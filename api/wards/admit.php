<?php
/**
 * PrimeCare - POST /api/wards/admit.php
 * Admin/Nurse-only atomic inpatient admission transaction.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/wards.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$actor = requireRole(['admin', 'nurse']);
requireCsrf();

$input             = getJsonInput();
$patientId         = trim((string) ($input['patientId'] ?? ''));
$bedId             = trim((string) ($input['bedId'] ?? ''));
$attendingDoctorId = trim((string) ($input['attendingDoctorId'] ?? ''));

if ($patientId === '' || $bedId === '' || $attendingDoctorId === '') {
    sendError('Patient, bed, and attending doctor are required.', 422);
}

$pdo = getDatabaseConnection();
$pdo->beginTransaction();

try {
    // 1. Lock and verify patient
    $patStmt = $pdo->prepare('SELECT id, full_name, status, admit_type FROM patients WHERE id = :pid FOR UPDATE');
    $patStmt->execute([':pid' => $patientId]);
    $patient = $patStmt->fetch();

    if (!is_array($patient)) {
        $pdo->rollBack();
        sendError('Patient not found.', 404);
    }
    if ($patient['status'] !== 'verified') {
        $pdo->rollBack();
        sendError('Only verified patients can be admitted.', 422);
    }

    // 2. Duplicate admission prevention (both patient admit_type and open admissions rows)
    $dupStmt = $pdo->prepare("SELECT id FROM admissions WHERE patient_id = :pid AND status = 'Admitted' LIMIT 1 FOR UPDATE");
    $dupStmt->execute([':pid' => $patientId]);
    if ($patient['admit_type'] === 'Inpatient' || $dupStmt->fetch()) {
        $pdo->rollBack();
        sendError('Patient is already admitted.', 409);
    }

    // 3. Lock and verify target bed + ward rate
    $bedStmt = $pdo->prepare("
        SELECT b.id, b.ward_id, b.bed_number, b.status, w.name AS ward_name, w.daily_rate
        FROM beds b
        JOIN wards w ON w.id = b.ward_id
        WHERE b.id = :bid
        FOR UPDATE
    ");
    $bedStmt->execute([':bid' => $bedId]);
    $bed = $bedStmt->fetch();

    if (!is_array($bed)) {
        $pdo->rollBack();
        sendError('Selected bed not found.', 404);
    }
    if ($bed['status'] !== 'Available') {
        $pdo->rollBack();
        sendError('Selected bed is not available for admission.', 409);
    }

    // 4. Verify attending doctor
    $docStmt = $pdo->prepare('SELECT id, name, status FROM doctors WHERE id = :did LIMIT 1');
    $docStmt->execute([':did' => $attendingDoctorId]);
    $doctor = $docStmt->fetch();

    if (!is_array($doctor)) {
        $pdo->rollBack();
        sendError('Attending doctor not found.', 404);
    }
    if ($doctor['status'] !== 'active') {
        $pdo->rollBack();
        sendError('Attending doctor must be active.', 422);
    }

    // 5. Allocate admission ID and update records atomically
    $admId     = allocateNextId($pdo, 'admissions', 'admissions', 'ADM', 3);
    $dailyRate = round((float) $bed['daily_rate'], 2);

    $updBed = $pdo->prepare("UPDATE beds SET status = 'Occupied', current_patient_id = :pid WHERE id = :bid");
    $updBed->execute([':pid' => $patientId, ':bid' => $bedId]);

    $insAdm = $pdo->prepare("
        INSERT INTO admissions (
            id, patient_id, bed_id, attending_doctor_id,
            admit_date, discharge_date, daily_rate, discharge_summary,
            status, billed, bill_id
        ) VALUES (
            :id, :pid, :bid, :did,
            CURDATE(), NULL, :rate, NULL,
            'Admitted', 0, NULL
        )
    ");
    $insAdm->execute([
        ':id'   => $admId,
        ':pid'  => $patientId,
        ':bid'  => $bedId,
        ':did'  => $attendingDoctorId,
        ':rate' => $dailyRate,
    ]);

    $updPat = $pdo->prepare("
        UPDATE patients
        SET admit_type = 'Inpatient',
            ward = :ward,
            bed_number = :bed_num,
            assigned_doctor_id = :did,
            date_admitted = CURDATE()
        WHERE id = :pid
    ");
    $updPat->execute([
        ':ward'    => $bed['ward_name'],
        ':bed_num' => $bed['bed_number'],
        ':did'     => $attendingDoctorId,
        ':pid'     => $patientId,
    ]);

    writeAuthAuditLog(
        (string) $actor['id'],
        (string) $actor['username'],
        'Admit Patient',
        "Admitted {$patientId} to {$bed['ward_name']} Bed {$bed['bed_number']} ({$admId})"
    );

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Failed to admit patient.', 500);
}

$admission = findAdmissionById($pdo, $admId);

sendSuccess('Patient admitted successfully.', [
    'admission' => $admission,
], 201);
