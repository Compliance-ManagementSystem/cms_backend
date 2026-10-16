/**
 * ComplianceRecord Model
 *
 * The central compliance tracking record — one per (Location × ComplianceRule).
 * Connects Entity + Location + Compliance Rule.
 *
 * Fields:
 *   - entity
 *   - location
 *   - rule / complianceRule
 *   - status ('pending', 'submitted', 'under_review', 'approved', 'rejected', 'expiring_soon', 'expired')
 *   - assignedUser
 *   - dueDate
 *   - submissionDate
 *   - approvalDate
 *   - expiryDate
 *   - comments
 *   - currentVersion
 *   - documents
 *   - approvals
 *
 * Deleting a record is a soft delete (isDeleted / deletedAt / deletedBy). Every query and
 * aggregate on this model leaves deleted records out unless run with { includeDeleted: true }.
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { Ref } from '../types/models.js';

// ── Status Types ─────────────────────────────────────────────────────────────
export type ComplianceRecordStatus =
  | 'pending'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'correction'
  | 'resubmitted'
  | 'expiring_soon'
  | 'expired'
  | 'in_progress'
  | 'not_applicable';

// ── Approval Trail (embedded) ─────────────────────────────────────────────────
export interface IApproval {
  _id: Types.ObjectId;
  level: number;
  approver: Ref<unknown>; // → User
  decision: 'pending' | 'approved' | 'rejected' | 'escalated';
  comments?: string;
  decidedAt?: Date;
  requestedAt: Date;
}

const approvalSchema = new Schema<IApproval>(
  {
    level: { type: Number, required: true, min: 1, default: 1 },
    approver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decision: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'escalated'],
      default: 'pending',
    },
    comments: { type: String },
    decidedAt: { type: Date },
    requestedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// ── ComplianceRecord document ──────────────────────────────────────────────────
export interface IComplianceRecord extends Document {
  _id: Types.ObjectId;
  // Core references connecting Entity + Location + Rule
  entity: Ref<unknown>; // → Entity
  location: Ref<unknown>; // → Location
  rule: Ref<unknown>; // → ComplianceRule
  complianceRule: Ref<unknown>; // → ComplianceRule (alias/backwards-compatible)

  // Identity
  recordNumber: string; // Auto-generated e.g. "CR-2026-00001"

  // Status
  status: ComplianceRecordStatus;

  // Assignment
  assignedUser?: Ref<unknown>; // → User

  // Number printed on the licence / registration certificate
  licenceNumber?: string;
  // Number on the authority's acknowledgement, captured when the licence is applied for
  acknowledgementNumber?: string;

  // Key Dates
  dueDate?: Date;
  submissionDate?: Date;
  approvalDate?: Date;
  expiryDate?: Date;
  issueDate?: Date;
  nextRenewalDate?: Date;
  lastRenewedAt?: Date;

  // Feedback & Notes
  comments?: string;
  notes?: string;
  internalNotes?: string;

  // Versioning
  currentVersion: number;

  // Applicability override
  isApplicable: boolean;
  notApplicableReason?: string;

  // Documents attached (compliance evidence)
  documents: Types.ObjectId[]; // → Document[]

  // Approval workflow trail
  approvals: IApproval[];
  currentApprovalLevel: number;

  // Tracking reminders
  remindersSent: number[];
  lastReminderSentAt?: Date;

  // Soft delete
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: Ref<unknown>; // → User

  createdBy?: Ref<unknown>;
  updatedBy?: Ref<unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const complianceRecordSchema = new Schema<IComplianceRecord>(
  {
    entity: { type: Schema.Types.ObjectId, ref: 'Entity', required: true, index: true },
    location: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    rule: { type: Schema.Types.ObjectId, ref: 'ComplianceRule', required: true, index: true },
    complianceRule: { type: Schema.Types.ObjectId, ref: 'ComplianceRule' },

    recordNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        'pending',
        'submitted',
        'under_review',
        'approved',
        'rejected',
        'correction',
        'resubmitted',
        'expiring_soon',
        'expired',
        'in_progress',
        'not_applicable',
      ],
      default: 'pending',
      index: true,
    },

    assignedUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    licenceNumber: { type: String, trim: true },
    acknowledgementNumber: { type: String, trim: true },

    dueDate: { type: Date, index: true },
    submissionDate: { type: Date },
    approvalDate: { type: Date },
    expiryDate: { type: Date, index: true },
    issueDate: { type: Date },
    nextRenewalDate: { type: Date, index: true },
    lastRenewedAt: { type: Date },

    comments: { type: String },
    notes: { type: String },
    internalNotes: { type: String },

    currentVersion: { type: Number, default: 1, min: 1 },

    isApplicable: { type: Boolean, default: true },
    notApplicableReason: { type: String },

    documents: { type: [Schema.Types.ObjectId], ref: 'Document', default: [] },
    approvals: { type: [approvalSchema], default: [] },
    currentApprovalLevel: { type: Number, default: 0 },

    remindersSent: { type: [Number], default: [] },
    lastReminderSentAt: { type: Date },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Compound unique: one live record per location × rule ───────────────────────
// Deleted records sit outside the index, so the same record can be created again.
export const LOCATION_RULE_INDEX = 'location_rule_unique_live';
complianceRecordSchema.index(
  { location: 1, rule: 1 },
  { unique: true, name: LOCATION_RULE_INDEX, partialFilterExpression: { isDeleted: false } }
);
complianceRecordSchema.index({ entity: 1, status: 1 });
complianceRecordSchema.index({ status: 1, dueDate: 1 });

// ── Soft delete: leave deleted records out of every read ───────────────────────
const NOT_DELETED = { isDeleted: { $ne: true } };

complianceRecordSchema.pre(
  [
    'find',
    'findOne',
    'countDocuments',
    'distinct',
    'findOneAndUpdate',
    'findOneAndDelete',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
  ],
  function () {
    if (!this.getOptions().includeDeleted) this.where(NOT_DELETED);
  }
);

complianceRecordSchema.pre('aggregate', function () {
  if (!this.options.includeDeleted) this.pipeline().unshift({ $match: NOT_DELETED });
});

// ── Pre-save Synchronizer Hook ────────────────────────────────────────────────
complianceRecordSchema.pre('validate', async function (next) {
  // Sync rule & complianceRule fields
  if (this.rule && !this.complianceRule) {
    this.complianceRule = this.rule;
  } else if (this.complianceRule && !this.rule) {
    this.rule = this.complianceRule;
  }

  // Generate unique recordNumber if not present
  if (!this.recordNumber) {
    const year = new Date().getFullYear();
    const count = await mongoose.model('ComplianceRecord').countDocuments().setOptions({ includeDeleted: true });
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    this.recordNumber = `CR-${year}-${String(count + 1).padStart(4, '0')}-${randomSuffix}`;
  }

  // Auto-set submissionDate when submitted
  if (this.isModified('status')) {
    if (this.status === 'submitted' && !this.submissionDate) {
      this.submissionDate = new Date();
    }
    if (this.status === 'approved' && !this.approvalDate) {
      this.approvalDate = new Date();
    }
  }

  next();
});

const ComplianceRecord: Model<IComplianceRecord> = mongoose.model<IComplianceRecord>(
  'ComplianceRecord',
  complianceRecordSchema
);
export default ComplianceRecord;
