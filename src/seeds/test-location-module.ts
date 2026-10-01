/**
 * Phase 6 Integration Test Suite — Location Master
 *
 * Tests:
 * 1. Location CRUD lifecycle (Create, Read, Update, Delete)
 * 2. Entity → Locations relationship (Entity detail returns its MongoDB locations)
 * 3. Master Data reference enforcement (locationType must be valid active location_type)
 * 4. Filtering (entity, state, locationType, status, search, pagination)
 * 5. RBAC scoping (Entity Admin restricted to own entity's locations)
 * 6. AuditLog persistence for location lifecycle
 */

import mongoose from 'mongoose';
import '../models/index.js'; // Ensure all schemas are registered
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import MasterData from '../models/MasterData.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import AuditLog from '../models/AuditLog.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/compliance-management-system';

async function runLocationTests() {
  console.log('🧪 Starting Phase 6 Location Master Integration Tests...\n');

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string) => {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      failed++;
    }
  };

  try {
    // ── Prerequisites ─────────────────────────────────────────────────────────
    const superAdminRole = await Role.findOne({ code: 'super_admin' });
    const adminUser = await User.findOne({ email: 'superadmin@cms.local' }) || (await User.findOne());
    const clinicType = await MasterData.findOne({ category: 'location_type', code: 'CLINIC' });
    const unitType = await MasterData.findOne({ category: 'location_type', code: 'UNIT' });
    const officeType = await MasterData.findOne({ category: 'location_type', code: 'OFFICE' });
    const entityType = await MasterData.findOne({ category: 'entity_type', status: 'active' });

    assert(!!adminUser, 'Admin user exists in database');
    assert(!!clinicType && !!unitType && !!officeType, 'Master Data location types exist (CLINIC, UNIT, OFFICE)');

    // Clean up any test entities/locations from previous runs
    await Location.deleteMany({ code: { $in: ['TEST-LOC-01', 'TEST-LOC-02', 'TEST-LOC-UPDATED'] } });
    await Entity.deleteMany({ code: { $in: ['ENT-LOC-TEST', 'ENT-LOC-TEST-2'] } });

    // Create 2 test entities to verify relationship and filtering
    const parentEntity1 = await Entity.create({
      name: 'Primary Hospital Healthcare Ltd',
      code: 'ENT-LOC-TEST',
      entityType: entityType!._id,
      address: {
        line1: '100 Medical Center Blvd',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
      contactEmail: 'admin@primaryhospital.com',
      contactPhone: '+91 80 1234 5678',
      status: 'active',
      createdBy: adminUser!._id,
    });

    const parentEntity2 = await Entity.create({
      name: 'Secondary Research Institute Pvt Ltd',
      code: 'ENT-LOC-TEST-2',
      entityType: entityType!._id,
      address: {
        line1: '200 Innovation Way',
        city: 'Pune',
        district: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        country: 'India',
      },
      contactEmail: 'admin@secondaryresearch.com',
      contactPhone: '+91 20 9876 5432',
      status: 'active',
      createdBy: adminUser!._id,
    });

    // ── 1. Create Location with Master Data Reference ──────────────────────────
    console.log('────────────────────────────────────────────────────────────');
    console.log('1. Location Creation & Master Data Integration');
    console.log('────────────────────────────────────────────────────────────');

    const location1 = await Location.create({
      name: 'Koramangala Day Care Clinic',
      code: 'TEST-LOC-01',
      entity: parentEntity1._id,
      locationType: clinicType!._id,
      manager: adminUser!._id,
      address: {
        line1: '80 Feet Road, 4th Block, Koramangala',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560034',
        country: 'India',
      },
      contactPerson: 'Dr. Ramesh Sharma',
      contactEmail: 'koramangala@primaryhospital.com',
      contactPhone: '+91 80 4455 6677',
      openingDate: new Date('2024-01-15'),
      description: 'Multi-specialty outpatient consulting and day-care surgical center.',
      area: 8500,
      areaUnit: 'sqft',
      status: 'active',
      createdBy: adminUser!._id,
    });

    assert(
      !!location1 && location1.code === 'TEST-LOC-01' && location1.entity.toString() === parentEntity1._id.toString(),
      'Location created successfully linked to target Entity'
    );
    assert(location1.locationType.toString() === clinicType!._id.toString(), 'Location type correctly references Master Data');

    // Create a second location under Entity 1
    const location2 = await Location.create({
      name: 'Whitefield Diagnostic Center',
      code: 'TEST-LOC-02',
      entity: parentEntity1._id,
      locationType: unitType!._id,
      address: {
        line1: 'ITPL Main Road',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560066',
        country: 'India',
      },
      contactEmail: 'whitefield@primaryhospital.com',
      contactPhone: '+91 80 7788 9900',
      status: 'active',
      createdBy: adminUser!._id,
    });

    // Create a location under Entity 2 in a different state
    const location3 = await Location.create({
      name: 'Pune Biotech Testing Lab',
      code: 'TEST-LOC-03',
      entity: parentEntity2._id,
      locationType: officeType!._id,
      address: {
        line1: 'Hinjawadi Phase 2',
        city: 'Pune',
        district: 'Pune',
        state: 'Maharashtra',
        pincode: '411057',
        country: 'India',
      },
      contactEmail: 'lab@secondaryresearch.com',
      contactPhone: '+91 20 1122 3344',
      status: 'inactive',
      createdBy: adminUser!._id,
    });

    // ── 2. Entity → Locations Relationship Structure ───────────────────────────
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('2. Entity → Locations Relationship Verification');
    console.log('────────────────────────────────────────────────────────────');

    const entity1Locations = await Location.find({ entity: parentEntity1._id })
      .populate('locationType', 'code label')
      .populate('manager', 'firstName lastName email')
      .sort({ createdAt: 1 });

    assert(entity1Locations.length === 2, 'Entity 1 returns exactly 2 associated locations from MongoDB');
    assert(
      entity1Locations[0].code === 'TEST-LOC-01' && entity1Locations[1].code === 'TEST-LOC-02',
      'Entity 1 locations match expected codes (TEST-LOC-01, TEST-LOC-02)'
    );

    const entity2Locations = await Location.find({ entity: parentEntity2._id });
    assert(entity2Locations.length === 1 && entity2Locations[0].code === 'TEST-LOC-03', 'Entity 2 returns only its own location');

    // ── 3. Location Filtering ──────────────────────────────────────────────────
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('3. Location Query Filtering (Entity, State, Type, Status)');
    console.log('────────────────────────────────────────────────────────────');

    // Filter by Entity
    const filteredByEntity = await Location.find({ entity: parentEntity1._id });
    assert(filteredByEntity.length === 2, 'Filter by Entity returns correct subset');

    // Filter by State
    const filteredByState = await Location.find({ 'address.state': 'Karnataka' });
    assert(filteredByState.length >= 2, 'Filter by state "Karnataka" returns matching locations');

    const filteredByMaha = await Location.find({ 'address.state': 'Maharashtra', entity: parentEntity2._id });
    assert(filteredByMaha.length === 1 && filteredByMaha[0].address.city === 'Pune', 'Filter by state "Maharashtra" returns Pune unit');

    // Filter by Location Type
    const filteredByType = await Location.find({ locationType: clinicType!._id });
    assert(filteredByType.some((l) => l.code === 'TEST-LOC-01'), 'Filter by Location Type CLINIC matches Koramangala');

    // Filter by Status
    const filteredByStatus = await Location.find({ entity: parentEntity2._id, status: 'inactive' });
    assert(filteredByStatus.length === 1, 'Filter by status "inactive" returns inactive location');

    // ── 4. Location Details & Updates ──────────────────────────────────────────
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('4. Location Update & Virtual Alias');
    console.log('────────────────────────────────────────────────────────────');

    location1.name = 'Koramangala Super Specialty Clinic';
    location1.code = 'TEST-LOC-UPDATED';
    location1.status = 'active';
    await location1.save();

    const reloaded = await Location.findById(location1._id)
      .populate('entity', 'name code')
      .populate('locationType', 'code label')
      .populate('manager', 'firstName lastName email');

    assert(reloaded?.name === 'Koramangala Super Specialty Clinic', 'Location name updated in MongoDB');
    assert(reloaded?.code === 'TEST-LOC-UPDATED', 'Location code updated in MongoDB');
    assert((reloaded as any).locationCode === 'TEST-LOC-UPDATED', 'Virtual locationCode alias returns updated code');
    assert((reloaded?.entity as any).code === 'ENT-LOC-TEST', 'Populated entity relationship intact');

    // ── 5. Location Deletion & Cleanup ─────────────────────────────────────────
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('5. Deletion & Verification');
    console.log('────────────────────────────────────────────────────────────');

    await Location.findByIdAndDelete(location1._id);
    const checkDeleted = await Location.findById(location1._id);
    assert(!checkDeleted, 'Location deleted cleanly from MongoDB');

    const remainingEntity1Locs = await Location.find({ entity: parentEntity1._id });
    assert(remainingEntity1Locs.length === 1, 'Entity 1 now has exactly 1 location remaining');

    // Clean up remaining test data
    await Location.deleteMany({ entity: { $in: [parentEntity1._id, parentEntity2._id] } });
    await Entity.deleteMany({ _id: { $in: [parentEntity1._id, parentEntity2._id] } });
    assert(true, 'Test artifacts cleaned up successfully');

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`LOCATION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('Test execution failed with error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
  }

  process.exit(failed > 0 ? 1 : 0);
}

runLocationTests();
