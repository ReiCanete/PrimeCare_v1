<?php
/**
 * PrimeCare - POST /api/doctors/delete.php
 * Phase 5.5: Admin-only doctor removal with strict referential integrity protection.
 *
 * Rules:
 * - Deactivation (`status = 'inactive'` via `update.php`) is preferred for doctors with history.
 * - If a doctor is referenced by ANY historical or upcoming appointments, medical records,
 *   prescriptions, lab results, admissions, or assigned patients, deletion is rejected with HTTP 409
 *   and instructs the administrator to deactivate the doctor instead.
 * - Only a newly created / unreferenced doctor profile may be removed.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/doctors.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$admin = requireRole(['admin']);
requireCsrf();

$input = getJsonInput();
$id    = strtoupper(trim((string) ($input['id'] ?? '')));

if ($id === '' || !preg_match('/^D-\d{3,}$/i', $id)) {
    sendError('A valid Doctor ID is required.', 400);
}

$pdo      = getDatabaseConnection();
$existing = findDoctorById($pdo, $id);

if ($existing === null) {
    sendError('Doctor not found.', 404);
}

// Check all child references across appointments, clinical records, admissions, and assigned patients
$referenceChecks = [
    ['table' => 'appointments',    'column' => 'doctor_id',           'label' => 'appointments'],
    ['table' => 'medical_records', 'column' => 'attending_doctor_id', 'label' => 'medical records'],
    ['table' => 'prescriptions',   'column' => 'doctor_id',           'label' => 'prescriptions'],
    ['table' => 'lab_results',     'column' => 'ordered_by',          'label' => 'laboratory orders'],
    ['table' => 'admissions',      'column' => 'attending_doctor_id', 'label' => 'inpatient admissions'],
    ['table' => 'patients',        'column' => 'assigned_doctor_id',  'label' => 'assigned patients'],
];

foreach ($referenceChecks as $ref) {
    $cStmt = $pdo->prepare("SELECT COUNT(*) FROM `{$ref['table']}` WHERE `{$ref['column']}` = :did");
    $cStmt->execute([':did' => $id]);
    if ((int) $cStmt->fetchColumn() > 0) {
        sendError(
            'Cannot delete doctor. They have existing appointments, clinical records, or patient assignments. Please set their status to Inactive instead to preserve historical records.',
            409
        );
    }
}

$pdo->beginTransaction();
try {
    // doctor_schedules rows are removed automatically via ON DELETE CASCADE,
    // or explicitly deleted here within the transaction.
    $delSched = $pdo->prepare('DELETE FROM doctor_schedules WHERE doctor_id = :did');
    $delSched->execute([':did' => $id]);

    $delDoc = $pdo->prepare('DELETE FROM doctors WHERE id = :did');
    $delDoc->execute([':did' => $id]);

    // Sync sequences.current_val to highest remaining doctor numeric ID so deleted tail IDs don't inflate sequence
    $maxStmt = $pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(id, 3) AS UNSIGNED)), 0) FROM doctors WHERE id REGEXP '^D-[0-9]+$'");
    $maxNum  = (int) $maxStmt->fetchColumn();
    $seqStmt = $pdo->prepare("UPDATE sequences SET current_val = :val WHERE entity_key = 'doctors'");
    $seqStmt->execute([':val' => max(5, $maxNum)]);

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError(
        'Cannot delete doctor. They have existing appointments or medical records. Please set status to Inactive instead.',
        409
    );
}

writeAuthAuditLog($admin['id'], $admin['username'], 'Delete Doctor', "Deleted unreferenced doctor {$id} ({$existing['name']})");

sendSuccess('Doctor deleted successfully.', [
    'deletedId' => $id,
]);
