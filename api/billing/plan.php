<?php
/**
 * PrimeCare - POST /api/billing/plan.php
 * Phase 5.9.2: Submit patient payment plan request for open bill.
 *
 * Authorization:
 * - Patient only.
 * - Admin, Staff, Doctor, Nurse: 403 Forbidden.
 * - Requires valid CSRF token.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(['patient']);
requireCsrf();

$input  = getJsonInput();
$pdo    = getDatabaseConnection();
$billId = trim((string) ($input['billId'] ?? $input['id'] ?? ''));
$months = (int) ($input['months'] ?? 0);
$reason = trim((string) ($input['reason'] ?? ''));

if ($billId === '') {
    sendError('Bill ID is required.', 400);
}

$own = findPatientByUserId($pdo, (string) $user['id']);
if ($own === null) {
    sendError('Patient profile not found.', 404);
}
$user['patient_id'] = (string) $own['id'];

$result = createPaymentPlanRecord($pdo, $billId, $months, $reason, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess(
    (string) $result['message'],
    ['plan' => $result['plan']],
    201
);

