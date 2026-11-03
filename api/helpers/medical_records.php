<?php
/**
 * PrimeCare - EHR / Medical Records Helpers, Serializers, Validators & Transactional Writers
 * Phase 5.7.2: EHR / Medical Records Backend Migration
 *
 * Tables used (no schema changes): `medical_records`, `medical_record_history`.
 * IDs come from the shared `sequences` row `medicalRecords` via allocateNextId().
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
// appointments.php also pins the PHP timezone to Asia/Manila (matches MariaDB SYSTEM time).
require_once __DIR__ . '/appointments.php';

/** Roles that may author/modify diagnoses and treatment notes. */
const PRIMECARE_EHR_CLINICAL_WRITE_ROLES = ['admin', 'doctor'];

/** Roles that may record vital signs. */
const PRIMECARE_EHR_VITALS_WRITE_ROLES = ['admin', 'doctor', 'nurse'];

/** Inclusive physiological ranges enforced server-side (Phase 5.7.1 audit §7). */
const PRIMECARE_VITAL_LIMITS = [
    'systolic'    => [50, 300],
    'diastolic'   => [30, 200],
    'heartRate'   => [20, 250],
    'temperature' => [30.0, 45.0],
    'spo2'        => [50, 100],
    'weightKg'    => [0.5, 500.0],
    'heightCm'    => [20.0, 300.0],
    'respRate'    => [4, 80],
];

/** Vital key (frontend camelCase) => [DB column, human label, type]. */
const PRIMECARE_VITAL_FIELDS = [
    'bp'          => ['vital_bp',          'blood pressure',   'bp'],
    'heartRate'   => ['vital_heart_rate',  'heart rate',       'int'],
    'temperature' => ['vital_temperature', 'temperature',      'decimal1'],
    'respRate'    => ['vital_resp_rate',   'respiratory rate', 'int'],
    'weightKg'    => ['vital_weight_kg',   'weight',           'decimal2'],
    'heightCm'    => ['vital_height_cm',   'height',           'decimal2'],
    'spo2'        => ['vital_spo2',        'SpO2',             'int'],
];

const PRIMECARE_EHR_MAX_COMPLAINT_LEN = 1000;
const PRIMECARE_EHR_MAX_DIAGNOSIS_LEN = 1000;
const PRIMECARE_EHR_MAX_TREATMENT_LEN = 5000;

// -----------------------------------------------------------------------------
// Result helpers
// -----------------------------------------------------------------------------

/**
 * @param array<string, mixed> $extra
 * @return array<string, mixed>
 */
function medicalRecordFail(int $status, string $message, array $extra = []): array
{
    return ['ok' => false, 'status' => $status, 'message' => $message] + $extra;
}

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

/**
 * Convert a MariaDB DATETIME ("2026-11-02 09:30:00") to the ISO-like form the frontend expects
 * ("2026-11-02T09:30:00"); existing UI code relies on `createdAt.split('T')[0]`.
 */
function formatMedicalRecordTimestamp(mixed $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return str_replace(' ', 'T', (string) $value);
}

/**
 * Which projection of a record a role may see.
 *  - full:    admin, doctor, nurse  (complete chart incl. vitals, history, author)
 *  - patient: own records only      (clinical content, no internal user IDs)
 *  - summary: staff                 (date, doctor, diagnosis only; no vitals/notes/complaint)
 * Unknown roles fail closed to the most restrictive view.
 */
function medicalRecordViewForRole(string $role): string
{
    return match ($role) {
        'admin', 'doctor', 'nurse' => 'full',
        'patient'                  => 'patient',
        default                    => 'summary',
    };
}

/**
 * @param array<string, mixed> $row  `medical_record_history` row
 * @return array<string, mixed>
 */
function serializeMedicalRecordHistory(array $row): array
{
    return [
        'id'        => (int) $row['id'],
        'recordId'  => (string) $row['medical_record_id'],
        'updatedBy' => (string) $row['updated_by'],
        'updatedAt' => formatMedicalRecordTimestamp($row['updated_at']),
        'summary'   => (string) $row['summary'],
    ];
}

/**
 * Build the nested frontend `vitals` object. Null columns are omitted so that
 * `Object.keys(vitals).length === 0` stays true for records without vitals.
 *
 * @param array<string, mixed> $row
 */
function serializeMedicalRecordVitals(array $row): object
{
    $vitals = [];
    if ($row['vital_bp'] !== null && $row['vital_bp'] !== '') {
        $vitals['bp'] = (string) $row['vital_bp'];
    }
    if ($row['vital_heart_rate'] !== null) {
        $vitals['heartRate'] = (int) $row['vital_heart_rate'];
    }
    if ($row['vital_temperature'] !== null) {
        $vitals['temperature'] = (float) $row['vital_temperature'];
    }
    if ($row['vital_resp_rate'] !== null) {
        $vitals['respRate'] = (int) $row['vital_resp_rate'];
    }
    if ($row['vital_weight_kg'] !== null) {
        $vitals['weightKg'] = (float) $row['vital_weight_kg'];
    }
    if ($row['vital_height_cm'] !== null) {
        $vitals['heightCm'] = (float) $row['vital_height_cm'];
    }
    if ($row['vital_spo2'] !== null) {
        $vitals['spo2'] = (int) $row['vital_spo2'];
    }
    return (object) $vitals;
}

/**
 * Serialize a joined `medical_records` row into the camelCase structure used by the frontend.
 *
 * @param array<string, mixed>                    $row
 * @param array<int, array<string, mixed>>|null   $history Serialized history entries, or null to omit.
 * @return array<string, mixed>
 */
function serializeMedicalRecord(array $row, ?array $history = null, string $view = 'full'): array
{
    $createdAt = formatMedicalRecordTimestamp($row['created_at'] ?? null);
    $doctorId  = $row['attending_doctor_id'] !== null && $row['attending_doctor_id'] !== ''
        ? (string) $row['attending_doctor_id']
        : null;

    $base = [
        'id'                => (string) $row['id'],
        'patientId'         => (string) $row['patient_id'],
        'patientName'       => isset($row['patient_name']) && $row['patient_name'] !== null ? (string) $row['patient_name'] : 'Unknown',
        'appointmentId'     => $row['appointment_id'] !== null && $row['appointment_id'] !== '' ? (string) $row['appointment_id'] : null,
        'attendingDoctorId' => $doctorId,
        'doctorId'          => $doctorId,
        'doctorName'        => isset($row['doctor_name']) && $row['doctor_name'] !== null ? (string) $row['doctor_name'] : 'Unknown',
        'specialization'    => isset($row['doctor_specialization']) && $row['doctor_specialization'] !== null ? (string) $row['doctor_specialization'] : '',
        'diagnosis'         => $row['diagnosis'] !== null ? (string) $row['diagnosis'] : '',
        'date'              => $createdAt !== null ? substr($createdAt, 0, 10) : '',
        'createdAt'         => $createdAt,
        'updatedAt'         => formatMedicalRecordTimestamp($row['updated_at'] ?? null),
        'view'              => $view,
    ];

    if ($view === 'summary') {
        return $base;
    }

    $base['chiefComplaint'] = (string) ($row['chief_complaint'] ?? '');
    $base['treatmentNotes'] = $row['treatment_notes'] !== null ? (string) $row['treatment_notes'] : '';
    $base['followUpDate']   = $row['follow_up_date'] !== null && $row['follow_up_date'] !== '' ? (string) $row['follow_up_date'] : null;
    $base['vitals']         = serializeMedicalRecordVitals($row);

    if ($view === 'full') {
        $base['createdBy']     = $row['created_by'] !== null && $row['created_by'] !== '' ? (string) $row['created_by'] : null;
        $base['createdByName'] = isset($row['created_by_name']) && $row['created_by_name'] !== null ? (string) $row['created_by_name'] : null;
        if ($history !== null) {
            $base['history'] = $history;
        }
    }

    return $base;
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

/** Shared SELECT ... FROM ... JOIN fragment (no WHERE / ORDER BY). */
function medicalRecordSelectSql(): string
{
    return 'SELECT m.*,
                   p.full_name AS patient_name,
                   d.name AS doctor_name,
                   d.specialization AS doctor_specialization,
                   u.full_name AS created_by_name
            FROM medical_records m
            LEFT JOIN patients p ON p.id = m.patient_id
            LEFT JOIN doctors d ON d.id = m.attending_doctor_id
            LEFT JOIN users u ON u.id = m.created_by';
}

/**
 * Fetch revision history for one record (newest first).
 *
 * @return array<int, array<string, mixed>>
 */
function fetchMedicalRecordHistory(PDO $pdo, string $recordId): array
{
    $stmt = $pdo->prepare(
        'SELECT * FROM medical_record_history
         WHERE medical_record_id = :rid
         ORDER BY updated_at DESC, id DESC'
    );
    $stmt->execute([':rid' => $recordId]);

    return array_map('serializeMedicalRecordHistory', $stmt->fetchAll() ?: []);
}

/**
 * Batch-fetch history for many records.
 *
 * @param array<int, string> $recordIds
 * @return array<string, array<int, array<string, mixed>>> recordId => entries (newest first)
 */
function fetchMedicalRecordHistoryByRecordIds(PDO $pdo, array $recordIds): array
{
    $map = [];
    if ($recordIds === []) {
        return $map;
    }

    $placeholders = implode(',', array_fill(0, count($recordIds), '?'));
    $stmt = $pdo->prepare(
        "SELECT * FROM medical_record_history
         WHERE medical_record_id IN ({$placeholders})
         ORDER BY updated_at DESC, id DESC"
    );
    $stmt->execute(array_values($recordIds));

    foreach ($stmt->fetchAll() ?: [] as $row) {
        $map[(string) $row['medical_record_id']][] = serializeMedicalRecordHistory($row);
    }

    return $map;
}

/**
 * Fetch one record by ID (joined + serialized for the given view).
 *
 * @return array<string, mixed>|null
 */
function findMedicalRecordById(PDO $pdo, string $id, string $view = 'full', bool $withHistory = true): ?array
{
    $stmt = $pdo->prepare(medicalRecordSelectSql() . ' WHERE m.id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        return null;
    }

    $history = ($withHistory && $view === 'full')
        ? fetchMedicalRecordHistory($pdo, (string) $row['id'])
        : null;

    return serializeMedicalRecord($row, $history, $view);
}

/**
 * Fetch and filter medical records.
 *
 * Supported filters: patientId, doctorId, dateFrom, dateTo (on created_at date), keyword
 * (record ID, patient name, diagnosis), sortBy (whitelisted), sortDir.
 *
 * @param array<string, mixed> $filters
 * @return array<int, array<string, mixed>>
 */
function fetchMedicalRecords(PDO $pdo, array $filters, string $view = 'full', bool $withHistory = true): array
{
    $where  = [];
    $params = [];

    $patientId = trim((string) ($filters['patientId'] ?? ''));
    if ($patientId !== '' && strtolower($patientId) !== 'all') {
        $where[]            = 'm.patient_id = :pid';
        $params[':pid']     = strtoupper($patientId);
    }

    $doctorId = trim((string) ($filters['doctorId'] ?? ''));
    if ($doctorId !== '' && strtolower($doctorId) !== 'all') {
        $where[]            = 'm.attending_doctor_id = :did';
        $params[':did']     = strtoupper($doctorId);
    }

    $dateFrom = trim((string) ($filters['dateFrom'] ?? ''));
    if ($dateFrom !== '' && isValidDateString($dateFrom)) {
        $where[]                 = 'm.created_at >= :date_from';
        $params[':date_from']    = $dateFrom . ' 00:00:00';
    }

    $dateTo = trim((string) ($filters['dateTo'] ?? ''));
    if ($dateTo !== '' && isValidDateString($dateTo)) {
        $where[]               = 'm.created_at <= :date_to';
        $params[':date_to']    = $dateTo . ' 23:59:59';
    }

    $keyword = trim((string) ($filters['keyword'] ?? ''));
    if ($keyword !== '') {
        $where[]          = '(m.id LIKE :kw1 OR p.full_name LIKE :kw2 OR m.diagnosis LIKE :kw3)';
        $like             = '%' . $keyword . '%';
        $params[':kw1']   = $like;
        $params[':kw2']   = $like;
        $params[':kw3']   = $like;
    }

    $sortDir = strtolower((string) ($filters['sortDir'] ?? 'desc')) === 'asc' ? 'ASC' : 'DESC';
    $orderBy = match ((string) ($filters['sortBy'] ?? 'createdAt')) {
        'id'          => "m.id {$sortDir}",
        'patientName' => "p.full_name {$sortDir}, m.created_at DESC",
        'doctorName'  => "d.name {$sortDir}, m.created_at DESC",
        default       => "m.created_at {$sortDir}, m.id {$sortDir}",
    };

    $sql = medicalRecordSelectSql();
    if ($where !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY ' . $orderBy;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll() ?: [];

    $historyMap = [];
    if ($withHistory && $view === 'full') {
        $historyMap = fetchMedicalRecordHistoryByRecordIds(
            $pdo,
            array_map(static fn(array $r): string => (string) $r['id'], $rows)
        );
    }

    $records = [];
    foreach ($rows as $row) {
        $history   = ($withHistory && $view === 'full') ? ($historyMap[(string) $row['id']] ?? []) : null;
        $records[] = serializeMedicalRecord($row, $history, $view);
    }

    return $records;
}

/**
 * Fetch the revision history for every record of a patient (newest first).
 *
 * @return array<int, array<string, mixed>>
 */
function fetchMedicalRecordHistoryForPatient(PDO $pdo, string $patientId): array
{
    $stmt = $pdo->prepare(
        'SELECT h.*
         FROM medical_record_history h
         INNER JOIN medical_records m ON m.id = h.medical_record_id
         WHERE m.patient_id = :pid
         ORDER BY h.updated_at DESC, h.id DESC'
    );
    $stmt->execute([':pid' => $patientId]);

    return array_map('serializeMedicalRecordHistory', $stmt->fetchAll() ?: []);
}

/**
 * Resolve the `doctors.id` profile linked to a user account, or null.
 */
function findDoctorIdForUser(PDO $pdo, string $userId): ?string
{
    $stmt = $pdo->prepare('SELECT id FROM doctors WHERE user_id = :uid LIMIT 1');
    $stmt->execute([':uid' => $userId]);
    $row = $stmt->fetch();

    return is_array($row) ? (string) $row['id'] : null;
}

/**
 * Enforce patient ownership. Patients may only touch their own records (403 otherwise);
 * every other role passes through (their access is gated by requireRole()).
 */
function assertMedicalRecordPatientAccess(PDO $pdo, array $user, string $recordPatientId): void
{
    if (($user['role'] ?? '') !== 'patient') {
        return;
    }

    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null || (string) $own['id'] !== $recordPatientId) {
        sendError('Forbidden: You do not have permission to view this medical record.', 403);
    }
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Parse a JSON-supplied number (int/float or plain numeric string). Null when invalid.
 */
function parseVitalNumber(mixed $value): ?float
{
    if (is_int($value) || is_float($value)) {
        $n = (float) $value;
    } elseif (is_string($value) && preg_match('/^-?\d+(\.\d+)?$/', trim($value)) === 1) {
        $n = (float) trim($value);
    } else {
        return null;
    }

    return is_finite($n) ? $n : null;
}

/**
 * Validate a vitals payload against the physiological ranges and normalise it for storage.
 * Only supplied (non-null, non-empty) fields are returned, enabling partial updates.
 *
 * @param array<string, mixed> $input  e.g. ['bp' => '120/80', 'heartRate' => 78, ...]
 * @return array{ok: true, vitals: array<string, string|int|float>}|array{ok: false, message: string, errors: array<string, string>}
 */
function validateVitalsPayload(array $input): array
{
    $vitals = [];
    $errors = [];
    $L      = PRIMECARE_VITAL_LIMITS;

    foreach (PRIMECARE_VITAL_FIELDS as $key => [, $label, $type]) {
        if (!array_key_exists($key, $input)) {
            continue;
        }
        $raw = $input[$key];
        if ($raw === null || (is_string($raw) && trim($raw) === '')) {
            continue;
        }

        if ($type === 'bp') {
            $bp = is_string($raw) ? trim($raw) : '';
            if (preg_match('/^(\d{2,3})\/(\d{2,3})$/', $bp, $m) !== 1) {
                $errors[$key] = 'Blood pressure must be in format SYS/DIA (e.g., 120/80).';
                continue;
            }
            $sys = (int) $m[1];
            $dia = (int) $m[2];
            if ($sys < $L['systolic'][0] || $sys > $L['systolic'][1]) {
                $errors[$key] = "Systolic pressure out of realistic range ({$L['systolic'][0]}-{$L['systolic'][1]} mmHg).";
                continue;
            }
            if ($dia < $L['diastolic'][0] || $dia > $L['diastolic'][1]) {
                $errors[$key] = "Diastolic pressure out of realistic range ({$L['diastolic'][0]}-{$L['diastolic'][1]} mmHg).";
                continue;
            }
            $vitals[$key] = "{$sys}/{$dia}";
            continue;
        }

        $n = parseVitalNumber($raw);
        if ($n === null) {
            $errors[$key] = ucfirst($label) . ' must be a number.';
            continue;
        }

        if ($type === 'int') {
            if (abs($n - round($n)) > 1e-9) {
                $errors[$key] = ucfirst($label) . ' must be a whole number.';
                continue;
            }
            $n = (float) round($n);
        }

        [$min, $max] = $L[$key];
        if ($n < $min || $n > $max) {
            $unit = match ($key) {
                'heartRate'   => 'bpm',
                'temperature' => '°C',
                'spo2'        => '%',
                'weightKg'    => 'kg',
                'heightCm'    => 'cm',
                'respRate'    => 'breaths/min',
                default       => '',
            };
            $errors[$key] = ucfirst($label) . " out of realistic range ({$min}-{$max} {$unit}).";
            continue;
        }

        $vitals[$key] = match ($type) {
            'int'      => (int) $n,
            'decimal1' => round($n, 1),
            default    => round($n, 2),
        };
    }

    if ($errors !== []) {
        return ['ok' => false, 'message' => (string) reset($errors), 'errors' => $errors];
    }

    if ($vitals === []) {
        return [
            'ok'      => false,
            'message' => 'At least one vital sign is required.',
            'errors'  => ['vitals' => 'At least one vital sign is required.'],
        ];
    }

    return ['ok' => true, 'vitals' => $vitals];
}

/**
 * Read an optional scalar text field. Returns [value, error]; error set if a non-scalar was supplied.
 *
 * @param array<string, mixed> $input
 * @return array{0: string, 1: string|null}
 */
function readMedicalRecordText(array $input, string $key, string $label): array
{
    if (!array_key_exists($key, $input) || $input[$key] === null) {
        return ['', null];
    }
    if (!is_scalar($input[$key]) || is_bool($input[$key])) {
        return ['', "{$label} must be text."];
    }

    return [trim((string) $input[$key]), null];
}

/**
 * Validate the clinical text fields shared by create and update.
 *
 * @param array<string, mixed> $input
 * @return array{ok: true, chiefComplaint: string, diagnosis: string, treatmentNotes: string}|array<string, mixed>
 */
function validateClinicalTextFields(array $input): array
{
    [$complaint, $e1] = readMedicalRecordText($input, 'chiefComplaint', 'Chief complaint');
    [$diagnosis, $e2] = readMedicalRecordText($input, 'diagnosis', 'Diagnosis');
    [$treatment, $e3] = readMedicalRecordText($input, 'treatmentNotes', 'Treatment notes');

    foreach ([$e1, $e2, $e3] as $err) {
        if ($err !== null) {
            return medicalRecordFail(400, $err);
        }
    }

    if ($diagnosis === '' || $treatment === '') {
        return medicalRecordFail(400, 'Diagnosis and treatment notes are required.');
    }
    if (mb_strlen($complaint) > PRIMECARE_EHR_MAX_COMPLAINT_LEN) {
        return medicalRecordFail(400, 'Chief complaint must not exceed ' . PRIMECARE_EHR_MAX_COMPLAINT_LEN . ' characters.');
    }
    if (mb_strlen($diagnosis) > PRIMECARE_EHR_MAX_DIAGNOSIS_LEN) {
        return medicalRecordFail(400, 'Diagnosis must not exceed ' . PRIMECARE_EHR_MAX_DIAGNOSIS_LEN . ' characters.');
    }
    if (mb_strlen($treatment) > PRIMECARE_EHR_MAX_TREATMENT_LEN) {
        return medicalRecordFail(400, 'Treatment notes must not exceed ' . PRIMECARE_EHR_MAX_TREATMENT_LEN . ' characters.');
    }

    return [
        'ok'             => true,
        'chiefComplaint' => $complaint,
        'diagnosis'      => $diagnosis,
        'treatmentNotes' => $treatment,
    ];
}

/**
 * Validate an optional follow-up date: valid calendar date, not before $notBefore (YYYY-MM-DD).
 *
 * @return array{ok: true, value: string|null}|array<string, mixed>
 */
function validateFollowUpDate(mixed $raw, string $notBefore): array
{
    if ($raw === null || (is_string($raw) && trim($raw) === '')) {
        return ['ok' => true, 'value' => null];
    }
    if (!is_string($raw) || !isValidDateString(trim($raw))) {
        return medicalRecordFail(400, 'Follow-up date must be a valid date (YYYY-MM-DD).');
    }
    $date = trim($raw);
    if ($date < $notBefore) {
        return medicalRecordFail(400, 'Follow-up date cannot be earlier than the date of the encounter.');
    }

    return ['ok' => true, 'value' => $date];
}

/**
 * Resolve the attending doctor to store on a create/update.
 *
 * Doctor accounts: bound to their own linked profile. They may adopt an unattributed record
 * (existing = null) for themselves but can never re-attribute a record already assigned to
 * another doctor. Admins may assign any existing doctor, but cannot clear an assigned doctor.
 *
 * @param string|null $requested  Requested attending doctor ('' / null = not specified)
 * @param bool        $provided   Whether the client sent the field at all
 * @param string|null $existing   Currently stored attending doctor (null for create)
 * @return array{ok: true, doctorId: string|null}|array<string, mixed>
 */
function resolveAttendingDoctorForWrite(PDO $pdo, array $user, ?string $requested, bool $provided, ?string $existing): array
{
    $requested = ($requested === null || trim($requested) === '') ? null : strtoupper(trim($requested));
    if ($requested !== null && preg_match('/^D-\d{3,}$/', $requested) !== 1) {
        return medicalRecordFail(400, 'Attending doctor ID is invalid.');
    }

    if (($user['role'] ?? '') === 'doctor') {
        $own = findDoctorIdForUser($pdo, (string) $user['id']);
        if ($own === null) {
            return medicalRecordFail(403, 'Your account is not linked to a doctor profile, so you cannot author clinical records.');
        }

        if ($existing !== null) {
            if ($provided && $requested === null) {
                return medicalRecordFail(400, 'The attending doctor cannot be removed once assigned.');
            }
            if ($requested !== null && $requested !== $existing) {
                return medicalRecordFail(403, 'Doctors cannot change the attending doctor of an existing record.');
            }
            return ['ok' => true, 'doctorId' => $existing];
        }

        if ($requested !== null && $requested !== $own) {
            return medicalRecordFail(403, 'Doctors can only author records under their own doctor profile.');
        }
        return ['ok' => true, 'doctorId' => $own];
    }

    // admin
    if ($existing !== null) {
        if (!$provided) {
            return ['ok' => true, 'doctorId' => $existing];
        }
        if ($requested === null) {
            return medicalRecordFail(400, 'The attending doctor cannot be removed once assigned.');
        }
    }
    if ($requested === null) {
        return ['ok' => true, 'doctorId' => null];
    }

    $chk = $pdo->prepare('SELECT id FROM doctors WHERE id = :id LIMIT 1');
    $chk->execute([':id' => $requested]);
    if (!$chk->fetch()) {
        return medicalRecordFail(400, 'Attending doctor not found.');
    }

    return ['ok' => true, 'doctorId' => $requested];
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

/**
 * Append a revision-history entry. Intended to be called inside the same transaction
 * as the record change it describes. Throws on failure so the caller rolls back.
 */
function appendMedicalRecordHistory(PDO $pdo, string $recordId, string $updatedBy, string $summary, string $timestamp): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO medical_record_history (medical_record_id, updated_by, updated_at, summary)
         VALUES (:rid, :by, :at, :summary)'
    );
    $stmt->execute([
        ':rid'     => $recordId,
        ':by'      => mb_substr($updatedBy, 0, 150),
        ':at'      => $timestamp,
        ':summary' => $summary,
    ]);

    if ($stmt->rowCount() !== 1) {
        throw new RuntimeException('Failed to write medical record history entry.');
    }
}

// -----------------------------------------------------------------------------
// Transactional writers
// -----------------------------------------------------------------------------

/**
 * Create a clinical encounter (diagnosis + treatment). Admin/doctor only (enforced by caller).
 *
 * @param array<string, mixed> $user  Authenticated safe user
 * @param array<string, mixed> $input Request body
 * @return array<string, mixed> ['ok'=>true,'recordId'=>...] or failure ['ok'=>false,'status'=>..,'message'=>..]
 */
function createClinicalRecord(PDO $pdo, array $user, array $input): array
{
    $patientId = strtoupper(trim((string) ($input['patientId'] ?? '')));
    if (preg_match('/^P-\d{3,}$/', $patientId) !== 1) {
        return medicalRecordFail(400, 'A valid Patient ID is required.');
    }

    $text = validateClinicalTextFields($input);
    if (empty($text['ok'])) {
        return $text;
    }

    $today    = date('Y-m-d');
    $followUp = validateFollowUpDate($input['followUpDate'] ?? null, $today);
    if (empty($followUp['ok'])) {
        return $followUp;
    }

    $vitals = [];
    if (isset($input['vitals']) && is_array($input['vitals']) && $input['vitals'] !== []) {
        $vCheck = validateVitalsPayload($input['vitals']);
        if (!$vCheck['ok']) {
            return medicalRecordFail(400, $vCheck['message'], ['errors' => $vCheck['errors']]);
        }
        $vitals = $vCheck['vitals'];
    }

    $appointmentId = strtoupper(trim((string) ($input['appointmentId'] ?? '')));
    if ($appointmentId !== '' && preg_match('/^A-\d{3,}$/', $appointmentId) !== 1) {
        return medicalRecordFail(400, 'Appointment ID is invalid.');
    }

    $requestedDoctor = array_key_exists('attendingDoctorId', $input) && is_scalar($input['attendingDoctorId'])
        ? (string) $input['attendingDoctorId']
        : null;

    $abort = static function (int $status, string $message) use ($pdo): array {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return medicalRecordFail($status, $message);
    };

    $pdo->beginTransaction();
    try {
        // Lock the patient row: serialises concurrent writes for the same patient.
        $ps = $pdo->prepare('SELECT id, status FROM patients WHERE id = :id FOR UPDATE');
        $ps->execute([':id' => $patientId]);
        $patient = $ps->fetch();
        if (!is_array($patient)) {
            return $abort(404, 'Patient not found.');
        }
        if ((string) $patient['status'] !== 'verified') {
            return $abort(400, 'Medical records can only be created for verified patients.');
        }

        $doc = resolveAttendingDoctorForWrite($pdo, $user, $requestedDoctor, true, null);
        if (empty($doc['ok'])) {
            return $abort((int) $doc['status'], (string) $doc['message']);
        }

        if ($appointmentId !== '') {
            $as = $pdo->prepare('SELECT id, patient_id, status FROM appointments WHERE id = :id FOR UPDATE');
            $as->execute([':id' => $appointmentId]);
            $appt = $as->fetch();
            if (!is_array($appt)) {
                return $abort(404, 'Appointment not found.');
            }
            if ((string) $appt['patient_id'] !== $patientId) {
                return $abort(400, 'The appointment belongs to a different patient.');
            }
            if ((string) $appt['status'] === 'Cancelled') {
                return $abort(400, 'Cannot create a medical record for a cancelled appointment.');
            }
            $dup = $pdo->prepare('SELECT id FROM medical_records WHERE appointment_id = :aid LIMIT 1');
            $dup->execute([':aid' => $appointmentId]);
            if ($dup->fetch()) {
                return $abort(409, 'A medical record already exists for this appointment.');
            }
        }

        $recordId = allocateNextId($pdo, 'medicalRecords', 'medical_records', 'M', 3);
        $nowStr   = date('Y-m-d H:i:s');

        $ins = $pdo->prepare(
            'INSERT INTO medical_records (
                id, patient_id, appointment_id, attending_doctor_id, chief_complaint,
                vital_bp, vital_heart_rate, vital_temperature, vital_resp_rate,
                vital_weight_kg, vital_height_cm, vital_spo2,
                diagnosis, treatment_notes, follow_up_date, created_by, created_at, updated_at
            ) VALUES (
                :id, :patient_id, :appointment_id, :doctor_id, :complaint,
                :bp, :hr, :temp, :resp, :weight, :height, :spo2,
                :diagnosis, :treatment, :follow_up, :created_by, :created_at, :updated_at
            )'
        );
        $ins->execute([
            ':id'             => $recordId,
            ':patient_id'     => $patientId,
            ':appointment_id' => $appointmentId !== '' ? $appointmentId : null,
            ':doctor_id'      => $doc['doctorId'],
            ':complaint'      => $text['chiefComplaint'],
            ':bp'             => $vitals['bp'] ?? null,
            ':hr'             => $vitals['heartRate'] ?? null,
            ':temp'           => $vitals['temperature'] ?? null,
            ':resp'           => $vitals['respRate'] ?? null,
            ':weight'         => $vitals['weightKg'] ?? null,
            ':height'         => $vitals['heightCm'] ?? null,
            ':spo2'           => $vitals['spo2'] ?? null,
            ':diagnosis'      => $text['diagnosis'],
            ':treatment'      => $text['treatmentNotes'],
            ':follow_up'      => $followUp['value'],
            ':created_by'     => (string) $user['id'],
            ':created_at'     => $nowStr,
            ':updated_at'     => $nowStr,
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    return ['ok' => true, 'recordId' => $recordId, 'patientId' => $patientId];
}

/**
 * Update an existing clinical record and append its history entry in ONE transaction.
 * If either statement fails both are rolled back and the exception is re-thrown.
 *
 * @param array<string, mixed> $user
 * @param array<string, mixed> $input
 * @param (callable(PDO,string,string,string,string):void)|null $historyAppender  Test seam; defaults to appendMedicalRecordHistory().
 * @return array<string, mixed> ['ok'=>true,'changed'=>bool,'recordId'=>..] or failure
 */
function updateClinicalRecord(PDO $pdo, array $user, string $recordId, array $input, ?callable $historyAppender = null): array
{
    $historyAppender ??= 'appendMedicalRecordHistory';

    $text = validateClinicalTextFields($input);
    if (empty($text['ok'])) {
        return $text;
    }

    $abort = static function (int $status, string $message) use ($pdo): array {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return medicalRecordFail($status, $message);
    };

    $pdo->beginTransaction();
    try {
        $lock = $pdo->prepare('SELECT * FROM medical_records WHERE id = :id FOR UPDATE');
        $lock->execute([':id' => $recordId]);
        $existing = $lock->fetch();
        if (!is_array($existing)) {
            return $abort(404, 'Medical record not found.');
        }

        // The patient and appointment link of an encounter are immutable (prevents mis-association).
        if (array_key_exists('patientId', $input) && $input['patientId'] !== null && $input['patientId'] !== ''
            && strtoupper(trim((string) $input['patientId'])) !== (string) $existing['patient_id']) {
            return $abort(400, 'A medical record cannot be moved to a different patient.');
        }
        if (array_key_exists('appointmentId', $input)) {
            $reqAppt = strtoupper(trim((string) ($input['appointmentId'] ?? '')));
            $curAppt = (string) ($existing['appointment_id'] ?? '');
            if ($reqAppt !== '' && $reqAppt !== $curAppt) {
                return $abort(400, 'The appointment link of a medical record cannot be changed.');
            }
        }

        // Optimistic concurrency: reject if someone else changed the record since the client loaded it.
        if (array_key_exists('expectedUpdatedAt', $input) && is_string($input['expectedUpdatedAt']) && trim($input['expectedUpdatedAt']) !== '') {
            $expected = str_replace('T', ' ', trim($input['expectedUpdatedAt']));
            if ($expected !== (string) $existing['updated_at']) {
                return $abort(409, 'This record was modified by someone else after you opened it. Please reload and try again.');
            }
        }

        $createdDate = substr((string) $existing['created_at'], 0, 10);
        $followUp    = array_key_exists('followUpDate', $input)
            ? validateFollowUpDate($input['followUpDate'], $createdDate)
            : ['ok' => true, 'value' => $existing['follow_up_date'] !== null ? (string) $existing['follow_up_date'] : null];
        if (empty($followUp['ok'])) {
            return $abort((int) $followUp['status'], (string) $followUp['message']);
        }

        $existingDoctor = $existing['attending_doctor_id'] !== null ? (string) $existing['attending_doctor_id'] : null;
        $requestedDoctor = array_key_exists('attendingDoctorId', $input) && (is_scalar($input['attendingDoctorId']) || $input['attendingDoctorId'] === null)
            ? ($input['attendingDoctorId'] === null ? null : (string) $input['attendingDoctorId'])
            : null;
        $doc = resolveAttendingDoctorForWrite(
            $pdo,
            $user,
            $requestedDoctor,
            array_key_exists('attendingDoctorId', $input),
            $existingDoctor
        );
        if (empty($doc['ok'])) {
            return $abort((int) $doc['status'], (string) $doc['message']);
        }

        $newComplaint = array_key_exists('chiefComplaint', $input) ? $text['chiefComplaint'] : (string) $existing['chief_complaint'];

        $changed = [];
        if ($newComplaint !== (string) $existing['chief_complaint']) {
            $changed[] = 'chief complaint';
        }
        if ($text['diagnosis'] !== (string) ($existing['diagnosis'] ?? '')) {
            $changed[] = 'diagnosis';
        }
        if ($text['treatmentNotes'] !== (string) ($existing['treatment_notes'] ?? '')) {
            $changed[] = 'treatment notes';
        }
        if ($followUp['value'] !== ($existing['follow_up_date'] !== null ? (string) $existing['follow_up_date'] : null)) {
            $changed[] = 'follow-up date';
        }
        if ($doc['doctorId'] !== $existingDoctor) {
            $changed[] = 'attending doctor';
        }

        if ($changed === []) {
            $pdo->rollBack();
            return ['ok' => true, 'changed' => false, 'recordId' => $recordId];
        }

        $nowStr = date('Y-m-d H:i:s');
        $upd = $pdo->prepare(
            'UPDATE medical_records
             SET chief_complaint = :complaint,
                 diagnosis = :diagnosis,
                 treatment_notes = :treatment,
                 follow_up_date = :follow_up,
                 attending_doctor_id = :doctor_id,
                 updated_at = :updated_at
             WHERE id = :id'
        );
        $upd->execute([
            ':complaint'  => $newComplaint,
            ':diagnosis'  => $text['diagnosis'],
            ':treatment'  => $text['treatmentNotes'],
            ':follow_up'  => $followUp['value'],
            ':doctor_id'  => $doc['doctorId'],
            ':updated_at' => $nowStr,
            ':id'         => $recordId,
        ]);

        $historyAppender(
            $pdo,
            $recordId,
            (string) $user['fullName'],
            'Record updated: ' . implode(', ', $changed) . '.',
            $nowStr
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    return ['ok' => true, 'changed' => true, 'recordId' => $recordId, 'changedFields' => $changed];
}

/**
 * Record / update vitals for a patient.
 *
 * Updates the patient's most recent encounter created today (history entry appended in the same
 * transaction); if none exists creates a clearly designated "Vitals check" encounter. The patient
 * row is locked first so concurrent requests cannot create duplicate "Vitals check" encounters.
 *
 * @param array<string, mixed>        $user
 * @param array<string, string|int|float> $vitals  Output of validateVitalsPayload()['vitals']
 * @param (callable(PDO,string,string,string,string):void)|null $historyAppender Test seam.
 * @return array<string, mixed> ['ok'=>true,'recordId'=>..,'created'=>bool,'changed'=>bool] or failure
 */
function saveVitalsRecord(PDO $pdo, array $user, string $patientId, array $vitals, ?callable $historyAppender = null): array
{
    $historyAppender ??= 'appendMedicalRecordHistory';

    $abort = static function (int $status, string $message) use ($pdo): array {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return medicalRecordFail($status, $message);
    };

    $pdo->beginTransaction();
    try {
        $ps = $pdo->prepare('SELECT id, status FROM patients WHERE id = :id FOR UPDATE');
        $ps->execute([':id' => $patientId]);
        $patient = $ps->fetch();
        if (!is_array($patient)) {
            return $abort(404, 'Patient not found.');
        }
        if ((string) $patient['status'] !== 'verified') {
            return $abort(400, 'Vitals can only be recorded for verified patients.');
        }

        $today = date('Y-m-d');
        $find  = $pdo->prepare(
            'SELECT * FROM medical_records
             WHERE patient_id = :pid AND created_at >= :start AND created_at <= :end
             ORDER BY created_at DESC, id DESC
             LIMIT 1
             FOR UPDATE'
        );
        $find->execute([':pid' => $patientId, ':start' => $today . ' 00:00:00', ':end' => $today . ' 23:59:59']);
        $existing = $find->fetch();
        $nowStr   = date('Y-m-d H:i:s');

        if (is_array($existing)) {
            $changedLabels = [];
            $setParts      = [];
            $params        = [':id' => (string) $existing['id'], ':updated_at' => $nowStr];

            foreach (PRIMECARE_VITAL_FIELDS as $key => [$col, $label, $type]) {
                if (!array_key_exists($key, $vitals)) {
                    continue;
                }
                $old = $existing[$col];
                $new = $vitals[$key];
                $same = $old !== null && (
                    $type === 'bp'
                        ? (string) $old === (string) $new
                        : abs((float) $old - (float) $new) < 1e-9
                );
                if ($same) {
                    continue;
                }
                $setParts[]            = "{$col} = :{$col}";
                $params[":{$col}"]     = $new;
                $changedLabels[]       = $label;
            }

            if ($setParts === []) {
                $pdo->rollBack();
                return ['ok' => true, 'recordId' => (string) $existing['id'], 'created' => false, 'changed' => false];
            }

            $upd = $pdo->prepare(
                'UPDATE medical_records SET ' . implode(', ', $setParts) . ', updated_at = :updated_at WHERE id = :id'
            );
            $upd->execute($params);

            $historyAppender(
                $pdo,
                (string) $existing['id'],
                (string) $user['fullName'],
                'Vitals updated: ' . implode(', ', $changedLabels) . '.',
                $nowStr
            );

            $pdo->commit();
            return ['ok' => true, 'recordId' => (string) $existing['id'], 'created' => false, 'changed' => true];
        }

        // No encounter today: create a designated "Vitals check" encounter.
        $attendingDoctor = null;
        if (($user['role'] ?? '') === 'doctor') {
            $attendingDoctor = findDoctorIdForUser($pdo, (string) $user['id']);
        }

        $recordId = allocateNextId($pdo, 'medicalRecords', 'medical_records', 'M', 3);
        $ins = $pdo->prepare(
            'INSERT INTO medical_records (
                id, patient_id, appointment_id, attending_doctor_id, chief_complaint,
                vital_bp, vital_heart_rate, vital_temperature, vital_resp_rate,
                vital_weight_kg, vital_height_cm, vital_spo2,
                diagnosis, treatment_notes, follow_up_date, created_by, created_at, updated_at
            ) VALUES (
                :id, :patient_id, NULL, :doctor_id, :complaint,
                :bp, :hr, :temp, :resp, :weight, :height, :spo2,
                NULL, NULL, NULL, :created_by, :created_at, :updated_at
            )'
        );
        $ins->execute([
            ':id'         => $recordId,
            ':patient_id' => $patientId,
            ':doctor_id'  => $attendingDoctor,
            ':complaint'  => 'Vitals check',
            ':bp'         => $vitals['bp'] ?? null,
            ':hr'         => $vitals['heartRate'] ?? null,
            ':temp'       => $vitals['temperature'] ?? null,
            ':resp'       => $vitals['respRate'] ?? null,
            ':weight'     => $vitals['weightKg'] ?? null,
            ':height'     => $vitals['heightCm'] ?? null,
            ':spo2'       => $vitals['spo2'] ?? null,
            ':created_by' => (string) $user['id'],
            ':created_at' => $nowStr,
            ':updated_at' => $nowStr,
        ]);

        $pdo->commit();
        return ['ok' => true, 'recordId' => $recordId, 'created' => true, 'changed' => true];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

