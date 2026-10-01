/**
 * Report Controller
 *
 * Dedicated REST endpoints for querying, previewing, and exporting statutory reports:
 * 1. GET /api/reports/compliance
 * 2. GET /api/reports/expiry
 * 3. GET /api/reports/pending
 * 4. GET /api/reports/overdue
 * 5. GET /api/reports/entities
 * 6. GET /api/reports/locations
 * 7. GET /api/reports/tasks
 * 8. GET /api/reports/export/csv
 * 9. GET /api/reports/export/excel
 * 10. GET /api/reports/filters
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/apiError.js';
import { ReportService, ReportType, ReportFilterParams } from '../services/report.service.js';

export class ReportController {
  private static parseFilters(req: Request): ReportFilterParams {
    const {
      startDate,
      endDate,
      state,
      entity,
      location,
      status,
      category,
      assignedUser,
      search,
      page,
      limit,
      sortBy,
      sortOrder,
    } = req.query;

    return {
      startDate: startDate as string,
      endDate: endDate as string,
      state: state as string,
      entity: entity as string,
      location: location as string,
      status: status as string,
      category: category as string,
      assignedUser: assignedUser as string,
      search: search as string,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      sortBy: sortBy as string,
      sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
    };
  }

  // ── Specific Report Type Endpoints ─────────────────────────────────────────

  public static getComplianceReport = asyncHandler(async (req: Request, res: Response) => {
    const filters = ReportController.parseFilters(req);
    const report = await ReportService.getComplianceReport(filters);
    return res.status(200).json(ApiResponse.success(report, 'Compliance report generated successfully'));
  });

  public static getExpiryReport = asyncHandler(async (req: Request, res: Response) => {
    const filters = ReportController.parseFilters(req);
    const report = await ReportService.getExpiryReport(filters);
    return res.status(200).json(ApiResponse.success(report, 'Expiry report generated successfully'));
  });

  public static getPendingReport = asyncHandler(async (req: Request, res: Response) => {
    const filters = ReportController.parseFilters(req);
    const report = await ReportService.getPendingReport(filters);
    return res.status(200).json(ApiResponse.success(report, 'Pending report generated successfully'));
  });

  public static getOverdueReport = asyncHandler(async (req: Request, res: Response) => {
    const filters = ReportController.parseFilters(req);
    const report = await ReportService.getOverdueReport(filters);
    return res.status(200).json(ApiResponse.success(report, 'Overdue report generated successfully'));
  });

  public static getEntityReport = asyncHandler(async (req: Request, res: Response) => {
    const filters = ReportController.parseFilters(req);
    const report = await ReportService.getEntityReport(filters);
    return res.status(200).json(ApiResponse.success(report, 'Entity report generated successfully'));
  });

  public static getLocationReport = asyncHandler(async (req: Request, res: Response) => {
    const filters = ReportController.parseFilters(req);
    const report = await ReportService.getLocationReport(filters);
    return res.status(200).json(ApiResponse.success(report, 'Location report generated successfully'));
  });

  public static getTaskReport = asyncHandler(async (req: Request, res: Response) => {
    const filters = ReportController.parseFilters(req);
    const report = await ReportService.getTaskReport(filters);
    return res.status(200).json(ApiResponse.success(report, 'Task report generated successfully'));
  });

  // ── CSV Export Stream ───────────────────────────────────────────────────────

  public static exportCsv = asyncHandler(async (req: Request, res: Response) => {
    const type = req.query.type as ReportType;
    if (!type) {
      throw ApiError.badRequest('Missing report type parameter');
    }

    const filters = ReportController.parseFilters(req);
    const report = await ReportService.generateReport(type, filters);
    const csvData = ReportService.toCsv(report);

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${type}_report_${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvData);
  });

  // ── Excel Export Stream ────────────────────────────────────────────────────

  public static exportExcel = asyncHandler(async (req: Request, res: Response) => {
    const type = req.query.type as ReportType;
    if (!type) {
      throw ApiError.badRequest('Missing report type parameter');
    }

    const filters = ReportController.parseFilters(req);
    const report = await ReportService.generateReport(type, filters);
    const excelXml = ReportService.toExcel(report);

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${type}_report_${timestamp}.xls`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(excelXml);
  });

  // ── Dynamic Filter Options ─────────────────────────────────────────────────

  public static getFilters = asyncHandler(async (_req: Request, res: Response) => {
    const filterOptions = await ReportService.getFilterOptions();
    return res.status(200).json(ApiResponse.success(filterOptions, 'Report filter options fetched successfully'));
  });
}
