# PrimeCare — Phase 5.6.2: Appointment Management & Online Booking Backend Implementation

**Project:** PrimeCare Hospital Information and Patient Management System (`C:\xampp\htdocs\PrimeCare_v1`)  
**Database:** `primecare_db` (XAMPP MariaDB / InnoDB)  
**Phase:** 5.6.2 — Appointment Management & Online Booking Backend Migration  
**Status:** Completed & Verified (261/261 Automated Smoke Test Assertions Passing)

---

## 1. Overview

Phase 5.6.2 migrates **Appointment Management (Staff/Admin/Clinical Portal)** and **Patient Online Booking & Telehealth Pre-Visit Questionnaires (Patient Portal)** from `localStorage` simulation to PHP + MariaDB while preserving full compatibility with existing frontend pages, camelCase payload shapes, `HH:MM` time strings, and unmigrated downstream modules (Billing, Reports, Dashboards, Clinical Records).

---

## 2. Files Created & Modified

### Created Backend Files
| File | Purpose |
| :--- | :--- |
| [`api/helpers/appointments.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/helpers/appointments.php) | Reusable appointment & pre-visit form serializers, relational queries, schedule/time-grid slot computation, transactional row-locking conflict validator, 24-hour cutoff check, and server-side telehealth join eligibility evaluator. |
| [`api/appointments/slots.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/slots.php) | `GET` endpoint computing available and unavailable `HH:MM` appointment slots for an active doctor on a target date. |
| [`api/appointments/list.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/list.php) | `GET` endpoint supporting staff search/filter/sort (`keyword`, `doctorId`, `patientId`, `status`, `type`, `dateFrom`, `dateTo`, `sortBy`, `sortDir`), patient portal self-scoping (`?my=1`, `scope=upcoming\|past\|cancelled`), status summary counts, and preview mode (`P-001`). |
| [`api/appointments/get.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/get.php) | `GET` endpoint returning a single serialized appointment with joined patient/doctor fields and attached telehealth pre-visit questionnaire, enforcing patient ownership (`403` on IDOR). |
| [`api/appointments/create.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/create.php) | `POST` endpoint creating appointments transactionally (`Confirmed` for `admin`/`staff`; `Pending` for `patient` self-booking) with row-level locking (`SELECT ... FOR UPDATE`). |
| [`api/appointments/reschedule.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/reschedule.php) | `POST` endpoint updating `appointment_date` and `appointment_time` **in-place** inside a transaction while preserving the appointment's primary key (`A-XXX`) and all linked relational records. |
| [`api/appointments/status.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/status.php) | `POST` endpoint enforcing role-based appointment status transitions (`Pending` → `Confirmed`, `Confirmed` → `Completed`, `Pending`/`Confirmed` → `Cancelled`). |
| [`api/appointments/pre-visit.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/pre-visit.php) | `GET` and `POST` endpoint for reading and submitting (`ON DUPLICATE KEY UPDATE`) telehealth pre-visit questionnaires and evaluating server-side telehealth join window eligibility (`[-30, +15]` minutes). |
| [`tests/appointment-smoke-test.mjs`](file:///c:/xampp/htdocs/PrimeCare_v1/tests/appointment-smoke-test.mjs) | 70-assertion end-to-end automated smoke and security test suite covering all Phase 5.6.2 endpoints, business rules, concurrency/double-booking locks, IDOR checks, and database cleanup. |

### Modified Frontend Files
| File | Summary of Changes |
| :--- | :--- |
| [`js/api.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js) | Enabled `_backendConfig.modules.appointments = true`; added `_syncAppointmentCache()` and `_getAppointmentsListForMockJoin()`; migrated `getAvailableSlots`, `searchAppointments`, `getAppointmentById`, `bookAppointment`, `rescheduleAppointment`, `cancelAppointment`, `updateAppointmentStatus`, `getMyDashboard`, `getMyAppointments`, `bookMyAppointment`, `rescheduleMyAppointment`, `cancelMyAppointment`, `getMyTelehealthAppointments`, `submitPreVisitForm`, `getPreVisitForm`, and `canJoinTelehealth`; updated cross-module consumers (`getStats`, `getTodaysAppointments`, `getAppointmentsPerDay`, `getRecentActivity`, `deleteUser`, `deletePatient`, `getPatientSummary`, `previewBillCharges`, `generateReport`). |
| [`js/appointments.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js) | Fixed cancel modal DOM ID mismatch (`#can-id`, `#can-reason`, `#can-alert`); updated `openReschedule()` and `viewAppt()` to fetch fresh appointment details via `api.getAppointmentById(id)`; passed `excludeId` to `api.getAvailableSlots()` during rescheduling. |
| [`js/patient-booking.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/patient-booking.js) | Updated `loadRescheduleSlots()` to pass `excludeId` (`#res-id`) to `api.getAvailableSlots()` when rescheduling an existing appointment. |

---

## 3. Endpoints & Request/Response Contracts

| Endpoint | Method | Auth / RBAC | CSRF | Request Parameters / Body | Response Data (`data`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `api/appointments/slots.php` | `GET` | `requireAuth()` | N/A | `?doctorId=D-001&date=YYYY-MM-DD[&excludeId=A-002]` | `{ doctorId, date, slotMinutes, slots: [{ time: "HH:MM", available: bool }] }` |
| `api/appointments/list.php` | `GET` | `requireAuth()` | N/A | `?keyword=&doctorId=&patientId=&status=&type=&dateFrom=&dateTo=&scope=&sortBy=&sortDir=&my=1` | `{ appointments: [...], counts: { all, pending, confirmed, completed, cancelled }, previewMode }` |
| `api/appointments/get.php` | `GET` | `requireAuth()` (Patient scoped to own `patientId`) | N/A | `?id=A-001` | `{ appointment: { ...serializedAppointment, preVisitForm } }` |
| `api/appointments/create.php` | `POST` | `requireRole(['admin','staff','patient'])` | `requireCsrf()` | `{ patientId?, doctorId, date, time, type, reason, notes? }` | `201 Created`: `{ appointment: {...} }` |
| `api/appointments/reschedule.php` | `POST` | `requireRole(['admin','staff','patient'])` | `requireCsrf()` | `{ id, date, time, type?, reason?, notes? }` | `{ appointment: {...} }` |
| `api/appointments/status.php` | `POST` | `requireRole(['admin','staff','doctor','patient'])` | `requireCsrf()` | `{ id, status, cancelReason?, allowDefaultReason? }` | `{ appointment: {...} }` |
| `api/appointments/pre-visit.php` | `GET` / `POST` | `GET`: `requireAuth()`<br>`POST`: `requireRole(['patient'])` | `POST`: `requireCsrf()` | `GET`: `?appointmentId=A-002`<br>`POST`: `{ appointmentId, symptoms, symptomDuration, currentMedications, allergies?, consent }` | `{ form, preVisitForm, appointment?, canJoin: { allowed, reason, minutesUntil? } }` |

---

## 4. Security Controls Implemented

1. **Session Authentication & RBAC Enforcement:**
   - Every endpoint validates the active server session via `requireAuth()` or `requireRole(...)` in [`api/helpers/auth.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/helpers/auth.php).
   - `nurse` and `doctor` roles are blocked (`403`) from creating or rescheduling appointments.
   - Only `admin` and `staff` can transition `Pending` → `Confirmed`.
   - Only `admin` and the **assigned `doctor`** (`doctors.user_id = users.id`) can transition `Confirmed` → `Completed`.
2. **CSRF Protection:**
   - All mutating `POST` endpoints (`create.php`, `reschedule.php`, `status.php`, `pre-visit.php`) require a valid `X-CSRF-Token` header and same-origin request via `requireCsrf()`.
3. **IDOR & Ownership Enforcement:**
   - When `user.role === 'patient'`, `patientId` is resolved server-side from `patients.user_id = $_SESSION['uid']`. Any client-supplied `patientId` in `create.php` or `list.php` is ignored.
   - `get.php`, `reschedule.php`, `status.php`, and `pre-visit.php` verify `appointment.patient_id === ownPatient.id` and return `403 Forbidden` on cross-patient access attempts.
4. **SQL Injection Prevention:**
   - All SQL queries use PDO prepared statements with native types (`ATTR_EMULATE_PREPARES => false`).
   - `ORDER BY` sorting in [`api/appointments/list.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/list.php) uses a strict server-side column whitelist (`datetime`, `id`, `patientName`, `doctorName`, `type`, `status`, `createdAt`).

---

## 5. Double-Booking Prevention & In-Place Rescheduling Design

### Transactional Concurrency Control (`validateAndLockAppointmentSlot`)
Inside [`api/helpers/appointments.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/helpers/appointments.php), both `create.php` and `reschedule.php` open a PDO transaction (`$pdo->beginTransaction()`) and call `validateAndLockAppointmentSlot()`:
1. **Doctor Row Lock:** Executes `SELECT * FROM doctors WHERE id = :id FOR UPDATE`, serializing concurrent booking attempts for the same doctor and verifying `status === 'active'`.
2. **Schedule & Time-Grid Verification:** Verifies the target weekday exists in `doctor_schedules`, the requested `HH:MM` falls within `[start_time, end_time - slot_minutes]`, and `(timeMinutes - startMinutes) % slot_minutes === 0`.
3. **Doctor Slot Conflict Lock:** Executes `SELECT id FROM appointments WHERE doctor_id = :did AND appointment_date = :dt AND appointment_time = :tm AND status != 'Cancelled' [AND id != :excludeId] FOR UPDATE`. Returns `409 Conflict` if an active appointment already occupies the slot.
4. **Patient Overlapping Appointment Lock:** Executes `SELECT id FROM appointments WHERE patient_id = :pid AND appointment_date = :dt AND appointment_time = :tm AND status != 'Cancelled' [AND id != :excludeId] FOR UPDATE`. Returns `409 Conflict` if the patient already has another active appointment at the same date and time.

### In-Place Rescheduling (`api/appointments/reschedule.php`)
Unlike the legacy mock implementation (which cancelled, deleted, and recreated the appointment under a new ID), [`api/appointments/reschedule.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/appointments/reschedule.php) updates `appointment_date` and `appointment_time` **in-place** (`UPDATE appointments SET appointment_date = :dt, appointment_time = :tm, updated_at = :now WHERE id = :id`). This preserves:
- The original appointment ID (`A-XXX`),
- `created_by` and `created_at` audit metadata,
- Linked `pre_visit_forms` rows (`fk_pre_visit_appointment`),
- Linked `medical_records` rows (`fk_med_records_appointment`), and
- Linked `bill_id` / `bill_items` references.

---

## 6. Bug Fixes & Schema Notes

1. **Staff Cancel Modal DOM ID Mismatch Fixed ([`js/appointments.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/appointments.js)):**
   - [`staff/appointments.html`](file:///c:/xampp/htdocs/PrimeCare_v1/staff/appointments.html#L137-L142) defines `#can-id`, `#can-reason`, and `#can-alert`, whereas `js/appointments.js` previously queried `#c-id` and `#c-reason` (throwing a `TypeError: Cannot set properties of null`). Updated `promptCancel()` and `submitCancel()` to target `#can-id`, `#can-reason`, and `#can-alert`.
2. **Same-Day Rescheduling Slot Exclusion:**
   - Updated `api.getAvailableSlots(doctorId, dateString, excludeId)` and both staff/patient reschedule modals to pass the appointment's own ID as `excludeId`, allowing a user to view slots on the same date cleanly.
3. **Pre-Visit Form `temperatureC` Schema Note:**
   - The `pre_visit_forms` table in `database/primecare.sql` stores `id`, `appointment_id`, `symptoms`, `duration`, `medications`, `allergies`, `consent`, and `submitted_at`. It does not include a `temperature` column. In accordance with Phase 5.6.2 safety rules, the database schema was not altered and no ad-hoc text packing was introduced; `symptoms`, `duration` (`symptomDuration`), `medications` (`currentMedications`), `allergies` (auto-populated from `patients.allergies` when omitted), and `consent` are persisted and serialized with full frontend compatibility.

---

## 7. Automated Smoke & Regression Test Results

All four automated Node.js test suites were executed against live XAMPP Apache + MariaDB (`primecare_db`):

| Test Suite | Command | Result |
| :--- | :--- | :--- |
| **Appointment & Booking Smoke Tests (Phase 5.6.2)** | `node tests/appointment-smoke-test.mjs` | **70 / 70 Passed** |
| **Doctor & Schedule Smoke Tests (Phase 5.5)** | `node tests/doctor-smoke-test.mjs` | **58 / 58 Passed** |
| **Patient Management Smoke Tests (Phase 5.3.2)** | `node tests/patient-smoke-test.mjs` | **55 / 55 Passed** |
| **Authentication & RBAC Smoke Tests (Phase 5.2)** | `node tests/auth-smoke-test.mjs` | **78 / 78 Passed** |
| **Total Assertions** | | **261 / 261 Passed (0 Failed)** |

Seeded database state was verified after test execution: `appointments` contains only `A-001` and `A-002`, and `sequences.current_val` for `appointments` is `2`.

