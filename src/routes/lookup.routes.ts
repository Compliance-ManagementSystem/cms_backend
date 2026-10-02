/**
 * Lookup Routes
 *
 * Reference data for dropdowns, readable by any authenticated user.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { LookupService } from '../services/lookup.service.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getAccessScope } from '../utils/accessScope.js';

const router = Router();

router.use(authenticate);

router.get(
  '/master-data',
  asyncHandler(async (req: Request, res: Response) => {
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    if (!category) throw ApiError.badRequest('category is required');

    const items = await LookupService.getMasterData(category, req.query.parent as string | undefined);
    return ApiResponse.success(res, { items, total: items.length, category });
  })
);

router.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const users = await LookupService.getAssignableUsers(
      getAccessScope(req),
      req.auth!.userId,
      req.query.entity as string | undefined
    );
    return ApiResponse.success(res, { users });
  })
);

export default router;
