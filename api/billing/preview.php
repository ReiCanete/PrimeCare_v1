<?php
/**
 * PrimeCare - GET /api/billing/preview.php
 * Phase 5.9.2: Preview unbilled hospital charges for a patient.
 *
 * Query Parameters:
 * - patientId: string (Required)
 *
 * Authorization:
 * - Admin, Staff only.
 * - Patient, Doctor, Nurse: 403 Forbidden.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(PRIMECARE_BILLING_STAFF_ROLES);
$pdo  = getDatabaseConnection();

$patientId = trim((string) ($_GET['patientId'] ?? ''));
if ($patientId === '') {
    sendError('Patient ID is required.', 400);
}

// Verify patient exists
$patStmt = $pdo->prepare("SELECT id FROM patients WHERE id = :id LIMIT 1");
$patStmt->execute([':id' => $patientId]);
if (!$patStmt->fetch()) {
    sendError('Patient not found.', 404);
}

$items = previewPatientCharges($pdo, $patientId);

sendSuccess('Charges preview retrieved successfully.', [
    'items' => $items,
    'count' => count($items),
]);

