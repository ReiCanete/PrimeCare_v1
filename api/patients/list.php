<?php
/**
 * PrimeCare - GET /api/patients/list.php
 * Phase 5.3.2: Patient listing, searching, filtering, and sorting (Staff/Clinical roles)
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/patients.php';

registerApiErrorHandlers();
requireMethod(['GET']);

// Only admin, staff, doctor, and nurse may list/search all hospital patients
requireRole(['admin', 'staff', 'doctor', 'nurse']);

$pdo = getDatabaseConnection();

$keyword   = trim((string) ($_GET['keyword'] ?? ''));
$status    = trim((string) ($_GET['status'] ?? 'All'));
$admitType = trim((string) ($_GET['admitType'] ?? 'All'));
$sortBy    = trim((string) ($_GET['sortBy'] ?? 'dateAdmitted'));
$sortDir   = strtolower(trim((string) ($_GET['sortDir'] ?? 'desc'))) === 'asc' ? 'ASC' : 'DESC';
$limit     = isset($_GET['limit']) && is_numeric($_GET['limit']) ? max(1, min(500, (int) $_GET['limit'])) : 0;

$where  = [];
$params = [];

if ($keyword !== '') {
    $where[]               = '(p.id LIKE :kw1 OR p.full_name LIKE :kw2 OR p.mobile LIKE :kw3 OR (p.email IS NOT NULL AND p.email LIKE :kw4))';
    $like                  = '%' . $keyword . '%';
    $params[':kw1']        = $like;
    $params[':kw2']        = $like;
    $params[':kw3']        = $like;
    $params[':kw4']        = $like;
}

if ($status !== '' && strtolower($status) !== 'all') {
    $allowedStatuses = ['pending', 'verified', 'rejected'];
    $cleanStatus     = strtolower($status);
    if (in_array($cleanStatus, $allowedStatuses, true)) {
        $where[]           = 'p.status = :status';
        $params[':status'] = $cleanStatus;
    }
}

if ($admitType !== '' && strtolower($admitType) !== 'all') {
    if (in_array($admitType, ['Outpatient', 'Inpatient'], true)) {
        $where[]              = 'p.admit_type = :admit_type';
        $params[':admit_type'] = $admitType;
    }
}

$sortMap = [
    'id'           => 'p.id',
    'fullName'     => 'p.full_name',
    'dateAdmitted' => 'COALESCE(p.date_admitted, p.created_at)',
    'createdAt'    => 'p.created_at',
    'status'       => 'p.status',
    'admitType'    => 'p.admit_type',
];
$orderCol = $sortMap[$sortBy] ?? 'COALESCE(p.date_admitted, p.created_at)';

$sql = 'SELECT p.* FROM patients p';
if ($where !== []) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= " ORDER BY {$orderCol} {$sortDir}, p.id ASC";
if ($limit > 0) {
    $sql .= ' LIMIT ' . (int) $limit;
}

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

$patients = array_map('serializePatient', $rows ?: []);

// Compute overall status badge counts
$countStmt = $pdo->query(
    "SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
     FROM patients"
);
$countRow = $countStmt ? $countStmt->fetch() : [];

sendSuccess('Patients retrieved successfully.', [
    'patients'      => $patients,
    'counts'        => [
        'all'      => (int) ($countRow['total'] ?? count($patients)),
        'pending'  => (int) ($countRow['pending_count'] ?? 0),
        'verified' => (int) ($countRow['verified_count'] ?? 0),
        'rejected' => (int) ($countRow['rejected_count'] ?? 0),
    ],
    'nextPreviewId' => previewNextPatientId($pdo),
]);

