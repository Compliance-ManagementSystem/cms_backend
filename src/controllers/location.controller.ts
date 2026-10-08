/**
 * Location Controller
 *
 * Full CRUD, search, filter, pagination, sorting, relationship aggregation, and RBAC scoping.
 */

import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import Location, { ILocation } from '../models/Location.js';
import Entity from '../models/Entity.js';
import MasterData from '../models/MasterData.js';
import User from '../models/User.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import CmsDocument from '../models/Document.js';
import Licence from '../models/Licence.js';
import Task from '../models/Task.js';
import AuditLog from '../models/AuditLog.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditService } from '../services/audit.service.js';
import { AccessScope, getAccessScope, toLocationScopeFilter } from '../utils/accessScope.js';
import { locationQuerySchema } from '../validations/location.validation.js';
import { expiredRecordCondition, summariseHealth } from '../utils/complianceHealth.js';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactMatch = (value: string): RegExp => new RegExp(`^${escapeRegex(value.trim())}$`, 'i');

const idOf = (value: unknown): string | null => {
  if (!value) return null;
  return ((value as { _id?: unknown })._id ?? value).toString();
};

/** Can the caller see this location at all? */
const canViewLocation = (
  scope: AccessScope,
  location: { _id: unknown; entity?: unknown; coEntities?: { entity?: unknown }[] }
): boolean => {
  if (scope.unrestricted) return true;
  if (scope.entityId) {
    const entityIds = [location.entity, ...(location.coEntities || []).map((co) => co.entity)].map(idOf);
    if (!entityIds.includes(scope.entityId)) return false;
  }
  if (scope.locationIds && !scope.locationIds.includes(idOf(location._id)!)) return false;
  return true;
};

/**
 * Managing locations (create / edit / delete) is for callers whose scope covers a
 * whole entity. Someone limited to specific locations cannot restructure them.
 */
const canManageEntity = (scope: AccessScope, entityId: string | null): boolean =>
  scope.unrestricted || (!scope.locationIds && !!scope.entityId && scope.entityId === entityId);

const resolveLocationType = async (typeInput: string): Promise<Types.ObjectId> => {
  const filter = mongoose.Types.ObjectId.isValid(typeInput)
    ? { _id: typeInput, category: 'location_type' }
    : { category: 'location_type', code: typeInput.toUpperCase() };

  const masterDoc = await MasterData.findOne(filter).select('_id');
  if (!masterDoc) {
    throw ApiError.badRequest(`Location type "${typeInput}" not found in Master Data`);
  }
  return masterDoc._id as Types.ObjectId;
};

/** The manager must be an active user who belongs to the location's entity or to no entity */
const resolveManager = async (managerId: string, entityId: string): Promise<Types.ObjectId> => {
  const user = await User.findOne({ _id: managerId, status: 'active' }).select('entity');
  if (!user) {
    throw ApiError.badRequest('Unit manager must be an active user');
  }
  if (user.entity && user.entity.toString() !== entityId) {
    throw ApiError.badRequest('Unit manager belongs to a different entity');
  }
  return user._id as Types.ObjectId;
};

/**
 * A location's manager is also assigned to it in their user profile, which is what
 * limits a Location Manager's access. Keep the two in step.
 */
const syncManagerAssignment = async (
  locationId: Types.ObjectId,
  previousManager: unknown,
  nextManager: unknown
): Promise<void> => {
  const previousId = idOf(previousManager);
  const nextId = idOf(nextManager);
  if (previousId === nextId) return;

  if (previousId) {
    await User.updateOne({ _id: previousId }, { $pull: { assignedLocations: locationId } });
  }
  if (nextId) {
    await User.updateOne({ _id: nextId }, { $addToSet: { assignedLocations: locationId } });
  }
};

/** A parent must exist in the same entity and must not create a loop */
const resolveParentLocation = async (
  parentId: string,
  entityId: string,
  locationId?: string
): Promise<Types.ObjectId> => {
  if (parentId === locationId) {
    throw ApiError.badRequest('A location cannot be its own parent');
  }

  const parent = await Location.findById(parentId).select('entity parentLocation');
  if (!parent) throw ApiError.badRequest('Parent location not found');
  if (String(parent.entity) !== entityId) {
    throw ApiError.badRequest('Parent location must belong to the same entity');
  }

  // Walk up the chain: the location being saved must not already be an ancestor
  let ancestorId = idOf(parent.parentLocation);
  for (let depth = 0; ancestorId && depth < 20; depth++) {
    if (ancestorId === locationId) {
      throw ApiError.badRequest('That parent is already a sub-unit of this location');
    }
    const ancestor = await Location.findById(ancestorId).select('parentLocation');
    ancestorId = idOf(ancestor?.parentLocation);
  }

  return parent._id as Types.ObjectId;
};

const toAgreements = (agreements: any[]) =>
  agreements.map((agr) => ({
    agreementType: agr.agreementType.trim(),
    agreementNumber: agr.agreementNumber.trim(),
    startDate: new Date(agr.startDate),
    endDate: new Date(agr.endDate),
    renewalDate: agr.renewalDate ? new Date(agr.renewalDate) : undefined,
    parties: Array.isArray(agr.parties) ? agr.parties.map((p: string) => p.trim()).filter(Boolean) : [],
    notes: agr.notes ? agr.notes.trim() : undefined,
  }));

// Co-entities must exist, differ from the owner and not repeat
const resolveCoEntities = async (coEntities: any[], ownerEntityId: string) => {
  const ids = [...new Set(coEntities.map((co) => String(co.entity)))];
  if (ids.length !== coEntities.length) {
    throw ApiError.badRequest('The same co-entity is listed more than once');
  }
  if (ids.includes(ownerEntityId)) {
    throw ApiError.badRequest('A co-entity must be different from the owning entity');
  }
  const found = await Entity.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) {
    throw ApiError.badRequest('Co-entity not found');
  }
  return coEntities.map((co) => ({
    entity: new Types.ObjectId(String(co.entity)),
    openingDate: co.openingDate ? new Date(co.openingDate) : undefined,
  }));
};

const auditSnapshot = (location: ILocation) => ({
  name: location.name,
  code: location.code,
  status: location.status,
  areaType: location.areaType,
  operatingModel: location.operatingModel,
  closingDate: location.closingDate,
  isUpcoming: location.isUpcoming,
  entity: idOf(location.entity),
  coEntities: (location.coEntities || []).map((co) => idOf(co.entity)),
  locationType: idOf(location.locationType),
  manager: idOf(location.manager),
  parentLocation: idOf(location.parentLocation),
  address: location.address ? { ...((location.address as any).toObject?.() ?? location.address) } : undefined,
  agreements: location.agreements?.length || 0,
});

// ── 1. Get Paginated Locations with Search, Filter & Sorting ───────────────────
export const getLocations = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search, entity, locationType, status, state, district, city, areaType, attention, opening, sortBy, sortOrder } =
    locationQuerySchema.parse(req.query);

  const emptyPage = () =>
    ApiResponse.success(res, {
      locations: [],
      pagination: {
        total: 0,
        activeCount: 0,
        inactiveCount: 0,
        attentionCount: 0,
        totalCompliance: 0,
        page,
        limit,
        totalPages: 0,
      },
    });

  // RBAC scoping is always applied; explicit filters only narrow it
  const conditions: Record<string, any>[] = [toLocationScopeFilter(getAccessScope(req))];

  // Filter by Entity (id, code or name)
  if (entity) {
    if (mongoose.Types.ObjectId.isValid(entity)) {
      conditions.push({ entity: new Types.ObjectId(entity) });
    } else {
      const entityIds = await Entity.find({
        $or: [{ code: entity.toUpperCase() }, { name: new RegExp(escapeRegex(entity), 'i') }],
      }).distinct('_id');
      conditions.push({ entity: { $in: entityIds } });
    }
  }

  // Filter by Location Type (id or code)
  if (locationType) {
    if (mongoose.Types.ObjectId.isValid(locationType)) {
      conditions.push({ locationType: new Types.ObjectId(locationType) });
    } else {
      const typeDoc = await MasterData.findOne({
        category: 'location_type',
        code: locationType.toUpperCase(),
      }).select('_id');
      if (!typeDoc) return emptyPage();
      conditions.push({ locationType: typeDoc._id });
    }
  }

  if (status) conditions.push({ status });
  if (state) conditions.push({ 'address.state': exactMatch(state) });
  if (district) conditions.push({ 'address.district': exactMatch(district) });
  if (city) conditions.push({ 'address.city': exactMatch(city) });
  if (areaType) conditions.push({ areaType });

  // Same rule the dashboard uses to tell planned units from open ones
  if (opening) {
    const upcoming = [{ openingDate: { $gt: new Date() } }, { isUpcoming: true, openingDate: null }];
    conditions.push(opening === 'upcoming' ? { $or: upcoming } : { $nor: upcoming });
  }

  if (search) {
    const searchRegex = new RegExp(escapeRegex(search), 'i');
    conditions.push({
      $or: [
        { name: searchRegex },
        { code: searchRegex },
        { contactPerson: searchRegex },
        { contactEmail: searchRegex },
        { 'address.city': searchRegex },
        { 'address.state': searchRegex },
      ],
    });
  }

  // Locations with at least one expired compliance record need attention.
  // The count ignores the attention filter itself so the card stays meaningful.
  const baseIds = await Location.find({ $and: conditions }).distinct('_id');
  const attentionIds = await ComplianceRecord.distinct('location', {
    $and: [{ location: { $in: baseIds } }, expiredRecordCondition()],
  });
  if (attention === 'true') {
    conditions.push({ _id: { $in: attentionIds } });
  }

  const query = { $and: conditions };

  const [locations, total, activeCount, matchingIds] = await Promise.all([
    Location.find(query)
      .populate('entity', 'name code status')
      .populate('coEntities.entity', 'name code')
      .populate('locationType', 'code label description')
      .populate('manager', 'firstName lastName email phone')
      .populate('parentLocation', 'name code')
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Location.countDocuments(query),
    Location.countDocuments({ $and: [...conditions, { status: 'active' }] }),
    Location.find(query).distinct('_id'),
  ]);

  const [totalCompliance, pageRecords] = await Promise.all([
    ComplianceRecord.countDocuments({ location: { $in: matchingIds } }),
    ComplianceRecord.find({
      location: { $in: locations.map((l) => l._id) },
      status: { $ne: 'not_applicable' },
    })
      .select('location status expiryDate')
      .lean(),
  ]);

  const recordsByLocation = new Map<string, typeof pageRecords>();
  for (const record of pageRecords) {
    const key = String(record.location);
    if (!recordsByLocation.has(key)) recordsByLocation.set(key, []);
    recordsByLocation.get(key)!.push(record);
  }

  return ApiResponse.success(res, {
    locations: locations.map((loc) => {
      const health = summariseHealth(recordsByLocation.get(loc._id.toString()) || []);
      return {
        ...loc,
        locationCode: loc.code,
        complianceCount: health.total,
        health,
      };
    }),
    pagination: {
      total,
      activeCount,
      inactiveCount: total - activeCount,
      attentionCount: attentionIds.length,
      totalCompliance,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── 2. Get Single Location by ID with Relationship Structures ────────────────
export const getLocationById = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Location ID format');
  }

  const location = await Location.findById(id)
    .populate('entity', 'name code status contactEmail contactPhone address')
    .populate('coEntities.entity', 'name code')
    .populate('locationType', 'code label description')
    .populate('manager', 'firstName lastName email phone role')
    .populate('parentLocation', 'name code locationType')
    .lean();

  if (!location) {
    throw ApiError.notFound(`Location with ID ${id} not found`);
  }

  if (!canViewLocation(getAccessScope(req), location)) {
    throw ApiError.forbidden('You are not authorized to access this location');
  }

  const locationId = new Types.ObjectId(id);

  const [complianceRecords, statusGroups, healthRecords, documents, licences, tasks, auditLogs] = await Promise.all([
    ComplianceRecord.find({ location: locationId })
      .select('recordNumber status dueDate expiryDate rule createdAt')
      .populate({
        path: 'rule',
        select: 'name code category priority',
        populate: { path: 'category', select: 'code label' },
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    // Counted in the database so the totals are not capped by the 50-row list above
    ComplianceRecord.aggregate<{ _id: string; count: number }>([
      { $match: { location: locationId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ComplianceRecord.find({ location: locationId, status: { $ne: 'not_applicable' } })
      .select('status expiryDate')
      .lean(),
    CmsDocument.find({ location: locationId, status: 'active' })
      .populate('documentType', 'code label')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    Licence.find({ location: locationId })
      .populate('licenceType', 'code label')
      .populate('document', 'name fileName currentVersion')
      .sort({ expiryDate: 1 })
      .limit(50)
      .lean(),
    Task.find({ location: locationId })
      .populate('assignedTo', 'firstName lastName email')
      .sort({ dueDate: 1 })
      .limit(50)
      .lean(),
    // recordId is stored as a string by some writers and as an ObjectId by others
    AuditLog.find({ entityType: 'Location', recordId: { $in: [id, locationId] } })
      .sort({ timestamp: -1 })
      .limit(20)
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
    location: {
      ...location,
      locationCode: location.code,
    },
    complianceStats,
    health: summariseHealth(healthRecords),
    // `complianceRule` is the name the client reads
    complianceRecords: complianceRecords.map(({ rule, ...record }) => ({ ...record, complianceRule: rule })),
    documents,
    // A licence past its expiry date is expired, whatever status was last saved
    licences: licences.map((licence) => ({
      ...licence,
      status:
        ['active', 'pending_renewal'].includes(licence.status) && new Date(licence.expiryDate) < new Date()
          ? 'expired'
          : licence.status,
    })),
    tasks,
    auditLogs,
  });
});

// ── 3. Create Location ────────────────────────────────────────────────────────
export const createLocation = asyncHandler(async (req: Request, res: Response) => {
  const {
    name,
    code,
    locationCode,
    entity: entityInput,
    locationType: typeInput,
    address,
    contactPerson,
    contactEmail,
    contactPhone,
    manager,
    openingDate,
    closingDate,
    isUpcoming,
    areaType,
    operatingModel,
    coEntities,
    description,
    area,
    areaUnit,
    operatingHours,
    parentLocation,
    status,
    agreements,
  } = req.body;

  const entityDoc = await Entity.findById(entityInput);
  if (!entityDoc) {
    throw ApiError.notFound('Target business entity not found');
  }
  const entityId = entityDoc._id.toString();

  if (!canManageEntity(getAccessScope(req), entityId)) {
    throw ApiError.forbidden('You cannot create locations for an entity other than your assigned entity');
  }

  const locationTypeId = await resolveLocationType(typeInput);
  const managerId = manager ? await resolveManager(manager, entityId) : undefined;
  const parentId = parentLocation ? await resolveParentLocation(parentLocation, entityId) : undefined;

  // Location code is unique per entity; generate one when not supplied
  let resolvedCode = (code || locationCode)?.trim().toUpperCase();
  if (!resolvedCode) {
    const entityPrefix = entityDoc.code ? entityDoc.code.slice(0, 4) : 'LOC';
    resolvedCode = `${entityPrefix}-U${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const existingCode = await Location.findOne({ entity: entityDoc._id, code: resolvedCode }).select('_id');
  if (existingCode) {
    throw ApiError.conflict(
      `Location code "${resolvedCode}" is already in use under entity "${entityDoc.name}"`
    );
  }

  const newLocation = await Location.create({
    name: name.trim(),
    code: resolvedCode,
    entity: entityDoc._id,
    locationType: locationTypeId,
    address: {
      line1: address.line1.trim(),
      line2: address.line2?.trim() || '',
      city: address.city?.trim() || '',
      district: address.district?.trim() || '',
      state: address.state.trim(),
      pincode: address.pincode?.trim() || '',
      country: address.country?.trim() || 'India',
    },
    contactPerson: contactPerson?.trim() || undefined,
    contactEmail: contactEmail?.trim() || undefined,
    contactPhone: contactPhone?.trim() || undefined,
    manager: managerId,
    openingDate: openingDate ? new Date(openingDate) : undefined,
    closingDate: closingDate ? new Date(closingDate) : undefined,
    isUpcoming: !!isUpcoming && !openingDate,
    areaType: areaType || undefined,
    operatingModel: operatingModel || undefined,
    coEntities: Array.isArray(coEntities) ? await resolveCoEntities(coEntities, entityId) : [],
    description: description?.trim() || undefined,
    area: area !== undefined && area !== null ? area : undefined,
    areaUnit: areaUnit || 'sqft',
    operatingHours: operatingHours?.trim() || undefined,
    parentLocation: parentId,
    agreements: Array.isArray(agreements) ? toAgreements(agreements) : [],
    status: status || 'active',
    createdBy: req.auth?.userId,
    updatedBy: req.auth?.userId,
  });

  await syncManagerAssignment(newLocation._id, null, managerId);

  const populated = await Location.findById(newLocation._id)
    .populate('entity', 'name code')
    .populate('coEntities.entity', 'name code')
    .populate('locationType', 'code label')
    .populate('manager', 'firstName lastName email phone')
    .lean();

  await auditService.logLocationCreated(newLocation, req);

  return ApiResponse.created(res, { location: populated }, 'Location created successfully');
});

// ── 4. Update Location ────────────────────────────────────────────────────────
export const updateLocation = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Location ID format');
  }

  const existingLocation = await Location.findById(id);
  if (!existingLocation) {
    throw ApiError.notFound(`Location with ID ${id} not found`);
  }

  const scope = getAccessScope(req);
  const currentEntityId = String(existingLocation.entity);
  if (!canManageEntity(scope, currentEntityId)) {
    throw ApiError.forbidden('You are not authorized to update this location');
  }

  const previousValue = auditSnapshot(existingLocation);
  const previousManager = existingLocation.manager;

  const {
    name,
    code,
    locationCode,
    entity: entityInput,
    locationType: typeInput,
    address,
    contactPerson,
    contactEmail,
    contactPhone,
    manager,
    openingDate,
    closingDate,
    isUpcoming,
    areaType,
    operatingModel,
    coEntities,
    description,
    area,
    areaUnit,
    operatingHours,
    parentLocation,
    status,
    agreements,
  } = req.body;

  // Moving to another entity: administrators only, and only while nothing hangs off the location
  let targetEntityId = currentEntityId;
  if (entityInput && entityInput !== currentEntityId) {
    if (!scope.unrestricted) {
      throw ApiError.forbidden('Only administrators can reassign a location to a different entity');
    }
    const targetEntity = await Entity.findById(entityInput).select('_id');
    if (!targetEntity) {
      throw ApiError.notFound('Target business entity not found');
    }

    const [records, tasks, documents, licences, children] = await Promise.all([
      ComplianceRecord.countDocuments({ location: id }),
      Task.countDocuments({ location: id }),
      CmsDocument.countDocuments({ location: id }),
      Licence.countDocuments({ location: id }),
      Location.countDocuments({ parentLocation: id }),
    ]);
    if (records + tasks + documents + licences + children > 0) {
      throw ApiError.badRequest(
        'This location has compliance records, tasks, documents, licences or sub-units under its current entity, so it cannot be moved to another entity.'
      );
    }

    targetEntityId = targetEntity._id.toString();
    existingLocation.entity = targetEntity._id;
  }

  // Code must stay unique within the (possibly new) entity
  const resolvedCode = (code || locationCode)?.trim().toUpperCase() || existingLocation.code;
  if (resolvedCode !== existingLocation.code || targetEntityId !== currentEntityId) {
    const codeConflict = await Location.findOne({
      _id: { $ne: existingLocation._id },
      entity: targetEntityId,
      code: resolvedCode,
    }).select('_id');
    if (codeConflict) {
      throw ApiError.conflict(`Location code "${resolvedCode}" is already in use under this entity`);
    }
    existingLocation.code = resolvedCode;
  }

  if (typeInput) {
    existingLocation.locationType = await resolveLocationType(typeInput);
  }

  if (manager !== undefined) {
    existingLocation.manager = manager ? await resolveManager(manager, targetEntityId) : undefined;
  }

  if (parentLocation !== undefined) {
    existingLocation.parentLocation = parentLocation
      ? await resolveParentLocation(parentLocation, targetEntityId, id)
      : undefined;
  }

  if (name) existingLocation.name = name.trim();
  if (status) existingLocation.status = status;
  if (openingDate !== undefined) {
    existingLocation.openingDate = openingDate ? new Date(openingDate) : undefined;
  }
  // The "to be opened" mark only stands while no opening date is set
  if (isUpcoming !== undefined) existingLocation.isUpcoming = isUpcoming;
  if (existingLocation.openingDate) existingLocation.isUpcoming = false;
  if (closingDate !== undefined) {
    existingLocation.closingDate = closingDate ? new Date(closingDate) : undefined;
  }
  if (areaType !== undefined) existingLocation.areaType = areaType || undefined;
  if (operatingModel !== undefined) existingLocation.operatingModel = operatingModel || undefined;
  if (Array.isArray(coEntities)) {
    existingLocation.coEntities = await resolveCoEntities(coEntities, targetEntityId);
  } else if (
    targetEntityId !== currentEntityId &&
    existingLocation.coEntities.some((co) => String(co.entity) === targetEntityId)
  ) {
    throw ApiError.badRequest('The new owning entity is already a co-entity of this location');
  }
  if (description !== undefined) existingLocation.description = description?.trim() || '';
  if (area !== undefined) existingLocation.area = area !== null ? area : undefined;
  if (areaUnit !== undefined) existingLocation.areaUnit = areaUnit;
  if (operatingHours !== undefined) existingLocation.operatingHours = operatingHours?.trim() || '';
  if (contactPerson !== undefined) existingLocation.contactPerson = contactPerson?.trim() || '';
  if (contactEmail !== undefined) existingLocation.contactEmail = contactEmail?.trim() || '';
  if (contactPhone !== undefined) existingLocation.contactPhone = contactPhone?.trim() || '';

  // Agreements are replaced as a whole
  if (Array.isArray(agreements)) {
    existingLocation.agreements = toAgreements(agreements);
  }

  if (address) {
    existingLocation.address = {
      line1: address.line1.trim(),
      line2: address.line2?.trim() || '',
      city: address.city?.trim() || '',
      district: address.district?.trim() || '',
      state: address.state.trim(),
      pincode: address.pincode?.trim() || '',
      country: address.country?.trim() || existingLocation.address.country || 'India',
    };
  }

  existingLocation.updatedBy = req.auth?.userId as any;
  await existingLocation.save();

  await syncManagerAssignment(existingLocation._id, previousManager, existingLocation.manager);

  const updatedPopulated = await Location.findById(existingLocation._id)
    .populate('entity', 'name code')
    .populate('coEntities.entity', 'name code')
    .populate('locationType', 'code label')
    .populate('manager', 'firstName lastName email phone')
    .lean();

  await auditService.logMutation({
    req,
    action: 'LOCATION_UPDATED',
    module: 'locations',
    entityType: 'Location',
    recordId: existingLocation._id,
    entityId: existingLocation.entity as Types.ObjectId,
    previousValue,
    newValue: auditSnapshot(existingLocation),
    description: `Updated facility location '${existingLocation.name}' (${existingLocation.code})`,
  });

  return ApiResponse.success(res, { location: updatedPopulated }, 'Location updated successfully');
});

// ── 5. Delete Location ────────────────────────────────────────────────────────
export const deleteLocation = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Location ID format');
  }

  const location = await Location.findById(id);
  if (!location) {
    throw ApiError.notFound(`Location with ID ${id} not found`);
  }

  if (!canManageEntity(getAccessScope(req), String(location.entity))) {
    throw ApiError.forbidden('You are not authorized to delete this location');
  }

  // A location can only be deleted once nothing depends on it
  const [children, records, tasks, documents, licences] = await Promise.all([
    Location.countDocuments({ parentLocation: id }),
    ComplianceRecord.countDocuments({ location: id }),
    Task.countDocuments({ location: id }),
    CmsDocument.countDocuments({ location: id, status: 'active' }),
    Licence.countDocuments({ location: id }),
  ]);

  const blockers = [
    children && `${children} sub-unit(s)`,
    records && `${records} compliance record(s)`,
    tasks && `${tasks} task(s)`,
    documents && `${documents} document(s)`,
    licences && `${licences} licence(s)`,
  ].filter(Boolean);

  if (blockers.length > 0) {
    throw ApiError.badRequest(
      `Cannot delete "${location.name}" because it still has ${blockers.join(', ')}. Remove or reassign them first, or set the location to inactive.`
    );
  }

  await Location.findByIdAndDelete(id);
  await User.updateMany({ assignedLocations: location._id }, { $pull: { assignedLocations: location._id } });

  await auditService.logLocationDeleted(location, req);

  return ApiResponse.success(res, null, `Location "${location.name}" deleted successfully`);
});
