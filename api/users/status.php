<?php
/**
 * PrimeCare - POST /api/users/status.php
 * Admin-only endpoint to activate or deactivate a staff/admin user account.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/users.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$admin = requireRole(['admin']);
requireCsrf();

$input  = getJsonInput();
$id     = trim((string) ($input['id'] ?? ''));
$status = trim((string) ($input['status'] ?? ''));

if ($id === '') {
    sendError('User ID is required.', 400);
}
if (!in_array($status, PRIMECARE_MANAGED_STATUSES, true)) {
    sendError('Status must be active or inactive.', 422);
}
if ($id === $admin['id'] && $status === 'inactive') {
    sendError('You cannot deactivate your own account.', 422);
}

$pdo      = getDatabaseConnection();
$existing = findManagedUserById($pdo, $id);

if ($existing === null) {
    sendError('User not found.', 404);
}
if ($existing['role'] === 'patient') {
    sendError('Patient accounts must be managed through Patient Records.', 422);
}
if ($status === 'inactive' && $existing['role'] === 'admin' && $existing['status'] === 'active') {
    if (countActiveAdmins($pdo, $id) < 1) {
        sendError('Cannot deactivate the last active admin.', 409);
    }
}

$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare('UPDATE users SET status = :status WHERE id = :id');
    $stmt->execute([':status' => $status, ':id' => $id]);

    writeUserAuditLog($pdo, $admin, 'Change User Status', "Set user {$id} ({$existing['username']}) status to {$status}");
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Failed to update user status.', 500);
}

sendSuccess("User status set to {$status}.", [
    'user' => findManagedUserById($pdo, $id),
]);
