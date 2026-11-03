<?php
/**
 * PrimeCare - POST /api/auth/change-password.php
 * Phase 5.3.2: Authenticated password change (`patient/profile.html` & force-password modal)
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/auth.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireAuth();
requireCsrf();

$input       = getJsonInput();
$oldPassword = (string) ($input['oldPassword'] ?? '');
$newPassword = (string) ($input['newPassword'] ?? '');

if ($oldPassword === '' || $newPassword === '') {
    sendError('Current password and new password are required.', 400);
}

if (!preg_match('/^(?=.*[A-Z])(?=.*\d).{8,}$/', $newPassword)) {
    sendError('Password must be min 8 chars, 1 uppercase, 1 number.', 400);
}

$pdo  = getDatabaseConnection();
$stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
$stmt->execute([':id' => $user['id']]);
$row = $stmt->fetch();

if (!is_array($row) || !password_verify($oldPassword, (string) $row['password_hash'])) {
    sendError('Incorrect current password.', 400);
}

$newHash = password_hash($newPassword, PASSWORD_DEFAULT);
$upd     = $pdo->prepare('UPDATE users SET password_hash = :hash, must_change_password = 0 WHERE id = :id');
$upd->execute([
    ':hash' => $newHash,
    ':id'   => $user['id'],
]);

writeAuthAuditLog($user['id'], $user['username'], 'Change Password', 'User changed their own password.');

$updatedUser = currentUser();
sendSuccess('Password updated successfully.', ['user' => $updatedUser]);

