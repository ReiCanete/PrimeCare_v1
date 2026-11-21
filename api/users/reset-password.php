<?php
/**
 * PrimeCare - POST /api/users/reset-password.php
 * Admin-only secure temporary password reset (forces password change on next login).
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

$pdo      = getDatabaseConnection();
$existing = findManagedUserById($pdo, $id);

if ($existing === null) {
    sendError('User not found.', 404);
}

$tempPw = generateTemporaryPassword();
$pwHash = password_hash($tempPw, PASSWORD_BCRYPT);

$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare(
        'UPDATE users
         SET password_hash = :hash,
             must_change_password = 1
         WHERE id = :id'
    );
    $stmt->execute([':hash' => $pwHash, ':id' => $id]);

    writeUserAuditLog($pdo, $admin, 'Reset Password', "Reset password for user {$id} ({$existing['username']})");
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Failed to reset user password.', 500);
}

sendSuccess('Password reset successfully.', [
    'user'         => findManagedUserById($pdo, $id),
    'tempPassword' => $tempPw,
]);
