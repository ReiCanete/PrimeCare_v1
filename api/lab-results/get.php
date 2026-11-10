<?php
/**
 * PrimeCare - GET /api/lab-results/get.php?id=LAB-001
 * Phase 5.10.2: Retrieve a single laboratory test record.
 *
 * Authorization:
 * - Allowed: admin, doctor, nurse, patient.
 * - Staff: 403 Forbidden.
 * - Patient: Can only access records belonging to their own patient profile (403 IDOR protection).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/lab_results.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(PRIMECARE_LAB_READ_ROLES);
$id   = strtoupper(trim((string) ($_GET['id'] ?? '')));

if ($id === '' || preg_match('/^LAB-\d{3,}$/', $id) !== 1) {
    sendError('A valid Laboratory Test ID (e.g., LAB-001) is required.', 400);
}

$pdo = getDatabaseConnection();

if ($user['role'] === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    $user['patient_id'] = $own ? (string) $own['id'] : '';
}

$result = findLabResultById($pdo, $id, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess('Lab result retrieved successfully.', ['lab' => $result['lab']]);
