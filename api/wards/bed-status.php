<?php
/**
 * PrimeCare - POST /api/wards/bed-status.php
 * Admin/Nurse-only toggle between Available and Maintenance on unoccupied beds.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/wards.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$actor = requireRole(['admin', 'nurse']);
requireCsrf();

$input  = getJsonInput();
$bedId  = trim((string) ($input['bedId'] ?? ''));
$status = trim((string) ($input['status'] ?? ''));

if ($bedId === '') {
    sendError('Bed ID is required.', 422);
}
if (!in_array($status, ['Available', 'Maintenance'], true)) {
    sendError('Invalid status. Allowed values: Available, Maintenance.', 422);
}

$pdo = getDatabaseConnection();
$pdo->beginTransaction();

try {
    $bedStmt = $pdo->prepare('SELECT id, ward_id, bed_number, status, current_patient_id FROM beds WHERE id = :bid FOR UPDATE');
    $bedStmt->execute([':bid' => $bedId]);
    $bed = $bedStmt->fetch();

    if (!is_array($bed)) {
        $pdo->rollBack();
        sendError('Bed not found.', 404);
    }
    if ($bed['status'] === 'Occupied') {
        $pdo->rollBack();
        sendError('Cannot change status of an occupied bed.', 409);
    }

    $upd = $pdo->prepare('UPDATE beds SET status = :status WHERE id = :bid');
    $upd->execute([':status' => $status, ':bid' => $bedId]);

    writeAuthAuditLog(
        (string) $actor['id'],
        (string) $actor['username'],
        'Change Bed Status',
        "Set bed {$bedId} status to {$status}"
    );

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Failed to update bed status.', 500);
}

$refetch = $pdo->prepare('SELECT id, ward_id, bed_number, status, current_patient_id FROM beds WHERE id = :bid LIMIT 1');
$refetch->execute([':bid' => $bedId]);
$updatedBed = $refetch->fetch();

sendSuccess("Bed status set to {$status}.", [
    'bed' => is_array($updatedBed) ? serializeBed($updatedBed) : null,
]);
