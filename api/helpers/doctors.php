<?php
/**
 * PrimeCare - Doctor Management & Scheduling Helpers, Serializers & Validators
 * Phase 5.5: Doctor Management & Scheduling Backend Integration
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

/**
 * Valid canonical days of week in chronological order (Monday through Sunday).
 */
const PRIMECARE_DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Format a MySQL TIME value ('09:00:00' or '09:00') into 'HH:MM' 24-hour string.
 */
function formatScheduleTime(string $time): string
{
    $trimmed = trim($time);
    if (preg_match('/^(\d{2}):(\d{2})/', $trimmed, $m)) {
        return $m[1] . ':' . $m[2];
    }
    return $trimmed;
}

/**
 * Validate and normalize a time input string ('HH:MM' or 'HH:MM:SS') into 'HH:MM'.
 * Returns null if invalid.
 */
function normalizeTimeInput(string $time): ?string
{
    $trimmed = trim($time);
    if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/', $trimmed, $m)) {
        return null;
    }
    return $m[1] . ':' . $m[2];
}

/**
 * Serialize a `doctor_schedules` database row into the frontend object shape.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function serializeDoctorScheduleRow(array $row): array
{
    return [
        'id'       => isset($row['id']) ? (int) $row['id'] : null,
        'doctorId' => (string) ($row['doctor_id'] ?? ''),
        'day'      => (string) ($row['day_of_week'] ?? ''),
        'start'    => formatScheduleTime((string) ($row['start_time'] ?? '')),
        'end'      => formatScheduleTime((string) ($row['end_time'] ?? '')),
    ];
}

/**
 * Fetch all schedules for a single doctor ordered Mon..Sun, start_time ASC.
 *
 * @param PDO    $pdo
 * @param string $doctorId
 * @return array<int, array<string, mixed>>
 */
function fetchSchedulesForDoctor(PDO $pdo, string $doctorId): array
{
    $stmt = $pdo->prepare(
        "SELECT id, doctor_id, day_of_week, start_time, end_time
         FROM doctor_schedules
         WHERE doctor_id = :did
         ORDER BY FIELD(day_of_week, 'Mon','Tue','Wed','Thu','Fri','Sat','Sun'), start_time ASC"
    );
    $stmt->execute([':did' => $doctorId]);
    $rows = $stmt->fetchAll();

    return array_map('serializeDoctorScheduleRow', $rows ?: []);
}

/**
 * Batch-fetch schedules for an array of doctor IDs, returning map: doctorId => schedule[].
 *
 * @param PDO                 $pdo
 * @param array<int, string>  $doctorIds
 * @return array<string, array<int, array<string, mixed>>>
 */
function fetchSchedulesByDoctorIds(PDO $pdo, array $doctorIds): array
{
    if ($doctorIds === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($doctorIds), '?'));
    $sql = "SELECT id, doctor_id, day_of_week, start_time, end_time
            FROM doctor_schedules
            WHERE doctor_id IN ({$placeholders})
            ORDER BY doctor_id ASC, FIELD(day_of_week, 'Mon','Tue','Wed','Thu','Fri','Sat','Sun'), start_time ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute(array_values($doctorIds));
    $rows = $stmt->fetchAll();

    $grouped = [];
    foreach ($doctorIds as $id) {
        $grouped[$id] = [];
    }
    foreach ($rows ?: [] as $row) {
        $did = (string) $row['doctor_id'];
        $grouped[$did][] = serializeDoctorScheduleRow($row);
    }

    return $grouped;
}

/**
 * Decode a JSON array column safely into a list of non-empty strings.
 *
 * @param mixed $raw
 * @return array<int, string>
 */
function decodeJsonStringArray(mixed $raw): array
{
    if (is_array($raw)) {
        return array_values(array_filter(array_map(static fn($v) => trim((string) $v), $raw), static fn($v) => $v !== ''));
    }
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return array_values(array_filter(array_map('trim', explode(',', $raw)), static fn($v) => $v !== ''));
    }
    return array_values(array_filter(array_map(static fn($v) => trim((string) $v), $decoded), static fn($v) => $v !== ''));
}

/**
 * Convert a `doctors` row (optionally joined with `departments`) + schedule array
 * into the camelCase structure expected by all PrimeCare frontend controllers.
 *
 * @param array<string, mixed>             $row
 * @param array<int, array<string, mixed>> $schedule
 * @return array<string, mixed>
 */
function serializeDoctor(array $row, array $schedule = []): array
{
    return [
        'id'                    => (string) $row['id'],
        'userId'                => ($row['user_id'] ?? null) !== null && $row['user_id'] !== '' ? (string) $row['user_id'] : null,
        'name'                  => (string) $row['name'],
        'photoInitials'         => (string) ($row['photo_initials'] ?? 'DR'),
        'specialization'        => (string) $row['specialization'],
        'department'            => (string) $row['department'],
        'departmentId'          => isset($row['department_id']) && $row['department_id'] !== null ? (int) $row['department_id'] : null,
        'departmentDescription' => isset($row['department_description']) && $row['department_description'] !== null ? (string) $row['department_description'] : null,
        'departmentServices'    => decodeJsonStringArray($row['department_services_json'] ?? null),
        'contact'               => $row['contact'] !== null ? (string) $row['contact'] : '',
        'email'                 => $row['email'] !== null ? (string) $row['email'] : '',
        'languages'             => decodeJsonStringArray($row['languages_json'] ?? null),
        'acceptedInsurance'     => decodeJsonStringArray($row['accepted_insurance_json'] ?? null),
        'qualifications'        => $row['qualifications'] !== null ? (string) $row['qualifications'] : '',
        'status'                => (string) ($row['status'] ?? 'active'),
        'consultationFee'       => isset($row['consultation_fee']) ? (float) $row['consultation_fee'] : 0.0,
        'slotMinutes'           => isset($row['slot_minutes']) ? (int) $row['slot_minutes'] : 30,
        'schedule'              => array_values($schedule),
        'createdAt'             => isset($row['created_at']) ? (string) $row['created_at'] : null,
        'updatedAt'             => isset($row['updated_at']) ? (string) $row['updated_at'] : null,
    ];
}

/**
 * Fetch a single doctor by ID (with joined department metadata and weekly schedule).
 *
 * @param PDO    $pdo
 * @param string $id
 * @return array<string, mixed>|null
 */
function findDoctorById(PDO $pdo, string $id): ?array
{
    $stmt = $pdo->prepare(
        'SELECT d.*,
                dept.id AS department_id,
                dept.description AS department_description,
                dept.services_json AS department_services_json
         FROM doctors d
         LEFT JOIN departments dept ON dept.name = d.department
         WHERE d.id = :id
         LIMIT 1'
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        return null;
    }

    $schedule = fetchSchedulesForDoctor($pdo, (string) $row['id']);
    return serializeDoctor($row, $schedule);
}

/**
 * Serialize a `departments` database row into the frontend object shape.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function serializeDepartment(array $row): array
{
    return [
        'id'          => isset($row['id']) ? (int) $row['id'] : null,
        'name'        => (string) ($row['name'] ?? ''),
        'description' => (string) ($row['description'] ?? ''),
        'services'    => decodeJsonStringArray($row['services_json'] ?? null),
    ];
}

/**
 * Resolve a department reference (by department name or numeric departmentId) against `departments`.
 * Returns the canonical department row or null if invalid.
 *
 * @param PDO             $pdo
 * @param string|int|null $deptNameOrId
 * @return array<string, mixed>|null
 */
function resolveDepartment(PDO $pdo, string|int|null $deptNameOrId): ?array
{
    if ($deptNameOrId === null) {
        return null;
    }
    $clean = trim((string) $deptNameOrId);
    if ($clean === '') {
        return null;
    }

    if (ctype_digit($clean)) {
        $stmt = $pdo->prepare('SELECT * FROM departments WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => (int) $clean]);
        $row = $stmt->fetch();
        if (is_array($row)) {
            return serializeDepartment($row);
        }
    }

    $stmt = $pdo->prepare('SELECT * FROM departments WHERE LOWER(name) = LOWER(:name) LIMIT 1');
    $stmt->execute([':name' => $clean]);
    $row = $stmt->fetch();

    return is_array($row) ? serializeDepartment($row) : null;
}

/**
 * Generate 2-character uppercase initials from a doctor's name (stripping leading "Dr." / "Dr").
 */
function computeDoctorInitials(string $name): string
{
    $clean = trim((string) preg_replace('/^Dr\.?\s+/i', '', trim($name)));
    if ($clean === '') {
        return 'DR';
    }
    $parts = preg_split('/\s+/', $clean) ?: [];
    if (count($parts) > 1) {
        $first = mb_substr($parts[0], 0, 1);
        $last  = mb_substr($parts[count($parts) - 1], 0, 1);
        return mb_strtoupper($first . $last);
    }
    return mb_strtoupper(mb_substr($parts[0], 0, 2));
}

/**
 * Validate a list of schedule shift entries for a doctor.
 * Checks:
 *  - valid day_of_week ('Mon'..'Sun')
 *  - valid 24h HH:MM start & end times
 *  - start < end (rejects zero-length or reversed/overnight shifts not supported by schema)
 *  - no duplicate or overlapping shifts on the same day of week
 *
 * Returns normalized array of shifts: [['day' => 'Mon', 'start' => '09:00', 'end' => '17:00'], ...]
 * Calls sendError(..., 400|409) on validation failure.
 *
 * @param array<int, mixed> $scheduleInput
 * @param bool              $requireNonEmpty
 * @return array<int, array{day: string, start: string, end: string}>
 */
function validateScheduleEntries(array $scheduleInput, bool $requireNonEmpty = true): array
{
    if ($requireNonEmpty && count($scheduleInput) === 0) {
        sendError('Please select at least one working day for the doctor schedule.', 400);
    }

    $normalized = [];
    $byDay      = [];

    foreach ($scheduleInput as $idx => $item) {
        if (!is_array($item)) {
            sendError("Schedule entry at index {$idx} must be an object.", 400);
        }

        $dayRaw   = trim((string) ($item['day'] ?? ($item['dayOfWeek'] ?? ($item['day_of_week'] ?? ''))));
        $startRaw = trim((string) ($item['start'] ?? ($item['startTime'] ?? ($item['start_time'] ?? ''))));
        $endRaw   = trim((string) ($item['end'] ?? ($item['endTime'] ?? ($item['end_time'] ?? ''))));

        if (!in_array($dayRaw, PRIMECARE_DAYS_OF_WEEK, true)) {
            sendError("Invalid day of week '{$dayRaw}'. Allowed values: Mon, Tue, Wed, Thu, Fri, Sat, Sun.", 400);
        }

        $start = normalizeTimeInput($startRaw);
        $end   = normalizeTimeInput($endRaw);

        if ($start === null || $end === null) {
            sendError("{$dayRaw}: Start time and end time must be valid 24-hour times (HH:MM).", 400);
        }

        if ($start >= $end) {
            sendError("{$dayRaw}: End time ({$end}) must be after start time ({$start}). Zero-length or overnight shifts are not permitted.", 400);
        }

        // Check overlap or duplicate day against any shift already seen for this day
        if (isset($byDay[$dayRaw])) {
            foreach ($byDay[$dayRaw] as $existing) {
                if ($start < $existing['end'] && $end > $existing['start']) {
                    sendError("{$dayRaw}: Shift {$start}-{$end} overlaps with existing shift {$existing['start']}-{$existing['end']}.", 409);
                }
            }
            // Note: uq_doctor_schedule_day enforces one shift row per (doctor_id, day_of_week) in the schema
            sendError("{$dayRaw}: Only one shift per day of week is supported for a doctor ({$existing['start']}-{$existing['end']} already defined).", 409);
        }

        $entry = [
            'day'   => $dayRaw,
            'start' => $start,
            'end'   => $end,
        ];
        $byDay[$dayRaw][] = $entry;
        $normalized[]     = $entry;
    }

    // Sort in canonical Mon..Sun order
    $dayOrder = array_flip(PRIMECARE_DAYS_OF_WEEK);
    usort($normalized, static fn(array $a, array $b): int => ($dayOrder[$a['day']] ?? 99) <=> ($dayOrder[$b['day']] ?? 99));

    return $normalized;
}

/**
 * Synchronize a doctor's weekly schedule inside an active transaction.
 * Preserves existing `doctor_schedules.id` rows when the day already exists,
 * inserts newly added days, and deletes unselected days.
 *
 * @param PDO                                                       $pdo
 * @param string                                                    $doctorId
 * @param array<int, array{day: string, start: string, end: string}> $validatedSchedule
 */
function syncDoctorSchedules(PDO $pdo, string $doctorId, array $validatedSchedule): void
{
    $existingStmt = $pdo->prepare('SELECT id, day_of_week FROM doctor_schedules WHERE doctor_id = :did FOR UPDATE');
    $existingStmt->execute([':did' => $doctorId]);
    $existingRows = $existingStmt->fetchAll() ?: [];

    $existingByDay = [];
    foreach ($existingRows as $r) {
        $existingByDay[(string) $r['day_of_week']] = (int) $r['id'];
    }

    $keepDays = [];
    $updStmt  = $pdo->prepare('UPDATE doctor_schedules SET start_time = :start, end_time = :end WHERE id = :id');
    $insStmt  = $pdo->prepare('INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (:did, :day, :start, :end)');

    foreach ($validatedSchedule as $shift) {
        $day   = $shift['day'];
        $start = $shift['start'] . ':00';
        $end   = $shift['end'] . ':00';
        $keepDays[] = $day;

        if (isset($existingByDay[$day])) {
            $updStmt->execute([
                ':start' => $start,
                ':end'   => $end,
                ':id'    => $existingByDay[$day],
            ]);
        } else {
            $insStmt->execute([
                ':did'   => $doctorId,
                ':day'   => $day,
                ':start' => $start,
                ':end'   => $end,
            ]);
        }
    }

    // Delete days that were removed from the doctor's schedule
    foreach ($existingByDay as $day => $schedId) {
        if (!in_array($day, $keepDays, true)) {
            $delStmt = $pdo->prepare('DELETE FROM doctor_schedules WHERE id = :id');
            $delStmt->execute([':id' => $schedId]);
        }
    }
}

/**
 * Check if a doctor email is already used by another doctor (case-insensitive).
 */
function isDoctorEmailTaken(PDO $pdo, string $email, ?string $excludeDoctorId = null): bool
{
    $clean = trim($email);
    if ($clean === '') {
        return false;
    }

    if ($excludeDoctorId !== null && $excludeDoctorId !== '') {
        $stmt = $pdo->prepare("SELECT 1 FROM doctors WHERE email IS NOT NULL AND email != '' AND LOWER(email) = LOWER(:e) AND id != :id LIMIT 1");
        $stmt->execute([':e' => $clean, ':id' => $excludeDoctorId]);
    } else {
        $stmt = $pdo->prepare("SELECT 1 FROM doctors WHERE email IS NOT NULL AND email != '' AND LOWER(email) = LOWER(:e) LIMIT 1");
        $stmt->execute([':e' => $clean]);
    }

    return (bool) $stmt->fetch();
}

/**
 * Check if a doctor contact number is already used by another doctor.
 */
function isDoctorContactTaken(PDO $pdo, string $contact, ?string $excludeDoctorId = null): bool
{
    $clean = trim($contact);
    if ($clean === '') {
        return false;
    }

    if ($excludeDoctorId !== null && $excludeDoctorId !== '') {
        $stmt = $pdo->prepare("SELECT 1 FROM doctors WHERE contact IS NOT NULL AND contact != '' AND contact = :c AND id != :id LIMIT 1");
        $stmt->execute([':c' => $clean, ':id' => $excludeDoctorId]);
    } else {
        $stmt = $pdo->prepare("SELECT 1 FROM doctors WHERE contact IS NOT NULL AND contact != '' AND contact = :c LIMIT 1");
        $stmt->execute([':c' => $clean]);
    }

    return (bool) $stmt->fetch();
}
