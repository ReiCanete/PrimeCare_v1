<?php
/**
 * PrimeCare - POST /api/users/role.php
 * Admin-only endpoint to reassign a staff user's role safely.
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
$role  = trim((string) ($input['role'] ?? ''));

if ($id === '') {
    sendError('User ID is required.', 400);
}
if (!in_array($role, PRIMECARE_STAFF_MANAGED_ROLES, true)) {
    sendError('Role must be one of: admin, doctor, nurse, staff.', 422);
}
if ($id === $admin['id']) {
    sendError('You cannot change your own role.', 422);
}

$pdo      = getDatabaseConnection();
$existing = findManagedUserById($pdo, $id);

if ($existing === null) {
    sendError('User not found.', 404);
}
if ($existing['role'] === 'patient') {
    sendError('Patient accounts cannot be assigned staff roles.', 422);
}
if ($existing['role'] === 'admin' && $existing['status'] === 'active' && $role !== 'admin') {
    if (countActiveAdmins($pdo, $id) < 1) {
        sendError('Cannot demote the last active admin.', 409);
    }
}

$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare('UPDATE users SET role = :role WHERE id = :id');
    $stmt->execute([':role' => $role, ':id' => $id]);

    writeUserAuditLog($pdo, $admin, 'Change User Role', "Set user {$id} ({$existing['username']}) role to {$role}");
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Failed to update user role.', 500);
}

sendSuccess("User role changed to {$role}.", [
    'user' => findManagedUserById($pdo, $id),
]);
