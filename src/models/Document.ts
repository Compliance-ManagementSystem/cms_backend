/**
 * Document Model
 *
 * Stores compliance and operational file metadata and maintains full immutable
 * version history as embedded DocumentVersion subdocuments.
 *
 * Requirements:
 * - name / title
 * - type / documentType
 * - entity
 * - location
 * - complianceRecord
 * - uploadedBy
 * - uploadedAt
 * - expiryDate
 * - verificationStatus ('pending' | 'verified' | 'rejected')
 * - version
 * - Never destroy old versions when replacing a document.
 */

import mongoose, { Schema, Document as MongoDocument, Model, Types } from 'mongoose';
import type { Ref } from '../types/models.js';

// ── DocumentVersion Subdocument (Embedded Immutable History) ─────────────────
export interface IDocumentVersion {
  _id: Types.ObjectId;
  version: number;
  fileUrl: string;
  fileName: string;
  fileSize: number; // bytes
  mimeType: string;
  checksum?: string;
  uploadedBy: Ref<unknown>; // → User
  uploadedAt: Date;
  notes?: string;
  status: 'active' | 'superseded' | 'archived';
}

const documentVersionSchema = new Schema<IDocumentVersion>(
  {
    version: { type: Number, required: true, min: 1 },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true, min: 0 },
    mimeType: { type: String, required: true },
    checksum: { type: String },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
    notes: { type: String },
    status: {
      type: String,
      enum: ['active', 'superseded', 'archived'],
      default: 'active',
    },
  },
  { _id: true }
);

// ── Document Document ─────────────────────────────────────────────────────────
export interface IDocument extends MongoDocument {
  _id: Types.ObjectId;
  name: string; // display name / document title
  title: string; // alias for name
  type?: string; // string type identifier or code
  documentType?: Ref<unknown>; // → MasterData (category: 'document_type')
  description?: string;

  entity: Ref<unknown>; // → Entity
  location?: Ref<unknown>; // → Location
  complianceRecord?: Ref<unknown>; // → ComplianceRecord

  // Polymorphic reference
  relatedTo?: {
    model: 'Location' | 'ComplianceRecord' | 'Licence' | 'Entity';
    id: Types.ObjectId;
  };

  // Current active version metadata
  version: number;
  currentVersion: number;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  latestVersionUrl?: string;

  uploadedBy: Ref<unknown>; // → User
  uploadedAt: Date;

  expiryDate?: Date;
  issueDate?: Date;

  verificationStatus: 'pending' | 'verified' | 'rejected';
  verifiedBy?: Ref<unknown>; // → User
  verifiedAt?: Date;
  verificationNotes?: string;

  // Complete version history — older versions are never destroyed
  versions: IDocumentVersion[];

  tags?: string[];
  status: 'active' | 'archived' | 'superseded';
  createdBy?: Ref<unknown>;
  updatedBy?: Ref<unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<IDocument>(
  {
    name: { type: String, required: true, trim: true },
    title: { type: String, trim: true },
    type: { type: String, trim: true },
    documentType: { type: Schema.Types.ObjectId, ref: 'MasterData' },
    description: { type: String },

    entity: { type: Schema.Types.ObjectId, ref: 'Entity', required: true, index: true },
    location: { type: Schema.Types.ObjectId, ref: 'Location', index: true },
    complianceRecord: { type: Schema.Types.ObjectId, ref: 'ComplianceRecord', index: true },

    relatedTo: {
      model: {
        type: String,
        enum: ['Location', 'ComplianceRecord', 'Licence', 'Entity'],
      },
      id: { type: Schema.Types.ObjectId },
    },

    version: { type: Number, default: 1, min: 1 },
    currentVersion: { type: Number, default: 1, min: 1 },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 0 },
    mimeType: { type: String, required: true },
    latestVersionUrl: { type: String },

    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    uploadedAt: { type: Date, default: Date.now },

    expiryDate: { type: Date, index: true },
    issueDate: { type: Date },

    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      index: true,
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    verificationNotes: { type: String },

    versions: { type: [documentVersionSchema], default: [] },

    tags: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['active', 'archived', 'superseded'],
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

// ── Pre-validate Hook ─────────────────────────────────────────────────────────
documentSchema.pre('validate', function (next) {
  if (this.name && !this.title) {
    this.title = this.name;
  } else if (this.title && !this.name) {
    this.name = this.title;
  }

  if (this.version && !this.currentVersion) {
    this.currentVersion = this.version;
  } else if (this.currentVersion && !this.version) {
    this.version = this.currentVersion;
  }

  if (this.fileUrl && !this.latestVersionUrl) {
    this.latestVersionUrl = this.fileUrl;
  }

  // Ensure complianceRecord and relatedTo are aligned
  if (this.complianceRecord && !this.relatedTo) {
    this.relatedTo = {
      model: 'ComplianceRecord',
      id: this.complianceRecord as Types.ObjectId,
    };
  }

  next();
});

// ── Indexes ──────────────────────────────────────────────────────────────────
documentSchema.index({ entity: 1, complianceRecord: 1 });
documentSchema.index({ complianceRecord: 1, version: 1 });

const CmsDocument: Model<IDocument> = mongoose.model<IDocument>('Document', documentSchema);
export default CmsDocument;
