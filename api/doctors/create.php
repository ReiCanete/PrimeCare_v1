<?php
/**
 * PrimeCare - POST /api/doctors/create.php
 * Phase 5.5: Create a new doctor profile and weekly shift schedule (Admin only).
 *
 * Security & Validation:
 * - Requires authenticated `admin` role + valid CSRF token.
 * - Validates required fields (name, specialization, department/departmentId, contact, schedule).
 * - Verifies department against `departments` table.
 * - Prevents duplicate contact number or email address across doctors.
 * - Validates schedule shifts (valid days, 24h HH:MM, start < end, no overlaps).
 * - Executes inside an atomic database transaction and logs to `audit_logs`.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/doctors.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$admin = requireRole(['admin']);
requireCsrf();

$input = getJsonInput();

$name           = trim((string) ($input['name'] ?? ''));
$specialization = trim((string) ($input['specialization'] ?? ''));
$deptInput      = $input['departmentId'] ?? ($input['department'] ?? null);
$contact        = trim((string) ($input['contact'] ?? ''));
$email          = trim((string) ($input['email'] ?? ''));
$qualifications = trim((string) ($input['qualifications'] ?? ''));
$statusRaw      = strtolower(trim((string) ($input['status'] ?? 'active')));
$feeRaw         = $input['consultationFee'] ?? 0;
$slotRaw        = $input['slotMinutes'] ?? 30;
$userIdInput    = isset($input['userId']) && trim((string) $input['userId']) !== '' ? trim((string) $input['userId']) : null;
$scheduleInput  = is_array($input['schedule'] ?? null) ? $input['schedule'] : [];

if ($name === '' || $specialization === '' || $contact === '') {
    sendError('Doctor Name, Specialization, and Contact Number are required.', 400);
}

if (!preg_match('/^09\d{9}$/', $contact) && !preg_match('/^[\d\-\+\(\)\s]{7,20}$/', $contact)) {
    sendError('Contact number must be a valid phone or Philippine mobile number (e.g., 09171234567).', 400);
}

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendError('Invalid email address format.', 400);
}

// Normalize status against actual database ENUM('active', 'inactive')
if ($statusRaw === 'on-leave') {
    $status = 'inactive';
} elseif (in_array($statusRaw, ['active', 'inactive'], true)) {
    $status = $statusRaw;
} else {
    sendError("Invalid status '{$statusRaw}'. Allowed values: active, inactive.", 400);
}

if (!is_numeric($feeRaw) || (float) $feeRaw < 0 || (float) $feeRaw > 999999.99) {
    sendError('Consultation fee must be a non-negative number.', 400);
}
$consultationFee = round((float) $feeRaw, 2);

$allowedSlotMinutes = [10, 15, 20, 30, 45, 60];
$slotMinutes        = is_numeric($slotRaw) ? (int) $slotRaw : 30;
if (!in_array($slotMinutes, $allowedSlotMinutes, true)) {
    sendError('Slot duration must be 10, 15, 20, 30, 45, or 60 minutes.', 400);
}

$languages         = decodeJsonStringArray($input['languages'] ?? []);
$acceptedInsurance = decodeJsonStringArray($input['acceptedInsurance'] ?? []);

$validatedSchedule = validateScheduleEntries($scheduleInput, true);

$pdo = getDatabaseConnection();

// Validate department against `departments` table
$dept = resolveDepartment($pdo, is_scalar($deptInput) ? (string) $deptInput : null);
if ($dept === null) {
    sendError('Please select a valid hospital department.', 400);
}

// Check duplicate contact or email
if (isDoctorContactTaken($pdo, $contact)) {
    sendError('Contact number is already assigned to another doctor.', 409);
}
if ($email !== '' && isDoctorEmailTaken($pdo, $email)) {
    sendError('Email address is already assigned to another doctor.', 409);
}

// Optional user_id linkage validation
if ($userIdInput !== null) {
    $uStmt = $pdo->prepare("SELECT id, role FROM users WHERE id = :uid LIMIT 1");
    $uStmt->execute([':uid' => $userIdInput]);
    $uRow = $uStmt->fetch();
    if (!is_array($uRow)) {
        sendError('Linked user account does not exist.', 400);
    }
    $linkCheck = $pdo->prepare('SELECT id FROM doctors WHERE user_id = :uid LIMIT 1');
    $linkCheck->execute([':uid' => $userIdInput]);
    if ($linkCheck->fetch()) {
        sendError('That user account is already linked to another doctor profile.', 409);
    }
}

$photoInitials = computeDoctorInitials($name);

$pdo->beginTransaction();
try {
    $doctorId = allocateNextId($pdo, 'doctors', 'doctors', 'D', 3);

    $stmt = $pdo->prepare(
        'INSERT INTO doctors (
            id, user_id, name, photo_initials, specialization, department,
            contact, email, languages_json, accepted_insurance_json,
            qualifications, status, consultation_fee, slot_minutes
        ) VALUES (
            :id, :user_id, :name, :initials, :spec, :dept,
            :contact, :email, :lang_json, :ins_json,
            :qual, :status, :fee, :slot_mins
        )'
    );

    $stmt->execute([
        ':id'        => $doctorId,
        ':user_id'   => $userIdInput,
        ':name'      => mb_substr($name, 0, 150),
        ':initials'  => mb_substr($photoInitials, 0, 10),
        ':spec'      => mb_substr($specialization, 0, 100),
        ':dept'      => mb_substr((string) $dept['name'], 0, 100),
        ':contact'   => mb_substr($contact, 0, 20),
        ':email'     => $email !== '' ? mb_substr($email, 0, 150) : null,
        ':lang_json' => json_encode($languages, JSON_UNESCAPED_UNICODE),
        ':ins_json'  => json_encode($acceptedInsurance, JSON_UNESCAPED_UNICODE),
        ':qual'      => $qualifications !== '' ? mb_substr($qualifications, 0, 150) : null,
        ':status'    => $status,
        ':fee'       => $consultationFee,
        ':slot_mins' => $slotMinutes,
    ]);

    syncDoctorSchedules($pdo, $doctorId, $validatedSchedule);

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

writeAuthAuditLog($admin['id'], $admin['username'], 'Create Doctor', "Created doctor {$doctorId} ({$name}, {$dept['name']})");

$created = findDoctorById($pdo, $doctorId);
sendSuccess('Doctor created successfully.', ['doctor' => $created], 201);

