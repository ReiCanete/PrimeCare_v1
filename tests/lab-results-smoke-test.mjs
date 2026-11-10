/**
 * PrimeCare HIS — Phase 5.10.2 Lab Results Backend Smoke Tests (remediation edition)
 *
 * Verifies the Lab Results module (PHP + MariaDB): auth, CSRF, RBAC, patient IDOR scoping, ordering and
 * sequence allocation, category whitelist, clinical flag calculation (computed flag is authoritative),
 * reference-range validation, write-once result protection, idempotent review, pagination / sorting /
 * filters, billing interoperability, rollback through the REAL production writers, and baseline
 * preservation.
 *
 * Data safety:
 *  - The suite NEVER issues broad deletes. It tracks only the lab results / bills it creates through the
 *    API and removes exactly those rows (plus the review audit rows it generated for those ids).
 *  - Fixtures it must flip temporarily (P-002 / U-006) are restored to their captured original values.
 *  - Sequences are restored to their captured values only when the suite created records.
 *
 * Run:
 *   node tests/lab-results-smoke-test.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

/** Assert and abort the run when a precondition for later sections is missing. */
function must(condition, label, detail = '') {
    assert(condition, label, detail);
    if (!condition) throw new Error(`Precondition failed: ${label}${detail ? ' — ' + detail : ''}`);
}

function runSql(sql) {
    return execFileSync(MYSQL_BIN, ['-u', 'root', 'primecare_db', '-N', '-B', '-e', sql], { encoding: 'utf8' }).trim();
}

const q = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const idList = (ids) => ids.map((id) => {
    if (!/^[A-Z]+-\d+$/.test(id)) throw new Error(`Refusing to use unexpected id in SQL: ${id}`);
    return q(id);
}).join(', ');
const labId = (n) => `LAB-${String(n).padStart(3, '0')}`;

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
    /** POST helper that always attaches this session's CSRF token. */
    post(endpoint, body) {
        return this.request(endpoint, { method: 'POST', headers: { 'X-CSRF-Token': this.csrfToken }, body });
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

// ---------------------------------------------------------------------------------------------
// Baseline capture & tracked-only cleanup
// ---------------------------------------------------------------------------------------------
const LAB_HASH_SQL = (id) => `
    SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(ordered_by,''), test_name, category, status, IFNULL(result,''), IFNULL(unit,''), IFNULL(ref_range_min,''), IFNULL(ref_range_max,''), IFNULL(flag,''), IFNULL(attachment_name,''), ordered_date, IFNULL(result_date,''), IFNULL(performed_by,''), billed, IFNULL(bill_id,'')))
    FROM lab_results WHERE id = ${q(id)}`;

const baseline = {};
const tracked = { labs: new Set(), bills: new Set() };

function captureBaseline() {
    baseline.lab001 = runSql(LAB_HASH_SQL('LAB-001'));
    baseline.lab002 = runSql(LAB_HASH_SQL('LAB-002'));
    baseline.labIds = runSql('SELECT id FROM lab_results ORDER BY id').split('\n').filter(Boolean);
    baseline.billIds = runSql('SELECT id FROM bills ORDER BY id').split('\n').filter(Boolean);
    baseline.labSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'labResults'`), 10);
    baseline.billSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'bills'`), 10);
    baseline.p2Status = runSql(`SELECT status FROM patients WHERE id = 'P-002'`);
    baseline.u6Status = runSql(`SELECT status FROM users WHERE id = 'U-006'`);
    baseline.u6LastLogin = runSql(`SELECT IFNULL(last_login, 'NULL') FROM users WHERE id = 'U-006'`);
    baseline.b001 = runSql(`SELECT MD5(CONCAT_WS('|', id, patient_id, status, subtotal, total, balance)) FROM bills WHERE id = 'B-001'`);
    baseline.b002 = runSql(`SELECT MD5(CONCAT_WS('|', id, patient_id, status, subtotal, total, balance)) FROM bills WHERE id = 'B-002'`);
}

/** Remove review audit rows that point at lab ids which no longer exist (left by interrupted earlier runs). */
function purgeOrphanReviewAudit() {
    const existing = new Set(runSql('SELECT id FROM lab_results').split('\n').filter(Boolean));
    const rows = runSql(`SELECT id, details FROM audit_logs WHERE action = 'Review Lab Result'`).split('\n').filter(Boolean);
    const orphanRowIds = [];
    for (const row of rows) {
        const [rowId, ...rest] = row.split('\t');
        const m = /reviewed lab result (LAB-\d+) \(/.exec(rest.join('\t'));
        if (m && !existing.has(m[1]) && /^\d+$/.test(rowId)) orphanRowIds.push(rowId);
    }
    if (orphanRowIds.length) runSql(`DELETE FROM audit_logs WHERE action = 'Review Lab Result' AND id IN (${orphanRowIds.join(', ')})`);
    return orphanRowIds.length;
}

/** Idempotent: removes ONLY what this run created and restores the fixtures it touched. */
function cleanupTrackedData() {
    try {
        const labs = [...tracked.labs];
        const bills = [...tracked.bills];
        const stmts = [];

        if (labs.length) {
            // Release any bill link first (lab_results.bill_id -> bills), then delete only tracked labs.
            stmts.push(`UPDATE lab_results SET billed = 0, bill_id = NULL WHERE id IN (${idList(labs)})`);
            stmts.push(`DELETE FROM lab_results WHERE id IN (${idList(labs)})`);
            // The review audit rows we generated would make a reused id look "already reviewed".
            const likeClauses = labs.map((id) => `details LIKE ${q(`%reviewed lab result ${id} (%`)}`).join(' OR ');
            stmts.push(`DELETE FROM audit_logs WHERE action = 'Review Lab Result' AND (${likeClauses})`);
        }
        if (bills.length) {
            stmts.push(`DELETE FROM bill_items WHERE bill_id IN (${idList(bills)})`);
            stmts.push(`DELETE FROM bills WHERE id IN (${idList(bills)})`);
            stmts.push(`UPDATE sequences SET current_val = ${baseline.billSeq} WHERE entity_key = 'bills' AND current_val > ${baseline.billSeq}`);
        }
        if (labs.length) {
            stmts.push(`UPDATE sequences SET current_val = ${baseline.labSeq} WHERE entity_key = 'labResults' AND current_val > ${baseline.labSeq}`);
        }
        // Fixtures flipped by the IDOR tests -> exact original values
        stmts.push(`UPDATE patients SET status = ${q(baseline.p2Status)} WHERE id = 'P-002'`);
        stmts.push(`UPDATE users SET status = ${q(baseline.u6Status)}, last_login = ${baseline.u6LastLogin === 'NULL' ? 'NULL' : q(baseline.u6LastLogin)} WHERE id = 'U-006'`);

        runSql(stmts.join('; '));
        tracked.labs.clear();
        tracked.bills.clear();
    } catch (e) {
        console.error('Warning during cleanupTrackedData:', e.message);
    }
}

const dbLab = (id) => {
    const row = runSql(`SELECT status, IFNULL(result,'NULL'), IFNULL(flag,'NULL'), billed, IFNULL(bill_id,'NULL') FROM lab_results WHERE id = ${q(id)}`);
    const [status, result, flag, billed, billId] = row.split('\t');
    return { status, result, flag, billed: billed === '1', billId };
};

async function runTests() {
    console.log('==============================================================');
    console.log('PrimeCare HIS — Phase 5.10.2 Lab Results Smoke Tests');
    console.log('==============================================================\n');

    captureBaseline();
    must(baseline.labIds.includes('LAB-001') && baseline.labIds.includes('LAB-002'), 'Precondition: seeded LAB-001 and LAB-002 exist');
    const purged = purgeOrphanReviewAudit();
    if (purged) console.log(`  (removed ${purged} orphan review audit row(s) left by an earlier interrupted run)`);

    const anon = new ClientSession('anon');
    const admin = new ClientSession('admin');
    const staff = new ClientSession('staff');
    const doctor = new ClientSession('doctor');
    const nurse = new ClientSession('nurse');
    const patient = new ClientSession('patient');
    const patient2 = new ClientSession('patient2');

    try {
        // -----------------------------------------------------------------------------------------
        console.log('[1] Unauthenticated access, method guards & no-delete-endpoint');
        {
            assert((await anon.request('lab-results/list.php')).status === 401, 'Unauthenticated GET list.php -> 401');
            assert((await anon.request('lab-results/get.php', { params: { id: 'LAB-001' } })).status === 401, 'Unauthenticated GET get.php -> 401');
            assert((await anon.request('lab-results/create.php', { method: 'POST', body: {} })).status === 401, 'Unauthenticated POST create.php -> 401');
            assert((await anon.request('lab-results/update.php', { method: 'POST', body: {} })).status === 401, 'Unauthenticated POST update.php -> 401');
            assert((await anon.request('lab-results/status.php', { method: 'POST', body: {} })).status === 401, 'Unauthenticated POST status.php -> 401');
            assert((await anon.request('lab-results/create.php', { method: 'GET' })).status === 405, 'GET on POST-only create.php -> 405');
            assert((await anon.request('lab-results/update.php', { method: 'GET' })).status === 405, 'GET on POST-only update.php -> 405');
            assert((await anon.request('lab-results/status.php', { method: 'GET' })).status === 405, 'GET on POST-only status.php -> 405');
            assert((await anon.request('lab-results/list.php', { method: 'POST', body: {} })).status === 405, 'POST on GET-only list.php -> 405');
            assert((await anon.request('lab-results/delete.php')).status === 404, 'delete.php does not exist (404 for GET)');
            assert((await anon.request('lab-results/delete.php', { method: 'POST' })).status === 404, 'delete.php does not exist (404 for POST)');
            const files = fs.readdirSync(path.join(PROJECT_ROOT, 'api', 'lab-results')).sort();
            assert(JSON.stringify(files) === JSON.stringify(['create.php', 'get.php', 'list.php', 'status.php', 'update.php']),
                'api/lab-results contains exactly five endpoints, no delete endpoint', `found: ${files.join(', ')}`);
        }

        // -----------------------------------------------------------------------------------------
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

        // -----------------------------------------------------------------------------------------
        console.log('\n[3] CSRF enforcement on mutating endpoints');
        {
            const body = { patientId: 'P-001', testName: 'CBC', category: 'Hematology' };
            assert((await doctor.request('lab-results/create.php', { method: 'POST', body })).status === 403, 'create.php without CSRF -> 403');
            assert((await doctor.request('lab-results/create.php', { method: 'POST', headers: { 'X-CSRF-Token': 'bogus' }, body })).status === 403, 'create.php with invalid CSRF -> 403');
            assert((await nurse.request('lab-results/update.php', { method: 'POST', body: { id: 'LAB-002', result: '1' } })).status === 403, 'update.php without CSRF -> 403');
            assert((await nurse.request('lab-results/update.php', { method: 'POST', headers: { 'X-CSRF-Token': 'bogus' }, body: { id: 'LAB-002', result: '1' } })).status === 403, 'update.php with invalid CSRF -> 403');
            assert((await doctor.request('lab-results/status.php', { method: 'POST', body: { id: 'LAB-001', action: 'review' } })).status === 403, 'status.php without CSRF -> 403');
            assert((await doctor.request('lab-results/status.php', { method: 'POST', headers: { 'X-CSRF-Token': 'bogus' }, body: { id: 'LAB-001', action: 'review' } })).status === 403, 'status.php with invalid CSRF -> 403');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[4] Baseline reads & seeded records');
        {
            const r = await admin.request('lab-results/list.php');
            assert(r.status === 200 && Array.isArray(r.json.data.labs), 'admin list returns 200');
            const labs = r.json.data.labs;
            assert(r.json.data.total === baseline.labIds.length, 'list total matches the number of lab_results rows', `total=${r.json.data.total}`);
            assert(r.json.data.page === 1 && r.json.data.limit === 50 && r.json.data.sortBy === 'orderedDate' && r.json.data.sortDir === 'desc',
                'list defaults: page 1, limit 50, orderedDate desc');

            const lab1 = labs.find((l) => l.id === 'LAB-001');
            const lab2 = labs.find((l) => l.id === 'LAB-002');
            must(Boolean(lab1) && Boolean(lab2), 'LAB-001 and LAB-002 present in list');
            assert(lab1.patientId === 'P-001' && lab1.patientName === 'Juan Dela Cruz', 'LAB-001 joins patientName');
            assert(lab1.orderedBy === 'D-001' && lab1.doctorName === 'Dr. Jose Rizal', 'LAB-001 joins doctorName');
            assert(lab1.testName === 'Complete Blood Count' && lab1.category === 'Hematology', 'LAB-001 testName & category');
            assert(lab1.status === 'Completed' && lab1.flag === 'Abnormal', 'LAB-001 Completed / Abnormal');
            assert(lab1.result === '13.5' && lab1.unit === 'g/dL', 'LAB-001 result & unit');
            assert(lab1.referenceRange && lab1.referenceRange.min === '13.8' && lab1.referenceRange.max === '17.2', 'LAB-001 nested referenceRange');
            assert(lab1.refRangeMin === 13.8 && lab1.refRangeMax === 17.2, 'LAB-001 flat refRangeMin/Max');
            assert(lab1.billed === true && lab1.billId === 'B-001', 'LAB-001 billed under B-001');
            assert(lab2.testName === 'Lipid Profile' && lab2.status === 'Completed' && lab2.flag === 'Normal', 'LAB-002 Lipid Profile Completed / Normal');
            assert(lab2.billed === false && lab2.billId === null, 'LAB-002 unbilled');

            assert((await nurse.request('lab-results/list.php')).status === 200, 'nurse reads list');
            assert((await doctor.request('lab-results/list.php')).status === 200, 'doctor reads list');
            const g = await doctor.request('lab-results/get.php', { params: { id: 'LAB-001' } });
            assert(g.status === 200 && g.json.data.lab.id === 'LAB-001', 'doctor GET get.php?id=LAB-001 -> 200');
            assert((await doctor.request('lab-results/get.php', { params: { id: 'INVALID' } })).status === 400, 'malformed ID -> 400');
            assert((await doctor.request('lab-results/get.php', { params: { id: 'LAB-999' } })).status === 404, 'unknown ID -> 404');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[5] Pagination, sorting & maximum page size (M2)');
        {
            const totalRows = baseline.labIds.length;
            const p1 = await admin.request('lab-results/list.php', { params: { limit: 1, page: 1, sortBy: 'id', sortDir: 'asc' } });
            assert(p1.status === 200 && p1.json.data.count === 1 && p1.json.data.labs[0].id === 'LAB-001', 'limit=1 page=1 sortBy=id asc -> LAB-001');
            assert(p1.json.data.limit === 1 && p1.json.data.total === totalRows && p1.json.data.totalPages === totalRows, 'pagination metadata (limit/total/totalPages) is correct');

            const p2 = await admin.request('lab-results/list.php', { params: { limit: 1, page: 2, sortBy: 'id', sortDir: 'asc' } });
            assert(p2.json.data.labs.length === 1 && p2.json.data.labs[0].id === 'LAB-002' && p2.json.data.page === 2, 'page=2 returns the next row (LAB-002)');

            const beyond = await admin.request('lab-results/list.php', { params: { limit: 1, page: 9999 } });
            assert(beyond.status === 200 && beyond.json.data.labs.length === 0 && beyond.json.data.total === totalRows, 'page beyond the last returns an empty page with the real total');

            const maxId = runSql('SELECT id FROM lab_results ORDER BY id DESC LIMIT 1');
            const desc = await admin.request('lab-results/list.php', { params: { limit: 1, sortBy: 'id', sortDir: 'desc' } });
            assert(desc.json.data.labs[0].id === maxId && desc.json.data.sortDir === 'desc', 'sortBy=id desc returns the highest id first');

            const big = await admin.request('lab-results/list.php', { params: { limit: 1000 } });
            assert(big.status === 200 && big.json.data.limit === 100, 'limit=1000 is clamped to the maximum page size (100)');
            assert((await admin.request('lab-results/list.php', { params: { limit: 0 } })).json.data.limit === 50, 'limit=0 falls back to the default (50)');
            assert((await admin.request('lab-results/list.php', { params: { limit: -7 } })).json.data.limit === 50, 'negative limit falls back to the default (50)');
            assert((await admin.request('lab-results/list.php', { params: { limit: 'abc' } })).json.data.limit === 50, 'non-numeric limit falls back to the default (50)');
            assert((await admin.request('lab-results/list.php', { params: { page: 0 } })).json.data.page === 1, 'page=0 is treated as page 1');
            assert((await admin.request('lab-results/list.php', { params: { page: -4 } })).json.data.page === 1, 'negative page is treated as page 1');
            assert((await admin.request('lab-results/list.php', { params: { page: 'abc' } })).json.data.page === 1, 'non-numeric page is treated as page 1');

            const byName = await admin.request('lab-results/list.php', { params: { sortBy: 'testName', sortDir: 'asc' } });
            const namesAsc = byName.json.data.labs.map((l) => l.testName);
            assert(byName.status === 200 && byName.json.data.sortBy === 'testName' && namesAsc.indexOf('Complete Blood Count') < namesAsc.indexOf('Lipid Profile'), 'sortBy=testName asc orders alphabetically');
            const byNameDesc = await admin.request('lab-results/list.php', { params: { sortBy: 'testName', sortDir: 'desc' } });
            const namesDesc = byNameDesc.json.data.labs.map((l) => l.testName);
            assert(namesDesc.indexOf('Lipid Profile') < namesDesc.indexOf('Complete Blood Count'), 'sortBy=testName desc reverses the order');
            assert((await admin.request('lab-results/list.php', { params: { sortBy: 'patientName' } })).status === 200, 'sortBy=patientName (alias) is allowed');

            const inj = await admin.request('lab-results/list.php', { params: { sortBy: 'id; DROP TABLE lab_results; --', sortDir: 'asc; DROP' } });
            assert(inj.status === 200 && inj.json.data.sortBy === 'orderedDate' && inj.json.data.sortDir === 'desc', 'SQL-injection sortBy/sortDir falls back to the allowlist defaults');
            const inj2 = await admin.request('lab-results/list.php', { params: { sortBy: 'l.id' } });
            assert(inj2.json.data.sortBy === 'orderedDate', 'column-qualified sortBy (not in allowlist) is ignored');
            assert(parseInt(runSql('SELECT COUNT(*) FROM lab_results'), 10) === totalRows, 'lab_results table is intact after injection attempts');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[6] Filters');
        {
            const ids = (r) => r.json.data.labs.map((l) => l.id);
            let r = await admin.request('lab-results/list.php', { params: { flag: 'Abnormal' } });
            assert(ids(r).includes('LAB-001') && !ids(r).includes('LAB-002'), 'flag=Abnormal includes LAB-001, excludes LAB-002');
            r = await admin.request('lab-results/list.php', { params: { flag: 'Normal' } });
            assert(ids(r).includes('LAB-002') && !ids(r).includes('LAB-001'), 'flag=Normal includes LAB-002, excludes LAB-001');
            r = await admin.request('lab-results/list.php', { params: { category: 'Chemistry' } });
            assert(ids(r).includes('LAB-002') && !ids(r).includes('LAB-001'), 'category=Chemistry includes LAB-002 only');
            r = await admin.request('lab-results/list.php', { params: { doctorId: 'D-001' } });
            assert(ids(r).includes('LAB-001') && !ids(r).includes('LAB-002'), 'doctorId=D-001 includes LAB-001 only');
            r = await admin.request('lab-results/list.php', { params: { doctorId: 'D-002' } });
            assert(ids(r).includes('LAB-002') && !ids(r).includes('LAB-001'), 'doctorId=D-002 includes LAB-002 only');
            r = await admin.request('lab-results/list.php', { params: { dateFrom: '2026-11-03', dateTo: '2026-11-03' } });
            assert(ids(r).includes('LAB-002') && !ids(r).includes('LAB-001'), 'dateFrom/dateTo=2026-11-03 includes LAB-002 only');
            r = await admin.request('lab-results/list.php', { params: { dateTo: '2026-11-02' } });
            assert(ids(r).includes('LAB-001') && !ids(r).includes('LAB-002'), 'dateTo=2026-11-02 includes LAB-001 only');
            r = await admin.request('lab-results/list.php', { params: { keyword: 'Lipid' } });
            assert(ids(r).includes('LAB-002') && !ids(r).includes('LAB-001'), 'keyword=Lipid matches LAB-002');
            r = await admin.request('lab-results/list.php', { params: { keyword: 'Juan' } });
            assert(ids(r).includes('LAB-001') && ids(r).includes('LAB-002'), 'keyword=Juan matches by patient name');
            r = await admin.request('lab-results/list.php', { params: { keyword: 'LAB-001' } });
            assert(ids(r).includes('LAB-001') && !ids(r).includes('LAB-002'), 'keyword=LAB-001 matches by id');
            r = await admin.request('lab-results/list.php', { params: { keyword: 'NoSuchThingXYZ' } });
            assert(r.json.data.total === 0, 'unmatched keyword returns 0 rows');
            r = await admin.request('lab-results/list.php', { params: { flag: 'Abnormal', category: 'Hematology', status: 'Completed', patientId: 'P-001' } });
            assert(ids(r).includes('LAB-001') && !ids(r).includes('LAB-002'), 'combined filters (flag+category+status+patientId) intersect correctly');
            r = await admin.request('lab-results/list.php', { params: { patientId: 'P-002' } });
            assert(r.json.data.total === parseInt(runSql(`SELECT COUNT(*) FROM lab_results WHERE patient_id = 'P-002'`), 10), 'patientId=P-002 filter matches the database count');
            r = await admin.request('lab-results/list.php', { params: { status: 'All', flag: 'All', category: 'All', doctorId: 'All' } });
            assert(r.json.data.total === baseline.labIds.length, "'All' filter values are ignored");
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[7] Staff Access Denial (403)');
        {
            assert((await staff.request('lab-results/list.php')).status === 403, 'staff GET list.php -> 403');
            assert((await staff.request('lab-results/get.php', { params: { id: 'LAB-001' } })).status === 403, 'staff GET get.php -> 403');
            assert((await staff.post('lab-results/create.php', { patientId: 'P-001', testName: 'Urinalysis', category: 'Urinalysis' })).status === 403, 'staff POST create.php -> 403');
            assert((await staff.post('lab-results/update.php', { id: 'LAB-002', result: '1', flag: 'Normal' })).status === 403, 'staff POST update.php -> 403');
            assert((await staff.post('lab-results/status.php', { id: 'LAB-001', action: 'review' })).status === 403, 'staff POST status.php -> 403');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[8] Patient ownership, IDOR & filter-bypass protection');
        {
            const p1 = await patient.request('lab-results/get.php', { params: { id: 'LAB-001' } });
            assert(p1.status === 200 && p1.json.data.lab.id === 'LAB-001', 'patient P-001 reads own LAB-001');

            const ownCompleted = parseInt(runSql(`SELECT COUNT(*) FROM lab_results WHERE patient_id = 'P-001' AND status = 'Completed'`), 10);
            const mine = await patient.request('lab-results/list.php', { params: { my: 1 } });
            assert(mine.status === 200 && mine.json.data.total === ownCompleted && mine.json.data.labs.every((l) => l.patientId === 'P-001' && l.status === 'Completed'),
                'patient list returns only own Completed labs', `total=${mine.json.data.total} expected=${ownCompleted}`);

            const paged = await patient.request('lab-results/list.php', { params: { limit: 1, page: 1 } });
            assert(paged.json.data.count === 1 && paged.json.data.total === ownCompleted, 'patient pagination total reflects only own Completed labs');

            const bypassPid = await patient.request('lab-results/list.php', { params: { patientId: 'P-002' } });
            assert(bypassPid.status === 200 && bypassPid.json.data.labs.every((l) => l.patientId === 'P-001') && bypassPid.json.data.total === ownCompleted,
                'patient cannot widen scope with patientId=P-002');
            const bypassStatus = await patient.request('lab-results/list.php', { params: { status: 'Ordered' } });
            assert(bypassStatus.status === 200 && bypassStatus.json.data.total === 0, 'patient cannot list Ordered tests with status=Ordered');
            const bypassDoctor = await patient.request('lab-results/list.php', { params: { doctorId: 'D-002', patientId: 'P-002', my: 0 } });
            assert(bypassDoctor.json.data.labs.every((l) => l.patientId === 'P-001'), 'patient scope holds with doctorId + patientId + my=0');

            assert((await patient.post('lab-results/create.php', { patientId: 'P-001', testName: 'CBC', category: 'Hematology' })).status === 403, 'patient cannot order -> 403');
            assert((await patient.post('lab-results/update.php', { id: 'LAB-002', result: '100', flag: 'Normal' })).status === 403, 'patient cannot enter results -> 403');
            assert((await patient.post('lab-results/status.php', { id: 'LAB-001', action: 'review' })).status === 403, 'patient cannot review -> 403');

            runSql(`UPDATE patients SET status = 'verified' WHERE id = 'P-002'; UPDATE users SET status = 'active' WHERE id = 'U-006';`);
            const p2L = await patient2.login('patient2', 'password123');
            must(p2L.status === 200, 'patient2 logged in (fixture temporarily verified)');
            assert((await patient2.request('lab-results/get.php', { params: { id: 'LAB-001' } })).status === 403, 'patient2 GET LAB-001 is BLOCKED (403 IDOR)');
            const idorList = await patient2.request('lab-results/list.php', { params: { patientId: 'P-001' } });
            assert(idorList.status === 200 && idorList.json.data.total === 0, 'patient2 list with patientId=P-001 is scoped to own (0 rows)');
            const idorKw = await patient2.request('lab-results/list.php', { params: { keyword: 'Complete Blood Count', flag: 'Abnormal' } });
            assert(idorKw.json.data.total === 0, 'patient2 cannot find P-001 results through keyword/flag filters');
            runSql(`UPDATE patients SET status = ${q(baseline.p2Status)} WHERE id = 'P-002'; UPDATE users SET status = ${q(baseline.u6Status)} WHERE id = 'U-006';`);
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[9] Nurse role boundaries');
        {
            assert((await nurse.post('lab-results/create.php', { patientId: 'P-001', testName: 'FBS', category: 'Chemistry' })).status === 403, 'nurse cannot order tests -> 403');
            assert((await nurse.post('lab-results/status.php', { id: 'LAB-001', action: 'review' })).status === 403, 'nurse cannot review results -> 403');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[10] Ordering: validation, category whitelist (M4) & sequence allocation');
        const order = {};
        {
            const ok = { patientId: 'P-001', testName: 'Smoke Test Panel', category: 'Chemistry' };
            assert((await doctor.post('lab-results/create.php', { ...ok, patientId: '' })).status === 400, 'missing patientId -> 400');
            assert((await doctor.post('lab-results/create.php', { ...ok, patientId: 'P-999' })).status === 404, 'unknown patient -> 404');
            assert((await doctor.post('lab-results/create.php', { ...ok, patientId: 'P-002' })).status === 422, 'unverified/pending patient -> 422');
            assert((await doctor.post('lab-results/create.php', { ...ok, testName: '' })).status === 400, 'missing testName -> 400');
            assert((await doctor.post('lab-results/create.php', { ...ok, testName: 'X'.repeat(151) })).status === 400, 'testName > 150 chars -> 400');
            assert((await doctor.post('lab-results/create.php', { ...ok, category: '' })).status === 400, 'missing category -> 400');
            const bad1 = await doctor.post('lab-results/create.php', { ...ok, category: 'Radiology' });
            assert(bad1.status === 422 && /Unsupported category/.test(bad1.json.message), 'unsupported category "Radiology" -> 422 with allowed list');
            assert((await doctor.post('lab-results/create.php', { ...ok, category: 'Hematology; DROP TABLE lab_results' })).status === 422, 'injection-style category -> 422');
            assert((await doctor.post('lab-results/create.php', { ...ok, category: ['Chemistry'] })).status === 422, 'array category -> 422');
            assert((await admin.post('lab-results/create.php', { ...ok, category: 'Pathology' })).status === 422, 'admin also cannot use an unsupported category -> 422');
            assert(parseInt(runSql('SELECT COUNT(*) FROM lab_results'), 10) === baseline.labIds.length, 'no lab row created by any rejected order');
            assert(parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'labResults'`), 10) === baseline.labSeq, 'sequence not advanced by rejected orders');

            const make = async (key, session, body) => {
                const res = await session.post('lab-results/create.php', body);
                must(res.status === 201 && res.json.data.lab, `order ${key} created (201)`, `status=${res.status} ${res.text.slice(0, 120)}`);
                tracked.labs.add(res.json.data.lab.id);
                order[key] = res.json.data.lab;
                return res.json.data.lab;
            };

            const a = await make('A', doctor, { patientId: 'P-001', orderedBy: 'D-003', testName: 'Fasting Blood Sugar', category: 'Chemistry' });
            assert(a.id === labId(baseline.labSeq + 1), `next allocated ID follows the sequence (${labId(baseline.labSeq + 1)})`);
            if (baseline.labSeq === 2) assert(a.id === 'LAB-003', 'first new order is LAB-003');
            assert(a.orderedBy === 'D-001', 'doctor attribution locked to authenticated session (D-001), impersonation ignored');
            assert(a.status === 'Ordered' && a.result === null && a.flag === null, 'initial status Ordered with null result/flag');
            assert(a.billed === false && a.billId === null, 'initial billed=false');

            const b = await make('B', admin, { patientId: 'P-001', orderedBy: 'D-002', testName: 'Serum Creatinine', category: 'chemistry' });
            assert(b.category === 'Chemistry', 'category is stored in canonical spelling');
            assert(b.orderedBy === 'D-002', 'admin order keeps the specified orderedBy');
            for (const [key, name, cat] of [
                ['C', 'Serum Potassium High', 'Chemistry'], ['D', 'Serum Potassium Low', 'Chemistry'],
                ['E', 'HIV Screening', 'Other'], ['F', 'Validation Panel', 'Hematology'],
                ['G', 'Boundary Panel', 'Urinalysis'], ['H', 'Rollback Disposable', 'Imaging'],
            ]) {
                await make(key, admin, { patientId: 'P-001', testName: name, category: cat });
            }
            assert(order.H.id === labId(baseline.labSeq + 8), 'eight sequential orders allocated without gaps');

            assert((await patient.request('lab-results/get.php', { params: { id: a.id } })).status === 403, 'patient cannot view an Ordered (uncompleted) test -> 403');
            const pl = await patient.request('lab-results/list.php', { params: { limit: 100 } });
            assert(pl.json.data.labs.every((l) => l.status === 'Completed'), 'patient list excludes Ordered tests');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[11] Result entry: validation (M1), authoritative computed flag (H1) & boundaries');
        {
            const F = order.F.id;
            const rangeBody = (extra) => ({ id: F, result: '9.9', unit: 'mmol/L', ...extra });
            const ordered = () => dbLab(F).status === 'Ordered' && dbLab(F).result === 'NULL';

            assert((await nurse.post('lab-results/update.php', { id: F, result: '' })).status === 400, 'empty result -> 400');
            assert((await nurse.post('lab-results/update.php', { id: F })).status === 400, 'missing result -> 400');
            assert((await nurse.post('lab-results/update.php', { id: F, result: 'x'.repeat(101), flag: 'Normal' })).status === 400, 'result > 100 chars -> 400');
            assert((await nurse.post('lab-results/update.php', { id: F, result: '1', unit: 'u'.repeat(51), flag: 'Normal' })).status === 400, 'unit > 50 chars -> 400');
            assert((await nurse.post('lab-results/update.php', { id: 'BOGUS', result: '1', flag: 'Normal' })).status === 400, 'malformed lab id -> 400');
            assert((await nurse.post('lab-results/update.php', { id: 'LAB-999', result: '1', flag: 'Normal' })).status === 404, 'unknown lab id -> 404');

            let r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: 'abc', max: '5' } }));
            assert(r.status === 422 && /minimum must be a number/i.test(r.json.message), 'non-numeric minimum -> 422', r.json?.message);
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: '1', max: '5mg' } }));
            assert(r.status === 422 && /maximum must be a number/i.test(r.json.message), 'non-numeric maximum -> 422', r.json?.message);
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: '3.5', max: '' } }));
            assert(r.status === 422 && /partial/i.test(r.json.message), 'partial range (min only) -> 422', r.json?.message);
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: null, max: '5' } }));
            assert(r.status === 422 && /partial/i.test(r.json.message), 'partial range (max only) -> 422', r.json?.message);
            r = await nurse.post('lab-results/update.php', rangeBody({ refRangeMin: '3.5' }));
            assert(r.status === 422 && /partial/i.test(r.json.message), 'partial flat range (refRangeMin only) -> 422', r.json?.message);
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: '5', max: '5' } }));
            assert(r.status === 422 && /strictly less/i.test(r.json.message), 'min == max -> 422', r.json?.message);
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: '100', max: '70' } }));
            assert(r.status === 422, 'min > max -> 422');
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: '3.5-5.0' }));
            assert(r.status === 422, 'non-object referenceRange -> 422');
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: '1', max: '1e12' } }));
            assert(r.status === 422, 'out-of-range reference bound -> 422');
            r = await nurse.post('lab-results/update.php', { id: F, result: 'Positive' });
            assert(r.status === 422, 'no range and no flag -> 422 (no invented threshold)');
            r = await nurse.post('lab-results/update.php', rangeBody({ flag: 'DangerZone' }));
            assert(r.status === 422, 'invalid manual flag string -> 422');
            r = await nurse.post('lab-results/update.php', rangeBody({ flag: ['Normal'] }));
            assert(r.status === 422, 'non-string manual flag -> 422');
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: '3.5', max: '5.0' }, flag: 'Normal' }));
            assert(r.status === 422 && /conflicts with the computed flag \(Critical\)/.test(r.json.message), 'H1: manual "Normal" on a critical value is REJECTED (422)', r.json?.message);
            r = await nurse.post('lab-results/update.php', rangeBody({ result: '4.0', referenceRange: { min: '3.5', max: '5.0' }, flag: 'Critical' }));
            assert(r.status === 422 && /conflicts/.test(r.json.message), 'H1: manual "Critical" on a normal value is REJECTED (422)');
            r = await nurse.post('lab-results/update.php', rangeBody({ result: '5.2', referenceRange: { min: '3.5', max: '5.0' }, flag: 'Normal' }));
            assert(r.status === 422, 'H1: manual "Normal" on an abnormal value is REJECTED (422)');
            assert(ordered(), 'every rejected submission left the record untouched (still Ordered, no result)');

            // Matching manual flag (any case) is accepted; the stored flag is the computed one.
            r = await nurse.post('lab-results/update.php', rangeBody({ referenceRange: { min: '3.5', max: '5.0' }, flag: 'critical' }));
            assert(r.status === 200 && r.json.data.lab.flag === 'Critical' && r.json.data.lab.status === 'Completed', 'matching manual flag is accepted; flag stored as computed (Critical)');

            const submit = (key, session, body) => session.post('lab-results/update.php', { id: order[key].id, ...body });

            r = await submit('A', nurse, { result: '90', unit: 'mg/dL', referenceRange: { min: '70', max: '100' } });
            assert(r.status === 200 && r.json.data.lab.flag === 'Normal' && r.json.data.lab.status === 'Completed', 'in-range result auto-flagged Normal and Completed');
            assert(Boolean(r.json.data.lab.performedBy) && Boolean(r.json.data.lab.resultDate), 'performedBy and resultDate recorded server-side');
            assert(r.json.data.lab.referenceRange.min === '70' && r.json.data.lab.refRangeMax === 100, 'reference range persisted (nested + flat)');

            r = await submit('B', nurse, { result: '1.30', unit: 'mg/dL', referenceRange: { min: '0.6', max: '1.2' } });
            assert(r.status === 200 && r.json.data.lab.flag === 'Abnormal', 'result just beyond max (1.30 in 0.6-1.2) auto-flagged Abnormal');

            r = await submit('C', doctor, { result: '6.1', unit: 'mmol/L', referenceRange: { min: '3.5', max: '5.0' } });
            assert(r.status === 200 && r.json.data.lab.flag === 'Critical', 'result above max+30% (6.1 > 5.45) auto-flagged Critical');
            r = await submit('D', doctor, { result: '2.8', unit: 'mmol/L', referenceRange: { min: '3.5', max: '5.0' } });
            assert(r.status === 200 && r.json.data.lab.flag === 'Critical', 'result below min-30% (2.8 < 3.05) auto-flagged Critical');

            r = await submit('E', nurse, { result: 'Reactive', unit: 'Qualitative', flag: 'Abnormal', attachmentName: 'C:\\fakepath\\..\\lab-report.pdf' });
            assert(r.status === 200 && r.json.data.lab.flag === 'Abnormal' && r.json.data.lab.referenceRange === null, 'qualitative result: explicit flag honoured only because no range exists');
            assert(r.json.data.lab.attachmentName === 'lab-report.pdf', 'attachment path traversal reduced to a bare filename');

            // Boundary through the API using the flat range form: exactly max + 30% is Abnormal, not Critical.
            r = await submit('G', admin, { result: '13', unit: 'g', refRangeMin: '0', refRangeMax: '10' });
            assert(r.status === 200 && r.json.data.lab.flag === 'Abnormal', 'API boundary: exactly max+30% (13 in 0-10, flat range fields) is Abnormal, not Critical');

            assert(dbLab(order.C.id).flag === 'Critical' && dbLab(order.A.id).flag === 'Normal', 'database stores the computed flags');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[12] Completed / billed result protection (H2)');
        {
            const A = order.A.id;
            const snapshot = JSON.stringify(dbLab(A));
            const rejBefore = parseInt(runSql(`SELECT COUNT(*) FROM audit_logs WHERE action = 'Lab Result Update Rejected'`), 10);

            let r = await nurse.post('lab-results/update.php', { id: A, result: '55', unit: 'mg/dL', referenceRange: { min: '70', max: '100' } });
            assert(r.status === 409 && /permanent/.test(r.json.message), 'nurse cannot overwrite a Completed result -> 409', r.json?.message);
            r = await doctor.post('lab-results/update.php', { id: A, result: '1000', flag: 'Normal' });
            assert(r.status === 409, 'doctor cannot overwrite a Completed result -> 409');
            r = await admin.post('lab-results/update.php', { id: A, result: '90', unit: 'mg/dL', referenceRange: { min: '70', max: '100' } });
            assert(r.status === 409, 'admin cannot overwrite a Completed result, even with identical values -> 409');
            assert(JSON.stringify(dbLab(A)) === snapshot, 'Completed record unchanged in the database after rejected updates');

            r = await admin.post('lab-results/update.php', { id: 'LAB-001', result: '99', flag: 'Normal' });
            assert(r.status === 409 && /billed/.test(r.json.message) && /B-001/.test(r.json.message), 'seeded billed LAB-001 cannot be modified -> 409 (billed)', r.json?.message);
            r = await admin.post('lab-results/update.php', { id: 'LAB-002', result: '99', flag: 'Normal' });
            assert(r.status === 409, 'seeded Completed LAB-002 cannot be modified -> 409');
            r = await admin.post('lab-results/update.php', { id: 'LAB-001', result: '99', flag: 'Normal', billed: false, billId: null });
            assert(r.status === 409, 'attempt to clear billing flags through update.php -> 409');
            const rejAfter = parseInt(runSql(`SELECT COUNT(*) FROM audit_logs WHERE action = 'Lab Result Update Rejected'`), 10);
            assert(rejAfter - rejBefore === 6, 'each rejected modification attempt is audit-logged', `delta=${rejAfter - rejBefore}`);
            assert(runSql(LAB_HASH_SQL('LAB-001')) === baseline.lab001 && runSql(LAB_HASH_SQL('LAB-002')) === baseline.lab002, 'seeded LAB-001 / LAB-002 are byte-for-byte unchanged after the rejections');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[13] Review: honest, audited and idempotent (M3)');
        {
            const A = order.A.id;
            const reviewRows = () => parseInt(runSql(`SELECT COUNT(*) FROM audit_logs WHERE action = 'Review Lab Result' AND details LIKE ${q(`%reviewed lab result ${A} (%`)}`), 10);
            assert(reviewRows() === 0, 'no review audit row exists before the first review');

            let r = await doctor.post('lab-results/status.php', { id: A, action: 'review' });
            assert(r.status === 200 && r.json.data.review.alreadyReviewed === false && r.json.data.review.reviewedBy === 'doctor', 'first review recorded (alreadyReviewed=false, reviewedBy=doctor)');
            assert(reviewRows() === 1, 'exactly one review audit row written');

            r = await doctor.post('lab-results/status.php', { id: A, action: 'review' });
            assert(r.status === 200 && r.json.data.review.alreadyReviewed === true && r.json.data.review.reviewedBy === 'doctor' && /already marked/.test(r.json.message), 'repeat review is idempotent and reports the original reviewer');
            r = await admin.post('lab-results/status.php', { id: A, action: 'review' });
            assert(r.status === 200 && r.json.data.review.alreadyReviewed === true && r.json.data.review.reviewedBy === 'doctor', 'a different physician also sees the original review (first reviewer wins)');
            assert(reviewRows() === 1, 'idempotent: still exactly one review audit row after repeat calls');

            assert((await doctor.post('lab-results/status.php', { id: order.H.id, action: 'review' })).status === 400, 'cannot review an Ordered (uncompleted) test -> 400');
            assert((await doctor.post('lab-results/status.php', { id: A, action: 'approve' })).status === 400, 'unsupported action -> 400');
            assert((await doctor.post('lab-results/status.php', { id: 'LAB-999', action: 'review' })).status === 404, 'review of unknown id -> 404');
            assert((await doctor.post('lab-results/status.php', { id: 'nope', action: 'review' })).status === 400, 'review with malformed id -> 400');
            assert((await nurse.post('lab-results/status.php', { id: A, action: 'review' })).status === 403, 'nurse still cannot review -> 403');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[14] Billing interoperability & billed-record protection');
        {
            const A = order.A.id;
            const preview = async () => (await staff.request('billing/preview.php', { params: { patientId: 'P-001' } }));
            const labIdsIn = (p) => p.json.data.items.filter((i) => i.sourceType === 'labResults').map((i) => i.sourceId);

            const p1 = await preview();
            assert(p1.status === 200, 'staff billing preview -> 200');
            const ids1 = labIdsIn(p1);
            assert(!ids1.includes('LAB-001'), 'already-billed LAB-001 excluded from preview');
            assert(ids1.includes('LAB-002') && ids1.includes(A), 'Completed + unbilled results (LAB-002, new) appear in preview');
            assert(!ids1.includes(order.H.id), 'Ordered (uncompleted) test is not billable');

            const item = p1.json.data.items.find((i) => i.sourceId === A);
            const created = await staff.post('billing/create.php', { patientId: 'P-001', discountType: 'None', philhealthAmount: 0, hmoProvider: '', hmoAmount: 0, items: [item] });
            must(created.status === 201, 'staff creates a bill for the new lab result (201)', created.text.slice(0, 160));
            const billId = created.json.data.bill.id;
            tracked.bills.add(billId);

            const afterBill = dbLab(A);
            assert(afterBill.billed === true && afterBill.billId === billId, `lab result flagged billed under ${billId}`);
            assert(!labIdsIn(await preview()).includes(A), 'billed lab result disappears from preview');

            const dup = await staff.post('billing/create.php', { patientId: 'P-001', discountType: 'None', items: [item] });
            assert(dup.status === 409, 'duplicate billing of the same lab result -> 409');

            const upd = await admin.post('lab-results/update.php', { id: A, result: '92', unit: 'mg/dL', referenceRange: { min: '70', max: '100' } });
            assert(upd.status === 409 && /billed/.test(upd.json.message), 'update of a billed lab result -> 409 (billed)', upd.json?.message);
            assert(dbLab(A).billed === true && dbLab(A).billId === billId && dbLab(A).result === '90', 'billing link and result intact after the rejected update');

            const voided = await admin.post('billing/void.php', { id: billId, reason: 'Smoke test void verification' });
            assert(voided.status === 200, 'admin voids the bill (200)');
            const afterVoid = dbLab(A);
            assert(afterVoid.billed === false && afterVoid.billId === 'NULL', 'void restores billed=0 / bill_id=NULL');
            assert(afterVoid.status === 'Completed' && afterVoid.result === '90', 'void does not alter the clinical result');
            assert(labIdsIn(await preview()).includes(A), 'unflagged lab result reappears in preview');
            assert((await admin.post('lab-results/update.php', { id: A, result: '91', flag: 'Normal' })).status === 409, 'a voided-unbilled Completed result is still write-once -> 409');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[15] Rollback through the REAL production writers (H3)');
        {
            const seqBefore = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'labResults'`), 10);
            const countBefore = parseInt(runSql('SELECT COUNT(*) FROM lab_results'), 10);
            let probe = {};
            try {
                const out = execFileSync(PHP_BIN, [path.join(PROJECT_ROOT, 'tests', 'lab-results-rollback-probe.php'), order.H.id], { encoding: 'utf8' }).trim();
                probe = JSON.parse(out);
            } catch (e) {
                console.error('  rollback probe error:', e.stdout || e.message);
            }
            const c = probe.create || {};
            assert(c.injectorRan === true && c.stage === 'create:before-commit', 'create: failure injected INSIDE the real transaction (after all writes, before commit)');
            assert(c.ok === false && c.status === 500, 'create: production writer reports failure (500)');
            assert(c.labIdsUnchanged === true && c.allocatedIdAbsent === true, 'create: no lab row survived (allocated id absent)');
            assert(c.sequenceUnchanged === true, 'create: sequence allocation rolled back');
            assert(c.auditUnchanged === true, 'create: audit row rolled back with the transaction');
            assert(c.inTransaction === false, 'create: no transaction left open');
            const u = probe.update || {};
            assert(u.injectorRan === true && u.ok === false && u.status === 500, 'update: production writer fails inside the real transaction (500)');
            assert(u.rowUnchanged === true && u.stillOrdered === true, 'update: lab row byte-for-byte unchanged and still Ordered');
            assert(u.auditUnchanged === true && u.inTransaction === false, 'update: audit row rolled back, no open transaction');
            const k = probe.control || {};
            assert(k.injectorRan === true && k.ok === true && k.completed === true && k.inTransaction === false, 'control: the same update WITHOUT a failure commits (proves the rollbacks above were real)');
            assert(parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'labResults'`), 10) === seqBefore, 'sequence value identical before and after the whole probe');
            assert(parseInt(runSql('SELECT COUNT(*) FROM lab_results'), 10) === countBefore, 'lab_results row count identical before and after the probe');
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[16] Clinical flag & reference-range boundary probe (pure logic)');
        {
            let cases = [];
            try {
                cases = JSON.parse(execFileSync(PHP_BIN, [path.join(PROJECT_ROOT, 'tests', 'lab-results-flag-probe.php')], { encoding: 'utf8' }).trim());
            } catch (e) {
                console.error('  flag probe error:', e.stdout || e.message);
            }
            assert(cases.length >= 45, 'flag probe produced its full case list', `cases=${cases.length}`);
            for (const c of cases) assert(c.pass === true, `flag probe: ${c.name}`, c.detail);
        }

        // -----------------------------------------------------------------------------------------
        console.log('\n[17] Data integrity, cleanup & seed preservation');
        {
            const delPat = await admin.post('patients/delete.php', { id: 'P-001' });
            assert(delPat.status === 409, 'patient P-001 with lab records cannot be deleted (409)');
            const delDoc = await admin.post('doctors/delete.php', { id: 'D-001' });
            assert(delDoc.status === 409, 'doctor D-001 with lab records cannot be deleted (409)');

            const createdCount = tracked.labs.size;
            cleanupTrackedData();

            assert(runSql(LAB_HASH_SQL('LAB-001')) === baseline.lab001, 'seeded LAB-001 is byte-for-byte unchanged');
            assert(runSql(LAB_HASH_SQL('LAB-002')) === baseline.lab002, 'seeded LAB-002 is byte-for-byte unchanged');
            assert(JSON.stringify(runSql('SELECT id FROM lab_results ORDER BY id').split('\n').filter(Boolean)) === JSON.stringify(baseline.labIds),
                `lab_results rows identical to the pre-run set (${createdCount} test rows removed, nothing else touched)`);
            assert(JSON.stringify(runSql('SELECT id FROM bills ORDER BY id').split('\n').filter(Boolean)) === JSON.stringify(baseline.billIds), 'bills rows identical to the pre-run set');
            assert(runSql(`SELECT MD5(CONCAT_WS('|', id, patient_id, status, subtotal, total, balance)) FROM bills WHERE id = 'B-001'`) === baseline.b001, 'seeded bill B-001 unchanged');
            assert(runSql(`SELECT MD5(CONCAT_WS('|', id, patient_id, status, subtotal, total, balance)) FROM bills WHERE id = 'B-002'`) === baseline.b002, 'seeded bill B-002 unchanged');
            assert(parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'labResults'`), 10) === baseline.labSeq, `labResults sequence restored to ${baseline.labSeq}`);
            assert(parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'bills'`), 10) === baseline.billSeq, `bills sequence restored to ${baseline.billSeq}`);
            assert(runSql(`SELECT status FROM patients WHERE id = 'P-002'`) === baseline.p2Status && runSql(`SELECT status FROM users WHERE id = 'U-006'`) === baseline.u6Status,
                'P-002 / U-006 fixtures restored to their original status');
            assert(parseInt(runSql(`SELECT COUNT(*) FROM audit_logs WHERE action = 'Review Lab Result' AND details LIKE '%reviewed lab result ${labId(baseline.labSeq + 1)} (%'`), 10) === 0,
                'review audit rows generated by this run were removed (so reused ids stay repeatable)');
        }
    } finally {
        cleanupTrackedData();
    }

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Unhandled error in lab-results-smoke-test:', err);
    cleanupTrackedData();
    process.exit(1);
});
