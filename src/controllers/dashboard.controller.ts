import { Request, Response, NextFunction } from 'express';
import { dashboardService, DashboardFilters } from '../services/dashboard.service.js';

export class DashboardController {
  /**
   * GET /api/dashboard/stats
   * Aggregated dashboard KPIs, charts, traffic lights, and drilldown metrics
   */
  public async getDashboardStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters: DashboardFilters = {
        state: req.query.state as string,
        entity: req.query.entity as string,
        location: req.query.location as string,
        category: req.query.category as string,
        status: req.query.status as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        period: req.query.period as any,
      };

      const data = await dashboardService.getDashboardStats(filters);

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
  public async getFilterOptions(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = await dashboardService.getFilterOptions();

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
