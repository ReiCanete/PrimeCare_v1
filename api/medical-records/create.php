<?php
/**
 * PrimeCare - POST /api/medical-records/create.php
 * Phase 5.7.2: Create a clinical encounter (diagnosis + treatment notes).
 *
 * Body (JSON): { patientId, diagnosis*, treatmentNotes*, chiefComplaint?, followUpDate?,
 *                attendingDoctorId?, appointmentId?, vitals? }
 *
 * Security & rules:
 * - requireRole(['admin','doctor']) + requireCsrf(). Nurse / staff / patient -> 403.
 * - Patient must exist and be verified.
 * - Doctors are always attributed to their own linked doctor profile (a different doctor -> 403).
 * - appointmentId (optional) must belong to the same patient, must not be cancelled and may only
 *   be linked to one record (409 on duplicate).
 * - Runs in a transaction; ID comes from the shared `medicalRecords` sequence (allocateNextId).
 * - Audit log records IDs only - never clinical content.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/medical_records.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(PRIMECARE_EHR_CLINICAL_WRITE_ROLES);
requireCsrf();

$input = getJsonInput();
$pdo   = getDatabaseConnection();

$result = createClinicalRecord($pdo, $user, $input);
if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status'], $result['errors'] ?? null);
}

$recordId = (string) $result['recordId'];
writeAuthAuditLog(
    (string) $user['id'],
    (string) $user['username'],
    'Create Medical Record',
    "Created medical record {$recordId} for patient {$result['patientId']}"
);

sendSuccess(
    'Medical record created successfully.',
    ['record' => findMedicalRecordById($pdo, $recordId, 'full', true)],
    201
);

