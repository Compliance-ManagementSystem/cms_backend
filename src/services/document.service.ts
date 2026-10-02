/**
 * Document Service
 *
 * Creates stored documents from uploaded files and adds new versions to them.
 * Older versions are never destroyed; they are marked superseded.
 */

import { Types } from 'mongoose';
import DocumentModel, { IDocument } from '../models/Document.js';

type RelatedModel = 'Location' | 'ComplianceRecord' | 'Licence' | 'Entity';

export interface NewDocumentInput {
  file: Express.Multer.File;
  userId: string;
  entityId: string;
  locationId?: string;
  complianceRecordId?: string;
  /** Defaults to the compliance record, then the location, then the entity */
  relatedTo?: { model: RelatedModel; id: string | Types.ObjectId };
  name?: string;
  type?: string;
  documentType?: string;
  description?: string;
  expiryDate?: string | Date;
  issueDate?: string | Date;
  tags?: string | string[];
}

const fileUrlOf = (file: Express.Multer.File): string => `/uploads/compliance-documents/${file.filename}`;

export class DocumentService {
  public static async createFromUpload(input: NewDocumentInput): Promise<IDocument> {
    const { file, userId, entityId, locationId, complianceRecordId } = input;
    const fileUrl = fileUrlOf(file);
    const uploadedBy = new Types.ObjectId(userId);
    const name = input.name || file.originalname;

    const relatedTo = input.relatedTo
      ? { model: input.relatedTo.model, id: new Types.ObjectId(input.relatedTo.id) }
      : complianceRecordId
      ? { model: 'ComplianceRecord' as const, id: new Types.ObjectId(complianceRecordId) }
      : locationId
      ? { model: 'Location' as const, id: new Types.ObjectId(locationId) }
      : { model: 'Entity' as const, id: new Types.ObjectId(entityId) };

    const document = new DocumentModel({
      name,
      title: name,
      type: input.type || 'COMPLIANCE_EVIDENCE',
      documentType: input.documentType || undefined,
      description: input.description,
      entity: new Types.ObjectId(entityId),
      location: locationId ? new Types.ObjectId(locationId) : undefined,
      complianceRecord: complianceRecordId ? new Types.ObjectId(complianceRecordId) : undefined,
      relatedTo,
      version: 1,
      currentVersion: 1,
      fileUrl,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      latestVersionUrl: fileUrl,
      uploadedBy,
      uploadedAt: new Date(),
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
      issueDate: input.issueDate ? new Date(input.issueDate) : undefined,
      verificationStatus: 'pending',
      versions: [
        {
          version: 1,
          fileUrl,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          uploadedBy,
          uploadedAt: new Date(),
          notes: 'Initial document upload',
          status: 'active' as const,
        },
      ],
      tags: input.tags ? (Array.isArray(input.tags) ? input.tags : [input.tags]) : [],
      status: 'active',
      createdBy: uploadedBy,
      updatedBy: uploadedBy,
    });

    await document.save();
    return document;
  }

  /**
   * Replaces the current file with a new version and returns the new version number.
   * Verification is reset because the content changed.
   */
  public static async addVersion(
    document: IDocument,
    file: Express.Multer.File,
    userId: string,
    options: { notes?: string; expiryDate?: string | Date } = {}
  ): Promise<number> {
    const fileUrl = fileUrlOf(file);
    const uploadedBy = new Types.ObjectId(userId);
    const newVersionNumber = (document.currentVersion || document.version || 1) + 1;

    document.versions.forEach((v) => {
      v.status = 'superseded';
    });

    document.versions.push({
      _id: new Types.ObjectId(),
      version: newVersionNumber,
      fileUrl,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy,
      uploadedAt: new Date(),
      notes: options.notes || 'Replaced document file',
      status: 'active',
    } as any);

    document.currentVersion = newVersionNumber;
    document.version = newVersionNumber;
    document.fileUrl = fileUrl;
    document.fileName = file.originalname;
    document.fileSize = file.size;
    document.mimeType = file.mimetype;
    document.latestVersionUrl = fileUrl;
    document.uploadedBy = uploadedBy;
    document.uploadedAt = new Date();
    document.verificationStatus = 'pending';
    document.updatedBy = uploadedBy;
    document.status = 'active';

    if (options.expiryDate) {
      document.expiryDate = new Date(options.expiryDate);
    }

    await document.save();
    return newVersionNumber;
  }
}
