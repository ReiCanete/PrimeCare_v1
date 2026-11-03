/**
 * PrimeCare HIS — Phase 5.7.2 EHR / Medical Records Smoke Test
 *
 * Exercises all six endpoints against live Apache + MariaDB:
 *   api/medical-records/list.php | get.php | create.php | update.php | vitals.php | history.php
 *
 * Safety:
 *  - Seeded record M-001 is never written to; its content hash is verified before/after.
 *  - All disposable data (records, history, appointments) is removed in a `finally` block and the
 *    `medicalRecords` / `appointments` sequences plus P-002 / U-006 state are restored.
 *  - Requires: XAMPP Apache + MariaDB running, mysql.exe + php.exe in C:\xampp.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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

function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function plusDays(n) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return fmtDate(d);
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
            for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
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
    /** POST with this session's CSRF token (unless csrf === false or a custom token string). */
    post(endpoint, body, csrf = true) {
        const headers = {};
        if (csrf === true) headers['X-CSRF-Token'] = this.csrfToken;
        else if (typeof csrf === 'string') headers['X-CSRF-Token'] = csrf;
        return this.request(endpoint, { method: 'POST', headers, body });
    }
    async login(username, password = 'password123') {
        const c = await this.request('auth/csrf.php');
        this.csrfToken = c.body?.data?.csrfToken || null;
        const res = await this.request('auth/login.php', {
            method: 'POST', headers: { 'X-CSRF-Token': this.csrfToken }, body: { username, password }
        });
        if (res.body?.data?.csrfToken) this.csrfToken = res.body.data.csrfToken;
        return res;
    }
    async logout() {
        return this.request('auth/logout.php', { method: 'POST', headers: this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}, body: {} });
    }
}

const M001_HASH_SQL = `SELECT MD5(CONCAT_WS('|', id, patient_id, appointment_id, attending_doctor_id, chief_complaint,
  vital_bp, vital_heart_rate, vital_temperature, vital_resp_rate, vital_weight_kg, vital_height_cm, vital_spo2,
  diagnosis, treatment_notes, IFNULL(follow_up_date,''), created_by, created_at, updated_at))
  FROM medical_records WHERE id = 'M-001'`;

const original = {};

function captureOriginalState() {
    original.m001Hash = runSql(M001_HASH_SQL);
    original.m001History = runSql("SELECT COUNT(*) FROM medical_record_history WHERE medical_record_id = 'M-001'");
    original.historyTotal = runSql('SELECT COUNT(*) FROM medical_record_history');
    original.recordCount = runSql('SELECT COUNT(*) FROM medical_records');
    original.seqMedical = runSql("SELECT current_val FROM sequences WHERE entity_key = 'medicalRecords'");
    original.seqAppointments = runSql("SELECT current_val FROM sequences WHERE entity_key = 'appointments'");
    original.p002Status = runSql("SELECT status FROM patients WHERE id = 'P-002'");
    original.u006Status = runSql("SELECT status FROM users WHERE id = 'U-006'");
    original.u006LastLogin = runSql("SELECT IFNULL(last_login,'NULL') FROM users WHERE id = 'U-006'");
}

function cleanupTestData() {
    try {
        runSql(`
            DELETE FROM medical_records WHERE id <> 'M-001';
            DELETE FROM appointments WHERE id NOT IN ('A-001', 'A-002');
            UPDATE sequences SET current_val = ${Number(original.seqMedical)} WHERE entity_key = 'medicalRecords';
            UPDATE sequences SET current_val = ${Number(original.seqAppointments)} WHERE entity_key = 'appointments';
            UPDATE patients SET status = '${original.p002Status}' WHERE id = 'P-002';
            UPDATE users SET status = '${original.u006Status}' WHERE id = 'U-006';
            UPDATE users SET last_login = ${original.u006LastLogin === 'NULL' ? 'NULL' : `'${original.u006LastLogin}'`} WHERE id = 'U-006';
        `);
    } catch (e) {
        console.error('Warning during cleanupTestData:', e.message);
    }
}

const hasKey = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);

async function runTests() {
    console.log('==============================================================');
    console.log('PrimeCare HIS — Phase 5.7.2 EHR / Medical Records Smoke Tests');
    console.log('==============================================================\n');

    captureOriginalState();
    // Remove leftovers from any previously aborted run (never touches M-001), then re-baseline.
    cleanupTestData();
    captureOriginalState();

    const anon = new ClientSession('anon');
    const admin = new ClientSession('admin');
    const staff = new ClientSession('staff');
    const doctor = new ClientSession('doctor');
    const nurse = new ClientSession('nurse');
    const nurse2 = new ClientSession('nurse2');
    const patient = new ClientSession('patient');
    const patient2 = new ClientSession('patient2');

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // server runs on Asia/Manila time
    const apptDate = plusDays(10);
    let R1 = null; // doctor-authored record for P-001
    let R2 = null; // admin-authored record for P-002 (attending D-002, linked to appointment)
    let vitalsCheckId = null;

    try {
        // ------------------------------------------------------------------
        console.log('[1] Unauthenticated access, method guards & no-delete-endpoint');
        for (const [ep, label] of [['list.php', 'list'], ['get.php', 'get'], ['history.php', 'history']]) {
            const r = await anon.request(`medical-records/${ep}`, { params: { id: 'M-001', recordId: 'M-001' } });
            assert(r.status === 401 && r.body?.success === false, `Unauthenticated GET ${label}.php -> 401`);
        }
        for (const [ep, label] of [['create.php', 'create'], ['update.php', 'update'], ['vitals.php', 'vitals']]) {
            const r = await anon.request(`medical-records/${ep}`, { method: 'POST', body: {} });
            assert(r.status === 401 && r.body?.success === false, `Unauthenticated POST ${label}.php -> 401`);
        }
        const getOnCreate = await anon.request('medical-records/create.php');
        assert(getOnCreate.status === 405, 'GET on POST-only create.php -> 405');

        const files = readdirSync(path.join(PROJECT_ROOT, 'api', 'medical-records')).sort();
        assert(
            JSON.stringify(files) === JSON.stringify(['create.php', 'get.php', 'history.php', 'list.php', 'update.php', 'vitals.php']),
            `api/medical-records contains exactly the six endpoints, no delete endpoint (found: ${files.join(', ')})`
        );
        const delGet = await anon.request('medical-records/delete.php');
        const delPost = await anon.request('medical-records/delete.php', { method: 'POST', body: { id: 'M-001' } });
        assert(delGet.status === 404 && delPost.status === 404, 'medical-records/delete.php does not exist (404 for GET and POST)');

        // ------------------------------------------------------------------
        console.log('\n[2] Logins');
        const logins = [
            [admin, 'admin'], [staff, 'staff'], [doctor, 'doctor'], [nurse, 'nurse'], [nurse2, 'nurse'], [patient, 'patient']
        ];
        for (const [sess, user] of logins) {
            const r = await sess.login(user);
            assert(r.status === 200 && r.body?.success === true, `${sess.name} (${user}) login succeeds`);
        }
        // patient2 (U-006 / P-002) is pending in the seed: enable the login only; P-002 stays pending for now.
        runSql("UPDATE users SET status = 'active' WHERE id = 'U-006'");
        const p2 = await patient2.login('patient2');
        assert(p2.status === 200 && p2.body?.success === true, 'patient2 (U-006 / P-002) login succeeds');

        // ------------------------------------------------------------------
        console.log('\n[3] CSRF enforcement on every POST endpoint');
        for (const ep of ['create.php', 'update.php', 'vitals.php']) {
            const noToken = await admin.post(`medical-records/${ep}`, { patientId: 'P-001', id: 'M-999', diagnosis: 'x', treatmentNotes: 'y', vitals: { heartRate: 70 } }, false);
            assert(noToken.status === 403, `POST ${ep} without CSRF token -> 403`);
            const badToken = await admin.post(`medical-records/${ep}`, { patientId: 'P-001', id: 'M-999', diagnosis: 'x', treatmentNotes: 'y', vitals: { heartRate: 70 } }, 'not-a-real-token');
            assert(badToken.status === 403, `POST ${ep} with invalid CSRF token -> 403`);
        }

        // ------------------------------------------------------------------
        console.log('\n[4] Baseline reads, projections & seeded record M-001');
        const adminList = await admin.request('medical-records/list.php');
        const adminRecords = adminList.body?.data?.records || [];
        assert(adminList.status === 200 && adminRecords.length === 1 && adminRecords[0].id === 'M-001', `admin list returns exactly the seeded record (got ${adminRecords.length})`);

        const m001 = (await admin.request('medical-records/get.php', { params: { id: 'M-001' } })).body?.data?.record;
        assert(
            m001 && m001.patientId === 'P-001' && m001.appointmentId === 'A-001' && m001.attendingDoctorId === 'D-001' &&
            m001.doctorName === 'Dr. Jose Rizal' && m001.diagnosis === 'Myopia' && m001.chiefComplaint === 'Blurry vision' &&
            m001.treatmentNotes === 'Prescribed new corrective lenses.' && m001.followUpDate === null && m001.createdBy === 'U-002',
            'M-001 serialized with patient, appointment, doctor attribution, diagnosis and treatment'
        );
        assert(
            m001 && m001.vitals?.bp === '120/80' && m001.vitals?.heartRate === 75 && m001.vitals?.temperature === 36.5 &&
            m001.vitals?.respRate === 16 && m001.vitals?.weightKg === 70 && m001.vitals?.heightCm === 170 && m001.vitals?.spo2 === 98,
            'M-001 vitals serialized into the nested frontend structure with numeric types'
        );
        assert(
            m001 && m001.createdAt === '2026-11-02T09:30:00' && m001.updatedAt === '2026-11-02T09:30:00' && m001.date === '2026-11-02' && Array.isArray(m001.history) && m001.history.length === 0,
            'Timestamps use ISO "T" format (frontend split(\'T\') compatible); history is an empty array'
        );

        const nurseList = await nurse.request('medical-records/list.php');
        assert(nurseList.status === 200 && nurseList.body?.data?.records?.[0]?.treatmentNotes === 'Prescribed new corrective lenses.', 'nurse reads full clinical record (list)');
        const nurseGet = await nurse.request('medical-records/get.php', { params: { id: 'M-001' } });
        assert(nurseGet.status === 200 && Array.isArray(nurseGet.body?.data?.record?.history), 'nurse reads full record with history (get)');
        const docGet = await doctor.request('medical-records/get.php', { params: { id: 'M-001' } });
        assert(docGet.status === 200 && docGet.body?.data?.record?.id === 'M-001', 'doctor reads M-001 (get)');

        const staffList = await staff.request('medical-records/list.php', { params: { patientId: 'P-001' } });
        const sRec = staffList.body?.data?.records?.[0];
        assert(
            staffList.status === 200 && sRec?.id === 'M-001' && sRec.diagnosis === 'Myopia' && sRec.view === 'summary' &&
            !hasKey(sRec, 'treatmentNotes') && !hasKey(sRec, 'vitals') && !hasKey(sRec, 'chiefComplaint') && !hasKey(sRec, 'history'),
            'staff gets summary projection only (diagnosis, no vitals/notes/complaint/history)'
        );
        const staffGet = await staff.request('medical-records/get.php', { params: { id: 'M-001' } });
        assert(staffGet.status === 200 && !hasKey(staffGet.body?.data?.record, 'treatmentNotes') && !hasKey(staffGet.body?.data?.record, 'vitals'), 'staff get.php is also summary-only');
        const staffHist = await staff.request('medical-records/history.php', { params: { recordId: 'M-001' } });
        assert(staffHist.status === 403, 'staff blocked from revision history (403)');

        // Filters (before any test record exists)
        const f1 = (await admin.request('medical-records/list.php', { params: { keyword: 'Myopia' } })).body?.data?.records || [];
        const f2 = (await admin.request('medical-records/list.php', { params: { keyword: 'Dela Cruz' } })).body?.data?.records || [];
        const f3 = (await admin.request('medical-records/list.php', { params: { doctorId: 'D-001' } })).body?.data?.records || [];
        const f4 = (await admin.request('medical-records/list.php', { params: { doctorId: 'D-002' } })).body?.data?.records || [];
        const f5 = (await admin.request('medical-records/list.php', { params: { dateFrom: '2026-11-03' } })).body?.data?.records || [];
        const f6 = (await admin.request('medical-records/list.php', { params: { dateFrom: '2026-11-02', dateTo: '2026-11-02' } })).body?.data?.records || [];
        const f7 = (await admin.request('medical-records/list.php', { params: { my: 1 } })).body?.data?.records || [];
        const f8 = (await admin.request('medical-records/list.php', { params: { patientId: 'P-002' } })).body?.data?.records || [];
        assert(f1.length === 1 && f2.length === 1, 'Filter by keyword (diagnosis, patient name) matches M-001');
        assert(f3.length === 1 && f4.length === 0, 'Filter by doctorId includes/excludes correctly');
        assert(f5.length === 0 && f6.length === 1, 'Filter by dateFrom/dateTo uses the record date');
        assert(f7.length === 1 && f7[0].patientId === 'P-001', '?my=1 preview defaults to demo patient P-001');
        assert(f8.length === 0, 'Filter by patientId P-002 (no records yet) returns none');
        const sqli = await admin.request('medical-records/list.php', { params: { sortBy: 'id; DROP TABLE medical_records;--', sortDir: 'asc', keyword: "' OR 1=1 --" } });
        assert(sqli.status === 200 && Array.isArray(sqli.body?.data?.records), 'Injection attempts in sortBy/keyword are neutralised (whitelist + prepared statements)');
        const badId = await admin.request('medical-records/get.php', { params: { id: 'banana' } });
        const noId = await admin.request('medical-records/get.php', { params: { id: 'M-999' } });
        assert(badId.status === 400 && noId.status === 404, 'get.php: malformed ID -> 400, unknown ID -> 404');

        // ------------------------------------------------------------------
        console.log('\n[5] Patient ownership & IDOR protection');
        const pList = await patient.request('medical-records/list.php');
        const pRecs = pList.body?.data?.records || [];
        assert(pList.status === 200 && pRecs.length === 1 && pRecs[0].id === 'M-001' && pRecs.every(r => r.patientId === 'P-001'), 'Patient P-001 retrieves its own seeded record M-001');
        assert(pRecs[0] && !hasKey(pRecs[0], 'createdBy') && !hasKey(pRecs[0], 'history') && pRecs[0].treatmentNotes === 'Prescribed new corrective lenses.', 'Patient projection hides internal user IDs / history but keeps clinical content');
        const pGet = await patient.request('medical-records/get.php', { params: { id: 'M-001' } });
        assert(pGet.status === 200 && pGet.body?.data?.record?.id === 'M-001', 'Patient P-001 get.php?id=M-001 -> 200');
        const pHist = await patient.request('medical-records/history.php', { params: { recordId: 'M-001' } });
        assert(pHist.status === 200 && Array.isArray(pHist.body?.data?.history), 'Patient may read history of their own record');

        const p2Get = await patient2.request('medical-records/get.php', { params: { id: 'M-001' } });
        assert(p2Get.status === 403 && p2Get.body?.success === false, "Different patient (P-002) cannot retrieve M-001 via get.php -> 403");
        assert(!JSON.stringify(p2Get.body).includes('Myopia'), 'IDOR response leaks no clinical content');
        const p2List = await patient2.request('medical-records/list.php', { params: { patientId: 'P-001' } });
        assert(p2List.status === 200 && (p2List.body?.data?.records || []).length === 0, 'patient2 list.php?patientId=P-001 is forced to own scope (0 rows)');
        const p2Hist = await patient2.request('medical-records/history.php', { params: { recordId: 'M-001' } });
        assert(p2Hist.status === 403, 'patient2 cannot read history of M-001 -> 403');
        const p2HistPat = await patient2.request('medical-records/history.php', { params: { patientId: 'P-001' } });
        assert(p2HistPat.status === 200 && p2HistPat.body?.data?.patientId === 'P-002' && p2HistPat.body?.data?.history?.length === 0, 'patient2 history.php?patientId=P-001 is forced to P-002');
        const p2Unknown = await patient2.request('medical-records/get.php', { params: { id: 'M-999' } });
        assert(p2Unknown.status === 404, 'Unknown record ID still returns 404 for a patient');
        const noParams = await admin.request('medical-records/history.php');
        assert(noParams.status === 400, 'history.php without recordId/patientId -> 400');

        // ------------------------------------------------------------------
        console.log('\n[6] Role enforcement on writes (server-side)');
        const body = { patientId: 'P-001', diagnosis: 'Role probe', treatmentNotes: 'Role probe' };
        for (const [sess, label] of [[nurse, 'nurse'], [staff, 'staff'], [patient, 'patient']]) {
            const c = await sess.post('medical-records/create.php', body);
            assert(c.status === 403, `${label} cannot create a diagnosis (403)`);
            const u = await sess.post('medical-records/update.php', { id: 'M-999', ...body });
            assert(u.status === 403, `${label} cannot update a diagnosis (403)`);
        }
        for (const [sess, label] of [[staff, 'staff'], [patient, 'patient']]) {
            const v = await sess.post('medical-records/vitals.php', { patientId: 'P-001', vitals: { heartRate: 70 } });
            assert(v.status === 403, `${label} cannot record vitals (403)`);
        }
        const afterRejects = runSql("SELECT COUNT(*) FROM medical_records WHERE id <> 'M-001'");
        assert(afterRejects === '0', 'Rejected role attempts created no records');

        // ------------------------------------------------------------------
        console.log('\n[7] Clinical validation on create');
        const base = { patientId: 'P-001', chiefComplaint: 'Headache', diagnosis: 'Tension headache', treatmentNotes: 'Rest and fluids' };
        const cr = (over) => admin.post('medical-records/create.php', { ...base, ...over });
        assert((await cr({ diagnosis: '' })).status === 400, 'Missing diagnosis rejected (400)');
        assert((await cr({ treatmentNotes: '   ' })).status === 400, 'Whitespace-only treatment notes rejected (400)');
        const missingBoth = await admin.post('medical-records/create.php', { patientId: 'P-001' });
        assert(missingBoth.status === 400 && /required/i.test(missingBoth.body?.message || ''), 'Missing diagnosis AND treatment notes rejected with a required-fields message (400)');
        assert((await cr({ patientId: '' })).status === 400, 'Missing patientId rejected (400)');
        assert((await cr({ patientId: 'banana' })).status === 400, 'Malformed patientId rejected (400)');
        assert((await cr({ patientId: 'P-999' })).status === 404, 'Unknown patient rejected (404)');
        assert((await cr({ patientId: 'P-002' })).status === 400, 'Unverified patient (P-002 pending) rejected (400)');
        assert((await cr({ diagnosis: 'x'.repeat(1001) })).status === 400, 'Over-long diagnosis rejected (400)');
        assert((await cr({ chiefComplaint: ['a'] })).status === 400, 'Non-text chief complaint rejected (400)');
        assert((await cr({ followUpDate: '2026-13-45' })).status === 400, 'Invalid follow-up date rejected (400)');
        assert((await cr({ followUpDate: '2020-01-01' })).status === 400, 'Follow-up date in the past rejected (400)');
        assert((await cr({ attendingDoctorId: 'D-999' })).status === 400, 'Unknown attending doctor rejected (400)');
        assert((await cr({ attendingDoctorId: 'nonsense' })).status === 400, 'Malformed attending doctor rejected (400)');
        assert((await cr({ appointmentId: 'A-999' })).status === 404, 'Unknown appointment rejected (404)');
        assert((await cr({ appointmentId: 'A-001' })).status === 409, 'Appointment A-001 already has encounter M-001 -> duplicate rejected (409)');
        assert((await cr({ vitals: { bp: '999/999' } })).status === 400, 'Invalid embedded vitals rejected on create (400)');
        const stillOne = runSql('SELECT COUNT(*) FROM medical_records');
        assert(stillOne === '1', 'No record was created by any rejected create request');

        // ------------------------------------------------------------------
        console.log('\n[8] Vital-sign validation (nurse) — every out-of-range / malformed value is rejected');
        const vx = (vitals, pid = 'P-001') => nurse.post('medical-records/vitals.php', { patientId: pid, vitals });
        const invalid = [
            ['bp "999/999"', { bp: '999/999' }], ['bp "abc"', { bp: 'abc' }], ['bp "120-80"', { bp: '120-80' }], ['bp "12/8"', { bp: '12/8' }],
            ['systolic 49', { bp: '49/80' }], ['systolic 301', { bp: '301/80' }], ['diastolic 29', { bp: '120/29' }], ['diastolic 201', { bp: '120/201' }],
            ['bp as number', { bp: 12080 }],
            ['temperature 29.9', { temperature: 29.9 }], ['temperature 45.1', { temperature: 45.1 }], ['temperature "hot"', { temperature: 'hot' }],
            ['heartRate 19', { heartRate: 19 }], ['heartRate 251', { heartRate: 251 }], ['heartRate 75.5', { heartRate: 75.5 }], ['heartRate 0', { heartRate: 0 }],
            ['spo2 49', { spo2: 49 }], ['spo2 101', { spo2: 101 }],
            ['weight 0.4', { weightKg: 0.4 }], ['weight 500.1', { weightKg: 500.1 }], ['weight "heavy"', { weightKg: 'heavy' }],
            ['height 19.9', { heightCm: 19.9 }], ['height 300.1', { heightCm: 300.1 }],
            ['respRate 3', { respRate: 3 }], ['respRate 81', { respRate: 81 }],
            ['array value', { heartRate: [70] }],
            ['valid + invalid mixed', { heartRate: 70, spo2: 150 }]
        ];
        for (const [label, vit] of invalid) {
            const r = await vx(vit);
            assert(r.status === 400 && r.body?.success === false, `Invalid vitals rejected: ${label} (400)`);
        }
        assert((await vx({})).status === 400, 'Empty vitals object rejected (400)');
        assert((await nurse.post('medical-records/vitals.php', { patientId: 'P-001' })).status === 400, 'Missing vitals object rejected (400)');
        assert((await nurse.post('medical-records/vitals.php', { vitals: { heartRate: 70 } })).status === 400, 'Missing patientId rejected (400)');
        assert((await vx({ heartRate: 70 }, 'P-999')).status === 404, 'Vitals for unknown patient rejected (404)');
        assert((await vx({ heartRate: 70 }, 'P-002')).status === 400, 'Vitals for unverified patient (P-002 pending) rejected (400)');
        const detail = await vx({ bp: '999/999', heartRate: 5 });
        assert(typeof detail.body?.data?.errors === 'object' && hasKey(detail.body.data.errors, 'bp') && hasKey(detail.body.data.errors, 'heartRate'), 'Validation response includes a per-field error map');
        assert(runSql('SELECT COUNT(*) FROM medical_records') === '1', 'No record was created or modified by any rejected vitals request');

        // ------------------------------------------------------------------
        console.log('\n[9] Valid vitals, "Vitals check" encounter & concurrency (P-002 verified from here on)');
        runSql("UPDATE patients SET status = 'verified' WHERE id = 'P-002'");

        // Two independent nurse sessions fire simultaneously for a patient with no encounter today.
        const [race1, race2] = await Promise.all([
            nurse.post('medical-records/vitals.php', { patientId: 'P-002', vitals: { bp: '118/76' } }),
            nurse2.post('medical-records/vitals.php', { patientId: 'P-002', vitals: { heartRate: 70 } })
        ]);
        const statuses = [race1.status, race2.status].sort();
        assert(race1.body?.success === true && race2.body?.success === true && statuses[0] === 200 && statuses[1] === 201, `Concurrent first-vitals requests: exactly one created (201), the other updated it (200) — got ${race1.status}/${race2.status}`);
        const p2Today = runSql("SELECT COUNT(*) FROM medical_records WHERE patient_id = 'P-002'");
        assert(p2Today === '1', `No duplicate "Vitals check" encounter under concurrency (P-002 has ${p2Today})`);
        vitalsCheckId = runSql("SELECT id FROM medical_records WHERE patient_id = 'P-002' LIMIT 1");
        const vc = (await admin.request('medical-records/get.php', { params: { id: vitalsCheckId } })).body?.data?.record;
        assert(
            vc && vc.chiefComplaint === 'Vitals check' && vc.createdBy === 'U-003' && vc.attendingDoctorId === null && vc.diagnosis === '' && vc.appointmentId === null,
            '"Vitals check" encounter is clearly designated, attributed to the nurse user, no diagnosis'
        );
        assert(vc && vc.vitals?.bp === '118/76' && vc.vitals?.heartRate === 70, 'Both concurrent partial vitals were merged into the single encounter');
        assert(vc && vc.history?.length === 1 && vc.history[0].updatedBy === 'Nurse Maria Clara' && /^Vitals updated: /.test(vc.history[0].summary), 'The updating request appended exactly one history entry attributed to the nurse');

        const upper = await nurse.post('medical-records/vitals.php', { patientId: 'P-002', vitals: { bp: '300/200', heartRate: 250, temperature: 45, spo2: 100, weightKg: 500, heightCm: 300, respRate: 80 } });
        assert(upper.status === 200 && upper.body?.data?.record?.vitals?.bp === '300/200' && upper.body.data.record.vitals.respRate === 80, 'Upper boundary vitals accepted');
        const lower = await nurse.post('medical-records/vitals.php', { patientId: 'P-002', vitals: { bp: '50/30', heartRate: 20, temperature: 30, spo2: 50, weightKg: 0.5, heightCm: 20, respRate: 4 } });
        assert(lower.status === 200 && lower.body?.data?.record?.vitals?.heartRate === 20 && lower.body.data.record.vitals.weightKg === 0.5, 'Lower boundary vitals accepted');
        const normal = await nurse.post('medical-records/vitals.php', { patientId: 'P-002', vitals: { bp: '120/80', heartRate: 78, temperature: 36.6, spo2: 99, weightKg: 70.5, heightCm: 170, respRate: 16 } });
        const nv = normal.body?.data?.record?.vitals;
        assert(normal.status === 200 && nv?.bp === '120/80' && nv.heartRate === 78 && nv.temperature === 36.6 && nv.spo2 === 99 && nv.weightKg === 70.5 && nv.heightCm === 170 && nv.respRate === 16, 'Normal vitals accepted and round-trip with correct types');
        assert(normal.body?.data?.record?.id === vitalsCheckId && normal.body.data.created === false, 'Subsequent vitals update the same encounter (no new encounter)');
        const noop = await nurse.post('medical-records/vitals.php', { patientId: 'P-002', vitals: { heartRate: 78 } });
        assert(noop.status === 200 && noop.body?.data?.changed === false, 'Re-submitting identical vitals is a no-op (no history noise)');
        const docVitals = await doctor.post('medical-records/vitals.php', { patientId: 'P-002', vitals: { spo2: 98 } });
        assert(docVitals.status === 200 && docVitals.body?.data?.record?.vitals?.spo2 === 98, 'Doctor can record vitals');
        const adminVitals = await admin.post('medical-records/vitals.php', { patientId: 'P-002', vitals: { spo2: 99 } });
        assert(adminVitals.status === 200 && adminVitals.body?.data?.record?.vitals?.spo2 === 99, 'Admin can record vitals');
        const vcHist = (await admin.request('medical-records/history.php', { params: { recordId: vitalsCheckId } })).body?.data?.history || [];
        const nurseEntries = vcHist.filter(h => h.updatedBy === 'Nurse Maria Clara').length;
        const docEntry = vcHist.find(h => h.updatedBy === 'Dr. Jose Rizal');
        assert(vcHist.length === 6 && nurseEntries === 4 && docEntry && /SpO2/.test(docEntry.summary), `Vitals history has one entry per real change with correct attribution (${vcHist.length} entries)`);

        // ------------------------------------------------------------------
        console.log('\n[10] Create clinical records (doctor / admin)');
        const doctorCreate = await doctor.post('medical-records/create.php', {
            patientId: 'P-001', chiefComplaint: 'Persistent cough', diagnosis: 'Acute bronchitis', treatmentNotes: 'Rest, fluids, prescribed expectorant.',
            followUpDate: plusDays(7), vitals: { bp: '122/82' }
        });
        R1 = doctorCreate.body?.data?.record;
        assert(
            doctorCreate.status === 201 && R1 && /^M-\d{3}$/.test(R1.id) && R1.id !== 'M-001' && R1.patientId === 'P-001' &&
            R1.attendingDoctorId === 'D-001' && R1.createdBy === 'U-002' && R1.followUpDate === plusDays(7) && R1.vitals?.bp === '122/82' && R1.date === today,
            `Doctor creates ${R1?.id} for P-001; attending defaults to own profile D-001; created_by = doctor user`
        );
        const idNum = (id) => Number(String(id).replace(/\D/g, ''));
        assert(idNum(R1?.id) === Number(runSql("SELECT current_val FROM sequences WHERE entity_key = 'medicalRecords'")), 'ID came from the shared medicalRecords sequence (sequence advanced to the new ID)');

        const spoof = await doctor.post('medical-records/create.php', { ...base, attendingDoctorId: 'D-002' });
        assert(spoof.status === 403, 'Doctor cannot author a record under another doctor (403)');
        const ownExplicit = await doctor.post('medical-records/create.php', { ...base, diagnosis: 'Explicit own doctor probe', attendingDoctorId: 'D-001' });
        assert(ownExplicit.status === 201 && ownExplicit.body?.data?.record?.attendingDoctorId === 'D-001', 'Doctor may explicitly name their own profile (201)');

        // Appointments for P-002 (booked by staff) to test encounter <-> appointment relationships
        const book = (time) => staff.post('appointments/create.php', { patientId: 'P-002', doctorId: 'D-001', date: apptDate, time, type: 'in-person', reason: 'EHR link test visit' });
        const appt1 = (await book('09:00')).body?.data?.appointment;
        const appt2 = (await book('09:30')).body?.data?.appointment;
        assert(appt1?.id && appt2?.id, `Test appointments booked for P-002 (${appt1?.id}, ${appt2?.id})`);
        await staff.post('appointments/status.php', { id: appt2.id, status: 'Cancelled', cancelReason: 'Cancelled for EHR test' });

        const adminCreate = await admin.post('medical-records/create.php', {
            patientId: 'P-002', chiefComplaint: 'Wheezing', diagnosis: 'Mild asthma exacerbation', treatmentNotes: 'Inhaler as needed.',
            attendingDoctorId: 'D-002', appointmentId: appt1.id
        });
        R2 = adminCreate.body?.data?.record;
        assert(
            adminCreate.status === 201 && R2 && R2.attendingDoctorId === 'D-002' && R2.doctorName === 'Dr. Antonio Luna' && R2.appointmentId === appt1.id && R2.createdBy === 'U-001',
            `Admin creates ${R2?.id} for P-002 under D-002 linked to appointment ${appt1?.id}`
        );
        const dupLink = await admin.post('medical-records/create.php', { patientId: 'P-002', diagnosis: 'dup', treatmentNotes: 'dup', appointmentId: appt1.id });
        assert(dupLink.status === 409, 'Second encounter for the same appointment rejected (409)');
        const wrongPatientLink = await admin.post('medical-records/create.php', { patientId: 'P-001', diagnosis: 'x', treatmentNotes: 'y', appointmentId: appt1.id });
        assert(wrongPatientLink.status === 400 && /different patient/i.test(wrongPatientLink.body?.message || ''), 'Linking an appointment that belongs to another patient rejected (400)');
        const cancelledLink = await admin.post('medical-records/create.php', { patientId: 'P-002', diagnosis: 'x', treatmentNotes: 'y', appointmentId: appt2.id });
        assert(cancelledLink.status === 400, 'Linking a cancelled appointment rejected (400)');
        const adminNoDoctor = await admin.post('medical-records/create.php', { ...base, patientId: 'P-001', diagnosis: 'No doctor probe' });
        assert(adminNoDoctor.status === 201 && adminNoDoctor.body?.data?.record?.attendingDoctorId === null, 'Admin may create without an attending doctor (attribution stays null)');

        // ------------------------------------------------------------------
        console.log('\n[11] Update, revision history & attribution');
        const upd1 = await doctor.post('medical-records/update.php', { id: R1.id, patientId: 'P-001', chiefComplaint: R1.chiefComplaint, diagnosis: 'Acute bronchitis (confirmed)', treatmentNotes: R1.treatmentNotes, followUpDate: R1.followUpDate, attendingDoctorId: 'D-001' });
        const r1a = upd1.body?.data?.record;
        assert(upd1.status === 200 && upd1.body?.data?.changed === true && r1a?.diagnosis === 'Acute bronchitis (confirmed)', 'Doctor updates diagnosis (200, changed=true)');
        assert(r1a?.history?.length === 1 && r1a.history[0].updatedBy === 'Dr. Jose Rizal' && /diagnosis/.test(r1a.history[0].summary) && r1a.history[0].recordId === R1.id, 'Update appended one history entry attributed to the doctor with a field summary');
        const hts = new Date(r1a.history[0].updatedAt + '+08:00').getTime();
        assert(Math.abs(Date.now() - hts) < 10 * 60 * 1000, `History timestamp is current server time (${r1a.history[0].updatedAt})`);
        assert(r1a.history[0].updatedAt === r1a.updatedAt && r1a.updatedAt >= r1a.createdAt, 'History timestamp equals the record updatedAt (same transaction)');

        const upd1b = await doctor.post('medical-records/update.php', { id: R1.id, patientId: 'P-001', chiefComplaint: R1.chiefComplaint, diagnosis: 'Acute bronchitis (confirmed)', treatmentNotes: R1.treatmentNotes, followUpDate: R1.followUpDate, attendingDoctorId: 'D-001' });
        assert(upd1b.status === 200 && upd1b.body?.data?.changed === false && upd1b.body.data.record.history.length === 1, 'Identical update is a no-op (no extra history entry)');

        const upd2 = await admin.post('medical-records/update.php', { id: R1.id, diagnosis: 'Acute bronchitis (confirmed)', treatmentNotes: 'Updated plan: add inhaled bronchodilator.', followUpDate: plusDays(14) });
        const r1b = upd2.body?.data?.record;
        assert(upd2.status === 200 && r1b?.history?.length === 2 && r1b.history[0].updatedBy === 'System Admin' && r1b.history[1].updatedBy === 'Dr. Jose Rizal', 'Admin update attributed to "System Admin"; history ordered newest first');
        assert(/treatment notes/.test(r1b.history[0].summary) && /follow-up date/.test(r1b.history[0].summary), 'History summary lists the changed fields');
        assert(r1b.chiefComplaint === R1.chiefComplaint && r1b.attendingDoctorId === 'D-001', 'Omitted fields are preserved on update');

        const stale = await doctor.post('medical-records/update.php', { id: R1.id, diagnosis: 'Stale overwrite', treatmentNotes: 'Stale overwrite', expectedUpdatedAt: '2000-01-01T00:00:00' });
        assert(stale.status === 409, 'Stale edit (outdated expectedUpdatedAt) rejected with 409');
        assert((await admin.request('medical-records/get.php', { params: { id: R1.id } })).body.data.record.diagnosis === 'Acute bronchitis (confirmed)', 'Rejected stale edit left the record untouched');
        const fresh = await doctor.post('medical-records/update.php', { id: R1.id, diagnosis: 'Acute bronchitis (resolved)', treatmentNotes: r1b.treatmentNotes, followUpDate: r1b.followUpDate, expectedUpdatedAt: r1b.updatedAt });
        assert(fresh.status === 200 && fresh.body?.data?.changed === true, 'Edit with the current expectedUpdatedAt succeeds');

        const u = (over, sess = admin) => sess.post('medical-records/update.php', { id: R1.id, diagnosis: 'Valid diag', treatmentNotes: 'Valid notes', ...over });
        assert((await u({ diagnosis: '' })).status === 400, 'Update with missing diagnosis rejected (400)');
        assert((await u({ treatmentNotes: '' })).status === 400, 'Update with missing treatment notes rejected (400)');
        assert((await u({ patientId: 'P-002' })).status === 400, 'Moving a record to a different patient rejected (400)');
        assert((await u({ appointmentId: appt1.id })).status === 400, 'Changing the appointment link rejected (400)');
        assert((await u({ followUpDate: '2020-01-01' })).status === 400, 'Follow-up before the encounter date rejected (400)');
        assert((await admin.post('medical-records/update.php', { id: 'M-999', diagnosis: 'a', treatmentNotes: 'b' })).status === 404, 'Update of unknown record -> 404');
        assert((await admin.post('medical-records/update.php', { id: 'bad', diagnosis: 'a', treatmentNotes: 'b' })).status === 400, 'Update with malformed ID -> 400');
        assert((await u({ attendingDoctorId: 'D-002' }, doctor)).status === 403, 'Doctor cannot reassign their record to another doctor (403)');
        for (const [sess, label] of [[nurse, 'nurse'], [staff, 'staff'], [patient, 'patient']]) {
            assert((await u({ diagnosis: 'Forbidden edit' }, sess)).status === 403, `${label} cannot update a real record (403)`);
        }
        assert((await admin.request('medical-records/get.php', { params: { id: R1.id } })).body.data.record.diagnosis === 'Acute bronchitis (resolved)', 'Forbidden / invalid updates did not change the record');

        const r2base = { id: R2.id, patientId: 'P-002', diagnosis: R2.diagnosis, treatmentNotes: R2.treatmentNotes };
        assert((await admin.post('medical-records/update.php', { ...r2base, attendingDoctorId: '' })).status === 400, 'Admin cannot clear an assigned attending doctor (400)');
        const docKeep = await doctor.post('medical-records/update.php', { ...r2base, treatmentNotes: 'Reviewed by Dr. Rizal: continue inhaler.', attendingDoctorId: 'D-002' });
        assert(docKeep.status === 200 && docKeep.body?.data?.record?.attendingDoctorId === 'D-002' && docKeep.body.data.record.history[0].updatedBy === 'Dr. Jose Rizal', "Doctor may edit another doctor's record without taking over attribution");
        const docTake = await doctor.post('medical-records/update.php', { ...r2base, attendingDoctorId: 'D-001' });
        assert(docTake.status === 403, "Doctor cannot take over another doctor's record (403)");
        const adminReassign = await admin.post('medical-records/update.php', { ...r2base, treatmentNotes: 'Reviewed by Dr. Rizal: continue inhaler.', attendingDoctorId: 'D-004' });
        assert(adminReassign.status === 200 && adminReassign.body?.data?.record?.attendingDoctorId === 'D-004' && /attending doctor/.test(adminReassign.body.data.record.history[0].summary), 'Admin can reassign the attending doctor (recorded in history)');

        // History endpoint
        const hRec = (await nurse.request('medical-records/history.php', { params: { recordId: R1.id } })).body?.data?.history || [];
        const hPat = (await admin.request('medical-records/history.php', { params: { patientId: 'P-001' } })).body?.data?.history || [];
        assert(hRec.length === 3 && hRec.every(h => h.recordId === R1.id), 'history.php?recordId returns all entries of the record (nurse may read)');
        assert(hPat.length >= 3 && hPat.every((h, i) => i === 0 || hPat[i - 1].updatedAt >= h.updatedAt), 'history.php?patientId aggregates entries across the patient, newest first');
        const hMine = await patient.request('medical-records/history.php', { params: { my: 1 } });
        assert(hMine.status === 200 && hMine.body.data.patientId === 'P-001' && hMine.body.data.history.length >= 3, 'Patient my=1 history scoped to own chart');
        const p2R1 = await patient2.request('medical-records/get.php', { params: { id: R1.id } });
        const p2R1h = await patient2.request('medical-records/history.php', { params: { recordId: R1.id } });
        assert(p2R1.status === 403 && p2R1h.status === 403, "New records are also protected: patient2 cannot read P-001's record or history (403)");
        const pOwnNew = await patient.request('medical-records/get.php', { params: { id: R1.id } });
        assert(pOwnNew.status === 200 && !hasKey(pOwnNew.body.data.record, 'history') && !hasKey(pOwnNew.body.data.record, 'createdBy'), 'Patient reads own new record without internal fields');
        const p2Own = await patient2.request('medical-records/list.php');
        assert((p2Own.body?.data?.records || []).length === 2 && p2Own.body.data.records.every(r => r.patientId === 'P-002'), 'patient2 (now verified) sees only their own two records');

        // ------------------------------------------------------------------
        console.log('\n[12] Transaction rollback when the history insert fails (real writers, injected failure)');
        let probe = null;
        try {
            probe = JSON.parse(execFileSync(PHP_BIN, [path.join(__dirname, 'medical-records-rollback-probe.php'), R2.id, 'P-002'], { encoding: 'utf8' }));
        } catch (e) {
            console.error('  probe error:', e.message);
        }
        assert(probe && probe.update?.threw === true, 'Clinical update with a failing history insert raises an error');
        assert(probe && probe.update?.rowUnchanged === true && probe.update?.notTouched === true && probe.update?.historyUnchanged === true, 'Clinical update ROLLED BACK: record row and history both unchanged');
        assert(probe && probe.update?.inTransaction === false, 'No transaction left open after the failed update');
        assert(probe && probe.vitals?.threw === true && probe.vitals?.rowUnchanged === true && probe.vitals?.historyUnchanged === true && probe.vitals?.inTransaction === false, 'Vitals update with a failing history insert ROLLED BACK (vitals and history unchanged)');

        // ------------------------------------------------------------------
        console.log('\n[13] Data-integrity guards from earlier phases remain intact');
        const delP2 = await admin.post('patients/delete.php', { id: 'P-002' });
        assert(delP2.status === 409 && runSql("SELECT COUNT(*) FROM patients WHERE id = 'P-002'") === '1', 'Patient with medical records cannot be deleted (409) and still exists');
        const delP1 = await admin.post('patients/delete.php', { id: 'P-001' });
        assert(delP1.status === 409 && runSql("SELECT COUNT(*) FROM patients WHERE id = 'P-001'") === '1', 'Seeded patient P-001 cannot be deleted (409)');
        const delD1 = await admin.post('doctors/delete.php', { id: 'D-001' });
        assert(delD1.status === 409 && runSql("SELECT COUNT(*) FROM doctors WHERE id = 'D-001'") === '1', 'Doctor with medical records cannot be deleted (409)');
        const delD4 = await admin.post('doctors/delete.php', { id: 'D-004' });
        assert(delD4.status === 409 && runSql("SELECT COUNT(*) FROM doctors WHERE id = 'D-004'") === '1', 'Doctor attributed to a new record (D-004) cannot be deleted (409)');
        assert(runSql(`SELECT attending_doctor_id FROM medical_records WHERE id = '${R2.id}'`) === 'D-004', 'Doctor attribution intact after blocked delete');

    } finally {
        cleanupTestData();
        for (const s of [admin, staff, doctor, nurse, nurse2, patient, patient2]) {
            try { await s.logout(); } catch { /* ignore */ }
        }
    }

    // ------------------------------------------------------------------
    console.log('\n[14] Seeded data preservation & cleanup verification');
    assert(runSql(M001_HASH_SQL) === original.m001Hash, 'Seeded record M-001 is byte-for-byte unchanged');
    assert(runSql("SELECT COUNT(*) FROM medical_record_history WHERE medical_record_id = 'M-001'") === original.m001History, 'M-001 history untouched');
    assert(runSql('SELECT COUNT(*) FROM medical_records') === original.recordCount, `All test records removed (medical_records count = ${original.recordCount})`);
    assert(runSql("SELECT COUNT(*) FROM medical_record_history") === original.historyTotal, 'All test history rows removed');
    assert(runSql("SELECT current_val FROM sequences WHERE entity_key = 'medicalRecords'") === original.seqMedical, `medicalRecords sequence restored to ${original.seqMedical}`);
    assert(runSql("SELECT COUNT(*) FROM appointments") === '2' && runSql("SELECT current_val FROM sequences WHERE entity_key = 'appointments'") === original.seqAppointments, 'Appointments restored to seeded A-001/A-002 and sequence restored');
    assert(runSql("SELECT status FROM patients WHERE id = 'P-002'") === original.p002Status && runSql("SELECT status FROM users WHERE id = 'U-006'") === original.u006Status, 'P-002 / U-006 status restored');

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    cleanupTestData();
    console.error('Unhandled error in medical-records-smoke-test:', err);
    process.exit(1);
});
