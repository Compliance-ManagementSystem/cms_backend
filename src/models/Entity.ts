/**
 * Entity Model
 *
 * Top-level legal/business entity in the compliance hierarchy.
 * Maps to: CCPL / CPPL / CTPL as per the reference workflow.
 *
 * An Entity owns many Locations.
 * Users are scoped to an Entity (or to all entities for super_admin).
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus, Ref } from '../types/models.js';

// ── Address (embedded) ────────────────────────────────────────────────────────

export interface IAddress {
  line1: string;
  line2?: string;
  city: string;
  district?: string;
  state: string;
  pincode?: string;
  country: string;
}

const addressSchema = new Schema<IAddress>(
  {
    line1:    { type: String, required: true, trim: true },
    line2:    { type: String, trim: true },
    city:     { type: String, required: true, trim: true },
    district: { type: String, trim: true },
    state:    { type: String, required: true, trim: true },
    pincode:  { type: String, trim: true },
    country:  { type: String, required: true, trim: true, default: 'India' },
  },
  { _id: false }
);

// ── Entity document ────────────────────────────────────────────────────────────

export interface IEntity extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;           // Unique entity code e.g. "CCPL", "CPPL"
  entityCode?: string;    // Virtual alias
  entityType: Ref<unknown>; // → MasterData (category: entity_type)
  owner?: Ref<unknown>;   // → User (Entity Admin / Owner)
  registrationNumber?: string;
  gstin?: string;
  pan?: string;
  cin?: string;           // Company Identification Number
  address: IAddress;
  contactEmail: string;
  contactPhone: string;
  contactPerson?: string;
  industry?: Ref<unknown>; // → MasterData (category: industry)
  parentEntity?: Ref<unknown>; // → Entity (for subsidiary/group structure)
  logoUrl?: string;
  description?: string;
  status: ActiveStatus;
  createdBy?: Ref<unknown>; // → User
  updatedBy?: Ref<unknown>; // → User
  createdAt: Date;
  updatedAt: Date;
}

const entitySchema = new Schema<IEntity>(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9_-]+$/, 'Code must be uppercase alphanumeric'],
    },
    entityType: {
      type: Schema.Types.ObjectId,
      ref: 'MasterData',
      required: true,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    registrationNumber: { type: String, trim: true, default: '' },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format'],
      sparse: true,
    },
    pan: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format'],
      sparse: true,
    },
    cin: { type: String, trim: true, uppercase: true },
    address: { type: addressSchema, required: true },
    contactEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },
    contactPhone: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    industry: { type: Schema.Types.ObjectId, ref: 'MasterData' },
    parentEntity: { type: Schema.Types.ObjectId, ref: 'Entity' },
    logoUrl: { type: String },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual alias for entityCode
entitySchema.virtual('entityCode').get(function (this: IEntity) {
  return this.code;
});

// ── Indexes ────────────────────────────────────────────────────────────────────
// Note: { code: 1 } unique index is declared on the field itself
entitySchema.index({ status: 1 });
entitySchema.index({ entityType: 1 });
entitySchema.index({ parentEntity: 1 });

const Entity: Model<IEntity> = mongoose.model<IEntity>('Entity', entitySchema);
export default Entity;
