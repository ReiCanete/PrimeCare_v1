<?php
/**
 * PrimeCare - Lab Results Helpers, Serializers, Validators & Writers
 * Phase 5.10.2: Lab Results Backend Implementation & Integration
 *
 * Tables used (no schema changes):
 * - `lab_results`
 * - `patients`
 * - `doctors`
 * - `bills`
 * - `audit_logs`
 * - `sequences`
 *
 * Design notes
 * ------------
 * - Result entry is write-once. `updateLabResultRecord()` only accepts `Ordered` records; any
 *   `Completed` or billed record is protected and answers HTTP 409. There is intentionally no
 *   correction/override workflow in this phase.
 * - When a numeric result and a usable reference range are supplied, the computed flag is
 *   authoritative. A manual flag that conflicts with it is rejected (HTTP 422). A manual flag is
 *   only honoured when no usable range exists (qualitative results, or numeric result with no range).
 * - Physician review LIMITATION: the existing `lab_results` schema has no reviewed_by / reviewed_at
 *   columns and this phase may not alter the schema. A review is therefore recorded ONLY as an
 *   `audit_logs` row (action = 'Review Lab Result'). It is idempotent (first reviewer wins, repeat
 *   calls write nothing) but the review state is not exposed on list/get responses.
 * - The optional `$failureInjector` callable accepted by the transactional writers exists solely so
 *   tests can force a failure INSIDE the real transaction (after the writes, before commit). No API
 *   endpoint ever passes one.
 */

declare(strict_types=1);

// Prevent direct HTTP access
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

// Clinical write & read roles
const PRIMECARE_LAB_READ_ROLES   = ['admin', 'doctor', 'nurse', 'patient'];
const PRIMECARE_LAB_ORDER_ROLES  = ['admin', 'doctor'];
const PRIMECARE_LAB_UPDATE_ROLES = ['admin', 'doctor', 'nurse'];
const PRIMECARE_LAB_REVIEW_ROLES = ['admin', 'doctor'];

// Allowed statuses, flags and categories
const PRIMECARE_LAB_STATUSES   = ['Ordered', 'Completed'];
const PRIMECARE_LAB_FLAGS      = ['Normal', 'Abnormal', 'Critical'];
const PRIMECARE_LAB_CATEGORIES = ['Hematology', 'Chemistry', 'Imaging', 'Urinalysis', 'Other'];

// Maximum field lengths
const PRIMECARE_LAB_MAX_TEST_LEN   = 150;
const PRIMECARE_LAB_MAX_RESULT_LEN = 100;
const PRIMECARE_LAB_MAX_UNIT_LEN   = 50;
const PRIMECARE_LAB_MAX_ATTACH_LEN = 255;

// Reference range bounds (lab_results.ref_range_* are DECIMAL(10,2))
const PRIMECARE_LAB_REF_ABS_MAX = 99999999.99;

// List pagination & sorting
const PRIMECARE_LAB_DEFAULT_PAGE_SIZE = 50;
const PRIMECARE_LAB_MAX_PAGE_SIZE     = 100;
const PRIMECARE_LAB_SORT_COLUMNS      = [
    'orderedDate' => 'l.ordered_date',
    'resultDate'  => 'l.result_date',
    'id'          => 'l.id',
    'testName'    => 'l.test_name',
    'category'    => 'l.category',
    'status'      => 'l.status',
    'flag'        => 'l.flag',
    'patientName' => 'patient_name',
];

// -----------------------------------------------------------------------------
// Serialization Helpers
// -----------------------------------------------------------------------------

/**
 * Serialize a database row from lab_results into frontend-compatible camelCase format.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function serializeLabResult(array $row): array
{
    $refMin = $row['ref_range_min'] !== null ? (float) $row['ref_range_min'] : null;
    $refMax = $row['ref_range_max'] !== null ? (float) $row['ref_range_max'] : null;

    $refRangeObj = null;
    if ($refMin !== null && $refMax !== null) {
        $refRangeObj = [
            'min' => (string) $refMin,
            'max' => (string) $refMax,
        ];
    }

    return [
        'id'             => (string) $row['id'],
        'patientId'      => (string) $row['patient_id'],
        'patientName'    => (string) ($row['patient_name'] ?? 'Unknown'),
        'orderedBy'      => $row['ordered_by'] !== null ? (string) $row['ordered_by'] : null,
        'doctorName'     => $row['doctor_name'] !== null ? (string) $row['doctor_name'] : null,
        'testName'       => (string) $row['test_name'],
        'category'       => (string) $row['category'],
        'status'         => (string) $row['status'],
        'result'         => $row['result'] !== null ? (string) $row['result'] : null,
        'unit'           => $row['unit'] !== null ? (string) $row['unit'] : null,
        'referenceRange' => $refRangeObj,
        'refRangeMin'    => $refMin,
        'refRangeMax'    => $refMax,
        'flag'           => $row['flag'] !== null ? (string) $row['flag'] : null,
        'attachmentName' => $row['attachment_name'] !== null ? (string) $row['attachment_name'] : null,
        'orderedDate'    => (string) $row['ordered_date'],
        'resultDate'     => $row['result_date'] !== null ? (string) $row['result_date'] : null,
        'performedBy'    => $row['performed_by'] !== null ? (string) $row['performed_by'] : null,
        'billed'         => !empty($row['billed']),
        'billId'         => $row['bill_id'] !== null ? (string) $row['bill_id'] : null,
    ];
}

// -----------------------------------------------------------------------------
// Validation Helpers
// -----------------------------------------------------------------------------

/**
 * Map a submitted category onto its canonical spelling, or null when unsupported.
 */
function normalizeLabCategory(string $category): ?string
{
    foreach (PRIMECARE_LAB_CATEGORIES as $allowed) {
        if (strcasecmp($allowed, $category) === 0) {
            return $allowed;
        }
    }
    return null;
}

/**
 * Map a submitted flag onto its canonical spelling, or null when not one of the allowed flags.
 */
function normalizeLabFlag(string $flag): ?string
{
    foreach (PRIMECARE_LAB_FLAGS as $allowed) {
        if (strcasecmp($allowed, trim($flag)) === 0) {
            return $allowed;
        }
    }
    return null;
}

/** True when a raw range bound is absent (null or an empty / whitespace-only string). */
function labRangeBoundIsBlank(mixed $value): bool
{
    return $value === null || (is_string($value) && trim($value) === '');
}

/** Format a float without trailing zeros for validation messages. */
function labFormatNumber(float $value): string
{
    $text = rtrim(rtrim(number_format($value, 4, '.', ''), '0'), '.');
    return $text === '' || $text === '-0' ? '0' : $text;
}

/**
 * Extract and validate the reference range from a result-entry payload.
 *
 * Accepts the nested `referenceRange: { min, max }` form (frontend contract) or the flat
 * `refRangeMin` / `refRangeMax` form. Rules:
 * - both bounds blank        -> no range (ok, min = max = null)
 * - exactly one bound blank  -> rejected (partial range)
 * - a non-numeric bound      -> rejected
 * - bounds are rounded to 2 decimals so the flag is computed on exactly what is stored.
 *
 * @param array<string, mixed> $input
 * @return array{ok: bool, min?: float|null, max?: float|null, message?: string}
 */
function parseLabReferenceRange(array $input): array
{
    $rawMin = null;
    $rawMax = null;

    if (array_key_exists('referenceRange', $input) && !labRangeBoundIsBlank($input['referenceRange'])) {
        if (!is_array($input['referenceRange'])) {
            return ['ok' => false, 'message' => 'Reference range must be an object with numeric min and max values.'];
        }
        $rawMin = $input['referenceRange']['min'] ?? null;
        $rawMax = $input['referenceRange']['max'] ?? null;
    } else {
        $rawMin = $input['refRangeMin'] ?? null;
        $rawMax = $input['refRangeMax'] ?? null;
    }

    $minBlank = labRangeBoundIsBlank($rawMin);
    $maxBlank = labRangeBoundIsBlank($rawMax);

    if ($minBlank && $maxBlank) {
        return ['ok' => true, 'min' => null, 'max' => null];
    }
    if ($minBlank !== $maxBlank) {
        return [
            'ok'      => false,
            'message' => 'Partial reference range: provide both a minimum and a maximum, or neither.',
        ];
    }

    $bounds = [];
    foreach (['minimum' => $rawMin, 'maximum' => $rawMax] as $label => $raw) {
        if (is_string($raw)) {
            $raw = trim($raw);
        }
        if (!(is_int($raw) || is_float($raw) || (is_string($raw) && is_numeric($raw)))) {
            return ['ok' => false, 'message' => "Reference {$label} must be a number."];
        }
        $number = (float) $raw;
        if (!is_finite($number) || abs($number) > PRIMECARE_LAB_REF_ABS_MAX) {
            return ['ok' => false, 'message' => "Reference {$label} is out of the supported range."];
        }
        $bounds[$label] = round($number, 2);
    }

    return ['ok' => true, 'min' => $bounds['minimum'], 'max' => $bounds['maximum']];
}

// -----------------------------------------------------------------------------
// Automated Clinical Flag Calculation
// -----------------------------------------------------------------------------

/**
 * Calculate the clinical laboratory abnormality flag.
 *
 * With a numeric result AND a usable reference range the computed flag is authoritative:
 * - Normal:   min <= result <= max
 * - Critical: result < min - 0.30 * span  OR  result > max + 0.30 * span   (span = max - min)
 * - Abnormal: outside [min, max] but not critical (a value exactly on a critical threshold is Abnormal)
 * A manual flag that disagrees with the computed flag is rejected, never silently applied.
 *
 * Without a usable range (or with a non-numeric result) no threshold is invented: a valid explicit
 * flag is required and used as supplied.
 *
 * @param mixed $result
 * @param float|null $min
 * @param float|null $max
 * @param string|null $manualFlag
 * @return array{ok: bool, flag?: string, message?: string, conflict?: bool}
 */
function calculateLabFlag(mixed $result, ?float $min, ?float $max, ?string $manualFlag = null): array
{
    $manual = null;
    if ($manualFlag !== null && trim($manualFlag) !== '') {
        $manual = normalizeLabFlag($manualFlag);
        if ($manual === null) {
            return [
                'ok'      => false,
                'message' => 'Invalid abnormality flag. Allowed values: Normal, Abnormal, Critical.',
            ];
        }
    }

    // A half-specified range is malformed input, not "no range".
    if (($min === null) !== ($max === null)) {
        return [
            'ok'      => false,
            'message' => 'Partial reference range: provide both a minimum and a maximum, or neither.',
        ];
    }

    if ($min !== null && $max !== null) {
        if ($min >= $max) {
            return [
                'ok'      => false,
                'message' => 'Reference minimum must be strictly less than reference maximum.',
            ];
        }

        if ($result !== null && is_numeric($result)) {
            $value     = (float) $result;
            $threshold = ($max - $min) * 0.30;

            if ($value >= $min && $value <= $max) {
                $computed = 'Normal';
            } elseif ($value < ($min - $threshold) || $value > ($max + $threshold)) {
                $computed = 'Critical';
            } else {
                $computed = 'Abnormal';
            }

            if ($manual !== null && $manual !== $computed) {
                return [
                    'ok'       => false,
                    'conflict' => true,
                    'message'  => "The supplied flag ({$manual}) conflicts with the computed flag ({$computed}) for result "
                        . labFormatNumber($value) . ' against reference range '
                        . labFormatNumber($min) . ' - ' . labFormatNumber($max)
                        . '. Remove the manual flag to use the computed value.',
                ];
            }

            return ['ok' => true, 'flag' => $computed];
        }

        // Non-numeric result: a range cannot be evaluated, so an explicit flag is required.
        if ($manual !== null) {
            return ['ok' => true, 'flag' => $manual];
        }
        return [
            'ok'      => false,
            'message' => 'Non-numeric results require a valid manual flag (Normal, Abnormal, or Critical).',
        ];
    }

    // No usable reference range: never invent a threshold.
    if ($manual !== null) {
        return ['ok' => true, 'flag' => $manual];
    }

    return [
        'ok'      => false,
        'message' => 'An abnormality flag (Normal, Abnormal, or Critical) is required when reference ranges are not provided.',
    ];
}

// -----------------------------------------------------------------------------
// Query & Finder Helpers
// -----------------------------------------------------------------------------

/**
 * Fetch one page of lab results filtered by criteria and scoped by user role.
 *
 * Patient sessions are ALWAYS restricted to their own Completed records regardless of any submitted
 * filter. Page size is capped at PRIMECARE_LAB_MAX_PAGE_SIZE; `sortBy` is validated against an
 * allowlist (unknown values fall back to the default `orderedDate DESC`).
 *
 * @param PDO $pdo
 * @param array<string, mixed> $filters Filters plus optional page, limit, sortBy, sortDir.
 * @param array<string, mixed> $currentUser
 * @return array{labs: array<int, array<string, mixed>>, total: int, page: int, limit: int, totalPages: int, sortBy: string, sortDir: string}
 */
function fetchLabResults(PDO $pdo, array $filters, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');

    $from = '
        FROM lab_results l
        LEFT JOIN patients p ON p.id = l.patient_id
        LEFT JOIN doctors d  ON d.id = l.ordered_by
        WHERE 1 = 1
    ';
    $where  = '';
    $params = [];

    // Role-based scoping: patients can ONLY view their own Completed records
    if ($role === 'patient') {
        $where .= ' AND l.patient_id = :patient_id AND l.status = "Completed"';
        $params[':patient_id'] = (string) ($currentUser['patient_id'] ?? '');
    } else {
        if (!empty($filters['patientId'])) {
            $where .= ' AND l.patient_id = :patient_id';
            $params[':patient_id'] = (string) $filters['patientId'];
        }
    }

    if (!empty($filters['status']) && $filters['status'] !== 'All') {
        $where .= ' AND l.status = :status';
        $params[':status'] = (string) $filters['status'];
    }

    if (!empty($filters['doctorId']) && $filters['doctorId'] !== 'All') {
        $where .= ' AND l.ordered_by = :ordered_by';
        $params[':ordered_by'] = (string) $filters['doctorId'];
    }

    if (!empty($filters['category']) && $filters['category'] !== 'All') {
        $where .= ' AND l.category = :category';
        $params[':category'] = (string) $filters['category'];
    }

    if (!empty($filters['flag']) && $filters['flag'] !== 'All') {
        $where .= ' AND l.flag = :flag';
        $params[':flag'] = (string) $filters['flag'];
    }

    if (!empty($filters['dateFrom'])) {
        $where .= ' AND l.ordered_date >= :date_from';
        $params[':date_from'] = (string) $filters['dateFrom'];
    }

    if (!empty($filters['dateTo'])) {
        $where .= ' AND l.ordered_date <= :date_to';
        $params[':date_to'] = (string) $filters['dateTo'];
    }

    if (!empty($filters['keyword'])) {
        $kw = '%' . trim((string) $filters['keyword']) . '%';
        $where .= ' AND (
            l.id LIKE :kw1
            OR CONCAT(p.first_name, " ", p.last_name) LIKE :kw2
            OR l.test_name LIKE :kw3
            OR l.category LIKE :kw4
        )';
        $params[':kw1'] = $kw;
        $params[':kw2'] = $kw;
        $params[':kw3'] = $kw;
        $params[':kw4'] = $kw;
    }

    // Pagination (clamped) and sorting (allowlisted)
    $page  = max(1, (int) ($filters['page'] ?? 1));
    $limit = (int) ($filters['limit'] ?? PRIMECARE_LAB_DEFAULT_PAGE_SIZE);
    if ($limit < 1) {
        $limit = PRIMECARE_LAB_DEFAULT_PAGE_SIZE;
    }
    $limit  = min($limit, PRIMECARE_LAB_MAX_PAGE_SIZE);
    $offset = ($page - 1) * $limit;

    $sortKey = (string) ($filters['sortBy'] ?? '');
    if (!array_key_exists($sortKey, PRIMECARE_LAB_SORT_COLUMNS)) {
        $sortKey = 'orderedDate';
    }
    $sortDir = strtolower((string) ($filters['sortDir'] ?? 'desc')) === 'asc' ? 'ASC' : 'DESC';

    $orderBy = PRIMECARE_LAB_SORT_COLUMNS[$sortKey] . ' ' . $sortDir;
    if ($sortKey !== 'id') {
        $orderBy .= ', l.id DESC';
    }

    // Total matching rows (for pagination metadata)
    $countStmt = $pdo->prepare('SELECT COUNT(*) ' . $from . $where);
    foreach ($params as $name => $value) {
        $countStmt->bindValue($name, $value, PDO::PARAM_STR);
    }
    $countStmt->execute();
    $total = (int) $countStmt->fetchColumn();

    $stmt = $pdo->prepare(
        'SELECT l.*, CONCAT(p.first_name, " ", p.last_name) AS patient_name, d.name AS doctor_name '
        . $from . $where
        . ' ORDER BY ' . $orderBy
        . ' LIMIT :page_limit OFFSET :page_offset'
    );
    foreach ($params as $name => $value) {
        $stmt->bindValue($name, $value, PDO::PARAM_STR);
    }
    $stmt->bindValue(':page_limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':page_offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    return [
        'labs'       => array_map('serializeLabResult', $rows),
        'total'      => $total,
        'page'       => $page,
        'limit'      => $limit,
        'totalPages' => $total > 0 ? (int) ceil($total / $limit) : 0,
        'sortBy'     => $sortKey,
        'sortDir'    => strtolower($sortDir),
    ];
}

/**
 * Retrieve a single lab result by ID with authorization / IDOR verification.
 *
 * @param PDO $pdo
 * @param string $id
 * @param array<string, mixed>|null $currentUser
 * @return array{ok: bool, status: int, message: string, lab?: array<string, mixed>}
 */
function findLabResultById(PDO $pdo, string $id, ?array $currentUser = null): array
{
    $stmt = $pdo->prepare('
        SELECT
            l.*,
            CONCAT(p.first_name, " ", p.last_name) AS patient_name,
            d.name AS doctor_name
        FROM lab_results l
        LEFT JOIN patients p ON p.id = l.patient_id
        LEFT JOIN doctors d  ON d.id = l.ordered_by
        WHERE l.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        return [
            'ok'      => false,
            'status'  => 404,
            'message' => 'Lab result not found.',
        ];
    }

    // Patient IDOR & status protection
    if ($currentUser !== null && ($currentUser['role'] ?? '') === 'patient') {
        $ownPatientId = (string) ($currentUser['patient_id'] ?? '');
        if ((string) $row['patient_id'] !== $ownPatientId) {
            return [
                'ok'      => false,
                'status'  => 403,
                'message' => 'Forbidden. You do not have permission to view this lab result.',
            ];
        }
        if ((string) $row['status'] !== 'Completed') {
            return [
                'ok'      => false,
                'status'  => 403,
                'message' => 'Forbidden. Patients may only view completed laboratory results.',
            ];
        }
    }

    return [
        'ok'      => true,
        'status'  => 200,
        'message' => 'Lab result retrieved successfully.',
        'lab'     => serializeLabResult($row),
    ];
}

// -----------------------------------------------------------------------------
// Transactional Writers
// -----------------------------------------------------------------------------

/**
 * Create a new laboratory test order.
 *
 * @param PDO $pdo
 * @param array<string, mixed> $input
 * @param array<string, mixed> $currentUser
 * @param callable|null $failureInjector Test hook, invoked inside the transaction after all writes
 *                                       and before commit as ($stage, $labId). Throwing from it
 *                                       forces the real rollback path. Never set by endpoints.
 * @return array{ok: bool, status: int, message: string, lab?: array<string, mixed>}
 */
function createLabOrderRecord(PDO $pdo, array $input, array $currentUser, ?callable $failureInjector = null): array
{
    $role = (string) ($currentUser['role'] ?? '');
    if (!in_array($role, PRIMECARE_LAB_ORDER_ROLES, true)) {
        return [
            'ok'      => false,
            'status'  => 403,
            'message' => 'Forbidden. Only doctors and administrators can order laboratory tests.',
        ];
    }

    $patientId = strtoupper(trim((string) ($input['patientId'] ?? '')));
    $testName  = trim((string) ($input['testName'] ?? ''));
    $category  = trim((string) ($input['category'] ?? ''));

    if ($patientId === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'Patient ID is required.'];
    }
    if ($testName === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'Test name is required.'];
    }
    if (mb_strlen($testName) > PRIMECARE_LAB_MAX_TEST_LEN) {
        return ['ok' => false, 'status' => 400, 'message' => 'Test name must not exceed ' . PRIMECARE_LAB_MAX_TEST_LEN . ' characters.'];
    }
    if ($category === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'Category is required.'];
    }
    $canonicalCategory = normalizeLabCategory($category);
    if ($canonicalCategory === null) {
        return [
            'ok'      => false,
            'status'  => 422,
            'message' => 'Unsupported category. Allowed categories: ' . implode(', ', PRIMECARE_LAB_CATEGORIES) . '.',
        ];
    }

    // Validate patient existence and status (must be verified)
    $patientStmt = $pdo->prepare('SELECT id, status, first_name, last_name FROM patients WHERE id = :pid LIMIT 1');
    $patientStmt->execute([':pid' => $patientId]);
    $patient = $patientStmt->fetch(PDO::FETCH_ASSOC);

    if (!$patient) {
        return ['ok' => false, 'status' => 404, 'message' => "Patient {$patientId} not found."];
    }
    if (strtolower((string) $patient['status']) !== 'verified') {
        return [
            'ok'      => false,
            'status'  => 422,
            'message' => "Cannot order laboratory tests for patient with status '{$patient['status']}'. Patient must be verified.",
        ];
    }

    // Determine ordering doctor ID (doctors are locked to their own profile)
    $doctorId = null;
    if ($role === 'doctor') {
        $docStmt = $pdo->prepare('SELECT id FROM doctors WHERE user_id = :uid LIMIT 1');
        $docStmt->execute([':uid' => $currentUser['id']]);
        $doc = $docStmt->fetch(PDO::FETCH_ASSOC);
        if (!$doc) {
            return ['ok' => false, 'status' => 403, 'message' => 'No linked doctor profile found for current user.'];
        }
        $doctorId = (string) $doc['id'];
    } elseif (!empty($input['orderedBy'])) {
        $chkDoc = $pdo->prepare('SELECT id FROM doctors WHERE id = :did LIMIT 1');
        $chkDoc->execute([':did' => trim((string) $input['orderedBy'])]);
        if ($chkDoc->fetch()) {
            $doctorId = trim((string) $input['orderedBy']);
        }
    }

    try {
        $pdo->beginTransaction();

        $labId = allocateNextId($pdo, 'labResults', 'lab_results', 'LAB', 3);

        $ins = $pdo->prepare('
            INSERT INTO lab_results (
                id, patient_id, ordered_by, test_name, category,
                status, result, unit, ref_range_min, ref_range_max,
                flag, attachment_name, ordered_date, result_date,
                performed_by, billed, bill_id
            ) VALUES (
                :id, :patient_id, :ordered_by, :test_name, :category,
                "Ordered", NULL, NULL, NULL, NULL,
                NULL, NULL, CURDATE(), NULL,
                NULL, 0, NULL
            )
        ');
        $ins->execute([
            ':id'         => $labId,
            ':patient_id' => $patientId,
            ':ordered_by' => $doctorId,
            ':test_name'  => $testName,
            ':category'   => $canonicalCategory,
        ]);

        writeAuthAuditLog(
            (string) ($currentUser['id'] ?? 'SYSTEM'),
            (string) ($currentUser['username'] ?? 'unknown'),
            'Create Lab Order',
            "Ordered test {$testName} ({$labId}) for patient {$patientId}"
        );

        if ($failureInjector !== null) {
            $failureInjector('create:before-commit', $labId);
        }

        $pdo->commit();

        $created = findLabResultById($pdo, $labId, $currentUser);
        return [
            'ok'      => true,
            'status'  => 201,
            'message' => 'Lab test ordered successfully.',
            'lab'     => $created['lab'] ?? null,
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('createLabOrderRecord error: ' . $e->getMessage());
        return [
            'ok'      => false,
            'status'  => 500,
            'message' => 'Failed to create laboratory test order.',
        ];
    }
}

/**
 * Enter results and complete an existing laboratory test (write-once).
 *
 * Only `Ordered` records can be completed. A `Completed` or billed record is protected and returns
 * HTTP 409; there is no correction workflow.
 *
 * @param PDO $pdo
 * @param string $id
 * @param array<string, mixed> $input
 * @param array<string, mixed> $currentUser
 * @param callable|null $failureInjector Test hook, see createLabOrderRecord().
 * @return array{ok: bool, status: int, message: string, lab?: array<string, mixed>}
 */
function updateLabResultRecord(PDO $pdo, string $id, array $input, array $currentUser, ?callable $failureInjector = null): array
{
    $role = (string) ($currentUser['role'] ?? '');
    if (!in_array($role, PRIMECARE_LAB_UPDATE_ROLES, true)) {
        return [
            'ok'      => false,
            'status'  => 403,
            'message' => 'Forbidden. Only doctors, nurses, and administrators can enter laboratory results.',
        ];
    }

    if (!isset($input['result']) || !(is_string($input['result']) || is_int($input['result']) || is_float($input['result']))) {
        return ['ok' => false, 'status' => 400, 'message' => 'Result value is required.'];
    }
    $resultVal = trim((string) $input['result']);
    if ($resultVal === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'Result value is required.'];
    }
    if (mb_strlen($resultVal) > PRIMECARE_LAB_MAX_RESULT_LEN) {
        return ['ok' => false, 'status' => 400, 'message' => 'Result must not exceed ' . PRIMECARE_LAB_MAX_RESULT_LEN . ' characters.'];
    }

    $unitRaw = $input['unit'] ?? '';
    if (!is_string($unitRaw) && !is_int($unitRaw) && !is_float($unitRaw) && $unitRaw !== null) {
        return ['ok' => false, 'status' => 400, 'message' => 'Unit must be text.'];
    }
    $unit = trim((string) $unitRaw);
    if (mb_strlen($unit) > PRIMECARE_LAB_MAX_UNIT_LEN) {
        return ['ok' => false, 'status' => 400, 'message' => 'Unit must not exceed ' . PRIMECARE_LAB_MAX_UNIT_LEN . ' characters.'];
    }

    // Reference range: malformed or partial ranges are rejected, never silently dropped.
    $range = parseLabReferenceRange($input);
    if (empty($range['ok'])) {
        return ['ok' => false, 'status' => 422, 'message' => (string) $range['message']];
    }
    $refMin = $range['min'];
    $refMax = $range['max'];

    $manualFlag = null;
    if (array_key_exists('flag', $input) && $input['flag'] !== null) {
        if (!is_string($input['flag'])) {
            return ['ok' => false, 'status' => 422, 'message' => 'Invalid abnormality flag. Allowed values: Normal, Abnormal, Critical.'];
        }
        $manualFlag = $input['flag'];
    }

    // Clinical flagging: the computed flag is authoritative when a range exists.
    $flagCalc = calculateLabFlag($resultVal, $refMin, $refMax, $manualFlag);
    if (empty($flagCalc['ok'])) {
        return [
            'ok'      => false,
            'status'  => 422,
            'message' => (string) ($flagCalc['message'] ?? 'Invalid laboratory values.'),
        ];
    }
    $finalFlag = (string) $flagCalc['flag'];

    // Sanitized attachment filename
    $attachment = null;
    if (!empty($input['attachmentName']) && is_string($input['attachmentName'])) {
        $rawAttach = basename(str_replace('\\', '/', trim($input['attachmentName'])));
        if ($rawAttach !== '') {
            $attachment = mb_substr($rawAttach, 0, PRIMECARE_LAB_MAX_ATTACH_LEN);
        }
    }

    $performer = trim((string) ($currentUser['fullName'] ?? $currentUser['full_name'] ?? $currentUser['username'] ?? 'Staff'));

    $rejection = null;

    try {
        $pdo->beginTransaction();

        $lockStmt = $pdo->prepare('SELECT * FROM lab_results WHERE id = :id FOR UPDATE');
        $lockStmt->execute([':id' => $id]);
        $row = $lockStmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 404, 'message' => 'Lab test not found.'];
        }

        // Write-once protection: billed or completed results can never be overwritten here.
        if (!empty($row['billed'])) {
            $rejection = [
                'ok'      => false,
                'status'  => 409,
                'message' => "Lab result {$id} has been billed (bill " . (string) ($row['bill_id'] ?? 'n/a')
                    . ') and is a permanent record; it cannot be modified.',
            ];
        } elseif ((string) $row['status'] !== 'Ordered') {
            $rejection = [
                'ok'      => false,
                'status'  => 409,
                'message' => "Lab result {$id} is already {$row['status']}; completed results are permanent clinical records and cannot be overwritten.",
            ];
        }

        if ($rejection !== null) {
            $pdo->rollBack();
        } else {
            $upd = $pdo->prepare('
                UPDATE lab_results SET
                    result          = :result,
                    unit            = :unit,
                    ref_range_min   = :ref_min,
                    ref_range_max   = :ref_max,
                    flag            = :flag,
                    attachment_name = :attachment,
                    status          = "Completed",
                    result_date     = CURDATE(),
                    performed_by    = :performed_by
                WHERE id = :id AND status = "Ordered" AND billed = 0
            ');
            $upd->execute([
                ':result'       => $resultVal,
                ':unit'         => $unit !== '' ? $unit : null,
                ':ref_min'      => $refMin,
                ':ref_max'      => $refMax,
                ':flag'         => $finalFlag,
                ':attachment'   => $attachment,
                ':performed_by' => $performer,
                ':id'           => $id,
            ]);

            writeAuthAuditLog(
                (string) ($currentUser['id'] ?? 'SYSTEM'),
                (string) ($currentUser['username'] ?? 'unknown'),
                'Update Lab Result',
                "Entered results for {$id} ({$row['test_name']}): result={$resultVal}, flag={$finalFlag}"
            );

            if ($failureInjector !== null) {
                $failureInjector('update:before-commit', $id);
            }

            $pdo->commit();
        }
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('updateLabResultRecord error: ' . $e->getMessage());
        return [
            'ok'      => false,
            'status'  => 500,
            'message' => 'Failed to update laboratory result.',
        ];
    }

    if ($rejection !== null) {
        // Logged after the rollback so the attempt is retained even though nothing was changed.
        writeAuthAuditLog(
            (string) ($currentUser['id'] ?? 'SYSTEM'),
            (string) ($currentUser['username'] ?? 'unknown'),
            'Lab Result Update Rejected',
            "Rejected modification of protected lab result {$id}: " . (string) $rejection['message']
        );
        return $rejection;
    }

    $updated = findLabResultById($pdo, $id, $currentUser);
    return [
        'ok'      => true,
        'status'  => 200,
        'message' => 'Lab result saved successfully.',
        'lab'     => $updated['lab'] ?? null,
    ];
}

/**
 * Look up the first recorded physician review for a lab result (audit_logs is the only store).
 *
 * @return array{reviewedBy: string, reviewedAt: string}|null
 */
function findLabReviewRecord(PDO $pdo, string $id): ?array
{
    $stmt = $pdo->prepare(
        "SELECT username, created_at FROM audit_logs
         WHERE action = 'Review Lab Result' AND details LIKE :pattern
         ORDER BY id ASC LIMIT 1"
    );
    $stmt->execute([':pattern' => '%reviewed lab result ' . $id . ' (%']);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        return null;
    }
    return [
        'reviewedBy' => (string) $row['username'],
        'reviewedAt' => (string) $row['created_at'],
    ];
}

/**
 * Record a physician review acknowledgment on a completed laboratory test.
 *
 * Idempotent: the first review wins and is the only audit row written; repeat calls (by anyone) return
 * the original review without writing again. See the file header for the schema limitation.
 *
 * @param PDO $pdo
 * @param string $id
 * @param array<string, mixed> $currentUser
 * @return array{ok: bool, status: int, message: string, review?: array<string, mixed>}
 */
function reviewLabResultRecord(PDO $pdo, string $id, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');
    if (!in_array($role, PRIMECARE_LAB_REVIEW_ROLES, true)) {
        return [
            'ok'      => false,
            'status'  => 403,
            'message' => 'Forbidden. Only doctors and administrators can review laboratory results.',
        ];
    }

    try {
        $pdo->beginTransaction();

        $lock = $pdo->prepare('SELECT id, status, test_name FROM lab_results WHERE id = :id FOR UPDATE');
        $lock->execute([':id' => $id]);
        $row = $lock->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 404, 'message' => 'Lab result not found.'];
        }

        if ((string) $row['status'] !== 'Completed') {
            $pdo->rollBack();
            return [
                'ok'      => false,
                'status'  => 400,
                'message' => 'Only completed lab results can be marked as reviewed.',
            ];
        }

        $existing = findLabReviewRecord($pdo, $id);
        if ($existing !== null) {
            $pdo->rollBack();
            return [
                'ok'      => true,
                'status'  => 200,
                'message' => "This lab result was already marked as reviewed by {$existing['reviewedBy']} on {$existing['reviewedAt']}.",
                'review'  => [
                    'alreadyReviewed' => true,
                    'reviewedBy'      => $existing['reviewedBy'],
                    'reviewedAt'      => $existing['reviewedAt'],
                ],
            ];
        }

        writeAuthAuditLog(
            (string) ($currentUser['id'] ?? 'SYSTEM'),
            (string) ($currentUser['username'] ?? 'unknown'),
            'Review Lab Result',
            "Physician {$currentUser['username']} reviewed lab result {$id} ({$row['test_name']})"
        );

        // writeAuthAuditLog() swallows its own failures; confirm the review really was recorded.
        $recorded = findLabReviewRecord($pdo, $id);
        if ($recorded === null) {
            $pdo->rollBack();
            return [
                'ok'      => false,
                'status'  => 500,
                'message' => 'The review could not be recorded. Please try again.',
            ];
        }

        $pdo->commit();

        return [
            'ok'      => true,
            'status'  => 200,
            'message' => 'Lab result marked as reviewed successfully.',
            'review'  => [
                'alreadyReviewed' => false,
                'reviewedBy'      => $recorded['reviewedBy'],
                'reviewedAt'      => $recorded['reviewedAt'],
            ],
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('reviewLabResultRecord error: ' . $e->getMessage());
        return [
            'ok'      => false,
            'status'  => 500,
            'message' => 'Failed to mark lab result as reviewed.',
        ];
    }
}
