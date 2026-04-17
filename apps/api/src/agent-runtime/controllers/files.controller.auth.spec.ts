/*
 * Copyright Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { FilesController } from './files.controller'
import { OrganizationAuthContextGuard } from '../../organization/guards/organization-auth-context.guard'
import { AuthStrategyType } from '../../auth/enums/auth-strategy-type.enum'
import {
  createCoverageTracker,
  expectArrayMatch,
  getAllowedAuthStrategies,
  getAuthContextGuards,
  isPublicEndpoint,
} from '../../test/helpers/controller-metadata.helper'

describe('[AUTH] FilesController', () => {
  const trackMethod = createCoverageTracker(FilesController)

  it('upload', () => {
    const methodName = trackMethod('upload')
    expect(isPublicEndpoint(FilesController, methodName)).toBe(false)
    expectArrayMatch(getAllowedAuthStrategies(FilesController, methodName), [
      AuthStrategyType.API_KEY,
      AuthStrategyType.JWT,
    ])
    expectArrayMatch(getAuthContextGuards(FilesController, methodName), [OrganizationAuthContextGuard])
  })

  it('list', () => {
    const methodName = trackMethod('list')
    expect(isPublicEndpoint(FilesController, methodName)).toBe(false)
    expectArrayMatch(getAllowedAuthStrategies(FilesController, methodName), [
      AuthStrategyType.API_KEY,
      AuthStrategyType.JWT,
    ])
    expectArrayMatch(getAuthContextGuards(FilesController, methodName), [OrganizationAuthContextGuard])
  })

  it('getMetadata', () => {
    const methodName = trackMethod('getMetadata')
    expect(isPublicEndpoint(FilesController, methodName)).toBe(false)
    expectArrayMatch(getAllowedAuthStrategies(FilesController, methodName), [
      AuthStrategyType.API_KEY,
      AuthStrategyType.JWT,
    ])
    expectArrayMatch(getAuthContextGuards(FilesController, methodName), [OrganizationAuthContextGuard])
  })

  it('download', () => {
    const methodName = trackMethod('download')
    expect(isPublicEndpoint(FilesController, methodName)).toBe(false)
    expectArrayMatch(getAllowedAuthStrategies(FilesController, methodName), [
      AuthStrategyType.API_KEY,
      AuthStrategyType.JWT,
    ])
    expectArrayMatch(getAuthContextGuards(FilesController, methodName), [OrganizationAuthContextGuard])
  })

  it('delete', () => {
    const methodName = trackMethod('delete')
    expect(isPublicEndpoint(FilesController, methodName)).toBe(false)
    expectArrayMatch(getAllowedAuthStrategies(FilesController, methodName), [
      AuthStrategyType.API_KEY,
      AuthStrategyType.JWT,
    ])
    expectArrayMatch(getAuthContextGuards(FilesController, methodName), [OrganizationAuthContextGuard])
  })
})
