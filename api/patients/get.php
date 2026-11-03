<?php
/**
 * PrimeCare - GET /api/patients/get.php
 * Phase 5.3.2: Retrieve a single patient record by ID (Staff/Clinical) or ?me=1 (Patient Portal)
 *
 * Enforces strict ownership (IDOR protection):
 * - A `patient` user may ONLY retrieve their own linked patient record.
 * - Staff/clinical/admin users may retrieve any patient by `?id=P-XXX`, or preview `P-001` via `?me=1`.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/patients.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireAuth();
$pdo  = getDatabaseConnection();

$isMe = isset($_GET['me']) && ($_GET['me'] === '1' || $_GET['me'] === 'true');
$id   = trim((string) ($_GET['id'] ?? ''));

if ($user['role'] === 'patient') {
    $ownPatient = findPatientByUserId($pdo, $user['id']);
    if ($ownPatient === null) {
        sendError('No linked patient record found. Please visit the hospital registration desk.', 404);
    }

    // Prevent IDOR: a patient cannot query another patient's ID
    if (!$isMe && $id !== '' && strcasecmp($id, (string) $ownPatient['id']) !== 0) {
        sendError('You do not have permission to view another patient\'s record.', 403);
    }

    sendSuccess('Patient profile retrieved.', [
        'patient'     => $ownPatient,
        'previewMode' => false,
    ]);
}

// Staff / Admin / Doctor / Nurse
if ($isMe) {
    // Staff/Admin visiting Patient Portal in read-only Preview Mode
    $demoPatient = findPatientById($pdo, 'P-001');
    if ($demoPatient === null) {
        $firstStmt   = $pdo->query('SELECT * FROM patients ORDER BY id ASC LIMIT 1');
        $firstRow    = $firstStmt ? $firstStmt->fetch() : false;
        $demoPatient = is_array($firstRow) ? serializePatient($firstRow) : null;
    }

    if ($demoPatient === null) {
        sendError('No patient records available for preview.', 404);
    }

    sendSuccess('Preview patient profile retrieved.', [
        'patient'     => $demoPatient,
        'previewMode' => true,
    ]);
}

if ($id === '') {
    sendError('Patient ID is required.', 400);
}

$patient = findPatientById($pdo, $id);
if ($patient === null) {
    sendError('Patient not found.', 404);
}

sendSuccess('Patient retrieved successfully.', [
    'patient'     => $patient,
    'previewMode' => false,
]);

