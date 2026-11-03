<?php
/**
 * PrimeCare - GET /api/appointments/list.php
 * Phase 5.6.2: List, search, filter, and sort appointments with role scoping and status counts.
 *
 * Authorization:
 * - Requires authenticated session (`requireAuth()`).
 * - When called by `patient` role (or with `?my=1` on patient portal pages):
 *   - `patient`: strictly scoped to their own linked `patients.id` (ignoring any client-supplied `patientId`).
 *   - Non-patient with `?my=1` (staff preview mode): scoped to demo patient `P-001`.
 * - When called by `admin`, `staff`, `nurse`, or `doctor`:
 *   - May filter by `doctorId`, `patientId`, `status`, `type`, `dateFrom`, `dateTo`, `keyword`, `scope`, `sortBy`, `sortDir`.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/appointments.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireAuth();
$pdo  = getDatabaseConnection();

$keyword   = trim((string) ($_GET['keyword'] ?? ''));
$doctorId  = trim((string) ($_GET['doctorId'] ?? ''));
$patientId = trim((string) ($_GET['patientId'] ?? ''));
$status    = trim((string) ($_GET['status'] ?? ''));
$type      = trim((string) ($_GET['type'] ?? ''));
$dateFrom  = trim((string) ($_GET['dateFrom'] ?? ''));
$dateTo    = trim((string) ($_GET['dateTo'] ?? ''));
$scope     = strtolower(trim((string) ($_GET['scope'] ?? '')));
$myFlag    = isset($_GET['my']) && ((string) $_GET['my'] === '1' || strtolower((string) $_GET['my']) === 'true');
$sortBy    = trim((string) ($_GET['sortBy'] ?? 'datetime'));
$sortDir   = strtolower(trim((string) ($_GET['sortDir'] ?? 'desc'))) === 'asc' ? 'ASC' : 'DESC';

// Enforce strict patient ownership scoping
if ($user['role'] === 'patient') {
    $ownPatient = findPatientByUserId($pdo, (string) $user['id']);
    if ($ownPatient === null) {
        sendSuccess('Appointments retrieved successfully.', [
            'appointments' => [],
            'counts'       => [
                'all'       => 0,
                'pending'   => 0,
                'confirmed' => 0,
                'completed' => 0,
                'cancelled' => 0,
            ],
        ]);
    }
    $patientId = (string) $ownPatient['id'];
} elseif ($myFlag && $patientId === '') {
    // Staff/Admin previewing the patient portal (`?my=1`) defaults to demo patient P-001
    $patientId = 'P-001';
}

// Base filter conditions (excluding `status` so we can compute accurate status chip counts)
$baseWhere  = [];
$baseParams = [];

if ($patientId !== '' && strtolower($patientId) !== 'all') {
    $baseWhere[]        = 'a.patient_id = :pid';
    $baseParams[':pid'] = strtoupper($patientId);
}

if ($doctorId !== '' && strtolower($doctorId) !== 'all') {
    $baseWhere[]        = 'a.doctor_id = :did';
    $baseParams[':did'] = strtoupper($doctorId);
}

if ($type !== '' && strtolower($type) !== 'all') {
    $cleanType = strtolower($type);
    if (in_array($cleanType, PRIMECARE_APPOINTMENT_TYPES, true)) {
        $baseWhere[]         = 'a.type = :type';
        $baseParams[':type'] = $cleanType;
    }
}

if ($dateFrom !== '' && getWeekdayCodeForDate($dateFrom) !== null) {
    $baseWhere[]             = 'a.appointment_date >= :date_from';
    $baseParams[':date_from'] = $dateFrom;
}

if ($dateTo !== '' && getWeekdayCodeForDate($dateTo) !== null) {
    $baseWhere[]           = 'a.appointment_date <= :date_to';
    $baseParams[':date_to'] = $dateTo;
}

if ($keyword !== '') {
    $baseWhere[]        = '(a.id LIKE :kw1 OR p.full_name LIKE :kw2 OR d.name LIKE :kw3 OR a.reason LIKE :kw4)';
    $like               = '%' . $keyword . '%';
    $baseParams[':kw1'] = $like;
    $baseParams[':kw2'] = $like;
    $baseParams[':kw3'] = $like;
    $baseParams[':kw4'] = $like;
}

// Compute status counts across the base filter set
$countSql = 'SELECT a.status, COUNT(*) AS cnt
             FROM appointments a
             LEFT JOIN patients p ON p.id = a.patient_id
             LEFT JOIN doctors d ON d.id = a.doctor_id';
if ($baseWhere !== []) {
    $countSql .= ' WHERE ' . implode(' AND ', $baseWhere);
}
$countSql .= ' GROUP BY a.status';

$countStmt = $pdo->prepare($countSql);
$countStmt->execute($baseParams);
$countRows = $countStmt->fetchAll();

$counts = [
    'all'       => 0,
    'pending'   => 0,
    'confirmed' => 0,
    'completed' => 0,
    'cancelled' => 0,
];
foreach ($countRows ?: [] as $cr) {
    $stKey = strtolower((string) ($cr['status'] ?? ''));
    $cVal  = (int) ($cr['cnt'] ?? 0);
    if (isset($counts[$stKey])) {
        $counts[$stKey] = $cVal;
    }
    $counts['all'] += $cVal;
}

// Build final query with status and scope filters
$where  = $baseWhere;
$params = $baseParams;

if ($status !== '' && strtolower($status) !== 'all') {
    foreach (PRIMECARE_APPOINTMENT_STATUSES as $validSt) {
        if (strcasecmp($status, $validSt) === 0) {
            $where[]           = 'a.status = :status';
            $params[':status'] = $validSt;
            break;
        }
    }
}

$todayStr = date('Y-m-d');
if ($scope === 'upcoming') {
    $where[]          = "a.appointment_date >= :scope_today AND a.status NOT IN ('Cancelled', 'Completed')";
    $params[':scope_today'] = $todayStr;
    if (!isset($_GET['sortBy'])) {
        $sortBy  = 'datetime';
        $sortDir = 'ASC';
    }
} elseif ($scope === 'past') {
    $where[]          = "(a.appointment_date < :scope_today OR a.status = 'Completed')";
    $params[':scope_today'] = $todayStr;
    if (!isset($_GET['sortBy'])) {
        $sortBy  = 'datetime';
        $sortDir = 'DESC';
    }
} elseif ($scope === 'cancelled') {
    $where[] = "a.status = 'Cancelled'";
    if (!isset($_GET['sortBy'])) {
        $sortBy  = 'datetime';
        $sortDir = 'DESC';
    }
} elseif ($scope === 'telehealth') {
    $where[]          = "a.type = 'telehealth' AND a.appointment_date >= :scope_today AND a.status IN ('Confirmed', 'Pending')";
    $params[':scope_today'] = $todayStr;
    if (!isset($_GET['sortBy'])) {
        $sortBy  = 'datetime';
        $sortDir = 'ASC';
    }
}

// Strict server-side sort whitelist
$orderClause = match ($sortBy) {
    'id'          => "a.id {$sortDir}",
    'date'        => "a.appointment_date {$sortDir}, a.appointment_time {$sortDir}",
    'patientName' => "p.full_name {$sortDir}, a.appointment_date DESC",
    'doctorName'  => "d.name {$sortDir}, a.appointment_date DESC",
    'status'      => "a.status {$sortDir}, a.appointment_date DESC",
    'type'        => "a.type {$sortDir}, a.appointment_date DESC",
    'createdAt'   => "a.created_at {$sortDir}",
    default       => "a.appointment_date {$sortDir}, a.appointment_time {$sortDir}, a.id {$sortDir}",
};

$sql = 'SELECT a.*,
               p.full_name AS patient_name,
               d.name AS doctor_name,
               d.specialization AS doctor_specialization,
               d.department AS doctor_department,
               d.consultation_fee AS consultation_fee
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors d ON d.id = a.doctor_id';

if ($where !== []) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= ' ORDER BY ' . $orderClause;

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll() ?: [];

$appointmentIds = array_map(static fn(array $r): string => (string) $r['id'], $rows);
$preVisitMap    = fetchPreVisitFormsByAppointmentIds($pdo, $appointmentIds);

$appointments = [];
foreach ($rows as $row) {
    $aid = (string) $row['id'];
    $appointments[] = serializeAppointment($row, $preVisitMap[$aid] ?? null);
}

sendSuccess('Appointments retrieved successfully.', [
    'appointments' => $appointments,
    'counts'       => $counts,
]);

