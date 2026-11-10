<?php
/**
 * PrimeCare - POST /api/lab-results/update.php
 * Phase 5.10.2: Enter test results and complete a laboratory order.
 *
 * Authorization:
 * - Admin, Doctor, Nurse only.
 * - Staff, Patient -> 403 Forbidden.
 * - Requires CSRF token.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/lab_results.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(PRIMECARE_LAB_UPDATE_ROLES);
requireCsrf();

$input = getJsonInput();
$id    = strtoupper(trim((string) ($input['id'] ?? $_GET['id'] ?? '')));

if ($id === '' || preg_match('/^LAB-\d{3,}$/', $id) !== 1) {
    sendError('A valid Laboratory Test ID (e.g., LAB-001) is required.', 400);
}

$pdo = getDatabaseConnection();

$result = updateLabResultRecord($pdo, $id, $input, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess(
    (string) $result['message'],
    ['lab' => $result['lab'] ?? null]
);
