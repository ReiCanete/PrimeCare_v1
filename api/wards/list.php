<?php
/**
 * PrimeCare - GET /api/wards/list.php
 * List all hospital wards.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/wards.php';

registerApiErrorHandlers();
requireMethod(['GET']);
requireRole(['admin', 'doctor', 'nurse', 'staff']);

$pdo  = getDatabaseConnection();
$stmt = $pdo->query('SELECT id, name, type, daily_rate FROM wards ORDER BY id ASC');
$rows = $stmt ? ($stmt->fetchAll() ?: []) : [];

sendSuccess('Wards retrieved successfully.', [
    'wards' => array_map('serializeWard', $rows),
]);
