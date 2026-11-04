<?php
/**
 * PrimeCare - Billing & Payments Helpers, Serializers, Validators & Writers
 * Phase 5.9.2: Billing & Payments Backend Migration
 *
 * Tables used (no schema changes):
 * - `bills`
 * - `bill_items`
 * - `payments`
 * - `payment_plan_requests`
 * - `service_catalog`
 * - `admissions`
 * - `appointments`
 * - `prescriptions`
 * - `lab_results`
 * - `patients`
 * - `users`
 * - `audit_logs`
 * - `sequences`
 */

declare(strict_types=1);

// Prevent direct HTTP access
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => 'Direct access to helper files is forbidden.',
        'data'    => null,
    ]);
    exit;
}

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/patients.php';
require_once __DIR__ . '/doctors.php';
require_once __DIR__ . '/appointments.php';
require_once __DIR__ . '/prescriptions.php';

// Billing roles
const PRIMECARE_BILLING_STAFF_ROLES  = ['admin', 'staff'];
const PRIMECARE_BILLING_STATUSES     = ['Unpaid', 'Partial', 'Paid', 'Voided'];
const PRIMECARE_PAYMENT_METHODS      = ['Cash', 'Credit/Debit Card', 'GCash', 'Bank Transfer'];
const PRIMECARE_BILL_ITEM_TYPES      = ['Room', 'Professional Fee', 'Medication', 'Laboratory', 'Other'];
const PRIMECARE_PAYMENT_PLAN_STATUSES = ['Pending', 'Approved', 'Rejected'];

// -----------------------------------------------------------------------------
// Serialization Helpers
// -----------------------------------------------------------------------------

/**
 * Format timestamp into ISO-8601 string ("2026-11-02T10:00:00")
 */
function formatBillingTimestamp(mixed $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return str_replace(' ', 'T', (string) $value);
}

/**
 * Serialize a single bill item to camelCase contract
 */
function serializeBillItem(array $item): array
{
    $itemType = (string) ($item['item_type'] ?? 'Other');
    return [
        'id'          => isset($item['id']) ? (int) $item['id'] : null,
        'billId'      => (string) ($item['bill_id'] ?? ''),
        'type'        => $itemType,
        'itemType'    => $itemType,
        'description' => (string) ($item['description'] ?? ''),
        'qty'         => (int) ($item['qty'] ?? 1),
        'unitPrice'   => round((float) ($item['unit_price'] ?? 0.0), 2),
        'amount'      => round((float) ($item['amount'] ?? 0.0), 2),
        'sourceType'  => $item['source_type'] !== null && $item['source_type'] !== '' ? (string) $item['source_type'] : null,
        'sourceId'    => $item['source_id'] !== null && $item['source_id'] !== '' ? (string) $item['source_id'] : null,
    ];
}

/**
 * Serialize a single payment/receipt to camelCase contract
 */
function serializePayment(array $payment): array
{
    $ref = (string) ($payment['reference_no'] ?? '');
    return [
        'receiptNo'   => (string) $payment['receipt_no'],
        'billId'      => (string) $payment['bill_id'],
        'amount'      => round((float) $payment['amount'], 2),
        'method'      => (string) $payment['method'],
        'reference'   => $ref,
        'referenceNo' => $ref,
        'paidAt'      => formatBillingTimestamp($payment['paid_at']),
        'receivedBy'  => (string) ($payment['received_by'] ?? ''),
    ];
}

/**
 * Serialize a single payment plan request
 */
function serializePaymentPlan(array $plan): array
{
    return [
        'id'        => (string) $plan['id'],
        'billId'    => (string) $plan['bill_id'],
        'patientId' => (string) $plan['patient_id'],
        'months'    => (int) $plan['months'],
        'reason'    => (string) $plan['reason'],
        'status'    => (string) $plan['status'],
        'createdAt' => formatBillingTimestamp($plan['created_at']),
    ];
}

/**
 * Serialize a bill row with child items and payments
 */
function serializeBill(array $bill, array $items = [], array $payments = []): array
{
    return [
        'id'                => (string) $bill['id'],
        'patientId'         => (string) $bill['patient_id'],
        'patientName'       => (string) ($bill['patient_name'] ?? 'Unknown'),
        'admissionId'       => $bill['admission_id'] !== null && $bill['admission_id'] !== '' ? (string) $bill['admission_id'] : null,
        'subtotal'          => round((float) $bill['subtotal'], 2),
        'discountType'      => (string) ($bill['discount_type'] ?? 'None'),
        'discountAmount'    => round((float) ($bill['discount_amount'] ?? 0.0), 2),
        'insuranceProvider' => (string) ($bill['insurance_provider'] ?? ''),
        'insuranceCoverage' => round((float) ($bill['insurance_coverage'] ?? 0.0), 2),
        'total'             => round((float) $bill['total'], 2),
        'amountPaid'        => round((float) ($bill['amount_paid'] ?? 0.0), 2),
        'balance'           => round((float) ($bill['balance'] ?? 0.0), 2),
        'status'            => (string) $bill['status'],
        'voidReason'        => $bill['void_reason'] !== null ? (string) $bill['void_reason'] : null,
        'createdBy'         => $bill['created_by'] !== null ? (string) $bill['created_by'] : null,
        'createdAt'         => formatBillingTimestamp($bill['created_at']),
        'updatedAt'         => formatBillingTimestamp($bill['updated_at'] ?? $bill['created_at']),
        'items'             => array_map('serializeBillItem', $items),
        'payments'          => array_map('serializePayment', $payments),
    ];
}

// -----------------------------------------------------------------------------
// Financial Calculation Engine
// -----------------------------------------------------------------------------

/**
 * Server-side authoritative calculation of bill amounts.
 * Never trusts client-computed subtotals, discounts, totals, or balances.
 *
 * @param array  $items             List of bill items (each having 'qty' and 'unitPrice' or 'unit_price')
 * @param string $discountType      'None', 'Senior Citizen', 'PWD', etc.
 * @param float  $insuranceCoverage Third-party insurance coverage amount
 * @param float  $amountPaid        Authoritative amount paid so far
 * @return array Calculated values: subtotal, discountAmount, discountType, insuranceCoverage, total, amountPaid, balance
 */
function calculateBillFinancials(
    array $items,
    string $discountType,
    float $insuranceCoverage,
    float $amountPaid = 0.0
): array {
    $subtotal = 0.0;
    foreach ($items as $item) {
        $qty = max(1, (int) ($item['qty'] ?? 1));
        $price = max(0.0, (float) ($item['unitPrice'] ?? $item['unit_price'] ?? 0.0));
        $subtotal += round($qty * $price, 2);
    }
    $subtotal = round($subtotal, 2);

    // Statutory discounts: 20% for Senior Citizen and PWD
    $discountAmount = 0.0;
    $normDiscount = trim($discountType);
    if ($normDiscount === 'Senior Citizen' || $normDiscount === 'PWD') {
        $discountAmount = round($subtotal * 0.20, 2);
    } else {
        $normDiscount = 'None';
    }

    $afterDiscount = max(0.00, round($subtotal - $discountAmount, 2));

    // Insurance coverage cannot exceed amount after discount
    $validCoverage = max(0.00, round($insuranceCoverage, 2));
    if ($validCoverage > $afterDiscount) {
        $validCoverage = $afterDiscount;
    }

    $total = max(0.00, round($afterDiscount - $validCoverage, 2));
    $paid  = max(0.00, round($amountPaid, 2));
    $balance = max(0.00, round($total - $paid, 2));

    return [
        'subtotal'          => $subtotal,
        'discountType'      => $normDiscount,
        'discountAmount'    => $discountAmount,
        'insuranceCoverage' => $validCoverage,
        'total'             => $total,
        'amountPaid'        => $paid,
        'balance'           => $balance,
    ];
}

// -----------------------------------------------------------------------------
// Sequence Management
// -----------------------------------------------------------------------------

/**
 * Atomically allocate the next Receipt Number (R-XXXX) using `sequences` and `payments`.
 */
function allocateNextReceiptNo(PDO $pdo): string
{
    $seqStmt = $pdo->prepare("SELECT prefix, current_val, pad_length FROM sequences WHERE entity_key = 'receipts' FOR UPDATE");
    $seqStmt->execute();
    $seq = $seqStmt->fetch();

    $prefix = is_array($seq) ? (string) $seq['prefix'] : 'R';
    $pad    = is_array($seq) ? (int) $seq['pad_length'] : 4;
    $next   = is_array($seq) ? ((int) $seq['current_val'] + 1) : 1;

    $existingStmt = $pdo->query("SELECT receipt_no FROM payments");
    if ($existingStmt) {
        while ($r = $existingStmt->fetch()) {
            if (isset($r['receipt_no']) && preg_match('/(\d+)$/', (string) $r['receipt_no'], $m)) {
                $num = (int) $m[1];
                if ($num >= $next) {
                    $next = $num + 1;
                }
            }
        }
    }

    $checkStmt = $pdo->prepare("SELECT 1 FROM payments WHERE receipt_no = :no LIMIT 1");
    while (true) {
        $candidate = $prefix . '-' . str_pad((string) $next, $pad, '0', STR_PAD_LEFT);
        $checkStmt->execute([':no' => $candidate]);
        if (!$checkStmt->fetch()) {
            break;
        }
        $next++;
    }

    if (is_array($seq)) {
        $upd = $pdo->prepare("UPDATE sequences SET current_val = :val WHERE entity_key = 'receipts'");
        $upd->execute([':val' => $next]);
    } else {
        $ins = $pdo->prepare("INSERT INTO sequences (entity_key, prefix, current_val, pad_length) VALUES ('receipts', :prefix, :val, :pad)");
        $ins->execute([':prefix' => $prefix, ':val' => $next, ':pad' => $pad]);
    }

    return $candidate;
}

// -----------------------------------------------------------------------------
// Query & Fetch Helpers
// -----------------------------------------------------------------------------

/**
 * Fetch bills with search, filters, pagination support, and patient IDOR restrictions.
 */
function fetchBills(PDO $pdo, array $filters, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');
    $where = [];
    $params = [];

    // Patient IDOR protection
    if ($role === 'patient') {
        $where[] = 'b.patient_id = :own_patient_id';
        $params[':own_patient_id'] = (string) ($currentUser['patient_id'] ?? '');
    } elseif (!empty($filters['patientId'])) {
        $where[] = 'b.patient_id = :patient_id';
        $params[':patient_id'] = $filters['patientId'];
    }

    // Status filter
    if (!empty($filters['status']) && $filters['status'] !== 'All') {
        $where[] = 'b.status = :status';
        $params[':status'] = $filters['status'];
    }

    // Date range filter
    if (!empty($filters['dateFrom'])) {
        $where[] = 'DATE(b.created_at) >= :date_from';
        $params[':date_from'] = $filters['dateFrom'];
    }
    if (!empty($filters['dateTo'])) {
        $where[] = 'DATE(b.created_at) <= :date_to';
        $params[':date_to'] = $filters['dateTo'];
    }

    // Keyword search (bill ID or patient name)
    if (!empty($filters['keyword'])) {
        $where[] = "(b.id LIKE :kw OR CONCAT_WS(' ', p.first_name, p.last_name) LIKE :kw)";
        $params[':kw'] = '%' . $filters['keyword'] . '%';
    }

    $whereSql = !empty($where) ? 'WHERE ' . implode(' AND ', $where) : '';

    $sql = "
        SELECT 
            b.*,
            CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name
        FROM bills b
        LEFT JOIN patients p ON b.patient_id = p.id
        {$whereSql}
        ORDER BY b.created_at DESC
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $billRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($billRows)) {
        return [];
    }

    // Pre-load child items and payments for all returned bills
    $billIds = array_column($billRows, 'id');
    $placeholders = implode(',', array_fill(0, count($billIds), '?'));

    // Fetch items
    $itemStmt = $pdo->prepare("SELECT * FROM bill_items WHERE bill_id IN ({$placeholders}) ORDER BY id ASC");
    $itemStmt->execute($billIds);
    $allItems = $itemStmt->fetchAll(PDO::FETCH_ASSOC);
    $itemsByBill = [];
    foreach ($allItems as $it) {
        $itemsByBill[$it['bill_id']][] = $it;
    }

    // Fetch payments
    $payStmt = $pdo->prepare("SELECT * FROM payments WHERE bill_id IN ({$placeholders}) ORDER BY paid_at ASC");
    $payStmt->execute($billIds);
    $allPayments = $payStmt->fetchAll(PDO::FETCH_ASSOC);
    $paymentsByBill = [];
    foreach ($allPayments as $py) {
        $paymentsByBill[$py['bill_id']][] = $py;
    }

    $serialized = [];
    foreach ($billRows as $row) {
        $bId = $row['id'];
        $bItems = $itemsByBill[$bId] ?? [];
        $bPayments = $paymentsByBill[$bId] ?? [];
        $serialized[] = serializeBill($row, $bItems, $bPayments);
    }

    return $serialized;
}

/**
 * Find a single bill by ID with child items and payment history.
 * Enforces patient IDOR check if currentUser is a patient.
 *
 * @return array|null Returns serialized bill array, or null if not found / forbidden.
 */
function findBillById(PDO $pdo, string $id, ?array $currentUser = null): ?array
{
    $stmt = $pdo->prepare("
        SELECT 
            b.*,
            CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name
        FROM bills b
        LEFT JOIN patients p ON b.patient_id = p.id
        WHERE b.id = :id
        LIMIT 1
    ");
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!is_array($row)) {
        return null;
    }

    // Patient IDOR check
    if ($currentUser !== null && ($currentUser['role'] ?? '') === 'patient') {
        $ownPatientId = (string) ($currentUser['patient_id'] ?? '');
        if ($ownPatientId === '' || $row['patient_id'] !== $ownPatientId) {
            return null;
        }
    }

    // Fetch items
    $itemStmt = $pdo->prepare("SELECT * FROM bill_items WHERE bill_id = :id ORDER BY id ASC");
    $itemStmt->execute([':id' => $id]);
    $items = $itemStmt->fetchAll(PDO::FETCH_ASSOC);

    // Fetch payments
    $payStmt = $pdo->prepare("SELECT * FROM payments WHERE bill_id = :id ORDER BY paid_at ASC");
    $payStmt->execute([':id' => $id]);
    $payments = $payStmt->fetchAll(PDO::FETCH_ASSOC);

    return serializeBill($row, $items, $payments);
}

/**
 * Fetch a receipt by receipt_no with its parent bill.
 */
function fetchReceiptByNo(PDO $pdo, string $receiptNo, ?array $currentUser = null): ?array
{
    $stmt = $pdo->prepare("SELECT * FROM payments WHERE receipt_no = :no LIMIT 1");
    $stmt->execute([':no' => $receiptNo]);
    $payRow = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!is_array($payRow)) {
        return null;
    }

    $bill = findBillById($pdo, (string) $payRow['bill_id'], $currentUser);
    if ($bill === null) {
        return null;
    }

    return [
        'receipt' => serializePayment($payRow),
        'bill'    => $bill,
    ];
}

/**
 * Fetch all receipts belonging to a patient (IDOR safe).
 */
function fetchPatientReceipts(PDO $pdo, string $patientId): array
{
    $stmt = $pdo->prepare("
        SELECT 
            py.*,
            b.patient_id
        FROM payments py
        JOIN bills b ON py.bill_id = b.id
        WHERE b.patient_id = :pid
        ORDER BY py.paid_at ASC
    ");
    $stmt->execute([':pid' => $patientId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $receipts = [];
    foreach ($rows as $r) {
        $receipts[] = serializePayment($r);
    }
    return $receipts;
}

/**
 * Compute billing dashboard metrics.
 */
function fetchBillingSummary(PDO $pdo): array
{
    // Unpaid total (sum of balance for Unpaid and Partial bills)
    $stmt = $pdo->query("SELECT COALESCE(SUM(balance), 0) AS unpaid_total FROM bills WHERE status IN ('Unpaid', 'Partial')");
    $unpaidTotal = (float) $stmt->fetchColumn();

    // Collected today
    $stmt = $pdo->query("SELECT COALESCE(SUM(amount), 0) AS collected_today FROM payments WHERE DATE(paid_at) = CURDATE()");
    $collectedToday = (float) $stmt->fetchColumn();

    // Collected this month
    $stmt = $pdo->query("SELECT COALESCE(SUM(amount), 0) AS collected_month FROM payments WHERE YEAR(paid_at) = YEAR(CURDATE()) AND MONTH(paid_at) = MONTH(CURDATE())");
    $collectedMonth = (float) $stmt->fetchColumn();

    // Status counts
    $stmt = $pdo->query("SELECT status, COUNT(*) AS cnt FROM bills GROUP BY status");
    $counts = ['Unpaid' => 0, 'Partial' => 0, 'Paid' => 0, 'Voided' => 0];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $st = (string) $row['status'];
        if (isset($counts[$st])) {
            $counts[$st] = (int) $row['cnt'];
        }
    }

    return [
        'unpaidTotal'    => round($unpaidTotal, 2),
        'collectedToday' => round($collectedToday, 2),
        'collectedMonth' => round($collectedMonth, 2),
        'countUnpaid'    => $counts['Unpaid'],
        'countPartial'   => $counts['Partial'],
        'countPaid'      => $counts['Paid'],
    ];
}

// -----------------------------------------------------------------------------
// Charge Preview Engine
// -----------------------------------------------------------------------------

/**
 * Preview unbilled hospital charges for a patient across all source modules:
 * - Admissions (Room and board)
 * - Appointments (Professional consultation fees)
 * - Prescriptions (Dispensed medication charges from service_catalog)
 * - Lab Results (Completed laboratory tests from service_catalog)
 */
function previewPatientCharges(PDO $pdo, string $patientId): array
{
    $items = [];

    // 1. Admissions: unbilled room and board
    $admStmt = $pdo->prepare("
        SELECT 
            a.*,
            w.name AS ward_name,
            w.daily_rate AS ward_daily_rate
        FROM admissions a
        LEFT JOIN beds b ON a.bed_id = b.id
        LEFT JOIN wards w ON b.ward_id = w.id
        WHERE a.patient_id = :pid AND a.billed = 0
    ");
    $admStmt->execute([':pid' => $patientId]);
    while ($a = $admStmt->fetch(PDO::FETCH_ASSOC)) {
        $startDate = !empty($a['admit_date']) ? strtotime((string) $a['admit_date']) : time();
        $endDate   = !empty($a['discharge_date']) ? strtotime((string) $a['discharge_date']) : time();
        $days = (int) floor(($endDate - $startDate) / 86400);
        if ($days < 1) {
            $days = 1;
        }

        $rate = (float) (!empty($a['ward_daily_rate']) ? $a['ward_daily_rate'] : ($a['daily_rate'] ?? 1000.0));
        $wardName = !empty($a['ward_name']) ? (string) $a['ward_name'] : 'Standard Ward';

        $items[] = [
            'type'        => 'Room',
            'itemType'    => 'Room',
            'description' => "Room Charge ({$wardName}) - {$days} days",
            'qty'         => $days,
            'unitPrice'   => round($rate, 2),
            'amount'      => round($days * $rate, 2),
            'sourceType'  => 'admissions',
            'sourceId'    => (string) $a['id'],
        ];
    }

    // 2. Appointments: unbilled completed consultations
    $apptStmt = $pdo->prepare("
        SELECT 
            a.*,
            d.name AS doctor_name,
            d.consultation_fee AS doc_fee
        FROM appointments a
        LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.patient_id = :pid AND a.status = 'Completed' AND a.billed = 0
    ");
    $apptStmt->execute([':pid' => $patientId]);
    while ($ap = $apptStmt->fetch(PDO::FETCH_ASSOC)) {
        $docName = !empty($ap['doctor_name']) ? (string) $ap['doctor_name'] : 'Consulting Physician';
        $fee = (float) (!empty($ap['doc_fee']) ? $ap['doc_fee'] : 500.0);

        $items[] = [
            'type'        => 'Professional Fee',
            'itemType'    => 'Professional Fee',
            'description' => "Consultation - {$docName}",
            'qty'         => 1,
            'unitPrice'   => round($fee, 2),
            'amount'      => round($fee, 2),
            'sourceType'  => 'appointments',
            'sourceId'    => (string) $ap['id'],
        ];
    }

    // 3. Prescriptions: unbilled dispensed medications
    $rxStmt = $pdo->prepare("
        SELECT 
            r.id AS rx_id,
            i.medicine,
            i.duration_days
        FROM prescriptions r
        JOIN prescription_items i ON r.id = i.prescription_id
        WHERE r.patient_id = :pid AND r.status = 'Dispensed' AND r.billed = 0
    ");
    $rxStmt->execute([':pid' => $patientId]);
    $rxRows = $rxStmt->fetchAll(PDO::FETCH_ASSOC);

    if (!empty($rxRows)) {
        $catalogStmt = $pdo->prepare("SELECT unit_price FROM service_catalog WHERE category = 'medicine' AND item_name = :name LIMIT 1");
        foreach ($rxRows as $rx) {
            $medName = (string) $rx['medicine'];
            $catalogStmt->execute([':name' => $medName]);
            $catPrice = $catalogStmt->fetchColumn();
            $unitPrice = ($catPrice !== false && $catPrice !== null) ? (float) $catPrice : 10.00;

            $duration = !empty($rx['duration_days']) ? (int) $rx['duration_days'] : 1;
            $qty = max(1, $duration * 3);

            $items[] = [
                'type'        => 'Medication',
                'itemType'    => 'Medication',
                'description' => $medName,
                'qty'         => $qty,
                'unitPrice'   => round($unitPrice, 2),
                'amount'      => round($qty * $unitPrice, 2),
                'sourceType'  => 'prescriptions',
                'sourceId'    => (string) $rx['rx_id'],
            ];
        }
    }

    // 4. Laboratory: unbilled completed lab results
    $labStmt = $pdo->prepare("
        SELECT id, test_name 
        FROM lab_results 
        WHERE patient_id = :pid AND status = 'Completed' AND billed = 0
    ");
    $labStmt->execute([':pid' => $patientId]);
    $labRows = $labStmt->fetchAll(PDO::FETCH_ASSOC);

    if (!empty($labRows)) {
        $labCatStmt = $pdo->prepare("SELECT unit_price FROM service_catalog WHERE category = 'laboratory' AND item_name = :name LIMIT 1");
        foreach ($labRows as $l) {
            $testName = (string) $l['test_name'];
            $labCatStmt->execute([':name' => $testName]);
            $labPrice = $labCatStmt->fetchColumn();
            $unitPrice = ($labPrice !== false && $labPrice !== null) ? (float) $labPrice : 500.00;

            $items[] = [
                'type'        => 'Laboratory',
                'itemType'    => 'Laboratory',
                'description' => $testName,
                'qty'         => 1,
                'unitPrice'   => round($unitPrice, 2),
                'amount'      => round($unitPrice, 2),
                'sourceType'  => 'labResults',
                'sourceId'    => (string) $l['id'],
            ];
        }
    }

    return $items;
}

// -----------------------------------------------------------------------------
// Transactional Writers
// -----------------------------------------------------------------------------

/**
 * Atomically create a bill with line items, update source records, and prevent double-billing.
 */
function createBillRecord(PDO $pdo, array $input, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');
    if (!in_array($role, PRIMECARE_BILLING_STAFF_ROLES, true)) {
        return ['ok' => false, 'status' => 403, 'message' => 'Unauthorized to create bills.'];
    }

    $patientId = trim((string) ($input['patientId'] ?? ''));
    if ($patientId === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'Patient is required.'];
    }

    // Verify patient exists and is verified
    $patStmt = $pdo->prepare("SELECT id, status FROM patients WHERE id = :pid LIMIT 1");
    $patStmt->execute([':pid' => $patientId]);
    $patRow = $patStmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($patRow)) {
        return ['ok' => false, 'status' => 404, 'message' => 'Patient not found.'];
    }
    if (($patRow['status'] ?? '') !== 'verified') {
        return ['ok' => false, 'status' => 400, 'message' => 'Patient must be verified before billing.'];
    }

    $rawItems = $input['items'] ?? [];
    if (!is_array($rawItems) || empty($rawItems)) {
        return ['ok' => false, 'status' => 400, 'message' => 'Bill must contain at least one item.'];
    }

    $validatedItems = [];
    foreach ($rawItems as $idx => $it) {
        if (!is_array($it)) {
            return ['ok' => false, 'status' => 400, 'message' => "Invalid item format at index {$idx}."];
        }
        $desc = trim((string) ($it['description'] ?? ''));
        if ($desc === '') {
            return ['ok' => false, 'status' => 400, 'message' => 'All items must have a description.'];
        }
        $type = trim((string) ($it['type'] ?? $it['itemType'] ?? 'Other'));
        if (!in_array($type, PRIMECARE_BILL_ITEM_TYPES, true)) {
            $type = 'Other';
        }
        $qty = (int) ($it['qty'] ?? 1);
        if ($qty < 1) {
            return ['ok' => false, 'status' => 400, 'message' => "Quantity must be at least 1 for '{$desc}'."];
        }
        $price = (float) ($it['unitPrice'] ?? $it['unit_price'] ?? 0.0);
        if ($price < 0) {
            return ['ok' => false, 'status' => 400, 'message' => "Unit price cannot be negative for '{$desc}'."];
        }
        $amount = round($qty * $price, 2);

        $sourceType = !empty($it['sourceType']) ? trim((string) $it['sourceType']) : null;
        $sourceId   = !empty($it['sourceId']) ? trim((string) $it['sourceId']) : null;

        $validatedItems[] = [
            'type'        => $type,
            'description' => $desc,
            'qty'         => $qty,
            'unitPrice'   => round($price, 2),
            'amount'      => $amount,
            'sourceType'  => $sourceType,
            'sourceId'    => $sourceId,
        ];
    }

    $discountType = trim((string) ($input['discountType'] ?? 'None'));
    $insProvider  = trim((string) ($input['insuranceProvider'] ?? ''));
    $insCoverage  = max(0.0, (float) ($input['insuranceCoverage'] ?? 0.0));
    $admissionId  = !empty($input['admissionId']) ? trim((string) $input['admissionId']) : null;

    // Server-side authoritative financial calculation
    $calc = calculateBillFinancials($validatedItems, $discountType, $insCoverage, 0.0);

    $pdo->beginTransaction();
    try {
        // Concurrency lock & verification for source items to prevent double-billing
        foreach ($validatedItems as $it) {
            $sTier = $it['sourceType'];
            $sId   = $it['sourceId'];
            if ($sTier && $sId) {
                if ($sTier === 'admissions') {
                    $chk = $pdo->prepare("SELECT id, billed, bill_id FROM admissions WHERE id = :id FOR UPDATE");
                    $chk->execute([':id' => $sId]);
                    $row = $chk->fetch(PDO::FETCH_ASSOC);
                    if ($row && !empty($row['billed'])) {
                        $pdo->rollBack();
                        return ['ok' => false, 'status' => 409, 'message' => "Admission {$sId} has already been billed under bill {$row['bill_id']}."];
                    }
                    if (!$admissionId) {
                        $admissionId = $sId;
                    }
                } elseif ($sTier === 'appointments') {
                    $chk = $pdo->prepare("SELECT id, billed, bill_id FROM appointments WHERE id = :id FOR UPDATE");
                    $chk->execute([':id' => $sId]);
                    $row = $chk->fetch(PDO::FETCH_ASSOC);
                    if ($row && !empty($row['billed'])) {
                        $pdo->rollBack();
                        return ['ok' => false, 'status' => 409, 'message' => "Appointment {$sId} has already been billed under bill {$row['bill_id']}."];
                    }
                } elseif ($sTier === 'prescriptions') {
                    $chk = $pdo->prepare("SELECT id, billed, bill_id FROM prescriptions WHERE id = :id FOR UPDATE");
                    $chk->execute([':id' => $sId]);
                    $row = $chk->fetch(PDO::FETCH_ASSOC);
                    if ($row && !empty($row['billed'])) {
                        $pdo->rollBack();
                        return ['ok' => false, 'status' => 409, 'message' => "Prescription {$sId} has already been billed under bill {$row['bill_id']}."];
                    }
                } elseif ($sTier === 'labResults') {
                    $chk = $pdo->prepare("SELECT id, billed, bill_id FROM lab_results WHERE id = :id FOR UPDATE");
                    $chk->execute([':id' => $sId]);
                    $row = $chk->fetch(PDO::FETCH_ASSOC);
                    if ($row && !empty($row['billed'])) {
                        $pdo->rollBack();
                        return ['ok' => false, 'status' => 409, 'message' => "Laboratory test {$sId} has already been billed under bill {$row['bill_id']}."];
                    }
                }
            }
        }

        // Allocate next bill ID
        $billId = allocateNextId($pdo, 'bills', 'bills', 'B', 3);

        // Insert bill row
        $insBill = $pdo->prepare("
            INSERT INTO bills (
                id, patient_id, admission_id, subtotal, discount_type, discount_amount,
                insurance_provider, insurance_coverage, total, amount_paid, balance,
                status, void_reason, created_by, created_at
            ) VALUES (
                :id, :patient_id, :admission_id, :subtotal, :discount_type, :discount_amount,
                :insurance_provider, :insurance_coverage, :total, 0.00, :balance,
                'Unpaid', NULL, :created_by, NOW()
            )
        ");
        $insBill->execute([
            ':id'                 => $billId,
            ':patient_id'         => $patientId,
            ':admission_id'       => $admissionId,
            ':subtotal'           => $calc['subtotal'],
            ':discount_type'      => $calc['discountType'],
            ':discount_amount'    => $calc['discountAmount'],
            ':insurance_provider' => $insProvider,
            ':insurance_coverage' => $calc['insuranceCoverage'],
            ':total'              => $calc['total'],
            ':balance'            => $calc['balance'],
            ':created_by'         => $currentUser['id'] ?? null,
        ]);

        // Insert child line items
        $insItem = $pdo->prepare("
            INSERT INTO bill_items (
                bill_id, item_type, description, qty, unit_price, amount, source_type, source_id
            ) VALUES (
                :bill_id, :item_type, :description, :qty, :unit_price, :amount, :source_type, :source_id
            )
        ");

        $updAdm  = $pdo->prepare("UPDATE admissions SET billed = 1, bill_id = :bid WHERE id = :sid");
        $updAppt = $pdo->prepare("UPDATE appointments SET billed = 1, bill_id = :bid WHERE id = :sid");
        $updRx   = $pdo->prepare("UPDATE prescriptions SET billed = 1, bill_id = :bid WHERE id = :sid");
        $updLab  = $pdo->prepare("UPDATE lab_results SET billed = 1, bill_id = :bid WHERE id = :sid");

        foreach ($validatedItems as $it) {
            $insItem->execute([
                ':bill_id'     => $billId,
                ':item_type'   => $it['type'],
                ':description' => $it['description'],
                ':qty'         => $it['qty'],
                ':unit_price'  => $it['unitPrice'],
                ':amount'      => $it['amount'],
                ':source_type' => $it['sourceType'],
                ':source_id'   => $it['sourceId'],
            ]);

            // Flag source record as billed
            if ($it['sourceType'] && $it['sourceId']) {
                if ($it['sourceType'] === 'admissions') {
                    $updAdm->execute([':bid' => $billId, ':sid' => $it['sourceId']]);
                } elseif ($it['sourceType'] === 'appointments') {
                    $updAppt->execute([':bid' => $billId, ':sid' => $it['sourceId']]);
                } elseif ($it['sourceType'] === 'prescriptions') {
                    $updRx->execute([':bid' => $billId, ':sid' => $it['sourceId']]);
                } elseif ($it['sourceType'] === 'labResults') {
                    $updLab->execute([':bid' => $billId, ':sid' => $it['sourceId']]);
                }
            }
        }

        // Audit log
        writeAuthAuditLog(
            (string) ($currentUser['id'] ?? ''),
            (string) ($currentUser['username'] ?? ''),
            'Create Bill',
            "Created bill {$billId} for patient {$patientId} with total {$calc['total']}."
        );

        $pdo->commit();

        $fresh = findBillById($pdo, $billId, $currentUser);
        return [
            'ok'      => true,
            'message' => 'Bill created successfully.',
            'bill'    => $fresh,
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return [
            'ok'      => false,
            'status'  => 500,
            'message' => 'Failed to create bill: ' . $e->getMessage(),
        ];
    }
}

/**
 * Atomically record a payment for a bill, update the balance and status, and issue a receipt.
 */
function recordPaymentRecord(PDO $pdo, string $billId, array $input, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');
    if (!in_array($role, ['admin', 'staff', 'patient'], true)) {
        return ['ok' => false, 'status' => 403, 'message' => 'Unauthorized to record payments.'];
    }

    $amount = (float) ($input['amount'] ?? 0.0);
    if ($amount <= 0.0 || is_nan($amount)) {
        return ['ok' => false, 'status' => 400, 'message' => 'Payment amount must be greater than zero.'];
    }
    $amount = round($amount, 2);

    $method = trim((string) ($input['method'] ?? 'Cash'));
    if (!in_array($method, PRIMECARE_PAYMENT_METHODS, true)) {
        return ['ok' => false, 'status' => 400, 'message' => 'Invalid payment method. Allowed: ' . implode(', ', PRIMECARE_PAYMENT_METHODS)];
    }

    $ref = trim((string) ($input['reference'] ?? $input['reference_no'] ?? ''));
    if (in_array($method, ['Credit/Debit Card', 'GCash', 'Bank Transfer'], true) && $ref === '') {
        return ['ok' => false, 'status' => 400, 'message' => "Reference number is required for {$method} payments."];
    }

    $pdo->beginTransaction();
    try {
        // Atomic row-level lock on the bill
        $billStmt = $pdo->prepare("SELECT * FROM bills WHERE id = :id FOR UPDATE");
        $billStmt->execute([':id' => $billId]);
        $bill = $billStmt->fetch(PDO::FETCH_ASSOC);

        if (!is_array($bill)) {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 404, 'message' => 'Bill not found.'];
        }

        // Patient IDOR protection
        if ($role === 'patient') {
            $ownPatientId = (string) ($currentUser['patient_id'] ?? '');
            if ($ownPatientId === '' || $bill['patient_id'] !== $ownPatientId) {
                $pdo->rollBack();
                return ['ok' => false, 'status' => 403, 'message' => 'You can only pay your own bills.'];
            }
        }

        if ($bill['status'] === 'Voided') {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 400, 'message' => 'Cannot record payment on a voided bill.'];
        }

        $currentBalance = round((float) $bill['balance'], 2);
        if ($currentBalance <= 0.0 || $bill['status'] === 'Paid') {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 400, 'message' => 'This bill is already fully paid.'];
        }

        // Overpayment check
        if ($amount > $currentBalance) {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 400, 'message' => "Payment amount ({$amount}) exceeds current balance ({$currentBalance})."];
        }

        // Allocate next receipt number
        $receiptNo = allocateNextReceiptNo($pdo);

        // Determine receivedBy
        $receivedBy = ($role === 'patient')
            ? 'Online Payment'
            : (string) ($currentUser['full_name'] ?? $currentUser['username'] ?? 'Billing Staff');

        // Insert payment
        $insPay = $pdo->prepare("
            INSERT INTO payments (
                receipt_no, bill_id, amount, method, reference_no, paid_at, received_by
            ) VALUES (
                :receipt_no, :bill_id, :amount, :method, :reference_no, NOW(), :received_by
            )
        ");
        $insPay->execute([
            ':receipt_no'   => $receiptNo,
            ':bill_id'      => $billId,
            ':amount'       => $amount,
            ':method'       => $method,
            ':reference_no' => $ref,
            ':received_by'  => $receivedBy,
        ]);

        // Authoritatively re-sum payments for this bill
        $sumStmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE bill_id = :bid");
        $sumStmt->execute([':bid' => $billId]);
        $newAmountPaid = round((float) $sumStmt->fetchColumn(), 2);

        $total = round((float) $bill['total'], 2);
        $newBalance = max(0.00, round($total - $newAmountPaid, 2));
        $newStatus  = ($newBalance <= 0.00) ? 'Paid' : 'Partial';

        $updBill = $pdo->prepare("
            UPDATE bills 
            SET amount_paid = :paid, balance = :bal, status = :status
            WHERE id = :id
        ");
        $updBill->execute([
            ':paid'   => $newAmountPaid,
            ':bal'    => $newBalance,
            ':status' => $newStatus,
            ':id'     => $billId,
        ]);

        // Audit log
        writeAuthAuditLog(
            (string) ($currentUser['id'] ?? ''),
            (string) ($currentUser['username'] ?? ''),
            'Record Payment',
            "Recorded payment {$receiptNo} of {$amount} for bill {$billId} via {$method}."
        );

        $pdo->commit();

        $freshReceipt = serializePayment([
            'receipt_no'   => $receiptNo,
            'bill_id'      => $billId,
            'amount'       => $amount,
            'method'       => $method,
            'reference_no' => $ref,
            'paid_at'      => date('Y-m-d H:i:s'),
            'received_by'  => $receivedBy,
        ]);

        $freshBill = findBillById($pdo, $billId, $currentUser);

        return [
            'ok'      => true,
            'message' => 'Payment recorded successfully.',
            'receipt' => $freshReceipt,
            'bill'    => $freshBill,
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return [
            'ok'      => false,
            'status'  => 500,
            'message' => 'Failed to record payment: ' . $e->getMessage(),
        ];
    }
}

/**
 * Atomically void an unpaid bill (Admin only) and revert source record billing flags.
 */
function voidBillRecord(PDO $pdo, string $billId, string $reason, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');
    if ($role !== 'admin') {
        return ['ok' => false, 'status' => 403, 'message' => 'Only administrators can void bills.'];
    }

    $cleanReason = trim($reason);
    if (mb_strlen($cleanReason) < 10) {
        return ['ok' => false, 'status' => 400, 'message' => 'Reason must be at least 10 characters.'];
    }

    $pdo->beginTransaction();
    try {
        $billStmt = $pdo->prepare("SELECT * FROM bills WHERE id = :id FOR UPDATE");
        $billStmt->execute([':id' => $billId]);
        $bill = $billStmt->fetch(PDO::FETCH_ASSOC);

        if (!is_array($bill)) {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 404, 'message' => 'Bill not found.'];
        }

        if ($bill['status'] === 'Voided') {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 400, 'message' => 'This bill is already voided.'];
        }

        // Verify zero payments and zero amount paid
        $payCountStmt = $pdo->prepare("SELECT COUNT(*) FROM payments WHERE bill_id = :id");
        $payCountStmt->execute([':id' => $billId]);
        $payCount = (int) $payCountStmt->fetchColumn();

        if ($payCount > 0 || (float) $bill['amount_paid'] > 0.0) {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 400, 'message' => 'Cannot void a bill with existing payments.'];
        }

        // Mark bill as voided
        $upd = $pdo->prepare("UPDATE bills SET status = 'Voided', void_reason = :reason WHERE id = :id");
        $upd->execute([':reason' => $cleanReason, ':id' => $billId]);

        // Find child items with source records and unflag them
        $itemStmt = $pdo->prepare("SELECT source_type, source_id FROM bill_items WHERE bill_id = :id AND source_type IS NOT NULL AND source_id IS NOT NULL");
        $itemStmt->execute([':id' => $billId]);
        $items = $itemStmt->fetchAll(PDO::FETCH_ASSOC);

        $unflagAdm  = $pdo->prepare("UPDATE admissions SET billed = 0, bill_id = NULL WHERE id = :sid");
        $unflagAppt = $pdo->prepare("UPDATE appointments SET billed = 0, bill_id = NULL WHERE id = :sid");
        $unflagRx   = $pdo->prepare("UPDATE prescriptions SET billed = 0, bill_id = NULL WHERE id = :sid");
        $unflagLab  = $pdo->prepare("UPDATE lab_results SET billed = 0, bill_id = NULL WHERE id = :sid");

        foreach ($items as $it) {
            $sType = $it['source_type'];
            $sId   = $it['source_id'];
            if ($sType === 'admissions') {
                $unflagAdm->execute([':sid' => $sId]);
            } elseif ($sType === 'appointments') {
                $unflagAppt->execute([':sid' => $sId]);
            } elseif ($sType === 'prescriptions') {
                $unflagRx->execute([':sid' => $sId]);
            } elseif ($sType === 'labResults') {
                $unflagLab->execute([':sid' => $sId]);
            }
        }

        writeAuthAuditLog(
            (string) ($currentUser['id'] ?? ''),
            (string) ($currentUser['username'] ?? ''),
            'Void Bill',
            "Voided bill {$billId}. Reason: {$cleanReason}"
        );

        $pdo->commit();

        return [
            'ok'      => true,
            'message' => 'Bill voided successfully.',
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return [
            'ok'      => false,
            'status'  => 500,
            'message' => 'Failed to void bill: ' . $e->getMessage(),
        ];
    }
}

/**
 * Create a patient payment plan request for an open bill.
 */
function createPaymentPlanRecord(PDO $pdo, string $billId, int $months, string $reason, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');
    if ($role !== 'patient') {
        return ['ok' => false, 'status' => 403, 'message' => 'Only patients can submit payment plan requests.'];
    }

    $ownPatientId = (string) ($currentUser['patient_id'] ?? '');
    if ($ownPatientId === '') {
        return ['ok' => false, 'status' => 403, 'message' => 'No patient record linked to current user.'];
    }

    if ($months < 2 || $months > 12) {
        return ['ok' => false, 'status' => 400, 'message' => 'Months must be between 2 and 12.'];
    }

    $cleanReason = trim($reason);
    if (mb_strlen($cleanReason) < 10) {
        return ['ok' => false, 'status' => 400, 'message' => 'Reason must be at least 10 characters.'];
    }

    $billStmt = $pdo->prepare("SELECT * FROM bills WHERE id = :id LIMIT 1");
    $billStmt->execute([':id' => $billId]);
    $bill = $billStmt->fetch(PDO::FETCH_ASSOC);

    if (!is_array($bill)) {
        return ['ok' => false, 'status' => 404, 'message' => 'Bill not found.'];
    }

    if ($bill['patient_id'] !== $ownPatientId) {
        return ['ok' => false, 'status' => 403, 'message' => 'You can only request payment plans for your own bills.'];
    }

    if ($bill['status'] === 'Voided' || (float) $bill['balance'] <= 0.0) {
        return ['ok' => false, 'status' => 400, 'message' => 'Invalid bill. Only unpaid or partial bills can have payment plans.'];
    }

    // Check for duplicate pending request
    $chkStmt = $pdo->prepare("SELECT COUNT(*) FROM payment_plan_requests WHERE bill_id = :id AND status = 'Pending'");
    $chkStmt->execute([':id' => $billId]);
    if ((int) $chkStmt->fetchColumn() > 0) {
        return ['ok' => false, 'status' => 400, 'message' => 'A request is already pending for this bill.'];
    }

    $planId = 'PLAN-' . (string) round(microtime(true) * 1000);

    $ins = $pdo->prepare("
        INSERT INTO payment_plan_requests (
            id, bill_id, patient_id, months, reason, status, created_at
        ) VALUES (
            :id, :bill_id, :patient_id, :months, :reason, 'Pending', NOW()
        )
    ");
    $ins->execute([
        ':id'         => $planId,
        ':bill_id'    => $billId,
        ':patient_id' => $ownPatientId,
        ':months'     => $months,
        ':reason'     => $cleanReason,
    ]);

    writeAuthAuditLog(
        (string) ($currentUser['id'] ?? ''),
        (string) ($currentUser['username'] ?? ''),
        'Payment Plan Request',
        "Patient {$ownPatientId} submitted {$months}-month payment plan for bill {$billId}."
    );

    $planData = [
        'id'        => $planId,
        'billId'    => $billId,
        'patientId' => $ownPatientId,
        'months'    => $months,
        'reason'    => $cleanReason,
        'status'    => 'Pending',
        'createdAt' => date('c'),
    ];

    return [
        'ok'      => true,
        'message' => 'Payment plan request submitted.',
        'plan'    => $planData,
    ];
}

