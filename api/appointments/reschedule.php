<?php
/**
 * PrimeCare - POST /api/appointments/reschedule.php
 * Phase 5.6.2: In-place rescheduling of an existing appointment.
 *
 * Security & Transaction Rules:
 * - Requires authenticated session (`requireRole(['admin', 'staff', 'patient'])`) and valid CSRF token (`requireCsrf()`).
 * - Updates the existing appointment row IN PLACE (`UPDATE appointments SET appointment_date = ..., appointment_time = ...`),
 *   preserving `id`, `created_by`, `created_at`, `status`, `pre_visit_forms`, `medical_records`, and `bill_id` relationships.
 * - If caller is `patient`:
 *   - Enforces patient ownership (`appointment.patient_id === own patient ID`, else 403).
 *   - Enforces the 24-hour cutoff before the currently scheduled appointment time (`isAppointmentMoreThan24HoursAway`).
 *   - Enforces the 60-day advance booking horizon (`newDate <= today + 60 days`).
 * - Rejects rescheduling `'Completed'` or `'Cancelled'` appointments (400).
 * - Inside a PDO transaction:
 *   - Locks the appointment row and the target doctor row (`SELECT ... FOR UPDATE`).
 *   - Validates the new slot against doctor status, weekday schedule, slot interval grid, and active conflicts
 *     (excluding the appointment itself via `$excludeAppointmentId = $id`).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/appointments.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(['admin', 'staff', 'patient']);
requireCsrf();

$input     = getJsonInput();
$pdo       = getDatabaseConnection();
$isPatient = ($user['role'] === 'patient');

$id      = strtoupper(trim((string) ($input['id'] ?? '')));
$newDate = trim((string) ($input['date'] ?? $input['newDate'] ?? $input['appointmentDate'] ?? ''));
$newTime = trim((string) ($input['time'] ?? $input['newTime'] ?? $input['appointmentTime'] ?? ''));

if ($id === '' || !preg_match('/^A-\d{3,}$/i', $id)) {
    sendError('A valid Appointment ID (e.g., A-001) is required.', 400);
}

if ($newDate === '' || getWeekdayCodeForDate($newDate) === null) {
    sendError('A valid new appointment date (YYYY-MM-DD) is required.', 400);
}

$normalizedTime = normalizeTimeInput($newTime);
if ($normalizedTime === null) {
    sendError('A valid new appointment time (HH:MM) is required.', 400);
}

$existing = findAppointmentById($pdo, $id);
if ($existing === null) {
    sendError('Appointment not found.', 404);
}

if ($isPatient) {
    $ownPatient = findPatientByUserId($pdo, (string) $user['id']);
    if ($ownPatient === null || (string) $ownPatient['id'] !== (string) $existing['patientId']) {
        sendError('Forbidden: You can only reschedule your own appointments.', 403);
    }
    if ((string) $ownPatient['status'] !== 'verified') {
        sendError('Only verified patients can reschedule appointments.', 403);
    }
    if (!isAppointmentMoreThan24HoursAway((string) $existing['date'], (string) $existing['time'])) {
        sendError('Cannot reschedule within 24 hours of the appointment.', 400);
    }

    $maxDateStr = (new DateTimeImmutable('today +60 days'))->format('Y-m-d');
    if ($newDate > $maxDateStr) {
        sendError('Cannot book more than 60 days in advance.', 400);
    }
}

$currentStatus = (string) $existing['status'];
if ($currentStatus === 'Completed' || $currentStatus === 'Cancelled') {
    sendError("Cannot reschedule a {$currentStatus} appointment.", 400);
}

// Optional fields that staff may update during reschedule modal submission
$newType   = isset($input['type']) && in_array(strtolower(trim((string) $input['type'])), PRIMECARE_APPOINTMENT_TYPES, true)
    ? strtolower(trim((string) $input['type']))
    : (string) $existing['type'];
$newReason = isset($input['reason']) && trim((string) $input['reason']) !== ''
    ? trim((string) $input['reason'])
    : (string) $existing['reason'];

$doctorId  = (string) $existing['doctorId'];
$patientId = (string) $existing['patientId'];

$pdo->beginTransaction();
try {
    // Lock the appointment row first
    $lockAppt = $pdo->prepare('SELECT id, status FROM appointments WHERE id = :id FOR UPDATE');
    $lockAppt->execute([':id' => $id]);
    $lockedRow = $lockAppt->fetch();
    if (!is_array($lockedRow) || in_array((string) $lockedRow['status'], ['Completed', 'Cancelled'], true)) {
        $pdo->rollBack();
        sendError('Appointment can no longer be rescheduled.', 400);
    }

    // Validate and lock the new slot, excluding this appointment's own ID
    $slotCheck = validateAndLockAppointmentSlot($pdo, $doctorId, $patientId, $newDate, $normalizedTime, $id);
    if (!$slotCheck['ok']) {
        $pdo->rollBack();
        sendError((string) $slotCheck['message'], (int) ($slotCheck['status'] ?? 400));
    }

    $nowStr = date('Y-m-d H:i:s');
    $dbTime = $normalizedTime . ':00';

    $upd = $pdo->prepare(
        'UPDATE appointments
         SET appointment_date = :dt,
             appointment_time = :tm,
             type = :type,
             reason = :reason,
             updated_at = :updated_at
         WHERE id = :id'
    );
    $upd->execute([
        ':dt'         => $newDate,
        ':tm'         => $dbTime,
        ':type'       => $newType,
        ':reason'     => $newReason,
        ':updated_at' => $nowStr,
        ':id'         => $id,
    ]);

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

$updated = findAppointmentById($pdo, $id);
writeAuthAuditLog(
    (string) $user['id'],
    (string) $user['username'],
    'Reschedule Appointment',
    "Rescheduled appointment {$id} to {$newDate} at {$normalizedTime}"
);

sendSuccess('Appointment rescheduled successfully.', [
    'appointment' => $updated,
]);

