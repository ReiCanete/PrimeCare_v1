/**
 * PrimeCare HIS — Phase 5.6.2 Automated Appointment Management & Online Booking Smoke Test
 *
 * Tests all Phase 5.6.2 PHP endpoints against live Apache + MariaDB:
 *   - api/appointments/slots.php
 *   - api/appointments/list.php
 *   - api/appointments/get.php
 *   - api/appointments/create.php
 *   - api/appointments/reschedule.php
 *   - api/appointments/status.php
 *   - api/appointments/pre-visit.php
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

function formatDateLocal(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getNextWeekday(targetDayIndex, minDaysAhead = 3) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + minDaysAhead);
    while (d.getDay() !== targetDayIndex) {
        d.setDate(d.getDate() + 1);
    }
    return formatDateLocal(d);
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

function cleanupTestData() {
    try {
        runSql(`
            DELETE FROM pre_visit_forms WHERE appointment_id NOT IN ('A-001', 'A-002');
            DELETE FROM appointments WHERE id NOT IN ('A-001', 'A-002');
            UPDATE sequences SET current_val = 2 WHERE entity_key = 'appointments';
            UPDATE doctors SET status = 'active' WHERE id = 'D-005';
            UPDATE users SET status = 'pending', last_login = NULL WHERE id = 'U-006';
            UPDATE patients SET status = 'pending' WHERE id = 'P-002';
        `);
    } catch (e) {
        console.error('Warning during cleanupTestData:', e.message);
    }
}

async function runTests() {
    console.log('==============================================================');
    console.log('PrimeCare HIS — Phase 5.6.2 Appointment & Booking Smoke Tests');
    console.log('==============================================================\n');

    cleanupTestData();

    const anon = new ClientSession('anonymous');
    const admin = new ClientSession('admin');
    const staff = new ClientSession('staff');
    const doctor = new ClientSession('doctor');
    const nurse = new ClientSession('nurse');
    const patient = new ClientSession('patient');
    const patient2 = new ClientSession('patient2');

    const nextMon = getNextWeekday(1, 5); // Monday >= 5 days out
    const nextTue = getNextWeekday(2, 5); // Tuesday >= 5 days out
    const nextWed = getNextWeekday(3, 5); // Wednesday >= 5 days out
    const nextThu = getNextWeekday(4, 5); // Thursday >= 5 days out
    const nextFri = getNextWeekday(5, 5); // Friday >= 5 days out
    const nextSun = getNextWeekday(0, 3); // Sunday (D-003, D-004, D-005 off day)
    const farMon = getNextWeekday(1, 70); // Monday > 60 days out

    try {
        // ------------------------------------------------------------------
        // 1. Unauthenticated (401) & Method Enforcement (405)
        // ------------------------------------------------------------------
        console.log('[1] Unauthenticated Access & HTTP Method Guards');

        const unauthSlots = await anon.request('appointments/slots.php', { params: { doctorId: 'D-001', date: nextMon } });
        assert(unauthSlots.status === 401, 'Unauthenticated GET appointments/slots.php returns 401');

        const unauthList = await anon.request('appointments/list.php');
        assert(unauthList.status === 401, 'Unauthenticated GET appointments/list.php returns 401');

        const unauthGet = await anon.request('appointments/get.php', { params: { id: 'A-001' } });
        assert(unauthGet.status === 401, 'Unauthenticated GET appointments/get.php returns 401');

        const unauthCreate = await anon.request('appointments/create.php', { method: 'POST', body: {} });
        assert(unauthCreate.status === 401, 'Unauthenticated POST appointments/create.php returns 401');

        const unauthResched = await anon.request('appointments/reschedule.php', { method: 'POST', body: {} });
        assert(unauthResched.status === 401, 'Unauthenticated POST appointments/reschedule.php returns 401');

        const unauthStatus = await anon.request('appointments/status.php', { method: 'POST', body: {} });
        assert(unauthStatus.status === 401, 'Unauthenticated POST appointments/status.php returns 401');

        const unauthPreVisit = await anon.request('appointments/pre-visit.php', { params: { appointmentId: 'A-002' } });
        assert(unauthPreVisit.status === 401, 'Unauthenticated GET appointments/pre-visit.php returns 401');

        const wrongMethodCreate = await anon.request('appointments/create.php', { method: 'GET' });
        assert(wrongMethodCreate.status === 405, 'GET on POST-only appointments/create.php returns 405');

        // ------------------------------------------------------------------
        // 2. Authenticate Sessions & Verify Seeded Baseline
        // ------------------------------------------------------------------
        console.log('\n[2] Session Login & Seeded Baseline Verification');

        const adminLogin = await admin.login('admin', 'password123');
        assert(adminLogin.status === 200 && adminLogin.body?.success === true, 'Admin login succeeds');

        const staffLogin = await staff.login('staff', 'password123');
        assert(staffLogin.status === 200 && staffLogin.body?.success === true, 'Staff login succeeds');

        const docLogin = await doctor.login('doctor', 'password123');
        assert(docLogin.status === 200 && docLogin.body?.success === true, 'Doctor (D-001) login succeeds');

        const nurseLogin = await nurse.login('nurse', 'password123');
        assert(nurseLogin.status === 200 && nurseLogin.body?.success === true, 'Nurse login succeeds');

        const patLogin = await patient.login('patient', 'password123');
        assert(patLogin.status === 200 && patLogin.body?.success === true, 'Verified patient (P-001) login succeeds');

        // Temporarily enable U-006 (patient2) user login while keeping P-002 patient status = 'pending'
        // so we can test defense-in-depth unverified patient booking rejection + cross-patient IDOR
        runSql("UPDATE users SET status = 'active' WHERE id = 'U-006';");
        const pat2Login = await patient2.login('patient2', 'password123');
        assert(pat2Login.status === 200 && pat2Login.body?.success === true, 'Second patient session (U-006 / P-002) login succeeds');

        const seededList = await admin.request('appointments/list.php');
        const seededAppts = seededList.body?.data?.appointments || [];
        assert(
            seededList.status === 200 && seededAppts.length === 2,
            `GET appointments/list.php returns 2 seeded appointments (got ${seededAppts.length})`
        );

        const a001 = seededAppts.find(a => a.id === 'A-001');
        const a002 = seededAppts.find(a => a.id === 'A-002');
        assert(
            a001 && a001.patientId === 'P-001' && a001.doctorId === 'D-001' && a001.time === '09:00' && a001.status === 'Completed' && a001.billed === true,
            'Seeded A-001 serialized with HH:MM time (09:00), status=Completed, billed=true'
        );
        assert(
            a002 && a002.patientId === 'P-001' && a002.doctorId === 'D-002' && a002.time === '10:00' && a002.type === 'telehealth' && a002.status === 'Confirmed',
            'Seeded A-002 serialized with HH:MM time (10:00), type=telehealth, status=Confirmed'
        );

        // ------------------------------------------------------------------
        // 3. CSRF & RBAC Enforcement
        // ------------------------------------------------------------------
        console.log('\n[3] CSRF & Role-Based Access Control (RBAC)');

        const noCsrfCreate = await staff.request('appointments/create.php', {
            method: 'POST',
            body: { patientId: 'P-001', doctorId: 'D-001', date: nextMon, time: '09:00', type: 'in-person', reason: 'Routine consultation' }
        });
        assert(noCsrfCreate.status === 403, 'POST appointments/create.php without CSRF token returns 403');

        const nurseCreate = await nurse.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { patientId: 'P-001', doctorId: 'D-001', date: nextMon, time: '09:00', type: 'in-person', reason: 'Nurse booking attempt' }
        });
        assert(nurseCreate.status === 403, 'Nurse is forbidden from creating appointments (403)');

        const docCreate = await doctor.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { patientId: 'P-001', doctorId: 'D-001', date: nextMon, time: '09:00', type: 'in-person', reason: 'Doctor booking attempt' }
        });
        assert(docCreate.status === 403, 'Doctor is forbidden from creating appointments (403)');

        const nurseStatus = await nurse.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': nurse.csrfToken },
            body: { id: 'A-002', status: 'Cancelled', cancelReason: 'Nurse cancel attempt' }
        });
        assert(nurseStatus.status === 403, 'Nurse is forbidden from updating appointment status (403)');

        const staffPreVisitPost = await staff.request('appointments/pre-visit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { appointmentId: 'A-002', symptoms: 'Headache and fever', consent: true }
        });
        assert(staffPreVisitPost.status === 403, 'Staff is forbidden from submitting pre-visit forms (patient-only POST, 403)');

        // ------------------------------------------------------------------
        // 4. Doctor Availability & Slot Generation (slots.php)
        // ------------------------------------------------------------------
        console.log('\n[4] Doctor Availability & Slot Generation (api/appointments/slots.php)');

        // D-001 works Mon-Sun 09:00-17:00 (30 min slots = 16 slots from 09:00 to 16:30)
        const d001MonSlots = await patient.request('appointments/slots.php', {
            params: { doctorId: 'D-001', date: nextMon }
        });
        const slotsArr = d001MonSlots.body?.data?.slots || [];
        assert(
            d001MonSlots.status === 200 && slotsArr.length === 16 && slotsArr[0].time === '09:00' && slotsArr[15].time === '16:30' && slotsArr.every(s => s.available === true),
            `D-001 on future Monday (${nextMon}) has 16 available 30-min slots (09:00 to 16:30)`
        );

        // D-003 (Pediatrics, Mon-Fri 10:00-15:00) is off on Sunday
        const d003SunSlots = await patient.request('appointments/slots.php', {
            params: { doctorId: 'D-003', date: nextSun }
        });
        assert(
            d003SunSlots.status === 200 && d003SunSlots.body?.data?.slots?.length === 0,
            `D-003 on Sunday (${nextSun}) returns 0 slots (off day)`
        );

        // D-002 on 2026-11-04 (has seeded A-002 at 10:00)
        const d002WedSlots = await staff.request('appointments/slots.php', {
            params: { doctorId: 'D-002', date: '2026-11-04' }
        });
        const slot1000 = (d002WedSlots.body?.data?.slots || []).find(s => s.time === '10:00');
        assert(
            d002WedSlots.status === 200 && slot1000 && slot1000.available === false,
            'D-002 slot 10:00 on 2026-11-04 is marked available=false due to seeded A-002'
        );

        // Exclude A-002 when rescheduling A-002 on the same date
        const d002WedExclude = await staff.request('appointments/slots.php', {
            params: { doctorId: 'D-002', date: '2026-11-04', excludeId: 'A-002' }
        });
        const slot1000Excl = (d002WedExclude.body?.data?.slots || []).find(s => s.time === '10:00');
        assert(
            d002WedExclude.status === 200 && slot1000Excl && slot1000Excl.available === true,
            'D-002 slot 10:00 on 2026-11-04 is marked available=true when excludeId=A-002 is passed'
        );

        // ------------------------------------------------------------------
        // 5. Booking Validation: Past, Off-Schedule, Off-Grid, Inactive Doctor, Unverified Patient
        // ------------------------------------------------------------------
        console.log('\n[5] Booking Validation & Business Rules');

        // Past date rejection
        const pastBook = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { patientId: 'P-001', doctorId: 'D-001', date: '2020-01-06', time: '09:00', type: 'in-person', reason: 'Past date test' }
        });
        assert(pastBook.status === 400, 'Reject booking in the past (400 Bad Request)');

        // Off-schedule weekday rejection (D-003 does not work on Sunday)
        const offDayBook = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { patientId: 'P-001', doctorId: 'D-003', date: nextSun, time: '10:00', type: 'in-person', reason: 'Sunday booking test' }
        });
        assert(offDayBook.status === 400, 'Reject booking on doctor off-day (400 Bad Request)');

        // Outside working hours (D-001 ends at 17:00)
        const afterHoursBook = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { patientId: 'P-001', doctorId: 'D-001', date: nextMon, time: '18:00', type: 'in-person', reason: 'After hours test' }
        });
        assert(afterHoursBook.status === 400, 'Reject booking outside doctor shift hours (400 Bad Request)');

        // Off-grid slot time (09:15 for 30-min slot doctor)
        const offGridBook = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { patientId: 'P-001', doctorId: 'D-001', date: nextMon, time: '09:15', type: 'in-person', reason: 'Off-grid time test' }
        });
        assert(offGridBook.status === 400, 'Reject off-grid time 09:15 for 30-minute slot schedule (400 Bad Request)');

        // Inactive doctor rejection (temporarily set D-005 inactive)
        await admin.request('doctors/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'D-005', status: 'inactive' }
        });
        const inactiveSlots = await patient.request('appointments/slots.php', {
            params: { doctorId: 'D-005', date: nextMon }
        });
        assert(
            inactiveSlots.status === 200 && inactiveSlots.body?.data?.slots?.length === 0,
            'Inactive doctor (D-005) returns 0 available slots'
        );

        const inactiveBook = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { patientId: 'P-001', doctorId: 'D-005', date: nextMon, time: '13:00', type: 'in-person', reason: 'Inactive doctor booking' }
        });
        assert(inactiveBook.status === 400, 'Reject booking with inactive doctor D-005 (400 Bad Request)');

        // Restore D-005 to active
        await admin.request('doctors/update.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': admin.csrfToken },
            body: { id: 'D-005', status: 'active' }
        });

        // Unverified patient (P-002) rejected when staff tries to book for them
        const staffBookUnverified = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { patientId: 'P-002', doctorId: 'D-001', date: nextMon, time: '09:00', type: 'in-person', reason: 'Unverified patient booking' }
        });
        assert(staffBookUnverified.status === 400, 'Reject staff booking for unverified patient P-002 (400 Bad Request)');

        // Unverified patient (patient2 / P-002) rejected when self-booking
        const pat2SelfBook = await patient2.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient2.csrfToken },
            body: { doctorId: 'D-001', date: nextMon, time: '09:00', type: 'in-person', reason: 'Unverified self booking attempt' }
        });
        assert(pat2SelfBook.status === 403, 'Reject self-booking by unverified patient2 / P-002 (403 Forbidden)');

        // Patient self-booking validation: reason < 10 chars
        const shortReasonBook = await patient.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { doctorId: 'D-001', date: nextMon, time: '09:00', type: 'in-person', reason: 'Too short' }
        });
        assert(shortReasonBook.status === 400, 'Reject patient self-booking with reason < 10 characters (400 Bad Request)');

        // Patient self-booking validation: > 60 days in advance
        const farFutureBook = await patient.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { doctorId: 'D-001', date: farMon, time: '09:00', type: 'in-person', reason: 'Booking more than 60 days ahead' }
        });
        assert(farFutureBook.status === 400, 'Reject patient self-booking more than 60 days in advance (400 Bad Request)');

        // ------------------------------------------------------------------
        // 6. Patient Self-Booking, Staff Booking, Double-Booking & 3-Active Limit
        // ------------------------------------------------------------------
        console.log('\n[6] Patient Self-Booking, Concurrency Conflict Checks & 3-Active Limit');

        const initialMyUpcoming = await patient.request('appointments/list.php', { params: { my: 1, scope: 'upcoming' } });
        const initialUpcomingCount = (initialMyUpcoming.body?.data?.appointments || []).length;

        // Patient self-books A-003 on nextMon at 09:00 with D-001 (even if body passes patientId: 'P-002', server must force P-001)
        const patBook1 = await patient.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: {
                patientId: 'P-002', // spoof attempt — must be ignored and forced to session's P-001
                doctorId: 'D-001',
                date: nextMon,
                time: '09:00',
                type: 'telehealth',
                reason: 'Follow-up telehealth consultation for hypertension'
            }
        });
        const appt3 = patBook1.body?.data?.appointment;
        assert(
            patBook1.status === 201 && appt3?.id === 'A-003' && appt3?.patientId === 'P-001' && appt3?.status === 'Pending',
            `Patient self-booking creates A-003 with status=Pending and enforces session patientId=P-001 (got ${appt3?.id}, ${appt3?.status})`
        );

        // Double-booking same doctor + date + time (D-001, nextMon, 09:00) -> 409 Conflict
        const doubleBookDoc = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: {
                patientId: 'P-001',
                doctorId: 'D-001',
                date: nextMon,
                time: '09:00',
                type: 'in-person',
                reason: 'Duplicate doctor slot test'
            }
        });
        assert(doubleBookDoc.status === 409, 'Prevent double-booking the same doctor slot (409 Conflict)');

        // Same-patient same-time conflict with a DIFFERENT doctor (D-002 also works Mon 08:00-16:00) -> 409 Conflict
        const samePatientTime = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: {
                patientId: 'P-001',
                doctorId: 'D-002',
                date: nextMon,
                time: '09:00',
                type: 'in-person',
                reason: 'Same patient overlapping time with different doctor'
            }
        });
        assert(samePatientTime.status === 409, 'Prevent same patient from booking two doctors at the exact same date & time (409 Conflict)');

        // Staff books A-004 for P-001 on nextTue at 09:00 -> status must be Confirmed
        const staffBook = await staff.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: {
                patientId: 'P-001',
                doctorId: 'D-001',
                date: nextTue,
                time: '09:00',
                type: 'in-person',
                reason: 'Staff scheduled checkup'
            }
        });
        const appt4 = staffBook.body?.data?.appointment;
        assert(
            staffBook.status === 201 && appt4?.id === 'A-004' && appt4?.status === 'Confirmed',
            `Staff-assisted booking creates A-004 with immediate status=Confirmed`
        );

        // If initialUpcomingCount was 0, create one more so P-001 has 3 active upcoming appointments
        if (initialUpcomingCount === 0) {
            await staff.request('appointments/create.php', {
                method: 'POST',
                headers: { 'X-CSRF-Token': staff.csrfToken },
                body: {
                    patientId: 'P-001',
                    doctorId: 'D-001',
                    date: nextThu,
                    time: '09:00',
                    type: 'in-person',
                    reason: 'Third active upcoming appointment'
                }
            });
        }

        // Now P-001 has 3 active upcoming appointments. 4th self-booking by patient must be rejected (400)
        const fourthSelfBook = await patient.request('appointments/create.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: {
                doctorId: 'D-001',
                date: nextFri,
                time: '10:00',
                type: 'in-person',
                reason: 'Fourth upcoming appointment attempt by patient'
            }
        });
        assert(
            fourthSelfBook.status === 400 && /maximum of 3/i.test(fourthSelfBook.body?.message || ''),
            'Enforce max 3 active upcoming appointments limit for patient self-booking (400 Bad Request)'
        );

        // ------------------------------------------------------------------
        // 7. Patient Ownership & IDOR Prevention
        // ------------------------------------------------------------------
        console.log('\n[7] Patient Ownership & IDOR Protection');

        // Patient2 (P-002) tries to GET P-001's appointment A-003 -> 403 Forbidden
        const idorGet = await patient2.request('appointments/get.php', { params: { id: 'A-003' } });
        assert(idorGet.status === 403, 'IDOR check: patient2 cannot view P-001 appointment A-003 via get.php (403)');

        // Patient2 (P-002) tries to list P-001's appointments via ?patientId=P-001 -> scoped to P-002 (0 results)
        const idorList = await patient2.request('appointments/list.php', { params: { patientId: 'P-001' } });
        const pat2List = idorList.body?.data?.appointments || [];
        assert(
            idorList.status === 200 && pat2List.length === 0,
            'IDOR check: patient2 querying list.php?patientId=P-001 only sees own appointments (0 rows)'
        );

        // Patient2 tries to reschedule A-003 -> 403 Forbidden
        const idorResched = await patient2.request('appointments/reschedule.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient2.csrfToken },
            body: { id: 'A-003', date: nextWed, time: '09:00' }
        });
        assert(idorResched.status === 403, 'IDOR check: patient2 cannot reschedule P-001 appointment A-003 (403)');

        // Patient2 tries to cancel A-003 -> 403 Forbidden
        const idorCancel = await patient2.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient2.csrfToken },
            body: { id: 'A-003', status: 'Cancelled', cancelReason: 'Unauthorized cancel attempt' }
        });
        assert(idorCancel.status === 403, 'IDOR check: patient2 cannot cancel P-001 appointment A-003 (403)');

        // Patient2 tries to view/submit pre-visit form for A-003 -> 403 Forbidden
        const idorPreVisitGet = await patient2.request('appointments/pre-visit.php', { params: { appointmentId: 'A-003' } });
        assert(idorPreVisitGet.status === 403, 'IDOR check: patient2 cannot read P-001 pre-visit form (403)');

        // ------------------------------------------------------------------
        // 8. In-Place Rescheduling & 24-Hour Cutoff Enforcement
        // ------------------------------------------------------------------
        console.log('\n[8] In-Place Rescheduling (ID Preservation) & 24-Hour Cutoff');

        // Patient reschedules A-003 (which is > 24h away) from nextMon 09:00 to nextWed 10:30
        const reschedOk = await patient.request('appointments/reschedule.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'A-003', date: nextWed, time: '10:30' }
        });
        const reschedAppt = reschedOk.body?.data?.appointment;
        assert(
            reschedOk.status === 200 && reschedAppt?.id === 'A-003' && reschedAppt?.date === nextWed && reschedAppt?.time === '10:30',
            `In-place reschedule preserves appointment ID A-003 and updates date/time to ${nextWed} 10:30`
        );

        // Old slot (nextMon 09:00) is now available again!
        const oldSlotCheck = await patient.request('appointments/slots.php', { params: { doctorId: 'D-001', date: nextMon } });
        const slot0900 = (oldSlotCheck.body?.data?.slots || []).find(s => s.time === '09:00');
        assert(slot0900 && slot0900.available === true, 'Old slot (09:00 on nextMon) is freed after rescheduling A-003');

        // Test 24-hour cutoff: set A-004's date/time in DB to 2 hours from now
        runSql(`
            UPDATE appointments
            SET appointment_date = DATE(DATE_ADD(NOW(), INTERVAL 2 HOUR)),
                appointment_time = TIME(DATE_ADD(NOW(), INTERVAL 2 HOUR))
            WHERE id = 'A-004';
        `);

        const reschedWithin24h = await patient.request('appointments/reschedule.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'A-004', date: nextFri, time: '09:00' }
        });
        assert(reschedWithin24h.status === 400, 'Reject patient rescheduling within 24 hours of appointment (400 Bad Request)');

        const cancelWithin24h = await patient.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'A-004', status: 'Cancelled', cancelReason: 'Too close to appointment time' }
        });
        assert(cancelWithin24h.status === 400, 'Reject patient cancellation within 24 hours of appointment (400 Bad Request)');

        // Staff CAN reschedule A-004 even within 24 hours
        const staffReschedWithin24h = await staff.request('appointments/reschedule.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { id: 'A-004', date: nextTue, time: '09:30' }
        });
        assert(
            staffReschedWithin24h.status === 200 && staffReschedWithin24h.body?.data?.appointment?.time === '09:30',
            'Staff can reschedule appointment A-004 even when it was within 24 hours (200 OK)'
        );

        // ------------------------------------------------------------------
        // 9. Status Transitions & Role Restrictions (status.php)
        // ------------------------------------------------------------------
        console.log('\n[9] Appointment Status Transitions & Role Restrictions');

        // Patient cannot confirm their own Pending appointment (A-003)
        const patConfirmTry = await patient.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'A-003', status: 'Confirmed' }
        });
        assert(patConfirmTry.status === 403, 'Patient cannot mark Pending appointment as Confirmed (403)');

        // Doctor cannot confirm a Pending appointment
        const docConfirmTry = await doctor.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'A-003', status: 'Confirmed' }
        });
        assert(docConfirmTry.status === 403, 'Doctor cannot mark Pending appointment as Confirmed (403)');

        // Doctor cannot complete a Pending appointment before it is Confirmed
        const docCompletePending = await doctor.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'A-003', status: 'Completed' }
        });
        assert(docCompletePending.status === 400, 'Cannot transition directly from Pending to Completed (400)');

        // Staff confirms A-003 (Pending -> Confirmed)
        const staffConfirmA003 = await staff.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { id: 'A-003', status: 'Confirmed' }
        });
        assert(
            staffConfirmA003.status === 200 && staffConfirmA003.body?.data?.appointment?.status === 'Confirmed',
            'Staff transitions A-003 from Pending to Confirmed (200 OK)'
        );

        // Doctor (D-001) tries to complete D-002's appointment (A-002) -> 403 Forbidden
        const docCompleteOther = await doctor.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'A-002', status: 'Completed' }
        });
        assert(docCompleteOther.status === 403, 'Doctor D-001 cannot complete another doctor (D-002) appointment (403)');

        // Assigned Doctor (D-001) completes A-004 (Confirmed -> Completed)
        const docCompleteA004 = await doctor.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': doctor.csrfToken },
            body: { id: 'A-004', status: 'Completed' }
        });
        assert(
            docCompleteA004.status === 200 && docCompleteA004.body?.data?.appointment?.status === 'Completed',
            'Assigned doctor D-001 transitions A-004 from Confirmed to Completed (200 OK)'
        );

        // Terminal state protection: cannot cancel or reschedule a Completed appointment (A-004)
        const cancelCompleted = await staff.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { id: 'A-004', status: 'Cancelled', cancelReason: 'Trying to cancel completed visit' }
        });
        assert(cancelCompleted.status === 400, 'Reject cancelling a Completed appointment (400 Bad Request)');

        const reschedCompleted = await staff.request('appointments/reschedule.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': staff.csrfToken },
            body: { id: 'A-004', date: nextFri, time: '10:00' }
        });
        assert(reschedCompleted.status === 400, 'Reject rescheduling a Completed appointment (400 Bad Request)');

        // ------------------------------------------------------------------
        // 10. Pre-Visit Form & Telehealth Join Window (pre-visit.php)
        // ------------------------------------------------------------------
        console.log('\n[10] Telehealth Pre-Visit Questionnaire & Join Window (api/appointments/pre-visit.php)');

        // Before submitting pre-visit form for A-003 (telehealth, Confirmed), canJoin must be false
        const preCheckBefore = await patient.request('appointments/pre-visit.php', {
            params: { appointmentId: 'A-003' }
        });
        assert(
            preCheckBefore.status === 200 && preCheckBefore.body?.data?.form === null && preCheckBefore.body?.data?.canJoin?.allowed === false,
            'GET pre-visit.php before submission returns form=null and canJoin.allowed=false'
        );

        // Reject missing consent
        const preVisitNoConsent = await patient.request('appointments/pre-visit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: {
                appointmentId: 'A-003',
                symptoms: 'Persistent headache and mild dizziness',
                symptomDuration: '3 days',
                currentMedications: 'Losartan 50mg',
                consent: false
            }
        });
        assert(preVisitNoConsent.status === 400, 'Reject pre-visit form when consent=false (400 Bad Request)');

        // Reject short symptoms (< 5 chars)
        const preVisitShortSym = await patient.request('appointments/pre-visit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: {
                appointmentId: 'A-003',
                symptoms: 'Flu',
                consent: true
            }
        });
        assert(preVisitShortSym.status === 400, 'Reject pre-visit form when symptoms < 5 characters (400 Bad Request)');

        // Submit valid pre-visit form for A-003 (without passing allergies -> should auto-populate P-001's "Penicillin, Aspirin")
        const preVisitSubmit = await patient.request('appointments/pre-visit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: {
                appointmentId: 'A-003',
                symptoms: 'Persistent headache and mild dizziness',
                symptomDuration: '3 days',
                currentMedications: 'Losartan 50mg once daily',
                consent: true
            }
        });
        const savedForm = preVisitSubmit.body?.data?.form;
        assert(
            preVisitSubmit.status === 200 &&
            savedForm?.appointmentId === 'A-003' &&
            savedForm?.symptomDuration === '3 days' &&
            savedForm?.currentMedications === 'Losartan 50mg once daily' &&
            savedForm?.allergies === 'Penicillin, Aspirin' &&
            savedForm?.consent === true,
            'Valid pre-visit form submission succeeds and auto-populates patient allergies from DB'
        );

        // Upsert idempotency: submitting again updates existing row without duplicate key error
        const preVisitUpdate = await patient.request('appointments/pre-visit.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: {
                appointmentId: 'A-003',
                symptoms: 'Updated symptoms: headache improving',
                symptomDuration: '4 days',
                currentMedications: 'Losartan 50mg',
                consent: true
            }
        });
        assert(
            preVisitUpdate.status === 200 &&
            preVisitUpdate.body?.data?.form?.id === savedForm?.id &&
            preVisitUpdate.body?.data?.form?.symptomDuration === '4 days',
            'Re-submitting pre-visit form for A-003 updates existing record in-place (idempotent upsert)'
        );

        // Staff/Doctor can read the pre-visit form via GET pre-visit.php and GET get.php
        const docReadPreVisit = await doctor.request('appointments/pre-visit.php', {
            params: { appointmentId: 'A-003' }
        });
        assert(
            docReadPreVisit.status === 200 && docReadPreVisit.body?.data?.form?.symptoms === 'Updated symptoms: headache improving',
            'Doctor can view patient pre-visit questionnaire via GET pre-visit.php'
        );

        // Since A-003 is on nextWed (> 15 mins in future), canJoin must be false with minutesUntil > 0
        assert(
            docReadPreVisit.body?.data?.canJoin?.allowed === false && docReadPreVisit.body?.data?.canJoin?.minutesUntil > 0,
            'Server-side telehealth join check blocks joining > 15 minutes before appointment'
        );

        // Move A-003 to 10 minutes from NOW() to verify active join window [-30, +15] mins
        runSql(`
            UPDATE appointments
            SET appointment_date = DATE(DATE_ADD(NOW(), INTERVAL 10 MINUTE)),
                appointment_time = TIME(DATE_ADD(NOW(), INTERVAL 10 MINUTE))
            WHERE id = 'A-003';
        `);

        const joinWindowOpen = await patient.request('appointments/pre-visit.php', {
            params: { appointmentId: 'A-003' }
        });
        assert(
            joinWindowOpen.status === 200 && joinWindowOpen.body?.data?.canJoin?.allowed === true,
            'Server-side telehealth join check returns allowed=true when Confirmed, form submitted, and within 15 minutes'
        );

        // Move A-003 back to nextWed 10:30 so patient can cancel it (> 24h away)
        runSql(`
            UPDATE appointments
            SET appointment_date = '${nextWed}',
                appointment_time = '10:30:00'
            WHERE id = 'A-003';
        `);

        // Patient cancels A-003 with short reason (< 5 chars) -> 400
        const shortCancel = await patient.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'A-003', status: 'Cancelled', cancelReason: 'No' }
        });
        assert(shortCancel.status === 400, 'Reject cancellation when cancelReason < 5 characters (400 Bad Request)');

        // Patient cancels A-003 with valid reason
        const validCancel = await patient.request('appointments/status.php', {
            method: 'POST',
            headers: { 'X-CSRF-Token': patient.csrfToken },
            body: { id: 'A-003', status: 'Cancelled', cancelReason: 'Schedule conflict at work' }
        });
        assert(
            validCancel.status === 200 && validCancel.body?.data?.appointment?.status === 'Cancelled',
            'Patient cancels own upcoming appointment A-003 (> 24h away) with valid reason (200 OK)'
        );
    } finally {
        cleanupTestData();
        await admin.logout();
        await staff.logout();
        await doctor.logout();
        await nurse.logout();
        await patient.logout();
        await patient2.logout();
    }

    // Verify seeded state restored (A-001 and A-002 only)
    const verifyCount = runSql("SELECT COUNT(*) FROM appointments;");
    const verifyIds = runSql("SELECT GROUP_CONCAT(id ORDER BY id) FROM appointments;");
    const verifySeq = runSql("SELECT current_val FROM sequences WHERE entity_key = 'appointments';");
    assert(
        verifyCount === '2' && verifyIds === 'A-001,A-002' && verifySeq === '2',
        `Database restored to exact seeded state: appointments=[${verifyIds}], sequence=${verifySeq}`
    );

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    cleanupTestData();
    console.error('Unhandled error in appointment-smoke-test:', err);
    process.exit(1);
});
