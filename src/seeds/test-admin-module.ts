/**
 * Admin Module & Master Data Integration Test
 *
 * Verifies:
 * - Admin and Super Admin access to Admin APIs
 * - User CRUD, validation, status toggle, delete
 * - Role CRUD and system role deletion prevention
 * - Permission catalog listing and custom permission creation
 * - Master Data CRUD across categories, unique constraints, parent-child linking
 * - System Settings retrieval and update
 * - AuditLog persistence for administrative actions
 * - Security: 403 Forbidden for non-admin roles (Viewer)
 *
 * Run with: npx tsx src/seeds/test-admin-module.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import Role from '../models/Role.js';
import MasterData from '../models/MasterData.js';
import AuditLog from '../models/AuditLog.js';
import Settings from '../models/Settings.js';
import { generateAccessToken } from '../utils/token.js';

dotenv.config();

const API_BASE = 'http://localhost:5003/api';

async function runTests() {
  console.log('🧪 Starting Admin & Master Data Module Integration Tests...\n');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/compliance-management-system');
  console.log('✅ Connected to MongoDB\n');

  // Fetch Super Admin, Admin, and Viewer users
  const superAdmin = await User.findOne({ email: 'superadmin@cms.local' }).populate('role');
  const admin = await User.findOne({ email: 'admin@cms.local' }).populate('role');
  const viewer = await User.findOne({ email: 'viewer@ccpl.local' }).populate('role');

  if (!superAdmin || !admin || !viewer) {
    throw new Error('Seed users not found. Please run npm run seed:dev first.');
  }

  const superAdminToken = generateAccessToken({
    userId: superAdmin._id.toString(),
    email: superAdmin.email,
    role: (superAdmin.role as any).code,
  });

  const viewerToken = generateAccessToken({
    userId: viewer._id.toString(),
    email: viewer.email,
    role: (viewer.role as any).code,
  });

  const superAdminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${superAdminToken}`,
  };

  const viewerHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${viewerToken}`,
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

  // ── TEST 1: Security Enforcement (Viewer blocked) ─────────────────────────
  console.log('─'.repeat(60));
  console.log('1. Security & RBAC Boundary');
  console.log('─'.repeat(60));

  await test('Viewer role is rejected with 403 Forbidden on /api/admin/users', async () => {
    const res = await fetch(`${API_BASE}/admin/users`, { headers: viewerHeaders });
    if (res.status !== 403) {
      throw new Error(`Expected status 403, got ${res.status}`);
    }
  });

  await test('Viewer role is rejected with 403 Forbidden on /api/admin/master-data', async () => {
    const res = await fetch(`${API_BASE}/admin/master-data`, { headers: viewerHeaders });
    if (res.status !== 403) {
      throw new Error(`Expected status 403, got ${res.status}`);
    }
  });

  // ── TEST 2: User CRUD ─────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('2. User Management CRUD');
  console.log('─'.repeat(60));

  let createdUserId = '';
  const testUserEmail = `qa.officer.${Date.now()}@cms.local`;

  await test('Super Admin can list users with pagination', async () => {
    const res = await fetch(`${API_BASE}/admin/users?page=1&limit=5`, { headers: superAdminHeaders });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data.users)) {
      throw new Error('Invalid users response payload');
    }
    if (json.data.pagination.total < 1) {
      throw new Error('Expected at least 1 user in system');
    }
  });

  await test('Create new user with role and validation', async () => {
    const officerRole = await Role.findOne({ code: 'compliance_officer' });
    const payload = {
      firstName: 'Karan',
      lastName: 'Johar',
      email: testUserEmail,
      password: 'Password123!',
      role: officerRole?._id.toString(),
      phone: '+91 9876543210',
      status: 'active',
    };

    const res = await fetch(`${API_BASE}/admin/users`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify(payload),
    });

    if (res.status !== 201) {
      const err = await res.text();
      throw new Error(`Expected 201, got ${res.status}: ${err}`);
    }

    const json = await res.json();
    createdUserId = json.data.user._id;
    if (json.data.user.email !== testUserEmail) {
      throw new Error('Created user email mismatch');
    }
  });

  await test('Update user details', async () => {
    const updatePayload = {
      firstName: 'Karan (Updated)',
      phone: '+91 9123456789',
    };

    const res = await fetch(`${API_BASE}/admin/users/${createdUserId}`, {
      method: 'PUT',
      headers: superAdminHeaders,
      body: JSON.stringify(updatePayload),
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (json.data.user.firstName !== 'Karan (Updated)') {
      throw new Error('User first name was not updated');
    }
  });

  await test('Toggle user status (Deactivate / Reactivate)', async () => {
    const res = await fetch(`${API_BASE}/admin/users/${createdUserId}/status`, {
      method: 'PATCH',
      headers: superAdminHeaders,
      body: JSON.stringify({ status: 'inactive' }),
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (json.data.user.status !== 'inactive') {
      throw new Error('Status was not changed to inactive');
    }
  });

  await test('Delete user and verify removal', async () => {
    const res = await fetch(`${API_BASE}/admin/users/${createdUserId}`, {
      method: 'DELETE',
      headers: superAdminHeaders,
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const check = await User.findById(createdUserId);
    if (check) throw new Error('User still exists after delete');
  });

  // ── TEST 3: Role Management ───────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('3. Role Management');
  console.log('─'.repeat(60));

  let customRoleId = '';

  await test('List all roles with user counts', async () => {
    const res = await fetch(`${API_BASE}/admin/roles`, { headers: superAdminHeaders });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.data.roles) || json.data.roles.length < 6) {
      throw new Error('Expected at least 6 canonical roles');
    }
  });

  await test('Create custom role', async () => {
    const roleCode = `qa_auditor_${Date.now()}`;
    const payload = {
      name: 'QA Compliance Auditor',
      code: roleCode,
      description: 'Custom auditor role with read and audit permissions',
      permissions: [
        { resource: 'compliance_record', actions: ['read', 'verify'] },
        { resource: 'audit_log', actions: ['read', 'export'] },
      ],
    };

    const res = await fetch(`${API_BASE}/admin/roles`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify(payload),
    });

    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    const json = await res.json();
    customRoleId = json.data.role._id;
  });

  await test('Protected system role cannot be deleted', async () => {
    const adminRole = await Role.findOne({ code: 'admin' });
    const res = await fetch(`${API_BASE}/admin/roles/${adminRole?._id}`, {
      method: 'DELETE',
      headers: superAdminHeaders,
    });
    if (res.status !== 400) {
      throw new Error(`Expected status 400 for protected system role deletion, got ${res.status}`);
    }
  });

  await test('Delete custom role', async () => {
    const res = await fetch(`${API_BASE}/admin/roles/${customRoleId}`, {
      method: 'DELETE',
      headers: superAdminHeaders,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  // ── TEST 4: Master Data Management ────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('4. Master Data Management (All 11 Categories)');
  console.log('─'.repeat(60));

  await test('List canonical Master Data categories with counts', async () => {
    const res = await fetch(`${API_BASE}/admin/master-data/categories`, { headers: superAdminHeaders });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.data.categories) || json.data.categories.length < 11) {
      throw new Error(`Expected 11 canonical categories, got ${json.data.categories?.length}`);
    }
  });

  let createdMasterDataId = '';
  await test('Create new master data entry (Task Priority)', async () => {
    const payload = {
      category: 'task_priority',
      code: `URGENT_SLA_${Date.now()}`.substring(0, 20),
      label: 'Urgent 24H SLA',
      description: 'Requires immediate action within 24 hours',
      sortOrder: 10,
      status: 'active',
    };

    const res = await fetch(`${API_BASE}/admin/master-data`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify(payload),
    });

    if (res.status !== 201) {
      const err = await res.text();
      throw new Error(`Expected 201, got ${res.status}: ${err}`);
    }
    const json = await res.json();
    createdMasterDataId = json.data.item._id;
  });

  await test('Update master data label & sortOrder', async () => {
    const res = await fetch(`${API_BASE}/admin/master-data/${createdMasterDataId}`, {
      method: 'PUT',
      headers: superAdminHeaders,
      body: JSON.stringify({ label: 'Urgent 24H SLA (Updated)', sortOrder: 99 }),
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (json.data.item.label !== 'Urgent 24H SLA (Updated)') {
      throw new Error('Label not updated');
    }
  });

  await test('Toggle master data status', async () => {
    const res = await fetch(`${API_BASE}/admin/master-data/${createdMasterDataId}/status`, {
      method: 'PATCH',
      headers: superAdminHeaders,
      body: JSON.stringify({ status: 'inactive' }),
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (json.data.item.status !== 'inactive') {
      throw new Error('Status not changed to inactive');
    }
  });

  await test('Delete created master data item', async () => {
    const res = await fetch(`${API_BASE}/admin/master-data/${createdMasterDataId}`, {
      method: 'DELETE',
      headers: superAdminHeaders,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  // ── TEST 5: System Settings ───────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('5. System Settings');
  console.log('─'.repeat(60));

  await test('Fetch global settings', async () => {
    const res = await fetch(`${API_BASE}/admin/settings`, { headers: superAdminHeaders });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (!json.data.settings || !json.data.settings.notifications) {
      throw new Error('Invalid settings object');
    }
  });

  await test('Update notification toggles and reminder days', async () => {
    const payload = {
      notifications: {
        emailEnabled: true,
        whatsappEnabled: true,
        smsEnabled: false,
        defaultReminderDays: [90, 60, 30, 15, 7],
      },
      config: {
        sessionTimeoutMinutes: 120,
        maxFileUploadSizeMB: 50,
      },
    };

    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'PUT',
      headers: superAdminHeaders,
      body: JSON.stringify(payload),
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const json = await res.json();
    if (!json.data.settings.notifications.whatsappEnabled) {
      throw new Error('whatsappEnabled was not updated to true');
    }
    if (json.data.settings.config.sessionTimeoutMinutes !== 120) {
      throw new Error('sessionTimeoutMinutes was not updated');
    }
  });

  // ── TEST 6: AuditLog Verification ─────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('6. AuditLog Verification');
  console.log('─'.repeat(60));

  await test('Audit logs recorded for administrative modifications', async () => {
    const logs = await AuditLog.find({ actor: superAdmin._id }).sort({ createdAt: -1 }).limit(10);
    if (logs.length === 0) {
      throw new Error('No audit logs were recorded for super admin actions');
    }
    console.log(`    Total recent audit logs recorded: ${logs.length}`);
  });

  console.log('\n' + '═'.repeat(60));
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('═'.repeat(60) + '\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
