<?php
/**
 * PrimeCare - POST /api/prescriptions/status.php
 * Phase 5.8.2: Transition prescription status to 'Dispensed' (Nurse/Admin) or 'Cancelled' (Doctor/Admin).
 *
 * Authorization:
 * - Dispensing: Admin, Nurse.
 * - Cancellation: Admin, Doctor.
 * - Staff, Patient -> 403 Forbidden.
 * - Requires CSRF token.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/prescriptions.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

// Require an authenticated user with any clinical/admin role
$user = requireRole(['admin', 'doctor', 'nurse']);
requireCsrf();

$input  = getJsonInput();
$id     = strtoupper(trim((string) ($input['id'] ?? '')));
$status = trim((string) ($input['status'] ?? ''));

if ($id === '' || preg_match('/^RX-\d{3,}$/', $id) !== 1) {
    sendError('A valid Prescription ID (e.g., RX-001) is required.', 400);
}

$pdo = getDatabaseConnection();
$result = updatePrescriptionStatusRecord($pdo, $id, $status, $user);

if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

sendSuccess((string) $result['message'], ['id' => $id, 'status' => $status]);

