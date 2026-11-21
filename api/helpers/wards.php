<?php
/**
 * PrimeCare - Wards, Beds & Inpatient Admissions Helpers
 *
 * Tables used (zero DDL changes):
 * - `wards`
 * - `beds`
 * - `admissions`
 * - `patients`
 * - `doctors`
 * - `sequences`
 */

declare(strict_types=1);

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

/**
 * Serialize a `wards` row to camelCase.
 *
 * @return array<string, mixed>
 */
function serializeWard(array $row): array
{
    return [
        'id'        => (string) $row['id'],
        'name'      => (string) $row['name'],
        'type'      => (string) $row['type'],
        'dailyRate' => round((float) $row['daily_rate'], 2),
    ];
}

/**
 * Serialize a `beds` row to camelCase.
 *
 * @return array<string, mixed>
 */
function serializeBed(array $row): array
{
    return [
        'id'               => (string) $row['id'],
        'wardId'           => (string) $row['ward_id'],
        'bedNumber'        => (string) $row['bed_number'],
        'status'           => (string) $row['status'],
        'currentPatientId' => ($row['current_patient_id'] !== null && $row['current_patient_id'] !== '')
            ? (string) $row['current_patient_id']
            : null,
    ];
}

/**
 * Serialize a joined `admissions` row to camelCase.
 *
 * @return array<string, mixed>
 */
function serializeAdmission(array $row): array
{
    return [
        'id'                => (string) $row['id'],
        'patientId'         => (string) $row['patient_id'],
        'bedId'             => (string) $row['bed_id'],
        'attendingDoctorId' => $row['attending_doctor_id'] !== null ? (string) $row['attending_doctor_id'] : null,
        'admitDate'         => (string) $row['admit_date'],
        'dischargeDate'     => $row['discharge_date'] !== null ? (string) $row['discharge_date'] : null,
        'dailyRate'         => round((float) $row['daily_rate'], 2),
        'dischargeSummary'  => $row['discharge_summary'] !== null ? (string) $row['discharge_summary'] : null,
        'status'            => (string) $row['status'],
        'billed'            => (bool) $row['billed'],
        'billId'            => ($row['bill_id'] !== null && $row['bill_id'] !== '') ? (string) $row['bill_id'] : null,
        'patientName'       => (string) ($row['patient_name'] ?? 'Unknown'),
        'doctorName'        => (string) ($row['doctor_name'] ?? 'Unknown'),
        'bedName'           => (string) ($row['bed_number'] ?? 'Unknown'),
        'wardName'          => (string) ($row['ward_name'] ?? 'Unknown'),
    ];
}

/**
 * Fetch admissions list with optional status / patient filters.
 *
 * @return array<int, array<string, mixed>>
 */
function fetchAdmissionsList(PDO $pdo, ?string $statusFilter = null, ?string $patientIdFilter = null): array
{
    $where  = [];
    $params = [];

    if ($statusFilter !== null && $statusFilter !== '' && strcasecmp($statusFilter, 'All') !== 0) {
        if (!in_array($statusFilter, ['Admitted', 'Discharged'], true)) {
            sendError('Invalid admission status filter.', 422);
        }
        $where[]           = 'a.status = :status';
        $params[':status'] = $statusFilter;
    }

    if ($patientIdFilter !== null && $patientIdFilter !== '') {
        $where[]        = 'a.patient_id = :pid';
        $params[':pid'] = $patientIdFilter;
    }

    $sql = "
        SELECT
            a.*,
            COALESCE(p.full_name, 'Unknown') AS patient_name,
            COALESCE(d.name, 'Unknown')      AS doctor_name,
            COALESCE(b.bed_number, 'Unknown') AS bed_number,
            COALESCE(w.name, 'Unknown')      AS ward_name
        FROM admissions a
        LEFT JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors  d ON d.id = a.attending_doctor_id
        LEFT JOIN beds     b ON b.id = a.bed_id
        LEFT JOIN wards    w ON w.id = b.ward_id
    ";
    if ($where !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY a.admit_date DESC, a.id DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll() ?: [];

    return array_map('serializeAdmission', $rows);
}

/**
 * Fetch one admission by ID with joined labels, or null if not found.
 *
 * @return array<string, mixed>|null
 */
function findAdmissionById(PDO $pdo, string $id): ?array
{
    $stmt = $pdo->prepare("
        SELECT
            a.*,
            COALESCE(p.full_name, 'Unknown')  AS patient_name,
            COALESCE(d.name, 'Unknown')       AS doctor_name,
            COALESCE(b.bed_number, 'Unknown') AS bed_number,
            COALESCE(w.name, 'Unknown')       AS ward_name
        FROM admissions a
        LEFT JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors  d ON d.id = a.attending_doctor_id
        LEFT JOIN beds     b ON b.id = a.bed_id
        LEFT JOIN wards    w ON w.id = b.ward_id
        WHERE a.id = :id
        LIMIT 1
    ");
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    return is_array($row) ? serializeAdmission($row) : null;
}
