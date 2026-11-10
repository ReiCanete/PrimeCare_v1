<?php
/**
 * PrimeCare - POST /api/lab-results/create.php
 * Phase 5.10.2: Order a laboratory test.
 *
 * Authorization:
 * - Admin, Doctor only.
 * - Nurse, Staff, Patient -> 403 Forbidden.
 * - Requires CSRF token.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/lab_results.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(PRIMECARE_LAB_ORDER_ROLES);
requireCsrf();

$input = getJsonInput();
$pdo   = getDatabaseConnection();

$result = createLabOrderRecord($pdo, $input, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess(
    (string) $result['message'],
    ['lab' => $result['lab']],
    201
);
