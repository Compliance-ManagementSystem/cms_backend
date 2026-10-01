/**
 * Role Model
 *
 * Stores named roles with an embedded permission list.
 * Permissions are embedded (not a separate collection) because they are
 * always read together with the role and never queried independently.
 *
 * Examples: super_admin, admin, compliance_manager, auditor, viewer
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ActiveStatus } from '../types/models.js';

// ── Permission (embedded) ─────────────────────────────────────────────────────

export interface IPermission {
  resource: string;   // e.g. "entity", "location", "compliance_record"
  actions: string[];  // e.g. ["create", "read", "update", "delete"]
}

const permissionSchema = new Schema<IPermission>(
  {
    resource: { type: String, required: true, trim: true },
    actions: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => v.length > 0,
        message: 'At least one action is required per permission.',
      },
    },
  },
  { _id: false }
);

// ── Role document ─────────────────────────────────────────────────────────────

export interface IRole extends Document {
  name: string;
  code: string;       // Unique slug, e.g. "super_admin"
  description: string;
  permissions: IPermission[];
  isSystem: boolean;  // System roles cannot be deleted
  status: ActiveStatus;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9_]+$/, 'Code must be lowercase alphanumeric with underscores'],
    },
    description: { type: String, default: '' },
    permissions: { type: [permissionSchema], default: [] },
    isSystem: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Note: { code: 1 } unique index is declared on the field itself (no duplicate needed)
roleSchema.index({ status: 1 });

const Role: Model<IRole> = mongoose.model<IRole>('Role', roleSchema);
export default Role;
