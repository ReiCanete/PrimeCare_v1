<?php
/**
 * PrimeCare - GET /api/lab-results/list.php
 * Phase 5.10.2: List, search, filter, sort and paginate laboratory results.
 *
 * Query Parameters:
 * - patientId: string
 * - doctorId: string ('All' or doctor ID)
 * - status: string ('All', 'Ordered', 'Completed')
 * - flag: string ('All', 'Normal', 'Abnormal', 'Critical')
 * - category: string ('All', 'Hematology', 'Chemistry', etc.)
 * - keyword: string (searches lab ID, patient name, test name, category)
 * - dateFrom / dateTo: string YYYY-MM-DD (ordered date)
 * - my: '1' or 'true' (patient portal convenience)
 * - page: int >= 1 (default 1)
 * - limit: int 1..100 (default 50, values above 100 are clamped to 100)
 * - sortBy: orderedDate | resultDate | id | testName | category | status | flag | patientName
 *           (anything else falls back to orderedDate)
 * - sortDir: asc | desc (default desc)
 *
 * Response data: labs, count (rows in this page), total (all matching rows), page, limit,
 *                totalPages, sortBy, sortDir.
 *
 * Authorization:
 * - Allowed: admin, doctor, nurse, patient.
 * - Staff: 403 Forbidden.
 * - Patient: Scoped strictly to own completed records (IDOR protected), whatever filters are sent.
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
    'page'      => $_GET['page'] ?? 1,
    'limit'     => $_GET['limit'] ?? PRIMECARE_LAB_DEFAULT_PAGE_SIZE,
    'sortBy'    => trim((string) ($_GET['sortBy'] ?? '')),
    'sortDir'   => trim((string) ($_GET['sortDir'] ?? '')),
];

$myFlag = isset($_GET['my']) && ((string) $_GET['my'] === '1' || strtolower((string) $_GET['my']) === 'true');

$emptyPage = static fn(): array => [
    'labs'       => [],
    'count'      => 0,
    'total'      => 0,
    'page'       => 1,
    'limit'      => PRIMECARE_LAB_DEFAULT_PAGE_SIZE,
    'totalPages' => 0,
    'sortBy'     => 'orderedDate',
    'sortDir'    => 'desc',
];

if ($role === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendSuccess('Lab results retrieved successfully.', $emptyPage());
    }
    $user['patient_id']   = (string) $own['id'];
    $filters['patientId'] = (string) $own['id'];
} elseif ($myFlag && $filters['patientId'] === '') {
    $filters['patientId'] = 'P-001';
}

$page = fetchLabResults($pdo, $filters, $user);

sendSuccess('Lab results retrieved successfully.', [
    'labs'       => $page['labs'],
    'count'      => count($page['labs']),
    'total'      => $page['total'],
    'page'       => $page['page'],
    'limit'      => $page['limit'],
    'totalPages' => $page['totalPages'],
    'sortBy'     => $page['sortBy'],
    'sortDir'    => $page['sortDir'],
]);
