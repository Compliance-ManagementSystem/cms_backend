/**
 * Location Controller
 *
 * Full CRUD, search, filter, pagination, sorting, relationship aggregation, and RBAC scoping.
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Location from '../models/Location.js';
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
import { logAuditEvent } from '../utils/audit.js';
import { ROLES } from '../constants/permissions.js';

// Helper to determine if user has global administrative visibility
const isGlobalAdmin = (req: Request): boolean => {
  const roleCode = (req.user?.role as any)?.code || req.auth?.role;
  return roleCode === ROLES.SUPER_ADMIN || roleCode === ROLES.ADMIN;
};

// ── 1. Get Paginated Locations with Search, Filter & Sorting ───────────────────
export const getLocations = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
  const search = (req.query.search as string)?.trim();
  const entityParam = req.query.entity as string;
  const locationType = req.query.locationType as string;
  const status = req.query.status as string;
  const state = req.query.state as string;
  const district = req.query.district as string;
  const city = req.query.city as string;
  const sortBy = (req.query.sortBy as string) || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

  const query: Record<string, any> = {};

  // RBAC Scoping:
  if (!isGlobalAdmin(req)) {
    const roleCode = (req.user?.role as any)?.code || req.auth?.role;
    const userEntityId = req.user?.entity
      ? (req.user.entity as any)._id || req.user.entity
      : req.auth?.entityId;
    const userLocationId = (req.user as any)?.location
      ? ((req.user as any).location as any)._id || (req.user as any).location
      : (req.auth as any)?.locationId;

    if (roleCode === ROLES.UNIT_MANAGER && userLocationId) {
      // Unit manager scoped to specific location
      query._id = userLocationId;
    } else if (userEntityId) {
      // Entity admin / compliance officer scoped to entity
      query.entity = userEntityId;
    } else {
      return ApiResponse.success(res, {
        locations: [],
        pagination: { total: 0, page, limit, totalPages: 0 },
      });
    }
  }

  // Filter by Entity (if user specified and allowed)
  if (entityParam) {
    if (mongoose.Types.ObjectId.isValid(entityParam)) {
      if (query.entity && query.entity.toString() !== entityParam) {
        // Scoped user trying to filter outside their entity
        return ApiResponse.success(res, {
          locations: [],
          pagination: { total: 0, page, limit, totalPages: 0 },
        });
      }
      query.entity = new mongoose.Types.ObjectId(entityParam);
    } else {
      // Search by entity code or name
      const matchingEntities = await Entity.find({
        $or: [
          { code: entityParam.toUpperCase() },
          { name: new RegExp(entityParam, 'i') },
        ],
      }).select('_id');
      const entityIds = matchingEntities.map((e) => e._id);
      if (query.entity) {
        query.entity = { $in: entityIds.filter((id) => id.toString() === query.entity.toString()) };
      } else {
        query.entity = { $in: entityIds };
      }
    }
  }

  // Filter by Location Type (code or ObjectId)
  if (locationType) {
    if (mongoose.Types.ObjectId.isValid(locationType)) {
      query.locationType = locationType;
    } else {
      const typeDoc = await MasterData.findOne({
        category: 'location_type',
        code: locationType.toUpperCase(),
      });
      if (typeDoc) {
        query.locationType = typeDoc._id;
      } else {
        return ApiResponse.success(res, {
          locations: [],
          pagination: { total: 0, page, limit, totalPages: 0 },
        });
      }
    }
  }

  // Filter by Status
  if (status) {
    query.status = status;
  }

  // Filter by State
  if (state) {
    query['address.state'] = new RegExp(`^${state.trim()}$`, 'i');
  }

  // Filter by District
  if (district) {
    query['address.district'] = new RegExp(`^${district.trim()}$`, 'i');
  }

  // Filter by City
  if (city) {
    query['address.city'] = new RegExp(`^${city.trim()}$`, 'i');
  }

  // General Text Search
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { name: searchRegex },
      { code: searchRegex },
      { contactPerson: searchRegex },
      { contactEmail: searchRegex },
      { 'address.city': searchRegex },
      { 'address.state': searchRegex },
    ];
  }

  const skip = (page - 1) * limit;

  const [locations, total] = await Promise.all([
    Location.find(query)
      .populate('entity', 'name code entityCode status')
      .populate('locationType', 'code label description')
      .populate('manager', 'firstName lastName email phone')
      .populate('parentLocation', 'name code')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean(),
    Location.countDocuments(query),
  ]);

  // Aggregate compliance obligations counts per location
  const locationIds = locations.map((l) => l._id);
  const complianceStats = await ComplianceRecord.aggregate([
    { $match: { location: { $in: locationIds } } },
    { $group: { _id: '$location', count: { $sum: 1 } } },
  ]);
  const complianceCountMap = new Map<string, number>(
    complianceStats.map((s) => [s._id.toString(), s.count])
  );

  const enrichedLocations = locations.map((loc) => ({
    ...loc,
    locationCode: loc.code,
    complianceCount: complianceCountMap.get(loc._id.toString()) || 0,
  }));

  return ApiResponse.success(res, {
    locations: enrichedLocations,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── 2. Get Single Location by ID with Relationship Structures ────────────────
export const getLocationById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Location ID format');
  }

  const location = await Location.findById(id)
    .populate('entity', 'name code entityCode status contactEmail contactPhone address')
    .populate('locationType', 'code label description')
    .populate('manager', 'firstName lastName email phone role')
    .populate('parentLocation', 'name code locationType')
    .lean();

  if (!location) {
    throw ApiError.notFound(`Location with ID ${id} not found`);
  }

  // RBAC Permission Scoping
  if (!isGlobalAdmin(req)) {
    const roleCode = (req.user?.role as any)?.code || req.auth?.role;
    const userEntityId = req.user?.entity
      ? (req.user.entity as any)._id?.toString() || req.user.entity.toString()
      : req.auth?.entityId;
    const userLocationId = (req.user as any)?.location
      ? ((req.user as any).location as any)._id?.toString() || (req.user as any).location.toString()
      : (req.auth as any)?.locationId;

    if (roleCode === ROLES.UNIT_MANAGER && userLocationId !== id) {
      throw ApiError.forbidden('You are not authorized to access this location');
    }

    const locEntityId = (location.entity as any)?._id?.toString() || location.entity?.toString();
    if (userEntityId && locEntityId !== userEntityId) {
      throw ApiError.forbidden('You are not authorized to access locations outside your assigned entity');
    }
  }

  // Retrieve associated relationships in parallel
  const [
    complianceRecords,
    documents,
    licences,
    tasks,
    auditLogs,
  ] = await Promise.all([
    ComplianceRecord.find({ location: id })
      .populate('complianceRule', 'name code category frequency riskLevel')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    CmsDocument.find({ location: id })
      .populate('documentType', 'code label')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    Licence.find({ location: id })
      .populate('licenceType', 'code label')
      .sort({ expiryDate: 1 })
      .limit(50)
      .lean(),
    Task.find({ location: id })
      .populate('assignedTo', 'firstName lastName email')
      .sort({ dueDate: 1 })
      .limit(50)
      .lean(),
    AuditLog.find({ resource: 'Location', resourceId: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  // Compute compliance statistics for this location
  const complianceStats = {
    total: complianceRecords.length,
    approved: complianceRecords.filter((r) => r.status === 'approved').length,
    pending: complianceRecords.filter((r) => r.status === 'pending').length,
    expired: complianceRecords.filter((r) => r.status === 'expired').length,
    rejected: complianceRecords.filter((r) => r.status === 'rejected').length,
  };

  return ApiResponse.success(res, {
    location: {
      ...location,
      locationCode: location.code,
    },
    complianceStats,
    complianceRecords,
    documents,
    licences,
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
    description,
    area,
    areaUnit,
    operatingHours,
    parentLocation,
    status,
  } = req.body;

  // 1. Verify Entity exists
  if (!mongoose.Types.ObjectId.isValid(entityInput)) {
    throw ApiError.badRequest('Invalid Entity ID');
  }
  const entityDoc = await Entity.findById(entityInput);
  if (!entityDoc) {
    throw ApiError.notFound('Target business entity not found');
  }

  // RBAC: Non-global admins can only add locations under their assigned entity
  if (!isGlobalAdmin(req)) {
    const userEntityId = req.user?.entity
      ? (req.user.entity as any)._id?.toString() || req.user.entity.toString()
      : req.auth?.entityId;

    if (userEntityId !== entityInput.toString()) {
      throw ApiError.forbidden('You cannot create locations for an entity other than your assigned entity');
    }
  }

  // 2. Resolve and validate Location Type from Master Data
  let locationTypeId: mongoose.Types.ObjectId;
  if (mongoose.Types.ObjectId.isValid(typeInput)) {
    const masterDoc = await MasterData.findOne({
      _id: typeInput,
      category: 'location_type',
    });
    if (!masterDoc) {
      throw ApiError.badRequest('Invalid Location Type ID');
    }
    locationTypeId = masterDoc._id;
  } else {
    const masterDoc = await MasterData.findOne({
      category: 'location_type',
      code: typeInput.toUpperCase(),
    });
    if (!masterDoc) {
      throw ApiError.badRequest(`Location Type code "${typeInput}" not found in Master Data`);
    }
    locationTypeId = masterDoc._id;
  }

  // 3. Resolve Manager (if provided)
  let managerId: mongoose.Types.ObjectId | undefined;
  if (manager) {
    if (!mongoose.Types.ObjectId.isValid(manager)) {
      throw ApiError.badRequest('Invalid Manager User ID');
    }
    const userDoc = await User.findById(manager);
    if (!userDoc) {
      throw ApiError.notFound('Designated manager user not found');
    }
    managerId = userDoc._id;
  }

  // 4. Resolve Location Code (unique per entity)
  let resolvedCode = (code || locationCode)?.trim().toUpperCase();
  if (!resolvedCode) {
    // Generate unique code based on entity prefix and random suffix
    const entityPrefix = entityDoc.code ? entityDoc.code.slice(0, 4) : 'LOC';
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    resolvedCode = `${entityPrefix}-U${randomSuffix}`;
  }

  // Check code uniqueness within this entity
  const existingCode = await Location.findOne({
    entity: entityDoc._id,
    code: resolvedCode,
  });
  if (existingCode) {
    throw ApiError.conflict(
      `Location code "${resolvedCode}" is already in use under entity "${entityDoc.name}"`
    );
  }

  // 5. Create Location
  const newLocation = await Location.create({
    name: name.trim(),
    code: resolvedCode,
    entity: entityDoc._id,
    locationType: locationTypeId,
    address: {
      line1: address.line1.trim(),
      line2: address.line2?.trim() || '',
      city: address.city.trim(),
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
    description: description?.trim() || undefined,
    area: area !== undefined && area !== null ? area : undefined,
    areaUnit: areaUnit || 'sqft',
    operatingHours: operatingHours?.trim() || undefined,
    parentLocation: parentLocation && mongoose.Types.ObjectId.isValid(parentLocation) ? parentLocation : undefined,
    status: status || 'active',
    createdBy: req.user?._id || req.auth?.userId,
    updatedBy: req.user?._id || req.auth?.userId,
  });

  const populated = await Location.findById(newLocation._id)
    .populate('entity', 'name code entityCode')
    .populate('locationType', 'code label')
    .populate('manager', 'firstName lastName email phone')
    .lean();

  // Audit Logging
  await logAuditEvent({
    action: 'CREATE',
    resource: 'Location',
    resourceId: newLocation._id.toString(),
    userId: (req.user?._id || req.auth?.userId)?.toString(),
    userEmail: req.user?.email || (req.auth as any)?.email,
    userRole: (req.user?.role as any)?.code || req.auth?.role,
    newValue: populated,
    description: `Created location "${newLocation.name}" (${newLocation.code}) under entity "${entityDoc.name}"`,
    req,
  });

  return ApiResponse.created(res, { location: populated }, 'Location created successfully');
});

// ── 4. Update Location ────────────────────────────────────────────────────────
export const updateLocation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Location ID format');
  }

  const existingLocation = await Location.findById(id);
  if (!existingLocation) {
    throw ApiError.notFound(`Location with ID ${id} not found`);
  }

  // RBAC Permission Scoping
  if (!isGlobalAdmin(req)) {
    const userEntityId = req.user?.entity
      ? (req.user.entity as any)._id?.toString() || req.user.entity.toString()
      : req.auth?.entityId;

    if (existingLocation.entity.toString() !== userEntityId) {
      throw ApiError.forbidden('You are not authorized to update locations outside your assigned entity');
    }
  }

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
    description,
    area,
    areaUnit,
    operatingHours,
    parentLocation,
    status,
  } = req.body;

  // Handle entity change (if requested)
  let targetEntityId = existingLocation.entity;
  if (entityInput && entityInput !== existingLocation.entity.toString()) {
    if (!isGlobalAdmin(req)) {
      throw ApiError.forbidden('Only administrators can reassign a location to a different entity');
    }
    if (!mongoose.Types.ObjectId.isValid(entityInput)) {
      throw ApiError.badRequest('Invalid Entity ID');
    }
    const targetEntity = await Entity.findById(entityInput);
    if (!targetEntity) {
      throw ApiError.notFound('Target business entity not found');
    }
    targetEntityId = targetEntity._id;
  }

  // Handle code change
  const resolvedCode = (code || locationCode)?.trim().toUpperCase();
  if (resolvedCode && resolvedCode !== existingLocation.code) {
    const codeConflict = await Location.findOne({
      _id: { $ne: existingLocation._id },
      entity: targetEntityId,
      code: resolvedCode,
    });
    if (codeConflict) {
      throw ApiError.conflict(
        `Location code "${resolvedCode}" is already in use under this entity`
      );
    }
    existingLocation.code = resolvedCode;
  }

  // Handle Location Type change
  if (typeInput) {
    if (mongoose.Types.ObjectId.isValid(typeInput)) {
      const masterDoc = await MasterData.findOne({
        _id: typeInput,
        category: 'location_type',
      });
      if (!masterDoc) throw ApiError.badRequest('Invalid Location Type ID');
      existingLocation.locationType = masterDoc._id;
    } else {
      const masterDoc = await MasterData.findOne({
        category: 'location_type',
        code: typeInput.toUpperCase(),
      });
      if (!masterDoc) {
        throw ApiError.badRequest(`Location Type code "${typeInput}" not found in Master Data`);
      }
      existingLocation.locationType = masterDoc._id;
    }
  }

  // Handle Manager change
  if (manager !== undefined) {
    if (manager === null || manager === '') {
      existingLocation.manager = undefined;
    } else if (mongoose.Types.ObjectId.isValid(manager)) {
      const userDoc = await User.findById(manager);
      if (!userDoc) throw ApiError.notFound('Designated manager user not found');
      existingLocation.manager = userDoc._id;
    } else {
      throw ApiError.badRequest('Invalid Manager ID');
    }
  }

  // Update direct fields
  if (name) existingLocation.name = name.trim();
  existingLocation.entity = targetEntityId;
  if (status) existingLocation.status = status;
  if (openingDate !== undefined) {
    existingLocation.openingDate = openingDate ? new Date(openingDate) : undefined;
  }
  if (description !== undefined) existingLocation.description = description?.trim() || '';
  if (area !== undefined) existingLocation.area = area !== null ? area : undefined;
  if (areaUnit !== undefined) existingLocation.areaUnit = areaUnit;
  if (operatingHours !== undefined) existingLocation.operatingHours = operatingHours?.trim() || '';
  if (contactPerson !== undefined) existingLocation.contactPerson = contactPerson?.trim() || '';
  if (contactEmail !== undefined) existingLocation.contactEmail = contactEmail?.trim() || '';
  if (contactPhone !== undefined) existingLocation.contactPhone = contactPhone?.trim() || '';
  if (parentLocation !== undefined) {
    existingLocation.parentLocation =
      parentLocation && mongoose.Types.ObjectId.isValid(parentLocation) ? parentLocation : undefined;
  }

  // Update address fields
  if (address) {
    existingLocation.address = {
      line1: address.line1?.trim() || existingLocation.address.line1,
      line2: address.line2 !== undefined ? address.line2?.trim() : existingLocation.address.line2,
      city: address.city?.trim() || existingLocation.address.city,
      district:
        address.district !== undefined ? address.district?.trim() : existingLocation.address.district,
      state: address.state?.trim() || existingLocation.address.state,
      pincode:
        address.pincode !== undefined ? address.pincode?.trim() : existingLocation.address.pincode,
      country: address.country?.trim() || existingLocation.address.country || 'India',
    };
  }

  existingLocation.updatedBy = req.user?._id || req.auth?.userId;
  await existingLocation.save();

  const updatedPopulated = await Location.findById(existingLocation._id)
    .populate('entity', 'name code entityCode')
    .populate('locationType', 'code label')
    .populate('manager', 'firstName lastName email phone')
    .lean();

  // Audit Logging
  await logAuditEvent({
    action: 'UPDATE',
    resource: 'Location',
    resourceId: existingLocation._id.toString(),
    userId: (req.user?._id || req.auth?.userId)?.toString(),
    userEmail: req.user?.email || (req.auth as any)?.email,
    userRole: (req.user?.role as any)?.code || req.auth?.role,
    previousValue: existingLocation.toObject(),
    newValue: updatedPopulated,
    description: `Updated location "${existingLocation.name}" (${existingLocation.code})`,
    req,
  });

  return ApiResponse.success(res, { location: updatedPopulated }, 'Location updated successfully');
});

// ── 5. Delete Location ────────────────────────────────────────────────────────
export const deleteLocation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Location ID format');
  }

  const location = await Location.findById(id);
  if (!location) {
    throw ApiError.notFound(`Location with ID ${id} not found`);
  }

  // RBAC Permission Scoping
  if (!isGlobalAdmin(req)) {
    const userEntityId = req.user?.entity
      ? (req.user.entity as any)._id?.toString() || req.user.entity.toString()
      : req.auth?.entityId;

    if (location.entity.toString() !== userEntityId) {
      throw ApiError.forbidden('You are not authorized to delete locations outside your assigned entity');
    }
  }

  // Safety check 1: Child locations (sub-units)
  const childCount = await Location.countDocuments({ parentLocation: id });
  if (childCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete location because it has ${childCount} dependent sub-unit(s). Reassign or remove them first.`
    );
  }

  // Safety check 2: Active compliance records
  const complianceCount = await ComplianceRecord.countDocuments({ location: id });
  if (complianceCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete location because it has ${complianceCount} active compliance obligation record(s).`
    );
  }

  await Location.findByIdAndDelete(id);

  // Audit Logging
  await logAuditEvent({
    action: 'DELETE',
    resource: 'Location',
    resourceId: id,
    userId: (req.user?._id || req.auth?.userId)?.toString(),
    userEmail: req.user?.email || (req.auth as any)?.email,
    userRole: (req.user?.role as any)?.code || req.auth?.role,
    description: `Deleted location "${location.name}" (${location.code})`,
    req,
  });

  return ApiResponse.success(res, null, `Location "${location.name}" deleted successfully`);
});
