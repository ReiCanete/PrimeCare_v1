<?php
/**
 * PrimeCare - GET /api/wards/beds.php
 * List beds with optional wardId and status filters.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/wards.php';

registerApiErrorHandlers();
requireMethod(['GET']);
requireRole(['admin', 'doctor', 'nurse', 'staff']);

$wardId = trim((string) ($_GET['wardId'] ?? 'All'));
$status = trim((string) ($_GET['status'] ?? 'All'));

$where  = [];
$params = [];

if ($wardId !== '' && strcasecmp($wardId, 'All') !== 0) {
    $where[]           = 'ward_id = :wid';
    $params[':wid']    = $wardId;
}

if ($status !== '' && strcasecmp($status, 'All') !== 0) {
    if (!in_array($status, ['Available', 'Occupied', 'Maintenance'], true)) {
        sendError('Invalid bed status filter.', 422);
    }
    $where[]           = 'status = :status';
    $params[':status'] = $status;
}

$sql = 'SELECT id, ward_id, bed_number, status, current_patient_id FROM beds';
if ($where !== []) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= ' ORDER BY id ASC';

$pdo  = getDatabaseConnection();
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll() ?: [];

sendSuccess('Beds retrieved successfully.', [
    'beds' => array_map('serializeBed', $rows),
]);
