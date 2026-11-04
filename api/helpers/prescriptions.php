<?php
/**
 * PrimeCare - Prescriptions & Pharmacy Helpers, Serializers, Validators & Writers
 * Phase 5.8.2: Prescriptions & Pharmacy Backend Migration
 *
 * Tables used (no schema changes):
 * - `prescriptions`
 * - `prescription_items`
 * - `patients`
 * - `doctors`
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
require_once __DIR__ . '/appointments.php';

// Clinical write roles
const PRIMECARE_RX_CREATE_ROLES   = ['admin', 'doctor'];
const PRIMECARE_RX_DISPENSE_ROLES = ['admin', 'nurse'];
const PRIMECARE_RX_CANCEL_ROLES   = ['admin', 'doctor'];

// Allowed prescription statuses
const PRIMECARE_RX_STATUSES = ['Active', 'Dispensed', 'Cancelled'];

// Maximum field lengths
const PRIMECARE_RX_MAX_MED_LEN   = 150;
const PRIMECARE_RX_MAX_DOS_LEN   = 100;
const PRIMECARE_RX_MAX_FREQ_LEN  = 100;
const PRIMECARE_RX_MAX_INST_LEN  = 1000;
const PRIMECARE_RX_MAX_NOTES_LEN = 2000;

// -----------------------------------------------------------------------------
// Serialization Helpers
// -----------------------------------------------------------------------------

/**
 * Format timestamp into ISO-8601 string ("2026-11-02T10:00:00")
 */
function formatRxTimestamp(mixed $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return str_replace(' ', 'T', (string) $value);
}

/**
 * Serialize a single prescription item to the frontend camelCase contract
 */
function serializePrescriptionItem(array $item): array
{
    return [
        'id'             => isset($item['id']) ? (int) $item['id'] : null,
        'prescriptionId' => (string) ($item['prescription_id'] ?? ''),
        'medicine'       => (string) $item['medicine'],
        'dosage'         => (string) $item['dosage'],
        'frequency'      => (string) $item['frequency'],
        'durationDays'   => $item['duration_days'] !== null ? (int) $item['duration_days'] : null,
        'instructions'   => $item['instructions'] !== null ? (string) $item['instructions'] : '',
    ];
}

/**
 * Serialize a prescription row with its items to the frontend contract
 */
function serializePrescription(array $row, array $items = []): array
{
    $serializedItems = array_map('serializePrescriptionItem', $items);

    return [
        'id'                   => (string) $row['id'],
        'patientId'            => (string) $row['patient_id'],
        'patientName'          => (string) ($row['patient_name'] ?? 'Unknown'),
        'doctorId'             => (string) $row['doctor_id'],
        'doctorName'           => (string) ($row['doctor_name'] ?? 'Unknown'),
        'doctorSpecialization' => (string) ($row['doctor_specialization'] ?? ''),
        'medicalRecordId'      => $row['medical_record_id'] !== null ? (string) $row['medical_record_id'] : null,
        'status'               => (string) $row['status'],
        'date'                 => (string) $row['prescribed_date'],
        'prescribedDate'       => (string) $row['prescribed_date'],
        'notes'                => $row['notes'] !== null ? (string) $row['notes'] : '',
        'overrideAllergy'      => (bool) $row['override_allergy'],
        'overrideReason'       => $row['override_reason'] !== null ? (string) $row['override_reason'] : null,
        'billed'               => (bool) $row['billed'],
        'billId'               => $row['bill_id'] !== null ? (string) $row['bill_id'] : null,
        'createdAt'            => formatRxTimestamp($row['created_at'] ?? null),
        'items'                => $serializedItems,
    ];
}

// -----------------------------------------------------------------------------
// Allergy Checking Engine
// -----------------------------------------------------------------------------

/**
 * Detect allergy conflicts between patient registered allergies and prescribed items.
 *
 * @param PDO $pdo
 * @param string $patientId
 * @param array $items Array of item payloads with 'medicine'
 * @return array<string> List of conflicting medicine names
 */
function checkPatientAllergyConflicts(PDO $pdo, string $patientId, array $items): array
{
    $stmt = $pdo->prepare('SELECT allergies FROM patients WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $patientId]);
    $patient = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$patient || empty($patient['allergies']) || strtolower(trim((string) $patient['allergies'])) === 'none') {
        return [];
    }

    $rawAllergies = explode(',', (string) $patient['allergies']);
    $allergies = [];
    foreach ($rawAllergies as $a) {
        $trimmed = trim(strtolower($a));
        if ($trimmed !== '' && $trimmed !== 'none') {
            $allergies[] = $trimmed;
        }
    }

    if (empty($allergies)) {
        return [];
    }

    $conflicts = [];
    foreach ($items as $item) {
        $medName = trim((string) ($item['medicine'] ?? ''));
        if ($medName === '') continue;

        $medLower = strtolower($medName);
        foreach ($allergies as $allergy) {
            if (str_contains($medLower, $allergy) || str_contains($allergy, $medLower)) {
                $conflicts[] = $medName;
                break;
            }
        }
    }

    return array_values(array_unique($conflicts));
}

// -----------------------------------------------------------------------------
// Query Helpers
// -----------------------------------------------------------------------------

/**
 * Fetch prescriptions matching filter criteria and role-based permissions.
 */
function fetchPrescriptions(PDO $pdo, array $filters, array $user): array
{
    $where = [];
    $params = [];

    // Role-based visibility
    if ($user['role'] === 'patient') {
        $patientId = $user['patient_id'] ?? null;
        if (!$patientId) {
            return [];
        }
        $where[] = 'p.patient_id = :session_patient_id';
        $params[':session_patient_id'] = $patientId;
    }

    // Explicit patient filter (admins/clinicians, or patient self-query)
    if (!empty($filters['patientId'])) {
        if ($user['role'] === 'patient') {
            // Patient cannot query another patient
            if ($filters['patientId'] !== ($user['patient_id'] ?? null)) {
                return [];
            }
        } else {
            $where[] = 'p.patient_id = :patient_id';
            $params[':patient_id'] = (string) $filters['patientId'];
        }
    }

    // Doctor filter
    if (!empty($filters['doctorId']) && $filters['doctorId'] !== 'All') {
        $where[] = 'p.doctor_id = :doctor_id';
        $params[':doctor_id'] = (string) $filters['doctorId'];
    }

    // Status filter
    if (!empty($filters['status']) && $filters['status'] !== 'All') {
        $where[] = 'p.status = :status';
        $params[':status'] = (string) $filters['status'];
    }

    // Date range filters (used in reports and auditing)
    if (!empty($filters['dateFrom'])) {
        $where[] = 'p.prescribed_date >= :date_from';
        $params[':date_from'] = (string) $filters['dateFrom'];
    }
    if (!empty($filters['dateTo'])) {
        $where[] = 'p.prescribed_date <= :date_to';
        $params[':date_to'] = (string) $filters['dateTo'];
    }

    // Keyword search (searches rx ID, patient full name, or medicine names)
    if (!empty($filters['keyword'])) {
        $kw = '%' . trim((string) $filters['keyword']) . '%';
        $where[] = '(
            p.id LIKE :kw1 
            OR CONCAT(pat.first_name, " ", pat.last_name) LIKE :kw2 
            OR EXISTS (
                SELECT 1 FROM prescription_items pi_search 
                WHERE pi_search.prescription_id = p.id AND pi_search.medicine LIKE :kw3
            )
        )';
        $params[':kw1'] = $kw;
        $params[':kw2'] = $kw;
        $params[':kw3'] = $kw;
    }

    $whereClause = !empty($where) ? 'WHERE ' . implode(' AND ', $where) : '';

    $sql = "
        SELECT 
            p.*,
            CONCAT(pat.first_name, ' ', pat.last_name) AS patient_name,
            d.name AS doctor_name,
            d.specialization AS doctor_specialization
        FROM prescriptions p
        INNER JOIN patients pat ON p.patient_id = pat.id
        INNER JOIN doctors d ON p.doctor_id = d.id
        {$whereClause}
        ORDER BY p.prescribed_date DESC, p.created_at DESC
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($rows)) {
        return [];
    }

    // Fetch all child items for the retrieved prescriptions in a single query
    $rxIds = array_column($rows, 'id');
    $inPlaceholders = implode(',', array_fill(0, count($rxIds), '?'));
    $itemsStmt = $pdo->prepare("SELECT * FROM prescription_items WHERE prescription_id IN ({$inPlaceholders}) ORDER BY id ASC");
    $itemsStmt->execute($rxIds);
    $allItems = $itemsStmt->fetchAll(PDO::FETCH_ASSOC);

    $itemsByRx = [];
    foreach ($allItems as $item) {
        $itemsByRx[$item['prescription_id']][] = $item;
    }

    $results = [];
    foreach ($rows as $row) {
        $items = $itemsByRx[$row['id']] ?? [];
        $results[] = serializePrescription($row, $items);
    }

    return $results;
}

/**
 * Fetch a single prescription by ID with items and doctor/patient metadata.
 */
function findPrescriptionById(PDO $pdo, string $id): ?array
{
    $sql = "
        SELECT 
            p.*,
            CONCAT(pat.first_name, ' ', pat.last_name) AS patient_name,
            d.name AS doctor_name,
            d.specialization AS doctor_specialization
        FROM prescriptions p
        INNER JOIN patients pat ON p.patient_id = pat.id
        INNER JOIN doctors d ON p.doctor_id = d.id
        WHERE p.id = :id
        LIMIT 1
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        return null;
    }

    $itemsStmt = $pdo->prepare('SELECT * FROM prescription_items WHERE prescription_id = :id ORDER BY id ASC');
    $itemsStmt->execute([':id' => $id]);
    $items = $itemsStmt->fetchAll(PDO::FETCH_ASSOC);

    return serializePrescription($row, $items);
}

/**
 * Find doctor by linked user_id.
 */
function findDoctorByUserId(PDO $pdo, string $userId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM doctors WHERE user_id = :uid LIMIT 1');
    $stmt->execute([':uid' => $userId]);
    $doc = $stmt->fetch(PDO::FETCH_ASSOC);
    return $doc ?: null;
}

// -----------------------------------------------------------------------------
// Transactional Writers
// -----------------------------------------------------------------------------

/**
 * Create a new prescription with atomic prescription items insertion.
 *
 * @param PDO $pdo
 * @param array $payload
 * @param array $user Authenticated session user
 * @return array Result array with 'ok', 'status', 'message', 'prescription', 'allergyConflict', etc.
 */
function createPrescriptionRecord(PDO $pdo, array $payload, array $user): array
{
    if (!in_array($user['role'], PRIMECARE_RX_CREATE_ROLES, true)) {
        return ['ok' => false, 'status' => 403, 'message' => 'Unauthorized. Only doctors and administrators may create prescriptions.'];
    }

    $patientId = trim((string) ($payload['patientId'] ?? ''));
    if ($patientId === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'Patient ID is required.'];
    }

    // Verify patient exists and is verified
    $patStmt = $pdo->prepare('SELECT id, status, allergies FROM patients WHERE id = :id LIMIT 1');
    $patStmt->execute([':id' => $patientId]);
    $patient = $patStmt->fetch(PDO::FETCH_ASSOC);

    if (!$patient) {
        return ['ok' => false, 'status' => 404, 'message' => "Patient {$patientId} not found."];
    }
    if ($patient['status'] !== 'verified') {
        return ['ok' => false, 'status' => 400, 'message' => 'Cannot create a prescription for an unverified patient.'];
    }

    // Determine Doctor Attribution
    $doctorId = null;
    if ($user['role'] === 'doctor') {
        // Enforce attribution to the logged-in doctor's profile
        $doc = findDoctorByUserId($pdo, (string) $user['id']);
        if (!$doc) {
            return ['ok' => false, 'status' => 403, 'message' => 'Doctor profile not found for current session.'];
        }
        $doctorId = (string) $doc['id'];
    } else {
        // Admin role: can specify doctor or default to D-001
        $doctorId = !empty($payload['doctorId']) ? trim((string) $payload['doctorId']) : 'D-001';
        $docCheck = $pdo->prepare('SELECT id FROM doctors WHERE id = :id LIMIT 1');
        $docCheck->execute([':id' => $doctorId]);
        if (!$docCheck->fetch()) {
            return ['ok' => false, 'status' => 400, 'message' => "Doctor {$doctorId} not found."];
        }
    }

    // Validate Items
    $items = $payload['items'] ?? null;
    if (!is_array($items) || count($items) === 0) {
        return ['ok' => false, 'status' => 400, 'message' => 'At least one medicine is required.'];
    }

    $cleanItems = [];
    foreach ($items as $idx => $item) {
        if (!is_array($item)) {
            return ['ok' => false, 'status' => 400, 'message' => "Item #" . ($idx + 1) . " must be an object."];
        }

        $medicine     = trim((string) ($item['medicine'] ?? ''));
        $dosage       = trim((string) ($item['dosage'] ?? ''));
        $frequency    = trim((string) ($item['frequency'] ?? ''));
        $durationRaw  = $item['durationDays'] ?? null;
        $instructions = trim((string) ($item['instructions'] ?? ''));

        if ($medicine === '' || $dosage === '' || $frequency === '' || $durationRaw === null || $durationRaw === '') {
            return ['ok' => false, 'status' => 400, 'message' => 'Please complete all required fields (medicine, dosage, frequency, duration) for each medicine.'];
        }

        if (mb_strlen($medicine) > PRIMECARE_RX_MAX_MED_LEN) {
            return ['ok' => false, 'status' => 400, 'message' => "Medicine name cannot exceed " . PRIMECARE_RX_MAX_MED_LEN . " characters."];
        }
        if (mb_strlen($dosage) > PRIMECARE_RX_MAX_DOS_LEN) {
            return ['ok' => false, 'status' => 400, 'message' => "Dosage cannot exceed " . PRIMECARE_RX_MAX_DOS_LEN . " characters."];
        }
        if (mb_strlen($frequency) > PRIMECARE_RX_MAX_FREQ_LEN) {
            return ['ok' => false, 'status' => 400, 'message' => "Frequency cannot exceed " . PRIMECARE_RX_MAX_FREQ_LEN . " characters."];
        }
        if (mb_strlen($instructions) > PRIMECARE_RX_MAX_INST_LEN) {
            return ['ok' => false, 'status' => 400, 'message' => "Instructions cannot exceed " . PRIMECARE_RX_MAX_INST_LEN . " characters."];
        }

        $durationDays = filter_var($durationRaw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 365]]);
        if ($durationDays === false) {
            return ['ok' => false, 'status' => 400, 'message' => 'Duration must be an integer between 1 and 365 days.'];
        }

        $cleanItems[] = [
            'medicine'     => $medicine,
            'dosage'       => $dosage,
            'frequency'    => $frequency,
            'durationDays' => (int) $durationDays,
            'instructions' => $instructions !== '' ? $instructions : null,
        ];
    }

    // Allergy Conflict Detection & Override Validation
    $overrideAllergy = !empty($payload['overrideAllergy']);
    $overrideReason  = isset($payload['overrideReason']) ? trim((string) $payload['overrideReason']) : null;
    $conflicts       = checkPatientAllergyConflicts($pdo, $patientId, $cleanItems);

    if (!empty($conflicts)) {
        if (!$overrideAllergy) {
            return [
                'ok'              => false,
                'status'          => 409,
                'allergyConflict' => true,
                'conflicts'       => $conflicts,
                'message'         => 'Allergy conflict detected. The patient is allergic to one or more prescribed medications.',
            ];
        }

        // If override is requested, require justification of at least 10 characters
        if ($overrideReason === null || mb_strlen($overrideReason) < 10) {
            return [
                'ok'      => false,
                'status'  => 400,
                'message' => 'Override reason must be at least 10 characters.',
            ];
        }
    } else {
        // No conflicts; override flags are not required
        $overrideAllergy = false;
        $overrideReason  = null;
    }

    // Optional Medical Record ID
    $medicalRecordId = !empty($payload['medicalRecordId']) ? trim((string) $payload['medicalRecordId']) : null;
    if ($medicalRecordId !== null) {
        $mrCheck = $pdo->prepare('SELECT id, patient_id FROM medical_records WHERE id = :id LIMIT 1');
        $mrCheck->execute([':id' => $medicalRecordId]);
        $mrRow = $mrCheck->fetch(PDO::FETCH_ASSOC);
        if (!$mrRow) {
            return ['ok' => false, 'status' => 404, 'message' => "Medical record {$medicalRecordId} not found."];
        }
        if ($mrRow['patient_id'] !== $patientId) {
            return ['ok' => false, 'status' => 400, 'message' => "Medical record {$medicalRecordId} does not belong to patient {$patientId}."];
        }
    }

    $notes = isset($payload['notes']) ? trim((string) $payload['notes']) : null;
    if ($notes !== null && mb_strlen($notes) > PRIMECARE_RX_MAX_NOTES_LEN) {
        return ['ok' => false, 'status' => 400, 'message' => "Notes cannot exceed " . PRIMECARE_RX_MAX_NOTES_LEN . " characters."];
    }

    // Database Transaction
    $pdo->beginTransaction();
    try {
        $rxId = allocateNextId($pdo, 'prescriptions', 'prescriptions', 'RX', 3);

        $insertRx = $pdo->prepare('
            INSERT INTO prescriptions (
                id, patient_id, doctor_id, medical_record_id, status, prescribed_date, 
                notes, override_allergy, override_reason, billed, bill_id, created_at
            ) VALUES (
                :id, :patient_id, :doctor_id, :medical_record_id, :status, CURDATE(), 
                :notes, :override_allergy, :override_reason, 0, NULL, NOW()
            )
        ');

        $insertRx->execute([
            ':id'               => $rxId,
            ':patient_id'       => $patientId,
            ':doctor_id'        => $doctorId,
            ':medical_record_id'=> $medicalRecordId,
            ':status'           => 'Active',
            ':notes'            => $notes !== '' ? $notes : null,
            ':override_allergy' => $overrideAllergy ? 1 : 0,
            ':override_reason'  => $overrideReason,
        ]);

        $insertItem = $pdo->prepare('
            INSERT INTO prescription_items (
                prescription_id, medicine, dosage, frequency, duration_days, instructions
            ) VALUES (
                :prescription_id, :medicine, :dosage, :frequency, :duration_days, :instructions
            )
        ');

        foreach ($cleanItems as $item) {
            $insertItem->execute([
                ':prescription_id' => $rxId,
                ':medicine'        => $item['medicine'],
                ':dosage'          => $item['dosage'],
                ':frequency'       => $item['frequency'],
                ':duration_days'   => $item['durationDays'],
                ':instructions'    => $item['instructions'],
            ]);
        }

        // Audit Log for Allergy Override if applicable
        if ($overrideAllergy) {
            writeAuthAuditLog(
                (string) $user['id'],
                (string) $user['username'],
                'Allergy Override',
                "Overrode allergy for patient {$patientId} on prescription {$rxId}. Conflicting meds: " . implode(', ', $conflicts) . ". Reason: {$overrideReason}"
            );
        }

        $pdo->commit();

        $saved = findPrescriptionById($pdo, $rxId);
        return [
            'ok'           => true,
            'status'       => 201,
            'message'      => 'Prescription created successfully.',
            'prescription' => $saved,
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[PrimeCare Prescription Create Error] ' . $e->getMessage());
        return ['ok' => false, 'status' => 500, 'message' => 'Failed to create prescription: ' . $e->getMessage()];
    }
}

/**
 * Update the status of a prescription (Dispensed or Cancelled).
 *
 * @param PDO $pdo
 * @param string $id
 * @param string $newStatus 'Dispensed' or 'Cancelled'
 * @param array $user Authenticated session user
 * @return array Result array with 'ok', 'status', 'message'
 */
function updatePrescriptionStatusRecord(PDO $pdo, string $id, string $newStatus, array $user): array
{
    if (!in_array($newStatus, ['Dispensed', 'Cancelled'], true)) {
        return ['ok' => false, 'status' => 400, 'message' => "Invalid status: {$newStatus}. Only 'Dispensed' or 'Cancelled' are allowed."];
    }

    // Role Enforcement
    if ($newStatus === 'Dispensed') {
        if (!in_array($user['role'], PRIMECARE_RX_DISPENSE_ROLES, true)) {
            return ['ok' => false, 'status' => 403, 'message' => 'Unauthorized. Only nurses and administrators may dispense prescriptions.'];
        }
    } elseif ($newStatus === 'Cancelled') {
        if (!in_array($user['role'], PRIMECARE_RX_CANCEL_ROLES, true)) {
            return ['ok' => false, 'status' => 403, 'message' => 'Unauthorized. Only doctors and administrators may cancel prescriptions.'];
        }
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT * FROM prescriptions WHERE id = :id FOR UPDATE');
        $stmt->execute([':id' => $id]);
        $rx = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$rx) {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 404, 'message' => "Prescription {$id} not found."];
        }

        // Lifecycle enforcement: can only transition from Active
        if ($rx['status'] !== 'Active') {
            $pdo->rollBack();
            return ['ok' => false, 'status' => 400, 'message' => "Cannot change status from {$rx['status']}."];
        }

        // Billed check on cancellation
        if ($newStatus === 'Cancelled') {
            if ((int) $rx['billed'] === 1 || !empty($rx['bill_id'])) {
                $pdo->rollBack();
                return ['ok' => false, 'status' => 400, 'message' => 'Cannot cancel a prescription that has already been billed.'];
            }
        }

        $updateStmt = $pdo->prepare('UPDATE prescriptions SET status = :status WHERE id = :id');
        $updateStmt->execute([
            ':status' => $newStatus,
            ':id'     => $id,
        ]);

        writeAuthAuditLog(
            (string) $user['id'],
            (string) $user['username'],
            "Prescription {$newStatus}",
            "Marked prescription {$id} as {$newStatus}."
        );

        $pdo->commit();

        return [
            'ok'      => true,
            'status'  => 200,
            'message' => "Prescription marked as {$newStatus}.",
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[PrimeCare Prescription Status Error] ' . $e->getMessage());
        return ['ok' => false, 'status' => 500, 'message' => 'Failed to update prescription status: ' . $e->getMessage()];
    }
}
