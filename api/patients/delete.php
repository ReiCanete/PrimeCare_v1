<?php
/**
 * PrimeCare - POST /api/patients/delete.php
 * Phase 5.3.2: Admin-only patient deletion with referential integrity checks
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/patients.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$admin = requireRole(['admin']);
requireCsrf();

$input = getJsonInput();
$id    = trim((string) ($input['id'] ?? ''));

if ($id === '') {
    sendError('Patient ID is required.', 400);
}

$pdo  = getDatabaseConnection();
$stmt = $pdo->prepare('SELECT * FROM patients WHERE id = :id LIMIT 1');
$stmt->execute([':id' => $id]);
$row = $stmt->fetch();

if (!is_array($row)) {
    sendError('Patient not found.', 404);
}

// Check all child tables that reference patients(id) with ON DELETE RESTRICT
$childTables = [
    'appointments',
    'medical_records',
    'prescriptions',
    'lab_results',
    'immunizations',
    'admissions',
    'bills',
];

foreach ($childTables as $table) {
    $cStmt = $pdo->prepare("SELECT COUNT(*) FROM `{$table}` WHERE patient_id = :pid");
    $cStmt->execute([':pid' => $id]);
    if ((int) $cStmt->fetchColumn() > 0) {
        sendError('Cannot delete patient. They have existing records.', 409);
    }
}

$linkedUserId = $row['user_id'] !== null ? (string) $row['user_id'] : null;
$fullName     = (string) $row['full_name'];

$pdo->beginTransaction();
try {
    $delPat = $pdo->prepare('DELETE FROM patients WHERE id = :id');
    $delPat->execute([':id' => $id]);

    if ($linkedUserId !== null && $linkedUserId !== '') {
        // Only remove the linked user if it is a patient account without audit/appointment dependencies
        $delUser = $pdo->prepare("DELETE FROM users WHERE id = :uid AND role = 'patient'");
        $delUser->execute([':uid' => $linkedUserId]);
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Cannot delete patient. They have existing records.', 409);
}

writeAuthAuditLog($admin['id'], $admin['username'], 'Delete Patient', "Deleted patient {$id} ({$fullName})");

sendSuccess('Patient deleted successfully.', ['deletedId' => $id, 'deletedUserId' => $linkedUserId]);
