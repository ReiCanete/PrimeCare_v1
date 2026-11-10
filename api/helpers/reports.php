<?php
/**
 * PrimeCare - Reports & Dashboard Analytics Domain Helper
 * Phase 5.11.2: Reports & Dashboard Analytics Backend Implementation
 *
 * Tables queried (read-only; no schema changes):
 * - `patients`
 * - `doctors`
 * - `appointments`
 * - `bills`
 * - `payments`
 * - `admissions`
 * - `beds`
 * - `wards`
 * - `medical_records`
 * - `prescriptions`
 * - `lab_results`
 * - `audit_logs`
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

// Allowed report types
const PRIMECARE_REPORT_TYPES = [
    'daily-admissions',
    'appointments-summary',
    'revenue',
    'doctor-workload',
    'bed-occupancy',
    'lab-summary',
    'registrations',
];

/**
 * Validates strict YYYY-MM-DD calendar date.
 */
function isValidReportDate(string $date): bool
{
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
        return false;
    }
    $parts = explode('-', $date);
    $y = (int) $parts[0];
    $m = (int) $parts[1];
    $d = (int) $parts[2];
    return checkdate($m, $d, $y);
}

/**
 * Fetch the 8 hospital dashboard KPI statistics.
 *
 * @param PDO $pdo
 * @return array<string, int>
 */
function fetchHospitalStats(PDO $pdo): array
{
    $stmt = $pdo->query("
        SELECT
            (SELECT COUNT(*) FROM patients) AS totalPatients,
            (SELECT COUNT(*) FROM doctors WHERE status = 'active') AS totalDoctors,
            (SELECT COUNT(*) FROM appointments WHERE appointment_date = CURDATE() AND status != 'Cancelled') AS appointmentsToday,
            (SELECT COUNT(*) FROM bills WHERE status IN ('Unpaid', 'Partial')) AS pendingBills,
            (SELECT COUNT(*) FROM patients WHERE status = 'pending') AS pendingVerifications,
            (SELECT COUNT(*) FROM admissions WHERE status = 'Admitted') AS admittedInpatients,
            (SELECT COUNT(*) FROM beds WHERE status = 'Available') AS availableBeds,
            (SELECT COUNT(*) FROM lab_results WHERE flag = 'Critical' AND status = 'Completed') AS criticalLabResults
    ");

    $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

    return [
        'totalPatients'        => (int) ($row['totalPatients'] ?? 0),
        'totalDoctors'         => (int) ($row['totalDoctors'] ?? 0),
        'appointmentsToday'    => (int) ($row['appointmentsToday'] ?? 0),
        'pendingBills'         => (int) ($row['pendingBills'] ?? 0),
        'pendingVerifications' => (int) ($row['pendingVerifications'] ?? 0),
        'admittedInpatients'   => (int) ($row['admittedInpatients'] ?? 0),
        'availableBeds'        => (int) ($row['availableBeds'] ?? 0),
        'criticalLabResults'   => (int) ($row['criticalLabResults'] ?? 0),
    ];
}

/**
 * Fetch appointment volume per day for the last N days (for dashboard chart).
 * Matches existing js/api.js:getAppointmentsPerDay format.
 *
 * @param PDO $pdo
 * @param int $days
 * @return array<int, array{date: string, count: int, fullDate: string}>
 */
function fetchAppointmentsPerDay(PDO $pdo, int $days = 7): array
{
    if ($days < 1) {
        $days = 7;
    } elseif ($days > 30) {
        $days = 30;
    }

    $startDate = (new DateTimeImmutable("-{$days} days"))->format('Y-m-d');

    $stmt = $pdo->prepare("
        SELECT 
            DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appt_date,
            COUNT(*) AS cnt
        FROM appointments
        WHERE appointment_date >= :start_date AND appointment_date <= CURDATE()
        GROUP BY appointment_date
    ");
    $stmt->execute([':start_date' => $startDate]);
    $countsByDate = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $countsByDate[$r['appt_date']] = (int) $r['cnt'];
    }

    $result = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $d = new DateTimeImmutable("-{$i} days");
        $dateStr = $d->format('Y-m-d');
        $result[] = [
            'date'     => $d->format('D'), // 'Mon', 'Tue', etc.
            'count'    => $countsByDate[$dateStr] ?? 0,
            'fullDate' => $dateStr,
        ];
    }

    return $result;
}

/**
 * Fetch ward occupancy snapshot (for dashboard pie chart & bed status).
 * Matches existing js/api.js:getWardOccupancy format.
 *
 * @param PDO $pdo
 * @return array<int, array{id: string, name: string, type: string, total: int, occupied: int, percent: int}>
 */
function fetchWardOccupancySnapshot(PDO $pdo): array
{
    $stmt = $pdo->query("
        SELECT 
            w.id,
            w.name,
            w.type,
            COUNT(b.id) AS total_beds,
            COUNT(CASE WHEN b.status = 'Occupied' THEN 1 END) AS occupied_beds
        FROM wards w
        LEFT JOIN beds b ON b.ward_id = w.id
        GROUP BY w.id, w.name, w.type
        ORDER BY w.name ASC
    ");

    $wards = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $total    = (int) $r['total_beds'];
        $occupied = (int) $r['occupied_beds'];
        $percent  = $total > 0 ? (int) round(($occupied / $total) * 100) : 0;
        $wards[] = [
            'id'       => (string) $r['id'],
            'name'     => (string) $r['name'],
            'type'     => (string) $r['type'],
            'total'    => $total,
            'occupied' => $occupied,
            'percent'  => $percent,
        ];
    }

    return $wards;
}

/**
 * Generate one of the seven hospital reports within a validated date range.
 *
 * @param PDO $pdo
 * @param string $type
 * @param string $dateFrom YYYY-MM-DD
 * @param string $dateTo YYYY-MM-DD
 * @return array{ok: bool, status?: int, message?: string, columns?: array<string>, rows?: array<array<mixed>>, summary?: array<string, mixed>, chartData?: array<array{label: string, value: mixed}>}
 */
function generateHospitalReport(PDO $pdo, string $type, string $dateFrom, string $dateTo): array
{
    if (!in_array($type, PRIMECARE_REPORT_TYPES, true)) {
        return [
            'ok'      => false,
            'status'  => 400,
            'message' => 'Invalid report type.',
        ];
    }

    if (!isValidReportDate($dateFrom) || !isValidReportDate($dateTo)) {
        return [
            'ok'      => false,
            'status'  => 400,
            'message' => 'Invalid date format. Expected YYYY-MM-DD.',
        ];
    }

    if ($dateFrom > $dateTo) {
        return [
            'ok'      => false,
            'status'  => 400,
            'message' => 'Date From cannot be after Date To.',
        ];
    }

    switch ($type) {
        case 'daily-admissions':
            return buildDailyAdmissionsReport($pdo, $dateFrom, $dateTo);

        case 'appointments-summary':
            return buildAppointmentsSummaryReport($pdo, $dateFrom, $dateTo);

        case 'revenue':
            return buildRevenueReport($pdo, $dateFrom, $dateTo);

        case 'doctor-workload':
            return buildDoctorWorkloadReport($pdo, $dateFrom, $dateTo);

        case 'bed-occupancy':
            return buildBedOccupancyReport($pdo);

        case 'lab-summary':
            return buildLabSummaryReport($pdo, $dateFrom, $dateTo);

        case 'registrations':
            return buildRegistrationsReport($pdo, $dateFrom, $dateTo);

        default:
            return [
                'ok'      => false,
                'status'  => 400,
                'message' => 'Invalid report type.',
            ];
    }
}

/**
 * Report 1: daily-admissions
 */
function buildDailyAdmissionsReport(PDO $pdo, string $dateFrom, string $dateTo): array
{
    $columns = ['Date', 'Patient ID', 'Patient Name', 'Ward', 'Doctor'];

    $stmt = $pdo->prepare("
        SELECT 
            DATE_FORMAT(a.admit_date, '%Y-%m-%d') AS admit_date,
            a.patient_id,
            COALESCE(p.full_name, 'Unknown') AS patient_name,
            COALESCE(w.name, 'Unknown') AS ward_name,
            COALESCE(d.name, 'Unknown') AS doctor_name
        FROM admissions a
        LEFT JOIN patients p ON p.id = a.patient_id
        LEFT JOIN beds b     ON b.id = a.bed_id
        LEFT JOIN wards w    ON w.id = b.ward_id
        LEFT JOIN doctors d  ON d.id = a.attending_doctor_id
        WHERE a.admit_date BETWEEN :date_from AND :date_to
        ORDER BY a.admit_date ASC, a.id ASC
    ");
    $stmt->execute([':date_from' => $dateFrom, ':date_to' => $dateTo]);

    $rows        = [];
    $dailyCounts = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $rows[] = [
            (string) $r['admit_date'],
            (string) $r['patient_id'],
            (string) $r['patient_name'],
            (string) $r['ward_name'],
            (string) $r['doctor_name'],
        ];
        $date = (string) $r['admit_date'];
        $dailyCounts[$date] = ($dailyCounts[$date] ?? 0) + 1;
    }

    ksort($dailyCounts);
    $chartData = [];
    foreach ($dailyCounts as $date => $val) {
        $chartData[] = ['label' => $date, 'value' => $val];
    }

    return [
        'ok'        => true,
        'columns'   => $columns,
        'rows'      => $rows,
        'summary'   => ['Total Admissions' => count($rows)],
        'chartData' => $chartData,
    ];
}

/**
 * Report 2: appointments-summary
 */
function buildAppointmentsSummaryReport(PDO $pdo, string $dateFrom, string $dateTo): array
{
    $columns = ['Date', 'Doctor', 'Type', 'Status', 'Count'];

    $stmt = $pdo->prepare("
        SELECT 
            DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appt_date,
            COALESCE(d.name, 'Unknown') AS doctor_name,
            a.type AS appt_type,
            a.status AS appt_status,
            1 AS count
        FROM appointments a
        LEFT JOIN doctors d ON d.id = a.doctor_id
        WHERE a.appointment_date BETWEEN :date_from AND :date_to
        ORDER BY a.appointment_date ASC, a.appointment_time ASC, a.id ASC
    ");
    $stmt->execute([':date_from' => $dateFrom, ':date_to' => $dateTo]);

    $rows = [];
    $statusCounts = [
        'Confirmed' => 0,
        'Completed' => 0,
        'Cancelled' => 0,
        'Pending'   => 0,
    ];

    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $status = (string) $r['appt_status'];
        $rows[] = [
            (string) $r['appt_date'],
            (string) $r['doctor_name'],
            (string) $r['appt_type'],
            $status,
            1,
        ];
        if (array_key_exists($status, $statusCounts)) {
            $statusCounts[$status]++;
        }
    }

    $summary = [
        'Total Appointments' => count($rows),
        'Completed'          => $statusCounts['Completed'],
        'Cancelled'          => $statusCounts['Cancelled'],
    ];

    $chartData = [
        ['label' => 'Confirmed', 'value' => $statusCounts['Confirmed']],
        ['label' => 'Completed', 'value' => $statusCounts['Completed']],
        ['label' => 'Cancelled', 'value' => $statusCounts['Cancelled']],
        ['label' => 'Pending',   'value' => $statusCounts['Pending']],
    ];

    return [
        'ok'        => true,
        'columns'   => $columns,
        'rows'      => $rows,
        'summary'   => $summary,
        'chartData' => $chartData,
    ];
}

/**
 * Report 3: revenue
 * Must sum actual payments.amount linked to non-voided bills; never substitute invoice totals.
 */
function buildRevenueReport(PDO $pdo, string $dateFrom, string $dateTo): array
{
    $columns = ['Date', 'Receipt No', 'Bill ID', 'Method', 'Amount'];

    $stmt = $pdo->prepare("
        SELECT 
            DATE_FORMAT(p.paid_at, '%Y-%m-%d') AS payment_date,
            p.receipt_no,
            p.bill_id,
            p.method,
            p.amount
        FROM payments p
        INNER JOIN bills b ON b.id = p.bill_id
        WHERE b.status != 'Voided'
          AND DATE(p.paid_at) BETWEEN :date_from AND :date_to
        ORDER BY p.paid_at ASC, p.receipt_no ASC
    ");
    $stmt->execute([':date_from' => $dateFrom, ':date_to' => $dateTo]);

    $rows         = [];
    $totalRev     = 0.0;
    $methodCounts = [];

    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $amt = (float) $r['amount'];
        $rows[] = [
            (string) $r['payment_date'],
            (string) $r['receipt_no'],
            (string) $r['bill_id'],
            (string) $r['method'],
            $amt,
        ];
        $totalRev += $amt;
        $m = (string) $r['method'];
        $methodCounts[$m] = ($methodCounts[$m] ?? 0.0) + $amt;
    }

    $chartData = [];
    foreach ($methodCounts as $m => $val) {
        $chartData[] = ['label' => $m, 'value' => round($val, 2)];
    }

    return [
        'ok'        => true,
        'columns'   => $columns,
        'rows'      => $rows,
        'summary'   => ['Total Revenue Collected' => round($totalRev, 2)],
        'chartData' => $chartData,
    ];
}

/**
 * Report 4: doctor-workload
 * Must use separate pre-aggregated queries to prevent Cartesian multiplication.
 */
function buildDoctorWorkloadReport(PDO $pdo, string $dateFrom, string $dateTo): array
{
    $columns = ['Doctor', 'Completed Appointments', 'Medical Records Written', 'Prescriptions Issued'];

    $stmt = $pdo->prepare("
        SELECT 
            d.name AS doctor_name,
            COALESCE(appts.cnt, 0) AS completed_appointments,
            COALESCE(meds.cnt, 0)  AS medical_records_written,
            COALESCE(rx.cnt, 0)    AS prescriptions_issued
        FROM doctors d
        LEFT JOIN (
            SELECT doctor_id, COUNT(*) AS cnt 
            FROM appointments 
            WHERE status = 'Completed' 
              AND appointment_date BETWEEN :df1 AND :dt1
            GROUP BY doctor_id
        ) appts ON appts.doctor_id = d.id
        LEFT JOIN (
            SELECT attending_doctor_id, COUNT(*) AS cnt 
            FROM medical_records 
            WHERE DATE(created_at) BETWEEN :df2 AND :dt2
            GROUP BY attending_doctor_id
        ) meds ON meds.attending_doctor_id = d.id
        LEFT JOIN (
            SELECT doctor_id, COUNT(*) AS cnt 
            FROM prescriptions 
            WHERE prescribed_date BETWEEN :df3 AND :dt3
            GROUP BY doctor_id
        ) rx ON rx.doctor_id = d.id
        WHERE (COALESCE(appts.cnt, 0) > 0 
            OR COALESCE(meds.cnt, 0) > 0 
            OR COALESCE(rx.cnt, 0) > 0)
        ORDER BY d.name ASC
    ");
    $stmt->execute([
        ':df1' => $dateFrom,
        ':dt1' => $dateTo,
        ':df2' => $dateFrom,
        ':dt2' => $dateTo,
        ':df3' => $dateFrom,
        ':dt3' => $dateTo,
    ]);

    $rows      = [];
    $chartData = [];

    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $name    = (string) $r['doctor_name'];
        $aCount  = (int) $r['completed_appointments'];
        $rCount  = (int) $r['medical_records_written'];
        $rxCount = (int) $r['prescriptions_issued'];

        $rows[] = [$name, $aCount, $rCount, $rxCount];
        $chartData[] = ['label' => $name, 'value' => $aCount];
    }

    return [
        'ok'        => true,
        'columns'   => $columns,
        'rows'      => $rows,
        'summary'   => ['Active Doctors in Period' => count($rows)],
        'chartData' => $chartData,
    ];
}

/**
 * Report 5: bed-occupancy
 * Real-time snapshot of wards and beds. Overall percentage is weighted: total occupied beds / total beds.
 */
function buildBedOccupancyReport(PDO $pdo): array
{
    $columns = ['Ward', 'Total Beds', 'Occupied', 'Occupancy %'];

    $wards = fetchWardOccupancySnapshot($pdo);

    $rows          = [];
    $chartData     = [];
    $totalBedsAll  = 0;
    $occupiedAll   = 0;

    foreach ($wards as $w) {
        $totalBedsAll += $w['total'];
        $occupiedAll  += $w['occupied'];

        $rows[] = [
            $w['name'],
            $w['total'],
            $w['occupied'],
            "{$w['percent']}%",
        ];
        $chartData[] = [
            'label' => $w['name'],
            'value' => $w['percent'],
        ];
    }

    $overallPct = $totalBedsAll > 0 ? (int) round(($occupiedAll / $totalBedsAll) * 100) : 0;

    return [
        'ok'        => true,
        'columns'   => $columns,
        'rows'      => $rows,
        'summary'   => ['Overall Occupancy' => "{$overallPct}%"],
        'chartData' => $chartData,
    ];
}

/**
 * Report 6: lab-summary
 * Filters Completed tests ordered in the selected period (ordered_date BETWEEN :from AND :to).
 * Preserves existing frontend contract where chartData is empty.
 */
function buildLabSummaryReport(PDO $pdo, string $dateFrom, string $dateTo): array
{
    $columns = ['Category', 'Test Name', 'Normal', 'Abnormal', 'Critical', 'Total'];

    $stmt = $pdo->prepare("
        SELECT 
            category,
            test_name,
            COUNT(CASE WHEN flag = 'Normal' THEN 1 END)   AS normal_count,
            COUNT(CASE WHEN flag = 'Abnormal' THEN 1 END) AS abnormal_count,
            COUNT(CASE WHEN flag = 'Critical' THEN 1 END) AS critical_count,
            COUNT(*) AS total_count
        FROM lab_results
        WHERE status = 'Completed'
          AND ordered_date BETWEEN :date_from AND :date_to
        GROUP BY category, test_name
        ORDER BY category ASC, test_name ASC
    ");
    $stmt->execute([':date_from' => $dateFrom, ':date_to' => $dateTo]);

    $rows = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $rows[] = [
            (string) $r['category'],
            (string) $r['test_name'],
            (int) $r['normal_count'],
            (int) $r['abnormal_count'],
            (int) $r['critical_count'],
            (int) $r['total_count'],
        ];
    }

    $sumStmt = $pdo->prepare("
        SELECT 
            COUNT(*) AS total_completed,
            COUNT(CASE WHEN flag = 'Critical' THEN 1 END) AS critical_findings
        FROM lab_results
        WHERE status = 'Completed'
          AND ordered_date BETWEEN :date_from AND :date_to
    ");
    $sumStmt->execute([':date_from' => $dateFrom, ':date_to' => $dateTo]);
    $sumRow = $sumStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    $summary = [
        'Total Tests Completed' => (int) ($sumRow['total_completed'] ?? 0),
        'Critical Findings'     => (int) ($sumRow['critical_findings'] ?? 0),
    ];

    return [
        'ok'        => true,
        'columns'   => $columns,
        'rows'      => $rows,
        'summary'   => $summary,
        'chartData' => [], // Empty array as expected by frontend
    ];
}

/**
 * Report 7: registrations
 */
function buildRegistrationsReport(PDO $pdo, string $dateFrom, string $dateTo): array
{
    $columns = ['Date', 'Patient ID', 'Name', 'Type', 'Status'];

    $stmt = $pdo->prepare("
        SELECT 
            DATE_FORMAT(created_at, '%Y-%m-%d') AS reg_date,
            id AS patient_id,
            full_name,
            admit_type,
            status
        FROM patients
        WHERE created_at BETWEEN :date_from AND :date_to
        ORDER BY created_at ASC, id ASC
    ");
    $stmt->execute([':date_from' => $dateFrom, ':date_to' => $dateTo]);

    $rows = [];
    $statusCounts = [
        'pending'  => 0,
        'verified' => 0,
        'rejected' => 0,
    ];

    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $status = (string) $r['status'];
        $rows[] = [
            (string) $r['reg_date'],
            (string) $r['patient_id'],
            (string) $r['full_name'],
            (string) $r['admit_type'],
            $status,
        ];
        if (array_key_exists($status, $statusCounts)) {
            $statusCounts[$status]++;
        }
    }

    $summary = [
        'Total Registrations' => count($rows),
        'Verified'            => $statusCounts['verified'],
        'Pending'             => $statusCounts['pending'],
    ];

    $chartData = [
        ['label' => 'PENDING',  'value' => $statusCounts['pending']],
        ['label' => 'VERIFIED', 'value' => $statusCounts['verified']],
        ['label' => 'REJECTED', 'value' => $statusCounts['rejected']],
    ];

    return [
        'ok'        => true,
        'columns'   => $columns,
        'rows'      => $rows,
        'summary'   => $summary,
        'chartData' => $chartData,
    ];
}
