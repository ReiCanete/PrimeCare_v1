<?php
/**
 * PrimeCare - POST /api/billing/void.php
 * Phase 5.9.2: Void an unpaid bill and restore source billing flags.
 *
 * Authorization:
 * - Admin only.
 * - Staff, Doctor, Nurse, Patient: 403 Forbidden.
 * - Requires valid CSRF token.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(['admin']);
requireCsrf();

$input  = getJsonInput();
$pdo    = getDatabaseConnection();
$billId = trim((string) ($input['id'] ?? $input['billId'] ?? ''));
$reason = trim((string) ($input['reason'] ?? ''));

if ($billId === '') {
    sendError('Bill ID is required.', 400);
}
if ($reason === '') {
    sendError('Void reason is required.', 400);
}

$result = voidBillRecord($pdo, $billId, $reason, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess((string) $result['message'], null, 200);

