/**
 * Centralized Audit Service
 *
 * Implements centralized immutable audit logging for all mutations across the system:
 * - USER_CREATED, USER_UPDATED, ROLE_CHANGED
 * - ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED
 * - LOCATION_CREATED, LOCATION_UPDATED, LOCATION_DELETED
 * - COMPLIANCE_CREATED, COMPLIANCE_UPDATED, STATUS_CHANGED
 * - DOCUMENT_UPLOADED, DOCUMENT_REPLACED, DOCUMENT_VERIFIED
 * - APPROVAL_CREATED
 * - TASK_CREATED, TASK_UPDATED, TASK_COMPLETED
 * - RULE_CREATED, RULE_UPDATED
 * - SETTINGS_CHANGED
 *
 * Extracts request context (IP, User Agent), computes object differences,
 * and guarantees append-only immutability.
 */

import { Request } from 'express';
import { Types } from 'mongoose';
import AuditLog, { AuditEventAction, IAuditLog } from '../models/AuditLog.js';
import User from '../models/User.js';

export interface LogAuditParams {
  req?: Request;
  userId?: string | Types.ObjectId;
  userEmail?: string;
  role?: string;
  action: AuditEventAction;
  module:
    | 'users'
    | 'roles'
    | 'entities'
    | 'locations'
    | 'compliance'
    | 'documents'
    | 'approvals'
    | 'tasks'
    | 'rules'
    | 'settings'
    | string;
  entityType:
    | 'User'
    | 'Role'
    | 'Entity'
    | 'Location'
    | 'ComplianceRecord'
    | 'Document'
    | 'Approval'
    | 'Task'
    | 'ComplianceRule'
    | 'Settings'
    | string;
  entityId?: string | Types.ObjectId;
  recordId?: string | Types.ObjectId;
  previousValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  description?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditQueryFilters {
  search?: string;
  userId?: string;
  module?: string;
  action?: string;
  entityType?: string;
  recordId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export class AuditService {
  /**
   * Computes a structured difference between before and after states
   */
  public static computeDiff(
    before?: Record<string, any> | null,
    after?: Record<string, any> | null
  ): Record<string, { before: any; after: any }> {
    const diff: Record<string, { before: any; after: any }> = {};
    if (!before && !after) return diff;

    const b = before ? (typeof before.toObject === 'function' ? before.toObject() : before) : {};
    const a = after ? (typeof after.toObject === 'function' ? after.toObject() : after) : {};

    // Filter out internal and transient properties
    const ignoredKeys = new Set(['_id', '__v', 'password', 'createdAt', 'updatedAt']);

    const allKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const key of allKeys) {
      if (ignoredKeys.has(key)) continue;

      const valB = b[key];
      const valA = a[key];

      const strB = JSON.stringify(valB);
      const strA = JSON.stringify(valA);

      if (strB !== strA) {
        diff[key] = {
          before: valB !== undefined ? valB : null,
          after: valA !== undefined ? valA : null,
        };
      }
    }

    return diff;
  }

  /**
   * Main audit recording function
   */
  public static async logMutation(params: LogAuditParams): Promise<IAuditLog> {
    try {
      let finalUserId = params.userId;
      let finalRole = params.role;
      let finalEmail = params.userEmail;
      let ipAddress = params.ipAddress;
      let userAgent = params.userAgent;

      // Extract from Express request if provided
      if (params.req) {
        const req = params.req as any;
        if (!finalUserId && req.user?._id) {
          finalUserId = req.user._id;
        }
        if (!finalRole && req.user?.role) {
          finalRole = typeof req.user.role === 'object' ? req.user.role.name || req.user.role.code : req.user.role;
        }
        if (!finalEmail && req.user?.email) {
          finalEmail = req.user.email;
        }

        // IP address resolution
        if (!ipAddress) {
          ipAddress =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
            req.socket?.remoteAddress ||
            req.ip ||
            '127.0.0.1';
        }

        // User agent resolution
        if (!userAgent) {
          userAgent = req.headers['user-agent'] || 'Unknown client';
        }
      }

      let action = params.action;
      if (action === 'create' || action === 'update' || action === 'delete') {
        const ent = params.entityType.toUpperCase();
        if (action === 'create') action = `${ent}_CREATED`;
        else if (action === 'update') action = `${ent}_UPDATED`;
        else if (action === 'delete') action = `${ent}_DELETED`;
      }

      // Compute diff if before and after values are provided
      const diff = this.computeDiff(params.previousValue, params.newValue);

      // Generate default description if omitted
      let description = params.description;
      if (!description) {
        const actorName = finalEmail || (finalUserId ? `User ${finalUserId}` : 'System');
        const entityLabel = params.entityType || 'Resource';
        const idLabel = params.recordId || params.entityId || '';
        description = `${actorName} performed ${action} on ${entityLabel} ${idLabel}`.trim();
      }

      const auditRecord = new AuditLog({
        user: finalUserId ? new Types.ObjectId(finalUserId.toString()) : undefined,
        role: finalRole,
        actorEmail: finalEmail,
        action,
        module: params.module,
        entityType: params.entityType,
        entityId: params.entityId,
        recordId: params.recordId || params.entityId,
        previousValue: params.previousValue,
        newValue: params.newValue,
        diff,
        metadata: params.metadata,
        ipAddress,
        userAgent,
        description,
        timestamp: new Date(),
      });

      return await auditRecord.save();
    } catch (error) {
      console.error('❌ Failed to record AuditLog:', error);
      // Return a non-persisted fallback instance so callers are not broken
      return new AuditLog({
        action: params.action,
        module: params.module,
        entityType: params.entityType,
        description: params.description || `Failed audit log: ${params.action}`,
        timestamp: new Date(),
      });
    }
  }

  // ── Query Engine with Search & Filters ──────────────────────────────────────
  public static async queryAuditLogs(filters: AuditQueryFilters = {}) {
    const match: any = {};

    // Search query (across description, action, module, actorEmail, ipAddress)
    if (filters.search?.trim()) {
      const regex = new RegExp(filters.search.trim(), 'i');
      match.$or = [
        { description: regex },
        { action: regex },
        { module: regex },
        { actorEmail: regex },
        { ipAddress: regex },
        { userAgent: regex },
      ];
    }

    if (filters.userId && Types.ObjectId.isValid(filters.userId)) {
      match.user = new Types.ObjectId(filters.userId);
    }

    if (filters.module && filters.module !== 'all') {
      match.module = filters.module;
    }

    if (filters.action && filters.action !== 'all') {
      match.action = filters.action;
    }

    if (filters.entityType && filters.entityType !== 'all') {
      match.entityType = filters.entityType;
    }

    if (filters.recordId) {
      match.$or = [
        { recordId: filters.recordId },
        { entityId: filters.recordId },
      ];
    }

    // Date range filter
    if (filters.startDate || filters.endDate) {
      match.timestamp = {};
      if (filters.startDate) match.timestamp.$gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        match.timestamp.$lte = end;
      }
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const skip = (page - 1) * limit;

    const sortField = filters.sortBy || 'timestamp';
    const sortDir = filters.sortOrder === 'asc' ? 1 : -1;

    const [logs, total] = await Promise.all([
      AuditLog.find(match)
        .populate('user', 'firstName lastName email role')
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(match),
    ]);

    return {
      logs: logs.map((log: any) => ({
        id: log._id.toString(),
        user: log.user
          ? {
              id: log.user._id?.toString(),
              name: `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() || log.user.email,
              email: log.user.email,
              role: log.role || log.actorRole,
            }
          : {
              name: log.actorEmail || 'System Worker',
              email: log.actorEmail || 'system@cms.internal',
              role: log.role || 'system',
            },
        action: log.action,
        module: log.module,
        entityType: log.entityType,
        entityId: log.entityId?.toString() || log.recordId?.toString() || '',
        recordId: log.recordId?.toString() || log.entityId?.toString() || '',
        previousValue: log.previousValue,
        newValue: log.newValue,
        diff: log.diff || this.computeDiff(log.previousValue, log.newValue),
        metadata: log.metadata,
        description: log.description,
        ipAddress: log.ipAddress || '—',
        userAgent: log.userAgent || '—',
        timestamp: log.timestamp || log.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Fetch single audit log by ID
   */
  public static async getAuditLogById(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const log: any = await AuditLog.findById(id).populate('user', 'firstName lastName email role').lean();
    if (!log) return null;

    return {
      id: log._id.toString(),
      user: log.user
        ? {
            id: log.user._id?.toString(),
            name: `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() || log.user.email,
            email: log.user.email,
            role: log.role || log.actorRole,
          }
        : {
            name: log.actorEmail || 'System Worker',
            email: log.actorEmail || 'system@cms.internal',
            role: log.role || 'system',
          },
      action: log.action,
      module: log.module,
      entityType: log.entityType,
      entityId: log.entityId?.toString() || log.recordId?.toString() || '',
      recordId: log.recordId?.toString() || log.entityId?.toString() || '',
      previousValue: log.previousValue,
      newValue: log.newValue,
      diff: log.diff || this.computeDiff(log.previousValue, log.newValue),
      metadata: log.metadata,
      description: log.description,
      ipAddress: log.ipAddress || '—',
      userAgent: log.userAgent || '—',
      timestamp: log.timestamp || log.createdAt,
    };
  }

  /**
   * Fetch distinct filter dropdown options
   */
  public static async getFilterOptions() {
    const [modules, actions, entityTypes, users] = await Promise.all([
      AuditLog.distinct('module'),
      AuditLog.distinct('action'),
      AuditLog.distinct('entityType'),
      User.find({ status: 'active' }).select('_id firstName lastName email').sort({ firstName: 1 }).lean(),
    ]);

    return {
      modules: modules.filter(Boolean).sort(),
      actions: actions.filter(Boolean).sort(),
      entityTypes: entityTypes.filter(Boolean).sort(),
      users: users.map((u) => ({
        id: u._id.toString(),
        name: `${u.firstName} ${u.lastName}`.trim() || u.email,
        email: u.email,
      })),
    };
  }

  // ── Dedicated Helper Methods for Standard System Mutations ─────────────────

  public static async logUserCreated(user: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'USER_CREATED',
      module: 'users',
      entityType: 'User',
      recordId: user._id,
      newValue: { email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      description: `Created user account for ${user.email}`,
    });
  }

  public static async logUserUpdated(user: any, previousValue: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'USER_UPDATED',
      module: 'users',
      entityType: 'User',
      recordId: user._id,
      previousValue,
      newValue: { email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, status: user.status },
      description: `Updated profile details for user ${user.email}`,
    });
  }

  public static async logRoleChanged(user: any, prevRole: string, newRole: string, req?: Request) {
    return this.logMutation({
      req,
      action: 'ROLE_CHANGED',
      module: 'roles',
      entityType: 'User',
      recordId: user._id,
      previousValue: { role: prevRole },
      newValue: { role: newRole },
      description: `Changed role of user ${user.email} from '${prevRole}' to '${newRole}'`,
    });
  }

  public static async logEntityCreated(entity: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'ENTITY_CREATED',
      module: 'entities',
      entityType: 'Entity',
      recordId: entity._id,
      entityId: entity._id,
      newValue: { name: entity.name, code: entity.code || entity.entityCode, status: entity.status },
      description: `Created corporate entity '${entity.name}' (${entity.code || entity.entityCode})`,
    });
  }

  public static async logEntityUpdated(entity: any, previousValue: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'ENTITY_UPDATED',
      module: 'entities',
      entityType: 'Entity',
      recordId: entity._id,
      entityId: entity._id,
      previousValue,
      newValue: { name: entity.name, code: entity.code || entity.entityCode, status: entity.status },
      description: `Updated corporate entity '${entity.name}' (${entity.code || entity.entityCode})`,
    });
  }

  public static async logEntityDeleted(entity: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'ENTITY_DELETED',
      module: 'entities',
      entityType: 'Entity',
      recordId: entity._id,
      entityId: entity._id,
      previousValue: { name: entity.name, code: entity.code || entity.entityCode },
      description: `Deleted corporate entity '${entity.name}' (${entity.code || entity.entityCode})`,
    });
  }

  public static async logLocationCreated(location: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'LOCATION_CREATED',
      module: 'locations',
      entityType: 'Location',
      recordId: location._id,
      entityId: location.entity,
      newValue: { name: location.name, code: location.code || location.locationCode, status: location.status },
      description: `Created facility location '${location.name}' (${location.code || location.locationCode})`,
    });
  }

  public static async logLocationUpdated(location: any, previousValue: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'LOCATION_UPDATED',
      module: 'locations',
      entityType: 'Location',
      recordId: location._id,
      entityId: location.entity,
      previousValue,
      newValue: { name: location.name, code: location.code || location.locationCode, status: location.status },
      description: `Updated facility location '${location.name}' (${location.code || location.locationCode})`,
    });
  }

  public static async logLocationDeleted(location: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'LOCATION_DELETED',
      module: 'locations',
      entityType: 'Location',
      recordId: location._id,
      entityId: location.entity,
      previousValue: { name: location.name, code: location.code || location.locationCode },
      description: `Deleted facility location '${location.name}' (${location.code || location.locationCode})`,
    });
  }

  public static async logComplianceCreated(record: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'COMPLIANCE_CREATED',
      module: 'compliance',
      entityType: 'ComplianceRecord',
      recordId: record._id,
      entityId: record.entity,
      newValue: { recordNumber: record.recordNumber, status: record.status, dueDate: record.dueDate },
      description: `Created statutory compliance record '${record.recordNumber || record._id}'`,
    });
  }

  public static async logComplianceUpdated(record: any, previousValue: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'COMPLIANCE_UPDATED',
      module: 'compliance',
      entityType: 'ComplianceRecord',
      recordId: record._id,
      entityId: record.entity,
      previousValue,
      newValue: { recordNumber: record.recordNumber, status: record.status, dueDate: record.dueDate, expiryDate: record.expiryDate },
      description: `Updated statutory compliance record '${record.recordNumber || record._id}'`,
    });
  }

  public static async logStatusChanged(record: any, previousStatus: string, newStatus: string, req?: Request) {
    return this.logMutation({
      req,
      action: 'STATUS_CHANGED',
      module: 'compliance',
      entityType: 'ComplianceRecord',
      recordId: record._id,
      entityId: record.entity,
      previousValue: { status: previousStatus },
      newValue: { status: newStatus },
      description: `Status changed from '${previousStatus}' to '${newStatus}' for record '${record.recordNumber || record._id}'`,
    });
  }

  public static async logDocumentUploaded(doc: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'DOCUMENT_UPLOADED',
      module: 'documents',
      entityType: 'Document',
      recordId: doc._id,
      entityId: doc.entity,
      newValue: { fileName: doc.name || doc.fileName, mimeType: doc.mimeType, version: doc.version },
      description: `Uploaded document '${doc.name || doc.fileName}' (v${doc.version || 1})`,
    });
  }

  public static async logDocumentReplaced(doc: any, prevVersion: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'DOCUMENT_REPLACED',
      module: 'documents',
      entityType: 'Document',
      recordId: doc._id,
      entityId: doc.entity,
      previousValue: { version: prevVersion },
      newValue: { version: doc.version, fileName: doc.name || doc.fileName },
      description: `Replaced document '${doc.name || doc.fileName}' to v${doc.version}`,
    });
  }

  public static async logDocumentVerified(doc: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'DOCUMENT_VERIFIED',
      module: 'documents',
      entityType: 'Document',
      recordId: doc._id,
      entityId: doc.entity,
      newValue: { verificationStatus: 'verified', verifiedAt: new Date() },
      description: `Verified document '${doc.name || doc.fileName}'`,
    });
  }

  public static async logApprovalCreated(approval: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'APPROVAL_CREATED',
      module: 'approvals',
      entityType: 'Approval',
      recordId: approval._id || approval.complianceRecord,
      entityId: approval.entity,
      newValue: { action: approval.action, status: approval.newStatus, comments: approval.comments },
      description: `Approval decision '${approval.action}' recorded for compliance record`,
    });
  }

  public static async logTaskCreated(task: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'TASK_CREATED',
      module: 'tasks',
      entityType: 'Task',
      recordId: task._id,
      entityId: task.entity,
      newValue: { title: task.title, priority: task.priority, status: task.status, dueDate: task.dueDate },
      description: `Created remedial task '${task.title}'`,
    });
  }

  public static async logTaskUpdated(task: any, previousValue: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'TASK_UPDATED',
      module: 'tasks',
      entityType: 'Task',
      recordId: task._id,
      entityId: task.entity,
      previousValue,
      newValue: { title: task.title, priority: task.priority, status: task.status, dueDate: task.dueDate },
      description: `Updated remedial task '${task.title}'`,
    });
  }

  public static async logTaskCompleted(task: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'TASK_COMPLETED',
      module: 'tasks',
      entityType: 'Task',
      recordId: task._id,
      entityId: task.entity,
      previousValue: { status: 'in_progress' },
      newValue: { status: 'completed', completedAt: task.completedAt || new Date() },
      description: `Marked remedial task '${task.title}' as COMPLETED`,
    });
  }

  public static async logRuleCreated(rule: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'RULE_CREATED',
      module: 'rules',
      entityType: 'ComplianceRule',
      recordId: rule._id,
      newValue: { name: rule.name, code: rule.code, category: rule.category },
      description: `Created statutory compliance rule '${rule.name}' (${rule.code})`,
    });
  }

  public static async logRuleUpdated(rule: any, previousValue: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'RULE_UPDATED',
      module: 'rules',
      entityType: 'ComplianceRule',
      recordId: rule._id,
      previousValue,
      newValue: { name: rule.name, code: rule.code, active: rule.active },
      description: `Updated statutory compliance rule '${rule.name}' (${rule.code})`,
    });
  }

  public static async logSettingsChanged(settings: any, previousValue: any, req?: Request) {
    return this.logMutation({
      req,
      action: 'SETTINGS_CHANGED',
      module: 'settings',
      entityType: 'Settings',
      recordId: settings._id,
      previousValue,
      newValue: settings,
      description: `Updated organizational system configuration and compliance parameters`,
    });
  }
}

export const auditService = AuditService;
