/**
 * Document Controller
 *
 * Handles statutory and compliance evidence file uploads, version replacements,
 * inline previews, secure downloads, metadata tracking, and verification workflows.
 */

import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { Types } from 'mongoose';
import DocumentModel, { IDocument } from '../models/Document.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertInScope, getAccessScope, isInScope } from '../utils/accessScope.js';
import { auditService } from '../services/audit.service.js';
import { TaskAutomationService } from '../services/taskAutomation.service.js';

// Multer has already written the file by the time the controller runs,
// so a rejected request must remove it before failing.
const rejectUpload = (req: Request, error: ApiError): never => {
  if (req.file?.path) {
    fs.unlink(req.file.path, () => {});
  }
  throw error;
};

// ── 1. Upload New Document ───────────────────────────────────────────────────
export const uploadDocument = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw ApiError.badRequest('No file provided for upload.');
  }

  const {
    name,
    title,
    type,
    documentType,
    description,
    entity,
    location,
    complianceRecord: complianceRecordId,
    expiryDate,
    issueDate,
    tags,
  } = req.body;

  const docName = name || title || req.file.originalname;
  let entityId = entity || req.auth?.entityId;
  let locationId = location;

  // A document attached to a compliance record always inherits that record's entity & location
  if (complianceRecordId) {
    const record = Types.ObjectId.isValid(complianceRecordId)
      ? await ComplianceRecord.findById(complianceRecordId).select('entity location')
      : null;
    if (!record) {
      return rejectUpload(req, ApiError.notFound('Compliance record not found.'));
    }
    entityId = String(record.entity);
    locationId = String(record.location);
  }

  if (!entityId) {
    return rejectUpload(req, ApiError.badRequest('Entity ID is required for document upload.'));
  }

  if (!isInScope(getAccessScope(req), { entity: entityId, location: locationId })) {
    return rejectUpload(
      req,
      ApiError.forbidden('You are not authorized to upload documents outside your assigned entity or location.')
    );
  }

  const fileUrl = `/uploads/compliance-documents/${req.file.filename}`;
  const uploadedBy = req.auth?.userId;

  // Build initial version subdocument
  const initialVersion = {
    version: 1,
    fileUrl,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    uploadedBy: new Types.ObjectId(uploadedBy),
    uploadedAt: new Date(),
    notes: 'Initial document upload',
    status: 'active' as const,
  };

  const document = new DocumentModel({
    name: docName,
    title: docName,
    type: type || 'COMPLIANCE_EVIDENCE',
    documentType: documentType || undefined,
    description,
    entity: new Types.ObjectId(entityId),
    location: locationId ? new Types.ObjectId(locationId) : undefined,
    complianceRecord: complianceRecordId ? new Types.ObjectId(complianceRecordId) : undefined,
    relatedTo: complianceRecordId
      ? { model: 'ComplianceRecord', id: new Types.ObjectId(complianceRecordId) }
      : locationId
      ? { model: 'Location', id: new Types.ObjectId(locationId) }
      : { model: 'Entity', id: new Types.ObjectId(entityId) },
    version: 1,
    currentVersion: 1,
    fileUrl,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    latestVersionUrl: fileUrl,
    uploadedBy: new Types.ObjectId(uploadedBy),
    uploadedAt: new Date(),
    expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    issueDate: issueDate ? new Date(issueDate) : undefined,
    verificationStatus: 'pending',
    versions: [initialVersion],
    tags: tags ? (Array.isArray(tags) ? tags : [tags]) : [],
    status: 'active',
    createdBy: new Types.ObjectId(uploadedBy),
    updatedBy: new Types.ObjectId(uploadedBy),
  });

  await document.save();

  // If attached to a ComplianceRecord, append to record's documents array
  if (complianceRecordId) {
    await ComplianceRecord.findByIdAndUpdate(complianceRecordId, {
      $addToSet: { documents: document._id },
      updatedBy: uploadedBy,
    });
  }

  await auditService.logDocumentUploaded(document, req);
  if (complianceRecordId) await TaskAutomationService.syncRecordTasks(complianceRecordId);

  return ApiResponse.created(res, { document }, 'Document uploaded successfully');
});

// ── 2. Replace Document (New Version — Never Destroy Old Versions) ────────────
export const replaceDocument = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!req.file) {
    throw ApiError.badRequest('No replacement file provided.');
  }

  const document = await DocumentModel.findById(id);
  if (!document) {
    return rejectUpload(req, ApiError.notFound('Document not found.'));
  }

  if (!isInScope(getAccessScope(req), document)) {
    return rejectUpload(
      req,
      ApiError.forbidden('You are not authorized to replace documents outside your assigned entity or location.')
    );
  }

  const notes = req.body.notes || 'Replaced document file';
  const newVersionNumber = (document.currentVersion || document.version || 1) + 1;
  const fileUrl = `/uploads/compliance-documents/${req.file.filename}`;
  const uploadedBy = req.auth?.userId;

  // Mark all existing versions as superseded
  document.versions.forEach((v) => {
    v.status = 'superseded';
  });

  // Append new version
  document.versions.push({
    _id: new Types.ObjectId(),
    version: newVersionNumber,
    fileUrl,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    uploadedBy: new Types.ObjectId(uploadedBy),
    uploadedAt: new Date(),
    notes,
    status: 'active',
  } as any);

  // Update active top-level pointer
  document.currentVersion = newVersionNumber;
  document.version = newVersionNumber;
  document.fileUrl = fileUrl;
  document.fileName = req.file.originalname;
  document.fileSize = req.file.size;
  document.mimeType = req.file.mimetype;
  document.latestVersionUrl = fileUrl;
  document.uploadedBy = new Types.ObjectId(uploadedBy);
  document.uploadedAt = new Date();
  document.verificationStatus = 'pending'; // reset verification on replacement
  document.updatedBy = new Types.ObjectId(uploadedBy);

  if (req.body.expiryDate) {
    document.expiryDate = new Date(req.body.expiryDate);
  }

  await document.save();

  await auditService.logDocumentReplaced(document, newVersionNumber - 1, req);
  if (document.complianceRecord) await TaskAutomationService.syncRecordTasks(document.complianceRecord as Types.ObjectId);

  return ApiResponse.success(res, { document }, `Document version v${newVersionNumber} uploaded successfully`);
});

// ── 3. Get Document Metadata & Versions ──────────────────────────────────────
export const getDocumentById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const document = await DocumentModel.findById(id)
    .populate('entity', 'name entityCode')
    .populate('location', 'name locationCode')
    .populate('uploadedBy', 'firstName lastName email fullName')
    .populate('verifiedBy', 'firstName lastName email fullName')
    .populate('versions.uploadedBy', 'firstName lastName email fullName');

  if (!document) {
    throw ApiError.notFound('Document not found.');
  }

  assertInScope(req, document);

  return ApiResponse.success(res, { document });
});

// ── 4. Download Document File ─────────────────────────────────────────────────
export const downloadDocument = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const versionParam = req.query.version ? parseInt(req.query.version as string, 10) : null;

  const document = await DocumentModel.findById(id);
  if (!document) {
    throw ApiError.notFound('Document not found.');
  }

  assertInScope(req, document);

  let targetFileUrl = document.fileUrl;
  let targetFileName = document.fileName;

  // If a specific version was requested, look it up in immutable history
  if (versionParam && versionParam !== document.currentVersion) {
    const historical = document.versions.find((v) => v.version === versionParam);
    if (!historical) {
      throw ApiError.notFound(`Version ${versionParam} not found for this document.`);
    }
    targetFileUrl = historical.fileUrl;
    targetFileName = historical.fileName;
  }

  // Construct absolute disk path
  const relativePath = targetFileUrl.startsWith('/') ? targetFileUrl.slice(1) : targetFileUrl;
  const absolutePath = path.join(process.cwd(), relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw ApiError.notFound('File not found on storage disk.');
  }

  res.download(absolutePath, targetFileName);
});

// ── 5. Preview Document File (Inline) ─────────────────────────────────────────
export const previewDocument = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const versionParam = req.query.version ? parseInt(req.query.version as string, 10) : null;

  const document = await DocumentModel.findById(id);
  if (!document) {
    throw ApiError.notFound('Document not found.');
  }

  assertInScope(req, document);

  let targetFileUrl = document.fileUrl;
  let targetMimeType = document.mimeType;

  if (versionParam && versionParam !== document.currentVersion) {
    const historical = document.versions.find((v) => v.version === versionParam);
    if (!historical) {
      throw ApiError.notFound(`Version ${versionParam} not found for this document.`);
    }
    targetFileUrl = historical.fileUrl;
    targetMimeType = historical.mimeType;
  }

  const relativePath = targetFileUrl.startsWith('/') ? targetFileUrl.slice(1) : targetFileUrl;
  const absolutePath = path.join(process.cwd(), relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw ApiError.notFound('File not found on storage disk.');
  }

  res.setHeader('Content-Type', targetMimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(absolutePath);
});

// ── 6. Verify Document Status ─────────────────────────────────────────────────
export const verifyDocument = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { verificationStatus, notes } = req.body;

  if (!['pending', 'verified', 'rejected'].includes(verificationStatus)) {
    throw ApiError.badRequest('Invalid verification status. Allowed: pending, verified, rejected.');
  }

  const document = await DocumentModel.findById(id);
  if (!document) {
    throw ApiError.notFound('Document not found.');
  }

  assertInScope(req, document);

  const previousVerificationStatus = document.verificationStatus;
  document.verificationStatus = verificationStatus;
  document.verifiedBy = new Types.ObjectId(req.auth?.userId);
  document.verifiedAt = new Date();
  if (notes) document.verificationNotes = notes;
  document.updatedBy = new Types.ObjectId(req.auth?.userId);

  await document.save();

  await auditService.logMutation({
    req,
    action: 'DOCUMENT_VERIFIED',
    module: 'documents',
    entityType: 'Document',
    recordId: document._id,
    entityId: document.entity as Types.ObjectId,
    previousValue: { verificationStatus: previousVerificationStatus },
    newValue: { verificationStatus },
    description: `Document "${document.name}" marked as ${verificationStatus}`,
    metadata: { notes },
  });
  if (document.complianceRecord) await TaskAutomationService.syncRecordTasks(document.complianceRecord as Types.ObjectId);

  return ApiResponse.success(res, { document }, `Document marked as ${verificationStatus}`);
});

// ── 7. Delete / Archive Document ──────────────────────────────────────────────
export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const document = await DocumentModel.findById(id);
  if (!document) {
    throw ApiError.notFound('Document not found.');
  }

  assertInScope(req, document);

  // Remove reference from compliance record if linked
  if (document.complianceRecord) {
    await ComplianceRecord.findByIdAndUpdate(document.complianceRecord, {
      $pull: { documents: document._id },
    });
  }

  // Soft-delete: mark as archived
  document.status = 'archived';
  await document.save();

  await auditService.logMutation({
    req,
    action: 'DOCUMENT_DELETED',
    module: 'documents',
    entityType: 'Document',
    recordId: document._id,
    entityId: document.entity as Types.ObjectId,
    previousValue: { name: document.name, status: 'active' },
    newValue: { status: 'archived' },
    description: `Archived document "${document.name}"`,
  });
  if (document.complianceRecord) await TaskAutomationService.syncRecordTasks(document.complianceRecord as Types.ObjectId);

  return ApiResponse.success(res, null, 'Document archived successfully');
});
