<?php
/**
 * PrimeCare - GET /api/appointments/get.php?id=A-001
 * Phase 5.6.2: Retrieve individual appointment details with patient, doctor, and pre-visit form data.
 *
 * Authorization:
 * - Requires authenticated session (`requireAuth()`).
 * - Patients may only view their own appointments (`patient_id === own patient ID`);
 *   attempting to view another patient's appointment returns HTTP 403.
 * - Staff, clinical, and admin roles may view any appointment.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/appointments.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireAuth();
$id   = strtoupper(trim((string) ($_GET['id'] ?? '')));

if ($id === '' || !preg_match('/^A-\d{3,}$/i', $id)) {
    sendError('A valid Appointment ID (e.g., A-001) is required.', 400);
}

$pdo  = getDatabaseConnection();
$appt = findAppointmentById($pdo, $id);

if ($appt === null) {
    sendError('Appointment not found.', 404);
}

if ($user['role'] === 'patient') {
    $ownPatient = findPatientByUserId($pdo, (string) $user['id']);
    if ($ownPatient === null || (string) $ownPatient['id'] !== (string) $appt['patientId']) {
        sendError('Forbidden: You do not have permission to view this appointment.', 403);
    }
}

sendSuccess('Appointment retrieved successfully.', [
    'appointment' => $appt,
]);

