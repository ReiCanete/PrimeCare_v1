<?php
/**
 * PrimeCare - GET /api/appointments/slots.php?doctorId=D-001&date=2026-11-05[&excludeId=A-002]
 * Phase 5.6.2: Calculate available time slots for a doctor on a given date.
 *
 * Authorization:
 * - Requires authenticated session (`requireAuth()`).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/appointments.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user      = requireAuth();
$doctorId  = strtoupper(trim((string) ($_GET['doctorId'] ?? '')));
$dateStr   = trim((string) ($_GET['date'] ?? ''));
$excludeId = strtoupper(trim((string) ($_GET['excludeId'] ?? '')));

if ($doctorId === '' || !preg_match('/^D-\d{3,}$/i', $doctorId)) {
    sendError('A valid Doctor ID (e.g., D-001) is required.', 400);
}

if ($dateStr === '' || getWeekdayCodeForDate($dateStr) === null) {
    sendError('A valid appointment date (YYYY-MM-DD) is required.', 400);
}

$pdo   = getDatabaseConnection();
$slots = computeDoctorSlots($pdo, $doctorId, $dateStr, $excludeId !== '' ? $excludeId : null);

sendSuccess('Available slots retrieved successfully.', [
    'doctorId' => $doctorId,
    'date'     => $dateStr,
    'slots'    => $slots,
]);

