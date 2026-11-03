<?php
/**
 * PrimeCare - POST /api/patients/create.php
 * Phase 5.3.2: Walk-in / hospital intake patient registration by Staff or Admin
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/patients.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$staff = requireRole(['admin', 'staff']);
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

$emName = trim((string) ($input['emergencyContactName'] ?? ''));
$emNum  = trim((string) ($input['emergencyContactNumber'] ?? ''));
$emRel  = trim((string) ($input['emergencyContactRelationship'] ?? ''));

$admitType        = trim((string) ($input['admitType'] ?? 'Outpatient')) ?: 'Outpatient';
$dateAdmitted     = trim((string) ($input['dateAdmitted'] ?? date('Y-m-d'))) ?: date('Y-m-d');
$assignedDoctorId = trim((string) ($input['assignedDoctorId'] ?? ''));
$ward             = trim((string) ($input['ward'] ?? ''));
$bedNumber        = trim((string) ($input['bedNumber'] ?? ''));

$bloodType         = trim((string) ($input['bloodType'] ?? ''));
$allergies         = trim((string) ($input['allergies'] ?? ''));
$medicalConditions = trim((string) ($input['medicalConditions'] ?? ''));
$insuranceProvider = trim((string) ($input['insuranceProvider'] ?? ''));
$insuranceNumber   = trim((string) ($input['insuranceNumber'] ?? ''));
$idType            = trim((string) ($input['idType'] ?? ''));
$idNumber          = trim((string) ($input['idNumber'] ?? ''));
$notes             = trim((string) ($input['notes'] ?? ''));

// Server-side validation
if ($firstName === '' || $lastName === '' || $birthdate === '' || $sex === '' || $civilStatus === '') {
    sendError('Personal information fields (First Name, Last Name, Birthdate, Sex, Civil Status) are required.', 400);
}
if (!isValidDateString($birthdate, true)) {
    sendError('Birthdate must be a valid past or present date (YYYY-MM-DD).', 400);
}
if (!in_array($sex, ['Male', 'Female', 'Other'], true)) {
    sendError('Invalid sex selection.', 400);
}
if ($mobile === '' || !preg_match('/^09\d{9}$/', $mobile)) {
    sendError('Mobile number must be a valid Philippine mobile number (09XXXXXXXXX).', 400);
}
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendError('Invalid email address format.', 400);
}
if ($address === '' || $street === '' || $barangay === '' || $city === '' || $province === '') {
    sendError('Complete address (Street, Barangay, City, Province) is required.', 400);
}
if ($emName === '' || $emNum === '' || $emRel === '') {
    sendError('Emergency contact name, number, and relationship are required.', 400);
}
if (!in_array($admitType, ['Outpatient', 'Inpatient'], true)) {
    sendError('Invalid admission type.', 400);
}
if ($admitType === 'Inpatient' && $ward === '') {
    sendError('Ward is required for Inpatient admission.', 400);
}
if (!isValidDateString($dateAdmitted, true)) {
    sendError('Date admitted must be a valid date not in the future.', 400);
}

$pdo = getDatabaseConnection();

if (isMobileTakenInDb($pdo, $mobile)) {
    sendError('Mobile number is already registered.', 409);
}
if ($email !== '' && isEmailTakenInDb($pdo, $email)) {
    sendError('Email address is already registered.', 409);
}
if ($idType !== '' && $idNumber !== '' && isNationalIdTakenInDb($pdo, $idType, $idNumber)) {
    sendError('This National ID is already registered.', 409);
}

if ($assignedDoctorId !== '') {
    $docCheck = $pdo->prepare('SELECT 1 FROM doctors WHERE id = :id LIMIT 1');
    $docCheck->execute([':id' => $assignedDoctorId]);
    if (!$docCheck->fetch()) {
        $assignedDoctorId = '';
    }
}

$fullName = trim($firstName . ' ' . $lastName);
$today    = date('Y-m-d');

$pdo->beginTransaction();
try {
    $patientId = allocateNextId($pdo, 'patients', 'patients', 'P', 3);

    $stmt = $pdo->prepare(
        'INSERT INTO patients (
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
            :id, NULL, :first_name, :middle_name, :last_name, :suffix, :full_name,
            :birthdate, :sex, :civil_status,
            :street, :barangay, :city, :province, :address,
            :mobile, :email,
            :em_name, :em_num, :em_rel,
            :id_type, :id_number,
            :admit_type, :date_admitted,
            \'verified\', :verified_by, :verified_at, NULL,
            :blood_type, :allergies, :medical_conditions,
            :insurance_provider, :insurance_number,
            :assigned_doctor_id, :ward, :bed_number, :notes, :created_at
        )'
    );

    $stmt->execute([
        ':id'                 => $patientId,
        ':first_name'         => mb_substr($firstName, 0, 100),
        ':middle_name'        => mb_substr($middleName, 0, 100),
        ':last_name'          => mb_substr($lastName, 0, 100),
        ':suffix'             => mb_substr($suffix, 0, 20),
        ':full_name'          => mb_substr($fullName, 0, 255),
        ':birthdate'          => $birthdate,
        ':sex'                => $sex,
        ':civil_status'       => mb_substr($civilStatus, 0, 30),
        ':street'             => mb_substr($street, 0, 150),
        ':barangay'           => mb_substr($barangay, 0, 100),
        ':city'               => mb_substr($city, 0, 100),
        ':province'           => mb_substr($province, 0, 100),
        ':address'            => mb_substr($address, 0, 500),
        ':mobile'             => mb_substr($mobile, 0, 20),
        ':email'              => $email !== '' ? mb_substr($email, 0, 150) : null,
        ':em_name'            => mb_substr($emName, 0, 150),
        ':em_num'             => mb_substr($emNum, 0, 20),
        ':em_rel'             => mb_substr($emRel, 0, 50),
        ':id_type'            => $idType !== '' ? mb_substr($idType, 0, 80) : null,
        ':id_number'          => $idNumber !== '' ? mb_substr($idNumber, 0, 80) : null,
        ':admit_type'         => $admitType,
        ':date_admitted'      => $dateAdmitted,
        ':verified_by'        => mb_substr((string) $staff['fullName'], 0, 150),
        ':verified_at'        => $today,
        ':blood_type'         => $bloodType !== '' ? mb_substr($bloodType, 0, 10) : null,
        ':allergies'          => $allergies !== '' ? $allergies : null,
        ':medical_conditions' => $medicalConditions !== '' ? $medicalConditions : null,
        ':insurance_provider' => $insuranceProvider !== '' ? mb_substr($insuranceProvider, 0, 100) : null,
        ':insurance_number'   => $insuranceNumber !== '' ? mb_substr($insuranceNumber, 0, 100) : null,
        ':assigned_doctor_id' => $assignedDoctorId !== '' ? $assignedDoctorId : null,
        ':ward'               => $admitType === 'Inpatient' ? mb_substr($ward, 0, 100) : '',
        ':bed_number'         => $admitType === 'Inpatient' ? mb_substr($bedNumber, 0, 20) : '',
        ':notes'              => $notes !== '' ? $notes : null,
        ':created_at'         => $today,
    ]);

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

writeAuthAuditLog($staff['id'], $staff['username'], 'Register Patient', "Registered walk-in patient {$patientId} ({$fullName})");

$created = findPatientById($pdo, $patientId);
sendSuccess('Patient registered successfully.', ['patient' => $created], 201);

