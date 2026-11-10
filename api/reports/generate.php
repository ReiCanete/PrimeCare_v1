<?php
/**
 * PrimeCare - POST /api/reports/generate.php
 * Phase 5.11.2: Generate hospital analytics reports.
 *
 * Authorization:
 * - Admin only.
 * - Doctor, Nurse, Staff, Patient -> 403 Forbidden.
 * - Requires CSRF token and JSON content type.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/reports.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(['admin']);
requireCsrf();

$input    = getJsonInput();
$type     = trim((string) ($input['type'] ?? ''));
$dateFrom = trim((string) ($input['dateFrom'] ?? ''));
$dateTo   = trim((string) ($input['dateTo'] ?? ''));

if ($type === '') {
    sendError('Report type is required.', 400);
}

if (!in_array($type, PRIMECARE_REPORT_TYPES, true)) {
    sendError('Invalid report type. Allowed types: ' . implode(', ', PRIMECARE_REPORT_TYPES), 400);
}

if ($dateFrom === '' || $dateTo === '') {
    sendError('Both Date From and Date To are required.', 400);
}

if (!isValidReportDate($dateFrom) || !isValidReportDate($dateTo)) {
    sendError('Invalid date format. Expected YYYY-MM-DD.', 400);
}

if ($dateFrom > $dateTo) {
    sendError('Date From cannot be after Date To.', 400);
}

$pdo = getDatabaseConnection();

$result = generateHospitalReport($pdo, $type, $dateFrom, $dateTo);

if (empty($result['ok'])) {
    sendError((string) ($result['message'] ?? 'Failed to generate report.'), (int) ($result['status'] ?? 400));
}

writeAuthAuditLog(
    (string) ($user['id'] ?? 'SYSTEM'),
    (string) ($user['username'] ?? 'unknown'),
    'Generate Report',
    "Generated {$type} report from {$dateFrom} to {$dateTo}"
);

sendSuccess('Report generated successfully.', [
    'type'      => $type,
    'dateFrom'  => $dateFrom,
    'dateTo'    => $dateTo,
    'columns'   => $result['columns'] ?? [],
    'rows'      => $result['rows'] ?? [],
    'summary'   => $result['summary'] ?? [],
    'chartData' => $result['chartData'] ?? [],
]);

