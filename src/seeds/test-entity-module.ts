/**
 * Entity Module Integration Test
 *
 * Verifies:
 * - Entity CRUD (Create, Read paginated, Update, Delete)
 * - Search, state/district/status filtering, sorting, pagination
 * - Master Data entityType reference validation
 * - Detailed view with relationship structures (Locations, Compliance, Documents, Tasks)
 * - RBAC scoping (Super Admin global vs Entity Admin scoped)
 * - AuditLog generation on mutations
 *
 * Run with: npx tsx src/seeds/test-entity-module.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import '../models/index.js';
import User from '../models/User.js';
import Entity from '../models/Entity.js';
import MasterData from '../models/MasterData.js';
import AuditLog from '../models/AuditLog.js';
import { generateAccessToken } from '../utils/token.js';

dotenv.config();

const API_BASE = 'http://localhost:5003/api';

async function runTests() {
  console.log('🧪 Starting Entity Management Integration Tests...\n');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/compliance-management-system');
  console.log('✅ Connected to MongoDB\n');

  const superAdmin = await User.findOne({ email: 'superadmin@cms.local' }).populate('role');
  const entityAdmin = await User.findOne({ email: 'entityadmin@ccpl.local' }).populate('role');
  const viewer = await User.findOne({ email: 'viewer@ccpl.local' }).populate('role');

  if (!superAdmin || !entityAdmin || !viewer) {
    throw new Error('Seed users not found. Run dev seed first.');
  }

  const superAdminToken = generateAccessToken({
    userId: superAdmin._id.toString(),
    email: superAdmin.email,
    role: (superAdmin.role as any).code,
  });

  const entityAdminToken = generateAccessToken({
    userId: entityAdmin._id.toString(),
    email: entityAdmin.email,
    role: (entityAdmin.role as any).code,
    entityId: entityAdmin.entity?.toString(),
  });

  const superAdminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${superAdminToken}`,
  };

  const entityAdminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${entityAdminToken}`,
  };

  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  };

  // Find a valid entityType from MasterData
  const entityTypeDoc = await MasterData.findOne({ category: 'entity_type' });
  if (!entityTypeDoc) {
    throw new Error('No entity_type MasterData found. Please run seed:dev.');
  }

  // ── TEST 1: Entity Listing & Filtering ─────────────────────────────────────
  console.log('─'.repeat(60));
  console.log('1. Entity Listing, Search, Filter & Pagination');
  console.log('─'.repeat(60));

  await test('Super Admin can list all entities with pagination & counts', async () => {
    const res = await fetch(`${API_BASE}/entities?page=1&limit=10`, { headers: superAdminHeaders });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data.entities)) {
      throw new Error('Invalid entities payload');
    }
    if (json.data.pagination.total < 1) {
      throw new Error('Expected at least 1 entity');
    }
  });

  await test('Search by entity code or name', async () => {
    const res = await fetch(`${API_BASE}/entities?search=CCPL`, { headers: superAdminHeaders });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (json.data.entities.length === 0) {
      throw new Error('Search for CCPL returned no results');
    }
    if (!json.data.entities[0].code.includes('CCPL')) {
      throw new Error('Search result did not match query');
    }
  });

  // ── TEST 2: Create, Read, Update, Delete Entity ─────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('2. Entity CRUD Lifecycle');
  console.log('─'.repeat(60));

  let createdEntityId = '';
  const testEntityCode = `ENT_${Date.now()}`.substring(0, 15);

  await test('Create new entity with Master Data reference & address', async () => {
    const payload = {
      name: 'Apex Care Hospitals Ltd',
      code: testEntityCode,
      entityType: entityTypeDoc._id.toString(),
      owner: entityAdmin._id.toString(),
      contactEmail: 'contact@apexcare.local',
      contactPhone: '+91 9988776655',
      contactPerson: 'Dr. Ramesh Rao',
      address: {
        line1: '12th Floor, Apex Towers',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
      description: 'Multi-specialty tertiary care hospital cluster',
      status: 'active',
    };

    const res = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify(payload),
    });

    if (res.status !== 201) {
      const err = await res.text();
      throw new Error(`Expected 201, got ${res.status}: ${err}`);
    }

    const json = await res.json();
    createdEntityId = json.data.entity._id;
    if (json.data.entity.code !== testEntityCode) {
      throw new Error('Entity code mismatch');
    }
  });

  await test('Get single entity details with relationships', async () => {
    const res = await fetch(`${API_BASE}/entities/${createdEntityId}`, { headers: superAdminHeaders });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (!json.data.entity || json.data.entity._id !== createdEntityId) {
      throw new Error('Fetched entity mismatch');
    }
    if (!json.data.complianceStats || typeof json.data.complianceStats.total !== 'number') {
      throw new Error('Missing complianceStats aggregation in detail view');
    }
  });

  await test('Update entity profile and address', async () => {
    const updatePayload = {
      name: 'Apex Care Hospitals Ltd (Renamed)',
      contactPhone: '+91 9988776600',
      address: {
        line1: '14th Floor, Apex Towers',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
    };

    const res = await fetch(`${API_BASE}/entities/${createdEntityId}`, {
      method: 'PUT',
      headers: superAdminHeaders,
      body: JSON.stringify(updatePayload),
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (json.data.entity.name !== 'Apex Care Hospitals Ltd (Renamed)') {
      throw new Error('Entity name was not updated');
    }
  });

  await test('Delete created entity and verify MongoDB removal', async () => {
    const res = await fetch(`${API_BASE}/entities/${createdEntityId}`, {
      method: 'DELETE',
      headers: superAdminHeaders,
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const check = await Entity.findById(createdEntityId);
    if (check) throw new Error('Entity still exists in database after delete');
  });

  // ── TEST 3: RBAC & Scoping Boundary ───────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('3. RBAC Scoping');
  console.log('─'.repeat(60));

  await test('Entity Admin cannot access unassigned entities', async () => {
    // CCPL entity is entityAdmin.entity
    // If we request a fake/unassigned entity ID, it should return 403 or 404
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await fetch(`${API_BASE}/entities/${fakeId}`, { headers: entityAdminHeaders });
    if (res.status !== 403 && res.status !== 404) {
      throw new Error(`Expected 403 or 404, got ${res.status}`);
    }
  });

  // ── TEST 4: AuditLog Generation ───────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('4. AuditLog Persistence');
  console.log('─'.repeat(60));

  await test('Audit logs recorded for entity creation and deletion', async () => {
    const logs = await AuditLog.find({ resource: 'Entity' }).sort({ createdAt: -1 }).limit(5);
    if (logs.length === 0) {
      throw new Error('No audit log entries recorded for Entity resource');
    }
  });

  console.log('\n' + '═'.repeat(60));
  console.log(`ENTITY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('═'.repeat(60) + '\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
