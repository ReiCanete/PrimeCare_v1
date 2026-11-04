<?php
/**
 * PrimeCare - POST /api/prescriptions/create.php
 * Phase 5.8.2: Create a prescription with child prescription items and allergy conflict detection.
 *
 * Authorization:
 * - Admin, Doctor only.
 * - Nurse, Staff, Patient -> 403 Forbidden.
 * - Requires CSRF token.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/prescriptions.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(PRIMECARE_RX_CREATE_ROLES);
requireCsrf();

$input = getJsonInput();
$pdo   = getDatabaseConnection();

$result = createPrescriptionRecord($pdo, $input, $user);

if (empty($result['ok'])) {
    $extra = [];
    if (!empty($result['allergyConflict'])) {
        $extra['allergyConflict'] = true;
        $extra['conflicts']       = $result['conflicts'] ?? [];
    }
    sendError((string) $result['message'], (int) $result['status'], !empty($extra) ? $extra : null);
}

sendSuccess(
    (string) $result['message'],
    ['prescription' => $result['prescription']],
    201
);

