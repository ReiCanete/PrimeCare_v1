<?php
/**
 * PrimeCare - GET /api/doctors/list.php
 * Phase 5.5: Doctor listing, searching, filtering, sorting, and department join.
 *
 * Authorization & Visibility Rules:
 * - Public / Unauthenticated visitors (for doctors.html & departments.html) or `patient` role:
 *     By default (?public=1 or role=patient/unauthenticated), only `active` doctors are returned,
 *     unless a staff/admin/clinical user is authenticated.
 * - Authenticated Staff/Clinical/Admin roles (`admin`, `staff`, `doctor`, `nurse`):
 *     Can list all doctors (including `inactive`) and filter by status.
 *     If `?requireAuth=1` is passed by a staff page, unauthenticated requests receive 401.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/doctors.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$requireAuthFlag = isset($_GET['requireAuth']) && ($_GET['requireAuth'] === '1' || $_GET['requireAuth'] === 'true');
if ($requireAuthFlag) {
    $user = requireRole(['admin', 'staff', 'doctor', 'nurse']);
} else {
    $user = currentUser();
}

$isStaffOrAdmin = is_array($user) && in_array($user['role'] ?? '', ['admin', 'staff', 'doctor', 'nurse'], true);

$pdo = getDatabaseConnection();

$keyword        = trim((string) ($_GET['keyword'] ?? ''));
$specialization = trim((string) ($_GET['specialization'] ?? ($_GET['spec'] ?? 'All')));
$department     = trim((string) ($_GET['department'] ?? 'All'));
$departmentId   = trim((string) ($_GET['departmentId'] ?? ''));
$status         = trim((string) ($_GET['status'] ?? 'All'));
$language       = trim((string) ($_GET['language'] ?? ''));
$insurance      = trim((string) ($_GET['insurance'] ?? ''));
$sortBy         = trim((string) ($_GET['sortBy'] ?? 'id'));
$sortDir        = strtolower(trim((string) ($_GET['sortDir'] ?? 'asc'))) === 'desc' ? 'DESC' : 'ASC';

$where  = [];
$params = [];

// Non-staff callers (unauthenticated public visitors or patient portal users) only see active doctors
if (!$isStaffOrAdmin) {
    $where[] = "d.status = 'active'";
} elseif ($status !== '' && strtolower($status) !== 'all') {
    $cleanStatus = strtolower($status);
    if (in_array($cleanStatus, ['active', 'inactive', 'on-leave'], true)) {
        $where[]           = 'd.status = :status';
        $params[':status'] = $cleanStatus;
    }
}

if ($keyword !== '') {
    $where[]        = '(d.id LIKE :kw1 OR d.name LIKE :kw2 OR d.specialization LIKE :kw3 OR d.department LIKE :kw4 OR (d.qualifications IS NOT NULL AND d.qualifications LIKE :kw5))';
    $like           = '%' . $keyword . '%';
    $params[':kw1'] = $like;
    $params[':kw2'] = $like;
    $params[':kw3'] = $like;
    $params[':kw4'] = $like;
    $params[':kw5'] = $like;
}

if ($specialization !== '' && strtolower($specialization) !== 'all') {
    $where[]                   = 'LOWER(d.specialization) = LOWER(:spec)';
    $params[':spec']           = $specialization;
}

if ($departmentId !== '' && ctype_digit($departmentId)) {
    $where[]             = 'dept.id = :dept_id';
    $params[':dept_id']  = (int) $departmentId;
} elseif ($department !== '' && strtolower($department) !== 'all') {
    $where[]             = 'LOWER(d.department) = LOWER(:dept)';
    $params[':dept']     = $department;
}

// Strict server-side sort column whitelist
$sortMap = [
    'id'               => 'd.id',
    'name'             => 'd.name',
    'specialization'   => 'd.specialization',
    'department'       => 'd.department',
    'status'           => 'd.status',
    'consultationFee'  => 'd.consultation_fee',
    'consultation_fee' => 'd.consultation_fee',
    'fee'              => 'd.consultation_fee',
    'slotMinutes'      => 'd.slot_minutes',
    'createdAt'        => 'd.created_at',
];
$orderCol = $sortMap[$sortBy] ?? 'd.id';

$sql = 'SELECT d.*,
               dept.id AS department_id,
               dept.description AS department_description,
               dept.services_json AS department_services_json
        FROM doctors d
        LEFT JOIN departments dept ON dept.name = d.department';

if ($where !== []) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= " ORDER BY {$orderCol} {$sortDir}, d.id ASC";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll() ?: [];

$doctorIds   = array_map(static fn(array $r): string => (string) $r['id'], $rows);
$scheduleMap = fetchSchedulesByDoctorIds($pdo, $doctorIds);

$doctors = [];
foreach ($rows as $row) {
    $did  = (string) $row['id'];
    $item = serializeDoctor($row, $scheduleMap[$did] ?? []);

    // Apply JSON array filters (language / insurance) in PHP after decoding
    if ($language !== '' && strtolower($language) !== 'all') {
        $matchedLang = false;
        foreach ($item['languages'] as $lang) {
            if (strcasecmp((string) $lang, $language) === 0) {
                $matchedLang = true;
                break;
            }
        }
        if (!$matchedLang) {
            continue;
        }
    }

    if ($insurance !== '' && strtolower($insurance) !== 'all') {
        $matchedIns = false;
        foreach ($item['acceptedInsurance'] as $ins) {
            if (strcasecmp((string) $ins, $insurance) === 0) {
                $matchedIns = true;
                break;
            }
        }
        if (!$matchedIns) {
            continue;
        }
    }

    $doctors[] = $item;
}

// Overall status counts for staff management chips
$countStmt = $pdo->query(
    "SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive_count
     FROM doctors"
);
$countRow = $countStmt ? $countStmt->fetch() : [];

sendSuccess('Doctors retrieved successfully.', [
    'doctors' => $doctors,
    'counts'  => [
        'all'      => (int) ($countRow['total'] ?? count($doctors)),
        'active'   => (int) ($countRow['active_count'] ?? 0),
        'onLeave'  => 0,
        'inactive' => (int) ($countRow['inactive_count'] ?? 0),
    ],
]);
