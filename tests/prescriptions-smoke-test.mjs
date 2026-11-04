/**
 * PrimeCare HIS — Phase 5.8.2 Prescriptions & Pharmacy Backend Smoke Tests
 *
 * Verifies the migration of the Prescriptions & Pharmacy module from localStorage to MariaDB.
 *
 * Run:
 *   node tests/prescriptions-smoke-test.mjs
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'http://localhost/PrimeCare_v1/api';
const MYSQL_BIN = 'C:\\xampp\\mysql\\bin\\mysql.exe';
const PHP_BIN = 'C:\\xampp\\php\\php.exe';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

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
    return execFileSync(MYSQL_BIN, ['-u', 'root', 'primecare_db', '-N', '-B', '-e', sql], { encoding: 'utf8' }).trim();
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
            const first = raw.split(';')[0];
            const eq = first.indexOf('=');
            if (eq > 0) {
                const k = first.slice(0, eq).trim();
                const v = first.slice(eq + 1).trim();
                if (/expires=Thu, 01 Jan 1970|max-age=0/i.test(raw) || v === 'deleted' || v === '') this.cookies.delete(k);
                else this.cookies.set(k, v);
            }
        }
    }
    _cookieHeader() {
        return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    async request(endpoint, { method = 'GET', params = null, body = undefined, headers = {} } = {}) {
        let url = `${BASE_URL}/${endpoint.replace(/^\/+/, '')}`;
        if (params) {
            const sp = new URLSearchParams();
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
            }
            const qs = sp.toString();
            if (qs) url += `?${qs}`;
        }
        const reqHeaders = { ...headers };
        const cookie = this._cookieHeader();
        if (cookie) reqHeaders['Cookie'] = cookie;
        if (body !== undefined && !reqHeaders['Content-Type']) {
            reqHeaders['Content-Type'] = 'application/json';
        }
        const opts = { method, headers: reqHeaders };
        if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
        const res = await fetch(url, opts);
        this._storeCookies(res);
        let json = null;
        const text = await res.text();
        try { json = JSON.parse(text); } catch { /* not json */ }
        return { status: res.status, headers: res.headers, text, json };
    }
    async fetchCsrf() {
        const res = await this.request('auth/csrf.php');
        if (res.json && res.json.data && res.json.data.csrfToken) {
            this.csrfToken = res.json.data.csrfToken;
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
        if (res.json && res.json.data && res.json.data.csrfToken) {
            this.csrfToken = res.json.data.csrfToken;
        }
        return res;
    }
}

let originalBaselineHash = null;
let originalItemHash = null;
let originalRxSeq = null;

function captureOriginalState() {
    originalBaselineHash = runSql(`
        SELECT MD5(CONCAT_WS('|', id, patient_id, doctor_id, IFNULL(medical_record_id,''), status, prescribed_date, IFNULL(notes,''), override_allergy, IFNULL(override_reason,''), billed, IFNULL(bill_id,''), created_at))
        FROM prescriptions WHERE id = 'RX-001'
    `);
    originalItemHash = runSql(`
        SELECT MD5(CONCAT_WS('|', id, prescription_id, medicine, dosage, frequency, IFNULL(duration_days,''), IFNULL(instructions,'')))
        FROM prescription_items WHERE prescription_id = 'RX-001'
    `);
    originalRxSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'prescriptions'`), 10);
}

function cleanupTestData() {
    try {
        runSql(`
            DELETE FROM prescription_items WHERE prescription_id <> 'RX-001';
            DELETE FROM prescriptions WHERE id <> 'RX-001';
            UPDATE sequences SET current_val = ${originalRxSeq} WHERE entity_key = 'prescriptions';
            UPDATE patients SET status = 'pending' WHERE id = 'P-002';
            UPDATE users SET status = 'pending' WHERE id = 'U-006';
        `);
    } catch (e) {
        console.error('Warning during cleanupTestData:', e.message);
    }
}

async function runTests() {
    console.log('==============================================================');
    console.log('PrimeCare HIS — Phase 5.8.2 Prescriptions & Pharmacy Smoke Tests');
    console.log('==============================================================\n');

    captureOriginalState();
    cleanupTestData();

    const anon = new ClientSession('anon');
    const admin = new ClientSession('admin');
    const staff = new ClientSession('staff');
    const doctor = new ClientSession('doctor');
    const nurse = new ClientSession('nurse');
    const patient = new ClientSession('patient');
    const patient2 = new ClientSession('patient2');

    // -------------------------------------------------------------------------
    // [1] Unauthenticated access, method guards & no-delete-endpoint
    // -------------------------------------------------------------------------
    console.log('[1] Unauthenticated access, method guards & no-delete-endpoint');
    {
        const r1 = await anon.request('prescriptions/list.php');
        assert(r1.status === 401, 'Unauthenticated GET prescriptions/list.php -> 401');

        const r2 = await anon.request('prescriptions/get.php', { params: { id: 'RX-001' } });
        assert(r2.status === 401, 'Unauthenticated GET prescriptions/get.php -> 401');

        const r3 = await anon.request('prescriptions/create.php', { method: 'POST', body: {} });
        assert(r3.status === 401, 'Unauthenticated POST prescriptions/create.php -> 401');

        const r4 = await anon.request('prescriptions/status.php', { method: 'POST', body: {} });
        assert(r4.status === 401, 'Unauthenticated POST prescriptions/status.php -> 401');

        const r5 = await anon.request('prescriptions/create.php', { method: 'GET' });
        assert(r5.status === 405, 'GET on POST-only prescriptions/create.php -> 405');

        const r6 = await anon.request('prescriptions/status.php', { method: 'GET' });
        assert(r6.status === 405, 'GET on POST-only prescriptions/status.php -> 405');

        const r7 = await anon.request('prescriptions/delete.php');
        assert(r7.status === 404, 'prescriptions/delete.php does not exist (404 for GET)');

        const r8 = await anon.request('prescriptions/delete.php', { method: 'POST' });
        assert(r8.status === 404, 'prescriptions/delete.php does not exist (404 for POST)');
    }

    // -------------------------------------------------------------------------
    // [2] Logins across roles
    // -------------------------------------------------------------------------
    console.log('\n[2] Logins');
    {
        const aL = await admin.login('admin', 'password123');
        assert(aL.status === 200 && aL.json.data.user.role === 'admin', 'admin login succeeds');

        const sL = await staff.login('staff', 'password123');
        assert(sL.status === 200 && sL.json.data.user.role === 'staff', 'staff login succeeds');

        const dL = await doctor.login('doctor', 'password123');
        assert(dL.status === 200 && dL.json.data.user.role === 'doctor', 'doctor login succeeds');

        const nL = await nurse.login('nurse', 'password123');
        assert(nL.status === 200 && nL.json.data.user.role === 'nurse', 'nurse login succeeds');

        const pL = await patient.login('patient', 'password123');
        assert(pL.status === 200 && pL.json.data.user.role === 'patient', 'patient (P-001) login succeeds');
    }

    // -------------------------------------------------------------------------
    // [3] CSRF enforcement on mutating endpoints
    // -------------------------------------------------------------------------
    console.log('\n[3] CSRF enforcement on mutating endpoints');
    {
        const r1 = await doctor.request('prescriptions/create.php', { method: 'POST', body: { patientId: 'P-001' } });
        assert(r1.status === 403, 'POST create.php without CSRF token -> 403');

        const r2 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': 'bogus-csrf-token' },
            body: { patientId: 'P-001' }
        });
        assert(r2.status === 403, 'POST create.php with invalid CSRF token -> 403');

        const r3 = await nurse.request('prescriptions/status.php', { method: 'POST', body: { id: 'RX-001', status: 'Dispensed' } });
        assert(r3.status === 403, 'POST status.php without CSRF token -> 403');

        const r4 = await nurse.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': 'bogus-csrf-token' },
            body: { id: 'RX-001', status: 'Dispensed' }
        });
        assert(r4.status === 403, 'POST status.php with invalid CSRF token -> 403');
    }

    // -------------------------------------------------------------------------
    // [4] Baseline reads, projections & seeded record RX-001
    // -------------------------------------------------------------------------
    console.log('\n[4] Baseline reads, projections & seeded record RX-001');
    {
        const r = await admin.request('prescriptions/list.php');
        assert(r.status === 200 && Array.isArray(r.json.data.prescriptions), 'admin list returns 200');
        assert(r.json.data.prescriptions.length === 1, 'admin list returns exactly 1 seeded prescription');

        const rx = r.json.data.prescriptions[0];
        assert(rx.id === 'RX-001', 'RX-001 has correct ID');
        assert(rx.patientId === 'P-001' && rx.patientName === 'Juan Dela Cruz', 'RX-001 joins patientName');
        assert(rx.doctorId === 'D-001' && rx.doctorName === 'Dr. Jose Rizal', 'RX-001 joins doctorName');
        assert(rx.status === 'Dispensed', 'RX-001 status is Dispensed');
        assert(rx.date === '2026-11-02', 'RX-001 date matches prescribed_date');
        assert(rx.billed === true && rx.billId === 'B-001', 'RX-001 billed is true with billId B-001');
        assert(rx.notes === 'Avoid rubbing eyes.', 'RX-001 notes matches baseline');
        assert(Array.isArray(rx.items) && rx.items.length === 1, 'RX-001 contains exactly 1 item');

        const item = rx.items[0];
        assert(item.medicine === 'Artificial Tears', 'Item medicine is Artificial Tears');
        assert(item.dosage === '1 drop', 'Item dosage is 1 drop');
        assert(item.frequency === '3x a day', 'Item frequency is 3x a day');
        assert(item.durationDays === 30, 'Item durationDays is 30');
        assert(item.instructions === 'Apply to both eyes.', 'Item instructions match');

        // Nurse & Doctor reads
        const nList = await nurse.request('prescriptions/list.php');
        assert(nList.status === 200 && nList.json.data.prescriptions.length === 1, 'nurse reads list');

        const dList = await doctor.request('prescriptions/list.php');
        assert(dList.status === 200 && dList.json.data.prescriptions.length === 1, 'doctor reads list');

        // Single get
        const gRes = await doctor.request('prescriptions/get.php', { params: { id: 'RX-001' } });
        assert(gRes.status === 200 && gRes.json.data.prescription.id === 'RX-001', 'doctor GET get.php?id=RX-001 -> 200');

        // Filter tests
        const fActive = await admin.request('prescriptions/list.php', { params: { status: 'Active' } });
        assert(fActive.json.data.prescriptions.length === 0, 'Filter status=Active returns 0');

        const fDisp = await admin.request('prescriptions/list.php', { params: { status: 'Dispensed' } });
        assert(fDisp.json.data.prescriptions.length === 1, 'Filter status=Dispensed returns 1');

        const fDoc = await admin.request('prescriptions/list.php', { params: { doctorId: 'D-001' } });
        assert(fDoc.json.data.prescriptions.length === 1, 'Filter doctorId=D-001 returns 1');

        const fDoc2 = await admin.request('prescriptions/list.php', { params: { doctorId: 'D-002' } });
        assert(fDoc2.json.data.prescriptions.length === 0, 'Filter doctorId=D-002 returns 0');

        const fKw1 = await admin.request('prescriptions/list.php', { params: { keyword: 'Tears' } });
        assert(fKw1.json.data.prescriptions.length === 1, 'Keyword "Tears" matches RX-001');

        const fKw2 = await admin.request('prescriptions/list.php', { params: { keyword: 'Juan' } });
        assert(fKw2.json.data.prescriptions.length === 1, 'Keyword "Juan" matches RX-001');

        const fKw3 = await admin.request('prescriptions/list.php', { params: { keyword: 'NonExistentXYZ' } });
        assert(fKw3.json.data.prescriptions.length === 0, 'Keyword "NonExistentXYZ" returns 0');

        // ID validation
        const badId = await doctor.request('prescriptions/get.php', { params: { id: 'BOGUS' } });
        assert(badId.status === 400, 'Malformed ID -> 400');

        const notFound = await doctor.request('prescriptions/get.php', { params: { id: 'RX-999' } });
        assert(notFound.status === 404, 'Non-existent ID -> 404');
    }

    // -------------------------------------------------------------------------
    // [5] Staff Access Denial
    // -------------------------------------------------------------------------
    console.log('\n[5] Staff Access Denial (403)');
    {
        const r1 = await staff.request('prescriptions/list.php');
        assert(r1.status === 403, 'staff GET prescriptions/list.php -> 403');

        const r2 = await staff.request('prescriptions/get.php', { params: { id: 'RX-001' } });
        assert(r2.status === 403, 'staff GET prescriptions/get.php -> 403');

        const r3 = await staff.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { patientId: 'P-001' }
        });
        assert(r3.status === 403, 'staff POST prescriptions/create.php -> 403');

        const r4 = await staff.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { id: 'RX-001', status: 'Dispensed' }
        });
        assert(r4.status === 403, 'staff POST prescriptions/status.php -> 403');
    }

    // -------------------------------------------------------------------------
    // [6] Patient Ownership & IDOR Protection
    // -------------------------------------------------------------------------
    console.log('\n[6] Patient Ownership & IDOR Protection');
    {
        // Patient P-001 can view RX-001
        const p1 = await patient.request('prescriptions/get.php', { params: { id: 'RX-001' } });
        assert(p1.status === 200 && p1.json.data.prescription.id === 'RX-001', 'Patient P-001 reads own RX-001');

        const pList = await patient.request('prescriptions/list.php', { params: { my: 1 } });
        assert(pList.status === 200 && pList.json.data.prescriptions.length === 1, 'Patient P-001 list.php?my=1 returns RX-001');

        // Patient role write attempts blocked
        const pCreate = await patient.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { patientId: 'P-001' }
        });
        assert(pCreate.status === 403, 'Patient cannot create prescriptions -> 403');

        const pStatus = await patient.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'RX-001', status: 'Cancelled' }
        });
        assert(pStatus.status === 403, 'Patient cannot update status -> 403');

        // Verify P-002 temporarily for IDOR testing
        runSql(`UPDATE patients SET status = 'verified' WHERE id = 'P-002'; UPDATE users SET status = 'active' WHERE id = 'U-006';`);
        const p2L = await patient2.login('patient2', 'password123');
        assert(p2L.status === 200, 'patient2 logged in');

        // IDOR: patient2 cannot view P-001's prescription RX-001
        const idorGet = await patient2.request('prescriptions/get.php', { params: { id: 'RX-001' } });
        assert(idorGet.status === 403, 'patient2 GET RX-001 is BLOCKED (403 IDOR)');

        // IDOR: patient2 query list for P-001 is forced to P-002 (0 rows)
        const idorList = await patient2.request('prescriptions/list.php', { params: { patientId: 'P-001' } });
        assert(idorList.status === 200 && idorList.json.data.prescriptions.length === 0, 'patient2 querying patientId=P-001 scoped to own profile (0 rows)');
    }

    // -------------------------------------------------------------------------
    // [7] Role Enforcement on Writes (Server-side)
    // -------------------------------------------------------------------------
    console.log('\n[7] Role Enforcement on Writes');
    {
        const nCreate = await nurse.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { patientId: 'P-001', items: [{ medicine: 'Paracetamol', dosage: '500mg', frequency: 'PRN', durationDays: 3 }] }
        });
        assert(nCreate.status === 403, 'Nurse cannot create prescription -> 403');

        const nCancel = await nurse.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { id: 'RX-001', status: 'Cancelled' }
        });
        assert(nCancel.status === 403, 'Nurse cannot cancel prescription -> 403');

        const dDisp = await doctor.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'RX-001', status: 'Dispensed' }
        });
        assert(dDisp.status === 403, 'Doctor cannot dispense prescription -> 403');
    }

    // -------------------------------------------------------------------------
    // [8] Prescription Creation Validation
    // -------------------------------------------------------------------------
    console.log('\n[8] Prescription Creation Validation');
    {
        // Reset P-002 back to pending
        runSql(`UPDATE patients SET status = 'pending' WHERE id = 'P-002'; UPDATE users SET status = 'pending' WHERE id = 'U-006';`);

        const v1 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: '' }
        });
        assert(v1.status === 400, 'Missing patientId -> 400');

        const v2 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-999', items: [{ medicine: 'M', dosage: 'D', frequency: 'F', durationDays: 5 }] }
        });
        assert(v2.status === 404, 'Unknown patientId -> 404');

        const v3 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-002', items: [{ medicine: 'M', dosage: 'D', frequency: 'F', durationDays: 5 }] }
        });
        assert(v3.status === 400, 'Unverified patient P-002 -> 400');

        const v4 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', items: [] }
        });
        assert(v4.status === 400, 'Empty items array -> 400');

        const v5 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', items: [{ medicine: '', dosage: '500mg', frequency: '3x', durationDays: 7 }] }
        });
        assert(v5.status === 400, 'Missing medicine name -> 400');

        const v6 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', items: [{ medicine: 'Paracetamol', dosage: '', frequency: '3x', durationDays: 7 }] }
        });
        assert(v6.status === 400, 'Missing dosage -> 400');

        const v7 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', items: [{ medicine: 'Paracetamol', dosage: '500mg', frequency: '', durationDays: 7 }] }
        });
        assert(v7.status === 400, 'Missing frequency -> 400');

        const v8 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', items: [{ medicine: 'Paracetamol', dosage: '500mg', frequency: '3x', durationDays: -1 }] }
        });
        assert(v8.status === 400, 'Negative durationDays -> 400');

        const v9 = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', items: [{ medicine: 'Paracetamol', dosage: '500mg', frequency: '3x', durationDays: 999 }] }
        });
        assert(v9.status === 400, 'DurationDays > 365 -> 400');
    }

    // -------------------------------------------------------------------------
    // [9] Allergy Conflict Detection & Override Justification
    // -------------------------------------------------------------------------
    console.log('\n[9] Allergy Conflict Detection & Override Justification');
    {
        // P-001 is allergic to Penicillin and Aspirin
        const conflictRes = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: {
                patientId: 'P-001',
                items: [
                    { medicine: 'Penicillin V Potassium 500mg', dosage: '1 tab', frequency: '4x a day', durationDays: 7 }
                ]
            }
        });
        assert(conflictRes.status === 409, 'Prescribing penicillin to allergic patient returns 409');
        assert(conflictRes.json.data && conflictRes.json.data.allergyConflict === true, 'Response flags allergyConflict: true');
        assert(Array.isArray(conflictRes.json.data.conflicts) && conflictRes.json.data.conflicts.length > 0, 'Response includes conflicts array');

        // Short override reason (< 10 chars)
        const shortOverride = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: {
                patientId: 'P-001',
                overrideAllergy: true,
                overrideReason: 'too short',
                items: [
                    { medicine: 'Penicillin V Potassium 500mg', dosage: '1 tab', frequency: '4x a day', durationDays: 7 }
                ]
            }
        });
        assert(shortOverride.status === 400, 'Override reason < 10 chars rejected -> 400');

        // Valid override (>= 10 chars)
        const validOverride = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: {
                patientId: 'P-001',
                overrideAllergy: true,
                overrideReason: 'Confirmed negative skin test result.',
                items: [
                    { medicine: 'Penicillin V Potassium 500mg', dosage: '1 tab', frequency: '4x a day', durationDays: 7 }
                ]
            }
        });
        assert(validOverride.status === 201, 'Valid allergy override creates prescription (201)');
        const rxOverride = validOverride.json.data.prescription;
        assert(rxOverride.id === 'RX-002', 'Allocated RX-002');
        assert(rxOverride.overrideAllergy === true, 'overrideAllergy is true');
        assert(rxOverride.overrideReason === 'Confirmed negative skin test result.', 'overrideReason stored');
        assert(rxOverride.doctorId === 'D-001', 'Doctor attribution locked to D-001');

        // Verify audit log entry
        const auditLogged = parseInt(runSql(`SELECT COUNT(*) FROM audit_logs WHERE action = 'Allergy Override' AND details LIKE '%RX-002%'`), 10);
        assert(auditLogged >= 1, 'Allergy override written to audit_logs');
    }

    // -------------------------------------------------------------------------
    // [10] Multi-Item Prescriptions & Doctor Attribution
    // -------------------------------------------------------------------------
    console.log('\n[10] Multi-Item Prescriptions & Doctor Attribution');
    {
        // Doctor creates multi-item prescription
        // Even if body specifies doctorId='D-003', doctor profile D-001 is enforced
        const multiRes = await doctor.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: {
                patientId: 'P-001',
                doctorId: 'D-003', // Impersonation attempt
                notes: 'Take with plenty of water.',
                items: [
                    { medicine: 'Cetirizine 10mg', dosage: '1 tab', frequency: 'Once daily at bedtime', durationDays: 14, instructions: 'Take before sleep' },
                    { medicine: 'Paracetamol 500mg', dosage: '1-2 tabs', frequency: 'Every 4-6 hours PRN', durationDays: 5, instructions: 'For pain or fever' }
                ]
            }
        });
        assert(multiRes.status === 201, 'Multi-item prescription created (201)');
        const rxMulti = multiRes.json.data.prescription;
        assert(rxMulti.id === 'RX-003', 'Allocated RX-003');
        assert(rxMulti.doctorId === 'D-001', 'Doctor impersonation ignored; doctorId locked to D-001');
        assert(rxMulti.items.length === 2, 'Prescription has 2 child items');
        assert(rxMulti.items[0].medicine === 'Cetirizine 10mg', 'Item 1 medicine correct');
        assert(rxMulti.items[1].medicine === 'Paracetamol 500mg', 'Item 2 medicine correct');

        // Admin creates prescription attributed to D-002
        const adminRes = await admin.request('prescriptions/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: {
                patientId: 'P-001',
                doctorId: 'D-002',
                items: [
                    { medicine: 'Omeprazole 20mg', dosage: '1 cap', frequency: 'Once daily before breakfast', durationDays: 30 }
                ]
            }
        });
        assert(adminRes.status === 201, 'Admin created prescription (201)');
        assert(adminRes.json.data.prescription.id === 'RX-004', 'Allocated RX-004');
        assert(adminRes.json.data.prescription.doctorId === 'D-002', 'Admin assigned D-002 attribution');
    }

    // -------------------------------------------------------------------------
    // [11] Status Transitions & State Machine
    // -------------------------------------------------------------------------
    console.log('\n[11] Status Transitions & State Machine');
    {
        // Nurse dispenses RX-002
        const dispRes = await nurse.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { id: 'RX-002', status: 'Dispensed' }
        });
        assert(dispRes.status === 200, 'Nurse marks RX-002 as Dispensed -> 200');

        const rx002 = (await admin.request('prescriptions/get.php', { params: { id: 'RX-002' } })).json.data.prescription;
        assert(rx002.status === 'Dispensed', 'RX-002 status is now Dispensed');

        // Attempting to transition from Dispensed -> 400
        const dispAgain = await nurse.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { id: 'RX-002', status: 'Dispensed' }
        });
        assert(dispAgain.status === 400, 'Cannot re-dispense already Dispensed prescription -> 400');

        const cancelDisp = await doctor.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'RX-002', status: 'Cancelled' }
        });
        assert(cancelDisp.status === 400, 'Cannot cancel already Dispensed prescription -> 400');

        // Doctor cancels RX-003
        const cancelRes = await doctor.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'RX-003', status: 'Cancelled' }
        });
        assert(cancelRes.status === 200, 'Doctor cancels RX-003 -> 200');

        const rx003 = (await admin.request('prescriptions/get.php', { params: { id: 'RX-003' } })).json.data.prescription;
        assert(rx003.status === 'Cancelled', 'RX-003 status is now Cancelled');

        // Cannot dispense a Cancelled prescription
        const dispCancelled = await nurse.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { id: 'RX-003', status: 'Dispensed' }
        });
        assert(dispCancelled.status === 400, 'Cannot dispense Cancelled prescription -> 400');

        // Cannot cancel a billed prescription (RX-001 is seeded with billed=1)
        const cancelBilled = await admin.request('prescriptions/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'RX-001', status: 'Cancelled' }
        });
        assert(cancelBilled.status === 400, 'Cannot cancel already billed prescription RX-001 -> 400');
    }

    // -------------------------------------------------------------------------
    // [12] Transaction Rollback Verification
    // -------------------------------------------------------------------------
    console.log('\n[12] Transaction Rollback Verification');
    {
        const probeOut = execFileSync(PHP_BIN, [path.join(PROJECT_ROOT, 'tests', 'prescriptions-rollback-probe.php')], { encoding: 'utf8' }).trim();
        let probeData = {};
        try { probeData = JSON.parse(probeOut); } catch {}
        assert(probeData.threw === true, 'Rollback probe threw an exception as expected');
        assert(probeData.inTxAfter === false, 'Rollback probe left no transaction open');
        assert(probeData.rxCountMatches === true, 'prescriptions count unchanged after rollback');
        assert(probeData.itemCountMatches === true, 'prescription_items count unchanged after rollback');
    }

    // -------------------------------------------------------------------------
    // [13] Data Integrity & Seed Preservation
    // -------------------------------------------------------------------------
    console.log('\n[13] Data Integrity & Seed Preservation');
    {
        // Referential integrity: patient P-001 cannot be deleted
        const delPat = await admin.request('patients/delete.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'P-001' }
        });
        assert(delPat.status === 409, 'Patient P-001 with prescriptions cannot be deleted (409)');

        // Doctor D-001 cannot be deleted
        const delDoc = await admin.request('doctors/delete.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'D-001' }
        });
        assert(delDoc.status === 409, 'Doctor D-001 with prescriptions cannot be deleted (409)');

        // Seeded RX-001 byte-for-byte check
        const currentBaselineHash = runSql(`
            SELECT MD5(CONCAT_WS('|', id, patient_id, doctor_id, IFNULL(medical_record_id,''), status, prescribed_date, IFNULL(notes,''), override_allergy, IFNULL(override_reason,''), billed, IFNULL(bill_id,''), created_at))
            FROM prescriptions WHERE id = 'RX-001'
        `);
        assert(currentBaselineHash === originalBaselineHash, 'Seeded prescription RX-001 is byte-for-byte unchanged');

        const currentItemHash = runSql(`
            SELECT MD5(CONCAT_WS('|', id, prescription_id, medicine, dosage, frequency, IFNULL(duration_days,''), IFNULL(instructions,'')))
            FROM prescription_items WHERE prescription_id = 'RX-001'
        `);
        assert(currentItemHash === originalItemHash, 'Seeded item Artificial Tears is byte-for-byte unchanged');

        // Cleanup test prescriptions
        cleanupTestData();

        const rxCountAfter = parseInt(runSql(`SELECT COUNT(*) FROM prescriptions`), 10);
        assert(rxCountAfter === 1, 'Only seeded prescription RX-001 remains in prescriptions');

        const itemCountAfter = parseInt(runSql(`SELECT COUNT(*) FROM prescription_items`), 10);
        assert(itemCountAfter === 1, 'Only seeded item remains in prescription_items');

        const seqAfter = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'prescriptions'`), 10);
        assert(seqAfter === 1, 'prescriptions sequence restored to 1');
    }

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Unhandled error in prescriptions-smoke-test:', err);
    process.exit(1);
});

