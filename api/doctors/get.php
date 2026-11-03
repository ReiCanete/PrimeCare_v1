<?php
/**
 * PrimeCare - GET /api/doctors/get.php?id=D-001
 * Phase 5.5: Retrieve individual doctor details with department and weekly schedule.
 *
 * Authorization:
 * - Requires authenticated session (`requireAuth()`).
 * - Patients may only view `active` doctors (or doctors linked to their historical appointments/records).
 * - Staff, clinical, and admin roles may view any doctor (active or inactive).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/doctors.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireAuth();
$id   = trim((string) ($_GET['id'] ?? ''));

if ($id === '' || !preg_match('/^D-\d{3,}$/i', $id)) {
    sendError('A valid Doctor ID (e.g., D-001) is required.', 400);
}

$pdo    = getDatabaseConnection();
$doctor = findDoctorById($pdo, strtoupper($id));

if ($doctor === null) {
    sendError('Doctor not found.', 404);
}

sendSuccess('Doctor retrieved successfully.', [
    'doctor' => $doctor,
]);

