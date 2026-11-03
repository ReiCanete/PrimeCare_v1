<?php
/**
 * PrimeCare - POST /api/medical-records/vitals.php
 * Phase 5.7.2: Record / update vital signs for a patient.
 *
 * Body (JSON): { patientId*, vitals: { bp?, heartRate?, temperature?, spo2?, weightKg?, heightCm?, respRate? } }
 *
 * Security & rules:
 * - requireRole(['admin','doctor','nurse']) + requireCsrf(). Staff / patient -> 403.
 * - Ranges: BP systolic 50-300 / diastolic 30-200, temp 30.0-45.0 C, HR 20-250, SpO2 50-100,
 *   weight 0.5-500 kg, height 20-300 cm, resp rate 4-80. Violations -> 400 (field map in `data.errors`).
 * - Only supplied fields are changed (partial update). At least one vital is required.
 * - Updates the patient's latest encounter of today (+ history entry, same transaction) or creates
 *   a designated "Vitals check" encounter. The patient row is locked so concurrent requests cannot
 *   create duplicate "Vitals check" encounters.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/medical_records.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(PRIMECARE_EHR_VITALS_WRITE_ROLES);
requireCsrf();

$input = getJsonInput();
$pdo   = getDatabaseConnection();

$patientId = strtoupper(trim((string) ($input['patientId'] ?? '')));
if ($patientId === '' || preg_match('/^P-\d{3,}$/', $patientId) !== 1) {
    sendError('A valid Patient ID is required.', 400);
}

if (!isset($input['vitals']) || !is_array($input['vitals'])) {
    sendError('A vitals object is required.', 400);
}

$check = validateVitalsPayload($input['vitals']);
if (!$check['ok']) {
    sendError($check['message'], 400, ['errors' => $check['errors']]);
}

$result = saveVitalsRecord($pdo, $user, $patientId, $check['vitals']);
if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status']);
}

$recordId = (string) $result['recordId'];
if (!empty($result['changed'])) {
    writeAuthAuditLog(
        (string) $user['id'],
        (string) $user['username'],
        !empty($result['created']) ? 'Create Vitals Check' : 'Update Vitals',
        "Recorded vitals on medical record {$recordId} for patient {$patientId}"
    );
}

sendSuccess(
    !empty($result['created']) ? 'Vitals recorded successfully.' : (!empty($result['changed']) ? 'Vitals updated successfully.' : 'No changes detected.'),
    [
        'record'  => findMedicalRecordById($pdo, $recordId, 'full', true),
        'created' => (bool) $result['created'],
        'changed' => (bool) $result['changed'],
    ],
    !empty($result['created']) ? 201 : 200
);

