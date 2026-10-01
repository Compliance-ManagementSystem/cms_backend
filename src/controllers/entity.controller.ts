/**
 * Entity Controller
 *
 * Full CRUD, search, filter, pagination, sorting, relationship aggregation, and RBAC scoping.
 */

import { Request, Response } from 'express';
import Entity from '../models/Entity.js';
import MasterData from '../models/MasterData.js';
import User from '../models/User.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import CmsDocument from '../models/Document.js';
import Task from '../models/Task.js';
import AuditLog from '../models/AuditLog.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAuditEvent } from '../utils/audit.js';
import { ROLES } from '../constants/permissions.js';

// Helper to determine if user has global administrative visibility
const isGlobalAdmin = (req: Request): boolean => {
  const roleCode = (req.user?.role as any)?.code || req.auth?.role;
  return roleCode === ROLES.SUPER_ADMIN || roleCode === ROLES.ADMIN;
};

// ── 1. Get Paginated Entities with Search, Filter & Sorting ───────────────────
export const getEntities = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
  const search = (req.query.search as string)?.trim();
  const entityType = req.query.entityType as string;
  const status = req.query.status as string;
  const state = req.query.state as string;
  const district = req.query.district as string;
  const city = req.query.city as string;
  const sortBy = (req.query.sortBy as string) || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

  const query: Record<string, any> = {};

  // RBAC Scoping: Non-global users can only see their assigned entity
  if (!isGlobalAdmin(req)) {
    const userEntityId = req.user?.entity
      ? (req.user.entity as any)._id || req.user.entity
      : req.auth?.entityId;

    if (!userEntityId) {
      return ApiResponse.success(res, {
        entities: [],
        pagination: { total: 0, page, limit, totalPages: 0 },
      });
    }
    query._id = userEntityId;
  }

  // Filters
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { name: searchRegex },
      { code: searchRegex },
      { 'address.city': searchRegex },
      { 'address.state': searchRegex },
      { contactEmail: searchRegex },
      { contactPhone: searchRegex },
    ];
  }

  if (entityType) {
    query.entityType = entityType;
  }

  if (status) {
    query.status = status;
  }

  if (state) {
    query['address.state'] = new RegExp(`^${state}$`, 'i');
  }

  if (district) {
    query['address.district'] = new RegExp(`^${district}$`, 'i');
  }

  if (city) {
    query['address.city'] = new RegExp(`^${city}$`, 'i');
  }

  const skip = (page - 1) * limit;
  const sortObj: Record<string, 1 | -1> = { [sortBy]: sortOrder };

  const [entities, total] = await Promise.all([
    Entity.find(query)
      .populate('entityType', 'code label')
      .populate('owner', 'firstName lastName email fullName')
      .populate('industry', 'code label')
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean(),
    Entity.countDocuments(query),
  ]);

  // Attach location count and compliance count for each entity
  const entityIds = entities.map((e) => e._id);
  const [locationCounts, complianceCounts] = await Promise.all([
    Location.aggregate([
      { $match: { entity: { $in: entityIds } } },
      { $group: { _id: '$entity', count: { $sum: 1 } } },
    ]),
    ComplianceRecord.aggregate([
      { $match: { entity: { $in: entityIds } } },
      { $group: { _id: '$entity', count: { $sum: 1 } } },
    ]),
  ]);

  const locCountMap: Record<string, number> = {};
  locationCounts.forEach((c) => {
    locCountMap[c._id.toString()] = c.count;
  });

  const compCountMap: Record<string, number> = {};
  complianceCounts.forEach((c) => {
    compCountMap[c._id.toString()] = c.count;
  });

  const enrichedEntities = entities.map((ent) => ({
    ...ent,
    entityCode: ent.code,
    locationCount: locCountMap[ent._id.toString()] || 0,
    complianceCount: compCountMap[ent._id.toString()] || 0,
  }));

  return ApiResponse.success(res, {
    entities: enrichedEntities,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── 2. Get Single Entity Details with Relationships ───────────────────────────
export const getEntityById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // RBAC Scoping check
  if (!isGlobalAdmin(req)) {
    const userEntityId = req.user?.entity
      ? (req.user.entity as any)._id?.toString() || req.user.entity.toString()
      : req.auth?.entityId;

    if (userEntityId !== id) {
      throw ApiError.forbidden('You are not authorized to view this entity.');
    }
  }

  const entity = await Entity.findById(id)
    .populate('entityType', 'code label description')
    .populate('owner', 'firstName lastName email fullName phone')
    .populate('parentEntity', 'name code')
    .populate('industry', 'code label')
    .populate('createdBy', 'firstName lastName email')
    .populate('updatedBy', 'firstName lastName email');

  if (!entity) {
    throw ApiError.notFound(`Entity with ID '${id}' not found`);
  }

  // Gather relationship summaries for the Details tabs:
  // 1. Locations
  const locations = await Location.find({ entity: id })
    .populate('locationType', 'code label')
    .populate('manager', 'firstName lastName email phone')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  // 2. Compliance summary stats
  const [compRecords, compStatsAgg] = await Promise.all([
    ComplianceRecord.find({ entity: id })
      .populate('complianceRule', 'name code category frequency')
      .populate('location', 'name code')
      .sort({ createdAt: -1 })
      .limit(15)
      .lean(),
    ComplianceRecord.aggregate([
      { $match: { entity: entity._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const complianceStats = {
    total: 0,
    approved: 0,
    pending: 0,
    expired: 0,
    rejected: 0,
  };

  compStatsAgg.forEach((stat) => {
    complianceStats.total += stat.count;
    if (stat._id === 'approved') complianceStats.approved = stat.count;
    else if (stat._id === 'pending') complianceStats.pending = stat.count;
    else if (stat._id === 'expired') complianceStats.expired = stat.count;
    else if (stat._id === 'rejected') complianceStats.rejected = stat.count;
  });

  // 3. Documents
  const documents = await CmsDocument.find({ entity: id })
    .populate('documentType', 'code label')
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  // 4. Tasks
  const tasks = await Task.find({ entity: id })
    .populate('assignedTo', 'firstName lastName email')
    .populate('location', 'name code')
    .sort({ dueDate: 1 })
    .limit(15)
    .lean();

  // 5. Recent Audit Trail events
  const auditLogs = await AuditLog.find({ entity: id })
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  return ApiResponse.success(res, {
    entity,
    locations,
    complianceStats,
    complianceRecords: compRecords,
    documents,
    tasks,
    auditLogs,
  });
});

// ── 3. Create Entity ──────────────────────────────────────────────────────────
export const createEntity = asyncHandler(async (req: Request, res: Response) => {
  // Only global administrators can create entities
  if (!isGlobalAdmin(req)) {
    throw ApiError.forbidden('Only administrators are authorized to create new entities.');
  }

  const {
    name,
    code,
    entityCode,
    entityType,
    owner,
    registrationNumber,
    gstin,
    pan,
    cin,
    address,
    contactEmail,
    contactPhone,
    contactPerson,
    description,
    status,
  } = req.body;

  const resolvedCode = (code || entityCode || '').toUpperCase().trim();

  // Check code uniqueness
  const existing = await Entity.findOne({ code: resolvedCode });
  if (existing) {
    throw ApiError.conflict(`An entity with code '${resolvedCode}' already exists.`);
  }

  // Validate entityType exists in MasterData
  const typeDoc = await MasterData.findById(entityType);
  if (!typeDoc) {
    throw ApiError.badRequest('Invalid entity type selected. Must reference valid Master Data.');
  }

  // Validate owner if provided
  if (owner) {
    const ownerDoc = await User.findById(owner);
    if (!ownerDoc) {
      throw ApiError.badRequest('Referenced owner user does not exist.');
    }
  }

  const entity = await Entity.create({
    name: name.trim(),
    code: resolvedCode,
    entityType,
    owner: owner || null,
    registrationNumber: registrationNumber?.trim() || '',
    gstin: gstin ? gstin.toUpperCase().trim() : undefined,
    pan: pan ? pan.toUpperCase().trim() : undefined,
    cin: cin ? cin.toUpperCase().trim() : undefined,
    address,
    contactEmail: contactEmail.toLowerCase().trim(),
    contactPhone: contactPhone.trim(),
    contactPerson: contactPerson?.trim() || undefined,
    description: description?.trim() || '',
    status: status || 'active',
    createdBy: req.user?._id,
  });

  const populated = await Entity.findById(entity._id)
    .populate('entityType', 'code label')
    .populate('owner', 'firstName lastName email');

  await logAuditEvent({
    req,
    action: 'create',
    resource: 'Entity',
    resourceId: entity._id,
    entity: entity._id,
    newValue: { name: entity.name, code: entity.code, status: entity.status },
    description: `Created entity '${entity.name}' (${entity.code})`,
  });

  return ApiResponse.created(res, { entity: populated }, 'Entity created successfully');
});

// ── 4. Update Entity ──────────────────────────────────────────────────────────
export const updateEntity = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // RBAC Scoping check
  if (!isGlobalAdmin(req)) {
    const userEntityId = req.user?.entity
      ? (req.user.entity as any)._id?.toString() || req.user.entity.toString()
      : req.auth?.entityId;

    if (userEntityId !== id) {
      throw ApiError.forbidden('You are not authorized to edit this entity.');
    }
  }

  const entity = await Entity.findById(id);
  if (!entity) {
    throw ApiError.notFound(`Entity with ID '${id}' not found`);
  }

  const previousState = {
    name: entity.name,
    code: entity.code,
    status: entity.status,
    contactEmail: entity.contactEmail,
    address: entity.address,
  };

  const {
    name,
    code,
    entityCode,
    entityType,
    owner,
    registrationNumber,
    gstin,
    pan,
    cin,
    address,
    contactEmail,
    contactPhone,
    contactPerson,
    description,
    status,
  } = req.body;

  // Code update uniqueness check if changing
  const resolvedCode = (code || entityCode)?.toUpperCase()?.trim();
  if (resolvedCode && resolvedCode !== entity.code) {
    const existing = await Entity.findOne({ code: resolvedCode });
    if (existing) {
      throw ApiError.conflict(`An entity with code '${resolvedCode}' already exists.`);
    }
    entity.code = resolvedCode;
  }

  if (name) entity.name = name.trim();
  if (entityType) {
    const typeDoc = await MasterData.findById(entityType);
    if (!typeDoc) {
      throw ApiError.badRequest('Invalid entity type selected.');
    }
    entity.entityType = entityType;
  }
  if (owner !== undefined) entity.owner = owner || undefined;
  if (registrationNumber !== undefined) entity.registrationNumber = registrationNumber.trim();
  if (gstin !== undefined) entity.gstin = gstin ? gstin.toUpperCase().trim() : undefined;
  if (pan !== undefined) entity.pan = pan ? pan.toUpperCase().trim() : undefined;
  if (cin !== undefined) entity.cin = cin ? cin.toUpperCase().trim() : undefined;
  if (address) entity.address = { ...entity.address, ...address };
  if (contactEmail) entity.contactEmail = contactEmail.toLowerCase().trim();
  if (contactPhone) entity.contactPhone = contactPhone.trim();
  if (contactPerson !== undefined) entity.contactPerson = contactPerson.trim();
  if (description !== undefined) entity.description = description.trim();
  if (status) entity.status = status;

  entity.updatedBy = req.user?._id;
  await entity.save();

  const populated = await Entity.findById(id)
    .populate('entityType', 'code label')
    .populate('owner', 'firstName lastName email');

  await logAuditEvent({
    req,
    action: 'update',
    resource: 'Entity',
    resourceId: entity._id,
    entity: entity._id,
    previousValue: previousState,
    newValue: { name: entity.name, status: entity.status, code: entity.code },
    description: `Updated entity profile for '${entity.name}' (${entity.code})`,
  });

  return ApiResponse.success(res, { entity: populated }, 'Entity updated successfully');
});

// ── 5. Delete Entity ──────────────────────────────────────────────────────────
export const deleteEntity = asyncHandler(async (req: Request, res: Response) => {
  // Only global administrators can delete entities
  if (!isGlobalAdmin(req)) {
    throw ApiError.forbidden('Only administrators are authorized to delete entities.');
  }

  const { id } = req.params;

  const entity = await Entity.findById(id);
  if (!entity) {
    throw ApiError.notFound(`Entity with ID '${id}' not found`);
  }

  // Safety check: Prevent deleting entity with active locations
  const locationCount = await Location.countDocuments({ entity: id });
  if (locationCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete entity '${entity.name}'. It contains ${locationCount} associated location(s). Remove or reassign locations first.`
    );
  }

  await Entity.findByIdAndDelete(id);

  await logAuditEvent({
    req,
    action: 'delete',
    resource: 'Entity',
    resourceId: entity._id,
    entity: entity._id,
    previousValue: { name: entity.name, code: entity.code },
    description: `Deleted entity '${entity.name}' (${entity.code})`,
  });

  return ApiResponse.success(res, null, `Entity '${entity.name}' deleted successfully`);
});
