/**
 * Authentication and Authorization Middlewares
 *
 * Enforces security at the backend boundary:
 *   - authenticate: Validates JWT access token and populates req.user
 *   - authorize: Role-based access control (RBAC)
 *   - requirePermission: Granular capability-based access control (CBAC)
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/token.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../models/User.js';
import { IRole } from '../models/Role.js';
import { ROLE_DEFINITIONS, ROLES, RoleCode } from '../constants/permissions.js';
import type { AuthenticatedUser } from '../types/auth.js';

/**
 * 1. Authenticate Middleware
 * Extracts and verifies JWT from Bearer Authorization header or cookie.
 * Attaches populated user document to req.user.
 */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    // 1. Extract token from header or cookie
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw ApiError.unauthorized('Authentication required. No token provided.');
    }

    // 2. Verify token signature and expiration
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Authentication token has expired. Please refresh your session.');
      }
      throw ApiError.unauthorized('Invalid authentication token.');
    }

    // 3. Find user and ensure account is active
    const user = await User.findById(decoded.userId)
      .populate<{ role: IRole }>('role')
      .populate('entity')
      .select('+refreshToken');

    if (!user) {
      throw ApiError.unauthorized('User associated with this token no longer exists.');
    }

    if (user.status !== 'active') {
      throw ApiError.forbidden(`Your account is ${user.status}. Please contact an administrator.`);
    }

    // 4. Attach to request
    req.user = user as unknown as AuthenticatedUser;
    req.auth = {
      userId: user._id.toString(),
      email: user.email,
      role: (user.role as IRole).code,
      entityId: user.entity ? (user.entity as any)._id?.toString() : null,
    };

    next();
  }
);

/**
 * 2. Authorize Middleware (Role-Based Access Control)
 * Ensures user has at least one of the required roles.
 * Super Admin always has full access.
 *
 * Example: authorize('super_admin', 'admin', 'entity_admin')
 */
export const authorize = (...allowedRoles: (string | string[])[]) => {
  const roles = allowedRoles.flat();
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return next(ApiError.unauthorized('Authentication required.'));
    }

    const userRoleCode = (req.user.role as IRole).code;

    // Super admin bypasses all role restrictions
    if (userRoleCode === ROLES.SUPER_ADMIN) {
      return next();
    }

    if (!roles.includes(userRoleCode)) {
      return next(
        ApiError.forbidden(
          `Access denied. Role '${userRoleCode}' is not authorized to access this resource.`
        )
      );
    }

    next();
  };
};

/**
 * Helper to check if a user has a specific permission
 */
export const hasUserPermission = (
  user: AuthenticatedUser,
  targetResource: string,
  targetAction: string
): boolean => {
  if (!user || !user.role) return false;

  const role = user.role as any;
  const roleCode: string =
    typeof role === 'string'
      ? role
      : role.code || (user as any).auth?.role || '';

  // Super Admin has unrestricted permissions globally
  if (roleCode === ROLES.SUPER_ADMIN || roleCode === 'super_admin') {
    return true;
  }

  const reqRes = targetResource.toLowerCase();
  const reqAct = targetAction.toLowerCase();
  const permString = `${reqRes}:${reqAct}`;

  // 1. Check embedded role permissions (objects or strings)
  if (Array.isArray(role.permissions)) {
    for (const p of role.permissions) {
      // String permission: e.g. "entity:read", "*", "entity:*"
      if (typeof p === 'string') {
        const pLower = p.toLowerCase();
        if (
          pLower === '*' ||
          pLower === '*:*' ||
          pLower === permString ||
          pLower === `${reqRes}:*` ||
          pLower === `*:${reqAct}`
        ) {
          return true;
        }
      }
      // Object permission: e.g. { resource: "entity", actions: ["read", "update"] }
      else if (p && typeof p === 'object') {
        const res = (p.resource || '').toLowerCase();
        const actions: string[] = Array.isArray(p.actions)
          ? p.actions.map((a: any) => String(a).toLowerCase())
          : [];

        const resourceMatches = res === '*' || res === reqRes;
        const actionMatches =
          actions.includes('*') ||
          actions.includes(reqAct) ||
          reqAct === '*';

        if (resourceMatches && actionMatches) {
          return true;
        }
      }
    }
  }

  // 2. Check centralized role definition fallback (from ROLE_DEFINITIONS)
  const definition = ROLE_DEFINITIONS[roleCode as RoleCode];
  if (definition && Array.isArray(definition.permissions)) {
    for (const dp of definition.permissions) {
      const dpStr = String(dp).toLowerCase();
      if (
        dpStr === '*' ||
        dpStr === '*:*' ||
        dpStr === permString ||
        dpStr === `${reqRes}:*` ||
        dpStr === `*:${reqAct}`
      ) {
        return true;
      }
    }
  }

  return false;
};

/**
 * 3. RequirePermission Middleware (Capability-Based Access Control)
 * Validates that the authenticated user's role grants permission to execute an action.
 *
 * Overloads:
 *   requirePermission('entity:create')
 *   requirePermission('entity', 'create')
 *   requirePermission(['entity:read', 'entity:update'])
 */
export const requirePermission = (
  resourceOrCode: string | string[],
  action?: string
) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return next(ApiError.unauthorized('Authentication required.'));
    }

    // Support single string or array of permissions (if array, user needs at least one)
    const checks: Array<{ resource: string; action: string }> = [];

    if (Array.isArray(resourceOrCode)) {
      for (const item of resourceOrCode) {
        const colonIndex = item.lastIndexOf(':');
        if (colonIndex > 0) {
          checks.push({
            resource: item.substring(0, colonIndex).trim().toLowerCase(),
            action: item.substring(colonIndex + 1).trim().toLowerCase(),
          });
        } else {
          checks.push({ resource: item.trim().toLowerCase(), action: '*' });
        }
      }
    } else if (action) {
      checks.push({
        resource: resourceOrCode.trim().toLowerCase(),
        action: action.trim().toLowerCase(),
      });
    } else {
      const colonIndex = resourceOrCode.lastIndexOf(':');
      if (colonIndex > 0) {
        checks.push({
          resource: resourceOrCode.substring(0, colonIndex).trim().toLowerCase(),
          action: resourceOrCode.substring(colonIndex + 1).trim().toLowerCase(),
        });
      } else {
        checks.push({ resource: resourceOrCode.trim().toLowerCase(), action: '*' });
      }
    }

    const isPermitted = checks.some((chk) =>
      hasUserPermission(req.user, chk.resource, chk.action)
    );

    if (!isPermitted) {
      const missing = checks.map((c) => `${c.resource}:${c.action}`).join(' or ');
      return next(
        ApiError.forbidden(`Permission denied: Missing required permission '${missing}'`)
      );
    }

    next();
  };
};
