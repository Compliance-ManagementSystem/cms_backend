/**
 * Approval Model
 *
 * Tracks individual review, submission, and sign-off decisions in the compliance workflow.
 *
 * Required fields:
 * - complianceRecord
 * - action ('Submit' | 'Start Review' | 'Approve' | 'Reject' | 'Request Correction' | 'Resubmit')
 * - performedBy (User reference)
 * - performedAt (Date)
 * - comments (String)
 * - previousStatus (String)
 * - newStatus (String)
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { Ref } from '../types/models.js';

export type WorkflowAction =
  | 'Submit'
  | 'Start Review'
  | 'Approve'
  | 'Reject'
  | 'Request Correction'
  | 'Resubmit';

export interface IApprovalDoc extends Document {
  _id: Types.ObjectId;
  complianceRecord: Types.ObjectId; // → ComplianceRecord
  action: WorkflowAction;
  performedBy: Ref<unknown>; // → User
  performedAt: Date;
  comments?: string;
  previousStatus: string;
  newStatus: string;

  // Scoping references
  entity?: Ref<unknown>; // → Entity
  location?: Ref<unknown>; // → Location

  createdAt: Date;
  updatedAt: Date;
}

const approvalSchema = new Schema<IApprovalDoc>(
  {
    complianceRecord: {
      type: Schema.Types.ObjectId,
      ref: 'ComplianceRecord',
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        'Submit',
        'Start Review',
        'Approve',
        'Reject',
        'Request Correction',
        'Resubmit',
      ],
      index: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    performedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    comments: {
      type: String,
      trim: true,
    },
    previousStatus: {
      type: String,
      required: true,
      trim: true,
    },
    newStatus: {
      type: String,
      required: true,
      trim: true,
    },
    entity: {
      type: Schema.Types.ObjectId,
      ref: 'Entity',
      index: true,
    },
    location: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      index: true,
    },
  },
  { timestamps: true }
);

approvalSchema.index({ complianceRecord: 1, performedAt: -1 });
approvalSchema.index({ performedBy: 1, action: 1 });
approvalSchema.index({ entity: 1, action: 1 });

const Approval: Model<IApprovalDoc> = mongoose.model<IApprovalDoc>('Approval', approvalSchema);
export default Approval;
