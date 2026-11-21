<?php
/**
 * PrimeCare - GET /api/wards/admissions.php
 * List admissions (scoped to own patient record for patient role).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/wards.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user   = requireRole(['admin', 'doctor', 'nurse', 'staff', 'patient']);
$pdo    = getDatabaseConnection();
$status = trim((string) ($_GET['status'] ?? 'All'));

if ($user['role'] === 'patient') {
    $patient = findPatientByUserId($pdo, (string) $user['id']);
    if ($patient === null) {
        sendSuccess('Admissions retrieved successfully.', ['admissions' => []]);
    }
    $admissions = fetchAdmissionsList($pdo, $status, (string) $patient['id']);
    sendSuccess('Admissions retrieved successfully.', ['admissions' => $admissions]);
}

$patientId  = trim((string) ($_GET['patientId'] ?? ''));
$admissions = fetchAdmissionsList($pdo, $status, $patientId !== '' ? $patientId : null);

sendSuccess('Admissions retrieved successfully.', [
    'admissions' => $admissions,
]);
