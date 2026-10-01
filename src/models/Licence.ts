/**
 * Licence Model
 *
 * Tracks government/regulatory licences and approvals tied to a Location.
 * Maps to Phase 3: Manage Licences & Approvals.
 *
 * Each Licence has:
 *   - Issuing authority
 *   - Issue/expiry dates
 *   - Referenced documents (certificates)
 *   - Renewal history (embedded)
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus, Ref } from '../types/models.js';

// ── Renewal history (embedded) ─────────────────────────────────────────────────

export interface ILicenceRenewal {
  _id: Types.ObjectId;
  renewedAt: Date;
  previousExpiryDate: Date;
  newExpiryDate: Date;
  renewedBy: Ref<unknown>;    // → User
  documentRef?: Ref<unknown>; // → Document
  remarks?: string;
}

const licenceRenewalSchema = new Schema<ILicenceRenewal>(
  {
    renewedAt:           { type: Date, required: true, default: Date.now },
    previousExpiryDate:  { type: Date, required: true },
    newExpiryDate:       { type: Date, required: true },
    renewedBy:           { type: Schema.Types.ObjectId, ref: 'User', required: true },
    documentRef:         { type: Schema.Types.ObjectId, ref: 'Document' },
    remarks:             { type: String },
  },
  { _id: true }
);

// ── Licence document ───────────────────────────────────────────────────────────

export type LicenceStatus = 'active' | 'expired' | 'pending_renewal' | 'cancelled' | 'suspended';

export interface ILicence extends Document {
  _id: Types.ObjectId;
  entity: Ref<unknown>;        // → Entity
  location: Ref<unknown>;      // → Location
  licenceType: Ref<unknown>;   // → MasterData (licence_type)

  licenceNumber: string;
  issuingAuthority: string;
  issuingState?: string;

  issueDate: Date;
  expiryDate: Date;
  nextRenewalDate?: Date;

  document?: Ref<unknown>;     // → Document (current certificate)
  renewalHistory: ILicenceRenewal[];

  reminderDaysBefore: number[];
  remindersSent: number[];

  status: LicenceStatus;
  notes?: string;
  createdBy?: Ref<unknown>;
  updatedBy?: Ref<unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const licenceSchema = new Schema<ILicence>(
  {
    entity:   { type: Schema.Types.ObjectId, ref: 'Entity', required: true },
    location: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    licenceType: {
      type: Schema.Types.ObjectId,
      ref: 'MasterData',
      required: true,
    },

    licenceNumber:    { type: String, required: true, trim: true },
    issuingAuthority: { type: String, required: true, trim: true },
    issuingState:     { type: String, trim: true },

    issueDate:       { type: Date, required: true },
    expiryDate:      { type: Date, required: true },
    nextRenewalDate: { type: Date },

    document:        { type: Schema.Types.ObjectId, ref: 'Document' },
    renewalHistory:  { type: [licenceRenewalSchema], default: [] },

    reminderDaysBefore: { type: [Number], default: [90, 60, 30, 7] },
    remindersSent:      { type: [Number], default: [] },

    status: {
      type: String,
      enum: ['active', 'expired', 'pending_renewal', 'cancelled', 'suspended'],
      default: 'active',
    },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
licenceSchema.index({ entity: 1, status: 1 });
licenceSchema.index({ location: 1, licenceType: 1 });
licenceSchema.index({ expiryDate: 1 });                 // Expiry job
licenceSchema.index({ licenceNumber: 1, entity: 1 });   // Lookup by number

const Licence: Model<ILicence> = mongoose.model<ILicence>('Licence', licenceSchema);
export default Licence;
