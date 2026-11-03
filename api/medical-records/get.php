<?php
/**
 * PrimeCare - GET /api/medical-records/get.php?id=M-001
 * Phase 5.7.2: Retrieve one medical record with doctor metadata and revision history.
 *
 * Authorization:
 * - All five roles may call it, but patients may only read records belonging to their own linked
 *   patient profile (403 otherwise - IDOR protection).
 * - Projection depends on role: admin/doctor/nurse = full (incl. revision history), patient = own
 *   clinical content, staff = summary only.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/medical_records.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'staff', 'doctor', 'nurse', 'patient']);
$id   = strtoupper(trim((string) ($_GET['id'] ?? '')));

if ($id === '' || preg_match('/^M-\d{3,}$/', $id) !== 1) {
    sendError('A valid Medical Record ID (e.g., M-001) is required.', 400);
}

$pdo  = getDatabaseConnection();
$view = medicalRecordViewForRole((string) $user['role']);

// Resolve ownership BEFORE building the response so no clinical content is serialised for outsiders.
$probe = $pdo->prepare('SELECT patient_id FROM medical_records WHERE id = :id LIMIT 1');
$probe->execute([':id' => $id]);
$owner = $probe->fetch();
if (!is_array($owner)) {
    sendError('Medical record not found.', 404);
}

assertMedicalRecordPatientAccess($pdo, $user, (string) $owner['patient_id']);

$record = findMedicalRecordById($pdo, $id, $view, true);
if ($record === null) {
    sendError('Medical record not found.', 404);
}

sendSuccess('Medical record retrieved successfully.', ['record' => $record]);

