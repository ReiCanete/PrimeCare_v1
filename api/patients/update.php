<?php
/**
 * PrimeCare - POST /api/patients/update.php
 * Phase 5.3.2: Role-scoped patient record update
 *
 * Authorization & Field Whitelisting:
 * - `patient`: may ONLY update their own record (`user_id === session uid`), and ONLY
 *   contact & emergency fields (`mobile`, `email`, `street`, `brgy`/`barangay`, `city`,
 *   `province`, `address`, `emergencyContactName`, `emergencyContactNumber`, `emergencyContactRelationship`).
 * - `nurse` / `doctor`: may update clinical & admission fields (`admitType`, `ward`, `bedNumber`,
 *   `assignedDoctorId`, `bloodType`, `allergies`, `medicalConditions`, `notes`).
 * - `admin` / `staff`: may update demographic, contact, emergency, clinical, and admission fields.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/patients.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireAuth();
requireCsrf();

$input   = getJsonInput();
$id      = trim((string) ($input['id'] ?? ''));
$changes = isset($input['changes']) && is_array($input['changes']) ? $input['changes'] : $input;

$pdo = getDatabaseConnection();

if ($user['role'] === 'patient') {
    $ownStmt = $pdo->prepare('SELECT * FROM patients WHERE user_id = :uid LIMIT 1');
    $ownStmt->execute([':uid' => $user['id']]);
    $existingRow = $ownStmt->fetch();

    if (!is_array($existingRow)) {
        sendError('No linked patient record found.', 404);
    }
    if ($id !== '' && strcasecmp($id, (string) $existingRow['id']) !== 0) {
        sendError('You do not have permission to update another patient\'s record.', 403);
    }
    $id = (string) $existingRow['id'];
} else {
    if ($id === '') {
        sendError('Patient ID is required.', 400);
    }
    $stmt = $pdo->prepare('SELECT * FROM patients WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $existingRow = $stmt->fetch();
    if (!is_array($existingRow)) {
        sendError('Patient not found.', 404);
    }
}

$current = serializePatient($existingRow);

// Determine allowed fields by role
$contactFields  = ['mobile', 'email', 'street', 'brgy', 'barangay', 'city', 'province', 'address', 'emergencyContactName', 'emergencyContactNumber', 'emergencyContactRelationship'];
$clinicalFields = ['admitType', 'ward', 'bedNumber', 'assignedDoctorId', 'bloodType', 'allergies', 'medicalConditions', 'notes'];
$staffFields    = array_merge($contactFields, $clinicalFields, ['firstName', 'middleName', 'lastName', 'suffix', 'birthdate', 'sex', 'civilStatus', 'idType', 'idNumber', 'dateAdmitted', 'insuranceProvider', 'insuranceNumber']);

if ($user['role'] === 'patient') {
    $allowedKeys = $contactFields;
} elseif ($user['role'] === 'nurse' || $user['role'] === 'doctor') {
    $allowedKeys = $clinicalFields;
} else {
    $allowedKeys = $staffFields;
}

$filtered = [];
foreach ($changes as $k => $v) {
    if (in_array($k, $allowedKeys, true)) {
        $filtered[$k] = is_string($v) ? trim($v) : $v;
    }
}

if ($filtered === []) {
    sendError('No permitted fields provided for update.', 400);
}

$firstName   = (string) ($filtered['firstName'] ?? $current['firstName']);
$middleName  = (string) ($filtered['middleName'] ?? $current['middleName']);
$lastName    = (string) ($filtered['lastName'] ?? $current['lastName']);
$suffix      = (string) ($filtered['suffix'] ?? $current['suffix']);
$fullName    = trim($firstName . ' ' . $lastName);
$birthdate   = (string) ($filtered['birthdate'] ?? $current['birthdate']);
$sex         = (string) ($filtered['sex'] ?? $current['sex']);
$civilStatus = (string) ($filtered['civilStatus'] ?? $current['civilStatus']);

$mobile   = (string) ($filtered['mobile'] ?? $current['mobile']);
$email    = array_key_exists('email', $filtered) ? (string) $filtered['email'] : (string) $current['email'];
$street   = (string) ($filtered['street'] ?? $current['street']);
$barangay = (string) ($filtered['brgy'] ?? ($filtered['barangay'] ?? $current['brgy']));
$city     = (string) ($filtered['city'] ?? $current['city']);
$province = (string) ($filtered['province'] ?? $current['province']);

// If structured parts were updated, rebuild combined address unless only `address` was edited
if (isset($filtered['street']) || isset($filtered['brgy']) || isset($filtered['barangay']) || isset($filtered['city']) || isset($filtered['province'])) {
    $address = implode(', ', array_filter([$street, $barangay, $city, $province], static fn($v) => $v !== ''));
} else {
    $address = (string) ($filtered['address'] ?? $current['address']);
    // If only `address` was edited (e.g. from Staff Edit Modal) and contains 4 comma-separated parts, sync parts
    if (isset($filtered['address']) && str_contains($address, ',')) {
        $parts = array_map('trim', explode(',', $address));
        if (count($parts) >= 4) {
            $street   = $parts[0];
            $barangay = $parts[1];
            $city     = $parts[2];
            $province = implode(', ', array_slice($parts, 3));
        }
    }
}

$emName = (string) ($filtered['emergencyContactName'] ?? $current['emergencyContactName']);
$emNum  = (string) ($filtered['emergencyContactNumber'] ?? $current['emergencyContactNumber']);
$emRel  = (string) ($filtered['emergencyContactRelationship'] ?? $current['emergencyContactRelationship']);

$admitType        = (string) ($filtered['admitType'] ?? $current['admitType']);
$dateAdmitted     = (string) ($filtered['dateAdmitted'] ?? ($current['dateAdmitted'] ?? date('Y-m-d')));
$ward             = (string) ($filtered['ward'] ?? $current['ward']);
$bedNumber        = (string) ($filtered['bedNumber'] ?? $current['bedNumber']);
$assignedDoctorId = (string) ($filtered['assignedDoctorId'] ?? $current['assignedDoctorId']);

$bloodType         = (string) ($filtered['bloodType'] ?? $current['bloodType']);
$allergies         = (string) ($filtered['allergies'] ?? $current['allergies']);
$medicalConditions = (string) ($filtered['medicalConditions'] ?? $current['medicalConditions']);
$insuranceProvider = (string) ($filtered['insuranceProvider'] ?? $current['insuranceProvider']);
$insuranceNumber   = (string) ($filtered['insuranceNumber'] ?? $current['insuranceNumber']);
$idType            = (string) ($filtered['idType'] ?? $current['idType']);
$idNumber          = (string) ($filtered['idNumber'] ?? $current['idNumber']);
$notes             = (string) ($filtered['notes'] ?? $current['notes']);

// Validations
if ($firstName === '' || $lastName === '') {
    sendError('First name and last name cannot be empty.', 400);
}
if (!isValidDateString($birthdate, true)) {
    sendError('Invalid birthdate.', 400);
}
if (!in_array($sex, ['Male', 'Female', 'Other'], true)) {
    sendError('Invalid sex selection.', 400);
}
if (!preg_match('/^09\d{9}$/', $mobile)) {
    sendError('Invalid mobile format (must be 09XXXXXXXXX).', 400);
}
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendError('Invalid email format.', 400);
}
if ($address === '') {
    sendError('Address cannot be empty.', 400);
}
if (!in_array($admitType, ['Outpatient', 'Inpatient'], true)) {
    sendError('Invalid admission type.', 400);
}
if ($admitType === 'Inpatient' && $current['status'] !== 'verified') {
    sendError('Cannot set Inpatient status for an unverified patient.', 400);
}
if ($admitType === 'Outpatient') {
    // Clear ward/bed if switched back to Outpatient unless explicitly kept
    if (!isset($filtered['ward'])) {
        $ward = '';
    }
    if (!isset($filtered['bedNumber'])) {
        $bedNumber = '';
    }
}

$linkedUserId = $current['userId'];

if (isMobileTakenInDb($pdo, $mobile, $id)) {
    sendError('Mobile is already in use.', 409);
}
if ($email !== '' && isEmailTakenInDb($pdo, $email, $id, $linkedUserId)) {
    sendError('Email is already in use.', 409);
}
if ($idType !== '' && $idNumber !== '' && isNationalIdTakenInDb($pdo, $idType, $idNumber, $id)) {
    sendError('This National ID is already registered to another patient.', 409);
}

if ($assignedDoctorId !== '') {
    $docCheck = $pdo->prepare('SELECT 1 FROM doctors WHERE id = :id LIMIT 1');
    $docCheck->execute([':id' => $assignedDoctorId]);
    if (!$docCheck->fetch()) {
        $assignedDoctorId = '';
    }
}

$pdo->beginTransaction();
try {
    $upd = $pdo->prepare(
        'UPDATE patients SET
            first_name                     = :first_name,
            middle_name                    = :middle_name,
            last_name                      = :last_name,
            suffix                         = :suffix,
            full_name                      = :full_name,
            birthdate                      = :birthdate,
            sex                            = :sex,
            civil_status                   = :civil_status,
            street                         = :street,
            barangay                       = :barangay,
            city                           = :city,
            province                       = :province,
            address                        = :address,
            mobile                         = :mobile,
            email                          = :email,
            emergency_contact_name         = :em_name,
            emergency_contact_number       = :em_num,
            emergency_contact_relationship = :em_rel,
            id_type                        = :id_type,
            id_number                      = :id_number,
            admit_type                     = :admit_type,
            date_admitted                  = :date_admitted,
            blood_type                     = :blood_type,
            allergies                      = :allergies,
            medical_conditions             = :medical_conditions,
            insurance_provider             = :insurance_provider,
            insurance_number               = :insurance_number,
            assigned_doctor_id             = :assigned_doctor_id,
            ward                           = :ward,
            bed_number                     = :bed_number,
            notes                          = :notes
         WHERE id = :id'
    );

    $upd->execute([
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
        ':date_admitted'      => $dateAdmitted !== '' ? $dateAdmitted : null,
        ':blood_type'         => $bloodType !== '' ? mb_substr($bloodType, 0, 10) : null,
        ':allergies'          => $allergies !== '' ? $allergies : null,
        ':medical_conditions' => $medicalConditions !== '' ? $medicalConditions : null,
        ':insurance_provider' => $insuranceProvider !== '' ? mb_substr($insuranceProvider, 0, 100) : null,
        ':insurance_number'   => $insuranceNumber !== '' ? mb_substr($insuranceNumber, 0, 100) : null,
        ':assigned_doctor_id' => $assignedDoctorId !== '' ? $assignedDoctorId : null,
        ':ward'               => mb_substr($ward, 0, 100),
        ':bed_number'         => mb_substr($bedNumber, 0, 20),
        ':notes'              => $notes !== '' ? $notes : null,
        ':id'                 => $id,
    ]);

    // Synchronize full_name, mobile, and email on the linked `users` account if present
    if ($linkedUserId !== null && $linkedUserId !== '') {
        if ($email !== '') {
            $syncUser = $pdo->prepare('UPDATE users SET full_name = :fn, mobile = :mob, email = :em WHERE id = :uid');
            $syncUser->execute([
                ':fn'  => mb_substr($fullName, 0, 150),
                ':mob' => mb_substr($mobile, 0, 20),
                ':em'  => mb_substr($email, 0, 150),
                ':uid' => $linkedUserId,
            ]);
        } else {
            $syncUser = $pdo->prepare('UPDATE users SET full_name = :fn, mobile = :mob WHERE id = :uid');
            $syncUser->execute([
                ':fn'  => mb_substr($fullName, 0, 150),
                ':mob' => mb_substr($mobile, 0, 20),
                ':uid' => $linkedUserId,
            ]);
        }
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

writeAuthAuditLog($user['id'], $user['username'], 'Update Patient', "Updated patient {$id} ({$fullName})");

$updated = findPatientById($pdo, $id);
sendSuccess('Patient updated successfully.', ['patient' => $updated]);

