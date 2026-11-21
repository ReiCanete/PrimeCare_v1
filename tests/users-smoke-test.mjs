/**
 * PrimeCare HIS — Automated User Management & Audit Log Smoke Test
 *
 * Tests api/users/*.php against live Apache + MariaDB:
 *   - list.php, get.php, save.php, status.php, role.php,
 *     reset-password.php, delete.php, audit-logs.php
 */

import { execFileSync } from 'node:child_process';

const BASE_URL = 'http://localhost/PrimeCare_v1/api';
const MYSQL_BIN = 'C:\\xampp\\mysql\\bin\\mysql.exe';

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
    if (condition) {
        passed++;
        console.log(`  PASS: ${label}`);
    } else {
        failed++;
        console.error(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    }
}

function runSql(sql) {
    return execFileSync(MYSQL_BIN, ['-u', 'root', 'primecare_db', '-N', '-B', '-e', sql], {
        encoding: 'utf8'
    }).trim();
}

class ClientSession {
    constructor(name) {
        this.name = name;
        this.cookies = new Map();
        this.csrfToken = null;
    }

    _storeCookies(res) {
        const setCookies = typeof res.headers.getSetCookie === 'function'
            ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
        for (const raw of setCookies) {
            if (!raw) continue;
            const firstPart = raw.split(';')[0];
            const eqIdx = firstPart.indexOf('=');
            if (eqIdx > 0) {
                const k = firstPart.slice(0, eqIdx).trim();
                const v = firstPart.slice(eqIdx + 1).trim();
                if (/expires=Thu, 01 Jan 1970|max-age=0/i.test(raw) || v === 'deleted' || v === '') {
                    this.cookies.delete(k);
                } else {
                    this.cookies.set(k, v);
                }
            }
        }
    }

    _cookieHeader() {
        return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    async request(endpoint, { method = 'GET', params = null, body = undefined, headers = {} } = {}) {
        let url = `${BASE_URL}/${endpoint.replace(/^\/+/, '')}`;
        if (params && typeof params === 'object') {
            const sp = new URLSearchParams();
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
            }
            const qs = sp.toString();
            if (qs) url += (url.includes('?') ? '&' : '?') + qs;
        }
        const reqHeaders = { Accept: 'application/json', ...headers };
        const cookieStr = this._cookieHeader();
        if (cookieStr) reqHeaders.Cookie = cookieStr;
        const opts = { method, headers: reqHeaders };
        if (body !== undefined && method !== 'GET') {
            reqHeaders['Content-Type'] = 'application/json; charset=utf-8';
            opts.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        this._storeCookies(res);
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { status: res.status, body: json, rawText: text };
    }

    async fetchCsrf() {
        const res = await this.request('auth/csrf.php');
        if (res.body?.data?.csrfToken) this.csrfToken = res.body.data.csrfToken;
        return res;
    }

    async login(username, password) {
        await this.fetchCsrf();
        const res = await this.request('auth/login.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': this.csrfToken },
            body: { username, password }
        });
        if (res.body?.data?.csrfToken) this.csrfToken = res.body.data.csrfToken;
        return res;
    }

    async logout() {
        return await this.request('auth/logout.php', {
            method: 'POST',
            headers: this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {},
            body: {}
        });
    }
}

function cleanupTestData() {
    try {
        runSql(`
            DELETE FROM audit_logs WHERE username = 'admin' AND (
                action IN ('Create User', 'Update User', 'Change User Status', 'Change User Role', 'Reset Password', 'Delete User')
                AND details LIKE '%smoketest%'
            );
            DELETE FROM audit_logs WHERE user_id NOT IN ('U-001','U-002','U-003','U-004','U-005','U-006');
            DELETE FROM users WHERE id NOT IN ('U-001','U-002','U-003','U-004','U-005','U-006');
            UPDATE sequences SET current_val = 6 WHERE entity_key = 'users';
        `);
    } catch (e) {
        console.error('Cleanup error:', e.message);
    }
}

async function runTests() {
    console.log('==============================================================');
    console.log('PrimeCare HIS — User Management Smoke Tests');
    console.log('==============================================================\n');
    cleanupTestData();

    const anon = new ClientSession('anon');
    const admin = new ClientSession('admin');
    const staff = new ClientSession('staff');
    const doctor = new ClientSession('doctor');
    const nurse = new ClientSession('nurse');
    const patient = new ClientSession('patient');
    const tempUserClient = new ClientSession('tempUser');

    let createdUserId = null;

    try {
        console.log('[1] Unauthenticated, RBAC & CSRF Guards');
        const unauthList = await anon.request('users/list.php');
        assert(unauthList.status === 401, 'Unauthenticated GET users/list.php returns 401');

        const unauthSave = await anon.request('users/save.php', { method: 'POST', body: {} });
        assert(unauthSave.status === 401, 'Unauthenticated POST users/save.php returns 401');

        assert((await admin.login('admin', 'password123')).status === 200, 'Admin logs in');
        assert((await staff.login('staff', 'password123')).status === 200, 'Staff logs in');
        assert((await doctor.login('doctor', 'password123')).status === 200, 'Doctor logs in');
        assert((await nurse.login('nurse', 'password123')).status === 200, 'Nurse logs in');
        assert((await patient.login('patient', 'password123')).status === 200, 'Patient logs in');

        assert((await staff.request('users/list.php')).status === 403, 'Staff blocked from GET users/list.php (403)');
        assert((await doctor.request('users/list.php')).status === 403, 'Doctor blocked from GET users/list.php (403)');
        assert((await nurse.request('users/list.php')).status === 403, 'Nurse blocked from GET users/list.php (403)');
        assert((await patient.request('users/list.php')).status === 403, 'Patient blocked from GET users/list.php (403)');
        assert((await staff.request('users/audit-logs.php')).status === 403, 'Staff blocked from GET users/audit-logs.php (403)');

        const noCsrf = await admin.request('users/save.php', {
            method: 'POST',
            body: { fullName: 'No CSRF', username: 'nocsrf1', email: 'nocsrf1@primecare.ph', role: 'staff', status: 'active' }
        });
        assert(noCsrf.status === 403, 'Missing CSRF token rejected with 403');

        console.log('\n[2] Listing, Search & Security Check (No Password Hashes)');
        const listRes = await admin.request('users/list.php');
        assert(listRes.status === 200 && Array.isArray(listRes.body?.data?.users) && listRes.body.data.users.length === 6, 'Admin lists 6 seeded users');
        assert(!listRes.rawText.includes('password_hash') && !listRes.rawText.includes('$2y$'), 'No bcrypt hash or password_hash key exposed in users/list.php');

        const filterRes = await admin.request('users/list.php', { params: { role: 'staff', keyword: 'Andres' } });
        assert(filterRes.status === 200 && filterRes.body?.data?.users?.length === 1 && filterRes.body.data.users[0].id === 'U-004', 'Role + keyword filter returns U-004');

        console.log('\n[3] Create Staff User, Login with Temp Password, Update, Role, Status, Reset PW');
        const badUser = await admin.request('users/save.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { fullName: 'Bad User', username: 'ab', email: 'not-an-email', role: 'staff', status: 'active' }
        });
        assert(badUser.status === 422, 'Reject invalid username/email input (422)');

        const createRes = await admin.request('users/save.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: {
                fullName: 'Smoke Test Staff',
                username: 'smoketest_staff',
                email: 'smoketest_staff@primecare.ph',
                role: 'staff',
                status: 'active'
            }
        });
        createdUserId = createRes.body?.data?.user?.id;
        const tempPassword = createRes.body?.data?.tempPassword;
        assert(createRes.status === 201 && Boolean(createdUserId) && Boolean(tempPassword) && createRes.body.data.user.mustChangePassword === true, `Created ${createdUserId} with temporary password and mustChangePassword=true`);
        assert(!createRes.rawText.includes('password_hash') && !createRes.rawText.includes('$2y$'), 'Create response exposes no hash');

        const dupUser = await admin.request('users/save.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { fullName: 'Dup', username: 'smoketest_staff', email: 'other@primecare.ph', role: 'staff', status: 'active' }
        });
        assert(dupUser.status === 409, 'Duplicate username rejected with 409');

        const dupEmail = await admin.request('users/save.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { fullName: 'Dup', username: 'smoketest_other', email: 'smoketest_staff@primecare.ph', role: 'staff', status: 'active' }
        });
        assert(dupEmail.status === 409, 'Duplicate email rejected with 409');

        const tempLogin = await tempUserClient.login('smoketest_staff', tempPassword);
        assert(tempLogin.status === 200 && tempLogin.body?.data?.user?.mustChangePassword === true, 'Newly created user authenticates with generated tempPassword');
        await tempUserClient.logout();

        const updRes = await admin.request('users/save.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: createdUserId, fullName: 'Smoke Test Nurse Updated', username: 'smoketest_staff', email: 'smoketest_staff@primecare.ph', role: 'nurse', status: 'active' }
        });
        assert(updRes.status === 200 && updRes.body?.data?.user?.fullName === 'Smoke Test Nurse Updated' && updRes.body.data.user.role === 'nurse', 'Updated user profile and role via save.php');

        const roleRes = await admin.request('users/role.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: createdUserId, role: 'doctor' }
        });
        assert(roleRes.status === 200 && roleRes.body?.data?.user?.role === 'doctor', 'Changed role via role.php');

        const deactRes = await admin.request('users/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: createdUserId, status: 'inactive' }
        });
        assert(deactRes.status === 200 && deactRes.body?.data?.user?.status === 'inactive', 'Deactivated user via status.php');

        const blockedLogin = await tempUserClient.login('smoketest_staff', tempPassword);
        assert(blockedLogin.status !== 200, 'Deactivated user cannot log in');

        const reactRes = await admin.request('users/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: createdUserId, status: 'active' }
        });
        assert(reactRes.status === 200 && reactRes.body?.data?.user?.status === 'active', 'Reactivated user via status.php');

        const resetRes = await admin.request('users/reset-password.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: createdUserId }
        });
        const resetPw = resetRes.body?.data?.tempPassword;
        assert(resetRes.status === 200 && Boolean(resetPw) && resetPw !== tempPassword, 'Reset password returned new tempPassword');

        const resetLogin = await tempUserClient.login('smoketest_staff', resetPw);
        assert(resetLogin.status === 200, 'User can log in with reset tempPassword');
        await tempUserClient.logout();

        console.log('\n[4] Self-Protection, Last Admin Protection, Patient Guard & Referential Delete');
        const selfDeact = await admin.request('users/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'U-001', status: 'inactive' }
        });
        assert(selfDeact.status === 422, 'Cannot deactivate own admin account (422)');

        const selfRole = await admin.request('users/role.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'U-001', role: 'staff' }
        });
        assert(selfRole.status === 422, 'Cannot change own admin role (422)');

        const selfDel = await admin.request('users/delete.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'U-001' }
        });
        assert(selfDel.status === 422, 'Cannot delete self (422)');

        const patMod = await admin.request('users/role.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'U-005', role: 'staff' }
        });
        assert(patMod.status === 422, 'Cannot modify patient role via user management (422)');

        // Admin promotion + demotion guard via another admin? We only have U-001 active admin right now.
        const refDel = await admin.request('users/delete.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'U-002' }
        });
        assert(refDel.status === 409, 'Cannot delete U-002 with linked records (409 Conflict)');

        // Users who have logged in have audit history and must not be deleted (409)
        const refDelU7 = await admin.request('users/delete.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: createdUserId }
        });
        assert(refDelU7.status === 409, `Cannot delete ${createdUserId} after login/audit activity (409 Conflict)`);

        // Unreferenced newly created user (no logins/clinical history) deletes cleanly (200)
        const unusedRes = await admin.request('users/save.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: {
                fullName: 'Smoke Test Unused',
                username: 'smoketest_unused',
                email: 'smoketest_unused@primecare.ph',
                role: 'staff',
                status: 'inactive'
            }
        });
        const unusedId = unusedRes.body?.data?.user?.id;
        const cleanDel = await admin.request('users/delete.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: unusedId }
        });
        assert(cleanDel.status === 200, `Deleted unreferenced test user ${unusedId} (200 OK)`);

        console.log('\n[5] Audit Logs Verification');
        const auditRes = await admin.request('users/audit-logs.php', { params: { keyword: 'smoketest_staff' } });
        assert(auditRes.status === 200 && Array.isArray(auditRes.body?.data?.logs) && auditRes.body.data.logs.length >= 4, 'Audit logs recorded user management actions');
    } finally {
        cleanupTestData();
        await admin.logout();
        await staff.logout();
        await doctor.logout();
        await nurse.logout();
        await patient.logout();
    }

    const cnt = runSql('SELECT COUNT(*) FROM users;');
    const seq = runSql("SELECT current_val FROM sequences WHERE entity_key = 'users';");
    assert(cnt === '6' && seq === '6', `Database restored to 6 seeded users and sequence=${seq}`);

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    cleanupTestData();
    console.error('Unhandled error in users-smoke-test:', err);
    process.exit(1);
});
