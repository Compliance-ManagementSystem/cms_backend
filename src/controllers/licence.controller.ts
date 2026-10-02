/**
 * Licence Controller
 *
 * Statutory licences and approvals held by a location, each with an optional
 * certificate file kept as a versioned document.
 */

import { Request, Response } from 'express';
import fs from 'fs';
import { Types } from 'mongoose';
import type { ZodType } from 'zod';
import Licence, { ILicence } from '../models/Licence.js';
import Location from '../models/Location.js';
import MasterData from '../models/MasterData.js';
import DocumentModel from '../models/Document.js';
import { DocumentService } from '../services/document.service.js';
import { auditService } from '../services/audit.service.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getAccessScope, isInScope } from '../utils/accessScope.js';
import { createLicenceSchema, updateLicenceSchema } from '../validations/licence.validation.js';

// Multer has already written the file by the time the controller runs,
// so a request that fails afterwards must not leave it behind.
const discardUpload = (req: Request): void => {
  if (req.file?.path) {
    fs.unlink(req.file.path, () => {});
  }
};

const withUploadCleanup = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  asyncHandler(async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      discardUpload(req);
      throw error;
    }
  });

// Validation failures name the field, so the form can show a useful message
const parseBody = <T>(schema: ZodType<T, any, any>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.badRequest(
      result.error.errors
        .map((e) => (e.message === 'Required' ? `${e.path.join('.')} is required` : e.message))
        .join(', ')
    );
  }
  return result.data;
};

const resolveLicenceType = async (id: string) => {
  const type = await MasterData.findOne({ _id: id, category: 'licence_type' }).select('label');
  if (!type) throw ApiError.badRequest('Licence type not found in Master Data');
  return type;
};

const populated = (id: Types.ObjectId) =>
  Licence.findById(id)
    .populate('licenceType', 'code label')
    .populate('document', 'name fileName currentVersion')
    .lean();

const auditSnapshot = (licence: ILicence) => ({
  licenceNumber: licence.licenceNumber,
  licenceType: licence.licenceType?.toString(),
  issuingAuthority: licence.issuingAuthority,
  issuingState: licence.issuingState,
  issueDate: licence.issueDate,
  expiryDate: licence.expiryDate,
  status: licence.status,
  notes: licence.notes,
  document: licence.document?.toString(),
});

// ── 1. Create Licence ─────────────────────────────────────────────────────────
export const createLicence = withUploadCleanup(async (req, res) => {
  const input = parseBody(createLicenceSchema, req.body);

  const location = await Location.findById(input.location).select('name entity address.state');
  if (!location) throw ApiError.notFound('Location not found');

  const entityId = String(location.entity);
  if (!isInScope(getAccessScope(req), { entity: entityId, location: location._id })) {
    throw ApiError.forbidden('You are not authorized to add licences to this location');
  }

  const licenceType = await resolveLicenceType(input.licenceType);

  const duplicate = await Licence.findOne({
    location: location._id,
    licenceNumber: input.licenceNumber,
  }).select('_id');
  if (duplicate) {
    throw ApiError.conflict(`Licence number "${input.licenceNumber}" is already recorded for this location`);
  }

  const licence = await Licence.create({
    entity: location.entity,
    location: location._id,
    licenceType: licenceType._id,
    licenceNumber: input.licenceNumber,
    issuingAuthority: input.issuingAuthority,
    issuingState: input.issuingState || location.address?.state,
    issueDate: new Date(input.issueDate),
    expiryDate: new Date(input.expiryDate),
    status: input.status || 'active',
    notes: input.notes || undefined,
    createdBy: req.auth!.userId,
    updatedBy: req.auth!.userId,
  });

  if (req.file) {
    const certificate = await DocumentService.createFromUpload({
      file: req.file,
      userId: req.auth!.userId,
      entityId,
      locationId: location._id.toString(),
      relatedTo: { model: 'Licence', id: licence._id },
      name: `${licenceType.label} – ${input.licenceNumber}`,
      type: 'LICENCE_CERT',
      issueDate: input.issueDate,
      expiryDate: input.expiryDate,
    });
    licence.document = certificate._id;
    await licence.save();
  }

  await auditService.logMutation({
    req,
    action: 'LICENCE_CREATED',
    module: 'licences',
    entityType: 'Licence',
    recordId: licence._id,
    entityId: licence.entity as Types.ObjectId,
    newValue: auditSnapshot(licence),
    description: `Added licence '${licence.licenceNumber}' (${licenceType.label}) to location '${location.name}'`,
  });

  return ApiResponse.created(res, { licence: await populated(licence._id) }, 'Licence added successfully');
});

// ── 2. Update Licence (details, renewal, certificate) ─────────────────────────
export const updateLicence = withUploadCleanup(async (req, res) => {
  const input = parseBody(updateLicenceSchema, req.body);

  const licence = await Licence.findById(String(req.params.id));
  if (!licence) throw ApiError.notFound('Licence not found');

  if (!isInScope(getAccessScope(req), licence)) {
    throw ApiError.forbidden('You are not authorized to update this licence');
  }

  const previousValue = auditSnapshot(licence);
  const previousExpiry = licence.expiryDate;

  if (input.licenceType) licence.licenceType = (await resolveLicenceType(input.licenceType))._id;

  if (input.licenceNumber && input.licenceNumber !== licence.licenceNumber) {
    const duplicate = await Licence.findOne({
      _id: { $ne: licence._id },
      location: licence.location,
      licenceNumber: input.licenceNumber,
    }).select('_id');
    if (duplicate) {
      throw ApiError.conflict(`Licence number "${input.licenceNumber}" is already recorded for this location`);
    }
    licence.licenceNumber = input.licenceNumber;
  }

  if (input.issuingAuthority) licence.issuingAuthority = input.issuingAuthority;
  if (input.issuingState !== undefined) licence.issuingState = input.issuingState || undefined;
  if (input.issueDate) licence.issueDate = new Date(input.issueDate);
  if (input.expiryDate) licence.expiryDate = new Date(input.expiryDate);
  if (input.status) licence.status = input.status;
  if (input.notes !== undefined) licence.notes = input.notes || undefined;

  if (licence.expiryDate <= licence.issueDate) {
    throw ApiError.badRequest('Expiry date must be after the issue date');
  }

  // New certificate file: a new version of the existing document, or the first one
  let certificateId = licence.document as Types.ObjectId | undefined;
  if (req.file) {
    const existing = certificateId ? await DocumentModel.findById(certificateId) : null;
    if (existing) {
      await DocumentService.addVersion(existing, req.file, req.auth!.userId, {
        notes: 'Licence certificate updated',
        expiryDate: licence.expiryDate,
      });
    } else {
      const type = await MasterData.findById(licence.licenceType).select('label');
      const certificate = await DocumentService.createFromUpload({
        file: req.file,
        userId: req.auth!.userId,
        entityId: String(licence.entity),
        locationId: String(licence.location),
        relatedTo: { model: 'Licence', id: licence._id },
        name: `${type?.label || 'Licence'} – ${licence.licenceNumber}`,
        type: 'LICENCE_CERT',
        issueDate: licence.issueDate,
        expiryDate: licence.expiryDate,
      });
      certificateId = certificate._id;
      licence.document = certificate._id;
    }
  }

  // Extending the validity is a renewal; keep the history
  const isRenewal = licence.expiryDate.getTime() > previousExpiry.getTime();
  if (isRenewal) {
    licence.renewalHistory.push({
      renewedAt: new Date(),
      previousExpiryDate: previousExpiry,
      newExpiryDate: licence.expiryDate,
      renewedBy: new Types.ObjectId(req.auth!.userId),
      documentRef: req.file ? certificateId : undefined,
    } as any);
    licence.remindersSent = [];
  }

  licence.updatedBy = req.auth!.userId as any;
  await licence.save();

  await auditService.logMutation({
    req,
    action: isRenewal ? 'LICENCE_RENEWED' : 'LICENCE_UPDATED',
    module: 'licences',
    entityType: 'Licence',
    recordId: licence._id,
    entityId: licence.entity as Types.ObjectId,
    previousValue,
    newValue: auditSnapshot(licence),
    description: isRenewal
      ? `Renewed licence '${licence.licenceNumber}' until ${licence.expiryDate.toLocaleDateString()}`
      : `Updated licence '${licence.licenceNumber}'`,
  });

  return ApiResponse.success(
    res,
    { licence: await populated(licence._id) },
    isRenewal ? 'Licence renewed successfully' : 'Licence updated successfully'
  );
});

// ── 3. Delete Licence ─────────────────────────────────────────────────────────
export const deleteLicence = asyncHandler(async (req: Request, res: Response) => {
  const licence = await Licence.findById(String(req.params.id));
  if (!licence) throw ApiError.notFound('Licence not found');

  if (!isInScope(getAccessScope(req), licence)) {
    throw ApiError.forbidden('You are not authorized to delete this licence');
  }

  await Licence.findByIdAndDelete(licence._id);

  // The certificate is archived rather than destroyed
  if (licence.document) {
    await DocumentModel.updateOne({ _id: licence.document }, { $set: { status: 'archived' } });
  }

  await auditService.logMutation({
    req,
    action: 'LICENCE_DELETED',
    module: 'licences',
    entityType: 'Licence',
    recordId: licence._id,
    entityId: licence.entity as Types.ObjectId,
    previousValue: auditSnapshot(licence),
    description: `Deleted licence '${licence.licenceNumber}'`,
  });

  return ApiResponse.success(res, null, 'Licence deleted successfully');
});
