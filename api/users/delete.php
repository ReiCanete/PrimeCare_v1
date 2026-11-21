<?php
/**
 * PrimeCare - POST /api/users/delete.php
 * Admin-only user deletion with strict self, last-admin, and referential integrity checks.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/users.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$admin = requireRole(['admin']);
requireCsrf();

$input = getJsonInput();
$id    = trim((string) ($input['id'] ?? ''));

if ($id === '') {
    sendError('User ID is required.', 400);
}
if ($id === $admin['id']) {
    sendError('You cannot delete yourself.', 422);
}

$pdo      = getDatabaseConnection();
$existing = findManagedUserById($pdo, $id);

if ($existing === null) {
    sendError('User not found.', 404);
}
if ($existing['role'] === 'patient') {
    sendError('Patient accounts must be managed through Patient Records.', 422);
}
if ($existing['role'] === 'admin' && $existing['status'] === 'active') {
    if (countActiveAdmins($pdo, $id) < 1) {
        sendError('Cannot delete the last active admin.', 409);
    }
}

$referenceChecks = [
    ['table' => 'appointments',    'column' => 'created_by'],
    ['table' => 'medical_records', 'column' => 'created_by'],
    ['table' => 'bills',           'column' => 'created_by'],
    ['table' => 'doctors',         'column' => 'user_id'],
    ['table' => 'patients',        'column' => 'user_id'],
    ['table' => 'audit_logs',      'column' => 'user_id'],
];

foreach ($referenceChecks as $ref) {
    $cStmt = $pdo->prepare("SELECT COUNT(*) FROM `{$ref['table']}` WHERE `{$ref['column']}` = :uid");
    $cStmt->execute([':uid' => $id]);
    if ((int) $cStmt->fetchColumn() > 0) {
        sendError('Cannot delete user with existing system records. Please deactivate them instead.', 409);
    }
}

$pdo->beginTransaction();
try {
    $delStmt = $pdo->prepare('DELETE FROM users WHERE id = :id');
    $delStmt->execute([':id' => $id]);

    // Resync users sequence to avoid tail gap inflation on clean deletes
    $maxStmt = $pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(id, 3) AS UNSIGNED)), 0) FROM users WHERE id REGEXP '^U-[0-9]+$'");
    $maxNum  = (int) ($maxStmt ? $maxStmt->fetchColumn() : 0);
    $seqStmt = $pdo->prepare("UPDATE sequences SET current_val = :val WHERE entity_key = 'users'");
    $seqStmt->execute([':val' => max(6, $maxNum)]);

    writeUserAuditLog($pdo, $admin, 'Delete User', "Deleted unreferenced user {$id} ({$existing['username']})");
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Cannot delete user with existing system records. Please deactivate them instead.', 409);
}

sendSuccess('User deleted.', [
    'deletedId' => $id,
]);
