/**
 * PrimeCare HIS — Automated Wards, Beds & Admissions Smoke Test
 *
 * Tests api/wards/*.php against live Apache + MariaDB and verifies consistency
 * with api/reports/stats.php, api/reports/generate.php, and api/billing/preview.php.
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
            DELETE FROM admissions WHERE id != 'ADM-001';
            UPDATE sequences SET current_val = 1 WHERE entity_key = 'admissions';
            UPDATE beds SET status = 'Available', current_patient_id = NULL;
            UPDATE patients SET admit_type = 'Outpatient', ward = '', bed_number = '', assigned_doctor_id = 'D-001', date_admitted = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = 'P-001';
            DELETE FROM audit_logs WHERE action IN ('Admit Patient', 'Transfer Patient', 'Discharge Patient', 'Change Bed Status')
                OR (action = 'Generate Report' AND details LIKE '%bed-occupancy%');
        `);
    } catch (e) {
        console.error('Cleanup error:', e.message);
    }
}

async function runTests() {
    console.log('==============================================================');
    console.log('PrimeCare HIS — Wards, Beds & Admissions Smoke Tests');
    console.log('==============================================================\n');
    cleanupTestData();

    const anon = new ClientSession('anon');
    const admin = new ClientSession('admin');
    const nurse = new ClientSession('nurse');
    const doctor = new ClientSession('doctor');
    const staff = new ClientSession('staff');
    const patient = new ClientSession('patient');

    let newAdmId = null;

    try {
        console.log('[1] Authentication, CSRF & RBAC Guards');
        assert((await anon.request('wards/list.php')).status === 401, 'Unauthenticated GET wards/list.php returns 401');
        assert((await anon.request('wards/beds.php')).status === 401, 'Unauthenticated GET wards/beds.php returns 401');
        assert((await anon.request('wards/admissions.php')).status === 401, 'Unauthenticated GET wards/admissions.php returns 401');
        assert((await anon.request('wards/admit.php', { method: 'POST', body: {} })).status === 401, 'Unauthenticated POST wards/admit.php returns 401');

        assert((await admin.login('admin', 'password123')).status === 200, 'Admin logs in');
        assert((await nurse.login('nurse', 'password123')).status === 200, 'Nurse logs in');
        assert((await doctor.login('doctor', 'password123')).status === 200, 'Doctor logs in');
        assert((await staff.login('staff', 'password123')).status === 200, 'Staff logs in');
        assert((await patient.login('patient', 'password123')).status === 200, 'Patient logs in');

        assert((await patient.request('wards/list.php')).status === 403, 'Patient blocked from GET wards/list.php (403)');
        assert((await patient.request('wards/beds.php')).status === 403, 'Patient blocked from GET wards/beds.php (403)');
        assert((await staff.request('wards/admit.php', { method: 'POST', headers: { 'X-CSRF-Token': staff.csrfToken }, body: { patientId: 'P-001', bedId: 'W1-B01', attendingDoctorId: 'D-001' } })).status === 403, 'Staff blocked from admitting patient (403)');
        assert((await doctor.request('wards/admit.php', { method: 'POST', headers: { 'X-CSRF-Token': doctor.csrfToken }, body: { patientId: 'P-001', bedId: 'W1-B01', attendingDoctorId: 'D-001' } })).status === 403, 'Doctor blocked from admitting patient (403)');
        assert((await doctor.request('wards/transfer.php', { method: 'POST', headers: { 'X-CSRF-Token': doctor.csrfToken }, body: { admissionId: 'ADM-001', newBedId: 'W1-B02' } })).status === 403, 'Doctor blocked from transferring patient (403)');
        assert((await doctor.request('wards/bed-status.php', { method: 'POST', headers: { 'X-CSRF-Token': doctor.csrfToken }, body: { bedId: 'W1-B01', status: 'Maintenance' } })).status === 403, 'Doctor blocked from changing bed status (403)');
        assert((await patient.request('wards/discharge.php', { method: 'POST', headers: { 'X-CSRF-Token': patient.csrfToken }, body: { admissionId: 'ADM-001', summary: 'Attempting discharge' } })).status === 403, 'Patient blocked from discharging (403)');

        const missingCsrf = await nurse.request('wards/admit.php', {
            method: 'POST',
            body: { patientId: 'P-001', bedId: 'W1-B01', attendingDoctorId: 'D-001' }
        });
        assert(missingCsrf.status === 403, 'Missing CSRF rejected on wards/admit.php (403)');

        console.log('\n[2] Seeded Baseline Wards, Beds & Patient Admissions');
        const wardsRes = await nurse.request('wards/list.php');
        assert(wardsRes.status === 200 && wardsRes.body?.data?.wards?.length === 5, 'Nurse lists 5 seeded wards');

        const bedsRes = await nurse.request('wards/beds.php');
        assert(bedsRes.status === 200 && bedsRes.body?.data?.beds?.length === 30, 'Nurse lists 30 seeded beds');

        const patAdms = await patient.request('wards/admissions.php');
        assert(patAdms.status === 200 && patAdms.body?.data?.admissions?.length === 1 && patAdms.body.data.admissions[0].id === 'ADM-001', 'Patient P-001 views own seeded admission ADM-001');

        console.log('\n[3] Bed Maintenance Toggle, Admission & Duplicate/Invalid Guards');
        const maintSet = await nurse.request('wards/bed-status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { bedId: 'W1-B06', status: 'Maintenance' }
        });
        assert(maintSet.status === 200 && maintSet.body?.data?.bed?.status === 'Maintenance', 'Nurse marks bed W1-B06 as Maintenance');

        const admitMaint = await nurse.request('wards/admit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { patientId: 'P-001', bedId: 'W1-B06', attendingDoctorId: 'D-002' }
        });
        assert(admitMaint.status === 409, 'Admitting into Maintenance bed rejected (409)');

        const admitPending = await nurse.request('wards/admit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { patientId: 'P-002', bedId: 'W1-B01', attendingDoctorId: 'D-002' }
        });
        assert(admitPending.status === 422, 'Admitting pending unverified patient P-002 rejected (422)');

        const admitOk = await nurse.request('wards/admit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { patientId: 'P-001', bedId: 'W1-B01', attendingDoctorId: 'D-002' }
        });
        newAdmId = admitOk.body?.data?.admission?.id;
        assert(admitOk.status === 201 && Boolean(newAdmId) && admitOk.body.data.admission.status === 'Admitted', `Nurse admits P-001 into W1-B01 (${newAdmId})`);

        const dupAdmit = await admin.request('wards/admit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { patientId: 'P-001', bedId: 'W1-B02', attendingDoctorId: 'D-002' }
        });
        assert(dupAdmit.status === 409, 'Duplicate admission for already-admitted patient P-001 rejected (409)');

        const toggleOcc = await nurse.request('wards/bed-status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { bedId: 'W1-B01', status: 'Maintenance' }
        });
        assert(toggleOcc.status === 409, 'Changing status of occupied bed W1-B01 rejected (409)');

        console.log('\n[4] Patient Transfer & Dashboard / Reports Cross-Module Consistency');
        const transferOk = await nurse.request('wards/transfer.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { admissionId: newAdmId, newBedId: 'W2-B01' }
        });
        assert(transferOk.status === 200 && transferOk.body?.data?.admission?.bedId === 'W2-B01' && transferOk.body.data.admission.dailyRate === 5000, 'Nurse transfers admission to ICU bed W2-B01 (daily rate updated to 5000)');

        const checkBedsAfterTransfer = await nurse.request('wards/beds.php');
        const oldBed = checkBedsAfterTransfer.body?.data?.beds?.find(b => b.id === 'W1-B01');
        const newBed = checkBedsAfterTransfer.body?.data?.beds?.find(b => b.id === 'W2-B01');
        assert(oldBed?.status === 'Available' && oldBed?.currentPatientId === null, 'Old bed W1-B01 freed after transfer');
        assert(newBed?.status === 'Occupied' && newBed?.currentPatientId === 'P-001', 'New bed W2-B01 marked Occupied for P-001');

        const statsCheck = await admin.request('reports/stats.php');
        assert(statsCheck.status === 200 && statsCheck.body?.data?.stats?.admittedInpatients === 1 && statsCheck.body?.data?.stats?.availableBeds === 28, 'Dashboard stats.php reflects 1 admitted inpatient and 28 available beds (1 occupied, 1 maintenance)');

        const today = new Date().toLocaleDateString('en-CA');
        const reportCheck = await admin.request('reports/generate.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { type: 'bed-occupancy', dateFrom: today, dateTo: today }
        });
        assert(
            reportCheck.status === 200
                && reportCheck.body?.data?.summary?.['Overall Occupancy'] === '3%'
                && (reportCheck.body?.data?.rows || []).some(r => r[0] === 'ICU' && r[2] === 1),
            'Reports bed-occupancy matches live database occupancy (3% overall, ICU occupied=1)'
        );

        console.log('\n[5] Discharge Validation & Billing Preview Integration');
        const shortDischarge = await doctor.request('wards/discharge.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { admissionId: newAdmId, summary: 'Too short' }
        });
        assert(shortDischarge.status === 422, 'Discharge with summary < 10 chars rejected (422)');

        const billPreviewBeforeDischarge = await staff.request('billing/preview.php', { params: { patientId: 'P-001' } });
        const hasAdmItem = (billPreviewBeforeDischarge.body?.data?.items || []).some(it => it.sourceType === 'admissions' && it.sourceId === newAdmId);
        assert(billPreviewBeforeDischarge.status === 200 && hasAdmItem, 'Billing preview.php detects unbilled room charges from active admission');

        const dischargeOk = await doctor.request('wards/discharge.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { admissionId: newAdmId, summary: 'Patient recovered well and cleared for home recovery with oral medications.' }
        });
        assert(dischargeOk.status === 200 && dischargeOk.body?.data?.admission?.status === 'Discharged', `Doctor discharges ${newAdmId} with valid summary`);

        const maintClear = await nurse.request('wards/bed-status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { bedId: 'W1-B06', status: 'Available' }
        });
        assert(maintClear.status === 200 && maintClear.body?.data?.bed?.status === 'Available', 'Nurse returns W1-B06 to Available');

        const billPreviewAfterDischarge = await staff.request('billing/preview.php', { params: { patientId: 'P-001' } });
        const roomItemAfter = (billPreviewAfterDischarge.body?.data?.items || []).find(it => it.sourceType === 'admissions' && it.sourceId === newAdmId);
        assert(billPreviewAfterDischarge.status === 200 && Boolean(roomItemAfter) && roomItemAfter.unitPrice === 5000, 'Billing preview.php picks up discharged unbilled room fee at transferred ICU rate (5000)');
    } finally {
        cleanupTestData();
        await anon.logout();
        await admin.logout();
        await nurse.logout();
        await doctor.logout();
        await staff.logout();
        await patient.logout();
    }

    const admCount = runSql('SELECT COUNT(*) FROM admissions;');
    const admSeq = runSql("SELECT current_val FROM sequences WHERE entity_key = 'admissions';");
    const occCount = runSql("SELECT COUNT(*) FROM beds WHERE status != 'Available';");
    assert(admCount === '1' && admSeq === '1' && occCount === '0', `Database restored to exact baseline (1 admission, seq=1, all 30 beds Available)`);

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    cleanupTestData();
    console.error('Unhandled error in wards-smoke-test:', err);
    process.exit(1);
});
