<?php
/**
 * PrimeCare - GET /api/lab-results/list.php
 * Phase 5.10.2: List, search, and filter laboratory results.
 *
 * Query Parameters:
 * - patientId: string
 * - doctorId: string ('All' or doctor ID)
 * - status: string ('All', 'Ordered', 'Completed')
 * - flag: string ('All', 'Normal', 'Abnormal', 'Critical')
 * - category: string ('All', 'Hematology', 'Chemistry', etc.)
 * - keyword: string (searches lab ID, patient name, test name, category)
 * - dateFrom: string YYYY-MM-DD
 * - dateTo: string YYYY-MM-DD
 * - my: '1' or 'true' (patient portal convenience)
 *
 * Authorization:
 * - Allowed: admin, doctor, nurse, patient.
 * - Staff: 403 Forbidden.
 * - Patient: Scoped strictly to own completed records (IDOR protected).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/lab_results.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(PRIMECARE_LAB_READ_ROLES);
$pdo  = getDatabaseConnection();
$role = (string) $user['role'];

$filters = [
    'patientId' => trim((string) ($_GET['patientId'] ?? '')),
    'doctorId'  => trim((string) ($_GET['doctorId'] ?? '')),
    'status'    => trim((string) ($_GET['status'] ?? '')),
    'flag'      => trim((string) ($_GET['flag'] ?? '')),
    'category'  => trim((string) ($_GET['category'] ?? '')),
    'keyword'   => trim((string) ($_GET['keyword'] ?? '')),
    'dateFrom'  => trim((string) ($_GET['dateFrom'] ?? '')),
    'dateTo'    => trim((string) ($_GET['dateTo'] ?? '')),
];

$myFlag = isset($_GET['my']) && ((string) $_GET['my'] === '1' || strtolower((string) $_GET['my']) === 'true');

if ($role === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendSuccess('Lab results retrieved successfully.', ['labs' => [], 'count' => 0]);
    }
    $user['patient_id'] = (string) $own['id'];
    $filters['patientId'] = (string) $own['id'];
} elseif ($myFlag && $filters['patientId'] === '') {
    $filters['patientId'] = 'P-001';
}

$labs = fetchLabResults($pdo, $filters, $user);

sendSuccess('Lab results retrieved successfully.', [
    'labs'  => $labs,
    'count' => count($labs),
]);
