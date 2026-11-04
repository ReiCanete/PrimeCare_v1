# Phase 5.9.2 — Billing & Payments Backend Implementation Report

**Project:** PrimeCare Hospital Information and Patient Management System  
**Environment:** Windows XAMPP (Apache + MariaDB)  
**Database:** `primecare_db`  
**Base Path:** `C:\xampp\htdocs\PrimeCare_v1`  
**Phase:** 5.9.2 — Billing & Payments Backend Migration  
**Status:** **COMPLETED & VERIFIED** (All 701 tests passed across 7 test suites)

---

## 1. Executive Summary

Phase 5.9.2 successfully migrated the **Billing & Payments** module of PrimeCare from simulated client-side `localStorage` storage to the authoritative PHP/MariaDB backend. 

All financial calculations (gross subtotals, statutory 20% discounts for Senior Citizens and PWDs, insurance deductions, net totals due, payments, and balances) are now computed strictly server-side. Multi-table write transactions prevent race conditions and overpayments using `SELECT ... FOR UPDATE` row-level locks. Concurrency guards ensure that inpatient room stays, completed doctor consultations, dispensed pharmacy medications, and completed laboratory tests cannot be billed multiple times. Furthermore, administrative voiding cleanly restores unbilled flags on all linked clinical records.

Zero database schema modifications (`ALTER TABLE` or `DROP TABLE`) were performed. All baseline records (`B-001`, `B-002`, `R-0001`) and sequence configurations are 100% intact.

---

## 2. Inventory of Files Created & Modified

### 2.1 Backend Helper & Business Logic
- [`api/helpers/billing.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/helpers/billing.php): Core domain logic, serialization (camelCase contracts), server-side financial calculation engine (`calculateBillFinancials`), sequence generator for receipts (`allocateNextReceiptNo`), charge preview aggregator (`previewPatientCharges`), transactional bill creator (`createBillRecord`), transactional cashiering (`recordPaymentRecord`), administrative voiding (`voidBillRecord`), and patient installment plan processor (`createPaymentPlanRecord`).

### 2.2 API Endpoints (`api/billing/`)
- [`api/billing/list.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/list.php) (`GET`): List, search, filter, and paginate hospital bills. Enforces patient IDOR scoping (`?my=1` or patient session).
- [`api/billing/get.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/get.php) (`GET`): Retrieve a single bill with itemized line items and payment history. Enforces patient ownership.
- [`api/billing/preview.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/preview.php) (`GET`): Preview unbilled hospital charges across admissions, appointments, prescriptions, and lab tests for a verified patient.
- [`api/billing/create.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/create.php) (`POST`): Create a new bill, insert line items, flag source clinical records (`billed = 1`), and allocate `B-XXX` sequence.
- [`api/billing/pay.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/pay.php) (`POST`): Record payments (Cash, Credit/Debit Card, GCash, Bank Transfer), issue official receipts (`R-XXXX`), update balances, and transition status (`Partial` or `Paid`).
- [`api/billing/void.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/void.php) (`POST`): Admin-only voiding for unpaid bills with $\ge 10$ character audit reason; reverts source clinical records (`billed = 0, bill_id = NULL`).
- [`api/billing/receipt.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/receipt.php) (`GET`): Lookup an official receipt by receipt number (`R-XXXX`) with linked bill.
- [`api/billing/receipts.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/receipts.php) (`GET`): List all payment receipts for the authenticated patient or billing ledger.
- [`api/billing/summary.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/summary.php) (`GET`): Billing dashboard financial KPIs (`unpaidTotal`, `collectedToday`, `collectedMonth`, and status counts).
- [`api/billing/plan.php`](file:///c:/xampp/htdocs/PrimeCare_v1/api/billing/plan.php) (`POST`): Patient-only submission of installment payment plan requests (2–12 months, $\ge 10$ char reason).

### 2.3 Frontend Integration
- [`js/api.js`](file:///c:/xampp/htdocs/PrimeCare_v1/js/api.js):
  - Enabled `_backendConfig.modules.billing = true`.
  - Added `_syncBillCache()` and `_getBillsListForMockJoin()` for synchronization with unmigrated dashboard and reporting modules.
  - Migrated staff methods: `getBills()`, `getBillById()`, `previewBillCharges()`, `createBill()`, `recordPayment()`, `voidBill()`, `getReceipt()`, `getBillingSummary()`.
  - Migrated patient methods: `getMyBills()`, `getMyBillById()`, `getMyReceipts()`, `payMyBill()`, `requestPaymentPlan()`, `getMyInsuranceInfo()`.

### 2.4 Test Probes & Suites
- [`tests/billing-rollback-probe.php`](file:///c:/xampp/htdocs/PrimeCare_v1/tests/billing-rollback-probe.php): CLI transaction rollback verification script.
- [`tests/billing-smoke-test.mjs`](file:///c:/xampp/htdocs/PrimeCare_v1/tests/billing-smoke-test.mjs): 153 automated smoke tests.

---

## 3. Financial Calculation & Validation Implementation

Client-submitted calculations are treated as untrusted hints. The backend re-computes all amounts using `calculateBillFinancials()`:
1. **Subtotal ($S$):**
   $$S = \sum (\text{qty}_i \times \text{unitPrice}_i)$$
   Quantities must be positive integers ($\ge 1$). Unit prices must be non-negative floats ($\ge 0.00$).
2. **Statutory Discounts ($D$):**
   - Senior Citizen: 20% ($0.20 \times S$)
   - PWD: 20% ($0.20 \times S$)
   - Others: 0% ($0.00$)
   - Rounded to 2 decimal places using `round($subtotal * 0.20, 2)`.
3. **Net After Discount ($A$):**
   $$A = \max(0.00, \text{round}(S - D, 2))$$
4. **Third-Party Insurance Deductions ($I$):**
   - Insurance coverage cannot exceed eligible net after-discount amount:
   $$I = \min(A, \max(0.00, \text{round}(\text{insuranceCoverage}, 2)))$$
5. **Net Total Due ($T$):**
   $$T = \max(0.00, \text{round}(A - I, 2))$$
6. **Balance Due ($B$):**
   $$B = \max(0.00, \text{round}(T - \text{amountPaid}, 2))$$

---

## 4. Concurrency, Locking & Anti-Double-Billing Strategy

1. **Charge Aggregation & Verification:**
   - Unbilled source items (`admissions`, `appointments`, `prescriptions`, `lab_results`) are queried where `billed = 0`.
   - Dispensed medications and lab tests resolve authoritative prices from `service_catalog`.
2. **Row Locking on Bill Creation:**
   - Source rows are selected using `SELECT ... FOR UPDATE` within an active transaction.
   - If any source item has already been marked `billed = 1`, the transaction immediately rolls back and returns HTTP 409 Conflict.
3. **Row Locking on Payment Recording:**
   - The bill row is locked using `SELECT * FROM bills WHERE id = :id FOR UPDATE`.
   - Prevents concurrent overpayments or payments on voided/paid bills.
   - Authoritative payment amounts are summed via `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE bill_id = :id`.
4. **Administrative Void Reversion:**
   - Only permitted if `amount_paid == 0` and zero payment rows exist.
   - Restores all linked source clinical records back to `billed = 0` and `bill_id = NULL`.

---

## 5. Role-Based Access Control (RBAC) Matrix

| Operation | Admin | Staff | Doctor | Nurse | Patient |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **List Bills** (`list.php`) | Allowed | Allowed | **403** | **403** | Own bills only |
| **Get Bill Details** (`get.php`) | Allowed | Allowed | **403** | **403** | Own bill only |
| **Preview Charges** (`preview.php`) | Allowed | Allowed | **403** | **403** | **403** |
| **Create Bill** (`create.php`) | Allowed | Allowed | **403** | **403** | **403** |
| **Record Payment** (`pay.php`) | Allowed | Allowed | **403** | **403** | Own bill only |
| **Void Bill** (`void.php`) | Allowed | **403** | **403** | **403** | **403** |
| **Get Receipt** (`receipt.php`) | Allowed | Allowed | **403** | **403** | Own receipt only |
| **List Receipts** (`receipts.php`) | Allowed | Allowed | **403** | **403** | Own receipts only |
| **Billing Summary** (`summary.php`) | Allowed | Allowed | **403** | **403** | **403** |
| **Payment Plan Request** (`plan.php`) | **403** | **403** | **403** | **403** | Own open bill only |

---

## 6. Automated & Regression Test Results

### 6.1 Phase 5.9.2 Billing & Payments Suite
Executed: `node tests/billing-smoke-test.mjs`
- **Result:** **153 passed, 0 failed** (Total: 153)
- Tested: Authentication, Method guards, RBAC, IDOR protection, Financial calculations, Senior Citizen/PWD discounts, Insurance deductions, Charge preview, Source record concurrency locking, Duplicate billing rejection, Payment recording (Cash, Card, GCash), Overpayment rejection, Receipt sequencing (`R-XXXX`), Administrative voiding, Source unflagging, Payment plan requests (2–12 months, duplicate prevention), Transaction rollback verification, Baseline seed preservation.

### 6.2 Full Regression Test Suite
| Suite | Module | Passed | Failed | Status |
| :--- | :--- | :---: | :---: | :---: |
| `tests/billing-smoke-test.mjs` | Billing & Payments | 153 | 0 | **PASS** |
| `tests/prescriptions-smoke-test.mjs` | Prescriptions & Pharmacy | 105 | 0 | **PASS** |
| `tests/medical-records-smoke-test.mjs` | Medical Records & Vitals | 182 | 0 | **PASS** |
| `tests/appointment-smoke-test.mjs` | Appointments & Telehealth | 70 | 0 | **PASS** |
| `tests/doctor-smoke-test.mjs` | Doctors & Scheduling | 58 | 0 | **PASS** |
| `tests/patient-smoke-test.mjs` | Patient Management | 55 | 0 | **PASS** |
| `tests/auth-smoke-test.mjs` | Authentication & Security | 78 | 0 | **PASS** |
| **TOTAL** | **Entire System** | **701** | **0** | **100% PASS** |

---

## 7. Manual Browser Verification Steps

### 7.1 Admin Workflow
1. Navigate to `http://localhost/PrimeCare_v1/login.html` and click **Admin** (`admin` / `password123`).
2. Go to **Billing** (`staff/billing.html`).
3. Verify Summary Cards: Unpaid Bills, Collected Today, Collected This Month.
4. Click **+ Create Bill**:
   - Select patient `Juan Dela Cruz (P-001)`.
   - Click **Load Charges** to load unbilled items or click **+ Add Custom Item**.
   - Select discount type (e.g. `Senior Citizen`) and enter insurance coverage. Verify recalculated totals.
   - Click **Generate Bill**. Verify toast notification and table refresh.
5. In the table, click **View** on an unpaid bill with ₱0.00 payments:
   - Verify the **Void Bill** button is visible for Admins.
   - Click **Void Bill**, enter a reason $\ge 10$ characters, and confirm. Verify bill transitions to `Voided`.

### 7.2 Staff Workflow
1. Log in as **Staff** (`staff` / `password123`).
2. Open `staff/billing.html`.
3. Click **Pay** on bill `B-002` (Unpaid balance ₱800.00).
4. Enter partial payment of ₱300.00 via `Cash`.
5. Submit payment: Verify status becomes `Partial`, balance is ₱500.00, and receipt number `R-XXXX` is generated.
6. Click **View** on `B-002`: Verify the **Void Bill** button is hidden (non-admin staff cannot void).

### 7.3 Patient Portal Workflow
1. Log in as **Patient** (`patient` / `password123`).
2. Open `patient/my-bills.html`.
3. Verify Dashboard cards: Total Balance Due, Total Paid, Open Bills.
4. **Bills Tab:** Verify `B-001` (Paid) and `B-002` (Partial) are listed.
5. Click **Pay** on `B-002`:
   - Select `Credit/Debit Card` and enter simulated card details.
   - Submit payment: Verify balance decreases and receipt is issued under `Online Payment`.
6. Switch to **Receipts Tab**: Verify official receipts with date, method, amount, and printable receipt view.
7. Switch to **Insurance Tab**: Verify PhilHealth claims breakdown.
8. Request Payment Plan: Click **Request Plan** on open bill, select 6 months, enter reason $\ge 10$ characters, and submit.

### 7.4 Clinical Role Denial
1. Log in as **Doctor** (`doctor` / `password123`) or **Nurse** (`nurse` / `password123`).
2. Navigate to `staff/billing.html`.
3. Verify access is denied and the `#access-denied` banner is displayed.

---

## 8. Data Preservation & Safety Confirmation

- **Database Schema:** 0 schema modifications. No `ALTER TABLE` or `DROP TABLE` statements executed.
- **Seeded Records:** `B-001`, `B-002`, and `R-0001` verified byte-for-byte identical via MD5 hashes.
- **Sequence Counters:** `bills` sequence verified at 2; `receipts` sequence verified at 1.
- **Safety Boundaries:** All test data created during test runs was automatically cleaned up.
- **No Git Commit:** Changes remain in the working tree awaiting user review.

