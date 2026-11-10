/**
 * PrimeCare HIS — Phase 5.10.2 Lab Results Backend Smoke Tests
 *
 * Verifies the migration of the Lab Results module from localStorage to PHP/MariaDB.
 *
 * Run:
 *   node tests/lab-results-smoke-test.mjs
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

let originalLab001Hash = null;
let originalLab002Hash = null;
let originalLabSeq = null;
let originalBillSeq = null;

function captureOriginalState() {
    originalLab001Hash = runSql(`
        SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(ordered_by,''), test_name, category, status, IFNULL(result,''), IFNULL(unit,''), IFNULL(ref_range_min,''), IFNULL(ref_range_max,''), IFNULL(flag,''), IFNULL(attachment_name,''), ordered_date, IFNULL(result_date,''), IFNULL(performed_by,''), billed, IFNULL(bill_id,'')))
        FROM lab_results WHERE id = 'LAB-001'
    `);
    originalLab002Hash = runSql(`
        SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(ordered_by,''), test_name, category, status, IFNULL(result,''), IFNULL(unit,''), IFNULL(ref_range_min,''), IFNULL(ref_range_max,''), IFNULL(flag,''), IFNULL(attachment_name,''), ordered_date, IFNULL(result_date,''), IFNULL(performed_by,''), billed, IFNULL(bill_id,'')))
        FROM lab_results WHERE id = 'LAB-002'
    `);
    originalLabSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'labResults'`), 10);
    originalBillSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'bills'`), 10);
}

function cleanupTestData() {
    try {
        runSql(`
            UPDATE lab_results SET billed = 0, bill_id = NULL WHERE id = 'LAB-002';
            DELETE FROM bill_items WHERE bill_id NOT IN ('B-001', 'B-002');
            DELETE FROM lab_results WHERE id NOT IN ('LAB-001', 'LAB-002');
            DELETE FROM bills WHERE id NOT IN ('B-001', 'B-002');
            UPDATE sequences SET current_val = ${originalLabSeq || 2} WHERE entity_key = 'labResults';
            UPDATE sequences SET current_val = ${originalBillSeq || 2} WHERE entity_key = 'bills';
            UPDATE patients SET status = 'pending' WHERE id = 'P-002';
            UPDATE users SET status = 'pending' WHERE id = 'U-006';
        `);
    } catch (e) {
        console.error('Warning during cleanupTestData:', e.message);
    }
}

async function runTests() {
    console.log('==============================================================');
    console.log('PrimeCare HIS — Phase 5.10.2 Lab Results Smoke Tests');
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
        const r1 = await anon.request('lab-results/list.php');
        assert(r1.status === 401, 'Unauthenticated GET lab-results/list.php -> 401');

        const r2 = await anon.request('lab-results/get.php', { params: { id: 'LAB-001' } });
        assert(r2.status === 401, 'Unauthenticated GET lab-results/get.php -> 401');

        const r3 = await anon.request('lab-results/create.php', { method: 'POST', body: {} });
        assert(r3.status === 401, 'Unauthenticated POST lab-results/create.php -> 401');

        const r4 = await anon.request('lab-results/update.php', { method: 'POST', body: {} });
        assert(r4.status === 401, 'Unauthenticated POST lab-results/update.php -> 401');

        const r5 = await anon.request('lab-results/status.php', { method: 'POST', body: {} });
        assert(r5.status === 401, 'Unauthenticated POST lab-results/status.php -> 401');

        const r6 = await anon.request('lab-results/create.php', { method: 'GET' });
        assert(r6.status === 405, 'GET on POST-only lab-results/create.php -> 405');

        const r7 = await anon.request('lab-results/update.php', { method: 'GET' });
        assert(r7.status === 405, 'GET on POST-only lab-results/update.php -> 405');

        const r8 = await anon.request('lab-results/status.php', { method: 'GET' });
        assert(r8.status === 405, 'GET on POST-only lab-results/status.php -> 405');

        const r9 = await anon.request('lab-results/list.php', { method: 'POST', body: {} });
        assert(r9.status === 405, 'POST on GET-only lab-results/list.php -> 405');

        const r10 = await anon.request('lab-results/delete.php');
        assert(r10.status === 404, 'lab-results/delete.php does not exist (404 for GET)');

        const r11 = await anon.request('lab-results/delete.php', { method: 'POST' });
        assert(r11.status === 404, 'lab-results/delete.php does not exist (404 for POST)');
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
        const r1 = await doctor.request('lab-results/create.php', {
            method: 'POST',
            body: { patientId: 'P-001', testName: 'CBC', category: 'Hematology' }
        });
        assert(r1.status === 403, 'POST create.php without CSRF token -> 403');

        const r2 = await doctor.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': 'invalid-csrf-token' },
            body: { patientId: 'P-001', testName: 'CBC', category: 'Hematology' }
        });
        assert(r2.status === 403, 'POST create.php with invalid CSRF token -> 403');

        const r3 = await nurse.request('lab-results/update.php', {
            method: 'POST',
            body: { id: 'LAB-002', result: '190' }
        });
        assert(r3.status === 403, 'POST update.php without CSRF token -> 403');

        const r4 = await nurse.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': 'invalid-csrf-token' },
            body: { id: 'LAB-002', result: '190' }
        });
        assert(r4.status === 403, 'POST update.php with invalid CSRF token -> 403');

        const r5 = await doctor.request('lab-results/status.php', {
            method: 'POST',
            body: { id: 'LAB-001', action: 'review' }
        });
        assert(r5.status === 403, 'POST status.php without CSRF token -> 403');

        const r6 = await doctor.request('lab-results/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': 'invalid-csrf-token' },
            body: { id: 'LAB-001', action: 'review' }
        });
        assert(r6.status === 403, 'POST status.php with invalid CSRF token -> 403');
    }

    // -------------------------------------------------------------------------
    // [4] Baseline reads, projections & seeded records LAB-001 and LAB-002
    // -------------------------------------------------------------------------
    console.log('\n[4] Baseline reads, projections & seeded records LAB-001 and LAB-002');
    {
        const r = await admin.request('lab-results/list.php');
        assert(r.status === 200 && Array.isArray(r.json.data.labs), 'admin list returns 200');
        assert(r.json.data.labs.length === 2, 'admin list returns 2 seeded lab results');

        // Ordered by ordered_date DESC, id DESC -> LAB-002 (2026-11-03) first, LAB-001 (2026-11-02) second
        const lab2 = r.json.data.labs.find(l => l.id === 'LAB-002');
        const lab1 = r.json.data.labs.find(l => l.id === 'LAB-001');

        assert(Boolean(lab1), 'LAB-001 present in list');
        assert(lab1.patientId === 'P-001' && lab1.patientName === 'Juan Dela Cruz', 'LAB-001 joins patientName');
        assert(lab1.orderedBy === 'D-001' && lab1.doctorName === 'Dr. Jose Rizal', 'LAB-001 joins doctorName');
        assert(lab1.testName === 'Complete Blood Count' && lab1.category === 'Hematology', 'LAB-001 testName & category match');
        assert(lab1.status === 'Completed' && lab1.flag === 'Abnormal', 'LAB-001 status Completed & flag Abnormal');
        assert(lab1.result === '13.5' && lab1.unit === 'g/dL', 'LAB-001 result & unit match');
        assert(lab1.referenceRange && lab1.referenceRange.min === '13.8' && lab1.referenceRange.max === '17.2', 'LAB-001 nested referenceRange matches');
        assert(lab1.refRangeMin === 13.8 && lab1.refRangeMax === 17.2, 'LAB-001 flat refRangeMin/Max match');
        assert(lab1.billed === true && lab1.billId === 'B-001', 'LAB-001 billed under B-001');

        assert(Boolean(lab2), 'LAB-002 present in list');
        assert(lab2.testName === 'Lipid Profile' && lab2.category === 'Chemistry', 'LAB-002 testName & category match');
        assert(lab2.status === 'Completed' && lab2.flag === 'Normal', 'LAB-002 status Completed & flag Normal');
        assert(lab2.result === '180' && lab2.unit === 'mg/dL', 'LAB-002 result & unit match');
        assert(lab2.billed === false && lab2.billId === null, 'LAB-002 is unbilled');

        // Nurse & Doctor reads
        const nList = await nurse.request('lab-results/list.php');
        assert(nList.status === 200 && nList.json.data.labs.length === 2, 'nurse reads list');

        const dList = await doctor.request('lab-results/list.php');
        assert(dList.status === 200 && dList.json.data.labs.length === 2, 'doctor reads list');

        // Single get
        const gRes = await doctor.request('lab-results/get.php', { params: { id: 'LAB-001' } });
        assert(gRes.status === 200 && gRes.json.data.lab.id === 'LAB-001', 'doctor GET get.php?id=LAB-001 -> 200');

        // Filter tests
        const fAbn = await admin.request('lab-results/list.php', { params: { flag: 'Abnormal' } });
        assert(fAbn.json.data.labs.length === 1 && fAbn.json.data.labs[0].id === 'LAB-001', 'Filter flag=Abnormal returns LAB-001');

        const fNor = await admin.request('lab-results/list.php', { params: { flag: 'Normal' } });
        assert(fNor.json.data.labs.length === 1 && fNor.json.data.labs[0].id === 'LAB-002', 'Filter flag=Normal returns LAB-002');

        const fCat = await admin.request('lab-results/list.php', { params: { category: 'Chemistry' } });
        assert(fCat.json.data.labs.length === 1 && fCat.json.data.labs[0].id === 'LAB-002', 'Filter category=Chemistry returns LAB-002');

        const fKw = await admin.request('lab-results/list.php', { params: { keyword: 'Lipid' } });
        assert(fKw.json.data.labs.length === 1 && fKw.json.data.labs[0].id === 'LAB-002', 'Keyword "Lipid" returns LAB-002');

        const badId = await doctor.request('lab-results/get.php', { params: { id: 'INVALID' } });
        assert(badId.status === 400, 'Malformed ID -> 400');

        const notFound = await doctor.request('lab-results/get.php', { params: { id: 'LAB-999' } });
        assert(notFound.status === 404, 'Non-existent ID -> 404');
    }

    // -------------------------------------------------------------------------
    // [5] Staff Access Denial (403 across all endpoints)
    // -------------------------------------------------------------------------
    console.log('\n[5] Staff Access Denial (403)');
    {
        const r1 = await staff.request('lab-results/list.php');
        assert(r1.status === 403, 'staff GET lab-results/list.php -> 403');

        const r2 = await staff.request('lab-results/get.php', { params: { id: 'LAB-001' } });
        assert(r2.status === 403, 'staff GET lab-results/get.php -> 403');

        const r3 = await staff.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { patientId: 'P-001', testName: 'Urinalysis', category: 'Urinalysis' }
        });
        assert(r3.status === 403, 'staff POST lab-results/create.php -> 403');

        const r4 = await staff.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { id: 'LAB-002', result: '190' }
        });
        assert(r4.status === 403, 'staff POST lab-results/update.php -> 403');

        const r5 = await staff.request('lab-results/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { id: 'LAB-001', action: 'review' }
        });
        assert(r5.status === 403, 'staff POST lab-results/status.php -> 403');
    }

    // -------------------------------------------------------------------------
    // [6] Patient Ownership & IDOR Protection
    // -------------------------------------------------------------------------
    console.log('\n[6] Patient Ownership & IDOR Protection');
    {
        const p1 = await patient.request('lab-results/get.php', { params: { id: 'LAB-001' } });
        assert(p1.status === 200 && p1.json.data.lab.id === 'LAB-001', 'Patient P-001 reads own LAB-001');

        const pList = await patient.request('lab-results/list.php', { params: { my: 1 } });
        assert(pList.status === 200 && pList.json.data.labs.length === 2, 'Patient P-001 list.php?my=1 returns 2 completed labs');

        // Patient cannot write
        const pCreate = await patient.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { patientId: 'P-001', testName: 'CBC', category: 'Hematology' }
        });
        assert(pCreate.status === 403, 'Patient cannot order lab tests -> 403');

        const pUpdate = await patient.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'LAB-002', result: '100', flag: 'Normal' }
        });
        assert(pUpdate.status === 403, 'Patient cannot enter lab results -> 403');

        const pReview = await patient.request('lab-results/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'LAB-001', action: 'review' }
        });
        assert(pReview.status === 403, 'Patient cannot review lab results -> 403');

        // Temporarily activate P-002 for IDOR test
        runSql(`UPDATE patients SET status = 'verified' WHERE id = 'P-002'; UPDATE users SET status = 'active' WHERE id = 'U-006';`);
        const p2L = await patient2.login('patient2', 'password123');
        assert(p2L.status === 200, 'patient2 logged in');

        const idorGet = await patient2.request('lab-results/get.php', { params: { id: 'LAB-001' } });
        assert(idorGet.status === 403, 'patient2 GET LAB-001 is BLOCKED (403 IDOR)');

        const idorList = await patient2.request('lab-results/list.php', { params: { patientId: 'P-001' } });
        assert(idorList.status === 200 && idorList.json.data.labs.length === 0, 'patient2 querying patientId=P-001 scoped to own profile (0 rows)');

        // Restore P-002 to pending
        runSql(`UPDATE patients SET status = 'pending' WHERE id = 'P-002'; UPDATE users SET status = 'pending' WHERE id = 'U-006';`);
    }

    // -------------------------------------------------------------------------
    // [7] Nurse Role Boundaries
    // -------------------------------------------------------------------------
    console.log('\n[7] Nurse Role Boundaries');
    {
        const nOrder = await nurse.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { patientId: 'P-001', testName: 'Fasting Blood Sugar', category: 'Chemistry' }
        });
        assert(nOrder.status === 403, 'Nurse cannot order lab tests -> 403');

        const nReview = await nurse.request('lab-results/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { id: 'LAB-001', action: 'review' }
        });
        assert(nReview.status === 403, 'Nurse cannot mark lab results as reviewed -> 403');
    }

    // -------------------------------------------------------------------------
    // [8] Lab Order Validation & Sequence Allocation (LAB-003+)
    // -------------------------------------------------------------------------
    console.log('\n[8] Lab Order Validation & Sequence Allocation');
    {
        const v1 = await doctor.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: '', testName: 'CBC', category: 'Hematology' }
        });
        assert(v1.status === 400, 'Missing patientId -> 400');

        const v2 = await doctor.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-999', testName: 'CBC', category: 'Hematology' }
        });
        assert(v2.status === 404, 'Unknown patientId P-999 -> 404');

        const v3 = await doctor.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-002', testName: 'CBC', category: 'Hematology' }
        });
        assert(v3.status === 422, 'Unverified pending patient P-002 -> 422');

        const v4 = await doctor.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', testName: '', category: 'Hematology' }
        });
        assert(v4.status === 400, 'Missing testName -> 400');

        const v5 = await doctor.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', testName: 'CBC', category: '' }
        });
        assert(v5.status === 400, 'Missing category -> 400');

        // Doctor creates valid order -> allocated LAB-003, doctor attribution locked to D-001 even if orderedBy='D-003'
        const order1 = await doctor.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: {
                patientId: 'P-001',
                orderedBy: 'D-003', // Impersonation attempt
                testName: 'Fasting Blood Sugar',
                category: 'Chemistry'
            }
        });
        assert(order1.status === 201, 'Doctor creates lab order -> 201');
        const lab3 = order1.json.data.lab;
        assert(lab3.id === 'LAB-003', 'Next allocated ID is LAB-003');
        assert(lab3.orderedBy === 'D-001', 'Doctor attribution locked to authenticated session D-001');
        assert(lab3.status === 'Ordered', 'Initial status is Ordered');
        assert(lab3.result === null && lab3.flag === null, 'Initial result & flag are null');
        assert(lab3.billed === false && lab3.billId === null, 'Initial billed is false');

        // Patient cannot view Ordered (uncompleted) test
        const patViewOrdered = await patient.request('lab-results/get.php', { params: { id: 'LAB-003' } });
        assert(patViewOrdered.status === 403, 'Patient cannot view uncompleted (Ordered) lab test via get.php -> 403');

        const patListOrdered = await patient.request('lab-results/list.php');
        assert(patListOrdered.json.data.labs.every(l => l.status === 'Completed'), 'Patient list.php excludes Ordered tests');

        // Admin creates two more orders (LAB-004, LAB-005)
        const order2 = await admin.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { patientId: 'P-001', orderedBy: 'D-002', testName: 'Serum Creatinine', category: 'Chemistry' }
        });
        assert(order2.status === 201 && order2.json.data.lab.id === 'LAB-004', 'Admin creates LAB-004');
        assert(order2.json.data.lab.orderedBy === 'D-002', 'Admin order preserves specified orderedBy D-002');

        const order3 = await admin.request('lab-results/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { patientId: 'P-001', testName: 'Serum Potassium', category: 'Chemistry' }
        });
        assert(order3.status === 201 && order3.json.data.lab.id === 'LAB-005', 'Admin creates LAB-005');
    }

    // -------------------------------------------------------------------------
    // [9] Result Entry & Automated Clinical Flag Calculation
    // -------------------------------------------------------------------------
    console.log('\n[9] Result Entry & Automated Clinical Flag Calculation');
    {
        // Cannot review an uncompleted test
        const revUncompleted = await doctor.request('lab-results/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'LAB-003', action: 'review' }
        });
        assert(revUncompleted.status === 400, 'Cannot review Ordered (uncompleted) test -> 400');

        // Validation: missing result value
        const emptyRes = await nurse.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { id: 'LAB-003', result: '' }
        });
        assert(emptyRes.status === 400, 'Empty result value -> 400');

        // Validation: invalid reference range (min >= max)
        const badRange = await nurse.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: {
                id: 'LAB-003',
                result: '90',
                unit: 'mg/dL',
                referenceRange: { min: '100', max: '70' }
            }
        });
        assert(badRange.status === 422, 'Invalid reference range (min >= max) -> 422');

        // Validation: missing reference range AND missing manual flag
        const noRangeNoFlag = await nurse.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: {
                id: 'LAB-003',
                result: 'Positive',
                unit: ''
            }
        });
        assert(noRangeNoFlag.status === 422, 'Missing reference range without manual flag -> 422');

        // Validation: invalid manual flag
        const badManualFlag = await nurse.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: {
                id: 'LAB-003',
                result: '90',
                flag: 'DangerZone'
            }
        });
        assert(badManualFlag.status === 422, 'Invalid manual flag string -> 422');

        // Case 1: Normal flag (within [70, 100])
        const normRes = await nurse.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: {
                id: 'LAB-003',
                result: '90',
                unit: 'mg/dL',
                referenceRange: { min: '70', max: '100' }
            }
        });
        assert(normRes.status === 200, 'Nurse enters normal result for LAB-003 -> 200');
        assert(normRes.json.data.lab.status === 'Completed', 'LAB-003 status transitioned to Completed');
        assert(normRes.json.data.lab.flag === 'Normal', 'Result 90 in [70, 100] auto-flagged as Normal');
        assert(Boolean(normRes.json.data.lab.performedBy), 'performedBy recorded from session');
        assert(Boolean(normRes.json.data.lab.resultDate), 'resultDate recorded');

        // Case 2: Abnormal flag (outside [0.6, 1.2], span=0.6, 30%=0.18, critical upper=1.38; 1.30 is Abnormal)
        const abnRes = await nurse.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: {
                id: 'LAB-004',
                result: '1.30',
                unit: 'mg/dL',
                referenceRange: { min: '0.6', max: '1.2' }
            }
        });
        assert(abnRes.status === 200, 'Nurse enters abnormal result for LAB-004 -> 200');
        assert(abnRes.json.data.lab.flag === 'Abnormal', 'Result 1.30 outside [0.6, 1.2] but <= 1.38 auto-flagged as Abnormal');

        // Case 3: Critical flag above upper threshold ([3.5, 5.0], span=1.5, 30%=0.45, critical upper=5.45; 6.1 > 5.45)
        const critHighRes = await doctor.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: {
                id: 'LAB-005',
                result: '6.1',
                unit: 'mmol/L',
                referenceRange: { min: '3.5', max: '5.0' }
            }
        });
        assert(critHighRes.status === 200, 'Doctor enters high critical result for LAB-005 -> 200');
        assert(critHighRes.json.data.lab.flag === 'Critical', 'Result 6.1 > 5.45 auto-flagged as Critical');

        // Case 4: Critical flag below lower threshold ([3.5, 5.0], critical lower = 3.5 - 0.45 = 3.05; 2.8 < 3.05)
        const critLowRes = await doctor.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: {
                id: 'LAB-005',
                result: '2.8',
                unit: 'mmol/L',
                referenceRange: { min: '3.5', max: '5.0' }
            }
        });
        assert(critLowRes.status === 200 && critLowRes.json.data.lab.flag === 'Critical', 'Result 2.8 < 3.05 auto-flagged as Critical');

        // Case 5: Qualitative result with explicit manual flag and attachment filename
        const qualRes = await nurse.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: {
                id: 'LAB-005',
                result: 'Reactive',
                unit: 'Qualitative',
                referenceRange: null,
                flag: 'Abnormal',
                attachmentName: 'C:\\fakepath\\lab-report-005.pdf'
            }
        });
        assert(qualRes.status === 200, 'Qualitative result with manual flag saved -> 200');
        assert(qualRes.json.data.lab.flag === 'Abnormal', 'Manual flag Abnormal preserved');
        assert(qualRes.json.data.lab.attachmentName === 'lab-report-005.pdf', 'Attachment basename sanitized and saved');

        // Physician review on completed LAB-003
        const revOk = await doctor.request('lab-results/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'LAB-003', action: 'review' }
        });
        assert(revOk.status === 200, 'Doctor marks completed LAB-003 as reviewed -> 200');

        const reviewAuditCount = parseInt(runSql(`SELECT COUNT(*) FROM audit_logs WHERE action = 'Review Lab Result' AND details LIKE '%LAB-003%'`), 10);
        assert(reviewAuditCount >= 1, 'Physician review logged to audit_logs');

        // Patient P-001 can now view completed LAB-003
        const patViewCompleted = await patient.request('lab-results/get.php', { params: { id: 'LAB-003' } });
        assert(patViewCompleted.status === 200 && patViewCompleted.json.data.lab.id === 'LAB-003', 'Patient P-001 can view LAB-003 once Completed');
    }

    // -------------------------------------------------------------------------
    // [10] Billing Interoperability & Billed Record Immutability
    // -------------------------------------------------------------------------
    console.log('\n[10] Billing Interoperability & Billed Record Immutability');
    {
        // Check billing preview for P-001
        const prev1 = await staff.request('billing/preview.php', { params: { patientId: 'P-001' } });
        assert(prev1.status === 200, 'staff GET billing/preview.php?patientId=P-001 -> 200');
        const labItems1 = prev1.json.data.items.filter(i => i.sourceType === 'labResults');
        const labSourceIds1 = labItems1.map(i => i.sourceId);

        assert(!labSourceIds1.includes('LAB-001'), 'Already-billed LAB-001 excluded from billing preview');
        assert(labSourceIds1.includes('LAB-002'), 'Unbilled completed LAB-002 included in billing preview');
        assert(labSourceIds1.includes('LAB-003'), 'Newly completed LAB-003 included in billing preview');

        // Create a bill for LAB-003
        const fbsItem = labItems1.find(i => i.sourceId === 'LAB-003');
        const createBillRes = await staff.request('billing/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: {
                patientId: 'P-001',
                discountType: 'None',
                philhealthAmount: 0,
                hmoProvider: '',
                hmoAmount: 0,
                items: [fbsItem]
            }
        });
        assert(createBillRes.status === 201, 'Staff creates bill for LAB-003 -> 201');
        const newBillId = createBillRes.json.data.bill.id;

        // Verify LAB-003 is now marked billed = true, billId = newBillId
        const lab3AfterBill = (await admin.request('lab-results/get.php', { params: { id: 'LAB-003' } })).json.data.lab;
        assert(lab3AfterBill.billed === true && lab3AfterBill.billId === newBillId, `LAB-003 marked billed=true with billId=${newBillId}`);

        // Verify LAB-003 disappears from billing preview
        const prev2 = await staff.request('billing/preview.php', { params: { patientId: 'P-001' } });
        const labSourceIds2 = prev2.json.data.items.filter(i => i.sourceType === 'labResults').map(i => i.sourceId);
        assert(!labSourceIds2.includes('LAB-003'), 'Billed LAB-003 no longer appears in billing preview');

        // Duplicate billing attempt for LAB-003 -> 409 Conflict
        const dupBillRes = await staff.request('billing/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: {
                patientId: 'P-001',
                discountType: 'None',
                items: [fbsItem]
            }
        });
        assert(dupBillRes.status === 409, 'Duplicate billing of LAB-003 rejected -> 409 Conflict');

        // Billed record immutability checks on update.php
        const tamperPatient = await admin.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'LAB-003', patientId: 'P-002', result: '92', referenceRange: { min: '70', max: '100' } }
        });
        assert(tamperPatient.status === 409, 'Cannot change patientId on a billed lab result -> 409');

        const tamperTestName = await admin.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'LAB-003', testName: 'Tampered Test', result: '92', referenceRange: { min: '70', max: '100' } }
        });
        assert(tamperTestName.status === 409, 'Cannot change testName on a billed lab result -> 409');

        const tamperBilled = await admin.request('lab-results/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'LAB-003', billed: false, result: '92', referenceRange: { min: '70', max: '100' } }
        });
        assert(tamperBilled.status === 409, 'Cannot modify billed flag via lab-results/update.php -> 409');

        // Voiding the bill restores LAB-003's unbilled state
        const voidRes = await admin.request('billing/void.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: newBillId, reason: 'Smoke test void verification' }
        });
        assert(voidRes.status === 200, `Admin voids bill ${newBillId} -> 200`);

        const lab3AfterVoid = (await admin.request('lab-results/get.php', { params: { id: 'LAB-003' } })).json.data.lab;
        assert(lab3AfterVoid.billed === false && lab3AfterVoid.billId === null, 'Voiding bill restores LAB-003 to billed=false, billId=null');

        // Verify LAB-003 reappears in billing preview
        const prev3 = await staff.request('billing/preview.php', { params: { patientId: 'P-001' } });
        const labSourceIds3 = prev3.json.data.items.filter(i => i.sourceType === 'labResults').map(i => i.sourceId);
        assert(labSourceIds3.includes('LAB-003'), 'Unflagged LAB-003 reappears in billing preview');
    }

    // -------------------------------------------------------------------------
    // [11] Transaction Rollback Verification
    // -------------------------------------------------------------------------
    console.log('\n[11] Transaction Rollback Verification');
    {
        const probeOut = execFileSync(PHP_BIN, [path.join(PROJECT_ROOT, 'tests', 'lab-results-rollback-probe.php')], { encoding: 'utf8' }).trim();
        let probeData = {};
        try { probeData = JSON.parse(probeOut); } catch {}
        assert(probeData.threw === true, 'Rollback probe threw an exception as expected');
        assert(probeData.inTxAfter === false, 'Rollback probe left no transaction open');
        assert(probeData.countMatches === true, 'lab_results count unchanged after rollback');
    }

    // -------------------------------------------------------------------------
    // [12] Data Integrity & Seed Preservation
    // -------------------------------------------------------------------------
    console.log('\n[12] Data Integrity & Seed Preservation');
    {
        // Referential integrity: patient P-001 cannot be deleted
        const delPat = await admin.request('patients/delete.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'P-001' }
        });
        assert(delPat.status === 409, 'Patient P-001 with lab records cannot be deleted (409)');

        // Doctor D-001 cannot be deleted
        const delDoc = await admin.request('doctors/delete.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'D-001' }
        });
        assert(delDoc.status === 409, 'Doctor D-001 with lab records cannot be deleted (409)');

        // Cleanup disposable records
        cleanupTestData();

        // Seeded LAB-001 and LAB-002 byte-for-byte check
        const currentLab001Hash = runSql(`
            SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(ordered_by,''), test_name, category, status, IFNULL(result,''), IFNULL(unit,''), IFNULL(ref_range_min,''), IFNULL(ref_range_max,''), IFNULL(flag,''), IFNULL(attachment_name,''), ordered_date, IFNULL(result_date,''), IFNULL(performed_by,''), billed, IFNULL(bill_id,'')))
            FROM lab_results WHERE id = 'LAB-001'
        `);
        assert(currentLab001Hash === originalLab001Hash, 'Seeded record LAB-001 is byte-for-byte unchanged');

        const currentLab002Hash = runSql(`
            SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(ordered_by,''), test_name, category, status, IFNULL(result,''), IFNULL(unit,''), IFNULL(ref_range_min,''), IFNULL(ref_range_max,''), IFNULL(flag,''), IFNULL(attachment_name,''), ordered_date, IFNULL(result_date,''), IFNULL(performed_by,''), billed, IFNULL(bill_id,'')))
            FROM lab_results WHERE id = 'LAB-002'
        `);
        assert(currentLab002Hash === originalLab002Hash, 'Seeded record LAB-002 is byte-for-byte unchanged');

        const labCountAfter = parseInt(runSql(`SELECT COUNT(*) FROM lab_results`), 10);
        assert(labCountAfter === 2, 'Only seeded LAB-001 and LAB-002 remain in lab_results');

        const seqAfter = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'labResults'`), 10);
        assert(seqAfter === 2, 'labResults sequence restored to 2');
    }

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Unhandled error in lab-results-smoke-test:', err);
    cleanupTestData();
    process.exit(1);
});
