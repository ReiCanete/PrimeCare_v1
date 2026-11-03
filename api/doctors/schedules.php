<?php
/**
 * PrimeCare - GET & POST /api/doctors/schedules.php
 * Phase 5.5: Dedicated Doctor Scheduling Backend Endpoint
 *
 * GET /api/doctors/schedules.php
 *   Query params:
 *     - doctorId (optional): Filter schedules by doctor ID (e.g., D-001)
 *     - day / dayOfWeek (optional): Filter schedules by day of week (Mon..Sun)
 *   Permissions: Any authenticated user (patient, staff, nurse, doctor, admin).
 *
 * POST /api/doctors/schedules.php
 *   JSON body actions (Admin only + CSRF required):
 *     1. `action = 'create'` (default if `id` is omitted and `action` is omitted):
 *        `{ action: 'create', doctorId: 'D-001', day: 'Sun', start: '09:00', end: '17:00' }`
 *        Validates doctor existence/status, day of week, start < end, and rejects overlapping/duplicate day shifts (409).
 *     2. `action = 'update'` (or when `id` is provided):
 *        `{ action: 'update', id: 15, doctorId: 'D-003', day: 'Mon', start: '09:00', end: '16:00' }`
 *        Preserves `doctor_schedules.id`, validates ownership, times, and conflict rules.
 *     3. `action = 'delete'`:
 *        `{ action: 'delete', id: 15, doctorId: 'D-003' }` (or `{ action: 'delete', doctorId: 'D-003', day: 'Fri' }`)
 *        Prevents removing a doctor's last remaining working day for an active doctor unless forced or doctor is inactive,
 *        and preserves historical appointment data (appointments store their own date & time on `appointments`).
 *     4. `action = 'sync'`:
 *        `{ action: 'sync', doctorId: 'D-001', schedule: [{ day: 'Mon', start: '09:00', end: '17:00' }, ...] }`
 *        Atomically synchronizes a doctor's full weekly schedule while preserving existing schedule IDs.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/doctors.php';

registerApiErrorHandlers();
requireMethod(['GET', 'POST']);

$pdo    = getDatabaseConnection();
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($method === 'GET') {
    $user     = requireAuth();
    $doctorId = strtoupper(trim((string) ($_GET['doctorId'] ?? ($_GET['doctor_id'] ?? ''))));
    $day      = trim((string) ($_GET['day'] ?? ($_GET['dayOfWeek'] ?? ($_GET['day_of_week'] ?? ''))));

    $where  = [];
    $params = [];

    if ($doctorId !== '') {
        if (!preg_match('/^D-\d{3,}$/i', $doctorId)) {
            sendError('Invalid Doctor ID format.', 400);
        }
        $docCheck = $pdo->prepare('SELECT id, status FROM doctors WHERE id = :did LIMIT 1');
        $docCheck->execute([':did' => $doctorId]);
        $docRow = $docCheck->fetch();
        if (!is_array($docRow)) {
            sendError('Doctor not found.', 404);
        }
        $where[]        = 's.doctor_id = :did';
        $params[':did'] = $doctorId;
    } elseif (($user['role'] ?? '') === 'patient') {
        // Patients listing all schedules only see active doctors' schedules
        $where[] = "d.status = 'active'";
    }

    if ($day !== '' && strtolower($day) !== 'all') {
        if (!in_array($day, PRIMECARE_DAYS_OF_WEEK, true)) {
            sendError("Invalid day of week '{$day}'. Allowed values: Mon, Tue, Wed, Thu, Fri, Sat, Sun.", 400);
        }
        $where[]        = 's.day_of_week = :day';
        $params[':day'] = $day;
    }

    $sql = "SELECT s.id, s.doctor_id, s.day_of_week, s.start_time, s.end_time,
                   d.name AS doctor_name, d.specialization, d.department, d.status AS doctor_status, d.slot_minutes
            FROM doctor_schedules s
            INNER JOIN doctors d ON d.id = s.doctor_id";

    if ($where !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= " ORDER BY s.doctor_id ASC, FIELD(s.day_of_week, 'Mon','Tue','Wed','Thu','Fri','Sat','Sun'), s.start_time ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll() ?: [];

    $schedules = array_map(static function (array $r): array {
        $item = serializeDoctorScheduleRow($r);
        $item['doctorName']     = (string) ($r['doctor_name'] ?? '');
        $item['specialization'] = (string) ($r['specialization'] ?? '');
        $item['department']     = (string) ($r['department'] ?? '');
        $item['doctorStatus']   = (string) ($r['doctor_status'] ?? 'active');
        $item['slotMinutes']    = isset($r['slot_minutes']) ? (int) $r['slot_minutes'] : 30;
        return $item;
    }, $rows);

    sendSuccess('Doctor schedules retrieved successfully.', [
        'schedules' => $schedules,
        'count'     => count($schedules),
    ]);
}

// POST: State-changing schedule operations (Admin only + CSRF required)
requireJsonContentType();
$admin = requireRole(['admin']);
requireCsrf();

$input    = getJsonInput();
$action   = strtolower(trim((string) ($input['action'] ?? '')));
$schedId  = isset($input['id']) && $input['id'] !== '' ? (int) $input['id'] : null;
$doctorId = strtoupper(trim((string) ($input['doctorId'] ?? ($input['doctor_id'] ?? ''))));

if ($action === '') {
    if (isset($input['schedule']) && is_array($input['schedule'])) {
        $action = 'sync';
    } elseif ($schedId !== null && $schedId > 0) {
        $action = 'update';
    } else {
        $action = 'create';
    }
}

if (!in_array($action, ['create', 'update', 'delete', 'sync'], true)) {
    sendError("Invalid schedule action '{$action}'. Allowed actions: create, update, delete, sync.", 400);
}

// Action: Bulk weekly schedule sync for a doctor
if ($action === 'sync') {
    if ($doctorId === '' || !preg_match('/^D-\d{3,}$/i', $doctorId)) {
        sendError('A valid Doctor ID is required.', 400);
    }
    $doc = findDoctorById($pdo, $doctorId);
    if ($doc === null) {
        sendError('Doctor not found.', 404);
    }

    $scheduleInput     = is_array($input['schedule'] ?? null) ? $input['schedule'] : [];
    $validatedSchedule = validateScheduleEntries($scheduleInput, true);

    $pdo->beginTransaction();
    try {
        syncDoctorSchedules($pdo, $doctorId, $validatedSchedule);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    writeAuthAuditLog($admin['id'], $admin['username'], 'Update Schedule', "Synchronized weekly schedule for {$doctorId}");
    $updatedSchedules = fetchSchedulesForDoctor($pdo, $doctorId);

    sendSuccess('Doctor schedule synchronized successfully.', [
        'doctorId'  => $doctorId,
        'schedules' => $updatedSchedules,
    ]);
}

// Action: Create a single schedule shift
if ($action === 'create') {
    if ($doctorId === '' || !preg_match('/^D-\d{3,}$/i', $doctorId)) {
        sendError('A valid Doctor ID is required.', 400);
    }

    $docStmt = $pdo->prepare('SELECT id, name, status FROM doctors WHERE id = :did LIMIT 1');
    $docStmt->execute([':did' => $doctorId]);
    $docRow = $docStmt->fetch();
    if (!is_array($docRow)) {
        sendError('Doctor not found.', 404);
    }

    $validated = validateScheduleEntries([$input], true)[0];
    $day       = $validated['day'];
    $start     = $validated['start'];
    $end       = $validated['end'];

    $pdo->beginTransaction();
    try {
        // Check for existing shifts on the same day for this doctor
        $confStmt = $pdo->prepare(
            'SELECT id, start_time, end_time
             FROM doctor_schedules
             WHERE doctor_id = :did AND day_of_week = :day
             FOR UPDATE'
        );
        $confStmt->execute([':did' => $doctorId, ':day' => $day]);
        $existingShifts = $confStmt->fetchAll() ?: [];

        foreach ($existingShifts as $ex) {
            $exStart = formatScheduleTime((string) $ex['start_time']);
            $exEnd   = formatScheduleTime((string) $ex['end_time']);
            if ($start < $exEnd && $end > $exStart) {
                $pdo->rollBack();
                sendError("{$day}: Shift {$start}-{$end} overlaps with existing shift {$exStart}-{$exEnd} for {$doctorId}.", 409);
            }
            $pdo->rollBack();
            sendError("{$day}: A schedule shift ({$exStart}-{$exEnd}) already exists for {$doctorId} on {$day}. Use update instead.", 409);
        }

        $insStmt = $pdo->prepare(
            'INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
             VALUES (:did, :day, :start, :end)'
        );
        $insStmt->execute([
            ':did'   => $doctorId,
            ':day'   => $day,
            ':start' => $start . ':00',
            ':end'   => $end . ':00',
        ]);
        $newId = (int) $pdo->lastInsertId();

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    writeAuthAuditLog($admin['id'], $admin['username'], 'Create Schedule', "Added {$day} ({$start}-{$end}) schedule for {$doctorId}");

    $createdRow = [
        'id'          => $newId,
        'doctor_id'   => $doctorId,
        'day_of_week' => $day,
        'start_time'  => $start . ':00',
        'end_time'    => $end . ':00',
    ];

    sendSuccess('Schedule created successfully.', [
        'schedule'  => serializeDoctorScheduleRow($createdRow),
        'schedules' => fetchSchedulesForDoctor($pdo, $doctorId),
    ], 201);
}

// Action: Update an existing schedule shift (preserving schedule ID)
if ($action === 'update') {
    if ($schedId === null || $schedId <= 0) {
        sendError('A valid schedule ID is required for update.', 400);
    }

    $sStmt = $pdo->prepare('SELECT * FROM doctor_schedules WHERE id = :id LIMIT 1');
    $sStmt->execute([':id' => $schedId]);
    $existingRow = $sStmt->fetch();
    if (!is_array($existingRow)) {
        sendError('Schedule not found.', 404);
    }

    $ownerDoctorId = (string) $existingRow['doctor_id'];
    if ($doctorId !== '' && strcasecmp($doctorId, $ownerDoctorId) !== 0) {
        sendError('Schedule ownership mismatch: schedule does not belong to the specified doctor.', 400);
    }

    $mergedInput = [
        'day'   => $input['day'] ?? ($input['dayOfWeek'] ?? ($input['day_of_week'] ?? $existingRow['day_of_week'])),
        'start' => $input['start'] ?? ($input['startTime'] ?? ($input['start_time'] ?? formatScheduleTime((string) $existingRow['start_time']))),
        'end'   => $input['end'] ?? ($input['endTime'] ?? ($input['end_time'] ?? formatScheduleTime((string) $existingRow['end_time']))),
    ];

    $validated = validateScheduleEntries([$mergedInput], true)[0];
    $day       = $validated['day'];
    $start     = $validated['start'];
    $end       = $validated['end'];

    $pdo->beginTransaction();
    try {
        // Check conflicts with other shifts for the same doctor on the target day
        $confStmt = $pdo->prepare(
            'SELECT id, start_time, end_time
             FROM doctor_schedules
             WHERE doctor_id = :did AND day_of_week = :day AND id != :id
             FOR UPDATE'
        );
        $confStmt->execute([
            ':did' => $ownerDoctorId,
            ':day' => $day,
            ':id'  => $schedId,
        ]);
        $otherShifts = $confStmt->fetchAll() ?: [];

        foreach ($otherShifts as $other) {
            $oStart = formatScheduleTime((string) $other['start_time']);
            $oEnd   = formatScheduleTime((string) $other['end_time']);
            if ($start < $oEnd && $end > $oStart) {
                $pdo->rollBack();
                sendError("{$day}: Shift {$start}-{$end} overlaps with another shift ({$oStart}-{$oEnd}) for {$ownerDoctorId}.", 409);
            }
            $pdo->rollBack();
            sendError("{$day}: Another shift already exists on {$day} for {$ownerDoctorId}.", 409);
        }

        $updStmt = $pdo->prepare(
            'UPDATE doctor_schedules
             SET day_of_week = :day, start_time = :start, end_time = :end
             WHERE id = :id'
        );
        $updStmt->execute([
            ':day'   => $day,
            ':start' => $start . ':00',
            ':end'   => $end . ':00',
            ':id'    => $schedId,
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    writeAuthAuditLog($admin['id'], $admin['username'], 'Update Schedule', "Updated schedule #{$schedId} for {$ownerDoctorId} -> {$day} ({$start}-{$end})");

    $updatedRow = [
        'id'          => $schedId,
        'doctor_id'   => $ownerDoctorId,
        'day_of_week' => $day,
        'start_time'  => $start . ':00',
        'end_time'    => $end . ':00',
    ];

    sendSuccess('Schedule updated successfully.', [
        'schedule'  => serializeDoctorScheduleRow($updatedRow),
        'schedules' => fetchSchedulesForDoctor($pdo, $ownerDoctorId),
    ]);
}

// Action: Delete / remove a schedule shift
if ($action === 'delete') {
    $targetRow = null;
    if ($schedId !== null && $schedId > 0) {
        $sStmt = $pdo->prepare('SELECT * FROM doctor_schedules WHERE id = :id LIMIT 1');
        $sStmt->execute([':id' => $schedId]);
        $targetRow = $sStmt->fetch();
    } elseif ($doctorId !== '' && isset($input['day'])) {
        $day = trim((string) $input['day']);
        $sStmt = $pdo->prepare('SELECT * FROM doctor_schedules WHERE doctor_id = :did AND day_of_week = :day LIMIT 1');
        $sStmt->execute([':did' => $doctorId, ':day' => $day]);
        $targetRow = $sStmt->fetch();
    }

    if (!is_array($targetRow)) {
        sendError('Schedule not found.', 404);
    }

    $ownerDoctorId = (string) $targetRow['doctor_id'];
    if ($doctorId !== '' && strcasecmp($doctorId, $ownerDoctorId) !== 0) {
        sendError('Schedule ownership mismatch: schedule does not belong to the specified doctor.', 400);
    }

    $targetId  = (int) $targetRow['id'];
    $targetDay = (string) $targetRow['day_of_week'];

    // Ensure an active doctor retains at least 1 working day unless allowEmpty is explicitly passed
    $countStmt = $pdo->prepare('SELECT COUNT(*) FROM doctor_schedules WHERE doctor_id = :did');
    $countStmt->execute([':did' => $ownerDoctorId]);
    $remainingCount = (int) $countStmt->fetchColumn();

    $allowEmpty = !empty($input['allowEmpty']);
    if ($remainingCount <= 1 && !$allowEmpty) {
        sendError('Cannot remove the last remaining working day for a doctor. Add another shift first or set the doctor to Inactive.', 400);
    }

    $delStmt = $pdo->prepare('DELETE FROM doctor_schedules WHERE id = :id');
    $delStmt->execute([':id' => $targetId]);

    writeAuthAuditLog($admin['id'], $admin['username'], 'Delete Schedule', "Removed {$targetDay} schedule (#{$targetId}) for {$ownerDoctorId}");

    sendSuccess('Schedule removed successfully.', [
        'deletedId' => $targetId,
        'doctorId'  => $ownerDoctorId,
        'schedules' => fetchSchedulesForDoctor($pdo, $ownerDoctorId),
    ]);
}

