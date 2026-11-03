<?php
/**
 * PrimeCare - POST /api/doctors/update.php
 * Phase 5.5: Update an existing doctor profile, weekly schedule, or active/inactive status (Admin only).
 *
 * Supports:
 * - Full edit submission from Doctor Management modal.
 * - Partial / status-only updates (`{ id, status: 'inactive' | 'active' }`) for deactivation/reactivation.
 * - Preserves doctor ID, historical appointments, medical records, prescriptions, labs, and admissions.
 * - Logs important changes to `audit_logs`.
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

// Merge submitted fields with existing values so partial updates (e.g. status toggle) work cleanly
$name           = array_key_exists('name', $input) ? trim((string) $input['name']) : (string) $existing['name'];
$specialization = array_key_exists('specialization', $input) ? trim((string) $input['specialization']) : (string) $existing['specialization'];
$deptInput      = $input['departmentId'] ?? ($input['department'] ?? $existing['department']);
$contact        = array_key_exists('contact', $input) ? trim((string) $input['contact']) : (string) $existing['contact'];
$email          = array_key_exists('email', $input) ? trim((string) $input['email']) : (string) $existing['email'];
$qualifications = array_key_exists('qualifications', $input) ? trim((string) $input['qualifications']) : (string) $existing['qualifications'];
$statusRaw      = array_key_exists('status', $input) ? strtolower(trim((string) $input['status'])) : strtolower((string) $existing['status']);
$feeRaw         = array_key_exists('consultationFee', $input) ? $input['consultationFee'] : $existing['consultationFee'];
$slotRaw        = array_key_exists('slotMinutes', $input) ? $input['slotMinutes'] : $existing['slotMinutes'];
$userIdInput    = array_key_exists('userId', $input)
    ? (trim((string) $input['userId']) !== '' ? trim((string) $input['userId']) : null)
    : $existing['userId'];

if ($name === '' || $specialization === '' || $contact === '') {
    sendError('Doctor Name, Specialization, and Contact Number are required.', 400);
}

if (!preg_match('/^09\d{9}$/', $contact) && !preg_match('/^[\d\-\+\(\)\s]{7,20}$/', $contact)) {
    sendError('Contact number must be a valid phone or Philippine mobile number (e.g., 09171234567).', 400);
}

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendError('Invalid email address format.', 400);
}

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

$languages         = array_key_exists('languages', $input) ? decodeJsonStringArray($input['languages']) : $existing['languages'];
$acceptedInsurance = array_key_exists('acceptedInsurance', $input) ? decodeJsonStringArray($input['acceptedInsurance']) : $existing['acceptedInsurance'];

$hasScheduleUpdate = array_key_exists('schedule', $input) && is_array($input['schedule']);
$validatedSchedule = $hasScheduleUpdate ? validateScheduleEntries($input['schedule'], true) : [];

// Validate department reference
$dept = resolveDepartment($pdo, is_scalar($deptInput) ? (string) $deptInput : null);
if ($dept === null) {
    sendError('Please select a valid hospital department.', 400);
}

// Check duplicate contact or email excluding current doctor
if (isDoctorContactTaken($pdo, $contact, $id)) {
    sendError('Contact number is already assigned to another doctor.', 409);
}
if ($email !== '' && isDoctorEmailTaken($pdo, $email, $id)) {
    sendError('Email address is already assigned to another doctor.', 409);
}

if ($userIdInput !== null) {
    $uStmt = $pdo->prepare('SELECT id FROM users WHERE id = :uid LIMIT 1');
    $uStmt->execute([':uid' => $userIdInput]);
    if (!$uStmt->fetch()) {
        sendError('Linked user account does not exist.', 400);
    }
    $linkCheck = $pdo->prepare('SELECT id FROM doctors WHERE user_id = :uid AND id != :did LIMIT 1');
    $linkCheck->execute([':uid' => $userIdInput, ':did' => $id]);
    if ($linkCheck->fetch()) {
        sendError('That user account is already linked to another doctor profile.', 409);
    }
}

$photoInitials = computeDoctorInitials($name);

$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare(
        'UPDATE doctors SET
            user_id = :user_id,
            name = :name,
            photo_initials = :initials,
            specialization = :spec,
            department = :dept,
            contact = :contact,
            email = :email,
            languages_json = :lang_json,
            accepted_insurance_json = :ins_json,
            qualifications = :qual,
            status = :status,
            consultation_fee = :fee,
            slot_minutes = :slot_mins
         WHERE id = :id'
    );

    $stmt->execute([
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
        ':id'        => $id,
    ]);

    if ($hasScheduleUpdate) {
        syncDoctorSchedules($pdo, $id, $validatedSchedule);
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

// Count upcoming appointments if doctor was deactivated so admin receives a clear warning note
$upcomingAppointments = 0;
if ($status === 'inactive') {
    $apptStmt = $pdo->prepare(
        "SELECT COUNT(*) FROM appointments
         WHERE doctor_id = :did
           AND status IN ('Pending', 'Confirmed')
           AND appointment_date >= CURDATE()"
    );
    $apptStmt->execute([':did' => $id]);
    $upcomingAppointments = (int) $apptStmt->fetchColumn();
}

$auditAction = ($existing['status'] !== $status)
    ? ($status === 'inactive' ? 'Deactivate Doctor' : 'Activate Doctor')
    : 'Update Doctor';
writeAuthAuditLog($admin['id'], $admin['username'], $auditAction, "Updated doctor {$id} ({$name}) [status={$status}]");

$updated = findDoctorById($pdo, $id);
$message = 'Doctor saved successfully.';
if ($existing['status'] !== $status) {
    $message = $status === 'inactive'
        ? 'Doctor deactivated successfully. Historical appointments and clinical records are preserved.'
        : 'Doctor reactivated successfully.';
}

sendSuccess($message, [
    'doctor'               => $updated,
    'upcomingAppointments' => $upcomingAppointments,
]);

