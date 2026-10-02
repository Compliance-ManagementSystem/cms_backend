/**
 * Report Generation Service
 *
 * Implements real database queries and aggregations for:
 * 1. Compliance Report
 * 2. Expiry Report
 * 3. Pending Report
 * 4. Overdue Report
 * 5. Entity Report
 * 6. Location Report
 * 7. Task Report
 *
 * Supports CSV and Excel-compatible tabular exports with RFC 4180 escaping.
 */

import { Types } from 'mongoose';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import Task, { isTaskOverdue } from '../models/Task.js';
import ComplianceRule from '../models/ComplianceRule.js';
import MasterData from '../models/MasterData.js';
import User from '../models/User.js';

export type ReportType =
  | 'compliance'
  | 'expiry'
  | 'pending'
  | 'overdue'
  | 'entities'
  | 'locations'
  | 'tasks';

export interface ReportFilterParams {
  startDate?: string;
  endDate?: string;
  state?: string;
  entity?: string;
  location?: string;
  status?: string;
  category?: string;
  assignedUser?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ReportResult<T = any> {
  reportType: ReportType;
  title: string;
  generatedAt: string;
  filtersApplied: Record<string, any>;
  summary: Record<string, number | string>;
  totalRecords: number;
  page?: number;
  limit?: number;
  data: T[];
}

export class ReportService {
  /**
   * Helper to build common Mongoose match query for ComplianceRecord
   */
  private static async buildRecordFilter(filters: ReportFilterParams): Promise<any> {
    const match: any = {
      status: { $ne: 'not_applicable' },
    };

    // State filter (via Location lookup)
    if (filters.state) {
      const locationIds = await Location.find({
        'address.state': { $regex: new RegExp(`^${filters.state.trim()}$`, 'i') },
      }).distinct('_id');
      match.location = { $in: locationIds };
    }

    // Entity filter
    if (filters.entity && Types.ObjectId.isValid(filters.entity)) {
      match.entity = new Types.ObjectId(filters.entity);
    }

    // Location filter
    if (filters.location && Types.ObjectId.isValid(filters.location)) {
      match.location = new Types.ObjectId(filters.location);
    }

    // Assigned User filter
    if (filters.assignedUser && Types.ObjectId.isValid(filters.assignedUser)) {
      match.assignedUser = new Types.ObjectId(filters.assignedUser);
    }

    // Category filter (via ComplianceRule)
    if (filters.category && Types.ObjectId.isValid(filters.category)) {
      const ruleIds = await ComplianceRule.find({
        category: new Types.ObjectId(filters.category),
      }).distinct('_id');
      match.rule = { $in: ruleIds };
    }

    // Status filter
    if (filters.status && filters.status !== 'all') {
      match.status = filters.status;
    }

    // Date range filter (dueDate or expiryDate or createdAt)
    if (filters.startDate || filters.endDate) {
      match.createdAt = {};
      if (filters.startDate) match.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        match.createdAt.$lte = end;
      }
    }

    return match;
  }

  // ── 1. Compliance Master Report ─────────────────────────────────────────────
  public static async getComplianceReport(filters: ReportFilterParams): Promise<ReportResult> {
    const match = await this.buildRecordFilter(filters);

    const records = await ComplianceRecord.find(match)
      .populate('entity', 'name code entityCode')
      .populate('location', 'name code locationCode address')
      .populate({
        path: 'rule',
        select: 'name code frequency category',
        populate: { path: 'category', select: 'name code' },
      })
      .populate('assignedUser', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    // Summary calculation
    let compliant = 0;
    let pending = 0;
    let expiringSoon = 0;
    let expired = 0;

    const data = records.map((r: any) => {
      if (r.status === 'approved') compliant++;
      else if (r.status === 'expiring_soon') expiringSoon++;
      else if (r.status === 'expired' || r.status === 'rejected') expired++;
      else pending++;

      return {
        id: r._id.toString(),
        recordNumber: r.recordNumber || `REC-${r._id.toString().slice(-6).toUpperCase()}`,
        ruleName: r.rule?.name || 'N/A',
        ruleCode: r.rule?.code || 'N/A',
        category: r.rule?.category?.name || 'General',
        entityName: r.entity?.name || 'N/A',
        entityCode: r.entity?.entityCode || r.entity?.code || 'N/A',
        locationName: r.location?.name || 'N/A',
        locationCode: r.location?.locationCode || r.location?.code || 'N/A',
        state: r.location?.address?.state || 'N/A',
        city: r.location?.address?.city || 'N/A',
        status: r.status,
        dueDate: r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : 'N/A',
        approvalDate: r.approvalDate ? new Date(r.approvalDate).toISOString().slice(0, 10) : 'N/A',
        expiryDate: r.expiryDate ? new Date(r.expiryDate).toISOString().slice(0, 10) : 'N/A',
        assignedTo: r.assignedUser ? `${r.assignedUser.firstName} ${r.assignedUser.lastName}` : 'Unassigned',
      };
    });

    const total = data.length;
    const complianceScore = total > 0 ? Math.round((compliant / total) * 100) : 100;

    return {
      reportType: 'compliance',
      title: 'Statutory Compliance Master Report',
      generatedAt: new Date().toISOString(),
      filtersApplied: filters,
      summary: {
        totalRecords: total,
        compliant,
        pending,
        expiringSoon,
        expired,
        complianceScore: `${complianceScore}%`,
      },
      totalRecords: total,
      data,
    };
  }

  // ── 2. Expiry Report ────────────────────────────────────────────────────────
  public static async getExpiryReport(filters: ReportFilterParams): Promise<ReportResult> {
    const match = await this.buildRecordFilter(filters);
    const now = new Date();
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAhead = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Default or targeted expiry matching
    match.$or = [
      { status: 'expiring_soon' },
      { expiryDate: { $gte: now, $lte: ninetyDaysAhead } },
      { status: 'expired' },
    ];

    const records = await ComplianceRecord.find(match)
      .populate('entity', 'name code entityCode')
      .populate('location', 'name code locationCode address')
      .populate({
        path: 'rule',
        select: 'name code frequency category',
        populate: { path: 'category', select: 'name code' },
      })
      .populate('assignedUser', 'firstName lastName email')
      .sort({ expiryDate: 1 })
      .lean();

    let expiring30Days = 0;
    let expiring60Days = 0;
    let expiring90Days = 0;
    let alreadyExpired = 0;

    const data = records.map((r: any) => {
      const exp = r.expiryDate ? new Date(r.expiryDate) : null;
      let daysRemaining: number | string = 'N/A';
      let urgency = 'medium';

      if (exp) {
        const diffMs = exp.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (daysRemaining <= 0) {
          alreadyExpired++;
          urgency = 'critical';
        } else if (daysRemaining <= 30) {
          expiring30Days++;
          urgency = 'high';
        } else if (daysRemaining <= 60) {
          expiring60Days++;
          urgency = 'medium';
        } else {
          expiring90Days++;
          urgency = 'low';
        }
      }

      return {
        id: r._id.toString(),
        recordNumber: r.recordNumber || `REC-${r._id.toString().slice(-6).toUpperCase()}`,
        ruleName: r.rule?.name || 'N/A',
        category: r.rule?.category?.name || 'General',
        entityName: r.entity?.name || 'N/A',
        locationName: r.location?.name || 'N/A',
        state: r.location?.address?.state || 'N/A',
        status: r.status,
        expiryDate: exp ? exp.toISOString().slice(0, 10) : 'N/A',
        daysRemaining,
        urgency,
        assignedTo: r.assignedUser ? `${r.assignedUser.firstName} ${r.assignedUser.lastName}` : 'Unassigned',
      };
    });

    return {
      reportType: 'expiry',
      title: 'Statutory Expiry & Renewal Forecast Report',
      generatedAt: new Date().toISOString(),
      filtersApplied: filters,
      summary: {
        totalRecords: data.length,
        expiring30Days,
        expiring60Days,
        expiring90Days,
        alreadyExpired,
      },
      totalRecords: data.length,
      data,
    };
  }

  // ── 3. Pending Approval / Submission Report ────────────────────────────────
  public static async getPendingReport(filters: ReportFilterParams): Promise<ReportResult> {
    const match = await this.buildRecordFilter(filters);
    match.status = { $in: ['pending', 'submitted', 'under_review', 'correction', 'resubmitted'] };

    const records = await ComplianceRecord.find(match)
      .populate('entity', 'name code entityCode')
      .populate('location', 'name code locationCode address')
      .populate({
        path: 'rule',
        select: 'name code frequency category',
        populate: { path: 'category', select: 'name code' },
      })
      .populate('assignedUser', 'firstName lastName email')
      .sort({ dueDate: 1 })
      .lean();

    let submittedCount = 0;
    let underReviewCount = 0;
    let pendingSubmissionCount = 0;
    let correctionCount = 0;

    const data = records.map((r: any) => {
      if (r.status === 'submitted') submittedCount++;
      else if (r.status === 'under_review') underReviewCount++;
      else if (r.status === 'correction') correctionCount++;
      else pendingSubmissionCount++;

      return {
        id: r._id.toString(),
        recordNumber: r.recordNumber || `REC-${r._id.toString().slice(-6).toUpperCase()}`,
        ruleName: r.rule?.name || 'N/A',
        category: r.rule?.category?.name || 'General',
        entityName: r.entity?.name || 'N/A',
        locationName: r.location?.name || 'N/A',
        state: r.location?.address?.state || 'N/A',
        status: r.status,
        dueDate: r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : 'N/A',
        submissionDate: r.submissionDate ? new Date(r.submissionDate).toISOString().slice(0, 10) : 'Not Submitted',
        assignedTo: r.assignedUser ? `${r.assignedUser.firstName} ${r.assignedUser.lastName}` : 'Unassigned',
      };
    });

    return {
      reportType: 'pending',
      title: 'Pending Compliance & Review Pipeline Report',
      generatedAt: new Date().toISOString(),
      filtersApplied: filters,
      summary: {
        totalPending: data.length,
        pendingSubmissionCount,
        submittedCount,
        underReviewCount,
        correctionCount,
      },
      totalRecords: data.length,
      data,
    };
  }

  // ── 4. Overdue Compliance & Task Report ────────────────────────────────────
  public static async getOverdueReport(filters: ReportFilterParams): Promise<ReportResult> {
    const match = await this.buildRecordFilter(filters);
    const now = new Date();

    match.$or = [
      { status: 'expired' },
      { status: 'rejected' },
      {
        status: { $in: ['pending', 'submitted', 'under_review', 'correction'] },
        dueDate: { $lt: now },
      },
    ];

    const records = await ComplianceRecord.find(match)
      .populate('entity', 'name code entityCode')
      .populate('location', 'name code locationCode address')
      .populate({
        path: 'rule',
        select: 'name code frequency category',
        populate: { path: 'category', select: 'name code' },
      })
      .populate('assignedUser', 'firstName lastName email')
      .sort({ dueDate: 1 })
      .lean();

    let overduePending = 0;
    let expiredRecords = 0;

    const data = records.map((r: any) => {
      const due = r.dueDate ? new Date(r.dueDate) : null;
      let daysOverdue = 0;
      if (due && due < now) {
        daysOverdue = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      }

      if (r.status === 'expired') expiredRecords++;
      else overduePending++;

      return {
        id: r._id.toString(),
        recordNumber: r.recordNumber || `REC-${r._id.toString().slice(-6).toUpperCase()}`,
        ruleName: r.rule?.name || 'N/A',
        category: r.rule?.category?.name || 'General',
        entityName: r.entity?.name || 'N/A',
        locationName: r.location?.name || 'N/A',
        state: r.location?.address?.state || 'N/A',
        status: r.status,
        dueDate: due ? due.toISOString().slice(0, 10) : 'N/A',
        daysOverdue,
        assignedTo: r.assignedUser ? `${r.assignedUser.firstName} ${r.assignedUser.lastName}` : 'Unassigned',
      };
    });

    return {
      reportType: 'overdue',
      title: 'Statutory Non-Compliance & Overdue Violations Report',
      generatedAt: new Date().toISOString(),
      filtersApplied: filters,
      summary: {
        totalOverdue: data.length,
        overduePending,
        expiredRecords,
      },
      totalRecords: data.length,
      data,
    };
  }

  // ── 5. Corporate Entity Master Report ──────────────────────────────────────
  public static async getEntityReport(filters: ReportFilterParams): Promise<ReportResult> {
    const entityMatch: any = {};
    if (filters.status && filters.status !== 'all') {
      entityMatch.status = filters.status;
    }
    if (filters.state) {
      entityMatch['address.state'] = { $regex: new RegExp(`^${filters.state.trim()}$`, 'i') };
    }
    if (filters.entity && Types.ObjectId.isValid(filters.entity)) {
      entityMatch._id = new Types.ObjectId(filters.entity);
    }

    const entities = await Entity.find(entityMatch)
      .populate('entityType', 'name code')
      .populate('owner', 'firstName lastName email')
      .sort({ name: 1 })
      .lean();

    const data = await Promise.all(
      entities.map(async (ent: any) => {
        const [locationCount, totalRecs, compliantRecs, overdueRecs] = await Promise.all([
          Location.countDocuments({ entity: ent._id, status: 'active' }),
          ComplianceRecord.countDocuments({ entity: ent._id, status: { $ne: 'not_applicable' } }),
          ComplianceRecord.countDocuments({ entity: ent._id, status: 'approved' }),
          ComplianceRecord.countDocuments({ entity: ent._id, status: { $in: ['expired', 'rejected'] } }),
        ]);

        const score = totalRecs > 0 ? Math.round((compliantRecs / totalRecs) * 100) : 100;

        return {
          id: ent._id.toString(),
          name: ent.name,
          code: ent.entityCode || ent.code || 'N/A',
          type: ent.entityType?.name || 'Corporate',
          state: ent.address?.state || 'N/A',
          city: ent.address?.city || 'N/A',
          status: ent.status,
          owner: ent.owner ? `${ent.owner.firstName} ${ent.owner.lastName}` : 'Unassigned',
          totalUnits: locationCount,
          totalCompliance: totalRecs,
          compliantCount: compliantRecs,
          overdueCount: overdueRecs,
          complianceScore: `${score}%`,
        };
      })
    );

    return {
      reportType: 'entities',
      title: 'Corporate Legal Entity Performance Report',
      generatedAt: new Date().toISOString(),
      filtersApplied: filters,
      summary: {
        totalEntities: data.length,
        activeEntities: data.filter((e) => e.status === 'active').length,
        totalFacilityUnits: data.reduce((acc, curr) => acc + curr.totalUnits, 0),
      },
      totalRecords: data.length,
      data,
    };
  }

  // ── 6. Facility Location / Unit Master Report ──────────────────────────────
  public static async getLocationReport(filters: ReportFilterParams): Promise<ReportResult> {
    const locMatch: any = {};
    if (filters.status && filters.status !== 'all') {
      locMatch.status = filters.status;
    }
    if (filters.state) {
      locMatch['address.state'] = { $regex: new RegExp(`^${filters.state.trim()}$`, 'i') };
    }
    if (filters.entity && Types.ObjectId.isValid(filters.entity)) {
      locMatch.entity = new Types.ObjectId(filters.entity);
    }
    if (filters.location && Types.ObjectId.isValid(filters.location)) {
      locMatch._id = new Types.ObjectId(filters.location);
    }

    const locations = await Location.find(locMatch)
      .populate('entity', 'name code entityCode')
      .populate('locationType', 'name code')
      .populate('manager', 'firstName lastName email')
      .sort({ name: 1 })
      .lean();

    const data = await Promise.all(
      locations.map(async (loc: any) => {
        const [totalRecs, compliantRecs, expiredRecs, pendingRecs] = await Promise.all([
          ComplianceRecord.countDocuments({ location: loc._id, status: { $ne: 'not_applicable' } }),
          ComplianceRecord.countDocuments({ location: loc._id, status: 'approved' }),
          ComplianceRecord.countDocuments({ location: loc._id, status: { $in: ['expired', 'rejected'] } }),
          ComplianceRecord.countDocuments({
            location: loc._id,
            status: { $in: ['pending', 'submitted', 'under_review', 'correction', 'resubmitted'] },
          }),
        ]);

        const score = totalRecs > 0 ? Math.round((compliantRecs / totalRecs) * 100) : 100;

        return {
          id: loc._id.toString(),
          name: loc.name,
          code: loc.locationCode || loc.code || 'N/A',
          type: loc.locationType?.name || 'Clinic/Office',
          entityName: loc.entity?.name || 'N/A',
          entityCode: loc.entity?.entityCode || loc.entity?.code || 'N/A',
          state: loc.address?.state || 'N/A',
          district: loc.address?.district || 'N/A',
          city: loc.address?.city || 'N/A',
          status: loc.status,
          manager: loc.manager ? `${loc.manager.firstName} ${loc.manager.lastName}` : 'Unassigned',
          totalCompliance: totalRecs,
          compliantCount: compliantRecs,
          pendingCount: pendingRecs,
          expiredCount: expiredRecs,
          complianceScore: `${score}%`,
        };
      })
    );

    return {
      reportType: 'locations',
      title: 'Facility Unit Audit & Compliance Report',
      generatedAt: new Date().toISOString(),
      filtersApplied: filters,
      summary: {
        totalLocations: data.length,
        activeLocations: data.filter((l) => l.status === 'active').length,
        totalObligationsTracked: data.reduce((acc, curr) => acc + curr.totalCompliance, 0),
      },
      totalRecords: data.length,
      data,
    };
  }

  // ── 7. Remedial Tasks Report ──────────────────────────────────────────────
  public static async getTaskReport(filters: ReportFilterParams): Promise<ReportResult> {
    const taskMatch: any = {};
    if (filters.status && filters.status !== 'all') {
      taskMatch.status = filters.status;
    }
    if (filters.entity && Types.ObjectId.isValid(filters.entity)) {
      taskMatch.entity = new Types.ObjectId(filters.entity);
    }
    if (filters.location && Types.ObjectId.isValid(filters.location)) {
      taskMatch.location = new Types.ObjectId(filters.location);
    }
    if (filters.assignedUser && Types.ObjectId.isValid(filters.assignedUser)) {
      taskMatch.assignedTo = new Types.ObjectId(filters.assignedUser);
    }
    if (filters.startDate || filters.endDate) {
      taskMatch.createdAt = {};
      if (filters.startDate) taskMatch.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        taskMatch.createdAt.$lte = end;
      }
    }

    const tasks = await Task.find(taskMatch)
      .populate('entity', 'name code entityCode')
      .populate('location', 'name code locationCode address')
      .populate('assignedTo', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName email')
      .populate('completedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    let openCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;
    let overdueCount = 0;

    const data = tasks.map((t: any) => {
      if (t.status === 'completed') completedCount++;
      else if (isTaskOverdue(t)) overdueCount++;
      else if (t.status === 'in_progress') inProgressCount++;
      else if (t.status !== 'cancelled') openCount++;

      return {
        id: t._id.toString(),
        title: t.title,
        priority: t.priority,
        status: t.status,
        entityName: t.entity?.name || 'N/A',
        locationName: t.location?.name || 'N/A',
        state: t.location?.address?.state || 'N/A',
        assignedTo: t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Unassigned',
        dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : 'N/A',
        createdAt: t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : 'N/A',
        completedAt: t.completedAt ? new Date(t.completedAt).toISOString().slice(0, 10) : 'N/A',
        completedBy: t.completedBy ? `${t.completedBy.firstName} ${t.completedBy.lastName}` : 'N/A',
      };
    });

    return {
      reportType: 'tasks',
      title: 'Statutory Remedial Tasks & Action Items Report',
      generatedAt: new Date().toISOString(),
      filtersApplied: filters,
      summary: {
        totalTasks: data.length,
        openCount,
        inProgressCount,
        completedCount,
        overdueCount,
      },
      totalRecords: data.length,
      data,
    };
  }

  // ── Dispatcher ─────────────────────────────────────────────────────────────
  public static async generateReport(type: ReportType, filters: ReportFilterParams): Promise<ReportResult> {
    switch (type) {
      case 'compliance':
        return this.getComplianceReport(filters);
      case 'expiry':
        return this.getExpiryReport(filters);
      case 'pending':
        return this.getPendingReport(filters);
      case 'overdue':
        return this.getOverdueReport(filters);
      case 'entities':
        return this.getEntityReport(filters);
      case 'locations':
        return this.getLocationReport(filters);
      case 'tasks':
        return this.getTaskReport(filters);
      default:
        throw new Error(`Invalid report type: ${type}`);
    }
  }

  // ── CSV Exporter (RFC 4180 Escaped + UTF-8 BOM for Microsoft Excel) ────────
  public static toCsv(result: ReportResult): string {
    if (!result.data || result.data.length === 0) {
      return '\ufeffNo records match the requested report criteria.';
    }

    const headers = Object.keys(result.data[0]).filter((k) => k !== 'id');

    const escapeCell = (val: any): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const lines: string[] = [];

    // Title & Metadata Header
    lines.push(`"${result.title}"`);
    lines.push(`"Generated At: ${result.generatedAt}"`);
    lines.push(`"Total Records: ${result.totalRecords}"`);

    // Summary row
    const summaryEntries = Object.entries(result.summary)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ');
    lines.push(`"Summary: ${summaryEntries}"`);
    lines.push(''); // blank line before table

    // Column Headers
    lines.push(headers.map((h) => escapeCell(h.toUpperCase())).join(','));

    // Data Rows
    for (const row of result.data) {
      const line = headers.map((h) => escapeCell(row[h])).join(',');
      lines.push(line);
    }

    // Prepend UTF-8 Byte Order Mark (BOM) so Excel opens UTF-8 encoded text automatically
    return '\ufeff' + lines.join('\r\n');
  }

  // ── Excel Compatible TSV / XML Exporter ────────────────────────────────────
  public static toExcel(result: ReportResult): string {
    // Generate clean XML Spreadsheet 2003 format natively supported by Excel without binary dependencies
    const escapeXml = (str: any) => {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    const headers = result.data.length > 0
      ? Object.keys(result.data[0]).filter((k) => k !== 'id')
      : [];

    let rowsXml = '';

    // Title Row
    rowsXml += `<Row><Cell><Data ss:Type="String">${escapeXml(result.title)}</Data></Cell></Row>\n`;
    rowsXml += `<Row><Cell><Data ss:Type="String">Generated: ${escapeXml(result.generatedAt)}</Data></Cell></Row>\n`;
    rowsXml += `<Row><Cell><Data ss:Type="String">Total Records: ${result.totalRecords}</Data></Cell></Row>\n<Row></Row>\n`;

    // Header Row
    if (headers.length > 0) {
      rowsXml += '<Row ss:StyleID="HeaderStyle">\n';
      for (const h of headers) {
        rowsXml += `  <Cell><Data ss:Type="String">${escapeXml(h.toUpperCase())}</Data></Cell>\n`;
      }
      rowsXml += '</Row>\n';

      // Data Rows
      for (const item of result.data) {
        rowsXml += '<Row>\n';
        for (const h of headers) {
          const val = item[h];
          const isNum = typeof val === 'number';
          rowsXml += `  <Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escapeXml(val)}</Data></Cell>\n`;
        }
        rowsXml += '</Row>\n';
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#1E293B" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Report">
  <Table>
   ${rowsXml}
  </Table>
 </Worksheet>
</Workbook>`;
  }

  // ── Dynamic Filters Lookup ─────────────────────────────────────────────────
  public static async getFilterOptions() {
    const [entities, locations, categories, users] = await Promise.all([
      Entity.find({ status: 'active' }).select('_id name code entityCode address').sort({ name: 1 }).lean(),
      Location.find({ status: 'active' }).select('_id name code locationCode entity address').sort({ name: 1 }).lean(),
      MasterData.find({ category: 'compliance_category', status: 'active' }).select('_id name code').sort({ name: 1 }).lean(),
      User.find({ status: 'active' }).select('_id firstName lastName email').sort({ firstName: 1 }).lean(),
    ]);

    const stateSet = new Set<string>();
    for (const e of entities) {
      if (e.address?.state) stateSet.add(e.address.state.trim());
    }
    for (const l of locations) {
      if (l.address?.state) stateSet.add(l.address.state.trim());
    }

    return {
      states: Array.from(stateSet).sort(),
      entities: entities.map((e) => ({
        _id: e._id.toString(),
        name: e.name,
        code: (e as any).entityCode || e.code,
        state: e.address?.state,
      })),
      locations: locations.map((l) => ({
        _id: l._id.toString(),
        name: l.name,
        code: (l as any).locationCode || l.code,
        entityId: (l.entity as any)?._id?.toString() || (l.entity as any)?.toString() || '',
        state: l.address?.state,
      })),
      categories: categories.map((c) => ({
        _id: c._id.toString(),
        name: c.name,
        code: c.code,
      })),
      users: users.map((u) => ({
        _id: u._id.toString(),
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
      })),
    };
  }
}
