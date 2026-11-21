<?php
/**
 * PrimeCare - GET /api/users/get.php?id=U-XXX
 * Admin-only lookup for a single user record.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/users.php';

registerApiErrorHandlers();
requireMethod(['GET']);
requireRole(['admin']);

$id = trim((string) ($_GET['id'] ?? ''));
if ($id === '') {
    sendError('User ID is required.', 400);
}

$pdo  = getDatabaseConnection();
$user = findManagedUserById($pdo, $id);

if ($user === null) {
    sendError('User not found.', 404);
}

sendSuccess('User retrieved successfully.', [
    'user' => $user,
]);
