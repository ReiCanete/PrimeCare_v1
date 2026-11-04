<?php
/**
 * PrimeCare - GET /api/prescriptions/list.php
 * Phase 5.8.2: List, search, and filter prescriptions.
 *
 * Query Parameters:
 * - patientId: string
 * - doctorId: string ('All' or doctor ID)
 * - status: string ('All', 'Active', 'Dispensed', 'Cancelled')
 * - keyword: string (searches rx ID, patient full name, medicine name)
 * - dateFrom: string YYYY-MM-DD
 * - dateTo: string YYYY-MM-DD
 * - my: '1' or 'true' (patient portal / dev preview)
 *
 * Authorization:
 * - Allowed: admin, doctor, nurse, patient.
 * - Staff: 403 Forbidden (no clinical or pharmacy access).
 * - Patient: Strictly locked to own linked patient record (IDOR protected).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/prescriptions.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'doctor', 'nurse', 'patient']);
$pdo  = getDatabaseConnection();
$role = (string) $user['role'];

$filters = [
    'patientId' => trim((string) ($_GET['patientId'] ?? '')),
    'doctorId'  => trim((string) ($_GET['doctorId'] ?? '')),
    'status'    => trim((string) ($_GET['status'] ?? '')),
    'keyword'   => trim((string) ($_GET['keyword'] ?? '')),
    'dateFrom'  => trim((string) ($_GET['dateFrom'] ?? '')),
    'dateTo'    => trim((string) ($_GET['dateTo'] ?? '')),
];

$myFlag = isset($_GET['my']) && ((string) $_GET['my'] === '1' || strtolower((string) $_GET['my']) === 'true');

if ($role === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendSuccess('Prescriptions retrieved successfully.', ['prescriptions' => [], 'count' => 0]);
    }
    $user['patient_id'] = (string) $own['id'];
    $filters['patientId'] = (string) $own['id'];
} elseif ($myFlag && $filters['patientId'] === '') {
    $filters['patientId'] = 'P-001';
}

$prescriptions = fetchPrescriptions($pdo, $filters, $user);

sendSuccess('Prescriptions retrieved successfully.', [
    'prescriptions' => $prescriptions,
    'count'         => count($prescriptions),
]);

