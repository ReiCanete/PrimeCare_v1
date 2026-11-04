/**
 * PrimeCare HIS — Phase 5.9.2 Billing & Payments Backend Smoke Tests
 *
 * Verifies the migration of the Billing & Payments module from localStorage to MariaDB.
 *
 * Run:
 *   node tests/billing-smoke-test.mjs
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

let originalB001Hash = null;
let B001ItemsHash = null;
let originalB002Hash = null;
let originalR0001Hash = null;
let originalBillsSeq = null;
let originalReceiptsSeq = null;

function captureOriginalState() {
    originalB001Hash = runSql(`
        SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(admission_id,''), subtotal, discount_type, discount_amount, IFNULL(insurance_provider,''), insurance_coverage, total, amount_paid, balance, status, IFNULL(void_reason,''), IFNULL(created_by,''), created_at))
        FROM bills WHERE id = 'B-001'
    `);
    B001ItemsHash = runSql(`
        SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', id, bill_id, item_type, description, qty, unit_price, amount, IFNULL(source_type,''), IFNULL(source_id,'')) ORDER BY id))
        FROM bill_items WHERE bill_id = 'B-001'
    `);
    originalB002Hash = runSql(`
        SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(admission_id,''), subtotal, discount_type, discount_amount, IFNULL(insurance_provider,''), insurance_coverage, total, amount_paid, balance, status, IFNULL(void_reason,''), IFNULL(created_by,''), created_at))
        FROM bills WHERE id = 'B-002'
    `);
    originalR0001Hash = runSql(`
        SELECT MD5(CONCAT_WS('|', receipt_no, bill_id, amount, method, IFNULL(reference_no,''), paid_at, received_by))
        FROM payments WHERE receipt_no = 'R-0001'
    `);
    originalBillsSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'bills'`), 10);
    originalReceiptsSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'receipts'`), 10);
}

function cleanupTestData() {
    try {
        runSql(`
            DELETE FROM payment_plan_requests;
            DELETE FROM payments WHERE receipt_no <> 'R-0001';
            DELETE FROM bill_items WHERE bill_id NOT IN ('B-001', 'B-002');
            DELETE FROM bills WHERE id NOT IN ('B-001', 'B-002');
            UPDATE sequences SET current_val = ${originalBillsSeq} WHERE entity_key = 'bills';
            UPDATE sequences SET current_val = ${originalReceiptsSeq} WHERE entity_key = 'receipts';
            UPDATE patients SET status = 'pending' WHERE id = 'P-002';
            UPDATE users SET status = 'pending' WHERE id = 'U-006';
        `);
    } catch (e) {
        console.error('Warning during cleanupTestData:', e.message);
    }
}

async function runTests() {
    console.log('==============================================================');
    console.log('PrimeCare HIS — Phase 5.9.2 Billing & Payments Smoke Tests');
    console.log('==============================================================\n');

    captureOriginalState();
    cleanupTestData();

    // -------------------------------------------------------------
    // [1] Unauthenticated access, method guards & no-delete-endpoint
    // -------------------------------------------------------------
    console.log('[1] Unauthenticated access, method guards & no-delete-endpoint');
    const anon = new ClientSession('anon');

    let res = await anon.request('billing/list.php');
    assert(res.status === 401, 'Unauthenticated GET billing/list.php -> 401');

    res = await anon.request('billing/get.php', { params: { id: 'B-001' } });
    assert(res.status === 401, 'Unauthenticated GET billing/get.php -> 401');

    res = await anon.request('billing/preview.php', { params: { patientId: 'P-001' } });
    assert(res.status === 401, 'Unauthenticated GET billing/preview.php -> 401');

    res = await anon.request('billing/create.php', { method: 'POST', body: {} });
    assert(res.status === 401, 'Unauthenticated POST billing/create.php -> 401');

    res = await anon.request('billing/pay.php', { method: 'POST', body: {} });
    assert(res.status === 401, 'Unauthenticated POST billing/pay.php -> 401');

    res = await anon.request('billing/void.php', { method: 'POST', body: {} });
    assert(res.status === 401, 'Unauthenticated POST billing/void.php -> 401');

    res = await anon.request('billing/receipt.php', { params: { receiptNo: 'R-0001' } });
    assert(res.status === 401, 'Unauthenticated GET billing/receipt.php -> 401');

    res = await anon.request('billing/receipts.php');
    assert(res.status === 401, 'Unauthenticated GET billing/receipts.php -> 401');

    res = await anon.request('billing/summary.php');
    assert(res.status === 401, 'Unauthenticated GET billing/summary.php -> 401');

    res = await anon.request('billing/plan.php', { method: 'POST', body: {} });
    assert(res.status === 401, 'Unauthenticated POST billing/plan.php -> 401');

    // Method guards
    res = await anon.request('billing/create.php', { method: 'GET' });
    assert(res.status === 405, 'GET on POST-only billing/create.php -> 405');

    res = await anon.request('billing/pay.php', { method: 'GET' });
    assert(res.status === 405, 'GET on POST-only billing/pay.php -> 405');

    res = await anon.request('billing/void.php', { method: 'GET' });
    assert(res.status === 405, 'GET on POST-only billing/void.php -> 405');

    res = await anon.request('billing/plan.php', { method: 'GET' });
    assert(res.status === 405, 'GET on POST-only billing/plan.php -> 405');

    res = await anon.request('billing/list.php', { method: 'POST', body: {} });
    assert(res.status === 405, 'POST on GET-only billing/list.php -> 405');

    res = await anon.request('billing/get.php', { method: 'POST', body: {} });
    assert(res.status === 405, 'POST on GET-only billing/get.php -> 405');

    res = await anon.request('billing/summary.php', { method: 'POST', body: {} });
    assert(res.status === 405, 'POST on GET-only billing/summary.php -> 405');

    // Deletion endpoints strictly prohibited
    res = await anon.request('billing/delete.php');
    assert(res.status === 404, 'billing/delete.php does not exist (404 for GET)');

    res = await anon.request('billing/delete.php', { method: 'POST', body: {} });
    assert(res.status === 404, 'billing/delete.php does not exist (404 for POST)');

    // -------------------------------------------------------------
    // [2] Logins and sessions
    // -------------------------------------------------------------
    console.log('\n[2] Logins');
    const admin = new ClientSession('admin');
    res = await admin.login('admin', 'password123');
    assert(res.status === 200 && res.json?.success, 'admin login succeeds');

    const staff = new ClientSession('staff');
    res = await staff.login('staff', 'password123');
    assert(res.status === 200 && res.json?.success, 'staff login succeeds');

    const doctor = new ClientSession('doctor');
    res = await doctor.login('doctor', 'password123');
    assert(res.status === 200 && res.json?.success, 'doctor login succeeds');

    const nurse = new ClientSession('nurse');
    res = await nurse.login('nurse', 'password123');
    assert(res.status === 200 && res.json?.success, 'nurse login succeeds');

    const patient1 = new ClientSession('patient1');
    res = await patient1.login('patient', 'password123');
    assert(res.status === 200 && res.json?.success, 'patient (P-001) login succeeds');

    // Temporarily activate patient2 for IDOR test
    runSql(`UPDATE patients SET status = 'verified' WHERE id = 'P-002'; UPDATE users SET status = 'active' WHERE id = 'U-006';`);
    const patient2 = new ClientSession('patient2');
    res = await patient2.login('patient2', 'password123');
    assert(res.status === 200 && res.json?.success, 'patient2 (P-002) login succeeds');
    // Restore pending status for patient2 validation test
    runSql(`UPDATE patients SET status = 'pending' WHERE id = 'P-002';`);

    // -------------------------------------------------------------
    // [3] CSRF enforcement on mutating endpoints
    // -------------------------------------------------------------
    console.log('\n[3] CSRF enforcement on mutating endpoints');
    res = await admin.request('billing/create.php', { method: 'POST', body: {} });
    assert(res.status === 403, 'POST create.php without CSRF token -> 403');

    res = await admin.request('billing/create.php', { method: 'POST', headers: { 'X-CSRF-Token': 'bogus' }, body: {} });
    assert(res.status === 403, 'POST create.php with invalid CSRF token -> 403');

    res = await admin.request('billing/pay.php', { method: 'POST', body: {} });
    assert(res.status === 403, 'POST pay.php without CSRF token -> 403');

    res = await admin.request('billing/pay.php', { method: 'POST', headers: { 'X-CSRF-Token': 'bogus' }, body: {} });
    assert(res.status === 403, 'POST pay.php with invalid CSRF token -> 403');

    res = await admin.request('billing/void.php', { method: 'POST', body: {} });
    assert(res.status === 403, 'POST void.php without CSRF token -> 403');

    res = await admin.request('billing/void.php', { method: 'POST', headers: { 'X-CSRF-Token': 'bogus' }, body: {} });
    assert(res.status === 403, 'POST void.php with invalid CSRF token -> 403');

    res = await patient1.request('billing/plan.php', { method: 'POST', body: {} });
    assert(res.status === 403, 'POST plan.php without CSRF token -> 403');

    res = await patient1.request('billing/plan.php', { method: 'POST', headers: { 'X-CSRF-Token': 'bogus' }, body: {} });
    assert(res.status === 403, 'POST plan.php with invalid CSRF token -> 403');

    // -------------------------------------------------------------
    // [4] Baseline reads, projections & seeded records
    // -------------------------------------------------------------
    console.log('\n[4] Baseline reads, projections & seeded records (B-001, B-002, R-0001)');
    res = await admin.request('billing/list.php');
    assert(res.status === 200 && Array.isArray(res.json?.data?.bills), 'admin list returns 200');
    const billsList = res.json?.data?.bills || [];
    assert(billsList.length >= 2, 'admin list returns seeded bills');

    const b001 = billsList.find(b => b.id === 'B-001');
    assert(b001 !== undefined, 'B-001 present in list');
    assert(b001?.patientId === 'P-001', 'B-001 patientId is P-001');
    assert(b001?.patientName === 'Juan Dela Cruz', 'B-001 joins patientName "Juan Dela Cruz"');
    assert(b001?.subtotal === 1750, 'B-001 subtotal is 1750');
    assert(b001?.insuranceCoverage === 500, 'B-001 insuranceCoverage is 500');
    assert(b001?.total === 1250, 'B-001 total is 1250');
    assert(b001?.amountPaid === 1250, 'B-001 amountPaid is 1250');
    assert(b001?.balance === 0, 'B-001 balance is 0');
    assert(b001?.status === 'Paid', 'B-001 status is Paid');
    assert(Array.isArray(b001?.items) && b001.items.length === 3, 'B-001 contains 3 line items');
    assert(Array.isArray(b001?.payments) && b001.payments.length === 1, 'B-001 contains 1 payment record');

    // Single bill GET
    res = await staff.request('billing/get.php', { params: { id: 'B-001' } });
    assert(res.status === 200 && res.json?.data?.bill?.id === 'B-001', 'staff GET billing/get.php?id=B-001 -> 200');

    // Seeded B-002 check
    res = await staff.request('billing/get.php', { params: { id: 'B-002' } });
    assert(res.status === 200, 'staff GET B-002 -> 200');
    const b002 = res.json?.data?.bill;
    assert(b002?.total === 800 && b002?.balance === 800 && b002?.status === 'Unpaid', 'B-002 is Unpaid with 800 balance');
    assert(b002?.items?.length === 1 && b002.items[0].description === 'Lipid Profile', 'B-002 item is Lipid Profile');

    // Receipt lookup
    res = await staff.request('billing/receipt.php', { params: { receiptNo: 'R-0001' } });
    assert(res.status === 200 && res.json?.data?.receipt?.receiptNo === 'R-0001', 'staff GET receipt R-0001 -> 200');
    assert(res.json?.data?.receipt?.amount === 1250, 'R-0001 amount is 1250');
    assert(res.json?.data?.receipt?.method === 'Cash', 'R-0001 method is Cash');
    assert(res.json?.data?.bill?.id === 'B-001', 'R-0001 linked to bill B-001');

    // Billing summary
    res = await staff.request('billing/summary.php');
    assert(res.status === 200, 'staff GET billing/summary.php -> 200');
    const summary = res.json?.data;
    assert(summary?.unpaidTotal >= 800, 'summary unpaidTotal >= 800');
    assert(summary?.countPaid >= 1, 'summary countPaid >= 1');
    assert(summary?.countUnpaid >= 1, 'summary countUnpaid >= 1');

    // -------------------------------------------------------------
    // [5] RBAC Enforcement (Clinical Role Isolation)
    // -------------------------------------------------------------
    console.log('\n[5] RBAC & Clinical Role Isolation');
    res = await doctor.request('billing/list.php');
    assert(res.status === 403, 'Doctor GET billing/list.php -> 403 Forbidden');

    res = await doctor.request('billing/get.php', { params: { id: 'B-001' } });
    assert(res.status === 403, 'Doctor GET billing/get.php -> 403 Forbidden');

    res = await doctor.request('billing/preview.php', { params: { patientId: 'P-001' } });
    assert(res.status === 403, 'Doctor GET billing/preview.php -> 403 Forbidden');

    res = await doctor.request('billing/summary.php');
    assert(res.status === 403, 'Doctor GET billing/summary.php -> 403 Forbidden');

    res = await doctor.request('billing/create.php', { method: 'POST', headers: { 'X-CSRF-Token': doctor.csrfToken }, body: {} });
    assert(res.status === 403, 'Doctor POST billing/create.php -> 403 Forbidden');

    res = await doctor.request('billing/pay.php', { method: 'POST', headers: { 'X-CSRF-Token': doctor.csrfToken }, body: {} });
    assert(res.status === 403, 'Doctor POST billing/pay.php -> 403 Forbidden');

    res = await doctor.request('billing/void.php', { method: 'POST', headers: { 'X-CSRF-Token': doctor.csrfToken }, body: {} });
    assert(res.status === 403, 'Doctor POST billing/void.php -> 403 Forbidden');

    res = await doctor.request('billing/plan.php', { method: 'POST', headers: { 'X-CSRF-Token': doctor.csrfToken }, body: {} });
    assert(res.status === 403, 'Doctor POST billing/plan.php -> 403 Forbidden');

    res = await nurse.request('billing/list.php');
    assert(res.status === 403, 'Nurse GET billing/list.php -> 403 Forbidden');

    res = await nurse.request('billing/summary.php');
    assert(res.status === 403, 'Nurse GET billing/summary.php -> 403 Forbidden');

    // Staff cannot void bills
    res = await staff.request('billing/void.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { id: 'B-002', reason: 'Void attempt by staff' }
    });
    assert(res.status === 403, 'Staff cannot void bills -> 403 Forbidden');

    // Patient cannot preview or create bills
    res = await patient1.request('billing/preview.php', { params: { patientId: 'P-001' } });
    assert(res.status === 403, 'Patient cannot access charge preview -> 403 Forbidden');

    res = await patient1.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient1.csrfToken },
        body: { patientId: 'P-001', items: [{ description: 'Test', qty: 1, unitPrice: 100 }] }
    });
    assert(res.status === 403, 'Patient cannot create bills -> 403 Forbidden');

    res = await patient1.request('billing/summary.php');
    assert(res.status === 403, 'Patient cannot view billing summary -> 403 Forbidden');

    // -------------------------------------------------------------
    // [6] Patient Ownership & IDOR Protection
    // -------------------------------------------------------------
    console.log('\n[6] Patient Ownership & IDOR Protection');
    res = await patient1.request('billing/get.php', { params: { id: 'B-001' } });
    assert(res.status === 200, 'Patient P-001 reads own bill B-001 -> 200');

    res = await patient1.request('billing/list.php', { params: { my: 1 } });
    assert(res.status === 200 && res.json?.data?.bills?.every(b => b.patientId === 'P-001'), 'Patient P-001 list.php?my=1 returns only P-001 bills');

    res = await patient1.request('billing/receipt.php', { params: { receiptNo: 'R-0001' } });
    assert(res.status === 200, 'Patient P-001 reads own receipt R-0001 -> 200');

    // Patient 2 IDOR attacks against Patient 1
    res = await patient2.request('billing/get.php', { params: { id: 'B-001' } });
    assert(res.status === 403, 'Patient 2 GET B-001 is BLOCKED (403 IDOR)');

    res = await patient2.request('billing/list.php', { params: { patientId: 'P-001' } });
    assert(res.status === 200 && res.json?.data?.bills?.length === 0, 'Patient 2 querying patientId=P-001 scoped strictly to P-002 (0 rows returned)');

    res = await patient2.request('billing/receipt.php', { params: { receiptNo: 'R-0001' } });
    assert(res.status === 403, 'Patient 2 reading R-0001 is BLOCKED (403 IDOR)');

    res = await patient2.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient2.csrfToken },
        body: { billId: 'B-002', amount: 100, method: 'Cash' }
    });
    assert(res.status === 403, 'Patient 2 paying P-001 bill B-002 is BLOCKED (403 IDOR)');

    res = await patient2.request('billing/plan.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient2.csrfToken },
        body: { billId: 'B-002', months: 6, reason: 'Payment plan request for B-002' }
    });
    assert(res.status === 403, 'Patient 2 requesting payment plan for P-001 bill is BLOCKED (403 IDOR)');

    // -------------------------------------------------------------
    // [7] Financial Calculations & Validation Engine
    // -------------------------------------------------------------
    console.log('\n[7] Financial Calculations & Validation Engine');
    // Validation failures
    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { items: [{ description: 'Item', qty: 1, unitPrice: 100 }] }
    });
    assert(res.status === 400, 'Missing patientId rejected -> 400');

    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { patientId: 'P-999', items: [{ description: 'Item', qty: 1, unitPrice: 100 }] }
    });
    assert(res.status === 404, 'Non-existent patientId rejected -> 404');

    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { patientId: 'P-002', items: [{ description: 'Item', qty: 1, unitPrice: 100 }] }
    });
    assert(res.status === 400, 'Unverified patient P-002 rejected -> 400');

    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { patientId: 'P-001', items: [] }
    });
    assert(res.status === 400, 'Empty items array rejected -> 400');

    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { patientId: 'P-001', items: [{ description: 'Item', qty: -1, unitPrice: 100 }] }
    });
    assert(res.status === 400, 'Negative quantity rejected -> 400');

    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { patientId: 'P-001', items: [{ description: 'Item', qty: 1, unitPrice: -50 }] }
    });
    assert(res.status === 400, 'Negative unit price rejected -> 400');

    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { patientId: 'P-001', items: [{ description: '', qty: 1, unitPrice: 100 }] }
    });
    assert(res.status === 400, 'Blank description rejected -> 400');

    // Statutory Senior Citizen 20% Discount
    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: {
            patientId: 'P-001',
            discountType: 'Senior Citizen',
            items: [
                { description: 'Specialist Consultation', qty: 1, unitPrice: 1000.00, type: 'Professional Fee' }
            ]
        }
    });
    assert(res.status === 201, 'Senior Citizen bill created (201)');
    let bill = res.json?.data?.bill;
    assert(bill?.subtotal === 1000, 'Subtotal is 1000.00');
    assert(bill?.discountType === 'Senior Citizen', 'Discount type is Senior Citizen');
    assert(bill?.discountAmount === 200, 'Discount amount is 200.00 (20%)');
    assert(bill?.total === 800, 'Total due is 800.00');
    assert(bill?.balance === 800, 'Balance is 800.00');
    const billB003 = bill?.id;

    // Combined Discount + Insurance
    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: {
            patientId: 'P-001',
            discountType: 'PWD',
            insuranceProvider: 'PhilHealth',
            insuranceCoverage: 300.00,
            items: [
                { description: 'Inpatient Room Charge', qty: 2, unitPrice: 500.00, type: 'Room' }
            ]
        }
    });
    assert(res.status === 201, 'PWD + PhilHealth bill created (201)');
    bill = res.json?.data?.bill;
    assert(bill?.subtotal === 1000, 'Subtotal is 1000.00');
    assert(bill?.discountAmount === 200, 'PWD discount is 200.00');
    assert(bill?.insuranceCoverage === 300, 'Insurance deduction is 300.00');
    assert(bill?.total === 500, 'Total is 500.00 (1000 - 200 - 300)');
    assert(bill?.balance === 500, 'Balance is 500.00');
    const billB004 = bill?.id;

    // Insurance capped at after-discount subtotal
    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: {
            patientId: 'P-001',
            discountType: 'None',
            insuranceProvider: 'MaxiCare',
            insuranceCoverage: 9999.00,
            items: [
                { description: 'Routine Checkup', qty: 1, unitPrice: 400.00, type: 'Professional Fee' }
            ]
        }
    });
    assert(res.status === 201, 'Capped insurance bill created (201)');
    bill = res.json?.data?.bill;
    assert(bill?.insuranceCoverage === 400, 'Insurance capped at 400.00 (cannot exceed net subtotal)');
    assert(bill?.total === 0, 'Total is 0.00');
    assert(bill?.balance === 0, 'Balance is 0.00');
    const billB005 = bill?.id;

    // -------------------------------------------------------------
    // [8] Charge Preview & Anti-Double-Billing Concurrency
    // -------------------------------------------------------------
    console.log('\n[8] Charge Preview & Anti-Double-Billing Concurrency');
    res = await staff.request('billing/preview.php', { params: { patientId: 'P-001' } });
    assert(res.status === 200 && Array.isArray(res.json?.data?.items), 'Charge preview returns 200 with items array');

    // Verify already-billed records (A-001, RX-001, LAB-001) are NOT in the preview
    const previewItems = res.json?.data?.items || [];
    assert(!previewItems.some(i => i.sourceId === 'A-001'), 'Already-billed appointment A-001 excluded from preview');
    assert(!previewItems.some(i => i.sourceId === 'RX-001'), 'Already-billed prescription RX-001 excluded from preview');

    // Create an unbilled appointment for P-001 to test source linking and double-billing prevention
    runSql(`
        INSERT INTO appointments (id, patient_id, doctor_id, appointment_date, appointment_time, type, status, reason, billed, bill_id, created_at, updated_at)
        VALUES ('A-999', 'P-001', 'D-001', CURDATE(), '10:00:00', 'in-person', 'Completed', 'Double billing probe test', 0, NULL, NOW(), NOW())
    `);

    // Charge preview should now contain A-999
    res = await staff.request('billing/preview.php', { params: { patientId: 'P-001' } });
    const hasA999 = (res.json?.data?.items || []).some(i => i.sourceId === 'A-999');
    assert(hasA999, 'Preview includes unbilled completed appointment A-999');

    // Bill appointment A-999
    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: {
            patientId: 'P-001',
            items: [
                { description: 'Consultation - Dr. Jose Rizal', qty: 1, unitPrice: 1000.00, type: 'Professional Fee', sourceType: 'appointments', sourceId: 'A-999' }
            ]
        }
    });
    assert(res.status === 201, 'Bill created linking A-999 (201)');
    const billB006 = res.json?.data?.bill?.id;

    // Verify A-999 is now marked billed = 1 and bill_id in MariaDB
    const a999State = runSql(`SELECT CONCAT_WS('|', billed, bill_id) FROM appointments WHERE id = 'A-999'`);
    assert(a999State === `1|${billB006}`, 'Appointment A-999 is flagged billed=1 and linked to bill ID');

    // Attempting to bill A-999 a second time must be REJECTED (409 Conflict)
    res = await staff.request('billing/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: {
            patientId: 'P-001',
            items: [
                { description: 'Duplicate Consultation', qty: 1, unitPrice: 1000.00, type: 'Professional Fee', sourceType: 'appointments', sourceId: 'A-999' }
            ]
        }
    });
    assert(res.status === 409, 'Duplicate billing of A-999 REJECTED with 409 Conflict');

    // -------------------------------------------------------------
    // [9] Payments & Cashiering
    // -------------------------------------------------------------
    console.log('\n[9] Payments & Cashiering');
    // Validation
    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB003, amount: -100, method: 'Cash' }
    });
    assert(res.status === 400, 'Negative payment rejected -> 400');

    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB003, amount: 0, method: 'Cash' }
    });
    assert(res.status === 400, 'Zero payment rejected -> 400');

    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB003, amount: 99999, method: 'Cash' }
    });
    assert(res.status === 400, 'Overpayment exceeding balance rejected -> 400');

    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB003, amount: 100, method: 'CryptoCurrency' }
    });
    assert(res.status === 400, 'Invalid payment method rejected -> 400');

    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB003, amount: 100, method: 'Credit/Debit Card', reference: '' }
    });
    assert(res.status === 400, 'Card payment without reference rejected -> 400');

    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB003, amount: 100, method: 'GCash', reference: '' }
    });
    assert(res.status === 400, 'GCash payment without reference rejected -> 400');

    // Partial payment on B-003 (Balance 800)
    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB003, amount: 300, method: 'Cash' }
    });
    assert(res.status === 200, 'Partial cash payment accepted (200)');
    let payData = res.json?.data;
    assert(payData?.receipt?.receiptNo?.startsWith('R-'), 'Receipt number allocated with R- prefix');
    assert(payData?.bill?.amountPaid === 300, 'Bill amountPaid is 300.00');
    assert(payData?.bill?.balance === 500, 'Bill balance is 500.00');
    assert(payData?.bill?.status === 'Partial', 'Bill status is Partial');
    const firstReceiptNo = payData?.receipt?.receiptNo;

    // Patient simulated online payment on remainder of B-003 (500)
    res = await patient1.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient1.csrfToken },
        body: { billId: billB003, amount: 500, method: 'Credit/Debit Card', reference: 'CARD-****1234' }
    });
    assert(res.status === 200, 'Patient full online card payment accepted (200)');
    payData = res.json?.data;
    assert(payData?.receipt?.receivedBy === 'Online Payment', 'Patient payment receivedBy is "Online Payment"');
    assert(payData?.bill?.amountPaid === 800, 'Bill amountPaid is now 800.00');
    assert(payData?.bill?.balance === 0, 'Bill balance is now 0.00');
    assert(payData?.bill?.status === 'Paid', 'Bill status transitioned to Paid');

    // Paying a fully paid bill must be REJECTED (400)
    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB003, amount: 50, method: 'Cash' }
    });
    assert(res.status === 400, 'Payment on already fully paid bill rejected -> 400');

    // -------------------------------------------------------------
    // [10] Administrative Void Workflow
    // -------------------------------------------------------------
    console.log('\n[10] Administrative Void Workflow');
    // Cannot void bill with payment history (B-003 has 2 payments)
    res = await admin.request('billing/void.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: billB003, reason: 'Accidental charge made by staff' }
    });
    assert(res.status === 400, 'Attempt to void bill with payments rejected -> 400');

    // Reason length check (< 10 chars)
    res = await admin.request('billing/void.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: billB006, reason: 'Short' }
    });
    assert(res.status === 400, 'Void reason < 10 characters rejected -> 400');

    // Valid void on B-006 (unpaid, links appointment A-999)
    res = await admin.request('billing/void.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: billB006, reason: 'Billing entry created in error for test' }
    });
    assert(res.status === 200, 'Admin successfully voided unpaid bill B-006 (200)');

    // Verify B-006 status is Voided
    res = await admin.request('billing/get.php', { params: { id: billB006 } });
    assert(res.json?.data?.bill?.status === 'Voided', 'B-006 status is now Voided');
    assert(res.json?.data?.bill?.voidReason === 'Billing entry created in error for test', 'B-006 voidReason stored correctly');

    // Verify linked appointment A-999 was REVERTED to billed = 0 and bill_id = NULL
    const a999Reverted = runSql(`SELECT CONCAT_WS('|', billed, IFNULL(bill_id, 'NULL')) FROM appointments WHERE id = 'A-999'`);
    assert(a999Reverted === '0|NULL', 'Appointment A-999 unflagged back to billed=0, bill_id=NULL');

    // Verify cannot pay voided bill
    res = await staff.request('billing/pay.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { billId: billB006, amount: 100, method: 'Cash' }
    });
    assert(res.status === 400, 'Payment on voided bill rejected -> 400');

    // Clean up temporary appointment A-999
    runSql(`DELETE FROM appointments WHERE id = 'A-999';`);

    // -------------------------------------------------------------
    // [11] Payment Plan Requests
    // -------------------------------------------------------------
    console.log('\n[11] Payment Plan Requests');
    // Admin/Staff cannot submit payment plan
    res = await admin.request('billing/plan.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { billId: 'B-002', months: 6, reason: 'Admin attempt to submit plan' }
    });
    assert(res.status === 403, 'Admin cannot submit payment plan -> 403');

    // Validation: months < 2
    res = await patient1.request('billing/plan.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient1.csrfToken },
        body: { billId: 'B-002', months: 1, reason: 'Valid reason exceeding ten characters' }
    });
    assert(res.status === 400, 'Plan months < 2 rejected -> 400');

    // Validation: months > 12
    res = await patient1.request('billing/plan.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient1.csrfToken },
        body: { billId: 'B-002', months: 13, reason: 'Valid reason exceeding ten characters' }
    });
    assert(res.status === 400, 'Plan months > 12 rejected -> 400');

    // Validation: reason < 10 characters
    res = await patient1.request('billing/plan.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient1.csrfToken },
        body: { billId: 'B-002', months: 6, reason: 'Short' }
    });
    assert(res.status === 400, 'Plan reason < 10 characters rejected -> 400');

    // Validation: paid bill (B-001) cannot have payment plan
    res = await patient1.request('billing/plan.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient1.csrfToken },
        body: { billId: 'B-001', months: 6, reason: 'Attempt on fully paid bill B-001' }
    });
    assert(res.status === 400, 'Payment plan on paid bill B-001 rejected -> 400');

    // Valid plan request on B-002
    res = await patient1.request('billing/plan.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient1.csrfToken },
        body: { billId: 'B-002', months: 6, reason: 'Need monthly installments for surgery copay' }
    });
    assert(res.status === 201, 'Patient payment plan request submitted (201)');
    assert(res.json?.data?.plan?.status === 'Pending', 'Plan status is Pending');
    assert(res.json?.data?.plan?.months === 6, 'Plan months is 6');

    // Duplicate pending plan request for same bill must be REJECTED (400)
    res = await patient1.request('billing/plan.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient1.csrfToken },
        body: { billId: 'B-002', months: 3, reason: 'Duplicate payment plan request for same bill' }
    });
    assert(res.status === 400, 'Duplicate pending plan request rejected -> 400');

    // -------------------------------------------------------------
    // [12] Transaction Rollback Verification
    // -------------------------------------------------------------
    console.log('\n[12] Transaction Rollback Verification');
    const probeOutput = execFileSync(PHP_BIN, [path.join(PROJECT_ROOT, 'tests', 'billing-rollback-probe.php')], { encoding: 'utf8' }).trim();
    let probe = null;
    try { probe = JSON.parse(probeOutput); } catch (e) { /* parse err */ }
    assert(probe?.threw === true, 'Rollback probe threw an exception as expected');
    assert(probe?.inTransaction === false, 'Rollback probe left no transaction open');
    assert(probe?.billsUnchanged === true, 'bills count unchanged after rollback');
    assert(probe?.itemsUnchanged === true, 'bill_items count unchanged after rollback');

    // -------------------------------------------------------------
    // [13] Data Integrity & Seed Preservation
    // -------------------------------------------------------------
    console.log('\n[13] Data Integrity & Seed Preservation');
    cleanupTestData();

    const finalB001Hash = runSql(`
        SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(admission_id,''), subtotal, discount_type, discount_amount, IFNULL(insurance_provider,''), insurance_coverage, total, amount_paid, balance, status, IFNULL(void_reason,''), IFNULL(created_by,''), created_at))
        FROM bills WHERE id = 'B-001'
    `);
    assert(finalB001Hash === originalB001Hash, 'Seeded bill B-001 is byte-for-byte unchanged');

    const finalB001ItemsHash = runSql(`
        SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', id, bill_id, item_type, description, qty, unit_price, amount, IFNULL(source_type,''), IFNULL(source_id,'')) ORDER BY id))
        FROM bill_items WHERE bill_id = 'B-001'
    `);
    assert(finalB001ItemsHash === B001ItemsHash, 'Seeded B-001 items are byte-for-byte unchanged');

    const finalB002Hash = runSql(`
        SELECT MD5(CONCAT_WS('|', id, patient_id, IFNULL(admission_id,''), subtotal, discount_type, discount_amount, IFNULL(insurance_provider,''), insurance_coverage, total, amount_paid, balance, status, IFNULL(void_reason,''), IFNULL(created_by,''), created_at))
        FROM bills WHERE id = 'B-002'
    `);
    assert(finalB002Hash === originalB002Hash, 'Seeded bill B-002 is byte-for-byte unchanged');

    const finalR0001Hash = runSql(`
        SELECT MD5(CONCAT_WS('|', receipt_no, bill_id, amount, method, IFNULL(reference_no,''), paid_at, received_by))
        FROM payments WHERE receipt_no = 'R-0001'
    `);
    assert(finalR0001Hash === originalR0001Hash, 'Seeded receipt R-0001 is byte-for-byte unchanged');

    const finalBillsSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'bills'`), 10);
    assert(finalBillsSeq === originalBillsSeq, `bills sequence restored to ${originalBillsSeq}`);

    const finalReceiptsSeq = parseInt(runSql(`SELECT current_val FROM sequences WHERE entity_key = 'receipts'`), 10);
    assert(finalReceiptsSeq === originalReceiptsSeq, `receipts sequence restored to ${originalReceiptsSeq}`);

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Unhandled error in billing-smoke-test:', err);
    process.exit(1);
});
