<?php
/**
 * PrimeCare - POST /api/billing/create.php
 * Phase 5.9.2: Create a bill with line items and atomic double-billing prevention.
 *
 * Authorization:
 * - Admin, Staff only.
 * - Doctor, Nurse, Patient: 403 Forbidden.
 * - Requires valid CSRF token.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(PRIMECARE_BILLING_STAFF_ROLES);
requireCsrf();

$input = getJsonInput();
$pdo   = getDatabaseConnection();

$result = createBillRecord($pdo, $input, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess(
    (string) $result['message'],
    ['bill' => $result['bill']],
    201
);

