/**
 * AuditLog Model
 *
 * Immutable append-only event log for every important mutation across the system.
 * Captures user, role, action, module, entityType, entityId, recordId, previousValue,
 * newValue, timestamp, IP address, and user agent.
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type AuditEventAction =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'ROLE_CHANGED'
  | 'ENTITY_CREATED'
  | 'ENTITY_UPDATED'
  | 'ENTITY_DELETED'
  | 'LOCATION_CREATED'
  | 'LOCATION_UPDATED'
  | 'LOCATION_DELETED'
  | 'COMPLIANCE_CREATED'
  | 'COMPLIANCE_UPDATED'
  | 'STATUS_CHANGED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_REPLACED'
  | 'DOCUMENT_VERIFIED'
  | 'APPROVAL_CREATED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_COMPLETED'
  | 'RULE_CREATED'
  | 'RULE_UPDATED'
  | 'SETTINGS_CHANGED'
  | string;

export interface IAuditLog extends Document {
  _id: Types.ObjectId;

  // Actor context
  user?: Types.ObjectId;
  actor?: Types.ObjectId; // Alias for backward compatibility
  role?: string;
  actorRole?: string;     // Alias
  actorEmail?: string;

  // Event & Scope
  action: AuditEventAction;
  module: string;         // 'users', 'entities', 'locations', 'compliance', 'documents', 'approvals', 'tasks', 'rules', 'settings'
  entityType: string;     // 'User', 'Entity', 'Location', 'ComplianceRecord', 'Document', 'Approval', 'Task', 'ComplianceRule', 'Settings'
  entityId?: Types.ObjectId | string;
  recordId?: Types.ObjectId | string;
  resource?: string;      // Alias
  resourceId?: Types.ObjectId | string; // Alias

  // State diff
  previousValue?: Record<string, any>;
  newValue?: Record<string, any>;
  diff?: Record<string, { before: any; after: any }>;
  metadata?: Record<string, any>;

  // Request context
  ipAddress?: string;
  userAgent?: string;
  description: string;

  timestamp: Date;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    user:       { type: Schema.Types.ObjectId, ref: 'User' },
    actor:      { type: Schema.Types.ObjectId, ref: 'User' },
    role:       { type: String },
    actorRole:  { type: String },
    actorEmail: { type: String },

    action:     { type: String, required: true },
    module:     { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId:   { type: Schema.Types.Mixed, index: true },
    recordId:   { type: Schema.Types.Mixed, index: true },
    resource:   { type: String },
    resourceId: { type: Schema.Types.Mixed },

    previousValue: { type: Schema.Types.Mixed },
    newValue:      { type: Schema.Types.Mixed },
    diff:          { type: Schema.Types.Mixed },
    metadata:      { type: Schema.Types.Mixed },

    ipAddress: { type: String },
    userAgent: { type: String },
    description: { type: String, required: true },

    timestamp: { type: Date, default: Date.now, index: true },
  },
  {
    // Append-only: createdAt and immutable timestamp
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Populate user and actor consistently
auditLogSchema.pre('save', function (next) {
  if (this.user && !this.actor) this.actor = this.user;
  if (this.actor && !this.user) this.user = this.actor;
  if (this.role && !this.actorRole) this.actorRole = this.role;
  if (this.actorRole && !this.role) this.role = this.actorRole;
  if (this.entityId && !this.recordId) this.recordId = this.entityId;
  if (!this.timestamp) this.timestamp = new Date();
  next();
});

// ── Indexes for high performance querying ─────────────────────────────────────
auditLogSchema.index({ user: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ module: 1, timestamp: -1 });
auditLogSchema.index({ entityType: 1, recordId: 1 });
auditLogSchema.index({ timestamp: -1 });

const AuditLog: Model<IAuditLog> = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
export default AuditLog;
