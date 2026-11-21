<?php
/**
 * PrimeCare - POST /api/wards/discharge.php
 * Admin/Nurse/Doctor atomic inpatient discharge transaction.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/wards.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$actor = requireRole(['admin', 'nurse', 'doctor']);
requireCsrf();

$input       = getJsonInput();
$admissionId = trim((string) ($input['admissionId'] ?? ''));
$summary     = trim((string) ($input['summary'] ?? ''));

if ($admissionId === '') {
    sendError('Admission ID is required.', 422);
}
if (mb_strlen($summary) < 10) {
    sendError('Discharge summary must be at least 10 characters.', 422);
}

$pdo = getDatabaseConnection();
$pdo->beginTransaction();

try {
    $admStmt = $pdo->prepare('SELECT id, patient_id, bed_id, status FROM admissions WHERE id = :aid FOR UPDATE');
    $admStmt->execute([':aid' => $admissionId]);
    $adm = $admStmt->fetch();

    if (!is_array($adm)) {
        $pdo->rollBack();
        sendError('Admission record not found.', 404);
    }
    if ($adm['status'] !== 'Admitted') {
        $pdo->rollBack();
        sendError('Active admission not found (patient already discharged).', 409);
    }

    $freeStmt = $pdo->prepare("UPDATE beds SET status = 'Available', current_patient_id = NULL WHERE id = :bid");
    $freeStmt->execute([':bid' => $adm['bed_id']]);

    $updAdm = $pdo->prepare("
        UPDATE admissions
        SET status = 'Discharged',
            discharge_date = CURDATE(),
            discharge_summary = :summary
        WHERE id = :aid
    ");
    $updAdm->execute([
        ':summary' => $summary,
        ':aid'     => $admissionId,
    ]);

    $updPat = $pdo->prepare("UPDATE patients SET admit_type = 'Outpatient', ward = '', bed_number = '' WHERE id = :pid");
    $updPat->execute([':pid' => $adm['patient_id']]);

    writeAuthAuditLog(
        (string) $actor['id'],
        (string) $actor['username'],
        'Discharge Patient',
        "Discharged inpatient {$adm['patient_id']} from admission {$admissionId}"
    );

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Failed to discharge patient.', 500);
}

sendSuccess('Patient discharged successfully.', [
    'admission' => findAdmissionById($pdo, $admissionId),
]);
