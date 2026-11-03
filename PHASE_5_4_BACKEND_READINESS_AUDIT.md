# PRIMECARE — PHASE 5.4: REMAINING BACKEND READINESS AUDIT

> **Document Type:** Architectural & Technical Readiness Audit  
> **Status:** Completed  
> **Project Directory:** `C:\xampp\htdocs\PrimeCare_v1`  
> **Target Database:** `primecare_db` (MySQL/MariaDB via XAMPP)  
> **Audit Date:** November 3, 2026  
> **Scope:** Audit only. No application files, database tables, or endpoints were modified.

---

## 1. Executive Summary

PrimeCare has successfully transitioned its core infrastructure and security layers to a robust PHP/MySQL foundation:
1. **Phase 5.1 (Foundation):** Established database configuration (`api/config/database.php`), standardized response envelope (`api/helpers/response.php`), and automated migration tracking.
2. **Phase 5.2 (Authentication & Security):** Implemented secure PHP session handling (`api/helpers/session.php`), password hashing (`password_verify`), rate-limiting/brute-force throttling, cryptographic CSRF validation, and Role-Based Access Control (`api/helpers/auth.php`).
3. **Phase 5.3 (Patient Management):** Fully migrated patient records, verification workflows, duplicate prevention, structured addresses, demographic updates, and self-registration into `api/patients/` backed by `primecare_db.patients` (55 passing smoke tests).

However, **9 functional domains remain unmigrated**, running on vanilla JavaScript mock data in `localStorage` through temporary bridging routines (`_getPatientsListForMockJoin`). 

### Core Audit Conclusion & Recommendation
The audit firmly recommends **Doctors Management & Scheduling** as the immediate next phase (**Phase 5.5**), followed directly by **Appointments & Booking** (**Phase 5.6**). 
- Every clinical, operational, and booking module in PrimeCare (Appointments, Medical Records, Prescriptions, Lab Orders, Admissions, and Inpatient Billing) possesses foreign key constraints pointing to `doctors.id`.
- Attempting to migrate Appointments, Records, or Prescriptions prior to Doctors would force those modules to reference mock doctor IDs or create broken foreign keys against MariaDB.
- The `doctors` and `doctor_schedules` tables are already normalized and seeded in `primecare_db`, making Doctor Management a low-risk, foundational prerequisite for the rest of the hospital workflow.

---

## 2. Current Backend Integration Status

| Module / Layer | Status | Backend Endpoints (`api/`) | Database Tables | Notes / Transports |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Core & Config** | Completed | `api/index.php`, `api/health.php` | `sequences`, `public_info` | PDO singleton, UTF8mb4, structured JSON responses |
| **Auth & Sessions** | Completed | `api/auth/login.php`, `logout.php`, `me.php`, `csrf.php`, `change-password.php` | `users`, `audit_logs` | HTTP-only session cookies, CSRF tokens, brute-force throttle |
| **Patient Management** | Completed | `api/patients/list.php`, `get.php`, `create.php`, `register.php`, `update.php`, `verify.php`, `delete.php`, `check-unique.php` | `patients`, `users`, `id_types`, `audit_logs`, `notifications` | Role-guarded, IDOR-protected, structured PH address normalization |
| **Doctors & Schedules** | Mock / localStorage | *None* | `doctors`, `doctor_schedules`, `departments` | Table created with 5 seeded doctors, but CRUD & schedules use `localStorage.primecare_doctors` |
| **Appointments & Booking** | Mock / localStorage | *None* | `appointments`, `pre_visit_forms` | References `patient_id` (migrated) and `doctor_id` (mock). Slotted time validation done client-side |
| **Medical Records (EHR)** | Mock / localStorage | *None* | `medical_records`, `medical_record_history` | References `patient_id`, `doctor_id`, `appointment_id`. Clinical history & vitals in `localStorage` |
| **Prescriptions & Rx** | Mock / localStorage | *None* | `prescriptions`, `prescription_items` | Contains allergy conflict logic; mock join to patients and doctors |
| **Laboratory Results** | Mock / localStorage | *None* | `lab_results` | Lab order and result input; critical flag triggers mock notifications |
| **Wards, Beds & Admissions** | Mock / localStorage | *None* | `wards`, `beds`, `admissions` | Inpatient bed allocation and discharge summaries mock-tracked |
| **Billing & Payments** | Mock / localStorage | *None* | `bills`, `bill_items`, `payments`, `payment_plan_requests`, `service_catalog` | Multi-item billing calculations, senior/PWD discounts, payments in `localStorage` |
| **Reports & Analytics** | Mock / localStorage | *None* | *None* (Aggregates across all tables) | Client-side aggregation of localStorage arrays |
| **User Management & RBAC** | Mock / localStorage | *Partial* (`users` table exists for auth) | `users`, `audit_logs` | Admin user listing, password resets, role alteration still mutate `localStorage.primecare_users` |

---

## 3. Module-by-Module Audit

### 3.1 Doctor Management & Schedules
- **Frontend Controllers:** `staff/doctor-management.html`, `js/doctor-management.js`, `doctors.html`, `js/public.js`
- **Existing API Methods:** `getDoctors()`, `getDoctorById(id)`, `getDoctorsBySpecialization()`, `saveDoctor(doctor)`, `deleteDoctor(id)`, `getDoctorSchedule(doctorId)`, `getAvailableSlots(doctorId, date)`
- **Database Tables:** `doctors` (5 rows), `doctor_schedules` (27 rows), `departments` (6 rows)
- **Foreign Keys:** `doctors.user_id -> users.id`, `doctor_schedules.doctor_id -> doctors.id`
- **Current State:** The database table `doctors` has the 5 default doctors with JSON columns `languages_json` and `accepted_insurance_json`. The 27 schedule slots represent weekday shifts. Currently, doctor edits in staff portal and slot calculations in patient portal mutate `localStorage.primecare_doctors`.
- **Permissions:** Admin has full CRUD; Staff has read-only; Patients have read-only access to active doctors and schedules.
- **Dependencies:** User table (`users.id` can link to a doctor's portal account). Prerequisite for Appointments and all clinical modules.

### 3.2 Appointments & Booking
- **Frontend Controllers:** `staff/appointments.html`, `js/appointments.js`, `patient/book-appointment.html`, `js/patient-booking.js`, `patient/telehealth.html`, `js/telehealth.js`
- **Existing API Methods:** `searchAppointments(filters)`, `bookAppointment(data)`, `rescheduleAppointment(id, date, time)`, `cancelAppointment(id, reason)`, `updateAppointmentStatus(id, status)`, `getTodaysAppointments()`, `getAppointmentsPerDay()`, `getMyAppointments()`, `bookMyAppointment()`, `rescheduleMyAppointment()`, `cancelMyAppointment()`
- **Database Tables:** `appointments` (2 rows), `pre_visit_forms` (0 rows)
- **Foreign Keys:** `appointments.patient_id -> patients.id`, `appointments.doctor_id -> doctors.id`, `appointments.created_by -> users.id`, `appointments.bill_id -> bills.id`
- **Permissions:** Admin/Staff (full management), Doctor (view assigned appointments), Patient (view/book/reschedule/cancel own appointments).
- **Security & Privacy:** Patients must only access their own appointments (IDOR guard). Slot locking is needed to prevent double booking.
- **Dependencies:** `patients` (migrated), `doctors` (requires migration), `doctor_schedules` (requires migration).

### 3.3 Medical Records (EHR) & Clinical Notes
- **Frontend Controllers:** `staff/medical-records.html`, `js/medical-records.js`, `patient/my-records.html`, `js/my-records.js`
- **Existing API Methods:** `getMedicalRecords(filters)`, `getMedicalRecordById(id)`, `getPatientMedicalHistory(patientId)`, `saveMedicalRecord(record)`, `saveVitals(patientId, vitals)`, `getMyMedicalRecords()`
- **Database Tables:** `medical_records` (1 row), `medical_record_history` (0 rows)
- **Foreign Keys:** `medical_records.patient_id -> patients.id`, `medical_records.attending_doctor_id -> doctors.id`, `medical_records.appointment_id -> appointments.id`, `medical_records.created_by -> users.id`
- **Permissions:** Doctor & Admin can create/edit; Nurse can log vitals; Patient can read own records; Staff has no clinical access.
- **Security & Privacy:** Highly sensitive PHI. Strict patient isolation. Audit logging required whenever clinical notes are edited or viewed.
- **Dependencies:** `patients` (migrated), `doctors` (unmigrated), `appointments` (unmigrated).

### 3.4 Prescriptions & Pharmacy
- **Frontend Controllers:** `staff/prescriptions.html`, `js/prescriptions.js`, `patient/my-records.html`
- **Existing API Methods:** `getPrescriptions(filters)`, `getPrescriptionById(id)`, `checkAllergyConflict(patientId, medName)`, `createPrescription(data)`, `updatePrescriptionStatus(id, status)`, `getMyPrescriptions()`
- **Database Tables:** `prescriptions` (1 row), `prescription_items` (1 row)
- **Foreign Keys:** `prescriptions.patient_id -> patients.id`, `prescriptions.doctor_id -> doctors.id`, `prescriptions.medical_record_id -> medical_records.id`, `prescription_items.prescription_id -> prescriptions.id`
- **Permissions:** Doctor creates prescriptions; Nurse/Staff updates status (e.g., Dispensed); Patient reads own prescriptions.
- **Business Logic:** Must check patient known allergies (`patients.allergies`) and warn or require override flags when conflicting drugs are prescribed.
- **Dependencies:** `patients` (migrated), `doctors` (unmigrated), `medical_records` (optional linkage).

### 3.5 Laboratory Results
- **Frontend Controllers:** `staff/lab-results.html`, `js/lab-results.js`, `patient/my-records.html`
- **Existing API Methods:** `getLabResults(filters)`, `getLabResultById(id)`, `getCriticalLabResults()`, `orderLabTest(data)`, `saveLabResult(id, data)`, `getMyLabResults()`
- **Database Tables:** `lab_results` (2 rows)
- **Foreign Keys:** `lab_results.patient_id -> patients.id`, `lab_results.ordered_by -> doctors.id`, `lab_results.bill_id -> bills.id`
- **Permissions:** Doctor orders tests; Nurse/Doctor enters results and attaches files; Patient views completed results.
- **Business Logic:** Automated flag assignment (`Normal`, `Abnormal`, `Critical`) based on numeric min/max reference ranges. Triggers notifications when critical.
- **Dependencies:** `patients` (migrated), `doctors` (unmigrated).

### 3.6 Wards, Beds & Inpatient Admissions
- **Frontend Controllers:** `staff/wards.html`, `js/wards.js`, `patient/my-records.html`
- **Existing API Methods:** `getWards()`, `getBeds(filters)`, `getWardOccupancy()`, `getAdmissions(filters)`, `admitPatient(data)`, `transferPatient(admissionId, newBedId)`, `dischargePatient(admissionId, summary)`, `setBedStatus(bedId, status)`, `getMyAdmissions()`
- **Database Tables:** `wards` (5 rows), `beds` (30 rows), `admissions` (1 row)
- **Foreign Keys:** `beds.ward_id -> wards.id`, `beds.current_patient_id -> patients.id`, `admissions.patient_id -> patients.id`, `admissions.bed_id -> beds.id`, `admissions.attending_doctor_id -> doctors.id`
- **Permissions:** Nurse & Admin manage admissions, transfers, and bed maintenance; Doctor views admissions and writes discharge summaries.
- **Integrity Requirement:** Multi-table ACID transaction: Updating `admissions.status = 'Discharged'` must atomically clear `beds.current_patient_id` and set `beds.status = 'Available'`.
- **Dependencies:** `patients` (migrated), `doctors` (unmigrated).

### 3.7 Billing, Invoicing & Payments
- **Frontend Controllers:** `staff/billing.html`, `js/billing.js`, `patient/my-bills.html`, `js/patient-bills.js`
- **Existing API Methods:** `getBills(filters)`, `getBillById(id)`, `previewBillCharges(admissionId/appointmentId)`, `createBill(data)`, `addBillItem(billId, item)`, `removeBillItem(billId, itemId)`, `recordPayment(data)`, `voidBill(id, reason)`, `getReceipt(receiptNo)`, `getBillingSummary()`, `getMyBills()`, `getMyBillById(id)`, `payMyBill(data)`, `requestPaymentPlan(data)`
- **Database Tables:** `bills` (2 rows), `bill_items` (4 rows), `payments` (1 row), `payment_plan_requests` (0 rows), `service_catalog` (15 rows)
- **Foreign Keys:** `bills.patient_id -> patients.id`, `bills.admission_id -> admissions.id`, `bill_items.bill_id -> bills.id`, `payments.bill_id -> bills.id`
- **Permissions:** Staff & Admin manage billing and accept payments; Patient can view bills, simulate online payments, and request payment plans.
- **Financial Integrity:** Senior/PWD mandatory 20% discount calculations, PhilHealth deductions, non-negative balance constraints, sequence allocation for `REC-` receipt numbers.
- **Dependencies:** `patients` (migrated), `admissions` (unmigrated), `appointments` (unmigrated), `prescriptions` (unmigrated).

### 3.8 Reports & Analytics
- **Frontend Controllers:** `staff/reports.html`, `js/reports.js`, `staff/dashboard.html`, `js/dashboard.js`
- **Existing API Methods:** `generateReport(type, dateFrom, dateTo)`, `getBillingSummary()`, `getWardOccupancy()`, `getAppointmentsPerDay()`, `getTodaysAppointments()`
- **Database Tables:** Aggregates across `appointments`, `bills`, `admissions`, `patients`, and `audit_logs`.
- **Permissions:** Admin & Staff.
- **Dependencies:** Cannot be cleanly migrated until the underlying source tables (appointments, billing, admissions) store live production data in MariaDB.

### 3.9 User Management & Administration
- **Frontend Controllers:** `staff/user-management.html`, `js/user-management.js`
- **Existing API Methods:** `getUsers(filters)`, `getUserById(id)`, `saveUser(data)`, `setUserStatus(id, status)`, `changeUserRole(id, role)`, `resetUserPassword(id)`, `deleteUser(id)`, `getAuditLog(filters)`
- **Database Tables:** `users` (7 rows), `audit_logs` (296 rows)
- **Foreign Keys:** `users.created_by -> users.id`, `audit_logs.user_id -> users.id`
- **Permissions:** Strictly Admin only.
- **Current State:** `users` is already used by `api/auth/login.php` and `api/patients/register.php`. However, administrative operations (creating a staff user, toggling active/inactive status, changing roles, resetting passwords) still write to `localStorage.primecare_users`.
- **Dependencies:** None. `users` table already exists.

---

## 4. Integration Risks & Technical Assessment

```
                      ┌──────────────────────┐
                      │    Phase 5.1 & 5.2   │
                      │  Auth & Core Config  │
                      └──────────┬───────────┘
                                 │
                      ┌──────────▼───────────┐
                      │      Phase 5.3       │
                      │  Patient Management  │
                      └──────────┬───────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │ (Prerequisite for all Doctor FKs)   │
              ▼                                     ▼
   ┌──────────────────────┐              ┌──────────────────────┐
   │      Phase 5.5       │              │      Phase 5.9       │
   │ Doctors & Schedules  │              │   User Management    │
   └──────────┬───────────┘              └──────────────────────┘
              │
              ├─────────────────────────────────────┐
              ▼                                     ▼
   ┌──────────────────────┐              ┌──────────────────────┐
   │      Phase 5.6       │              │      Phase 5.7       │
   │ Appointments & Slots │              │ Wards & Admissions   │
   └──────────┬───────────┘              └──────────┬───────────┘
              │                                     │
              ├──────────────────┐                  │
              ▼                  ▼                  ▼
   ┌──────────────────────┐   ┌─────────────────────────────────┐
   │      Phase 5.8       │   │           Phase 5.10            │
   │ Clinical EHR & Labs  │   │       Billing & Payments        │
   │ (Records, Rx, Labs)  │   │  (Bills, Items, Receipts, PhilH)│
   └──────────────────────┘   └─────────────────┬───────────────┘
                                                │
                                                ▼
                                     ┌──────────────────────┐
                                     │      Phase 5.11      │
                                     │ Reports & Dashboards │
                                     └──────────────────────┘
```

### 4.1 Foreign Key Blockers & Data Integrity
MariaDB enforces foreign key checks on `primecare_db`. If an unmigrated module inserts records into MariaDB while referencing mock IDs:
- In `appointments`, `doctor_id` must match a valid `doctors.id`.
- In `medical_records`, `attending_doctor_id` must match `doctors.id`.
- In `admissions`, `attending_doctor_id` must match `doctors.id`.
- In `lab_results`, `ordered_by` must match `doctors.id`.
**Migrating Doctors first permanently resolves the root foreign key dependency for the entire clinical system.**

### 4.2 Temporary Mock Join Overhead
`js/api.js` currently relies on `_getPatientsListForMockJoin()` to fetch live patient records from PHP and merge them with unmigrated localStorage arrays. While this keeps the frontend operational, it causes redundant HTTP traffic and cannot perform relational SQL queries. Migrating subsequent modules will eliminate this adapter piece by piece.

### 4.3 Patient Data Isolation (IDOR)
In patient-facing portals (`patient/book-appointment.html`, `patient/my-records.html`, `patient/my-bills.html`), the backend must never trust patient IDs passed in GET query parameters or POST bodies. Like in Phase 5.3 (`api/patients/get.php`), every endpoint must resolve `patient_id` from the authenticated session (`findPatientByUserId($_SESSION['user_id'])`).

---

## 5. Recommended Implementation Roadmap

| Phase | Module Name | Primary Objective & Scope | Rationale |
| :---: | :--- | :--- | :--- |
| **5.5** | **Doctor Management & Schedules** | • Doctor directory & profiles<br>• Weekly schedule management<br>• Dynamic slot generation engine | **Essential blocker:** Required by Appointments, Clinical Records, Admissions, and Billing FKs. Schema already complete. |
| **5.6** | **Appointments & Scheduling** | • Staff appointment scheduling<br>• Patient online appointment booking<br>• Slot conflict validation & cancellation | Relies on Patients (Phase 5.3) and Doctors (Phase 5.5). Highest customer-facing feature. |
| **5.7** | **Wards, Beds & Admissions** | • Ward & bed real-time occupancy<br>• Inpatient admission & transfers<br>• Discharge summaries with bed clearance | Self-contained inpatient workflow. Direct feeder into inpatient billing. |
| **5.8** | **Clinical Modules (EHR, Rx, Labs)** | • Medical records & vitals history<br>• Prescriptions with allergy checks<br>• Lab orders & critical value flags | Core hospital clinical workflow; references patients, doctors, and appointments. |
| **5.9** | **User Management & Audit Logs** | • Staff account administration<br>• Role switching & password resets<br>• Full system audit log viewing | Administrative control; users table already established by Auth. |
| **5.10** | **Billing & Financials** | • Outpatient & Inpatient bill creation<br>• Senior/PWD discount & PhilHealth rules<br>• Payment recording & receipt generation | Financial ledger; requires settled appointments, admissions, lab orders, and prescriptions. |
| **5.11** | **Reports & Dashboard Analytics** | • Live SQL aggregations for KPI cards<br>• Financial and occupancy reports<br>• CSV/Printable export routines | Must run against live production data across all tables. |

---

## 6. Recommended Next Phase: Phase 5.5 Scope & Acceptance Criteria

### 6.1 Phase 5.5 Recommended Scope: Doctor Management & Scheduling
1. **PHP Endpoints (`api/doctors/`):**
   - `list.php`: Search and filter doctors by department, specialization, status, and insurance.
   - `get.php`: Retrieve complete doctor profile with parsed schedule and qualifications.
   - `save.php`: Create or update doctor profile (admin-only, with photo initials auto-generation).
   - `delete.php`: Soft/hard delete doctor (with check for existing appointments/records).
   - `schedule.php`: Manage weekly shift schedules per doctor (`doctor_schedules`).
   - `slots.php`: Public/patient endpoint that takes `doctor_id` and `date`, inspects existing `appointments` in the database, and returns available 30-minute booking slots.
2. **Backend Helper:**
   - Create `api/helpers/doctors.php` containing serializing functions, slot calculation logic, and foreign key verification.
3. **Frontend Integration:**
   - Enable `api._backendConfig.modules.doctors = true`.
   - Connect `js/doctor-management.js`, `doctors.html`, and the doctor selection step of `patient/book-appointment.html`.

### 6.2 Acceptance Criteria for Phase 5.5
- [ ] `GET api/doctors/list.php` returns all active doctors with schedule arrays and JSON fields cleanly decoded.
- [ ] `POST api/doctors/save.php` requires Admin role and CSRF validation, updating `doctors` and `doctor_schedules`.
- [ ] `GET api/doctors/slots.php?doctor_id=D-001&date=YYYY-MM-DD` dynamically returns available time slots according to the doctor's day-of-week shift.
- [ ] Unauthenticated public users can view active doctors on `doctors.html`.
- [ ] All 55 Phase 5.3 patient smoke tests and 78 auth smoke tests continue to pass with 0 regressions.

---

## 7. Open Decisions for Project Stakeholders

1. **Doctor Account Linkage:** `doctors.user_id` allows linking a doctor profile to a login in `users`. Should creating a doctor automatically generate a doctor user account, or should account creation remain a separate manual admin step?
2. **Department Management:** Currently `departments` has 6 static rows. Should department CRUD be exposed to Admins, or treated as standard hospital configuration?
3. **Slot Interval Customization:** Currently defaults to 30 minutes (`slot_minutes = 30`). Should doctors be allowed custom intervals (e.g., 15 or 45 mins), or remain fixed at 30 minutes?

