<?php
/**
 * PrimeCare - GET /api/billing/get.php
 * Phase 5.9.2: Retrieve a single bill with itemized line items and payment history.
 *
 * Query Parameters:
 * - id: string (Bill ID, e.g. 'B-001')
 *
 * Authorization:
 * - Admin, Staff: Allowed (any bill).
 * - Patient: Allowed (own bill only, IDOR protected).
 * - Doctor, Nurse: 403 Forbidden.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'staff', 'patient']);
$pdo  = getDatabaseConnection();
$role = (string) $user['role'];

$id = trim((string) ($_GET['id'] ?? ''));
if ($id === '') {
    sendError('Bill ID is required.', 400);
}

if ($role === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendError('Patient profile not found.', 404);
    }
    $user['patient_id'] = (string) $own['id'];

    // Check if bill exists before checking ownership to return 404 vs 403
    $rawStmt = $pdo->prepare("SELECT id, patient_id FROM bills WHERE id = :id LIMIT 1");
    $rawStmt->execute([':id' => $id]);
    $rawBill = $rawStmt->fetch(PDO::FETCH_ASSOC);

    if (!is_array($rawBill)) {
        sendError('Bill not found.', 404);
    }
    if ($rawBill['patient_id'] !== $user['patient_id']) {
        sendError('Access denied. You cannot view another patient\'s financial records.', 403);
    }
}

$bill = findBillById($pdo, $id, $user);
if ($bill === null) {
    sendError('Bill not found.', 404);
}

sendSuccess('Bill retrieved successfully.', [
    'bill' => $bill,
]);

