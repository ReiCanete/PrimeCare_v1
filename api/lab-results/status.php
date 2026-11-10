<?php
/**
 * PrimeCare - POST /api/lab-results/status.php
 * Phase 5.10.2: Mark laboratory result as reviewed by physician.
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

$user = requireRole(PRIMECARE_LAB_REVIEW_ROLES);
requireCsrf();

$input  = getJsonInput();
$id     = strtoupper(trim((string) ($input['id'] ?? $_GET['id'] ?? '')));
$action = strtolower(trim((string) ($input['action'] ?? 'review')));

if ($id === '' || preg_match('/^LAB-\d{3,}$/', $id) !== 1) {
    sendError('A valid Laboratory Test ID (e.g., LAB-001) is required.', 400);
}

if ($action !== 'review') {
    sendError('Invalid action. Supported actions: review.', 400);
}

$pdo = getDatabaseConnection();

$result = reviewLabResultRecord($pdo, $id, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess((string) $result['message'], null);
