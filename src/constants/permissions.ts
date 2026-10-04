/**
 * Centralized Permission Definitions & Role Mappings
 *
 * Single Source of Truth for system permissions and default role capabilities.
 * Controllers and route handlers reference these constants rather than hardcoding strings.
 */

// ── Resource Modules ──────────────────────────────────────────────────────────
export const RESOURCES = {
  ENTITY: 'entity',
  LOCATION: 'location',
  COMPLIANCE_RULE: 'compliance_rule',
  COMPLIANCE_RECORD: 'compliance_record',
  LICENCE: 'licence',
  DOCUMENT: 'document',
  TASK: 'task',
  APPROVAL: 'approval',
  NOTIFICATION: 'notification',
  AUDIT_LOG: 'audit_log',
  SETTINGS: 'settings',
  USER: 'user',
  REPORT: 'report',
} as const;

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES];

// ── Action Verbs ────────────────────────────────────────────────────────────
export const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  REJECT: 'reject',
  RENEW: 'renew',
  UPLOAD: 'upload',
  DOWNLOAD: 'download',
  EXPORT: 'export',
  ASSIGN: 'assign',
  SUBMIT: 'submit',
  MANAGE: 'manage',
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

// ── Fine-Grained Permission Strings: `${resource}:${action}` ────────────────
export const PERMISSIONS = {
  // Entity
  ENTITY_CREATE: 'entity:create',
  ENTITY_READ: 'entity:read',
  ENTITY_UPDATE: 'entity:update',
  ENTITY_DELETE: 'entity:delete',

  // Location
  LOCATION_CREATE: 'location:create',
  LOCATION_READ: 'location:read',
  LOCATION_UPDATE: 'location:update',
  LOCATION_DELETE: 'location:delete',

  // Compliance Rule
  COMPLIANCE_RULE_CREATE: 'compliance_rule:create',
  COMPLIANCE_RULE_READ: 'compliance_rule:read',
  COMPLIANCE_RULE_UPDATE: 'compliance_rule:update',
  COMPLIANCE_RULE_DELETE: 'compliance_rule:delete',

  // Compliance Record
  COMPLIANCE_RECORD_CREATE: 'compliance_record:create',
  COMPLIANCE_RECORD_READ: 'compliance_record:read',
  COMPLIANCE_RECORD_UPDATE: 'compliance_record:update',
  COMPLIANCE_RECORD_DELETE: 'compliance_record:delete',
  COMPLIANCE_RECORD_APPROVE: 'compliance_record:approve',
  COMPLIANCE_RECORD_SUBMIT: 'compliance_record:submit',

  // Licence
  LICENCE_CREATE: 'licence:create',
  LICENCE_READ: 'licence:read',
  LICENCE_UPDATE: 'licence:update',
  LICENCE_DELETE: 'licence:delete',
  LICENCE_RENEW: 'licence:renew',

  // Document
  DOCUMENT_UPLOAD: 'document:upload',
  DOCUMENT_READ: 'document:read',
  DOCUMENT_UPDATE: 'document:update',
  DOCUMENT_DELETE: 'document:delete',
  DOCUMENT_DOWNLOAD: 'document:download',

  // Task
  TASK_CREATE: 'task:create',
  TASK_READ: 'task:read',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_ASSIGN: 'task:assign',

  // Approval
  APPROVAL_READ: 'approval:read',
  APPROVAL_DECIDE: 'approval:decide',

  // Notification
  NOTIFICATION_READ: 'notification:read',
  NOTIFICATION_MANAGE: 'notification:manage',

  // Audit Log
  AUDIT_LOG_READ: 'audit_log:read',
  AUDIT_LOG_EXPORT: 'audit_log:export',

  // Settings
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',

  // User Management
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',

  // Reports & Analytics
  REPORT_READ: 'report:read',
  REPORT_EXPORT: 'report:export',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ── The 6 Canonical System Roles ────────────────────────────────────────────
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  ENTITY_ADMIN: 'entity_admin',
  LOCATION_MANAGER: 'location_manager',
  COMPLIANCE_OFFICER: 'compliance_officer',
  VIEWER: 'viewer',
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

// ── Role Metadata ────────────────────────────────────────────────────────────
export interface RoleDefinition {
  name: string;
  code: RoleCode;
  description: string;
  isSystem: boolean;
  permissions: PermissionCode[] | ['*'];
}

export const ROLE_DEFINITIONS: Record<RoleCode, RoleDefinition> = {
  [ROLES.SUPER_ADMIN]: {
    name: 'Super Admin',
    code: ROLES.SUPER_ADMIN,
    description: 'National control plane with unrestricted global access to all entities, settings, and audits.',
    isSystem: true,
    permissions: ['*'],
  },
  [ROLES.ADMIN]: {
    name: 'Admin',
    code: ROLES.ADMIN,
    description: 'System administrator across all entities with operational and user management privileges.',
    isSystem: true,
    permissions: [
      PERMISSIONS.ENTITY_CREATE,
      PERMISSIONS.ENTITY_READ,
      PERMISSIONS.ENTITY_UPDATE,
      PERMISSIONS.LOCATION_CREATE,
      PERMISSIONS.LOCATION_READ,
      PERMISSIONS.LOCATION_UPDATE,
      PERMISSIONS.LOCATION_DELETE,
      PERMISSIONS.COMPLIANCE_RULE_CREATE,
      PERMISSIONS.COMPLIANCE_RULE_READ,
      PERMISSIONS.COMPLIANCE_RULE_UPDATE,
      PERMISSIONS.COMPLIANCE_RECORD_CREATE,
      PERMISSIONS.COMPLIANCE_RECORD_READ,
      PERMISSIONS.COMPLIANCE_RECORD_UPDATE,
      PERMISSIONS.COMPLIANCE_RECORD_APPROVE,
      PERMISSIONS.LICENCE_CREATE,
      PERMISSIONS.LICENCE_READ,
      PERMISSIONS.LICENCE_UPDATE,
      PERMISSIONS.LICENCE_RENEW,
      PERMISSIONS.DOCUMENT_UPLOAD,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.DOCUMENT_UPDATE,
      PERMISSIONS.DOCUMENT_DOWNLOAD,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_READ,
      PERMISSIONS.TASK_UPDATE,
      PERMISSIONS.TASK_ASSIGN,
      PERMISSIONS.APPROVAL_READ,
      PERMISSIONS.APPROVAL_DECIDE,
      PERMISSIONS.NOTIFICATION_READ,
      PERMISSIONS.NOTIFICATION_MANAGE,
      PERMISSIONS.AUDIT_LOG_READ,
      PERMISSIONS.AUDIT_LOG_EXPORT,
      PERMISSIONS.SETTINGS_READ,
      PERMISSIONS.SETTINGS_UPDATE,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_EXPORT,
    ],
  },
  [ROLES.ENTITY_ADMIN]: {
    name: 'Entity Admin',
    code: ROLES.ENTITY_ADMIN,
    description: 'Administrator for a specific entity (e.g. CCPL). Manages entity locations, users, and compliance.',
    isSystem: true,
    permissions: [
      PERMISSIONS.ENTITY_READ,
      PERMISSIONS.ENTITY_UPDATE,
      PERMISSIONS.LOCATION_CREATE,
      PERMISSIONS.LOCATION_READ,
      PERMISSIONS.LOCATION_UPDATE,
      PERMISSIONS.COMPLIANCE_RULE_READ,
      PERMISSIONS.COMPLIANCE_RECORD_CREATE,
      PERMISSIONS.COMPLIANCE_RECORD_READ,
      PERMISSIONS.COMPLIANCE_RECORD_UPDATE,
      PERMISSIONS.COMPLIANCE_RECORD_APPROVE,
      PERMISSIONS.LICENCE_CREATE,
      PERMISSIONS.LICENCE_READ,
      PERMISSIONS.LICENCE_UPDATE,
      PERMISSIONS.LICENCE_RENEW,
      PERMISSIONS.DOCUMENT_UPLOAD,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.DOCUMENT_UPDATE,
      PERMISSIONS.DOCUMENT_DOWNLOAD,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_READ,
      PERMISSIONS.TASK_UPDATE,
      PERMISSIONS.TASK_ASSIGN,
      PERMISSIONS.APPROVAL_READ,
      PERMISSIONS.APPROVAL_DECIDE,
      PERMISSIONS.NOTIFICATION_READ,
      PERMISSIONS.NOTIFICATION_MANAGE,
      PERMISSIONS.AUDIT_LOG_READ,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_EXPORT,
    ],
  },
  [ROLES.LOCATION_MANAGER]: {
    name: 'Unit/Location Manager',
    code: ROLES.LOCATION_MANAGER,
    description: 'Manages an assigned physical unit/clinic. Coordinates onsite tasks, evidence uploads, and renewal requests.',
    isSystem: true,
    permissions: [
      PERMISSIONS.ENTITY_READ,
      PERMISSIONS.LOCATION_READ,
      PERMISSIONS.COMPLIANCE_RECORD_READ,
      PERMISSIONS.COMPLIANCE_RECORD_UPDATE, // status and licence details, own units only
      PERMISSIONS.COMPLIANCE_RECORD_SUBMIT,
      PERMISSIONS.LICENCE_READ,
      PERMISSIONS.DOCUMENT_UPLOAD,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.DOCUMENT_DOWNLOAD,
      PERMISSIONS.TASK_READ,
      PERMISSIONS.TASK_UPDATE,
      PERMISSIONS.NOTIFICATION_READ,
      PERMISSIONS.REPORT_READ,
    ],
  },
  [ROLES.COMPLIANCE_OFFICER]: {
    name: 'Compliance Officer',
    code: ROLES.COMPLIANCE_OFFICER,
    description: 'Specialist managing compliance verification, regulatory filing, evidence audits, and rule execution.',
    isSystem: true,
    permissions: [
      PERMISSIONS.ENTITY_READ,
      PERMISSIONS.LOCATION_READ,
      PERMISSIONS.COMPLIANCE_RULE_READ,
      PERMISSIONS.COMPLIANCE_RECORD_CREATE,
      PERMISSIONS.COMPLIANCE_RECORD_READ,
      PERMISSIONS.COMPLIANCE_RECORD_UPDATE,
      PERMISSIONS.COMPLIANCE_RECORD_SUBMIT,
      PERMISSIONS.LICENCE_CREATE,
      PERMISSIONS.LICENCE_READ,
      PERMISSIONS.LICENCE_UPDATE,
      PERMISSIONS.LICENCE_RENEW,
      PERMISSIONS.DOCUMENT_UPLOAD,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.DOCUMENT_UPDATE,
      PERMISSIONS.DOCUMENT_DOWNLOAD,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_READ,
      PERMISSIONS.TASK_UPDATE,
      PERMISSIONS.APPROVAL_READ,
      PERMISSIONS.NOTIFICATION_READ,
      PERMISSIONS.AUDIT_LOG_READ,
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_EXPORT,
    ],
  },
  [ROLES.VIEWER]: {
    name: 'Viewer',
    code: ROLES.VIEWER,
    description: 'Read-only stakeholder. Can view dashboards, compliance statuses, and reports without write capability.',
    isSystem: true,
    permissions: [
      PERMISSIONS.ENTITY_READ,
      PERMISSIONS.LOCATION_READ,
      PERMISSIONS.COMPLIANCE_RULE_READ,
      PERMISSIONS.COMPLIANCE_RECORD_READ,
      PERMISSIONS.LICENCE_READ,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.TASK_READ,
      PERMISSIONS.NOTIFICATION_READ,
      PERMISSIONS.REPORT_READ,
    ],
  },
};
