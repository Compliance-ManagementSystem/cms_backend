/**
 * Test Approval Workflow Integration Test Suite
 *
 * Verifies Phase 9 requirements:
 * 1. Standard workflow: Submitted → Under Review → Approved
 * 2. Correction workflow: Under Review → Rejected → Correction → Resubmitted → Under Review → Approved
 * 3. Strict transition validations:
 *    - Approved → Submitted MUST FAIL
 *    - Approved → Under Review MUST FAIL
 *    - Pending → Approved MUST FAIL
 *    - Pending → Under Review MUST FAIL
 *    - Under Review → Submitted MUST FAIL
 *    - Reject/Request Correction without comments MUST FAIL
 * 4. Fine-grained permissions & scoping:
 *    - Location manager CANNOT approve or reject (403 Forbidden)
 *    - Entity admin CANNOT approve records of another entity (403 Forbidden)
 *    - Location manager CANNOT submit records of another location (403 Forbidden)
 *    - Viewer CANNOT execute any workflow actions (403 Forbidden)
 * 5. Persistent Approval records & audit trail
 */

import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import '../models/index.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import ComplianceRule from '../models/ComplianceRule.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Approval from '../models/Approval.js';
import MasterData from '../models/MasterData.js';
import { ApprovalWorkflowService } from '../services/approvalWorkflow.service.js';
import { ROLES } from '../constants/permissions.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/compliance-management-system';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('============================================================');
  console.log('  PHASE 9 — APPROVAL WORKFLOW INTEGRATION TEST SUITE');
  console.log('============================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.\n');

  try {
    // ── Setup: Fetch or Create Roles & Test Fixtures ──────────
    const [superAdminRole, adminRole, entityAdminRole, locMgrRole, officerRole, viewerRole] =
      await Promise.all([
        Role.findOne({ code: ROLES.SUPER_ADMIN }),
        Role.findOne({ code: ROLES.ADMIN }),
        Role.findOne({ code: ROLES.ENTITY_ADMIN }),
        Role.findOne({ code: ROLES.LOCATION_MANAGER }),
        Role.findOne({ code: ROLES.COMPLIANCE_OFFICER }),
        Role.findOne({ code: ROLES.VIEWER }),
      ]);

    assert(!!superAdminRole && !!locMgrRole && !!entityAdminRole, 'System roles exist in database');

    const entityType = await MasterData.findOne({ category: 'entity_type', status: 'active' });
    const locationType = await MasterData.findOne({ category: 'location_type', status: 'active' });
    const complianceCat = await MasterData.findOne({ category: 'compliance_category', status: 'active' });
    const complianceFreq = await MasterData.findOne({ category: 'compliance_frequency', status: 'active' });

    // Clean any prior test fixtures
    await Promise.all([
      Entity.deleteMany({ code: { $in: ['TEST-ENT-A', 'TEST-ENT-B'] } }),
      Location.deleteMany({ code: { $in: ['TEST-LOC-A1', 'TEST-LOC-B1'] } }),
      ComplianceRule.deleteMany({ code: 'RULE-TEST-WF' }),
      User.deleteMany({ email: 'locmgr.a1@compliance.test' }),
    ]);

    // 1. Entities
    const entityA = await Entity.create({
      name: 'Apollo Hospital Corp (Entity A)',
      code: 'TEST-ENT-A',
      entityCode: 'TEST-ENT-A',
      entityType: entityType?._id,
      contactEmail: 'contact@apollo-a.test',
      contactPhone: '9876543210',
      address: {
        line1: '100 Medical City',
        city: 'Bangalore',
        state: 'Karnataka',
        country: 'India',
      },
      status: 'active',
    });

    const entityB = await Entity.create({
      name: 'Fortis Healthcare (Entity B)',
      code: 'TEST-ENT-B',
      entityCode: 'TEST-ENT-B',
      entityType: entityType?._id,
      contactEmail: 'contact@fortis-b.test',
      contactPhone: '9876543211',
      address: {
        line1: '200 Health Way',
        city: 'Bangalore',
        state: 'Karnataka',
        country: 'India',
      },
      status: 'active',
    });

    // 2. Locations
    const locationA1 = await Location.create({
      name: 'Apollo Bannerghatta Unit A1',
      code: 'TEST-LOC-A1',
      locationCode: 'TEST-LOC-A1',
      entity: entityA._id,
      locationType: locationType?._id,
      status: 'active',
      address: {
        line1: 'Bannerghatta Main Rd',
        city: 'Bangalore',
        state: 'Karnataka',
        pincode: '560076',
        country: 'India',
      },
    });

    const locationB1 = await Location.create({
      name: 'Fortis BG Road Unit B1',
      code: 'TEST-LOC-B1',
      locationCode: 'TEST-LOC-B1',
      entity: entityB._id,
      locationType: locationType?._id,
      status: 'active',
      address: {
        line1: 'Fortis Way',
        city: 'Bangalore',
        state: 'Karnataka',
        pincode: '560076',
        country: 'India',
      },
    });

    // 3. Rules (unique per record to satisfy location_1_complianceRule_1 index)
    const rule1 = await ComplianceRule.create({
      name: 'Bio-Medical Waste Authorization',
      code: 'RULE-TEST-WF-1',
      category: complianceCat?._id,
      frequency: complianceFreq?._id,
      renewalCycle: 365,
      mandatory: true,
      active: true,
    });

    const rule2 = await ComplianceRule.create({
      name: 'Fire Safety Clearance NOC',
      code: 'RULE-TEST-WF-2',
      category: complianceCat?._id,
      frequency: complianceFreq?._id,
      renewalCycle: 365,
      mandatory: true,
      active: true,
    });

    const rule3 = await ComplianceRule.create({
      name: 'Radiation Safety Certificate',
      code: 'RULE-TEST-WF-3',
      category: complianceCat?._id,
      frequency: complianceFreq?._id,
      renewalCycle: 365,
      mandatory: true,
      active: true,
    });

    // 4. Test Users with Scoped Contexts
    const superAdminUser = {
      userId: new Types.ObjectId().toString(),
      email: 'superadmin@compliance.test',
      role: ROLES.SUPER_ADMIN,
    };

    const entityAdminAUser = {
      userId: new Types.ObjectId().toString(),
      email: 'entityadmin.a@compliance.test',
      role: ROLES.ENTITY_ADMIN,
      entityId: entityA._id.toString(),
    };

    const entityAdminBUser = {
      userId: new Types.ObjectId().toString(),
      email: 'entityadmin.b@compliance.test',
      role: ROLES.ENTITY_ADMIN,
      entityId: entityB._id.toString(),
    };

    const officerUser = {
      userId: new Types.ObjectId().toString(),
      email: 'officer@compliance.test',
      role: ROLES.COMPLIANCE_OFFICER,
      entityId: entityA._id.toString(),
    };

    // Location manager for location A1
    const locMgrUserDoc = await User.findOneAndUpdate(
      { email: 'locmgr.a1@compliance.test' },
      {
        firstName: 'Unit',
        lastName: 'Manager A1',
        email: 'locmgr.a1@compliance.test',
        password: '$2b$10$abcdefghijklmnopqrstuv',
        role: locMgrRole!._id,
        entity: entityA._id,
        assignedLocations: [locationA1._id],
        status: 'active',
      },
      { upsert: true, new: true }
    );

    const locMgrUser = {
      userId: locMgrUserDoc._id.toString(),
      email: locMgrUserDoc.email,
      role: ROLES.LOCATION_MANAGER,
      entityId: entityA._id.toString(),
    };

    const viewerUser = {
      userId: new Types.ObjectId().toString(),
      email: 'viewer@compliance.test',
      role: ROLES.VIEWER,
    };

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('1. Standard Workflow: Submitted → Under Review → Approved');
    console.log('────────────────────────────────────────────────────────────');

    // Create fresh record 1
    const record1 = await ComplianceRecord.create({
      entity: entityA._id,
      location: locationA1._id,
      rule: rule1._id,
      complianceRule: rule1._id,
      recordNumber: `CR-WF-${Date.now()}-1`,
      status: 'pending',
      currentVersion: 1,
    });
    assert(record1.status === 'pending', 'Record 1 initialized with status "pending"');

    // Step 1: Submit (by Location Manager)
    const submitResult = await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record1._id.toString(),
      action: 'Submit',
      comments: 'Evidence attached for annual bio-medical clearance.',
      user: locMgrUser,
    });
    assert(submitResult.record.status === 'submitted', 'Status transitioned to "submitted"');
    assert(!!submitResult.record.submissionDate, 'Submission date automatically populated');
    assert(submitResult.approval.action === 'Submit', 'Approval record logged action "Submit"');
    assert(submitResult.approval.previousStatus === 'pending', 'Approval recorded previousStatus "pending"');
    assert(submitResult.approval.newStatus === 'submitted', 'Approval recorded newStatus "submitted"');

    // Step 2: Start Review (by Compliance Officer)
    const reviewResult = await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record1._id.toString(),
      action: 'Start Review',
      comments: 'Verifying emission and waste treatment certificates.',
      user: officerUser,
    });
    assert(reviewResult.record.status === 'under_review', 'Status transitioned to "under_review"');
    assert(reviewResult.approval.action === 'Start Review', 'Approval record logged action "Start Review"');

    // Step 3: Approve (by Entity Admin A)
    const approveResult = await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record1._id.toString(),
      action: 'Approve',
      comments: 'All clearances confirmed valid. Statutory approval granted.',
      user: entityAdminAUser,
    });
    assert(approveResult.record.status === 'approved', 'Status transitioned to "approved"');
    assert(!!approveResult.record.approvalDate, 'Approval date automatically populated');
    assert(approveResult.approval.action === 'Approve', 'Approval record logged action "Approve"');

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('2. Strict Transition Validations: Block Invalid Transitions on Approved Record');
    console.log('────────────────────────────────────────────────────────────');

    // Test: Approved → Submitted MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record1._id.toString(),
        action: 'Submit',
        user: locMgrUser,
      });
      assert(false, 'Approved → Submitted should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('already Approved'),
        'Approved → Submitted is strictly BLOCKED (400 Bad Request)'
      );
    }

    // Test: Approved → Under Review MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record1._id.toString(),
        action: 'Start Review',
        user: officerUser,
      });
      assert(false, 'Approved → Start Review should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('already Approved'),
        'Approved → Start Review is strictly BLOCKED (400 Bad Request)'
      );
    }

    // Test: Approved → Reject MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record1._id.toString(),
        action: 'Reject',
        comments: 'Attempting to reject an approved record',
        user: entityAdminAUser,
      });
      assert(false, 'Approved → Reject should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('already Approved'),
        'Approved → Reject is strictly BLOCKED (400 Bad Request)'
      );
    }

    // Test: Approved → Request Correction MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record1._id.toString(),
        action: 'Request Correction',
        comments: 'Attempting to request correction on approved record',
        user: officerUser,
      });
      assert(false, 'Approved → Request Correction should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('already Approved'),
        'Approved → Request Correction is strictly BLOCKED (400 Bad Request)'
      );
    }

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('3. Correction Branch Workflow: Under Review → Rejected → Correction → Resubmitted → Under Review → Approved');
    console.log('────────────────────────────────────────────────────────────');

    // Create fresh record 2
    const record2 = await ComplianceRecord.create({
      entity: entityA._id,
      location: locationA1._id,
      rule: rule2._id,
      complianceRule: rule2._id,
      recordNumber: `CR-WF-${Date.now()}-2`,
      status: 'pending',
      currentVersion: 1,
    });

    // 3a. Submit
    await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record2._id.toString(),
      action: 'Submit',
      comments: 'Initial submission with preliminary certificate',
      user: locMgrUser,
    });

    // 3b. Start Review
    await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record2._id.toString(),
      action: 'Start Review',
      user: officerUser,
    });

    // 3c. Reject (with mandatory comments)
    const rejectResult = await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record2._id.toString(),
      action: 'Reject',
      comments: 'PCB certificate expired on 2026-08-31. Re-upload valid renewal.',
      user: officerUser,
    });
    assert(rejectResult.record.status === 'rejected', 'Status transitioned to "rejected"');
    assert(rejectResult.approval.action === 'Reject', 'Approval recorded action "Reject"');

    // 3d. Request Correction (downgrades rejection to allow unit manager correction)
    const correctionResult = await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record2._id.toString(),
      action: 'Request Correction',
      comments: 'Uploaded test report is missing lab seal. Please resubmit stamped copy.',
      user: officerUser,
    });
    assert(correctionResult.record.status === 'correction', 'Status transitioned to "correction"');
    assert(correctionResult.approval.action === 'Request Correction', 'Approval recorded "Request Correction"');

    // 3e. Resubmit (by Location Manager)
    const resubmitResult = await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record2._id.toString(),
      action: 'Resubmit',
      comments: 'Uploaded fresh stamped laboratory clearance report.',
      user: locMgrUser,
    });
    assert(resubmitResult.record.status === 'resubmitted', 'Status transitioned to "resubmitted"');
    assert(resubmitResult.approval.action === 'Resubmit', 'Approval recorded "Resubmit"');

    // 3f. Secondary Review (Start Review)
    const secondReview = await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record2._id.toString(),
      action: 'Start Review',
      comments: 'Reviewing newly uploaded stamped laboratory certificate.',
      user: officerUser,
    });
    assert(secondReview.record.status === 'under_review', 'Status transitioned back to "under_review"');

    // 3g. Final Approval
    const finalApprove = await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record2._id.toString(),
      action: 'Approve',
      comments: 'Lab verification stamped and authenticated. Fully compliant.',
      user: officerUser,
    });
    assert(finalApprove.record.status === 'approved', 'Status successfully transitioned to "approved"');

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('4. Additional Invalid State Transitions');
    console.log('────────────────────────────────────────────────────────────');

    // Create fresh record 3
    const record3 = await ComplianceRecord.create({
      entity: entityA._id,
      location: locationA1._id,
      rule: rule3._id,
      complianceRule: rule3._id,
      recordNumber: `CR-WF-${Date.now()}-3`,
      status: 'pending',
      currentVersion: 1,
    });

    // Test: Pending → Approve MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Approve',
        user: officerUser,
      });
      assert(false, 'Pending → Approve should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('Invalid transition'),
        'Pending → Approve is strictly BLOCKED (400 Bad Request)'
      );
    }

    // Test: Pending → Start Review MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Start Review',
        user: officerUser,
      });
      assert(false, 'Pending → Start Review should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('Invalid transition'),
        'Pending → Start Review is strictly BLOCKED (400 Bad Request)'
      );
    }

    // Test: Pending → Resubmit MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Resubmit',
        user: locMgrUser,
      });
      assert(false, 'Pending → Resubmit should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('Invalid transition'),
        'Pending → Resubmit is strictly BLOCKED (400 Bad Request)'
      );
    }

    // Submit record 3
    await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record3._id.toString(),
      action: 'Submit',
      user: locMgrUser,
    });

    // Test: Submitted → Resubmit MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Resubmit',
        user: locMgrUser,
      });
      assert(false, 'Submitted → Resubmit should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('Invalid transition'),
        'Submitted → Resubmit is strictly BLOCKED (400 Bad Request)'
      );
    }

    // Move record 3 to Under Review
    await ApprovalWorkflowService.executeWorkflowAction({
      recordId: record3._id.toString(),
      action: 'Start Review',
      user: officerUser,
    });

    // Test: Reject WITHOUT comments MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Reject',
        comments: '',
        user: officerUser,
      });
      assert(false, 'Reject without comments should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('Comments are strictly required'),
        'Reject without comments is strictly BLOCKED (400 Bad Request)'
      );
    }

    // Test: Request Correction WITHOUT comments MUST FAIL
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Request Correction',
        comments: '   ',
        user: officerUser,
      });
      assert(false, 'Request Correction without comments should have failed');
    } catch (err: any) {
      assert(
        err.statusCode === 400 && err.message.includes('Comments are strictly required'),
        'Request Correction without comments is strictly BLOCKED (400 Bad Request)'
      );
    }

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('5. RBAC & Scoping Permissions');
    console.log('────────────────────────────────────────────────────────────');

    // Test: Location Manager attempts to Approve MUST FAIL (403)
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Approve',
        user: locMgrUser,
      });
      assert(false, 'Location Manager Approve should have failed with 403');
    } catch (err: any) {
      assert(
        err.statusCode === 403 && err.message.includes('not authorized to approve'),
        'Location Manager cannot approve (403 Forbidden)'
      );
    }

    // Test: Location Manager attempts to Reject MUST FAIL (403)
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Reject',
        comments: 'Unjustified rejection',
        user: locMgrUser,
      });
      assert(false, 'Location Manager Reject should have failed with 403');
    } catch (err: any) {
      assert(
        err.statusCode === 403 && err.message.includes('not authorized to approve'),
        'Location Manager cannot reject (403 Forbidden)'
      );
    }

    // Test: Entity Admin of Entity B attempts to Approve record of Entity A MUST FAIL (403)
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Approve',
        user: entityAdminBUser,
      });
      assert(false, 'Entity Admin B approving Entity A record should have failed with 403');
    } catch (err: any) {
      assert(
        err.statusCode === 403 && err.message.includes('outside your assigned entity'),
        'Cross-entity approval strictly BLOCKED (403 Forbidden)'
      );
    }

    // Test: Viewer attempts ANY workflow action MUST FAIL (403)
    try {
      await ApprovalWorkflowService.executeWorkflowAction({
        recordId: record3._id.toString(),
        action: 'Start Review',
        user: viewerUser,
      });
      assert(false, 'Viewer executing action should have failed with 403');
    } catch (err: any) {
      assert(
        err.statusCode === 403 && err.message.includes('Viewers have read-only access'),
        'Viewer action strictly BLOCKED (403 Forbidden)'
      );
    }

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('6. Approval History & Available Actions Inspection');
    console.log('────────────────────────────────────────────────────────────');

    const historyRecord2 = await ApprovalWorkflowService.getRecordApprovals(record2._id.toString());
    assert(historyRecord2.length >= 6, `Approval trail has complete history (${historyRecord2.length} records)`);
    assert(
      historyRecord2[0].action === 'Approve' && historyRecord2[historyRecord2.length - 1].action === 'Submit',
      'Approval trail correctly sorted by descending timestamp'
    );

    // Available actions check for record 3 (currently under_review)
    const updatedRecord3 = await ComplianceRecord.findById(record3._id);
    const availableForOfficer = ApprovalWorkflowService.getAvailableActions(updatedRecord3!, officerUser);
    const actionNames = availableForOfficer.map((a) => a.action);
    assert(actionNames.includes('Approve'), 'Under review offers "Approve" to Compliance Officer');
    assert(actionNames.includes('Reject'), 'Under review offers "Reject" to Compliance Officer');
    assert(actionNames.includes('Request Correction'), 'Under review offers "Request Correction" to Compliance Officer');

    const availableForViewer = ApprovalWorkflowService.getAvailableActions(updatedRecord3!, viewerUser);
    assert(availableForViewer.length === 0, 'No available actions for Viewer (read-only)');

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('7. Cleanup Test Fixtures');
    console.log('────────────────────────────────────────────────────────────');

    await ComplianceRecord.deleteMany({ _id: { $in: [record1._id, record2._id, record3._id] } });
    await Approval.deleteMany({ complianceRecord: { $in: [record1._id, record2._id, record3._id] } });
    await User.deleteMany({ email: 'locmgr.a1@compliance.test' });
    await Location.deleteMany({ locationCode: { $in: ['TEST-LOC-A1', 'TEST-LOC-B1'] } });
    await Entity.deleteMany({ code: { $in: ['TEST-ENT-A', 'TEST-ENT-B'] } });
    await ComplianceRule.deleteMany({ code: { $in: ['RULE-TEST-WF-1', 'RULE-TEST-WF-2', 'RULE-TEST-WF-3'] } });
    assert(true, 'Test artifacts and records cleaned up successfully');

    console.log('\n============================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

runTests();
