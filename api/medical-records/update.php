<?php
/**
 * PrimeCare - POST /api/medical-records/update.php
 * Phase 5.7.2: Update diagnosis / treatment notes of an existing record with transactional history.
 *
 * Body (JSON): { id*, diagnosis*, treatmentNotes*, chiefComplaint?, followUpDate?, attendingDoctorId?,
 *                patientId? (must match), appointmentId? (must match), expectedUpdatedAt? }
 *
 * Security & rules:
 * - requireRole(['admin','doctor']) + requireCsrf(). Nurse / staff / patient -> 403.
 * - The record UPDATE and its `medical_record_history` INSERT run in one transaction; if either
 *   fails both are rolled back (see updateClinicalRecord()).
 * - History `updated_by` is the authenticated user's full name; `updated_at` is server time.
 * - patientId / appointmentId are immutable; a doctor can never re-attribute a record assigned to
 *   another doctor; an assigned attending doctor cannot be cleared.
 * - `expectedUpdatedAt` (optional) enables optimistic concurrency: stale edits get 409.
 * - A request that changes nothing is a no-op: success, no history entry, `updated_at` untouched.
 * - There is deliberately NO delete endpoint for medical records.
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

$id = strtoupper(trim((string) ($input['id'] ?? '')));
if ($id === '' || preg_match('/^M-\d{3,}$/', $id) !== 1) {
    sendError('A valid Medical Record ID (e.g., M-001) is required.', 400);
}

$result = updateClinicalRecord($pdo, $user, $id, $input);
if (empty($result['ok'])) {
    sendError((string) $result['message'], (int) $result['status'], $result['errors'] ?? null);
}

if (!empty($result['changed'])) {
    writeAuthAuditLog(
        (string) $user['id'],
        (string) $user['username'],
        'Update Medical Record',
        "Updated medical record {$id}: " . implode(', ', (array) ($result['changedFields'] ?? []))
    );
}

sendSuccess(
    !empty($result['changed']) ? 'Medical record updated successfully.' : 'No changes detected.',
    [
        'record'  => findMedicalRecordById($pdo, $id, 'full', true),
        'changed' => (bool) $result['changed'],
    ]
);

