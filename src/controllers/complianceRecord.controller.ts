/**
 * Compliance Record Controller
 *
 * Implements full CRUD, status update transitions, document associations,
 * date-range filtering, and real MongoDB aggregated metrics.
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import ComplianceRecord, { ComplianceRecordStatus } from '../models/ComplianceRecord.js';
import ComplianceRule from '../models/ComplianceRule.js';
import Location from '../models/Location.js';
import Entity from '../models/Entity.js';
import AuditLog from '../models/AuditLog.js';
import { RuleEngineService } from '../services/ruleEngine.service.js';
import { ApprovalWorkflowService } from '../services/approvalWorkflow.service.js';
import {
  createComplianceRecordSchema,
  updateComplianceRecordSchema,
  updateComplianceStatusSchema,
  executeWorkflowActionSchema,
  complianceRecordQuerySchema,
} from '../validations/complianceRecord.validation.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ── 1. Get Compliance Records (Paginated, Filtered & Real Counts) ──────────────
export const getComplianceRecords = asyncHandler(async (req: Request, res: Response) => {
  const query = complianceRecordQuerySchema.parse(req.query);

  const filter: Record<string, any> = {};

  // RBAC entity/location scoping
  const userRole = req.auth?.role;
  const userEntityId = req.auth?.entityId;
  const userLocationId = req.auth?.locationId;

  if (userRole === 'entity_admin' && userEntityId) {
    filter.entity = new Types.ObjectId(userEntityId);
  } else if (userRole === 'location_manager' && userLocationId) {
    filter.location = new Types.ObjectId(userLocationId);
  }

  // Explicit filters
  if (query.entity) {
    filter.entity = new Types.ObjectId(query.entity);
  }
  if (query.location) {
    filter.location = new Types.ObjectId(query.location);
  }
  if (query.rule) {
    filter.$or = [
      { rule: new Types.ObjectId(query.rule) },
      { complianceRule: new Types.ObjectId(query.rule) },
    ];
  }
  if (query.status) {
    filter.status = query.status;
  }
  if (query.assignedUser) {
    filter.assignedUser = new Types.ObjectId(query.assignedUser);
  }

  // Date range filters
  if (query.dueDateFrom || query.dueDateTo) {
    filter.dueDate = {};
    if (query.dueDateFrom) filter.dueDate.$gte = new Date(query.dueDateFrom);
    if (query.dueDateTo) filter.dueDate.$lte = new Date(query.dueDateTo);
  }

  if (query.expiryDateFrom || query.expiryDateTo) {
    filter.expiryDate = {};
    if (query.expiryDateFrom) filter.expiryDate.$gte = new Date(query.expiryDateFrom);
    if (query.expiryDateTo) filter.expiryDate.$lte = new Date(query.expiryDateTo);
  }

  // Text search on recordNumber or regex on populated rule/location
  if (query.search) {
    const searchRegex = new RegExp(query.search.trim(), 'i');
    filter.$or = [{ recordNumber: searchRegex }, { comments: searchRegex }, { notes: searchRegex }];
  }

  const page = query.page;
  const limit = query.limit;
  const skip = (page - 1) * limit;

  const sort: Record<string, 1 | -1> = {
    [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1,
  };

  const [records, total, metricsAggregation] = await Promise.all([
    ComplianceRecord.find(filter)
      .populate('entity', 'name entityCode address')
      .populate('location', 'name locationCode address')
      .populate({
        path: 'rule',
        populate: [
          { path: 'category', select: 'code label' },
          { path: 'frequency', select: 'code label' },
          { path: 'requiredDocuments.documentType', select: 'code label' },
        ],
      })
      .populate('assignedUser', 'firstName lastName email fullName')
      .populate('documents', 'name fileName fileSize verificationStatus currentVersion fileUrl')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),

    ComplianceRecord.countDocuments(filter),

    // Real status counts for summary metrics
    ComplianceRecord.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  // Format real metrics
  const statusCounts: Record<string, number> = {
    total: 0,
    pending: 0,
    submitted: 0,
    under_review: 0,
    approved: 0,
    rejected: 0,
    expiring_soon: 0,
    expired: 0,
  };

  metricsAggregation.forEach((item: { _id: string; count: number }) => {
    if (statusCounts[item._id] !== undefined) {
      statusCounts[item._id] = item.count;
    }
    statusCounts.total += item.count;
  });

  return ApiResponse.success(res, {
    records,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
    metrics: statusCounts,
  });
});

// ── 2. Get Single Compliance Record By ID ─────────────────────────────────────
export const getComplianceRecordById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const record = await ComplianceRecord.findById(id)
    .populate('entity', 'name entityCode address contactEmail contactPhone')
    .populate('location', 'name locationCode address manager contactEmail')
    .populate({
      path: 'rule',
      populate: [
        { path: 'category', select: 'code label description' },
        { path: 'frequency', select: 'code label description' },
        { path: 'applicableEntityTypes', select: 'code label' },
        { path: 'applicableLocationTypes', select: 'code label' },
        { path: 'requiredDocuments.documentType', select: 'code label description' },
      ],
    })
    .populate('assignedUser', 'firstName lastName email fullName')
    .populate({
      path: 'documents',
      populate: [
        { path: 'uploadedBy', select: 'firstName lastName email fullName' },
        { path: 'verifiedBy', select: 'firstName lastName email fullName' },
        { path: 'versions.uploadedBy', select: 'firstName lastName email fullName' },
      ],
    })
    .populate('approvals.approver', 'firstName lastName email fullName role');

  if (!record) {
    throw ApiError.notFound('Compliance record not found.');
  }

  return ApiResponse.success(res, { record });
});

// ── 3. Create Compliance Record ───────────────────────────────────────────────
export const createComplianceRecord = asyncHandler(async (req: Request, res: Response) => {
  const validated = createComplianceRecordSchema.parse(req.body);

  const [entity, location, rule] = await Promise.all([
    Entity.findById(validated.entity),
    Location.findById(validated.location),
    ComplianceRule.findById(validated.rule),
  ]);

  if (!entity) throw ApiError.notFound('Target entity not found.');
  if (!location) throw ApiError.notFound('Target location not found.');
  if (!rule) throw ApiError.notFound('Target compliance rule not found.');

  // Check if a record already exists for this (location × rule)
  const existing = await ComplianceRecord.findOne({
    location: validated.location,
    rule: validated.rule,
  });
  if (existing) {
    throw ApiError.conflict('A compliance record already exists for this Location and Compliance Rule.');
  }

  // Calculate default due date if not provided
  let dueDate = validated.dueDate ? new Date(validated.dueDate) : undefined;
  if (!dueDate && rule.renewalCycle) {
    dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (rule.renewalCycle || 30));
  } else if (!dueDate) {
    dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
  }

  const record = new ComplianceRecord({
    entity: validated.entity,
    location: validated.location,
    rule: validated.rule,
    complianceRule: validated.rule,
    assignedUser: validated.assignedUser || undefined,
    dueDate,
    expiryDate: validated.expiryDate ? new Date(validated.expiryDate) : undefined,
    comments: validated.comments,
    notes: validated.notes,
    status: validated.status || 'pending',
    currentVersion: 1,
    createdBy: req.auth?.userId,
    updatedBy: req.auth?.userId,
  });

  await record.save();

  // Audit Log
  await AuditLog.create({
    user: req.auth?.userId,
    action: 'CREATE',
    resource: 'ComplianceRecord',
    resourceId: record._id,
    entity: record.entity,
    location: record.location,
    description: `Created compliance record "${record.recordNumber}" for rule "${rule.name}"`,
    metadata: {
      ruleCode: rule.code,
      locationId: validated.location,
      dueDate,
    },
  });

  const populated = await ComplianceRecord.findById(record._id)
    .populate('entity', 'name entityCode')
    .populate('location', 'name locationCode')
    .populate('rule', 'name code');

  return ApiResponse.created(res, { record: populated }, 'Compliance record created successfully');
});

// ── 4. Update Compliance Record ───────────────────────────────────────────────
export const updateComplianceRecord = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const validated = updateComplianceRecordSchema.parse(req.body);

  const record = await ComplianceRecord.findById(id);
  if (!record) throw ApiError.notFound('Compliance record not found.');

  if (validated.assignedUser !== undefined) record.assignedUser = validated.assignedUser as any;
  if (validated.dueDate) record.dueDate = new Date(validated.dueDate);
  if (validated.expiryDate) record.expiryDate = new Date(validated.expiryDate);
  if (validated.submissionDate) record.submissionDate = new Date(validated.submissionDate);
  if (validated.approvalDate) record.approvalDate = new Date(validated.approvalDate);
  if (validated.comments !== undefined) record.comments = validated.comments;
  if (validated.notes !== undefined) record.notes = validated.notes;
  if (validated.status) record.status = validated.status as ComplianceRecordStatus;

  record.updatedBy = req.auth?.userId as any;
  await record.save();

  await AuditLog.create({
    user: req.auth?.userId,
    action: 'UPDATE',
    resource: 'ComplianceRecord',
    resourceId: record._id,
    entity: record.entity,
    location: record.location,
    description: `Updated compliance record "${record.recordNumber}"`,
  });

  const populated = await ComplianceRecord.findById(record._id)
    .populate('entity', 'name entityCode')
    .populate('location', 'name locationCode')
    .populate('rule', 'name code')
    .populate('assignedUser', 'firstName lastName email fullName');

  return ApiResponse.success(res, { record: populated }, 'Compliance record updated successfully');
});

// ── 5. Update Status Transition (Submit, Review, Approve, Reject, Expire) ──────
export const updateComplianceRecordStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, comments, decision } = updateComplianceStatusSchema.parse(req.body);

  const record = await ComplianceRecord.findById(id);
  if (!record) throw ApiError.notFound('Compliance record not found.');

  const previousStatus = record.status;

  // Strict rule: Approved record cannot be transitioned back
  if (
    previousStatus === 'approved' &&
    ['submitted', 'under_review', 'pending', 'correction', 'resubmitted', 'rejected'].includes(
      status
    )
  ) {
    throw ApiError.badRequest(
      `Invalid transition: Record is already Approved. Cannot transition back to "${status}".`
    );
  }

  record.status = status as ComplianceRecordStatus;

  // Timestamps
  if (status === 'submitted' && !record.submissionDate) {
    record.submissionDate = new Date();
  }
  if (status === 'approved') {
    record.approvalDate = new Date();
    // If rule has renewal cycle, update nextRenewalDate
    const rule = await ComplianceRule.findById(record.rule || record.complianceRule);
    if (rule?.renewalCycle && !record.expiryDate) {
      const exp = new Date();
      exp.setDate(exp.getDate() + rule.renewalCycle);
      record.expiryDate = exp;
    }
  }

  if (comments) {
    record.comments = comments;
  }

  // Append to approval audit trail
  const approvalEntry = {
    _id: new Types.ObjectId(),
    level: (record.currentApprovalLevel || 0) + 1,
    approver: new Types.ObjectId(req.auth?.userId),
    decision: decision || (status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending'),
    comments,
    decidedAt: new Date(),
    requestedAt: new Date(),
  };

  record.approvals.push(approvalEntry as any);
  record.currentApprovalLevel = approvalEntry.level;
  record.updatedBy = req.auth?.userId as any;

  await record.save();

  // Audit log
  await AuditLog.create({
    user: req.auth?.userId,
    action: 'STATUS_CHANGE',
    resource: 'ComplianceRecord',
    resourceId: record._id,
    entity: record.entity,
    location: record.location,
    description: `Compliance record "${record.recordNumber}" transitioned from ${previousStatus} to ${status}`,
    metadata: { previousStatus, newStatus: status, comments },
  });

  const updatedRecord = await ComplianceRecord.findById(id)
    .populate('entity', 'name entityCode')
    .populate('location', 'name locationCode')
    .populate('rule', 'name code')
    .populate('assignedUser', 'firstName lastName email fullName')
    .populate('approvals.approver', 'firstName lastName email fullName');

  return ApiResponse.success(
    res,
    { record: updatedRecord },
    `Compliance record status updated to ${status.replace('_', ' ').toUpperCase()}`
  );
});

// ── 6. Auto-Initialize Missing Compliance Records For Location ─────────────────
export const generateRecordsForLocation = asyncHandler(async (req: Request, res: Response) => {
  const { locationId } = req.body;
  if (!locationId) throw ApiError.badRequest('Location ID is required.');

  const location = await Location.findById(locationId);
  if (!location) throw ApiError.notFound('Location not found.');

  const entityId = location.entity;

  // Evaluate applicable rules using RuleEngineService
  const applicableRules = await RuleEngineService.getApplicableRules({
    locationId: location._id.toString(),
    entityId: entityId.toString(),
  });

  const createdRecords: any[] = [];

  for (const rule of applicableRules) {
    const existing = await ComplianceRecord.findOne({
      location: location._id,
      rule: rule._id,
    });

    if (!existing) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (rule.renewalCycle || 30));

      const newRecord = new ComplianceRecord({
        entity: entityId,
        location: location._id,
        rule: rule._id,
        complianceRule: rule._id,
        dueDate,
        status: 'pending',
        currentVersion: 1,
        createdBy: req.auth?.userId,
        updatedBy: req.auth?.userId,
      });

      await newRecord.save();
      createdRecords.push(newRecord);
    }
  }

  return ApiResponse.success(
    res,
    {
      createdCount: createdRecords.length,
      records: createdRecords,
      location: location.name,
    },
    `Generated ${createdRecords.length} compliance records for ${location.name}`
  );
});

// ── 7. Delete Compliance Record ───────────────────────────────────────────────
export const deleteComplianceRecord = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const record = await ComplianceRecord.findById(id);
  if (!record) throw ApiError.notFound('Compliance record not found.');

  await ComplianceRecord.findByIdAndDelete(id);

  await AuditLog.create({
    user: req.auth?.userId,
    action: 'DELETE',
    resource: 'ComplianceRecord',
    resourceId: record._id,
    entity: record.entity,
    location: record.location,
    description: `Deleted compliance record "${record.recordNumber}"`,
  });

  return ApiResponse.success(res, null, 'Compliance record deleted successfully');
});

// ── 8. Execute Workflow Action (Submit, Review, Approve, Reject, Request Correction, Resubmit) ──
export const executeWorkflowAction = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const validated = executeWorkflowActionSchema.parse(req.body);

  const result = await ApprovalWorkflowService.executeWorkflowAction({
    recordId: id,
    action: validated.action,
    comments: validated.comments,
    user: {
      userId: req.auth!.userId,
      email: req.auth!.email,
      role: req.auth!.role,
      entityId: req.auth!.entityId,
    },
  });

  return ApiResponse.success(
    res,
    {
      record: result.record,
      approval: result.approval,
    },
    `Action "${validated.action}" applied successfully. Status is now "${result.record.status}".`
  );
});

// ── 9. Get Workflow History & Available Actions ───────────────────────────────
export const getComplianceRecordApprovals = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const record = await ComplianceRecord.findById(id);
  if (!record) {
    throw ApiError.notFound('Compliance record not found.');
  }

  const [approvals, availableActions] = await Promise.all([
    ApprovalWorkflowService.getRecordApprovals(id, 'desc'),
    ApprovalWorkflowService.getAvailableActions(record, {
      userId: req.auth!.userId,
      email: req.auth!.email,
      role: req.auth!.role,
      entityId: req.auth!.entityId,
    }),
  ]);

  return ApiResponse.success(res, {
    currentStatus: record.status,
    approvals,
    availableActions,
  });
});

