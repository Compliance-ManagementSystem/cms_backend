/**
 * Phase 10 Automated Integration Test Suite
 *
 * Verifies:
 * 1. Automatic Task Generation:
 *    - Compliance approaching expiry
 *    - Compliance expired
 *    - Pending approval
 *    - Missing documents
 *    - Overdue compliance
 * 2. Duplicate Prevention:
 *    - Running the automation engine repeatedly results in 0 duplicate tasks created.
 * 3. Task Status Lifecycle:
 *    - Status transitions (open -> in_progress -> completed)
 *    - Verification of completedBy and completedAt timestamps
 * 4. Notification Architecture & Dispatch:
 *    - In-app notification creation
 *    - Unread counters
 *    - Mark single & mark all as read
 */

import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRule from '../models/ComplianceRule.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Task from '../models/Task.js';
import Notification from '../models/Notification.js';
import MasterData from '../models/MasterData.js';
import { taskAutomationService } from '../services/taskAutomation.service.js';
import { notificationService } from '../services/notification.service.js';

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
  console.log('🧪 Starting Phase 10: Tasks + Notifications + Automation Test');
  console.log('=============================================================\n');

  await connectDB();

  try {
    // ── Setup Test Context ──────────────────────────────────────────────────
    console.log('1️⃣ Setting up test entity, location, user and rules...');

    // Find or create test user
    let user = await User.findOne({ email: 'officer@example.com' });
    if (!user) {
      user = await User.findOne({});
    }
    if (!user) {
      throw new Error('No test user found. Please run seed script first.');
    }

    // Find test entity and location
    const entity = await Entity.findOne({ status: 'active' });
    if (!entity) throw new Error('No active entity found.');

    const location = await Location.findOne({ entity: entity._id });
    if (!location) throw new Error('No location found for entity.');

    const complianceCat = (await MasterData.findOne({ category: 'compliance_category', status: 'active' })) ||
      (await MasterData.create({ category: 'compliance_category', name: 'Statutory', code: 'statutory', status: 'active' }));

    const complianceFreq = (await MasterData.findOne({ category: 'compliance_frequency', status: 'active' })) ||
      (await MasterData.create({ category: 'compliance_frequency', name: 'Annual', code: 'annual', status: 'active' }));

    const docType = (await MasterData.findOne({ category: 'document_type', status: 'active' })) ||
      (await MasterData.create({ category: 'document_type', name: 'Audit Report', code: 'audit_report', status: 'active' }));

    // Clean up any previous test tasks, rules, and records with prefix [PHASE-10]
    await Task.deleteMany({ title: { $regex: /\[PHASE-10\]/ } });
    await Notification.deleteMany({ title: { $regex: /\[PHASE-10\]/ } });
    await ComplianceRecord.deleteMany({ comments: { $regex: /\[PHASE-10\]/ } });
    await ComplianceRule.deleteMany({ name: { $regex: /\[PHASE-10\]/ } });

    // ── Create Test Compliance Rules & Records for all 5 triggers ───────────
    console.log('\n2️⃣ Creating test statutory records for each trigger scenario...');

    const createTestRule = async (suffix: string, docs: any[] = []) => {
      return ComplianceRule.create({
        name: `[PHASE-10] Test Rule ${suffix}`,
        code: `RULE-P10-${suffix}-${Date.now()}`,
        category: complianceCat._id,
        applicableEntityTypes: [entity.entityType],
        applicableLocationTypes: [location.locationType],
        frequency: complianceFreq._id,
        renewalCycle: 365,
        requiredDocuments: docs,
        mandatory: true,
        active: true,
      });
    };

    const ruleExpiring = await createTestRule('EXPIRING');
    const ruleExpired = await createTestRule('EXPIRED');
    const rulePendingApproval = await createTestRule('APPROVAL');
    const ruleMissingDoc = await createTestRule('MISSINGDOC', [
      {
        label: 'Annual Audit Report',
        documentType: docType._id,
        isMandatory: true,
      },
    ]);
    const ruleOverdue = await createTestRule('OVERDUE');

    // Scenario A: Approaching Expiry (expires in 7 days)
    const expiryIn7d = new Date();
    expiryIn7d.setDate(expiryIn7d.getDate() + 7);

    const recordExpiring = await ComplianceRecord.create({
      recordNumber: `REC-P10-EXP-7D-${Date.now()}`,
      entity: entity._id,
      location: location._id,
      rule: ruleExpiring._id,
      status: 'approved',
      assignedUser: user._id,
      expiryDate: expiryIn7d,
      dueDate: new Date(Date.now() + 10 * 86400000),
      comments: '[PHASE-10] Approaching expiry test',
    });

    // Scenario B: Already Expired (expired 3 days ago)
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 3);

    const recordExpired = await ComplianceRecord.create({
      recordNumber: `REC-P10-EXPIRED-${Date.now()}`,
      entity: entity._id,
      location: location._id,
      rule: ruleExpired._id,
      status: 'expired',
      assignedUser: user._id,
      expiryDate: expiredDate,
      dueDate: new Date(Date.now() - 15 * 86400000),
      comments: '[PHASE-10] Expired record test',
    });

    // Scenario C: Pending Approval
    const recordPendingApproval = await ComplianceRecord.create({
      recordNumber: `REC-P10-APPROVAL-${Date.now()}`,
      entity: entity._id,
      location: location._id,
      rule: rulePendingApproval._id,
      status: 'under_review',
      assignedUser: user._id,
      dueDate: new Date(Date.now() + 5 * 86400000),
      comments: '[PHASE-10] Under review test',
    });

    // Scenario D: Missing Documents
    const recordMissingDocs = await ComplianceRecord.create({
      recordNumber: `REC-P10-MISSINGDOCS-${Date.now()}`,
      entity: entity._id,
      location: location._id,
      rule: ruleMissingDoc._id,
      status: 'pending',
      assignedUser: user._id,
      documents: [], // 0 documents attached
      dueDate: new Date(Date.now() + 4 * 86400000),
      comments: '[PHASE-10] Missing docs test',
    });

    // Scenario E: Overdue Compliance
    const overdueDate = new Date();
    overdueDate.setDate(overdueDate.getDate() - 5);

    const recordOverdue = await ComplianceRecord.create({
      recordNumber: `REC-P10-OVERDUE-${Date.now()}`,
      entity: entity._id,
      location: location._id,
      rule: ruleOverdue._id,
      status: 'pending',
      assignedUser: user._id,
      dueDate: overdueDate,
      comments: '[PHASE-10] Overdue pending record test',
    });

    console.log('✅ Created 5 test compliance records across all 5 trigger conditions.');

    // ── TEST 1: Automatic Task Generation (First Run) ─────────────────────────
    console.log('\n3️⃣ Executing automatic task generation (Run #1)...');
    const run1Result = await taskAutomationService.generateComplianceTasks();

    console.log(
      `   Run 1 Results: ${run1Result.createdTasksCount} tasks created, ${run1Result.notificationsCount} notifications sent.`
    );

    assert(
      run1Result.createdTasksCount >= 4,
      'Automatic task generation created tasks for triggered conditions',
      { tasksCreated: run1Result.createdTasksCount }
    );

    // Verify task for Approaching Expiry
    const taskExpiring = await Task.findOne({
      complianceRecord: recordExpiring._id,
    });
    assert(
      !!taskExpiring && taskExpiring.status === 'open',
      'Approaching expiry task created with Open status'
    );

    // Verify task for Expired Record
    const taskExpired = await Task.findOne({
      complianceRecord: recordExpired._id,
    });
    assert(
      !!taskExpired && taskExpired.priority === 'critical',
      'Expired compliance task created with Critical priority'
    );

    // Verify task for Pending Review
    const taskPendingReview = await Task.findOne({
      complianceRecord: recordPendingApproval._id,
    });
    assert(
      !!taskPendingReview && taskPendingReview.status === 'pending_approval',
      'Review task created with Pending Approval status'
    );

    // Verify task for Missing Documents
    const taskMissingDocs = await Task.findOne({
      complianceRecord: recordMissingDocs._id,
    });
    assert(
      !!taskMissingDocs && taskMissingDocs.taskType === 'document_upload',
      'Missing documents task created with document_upload type'
    );

    // Verify task for Overdue Record
    const taskOverdue = await Task.findOne({
      complianceRecord: recordOverdue._id,
    });
    assert(
      !!taskOverdue && taskOverdue.status === 'overdue',
      'Overdue record task created with Overdue status'
    );

    // ── TEST 2: Duplicate Prevention Guard (Run #2) ───────────────────────────
    console.log('\n4️⃣ Executing automatic task generation again (Run #2 - Duplicate Check)...');
    const run2Result = await taskAutomationService.generateComplianceTasks();

    console.log(
      `   Run 2 Results: ${run2Result.createdTasksCount} tasks created on duplicate execution.`
    );

    assert(
      run2Result.createdTasksCount === 0,
      'Strict duplicate prevention: 0 duplicate tasks created on second run',
      { secondRunCreated: run2Result.createdTasksCount }
    );

    // Double check specific autoGenKey uniqueness
    const expiringTasksCount = await Task.countDocuments({
      complianceRecord: recordExpiring._id,
    });
    assert(
      expiringTasksCount === 1,
      'Exactly 1 task exists for approaching expiry record (no duplicates)',
      { count: expiringTasksCount }
    );

    const expiredTasksCount = await Task.countDocuments({
      complianceRecord: recordExpired._id,
    });
    assert(
      expiredTasksCount === 1,
      'Exactly 1 task exists for expired record (no duplicates)',
      { count: expiredTasksCount }
    );

    // ── TEST 3: Task Status Transitions & Completion Tracking ────────────────
    console.log('\n5️⃣ Testing Task status lifecycle and completion tracking...');

    assert(taskExpiring!.status === 'open', 'Initial task status is open');

    // Update to in_progress
    const inProgressTask = await taskAutomationService.updateTask(
      taskExpiring!._id.toString(),
      { status: 'in_progress' },
      user._id.toString()
    );
    assert(
      inProgressTask.status === 'in_progress',
      'Task updated to In Progress status'
    );

    // Update to completed
    const completedTask = await taskAutomationService.updateTask(
      taskExpiring!._id.toString(),
      { status: 'completed' },
      user._id.toString()
    );

    assert(
      completedTask.status === 'completed',
      'Task status successfully transitioned to Completed'
    );
    const completedById =
      (completedTask.completedBy as any)?._id?.toString() ||
      completedTask.completedBy?.toString();
    assert(
      completedById === user._id.toString(),
      'completedBy field automatically populated with user ID'
    );
    assert(
      !!completedTask.completedAt && completedTask.completedAt <= new Date(),
      'completedAt timestamp automatically recorded upon completion'
    );

    // ── TEST 4: Task Filtering & Metrics ─────────────────────────────────────
    console.log('\n6️⃣ Testing Task query filters & metrics...');

    const metrics = await taskAutomationService.getTaskMetrics();
    assert(
      metrics.total > 0 && metrics.completed >= 1,
      'Task metrics correctly aggregate status counts',
      metrics
    );

    const overdueList = await taskAutomationService.getTasks({ overdueOnly: true });
    assert(
      overdueList.tasks.length >= 1,
      'getTasks with overdueOnly: true returns overdue tasks',
      { overdueCount: overdueList.tasks.length }
    );

    const userTasks = await taskAutomationService.getTasks({
      assignedTo: user._id.toString(),
    });
    assert(
      userTasks.tasks.length >= 1,
      'getTasks correctly filters by assignedTo user',
      { assignedCount: userTasks.tasks.length }
    );

    // ── TEST 5: Notifications & Read/Unread Status ───────────────────────────
    console.log('\n7️⃣ Testing in-app Notifications & mark-as-read...');

    const testNotif = await notificationService.dispatchNotification({
      recipientId: user._id.toString(),
      type: 'task_assigned',
      title: '[PHASE-10] Direct Test Notification',
      body: 'Testing notification delivery channels and read state.',
      relatedTask: taskExpiring!._id,
      channels: ['in_app', 'email'],
    });

    assert(
      !!testNotif && !testNotif.isRead,
      'Notification dispatched with isRead: false'
    );

    const initialUnreadCount = await notificationService.getUnreadCount(
      user._id.toString()
    );
    assert(
      initialUnreadCount >= 1,
      'getUnreadCount returns positive unread notification count',
      { unreadCount: initialUnreadCount }
    );

    // Mark single notification as read
    const readNotif = await notificationService.markAsRead(
      testNotif._id.toString(),
      user._id.toString()
    );
    assert(
      readNotif?.isRead === true && !!readNotif.readAt,
      'markAsRead sets isRead: true and attaches readAt timestamp'
    );

    // Mark all as read
    const markedCount = await notificationService.markAllAsRead(
      user._id.toString()
    );
    const unreadCountAfter = await notificationService.getUnreadCount(
      user._id.toString()
    );
    assert(
      unreadCountAfter === 0,
      'markAllAsRead sets all user notifications to read (unreadCount: 0)',
      { unreadCountAfter, markedCount }
    );

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n=============================================================');
    console.log(
      `🏁 Phase 10 Tests Finished: ${passedTests} PASSED, ${failedTests} FAILED`
    );
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
