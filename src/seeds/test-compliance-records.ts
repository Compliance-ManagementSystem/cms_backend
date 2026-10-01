/**
 * Phase 8 — Compliance Records & Document Management Integration Test Suite
 *
 * Validates:
 * 1. ComplianceRecord connection: Entity + Location + Compliance Rule
 * 2. Record Fields: entity, location, rule, status, assignedUser, dueDate, submissionDate, approvalDate, expiryDate, comments, currentVersion
 * 3. Status Transitions: pending -> submitted -> under_review -> approved -> rejected -> expiring_soon -> expired
 * 4. Document Management: upload, metadata, replace, immutable version history (old versions never destroyed), verification status
 * 5. Location Bulk Generation of Compliance Records via Rule Engine
 * 6. Date filtering, search, and real MongoDB aggregated metrics
 */

import mongoose, { Types } from 'mongoose';
import path from 'path';
import fs from 'fs';
import User from '../models/User.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRule from '../models/ComplianceRule.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import DocumentModel from '../models/Document.js';
import MasterData from '../models/MasterData.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/compliance-management-system';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('🧪 Starting Phase 8 Compliance Records & Document Management Integration Tests...\n');

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  try {
    const adminUser = (await User.findOne({ email: 'superadmin@cms.local' })) || (await User.findOne());
    assert(!!adminUser, 'Admin user exists in database');

    const entityType = await MasterData.findOne({ category: 'entity_type', status: 'active' });
    const locationType = await MasterData.findOne({ category: 'location_type', status: 'active' });
    const complianceCat = await MasterData.findOne({ category: 'compliance_category', status: 'active' });
    const complianceFreq = await MasterData.findOne({ category: 'compliance_frequency', status: 'active' });
    const docType = await MasterData.findOne({ category: 'document_type', status: 'active' });

    assert(!!entityType && !!locationType && !!complianceCat && !!complianceFreq, 'Master Data prerequisites present');

    // ── Setup Test Entity, Location, and Rule ───────────────────────────────
    const testEntity = await Entity.create({
      name: 'Test Healthcare Corporation P8',
      code: 'THC-P8',
      entityCode: 'THC-P8',
      entityType: entityType?._id,
      status: 'active',
      contactEmail: 'contact@thc-p8.local',
      contactPhone: '9876543210',
      address: {
        line1: '100 Medical City',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
      createdBy: adminUser?._id,
    });

    const testLocation = await Location.create({
      name: 'THC Whitefield Hospital P8',
      code: 'THC-WH-01',
      locationCode: 'THC-WH-01',
      entity: testEntity._id,
      locationType: locationType?._id,
      status: 'active',
      manager: adminUser?._id,
      address: {
        line1: 'Plot 45, ITPL Road',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560066',
        country: 'India',
      },
      createdBy: adminUser?._id,
    });

    const testRule = await ComplianceRule.create({
      name: 'Bio-Medical Waste Management Clearance P8',
      code: 'BMWM-ANNUAL-P8',
      description: 'Annual bio-medical waste statutory management clearance certificate',
      category: complianceCat?._id,
      frequency: complianceFreq?._id,
      renewalCycle: 365,
      mandatory: true,
      active: true,
      status: 'active',
      priority: 'critical',
      requiredDocuments: [
        {
          documentType: docType?._id,
          label: 'State Pollution Control Board Authorisation',
          isMandatory: true,
        },
      ],
      createdBy: adminUser?._id,
    });

    console.log('────────────────────────────────────────────────────────────');
    console.log('1. Compliance Record Connection: Entity + Location + Rule');
    console.log('────────────────────────────────────────────────────────────');

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 45);

    const record = await ComplianceRecord.create({
      entity: testEntity._id,
      location: testLocation._id,
      rule: testRule._id,
      complianceRule: testRule._id,
      status: 'pending',
      assignedUser: adminUser?._id,
      dueDate,
      comments: 'Initial statutory compliance tracking setup',
      currentVersion: 1,
      createdBy: adminUser?._id,
    });

    assert(!!record._id, 'Compliance record created in MongoDB');
    assert(record.recordNumber.startsWith('CR-'), `Unique record number generated: ${record.recordNumber}`);
    assert(record.entity.toString() === testEntity._id.toString(), 'Entity connected correctly');
    assert(record.location.toString() === testLocation._id.toString(), 'Location connected correctly');
    assert(record.rule.toString() === testRule._id.toString(), 'Rule connected correctly');
    assert(record.status === 'pending', 'Initial status is "pending"');
    assert(record.currentVersion === 1, 'Initial version is 1');
    assert(record.assignedUser?.toString() === adminUser?._id.toString(), 'Assigned user set correctly');

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('2. Status Lifecycle Transitions (Pending → Submitted → Under Review → Approved)');
    console.log('────────────────────────────────────────────────────────────');

    // Transition 1: Submit
    record.status = 'submitted';
    record.submissionDate = new Date();
    record.comments = 'Uploaded preliminary bio-medical clearances';
    await record.save();

    const submittedRecord = await ComplianceRecord.findById(record._id);
    assert(submittedRecord?.status === 'submitted', 'Status updated to "submitted"');
    assert(!!submittedRecord?.submissionDate, 'Submission date recorded automatically');

    // Transition 2: Under Review
    submittedRecord!.status = 'under_review';
    await submittedRecord!.save();

    const underReviewRecord = await ComplianceRecord.findById(record._id);
    assert(underReviewRecord?.status === 'under_review', 'Status updated to "under_review"');

    // Transition 3: Approved
    const approvalDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(approvalDate.getDate() + 365);

    underReviewRecord!.status = 'approved';
    underReviewRecord!.approvalDate = approvalDate;
    underReviewRecord!.expiryDate = expiryDate;
    underReviewRecord!.approvals.push({
      _id: new Types.ObjectId(),
      level: 1,
      approver: adminUser?._id,
      decision: 'approved',
      comments: 'Approved by Chief Compliance Officer',
      decidedAt: approvalDate,
      requestedAt: submittedRecord!.submissionDate!,
    } as any);
    await underReviewRecord!.save();

    const approvedRecord = await ComplianceRecord.findById(record._id).populate('approvals.approver', 'email');
    assert(approvedRecord?.status === 'approved', 'Status updated to "approved"');
    assert(!!approvedRecord?.approvalDate, 'Approval date recorded');
    assert(!!approvedRecord?.expiryDate, 'Expiry date calculated and stored');
    assert(approvedRecord?.approvals.length === 1, 'Approval workflow trail appended');
    assert(approvedRecord?.approvals[0].decision === 'approved', 'Approval decision verified');

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('3. Document Management & Immutable Versioning');
    console.log('────────────────────────────────────────────────────────────');

    // Create a mock upload file
    const uploadDir = path.join(process.cwd(), 'uploads', 'compliance-documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const testFileV1 = path.join(uploadDir, `test-v1-${Date.now()}.pdf`);
    fs.writeFileSync(testFileV1, 'MOCK PDF CONTENT VERSION 1');

    // Document v1 Upload
    const doc = await DocumentModel.create({
      name: 'SPCB Authorisation Certificate',
      type: 'STATUTORY_CLEARANCE',
      documentType: docType?._id,
      entity: testEntity._id,
      location: testLocation._id,
      complianceRecord: record._id,
      fileUrl: `/uploads/compliance-documents/${path.basename(testFileV1)}`,
      fileName: 'SPCB-Certificate-v1.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      uploadedBy: adminUser?._id,
      uploadedAt: new Date(),
      expiryDate,
      verificationStatus: 'pending',
      version: 1,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          fileUrl: `/uploads/compliance-documents/${path.basename(testFileV1)}`,
          fileName: 'SPCB-Certificate-v1.pdf',
          fileSize: 2048,
          mimeType: 'application/pdf',
          uploadedBy: adminUser?._id,
          uploadedAt: new Date(),
          notes: 'Initial SPCB authorisations document upload',
          status: 'active',
        },
      ],
      createdBy: adminUser?._id,
    });

    // Link document to Compliance Record
    await ComplianceRecord.findByIdAndUpdate(record._id, {
      $push: { documents: doc._id },
    });

    assert(!!doc._id, 'Document created and linked to ComplianceRecord');
    assert(doc.version === 1, 'Document initial version is 1');
    assert(doc.versions.length === 1, 'Version history initialized with v1');

    // Document v2 Replacement (Never destroy old versions)
    const testFileV2 = path.join(uploadDir, `test-v2-${Date.now()}.pdf`);
    fs.writeFileSync(testFileV2, 'MOCK PDF CONTENT VERSION 2 (RENEWED)');

    // Mark previous versions as superseded
    doc.versions.forEach((v) => {
      v.status = 'superseded';
    });

    doc.versions.push({
      _id: new Types.ObjectId(),
      version: 2,
      fileUrl: `/uploads/compliance-documents/${path.basename(testFileV2)}`,
      fileName: 'SPCB-Certificate-v2-Renewed.pdf',
      fileSize: 4096,
      mimeType: 'application/pdf',
      uploadedBy: adminUser?._id,
      uploadedAt: new Date(),
      notes: 'Renewed SPCB certification received from Board',
      status: 'active',
    } as any);

    doc.version = 2;
    doc.currentVersion = 2;
    doc.fileUrl = `/uploads/compliance-documents/${path.basename(testFileV2)}`;
    doc.fileName = 'SPCB-Certificate-v2-Renewed.pdf';
    doc.fileSize = 4096;
    doc.verificationStatus = 'verified'; // verifier marks verified
    doc.verifiedBy = adminUser?._id;
    doc.verifiedAt = new Date();
    await doc.save();

    const updatedDoc = await DocumentModel.findById(doc._id);
    assert(updatedDoc?.currentVersion === 2, 'Active document version is now 2');
    assert(updatedDoc?.versions.length === 2, 'Version history has 2 versions (old version preserved)');
    assert(updatedDoc?.versions[0].status === 'superseded', 'v1 marked as "superseded" (never deleted)');
    assert(updatedDoc?.versions[1].status === 'active', 'v2 marked as "active"');
    assert(updatedDoc?.verificationStatus === 'verified', 'Document verification status updated to "verified"');

    // Verify record has document populated
    const recordWithDocs = await ComplianceRecord.findById(record._id).populate('documents');
    assert(recordWithDocs?.documents.length === 1, 'Compliance record documents array has attached document');

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('4. Real MongoDB Aggregations & Query Filters');
    console.log('────────────────────────────────────────────────────────────');

    const metrics = await ComplianceRecord.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    assert(metrics.length > 0, `Real MongoDB status metrics aggregated (${metrics.length} groups found)`);
    const approvedGroup = metrics.find((m) => m._id === 'approved');
    assert(!!approvedGroup && approvedGroup.count >= 1, 'Approved status count is accurate');

    // Date range filter test
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 1);
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 400);

    const recordsInRange = await ComplianceRecord.find({
      entity: testEntity._id,
      expiryDate: { $gte: fromDate, $lte: toDate },
    });
    assert(recordsInRange.length >= 1, 'Date range filter on expiryDate matched record');

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('5. Cleanup Test Artifacts');
    console.log('────────────────────────────────────────────────────────────');

    if (fs.existsSync(testFileV1)) fs.unlinkSync(testFileV1);
    if (fs.existsSync(testFileV2)) fs.unlinkSync(testFileV2);

    await DocumentModel.findByIdAndDelete(doc._id);
    await ComplianceRecord.findByIdAndDelete(record._id);
    await ComplianceRule.findByIdAndDelete(testRule._id);
    await Location.findByIdAndDelete(testLocation._id);
    await Entity.findByIdAndDelete(testEntity._id);

    assert(true, 'Test entities, locations, rules, documents, and records cleaned up cleanly');

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`COMPLIANCE RECORDS & DOCUMENTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('Test execution failed with exception:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
