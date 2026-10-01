/**
 * Admin Master Data Controller
 *
 * Full CRUD for the 11 core classification and lookup categories:
 *   - Entity Types
 *   - Location Types
 *   - Compliance Categories
 *   - Compliance Frequencies
 *   - Document Types
 *   - Licence Types
 *   - Task Priorities
 *   - Task Statuses
 *   - Notification Rules
 *   - States
 *   - Districts
 */

import { Request, Response } from 'express';
import MasterData from '../models/MasterData.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAuditEvent } from '../utils/audit.js';

// Canonical category definitions with descriptive labels
export const CANONICAL_CATEGORIES = [
  { id: 'entity_type', name: 'Entity Types', description: 'Legal and structural entity classifications' },
  { id: 'location_type', name: 'Location Types', description: 'Physical branch and facility tiers' },
  { id: 'compliance_category', name: 'Compliance Categories', description: 'Regulatory domains and statutes' },
  { id: 'compliance_frequency', name: 'Compliance Frequencies', description: 'Filing, renewal, and audit intervals' },
  { id: 'document_type', name: 'Document Types', description: 'Permitted statutory evidence classifications' },
  { id: 'licence_type', name: 'Licence Types', description: 'Mandatory operating licences and permits' },
  { id: 'task_priority', name: 'Task Priorities', description: 'Operational urgency and escalation levels' },
  { id: 'task_status', name: 'Task Statuses', description: 'Lifecycle states of statutory tasks' },
  { id: 'notification_rule', name: 'Notification Rules', description: 'Advance reminder and escalation rules' },
  { id: 'state', name: 'States', description: 'State jurisdictions for Indian statutory compliance' },
  { id: 'district', name: 'Districts', description: 'Districts linked hierarchically to parent states' },
];

// ── 1. Get Categories Overview with Item Counts ─────────────────────────────
export const getCategories = asyncHandler(async (_req: Request, res: Response) => {
  const counts = await MasterData.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 }, activeCount: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } },
  ]);

  const countMap: Record<string, { total: number; active: number }> = {};
  counts.forEach((c) => {
    countMap[c._id] = { total: c.count, active: c.activeCount };
  });

  const categories = CANONICAL_CATEGORIES.map((cat) => ({
    ...cat,
    count: countMap[cat.id]?.total || 0,
    activeCount: countMap[cat.id]?.active || 0,
  }));

  return ApiResponse.success(res, { categories });
});

// ── 2. Get Master Data Items with Search, Filter & Pagination ───────────────
export const getMasterData = asyncHandler(async (req: Request, res: Response) => {
  const category = (req.query.category as string)?.toLowerCase();
  const status = req.query.status as string;
  const parent = req.query.parent as string;
  const search = (req.query.search as string)?.trim();

  const query: Record<string, any> = {};

  if (category) {
    query.category = category;
  }

  if (status) {
    query.status = status;
  }

  if (parent) {
    query.parent = parent;
  }

  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [{ code: searchRegex }, { label: searchRegex }, { description: searchRegex }];
  }

  const items = await MasterData.find(query)
    .populate('parent', 'code label category')
    .sort({ sortOrder: 1, label: 1 })
    .lean();

  return ApiResponse.success(res, {
    items,
    total: items.length,
    category: category || 'all',
  });
});

// ── 3. Get Single Master Data Item ──────────────────────────────────────────
export const getMasterDataById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const item = await MasterData.findById(id).populate('parent', 'code label category');
  if (!item) {
    throw ApiError.notFound(`Master data entry not found with ID '${id}'`);
  }

  return ApiResponse.success(res, { item });
});

// ── 4. Create Master Data Item ──────────────────────────────────────────────
export const createMasterData = asyncHandler(async (req: Request, res: Response) => {
  const { category, code, label, description, parent, sortOrder, metadata, status } = req.body;

  const formattedCategory = category.toLowerCase().trim();
  const formattedCode = code.toUpperCase().trim();

  // Enforce uniqueness within category
  const existing = await MasterData.findOne({ category: formattedCategory, code: formattedCode });
  if (existing) {
    throw ApiError.conflict(
      `An item with code '${formattedCode}' already exists in category '${formattedCategory}'.`
    );
  }

  // Validate parent if provided (e.g., district parent must be a state)
  if (parent) {
    const parentDoc = await MasterData.findById(parent);
    if (!parentDoc) {
      throw ApiError.badRequest('Referenced parent master data item does not exist.');
    }
  }

  const item = await MasterData.create({
    category: formattedCategory,
    code: formattedCode,
    label: label.trim(),
    description: description || '',
    parent: parent || null,
    sortOrder: sortOrder || 0,
    metadata: metadata || {},
    status: status || 'active',
    isSystem: false,
    createdBy: req.user?._id,
  });

  const populated = await MasterData.findById(item._id).populate('parent', 'code label category');

  await logAuditEvent({
    req,
    action: 'create',
    resource: 'MasterData',
    resourceId: item._id,
    newValue: { category: formattedCategory, code: formattedCode, label: item.label },
    description: `Created master data item '${formattedCode}' in '${formattedCategory}'`,
  });

  return ApiResponse.created(res, { item: populated }, 'Master data item created successfully');
});

// ── 5. Update Master Data Item ──────────────────────────────────────────────
export const updateMasterData = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { label, description, parent, sortOrder, metadata, status } = req.body;

  const item = await MasterData.findById(id);
  if (!item) {
    throw ApiError.notFound(`Master data entry not found with ID '${id}'`);
  }

  const previousState = {
    label: item.label,
    description: item.description,
    parent: item.parent,
    sortOrder: item.sortOrder,
    status: item.status,
  };

  if (label) item.label = label.trim();
  if (description !== undefined) item.description = description;
  if (sortOrder !== undefined) item.sortOrder = sortOrder;
  if (metadata !== undefined) item.metadata = metadata;
  if (status) item.status = status;

  if (parent !== undefined) {
    if (parent) {
      const parentDoc = await MasterData.findById(parent);
      if (!parentDoc) {
        throw ApiError.badRequest('Referenced parent master data item does not exist.');
      }
      item.parent = parent;
    } else {
      item.parent = undefined;
    }
  }

  item.updatedBy = req.user?._id;
  await item.save();

  const populated = await MasterData.findById(id).populate('parent', 'code label category');

  await logAuditEvent({
    req,
    action: 'update',
    resource: 'MasterData',
    resourceId: item._id,
    previousValue: previousState,
    newValue: { label: item.label, status: item.status, sortOrder: item.sortOrder },
    description: `Updated master data item '${item.code}' in '${item.category}'`,
  });

  return ApiResponse.success(res, { item: populated }, 'Master data item updated successfully');
});

// ── 6. Toggle Master Data Status (Active / Inactive) ─────────────────────────
export const toggleMasterDataStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const item = await MasterData.findById(id);
  if (!item) {
    throw ApiError.notFound(`Master data entry not found with ID '${id}'`);
  }

  const prevStatus = item.status;
  item.status = status;
  item.updatedBy = req.user?._id;
  await item.save();

  await logAuditEvent({
    req,
    action: 'update',
    resource: 'MasterData',
    resourceId: item._id,
    previousValue: { status: prevStatus },
    newValue: { status },
    description: `Changed status of '${item.code}' in '${item.category}' to ${status}`,
  });

  return ApiResponse.success(res, { item }, `Item status changed to ${status}`);
});

// ── 7. Delete Master Data Item ──────────────────────────────────────────────
export const deleteMasterData = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const item = await MasterData.findById(id);
  if (!item) {
    throw ApiError.notFound(`Master data entry not found with ID '${id}'`);
  }

  // Prevent deleting items that have children (e.g. state having districts)
  const childCount = await MasterData.countDocuments({ parent: id });
  if (childCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete '${item.label}'. It has ${childCount} dependent child item(s). Reassign or delete child items first.`
    );
  }

  await MasterData.findByIdAndDelete(id);

  await logAuditEvent({
    req,
    action: 'delete',
    resource: 'MasterData',
    resourceId: item._id,
    previousValue: { category: item.category, code: item.code, label: item.label },
    description: `Deleted master data item '${item.code}' from '${item.category}'`,
  });

  return ApiResponse.success(res, null, `Master data item '${item.label}' deleted successfully`);
});
