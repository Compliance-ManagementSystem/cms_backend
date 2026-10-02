/**
 * Compliance Rule Controller
 *
 * Full CRUD, search, filter, status toggles, Master Data resolution, and
 * rule applicability evaluation via RuleEngineService.
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import ComplianceRule from '../models/ComplianceRule.js';
import MasterData from '../models/MasterData.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Task from '../models/Task.js';
import { RuleEngineService } from '../services/ruleEngine.service.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAuditEvent } from '../utils/audit.js';

// ── 1. Get Paginated Compliance Rules ─────────────────────────────────────────
export const getComplianceRules = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
  const search = (req.query.search as string)?.trim();
  const categoryParam = req.query.category as string;
  const frequencyParam = req.query.frequency as string;
  const statusParam = req.query.status as string;
  const mandatoryParam = req.query.mandatory as string;
  const stateParam = req.query.state as string;
  const entityTypeParam = req.query.entityType as string;
  const locationTypeParam = req.query.locationType as string;
  const sortBy = (req.query.sortBy as string) || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

  const query: Record<string, any> = {};

  // Filter by Category
  if (categoryParam) {
    if (mongoose.Types.ObjectId.isValid(categoryParam)) {
      query.category = categoryParam;
    } else {
      const catDoc = await MasterData.findOne({
        category: 'compliance_category',
        code: categoryParam.toUpperCase(),
      });
      if (catDoc) query.category = catDoc._id;
    }
  }

  // Filter by Frequency
  if (frequencyParam) {
    if (mongoose.Types.ObjectId.isValid(frequencyParam)) {
      query.frequency = frequencyParam;
    } else {
      const freqDoc = await MasterData.findOne({
        category: 'compliance_frequency',
        code: frequencyParam.toUpperCase(),
      });
      if (freqDoc) query.frequency = freqDoc._id;
    }
  }

  // Filter by Status
  if (statusParam) {
    query.status = statusParam;
  }

  // Filter by Mandatory
  if (mandatoryParam !== undefined && mandatoryParam !== '') {
    query.mandatory = mandatoryParam === 'true';
  }

  // Filter by State
  if (stateParam) {
    query.$or = [
      { applicableStates: { $size: 0 } }, // Pan-India
      { applicableStates: new RegExp(`^${stateParam.trim()}$`, 'i') },
    ];
  }

  // Filter by Entity Type
  if (entityTypeParam) {
    if (mongoose.Types.ObjectId.isValid(entityTypeParam)) {
      query.applicableEntityTypes = { $in: [new mongoose.Types.ObjectId(entityTypeParam)] };
    }
  }

  // Filter by Location Type
  if (locationTypeParam) {
    if (mongoose.Types.ObjectId.isValid(locationTypeParam)) {
      query.applicableLocationTypes = { $in: [new mongoose.Types.ObjectId(locationTypeParam)] };
    }
  }

  // Search by text — use $and to avoid overwriting state $or filter
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    const searchConditions = [
      { name: searchRegex },
      { code: searchRegex },
      { description: searchRegex },
      { legalReference: searchRegex },
    ];
    if (query.$or) {
      // Combine existing $or (state/entityType filter) with search using $and
      query.$and = [
        ...(query.$and || []),
        { $or: query.$or },
        { $or: searchConditions },
      ];
      delete query.$or;
    } else {
      query.$or = searchConditions;
    }
  }

  const skip = (page - 1) * limit;

  // Run paginated query + total count + aggregate stats in parallel
  const [rules, total, activeCount, mandatoryCount] = await Promise.all([
    ComplianceRule.find(query)
      .populate('category', 'code label description')
      .populate('frequency', 'code label')
      .populate('applicableEntityTypes', 'code label')
      .populate('applicableLocationTypes', 'code label')
      .populate('requiredDocuments.documentType', 'code label')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean(),
    ComplianceRule.countDocuments(query),
    ComplianceRule.countDocuments({ ...query, status: 'active' }),
    ComplianceRule.countDocuments({ ...query, mandatory: true }),
  ]);

  // Compute unique categories from the full filtered set
  const categoryAgg = await ComplianceRule.distinct('category', query);
  const uniqueCategoriesCount = categoryAgg.length;

  return ApiResponse.success(res, {
    rules,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    stats: {
      total,
      activeCount,
      mandatoryCount,
      uniqueCategoriesCount,
    },
  });
});

// ── 2. Get Single Compliance Rule by ID ───────────────────────────────────────
export const getComplianceRuleById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Compliance Rule ID format');
  }

  const rule = await ComplianceRule.findById(id)
    .populate('category', 'code label description')
    .populate('frequency', 'code label description')
    .populate('applicableEntityTypes', 'code label description')
    .populate('applicableLocationTypes', 'code label description')
    .populate('requiredDocuments.documentType', 'code label description')
    .populate('createdBy', 'firstName lastName email')
    .populate('updatedBy', 'firstName lastName email')
    .lean();

  if (!rule) {
    throw ApiError.notFound(`Compliance Rule with ID "${id}" not found`);
  }

  return ApiResponse.success(res, { rule });
});

// ── 3. Create Compliance Rule ─────────────────────────────────────────────────
export const createComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const {
    name,
    code,
    description,
    category: categoryInput,
    legalReference,
    applicableEntityTypes: entityTypesInput = [],
    applicableLocationTypes: locationTypesInput = [],
    applicableStates = [],
    frequency: frequencyInput,
    renewalFrequency,
    renewalCycle = 365,
    requiredDocuments: docsInput = [],
    mandatory = true,
    active = true,
    notificationRules,
    escalationRules,
    priority = 'medium',
    status = 'active',
    requiresApproval = false,
    approvalLevels = 1,
  } = req.body;

  // 1. Resolve Category from Master Data
  let categoryId: mongoose.Types.ObjectId;
  if (mongoose.Types.ObjectId.isValid(categoryInput)) {
    const catDoc = await MasterData.findOne({
      _id: categoryInput,
      category: 'compliance_category',
    });
    if (!catDoc) throw ApiError.badRequest('Invalid Compliance Category ID in Master Data');
    categoryId = catDoc._id;
  } else {
    const catDoc = await MasterData.findOne({
      category: 'compliance_category',
      code: categoryInput.toUpperCase(),
    });
    if (!catDoc) {
      throw ApiError.badRequest(`Compliance Category "${categoryInput}" not found in Master Data`);
    }
    categoryId = catDoc._id;
  }

  // 2. Resolve Frequency from Master Data
  let frequencyId: mongoose.Types.ObjectId;
  let frequencyCode = renewalFrequency || 'ANNUALLY';
  if (mongoose.Types.ObjectId.isValid(frequencyInput)) {
    const freqDoc = await MasterData.findOne({
      _id: frequencyInput,
      category: 'compliance_frequency',
    });
    if (!freqDoc) throw ApiError.badRequest('Invalid Compliance Frequency ID in Master Data');
    frequencyId = freqDoc._id;
    frequencyCode = freqDoc.code;
  } else {
    const freqDoc = await MasterData.findOne({
      category: 'compliance_frequency',
      code: frequencyInput.toUpperCase(),
    });
    if (!freqDoc) {
      throw ApiError.badRequest(`Compliance Frequency "${frequencyInput}" not found in Master Data`);
    }
    frequencyId = freqDoc._id;
    frequencyCode = freqDoc.code;
  }

  // 3. Resolve Applicable Entity Types
  const resolvedEntityTypes: mongoose.Types.ObjectId[] = [];
  for (const item of entityTypesInput) {
    if (mongoose.Types.ObjectId.isValid(item)) {
      resolvedEntityTypes.push(new mongoose.Types.ObjectId(item));
    } else {
      const typeDoc = await MasterData.findOne({
        category: 'entity_type',
        code: item.toUpperCase(),
      });
      if (typeDoc) resolvedEntityTypes.push(typeDoc._id);
    }
  }

  // 4. Resolve Applicable Location Types
  const resolvedLocationTypes: mongoose.Types.ObjectId[] = [];
  for (const item of locationTypesInput) {
    if (mongoose.Types.ObjectId.isValid(item)) {
      resolvedLocationTypes.push(new mongoose.Types.ObjectId(item));
    } else {
      const typeDoc = await MasterData.findOne({
        category: 'location_type',
        code: item.toUpperCase(),
      });
      if (typeDoc) resolvedLocationTypes.push(typeDoc._id);
    }
  }

  // 5. Resolve Required Documents
  const resolvedDocs: Array<{ documentType: mongoose.Types.ObjectId; label: string; isMandatory: boolean }> = [];
  for (const doc of docsInput) {
    let docTypeId: mongoose.Types.ObjectId | undefined;
    if (mongoose.Types.ObjectId.isValid(doc.documentType)) {
      docTypeId = new mongoose.Types.ObjectId(doc.documentType);
    } else {
      const docTypeMaster = await MasterData.findOne({
        category: 'document_type',
        code: doc.documentType.toUpperCase(),
      });
      if (docTypeMaster) docTypeId = docTypeMaster._id;
    }

    if (docTypeId) {
      resolvedDocs.push({
        documentType: docTypeId,
        label: doc.label || 'Required Document',
        isMandatory: doc.isMandatory !== undefined ? doc.isMandatory : true,
      });
    }
  }

  // 6. Resolve Code
  let resolvedCode = code?.trim().toUpperCase();
  if (!resolvedCode) {
    const catPrefix = categoryInput.slice(0, 4).toUpperCase();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    resolvedCode = `RULE-${catPrefix}-${randomSuffix}`;
  }

  const existingRule = await ComplianceRule.findOne({ code: resolvedCode });
  if (existingRule) {
    throw ApiError.conflict(`Compliance Rule with code "${resolvedCode}" already exists`);
  }

  // 7. Create Rule
  const newRule = await ComplianceRule.create({
    name: name.trim(),
    code: resolvedCode,
    description: description?.trim() || '',
    category: categoryId,
    legalReference: legalReference?.trim() || '',
    applicableEntityTypes: resolvedEntityTypes,
    applicableLocationTypes: resolvedLocationTypes,
    applicableStates: applicableStates.map((s: string) => s.trim()),
    frequency: frequencyId,
    renewalFrequency: frequencyCode,
    renewalCycle: Number(renewalCycle) || 365,
    requiredDocuments: resolvedDocs,
    mandatory: Boolean(mandatory),
    active: status === 'active' && Boolean(active),
    status: status || 'active',
    notificationRules: notificationRules || {
      reminderDays: [90, 60, 30, 15, 7],
      notifyRoles: ['unit_manager', 'compliance_officer'],
      channels: ['email', 'in_app'],
    },
    escalationRules: escalationRules || {
      escalateAfterDays: 7,
      escalateToRole: 'entity_admin',
      autoTaskCreation: true,
    },
    priority,
    requiresApproval: Boolean(requiresApproval),
    approvalLevels: Number(approvalLevels) || 1,
    createdBy: req.user?._id || req.auth?.userId,
    updatedBy: req.user?._id || req.auth?.userId,
  });

  const populatedRule = await ComplianceRule.findById(newRule._id)
    .populate('category', 'code label')
    .populate('frequency', 'code label')
    .populate('applicableEntityTypes', 'code label')
    .populate('applicableLocationTypes', 'code label')
    .populate('requiredDocuments.documentType', 'code label')
    .lean();

  await logAuditEvent({
    action: 'CREATE',
    resource: 'ComplianceRule',
    resourceId: newRule._id.toString(),
    userId: (req.user?._id || req.auth?.userId)?.toString(),
    userEmail: req.user?.email || (req.auth as any)?.email,
    userRole: (req.user?.role as any)?.code || req.auth?.role,
    newValue: populatedRule,
    description: `Created compliance rule "${newRule.name}" (${newRule.code})`,
    req,
  });

  return ApiResponse.created(res, { rule: populatedRule }, 'Compliance rule created successfully');
});

// ── 4. Update Compliance Rule ─────────────────────────────────────────────────
export const updateComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Compliance Rule ID format');
  }

  const existingRule = await ComplianceRule.findById(id);
  if (!existingRule) {
    throw ApiError.notFound(`Compliance Rule with ID "${id}" not found`);
  }

  const {
    name,
    code,
    description,
    category: categoryInput,
    legalReference,
    applicableEntityTypes: entityTypesInput,
    applicableLocationTypes: locationTypesInput,
    applicableStates,
    frequency: frequencyInput,
    renewalFrequency,
    renewalCycle,
    requiredDocuments: docsInput,
    mandatory,
    active,
    notificationRules,
    escalationRules,
    priority,
    status,
    requiresApproval,
    approvalLevels,
  } = req.body;

  // Resolve Category if updated
  if (categoryInput) {
    if (mongoose.Types.ObjectId.isValid(categoryInput)) {
      existingRule.category = new mongoose.Types.ObjectId(categoryInput);
    } else {
      const catDoc = await MasterData.findOne({
        category: 'compliance_category',
        code: categoryInput.toUpperCase(),
      });
      if (catDoc) existingRule.category = catDoc._id;
    }
  }

  // Resolve Frequency if updated
  if (frequencyInput) {
    if (mongoose.Types.ObjectId.isValid(frequencyInput)) {
      existingRule.frequency = new mongoose.Types.ObjectId(frequencyInput);
    } else {
      const freqDoc = await MasterData.findOne({
        category: 'compliance_frequency',
        code: frequencyInput.toUpperCase(),
      });
      if (freqDoc) {
        existingRule.frequency = freqDoc._id;
        existingRule.renewalFrequency = freqDoc.code;
      }
    }
  }

  // Resolve Code if updated
  const resolvedCode = code?.trim().toUpperCase();
  if (resolvedCode && resolvedCode !== existingRule.code) {
    const codeConflict = await ComplianceRule.findOne({
      _id: { $ne: existingRule._id },
      code: resolvedCode,
    });
    if (codeConflict) {
      throw ApiError.conflict(`Compliance Rule with code "${resolvedCode}" already exists`);
    }
    existingRule.code = resolvedCode;
  }

  if (name) existingRule.name = name.trim();
  if (description !== undefined) existingRule.description = description?.trim() || '';
  if (legalReference !== undefined) existingRule.legalReference = legalReference?.trim() || '';
  if (renewalFrequency) existingRule.renewalFrequency = renewalFrequency;
  if (renewalCycle !== undefined) existingRule.renewalCycle = Number(renewalCycle);
  if (mandatory !== undefined) existingRule.mandatory = Boolean(mandatory);
  if (priority) existingRule.priority = priority;

  if (status !== undefined) {
    existingRule.status = status;
    existingRule.active = status === 'active';
  } else if (active !== undefined) {
    existingRule.active = Boolean(active);
    existingRule.status = active ? 'active' : 'inactive';
  }

  // Update Applicability Filters
  if (entityTypesInput !== undefined) {
    const resolvedEntityTypes: mongoose.Types.ObjectId[] = [];
    for (const item of entityTypesInput) {
      if (mongoose.Types.ObjectId.isValid(item)) {
        resolvedEntityTypes.push(new mongoose.Types.ObjectId(item));
      } else {
        const typeDoc = await MasterData.findOne({ category: 'entity_type', code: item.toUpperCase() });
        if (typeDoc) resolvedEntityTypes.push(typeDoc._id);
      }
    }
    existingRule.applicableEntityTypes = resolvedEntityTypes;
  }

  if (locationTypesInput !== undefined) {
    const resolvedLocationTypes: mongoose.Types.ObjectId[] = [];
    for (const item of locationTypesInput) {
      if (mongoose.Types.ObjectId.isValid(item)) {
        resolvedLocationTypes.push(new mongoose.Types.ObjectId(item));
      } else {
        const typeDoc = await MasterData.findOne({ category: 'location_type', code: item.toUpperCase() });
        if (typeDoc) resolvedLocationTypes.push(typeDoc._id);
      }
    }
    existingRule.applicableLocationTypes = resolvedLocationTypes;
  }

  if (applicableStates !== undefined) {
    existingRule.applicableStates = applicableStates.map((s: string) => s.trim());
  }

  if (docsInput !== undefined) {
    const resolvedDocs: Array<{ documentType: mongoose.Types.ObjectId; label: string; isMandatory: boolean }> = [];
    for (const doc of docsInput) {
      let docTypeId: mongoose.Types.ObjectId | undefined;
      if (mongoose.Types.ObjectId.isValid(doc.documentType)) {
        docTypeId = new mongoose.Types.ObjectId(doc.documentType);
      } else {
        const docTypeMaster = await MasterData.findOne({
          category: 'document_type',
          code: doc.documentType.toUpperCase(),
        });
        if (docTypeMaster) docTypeId = docTypeMaster._id;
      }
      if (docTypeId) {
        resolvedDocs.push({
          documentType: docTypeId,
          label: doc.label || 'Document',
          isMandatory: doc.isMandatory !== undefined ? doc.isMandatory : true,
        });
      }
    }
    existingRule.requiredDocuments = resolvedDocs;
  }

  if (notificationRules !== undefined) existingRule.notificationRules = notificationRules;
  if (escalationRules !== undefined) existingRule.escalationRules = escalationRules;
  if (requiresApproval !== undefined) existingRule.requiresApproval = Boolean(requiresApproval);
  if (approvalLevels !== undefined) existingRule.approvalLevels = Number(approvalLevels) || 1;

  existingRule.updatedBy = req.user?._id || req.auth?.userId;
  await existingRule.save();

  const updatedPopulated = await ComplianceRule.findById(existingRule._id)
    .populate('category', 'code label')
    .populate('frequency', 'code label')
    .populate('applicableEntityTypes', 'code label')
    .populate('applicableLocationTypes', 'code label')
    .populate('requiredDocuments.documentType', 'code label')
    .lean();

  await logAuditEvent({
    action: 'UPDATE',
    resource: 'ComplianceRule',
    resourceId: existingRule._id.toString(),
    userId: (req.user?._id || req.auth?.userId)?.toString(),
    userEmail: req.user?.email || (req.auth as any)?.email,
    userRole: (req.user?.role as any)?.code || req.auth?.role,
    previousValue: existingRule.toObject(),
    newValue: updatedPopulated,
    description: `Updated compliance rule "${existingRule.name}" (${existingRule.code})`,
    req,
  });

  return ApiResponse.success(res, { rule: updatedPopulated }, 'Compliance rule updated successfully');
});

// ── 5. Toggle Rule Active Status ──────────────────────────────────────────────
export const toggleRuleStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Compliance Rule ID format');
  }

  const rule = await ComplianceRule.findById(id);
  if (!rule) {
    throw ApiError.notFound(`Compliance Rule with ID "${id}" not found`);
  }

  const newStatus = rule.status === 'active' ? 'inactive' : 'active';
  rule.status = newStatus;
  rule.active = newStatus === 'active';
  rule.updatedBy = req.user?._id || req.auth?.userId;
  await rule.save();

  await logAuditEvent({
    action: 'UPDATE',
    resource: 'ComplianceRule',
    resourceId: id,
    userId: (req.user?._id || req.auth?.userId)?.toString(),
    userEmail: req.user?.email || (req.auth as any)?.email,
    userRole: (req.user?.role as any)?.code || req.auth?.role,
    description: `Toggled compliance rule "${rule.name}" status to "${newStatus}"`,
    req,
  });

  return ApiResponse.success(res, { rule }, `Compliance rule ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`);
});

// ── 6. Delete Compliance Rule ─────────────────────────────────────────────────
export const deleteComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Compliance Rule ID format');
  }

  const rule = await ComplianceRule.findById(id);
  if (!rule) {
    throw ApiError.notFound(`Compliance Rule with ID "${id}" not found`);
  }

  // Safety check 1: block deletion if compliance records exist for this rule
  const recordsCount = await ComplianceRecord.countDocuments({ complianceRule: id });
  if (recordsCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete compliance rule "${rule.name}" because it is referenced by ${recordsCount} existing compliance record(s). Deactivate the rule instead.`
    );
  }

  // Safety check 2: block deletion if active tasks reference compliance records for this rule
  const complianceRecordIds = await ComplianceRecord.distinct('_id', { complianceRule: id });
  if (complianceRecordIds.length > 0) {
    const taskCount = await Task.countDocuments({
      complianceRecord: { $in: complianceRecordIds },
      status: { $in: ['open', 'in_progress', 'pending_approval'] },
    });
    if (taskCount > 0) {
      throw ApiError.badRequest(
        `Cannot delete compliance rule "${rule.name}" because ${taskCount} active task(s) reference its compliance records. Complete or cancel those tasks first.`
      );
    }
  }

  await ComplianceRule.findByIdAndDelete(id);

  await logAuditEvent({
    action: 'DELETE',
    resource: 'ComplianceRule',
    resourceId: id,
    userId: (req.user?._id || req.auth?.userId)?.toString(),
    userEmail: req.user?.email || (req.auth as any)?.email,
    userRole: (req.user?.role as any)?.code || req.auth?.role,
    description: `Deleted compliance rule "${rule.name}" (${rule.code})`,
    req,
  });

  return ApiResponse.success(res, null, `Compliance rule "${rule.name}" deleted successfully`);
});

// ── 7. Evaluate Rule Applicability (Rule Engine Endpoint) ─────────────────────
export const evaluateRuleApplicability = asyncHandler(async (req: Request, res: Response) => {
  const { ruleId, entityId, locationId } = req.body;

  if (ruleId) {
    // Evaluate single rule against entity/location
    const result = await RuleEngineService.evaluateSingleRule(ruleId, {
      entityId,
      locationId,
    });
    return ApiResponse.success(res, result);
  }

  // Find all applicable rules for this target
  if (!entityId && !locationId) {
    throw ApiError.badRequest('Must provide at least entityId or locationId for evaluation');
  }

  const result = await RuleEngineService.getApplicableRules({
    entityId,
    locationId,
  });

  return ApiResponse.success(res, result);
});

// ── 8. Archive Compliance Rule (Feature F) ────────────────────────────────────
export const archiveComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Compliance Rule ID format');
  }

  const rule = await ComplianceRule.findById(id);
  if (!rule) {
    throw ApiError.notFound(`Compliance Rule with ID "${id}" not found`);
  }

  if (rule.status === 'archived') {
    throw ApiError.badRequest(`Rule "${rule.name}" is already archived`);
  }

  rule.status = 'archived';
  rule.active = false;
  rule.updatedBy = req.user?._id || req.auth?.userId;
  await rule.save();

  await logAuditEvent({
    action: 'UPDATE',
    resource: 'ComplianceRule',
    resourceId: id,
    userId: (req.user?._id || req.auth?.userId)?.toString(),
    userEmail: req.user?.email || (req.auth as any)?.email,
    userRole: (req.user?.role as any)?.code || req.auth?.role,
    description: `Archived compliance rule "${rule.name}" (${rule.code})`,
    req,
  });

  return ApiResponse.success(res, { rule }, `Compliance rule "${rule.name}" has been archived`);
});

