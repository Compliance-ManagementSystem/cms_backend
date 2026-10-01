/**
 * Models barrel — import all models here so Mongoose registers them
 * before any queries run. Import this file in app.ts (after DB connects).
 *
 * All 19 Mongoose models for the Compliance Management System:
 *   1. User
 *   2. Role
 *   3. Permission
 *   4. Entity
 *   5. EntityType
 *   6. Location
 *   7. LocationType
 *   8. ComplianceRule
 *   9. ComplianceRecord
 *   10. Document (CmsDocument)
 *   11. DocumentVersion
 *   12. Licence
 *   13. Approval
 *   14. Task
 *   15. Notification
 *   16. AuditLog
 *   17. MasterData
 *   18. Workflow
 *   19. Settings
 */

// 1. Foundation & RBAC
export { default as Permission }       from './Permission.js';
export { default as Role }             from './Role.js';
export { default as User }             from './User.js';

// 2. Master Data & Classification
export { default as MasterData }       from './MasterData.js';
export { default as EntityType }       from './EntityType.js';
export { default as LocationType }     from './LocationType.js';

// 3. Organization Hierarchy
export { default as Entity }           from './Entity.js';
export { default as Location }         from './Location.js';

// 4. Documents & Evidence
export { default as CmsDocument }      from './Document.js';
export { default as DocumentVersion }  from './DocumentVersion.js';

// 5. Compliance Rules & Tracking
export { default as ComplianceRule }   from './ComplianceRule.js';
export { default as ComplianceRecord } from './ComplianceRecord.js';
export { default as Licence }          from './Licence.js';

// 6. Workflow & Approvals
export { default as Workflow }         from './Workflow.js';
export { default as Approval }         from './Approval.js';

// 7. Operations & Monitoring
export { default as Task }             from './Task.js';
export { default as Notification }     from './Notification.js';
export { default as AuditLog }         from './AuditLog.js';
export { default as Settings }         from './Settings.js';

// ── Export Interface Types ───────────────────────────────────────────────────
export type { IPermissionDoc }         from './Permission.js';
export type { IRole, IPermission }     from './Role.js';
export type { IUser }                  from './User.js';
export type { IMasterData }            from './MasterData.js';
export type { IEntityTypeDoc }         from './EntityType.js';
export type { ILocationTypeDoc }       from './LocationType.js';
export type { IEntity, IAddress }      from './Entity.js';
export type { ILocation, IAgreement }  from './Location.js';
export type { IDocument, IDocumentVersion } from './Document.js';
export type { IDocumentVersionDoc }    from './DocumentVersion.js';
export type { IComplianceRule }        from './ComplianceRule.js';
export type { IComplianceRecord, IApproval } from './ComplianceRecord.js';
export type { ILicence, ILicenceRenewal } from './Licence.js';
export type { IWorkflowDoc, IWorkflowStepItem } from './Workflow.js';
export type { IApprovalDoc }           from './Approval.js';
export type { ITask }                  from './Task.js';
export type { INotification }          from './Notification.js';
export type { IAuditLog }              from './AuditLog.js';
export type { ISettings, IWorkflow, IWorkflowStep, INotificationSettings } from './Settings.js';
