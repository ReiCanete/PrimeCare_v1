<?php
/**
 * PrimeCare - GET /api/reports/stats.php
 * Phase 5.11.2: Hospital dashboard statistics and KPIs.
 *
 * Authorization:
 * - Admin, Doctor, Nurse, Staff only.
 * - Patient -> 403 Forbidden.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/reports.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'doctor', 'nurse', 'staff']);
$pdo  = getDatabaseConnection();

$daysRaw = $_GET['days'] ?? 7;
$days    = is_numeric($daysRaw) ? (int) $daysRaw : 7;
if ($days < 1) {
    $days = 7;
} elseif ($days > 30) {
    $days = 30;
}

$stats              = fetchHospitalStats($pdo);
$appointmentsPerDay = fetchAppointmentsPerDay($pdo, $days);
$wardOccupancy      = fetchWardOccupancySnapshot($pdo);

sendSuccess('Hospital statistics retrieved successfully.', [
    'stats'              => $stats,
    'appointmentsPerDay' => $appointmentsPerDay,
    'wardOccupancy'      => $wardOccupancy,
]);

