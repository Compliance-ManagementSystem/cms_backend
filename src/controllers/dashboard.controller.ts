import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { dashboardService } from '../services/dashboard.service.js';
import { getAccessScope } from '../utils/accessScope.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');

const dashboardQuerySchema = z.object({
  state: z.string().trim().min(1).max(100).optional(),
  entity: objectId.optional(),
  location: objectId.optional(),
  category: objectId.optional(),
});

export class DashboardController {
  /**
   * GET /api/dashboard/stats
   * Compliance health, task load, charts and alerts for the caller's scope
   */
  public async getDashboardStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = dashboardQuerySchema.parse(req.query);
      const data = await dashboardService.getDashboardStats(filters, getAccessScope(req));

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/filters
   * Returns available filter options (states, entities, locations, categories)
   */
  public async getFilterOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = await dashboardService.getFilterOptions(getAccessScope(req));

      res.status(200).json({
        success: true,
        data: filters,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const dashboardController = new DashboardController();
