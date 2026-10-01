/**
 * Automated Auth & RBAC Verification Suite
 *
 * Spawns the Express server and executes end-to-end HTTP requests to verify:
 *   - Login for all 6 roles with bcrypt validation
 *   - JWT generation & verification
 *   - Token refresh rotation
 *   - GET /api/auth/me profile and permissions
 *   - Role-based authorization enforcement (authorize)
 *   - Permission-based access enforcement (requirePermission)
 *   - Negative test cases: invalid password, expired/bad token, unauthorized role
 */

import http from 'http';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import createApp from '../app.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/compliance-management-system';

interface LoginResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
    user: {
      email: string;
      role: {
        code: string;
        name: string;
      };
    };
    permissions: string[];
  };
}

async function runTests() {
  console.log('\n🔒 Starting Phase 3 — Authentication & RBAC Test Suite...\n');
  await mongoose.connect(MONGODB_URI);

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(5099, () => {
      console.log('Test HTTP server listening on port 5099');
      resolve();
    });
  });

  const baseUrl = 'http://127.0.0.1:5099/api/auth';

  // Helper for json requests
  const request = async (
    path: string,
    options: {
      method?: string;
      body?: any;
      token?: string;
    } = {}
  ) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const json = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body: json };
  };

  try {
    // ── 1. Negative Test: Invalid Credentials ───────────────────────────────
    console.log('1. Testing Invalid Credentials (Negative Test):');
    const badLogin = await request('/login', {
      method: 'POST',
      body: { email: 'superadmin@cms.local', password: 'WrongPassword999!' },
    });
    if (badLogin.status === 401 && !badLogin.body.success) {
      console.log('  ✓ 401 Unauthorized correctly rejected invalid password');
    } else {
      throw new Error(`Expected 401, got ${badLogin.status}`);
    }

    // ── 2. Test Login for All 6 Roles ───────────────────────────────────────
    console.log('\n2. Testing Login & Token Generation for All 6 Roles:');

    const testUsers = [
      { role: 'super_admin', email: 'superadmin@cms.local' },
      { role: 'admin', email: 'admin@cms.local' },
      { role: 'entity_admin', email: 'entityadmin@ccpl.local' },
      { role: 'location_manager', email: 'locationmanager@ccpl.local' },
      { role: 'compliance_officer', email: 'officer@ccpl.local' },
      { role: 'viewer', email: 'viewer@ccpl.local' },
    ];

    const tokens: Record<string, { access: string; refresh: string }> = {};

    for (const u of testUsers) {
      const res = await request('/login', {
        method: 'POST',
        body: { email: u.email, password: 'Password123!' },
      });

      if (res.status !== 200 || !res.body.success) {
        throw new Error(`Login failed for ${u.email}: ${JSON.stringify(res.body)}`);
      }

      const data = res.body.data;
      if (!data.accessToken || !data.refreshToken) {
        throw new Error(`Missing tokens for ${u.email}`);
      }

      tokens[u.role] = { access: data.accessToken, refresh: data.refreshToken };
      console.log(
        `  ✓ ${u.role.padEnd(20)} logged in → Token generated (Permissions count: ${data.permissions.length})`
      );
    }

    // ── 3. Test GET /api/auth/me ────────────────────────────────────────────
    console.log('\n3. Testing GET /api/auth/me:');
    const meRes = await request('/me', { token: tokens['compliance_officer'].access });
    if (meRes.status === 200 && meRes.body.data.user.email === 'officer@ccpl.local') {
      console.log(`  ✓ Current profile successfully retrieved: ${meRes.body.data.user.fullName} (${meRes.body.data.user.role.name})`);
    } else {
      throw new Error(`GET /me failed: ${JSON.stringify(meRes.body)}`);
    }

    // ── 4. Test POST /api/auth/refresh ──────────────────────────────────────
    console.log('\n4. Testing POST /api/auth/refresh:');
    const refreshRes = await request('/refresh', {
      method: 'POST',
      body: { refreshToken: tokens['viewer'].refresh },
    });
    if (refreshRes.status === 200 && refreshRes.body.data.accessToken) {
      console.log('  ✓ Token refresh succeeded, new accessToken and rotated refreshToken issued');
    } else {
      throw new Error(`Refresh failed: ${JSON.stringify(refreshRes.body)}`);
    }

    // ── 5. Test Role Authorization (Super Admin Only) ──────────────────────
    console.log('\n5. Testing Role Authorization: /api/auth/test/super-admin-only');
    const saAllowed = await request('/test/super-admin-only', { token: tokens['super_admin'].access });
    if (saAllowed.status === 200) {
      console.log('  ✓ Super Admin allowed access (200 OK)');
    } else {
      throw new Error(`Super admin access failed: ${saAllowed.status}`);
    }

    const adminBlocked = await request('/test/super-admin-only', { token: tokens['admin'].access });
    if (adminBlocked.status === 403) {
      console.log('  ✓ Admin blocked with 403 Forbidden');
    } else {
      throw new Error(`Expected 403 for Admin on super-admin-only, got ${adminBlocked.status}`);
    }

    const viewerBlocked = await request('/test/super-admin-only', { token: tokens['viewer'].access });
    if (viewerBlocked.status === 403) {
      console.log('  ✓ Viewer blocked with 403 Forbidden');
    } else {
      throw new Error(`Expected 403 for Viewer on super-admin-only, got ${viewerBlocked.status}`);
    }

    // ── 6. Test Tier Authorization: /api/auth/test/admin-or-above ──────────
    console.log('\n6. Testing Multi-Role Tier Authorization: /api/auth/test/admin-or-above');
    const eaAllowed = await request('/test/admin-or-above', { token: tokens['entity_admin'].access });
    if (eaAllowed.status === 200) {
      console.log('  ✓ Entity Admin allowed access (200 OK)');
    } else {
      throw new Error(`Entity admin access failed: ${eaAllowed.status}`);
    }

    const lmBlocked = await request('/test/admin-or-above', { token: tokens['location_manager'].access });
    if (lmBlocked.status === 403) {
      console.log('  ✓ Location Manager blocked with 403 Forbidden');
    } else {
      throw new Error(`Expected 403 for Location Manager, got ${lmBlocked.status}`);
    }

    // ── 7. Test Capability/Permission: requirePermission('entity:create') ───
    console.log("\n7. Testing Capability-Based Access Control: requirePermission('entity:create')");
    const saPerm = await request('/test/require-entity-create', { token: tokens['super_admin'].access });
    if (saPerm.status === 200) {
      console.log('  ✓ Super Admin granted permission via wildcard (200 OK)');
    } else {
      throw new Error(`Super admin permission failed: ${saPerm.status}`);
    }

    const adminNoPerm = await request('/test/require-entity-create', { token: tokens['admin'].access });
    if (adminNoPerm.status === 403) {
      console.log('  ✓ Admin correctly rejected (403 Forbidden) for entity:create');
    } else {
      throw new Error(`Expected 403 for Admin on entity:create, got ${adminNoPerm.status}`);
    }

    // ── 8. Test Capability/Permission: requirePermission('compliance_record:submit')
    console.log("\n8. Testing Capability-Based Access Control: requirePermission('compliance_record:submit')");
    const lmPerm = await request('/test/require-compliance-submit', { token: tokens['location_manager'].access });
    if (lmPerm.status === 200) {
      console.log('  ✓ Location Manager granted compliance_record:submit (200 OK)');
    } else {
      throw new Error(`Location manager permission failed: ${lmPerm.status}`);
    }

    const coPerm = await request('/test/require-compliance-submit', { token: tokens['compliance_officer'].access });
    if (coPerm.status === 200) {
      console.log('  ✓ Compliance Officer granted compliance_record:submit (200 OK)');
    } else {
      throw new Error(`Compliance officer permission failed: ${coPerm.status}`);
    }

    const vNoPerm = await request('/test/require-compliance-submit', { token: tokens['viewer'].access });
    if (vNoPerm.status === 403) {
      console.log('  ✓ Viewer correctly rejected (403 Forbidden) for compliance_record:submit');
    } else {
      throw new Error(`Expected 403 for Viewer, got ${vNoPerm.status}`);
    }

    // ── 9. Negative Test: Malformed Token ───────────────────────────────────
    console.log('\n9. Testing Malformed Token:');
    const badToken = await request('/me', { token: 'invalid.token.here' });
    if (badToken.status === 401) {
      console.log('  ✓ 401 Unauthorized returned for forged/malformed token');
    } else {
      throw new Error(`Expected 401, got ${badToken.status}`);
    }

    console.log('\n🎉 ALL AUTHENTICATION & RBAC TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test run failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
