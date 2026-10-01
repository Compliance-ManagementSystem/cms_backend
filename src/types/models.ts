// ── Shared Types for Mongoose Models ────────────────────────────────────────
// Import these in any model that needs them.
// Do NOT redeclare these in individual model files.

import type { Types } from 'mongoose';

// Soft reference — stored as ObjectId in DB
export type Ref<T> = Types.ObjectId | T;

// Timestamps added by Mongoose { timestamps: true }
export interface TimestampFields {
  createdAt: Date;
  updatedAt: Date;
}

// Audit fields present on nearly every document
export interface AuditFields extends TimestampFields {
  createdBy: Ref<unknown>;
  updatedBy: Ref<unknown>;
}

// Common status for most entities
export type ActiveStatus = 'active' | 'inactive' | 'archived';

// Compliance-specific statuses
export type ComplianceStatus =
  | 'pending'
  | 'in_progress'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'not_applicable';

// Document version status
export type DocumentStatus = 'draft' | 'active' | 'superseded' | 'archived';

// Task status
export type TaskStatus =
  | 'open'
  | 'in_progress'
  | 'pending_approval'
  | 'completed'
  | 'overdue'
  | 'cancelled';

// Task priority
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

// Notification types
export type NotificationType =
  | 'task_assigned'
  | 'task_due'
  | 'task_overdue'
  | 'compliance_expiring'
  | 'compliance_expired'
  | 'document_uploaded'
  | 'approval_required'
  | 'approval_approved'
  | 'approval_rejected'
  | 'licence_expiring'
  | 'licence_expired'
  | 'system';

// Notification channel
export type NotificationChannel = 'in_app' | 'email' | 'whatsapp' | 'sms';

// Audit action verbs
export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'approve'
  | 'reject'
  | 'upload'
  | 'download'
  | 'export';

// Approval decision
export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'escalated';

// Frequency for renewal cycles
export type RenewalFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'half_yearly'
  | 'yearly'
  | 'biennial'
  | 'custom';
