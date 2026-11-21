<?php
/**
 * PrimeCare - GET /api/users/audit-logs.php
 * Admin-only audit activity log listing with date/user/keyword filters.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/users.php';

registerApiErrorHandlers();
requireMethod(['GET']);
requireRole(['admin']);

$userId   = trim((string) ($_GET['userId'] ?? ''));
$dateFrom = trim((string) ($_GET['dateFrom'] ?? ''));
$dateTo   = trim((string) ($_GET['dateTo'] ?? ''));
$keyword  = trim((string) ($_GET['keyword'] ?? ''));

$where  = [];
$params = [];

if ($userId !== '') {
    $where[]           = 'user_id = :uid';
    $params[':uid']    = $userId;
}

if ($dateFrom !== '') {
    if (!isValidDateString($dateFrom)) {
        sendError('Invalid dateFrom filter.', 422);
    }
    $where[]         = 'DATE(created_at) >= :dfrom';
    $params[':dfrom'] = $dateFrom;
}

if ($dateTo !== '') {
    if (!isValidDateString($dateTo)) {
        sendError('Invalid dateTo filter.', 422);
    }
    $where[]       = 'DATE(created_at) <= :dto';
    $params[':dto'] = $dateTo;
}

if ($keyword !== '') {
    $where[]        = '(username LIKE :kw1 OR action LIKE :kw2 OR details LIKE :kw3)';
    $like           = '%' . $keyword . '%';
    $params[':kw1'] = $like;
    $params[':kw2'] = $like;
    $params[':kw3'] = $like;
}

$sql = 'SELECT log_code, user_id, username, action, details, created_at FROM audit_logs';
if ($where !== []) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= ' ORDER BY created_at DESC, id DESC LIMIT 500';

$pdo  = getDatabaseConnection();
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll() ?: [];

$logs = array_map(static fn(array $r): array => [
    'id'        => (string) $r['log_code'],
    'userId'    => $r['user_id'] !== null ? (string) $r['user_id'] : '',
    'username'  => (string) $r['username'],
    'action'    => (string) $r['action'],
    'details'   => (string) $r['details'],
    'timestamp' => str_replace(' ', 'T', (string) $r['created_at']),
], $rows);

sendSuccess('Audit logs retrieved successfully.', [
    'logs'  => $logs,
    'total' => count($logs),
]);
