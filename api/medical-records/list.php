<?php
/**
 * PrimeCare - GET /api/medical-records/list.php
 * Phase 5.7.2: List, search and filter medical records with role-scoped projections.
 *
 * Query: patientId, doctorId, dateFrom, dateTo, keyword, sortBy (createdAt|id|patientName|doctorName),
 *        sortDir (asc|desc), my=1
 *
 * Authorization (requireRole - all five roles may read; what they see differs):
 * - admin / doctor / nurse: full clinical projection (vitals, notes, revision history).
 * - staff:   summary projection only (date, doctor, diagnosis) - no vitals, complaint or treatment notes.
 * - patient: strictly scoped to their own linked patient record (client `patientId` is ignored).
 * - `?my=1` by a non-patient (portal preview) defaults to demo patient P-001 when no patientId is given.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/medical_records.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'staff', 'doctor', 'nurse', 'patient']);
$pdo  = getDatabaseConnection();
$role = (string) $user['role'];
$view = medicalRecordViewForRole($role);

$filters = [
    'patientId' => trim((string) ($_GET['patientId'] ?? '')),
    'doctorId'  => trim((string) ($_GET['doctorId'] ?? '')),
    'dateFrom'  => trim((string) ($_GET['dateFrom'] ?? '')),
    'dateTo'    => trim((string) ($_GET['dateTo'] ?? '')),
    'keyword'   => trim((string) ($_GET['keyword'] ?? '')),
    'sortBy'    => trim((string) ($_GET['sortBy'] ?? 'createdAt')),
    'sortDir'   => trim((string) ($_GET['sortDir'] ?? 'desc')),
];
$myFlag = isset($_GET['my']) && ((string) $_GET['my'] === '1' || strtolower((string) $_GET['my']) === 'true');

if ($role === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendSuccess('Medical records retrieved successfully.', ['records' => [], 'count' => 0]);
    }
    // Server-side ownership: whatever the client asked for, a patient only ever sees their own chart.
    $filters['patientId'] = (string) $own['id'];
} elseif ($myFlag && $filters['patientId'] === '') {
    $filters['patientId'] = 'P-001';
}

$records = fetchMedicalRecords($pdo, $filters, $view, true);

sendSuccess('Medical records retrieved successfully.', [
    'records' => $records,
    'count'   => count($records),
]);

