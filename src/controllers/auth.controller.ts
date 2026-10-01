/**
 * Authentication Controller
 *
 * Implements:
 *   - POST /api/auth/login
 *   - POST /api/auth/logout
 *   - GET  /api/auth/me
 *   - POST /api/auth/refresh
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/apiError.js';
import { env } from '../config/env.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/token.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { IRole } from '../models/Role.js';
import { ROLE_DEFINITIONS, ROLES, RoleCode } from '../constants/permissions.js';

/**
 * Helper to compute the flat list of permission strings for a role
 */
export const getEffectivePermissions = (role: IRole): string[] => {
  if (role.code === ROLES.SUPER_ADMIN) {
    return ['*'];
  }

  const permissionsSet = new Set<string>();

  // 1. From embedded role permissions
  if (Array.isArray(role.permissions)) {
    for (const p of role.permissions) {
      for (const a of p.actions) {
        permissionsSet.add(`${p.resource}:${a}`);
      }
    }
  }

  // 2. From centralized role catalog
  const def = ROLE_DEFINITIONS[role.code as RoleCode];
  if (def && Array.isArray(def.permissions)) {
    for (const p of def.permissions) {
      permissionsSet.add(p);
    }
  }

  return Array.from(permissionsSet);
};

/**
 * Cookie options for the refresh token
 */
const getRefreshTokenCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
});

/**
 * 1. Login
 * POST /api/auth/login
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // 1. Find user with password and role
  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('+password +refreshToken')
    .populate<{ role: IRole }>('role')
    .populate('entity');

  if (!user) {
    throw ApiError.unauthorized('Invalid email or password.');
  }

  // 2. Verify password with bcrypt
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw ApiError.unauthorized('Invalid email or password.');
  }

  // 3. Verify user status
  if (user.status !== 'active') {
    throw ApiError.forbidden(`Your account is ${user.status}. Please contact an administrator.`);
  }

  const role = user.role as unknown as IRole;
  const entityId = user.entity ? (user.entity as any)._id?.toString() : null;

  // 4. Generate tokens
  const tokenPayload = {
    userId: user._id.toString(),
    email: user.email,
    role: role.code,
    entityId,
  };

  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // 5. Store refresh token & update last login timestamp
  user.refreshToken = refreshToken;
  user.lastLoginAt = new Date();
  await user.save();

  // 6. Set HTTP-only cookie
  res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());

  // 7. Audit Log
  await AuditLog.create({
    action: 'login',
    resource: 'User',
    resourceId: user._id,
    entity: user.entity || undefined,
    actor: user._id,
    actorEmail: user.email,
    actorRole: role.code,
    ipAddress: req.ip || req.socket.remoteAddress || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'Unknown',
    description: `User ${user.email} (${role.name}) logged in successfully`,
  }).catch(() => {}); // Non-blocking audit log

  // 8. Prepare safe user response
  const userObject = user.toObject();
  delete (userObject as any).password;
  delete (userObject as any).refreshToken;

  const permissions = getEffectivePermissions(role);

  res.status(200).json(
    ApiResponse.ok('Login successful', {
      user: userObject,
      accessToken,
      refreshToken,
      permissions,
    })
  );
});

/**
 * 2. Logout
 * POST /api/auth/logout
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;

  if (token) {
    try {
      const decoded = verifyRefreshToken(token);
      await User.findByIdAndUpdate(decoded.userId, { refreshToken: null });
    } catch {
      // Token might be expired/invalid; proceed with clearing cookie
    }
  } else if (req.user) {
    await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
  }

  res.clearCookie('refreshToken', { path: '/' });

  res.status(200).json(ApiResponse.ok('Logged out successfully'));
});

/**
 * 3. Get Current User Profile
 * GET /api/auth/me
 */
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw ApiError.unauthorized('Not authenticated');
  }

  const userObject = (req.user as any).toObject ? (req.user as any).toObject() : req.user;
  delete userObject.password;
  delete userObject.refreshToken;

  const role = req.user.role as IRole;
  const permissions = getEffectivePermissions(role);

  res.status(200).json(
    ApiResponse.ok('Current user profile retrieved', {
      user: userObject,
      permissions,
    })
  );
});

/**
 * 4. Refresh Access Token
 * POST /api/auth/refresh
 */
export const refreshTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!token) {
    throw ApiError.unauthorized('Refresh token is required.');
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch (err: any) {
    res.clearCookie('refreshToken', { path: '/' });
    throw ApiError.unauthorized('Invalid or expired refresh token. Please login again.');
  }

  const user = await User.findById(decoded.userId)
    .select('+refreshToken')
    .populate<{ role: IRole }>('role')
    .populate('entity');

  if (!user || user.refreshToken !== token) {
    res.clearCookie('refreshToken', { path: '/' });
    throw ApiError.unauthorized('Refresh token is invalid or has been revoked.');
  }

  if (user.status !== 'active') {
    res.clearCookie('refreshToken', { path: '/' });
    throw ApiError.forbidden(`Your account is ${user.status}.`);
  }

  const role = user.role as unknown as IRole;
  const entityId = user.entity ? (user.entity as any)._id?.toString() : null;

  const tokenPayload = {
    userId: user._id.toString(),
    email: user.email,
    role: role.code,
    entityId,
  };

  // Issue new tokens
  const newAccessToken = generateAccessToken(tokenPayload);
  const newRefreshToken = generateRefreshToken(tokenPayload);

  // Rotate refresh token
  user.refreshToken = newRefreshToken;
  await user.save();

  res.cookie('refreshToken', newRefreshToken, getRefreshTokenCookieOptions());

  res.status(200).json(
    ApiResponse.ok('Session token refreshed successfully', {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    })
  );
});
