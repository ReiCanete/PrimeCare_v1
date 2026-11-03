<?php
/**
 * PrimeCare - Appointment Management & Online Booking Helpers, Serializers & Validators
 * Phase 5.6.2: Appointment Management & Online Booking Backend Migration
 */

declare(strict_types=1);

// Prevent direct HTTP access to this helper file
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => 'Direct access to helper files is forbidden.',
        'data'    => null,
    ]);
    exit;
}

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/patients.php';
require_once __DIR__ . '/doctors.php';

// Align PHP wall-clock calculations with local Philippine Standard Time (XAMPP MariaDB SYSTEM timezone)
date_default_timezone_set('Asia/Manila');

/**
 * Valid appointment consultation types.
 */
const PRIMECARE_APPOINTMENT_TYPES = ['in-person', 'telehealth'];

/**
 * Valid appointment statuses.
 */
const PRIMECARE_APPOINTMENT_STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];

/**
 * Serialize a `pre_visit_forms` database row into the camelCase shape expected by frontend consumers.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function serializePreVisitForm(array $row): array
{
    $duration    = $row['duration'] !== null ? (string) $row['duration'] : '';
    $medications = $row['medications'] !== null ? (string) $row['medications'] : '';
    $allergies   = $row['allergies'] !== null ? (string) $row['allergies'] : '';

    return [
        'id'                 => (string) ($row['id'] ?? ''),
        'appointmentId'      => (string) ($row['appointment_id'] ?? ''),
        'symptoms'           => (string) ($row['symptoms'] ?? ''),
        'duration'           => $duration,
        'symptomDuration'    => $duration,
        'medications'        => $medications,
        'currentMedications' => $medications,
        'allergies'          => $allergies,
        'consent'            => !empty($row['consent']),
        'submittedAt'        => isset($row['submitted_at']) ? (string) $row['submitted_at'] : null,
    ];
}

/**
 * Fetch a pre-visit form by appointment ID, or return null if not submitted.
 *
 * @param PDO    $pdo
 * @param string $appointmentId
 * @return array<string, mixed>|null
 */
function findPreVisitFormByAppointmentId(PDO $pdo, string $appointmentId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM pre_visit_forms WHERE appointment_id = :aid LIMIT 1');
    $stmt->execute([':aid' => $appointmentId]);
    $row = $stmt->fetch();

    return is_array($row) ? serializePreVisitForm($row) : null;
}

/**
 * Batch-fetch pre-visit forms for an array of appointment IDs, returning map: appointmentId => serializedForm.
 *
 * @param PDO                $pdo
 * @param array<int, string> $appointmentIds
 * @return array<string, array<string, mixed>>
 */
function fetchPreVisitFormsByAppointmentIds(PDO $pdo, array $appointmentIds): array
{
    if ($appointmentIds === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($appointmentIds), '?'));
    $stmt = $pdo->prepare("SELECT * FROM pre_visit_forms WHERE appointment_id IN ({$placeholders})");
    $stmt->execute(array_values($appointmentIds));
    $rows = $stmt->fetchAll();

    $map = [];
    foreach ($rows ?: [] as $row) {
        $aid = (string) $row['appointment_id'];
        $map[$aid] = serializePreVisitForm($row);
    }

    return $map;
}

/**
 * Convert an `appointments` row (joined with `patients` and `doctors`) into the camelCase
 * object expected across all PrimeCare staff, clinical, and patient portal controllers.
 *
 * @param array<string, mixed>      $row
 * @param array<string, mixed>|null $preVisitForm
 * @return array<string, mixed>
 */
function serializeAppointment(array $row, ?array $preVisitForm = null): array
{
    $rawTime = (string) ($row['appointment_time'] ?? '');
    $hhmm    = formatScheduleTime($rawTime);
    $fee     = isset($row['consultation_fee']) ? (float) $row['consultation_fee'] : 0.0;

    return [
        'id'              => (string) $row['id'],
        'patientId'       => (string) $row['patient_id'],
        'patientName'     => isset($row['patient_name']) && $row['patient_name'] !== null ? (string) $row['patient_name'] : 'Unknown',
        'doctorId'        => (string) $row['doctor_id'],
        'doctorName'      => isset($row['doctor_name']) && $row['doctor_name'] !== null ? (string) $row['doctor_name'] : 'Unknown',
        'specialization'  => isset($row['doctor_specialization']) && $row['doctor_specialization'] !== null ? (string) $row['doctor_specialization'] : '',
        'department'      => isset($row['doctor_department']) && $row['doctor_department'] !== null ? (string) $row['doctor_department'] : '',
        'fee'             => $fee,
        'consultationFee' => $fee,
        'date'            => (string) ($row['appointment_date'] ?? ''),
        'time'            => $hhmm,
        'appointmentDate' => (string) ($row['appointment_date'] ?? ''),
        'appointmentTime' => $rawTime,
        'type'            => (string) ($row['type'] ?? 'in-person'),
        'status'          => (string) ($row['status'] ?? 'Pending'),
        'reason'          => (string) ($row['reason'] ?? ''),
        'notes'           => $row['notes'] !== null ? (string) $row['notes'] : '',
        'cancelReason'    => $row['cancel_reason'] !== null ? (string) $row['cancel_reason'] : null,
        'billed'          => !empty($row['billed']),
        'billId'          => $row['bill_id'] !== null && $row['bill_id'] !== '' ? (string) $row['bill_id'] : null,
        'createdBy'       => $row['created_by'] !== null && $row['created_by'] !== '' ? (string) $row['created_by'] : null,
        'createdAt'       => isset($row['created_at']) ? (string) $row['created_at'] : null,
        'updatedAt'       => isset($row['updated_at']) ? (string) $row['updated_at'] : null,
        'hasPreVisitForm' => $preVisitForm !== null,
        'preVisitForm'    => $preVisitForm,
    ];
}

/**
 * Fetch a single appointment by ID with joined patient/doctor fields and pre-visit form.
 *
 * @param PDO    $pdo
 * @param string $id
 * @return array<string, mixed>|null
 */
function findAppointmentById(PDO $pdo, string $id): ?array
{
    $stmt = $pdo->prepare(
        'SELECT a.*,
                p.full_name AS patient_name,
                d.name AS doctor_name,
                d.specialization AS doctor_specialization,
                d.department AS doctor_department,
                d.consultation_fee AS consultation_fee
         FROM appointments a
         LEFT JOIN patients p ON p.id = a.patient_id
         LEFT JOIN doctors d ON d.id = a.doctor_id
         WHERE a.id = :id
         LIMIT 1'
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        return null;
    }

    $preVisit = findPreVisitFormByAppointmentId($pdo, (string) $row['id']);
    return serializeAppointment($row, $preVisit);
}

/**
 * Validate a YYYY-MM-DD date string and return its canonical 3-letter weekday ('Mon'..'Sun'),
 * or null if the date format or calendar date is invalid.
 *
 * @param string $dateStr
 * @return string|null
 */
function getWeekdayCodeForDate(string $dateStr): ?string
{
    $trimmed = trim($dateStr);
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $trimmed, $m)) {
        return null;
    }
    $year  = (int) $m[1];
    $month = (int) $m[2];
    $day   = (int) $m[3];
    if (!checkdate($month, $day, $year)) {
        return null;
    }

    $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $trimmed);
    if (!$dt) {
        return null;
    }

    return $dt->format('D'); // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
}

/**
 * Convert an 'HH:MM' or 'HH:MM:SS' string to minutes since midnight.
 */
function timeStringToMinutes(string $time): int
{
    $parts = explode(':', trim($time));
    $h = isset($parts[0]) ? (int) $parts[0] : 0;
    $m = isset($parts[1]) ? (int) $parts[1] : 0;
    return ($h * 60) + $m;
}

/**
 * Compute all time slots for a doctor on a given date string ('YYYY-MM-DD').
 *
 * Rules:
 * - If doctor does not exist or `status !== 'active'`, returns `[]`.
 * - If date is invalid or doctor has no schedule on that weekday, returns `[]`.
 * - Generates slots from `start_time` to `end_time` stepping by `slot_minutes`.
 * - Marks a slot `available = false` if:
 *   a) `date === today` and slot time <= current local time, OR
 *   b) an active (`status != 'Cancelled'`) appointment exists for `(doctor_id, appointment_date, appointment_time)`
 *      (excluding `$excludeAppointmentId` when rescheduling).
 *
 * @param PDO         $pdo
 * @param string      $doctorId
 * @param string      $dateStr
 * @param string|null $excludeAppointmentId
 * @return array<int, array{time: string, available: bool}>
 */
function computeDoctorSlots(PDO $pdo, string $doctorId, string $dateStr, ?string $excludeAppointmentId = null): array
{
    $dayCode = getWeekdayCodeForDate($dateStr);
    if ($dayCode === null) {
        return [];
    }

    $docStmt = $pdo->prepare('SELECT id, status, slot_minutes FROM doctors WHERE id = :did LIMIT 1');
    $docStmt->execute([':did' => $doctorId]);
    $doc = $docStmt->fetch();

    if (!is_array($doc) || (string) $doc['status'] !== 'active') {
        return [];
    }

    $slotMins = isset($doc['slot_minutes']) && (int) $doc['slot_minutes'] > 0
        ? (int) $doc['slot_minutes']
        : 30;

    $schedStmt = $pdo->prepare(
        'SELECT start_time, end_time
         FROM doctor_schedules
         WHERE doctor_id = :did AND day_of_week = :day
         ORDER BY start_time ASC'
    );
    $schedStmt->execute([
        ':did' => $doctorId,
        ':day' => $dayCode,
    ]);
    $shifts = $schedStmt->fetchAll();

    if (!$shifts) {
        return [];
    }

    // Fetch existing active appointments for this doctor and date
    $apptSql = "SELECT appointment_time
                FROM appointments
                WHERE doctor_id = :did
                  AND appointment_date = :dt
                  AND status != 'Cancelled'";
    $apptParams = [
        ':did' => $doctorId,
        ':dt'  => $dateStr,
    ];
    if ($excludeAppointmentId !== null && $excludeAppointmentId !== '') {
        $apptSql .= ' AND id != :exid';
        $apptParams[':exid'] = $excludeAppointmentId;
    }

    $apptStmt = $pdo->prepare($apptSql);
    $apptStmt->execute($apptParams);
    $takenRows = $apptStmt->fetchAll();

    $takenTimes = [];
    foreach ($takenRows ?: [] as $r) {
        $takenTimes[formatScheduleTime((string) $r['appointment_time'])] = true;
    }

    $todayStr   = date('Y-m-d');
    $nowMinutes = ((int) date('G') * 60) + (int) date('i');

    $slots = [];
    foreach ($shifts as $shift) {
        $startMins = timeStringToMinutes((string) $shift['start_time']);
        $endMins   = timeStringToMinutes((string) $shift['end_time']);

        for ($cur = $startMins; $cur < $endMins; $cur += $slotMins) {
            $hh      = str_pad((string) intdiv($cur, 60), 2, '0', STR_PAD_LEFT);
            $mm      = str_pad((string) ($cur % 60), 2, '0', STR_PAD_LEFT);
            $timeStr = "{$hh}:{$mm}";

            $available = true;
            if ($dateStr < $todayStr) {
                $available = false;
            } elseif ($dateStr === $todayStr && $cur <= $nowMinutes) {
                $available = false;
            }
            if (isset($takenTimes[$timeStr])) {
                $available = false;
            }

            $slots[] = [
                'time'      => $timeStr,
                'available' => $available,
            ];
        }
    }

    return $slots;
}

/**
 * Validate a requested booking/reschedule slot inside an active PDO transaction.
 *
 * Caller MUST have started a transaction (`$pdo->beginTransaction()`) before calling this helper.
 * Locks the target doctor row (`SELECT ... FOR UPDATE`), validates doctor status, schedule,
 * slot grid alignment, and checks for doctor and patient double-booking conflicts.
 *
 * Calls `sendError(..., 400|404|409)` (which rolls back if handled or caller catches) or returns
 * an error array `['ok' => false, 'status' => int, 'message' => string]`.
 *
 * @param PDO         $pdo
 * @param string      $doctorId
 * @param string      $patientId
 * @param string      $dateStr
 * @param string      $timeHhMm
 * @param string|null $excludeAppointmentId
 * @return array{ok: bool, status?: int, message?: string, doctor?: array<string, mixed>}
 */
function validateAndLockAppointmentSlot(
    PDO $pdo,
    string $doctorId,
    string $patientId,
    string $dateStr,
    string $timeHhMm,
    ?string $excludeAppointmentId = null
): array {
    $dayCode = getWeekdayCodeForDate($dateStr);
    if ($dayCode === null) {
        return ['ok' => false, 'status' => 400, 'message' => 'A valid appointment date (YYYY-MM-DD) is required.'];
    }

    $normalizedTime = normalizeTimeInput($timeHhMm);
    if ($normalizedTime === null) {
        return ['ok' => false, 'status' => 400, 'message' => 'A valid appointment time (HH:MM) is required.'];
    }

    $todayStr = date('Y-m-d');
    if ($dateStr < $todayStr) {
        return ['ok' => false, 'status' => 400, 'message' => 'Cannot book appointments in the past.'];
    }

    // 1. Lock the doctor row to serialize concurrent bookings for this doctor
    $docStmt = $pdo->prepare('SELECT * FROM doctors WHERE id = :did FOR UPDATE');
    $docStmt->execute([':did' => $doctorId]);
    $doc = $docStmt->fetch();

    if (!is_array($doc)) {
        return ['ok' => false, 'status' => 404, 'message' => 'Doctor not found.'];
    }
    if ((string) $doc['status'] !== 'active') {
        return ['ok' => false, 'status' => 400, 'message' => 'Doctor is not available for new appointments.'];
    }

    // 2. Verify doctor schedule for that weekday and slot grid alignment
    $schedStmt = $pdo->prepare(
        'SELECT start_time, end_time
         FROM doctor_schedules
         WHERE doctor_id = :did AND day_of_week = :day
         ORDER BY start_time ASC'
    );
    $schedStmt->execute([':did' => $doctorId, ':day' => $dayCode]);
    $shifts = $schedStmt->fetchAll();

    if (!$shifts) {
        return ['ok' => false, 'status' => 400, 'message' => 'Doctor is not in clinic on this day.'];
    }

    $slotMins = isset($doc['slot_minutes']) && (int) $doc['slot_minutes'] > 0
        ? (int) $doc['slot_minutes']
        : 30;
    $targetMins = timeStringToMinutes($normalizedTime);

    $inScheduleGrid = false;
    foreach ($shifts as $shift) {
        $startMins = timeStringToMinutes((string) $shift['start_time']);
        $endMins   = timeStringToMinutes((string) $shift['end_time']);
        if ($targetMins >= $startMins && $targetMins < $endMins && (($targetMins - $startMins) % $slotMins === 0)) {
            $inScheduleGrid = true;
            break;
        }
    }

    if (!$inScheduleGrid) {
        return ['ok' => false, 'status' => 400, 'message' => 'Time is outside doctor schedule or does not align with clinic slot intervals.'];
    }

    // Check if slot is already in the past today
    $nowMinutes = ((int) date('G') * 60) + (int) date('i');
    if ($dateStr === $todayStr && $targetMins <= $nowMinutes) {
        return ['ok' => false, 'status' => 400, 'message' => 'Cannot book a time slot that has already passed today.'];
    }

    $dbTime = $normalizedTime . ':00';

    // 3. Check for conflicting active doctor appointments
    $docConflictSql = "SELECT id FROM appointments
                       WHERE doctor_id = :did
                         AND appointment_date = :dt
                         AND appointment_time = :tm
                         AND status != 'Cancelled'";
    $docConflictParams = [
        ':did' => $doctorId,
        ':dt'  => $dateStr,
        ':tm'  => $dbTime,
    ];
    if ($excludeAppointmentId !== null && $excludeAppointmentId !== '') {
        $docConflictSql .= ' AND id != :exid';
        $docConflictParams[':exid'] = $excludeAppointmentId;
    }
    $docConflictSql .= ' FOR UPDATE';

    $dcStmt = $pdo->prepare($docConflictSql);
    $dcStmt->execute($docConflictParams);
    if ($dcStmt->fetch()) {
        return ['ok' => false, 'status' => 409, 'message' => 'Time slot is already taken.'];
    }

    // 4. Check for conflicting active appointments for the same patient at the same date & time
    $patConflictSql = "SELECT id FROM appointments
                       WHERE patient_id = :pid
                         AND appointment_date = :dt
                         AND appointment_time = :tm
                         AND status != 'Cancelled'";
    $patConflictParams = [
        ':pid' => $patientId,
        ':dt'  => $dateStr,
        ':tm'  => $dbTime,
    ];
    if ($excludeAppointmentId !== null && $excludeAppointmentId !== '') {
        $patConflictSql .= ' AND id != :exid';
        $patConflictParams[':exid'] = $excludeAppointmentId;
    }
    $patConflictSql .= ' FOR UPDATE';

    $pcStmt = $pdo->prepare($patConflictSql);
    $pcStmt->execute($patConflictParams);
    if ($pcStmt->fetch()) {
        return ['ok' => false, 'status' => 409, 'message' => 'Patient already has an appointment at this date and time.'];
    }

    return [
        'ok'     => true,
        'doctor' => $doc,
    ];
}

/**
 * Evaluate whether a patient is within 24 hours of an appointment's scheduled date and time.
 * Returns true if the appointment is strictly more than 24 hours in the future.
 */
function isAppointmentMoreThan24HoursAway(string $dateStr, string $timeStr): bool
{
    $hhmm = formatScheduleTime($timeStr);
    $dt   = DateTimeImmutable::createFromFormat('Y-m-d H:i', "{$dateStr} {$hhmm}");
    if (!$dt) {
        return false;
    }
    $diffSeconds = $dt->getTimestamp() - time();
    return $diffSeconds >= (24 * 60 * 60);
}

/**
 * Evaluate server-side telehealth join eligibility for an appointment and its pre-visit form.
 *
 * Rules (matching `api.canJoinTelehealth` and `js/telehealth.js`):
 * 1. Appointment must have `type === 'telehealth'`.
 * 2. Appointment `status` must be `'Confirmed'`.
 * 3. Pre-visit questionnaire must be submitted (`$preVisitForm !== null`).
 * 4. Join window opens 15 minutes before the scheduled time (`diffMins <= 15`)
 *    and closes 30 minutes after the scheduled time (`diffMins >= -30`).
 *
 * @param array<string, mixed>      $appointment  Serialized appointment
 * @param array<string, mixed>|null $preVisitForm Serialized pre-visit form or null
 * @return array<string, mixed>
 */
function evaluateTelehealthJoinEligibility(array $appointment, ?array $preVisitForm): array
{
    if (($appointment['type'] ?? '') !== 'telehealth') {
        return [
            'allowed' => false,
            'reason'  => 'This appointment is not a telehealth consultation.',
        ];
    }

    if (($appointment['status'] ?? '') !== 'Confirmed') {
        return [
            'allowed' => false,
            'reason'  => 'Appointment is not confirmed yet.',
        ];
    }

    if ($preVisitForm === null) {
        return [
            'allowed' => false,
            'reason'  => 'Pre-visit questionnaire not submitted.',
        ];
    }

    $dateStr = (string) ($appointment['date'] ?? '');
    $timeStr = formatScheduleTime((string) ($appointment['time'] ?? ''));
    $dt      = DateTimeImmutable::createFromFormat('Y-m-d H:i', "{$dateStr} {$timeStr}");

    if (!$dt) {
        return [
            'allowed' => false,
            'reason'  => 'Invalid appointment schedule.',
        ];
    }

    $diffMins = ($dt->getTimestamp() - time()) / 60.0;

    if ($diffMins > 15.0) {
        return [
            'allowed'      => false,
            'reason'       => 'Join window opens 15 minutes before.',
            'minutesUntil' => (int) ceil($diffMins - 15.0),
        ];
    }

    if ($diffMins < -30.0) {
        return [
            'allowed' => false,
            'reason'  => 'Appointment time has passed.',
        ];
    }

    return [
        'allowed' => true,
        'reason'  => 'Eligible to join telehealth session.',
    ];
}
