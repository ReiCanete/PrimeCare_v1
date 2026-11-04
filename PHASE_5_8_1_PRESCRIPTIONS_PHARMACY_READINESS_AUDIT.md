# Phase 5.8.1 — Prescriptions & Pharmacy Backend Readiness Audit

**Project:** PrimeCare Hospital Information and Patient Management System  
**Environment:** Windows XAMPP (Apache + MariaDB)  
**Database:** `primecare_db`  
**Base Directory:** `C:\xampp\htdocs\PrimeCare_v1`  
**Phase:** 5.8.1 — Prescriptions & Pharmacy Backend Readiness Audit  
**Audit Type:** READ-ONLY Architectural & Schema Audit  
**Verdict:** **READY FOR IMPLEMENTATION** (Zero schema modifications required)

---

## 1. Executive Summary

This audit evaluates the readiness of the **Prescriptions & Pharmacy** module for backend migration from client-side `localStorage` to PHP/MariaDB. 

PrimeCare's prescriptions module supports doctor medication ordering, allergy conflict detection with physician override justification, multi-item prescription formulation (dosage, frequency, duration, sig instructions), status lifecycle transitions (`Active` -> `Dispensed` or `Cancelled`), and patient portal prescription viewing and printing.

### Key Audit Findings:
1. **Schema 100% Prepared:** The MariaDB database `primecare_db` already contains the fully normalized, indexed relational tables: `prescriptions` and `prescription_items`, as well as sequence management row `'prescriptions'` (prefix `'RX'`).
2. **Zero Schema Alterations Required:** No DDL, migrations, or new tables/columns are needed. All fields required by the frontend contracts (`patient_id`, `doctor_id`, `medical_record_id`, `status`, `prescribed_date`, `notes`, `override_allergy`, `override_reason`, `billed`, `bill_id`) exist in the live database.
3. **Preserved Seed Baseline:** Exactly 1 seeded prescription exists: `RX-001` (`P-001`, `D-001`, `M-001`, `Dispensed`, `B-001`) with item `Artificial Tears` (id: 1). This must be preserved byte-for-byte.
4. **Pharmacy Scope Clarification:** PrimeCare does not have a dedicated pharmacy inventory or warehouse management subsystem. In PrimeCare, "pharmacy fulfillment" is modeled as a clinical dispensing status transition (`Active` -> `Dispensed`) performed by Nurses or Admins. Medicine prices for billing reside in `service_catalog`.
5. **Legal & Clinical Invariant:** There is no prescription deletion endpoint or UI action anywhere in the application. Prescriptions are legal clinical orders that may only be `Cancelled`, never deleted.
6. **Allergy Safety System:** The frontend enforces patient allergy checks. If an prescribed medicine conflicts with `patients.allergies`, the system requires an explicit clinical override with a mandatory minimum 10-character justification logged to `audit_logs`.

---

## 2. Current Architecture & Workflows

### 2.1 Staff e-Prescriptions Workflow (`staff/prescriptions.html`, `js/prescriptions.js`)
1. **Access Control:**
   - When loaded, `checkAccess()` checks `api.getCurrentUser()`.
   - `staff` role is explicitly blocked: displays `#access-denied` panel ("You do not have permission to access e-Prescriptions").
   - `nurse`: Can view prescriptions, search/filter, print, and **Dispense** active prescriptions. Cannot create new prescriptions.
   - `doctor`: Can view prescriptions (auto-filtered to own profile `myDoc.id`), search/filter, print, **Cancel** active prescriptions, and **Create** new prescriptions.
   - `admin`: Has unrestricted access: create, view, print, dispense, and cancel.
2. **Prescription Listing & Filtering:**
   - Filter by keyword (searches RX ID, patient name, and medicine name).
   - Filter by status (`All`, `Active`, `Dispensed`, `Cancelled`).
   - Filter by doctor (`All Doctors` or specific doctor). Doctors have this locked to their own ID.
   - Pagination (10 records per page).
3. **Prescription Creation Workflow:**
   - Clicking **+ New Prescription** opens `#new-rx-modal`.
   - Doctor selects a verified patient.
   - `checkPatientAllergies()` fetches the patient chart and displays an allergy warning banner if allergies exist.
   - Doctor adds one or more medicine items:
     - Medicine name (`medicine` - string, required)
     - Dosage (`dosage` - string, e.g. `1 capsule`, required)
     - Frequency (`frequency` - string, e.g. `3x a day`, required)
     - Duration in days (`durationDays` - integer, required)
     - Instructions (`instructions` - string, optional)
   - Doctor enters optional general notes.
   - On submission (`submitRx(false)`):
     - Validates presence of at least 1 item and all required item fields.
     - Performs allergy conflict check. If any medicine matches the patient's recorded allergies, the submission halts and surfaces `#rx-conflict-box`.
     - The doctor must enter a reason for override (minimum 10 characters) and click **Override and Save** (`submitRx(true)`).
4. **Prescription Lifecycle & Dispensing:**
   - From the table:
     - If status is `Active`:
       - Nurse/Admin can click **Dispense** -> calls `api.updatePrescriptionStatus(id, 'Dispensed')`.
       - Doctor/Admin can click **Cancel** -> calls `api.updatePrescriptionStatus(id, 'Cancelled')`.
     - If status is `Dispensed` or `Cancelled`: No further status transitions are allowed.
5. **Print & Details Modal:**
   - Clicking **View/Print** opens `#print-modal`.
   - Formats prescription header with hospital metadata (`PRIMECARE`, address, contact number).
   - Displays Patient name, Age/Sex, Date, and RX ID.
   - Renders `Rx` item table (Medicine, Dosage, Sig frequency/duration/instructions).
   - Displays Doctor signature block with License No and Specialization.
   - Provides a one-click print trigger (`window.print()`).

### 2.2 Patient Portal Prescriptions Workflow (`patient/my-records.html`, `js/my-records.js`)
1. **Prescriptions Tab:**
   - In `patient/my-records.html`, the "Prescriptions" tab (`#tab-rx`) calls `api.getMyPrescriptions()`.
   - Renders responsive cards for each prescription issued to the logged-in patient.
   - Displays prescription date, prescribing doctor name, status badge, and item summary.
2. **Patient Print/View Modal:**
   - Clicking **Print / View** opens `#print-rx-modal`.
   - Validates that `rx.patientId === myPatientProfile.id` (client-side sanity check).
   - Formats the printable Rx slip identical to the staff print view.

### 2.3 EHR / Medical Records Cross-Link (`staff/medical-records.html`, `js/medical-records.js`)
- In `staff/medical-records.html`, opening a patient's chart and clicking the **Prescriptions** tab (`#chart-rx`) queries `api.getPrescriptions({ patientId: currentPatientId })`.
- Displays historical prescriptions with dates, doctor names, and medications.

### 2.4 Billing & Reports Cross-Links
- **Billing (`js/api.js`):** In `createBill()`, the system filters for `patientId === pid && status === 'Dispensed' && !billed`. It generates medication line items for the bill and flags `billed = true` and `bill_id = 'B-XXX'`.
- **Reports (`js/api.js`):** In `generateReport('doctor-workload')`, prescriptions issued during the date window are counted in the "Prescriptions Issued" column.

---

## 3. Database Inventory & Relationship Map

### 3.1 Table: `prescriptions`
```sql
CREATE TABLE `prescriptions` (
  `id` varchar(20) NOT NULL,
  `patient_id` varchar(20) NOT NULL,
  `doctor_id` varchar(20) NOT NULL,
  `medical_record_id` varchar(20) DEFAULT NULL,
  `status` enum('Active','Dispensed','Cancelled') NOT NULL DEFAULT 'Active',
  `prescribed_date` date NOT NULL,
  `notes` text DEFAULT NULL,
  `override_allergy` tinyint(1) NOT NULL DEFAULT 0,
  `override_reason` text DEFAULT NULL,
  `billed` tinyint(1) NOT NULL DEFAULT 0,
  `bill_id` varchar(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_prescriptions_patient` (`patient_id`,`prescribed_date`),
  KEY `idx_prescriptions_doctor` (`doctor_id`),
  KEY `idx_prescriptions_med_record` (`medical_record_id`),
  KEY `idx_prescriptions_bill` (`bill_id`),
  CONSTRAINT `fk_prescriptions_bill` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_prescriptions_doctor` FOREIGN KEY (`doctor_id`) REFERENCES `doctors` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_prescriptions_med_record` FOREIGN KEY (`medical_record_id`) REFERENCES `medical_records` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_prescriptions_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

### 3.2 Table: `prescription_items`
```sql
CREATE TABLE `prescription_items` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `prescription_id` varchar(20) NOT NULL,
  `medicine` varchar(150) NOT NULL,
  `dosage` varchar(100) NOT NULL,
  `frequency` varchar(100) NOT NULL,
  `duration_days` int(10) unsigned DEFAULT NULL,
  `instructions` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rx_items_prescription` (`prescription_id`),
  CONSTRAINT `fk_rx_items_prescription` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

### 3.3 Relational Map
```
               +------------------+
               |     patients     |
               +--------+---------+
                        |
                        | 1:N (fk_prescriptions_patient)
                        v
+-------------+ 1:N    +------------------+    N:1 (fk_prescriptions_med_record)   +------------------+
|   doctors   +------->+  prescriptions   +--------------------------------------->+ medical_records  |
+-------------+        +--------+---------+                                        +------------------+
  (fk_prescriptions_doctor)     |
                                | 1:N (fk_rx_items_prescription - CASCADE)
                                v
                       +------------------+
                       |prescription_items|
                       +------------------+
                                |
                                | 1:N (polymorphic source_id in bill_items)
                                v
                       +------------------+
                       |    bill_items    |
                       +------------------+
```

### 3.4 Seeded Baseline Record
- `prescriptions` row:
  - `id`: `RX-001`
  - `patient_id`: `P-001` (`Juan Dela Cruz`)
  - `doctor_id`: `D-001` (`Dr. Jose Rizal`)
  - `medical_record_id`: `M-001`
  - `status`: `Dispensed`
  - `prescribed_date`: `2026-11-02`
  - `notes`: `Avoid rubbing eyes.`
  - `override_allergy`: `0`
  - `override_reason`: `NULL`
  - `billed`: `1`
  - `bill_id`: `B-001`
- `prescription_items` row:
  - `id`: `1`
  - `prescription_id`: `RX-001`
  - `medicine`: `Artificial Tears`
  - `dosage`: `1 drop`
  - `frequency`: `3x a day`
  - `duration_days`: `30`
  - `instructions`: `Apply to both eyes.`
- `sequences` row:
  - `entity_key`: `prescriptions`
  - `prefix`: `RX`
  - `current_val`: `1`
  - `pad_length`: `3`

---

## 4. Role-Based Access Control (RBAC) & Security Matrix

| Action / Endpoint | Method | Admin | Doctor | Nurse | Staff | Patient |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **List Prescriptions** (`list.php`) | `GET` | All | All (Default to own) | All (For Dispensing) | **403 Forbidden** | Own Records Only (IDOR Protected) |
| **Get Prescription Details** (`get.php`) | `GET` | Allowed | Allowed | Allowed | **403 Forbidden** | Own Record Only (IDOR Protected) |
| **Create Prescription** (`create.php`) | `POST` | Allowed | Allowed (Locked to own `doctorId`) | **403 Forbidden** | **403 Forbidden** | **403 Forbidden** |
| **Dispense Medication** (`status.php`) | `POST` | Allowed | **403 Forbidden** | Allowed | **403 Forbidden** | **403 Forbidden** |
| **Cancel Prescription** (`status.php`) | `POST` | Allowed | Allowed (Own record or colleague) | **403 Forbidden** | **403 Forbidden** | **403 Forbidden** |
| **Delete Prescription** (`delete.php`) | ANY | **Prohibited (404)** | **Prohibited (404)** | **Prohibited (404)** | **Prohibited (404)** | **Prohibited (404)** |

### Security & IDOR Protections Required:
1. **Patient IDOR Prevention:**
   - In `list.php`: When called with a patient session, the endpoint must automatically lock `$patientId = $currentUser['patient_id']`. Any incoming query parameter attempting to request another patient's data (`?patientId=P-002`) must be ignored or rejected.
   - In `get.php`: If the session belongs to a patient, the prescription's `patient_id` must match the patient's ID; otherwise, return HTTP `403 Forbidden`.
2. **Doctor Attribution Enforcement:**
   - In `create.php`: When a doctor creates a prescription, the backend must resolve the doctor profile from `$_SESSION['uid']` and force `doctor_id = $myDoctorId`. Doctors cannot forge or attribute prescriptions to other physicians.
3. **Staff Access Denial:**
   - Administrative staff members do not have clinical or pharmacy credentials and must be strictly blocked with HTTP `403 Forbidden`.
4. **CSRF Protection:**
   - All state-changing POST endpoints (`create.php`, `status.php`) must require valid `X-CSRF-Token` headers.
5. **No-Delete Invariant:**
   - Under no circumstances should a prescription deletion endpoint or UI control be introduced.

---

## 5. Frontend Migration Inventory (`js/api.js`)

| API Method | Current Source | Target PHP Endpoint | Notes & Contracts |
| :--- | :--- | :--- | :--- |
| `getPrescriptions(filters)` | `this.getAll('prescriptions')` | `GET api/prescriptions/list.php` | Returns array of prescriptions with joined `patientName`, `doctorName`, and nested `items` array. Supports `patientId`, `doctorId`, `status`, `keyword`, `page`, `limit`. |
| `getPrescriptionById(id)` | `this.getById('prescriptions', id)` | `GET api/prescriptions/get.php?id={id}` | Returns single prescription with `items` and doctor specialization details. Enforces IDOR. |
| `createPrescription(rx)` | `this.save('prescriptions', rx, 'RX')` | `POST api/prescriptions/create.php` | Performs server-side allergy check. If conflict and not overridden, returns HTTP 409/400 with `{ allergyConflict: true, conflicts: [...] }`. Validates override reason (>= 10 chars). |
| `updatePrescriptionStatus(id, status)` | `localStorage` item mutation | `POST api/prescriptions/status.php` | Handles `Dispensed` (Nurse/Admin) and `Cancelled` (Doctor/Admin). Rejects invalid transitions if not `Active`. |
| `getMyPrescriptions()` | `this.getAll('prescriptions')` | `GET api/prescriptions/list.php?my=1` | Patient portal helper. Server scopes response to logged-in patient. |
| `getPatientSummary(id)` | `this.getAll('prescriptions')` | Reads DB / synced cache | Keep `_syncPrescriptionCache()` to ensure patient chart summary counts work. |
| `generateReport('doctor-workload')` | `this.getAll('prescriptions')` | Database query or helper | Update `_getPrescriptionsListForMockJoin()` for accurate workload metrics. |

---

## 6. Proposed PHP Backend Architecture

### 6.1 Backend Helper: `api/helpers/prescriptions.php`
- `serializePrescription($row, $items)`:
  - Formats database rows into exact frontend camelCase contract:
    - `id`: string (`RX-001`)
    - `patientId`: string (`P-001`)
    - `patientName`: string
    - `doctorId`: string (`D-001`)
    - `doctorName`: string
    - `doctorSpecialization`: string
    - `medicalRecordId`: nullable string
    - `status`: string (`Active` | `Dispensed` | `Cancelled`)
    - `date`: string `YYYY-MM-DD` (aliased from `prescribed_date`)
    - `prescribedDate`: string `YYYY-MM-DD`
    - `notes`: nullable string
    - `overrideAllergy`: boolean
    - `overrideReason`: nullable string
    - `billed`: boolean
    - `billId`: nullable string
    - `createdAt`: ISO-8601 string
    - `items`: array of serialized items:
      - `id`: integer
      - `medicine`: string
      - `dosage`: string
      - `frequency`: string
      - `durationDays`: integer
      - `instructions`: nullable string
- `fetchPrescriptions($pdo, $filters, $user)`:
  - Builds prepared SQL query with filters and role-based restrictions.
  - Efficiently queries and attaches `prescription_items` in batches.
- `findPrescriptionById($pdo, $id)`:
  - Fetches single prescription with items and joined metadata.
- `checkPatientAllergyConflicts($pdo, $patientId, $items)`:
  - Queries `patients.allergies`.
  - Performs case-insensitive matching between medicine names and comma-separated allergy entries.
  - Returns array of conflicting medicine names.
- `createPrescriptionRecord($pdo, $data, $user)`:
  - Transactional sequence acquisition (`sequences` row `'prescriptions'`).
  - Inserts header row into `prescriptions`.
  - Loops and inserts child rows into `prescription_items`.
  - Writes to `audit_logs` if an allergy override was accepted.
- `updatePrescriptionStatusRecord($pdo, $id, $newStatus, $user)`:
  - Atomic status transition with `SELECT ... FOR UPDATE`.
  - Validates that current status is `'Active'`.
  - Enforces role permissions (Nurse for `Dispensed`, Doctor for `Cancelled`).

### 6.2 Endpoints in `api/prescriptions/`
1. `list.php` (`GET`): Publicly protected list endpoint with search, filter, and pagination.
2. `get.php` (`GET`): Single prescription endpoint with IDOR validation.
3. `create.php` (`POST`): Doctor/Admin creation endpoint with allergy checks and transactional inserts.
4. `status.php` (`POST`): Status transition endpoint (`Dispensed` / `Cancelled`).

---

## 7. Validation Rules & Policy Decisions

### 7.1 Validation Rules
- **Patient Verification:** Prescriptions may only be issued to verified patients (`status = 'verified'`). Unverified or rejected patients must be rejected with HTTP 400.
- **Medicine Items:**
  - `items` array must be non-empty (at least 1 item).
  - `medicine`: non-empty string, max 150 characters.
  - `dosage`: non-empty string, max 100 characters.
  - `frequency`: non-empty string, max 100 characters.
  - `durationDays`: integer between 1 and 365.
  - `instructions`: optional string, max 1,000 characters.
- **Allergy Conflict Enforcement:**
  - If a patient has registered allergies (e.g. `Penicillin, Aspirin`) and an item contains `Amoxicillin` or matching text:
    - If `overrideAllergy` is false: Halt and return HTTP 409 Conflict with `conflicts` array.
    - If `overrideAllergy` is true: Require `overrideReason` with at least 10 characters.
- **Status State Machine:**
  - `Active` -> `Dispensed`: Allowed for Nurse and Admin.
  - `Active` -> `Cancelled`: Allowed for Doctor and Admin.
  - `Dispensed` -> `*`: Prohibited (HTTP 400).
  - `Cancelled` -> `*`: Prohibited (HTTP 400).
  - If `billed = 1` or `bill_id IS NOT NULL`: Cancellation is prohibited (HTTP 400, "Cannot cancel a prescription that has already been billed").

### 7.2 Unresolved Policy Decisions & Recommendations

| Decision Item | Options | Audit Recommendation |
| :--- | :--- | :--- |
| **Colleague Prescription Cancellation** | Can Doctor A cancel an active prescription written by Doctor B? | **Allow with Audit Log:** In hospital care and clinical coverage, attending doctors frequently manage medications initiated by off-duty colleagues. Admins have full cancel rights. |
| **Prescription Item Modification** | Can an active prescription be edited (e.g. adjust dosage or add items)? | **Prohibit Modification (Cancel & Re-issue):** To protect legal and audit trail integrity, once issued, prescriptions cannot be silently edited. Doctors should cancel and issue a new prescription. |
| **Allergy Matching Engine** | Substring matching vs strict catalog dictionary | **Case-insensitive substring matching:** Matches `p.allergies` against `item.medicine` (e.g., patient allergy `penicillin` matches `Penicillin V` and `Amoxicillin/Penicillin`). Matches frontend logic. |

---

## 8. Test Plan (Phase 5.8.2)

An automated smoke test suite (`tests/prescriptions-smoke-test.mjs`) must verify:
1. **Unauthenticated & Method Guards:**
   - Unauthenticated GET/POST requests return HTTP 401.
   - Disallowed HTTP methods (e.g. GET on `create.php`, POST on `list.php`) return HTTP 405.
   - Verification that `delete.php` does not exist (HTTP 404).
2. **Session Login & RBAC Enforcement:**
   - `staff` blocked from `list.php`, `get.php`, `create.php`, `status.php` (HTTP 403).
   - `nurse` allowed `list.php`, `get.php`, and `status.php` (`Dispensed`), but blocked from `create.php` and `Cancelled` (HTTP 403).
   - `doctor` allowed `list.php`, `get.php`, `create.php`, and `status.php` (`Cancelled`), but blocked from `Dispensed` (HTTP 403).
   - `patient` allowed only own records via `list.php?my=1` or session-scoped ID.
3. **Patient IDOR Protection:**
   - `patient` (P-001) retrieves own prescription `RX-001`.
   - `patient2` (P-002) attempting `get.php?id=RX-001` receives HTTP 403.
   - `patient2` attempting `list.php?patientId=P-001` receives 0 records (scoped to own profile).
4. **Allergy Conflict & Override Engine:**
   - Prescribing a conflicting medication without override returns HTTP 409 with `allergyConflict: true`.
   - Prescribing with override but reason < 10 characters returns HTTP 400.
   - Valid override succeeds (HTTP 201) and generates an `audit_logs` record.
5. **Item Validation & Multi-Item Handling:**
   - Prescriptions with 0 items rejected (HTTP 400).
   - Missing dosage, frequency, or non-numeric duration rejected (HTTP 400).
   - Multi-item prescription saves all items into `prescription_items` linked by foreign key.
6. **Status Transitions & State Machine:**
   - Transitioning `Active` to `Dispensed` by Nurse succeeds (HTTP 200).
   - Transitioning `Active` to `Cancelled` by Doctor succeeds (HTTP 200).
   - Attempting to transition `Dispensed` or `Cancelled` returns HTTP 400.
   - Attempting to cancel a billed prescription (`RX-001`) returns HTTP 400.
7. **Transactional Rollback Verification:**
   - If an error occurs inserting prescription items, the entire transaction (including the prescription header row) rolls back cleanly.
8. **Referential Integrity & Seed Preservation:**
   - Seeded prescription `RX-001` is byte-for-byte unchanged at the conclusion of testing.
   - Patients and doctors with prescriptions cannot be deleted (HTTP 409).
   - Sequence row `prescriptions` is cleanly restored to baseline value.
9. **Full Regression Suite:**
   - Run existing test suites (`auth-smoke-test.mjs`, `patient-smoke-test.mjs`, `doctor-smoke-test.mjs`, `appointment-smoke-test.mjs`, `medical-records-smoke-test.mjs`) to confirm 100% pass rate (443+ tests).

---

## 9. Risks & Dependencies

1. **Billing Interoperability:** Unmigrated billing modules query `localStorage.getItem('primecare_prescriptions')`. When `api/prescriptions/` is implemented, `js/api.js` must maintain client-side cache synchronization (`_syncPrescriptionCache()`) so `createBill()` does not break.
2. **Workload Report Aggregation:** The `doctor-workload` report counts prescriptions issued by doctors. `_getPrescriptionsListForMockJoin()` must be added to fetch real database prescriptions.
3. **No Pharmacy Warehouse Table:** Clarify to all stakeholders that pharmacy dispensing is a clinical verification step and does not decrement an inventory ledger, as no inventory schema exists in PrimeCare.

---

## 10. Final Readiness Verdict

### **VERDICT: READY FOR IMPLEMENTATION**

- **Database:** Fully ready. Relational schema, foreign keys, indexes, and sequences are already active in MariaDB.
- **Frontend Contracts:** Fully mapped and compatible with existing conventions.
- **Security:** Clear RBAC boundaries established; no deletion path permitted.
- **Recommended Next Subphase:** **Phase 5.8.2 — Prescriptions & Pharmacy Backend Implementation & Integration**.

