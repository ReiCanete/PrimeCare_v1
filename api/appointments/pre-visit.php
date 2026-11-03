<?php
/**
 * PrimeCare - GET / POST /api/appointments/pre-visit.php
 * Phase 5.6.2: Retrieve or submit Telehealth Pre-Visit Questionnaire and evaluate server-side join eligibility.
 *
 * GET ?appointmentId=A-002
 * - Requires authenticated session (`requireAuth()`).
 * - Patients may only access their own appointment's pre-visit form and join check (403 on IDOR).
 * - Staff, clinical (`doctor`, `nurse`), and `admin` roles may view any appointment's pre-visit form.
 * - Returns `{ preVisitForm: array|null, canJoin: { allowed: bool, reason: string, minutesUntil?: int } }`.
 *
 * POST
 * - Requires authenticated `patient` session (`requireRole(['patient'])`) and valid CSRF token (`requireCsrf()`).
 * - Enforces patient ownership of `appointmentId` (403 if not owned by caller).
 * - Enforces `appointment.type === 'telehealth'` and `appointment.status !== 'Cancelled'`.
 * - Enforces `symptoms` length >= 5 characters and `consent === true`.
 * - Resolves patient `allergies` from the database (`patients.allergies`) if not explicitly supplied.
 * - Upserts into `pre_visit_forms` using `uq_pre_visit_appointment (appointment_id)` with deterministic ID `PVF-{appointmentId}`.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/appointments.php';

registerApiErrorHandlers();
requireMethod(['GET', 'POST']);

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$pdo    = getDatabaseConnection();

if ($method === 'GET') {
    $user          = requireAuth();
    $appointmentId = strtoupper(trim((string) ($_GET['appointmentId'] ?? $_GET['id'] ?? '')));

    if ($appointmentId === '' || !preg_match('/^A-\d{3,}$/i', $appointmentId)) {
        sendError('A valid Appointment ID (e.g., A-002) is required.', 400);
    }

    $appt = findAppointmentById($pdo, $appointmentId);
    if ($appt === null) {
        sendError('Appointment not found.', 404);
    }

    if ($user['role'] === 'patient') {
        $ownPatient = findPatientByUserId($pdo, (string) $user['id']);
        if ($ownPatient === null || (string) $ownPatient['id'] !== (string) $appt['patientId']) {
            sendError('Forbidden: You can only view pre-visit questionnaires for your own appointments.', 403);
        }
    }

    $preVisit = $appt['preVisitForm'] ?? null;
    $canJoin  = evaluateTelehealthJoinEligibility($appt, $preVisit);

    sendSuccess('Pre-visit form status retrieved successfully.', [
        'appointmentId' => $appointmentId,
        'form'          => $preVisit,
        'preVisitForm'  => $preVisit,
        'canJoin'       => $canJoin,
    ]);
}

// POST: Submit / Upsert Pre-Visit Questionnaire
requireJsonContentType();
$user = requireRole(['patient']);
requireCsrf();

$input         = getJsonInput();
$appointmentId = strtoupper(trim((string) ($input['appointmentId'] ?? '')));

if ($appointmentId === '' || !preg_match('/^A-\d{3,}$/i', $appointmentId)) {
    sendError('A valid Appointment ID (e.g., A-002) is required.', 400);
}

$ownPatient = findPatientByUserId($pdo, (string) $user['id']);
if ($ownPatient === null) {
    sendError('No linked patient record found.', 403);
}
if ((string) $ownPatient['status'] !== 'verified') {
    sendError('Only verified patients can submit pre-visit forms.', 403);
}

$appt = findAppointmentById($pdo, $appointmentId);
if ($appt === null) {
    sendError('Appointment not found.', 404);
}

if ((string) $appt['patientId'] !== (string) $ownPatient['id']) {
    sendError('Forbidden: You can only submit a pre-visit form for your own appointment.', 403);
}

if ((string) $appt['type'] !== 'telehealth') {
    sendError('Pre-visit questionnaires are only applicable to telehealth appointments.', 400);
}

if ((string) $appt['status'] === 'Cancelled' || (string) $appt['status'] === 'Completed') {
    sendError("Cannot submit a pre-visit form for a {$appt['status']} appointment.", 400);
}

$symptoms    = trim((string) ($input['symptoms'] ?? ''));
$duration    = trim((string) ($input['duration'] ?? $input['symptomDuration'] ?? ''));
$medications = trim((string) ($input['medications'] ?? $input['currentMedications'] ?? ''));
$allergies   = trim((string) ($input['allergies'] ?? ''));
$consentRaw  = $input['consent'] ?? false;
$consent     = ($consentRaw === true || $consentRaw === 1 || $consentRaw === '1' || $consentRaw === 'true');

if (mb_strlen($symptoms) < 5) {
    sendError('Please describe your symptoms (at least 5 characters).', 400);
}

if (!$consent) {
    sendError('You must consent to the telehealth session.', 400);
}

// Default allergies from the verified patient's database record if not explicitly passed
if ($allergies === '') {
    $allergies = trim((string) ($ownPatient['allergies'] ?? 'None'));
}

if (mb_strlen($duration) > 100) {
    $duration = mb_substr($duration, 0, 100);
}

$formId = 'PVF-' . $appointmentId;
$nowStr = date('Y-m-d H:i:s');

$stmt = $pdo->prepare(
    'INSERT INTO pre_visit_forms (
        id, appointment_id, symptoms, duration, medications, allergies, consent, submitted_at
    ) VALUES (
        :id, :appointment_id, :symptoms, :duration, :medications, :allergies, :consent, :submitted_at
    )
    ON DUPLICATE KEY UPDATE
        symptoms = VALUES(symptoms),
        duration = VALUES(duration),
        medications = VALUES(medications),
        allergies = VALUES(allergies),
        consent = VALUES(consent),
        submitted_at = VALUES(submitted_at)'
);
$stmt->execute([
    ':id'             => $formId,
    ':appointment_id' => $appointmentId,
    ':symptoms'       => $symptoms,
    ':duration'       => $duration !== '' ? $duration : null,
    ':medications'    => $medications !== '' ? $medications : null,
    ':allergies'      => $allergies !== '' ? $allergies : null,
    ':consent'        => 1,
    ':submitted_at'   => $nowStr,
]);

$savedForm   = findPreVisitFormByAppointmentId($pdo, $appointmentId);
$updatedAppt = findAppointmentById($pdo, $appointmentId);
$canJoin     = $updatedAppt !== null ? evaluateTelehealthJoinEligibility($updatedAppt, $savedForm) : ['allowed' => false];

writeAuthAuditLog(
    (string) $user['id'],
    (string) $user['username'],
    'Submit Pre-Visit Form',
    "Submitted telehealth pre-visit questionnaire for appointment {$appointmentId}"
);

sendSuccess('Pre-visit form submitted.', [
    'form'         => $savedForm,
    'preVisitForm' => $savedForm,
    'appointment'  => $updatedAppt,
    'canJoin'      => $canJoin,
]);
