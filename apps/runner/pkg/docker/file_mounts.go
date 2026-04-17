// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type fileMountMetadata struct {
	FileId     string `json:"fileId"`
	Filename   string `json:"filename,omitempty"`
	TargetPath string `json:"targetPath"`
	Access     string `json:"access,omitempty"`
	Bucket     string `json:"bucket"`
	Key        string `json:"key"`
}

type fileMountState struct {
	FileId     string `json:"fileId"`
	Filename   string `json:"filename,omitempty"`
	TargetPath string `json:"targetPath"`
	Access     string `json:"access,omitempty"`
	Bucket     string `json:"bucket"`
	Key        string `json:"key"`
	LocalPath  string `json:"localPath"`
	OriginHash string `json:"originHash"`
}

type fileMountCacheMeta struct {
	ETag string `json:"etag"`
}

func (d *DockerClient) prepareFileMounts(
	ctx context.Context,
	fileMounts []fileMountMetadata,
) ([]string, []fileMountState, error) {
	if len(fileMounts) == 0 {
		return nil, nil, nil
	}

	s3Client, err := d.getFileMountS3Client()
	if err != nil {
		return nil, nil, err
	}

	fileMountPathBinds := make([]string, 0, len(fileMounts))
	states := make([]fileMountState, 0, len(fileMounts))
	downloaded := make(map[string]bool)

	for _, mount := range fileMounts {
		targetPath := normalizeFileMountTargetPath(mount.TargetPath, mount.Filename, mount.FileId)
		if targetPath == "" || !filepath.IsAbs(targetPath) {
			return nil, nil, fmt.Errorf("invalid file mount target path: %q", mount.TargetPath)
		}
		if mount.Bucket == "" || mount.Key == "" {
			return nil, nil, fmt.Errorf("file mount source is incomplete for fileId %q", mount.FileId)
		}

		localFilePath := getLocalFileMountPath(mount.FileId, mount.Filename, mount.Key)
		if !downloaded[localFilePath] {
			if err := d.ensureFileMountObject(ctx, s3Client, mount.Bucket, mount.Key, localFilePath); err != nil {
				return nil, nil, err
			}
			downloaded[localFilePath] = true
		}

		originHash, err := computeFileSHA256(localFilePath)
		if err != nil {
			return nil, nil, err
		}

		// Always mount read-write in container; write-back behavior is controlled by access policy.
		fileMountPathBinds = append(fileMountPathBinds, fmt.Sprintf("%s:%s:%s", localFilePath, targetPath, "rw"))
		states = append(states, fileMountState{
			FileId:     mount.FileId,
			Filename:   mount.Filename,
			TargetPath: targetPath,
			Access:     mount.Access,
			Bucket:     mount.Bucket,
			Key:        mount.Key,
			LocalPath:  localFilePath,
			OriginHash: originHash,
		})
	}

	return fileMountPathBinds, states, nil
}

func getLocalFileMountPath(fileID, filename, objectKey string) string {
	sum := sha256.Sum256([]byte(objectKey))
	keyHash := hex.EncodeToString(sum[:8])
	name := sanitizeFileMountName(filename)
	if name == "" {
		name = sanitizeFileMountName(fileID)
	}
	baseDir := filepath.Join(getVolumeMountBasePath(), "daytona-file-mounts", name, keyHash)
	return filepath.Join(baseDir, "content")
}

func sanitizeFileMountName(name string) string {
	base := strings.TrimSpace(filepath.Base(name))
	if base == "." || base == "/" {
		return ""
	}

	// Keep local cache paths filesystem-safe and predictable.
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_")
	return replacer.Replace(base)
}

func normalizeFileMountTargetPath(targetPath, filename, fileID string) string {
	path := strings.TrimSpace(targetPath)
	if path == "" {
		return path
	}

	name := strings.TrimSpace(filename)
	if name == "" {
		name = fileID
	}

	// targetPath is treated strictly as a directory; destination is always "<targetDir>/<filename>".
	return filepath.Clean(filepath.Join(path, name))
}

func computeFileSHA256(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read file %s for hash: %w", path, err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func (d *DockerClient) ensureFileMountObject(
	ctx context.Context,
	s3Client *minio.Client,
	bucket string,
	key string,
	localPath string,
) error {
	stat, err := s3Client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to stat file mount object s3://%s/%s: %w", bucket, key, err)
	}
	remoteETag := normalizeETag(stat.ETag)

	if _, err := os.Stat(localPath); err == nil {
		meta, metaErr := loadFileMountCacheMeta(localPath)
		if metaErr == nil && meta != nil && normalizeETag(meta.ETag) == remoteETag {
			return nil
		}
	}

	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return fmt.Errorf("failed to create file mount directory %s: %w", filepath.Dir(localPath), err)
	}

	d.logger.InfoContext(ctx, "downloading file mount object", "bucket", bucket, "key", key, "path", localPath)
	if err := s3Client.FGetObject(ctx, bucket, key, localPath, minio.GetObjectOptions{}); err != nil {
		return fmt.Errorf("failed to download file mount object s3://%s/%s: %w", bucket, key, err)
	}
	if err := persistFileMountCacheMeta(localPath, remoteETag); err != nil {
		return err
	}

	return nil
}

func getFileMountCacheMetaPath(localPath string) string {
	return localPath + ".meta.json"
}

func loadFileMountCacheMeta(localPath string) (*fileMountCacheMeta, error) {
	raw, err := os.ReadFile(getFileMountCacheMetaPath(localPath))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read file mount cache metadata: %w", err)
	}

	var meta fileMountCacheMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil, fmt.Errorf("failed to parse file mount cache metadata: %w", err)
	}
	return &meta, nil
}

func persistFileMountCacheMeta(localPath, etag string) error {
	if etag == "" {
		return nil
	}

	meta := fileMountCacheMeta{ETag: normalizeETag(etag)}
	raw, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("failed to marshal file mount cache metadata: %w", err)
	}

	metaPath := getFileMountCacheMetaPath(localPath)
	tmpPath := metaPath + ".tmp"
	if err := os.WriteFile(tmpPath, raw, 0644); err != nil {
		return fmt.Errorf("failed to write temporary file mount cache metadata: %w", err)
	}
	if err := os.Rename(tmpPath, metaPath); err != nil {
		return fmt.Errorf("failed to move file mount cache metadata into place: %w", err)
	}
	return nil
}

func normalizeETag(etag string) string {
	return strings.Trim(strings.TrimSpace(etag), "\"")
}

func getFileMountStatePath(containerID string) string {
	return filepath.Join(getVolumeMountBasePath(), "daytona-file-mounts", ".state", containerID+".json")
}

func persistFileMountState(containerID string, states []fileMountState) error {
	statePath := getFileMountStatePath(containerID)
	if err := os.MkdirAll(filepath.Dir(statePath), 0755); err != nil {
		return fmt.Errorf("failed to create file mount state directory: %w", err)
	}

	raw, err := json.Marshal(states)
	if err != nil {
		return fmt.Errorf("failed to marshal file mount state: %w", err)
	}

	tmpPath := statePath + ".tmp"
	if err := os.WriteFile(tmpPath, raw, 0644); err != nil {
		return fmt.Errorf("failed to write temporary file mount state: %w", err)
	}

	if err := os.Rename(tmpPath, statePath); err != nil {
		return fmt.Errorf("failed to move file mount state into place: %w", err)
	}

	return nil
}

func loadFileMountState(containerID string) ([]fileMountState, error) {
	statePath := getFileMountStatePath(containerID)
	raw, err := os.ReadFile(statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read file mount state: %w", err)
	}

	var states []fileMountState
	if err := json.Unmarshal(raw, &states); err != nil {
		return nil, fmt.Errorf("failed to parse file mount state: %w", err)
	}
	return states, nil
}

func clearFileMountState(containerID string) {
	_ = os.Remove(getFileMountStatePath(containerID))
}

func (d *DockerClient) syncFileMountsToS3(ctx context.Context, containerID string) error {
	states, err := loadFileMountState(containerID)
	if err != nil || len(states) == 0 {
		return err
	}

	s3Client, err := d.getFileMountS3Client()
	if err != nil {
		return err
	}

	updated := false
	for i := range states {
		state := &states[i]
		if state.Access != "read_write" {
			continue
		}

		currentHash, err := computeFileSHA256(state.LocalPath)
		if err != nil {
			return err
		}
		if currentHash == state.OriginHash {
			continue
		}

		d.logger.InfoContext(ctx, "uploading changed file mount back to object storage", "bucket", state.Bucket, "key", state.Key)
		// TODO: add optimistic concurrency control (e.g. If-Match/version check) to avoid concurrent overwrite conflicts.
		uploadInfo, err := s3Client.FPutObject(ctx, state.Bucket, state.Key, state.LocalPath, minio.PutObjectOptions{})
		if err != nil {
			return fmt.Errorf("failed to upload updated file mount s3://%s/%s: %w", state.Bucket, state.Key, err)
		}
		if err := persistFileMountCacheMeta(state.LocalPath, uploadInfo.ETag); err != nil {
			return err
		}
		state.OriginHash = currentHash
		updated = true
	}

	if updated {
		return persistFileMountState(containerID, states)
	}
	return nil
}

func (d *DockerClient) getFileMountS3Client() (*minio.Client, error) {
	endpoint := d.awsEndpointUrl
	useSSL := strings.HasPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimPrefix(endpoint, "https://")

	if endpoint == "" || d.awsAccessKeyId == "" || d.awsSecretAccessKey == "" {
		return nil, fmt.Errorf("missing AWS configuration for file mounts")
	}

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(d.awsAccessKeyId, d.awsSecretAccessKey, ""),
		Secure: useSSL,
		Region: d.awsRegion,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create S3 client for file mounts: %w", err)
	}

	return client, nil
}
