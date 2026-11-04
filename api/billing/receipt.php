<?php
/**
 * PrimeCare - GET /api/billing/receipt.php
 * Phase 5.9.2: Retrieve payment receipt details with linked bill.
 *
 * Query Parameters:
 * - receiptNo: string (e.g. 'R-0001')
 *
 * Authorization:
 * - Admin, Staff: Allowed.
 * - Patient: Allowed (own receipt only, IDOR protected).
 * - Doctor, Nurse: 403 Forbidden.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'staff', 'patient']);
$pdo  = getDatabaseConnection();
$role = (string) $user['role'];

$receiptNo = trim((string) ($_GET['receiptNo'] ?? $_GET['id'] ?? ''));
if ($receiptNo === '') {
    sendError('Receipt number is required.', 400);
}

if ($role === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendError('Patient profile not found.', 404);
    }
    $user['patient_id'] = (string) $own['id'];

    // Pre-check receipt existence vs ownership for 404 vs 403
    $rawStmt = $pdo->prepare("
        SELECT py.receipt_no, b.patient_id 
        FROM payments py 
        JOIN bills b ON py.bill_id = b.id 
        WHERE py.receipt_no = :no 
        LIMIT 1
    ");
    $rawStmt->execute([':no' => $receiptNo]);
    $raw = $rawStmt->fetch(PDO::FETCH_ASSOC);

    if (!is_array($raw)) {
        sendError('Receipt not found.', 404);
    }
    if ($raw['patient_id'] !== $user['patient_id']) {
        sendError('Access denied. You cannot view another patient\'s receipt.', 403);
    }
}

$data = fetchReceiptByNo($pdo, $receiptNo, $user);
if ($data === null) {
    sendError('Receipt not found.', 404);
}

sendSuccess('Receipt retrieved successfully.', [
    'receipt' => $data['receipt'],
    'bill'    => $data['bill'],
]);

