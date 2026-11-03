# PrimeCare — Phase 5.5: Doctor Management & Scheduling Backend Implementation

## 1. Executive Summary

Phase 5.5 migrates **Doctor Management**, **Doctor Scheduling**, and **Department Directory** operations from `localStorage` / simulated frontend mocks to PHP and MySQL (`primecare_db`), while preserving all existing frontend page designs, API method signatures, and backward compatibility with modules still scheduled for future backend phases (Appointments, Clinical Records, Admissions, Billing).

---

## 2. Files Created & Modified

### Created Backend & Test Files
| File | Purpose |
|---|---|
| [`api/helpers/doctors.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/helpers/doctors.php) | Shared serialization, schedule querying/batching, department lookup, time/overlap validation, transactional schedule syncing, and duplicate contact/email checks. |
| [`api/doctors/departments.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/doctors/departments.php) | Read-only `GET` endpoint returning the hospital department catalog (`departments` table) or a single department by `id`/`name`. |
| [`api/doctors/list.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/doctors/list.php) | `GET` endpoint for listing, searching, filtering, and sorting doctors with joined department metadata and weekly schedules. Enforces visibility scoping (`active` only for public/patient callers; all statuses for authenticated staff/clinical/admin). |
| [`api/doctors/get.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/doctors/get.php) | Authenticated `GET` endpoint returning a single doctor record (`D-XXX`) with department metadata, services, and sorted weekly schedule. |
| [`api/doctors/create.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/doctors/create.php) | Admin-only `POST` endpoint (`requireRole(['admin'])` + `requireCsrf()`) that allocates the next `D-XXX` ID via `sequences`, validates department & schedule constraints, prevents duplicate contact/email, and inserts into `doctors` + `doctor_schedules` atomically. |
| [`api/doctors/update.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/doctors/update.php) | Admin-only `POST` endpoint (`requireRole(['admin'])` + `requireCsrf()`) supporting both full doctor profile/schedule updates and partial status toggles (`active` / `inactive`), preserving doctor IDs and returning `upcomingAppointments` count when deactivating. |
| [`api/doctors/delete.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/doctors/delete.php) | Admin-only `POST` endpoint (`requireRole(['admin'])` + `requireCsrf()`) that checks all 6 child tables (`appointments`, `medical_records`, `prescriptions`, `lab_results`, `admissions`, `patients`) and blocks deletion (`409 Conflict`) when historical references exist. |
| [`api/doctors/schedules.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/doctors/schedules.php) | `GET` (authenticated schedule listing by `doctorId` and optional `day`) and Admin-only `POST` (`action: 'create' | 'update' | 'delete' | 'sync'`) for granular weekly shift management with server-side conflict & overlap detection. |
| [`tests/doctor-smoke-test.mjs`](file:///c:/xampp/htdocs/PrimeCare_v1/tests/doctor-smoke-test.mjs) | Automated 58-assertion smoke test suite covering RBAC, CSRF, department lookup, doctor CRUD, status lifecycle, schedule CRUD, overlap rejection, and referential integrity protection. |
| [`PHASE_5_5_DOCTOR_BACKEND_IMPLEMENTATION.md`](file:///c:/xampp/htdocs/PrimeCare_v1/PHASE_5_5_DOCTOR_BACKEND_IMPLEMENTATION.md) | Phase 5.5 technical implementation and verification documentation. |

### Modified Files
| File | Summary of Changes |
|---|---|
| [`api/helpers/patients.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/helpers/patients.php) | Expanded `allocateNextId()` allowed entity table whitelist to include `'doctors'` (and core clinical/billing tables). |
| [`js/api.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js) | Enabled `_backendConfig.modules.doctors = true`; added `_syncDoctorCache()` and `_getDoctorsListForMockJoin()`; routed `getDepartments()`, `searchDoctors()`, `getDoctorById()`, `getDoctors()`, `getDoctorsBySpecialization()`, `saveDoctor()`, `setDoctorStatus()`, `deleteDoctor()`, `getDoctorSchedules()`, `getDoctorSchedule()`, `createDoctorSchedule()`, `updateDoctorSchedule()`, and `deleteDoctorSchedule()` to PHP/MySQL; updated cross-module joins (`getStats`, `getTodaysAppointments`, `searchAppointments`, `getMedicalRecords`, `getPrescriptions`, `orderLabTest`, `getAdmissions`, `generateReport`, and Patient Portal methods) to use live MySQL doctors. |
| [`departments.html`](file:///c:/xampp/htdocs/PrimeCare_v1/departments.html) | Updated `openDept(name)` modal to fetch department doctors via `safeCall('searchDoctors', { department: name })` instead of reading `localStorage` directly. |

---

## 3. Endpoints, HTTP Methods & Role Permissions

| Endpoint | Method | Authentication & RBAC | CSRF Required | Description |
|---|---|---|---|---|
| `api/doctors/departments.php` | `GET` | Public / Any | No | List all 6 hospital departments (`id`, `name`, `description`, `services`) or fetch one by `?id=` or `?name=`. |
| `api/doctors/list.php` | `GET` | Public (`active` only) or Staff/Clinical/Admin (all statuses); `?requireAuth=1` enforces session | No | Search (`keyword`), filter (`specialization`, `department`, `departmentId`, `status`, `language`, `insurance`), and sort (`sortBy`, `sortDir`) doctors with joined department and schedule data. |
| `api/doctors/get.php` | `GET` | `requireAuth()` (All authenticated roles) | No | Retrieve single doctor by `?id=D-XXX` including department metadata and weekly schedule. |
| `api/doctors/create.php` | `POST` | `requireRole(['admin'])` | Yes (`X-CSRF-Token`) | Create new doctor (`D-XXX`) and weekly `doctor_schedules` rows in a transaction; logs to `audit_logs`. |
| `api/doctors/update.php` | `POST` | `requireRole(['admin'])` | Yes (`X-CSRF-Token`) | Update doctor profile and schedule, or toggle status (`active`/`inactive`) while preserving ID and historical links. |
| `api/doctors/delete.php` | `POST` | `requireRole(['admin'])` | Yes (`X-CSRF-Token`) | Delete unreferenced doctor record; returns `409 Conflict` if referenced by any clinical, appointment, or patient record. |
| `api/doctors/schedules.php` | `GET` | `requireAuth()` | No | List schedule rows for `?doctorId=D-XXX` (optional `?day=Mon`). |
| `api/doctors/schedules.php` | `POST` | `requireRole(['admin'])` | Yes (`X-CSRF-Token`) | Create, update, delete, or sync schedule shifts (`action: 'create' | 'update' | 'delete' | 'sync'`). |

---

## 4. Request & Response Formats

All endpoints use [`api/helpers/response.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/helpers/response.php) and return standardized JSON envelopes:

```json
{
  "success": true,
  "message": "Human-readable status message",
  "data": { ... },
  "timestamp": "2026-11-03T15:00:00+08:00"
}
```

### Serialized Doctor Object Shape
```json
{
  "id": "D-001",
  "userId": "U-002",
  "name": "Dr. Jose Rizal",
  "photoInitials": "JR",
  "specialization": "Ophthalmology",
  "department": "Surgery",
  "departmentId": 5,
  "departmentDescription": "General and specialized surgical procedures.",
  "departmentServices": ["Appendectomy", "Hernia Repair", "Minimally Invasive Surgery"],
  "contact": "09170000001",
  "email": "jrizal@primecare.ph",
  "languages": ["English", "Tagalog", "Spanish"],
  "acceptedInsurance": ["PhilHealth", "Maxicare"],
  "qualifications": "MD, PhD",
  "status": "active",
  "consultationFee": 1000,
  "slotMinutes": 30,
  "schedule": [
    {
      "id": 1,
      "doctorId": "D-001",
      "day": "Mon",
      "dayOfWeek": "Mon",
      "start": "09:00",
      "end": "17:00",
      "startTime": "09:00:00",
      "endTime": "17:00:00"
    }
  ],
  "createdAt": "2026-11-02 20:00:00",
  "updatedAt": "2026-11-02 20:00:00"
}
```

---

## 5. Database Tables Used

1. **`doctors`**
   - Primary Key: `id` (`VARCHAR(20)`, e.g. `D-001`..`D-005`).
   - Columns: `user_id`, `name`, `photo_initials`, `specialization`, `department`, `contact`, `email`, `languages_json`, `accepted_insurance_json`, `qualifications`, `status` (`ENUM('active','inactive')`), `consultation_fee`, `slot_minutes`, `created_at`, `updated_at`.
   - Seeded baseline: 5 doctors (`D-001` through `D-005`).
2. **`doctor_schedules`**
   - Primary Key: `id` (`INT UNSIGNED AUTO_INCREMENT`).
   - Foreign Key: `doctor_id` references `doctors(id) ON DELETE CASCADE ON UPDATE CASCADE`.
   - Unique Constraint: `uq_doctor_schedule_day (doctor_id, day_of_week)`.
   - Columns: `id`, `doctor_id`, `day_of_week` (`ENUM('Mon','Tue','Wed','Thu','Fri','Sat','Sun')`), `start_time` (`TIME`), `end_time` (`TIME`).
   - Seeded baseline: 27 weekly shift slots across `D-001`..`D-005`.
3. **`departments`**
   - Primary Key: `id` (`INT UNSIGNED AUTO_INCREMENT`).
   - Unique Key: `uq_departments_name (name)`.
   - Columns: `id`, `name`, `description`, `services_json`.
   - Seeded baseline: 6 departments (`Cardiology`, `Pediatrics`, `Oncology`, `Internal Medicine`, `Surgery`, `Dermatology`).
4. **`sequences`**
   - `entity_key = 'doctors'` (`prefix = 'D'`, `pad_length = 3`) locked with `SELECT ... FOR UPDATE` inside `allocateNextId()`.
5. **`audit_logs`**
   - Records administrative doctor creations, updates, status changes, schedule modifications, and deletions.

---

## 6. Validation Rules & Scheduling Conflict Logic

### Doctor Validation Rules
- **Required fields:** `name`, `specialization`, and a valid `department` (or `departmentId`) that exists in the `departments` table.
- **Consultation fee:** Numeric value `>= 0` and `<= 1,000,000`.
- **Slot duration (`slotMinutes`):** Must be one of `15`, `20`, `30`, `45`, or `60` minutes.
- **Contact & Email:** Philippine mobile number (`09XXXXXXXXX`, 11 digits) and valid email format when provided; uniqueness enforced case-insensitively across `doctors` (`409 Conflict` on duplicate).
- **Status normalization:** Database schema defines `ENUM('active', 'inactive')`. If the legacy UI sends `'on-leave'`, the backend normalizes it to `'inactive'` so database constraints are respected without schema alterations.

### Schedule & Overlap Validation Rules
- **Valid days:** `'Mon'`, `'Tue'`, `'Wed'`, `'Thu'`, `'Fri'`, `'Sat'`, `'Sun'`.
- **24-hour time format:** Strict `HH:MM` (or `HH:MM:SS`) validation (`00:00` to `23:59`).
- **Positive duration:** `start_time` must be strictly earlier than `end_time` (`startMinutes < endMinutes`). Zero-length (`10:00` to `10:00`) and reversed (`16:00` to `10:00`) shifts are rejected with `400 Bad Request`.
- **Duplicate / Overlapping shifts:**
  - Within a batch schedule payload (`validateScheduleEntries()`), multiple entries on the same `day_of_week` are checked for time interval overlap (`startA < endB && startB < endA`) and per-day uniqueness (`uq_doctor_schedule_day`), returning `409 Conflict` when a conflict is detected.
  - In `api/doctors/schedules.php`, `create` and `update` check existing database rows for the same `doctor_id` and `day_of_week` (excluding the schedule row being updated) and reject overlapping or duplicate day assignments with `409 Conflict`.
- **ID Preservation:** Both `syncDoctorSchedules()` (used during full doctor edits) and `schedules.php` (`action: 'update'`) update existing `doctor_schedules` rows in place, preserving primary key `id` values.
- **Minimum Schedule Rule:** Deleting a doctor's last remaining working day via `schedules.php` (`action: 'delete'`) is blocked (`400 Bad Request`) so an active doctor never ends up with zero working days.

---

## 7. Automated Test Coverage & Verification Results

All three automated smoke test suites were executed against live XAMPP Apache and MariaDB (`primecare_db`):

1. **Doctor & Scheduling Smoke Tests (`node tests/doctor-smoke-test.mjs`):** **58 passed, 0 failed**
   - Unauthenticated access rejection (`401`) and CSRF protection (`403`).
   - Role-based access control (`staff`, `doctor`, `patient` blocked from admin write endpoints with `403`).
   - Department listing (6 seeded departments), lookup by `id` and `name`, and `404` on unknown department.
   - Doctor listing, keyword search, department/language/insurance filtering, sort column whitelist & SQLi protection, and individual doctor retrieval (`D-001`).
   - Doctor creation (`D-006`), missing/invalid field rejection (`400`), duplicate email & contact rejection (`409`).
   - Doctor profile update, deactivation (`status: 'inactive'`), public/patient visibility exclusion of inactive doctors, and reactivation (`status: 'active'`).
   - Schedule listing, single-day filtering, shift creation, overlap/duplicate-day rejection (`409`), reversed/zero-length/malformed time rejection (`400`), non-existent doctor rejection (`404`), schedule update with preserved `schedule.id`, ownership mismatch rejection (`400`), shift deletion, and last-working-day deletion protection (`400`).
   - Referential integrity protection blocking deletion of `D-001` (`409 Conflict`) and clean removal of unreferenced test doctor `D-006` (`200 OK`), restoring the exact baseline of **5 doctors and 27 schedule shifts**.
2. **Authentication & RBAC Regression Suite (`node tests/auth-smoke-test.mjs`):** **78 passed, 0 failed**
3. **Patient Management Regression Suite (`node tests/patient-smoke-test.mjs`):** **55 passed, 0 failed**

---

## 8. Known Limitations & Next Phase Readiness

- **Appointments Still in `localStorage` (Phase 5.6 Scope):** While `getAvailableSlots()` and all appointment/clinical/portal views now read live doctors and schedules from MySQL, appointment booking records (`appointments` table) remain in `localStorage` until Phase 5.6. When an admin deactivates a doctor via `api/doctors/update.php`, the backend queries `appointments` in MySQL for `upcomingAppointments` and `js/api.js` takes `Math.max()` with any local mock appointments so the admin warning toast remains accurate during the transition.
- **`doctors.status` Enum:** The MySQL schema defines `doctors.status` as `ENUM('active','inactive')`. Selecting `"On Leave"` in the admin UI maps to `'inactive'` in the database.

