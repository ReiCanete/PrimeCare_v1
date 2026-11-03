<?php
/**
 * PrimeCare - POST /api/patients/register.php
 * Phase 5.3.2: Public patient self-registration (`register.html`)
 *
 * Atomically creates:
 * 1. A `users` row (`role = 'patient'`, `status = 'pending'`, bcrypt `password_hash`)
 * 2. A linked `patients` row (`user_id = U-XXX`, `status = 'pending'`)
 *
 * Until verified by hospital staff (`api/patients/verify.php`), the account remains
 * `pending` and cannot log in (Phase 5.2 strict rule).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/patients.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

startApiSession(true);
requireCsrf();

$input = getJsonInput();

$firstName   = trim((string) ($input['firstName'] ?? ''));
$middleName  = trim((string) ($input['middleName'] ?? ''));
$lastName    = trim((string) ($input['lastName'] ?? ''));
$suffix      = trim((string) ($input['suffix'] ?? ''));
$birthdate   = trim((string) ($input['birthdate'] ?? ''));
$sex         = trim((string) ($input['sex'] ?? ''));
$civilStatus = trim((string) ($input['civilStatus'] ?? ''));

$mobile   = trim((string) ($input['mobile'] ?? ''));
$email    = trim((string) ($input['email'] ?? ''));
$street   = trim((string) ($input['street'] ?? ''));
$barangay = trim((string) ($input['brgy'] ?? ($input['barangay'] ?? '')));
$city     = trim((string) ($input['city'] ?? ''));
$province = trim((string) ($input['province'] ?? ''));
$address  = trim((string) ($input['address'] ?? ''));

if ($address === '' && ($street !== '' || $barangay !== '' || $city !== '' || $province !== '')) {
    $address = implode(', ', array_filter([$street, $barangay, $city, $province], static fn($v) => $v !== ''));
}

$idType   = trim((string) ($input['idType'] ?? ''));
$idNumber = trim((string) ($input['idNumber'] ?? ''));
$emName   = trim((string) ($input['emergencyContactName'] ?? ''));
$emNum    = trim((string) ($input['emergencyContactNumber'] ?? ''));
$emRel    = trim((string) ($input['emergencyContactRelationship'] ?? ''));

$username = trim((string) ($input['username'] ?? ''));
$password = (string) ($input['password'] ?? '');

// Validate required fields
if ($firstName === '' || $lastName === '' || $birthdate === '' || $sex === '' || $civilStatus === '') {
    sendError('Personal information fields are required.', 400);
}
if (!isValidDateString($birthdate, true)) {
    sendError('Birthdate must be a valid past date.', 400);
}

// Enforce 18+ age rule for online self-registration
$dobObj = new DateTimeImmutable($birthdate);
$age    = $dobObj->diff(new DateTimeImmutable('today'))->y;
if ($age < 18) {
    sendError('Must be 18 or older. Minors must be registered by a guardian at the hospital.', 400);
}

if (!in_array($sex, ['Male', 'Female', 'Other'], true)) {
    sendError('Invalid sex selection.', 400);
}
if (!preg_match('/^09\d{9}$/', $mobile)) {
    sendError('Must be a valid Philippine mobile number (09XXXXXXXXX).', 400);
}
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendError('A valid email address is required.', 400);
}
if ($street === '' || $barangay === '' || $city === '' || $province === '') {
    sendError('Complete address (Street, Barangay, City, Province) is required.', 400);
}
if ($idType === '' || $idNumber === '') {
    sendError('Valid National ID type and number are required.', 400);
}
if ($emName === '' || $emNum === '' || $emRel === '') {
    sendError('Emergency contact details are required.', 400);
}
if (!preg_match('/^[a-zA-Z0-9_]{4,20}$/', $username)) {
    sendError('Username must be 4-20 characters (letters, numbers, underscore only).', 400);
}
if (!preg_match('/^(?=.*[A-Z])(?=.*\d).{8,}$/', $password)) {
    sendError('Password must be at least 8 characters with 1 uppercase letter and 1 number.', 400);
}

$pdo = getDatabaseConnection();

if (isUsernameTakenInDb($pdo, $username)) {
    sendError('Username is already taken.', 409);
}
if (isEmailTakenInDb($pdo, $email)) {
    sendError('Email address is already registered.', 409);
}
if (isMobileTakenInDb($pdo, $mobile)) {
    sendError('Mobile number is already registered.', 409);
}
if (isNationalIdTakenInDb($pdo, $idType, $idNumber)) {
    sendError('This National ID is already registered.', 409);
}

$fullName     = trim($firstName . ' ' . $lastName);
$today        = date('Y-m-d');
$passwordHash = password_hash($password, PASSWORD_DEFAULT);

$pdo->beginTransaction();
try {
    $userId    = allocateNextId($pdo, 'users', 'users', 'U', 3);
    $patientId = allocateNextId($pdo, 'patients', 'patients', 'P', 3);

    $userStmt = $pdo->prepare(
        "INSERT INTO users (
            id, username, password_hash, full_name, role, status,
            email, mobile, must_change_password, last_login, created_by, created_at
        ) VALUES (
            :id, :username, :password_hash, :full_name, 'patient', 'pending',
            :email, :mobile, 0, NULL, NULL, :created_at
        )"
    );
    $userStmt->execute([
        ':id'            => $userId,
        ':username'      => $username,
        ':password_hash' => $passwordHash,
        ':full_name'     => mb_substr($fullName, 0, 150),
        ':email'         => mb_substr($email, 0, 150),
        ':mobile'        => mb_substr($mobile, 0, 20),
        ':created_at'    => $today,
    ]);

    $patStmt = $pdo->prepare(
        "INSERT INTO patients (
            id, user_id, first_name, middle_name, last_name, suffix, full_name,
            birthdate, sex, civil_status,
            street, barangay, city, province, address,
            mobile, email,
            emergency_contact_name, emergency_contact_number, emergency_contact_relationship,
            id_type, id_number,
            admit_type, date_admitted,
            status, verified_by, verified_at, rejection_reason,
            blood_type, allergies, medical_conditions,
            insurance_provider, insurance_number,
            assigned_doctor_id, ward, bed_number, notes, created_at
        ) VALUES (
            :id, :user_id, :first_name, :middle_name, :last_name, :suffix, :full_name,
            :birthdate, :sex, :civil_status,
            :street, :barangay, :city, :province, :address,
            :mobile, :email,
            :em_name, :em_num, :em_rel,
            :id_type, :id_number,
            'Outpatient', :date_admitted,
            'pending', NULL, NULL, NULL,
            NULL, NULL, NULL,
            NULL, NULL,
            NULL, '', '', 'Self-registered online; awaiting staff verification.', :created_at
        )"
    );
    $patStmt->execute([
        ':id'            => $patientId,
        ':user_id'       => $userId,
        ':first_name'    => mb_substr($firstName, 0, 100),
        ':middle_name'   => mb_substr($middleName, 0, 100),
        ':last_name'     => mb_substr($lastName, 0, 100),
        ':suffix'        => mb_substr($suffix, 0, 20),
        ':full_name'     => mb_substr($fullName, 0, 255),
        ':birthdate'     => $birthdate,
        ':sex'           => $sex,
        ':civil_status'  => mb_substr($civilStatus, 0, 30),
        ':street'        => mb_substr($street, 0, 150),
        ':barangay'      => mb_substr($barangay, 0, 100),
        ':city'          => mb_substr($city, 0, 100),
        ':province'      => mb_substr($province, 0, 100),
        ':address'       => mb_substr($address, 0, 500),
        ':mobile'        => mb_substr($mobile, 0, 20),
        ':email'         => mb_substr($email, 0, 150),
        ':em_name'       => mb_substr($emName, 0, 150),
        ':em_num'        => mb_substr($emNum, 0, 20),
        ':em_rel'        => mb_substr($emRel, 0, 50),
        ':id_type'       => mb_substr($idType, 0, 80),
        ':id_number'     => mb_substr($idNumber, 0, 80),
        ':date_admitted' => $today,
        ':created_at'    => $today,
    ]);

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

writeAuthAuditLog($userId, $username, 'Self-Register Patient', "Online patient registration {$patientId} ({$fullName}) pending verification.");

$created = findPatientById($pdo, $patientId);
sendSuccess('Registration submitted! Your account is pending staff verification.', ['patient' => $created], 201);

