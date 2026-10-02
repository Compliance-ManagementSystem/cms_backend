/**
 * Access Scope Utility
 *
 * Resolves which entities / locations the authenticated user may see and act on,
 * and applies that scope to list queries and single-resource checks.
 *
 *   - Super Admin & Admin: unrestricted
 *   - Location Manager: their assigned locations (falls back to their entity)
 *   - Other roles: their assigned entity; org-wide when no entity is assigned
 *   - Entity Admin / Location Manager with no assignment: nothing
 */

import { Request } from 'express';
import { Types } from 'mongoose';
import { ApiError } from './apiError.js';
import { ROLES } from '../constants/permissions.js';

export interface AccessScope {
  unrestricted: boolean;
  entityId?: string;
  locationIds?: string[];
}

export interface ScopedTarget {
  entity?: unknown;
  location?: unknown;
}

// Accepts an ObjectId, an id string, or a populated document
const idOf = (value: unknown): string | null => {
  if (!value) return null;
  const inner = (value as { _id?: unknown })._id;
  return (inner ?? value).toString();
};

export const getAccessScope = (req: Request): AccessScope => {
  const role = req.auth?.role;

  if (role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN) {
    return { unrestricted: true };
  }

  const entityId = req.auth?.entityId || undefined;

  if (role === ROLES.LOCATION_MANAGER) {
    const locationIds = (req.user?.assignedLocations || [])
      .map((loc) => idOf(loc))
      .filter((id): id is string => !!id);
    if (locationIds.length > 0) {
      return { unrestricted: false, entityId, locationIds };
    }
  }

  if (entityId) {
    return { unrestricted: false, entityId };
  }

  if (role === ROLES.ENTITY_ADMIN || role === ROLES.LOCATION_MANAGER) {
    return { unrestricted: false, locationIds: [] };
  }

  return { unrestricted: true };
};

/**
 * Mongo filter for models that carry `entity` and `location` references.
 * Uses ObjectIds so it is safe inside aggregation $match stages.
 */
export const toScopeFilter = (scope: AccessScope): Record<string, any> => {
  if (scope.unrestricted) return {};

  const filter: Record<string, any> = {};
  if (scope.entityId) {
    filter.entity = new Types.ObjectId(scope.entityId);
  }
  if (scope.locationIds) {
    filter.location = { $in: scope.locationIds.map((id) => new Types.ObjectId(id)) };
  }
  return filter;
};

/** Mongo filter for the Location collection itself (keyed by `_id`, not `location`) */
export const toLocationScopeFilter = (scope: AccessScope): Record<string, any> => {
  if (scope.unrestricted) return {};

  const filter: Record<string, any> = {};
  if (scope.entityId) {
    filter.entity = new Types.ObjectId(scope.entityId);
  }
  if (scope.locationIds) {
    filter._id = { $in: scope.locationIds.map((id) => new Types.ObjectId(id)) };
  }
  return filter;
};

export const isInScope = (scope: AccessScope, target: ScopedTarget): boolean => {
  if (scope.unrestricted) return true;

  if (scope.entityId && idOf(target.entity) !== scope.entityId) {
    return false;
  }
  if (scope.locationIds) {
    const locationId = idOf(target.location);
    if (!locationId || !scope.locationIds.includes(locationId)) {
      return false;
    }
  }
  return true;
};

export const assertInScope = (
  req: Request,
  target: ScopedTarget,
  message = 'You are not authorized to access resources outside your assigned entity or location.'
): void => {
  if (!isInScope(getAccessScope(req), target)) {
    throw ApiError.forbidden(message);
  }
};
