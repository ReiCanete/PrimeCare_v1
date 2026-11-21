<?php
/**
 * PrimeCare - GET /api/users/list.php
 * Admin-only listing of users with optional role, status, and keyword filters.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/users.php';

registerApiErrorHandlers();
requireMethod(['GET']);
requireRole(['admin']);

$pdo     = getDatabaseConnection();
$role    = trim((string) ($_GET['role'] ?? 'All'));
$status  = trim((string) ($_GET['status'] ?? 'All'));
$keyword = trim((string) ($_GET['keyword'] ?? ''));

$where  = [];
$params = [];

if ($role !== '' && strcasecmp($role, 'All') !== 0) {
    if (!in_array($role, PRIMECARE_ROLES, true)) {
        sendError('Invalid role filter.', 422);
    }
    $where[]         = 'role = :role';
    $params[':role'] = $role;
}

if ($status !== '' && strcasecmp($status, 'All') !== 0) {
    $allowedStatuses = ['active', 'inactive', 'pending', 'rejected'];
    if (!in_array($status, $allowedStatuses, true)) {
        sendError('Invalid status filter.', 422);
    }
    $where[]           = 'status = :status';
    $params[':status'] = $status;
}

if ($keyword !== '') {
    $where[]        = '(full_name LIKE :kw1 OR username LIKE :kw2 OR email LIKE :kw3)';
    $like           = '%' . $keyword . '%';
    $params[':kw1'] = $like;
    $params[':kw2'] = $like;
    $params[':kw3'] = $like;
}

$sql = 'SELECT id, username, full_name, role, status, email, mobile,
               must_change_password, last_login, created_by, created_at
        FROM users';
if ($where !== []) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= ' ORDER BY full_name ASC, id ASC';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll() ?: [];

$users = array_map('serializeManagedUser', $rows);

sendSuccess('Users retrieved successfully.', [
    'users' => $users,
    'total' => count($users),
]);
