/**
 * Audit Logging Helper Utility
 *
 * Delegates to the centralized AuditService for recording mutations.
 */

import { Request } from 'express';
import { auditService } from '../services/audit.service.js';
import type { AuditEventAction } from '../models/AuditLog.js';

export interface AuditLogOptions {
  req?: Request;
  action: AuditEventAction;
  resource?: string;
  module?: string;
  entityType?: string;
  resourceId?: any;
  entityId?: any;
  recordId?: any;
  entity?: any;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  description?: string;
  metadata?: Record<string, unknown>;
  userId?: any;
  role?: string;
}

export const logAuditEvent = async (options: AuditLogOptions): Promise<void> => {
  const moduleName = options.module || (options.resource ? options.resource.toLowerCase() + 's' : 'system');
  const entityTypeName = options.entityType || options.resource || 'Entity';

  await auditService.logMutation({
    req: options.req,
    userId: options.userId,
    role: options.role,
    action: options.action,
    module: moduleName,
    entityType: entityTypeName,
    entityId: options.entityId || options.resourceId || options.entity,
    recordId: options.recordId || options.resourceId,
    previousValue: options.previousValue,
    newValue: options.newValue,
    description: options.description,
    metadata: options.metadata,
  });
};
