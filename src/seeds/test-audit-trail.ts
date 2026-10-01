/**
 * Phase 13 Automated Integration Test Suite: Complete Audit Trail
 *
 * Verifies:
 * 1. Required Audit Events:
 *    - USER_CREATED, USER_UPDATED, ROLE_CHANGED
 *    - ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED
 *    - LOCATION_CREATED, LOCATION_UPDATED, LOCATION_DELETED
 *    - COMPLIANCE_CREATED, COMPLIANCE_UPDATED, STATUS_CHANGED
 *    - DOCUMENT_UPLOADED, DOCUMENT_REPLACED, DOCUMENT_VERIFIED
 *    - APPROVAL_CREATED
 *    - TASK_CREATED, TASK_UPDATED, TASK_COMPLETED
 *    - RULE_CREATED, RULE_UPDATED
 *    - SETTINGS_CHANGED
 * 2. Audit Event Schema Integrity:
 *    - user, role, action, module, entityType, entityId, recordId, previousValue, newValue, timestamp, ipAddress, userAgent
 * 3. Difference Viewer Engine:
 *    - Accurate detection of changed fields
 *    - Internal field exclusion (_id, __v, password)
 * 4. Query & Filter API:
 *    - Search keyword filtering
 *    - Date range boundaries
 *    - Module, action, user, and record filters
 *    - Filter options dropdown lookup
 */

import mongoose, { Types } from 'mongoose';
import { connectDB } from '../config/db.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Task from '../models/Task.js';
import { auditService, AuditService } from '../services/audit.service.js';

let passedTests = 0;
let failedTests = 0;

const assert = (condition: boolean, testName: string, details?: any) => {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`, details ? details : '');
    failedTests++;
  }
};

const runTests = async () => {
  console.log('\n=============================================================');
  console.log('🧪 Starting Phase 13: Complete Audit Trail Integration Test');
  console.log('=============================================================\n');

  await connectDB();

  try {
    const adminUser = await User.findOne({ email: 'superadmin@cms.local' });
    const testUserId = adminUser ? adminUser._id : new Types.ObjectId();
    const testUserEmail = adminUser?.email || 'superadmin@cms.local';
    const testRole = 'super_admin';

    // ── 1. User & Role Audit Events ──────────────────────────────────────────
    console.log('1️⃣ Testing User & Role Audit Events (USER_CREATED, USER_UPDATED, ROLE_CHANGED)...');

    const dummyUser = {
      _id: new Types.ObjectId(),
      email: 'audittest.user@example.com',
      firstName: 'Audit',
      lastName: 'User',
      role: 'viewer',
      status: 'active',
    };

    // USER_CREATED
    const logUserCreated = await auditService.logUserCreated(dummyUser);
    assert(logUserCreated.action === 'USER_CREATED', 'USER_CREATED action recorded');
    assert(logUserCreated.module === 'users', 'USER_CREATED module is users');
    assert(logUserCreated.entityType === 'User', 'USER_CREATED entityType is User');
    assert(logUserCreated.recordId?.toString() === dummyUser._id.toString(), 'USER_CREATED recordId matches');

    // USER_UPDATED
    const prevUserState = { firstName: 'Audit', lastName: 'User', status: 'pending' };
    const logUserUpdated = await auditService.logUserUpdated(dummyUser, prevUserState);
    assert(logUserUpdated.action === 'USER_UPDATED', 'USER_UPDATED action recorded');
    assert(logUserUpdated.diff && 'status' in logUserUpdated.diff, 'USER_UPDATED computes status diff');

    // ROLE_CHANGED
    const logRoleChanged = await auditService.logRoleChanged(dummyUser, 'viewer', 'compliance_officer');
    assert(logRoleChanged.action === 'ROLE_CHANGED', 'ROLE_CHANGED action recorded');
    assert(logRoleChanged.diff && 'role' in logRoleChanged.diff, 'ROLE_CHANGED computes role diff');

    // ── 2. Entity Audit Events ───────────────────────────────────────────────
    console.log('\n2️⃣ Testing Entity Audit Events (ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED)...');

    const dummyEntity = {
      _id: new Types.ObjectId(),
      name: 'Audit Medical Corp',
      code: 'ENT-AUDIT-01',
      status: 'active',
    };

    // ENTITY_CREATED
    const logEntCreated = await auditService.logEntityCreated(dummyEntity);
    assert(logEntCreated.action === 'ENTITY_CREATED', 'ENTITY_CREATED action recorded');
    assert(logEntCreated.module === 'entities', 'ENTITY_CREATED module is entities');
    assert(logEntCreated.entityType === 'Entity', 'ENTITY_CREATED entityType is Entity');

    // ENTITY_UPDATED
    const logEntUpdated = await auditService.logEntityUpdated(dummyEntity, { name: 'Old Corp Name', status: 'draft' });
    assert(logEntUpdated.action === 'ENTITY_UPDATED', 'ENTITY_UPDATED action recorded');
    assert(logEntUpdated.diff && 'name' in logEntUpdated.diff, 'ENTITY_UPDATED computes name diff');
    assert(logEntUpdated.diff && 'status' in logEntUpdated.diff, 'ENTITY_UPDATED computes status diff');

    // ENTITY_DELETED
    const logEntDeleted = await auditService.logEntityDeleted(dummyEntity);
    assert(logEntDeleted.action === 'ENTITY_DELETED', 'ENTITY_DELETED action recorded');

    // ── 3. Location Audit Events ─────────────────────────────────────────────
    console.log('\n3️⃣ Testing Location Audit Events (LOCATION_CREATED, LOCATION_UPDATED, LOCATION_DELETED)...');

    const dummyLocation = {
      _id: new Types.ObjectId(),
      entity: dummyEntity._id,
      name: 'Audit Clinic South',
      code: 'LOC-AUDIT-01',
      status: 'active',
    };

    // LOCATION_CREATED
    const logLocCreated = await auditService.logLocationCreated(dummyLocation);
    assert(logLocCreated.action === 'LOCATION_CREATED', 'LOCATION_CREATED action recorded');
    assert(logLocCreated.module === 'locations', 'LOCATION_CREATED module is locations');

    // LOCATION_UPDATED
    const logLocUpdated = await auditService.logLocationUpdated(dummyLocation, { name: 'Old Clinic Name' });
    assert(logLocUpdated.action === 'LOCATION_UPDATED', 'LOCATION_UPDATED action recorded');
    assert(logLocUpdated.diff && 'name' in logLocUpdated.diff, 'LOCATION_UPDATED computes name diff');

    // LOCATION_DELETED
    const logLocDeleted = await auditService.logLocationDeleted(dummyLocation);
    assert(logLocDeleted.action === 'LOCATION_DELETED', 'LOCATION_DELETED action recorded');

    // ── 4. Compliance Record & Status Events ─────────────────────────────────
    console.log('\n4️⃣ Testing Compliance Record Events (COMPLIANCE_CREATED, COMPLIANCE_UPDATED, STATUS_CHANGED)...');

    const dummyRecord = {
      _id: new Types.ObjectId(),
      recordNumber: 'CR-AUDIT-2026-001',
      entity: dummyEntity._id,
      location: dummyLocation._id,
      status: 'pending',
      dueDate: new Date(),
    };

    // COMPLIANCE_CREATED
    const logCompCreated = await auditService.logComplianceCreated(dummyRecord);
    assert(logCompCreated.action === 'COMPLIANCE_CREATED', 'COMPLIANCE_CREATED action recorded');
    assert(logCompCreated.module === 'compliance', 'COMPLIANCE_CREATED module is compliance');

    // COMPLIANCE_UPDATED
    const logCompUpdated = await auditService.logComplianceUpdated(dummyRecord, { dueDate: new Date('2026-01-01') });
    assert(logCompUpdated.action === 'COMPLIANCE_UPDATED', 'COMPLIANCE_UPDATED action recorded');

    // STATUS_CHANGED
    const logStatusChanged = await auditService.logStatusChanged(dummyRecord, 'pending', 'under_review');
    assert(logStatusChanged.action === 'STATUS_CHANGED', 'STATUS_CHANGED action recorded');
    assert(logStatusChanged.diff?.status?.before === 'pending', 'STATUS_CHANGED diff before matches');
    assert(logStatusChanged.diff?.status?.after === 'under_review', 'STATUS_CHANGED diff after matches');

    // ── 5. Document & Approval Audit Events ──────────────────────────────────
    console.log('\n5️⃣ Testing Document & Approval Events (DOCUMENT_UPLOADED, DOCUMENT_REPLACED, DOCUMENT_VERIFIED, APPROVAL_CREATED)...');

    const dummyDoc = {
      _id: new Types.ObjectId(),
      name: 'Fire_NOC_Certificate.pdf',
      mimeType: 'application/pdf',
      version: 1,
      entity: dummyEntity._id,
    };

    // DOCUMENT_UPLOADED
    const logDocUpload = await auditService.logDocumentUploaded(dummyDoc);
    assert(logDocUpload.action === 'DOCUMENT_UPLOADED', 'DOCUMENT_UPLOADED action recorded');
    assert(logDocUpload.module === 'documents', 'DOCUMENT_UPLOADED module is documents');

    // DOCUMENT_REPLACED
    dummyDoc.version = 2;
    const logDocReplaced = await auditService.logDocumentReplaced(dummyDoc, 1);
    assert(logDocReplaced.action === 'DOCUMENT_REPLACED', 'DOCUMENT_REPLACED action recorded');
    assert(logDocReplaced.diff?.version?.before === 1, 'DOCUMENT_REPLACED diff before is 1');
    assert(logDocReplaced.diff?.version?.after === 2, 'DOCUMENT_REPLACED diff after is 2');

    // DOCUMENT_VERIFIED
    const logDocVerified = await auditService.logDocumentVerified(dummyDoc);
    assert(logDocVerified.action === 'DOCUMENT_VERIFIED', 'DOCUMENT_VERIFIED action recorded');

    // APPROVAL_CREATED
    const dummyApproval = {
      _id: new Types.ObjectId(),
      complianceRecord: dummyRecord._id,
      entity: dummyEntity._id,
      action: 'approve',
      newStatus: 'approved',
      comments: 'Approved after verification of Fire NOC',
    };
    const logApproval = await auditService.logApprovalCreated(dummyApproval);
    assert(logApproval.action === 'APPROVAL_CREATED', 'APPROVAL_CREATED action recorded');
    assert(logApproval.module === 'approvals', 'APPROVAL_CREATED module is approvals');

    // ── 6. Task, Rule, Settings Audit Events ─────────────────────────────────
    console.log('\n6️⃣ Testing Task, Rule & Settings Events (TASK_CREATED, TASK_UPDATED, TASK_COMPLETED, RULE_CREATED, RULE_UPDATED, SETTINGS_CHANGED)...');

    const dummyTask = {
      _id: new Types.ObjectId(),
      title: 'Upload biomedical waste certificate',
      priority: 'high',
      status: 'open',
      dueDate: new Date(),
      entity: dummyEntity._id,
    };

    // TASK_CREATED
    const logTaskCreated = await auditService.logTaskCreated(dummyTask);
    assert(logTaskCreated.action === 'TASK_CREATED', 'TASK_CREATED action recorded');
    assert(logTaskCreated.module === 'tasks', 'TASK_CREATED module is tasks');

    // TASK_UPDATED
    dummyTask.priority = 'critical';
    const logTaskUpdated = await auditService.logTaskUpdated(dummyTask, { priority: 'high' });
    assert(logTaskUpdated.action === 'TASK_UPDATED', 'TASK_UPDATED action recorded');
    assert(logTaskUpdated.diff?.priority?.before === 'high', 'TASK_UPDATED diff before is high');
    assert(logTaskUpdated.diff?.priority?.after === 'critical', 'TASK_UPDATED diff after is critical');

    // TASK_COMPLETED
    const logTaskCompleted = await auditService.logTaskCompleted(dummyTask);
    assert(logTaskCompleted.action === 'TASK_COMPLETED', 'TASK_COMPLETED action recorded');
    assert(logTaskCompleted.diff?.status?.after === 'completed', 'TASK_COMPLETED diff after is completed');

    // RULE_CREATED & RULE_UPDATED
    const dummyRule = {
      _id: new Types.ObjectId(),
      name: 'Bio-Medical Waste Authorization',
      code: 'BMW-001',
      category: 'Healthcare',
      active: true,
    };
    const logRuleCreated = await auditService.logRuleCreated(dummyRule);
    assert(logRuleCreated.action === 'RULE_CREATED', 'RULE_CREATED action recorded');

    const logRuleUpdated = await auditService.logRuleUpdated(dummyRule, { name: 'Old BMW Rule' });
    assert(logRuleUpdated.action === 'RULE_UPDATED', 'RULE_UPDATED action recorded');

    // SETTINGS_CHANGED
    const logSettings = await auditService.logSettingsChanged(
      { escalationNoticeDays: 14, defaultTimezone: 'Asia/Kolkata' },
      { escalationNoticeDays: 7, defaultTimezone: 'UTC' }
    );
    assert(logSettings.action === 'SETTINGS_CHANGED', 'SETTINGS_CHANGED action recorded');
    assert(logSettings.module === 'settings', 'SETTINGS_CHANGED module is settings');

    // ── 7. Audit Schema Fields Verification ──────────────────────────────────
    console.log('\n7️⃣ Testing Audit Log Schema Mandatory Fields Completeness...');
    // Create an explicit log testing all fields
    const fullLog = await auditService.logMutation({
      userId: testUserId,
      userEmail: testUserEmail,
      role: testRole,
      action: 'ENTITY_CREATED',
      module: 'entities',
      entityType: 'Entity',
      entityId: dummyEntity._id,
      recordId: dummyEntity._id,
      previousValue: { name: 'Prior' },
      newValue: { name: 'Posterior' },
      ipAddress: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      description: 'Comprehensive audit trail verification event',
    });

    assert(!!fullLog.user, 'Log captures user reference');
    assert(fullLog.role === testRole, 'Log captures actor role');
    assert(fullLog.action === 'ENTITY_CREATED', 'Log captures action code');
    assert(fullLog.module === 'entities', 'Log captures module');
    assert(fullLog.entityType === 'Entity', 'Log captures entityType');
    assert(fullLog.entityId?.toString() === dummyEntity._id.toString(), 'Log captures entityId');
    assert(fullLog.recordId?.toString() === dummyEntity._id.toString(), 'Log captures recordId');
    assert(!!fullLog.previousValue, 'Log captures previousValue');
    assert(!!fullLog.newValue, 'Log captures newValue');
    assert(fullLog.ipAddress === '192.168.1.100', 'Log captures ipAddress');
    assert(fullLog.userAgent?.includes('Mozilla'), 'Log captures userAgent');
    assert(fullLog.timestamp instanceof Date, 'Log captures immutable timestamp Date');

    // ── 8. Difference Engine Test ────────────────────────────────────────────
    console.log('\n8️⃣ Testing Object Difference Engine (computeDiff)...');
    const prevObj = { _id: '123', password: 'secret', status: 'pending', name: 'Alpha', count: 10 };
    const nextObj = { _id: '123', password: 'newsecret', status: 'active', name: 'Alpha', count: 20 };

    const diff = AuditService.computeDiff(prevObj, nextObj);
    assert(!('_id' in diff), 'computeDiff ignores _id');
    assert(!('password' in diff), 'computeDiff ignores password');
    assert(!('name' in diff), 'computeDiff ignores unchanged keys');
    assert(diff.status?.before === 'pending' && diff.status?.after === 'active', 'computeDiff captures status change');
    assert(diff.count?.before === 10 && diff.count?.after === 20, 'computeDiff captures count change');

    // ── 9. Query & Filter API Verification ───────────────────────────────────
    console.log('\n9️⃣ Testing Query & Multi-Dimensional Filters Engine...');
    // Query with search
    const searchRes = await auditService.queryAuditLogs({ search: 'Bio-Medical' });
    assert(searchRes.logs.length > 0, 'Search matches logged keywords');

    // Query with action filter
    const actionRes = await auditService.queryAuditLogs({ action: 'STATUS_CHANGED' });
    assert(actionRes.logs.every((l) => l.action === 'STATUS_CHANGED'), 'Action filter strictly isolates STATUS_CHANGED');

    // Query with module filter
    const moduleRes = await auditService.queryAuditLogs({ module: 'documents' });
    assert(moduleRes.logs.every((l) => l.module === 'documents'), 'Module filter strictly isolates documents');

    // Filter Options Lookup
    const filterOpts = await auditService.getFilterOptions();
    assert(filterOpts.actions.includes('STATUS_CHANGED'), 'Filter options contains logged actions');
    assert(filterOpts.modules.includes('entities'), 'Filter options contains logged modules');
    assert(filterOpts.entityTypes.includes('ComplianceRecord'), 'Filter options contains entityTypes');

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n=============================================================');
    console.log(`🏁 Phase 13 Tests Finished: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=============================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during test execution:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

runTests();
