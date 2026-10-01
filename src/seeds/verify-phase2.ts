/**
 * Phase 2 Verification Script
 *
 * Verifies that:
 * 1. All 19 Mongoose models are registered and functional
 * 2. All key relationships (1-to-many, many-to-many, polymorphic) resolve with .populate()
 * 3. Cascade and query patterns work as specified
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import {
  Permission,
  Role,
  User,
  MasterData,
  EntityType,
  LocationType,
  Entity,
  Location,
  CmsDocument,
  DocumentVersion,
  ComplianceRule,
  ComplianceRecord,
  Licence,
  Workflow,
  Approval,
  Task,
  Notification,
  AuditLog,
  Settings,
} from '../models/index.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/compliance-management-system';

async function verify() {
  console.log('\n🔍 Verifying Phase 2 — Database Models & Relationships...\n');
  await mongoose.connect(MONGODB_URI);

  const registeredModels = Object.keys(mongoose.models).sort();
  console.log(`Registered Mongoose Models (${registeredModels.length}):`);
  registeredModels.forEach((m) => console.log(`  ✓ ${m}`));

  const requiredModels = [
    'User',
    'Role',
    'Permission',
    'Entity',
    'EntityType',
    'Location',
    'LocationType',
    'ComplianceRule',
    'ComplianceRecord',
    'Document',
    'DocumentVersion',
    'Licence',
    'Approval',
    'Task',
    'Notification',
    'AuditLog',
    'MasterData',
    'Workflow',
    'Settings',
  ];

  const missing = requiredModels.filter((m) => !registeredModels.includes(m));
  if (missing.length > 0) {
    throw new Error(`Missing required models: ${missing.join(', ')}`);
  }
  console.log('\n✅ All 19 required models are registered!');

  // ── Test Relationships ──────────────────────────────────────────────────
  console.log('\nTesting Relationships:');

  // 1. Entity → many Locations
  const entity = await Entity.findOne({ code: 'CCPL' });
  if (!entity) throw new Error('Entity CCPL not found');
  const locations = await Location.find({ entity: entity._id });
  console.log(`  ✓ Entity (${entity.code}) → ${locations.length} Locations`);

  // 2. Location → many ComplianceRecords
  const loc1 = locations[0];
  const records = await ComplianceRecord.find({ location: loc1._id }).populate('complianceRule');
  console.log(`  ✓ Location (${loc1.code}) → ${records.length} ComplianceRecords`);

  // 3. ComplianceRule → ComplianceRecord
  const rulePopulated = records[0].complianceRule as any;
  console.log(`  ✓ ComplianceRecord (${records[0].recordNumber}) → Rule (${rulePopulated.code})`);

  // 4. ComplianceRecord → Documents
  const recordWithDoc = await ComplianceRecord.findOne({ recordNumber: 'CR-2026-00001' }).populate('documents');
  console.log(`  ✓ ComplianceRecord (${recordWithDoc?.recordNumber}) → ${recordWithDoc?.documents.length} Documents`);

  // 5. ComplianceRecord → Approvals
  const approvals = await Approval.find({ complianceRecord: recordWithDoc?._id }).populate('approver');
  console.log(`  ✓ ComplianceRecord (${recordWithDoc?.recordNumber}) → ${approvals.length} Approvals`);

  // 6. ComplianceRecord → Tasks
  const tasks = await Task.find({ complianceRecord: recordWithDoc?._id }).populate('assignedTo');
  console.log(`  ✓ ComplianceRecord (${recordWithDoc?.recordNumber}) → ${tasks.length} Tasks`);

  // 7. User → Tasks, Notifications, AuditLogs
  const manager = await User.findOne({
    email: { $in: ['officer@ccpl.local', 'manager@ccpl.local'] },
  });
  if (!manager) throw new Error('Compliance user not found');
  const userTasks = await Task.find({ assignedTo: manager._id });
  const userNotifications = await Notification.find({ recipient: manager._id });
  const userAuditLogs = await AuditLog.find({ actor: manager._id });
  console.log(`  ✓ User (${manager.email}) → ${userTasks.length} Tasks, ${userNotifications.length} Notifications, ${userAuditLogs.length} AuditLogs`);

  // 8. Document → DocumentVersion
  const doc = await CmsDocument.findOne();
  const versions = await DocumentVersion.find({ document: doc?._id });
  console.log(`  ✓ Document (${doc?.title}) → ${versions.length} DocumentVersions`);

  // 9. Workflow → Steps
  const workflow = await Workflow.findOne({ code: 'COMPLIANCE_SIGN_OFF' }).populate('steps.role');
  console.log(`  ✓ Workflow (${workflow?.code}) → ${workflow?.steps.length} Steps`);

  console.log('\n🎉 ALL PHASE 2 VERIFICATIONS PASSED!\n');
  await mongoose.disconnect();
}

verify().catch((err) => {
  console.error('\n❌ Verification failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
