# Phase 5.9.1 — Billing & Payments Backend Readiness Audit

**Project:** PrimeCare Hospital Information and Patient Management System  
**Environment:** Windows XAMPP (Apache + MariaDB)  
**Database:** `primecare_db`  
**Base Path:** `C:\xampp\htdocs\PrimeCare_v1`  
**Phase:** 5.9.1 — Billing & Payments Backend Readiness Audit  
**Audit Type:** READ-ONLY Architectural & Financial Schema Audit  
**Verdict:** **READY FOR IMPLEMENTATION** (Zero schema modifications required)

---

## 1. Executive Summary

This audit evaluates the architectural and database readiness of the **Billing & Payments** module for migration from `localStorage` simulation to the PHP/MariaDB backend.

Billing is the central financial hub of PrimeCare. It aggregates pending clinical charges from inpatient admissions (room and board), outpatient appointments (consultation fees), pharmacy (dispensed medications), and laboratory diagnostics. It calculates gross subtotals, statutory discounts (Senior Citizen / PWD 20%), and third-party insurance coverage (PhilHealth / HMO). Furthermore, it processes partial or full payments, issues system-generated official receipts (`R-XXXX`), supports administrative voiding with audit reasons, and enables patient-initiated payment plan installment requests.

### Key Audit Findings:
1. **Schema 100% Prepared:** The MariaDB database `primecare_db` contains all required tables: `bills`, `bill_items`, `payments`, `payment_plan_requests`, and `service_catalog`.
2. **Zero Schema Alterations Required:** Foreign keys (`fk_bills_patient`, `fk_bills_admission`, `fk_bills_created_by`, `fk_bill_items_bill`, `fk_payments_bill`, `fk_payment_plans_bill`, `fk_payment_plans_patient`) and indexes are already active. No DDL or migrations are needed.
3. **Sequences Configured:** The `sequences` table contains active sequence rows for `bills` (`B`, current value 2, pad 3) and `receipts` (`R`, current value 1, pad 4).
4. **Preserved Seed Baseline:** MariaDB contains seeded records:
   - `B-001` (Paid, total ₱1,250.00, linked to PhilHealth ₱500.00 coverage) with 3 line items (Consultation `A-001`, Medication `RX-001`, Laboratory `LAB-001`).
   - `B-002` (Unpaid, total ₱800.00) with 1 line item (Lipid Profile).
   - `R-0001` (Cash payment of ₱1,250.00 for `B-001`).
   These records are verified intact and will be preserved.
5. **Double-Billing Prevention Protocol:** When a bill is created, source clinical records (`prescriptions`, `appointments`, `admissions`, `lab_results`) are flagged with `billed = 1` and `bill_id = 'B-XXX'`. If a bill is voided by an administrator, these flags are cleanly reverted to `billed = 0` and `bill_id = NULL`.
6. **Strict Role-Based Authorization:**
   - Administrative Staff and Admins manage billing and record payments.
   - Only Admins have permission to void bills (requires mandatory >= 10 character audit reason; permitted only if zero payments exist).
   - Doctors and Nurses are strictly blocked (HTTP 403 Forbidden).
   - Patients have read-only access to their own bills and receipts, can submit online card/GCash payments, and can submit payment plan requests.

---

## 2. Current Architecture & Workflows

### 2.1 Staff Billing Workflow (`staff/billing.html`, `js/billing.js`)
1. **Access Control:**
   - `checkAccess()` restricts access to `admin` and `staff`.
   - `doctor`, `nurse`, and unauthorized users receive the `#access-denied` panel.
   - Admin-only controls (`#btn-void`) are hidden for non-admin staff.
2. **Billing Dashboard & Summary Metrics:**
   - Computes:
     - `Total Unpaid`: Sum of `balance` for bills with status `Unpaid` or `Partial`.
     - `Collected Today`: Sum of payments where `DATE(paid_at) = CURDATE()`.
     - `Collected This Month`: Sum of payments where `YEAR(paid_at) = YEAR(CURDATE()) AND MONTH(paid_at) = MONTH(CURDATE())`.
     - `Bills Pending`: Count of bills with status `Unpaid` or `Partial`.
3. **Bill Listing, Search & Filters:**
   - Filter by keyword (searches Bill ID and patient full name).
   - Filter by status (`All`, `Unpaid`, `Partial`, `Paid`, `Voided`).
   - Filter by date range (`dateFrom`, `dateTo`).
   - Paginated display (10 records per page).
4. **Bill Creation Modal (`#new-bill-modal`):**
   - Staff selects a verified patient.
   - Clicking **Load Charges** calls `api.previewBillCharges(patientId)`:
     - Unbilled admissions: Calculates length of stay (`days * dailyRate`) and room type.
     - Unbilled completed appointments: Adds doctor consultation fee.
     - Unbilled dispensed prescriptions: Adds medication item lines with quantities and catalog prices.
     - Unbilled completed lab tests: Adds laboratory procedure fees.
   - Staff may manually add custom charge items (e.g. medical supplies, surgical materials, ambulance).
   - Real-time client-side calculation:
     - Subtotal = sum of item amounts (`qty * unitPrice`).
     - Discount: 20% on subtotal if `Senior Citizen` or `PWD`.
     - Insurance coverage: Deducts PhilHealth or HMO benefit (capped at `subtotal - discount`).
     - Total Due = `subtotal - discount - insuranceCoverage`.
   - Submitting calls `api.createBill(data)`.
5. **View Bill & Statement of Account Modal (`#view-bill-modal`):**
   - Displays Statement of Account with grouped categories:
     - Room Accommodation / Room & Board
     - Professional Fees
     - Pharmacy / Medications / Supplies
     - Laboratory / Diagnostics
     - Other Services / Miscellaneous
   - Shows gross subtotal, itemized discount breakdown, insurance deductions, amount paid, and net balance due.
   - Lists full payment history with timestamps, receipt numbers, payment methods, and amounts.
   - Printable formatted invoice (`window.print()`).
6. **Payment Recording Modal (`#pay-modal`):**
   - Opened from bill view or quick-pay action.
   - Validates that bill is not Paid or Voided.
   - Default payment amount is the remaining `balance`.
   - Payment method options: `Cash`, `Credit/Debit Card`, `GCash`, `Bank Transfer`.
   - Non-cash methods require a reference number.
   - Submitting generates a receipt number `R-XXXX`, updates bill `amount_paid` and `balance`, transitions status (`Partial` or `Paid`), and prompts to print the official receipt.
7. **Administrative Void Flow:**
   - Admin clicks **Void Bill** on an unpaid bill with 0 payments.
   - Prompt requires justification of at least 10 characters.
   - Marks status as `Voided`, stores `void_reason`, reverts all source items' `billed` flags to 0, and writes an audit log.

### 2.2 Patient Portal Workflow (`patient/my-bills.html`, `js/patient-bills.js`)
1. **Patient Dashboard:**
   - Shows patient-specific metrics: `Total Balance Due`, `Total Paid`, `Open Bills`.
2. **Tabs Interface:**
   - **Bills Tab:** Lists all bills for the authenticated patient. Shows Total, Paid, Balance, and Status.
   - **Receipts Tab:** Lists all official receipts issued to the patient with payment date, bill ID, payment method, and amount.
   - **Insurance Tab:** Shows registered insurance provider, policy number, and breakdown of claims applied to bills.
3. **Online Bill Payment (`payMyBill`):**
   - Patient can pay bills directly online via Credit/Debit card (with Luhn algorithm and expiry check) or GCash (mobile number validation).
   - Generates an official receipt attributed to `'Online Payment'`.
4. **Payment Plan Request (`requestPaymentPlan`):**
   - For open bills (`balance > 0`), patient can request an installment plan (2 to 12 months) with a mandatory minimum 10-character reason.
   - Saves into `payment_plan_requests` table with status `'Pending'`.
   - Duplicate pending requests for the same bill are blocked.

---

## 3. Database Inventory & Relationship Map

### 3.1 Table: `bills`
```sql
CREATE TABLE `bills` (
  `id` varchar(20) NOT NULL,
  `patient_id` varchar(20) NOT NULL,
  `admission_id` varchar(20) DEFAULT NULL,
  `subtotal` decimal(10,2) NOT NULL DEFAULT 0.00,
  `discount_type` varchar(50) NOT NULL DEFAULT 'None',
  `discount_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `insurance_provider` varchar(100) DEFAULT '',
  `insurance_coverage` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total` decimal(10,2) NOT NULL DEFAULT 0.00,
  `amount_paid` decimal(10,2) NOT NULL DEFAULT 0.00,
  `balance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `status` enum('Unpaid','Partial','Paid','Voided') NOT NULL DEFAULT 'Unpaid',
  `void_reason` text DEFAULT NULL,
  `created_by` varchar(20) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bills_patient` (`patient_id`),
  KEY `idx_bills_admission` (`admission_id`),
  KEY `idx_bills_status_date` (`status`,`created_at`),
  KEY `fk_bills_created_by` (`created_by`),
  CONSTRAINT `fk_bills_admission` FOREIGN KEY (`admission_id`) REFERENCES `admissions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_bills_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_bills_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.2 Table: `bill_items`
```sql
CREATE TABLE `bill_items` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `bill_id` varchar(20) NOT NULL,
  `item_type` varchar(50) NOT NULL COMMENT 'Room, Professional Fee, Medication, Laboratory, etc.',
  `description` varchar(255) NOT NULL,
  `qty` int(10) unsigned NOT NULL DEFAULT 1,
  `unit_price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `source_type` varchar(50) DEFAULT NULL COMMENT 'admissions, appointments, prescriptions, labResults',
  `source_id` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bill_items_bill` (`bill_id`),
  KEY `idx_bill_items_source` (`source_type`,`source_id`),
  CONSTRAINT `fk_bill_items_bill` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.3 Table: `payments`
```sql
CREATE TABLE `payments` (
  `receipt_no` varchar(20) NOT NULL,
  `bill_id` varchar(20) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `method` varchar(50) NOT NULL COMMENT 'Cash, Credit/Debit Card, GCash, Bank Transfer',
  `reference_no` varchar(100) DEFAULT '',
  `paid_at` datetime NOT NULL,
  `received_by` varchar(150) NOT NULL,
  PRIMARY KEY (`receipt_no`),
  KEY `idx_payments_bill` (`bill_id`),
  KEY `idx_payments_paid_at` (`paid_at`),
  CONSTRAINT `fk_payments_bill` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.4 Table: `payment_plan_requests`
```sql
CREATE TABLE `payment_plan_requests` (
  `id` varchar(30) NOT NULL,
  `bill_id` varchar(20) NOT NULL,
  `patient_id` varchar(20) NOT NULL,
  `months` int(10) unsigned NOT NULL,
  `reason` text NOT NULL,
  `status` enum('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_payment_plans_bill` (`bill_id`),
  KEY `idx_payment_plans_patient` (`patient_id`),
  CONSTRAINT `fk_payment_plans_bill` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_payment_plans_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.5 Relational Diagram
```
                     +-------------------+
                     |     patients      |
                     +---------+---------+
                               |
                               | 1:N (fk_bills_patient)
                               v
+------------------+ 1:N     +-------------------+     N:1 (fk_bills_admission)     +------------------+
|      users       +-------->+       bills       +<---------------------------------+    admissions    |
+------------------+         +---+---+-------+---+                                  +------------------+
  (fk_bills_created_by)          |   |       |
                                 |   |       | 1:N (fk_bill_items_bill - CASCADE)
                                 |   |       v
                                 |   |     +-------------------+
                                 |   |     |    bill_items     |
                                 |   |     +-------------------+
                                 |   |       (source_type, source_id polymorphic)
                                 |   |
                                 |   | 1:N (fk_payments_bill - RESTRICT)
                                 |   v
                                 | +-------------------+
                                 | |     payments      |
                                 | +-------------------+
                                 |
                                 | 1:N (fk_payment_plans_bill - CASCADE)
                                 v
                               +-------------------+
                               |payment_plan_reqs  |
                               +-------------------+
```

### 3.6 Seeded Baseline Records
- `bills`:
  - `B-001`: `P-001`, Subtotal ₱1,750.00, Discount ₱0.00, PhilHealth ₱500.00, Total ₱1,250.00, Paid ₱1,250.00, Balance ₱0.00, Status `Paid`, Created `2026-11-02 10:00:00` by `U-004`.
  - `B-002`: `P-001`, Subtotal ₱800.00, Discount ₱0.00, Insurance ₱0.00, Total ₱800.00, Paid ₱0.00, Balance ₱800.00, Status `Unpaid`, Created `2026-11-03 11:00:00` by `U-001`.
- `bill_items`:
  - Item 1 (`B-001`): `Professional Fee`, `Consultation - Dr. Jose Rizal`, qty 1, price 1000.00, amount 1000.00, source: `appointments` / `A-001`.
  - Item 2 (`B-001`): `Medication`, `Artificial Tears`, qty 1, price 250.00, amount 250.00, source: `prescriptions` / `RX-001`.
  - Item 3 (`B-001`): `Laboratory`, `Complete Blood Count`, qty 1, price 500.00, amount 500.00, source: `labResults` / `LAB-001`.
  - Item 4 (`B-002`): `Laboratory`, `Lipid Profile`, qty 1, price 800.00, amount 800.00.
- `payments`:
  - Receipt `R-0001` (`B-001`): ₱1,250.00, `Cash`, Paid `2026-11-02 14:30:00`, Received by `Andres Bonifacio`.
- `sequences`:
  - `bills`: Prefix `B`, current value 2, pad length 3 (`B-003` next).
  - `receipts`: Prefix `R`, current value 1, pad length 4 (`R-0002` next).

---

## 4. Financial Calculations & State Transitions

### 4.1 Server-Side Formula Specifications
The backend must never trust client-computed totals and must re-calculate all values:
1. **Gross Subtotal ($S$):**
   $$S = \sum_{i=1}^{n} (\text{qty}_i \times \text{unitPrice}_i)$$
2. **Statutory Discount ($D$):**
   - If `discountType` is `'Senior Citizen'` or `'PWD'`:
     $$D = \text{ROUND}(S \times 0.20, 2)$$
   - Otherwise:
     $$D = 0.00$$
3. **Net After Discount ($A$):**
   $$A = \max(0.00, S - D)$$
4. **Third-Party Insurance Deduction ($I$):**
   - Validated non-negative float.
   $$I = \min(A, \text{ROUND}(\text{insuranceCoverage}, 2))$$
5. **Net Total Due ($T$):**
   $$T = \text{ROUND}(A - I, 2)$$
6. **Balance Due ($B$):**
   $$B = \max(0.00, \text{ROUND}(T - \text{amountPaid}, 2))$$

### 4.2 Status Lifecycle State Machine
```
           +------------------+
           |      Unpaid      |  (amountPaid == 0)
           +--------+---------+
                    |
       +------------+------------+
       |                         |
       v                         v
+--------------+          +--------------+
|   Partial    |          |     Paid     |  (amountPaid >= total, balance == 0)
+------+-------+          +--------------+
       |                         ^
       +-------------------------+
                    |
      (additional payment completes balance)

Special State:
  Unpaid ----(Admin Void with >= 10 char reason)----> Voided (Terminal)
  (Void is only permitted if payments count == 0 and amountPaid == 0)
```

---

## 5. Security, RBAC & IDOR Matrix

| Endpoint / Action | Method | Admin | Staff | Doctor | Nurse | Patient |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **List Bills** (`list.php`) | `GET` | All | All | **403** | **403** | Own Bills Only (IDOR Protected) |
| **Get Bill Details** (`get.php`) | `GET` | Allowed | Allowed | **403** | **403** | Own Bill Only (IDOR Protected) |
| **Preview Charges** (`preview.php`) | `GET` | Allowed | Allowed | **403** | **403** | **403 Forbidden** |
| **Create Bill** (`create.php`) | `POST` | Allowed | Allowed | **403** | **403** | **403 Forbidden** |
| **Record Payment** (`pay.php`) | `POST` | Allowed | Allowed | **403** | **403** | Allowed (Own bill only) |
| **Void Bill** (`void.php`) | `POST` | Allowed | **403** | **403** | **403** | **403 Forbidden** |
| **Get Receipt** (`receipt.php`) | `GET` | Allowed | Allowed | **403** | **403** | Own Receipt Only (IDOR Protected) |
| **Billing Summary** (`summary.php`) | `GET` | Allowed | Allowed | **403** | **403** | **403 Forbidden** |
| **Payment Plan Request** (`plan.php`) | `POST` | **403** | **403** | **403** | **403** | Allowed (Own open bill only) |

### Key Security Safeguards:
1. **Patient IDOR Prevention:**
   - In `list.php`: If called by a patient session, the backend strictly overrides `$patientId = $currentUser['patient_id']`.
   - In `get.php`: If the bill's `patient_id` does not match `$currentUser['patient_id']`, returns HTTP 403.
   - In `pay.php`: Patients can only submit payments against their own bills.
2. **Clinical Role Isolation:**
   - Doctors and Nurses do not participate in hospital cashiering and are blocked with HTTP 403.
3. **Double-Payment & Overpayment Guards:**
   - Payment recording runs inside an atomic database transaction using row-level locking (`SELECT ... FOR UPDATE` on `bills`).
   - If payment amount exceeds the current `balance`, the request is rejected with HTTP 400.
4. **CSRF Enforcement:**
   - Every mutating request (`create.php`, `pay.php`, `void.php`, `plan.php`) requires a valid `X-CSRF-Token`.

---

## 6. Frontend Migration Inventory (`js/api.js`)

| Frontend Method | Current Implementation | Proposed PHP Endpoint | Notes & Payload |
| :--- | :--- | :--- | :--- |
| `getBills(filters)` | `this.getAll('bills')` | `GET api/billing/list.php` | Supports `patientId`, `status`, `keyword`, `dateFrom`, `dateTo`. Joins `patientName`. |
| `getBillById(id)` | `this.getById('bills', id)` | `GET api/billing/get.php?id={id}` | Returns bill with `items` and `payments` array. |
| `previewBillCharges(pid)` | Multi-table mock join | `GET api/billing/preview.php?patientId={pid}` | Queries unbilled admissions, appointments, dispensed prescriptions, and lab results. |
| `createBill(data)` | `localStorage` item append | `POST api/billing/create.php` | Server computes totals, flags source records, acquires `B-XXX` sequence. |
| `recordPayment(billId, data)` | `localStorage` item append | `POST api/billing/pay.php` | Atomically locks bill, updates balance, creates receipt `R-XXXX`. |
| `voidBill(id, reason)` | `localStorage` item mutation | `POST api/billing/void.php` | Admin-only. Requires >= 10 char reason. Unflags source records. |
| `getReceipt(receiptNo)` | In-memory loop | `GET api/billing/receipt.php?receiptNo={no}` | Returns receipt details with linked bill. |
| `getBillingSummary()` | In-memory loop | `GET api/billing/summary.php` | Computes unpaidTotal, collectedToday, collectedMonth, status counts. |
| `getMyBills(filters)` | In-memory patient filter | `GET api/billing/list.php?my=1` | Server-scoped to patient session. |
| `getMyReceipts()` | In-memory patient filter | `GET api/billing/receipts.php?my=1` | Returns all receipts for the authenticated patient. |
| `payMyBill(billId, data)` | Client Luhn / GCash check | Client checks then calls `recordPayment` | Keep client-side validation; backend records payment. |
| `requestPaymentPlan(billId, m, r)` | `localStorage` append | `POST api/billing/plan.php` | Inserts into `payment_plan_requests`. |

---

## 7. Financial Integrity Risks & Mitigation Plan

1. **Floating Point Rounding Errors:**
   - *Risk:* Binary floating point arithmetic can lead to fraction-of-a-cent discrepancies (e.g. ₱0.0000001).
   - *Mitigation:* The MariaDB schema uses `DECIMAL(10,2)`. The PHP backend will use `round($val, 2)` for all arithmetic and store exact fixed-point strings.
2. **Concurrent Payments (Double Payment):**
   - *Risk:* Two cashiers or a cashier and an online patient submit payments simultaneously, resulting in overpayment or negative balance.
   - *Mitigation:* Use `$pdo->beginTransaction()` and `SELECT balance, status, total, amount_paid FROM bills WHERE id = :id FOR UPDATE`. Calculate the new balance within the locked transaction.
3. **Double-Billing of Source Records:**
   - *Risk:* Creating a bill fails midway, leaving prescriptions partially flagged as billed.
   - *Mitigation:* The entire bill creation workflow—inserting `bills`, inserting `bill_items`, and updating `appointments`, `prescriptions`, `admissions`, `lab_results`—must execute inside a single transaction with automatic rollback on any failure.
4. **Void Invariant:**
   - *Risk:* Voiding a bill after a payment was recorded breaks cashier accounting ledgers.
   - *Mitigation:* The backend strictly rejects voiding if `amount_paid > 0` or if any payment row exists in `payments` (HTTP 400).

---

## 8. Test Plan (Phase 5.9.2)

An automated smoke test suite (`tests/billing-smoke-test.mjs`) will test:
1. **Unauthenticated & Method Guards:**
   - Unauthenticated GET/POST requests return HTTP 401.
   - GET on POST endpoints returns HTTP 405.
   - Delete endpoint `api/billing/delete.php` does not exist (HTTP 404).
2. **Role-Based Access Control:**
   - `staff` and `admin` can list, view, create bills, and record payments.
   - `staff` cannot void bills (HTTP 403). Only `admin` can void.
   - `doctor` and `nurse` are blocked from all billing endpoints (HTTP 403).
   - `patient` can only view own bills/receipts and make payments on own bills.
3. **Patient IDOR Protection:**
   - `patient` (P-001) reads own bills (`B-001`, `B-002`).
   - `patient2` (P-002) attempting `get.php?id=B-001` receives HTTP 403.
   - `patient2` querying `list.php?patientId=P-001` receives 0 records.
   - `patient2` attempting to pay `B-001` receives HTTP 403.
4. **Charge Preview & Calculation Engine:**
   - `preview.php` loads pending items (appointments, dispensed prescriptions, etc.).
   - Creating a bill correctly calculates subtotal, 20% Senior/PWD discount, and insurance deductions.
5. **Source Record Linkage & Anti-Double-Billing:**
   - When a bill is created with a dispensed prescription or completed appointment, those source records are marked `billed = 1` and linked to the bill ID.
   - Re-running `preview.php` no longer lists the billed items.
6. **Payment Recording & State Machine:**
   - Partial payment: Bill status transitions from `Unpaid` to `Partial`.
   - Full payment: Bill status transitions from `Partial` to `Paid`. Balance becomes 0.00.
   - Overpayment: Submitting payment amount > balance is rejected (HTTP 400).
   - Receipt generation: Generates sequential `R-XXXX` receipt stored in `payments`.
7. **Administrative Void Flow:**
   - Voiding bill with payments is rejected (HTTP 400).
   - Voiding unpaid bill with reason < 10 characters is rejected (HTTP 400).
   - Valid void transitions status to `Voided`, stores reason, and restores source items (`billed = 0`, `bill_id = NULL`).
8. **Payment Plan Requests:**
   - Patient submits installment request (2-12 months, min 10 char reason).
   - Stored in `payment_plan_requests`. Duplicate pending request rejected (HTTP 400).
9. **Transaction Rollback:**
   - Probe script verifies that an error during bill item insertion rolls back the bill row and leaves sequence and source records untouched.
10. **Baseline Seed Preservation:**
    - Seeded records `B-001`, `B-002`, and `R-0001` remain byte-for-byte identical after testing.
    - Sequences `bills` and `receipts` are cleanly restored.

---

## 9. Unresolved Business Decisions & Recommendations

| Decision Item | Analysis | Audit Recommendation |
| :--- | :--- | :--- |
| **Payment Plan Approval UI** | Currently, patients can request payment plans, but staff has no UI to approve/reject them. | Keep status `'Pending'` in `payment_plan_requests`. Document the schema readiness for a future staff review screen. |
| **Refunds / Payment Reversals** | Neither the UI nor schema has a `refunds` table or reversal flow. | Maintain current rule: payments are immutable official receipts. If an error occurs, it is handled via administrative manual ledger adjustment. |
| **Online Card Processing** | Patient card payment uses client-side Luhn / expiry check. | Retain existing simulated validation. In production, this would be replaced with a payment gateway (e.g. PayMongo or Stripe). |

---

## 10. Implementation Order & Readiness Verdict

### **VERDICT: READY FOR IMPLEMENTATION**

- **Database:** 100% prepared. All tables, foreign keys, indexes, and sequences are active in MariaDB.
- **Dependencies:** Patient, Doctor, Appointment, and Prescriptions modules are fully migrated to PHP/MariaDB.
- **Recommended Next Subphase:** **Phase 5.9.2 — Billing & Payments Backend Implementation & Integration**.

