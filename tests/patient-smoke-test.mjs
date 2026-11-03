/**
 * PrimeCare HIS — Phase 5.3.2 Automated Patient Management & Security Smoke Test
 *
 * Tests all Phase 5.3.2 PHP endpoints against live Apache + MariaDB:
 *   - api/patients/list.php
 *   - api/patients/get.php
 *   - api/patients/check-unique.php
 *   - api/patients/create.php
 *   - api/patients/register.php
 *   - api/patients/update.php
 *   - api/patients/verify.php
 *   - api/patients/delete.php
 *   - api/auth/change-password.php
 */

const BASE_URL = 'http://localhost/PrimeCare_v1/api';

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
        return Array.from(this.cookies.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
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
        const json = await res.json().catch(() => null);
        return { status: res.status, body: json };
    }

    async fetchCsrf() {
        const res = await this.request('auth/csrf.php');
        if (res.body?.data?.csrfToken) {
            this.csrfToken = res.body.data.csrfToken;
        }
        return res;
    }

    async login(username, password) {
        await this.fetchCsrf();
        const res = await this.request('auth/login.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': this.csrfToken },
            body: { username, password }
        });
        if (res.body?.data?.csrfToken) {
            this.csrfToken = res.body.data.csrfToken;
        }
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

async function run() {
    console.log('=== PrimeCare Phase 5.3.2 Patient Management Smoke Tests ===\n');

    // 1. Unauthenticated & RBAC checks
    console.log('1. Unauthenticated & RBAC Guards');
    const anon = new ClientSession('anon');
    const unauthList = await anon.request('patients/list.php');
    assert(unauthList.status === 401 && unauthList.body?.success === false, 'Unauthenticated GET patients/list.php -> 401');

    const unauthGet = await anon.request('patients/get.php', { params: { id: 'P-001' } });
    assert(unauthGet.status === 401 && unauthGet.body?.success === false, 'Unauthenticated GET patients/get.php -> 401');

    const patient = new ClientSession('patient');
    const pLogin = await patient.login('patient', 'password123');
    assert(pLogin.status === 200 && pLogin.body?.success === true, 'patient logs in');

    const patientListTry = await patient.request('patients/list.php');
    assert(patientListTry.status === 403 && patientListTry.body?.success === false, 'patient blocked from GET patients/list.php -> 403');

    // 2. IDOR & Own-Record Scoping
    console.log('\n2. IDOR Protection & Own-Record Scoping (api/patients/get.php)');
    const p1Me = await patient.request('patients/get.php', { params: { me: 1 } });
    assert(p1Me.status === 200 && p1Me.body?.data?.patient?.id === 'P-001', 'patient GET get.php?me=1 returns P-001');
    assert(p1Me.body?.data?.patient?.street === '123 Katipunan Ave.', 'P-001 street populated');
    assert(p1Me.body?.data?.patient?.brgy === 'Loyola Heights', 'P-001 brgy populated');
    assert(p1Me.body?.data?.patient?.city === 'Quezon City', 'P-001 city populated');
    assert(p1Me.body?.data?.patient?.province === 'Metro Manila', 'P-001 province populated');

    const p1OwnId = await patient.request('patients/get.php', { params: { id: 'P-001' } });
    assert(p1OwnId.status === 200 && p1OwnId.body?.data?.patient?.id === 'P-001', 'patient GET get.php?id=P-001 allowed');

    const p1Idor = await patient.request('patients/get.php', { params: { id: 'P-002' } });
    assert(p1Idor.status === 403 && p1Idor.body?.success === false, 'patient GET get.php?id=P-002 blocked (IDOR 403)');

    // 3. Staff / Nurse / Doctor / Admin list & preview mode
    console.log('\n3. Staff List, Search, Filter, Sort & Preview Mode');
    const staff = new ClientSession('staff');
    const sLogin = await staff.login('staff', 'password123');
    assert(sLogin.status === 200 && sLogin.body?.success === true, 'staff logs in');

    const staffMePreview = await staff.request('patients/get.php', { params: { me: 1 } });
    assert(
        staffMePreview.status === 200 && staffMePreview.body?.data?.previewMode === true && staffMePreview.body?.data?.patient?.id === 'P-001',
        'staff GET get.php?me=1 returns P-001 in previewMode'
    );

    const allList = await staff.request('patients/list.php');
    assert(allList.status === 200 && Array.isArray(allList.body?.data?.patients), 'staff GET patients/list.php -> 200');
    assert(allList.body?.data?.counts?.all >= 2, 'counts.all >= 2');
    assert(allList.body?.data?.counts?.pending >= 1, 'counts.pending >= 1 (P-002 is pending)');
    assert(allList.body?.data?.counts?.verified >= 1, 'counts.verified >= 1 (P-001 is verified)');

    const pendingOnly = await staff.request('patients/list.php', { params: { status: 'pending' } });
    assert(
        pendingOnly.status === 200 && pendingOnly.body.data.patients.some(p => p.id === 'P-002') && !pendingOnly.body.data.patients.some(p => p.id === 'P-001'),
        'Filter status=pending returns P-002 and excludes P-001'
    );

    const kwSearch = await staff.request('patients/list.php', { params: { keyword: 'Leonor' } });
    assert(kwSearch.status === 200 && kwSearch.body.data.patients.length === 1 && kwSearch.body.data.patients[0].id === 'P-002', 'Keyword search "Leonor" finds P-002');

    const sqliSort = await staff.request('patients/list.php', { params: { sortBy: 'id; DROP TABLE patients;--', sortDir: 'asc' } });
    assert(sqliSort.status === 200 && sqliSort.body.data.patients.length >= 2, 'SQLi attempt in sortBy safely falls back to whitelist');

    // 4. Uniqueness & ID Types Endpoint
    console.log('\n4. Uniqueness & Reference Checks (api/patients/check-unique.php)');
    const idTypesRes = await anon.request('patients/check-unique.php', { params: { field: 'idTypes' } });
    assert(idTypesRes.status === 200 && idTypesRes.body?.data?.idTypes?.length === 8, 'check-unique field=idTypes returns 8 ID types');

    const uTaken = await anon.request('patients/check-unique.php', { params: { field: 'username', value: 'patient' } });
    assert(uTaken.status === 200 && uTaken.body?.data?.taken === true, 'username "patient" is taken');

    const uFree = await anon.request('patients/check-unique.php', { params: { field: 'username', value: 'totally_unused_user_999' } });
    assert(uFree.status === 200 && uFree.body?.data?.taken === false, 'unused username is not taken');

    const mTaken = await staff.request('patients/check-unique.php', { params: { field: 'mobile', value: '09171234567' } });
    assert(mTaken.status === 200 && mTaken.body?.data?.taken === true, 'mobile 09171234567 is taken');

    const mExcl = await staff.request('patients/check-unique.php', { params: { field: 'mobile', value: '09171234567', excludeId: 'P-001' } });
    assert(mExcl.status === 200 && mExcl.body?.data?.taken === false, 'mobile 09171234567 with excludeId=P-001 is not taken');

    // 5. Walk-In Patient Registration (api/patients/create.php)
    console.log('\n5. Walk-in Patient Registration (api/patients/create.php)');
    const noCsrfCreate = await staff.request('patients/create.php', {
        method: 'POST',
        body: { firstName: 'No', lastName: 'Csrf' }
    });
    assert(noCsrfCreate.status === 403, 'Walk-in create without CSRF token -> 403');

    const patientTryCreate = await patient.request('patients/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient.csrfToken },
        body: { firstName: 'Forbidden', lastName: 'Patient' }
    });
    assert(patientTryCreate.status === 403, 'patient blocked from walk-in create -> 403');

    const dupMobileCreate = await staff.request('patients/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: {
            firstName: 'Dup',
            lastName: 'Mobile',
            birthdate: '1990-05-10',
            sex: 'Male',
            civilStatus: 'Single',
            mobile: '09171234567',
            street: '10 Main St',
            brgy: 'San Antonio',
            city: 'Pasig',
            province: 'Metro Manila',
            emergencyContactName: 'Contact One',
            emergencyContactNumber: '09180000001',
            emergencyContactRelationship: 'Sibling',
            admitType: 'Outpatient',
            dateAdmitted: '2026-11-03'
        }
    });
    assert(dupMobileCreate.status === 409 && dupMobileCreate.body?.success === false, 'Walk-in create with duplicate mobile -> 409');

    const walkInCreate = await staff.request('patients/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: {
            firstName: 'Emilio',
            middleName: 'Famy',
            lastName: 'Aguinaldo',
            birthdate: '1988-03-22',
            sex: 'Male',
            civilStatus: 'Married',
            mobile: '09179990001',
            email: 'emilio.walkin@test.local',
            street: '789 Kawit Rd.',
            brgy: 'Binakayan',
            city: 'Kawit',
            province: 'Cavite',
            emergencyContactName: 'Hilaria Aguinaldo',
            emergencyContactNumber: '09179990002',
            emergencyContactRelationship: 'Spouse',
            admitType: 'Outpatient',
            dateAdmitted: '2026-11-03',
            bloodType: 'O+',
            idType: 'PhilSys (National ID)',
            idNumber: 'PSN-9999-0001'
        }
    });
    const walkInId = walkInCreate.body?.data?.patient?.id;
    assert(walkInCreate.status === 201 && walkInCreate.body?.success === true && Boolean(walkInId), `Walk-in patient created (${walkInId})`);
    assert(walkInCreate.body?.data?.patient?.status === 'verified', 'Walk-in patient is auto-verified');
    assert(walkInCreate.body?.data?.patient?.verifiedBy === 'Andres Bonifacio', 'Walk-in verifiedBy set to staff fullName');
    assert(walkInCreate.body?.data?.patient?.brgy === 'Binakayan', 'Walk-in structured brgy saved');

    // 6. Public Self-Registration, Pending Login Block, Staff Verification, Profile Update, Password Change, Rejection
    console.log('\n6. Public Self-Registration & Full Verification Lifecycle');
    await anon.fetchCsrf();

    const minorReg = await anon.request('patients/register.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': anon.csrfToken },
        body: {
            firstName: 'Young',
            lastName: 'Patient',
            birthdate: '2015-01-01',
            sex: 'Female',
            civilStatus: 'Single',
            mobile: '09178880001',
            email: 'young@test.local',
            street: '1 St',
            brgy: 'B1',
            city: 'C1',
            province: 'P1',
            idType: 'Passport',
            idNumber: 'P-MINOR-01',
            emergencyContactName: 'Parent',
            emergencyContactNumber: '09178880002',
            emergencyContactRelationship: 'Parent',
            username: 'minor_user1',
            password: 'Password123'
        }
    });
    assert(minorReg.status === 400 && minorReg.body?.success === false, 'Under-18 self-registration rejected -> 400');

    const selfReg = await anon.request('patients/register.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': anon.csrfToken },
        body: {
            firstName: 'Gabriela',
            lastName: 'Silang',
            birthdate: '1994-03-19',
            sex: 'Female',
            civilStatus: 'Married',
            mobile: '09178880011',
            email: 'gabriela.silang@test.local',
            street: '45 Ilocos St.',
            brgy: 'Santa',
            city: 'Vigan',
            province: 'Ilocos Sur',
            idType: 'Passport',
            idNumber: 'PH-GAB-2026',
            emergencyContactName: 'Diego Silang',
            emergencyContactNumber: '09178880012',
            emergencyContactRelationship: 'Spouse',
            username: 'gabriela_test',
            password: 'Password123'
        }
    });
    const selfPatientId = selfReg.body?.data?.patient?.id;
    const selfUserId = selfReg.body?.data?.patient?.userId;
    assert(selfReg.status === 201 && selfReg.body?.success === true && Boolean(selfPatientId) && Boolean(selfUserId), `Self-registered patient created (${selfPatientId}, user ${selfUserId})`);
    assert(selfReg.body?.data?.patient?.status === 'pending', 'Self-registered patient starts as pending');

    const gabriela = new ClientSession('gabriela');
    const pendingLoginTry = await gabriela.login('gabriela_test', 'Password123');
    assert(pendingLoginTry.status === 403 && pendingLoginTry.body?.success === false, 'Pending self-registered patient cannot log in before staff verification -> 403');

    // Attempt to set Inpatient while pending -> 400
    const inpatientPendingTry = await staff.request('patients/update.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { id: selfPatientId, admitType: 'Inpatient', ward: 'General Ward A' }
    });
    assert(inpatientPendingTry.status === 400, 'Cannot set Inpatient status for an unverified patient -> 400');

    // Staff verifies Gabriela
    const verifyRes = await staff.request('patients/verify.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { id: selfPatientId, action: 'verify' }
    });
    assert(verifyRes.status === 200 && verifyRes.body?.data?.patient?.status === 'verified', 'staff verifies self-registered patient -> verified');

    // Now Gabriela can log in!
    const verifiedLogin = await gabriela.login('gabriela_test', 'Password123');
    assert(verifiedLogin.status === 200 && verifiedLogin.body?.success === true, 'Verified self-registered patient logs in -> 200');

    // Gabriela updates her own contact & address, and tries to spoof firstName
    const selfUpdate = await gabriela.request('patients/update.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': gabriela.csrfToken },
        body: {
            id: selfPatientId,
            firstName: 'SpoofedFirstName',
            mobile: '09178880099',
            email: 'gabriela.updated@test.local',
            street: '99 Heritage Calle',
            brgy: 'Poblacion',
            city: 'Vigan',
            province: 'Ilocos Sur',
            emergencyContactName: 'Diego Silang Jr.',
            emergencyContactNumber: '09178880012',
            emergencyContactRelationship: 'Spouse'
        }
    });
    assert(selfUpdate.status === 200 && selfUpdate.body?.data?.patient?.mobile === '09178880099', 'Patient updates own contact & structured address -> 200');
    assert(selfUpdate.body?.data?.patient?.firstName === 'Gabriela', 'Patient cannot overwrite restricted demographic field (firstName ignored)');
    assert(selfUpdate.body?.data?.patient?.address === '99 Heritage Calle, Poblacion, Vigan, Ilocos Sur', 'Combined address rebuilt from structured fields');

    // Gabriela tries to update P-001 -> 403 IDOR
    const selfUpdateOther = await gabriela.request('patients/update.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': gabriela.csrfToken },
        body: { id: 'P-001', mobile: '09170000000' }
    });
    assert(selfUpdateOther.status === 403, 'Patient blocked from updating another patient record -> 403');

    // Gabriela changes her own password
    const badOldPw = await gabriela.request('auth/change-password.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': gabriela.csrfToken },
        body: { oldPassword: 'WrongPassword1', newPassword: 'NewPassword123' }
    });
    assert(badOldPw.status === 400 && badOldPw.body?.success === false, 'change-password with wrong current password -> 400');

    const goodPwChange = await gabriela.request('auth/change-password.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': gabriela.csrfToken },
        body: { oldPassword: 'Password123', newPassword: 'NewPassword123' }
    });
    assert(goodPwChange.status === 200 && goodPwChange.body?.success === true, 'change-password with valid password -> 200');

    await gabriela.logout();
    const reloginNewPw = await gabriela.login('gabriela_test', 'NewPassword123');
    assert(reloginNewPw.status === 200 && reloginNewPw.body?.success === true, 'Patient logs in with newly changed password -> 200');
    await gabriela.logout();

    // Staff rejects Gabriela
    const shortReject = await staff.request('patients/verify.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { id: selfPatientId, action: 'reject', reason: 'Too short' }
    });
    assert(shortReject.status === 400, 'Rejection reason < 10 chars rejected -> 400');

    const validReject = await staff.request('patients/verify.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { id: selfPatientId, action: 'reject', reason: 'Automated smoke test rejection verification' }
    });
    assert(validReject.status === 200 && validReject.body?.data?.patient?.status === 'rejected', 'Staff rejects patient -> status=rejected');

    const rejectedLoginTry = await gabriela.login('gabriela_test', 'NewPassword123');
    assert(rejectedLoginTry.status === 403 && rejectedLoginTry.body?.success === false, 'Rejected patient account blocked from logging in -> 403');

    // 7. Deletion & Role / Referential Integrity Guards
    console.log('\n7. Patient Deletion (api/patients/delete.php)');
    const staffTryDelete = await staff.request('patients/delete.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { id: walkInId }
    });
    assert(staffTryDelete.status === 403, 'staff blocked from deleting patient (admin only) -> 403');

    const admin = new ClientSession('admin');
    const adminLogin = await admin.login('admin', 'password123');
    assert(adminLogin.status === 200 && adminLogin.body?.success === true, 'admin logs in');

    // Referential integrity check: P-001 has seeded appointments/records/bills -> must return 409
    const delProtected = await admin.request('patients/delete.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: 'P-001' }
    });
    assert(delProtected.status === 409 && delProtected.body?.success === false, 'admin blocked from deleting P-001 with existing child records -> 409');

    const delWalkIn = await admin.request('patients/delete.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: walkInId }
    });
    assert(delWalkIn.status === 200 && delWalkIn.body?.success === true, `admin deletes walk-in test patient (${walkInId}) -> 200`);

    const delSelfReg = await admin.request('patients/delete.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: selfPatientId }
    });
    assert(delSelfReg.status === 200 && delSelfReg.body?.success === true, `admin deletes self-registered test patient (${selfPatientId}) and linked user (${selfUserId}) -> 200`);

    const verifyGone = await admin.request('patients/get.php', { params: { id: selfPatientId } });
    assert(verifyGone.status === 404, 'Deleted patient returns 404');

    await patient.logout();
    await staff.logout();
    await admin.logout();

    console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
}

run().catch(err => {
    console.error('Unhandled error in smoke test:', err);
    process.exit(1);
});
