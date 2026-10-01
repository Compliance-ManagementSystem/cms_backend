/**
 * DocumentVersion Model
 *
 * Standalone collection for tracking file revision history, checksums,
 * and immutable versions of compliance and regulatory documents.
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { DocumentStatus, Ref } from '../types/models.js';

export interface IDocumentVersionDoc extends Document {
  _id: Types.ObjectId;
  document: Ref<unknown>;    // → Document
  version: number;
  fileUrl: string;
  fileName: string;
  fileSize: number;          // in bytes
  mimeType: string;
  checksum?: string;         // SHA-256 integrity hash
  uploadedBy: Ref<unknown>;  // → User
  uploadedAt: Date;
  notes?: string;
  status: DocumentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const documentVersionSchema = new Schema<IDocumentVersionDoc>(
  {
    document:   { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    version:    { type: Number, required: true, min: 1 },
    fileUrl:    { type: String, required: true },
    fileName:   { type: String, required: true, trim: true },
    fileSize:   { type: Number, required: true, min: 0 },
    mimeType:   { type: String, required: true },
    checksum:   { type: String },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
    notes:      { type: String },
    status: {
      type: String,
      enum: ['draft', 'active', 'superseded', 'archived'],
      default: 'active',
    },
  },
  { timestamps: true }
);

documentVersionSchema.index({ document: 1, version: 1 }, { unique: true });
documentVersionSchema.index({ uploadedBy: 1 });
documentVersionSchema.index({ status: 1 });

const DocumentVersion: Model<IDocumentVersionDoc> = mongoose.model<IDocumentVersionDoc>(
  'DocumentVersion',
  documentVersionSchema
);
export default DocumentVersion;
