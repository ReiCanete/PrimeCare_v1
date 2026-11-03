# PrimeCare — Phase 5.6.1: Appointment Management & Online Booking Backend Readiness Audit

**Date:** November 3, 2026  
**Project Directory:** `C:\xampp\htdocs\PrimeCare_v1`  
**Database:** `primecare_db` (MariaDB / MySQL via XAMPP)  
**Phase Type:** Audit & Planning Only (Zero Code or Database Modifications)

---

## 1. Current Implementation Overview

### 1.1 Architecture & Migration State
Following the completion of Phases 5.1 through 5.5:
- **Migrated to PHP/MySQL:**
  - Authentication, Sessions, RBAC & CSRF (`_backendConfig.modules.auth = true` via `api/auth/*.php`)
  - Patient Management & Verification (`_backendConfig.modules.patients = true` via `api/patients/*.php`)
  - Doctor Management, Departments & Weekly Schedules (`_backendConfig.modules.doctors = true` via `api/doctors/*.php`)
- **Still Operating on `localStorage` (`_backendConfig.modules.appointments = false` & `patientPortal = false`):**
  - Staff Appointment Management ([`staff/appointments.html`](file:///c:/xampp/htdocs/PrimeCare_v1/staff/appointments.html), [`js/appointments.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js))
  - Patient Online Booking & My Appointments ([`patient/book-appointment.html`](file:///c:/xampp/htdocs/PrimeCare_v1/patient/book-appointment.html), [`js/patient-booking.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/patient-booking.js))
  - Telehealth Lobby & Pre-Visit Questionnaires ([`patient/telehealth.html`](file:///c:/xampp/htdocs/PrimeCare_v1/patient/telehealth.html), [`js/telehealth.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/telehealth.js))
  - Cross-module appointment consumers (Dashboard KPIs/charts, Patient Records modal history, Medical Records linkage, Billing unbilled consultation fees, Reports).

### 1.2 Staff Appointment Management (`staff/appointments.html` + `js/appointments.js`)
- **Listing & Filtering:**
  - Calls [`api.searchAppointments(state)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L1333-L1365) with `{ keyword, status, doctorId, type, dateFrom, dateTo, sortBy, sortDir }`.
  - Also calls `api.searchAppointments({ ...state, status: 'All' })` to populate the 5 status filter chip counters (`All`, `Pending`, `Confirmed`, `Completed`, `Cancelled`).
  - **Role Scoping in UI:** When a user with `role === 'doctor'` opens [`staff/appointments.html`](file:///c:/xampp/htdocs/PrimeCare_v1/staff/appointments.html), [`initUI()`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js#L27-L34) matches `d.userId === user.id` (`D-001` for `U-002`) and locks the `#filter-doc` dropdown to that doctor's ID. `admin`, `staff`, and `nurse` roles can view all doctors' appointments.
- **Appointment Creation (Staff Walk-In / Assisted Booking):**
  - Only `admin` and `staff` see the `+ New Appointment` button (`.admin-staff-only`).
  - Populates `#b-patient` with verified patients (`api.searchPatients({ status: 'verified' })`) and `#b-doctor` grouped by specialization (`api.getDoctorsBySpecialization()`).
  - Selecting a doctor and date triggers [`loadSlots()`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js#L184-L209) → [`api.getAvailableSlots(docId, dateStr)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L1300-L1332).
  - Submitting calls [`api.bookAppointment(data)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L1366-L1400). Because the caller is `admin` or `staff`, the initial appointment status is automatically set to `'Confirmed'`.
- **Rescheduling (`openReschedule` / `rescheduleAppointment`):**
  - Staff can reschedule `'Pending'` or `'Confirmed'` appointments.
  - **Critical Flaw in Current Mock Implementation:** [`api.rescheduleAppointment(id, newDate, newTime)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L1401-L1417) temporarily marks the existing appointment as `'Cancelled'`, calls `this.bookAppointment(...)` (which allocates a **brand-new appointment ID** `A-XXX`), and then **deletes** the original appointment record (`this.remove('appointments', id)`). In MySQL, deleting and recreating an appointment on reschedule would break primary key continuity, destroy `pre_visit_forms` (`ON DELETE CASCADE`), and lose `created_by` / `created_at` history. Furthermore, when a patient reschedules a `'Confirmed'` appointment through the current mock [`rescheduleMyAppointment`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L2241-L2252), `bookAppointment` resets the status to `'Pending'` or changes the ID.
- **Cancellation (`promptCancel` / `cancelAppointment`):**
  - Requires a cancellation reason of at least 5 characters (`reason.length >= 5`).
  - Rejects cancelling an already `'Completed'` appointment.
  - Sets `status = 'Cancelled'`, `cancelReason = reason`, and `updatedAt`.
  - **Bug Discovered in `staff/appointments.html` vs `js/appointments.js`:**
    - In [`staff/appointments.html`](file:///c:/xampp/htdocs/PrimeCare_v1/staff/appointments.html#L138-L141), the cancel modal inputs have IDs **`can-id`** and **`can-reason`**.
    - However, in [`js/appointments.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js#L259-L268), `promptCancel(id)` and `submitCancel()` reference `document.getElementById('c-id')` and `document.getElementById('c-reason')` (`null` DOM elements!), causing a `TypeError: Cannot set properties of null (setting 'value')` whenever staff click "Cancel" on the Appointments page.
- **Status Transitions (`updateAppointmentStatus`):**
  - `admin` and `staff` can transition `'Pending'` → `'Confirmed'` (from [`js/appointments.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js#L128)) or use the status dropdown on [`staff/dashboard.html`](file:///c:/xampp/htdocs/PrimeCare_v1/js/dashboard.js#L140-L145) (`Confirmed`, `Completed`, `Cancelled`).
  - `doctor` can transition `'Confirmed'` → `'Completed'` (from [`js/appointments.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js#L134-L136)).
  - Rejects transitions out of terminal states (`'Cancelled'` or `'Completed'`).

### 1.3 Patient Online Booking (`patient/book-appointment.html` + `js/patient-booking.js`)
- **Verification Gate:**
  - [`initUI()`](file:///c:/xampp/htdocs/PrimeCare_v1/js/patient-booking.js#L17-L42) checks `api._getPatientContext()`. Unverified (`pending` or `rejected`) patients see `#locked-state` instead of `#booking-wizard`.
- **Step 1 — Doctor & Specialty Selection:**
  - Fetches active doctors via `api.getDoctors()`, filters by specialization (`#b-spec`), and sorts doctors by earliest upcoming availability using [`utils.getNextDoctorAvailability(d)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/app.js#L253-L355).
  - Supports deep-linking from the public/portal doctor directory via `?doctor=D-XXX`.
- **Step 2 — Date & Slot Selection:**
  - Displays a 7-day rolling schedule overview (`renderDoctorScheduleOverview`) and restricts `#b-date` between `today` and `today + 60 days`.
  - Calls [`api.getAvailableSlots(selectedDoctor.id, dateStr)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L1300-L1332) to render time slot buttons at intervals of `doc.slotMinutes` (`15`, `20`, `30`, `45`, or `60` mins).
- **Step 3 & 4 — Visit Details & Confirmation:**
  - Patient selects `type` (`'in-person'` or `'telehealth'`) and enters `reason` (enforced `>= 10` characters for patient self-booking vs `>= 1` character for staff booking).
  - Submitting calls [`api.bookMyAppointment(data)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L2220-L2239), which enforces:
    1. Authenticated patient context (`requireWrite = true`, blocking staff preview mode).
    2. `patient.status === 'verified'`.
    3. `reason.length >= 10`.
    4. `date <= today + 60 days`.
    5. Maximum of **3 active upcoming appointments** (`date >= today` and `status NOT IN ('Cancelled', 'Completed')`).
    6. Delegates to `bookAppointment()`, which creates the appointment with `status = 'Pending'`.
- **My Appointments Tab (`upcoming`, `past`, `cancelled`):**
  - Calls [`api.getMyAppointments({ scope })`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L2203-L2218).
  - Enforces a **24-hour lock window**: patients can only reschedule ([`rescheduleMyAppointment`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L2241-L2252)) or cancel ([`cancelMyAppointment`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L2254-L2265)) if the appointment date/time is more than 24 hours in the future (`apptDate - now >= 24h`).

### 1.4 Telehealth & Pre-Visit Questionnaire (`patient/telehealth.html` + `js/telehealth.js`)
- **Telehealth Lobby:**
  - Calls [`api.getMyTelehealthAppointments()`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L2393-L2402) to list the patient's upcoming (`date >= today`) telehealth appointments with status `'Confirmed'` or `'Pending'`.
  - For each card, calls [`api.getPreVisitForm(a.id)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L2418-L2420) to check if the pre-visit questionnaire is completed.
- **Pre-Visit Form Fields & Mismatch Between UI and Schema:**
  - In [`patient/telehealth.html`](file:///c:/xampp/htdocs/PrimeCare_v1/patient/telehealth.html#L92-L117) and [`js/telehealth.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/telehealth.js#L94-L123), the modal collects:
    - `symptoms` (`#pv-symptoms`, required, `>= 5` chars)
    - `symptomDuration` (`#pv-duration`, text e.g. `"3 days"`)
    - `temperatureC` (`#pv-temp`, number step `0.1`, e.g. `36.5`)
    - `currentMedications` (`#pv-meds`, textarea)
    - `allergies` (`#pv-allergies`, readonly input prefilled from `myPatientProfile.allergies`, **not included** in the `data` payload sent by `submitPreVisit()`!)
    - `consent` (`#pv-consent`, boolean checkbox, required `true`)
  - **Join Call Gate ([`api.canJoinTelehealth(appointmentId)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L2422-L2441)):**
    - Verifies patient ownership (`appt.patientId === ctx.patient.id`), `appt.status === 'Confirmed'`, pre-visit form exists, and current time is within `[-15 mins before, +30 mins after]` the scheduled time.
  - **Staff Access Gap:** Currently, there is **no UI or API method** for doctors/nurses/staff to view a patient's submitted `pre_visit_forms` record when viewing a telehealth appointment in [`staff/appointments.html`](file:///c:/xampp/htdocs/PrimeCare_v1/staff/appointments.html#L150-L172). Including `preVisitForm` in the appointment detail payload (`api/appointments/get.php` and `api/appointments/list.php`) will allow both patient telehealth checks and clinical/staff review to work seamlessly.

---

## 2. Existing Database Structure (Verified Against Live `primecare_db`)

### 2.1 `appointments` Table
Verified via `SHOW CREATE TABLE appointments` on live `primecare_db`:

```sql
CREATE TABLE `appointments` (
  `id` varchar(20) NOT NULL,
  `patient_id` varchar(20) NOT NULL,
  `doctor_id` varchar(20) NOT NULL,
  `appointment_date` date NOT NULL,
  `appointment_time` time NOT NULL,
  `type` enum('in-person','telehealth') NOT NULL DEFAULT 'in-person',
  `status` enum('Pending','Confirmed','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  `reason` text NOT NULL,
  `notes` text DEFAULT NULL,
  `cancel_reason` text DEFAULT NULL,
  `billed` tinyint(1) NOT NULL DEFAULT 0,
  `bill_id` varchar(20) DEFAULT NULL,
  `created_by` varchar(20) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_appointments_doctor_slot` (`doctor_id`,`appointment_date`,`appointment_time`),
  KEY `idx_appointments_patient_date` (`patient_id`,`appointment_date`),
  KEY `idx_appointments_status_date` (`status`,`appointment_date`),
  KEY `idx_appointments_bill` (`bill_id`),
  KEY `fk_appointments_created_by` (`created_by`),
  CONSTRAINT `fk_appointments_bill` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_appointments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_appointments_doctor` FOREIGN KEY (`doctor_id`) REFERENCES `doctors` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_appointments_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Live Seeded Rows in `appointments` (2 rows):**
| `id` | `patient_id` | `doctor_id` | `appointment_date` | `appointment_time` | `type` | `status` | `reason` | `billed` | `bill_id` | `created_by` |
|---|---|---|---|---|---|---|---|---|---|---|
| `A-001` | `P-001` | `D-001` | `2026-11-02` | `09:00:00` | `in-person` | `Completed` | Routine eye checkup | `1` | `B-001` | `U-001` |
| `A-002` | `P-001` | `D-002` | `2026-11-04` | `10:00:00` | `telehealth` | `Confirmed` | Follow-up on heart palpitations | `0` | `NULL` | `U-005` |

**Sequence State in `sequences`:**
- `entity_key = 'appointments'`, `prefix = 'A'`, `current_val = 2`, `pad_length = 3` (next allocated ID will be `A-003`).

### 2.2 `pre_visit_forms` Table
Verified via `SHOW CREATE TABLE pre_visit_forms` on live `primecare_db`:

```sql
CREATE TABLE `pre_visit_forms` (
  `id` varchar(30) NOT NULL,
  `appointment_id` varchar(20) NOT NULL,
  `symptoms` text NOT NULL,
  `duration` varchar(100) DEFAULT NULL,
  `medications` text DEFAULT NULL,
  `allergies` text DEFAULT NULL,
  `consent` tinyint(1) NOT NULL DEFAULT 1,
  `submitted_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pre_visit_appointment` (`appointment_id`),
  CONSTRAINT `fk_pre_visit_appointment` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Live Seeded Rows in `pre_visit_forms`:** `0` rows.

### 2.3 Column Mapping & Schema Observations
1. **Column Name Differences (MySQL `snake_case` vs Frontend `camelCase`):**
   - `appointments.appointment_date` (`DATE`) ↔ `date` (`YYYY-MM-DD`)
   - `appointments.appointment_time` (`TIME`, e.g., `'09:00:00'`) ↔ `time` (`HH:MM`, e.g., `'09:00'` — **critical**: frontend slot comparisons `a.time === timeStr` and `new Date(a.date + 'T' + a.time)` expect 5-char `'HH:MM'`, so the serializer must format `appointment_time` as `substr($row['appointment_time'], 0, 5)` while optionally exposing `appointmentTime` too).
   - `appointments.cancel_reason` ↔ `cancelReason`
   - `appointments.bill_id` ↔ `billId`
   - `appointments.created_by` ↔ `createdBy`
   - `appointments.created_at` / `updated_at` (`DATETIME`) ↔ `createdAt` / `updatedAt`
2. **`pre_visit_forms` Field Mapping (`js/telehealth.js` vs MySQL):**
   - `js/telehealth.js` sends `{ symptoms, symptomDuration, currentMedications, temperatureC, consent }`.
   - `pre_visit_forms` has columns `symptoms`, `duration`, `medications`, `allergies`, `consent`, `submitted_at`.
   - Notice `temperatureC` is collected in `#pv-temp` on [`patient/telehealth.html`](file:///c:/xampp/htdocs/PrimeCare_v1/patient/telehealth.html#L103), but `pre_visit_forms` does not have a dedicated `temperature` column. To preserve `temperatureC` without altering the database schema, the backend helper can either store temperature inside `duration` / `symptoms` metadata or map `duration` ↔ `symptomDuration`, `medications` ↔ `currentMedications`, and auto-populate `allergies` from the patient's MySQL record (`patients.allergies`) if not passed.
3. **Index & Uniqueness Analysis on `appointments`:**
   - `idx_appointments_doctor_slot (doctor_id, appointment_date, appointment_time)` is a **non-unique** composite index. This is intentional and necessary because a slot may have one or more historical `'Cancelled'` appointments at the same `(doctor_id, appointment_date, appointment_time)` before another patient books that slot.
   - Because a standard SQL `UNIQUE` index on `(doctor_id, appointment_date, appointment_time)` would block re-booking a cancelled slot, double-booking prevention must be enforced **transactionally in PHP using row locking** (`SELECT ... FOR UPDATE` on the doctor row and/or active slot check inside a PDO transaction).

---

## 3. Files Requiring Modification in Phase 5.6.2

### 3.1 New Backend Files to Create (`api/`)
1. `api/helpers/appointments.php` — Shared appointment & pre-visit form serializers, slot calculation engine against `doctors` + `doctor_schedules` + `appointments`, transactional slot lock/conflict checker, and status transition validator.
2. `api/appointments/slots.php` — `GET` endpoint returning available/unavailable time slots for a `doctorId` and `date` (with optional `excludeAppointmentId` for rescheduling).
3. `api/appointments/list.php` — `GET` endpoint for listing, searching, filtering, sorting, and counting appointments (role-scoped for `admin`/`staff`/`nurse`, `doctor`, and `patient`).
4. `api/appointments/get.php` — `GET` endpoint retrieving a single appointment by `id` (including joined patient/doctor info and any `pre_visit_forms` record), enforcing patient ownership.
5. `api/appointments/create.php` — `POST` endpoint (`requireAuth()` + `requireCsrf()`) for creating new appointments (supports both staff walk-in/assisted booking and patient online self-booking with role-specific rules).
6. `api/appointments/reschedule.php` — `POST` endpoint (`requireAuth()` + `requireCsrf()`) that updates `appointment_date` and `appointment_time` **in-place** (preserving `appointments.id` and `pre_visit_forms` linkage) inside a transaction.
7. `api/appointments/status.php` — `POST` endpoint (`requireAuth()` + `requireCsrf()`) handling status transitions (`Confirm`, `Complete`, `Cancel` with `cancelReason`), role authorization, and 24-hour patient cancellation rules.
8. `api/appointments/pre-visit.php` — `GET` and `POST` endpoint (`requireAuth()`, `requireCsrf()` on `POST`) for retrieving and submitting telehealth pre-visit questionnaires (`pre_visit_forms`) and evaluating `canJoinTelehealth` server-side.
9. `tests/appointment-smoke-test.mjs` — Automated end-to-end smoke test suite for Phase 5.6.2.

### 3.2 Existing Files Requiring Modification
1. [`js/api.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js):
   - Set `_backendConfig.modules.appointments = true`.
   - Add `_syncAppointmentCache()` and `_getAppointmentsListForMockJoin()` so unmigrated modules (`getStats`, `getAppointmentsPerDay`, `getRecentActivity`, `previewBillCharges`, `createBill`, `generateReport`, `deleteUser`, `deletePatient`) seamlessly read live MySQL appointments.
   - Migrate:
     - `getAvailableSlots(doctorId, dateString)`
     - `searchAppointments(filters)`
     - `getAppointmentById(id)` (and support `getById('appointments', id)` callers)
     - `bookAppointment(data)`
     - `rescheduleAppointment(id, newDate, newTime)`
     - `cancelAppointment(id, reason)`
     - `updateAppointmentStatus(id, status)`
     - `getTodaysAppointments()`
     - `getAppointmentsPerDay(days)`
     - `getPatientSummary(id)` (use live MySQL appointments for the patient)
     - `getMyDashboard()` (use live MySQL upcoming appointments for the patient)
     - `getMyAppointments(filters)`
     - `bookMyAppointment(data)`
     - `rescheduleMyAppointment(id, newDate, newTime)`
     - `cancelMyAppointment(id, reason)`
     - `getMyTelehealthAppointments()`
     - `submitPreVisitForm(appointmentId, form)`
     - `getPreVisitForm(appointmentId)`
     - `canJoinTelehealth(appointmentId)`
2. [`js/appointments.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js):
   - **Fix Cancel Modal DOM ID Bug (Lines 259–268):** Update `promptCancel(id)` and `submitCancel()` to use `can-id` and `can-reason` (matching [`staff/appointments.html`](file:///c:/xampp/htdocs/PrimeCare_v1/staff/appointments.html#L138-L141)) instead of `c-id` and `c-reason`, and display validation errors in `can-alert`.
   - Update `openReschedule(id)` (line 171) and `viewAppt(id)` (line 279) to call `await api.getAppointmentById(id)` (or `api.getById('appointments', id)` backed by cache/API) so fresh MySQL appointment details are loaded even if `localStorage` is empty.

---

## 4. Missing Backend Endpoints & Specifications

| Endpoint | Method | Roles Allowed | Purpose & Key Parameters |
|---|---|---|---|
| `api/appointments/slots.php` | `GET` | `requireAuth()` (All authenticated roles) | Params: `doctorId`, `date` (`YYYY-MM-DD`), optional `excludeId` (`A-XXX`). Queries `doctors` (`status = 'active'`, `slot_minutes`), `doctor_schedules` for that weekday, and active (`status != 'Cancelled'`) rows in `appointments` for `(doctor_id, appointment_date)`. Returns `{ slots: [{ time: '09:00', available: true|false }, ...] }`. |
| `api/appointments/list.php` | `GET` | `requireAuth()` (`admin`, `staff`, `nurse`, `doctor`, `patient`) | Params: `keyword`, `doctorId`, `patientId`, `status`, `type`, `dateFrom`, `dateTo`, `scope` (`upcoming` \| `past` \| `cancelled` \| `telehealth`), `sortBy`, `sortDir`. Returns `{ appointments: [...], counts: { all, pending, confirmed, completed, cancelled } }`. |
| `api/appointments/get.php` | `GET` | `requireAuth()` | Params: `id` (`A-XXX`). Returns `{ appointment: { ..., preVisitForm: {...}|null } }`. Enforces IDOR protection so `patient` can only view their own appointment. |
| `api/appointments/create.php` | `POST` | `requireAuth()` (`admin`, `staff`, `patient`) + `requireCsrf()` | Body: `{ patientId?, doctorId, date, time, type, reason, notes? }`. If `role === 'patient'`, forces `patientId` to session's linked patient, enforces 60-day horizon, `reason >= 10` chars, max 3 active upcoming appointments, and `status = 'Pending'`. If `role IN ('admin', 'staff')`, creates with `status = 'Confirmed'`. |
| `api/appointments/reschedule.php` | `POST` | `requireAuth()` (`admin`, `staff`, `patient`) + `requireCsrf()` | Body: `{ id, date, time }`. Updates `appointment_date`, `appointment_time`, and `updated_at` **in-place** on the existing `A-XXX` row after verifying slot availability and 24-hour rule (for patients). |
| `api/appointments/status.php` | `POST` | `requireAuth()` (`admin`, `staff`, `doctor`, `patient`) + `requireCsrf()` | Body: `{ id, status, cancelReason? }`. Validates state transitions (`Pending` → `Confirmed`/`Cancelled`, `Confirmed` → `Completed`/`Cancelled`), role permissions, and `cancelReason` (`>= 5` chars). |
| `api/appointments/pre-visit.php` | `GET`, `POST` | `requireAuth()` (`POST` requires `patient` + `requireCsrf()`) | `GET ?appointmentId=A-XXX`: returns `{ preVisitForm, canJoin: { allowed, reason, minutesUntil } }`. `POST`: validates ownership, appointment type (`telehealth`), symptoms (`>= 5` chars), and consent (`true`), then upserts into `pre_visit_forms`. |

---

## 5. Security, Race Conditions & Validation Concerns

### 5.1 Race Condition / Double-Booking Prevention (TOCTOU)
- **Vulnerability:** In a naive implementation, checking `getAvailableSlots()` and then running `INSERT INTO appointments` allows two concurrent requests (e.g., two patients or a staff member and a patient clicking "Confirm Booking" at the same millisecond) to book the exact same `(doctor_id, appointment_date, appointment_time)` slot.
- **Mitigation:** Inside `create.php` and `reschedule.php`, open a PDO transaction (`$pdo->beginTransaction()`), acquire an exclusive row lock on the target doctor row (`SELECT id, status, slot_minutes FROM doctors WHERE id = :did FOR UPDATE`), serialize all concurrent booking attempts for that doctor, and then execute:
  1. `SELECT COUNT(*) FROM appointments WHERE doctor_id = :did AND appointment_date = :date AND appointment_time = :time AND status != 'Cancelled' AND id != :exclude_id FOR UPDATE` (reject with `409 Conflict` if `> 0`).
  2. `SELECT COUNT(*) FROM appointments WHERE patient_id = :pid AND appointment_date = :date AND appointment_time = :time AND status != 'Cancelled' AND id != :exclude_id FOR UPDATE` (reject with `409 Conflict` if the patient already has another appointment at the exact same date & time).

### 5.2 IDOR & Ownership Enforcement
- **Patient Role Isolation:**
  - A logged-in `patient` must **never** be able to pass another patient's `patientId` when booking, listing, viewing, rescheduling, cancelling, or submitting a pre-visit form.
  - On the server, when `$user['role'] === 'patient'`, resolve `$patient = findPatientByUserId($pdo, $user['id'])` directly from the database session—ignoring any client-supplied `patientId`.
  - In `get.php`, `reschedule.php`, `status.php`, and `pre-visit.php`, if `$user['role'] === 'patient'` and `$appointment['patientId'] !== $patient['id']`, return `403 Forbidden`.
- **Doctor Role Scoping:**
  - Doctors (`role === 'doctor'`) can mark `'Confirmed'` appointments as `'Completed'`, view appointments, and view pre-visit questionnaires, but cannot create walk-in bookings or confirm pending requests (restricted to `admin` and `staff`, matching `.admin-staff-only` UI controls).
  - Nurses (`role === 'nurse'`) have read-only access to appointment listings and details (for clinical preparation and vitals intake) and cannot mutate appointment bookings or statuses.

### 5.3 Inactive Doctor & Unverified Patient Protection
- **Inactive Doctors:** Both `slots.php` and `create.php`/`reschedule.php` must check `$doctor['status'] === 'active'` in MySQL. If a doctor was deactivated (`status === 'inactive'`), `slots.php` returns `[]` and `create.php`/`reschedule.php` rejects with `400 Bad Request` (`"Doctor is not available."`).
- **Unverified Patients:** Both staff booking (`create.php`) and patient self-booking must verify `$patient['status'] === 'verified'` in MySQL (`patients.status`). Pending or rejected patients cannot book or have appointments booked for them (`400 Bad Request`).

### 5.4 Server-Side Schedule & Time-Grid Validation
- Never trust the client-supplied `time` string alone. The backend slot validator must verify:
  1. `date` is a valid `YYYY-MM-DD` date and `date >= CURDATE()` (and `<= CURDATE() + INTERVAL 60 DAY` for patient self-booking/rescheduling).
  2. The doctor has a `doctor_schedules` row for `DAYNAME(date)` (`Mon`..`Sun`).
  3. `time` (`HH:MM`) falls within `[start_time, end_time)` and aligns with the doctor's `slot_minutes` grid (`(timeMinutes - startMinutes) % slotMinutes === 0`).
  4. If `date === CURDATE()`, `time` must be strictly in the future (`time > current local time`).

### 5.5 State Machine & 24-Hour Lock Rules
- **Valid Status Transitions:**
  - `'Pending'` → `'Confirmed'` (`admin`, `staff`)
  - `'Pending'` → `'Cancelled'` (`admin`, `staff`, or owning `patient` if `> 24h` before slot)
  - `'Confirmed'` → `'Completed'` (`admin`, `staff`, `doctor`)
  - `'Confirmed'` → `'Cancelled'` (`admin`, `staff`, or owning `patient` if `> 24h` before slot)
  - `'Completed'` → *(Terminal: no status changes or cancellations allowed)*
  - `'Cancelled'` → *(Terminal: no status changes allowed)*
- **Patient 24-Hour Cutoff:**
  - Server-side check in `reschedule.php` and `status.php` (when `$user['role'] === 'patient'`): compute `$apptTimestamp - time()`. If `< 86400` seconds (24 hours), reject with `400 Bad Request` (`"Cannot reschedule/cancel within 24 hours of the appointment."`).

---

## 6. Foreign Key & Transaction Considerations

1. **In-Place Rescheduling vs Delete-and-Recreate:**
   - `pre_visit_forms.appointment_id` has `ON DELETE CASCADE`, and `medical_records.appointment_id` has `ON DELETE SET NULL`.
   - Therefore, rescheduling an appointment **must** execute an `UPDATE appointments SET appointment_date = :date, appointment_time = :time, updated_at = NOW() WHERE id = :id` rather than deleting the old row and inserting a new ID.
   - When excluding the current appointment from slot availability checks during reschedule (`excludeId`), the patient can view slots on the same day without their own current slot falsely blocking adjacent checks, while their current exact `(date, time)` is rejected as a no-op if unchanged.
2. **Billing & Clinical Linkage Preservation:**
   - `appointments` contains `billed` (`TINYINT(1)`) and `bill_id` (`VARCHAR(20)` FK to `bills.id`).
   - Seeded appointment `A-001` has `status = 'Completed'`, `billed = 1`, `bill_id = 'B-001'`.
   - `serializeAppointment()` must include `billed: (bool) $row['billed']` and `billId: $row['bill_id']` so [`api.previewBillCharges(patientId)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L1838-L1841) and [`api.createBill(data)`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js#L1888-L1894) continue to detect unbilled completed appointments (`status === 'Completed' && !a.billed`).
   - Furthermore, until Phase 5.8 (Billing Backend Migration), when `api.createBill()` marks an appointment as billed in `localStorage`, we should also support updating `billed` / `bill_id` or syncing the cache cleanly.
3. **Sequence Allocation (`sequences` table):**
   - `allocateNextId($pdo, 'appointments', 'appointments', 'A', 3)` in [`api/helpers/patients.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/helpers/patients.php#L133-L179) already includes `'appointments'` in its table whitelist and uses `SELECT ... FOR UPDATE` on `sequences`.
   - For `pre_visit_forms`, the primary key `id` is `VARCHAR(30)` (e.g., `PVF-A-002` or `PVF-<timestamp>`). Using deterministic `PVF-{appointment_id}` (e.g., `PVF-A-002`) or `INSERT ... ON DUPLICATE KEY UPDATE` on `uq_pre_visit_appointment (appointment_id)` guarantees idempotent upsert without orphan IDs.

---

## 7. Recommended Implementation Architecture

### 7.1 Directory Structure
```text
api/
├── helpers/
│   ├── patients.php        (existing - provides allocateNextId, findPatientById)
│   ├── doctors.php         (existing - provides findDoctorById, fetchSchedulesForDoctor)
│   └── appointments.php    (NEW - serializeAppointment, serializePreVisitForm, computeAvailableSlots, validateSlotForDoctor)
└── appointments/
    ├── slots.php           (NEW - GET available slots for doctor + date)
    ├── list.php            (NEW - GET filtered/sorted appointments + status counts)
    ├── get.php             (NEW - GET single appointment + preVisitForm)
    ├── create.php          (NEW - POST staff or patient booking inside transaction)
    ├── reschedule.php      (NEW - POST in-place date/time reschedule inside transaction)
    ├── status.php          (NEW - POST confirm, complete, or cancel transition)
    └── pre-visit.php       (NEW - GET/POST telehealth pre-visit questionnaire & join check)
```

### 7.2 Serialized Appointment Contract (`serializeAppointment`)
To maintain 100% compatibility with `js/appointments.js`, `js/patient-booking.js`, `js/dashboard.js`, `js/patient-home.js`, `js/telehealth.js`, `js/patient-records.js`, `js/billing.js`, and `js/reports.js`, every serialized appointment object will return:

```json
{
  "id": "A-002",
  "patientId": "P-001",
  "patientName": "Juan Dela Cruz",
  "doctorId": "D-002",
  "doctorName": "Dr. Antonio Luna",
  "specialization": "Cardiology",
  "department": "Internal Medicine",
  "fee": 1500,
  "consultationFee": 1500,
  "date": "2026-11-04",
  "time": "10:00",
  "appointmentDate": "2026-11-04",
  "appointmentTime": "10:00:00",
  "type": "telehealth",
  "status": "Confirmed",
  "reason": "Follow-up on heart palpitations",
  "notes": "",
  "cancelReason": null,
  "billed": false,
  "billId": null,
  "createdBy": "U-005",
  "createdAt": "2026-11-03 09:00:00",
  "updatedAt": "2026-11-03 09:00:00",
  "hasPreVisitForm": false,
  "preVisitForm": null
}
```

---

## 8. Proposed Testing Strategy (`tests/appointment-smoke-test.mjs`)

1. **Authentication, Session & RBAC Guards:**
   - Unauthenticated `GET`/`POST` to all 7 `api/appointments/*.php` endpoints rejected (`401`).
   - Missing CSRF token on `create.php`, `reschedule.php`, `status.php`, and `POST pre-visit.php` rejected (`403`).
   - `nurse` blocked (`403`) from creating, rescheduling, or changing appointment statuses.
   - `doctor` blocked (`403`) from creating appointments or confirming `'Pending'` appointments, but allowed to mark `'Confirmed'` → `'Completed'`.
2. **Slot Generation & Schedule Validation (`slots.php`):**
   - Returns accurate slot grid based on `doctors.slot_minutes` and `doctor_schedules` for the requested weekday.
   - Returns empty array `[]` on days the doctor does not work (`D-005` on Friday/Saturday/Sunday) or when the doctor is `inactive`.
   - Marks already-booked slots (`A-002` on `D-002` at `10:00`) as `available: false`.
3. **Staff Appointment Creation & Management:**
   - Staff creates walk-in/assisted appointment for verified patient `P-001` → auto-assigned `status: 'Confirmed'`, allocated ID `A-003`.
   - Rejects booking for unverified (`pending`) patient `P-002` (`400`).
   - Rejects booking for inactive doctor (`400`).
   - Rejects past date, off-schedule day, or off-grid time (`400`).
   - Rejects double-booking the same doctor/date/time (`409 Conflict`) and same patient/date/time (`409 Conflict`).
4. **Patient Online Booking & Ownership/IDOR Protection:**
   - Unverified patient (`patient2` / `P-002`) blocked from booking (`403`/`400`).
   - Verified patient (`patient` / `P-001`) books online → created with `status: 'Pending'`.
   - Patient attempting to pass another patient's `patientId` still books only under their own `P-001` record.
   - Enforces `reason >= 10` chars, `date <= +60 days`, and **max 3 active upcoming appointments** limit (`400`).
   - Patient `GET list.php` and `GET get.php` only return own appointments; requesting another patient's appointment ID returns `403`.
5. **Rescheduling & Status Transitions:**
   - Rescheduling updates `date` and `time` **in-place** while preserving appointment ID (`A-003`).
   - Enforces 24-hour cutoff for patient reschedule/cancel (`400` when `< 24h`), while allowing `admin`/`staff` override.
   - Staff transitions `'Pending'` → `'Confirmed'`; Doctor transitions `'Confirmed'` → `'Completed'`.
   - Rejects cancelling or modifying `'Completed'` or `'Cancelled'` appointments (`400`).
6. **Telehealth Pre-Visit Forms & Join Check (`pre-visit.php`):**
   - Rejects pre-visit submission without consent or with short symptoms (`< 5` chars) (`400`).
   - Submits and updates pre-visit form for a telehealth appointment (`200`), verifying `uq_pre_visit_appointment` upsert and `canJoinTelehealth` logic.
7. **Cleanup & Regression:**
   - Clean up test appointments created during the smoke test and restore `sequences` (`appointments` = 2) so `primecare_db` remains at its exact seeded baseline (`A-001`, `A-002`).
   - Re-run `auth-smoke-test.mjs`, `patient-smoke-test.mjs`, and `doctor-smoke-test.mjs`.

---

## 9. Potential Migration Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **1. Time Format Mismatch (`09:00:00` vs `09:00`)** | Frontend `new Date(a.date + 'T' + a.time)` and slot matching `s.time === a.time` expect `HH:MM`, whereas MySQL `TIME` returns `HH:MM:SS`. | Format `time` as `substr($row['appointment_time'], 0, 5)` (`HH:MM`) in `serializeAppointment()` while keeping `appointmentTime` (`HH:MM:SS`) for reference. |
| **2. Cancel Modal Bug in `js/appointments.js`** | `staff/appointments.html` uses `#can-id` and `#can-reason`, while `js/appointments.js` looks up `#c-id` and `#c-reason` (throwing a null reference error). | Fix the element IDs in `js/appointments.js` (`promptCancel` and `submitCancel`) during Phase 5.6.2. |
| **3. Unmigrated Billing & Reports Reading `localStorage`** | `previewBillCharges()`, `createBill()`, `getStats()`, and `generateReport()` read `this.getAll('appointments')`. | Add `_syncAppointmentCache()` and `_getAppointmentsListForMockJoin()` in `js/api.js` (matching the proven pattern from Phases 5.3.2 and 5.5) and await it in `getStats`, `previewBillCharges`, and `generateReport`. |
| **4. Seeded `A-001` & `A-002` Relative Dates** | Seeded SQL used `CURDATE() - 1 DAY` (`2026-11-02`) for `A-001` and `CURDATE() + 1 DAY` (`2026-11-04`) for `A-002`. | Preserve `A-001` and `A-002` untouched during smoke tests; allocate `A-003+` for test mutations and clean them up at the end of the test run. |

---

## 10. Recommended Subphase Implementation Plan (Phase 5.6.2)

1. **Step 1 — Backend Helper (`api/helpers/appointments.php`):**
   - Implement `serializeAppointment()`, `serializePreVisitForm()`, `findAppointmentById()`, `computeDoctorSlots()`, and transactional conflict checks.
2. **Step 2 — Backend Endpoints (`api/appointments/*.php`):**
   - Implement `slots.php`, `list.php`, `get.php`, `create.php`, `reschedule.php`, `status.php`, and `pre-visit.php` with strict PDO prepared statements, transactions, RBAC, and CSRF validation.
3. **Step 3 — Frontend API & Controller Integration (`js/api.js` & `js/appointments.js`):**
   - Enable `_backendConfig.modules.appointments = true` in `js/api.js`, wire all staff/patient/telehealth appointment methods and cross-module joins to the PHP endpoints, and fix the `#can-id` / `#can-reason` cancel modal bug in `js/appointments.js`.
4. **Step 4 — Automated Smoke Tests & Regression Verification:**
   - Build and run `tests/appointment-smoke-test.mjs` alongside `auth-smoke-test.mjs`, `patient-smoke-test.mjs`, and `doctor-smoke-test.mjs`.
   - Document everything in `PHASE_5_6_2_APPOINTMENT_BACKEND_IMPLEMENTATION.md`.

