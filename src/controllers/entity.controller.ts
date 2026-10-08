/**
 * Entity Controller
 *
 * Full CRUD, search, filter, pagination, sorting, relationship aggregation, and RBAC scoping.
 *
 * Who may do what:
 *   - Super Admin & Admin: create and edit any entity
 *   - Super Admin: delete
 *   - Entity Admin: edit their own entity's contact details, address and description only
 */

import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import Entity, { IEntity } from '../models/Entity.js';
import MasterData from '../models/MasterData.js';
import User from '../models/User.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import CmsDocument from '../models/Document.js';
import Licence from '../models/Licence.js';
import Task from '../models/Task.js';
import AuditLog from '../models/AuditLog.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditService } from '../services/audit.service.js';
import { getAccessScope } from '../utils/accessScope.js';
import { expiredRecordCondition, summariseHealth } from '../utils/complianceHealth.js';
import { entityQuerySchema } from '../validations/entity.validation.js';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactMatch = (value: string): RegExp => new RegExp(`^${escapeRegex(value.trim())}$`, 'i');

const idOf = (value: unknown): string | null => {
  if (!value) return null;
  return ((value as { _id?: unknown })._id ?? value).toString();
};

/** Fields an Entity Admin may change on their own entity */
const SELF_SERVICE_FIELDS = ['contactPerson', 'contactEmail', 'contactPhone', 'address', 'description'];

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  code: 'code',
  entityType: 'entity type',
  owner: 'owner',
  registrationNumber: 'registration number',
  gstin: 'GSTIN',
  pan: 'PAN',
  cin: 'CIN',
  industry: 'industry',
  parentEntity: 'parent entity',
  status: 'status',
};

const resolveEntityType = async (id: string): Promise<Types.ObjectId> => {
  const type = await MasterData.findOne({ _id: id, category: 'entity_type', status: 'active' }).select('_id');
  if (!type) throw ApiError.badRequest('Entity type must be an active Entity Type from Master Data.');
  return type._id as Types.ObjectId;
};

const resolveIndustry = async (id: string): Promise<Types.ObjectId> => {
  const industry = await MasterData.findOne({ _id: id, category: 'industry' }).select('_id');
  if (!industry) throw ApiError.badRequest('Industry not found in Master Data.');
  return industry._id as Types.ObjectId;
};

/** The owner must be an active user who belongs to this entity or to no entity */
const resolveOwner = async (ownerId: string, entityId?: string): Promise<Types.ObjectId> => {
  const user = await User.findOne({ _id: ownerId, status: 'active' }).select('entity');
  if (!user) throw ApiError.badRequest('Owner must be an active user.');
  if (user.entity && user.entity.toString() !== entityId) {
    throw ApiError.badRequest('Owner belongs to a different entity.');
  }
  return user._id as Types.ObjectId;
};

/** A parent must exist and must not create a loop */
const resolveParentEntity = async (parentId: string, entityId?: string): Promise<Types.ObjectId> => {
  if (parentId === entityId) throw ApiError.badRequest('An entity cannot be its own parent.');

  const parent = await Entity.findById(parentId).select('parentEntity');
  if (!parent) throw ApiError.badRequest('Parent entity not found.');

  let ancestorId = idOf(parent.parentEntity);
  for (let depth = 0; ancestorId && depth < 20; depth++) {
    if (ancestorId === entityId) {
      throw ApiError.badRequest('That parent is already a subsidiary of this entity.');
    }
    const ancestor = await Entity.findById(ancestorId).select('parentEntity');
    ancestorId = idOf(ancestor?.parentEntity);
  }

  return parent._id as Types.ObjectId;
};

/** Statutory identifiers belong to one legal entity only */
const assertUniqueIdentifiers = async (
  identifiers: { gstin?: string; pan?: string; cin?: string },
  excludeId?: Types.ObjectId
): Promise<void> => {
  for (const [field, label] of [
    ['gstin', 'GSTIN'],
    ['pan', 'PAN'],
    ['cin', 'CIN'],
  ] as const) {
    const value = identifiers[field];
    if (!value) continue;
    const clash = await Entity.findOne({ [field]: value, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('name');
    if (clash) throw ApiError.conflict(`${label} ${value} is already registered to '${clash.name}'.`);
  }
};

/** Builds a short unique code from the entity name, e.g. "Apex Care Pvt Ltd" → "ACPL" */
const generateEntityCode = async (name: string): Promise<string> => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join('');
  const base = (initials.length >= 2 ? initials : (words[0] || 'ENT').slice(0, 4)).slice(0, 8);

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (!(await Entity.exists({ code: candidate }))) return candidate;
  }
  return `ENT-${Date.now().toString().slice(-6)}`;
};

const auditSnapshot = (entity: IEntity) => ({
  name: entity.name,
  code: entity.code,
  status: entity.status,
  entityType: idOf(entity.entityType),
  owner: idOf(entity.owner),
  industry: idOf(entity.industry),
  parentEntity: idOf(entity.parentEntity),
  registrationNumber: entity.registrationNumber,
  gstin: entity.gstin,
  pan: entity.pan,
  cin: entity.cin,
  contactPerson: entity.contactPerson,
  contactEmail: entity.contactEmail,
  contactPhone: entity.contactPhone,
  description: entity.description,
  address: { ...((entity.address as any)?.toObject?.() ?? entity.address) },
});

// ── 1. Get Paginated Entities with Search, Filter & Sorting ───────────────────
export const getEntities = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search, entityType, status, state, district, city, attention, sortBy, sortOrder } =
    entityQuerySchema.parse(req.query);

  // RBAC scoping: users tied to an entity only ever see that entity
  const scope = getAccessScope(req);
  const conditions: Record<string, any>[] = [];
  if (!scope.unrestricted) {
    if (!scope.entityId) {
      return ApiResponse.success(res, {
        entities: [],
        pagination: { total: 0, activeCount: 0, inactiveCount: 0, attentionCount: 0, totalLocations: 0, page, limit, totalPages: 0 },
      });
    }
    conditions.push({ _id: new Types.ObjectId(scope.entityId) });
  }

  if (search) {
    const searchRegex = new RegExp(escapeRegex(search), 'i');
    conditions.push({
      $or: [
        { name: searchRegex },
        { code: searchRegex },
        { 'address.city': searchRegex },
        { 'address.state': searchRegex },
        { contactEmail: searchRegex },
        { contactPhone: searchRegex },
      ],
    });
  }

  if (entityType) conditions.push({ entityType: new Types.ObjectId(entityType) });
  if (status) conditions.push({ status });
  if (state) conditions.push({ 'address.state': exactMatch(state) });
  if (district) conditions.push({ 'address.district': exactMatch(district) });
  if (city) conditions.push({ 'address.city': exactMatch(city) });

  // Entities with at least one expired compliance record need attention.
  // The count ignores the attention filter itself so the card stays meaningful.
  const baseIds = await Entity.find(conditions.length > 0 ? { $and: conditions } : {}).distinct('_id');
  const attentionIds = await ComplianceRecord.distinct('entity', {
    $and: [{ entity: { $in: baseIds } }, expiredRecordCondition()],
  });
  if (attention === 'true') {
    conditions.push({ _id: { $in: attentionIds } });
  }

  const query = conditions.length > 0 ? { $and: conditions } : {};

  const [entities, total, activeCount, inactiveCount, matchingIds] = await Promise.all([
    Entity.find(query)
      .populate('entityType', 'code label')
      .populate('owner', 'firstName lastName email')
      .populate('industry', 'code label')
      .populate('parentEntity', 'name code')
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Entity.countDocuments(query),
    Entity.countDocuments({ $and: [...conditions, { status: 'active' }] }),
    Entity.countDocuments({ $and: [...conditions, { status: 'inactive' }] }),
    Entity.find(query).distinct('_id'),
  ]);

  const entityIds = entities.map((e) => e._id);
  const [totalLocations, locationCounts, complianceCounts, healthRecords] = await Promise.all([
    Location.countDocuments({ $or: [{ entity: { $in: matchingIds } }, { 'coEntities.entity': { $in: matchingIds } }] }),
    // A shared unit counts for its owner and for every other company operating there
    Location.aggregate([
      { $match: { $or: [{ entity: { $in: entityIds } }, { 'coEntities.entity': { $in: entityIds } }] } },
      { $project: { operator: { $concatArrays: [['$entity'], { $ifNull: ['$coEntities.entity', []] }] } } },
      { $unwind: '$operator' },
      { $match: { operator: { $in: entityIds } } },
      { $group: { _id: '$operator', count: { $sum: 1 } } },
    ]),
    ComplianceRecord.aggregate([
      { $match: { entity: { $in: entityIds } } },
      { $group: { _id: '$entity', count: { $sum: 1 } } },
    ]),
    ComplianceRecord.find({ entity: { $in: entityIds }, status: { $ne: 'not_applicable' } })
      .select('entity status expiryDate')
      .lean(),
  ]);

  const recordsByEntity = new Map<string, Array<{ status: string; expiryDate?: Date | null }>>();
  for (const record of healthRecords) {
    const key = String(record.entity);
    if (!recordsByEntity.has(key)) recordsByEntity.set(key, []);
    recordsByEntity.get(key)!.push(record);
  }

  const locCountMap = new Map<string, number>(locationCounts.map((c) => [c._id.toString(), c.count]));
  const compCountMap = new Map<string, number>(complianceCounts.map((c) => [c._id.toString(), c.count]));

  return ApiResponse.success(res, {
    entities: entities.map((ent) => ({
      ...ent,
      entityCode: ent.code,
      locationCount: locCountMap.get(ent._id.toString()) || 0,
      complianceCount: compCountMap.get(ent._id.toString()) || 0,
      health: summariseHealth(recordsByEntity.get(ent._id.toString()) || []),
    })),
    pagination: {
      total,
      activeCount,
      inactiveCount,
      attentionCount: attentionIds.length,
      totalLocations,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── 2. Get Single Entity Details with Relationships ───────────────────────────
export const getEntityById = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid entity ID format');
  }

  const scope = getAccessScope(req);
  if (!scope.unrestricted && scope.entityId !== id) {
    throw ApiError.forbidden('You are not authorized to view this entity.');
  }

  const entity = await Entity.findById(id)
    .populate('entityType', 'code label description')
    .populate('owner', 'firstName lastName email phone')
    .populate('parentEntity', 'name code')
    .populate('industry', 'code label')
    .populate('createdBy', 'firstName lastName email')
    .populate('updatedBy', 'firstName lastName email');

  if (!entity) {
    throw ApiError.notFound(`Entity with ID '${id}' not found`);
  }

  const entityId = entity._id;

  // Units the entity owns, plus shared units it operates at
  const locationFilter = { $or: [{ entity: entityId }, { 'coEntities.entity': entityId }] };

  const [locations, locationCount, compRecords, statusGroups, healthRecords, documents, tasks, auditLogs] = await Promise.all([
    Location.find(locationFilter)
      .populate('locationType', 'code label')
      .populate('manager', 'firstName lastName email phone')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    // The list above is capped; this is the real number
    Location.countDocuments(locationFilter),
    ComplianceRecord.find({ entity: entityId })
      .select('recordNumber status dueDate expiryDate rule location createdAt')
      .populate({
        path: 'rule',
        select: 'name code category priority',
        populate: { path: 'category', select: 'code label' },
      })
      .populate('location', 'name code')
      .sort({ createdAt: -1 })
      .limit(15)
      .lean(),
    ComplianceRecord.aggregate<{ _id: string; count: number }>([
      { $match: { entity: entityId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ComplianceRecord.find({ entity: entityId, status: { $ne: 'not_applicable' } })
      .select('status expiryDate')
      .lean(),
    CmsDocument.find({ entity: entityId, status: 'active' })
      .populate('documentType', 'code label')
      .sort({ createdAt: -1 })
      .limit(15)
      .lean(),
    Task.find({ entity: entityId })
      .populate('assignedTo', 'firstName lastName email')
      .populate('location', 'name code')
      .sort({ dueDate: 1 })
      .limit(15)
      .lean(),
    // recordId is stored as a string by some writers and as an ObjectId by others
    AuditLog.find({ entityType: 'Entity', recordId: { $in: [id, entityId] } })
      .sort({ timestamp: -1 })
      .limit(15)
      .lean(),
  ]);

  // approved = currently valid, pending = anywhere in the workflow
  const complianceStats = { total: 0, approved: 0, pending: 0, expired: 0, rejected: 0 };
  for (const group of statusGroups) {
    complianceStats.total += group.count;
    if (group._id === 'approved' || group._id === 'expiring_soon') complianceStats.approved += group.count;
    else if (group._id === 'expired') complianceStats.expired += group.count;
    else if (group._id === 'rejected') complianceStats.rejected += group.count;
    else if (group._id !== 'not_applicable') complianceStats.pending += group.count;
  }

  return ApiResponse.success(res, {
    entity,
    locations,
    locationCount,
    complianceStats,
    health: summariseHealth(healthRecords),
    // `complianceRule` is the name the client reads
    complianceRecords: compRecords.map(({ rule, ...record }) => ({ ...record, complianceRule: rule })),
    documents,
    tasks,
    auditLogs,
  });
});

// ── 3. Create Entity ──────────────────────────────────────────────────────────
export const createEntity = asyncHandler(async (req: Request, res: Response) => {
  if (!getAccessScope(req).unrestricted) {
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
    industry,
    parentEntity,
    description,
    status,
  } = req.body;

  let resolvedCode = (code || entityCode || '').toUpperCase().trim();
  if (resolvedCode) {
    if (await Entity.exists({ code: resolvedCode })) {
      throw ApiError.conflict(`An entity with code '${resolvedCode}' already exists.`);
    }
  } else {
    resolvedCode = await generateEntityCode(name);
  }

  const identifiers = {
    gstin: gstin ? gstin.toUpperCase().trim() : undefined,
    pan: pan ? pan.toUpperCase().trim() : undefined,
    cin: cin ? cin.toUpperCase().trim() : undefined,
  };
  await assertUniqueIdentifiers(identifiers);

  const entity = await Entity.create({
    name: name.trim(),
    code: resolvedCode,
    entityType: await resolveEntityType(entityType),
    owner: owner ? await resolveOwner(owner) : undefined,
    registrationNumber: registrationNumber?.trim() || '',
    ...identifiers,
    address,
    contactEmail: contactEmail.toLowerCase().trim(),
    contactPhone: contactPhone.trim(),
    contactPerson: contactPerson?.trim() || undefined,
    industry: industry ? await resolveIndustry(industry) : undefined,
    parentEntity: parentEntity ? await resolveParentEntity(parentEntity) : undefined,
    description: description?.trim() || '',
    status: status || 'active',
    createdBy: req.auth?.userId,
  });

  const populated = await Entity.findById(entity._id)
    .populate('entityType', 'code label')
    .populate('owner', 'firstName lastName email')
    .populate('parentEntity', 'name code')
    .populate('industry', 'code label');

  await auditService.logEntityCreated(entity, req);

  return ApiResponse.created(res, { entity: populated }, 'Entity created successfully');
});

// ── 4. Update Entity ──────────────────────────────────────────────────────────
export const updateEntity = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid entity ID format');
  }

  const scope = getAccessScope(req);
  if (!scope.unrestricted && scope.entityId !== id) {
    throw ApiError.forbidden('You are not authorized to edit this entity.');
  }

  const entity = await Entity.findById(id);
  if (!entity) {
    throw ApiError.notFound(`Entity with ID '${id}' not found`);
  }

  const previousValue = auditSnapshot(entity);

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
    industry,
    parentEntity,
    description,
    status,
  } = req.body;

  const resolvedCode = (code || entityCode)?.toUpperCase()?.trim();
  if (resolvedCode && resolvedCode !== entity.code) {
    if (await Entity.exists({ code: resolvedCode, _id: { $ne: entity._id } })) {
      throw ApiError.conflict(`An entity with code '${resolvedCode}' already exists.`);
    }
    entity.code = resolvedCode;
  }

  if (name) entity.name = name.trim();
  if (entityType && entityType !== idOf(entity.entityType)) {
    entity.entityType = await resolveEntityType(entityType);
  }
  if (owner !== undefined && (owner || '') !== (idOf(entity.owner) || '')) {
    entity.owner = owner ? await resolveOwner(owner, id) : undefined;
  }
  if (registrationNumber !== undefined) entity.registrationNumber = registrationNumber.trim();
  if (gstin !== undefined) entity.gstin = gstin ? gstin.toUpperCase().trim() : undefined;
  if (pan !== undefined) entity.pan = pan ? pan.toUpperCase().trim() : undefined;
  if (cin !== undefined) entity.cin = cin ? cin.toUpperCase().trim() : undefined;
  if (industry !== undefined && (industry || '') !== (idOf(entity.industry) || '')) {
    entity.industry = industry ? await resolveIndustry(industry) : undefined;
  }
  if (parentEntity !== undefined && (parentEntity || '') !== (idOf(entity.parentEntity) || '')) {
    entity.parentEntity = parentEntity ? await resolveParentEntity(parentEntity, id) : undefined;
  }
  if (status) entity.status = status;

  if (address) {
    entity.address = {
      line1: address.line1.trim(),
      line2: address.line2?.trim() || '',
      city: address.city.trim(),
      district: address.district?.trim() || '',
      state: address.state.trim(),
      pincode: address.pincode?.trim() || '',
      country: address.country?.trim() || entity.address.country || 'India',
    };
  }
  if (contactEmail) entity.contactEmail = contactEmail.toLowerCase().trim();
  if (contactPhone) entity.contactPhone = contactPhone.trim();
  if (contactPerson !== undefined) entity.contactPerson = contactPerson.trim();
  if (description !== undefined) entity.description = description.trim();

  // Work out what actually changed; that drives both the permission check and the audit entry
  const currentValue = auditSnapshot(entity);
  const changedFields = (Object.keys(currentValue) as Array<keyof typeof currentValue>).filter(
    (key) => JSON.stringify(previousValue[key] ?? '') !== JSON.stringify(currentValue[key] ?? '')
  );

  if (!scope.unrestricted) {
    const restricted = changedFields.filter((field) => !SELF_SERVICE_FIELDS.includes(field));
    if (restricted.length > 0) {
      throw ApiError.forbidden(
        `Only administrators can change an entity's ${restricted.map((f) => FIELD_LABELS[f] || f).join(', ')}.`
      );
    }
  }

  if (changedFields.some((field) => ['gstin', 'pan', 'cin'].includes(field))) {
    await assertUniqueIdentifiers({ gstin: entity.gstin, pan: entity.pan, cin: entity.cin }, entity._id);
  }

  entity.updatedBy = req.auth?.userId as any;
  await entity.save();

  const populated = await Entity.findById(id)
    .populate('entityType', 'code label')
    .populate('owner', 'firstName lastName email')
    .populate('parentEntity', 'name code')
    .populate('industry', 'code label');

  if (changedFields.length > 0) {
    const pick = (source: typeof currentValue) =>
      Object.fromEntries(changedFields.map((field) => [field, source[field]]));
    await auditService.logMutation({
      req,
      action: 'ENTITY_UPDATED',
      module: 'entities',
      entityType: 'Entity',
      recordId: entity._id,
      entityId: entity._id,
      previousValue: pick(previousValue),
      newValue: pick(currentValue),
      description: `Updated entity '${entity.name}' (${changedFields.join(', ')})`,
    });
  }

  return ApiResponse.success(res, { entity: populated }, 'Entity updated successfully');
});

// ── 5. Delete Entity ──────────────────────────────────────────────────────────
export const deleteEntity = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid entity ID format');
  }

  const entity = await Entity.findById(id);
  if (!entity) {
    throw ApiError.notFound(`Entity with ID '${id}' not found`);
  }

  // An entity can only be deleted once nothing depends on it
  const [locations, users, subsidiaries, records, tasks, documents, licences] = await Promise.all([
    Location.countDocuments({ entity: id }),
    User.countDocuments({ entity: id }),
    Entity.countDocuments({ parentEntity: id }),
    ComplianceRecord.countDocuments({ entity: id }),
    Task.countDocuments({ entity: id }),
    CmsDocument.countDocuments({ entity: id, status: 'active' }),
    Licence.countDocuments({ entity: id }),
  ]);

  const blockers = [
    locations && `${locations} location(s)`,
    users && `${users} user(s)`,
    subsidiaries && `${subsidiaries} subsidiary entity(ies)`,
    records && `${records} compliance record(s)`,
    tasks && `${tasks} task(s)`,
    documents && `${documents} document(s)`,
    licences && `${licences} licence(s)`,
  ].filter(Boolean);

  if (blockers.length > 0) {
    throw ApiError.badRequest(
      `Cannot delete '${entity.name}' because it still has ${blockers.join(', ')}. Remove or reassign them first, or set the entity to inactive.`
    );
  }

  await Entity.findByIdAndDelete(id);

  await auditService.logEntityDeleted(entity, req);

  return ApiResponse.success(res, null, `Entity '${entity.name}' deleted successfully`);
});
