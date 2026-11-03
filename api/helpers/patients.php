<?php
/**
 * PrimeCare - Patient Management Helpers, Serializer & Sequence Generator
 * Phase 5.3.2: Patient Management Backend Implementation
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

/**
 * Convert a `patients` database row to the camelCase object expected by the frontend.
 * Maps `barangay` -> `brgy` (and also includes `barangay` for compatibility).
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function serializePatient(array $row): array
{
    $street   = trim((string) ($row['street'] ?? ''));
    $barangay = trim((string) ($row['barangay'] ?? ''));
    $city     = trim((string) ($row['city'] ?? ''));
    $province = trim((string) ($row['province'] ?? ''));
    $address  = trim((string) ($row['address'] ?? ''));

    // Fallback: if structured parts are empty but combined address has comma-separated parts, parse them
    if ($street === '' && $barangay === '' && $province === '' && $address !== '' && str_contains($address, ',')) {
        $parts    = array_map('trim', explode(',', $address));
        $street   = $parts[0] ?? '';
        $barangay = $parts[1] ?? '';
        $city     = $parts[2] ?? $city;
        $province = $parts[3] ?? '';
    }

    return [
        'id'                           => (string) $row['id'],
        'userId'                       => $row['user_id'] !== null ? (string) $row['user_id'] : null,
        'firstName'                    => (string) $row['first_name'],
        'middleName'                   => (string) ($row['middle_name'] ?? ''),
        'lastName'                     => (string) $row['last_name'],
        'suffix'                       => (string) ($row['suffix'] ?? ''),
        'fullName'                     => (string) $row['full_name'],
        'birthdate'                    => (string) $row['birthdate'],
        'sex'                          => (string) $row['sex'],
        'civilStatus'                  => (string) $row['civil_status'],
        'street'                       => $street,
        'brgy'                         => $barangay,
        'barangay'                     => $barangay,
        'city'                         => $city,
        'province'                     => $province,
        'address'                      => $address,
        'mobile'                       => (string) $row['mobile'],
        'email'                        => $row['email'] !== null ? (string) $row['email'] : '',
        'emergencyContactName'         => (string) $row['emergency_contact_name'],
        'emergencyContactNumber'       => (string) $row['emergency_contact_number'],
        'emergencyContactRelationship' => (string) $row['emergency_contact_relationship'],
        'idType'                       => $row['id_type'] !== null ? (string) $row['id_type'] : '',
        'idNumber'                     => $row['id_number'] !== null ? (string) $row['id_number'] : '',
        'admitType'                    => (string) $row['admit_type'],
        'dateAdmitted'                 => $row['date_admitted'] !== null ? (string) $row['date_admitted'] : null,
        'status'                       => (string) $row['status'],
        'verifiedBy'                   => $row['verified_by'] !== null ? (string) $row['verified_by'] : null,
        'verifiedAt'                   => $row['verified_at'] !== null ? (string) $row['verified_at'] : null,
        'rejectionReason'              => $row['rejection_reason'] !== null ? (string) $row['rejection_reason'] : null,
        'bloodType'                    => $row['blood_type'] !== null ? (string) $row['blood_type'] : '',
        'allergies'                    => $row['allergies'] !== null ? (string) $row['allergies'] : '',
        'medicalConditions'            => $row['medical_conditions'] !== null ? (string) $row['medical_conditions'] : '',
        'insuranceProvider'            => $row['insurance_provider'] !== null ? (string) $row['insurance_provider'] : '',
        'insuranceNumber'              => $row['insurance_number'] !== null ? (string) $row['insurance_number'] : '',
        'assignedDoctorId'             => $row['assigned_doctor_id'] !== null ? (string) $row['assigned_doctor_id'] : '',
        'ward'                         => (string) ($row['ward'] ?? ''),
        'bedNumber'                    => (string) ($row['bed_number'] ?? ''),
        'notes'                        => $row['notes'] !== null ? (string) $row['notes'] : '',
        'createdAt'                    => (string) $row['created_at'],
        'updatedAt'                    => isset($row['updated_at']) ? (string) $row['updated_at'] : null,
    ];
}

/**
 * Fetch a single patient row by ID and serialize it, or return null if not found.
 *
 * @param PDO    $pdo
 * @param string $id
 * @return array<string, mixed>|null
 */
function findPatientById(PDO $pdo, string $id): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM patients WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    return is_array($row) ? serializePatient($row) : null;
}

/**
 * Fetch a single patient row by linked user_id and serialize it, or return null.
 *
 * @param PDO    $pdo
 * @param string $userId
 * @return array<string, mixed>|null
 */
function findPatientByUserId(PDO $pdo, string $userId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM patients WHERE user_id = :uid LIMIT 1');
    $stmt->execute([':uid' => $userId]);
    $row = $stmt->fetch();

    return is_array($row) ? serializePatient($row) : null;
}

/**
 * Atomically allocate the next formatted business ID (e.g. P-003, U-007) inside a transaction.
 *
 * @param PDO    $pdo
 * @param string $entityKey     Row key in `sequences` ('patients' or 'users').
 * @param string $tableName     Whitelisted table name ('patients' or 'users').
 * @param string $defaultPrefix Prefix if sequence row is missing ('P' or 'U').
 * @param int    $defaultPad    Zero-padding width (default 3).
 * @return string
 */
function allocateNextId(PDO $pdo, string $entityKey, string $tableName, string $defaultPrefix, int $defaultPad = 3): string
{
    if (!in_array($tableName, ['patients', 'users', 'doctors', 'appointments', 'medical_records', 'prescriptions', 'lab_results', 'immunizations', 'admissions', 'bills'], true)) {
        throw new InvalidArgumentException('Invalid table name for sequence allocation.');
    }

    $seqStmt = $pdo->prepare('SELECT prefix, current_val, pad_length FROM sequences WHERE entity_key = :key FOR UPDATE');
    $seqStmt->execute([':key' => $entityKey]);
    $seq = $seqStmt->fetch();

    $prefix = is_array($seq) ? (string) $seq['prefix'] : $defaultPrefix;
    $pad    = is_array($seq) ? (int) $seq['pad_length'] : $defaultPad;
    $next   = is_array($seq) ? ((int) $seq['current_val'] + 1) : 1;

    // Also inspect highest existing numeric suffix in the target table to prevent any collision
    $existingStmt = $pdo->query("SELECT id FROM `{$tableName}`");
    if ($existingStmt) {
        while ($r = $existingStmt->fetch()) {
            if (isset($r['id']) && preg_match('/(\d+)$/', (string) $r['id'], $m)) {
                $num = (int) $m[1];
                if ($num >= $next) {
                    $next = $num + 1;
                }
            }
        }
    }

    $checkStmt = $pdo->prepare("SELECT 1 FROM `{$tableName}` WHERE id = :id LIMIT 1");
    while (true) {
        $candidate = $prefix . '-' . str_pad((string) $next, $pad, '0', STR_PAD_LEFT);
        $checkStmt->execute([':id' => $candidate]);
        if (!$checkStmt->fetch()) {
            break;
        }
        $next++;
    }

    if (is_array($seq)) {
        $upd = $pdo->prepare('UPDATE sequences SET current_val = :val WHERE entity_key = :key');
        $upd->execute([':val' => $next, ':key' => $entityKey]);
    } else {
        $ins = $pdo->prepare('INSERT INTO sequences (entity_key, prefix, current_val, pad_length) VALUES (:key, :prefix, :val, :pad)');
        $ins->execute([':key' => $entityKey, ':prefix' => $prefix, ':val' => $next, ':pad' => $pad]);
    }

    return $candidate;
}

/**
 * Non-mutating preview of the next Patient ID (for the registration page badge).
 */
function previewNextPatientId(PDO $pdo): string
{
    $seqStmt = $pdo->prepare("SELECT prefix, current_val, pad_length FROM sequences WHERE entity_key = 'patients' LIMIT 1");
    $seqStmt->execute();
    $seq = $seqStmt->fetch();

    $prefix = is_array($seq) ? (string) $seq['prefix'] : 'P';
    $pad    = is_array($seq) ? (int) $seq['pad_length'] : 3;
    $next   = is_array($seq) ? ((int) $seq['current_val'] + 1) : 1;

    $existingStmt = $pdo->query('SELECT id FROM patients');
    if ($existingStmt) {
        while ($r = $existingStmt->fetch()) {
            if (isset($r['id']) && preg_match('/(\d+)$/', (string) $r['id'], $m)) {
                $num = (int) $m[1];
                if ($num >= $next) {
                    $next = $num + 1;
                }
            }
        }
    }

    return $prefix . '-' . str_pad((string) $next, $pad, '0', STR_PAD_LEFT);
}

/**
 * Check if a username is already taken in `users` (case-insensitive).
 */
function isUsernameTakenInDb(PDO $pdo, string $username, ?string $excludeUserId = null): bool
{
    $clean = trim($username);
    if ($clean === '') {
        return false;
    }

    if ($excludeUserId !== null && $excludeUserId !== '') {
        $stmt = $pdo->prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(:u) AND id != :uid LIMIT 1');
        $stmt->execute([':u' => $clean, ':uid' => $excludeUserId]);
    } else {
        $stmt = $pdo->prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(:u) LIMIT 1');
        $stmt->execute([':u' => $clean]);
    }

    return (bool) $stmt->fetch();
}

/**
 * Check if an email address is already used in `patients` or `users` (case-insensitive).
 */
function isEmailTakenInDb(PDO $pdo, string $email, ?string $excludePatientId = null, ?string $excludeUserId = null): bool
{
    $clean = trim($email);
    if ($clean === '') {
        return false;
    }

    // Resolve excludeUserId from excludePatientId if not provided
    if (($excludeUserId === null || $excludeUserId === '') && $excludePatientId !== null && $excludePatientId !== '') {
        $uStmt = $pdo->prepare('SELECT user_id FROM patients WHERE id = :pid LIMIT 1');
        $uStmt->execute([':pid' => $excludePatientId]);
        $uRow = $uStmt->fetch();
        if (is_array($uRow) && !empty($uRow['user_id'])) {
            $excludeUserId = (string) $uRow['user_id'];
        }
    }

    if ($excludePatientId !== null && $excludePatientId !== '') {
        $pStmt = $pdo->prepare('SELECT 1 FROM patients WHERE email IS NOT NULL AND email != \'\' AND LOWER(email) = LOWER(:e) AND id != :pid LIMIT 1');
        $pStmt->execute([':e' => $clean, ':pid' => $excludePatientId]);
    } else {
        $pStmt = $pdo->prepare('SELECT 1 FROM patients WHERE email IS NOT NULL AND email != \'\' AND LOWER(email) = LOWER(:e) LIMIT 1');
        $pStmt->execute([':e' => $clean]);
    }
    if ($pStmt->fetch()) {
        return true;
    }

    if ($excludeUserId !== null && $excludeUserId !== '') {
        $uStmt = $pdo->prepare('SELECT 1 FROM users WHERE LOWER(email) = LOWER(:e) AND id != :uid LIMIT 1');
        $uStmt->execute([':e' => $clean, ':uid' => $excludeUserId]);
    } else {
        $uStmt = $pdo->prepare('SELECT 1 FROM users WHERE LOWER(email) = LOWER(:e) LIMIT 1');
        $uStmt->execute([':e' => $clean]);
    }

    return (bool) $uStmt->fetch();
}

/**
 * Check if a mobile number is already used in `patients`.
 */
function isMobileTakenInDb(PDO $pdo, string $mobile, ?string $excludePatientId = null): bool
{
    $clean = trim($mobile);
    if ($clean === '') {
        return false;
    }

    if ($excludePatientId !== null && $excludePatientId !== '') {
        $stmt = $pdo->prepare('SELECT 1 FROM patients WHERE mobile = :m AND id != :pid LIMIT 1');
        $stmt->execute([':m' => $clean, ':pid' => $excludePatientId]);
    } else {
        $stmt = $pdo->prepare('SELECT 1 FROM patients WHERE mobile = :m LIMIT 1');
        $stmt->execute([':m' => $clean]);
    }

    return (bool) $stmt->fetch();
}

/**
 * Check if a national ID (id_type + id_number) is already registered in `patients`.
 */
function isNationalIdTakenInDb(PDO $pdo, string $idType, string $idNumber, ?string $excludePatientId = null): bool
{
    $type = trim($idType);
    $num  = trim($idNumber);
    if ($type === '' || $num === '') {
        return false;
    }

    if ($excludePatientId !== null && $excludePatientId !== '') {
        $stmt = $pdo->prepare('SELECT 1 FROM patients WHERE id_type = :t AND LOWER(id_number) = LOWER(:n) AND id != :pid LIMIT 1');
        $stmt->execute([':t' => $type, ':n' => $num, ':pid' => $excludePatientId]);
    } else {
        $stmt = $pdo->prepare('SELECT 1 FROM patients WHERE id_type = :t AND LOWER(id_number) = LOWER(:n) LIMIT 1');
        $stmt->execute([':t' => $type, ':n' => $num]);
    }

    return (bool) $stmt->fetch();
}

/**
 * Insert a notification for a patient in the `notifications` table.
 */
function createPatientNotification(PDO $pdo, string $patientId, string $type, string $title, string $message, string $link): void
{
    $allowedTypes = ['system', 'account', 'appointment', 'lab', 'bill'];
    $safeType     = in_array($type, $allowedTypes, true) ? $type : 'system';
    $notifId      = 'N-' . round(microtime(true) * 1000) . '-' . random_int(10, 99);

    $stmt = $pdo->prepare(
        'INSERT INTO notifications (id, patient_id, type, title, message, link, is_read, created_at)
         VALUES (:id, :pid, :type, :title, :msg, :link, 0, NOW())'
    );
    $stmt->execute([
        ':id'    => substr($notifId, 0, 30),
        ':pid'   => $patientId,
        ':type'  => $safeType,
        ':title' => mb_substr($title, 0, 150),
        ':msg'   => $message,
        ':link'  => $link,
    ]);
}

/**
 * Validate a YYYY-MM-DD date string and optionally ensure it is not in the future.
 */
function isValidDateString(string $date, bool $disallowFuture = false): bool
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return false;
    }
    [$y, $m, $d] = array_map('intval', explode('-', $date));
    if (!checkdate($m, $d, $y)) {
        return false;
    }
    if ($disallowFuture && $date > date('Y-m-d')) {
        return false;
    }

    return true;
}

