/**
 * PrimeCare HIS — Phase 5.5 Automated Doctor Management & Scheduling Smoke Test
 *
 * Tests all Phase 5.5 PHP endpoints against live Apache + MariaDB:
 *   - api/doctors/departments.php
 *   - api/doctors/list.php
 *   - api/doctors/get.php
 *   - api/doctors/create.php
 *   - api/doctors/update.php
 *   - api/doctors/delete.php
 *   - api/doctors/schedules.php
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

async function runTests() {
    console.log('==============================================================');
    console.log('PRIMECARE PHASE 5.5 — DOCTOR & SCHEDULING SMOKE TEST SUITE');
    console.log('==============================================================\n');

    const anon = new ClientSession('Anonymous');
    const admin = new ClientSession('Admin');
    const staff = new ClientSession('Staff');
    const doctor = new ClientSession('Doctor');
    const patient = new ClientSession('Patient');

    // ------------------------------------------------------------------
    // 1. Authentication & RBAC Enforcement
    // ------------------------------------------------------------------
    console.log('[1] Authentication, Session & RBAC Enforcement');

    const unauthGet = await anon.request('doctors/get.php', { params: { id: 'D-001' } });
    assert(unauthGet.status === 401, 'Unauthenticated GET /doctors/get.php rejected (401)');

    const unauthListReq = await anon.request('doctors/list.php', { params: { requireAuth: 1 } });
    assert(unauthListReq.status === 401, 'Unauthenticated GET /doctors/list.php?requireAuth=1 rejected (401)');

    const unauthSched = await anon.request('doctors/schedules.php', { params: { doctorId: 'D-001' } });
    assert(unauthSched.status === 401, 'Unauthenticated GET /doctors/schedules.php rejected (401)');

    const unauthCreate = await anon.request('doctors/create.php', { method: 'POST', body: {} });
    assert(unauthCreate.status === 401, 'Unauthenticated POST /doctors/create.php rejected (401)');

    const unauthUpdate = await anon.request('doctors/update.php', { method: 'POST', body: {} });
    assert(unauthUpdate.status === 401, 'Unauthenticated POST /doctors/update.php rejected (401)');

    const unauthDelete = await anon.request('doctors/delete.php', { method: 'POST', body: {} });
    assert(unauthDelete.status === 401, 'Unauthenticated POST /doctors/delete.php rejected (401)');

    // Login test accounts
    const adminLogin = await admin.login('admin', 'password123');
    assert(adminLogin.status === 200 && adminLogin.body?.success === true, 'Admin login succeeds');

    const staffLogin = await staff.login('staff', 'password123');
    assert(staffLogin.status === 200 && staffLogin.body?.success === true, 'Staff login succeeds');

    const doctorLogin = await doctor.login('doctor', 'password123');
    assert(doctorLogin.status === 200 && doctorLogin.body?.success === true, 'Doctor login succeeds');

    const patientLogin = await patient.login('patient', 'password123');
    assert(patientLogin.status === 200 && patientLogin.body?.success === true, 'Patient login succeeds');

    // Missing CSRF check on admin write
    const noCsrfCreate = await admin.request('doctors/create.php', { method: 'POST', body: { name: 'Dr. Test' } });
    assert(noCsrfCreate.status === 403, 'Admin POST /doctors/create.php without CSRF token rejected (403)');

    // Non-admin roles blocked from doctor mutations
    const staffCreate = await staff.request('doctors/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { name: 'Dr. Unauthorized' }
    });
    assert(staffCreate.status === 403, 'Staff role blocked from POST /doctors/create.php (403)');

    const doctorUpdate = await doctor.request('doctors/update.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': doctor.csrfToken },
        body: { id: 'D-001', status: 'inactive' }
    });
    assert(doctorUpdate.status === 403, 'Doctor role blocked from POST /doctors/update.php (403)');

    const patientDelete = await patient.request('doctors/delete.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': patient.csrfToken },
        body: { id: 'D-001' }
    });
    assert(patientDelete.status === 403, 'Patient role blocked from POST /doctors/delete.php (403)');

    const staffSchedPost = await staff.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': staff.csrfToken },
        body: { action: 'create', doctorId: 'D-001', day: 'Sun', start: '09:00', end: '12:00' }
    });
    assert(staffSchedPost.status === 403, 'Staff role blocked from POST /doctors/schedules.php (403)');

    // ------------------------------------------------------------------
    // 2. Department Directory Integration
    // ------------------------------------------------------------------
    console.log('\n[2] Department Directory Integration');

    const deptRes = await anon.request('doctors/departments.php');
    const depts = deptRes.body?.data?.departments || [];
    assert(
        deptRes.status === 200 && depts.length === 6,
        `GET /doctors/departments.php returns 6 seeded departments (got ${depts.length})`
    );
    assert(
        depts.some(d => d.id === 1 && d.name === 'Cardiology' && Array.isArray(d.services) && d.services.includes('ECG')),
        'Cardiology department includes id, name, description, and decoded services_json array'
    );

    const singleDeptId = await anon.request('doctors/departments.php', { params: { id: 2 } });
    assert(
        singleDeptId.status === 200 && singleDeptId.body?.data?.department?.name === 'Pediatrics',
        'Lookup department by id=2 returns Pediatrics'
    );

    const singleDeptName = await anon.request('doctors/departments.php', { params: { name: 'Oncology' } });
    assert(
        singleDeptName.status === 200 && singleDeptName.body?.data?.department?.id === 3,
        'Lookup department by name=Oncology returns id=3'
    );

    const missingDept = await anon.request('doctors/departments.php', { params: { name: 'NonExistentDept' } });
    assert(missingDept.status === 404, 'Lookup non-existent department returns 404');

    // ------------------------------------------------------------------
    // 3. Doctor Listing, Search, Filtering, Sorting & Details
    // ------------------------------------------------------------------
    console.log('\n[3] Doctor Listing, Search, Filtering, Sorting & Details');

    const listAll = await admin.request('doctors/list.php');
    const docsAll = listAll.body?.data?.doctors || [];
    assert(
        listAll.status === 200 && docsAll.length === 5,
        `GET /doctors/list.php returns 5 seeded doctors (got ${docsAll.length})`
    );

    const d001FromList = docsAll.find(d => d.id === 'D-001');
    assert(
        d001FromList &&
        d001FromList.name === 'Dr. Jose Rizal' &&
        d001FromList.department === 'Surgery' &&
        d001FromList.departmentId === 5 &&
        Array.isArray(d001FromList.schedule) &&
        d001FromList.schedule.length === 7,
        'Doctor D-001 includes relational department metadata and 7 weekly schedule rows'
    );

    // Keyword search
    const searchRizal = await anon.request('doctors/list.php', { params: { keyword: 'Rizal' } });
    assert(
        searchRizal.status === 200 &&
        searchRizal.body?.data?.doctors?.length === 1 &&
        searchRizal.body.data.doctors[0].id === 'D-001',
        'Keyword search "Rizal" returns D-001'
    );

    // Filter by department & specialization
    const filterDept = await anon.request('doctors/list.php', { params: { department: 'Pediatrics' } });
    assert(
        filterDept.status === 200 &&
        filterDept.body?.data?.doctors?.length === 1 &&
        filterDept.body.data.doctors[0].id === 'D-003',
        'Filter by department="Pediatrics" returns D-003 (Dr. Melchora Aquino)'
    );

    // Filter by language & insurance
    const filterLangIns = await anon.request('doctors/list.php', {
        params: { language: 'Spanish', insurance: 'Maxicare' }
    });
    assert(
        filterLangIns.status === 200 &&
        filterLangIns.body?.data?.doctors?.length === 1 &&
        filterLangIns.body.data.doctors[0].id === 'D-001',
        'Filter by language="Spanish" and insurance="Maxicare" returns D-001'
    );

    // Sort whitelist & SQL injection protection
    const sortFeeDesc = await anon.request('doctors/list.php', {
        params: { sortBy: 'consultationFee', sortDir: 'desc' }
    });
    const sortedFees = (sortFeeDesc.body?.data?.doctors || []).map(d => d.consultationFee);
    assert(
        sortFeeDesc.status === 200 && sortedFees[0] === 1500 && sortedFees[sortedFees.length - 1] === 800,
        `Sort by consultationFee DESC orders doctors properly (${sortedFees.join(' >= ')})`
    );

    const sortSqlInj = await anon.request('doctors/list.php', {
        params: { sortBy: 'name; DROP TABLE doctors;--', sortDir: 'invalid' }
    });
    assert(
        sortSqlInj.status === 200 && sortSqlInj.body?.data?.doctors?.length === 5,
        'Sort parameter whitelist neutralizes invalid/malicious sortBy and sortDir'
    );

    // Retrieve individual doctor details
    const getD001 = await staff.request('doctors/get.php', { params: { id: 'D-001' } });
    assert(
        getD001.status === 200 &&
        getD001.body?.data?.doctor?.id === 'D-001' &&
        getD001.body?.data?.doctor?.departmentServices?.includes('Appendectomy'),
        'GET /doctors/get.php?id=D-001 returns full doctor record with department services'
    );

    const getInvalidId = await staff.request('doctors/get.php', { params: { id: 'INVALID' } });
    assert(getInvalidId.status === 400, 'GET /doctors/get.php with malformed ID returns 400');

    const getNotFound = await staff.request('doctors/get.php', { params: { id: 'D-999' } });
    assert(getNotFound.status === 404, 'GET /doctors/get.php with non-existent ID returns 404');

    // ------------------------------------------------------------------
    // 4. Doctor Creation, Validation & Duplicate Prevention
    // ------------------------------------------------------------------
    console.log('\n[4] Doctor Creation, Validation & Duplicate Prevention');

    // Reject missing required fields
    const createMissing = await admin.request('doctors/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { name: '', specialization: '' }
    });
    assert(createMissing.status === 400, 'Reject doctor creation with missing required fields (400)');

    // Reject invalid department
    const createBadDept = await admin.request('doctors/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            name: 'Dr. Invalid Dept',
            specialization: 'Neurology',
            department: 'NonExistentDepartment',
            consultationFee: 1200,
            slotMinutes: 30,
            contact: '09179998877',
            email: 'invalid.dept@primecare.ph',
            schedule: [{ day: 'Mon', start: '09:00', end: '17:00' }]
        }
    });
    assert(createBadDept.status === 400, 'Reject doctor creation with non-existent department (400)');

    // Reject negative consultation fee
    const createNegFee = await admin.request('doctors/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            name: 'Dr. Negative Fee',
            specialization: 'Cardiology',
            department: 'Cardiology',
            consultationFee: -500,
            slotMinutes: 30,
            contact: '09179998877',
            email: 'neg.fee@primecare.ph',
            schedule: [{ day: 'Mon', start: '09:00', end: '17:00' }]
        }
    });
    assert(createNegFee.status === 400, 'Reject doctor creation with negative consultationFee (400)');

    // Reject duplicate email (D-001 uses jrizal@primecare.ph)
    const createDupEmail = await admin.request('doctors/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            name: 'Dr. Duplicate Email',
            specialization: 'Cardiology',
            department: 'Cardiology',
            consultationFee: 1500,
            slotMinutes: 30,
            contact: '09179998877',
            email: 'jrizal@primecare.ph',
            schedule: [{ day: 'Mon', start: '09:00', end: '17:00' }]
        }
    });
    assert(createDupEmail.status === 409, 'Reject doctor creation with duplicate email (409 Conflict)');

    // Reject duplicate contact (D-001 uses 09170000001)
    const createDupContact = await admin.request('doctors/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            name: 'Dr. Duplicate Contact',
            specialization: 'Cardiology',
            department: 'Cardiology',
            consultationFee: 1500,
            slotMinutes: 30,
            contact: '09170000001',
            email: 'unique.doc@primecare.ph',
            schedule: [{ day: 'Mon', start: '09:00', end: '17:00' }]
        }
    });
    assert(createDupContact.status === 409, 'Reject doctor creation with duplicate contact number (409 Conflict)');

    // Create a valid test doctor
    const createValid = await admin.request('doctors/create.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            name: 'Dr. Gabriela Silang',
            specialization: 'Internal Medicine',
            department: 'Internal Medicine',
            consultationFee: 1400,
            slotMinutes: 30,
            contact: '09175550199',
            email: 'gsilang@primecare.ph',
            bio: 'Board-certified internist specializing in preventive medicine.',
            experience: 9,
            languages: ['English', 'Tagalog'],
            insurance: ['PhilHealth', 'Maxicare'],
            telehealth: true,
            status: 'active',
            schedule: [
                { day: 'Mon', start: '09:00', end: '15:00' },
                { day: 'Wed', start: '09:00', end: '15:00' }
            ]
        }
    });
    const createdDoc = createValid.body?.data?.doctor;
    const testDoctorId = createdDoc?.id;
    assert(
        createValid.status === 201 &&
        testDoctorId &&
        /^D-\d{3,}$/.test(testDoctorId) &&
        createdDoc.name === 'Dr. Gabriela Silang' &&
        createdDoc.schedule?.length === 2,
        `Create new doctor succeeds (201) with generated ID ${testDoctorId} and 2 schedule rows`
    );

    // ------------------------------------------------------------------
    // 5. Doctor Update, Deactivation & Reactivation
    // ------------------------------------------------------------------
    console.log('\n[5] Doctor Update, Deactivation & Reactivation');

    const updateDoc = await admin.request('doctors/update.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            id: testDoctorId,
            name: 'Dr. Gabriela Silang-Estrada',
            specialization: 'Internal Medicine',
            department: 'Internal Medicine',
            consultationFee: 1600,
            slotMinutes: 20,
            contact: '09175550199',
            email: 'gsilang@primecare.ph',
            bio: 'Updated bio for Dr. Silang.',
            experience: 10,
            languages: ['English', 'Tagalog'],
            insurance: ['PhilHealth', 'Maxicare', 'Medicard'],
            telehealth: true
        }
    });
    assert(
        updateDoc.status === 200 &&
        updateDoc.body?.data?.doctor?.id === testDoctorId &&
        updateDoc.body?.data?.doctor?.consultationFee === 1600 &&
        updateDoc.body?.data?.doctor?.slotMinutes === 20,
        `Update doctor ${testDoctorId} preserves ID and updates profile fields`
    );

    // Deactivate test doctor
    const deactivateDoc = await admin.request('doctors/update.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: testDoctorId, status: 'inactive' }
    });
    assert(
        deactivateDoc.status === 200 &&
        deactivateDoc.body?.data?.doctor?.status === 'inactive' &&
        typeof deactivateDoc.body?.data?.upcomingAppointments === 'number',
        `Deactivate doctor ${testDoctorId} sets status="inactive" and returns upcomingAppointments count`
    );

    // Verify public/patient listing hides inactive doctor while admin listing includes it
    const publicListAfterDeact = await anon.request('doctors/list.php');
    const publicIds = (publicListAfterDeact.body?.data?.doctors || []).map(d => d.id);
    assert(
        !publicIds.includes(testDoctorId),
        `Public doctor list excludes deactivated doctor ${testDoctorId}`
    );

    const patientListAfterDeact = await patient.request('doctors/list.php');
    const patientIds = (patientListAfterDeact.body?.data?.doctors || []).map(d => d.id);
    assert(
        !patientIds.includes(testDoctorId),
        `Patient doctor list excludes deactivated doctor ${testDoctorId}`
    );

    const adminListAfterDeact = await admin.request('doctors/list.php');
    const adminDocEntry = (adminListAfterDeact.body?.data?.doctors || []).find(d => d.id === testDoctorId);
    assert(
        adminDocEntry && adminDocEntry.status === 'inactive',
        `Admin doctor list still includes deactivated doctor ${testDoctorId} with status="inactive"`
    );

    // Reactivate test doctor
    const reactivateDoc = await admin.request('doctors/update.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: testDoctorId, status: 'active' }
    });
    assert(
        reactivateDoc.status === 200 && reactivateDoc.body?.data?.doctor?.status === 'active',
        `Reactivate doctor ${testDoctorId} restores status="active"`
    );

    // ------------------------------------------------------------------
    // 6. Doctor Schedule Operations & Conflict Validation
    // ------------------------------------------------------------------
    console.log('\n[6] Doctor Schedule Operations & Conflict Validation');

    // List schedules for D-001
    const listD001Sched = await staff.request('doctors/schedules.php', { params: { doctorId: 'D-001' } });
    assert(
        listD001Sched.status === 200 && listD001Sched.body?.data?.schedules?.length === 7,
        'GET /doctors/schedules.php?doctorId=D-001 returns 7 shifts'
    );

    // Filter schedules by day
    const listD001Mon = await staff.request('doctors/schedules.php', {
        params: { doctorId: 'D-001', day: 'Mon' }
    });
    assert(
        listD001Mon.status === 200 &&
        listD001Mon.body?.data?.schedules?.length === 1 &&
        listD001Mon.body.data.schedules[0].day === 'Mon',
        'GET /doctors/schedules.php?doctorId=D-001&day=Mon returns Monday shift'
    );

    // Create a valid Fri schedule for testDoctorId
    const createFriSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'create',
            doctorId: testDoctorId,
            day: 'Fri',
            start: '10:00',
            end: '16:00'
        }
    });
    const friScheduleId = createFriSched.body?.data?.schedule?.id;
    assert(
        createFriSched.status === 201 && friScheduleId > 0 && createFriSched.body?.data?.schedules?.length === 3,
        `Create Friday schedule for ${testDoctorId} succeeds (201, id=${friScheduleId})`
    );

    // Reject overlapping/duplicate day schedule on Fri
    const dupFriSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'create',
            doctorId: testDoctorId,
            day: 'Fri',
            start: '12:00',
            end: '18:00'
        }
    });
    assert(
        dupFriSched.status === 409,
        'Reject duplicate/overlapping Friday schedule for same doctor (409 Conflict)'
    );

    // Reject invalid time range (start >= end)
    const reversedTimeSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'create',
            doctorId: testDoctorId,
            day: 'Thu',
            start: '16:00',
            end: '10:00'
        }
    });
    assert(
        reversedTimeSched.status === 400,
        'Reject schedule with start time >= end time (400 Bad Request)'
    );

    // Reject zero-length shift
    const zeroLenSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'create',
            doctorId: testDoctorId,
            day: 'Thu',
            start: '10:00',
            end: '10:00'
        }
    });
    assert(zeroLenSched.status === 400, 'Reject zero-length schedule shift (400 Bad Request)');

    // Reject invalid time format
    const badTimeSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'create',
            doctorId: testDoctorId,
            day: 'Thu',
            start: '25:99',
            end: '17:00'
        }
    });
    assert(badTimeSched.status === 400, 'Reject invalid 24h time format (400 Bad Request)');

    // Reject invalid doctor reference
    const nonExistentDocSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'create',
            doctorId: 'D-999',
            day: 'Thu',
            start: '09:00',
            end: '15:00'
        }
    });
    assert(nonExistentDocSched.status === 404, 'Reject schedule creation for non-existent doctor D-999 (404)');

    // Update Friday schedule and verify schedule.id is preserved
    const updateFriSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'update',
            id: friScheduleId,
            doctorId: testDoctorId,
            day: 'Fri',
            start: '08:30',
            end: '14:30'
        }
    });
    assert(
        updateFriSched.status === 200 &&
        updateFriSched.body?.data?.schedule?.id === friScheduleId &&
        updateFriSched.body?.data?.schedule?.start === '08:30' &&
        updateFriSched.body?.data?.schedule?.end === '14:30',
        `Update schedule preserves id=${friScheduleId} and updates hours to 08:30-14:30`
    );

    // Reject schedule ownership mismatch on update
    const mismatchOwnerUpdate = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'update',
            id: friScheduleId,
            doctorId: 'D-001',
            day: 'Fri',
            start: '09:00',
            end: '15:00'
        }
    });
    assert(mismatchOwnerUpdate.status === 400, 'Reject schedule update when doctorId does not match schedule owner (400)');

    // Delete Friday schedule
    const deleteFriSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'delete',
            id: friScheduleId,
            doctorId: testDoctorId
        }
    });
    assert(
        deleteFriSched.status === 200 && deleteFriSched.body?.data?.schedules?.length === 2,
        `Delete Friday schedule succeeds and leaves 2 shifts for ${testDoctorId}`
    );

    // Delete Wednesday schedule (leaving only Monday)
    const deleteWedSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'delete',
            doctorId: testDoctorId,
            day: 'Wed'
        }
    });
    assert(
        deleteWedSched.status === 200 && deleteWedSched.body?.data?.schedules?.length === 1,
        `Delete Wednesday schedule succeeds and leaves 1 shift for ${testDoctorId}`
    );

    // Reject deleting the last remaining working day
    const deleteLastSched = await admin.request('doctors/schedules.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: {
            action: 'delete',
            doctorId: testDoctorId,
            day: 'Mon'
        }
    });
    assert(
        deleteLastSched.status === 400,
        'Prevent deleting the only remaining schedule day for a doctor (400 Bad Request)'
    );

    // ------------------------------------------------------------------
    // 7. Referential Integrity Protection & Clean Test Doctor Cleanup
    // ------------------------------------------------------------------
    console.log('\n[7] Referential Integrity Protection & Test Cleanup');

    // Attempt to delete D-001 (has appointments, medical_records, prescriptions, lab_results, admissions, patients)
    const deleteD001 = await admin.request('doctors/delete.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: 'D-001' }
    });
    assert(
        deleteD001.status === 409 && deleteD001.body?.success === false,
        'Reject deleting seeded doctor D-001 with historical clinical/appointment references (409 Conflict)'
    );

    // Delete unreferenced test doctor (D-006) and reset sequence
    const deleteTestDoc = await admin.request('doctors/delete.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': admin.csrfToken },
        body: { id: testDoctorId }
    });
    assert(
        deleteTestDoc.status === 200 && deleteTestDoc.body?.data?.deletedId === testDoctorId,
        `Cleanly delete unreferenced test doctor ${testDoctorId} (200 OK)`
    );

    // Verify seeded state restored (5 doctors, 27 schedules)
    const finalDocsRes = await admin.request('doctors/list.php');
    const finalDocs = finalDocsRes.body?.data?.doctors || [];
    const totalScheds = finalDocs.reduce((acc, d) => acc + (d.schedule ? d.schedule.length : 0), 0);
    assert(
        finalDocs.length === 5 && totalScheds === 27,
        `Database restored to exact seeded baseline: ${finalDocs.length} doctors and ${totalScheds} weekly shifts`
    );

    await admin.logout();
    await staff.logout();
    await doctor.logout();
    await patient.logout();

    console.log('\n==============================================================');
    console.log(`SUMMARY: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
    console.log('==============================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Unhandled error in doctor-smoke-test:', err);
    process.exit(1);
});
