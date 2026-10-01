/**
 * Audit Log Controller
 *
 * Exposes read-only endpoints for querying, filtering, and inspecting immutable audit logs:
 * - GET /api/audit-logs
 * - GET /api/audit-logs/filters
 * - GET /api/audit-logs/:id
 *
 * Immutability Guarantee:
 * - No POST, PUT, PATCH, or DELETE routes exist for audit logs.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/apiError.js';
import { AuditService } from '../services/audit.service.js';

export class AuditController {
  /**
   * GET /api/audit-logs
   */
  public static getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
    const {
      search,
      userId,
      module,
      action,
      entityType,
      recordId,
      startDate,
      endDate,
      page,
      limit,
      sortBy,
      sortOrder,
    } = req.query;

    const result = await AuditService.queryAuditLogs({
      search: search as string,
      userId: userId as string,
      module: module as string,
      action: action as string,
      entityType: entityType as string,
      recordId: recordId as string,
      startDate: startDate as string,
      endDate: endDate as string,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 20,
      sortBy: sortBy as string,
      sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
    });

    return res.status(200).json(
      ApiResponse.success(
        result.logs,
        'Audit logs retrieved successfully',
        200,
        result.pagination
      )
    );
  });

  /**
   * GET /api/audit-logs/filters
   */
  public static getFilters = asyncHandler(async (_req: Request, res: Response) => {
    const filters = await AuditService.getFilterOptions();
    return res.status(200).json(ApiResponse.success(filters, 'Audit filter options fetched successfully'));
  });

  /**
   * GET /api/audit-logs/:id
   */
  public static getAuditLogById = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const log = await AuditService.getAuditLogById(id);

    if (!log) {
      throw ApiError.notFound('Audit log entry not found');
    }

    return res.status(200).json(ApiResponse.success(log, 'Audit log details fetched successfully'));
  });
}
