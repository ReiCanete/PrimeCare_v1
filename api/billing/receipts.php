<?php
/**
 * PrimeCare - GET /api/billing/receipts.php
 * Phase 5.9.2: Retrieve payment receipts for a patient or overall ledger.
 *
 * Query Parameters:
 * - patientId: string
 * - my: '1' or 'true'
 *
 * Authorization:
 * - Admin, Staff: Allowed.
 * - Patient: Allowed (own receipts only, IDOR protected).
 * - Doctor, Nurse: 403 Forbidden.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'staff', 'patient']);
$pdo  = getDatabaseConnection();
$role = (string) $user['role'];

$patientId = trim((string) ($_GET['patientId'] ?? ''));
$myFlag = isset($_GET['my']) && ((string) $_GET['my'] === '1' || strtolower((string) $_GET['my']) === 'true');

if ($role === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendSuccess('Receipts retrieved successfully.', ['receipts' => [], 'count' => 0]);
    }
    $patientId = (string) $own['id'];
} elseif ($myFlag && $patientId === '') {
    $patientId = 'P-001';
}

if ($patientId !== '') {
    $receipts = fetchPatientReceipts($pdo, $patientId);
} else {
    // Staff/Admin all receipts
    $stmt = $pdo->query("
        SELECT 
            py.*,
            b.patient_id
        FROM payments py
        JOIN bills b ON py.bill_id = b.id
        ORDER BY py.paid_at DESC
    ");
    $receipts = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $receipts[] = serializePayment($r);
    }
}

sendSuccess('Receipts retrieved successfully.', [
    'receipts' => $receipts,
    'count'    => count($receipts),
]);

