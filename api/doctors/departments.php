<?php
/**
 * PrimeCare - GET /api/doctors/departments.php
 * Phase 5.5: Read-only department directory integration from `departments` table.
 *
 * Accessible to both public visitors (for departments.html) and authenticated portal users.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/doctors.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$pdo  = getDatabaseConnection();
$name = trim((string) ($_GET['name'] ?? ''));
$id   = trim((string) ($_GET['id'] ?? ''));

if ($id !== '' || $name !== '') {
    $dept = resolveDepartment($pdo, $id !== '' ? $id : $name);
    if ($dept === null) {
        sendError('Department not found.', 404);
    }

    sendSuccess('Department retrieved successfully.', [
        'department' => $dept,
    ]);
}

$stmt = $pdo->query('SELECT * FROM departments ORDER BY id ASC');
$rows = $stmt ? $stmt->fetchAll() : [];

$departments = array_map('serializeDepartment', $rows ?: []);

sendSuccess('Departments retrieved successfully.', [
    'departments' => $departments,
    'count'       => count($departments),
]);

