/**
 * Approval Workflow Service
 *
 * Implements the Compliance Approval Workflow State Machine:
 *
 * Normal Path:
 *   Submitted → Under Review → Approved
 *
 * Correction / Rejection Path:
 *   Under Review → Rejected → Correction → Resubmitted → Under Review
 *   (or Under Review → Correction via 'Request Correction' → Resubmitted → Under Review)
 *
 * Requirements:
 * 1. Strict State Machine Validation: Every status transition must be validated.
 *    Invalid transitions (e.g. Approved → Submitted, Pending → Approved) are strictly blocked with 400 Bad Request.
 * 2. Fine-grained Permissions:
 *    - Super Admin & Admin: Global authority across all entities and locations.
 *    - Compliance Officer: Authorized to review, approve, reject, or request corrections. Scoped by entity if assigned.
 *    - Entity Admin: Authorized to approve/reject ONLY within their assigned entity.
 *    - Location Manager: Can submit or resubmit records for their assigned location(s). FORBIDDEN from approving/rejecting.
 *    - Viewer: Read-only. FORBIDDEN from executing workflow actions.
 * 3. Immutable Approval Audit Trail:
 *    - Records every action, actor, timestamp, previousStatus, newStatus, and comments.
 */

import { Types } from 'mongoose';
import ComplianceRecord, {
  IComplianceRecord,
  ComplianceRecordStatus,
} from '../models/ComplianceRecord.js';
import Approval, { IApprovalDoc, WorkflowAction } from '../models/Approval.js';
import ComplianceRule from '../models/ComplianceRule.js';
import User, { IUser } from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { ApiError } from '../utils/apiError.js';
import { ROLES } from '../constants/permissions.js';

export interface WorkflowUserContext {
  userId: string;
  email: string;
  role: string;
  entityId?: string | null;
}

export interface WorkflowTransitionInput {
  recordId: string;
  action: WorkflowAction;
  comments?: string;
  user: WorkflowUserContext;
}

export interface AvailableActionInfo {
  action: WorkflowAction;
  label: string;
  targetStatus: ComplianceRecordStatus;
  variant: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info';
  requiresComments: boolean;
  description: string;
}

export class ApprovalWorkflowService {
  /**
   * Roles authorized to approve, reject, or request corrections
   */
  private static readonly APPROVER_ROLES = [
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.COMPLIANCE_OFFICER,
    ROLES.ENTITY_ADMIN,
  ];

  /**
   * Roles authorized to submit or resubmit compliance records
   */
  private static readonly SUBMITTER_ROLES = [
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.COMPLIANCE_OFFICER,
    ROLES.ENTITY_ADMIN,
    ROLES.LOCATION_MANAGER,
  ];

  /**
   * Validates if a user is authorized to perform the workflow action on this record.
   */
  public static async validateAuthorization(
    record: IComplianceRecord,
    action: WorkflowAction,
    userContext: WorkflowUserContext
  ): Promise<void> {
    const { role, entityId, userId } = userContext;

    // Viewers cannot execute any workflow actions
    if (role === ROLES.VIEWER) {
      throw ApiError.forbidden('Viewers have read-only access and cannot execute workflow actions.');
    }

    const recordEntityId = record.entity ? record.entity.toString() : null;
    const recordLocationId = record.location ? record.location.toString() : null;

    // 1. Approval / Rejection / Correction authorization
    if (['Approve', 'Reject', 'Request Correction', 'Start Review'].includes(action)) {
      if (!this.APPROVER_ROLES.includes(role as any)) {
        throw ApiError.forbidden(
          `Users with role "${role}" are not authorized to approve, reject, or review compliance records.`
        );
      }

      // Entity-scoping check: Entity Admin and entity-scoped Compliance Officers
      // cannot manage records outside their assigned entity.
      if (role === ROLES.ENTITY_ADMIN || (role === ROLES.COMPLIANCE_OFFICER && entityId)) {
        if (entityId && recordEntityId && entityId !== recordEntityId) {
          throw ApiError.forbidden(
            'You are not authorized to review or approve compliance records outside your assigned entity.'
          );
        }
      }
    }

    // 2. Submission / Resubmission authorization
    if (['Submit', 'Resubmit'].includes(action)) {
      if (!this.SUBMITTER_ROLES.includes(role as any)) {
        throw ApiError.forbidden(`Users with role "${role}" cannot submit compliance records.`);
      }

      // Location Manager scoping check
      if (role === ROLES.LOCATION_MANAGER) {
        // Fetch full user to inspect assignedLocations if needed
        const userDoc = await User.findById(userId).select('assignedLocations entity');
        if (userDoc) {
          // If entity is set and does not match
          if (userDoc.entity && recordEntityId && userDoc.entity.toString() !== recordEntityId) {
            throw ApiError.forbidden(
              'Location manager cannot submit records outside their assigned entity.'
            );
          }

          // If assignedLocations are configured, verify the record belongs to one
          if (
            userDoc.assignedLocations &&
            userDoc.assignedLocations.length > 0 &&
            recordLocationId
          ) {
            const hasLocation = userDoc.assignedLocations.some(
              (loc) => loc.toString() === recordLocationId
            );
            if (!hasLocation) {
              throw ApiError.forbidden(
                'Location manager can only submit compliance records for their assigned location.'
              );
            }
          }
        }
      }
    }
  }

  /**
   * Validates state transition and returns the resulting target status.
   * Throws 400 Bad Request for any invalid or disallowed transition.
   */
  public static validateTransition(
    currentStatus: ComplianceRecordStatus,
    action: WorkflowAction,
    comments?: string
  ): ComplianceRecordStatus {
    // Rule 1: Terminal Approved State cannot be transitioned back to submission or review
    if (currentStatus === 'approved') {
      throw ApiError.badRequest(
        `Invalid transition: Compliance record is already Approved. Transition from "approved" via action "${action}" is not allowed.`
      );
    }

    // Rule 2: Mandatory comments for Rejection or Request Correction
    if (action === 'Reject' || action === 'Request Correction') {
      if (!comments || comments.trim().length === 0) {
        throw ApiError.badRequest(
          `Comments are strictly required when performing "${action}". Please provide a rationale or correction requirements.`
        );
      }
    }

    // Rule 3: State Machine transitions
    switch (action) {
      case 'Submit':
        if (currentStatus === 'pending') {
          return 'submitted';
        }
        if (currentStatus === 'correction' || currentStatus === 'rejected') {
          return 'resubmitted';
        }
        throw ApiError.badRequest(
          `Invalid transition: Cannot "Submit" a record with current status "${currentStatus}". Submit is only valid for "pending", "correction", or "rejected" records.`
        );

      case 'Start Review':
        if (currentStatus === 'submitted' || currentStatus === 'resubmitted') {
          return 'under_review';
        }
        if (currentStatus === 'under_review') {
          throw ApiError.badRequest('Record is already Under Review.');
        }
        throw ApiError.badRequest(
          `Invalid transition: Cannot "Start Review" on a record with status "${currentStatus}". Record must be "submitted" or "resubmitted" first.`
        );

      case 'Approve':
        // Allowed from under_review, or directly from submitted / resubmitted by authorized reviewer
        if (
          currentStatus === 'under_review' ||
          currentStatus === 'submitted' ||
          currentStatus === 'resubmitted'
        ) {
          return 'approved';
        }
        throw ApiError.badRequest(
          `Invalid transition: Cannot "Approve" a record with status "${currentStatus}". Record must be in "under_review", "submitted", or "resubmitted" status.`
        );

      case 'Reject':
        if (
          currentStatus === 'under_review' ||
          currentStatus === 'submitted' ||
          currentStatus === 'resubmitted'
        ) {
          return 'rejected';
        }
        throw ApiError.badRequest(
          `Invalid transition: Cannot "Reject" a record with status "${currentStatus}". Record must be under review or submitted.`
        );

      case 'Request Correction':
        if (
          currentStatus === 'under_review' ||
          currentStatus === 'submitted' ||
          currentStatus === 'resubmitted' ||
          currentStatus === 'rejected'
        ) {
          return 'correction';
        }
        throw ApiError.badRequest(
          `Invalid transition: Cannot "Request Correction" for a record with status "${currentStatus}".`
        );

      case 'Resubmit':
        if (currentStatus === 'correction' || currentStatus === 'rejected') {
          return 'resubmitted';
        }
        throw ApiError.badRequest(
          `Invalid transition: Cannot "Resubmit" a record with status "${currentStatus}". Resubmission is only allowed for records in "correction" or "rejected" status.`
        );

      default:
        throw ApiError.badRequest(`Unknown workflow action: "${action}".`);
    }
  }

  /**
   * Executes a workflow action atomically:
   * 1. Validates record existence
   * 2. Validates RBAC & entity/location permissions
   * 3. Validates status transition
   * 4. Creates Approval log
   * 5. Updates ComplianceRecord status & dates
   * 6. Appends to embedded approval trail
   * 7. Logs system AuditLog
   */
  public static async executeWorkflowAction(
    input: WorkflowTransitionInput
  ): Promise<{ record: IComplianceRecord; approval: IApprovalDoc }> {
    const { recordId, action, comments, user } = input;

    const record = await ComplianceRecord.findById(recordId);
    if (!record) {
      throw ApiError.notFound('Compliance record not found.');
    }

    // 1. Authorize user
    await this.validateAuthorization(record, action, user);

    const previousStatus = record.status;

    // 2. Validate transition
    const newStatus = this.validateTransition(previousStatus, action, comments);

    // 3. Create persistent Approval record
    const approval = await Approval.create({
      complianceRecord: record._id,
      action,
      performedBy: user.userId,
      performedAt: new Date(),
      comments: comments?.trim() || undefined,
      previousStatus,
      newStatus,
      entity: record.entity,
      location: record.location,
    });

    // 4. Update dates and record fields
    record.status = newStatus;

    if ((newStatus === 'submitted' || newStatus === 'resubmitted') && !record.submissionDate) {
      record.submissionDate = new Date();
    }

    if (newStatus === 'approved') {
      record.approvalDate = new Date();
      // Auto-calculate renewal expiry if rule defines renewal cycle and expiryDate is empty
      const rule = await ComplianceRule.findById(record.rule || record.complianceRule);
      if (rule?.renewalCycle && !record.expiryDate) {
        const exp = new Date();
        exp.setDate(exp.getDate() + rule.renewalCycle);
        record.expiryDate = exp;
      }
    }

    if (comments) {
      record.comments = comments.trim();
    }

    // 5. Append to embedded approval trail
    const approvalEntry = {
      _id: new Types.ObjectId(),
      level: (record.currentApprovalLevel || 0) + 1,
      approver: new Types.ObjectId(user.userId),
      decision:
        newStatus === 'approved'
          ? 'approved'
          : newStatus === 'rejected'
          ? 'rejected'
          : ('pending' as const),
      comments: comments?.trim(),
      decidedAt: new Date(),
      requestedAt: new Date(),
    };

    record.approvals.push(approvalEntry as any);
    record.currentApprovalLevel = approvalEntry.level;
    record.updatedBy = user.userId as any;

    await record.save();

    // 6. Record in Audit Log
    const auditAction =
      action === 'Approve' ? 'approve' : action === 'Reject' ? 'reject' : 'update';

    await AuditLog.create({
      actor: user.userId,
      actorEmail: user.email,
      actorRole: user.role,
      action: auditAction,
      resource: 'ComplianceRecord',
      resourceId: record._id,
      entity: record.entity,
      description: `Workflow Action: "${action}" — transitioned "${record.recordNumber}" from ${previousStatus} to ${newStatus}`,
      metadata: {
        approvalId: approval._id,
        action,
        previousStatus,
        newStatus,
        comments,
      },
    });

    // Return populated record
    const populated = await ComplianceRecord.findById(record._id)
      .populate('entity', 'name entityCode')
      .populate('location', 'name locationCode address')
      .populate('rule', 'name code category frequency renewalCycle requiredDocuments')
      .populate('assignedUser', 'firstName lastName email fullName role')
      .populate({
        path: 'documents',
        populate: [{ path: 'uploadedBy', select: 'firstName lastName email' }],
      })
      .populate('approvals.approver', 'firstName lastName email fullName role');

    return { record: populated || record, approval };
  }

  /**
   * Computes available workflow actions for a given record and user.
   * Useful for dynamic UI action buttons.
   */
  public static getAvailableActions(
    record: IComplianceRecord,
    user: WorkflowUserContext
  ): AvailableActionInfo[] {
    const { role, entityId } = user;
    const actions: AvailableActionInfo[] = [];

    if (role === ROLES.VIEWER) {
      return [];
    }

    const currentStatus = record.status;
    const recordEntityId = record.entity ? record.entity.toString() : null;

    const isApprover = this.APPROVER_ROLES.includes(role as any);
    const isSubmitter = this.SUBMITTER_ROLES.includes(role as any);

    // Entity-scope check for Entity Admin or scoped Compliance Officer
    const isEntityAllowed =
      role === ROLES.SUPER_ADMIN ||
      role === ROLES.ADMIN ||
      !entityId ||
      !recordEntityId ||
      entityId === recordEntityId;

    // 1. Pending → Submit
    if (currentStatus === 'pending' && isSubmitter) {
      actions.push({
        action: 'Submit',
        label: 'Submit for Review',
        targetStatus: 'submitted',
        variant: 'primary',
        requiresComments: false,
        description: 'Submit compliance documentation and evidence for statutory review.',
      });
    }

    // 2. Submitted / Resubmitted → Start Review, Approve, Reject, Request Correction
    if (['submitted', 'resubmitted'].includes(currentStatus) && isApprover && isEntityAllowed) {
      actions.push({
        action: 'Start Review',
        label: 'Start Review',
        targetStatus: 'under_review',
        variant: 'info',
        requiresComments: false,
        description: 'Place compliance record under official inspection and audit review.',
      });

      actions.push({
        action: 'Approve',
        label: 'Approve Compliance',
        targetStatus: 'approved',
        variant: 'success',
        requiresComments: false,
        description: 'Grant final statutory compliance approval and sign-off.',
      });

      actions.push({
        action: 'Request Correction',
        label: 'Request Correction',
        targetStatus: 'correction',
        variant: 'warning',
        requiresComments: true,
        description: 'Return record with required revisions or missing documents.',
      });

      actions.push({
        action: 'Reject',
        label: 'Reject Compliance',
        targetStatus: 'rejected',
        variant: 'danger',
        requiresComments: true,
        description: 'Reject compliance submission due to statutory non-compliance.',
      });
    }

    // 3. Under Review → Approve, Reject, Request Correction
    if (currentStatus === 'under_review' && isApprover && isEntityAllowed) {
      actions.push({
        action: 'Approve',
        label: 'Approve Compliance',
        targetStatus: 'approved',
        variant: 'success',
        requiresComments: false,
        description: 'Grant final statutory compliance approval and sign-off.',
      });

      actions.push({
        action: 'Request Correction',
        label: 'Request Correction',
        targetStatus: 'correction',
        variant: 'warning',
        requiresComments: true,
        description: 'Return record with required revisions or missing documents.',
      });

      actions.push({
        action: 'Reject',
        label: 'Reject Compliance',
        targetStatus: 'rejected',
        variant: 'danger',
        requiresComments: true,
        description: 'Reject compliance submission due to statutory non-compliance.',
      });
    }

    // 4. Correction or Rejected → Resubmit
    if (['correction', 'rejected'].includes(currentStatus) && isSubmitter) {
      actions.push({
        action: 'Resubmit',
        label: 'Resubmit for Review',
        targetStatus: 'resubmitted',
        variant: 'primary',
        requiresComments: false,
        description: 'Resubmit corrected documents and responses for secondary review.',
      });

      if (currentStatus === 'rejected' && isApprover && isEntityAllowed) {
        actions.push({
          action: 'Request Correction',
          label: 'Request Correction',
          targetStatus: 'correction',
          variant: 'warning',
          requiresComments: true,
          description: 'Downgrade full rejection to allow unit manager to submit corrections.',
        });
      }
    }

    return actions;
  }

  /**
   * Retrieves all historical Approval records for a compliance record, ordered by performedAt asc/desc.
   */
  public static async getRecordApprovals(
    recordId: string,
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<IApprovalDoc[]> {
    return Approval.find({ complianceRecord: recordId })
      .populate('performedBy', 'firstName lastName email fullName role avatar')
      .populate('complianceRecord', 'recordNumber status')
      .sort({ performedAt: sortOrder === 'desc' ? -1 : 1 });
  }
}
