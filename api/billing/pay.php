<?php
/**
 * PrimeCare - POST /api/billing/pay.php
 * Phase 5.9.2: Record payment against a bill, issue receipt, and update balance.
 *
 * Authorization:
 * - Admin, Staff, Patient.
 * - Patient can only pay own bill (IDOR protected).
 * - Doctor, Nurse: 403 Forbidden.
 * - Requires valid CSRF token.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(['admin', 'staff', 'patient']);
requireCsrf();

$input  = getJsonInput();
$pdo    = getDatabaseConnection();
$billId = trim((string) ($input['billId'] ?? $input['id'] ?? ''));

if ($billId === '') {
    sendError('Bill ID is required.', 400);
}

if ($user['role'] === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendError('Patient profile not found.', 404);
    }
    $user['patient_id'] = (string) $own['id'];
}

$result = recordPaymentRecord($pdo, $billId, $input, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess(
    (string) $result['message'],
    [
        'receipt' => $result['receipt'],
        'bill'    => $result['bill'],
    ],
    200
);

