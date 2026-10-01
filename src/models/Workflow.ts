/**
 * Workflow Model
 *
 * Defines approval stages, escalation paths, and review workflows.
 * Can be global or customized per entity.
 *
 * Examples:
 *   - Compliance Approval (e.g. Manager → HOD → Legal)
 *   - Licence Renewal Workflow
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus, Ref } from '../types/models.js';

export interface IWorkflowStepItem {
  step: number;
  name: string;
  role: Ref<unknown>;          // → Role authorized for this step
  isRequired: boolean;
  canDelegate: boolean;
  slaHours?: number;           // Target resolution hours
}

const workflowStepItemSchema = new Schema<IWorkflowStepItem>(
  {
    step:        { type: Number, required: true },
    name:        { type: String, required: true, trim: true },
    role:        { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    isRequired:  { type: Boolean, default: true },
    canDelegate: { type: Boolean, default: false },
    slaHours:    { type: Number, min: 1 },
  },
  { _id: false }
);

export interface IWorkflowDoc extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;                // e.g. "COMPLIANCE_APPROVAL", "LICENCE_RENEWAL"
  description?: string;
  entity?: Ref<unknown>;       // → Entity (null = system-wide default)
  module: 'compliance' | 'licence' | 'document' | 'task' | 'general';
  steps: IWorkflowStepItem[];
  isActive: boolean;
  status: ActiveStatus;
  createdBy?: Ref<unknown>;    // → User
  updatedBy?: Ref<unknown>;    // → User
  createdAt: Date;
  updatedAt: Date;
}

const workflowSchema = new Schema<IWorkflowDoc>(
  {
    name:        { type: String, required: true, trim: true },
    code:        { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, default: '' },
    entity:      { type: Schema.Types.ObjectId, ref: 'Entity', default: null },
    module: {
      type: String,
      enum: ['compliance', 'licence', 'document', 'task', 'general'],
      default: 'compliance',
    },
    steps:    { type: [workflowStepItemSchema], default: [] },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

workflowSchema.index({ entity: 1, code: 1 }, { unique: true });
workflowSchema.index({ module: 1, status: 1 });

const Workflow: Model<IWorkflowDoc> = mongoose.model<IWorkflowDoc>('Workflow', workflowSchema);
export default Workflow;
