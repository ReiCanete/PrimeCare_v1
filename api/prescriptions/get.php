<?php
/**
 * PrimeCare - GET /api/prescriptions/get.php?id=RX-001
 * Phase 5.8.2: Retrieve a single prescription with items, doctor metadata, and patient details.
 *
 * Authorization:
 * - Allowed: admin, doctor, nurse, patient.
 * - Staff: 403 Forbidden.
 * - Patient: Can only access prescriptions belonging to their own patient profile (403 IDOR protection).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/prescriptions.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'doctor', 'nurse', 'patient']);
$id   = strtoupper(trim((string) ($_GET['id'] ?? '')));

if ($id === '' || preg_match('/^RX-\d{3,}$/', $id) !== 1) {
    sendError('A valid Prescription ID (e.g., RX-001) is required.', 400);
}

$pdo = getDatabaseConnection();

// IDOR Check for patient session
if ($user['role'] === 'patient') {
    $probe = $pdo->prepare('SELECT patient_id FROM prescriptions WHERE id = :id LIMIT 1');
    $probe->execute([':id' => $id]);
    $owner = $probe->fetch(PDO::FETCH_ASSOC);

    if (!$owner) {
        sendError('Prescription not found.', 404);
    }

    $own = findPatientByUserId($pdo, (string) $user['id']);
    if (!$own || (string) $owner['patient_id'] !== (string) $own['id']) {
        sendError('Forbidden. You do not have permission to view this prescription.', 403);
    }
}

$rx = findPrescriptionById($pdo, $id);
if ($rx === null) {
    sendError('Prescription not found.', 404);
}

sendSuccess('Prescription retrieved successfully.', ['prescription' => $rx]);

