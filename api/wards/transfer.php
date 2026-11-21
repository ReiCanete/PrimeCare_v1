<?php
/**
 * PrimeCare - POST /api/wards/transfer.php
 * Admin/Nurse-only atomic inpatient bed transfer transaction.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/wards.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$actor = requireRole(['admin', 'nurse']);
requireCsrf();

$input       = getJsonInput();
$admissionId = trim((string) ($input['admissionId'] ?? ''));
$newBedId    = trim((string) ($input['newBedId'] ?? ''));

if ($admissionId === '' || $newBedId === '') {
    sendError('Admission ID and destination bed ID are required.', 422);
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

    $oldBedId = (string) $adm['bed_id'];
    if ($oldBedId === $newBedId) {
        $pdo->rollBack();
        sendError('Patient is already assigned to that bed.', 422);
    }

    // Lock both beds in deterministic ID order to avoid deadlocks
    $bedStmt = $pdo->prepare("
        SELECT b.id, b.ward_id, b.bed_number, b.status, w.name AS ward_name, w.daily_rate
        FROM beds b
        JOIN wards w ON w.id = b.ward_id
        WHERE b.id IN (:id1, :id2)
        ORDER BY b.id ASC
        FOR UPDATE
    ");
    $bedStmt->execute([':id1' => $oldBedId, ':id2' => $newBedId]);
    $bedsById = [];
    foreach ($bedStmt->fetchAll() as $b) {
        $bedsById[(string) $b['id']] = $b;
    }

    if (!isset($bedsById[$newBedId])) {
        $pdo->rollBack();
        sendError('Destination bed not found.', 404);
    }
    $newBed = $bedsById[$newBedId];
    if ($newBed['status'] !== 'Available') {
        $pdo->rollBack();
        sendError('New bed is not available.', 409);
    }

    if (isset($bedsById[$oldBedId])) {
        $freeStmt = $pdo->prepare("UPDATE beds SET status = 'Available', current_patient_id = NULL WHERE id = :bid");
        $freeStmt->execute([':bid' => $oldBedId]);
    }

    $occStmt = $pdo->prepare("UPDATE beds SET status = 'Occupied', current_patient_id = :pid WHERE id = :bid");
    $occStmt->execute([':pid' => $adm['patient_id'], ':bid' => $newBedId]);

    $updAdm = $pdo->prepare('UPDATE admissions SET bed_id = :bid, daily_rate = :rate WHERE id = :aid');
    $updAdm->execute([
        ':bid'  => $newBedId,
        ':rate' => round((float) $newBed['daily_rate'], 2),
        ':aid'  => $admissionId,
    ]);

    $updPat = $pdo->prepare('UPDATE patients SET ward = :ward, bed_number = :bed_num WHERE id = :pid');
    $updPat->execute([
        ':ward'    => $newBed['ward_name'],
        ':bed_num' => $newBed['bed_number'],
        ':pid'     => $adm['patient_id'],
    ]);

    writeAuthAuditLog(
        (string) $actor['id'],
        (string) $actor['username'],
        'Transfer Patient',
        "Transferred admission {$admissionId} from {$oldBedId} to {$newBedId} ({$newBed['ward_name']})"
    );

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Failed to transfer patient.', 500);
}

sendSuccess('Patient transferred successfully.', [
    'admission' => findAdmissionById($pdo, $admissionId),
]);
