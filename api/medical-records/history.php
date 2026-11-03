<?php
/**
 * PrimeCare - GET /api/medical-records/history.php
 * Phase 5.7.2: Revision history for one medical record or for all of a patient's records.
 *
 * Query: recordId=M-001   OR   patientId=P-001   OR   my=1
 *
 * Authorization (requireRole): admin, doctor, nurse, patient.
 * - Staff receive 403: they only get the summary projection through list/get (patient-records workflow),
 *   and revision history exposes clinician activity that is not part of that workflow.
 * - Patients: `patientId` is forced to their own profile; `recordId` of another patient's record -> 403.
 * - Non-patient `?my=1` (portal preview) defaults to demo patient P-001.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/medical_records.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'doctor', 'nurse', 'patient']);
$pdo  = getDatabaseConnection();

$recordId  = strtoupper(trim((string) ($_GET['recordId'] ?? $_GET['id'] ?? '')));
$patientId = strtoupper(trim((string) ($_GET['patientId'] ?? '')));
$myFlag    = isset($_GET['my']) && ((string) $_GET['my'] === '1' || strtolower((string) $_GET['my']) === 'true');

if ($recordId !== '') {
    if (preg_match('/^M-\d{3,}$/', $recordId) !== 1) {
        sendError('A valid Medical Record ID (e.g., M-001) is required.', 400);
    }

    $probe = $pdo->prepare('SELECT patient_id FROM medical_records WHERE id = :id LIMIT 1');
    $probe->execute([':id' => $recordId]);
    $owner = $probe->fetch();
    if (!is_array($owner)) {
        sendError('Medical record not found.', 404);
    }

    assertMedicalRecordPatientAccess($pdo, $user, (string) $owner['patient_id']);

    sendSuccess('Medical record history retrieved successfully.', [
        'recordId' => $recordId,
        'history'  => fetchMedicalRecordHistory($pdo, $recordId),
    ]);
}

if ($user['role'] === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendSuccess('Medical record history retrieved successfully.', ['patientId' => null, 'history' => []]);
    }
    $patientId = (string) $own['id'];
} elseif ($patientId === '' && $myFlag) {
    $patientId = 'P-001';
}

if ($patientId === '' || preg_match('/^P-\d{3,}$/', $patientId) !== 1) {
    sendError('A recordId or a valid patientId is required.', 400);
}

sendSuccess('Medical record history retrieved successfully.', [
    'patientId' => $patientId,
    'history'   => fetchMedicalRecordHistoryForPatient($pdo, $patientId),
]);

