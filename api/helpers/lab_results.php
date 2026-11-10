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

// Allowed statuses and flags
const PRIMECARE_LAB_STATUSES = ['Ordered', 'Completed'];
const PRIMECARE_LAB_FLAGS    = ['Normal', 'Abnormal', 'Critical'];

// Maximum field lengths
const PRIMECARE_LAB_MAX_TEST_LEN   = 150;
const PRIMECARE_LAB_MAX_CAT_LEN    = 80;
const PRIMECARE_LAB_MAX_RESULT_LEN = 100;
const PRIMECARE_LAB_MAX_UNIT_LEN   = 50;
const PRIMECARE_LAB_MAX_ATTACH_LEN = 255;

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
// Automated Clinical Flag Calculation
// -----------------------------------------------------------------------------

/**
 * Calculate clinical laboratory abnormality flag based on numeric thresholds or explicit flag.
 *
 * Given a numeric result, reference minimum, and reference maximum:
 * - Normal: result is within the reference range [min, max].
 * - Abnormal: result is outside the reference range but within the critical threshold.
 * - Critical: result is below min - (0.30 * span) or above max + (0.30 * span), where span = max - min.
 *
 * @param mixed $result
 * @param float|null $min
 * @param float|null $max
 * @param string|null $manualFlag
 * @return array{ok: bool, flag?: string, message?: string}
 */
function calculateLabFlag(mixed $result, ?float $min, ?float $max, ?string $manualFlag = null): array
{
    // Clean manual flag if provided
    $manual = null;
    if ($manualFlag !== null && trim((string) $manualFlag) !== '') {
        $manual = ucfirst(strtolower(trim((string) $manualFlag)));
        if (!in_array($manual, PRIMECARE_LAB_FLAGS, true)) {
            return [
                'ok'      => false,
                'message' => 'Invalid abnormality flag. Allowed values: Normal, Abnormal, Critical.',
            ];
        }
    }

    // Both reference bounds provided
    if ($min !== null && $max !== null) {
        if ($min >= $max) {
            return [
                'ok'      => false,
                'message' => 'Reference minimum must be strictly less than reference maximum.',
            ];
        }

        // Numeric evaluation
        if ($result !== null && is_numeric($result)) {
            $val = (float) $result;
            $span = $max - $min;
            $critThreshold = $span * 0.30;

            if ($val >= $min && $val <= $max) {
                $computedFlag = 'Normal';
            } elseif ($val < ($min - $critThreshold) || $val > ($max + $critThreshold)) {
                $computedFlag = 'Critical';
            } else {
                $computedFlag = 'Abnormal';
            }

            // If manual flag was explicitly submitted, accept it if valid, else use computed
            return [
                'ok'   => true,
                'flag' => $manual ?? $computedFlag,
            ];
        }

        // Non-numeric result with reference ranges
        if ($manual !== null) {
            return ['ok' => true, 'flag' => $manual];
        }

        return [
            'ok'      => false,
            'message' => 'Non-numeric results require a valid manual flag (Normal, Abnormal, or Critical).',
        ];
    }

    // Reference ranges are not provided
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
 * Fetch a list of lab results filtered by criteria and scoped by user role.
 *
 * @param PDO $pdo
 * @param array<string, mixed> $filters
 * @param array<string, mixed> $currentUser
 * @return array<int, array<string, mixed>>
 */
function fetchLabResults(PDO $pdo, array $filters, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');

    $sql = '
        SELECT 
            l.*,
            CONCAT(p.first_name, " ", p.last_name) AS patient_name,
            d.name AS doctor_name
        FROM lab_results l
        LEFT JOIN patients p ON p.id = l.patient_id
        LEFT JOIN doctors d  ON d.id = l.ordered_by
        WHERE 1 = 1
    ';
    $params = [];

    // Role-based scoping: patients can ONLY view their own Completed records
    if ($role === 'patient') {
        $patientId = (string) ($currentUser['patient_id'] ?? '');
        $sql .= ' AND l.patient_id = :patient_id AND l.status = "Completed"';
        $params[':patient_id'] = $patientId;
    } else {
        // Staff/Admin/Doctor/Nurse filters
        if (!empty($filters['patientId'])) {
            $sql .= ' AND l.patient_id = :patient_id';
            $params[':patient_id'] = (string) $filters['patientId'];
        }

        if (!empty($filters['status']) && $filters['status'] !== 'All') {
            $sql .= ' AND l.status = :status';
            $params[':status'] = (string) $filters['status'];
        }
    }

    if (!empty($filters['doctorId']) && $filters['doctorId'] !== 'All') {
        $sql .= ' AND l.ordered_by = :ordered_by';
        $params[':ordered_by'] = (string) $filters['doctorId'];
    }

    if (!empty($filters['category']) && $filters['category'] !== 'All') {
        $sql .= ' AND l.category = :category';
        $params[':category'] = (string) $filters['category'];
    }

    if (!empty($filters['flag']) && $filters['flag'] !== 'All') {
        $sql .= ' AND l.flag = :flag';
        $params[':flag'] = (string) $filters['flag'];
    }

    if (!empty($filters['dateFrom'])) {
        $sql .= ' AND l.ordered_date >= :date_from';
        $params[':date_from'] = (string) $filters['dateFrom'];
    }

    if (!empty($filters['dateTo'])) {
        $sql .= ' AND l.ordered_date <= :date_to';
        $params[':date_to'] = (string) $filters['dateTo'];
    }

    if (!empty($filters['keyword'])) {
        $kw = '%' . trim((string) $filters['keyword']) . '%';
        $sql .= ' AND (
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

    $sql .= ' ORDER BY l.ordered_date DESC, l.id DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    return array_map('serializeLabResult', $rows);
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
 * @return array{ok: bool, status: int, message: string, lab?: array<string, mixed>}
 */
function createLabOrderRecord(PDO $pdo, array $input, array $currentUser): array
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
    if (mb_strlen($category) > PRIMECARE_LAB_MAX_CAT_LEN) {
        return ['ok' => false, 'status' => 400, 'message' => 'Category must not exceed ' . PRIMECARE_LAB_MAX_CAT_LEN . ' characters.'];
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

    // Determine ordering doctor ID
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
            ':category'   => $category,
        ]);

        writeAuthAuditLog(
            (string) ($currentUser['id'] ?? 'SYSTEM'),
            (string) ($currentUser['username'] ?? 'unknown'),
            'Create Lab Order',
            "Ordered test {$testName} ({$labId}) for patient {$patientId}"
        );

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
 * Enter results and complete an existing laboratory test.
 *
 * @param PDO $pdo
 * @param string $id
 * @param array<string, mixed> $input
 * @param array<string, mixed> $currentUser
 * @return array{ok: bool, status: int, message: string, lab?: array<string, mixed>}
 */
function updateLabResultRecord(PDO $pdo, string $id, array $input, array $currentUser): array
{
    $role = (string) ($currentUser['role'] ?? '');
    if (!in_array($role, PRIMECARE_LAB_UPDATE_ROLES, true)) {
        return [
            'ok'      => false,
            'status'  => 403,
            'message' => 'Forbidden. Only doctors, nurses, and administrators can enter laboratory results.',
        ];
    }

    $resultVal = trim((string) ($input['result'] ?? ''));
    if ($resultVal === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'Result value is required.'];
    }
    if (mb_strlen($resultVal) > PRIMECARE_LAB_MAX_RESULT_LEN) {
        return ['ok' => false, 'status' => 400, 'message' => 'Result must not exceed ' . PRIMECARE_LAB_MAX_RESULT_LEN . ' characters.'];
    }

    $unit = trim((string) ($input['unit'] ?? ''));
    if (mb_strlen($unit) > PRIMECARE_LAB_MAX_UNIT_LEN) {
        return ['ok' => false, 'status' => 400, 'message' => 'Unit must not exceed ' . PRIMECARE_LAB_MAX_UNIT_LEN . ' characters.'];
    }

    // Extract reference ranges: support both nested referenceRange { min, max } and flat refRangeMin / refRangeMax
    $refMin = null;
    $refMax = null;

    if (isset($input['referenceRange']) && is_array($input['referenceRange'])) {
        $rMin = $input['referenceRange']['min'] ?? null;
        $rMax = $input['referenceRange']['max'] ?? null;
        if ($rMin !== null && $rMin !== '' && is_numeric($rMin)) {
            $refMin = (float) $rMin;
        }
        if ($rMax !== null && $rMax !== '' && is_numeric($rMax)) {
            $refMax = (float) $rMax;
        }
    } else {
        if (isset($input['refRangeMin']) && $input['refRangeMin'] !== '' && is_numeric($input['refRangeMin'])) {
            $refMin = (float) $input['refRangeMin'];
        }
        if (isset($input['refRangeMax']) && $input['refRangeMax'] !== '' && is_numeric($input['refRangeMax'])) {
            $refMax = (float) $input['refRangeMax'];
        }
    }

    $manualFlag = isset($input['flag']) ? (string) $input['flag'] : null;

    // Run clinical flagging algorithm
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
    if (!empty($input['attachmentName'])) {
        $rawAttach = basename(trim((string) $input['attachmentName']));
        if ($rawAttach !== '') {
            $attachment = mb_substr($rawAttach, 0, PRIMECARE_LAB_MAX_ATTACH_LEN);
        }
    }

    $performer = trim((string) ($currentUser['fullName'] ?? $currentUser['full_name'] ?? $currentUser['username'] ?? 'Staff'));

    try {
        $pdo->beginTransaction();

        $lockStmt = $pdo->prepare('SELECT * FROM lab_results WHERE id = :id FOR UPDATE');
        $lockStmt->execute([':id' => $id]);
        $row = $lockStmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 404, 'message' => 'Lab test not found.'];
        }

        // Prevent direct manipulation of billing relationship from lab endpoint
        if (array_key_exists('billed', $input) && (bool) $input['billed'] !== (bool) $row['billed']) {
            $pdo->rollBack();
            return [
                'ok'      => false,
                'status'  => 409,
                'message' => 'Cannot modify billing status directly from laboratory module.',
            ];
        }
        if (array_key_exists('billId', $input) && (string) ($input['billId'] ?? '') !== (string) ($row['bill_id'] ?? '')) {
            $pdo->rollBack();
            return [
                'ok'      => false,
                'status'  => 409,
                'message' => 'Cannot modify billing reference directly from laboratory module.',
            ];
        }

        // Immutability protection: if billed, verify core identity isn't being tampered with
        if (!empty($row['billed'])) {
            if (isset($input['patientId']) && (string) $input['patientId'] !== (string) $row['patient_id']) {
                $pdo->rollBack();
                return [
                    'ok'      => false,
                    'status'  => 409,
                    'message' => 'Cannot modify patient on a billed laboratory record.',
                ];
            }
            if (isset($input['testName']) && (string) $input['testName'] !== (string) $row['test_name']) {
                $pdo->rollBack();
                return [
                    'ok'      => false,
                    'status'  => 409,
                    'message' => 'Cannot modify test name on a billed laboratory record.',
                ];
            }
            if (isset($input['category']) && (string) $input['category'] !== (string) $row['category']) {
                $pdo->rollBack();
                return [
                    'ok'      => false,
                    'status'  => 409,
                    'message' => 'Cannot modify category on a billed laboratory record.',
                ];
            }
        }

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
            WHERE id = :id
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

        $pdo->commit();

        $updated = findLabResultById($pdo, $id, $currentUser);
        return [
            'ok'      => true,
            'status'  => 200,
            'message' => 'Lab result saved successfully.',
            'lab'     => $updated['lab'] ?? null,
        ];
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
}

/**
 * Record a physician review acknowledgment on a completed laboratory test.
 *
 * @param PDO $pdo
 * @param string $id
 * @param array<string, mixed> $currentUser
 * @return array{ok: bool, status: int, message: string}
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

        writeAuthAuditLog(
            (string) ($currentUser['id'] ?? 'SYSTEM'),
            (string) ($currentUser['username'] ?? 'unknown'),
            'Review Lab Result',
            "Physician {$currentUser['username']} reviewed lab result {$id} ({$row['test_name']})"
        );

        $pdo->commit();

        return [
            'ok'      => true,
            'status'  => 200,
            'message' => 'Lab result marked as reviewed successfully.',
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
