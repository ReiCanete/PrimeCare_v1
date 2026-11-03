<?php
/**
 * PrimeCare - POST /api/appointments/create.php
 * Phase 5.6.2: Create an appointment (Staff-assisted walk-in/booking or Patient online self-booking).
 *
 * Security & Transaction Rules:
 * - Requires authenticated session (`requireRole(['admin', 'staff', 'patient'])`) and valid CSRF token (`requireCsrf()`).
 * - Doctors and nurses are blocked (403) from creating appointment bookings.
 * - If caller is `patient`:
 *   - Derives `patientId` strictly from the authenticated session (`findPatientByUserId`), ignoring any client-supplied `patientId`.
 *   - Enforces `patient.status === 'verified'`.
 *   - Enforces `reason` length >= 10 characters.
 *   - Enforces 60-day advance booking horizon (`date <= today + 60 days`).
 *   - Enforces maximum of 3 active upcoming appointments (`date >= today` and `status NOT IN ('Cancelled','Completed')`).
 *   - Sets initial appointment status to `'Pending'`.
 * - If caller is `admin` or `staff`:
 *   - Validates target `patientId` exists and `patient.status === 'verified'`.
 *   - Requires non-empty `reason`.
 *   - Sets initial appointment status to `'Confirmed'`.
 * - Inside a PDO transaction:
 *   1. Locks the target doctor row (`SELECT ... FOR UPDATE`).
 *   2. Validates doctor is `active`, works on that weekday, and time aligns with `slot_minutes`.
 *   3. Checks for conflicting active doctor appointments (`409 Conflict`).
 *   4. Checks for conflicting active patient appointments (`409 Conflict`).
 *   5. Allocates the next `A-XXX` ID via `allocateNextId()`.
 *   6. Inserts into `appointments` and commits.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/appointments.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(['admin', 'staff', 'patient']);
requireCsrf();

$input    = getJsonInput();
$pdo      = getDatabaseConnection();
$isPatient = ($user['role'] === 'patient');

$doctorId = strtoupper(trim((string) ($input['doctorId'] ?? '')));
$dateStr  = trim((string) ($input['date'] ?? $input['appointmentDate'] ?? ''));
$timeStr  = trim((string) ($input['time'] ?? $input['appointmentTime'] ?? ''));
$type     = strtolower(trim((string) ($input['type'] ?? 'in-person')));
$reason   = trim((string) ($input['reason'] ?? ''));
$notes    = trim((string) ($input['notes'] ?? ''));

if ($doctorId === '' || !preg_match('/^D-\d{3,}$/i', $doctorId)) {
    sendError('A valid Doctor ID is required.', 400);
}

if ($dateStr === '' || getWeekdayCodeForDate($dateStr) === null) {
    sendError('A valid appointment date (YYYY-MM-DD) is required.', 400);
}

$normalizedTime = normalizeTimeInput($timeStr);
if ($normalizedTime === null) {
    sendError('A valid appointment time (HH:MM) is required.', 400);
}

if (!in_array($type, PRIMECARE_APPOINTMENT_TYPES, true)) {
    sendError('Invalid consultation type. Must be "in-person" or "telehealth".', 400);
}

// Resolve and validate patient identity & verification status
if ($isPatient) {
    $patient = findPatientByUserId($pdo, (string) $user['id']);
    if ($patient === null) {
        sendError('No linked patient record found. Please visit the hospital to register.', 403);
    }
    if ((string) $patient['status'] !== 'verified') {
        sendError('Only verified patients can book appointments. Your account is pending verification by hospital staff.', 403);
    }
    if (mb_strlen($reason) < 10) {
        sendError('Reason for visit must be at least 10 characters.', 400);
    }

    $maxDateStr = (new DateTimeImmutable('today +60 days'))->format('Y-m-d');
    if ($dateStr > $maxDateStr) {
        sendError('Cannot book more than 60 days in advance.', 400);
    }

    $patientId     = (string) $patient['id'];
    $initialStatus = 'Pending';
} else {
    $requestedPid = strtoupper(trim((string) ($input['patientId'] ?? '')));
    if ($requestedPid === '' || !preg_match('/^P-\d{3,}$/i', $requestedPid)) {
        sendError('A valid Patient ID is required.', 400);
    }
    $patient = findPatientById($pdo, $requestedPid);
    if ($patient === null) {
        sendError('Patient not found.', 404);
    }
    if ((string) $patient['status'] !== 'verified') {
        sendError('Only verified patients can book appointments.', 400);
    }
    if ($reason === '') {
        sendError('Reason for visit is required.', 400);
    }

    $patientId     = (string) $patient['id'];
    $initialStatus = 'Confirmed';
}

$pdo->beginTransaction();
try {
    // Lock the patient row if self-booking to enforce the 3-active-upcoming-appointments limit atomically
    if ($isPatient) {
        $lockPat = $pdo->prepare('SELECT id FROM patients WHERE id = :pid FOR UPDATE');
        $lockPat->execute([':pid' => $patientId]);

        $todayStr = date('Y-m-d');
        $activeCountStmt = $pdo->prepare(
            "SELECT COUNT(*) FROM appointments
             WHERE patient_id = :pid
               AND appointment_date >= :today
               AND status NOT IN ('Cancelled', 'Completed')"
        );
        $activeCountStmt->execute([
            ':pid'   => $patientId,
            ':today' => $todayStr,
        ]);
        if ((int) $activeCountStmt->fetchColumn() >= 3) {
            $pdo->rollBack();
            sendError('You can only have a maximum of 3 active upcoming appointments.', 400);
        }
    }

    // Lock doctor row, validate schedule & time grid, and check for doctor/patient double-booking
    $slotCheck = validateAndLockAppointmentSlot($pdo, $doctorId, $patientId, $dateStr, $normalizedTime, null);
    if (!$slotCheck['ok']) {
        $pdo->rollBack();
        sendError((string) $slotCheck['message'], (int) ($slotCheck['status'] ?? 400));
    }

    $appointmentId = allocateNextId($pdo, 'appointments', 'appointments', 'A', 3);
    $nowStr        = date('Y-m-d H:i:s');
    $dbTime        = $normalizedTime . ':00';

    $ins = $pdo->prepare(
        'INSERT INTO appointments (
            id, patient_id, doctor_id, appointment_date, appointment_time,
            type, status, reason, notes, cancel_reason,
            billed, bill_id, created_by, created_at, updated_at
        ) VALUES (
            :id, :patient_id, :doctor_id, :appointment_date, :appointment_time,
            :type, :status, :reason, :notes, NULL,
            0, NULL, :created_by, :created_at, :updated_at
        )'
    );
    $ins->execute([
        ':id'               => $appointmentId,
        ':patient_id'       => $patientId,
        ':doctor_id'        => $doctorId,
        ':appointment_date' => $dateStr,
        ':appointment_time' => $dbTime,
        ':type'             => $type,
        ':status'           => $initialStatus,
        ':reason'           => $reason,
        ':notes'            => $notes,
        ':created_by'       => (string) $user['id'],
        ':created_at'       => $nowStr,
        ':updated_at'       => $nowStr,
    ]);

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

$created = findAppointmentById($pdo, $appointmentId);
writeAuthAuditLog(
    (string) $user['id'],
    (string) $user['username'],
    'Create Appointment',
    "Scheduled appointment {$appointmentId} for patient {$patientId} with doctor {$doctorId} on {$dateStr} at {$normalizedTime} ({$initialStatus})"
);

sendSuccess(
    'Appointment scheduled successfully.',
    ['appointment' => $created],
    201
);

