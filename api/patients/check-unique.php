<?php
/**
 * PrimeCare - GET /api/patients/check-unique.php
 * Phase 5.3.2: Safe uniqueness checks for username, email, mobile, national ID, and ID types catalog.
 *
 * Returns ONLY a boolean `{ "taken": true|false }` (or `{ "idTypes": [...] }`) and never exposes
 * any user or patient data.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/patients.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$pdo       = getDatabaseConnection();
$field     = trim((string) ($_GET['field'] ?? ''));
$value     = trim((string) ($_GET['value'] ?? ''));
$excludeId = isset($_GET['excludeId']) && trim((string) $_GET['excludeId']) !== ''
    ? trim((string) $_GET['excludeId'])
    : null;

if ($field === 'idTypes') {
    $stmt = $pdo->query('SELECT name FROM id_types ORDER BY sort_order ASC, id ASC');
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_COLUMN) : [];
    sendSuccess('ID types retrieved.', ['idTypes' => array_values($rows ?: [])]);
}

if ($field === 'nextId') {
    requireRole(['admin', 'staff']);
    sendSuccess('Next patient ID preview.', ['nextPreviewId' => previewNextPatientId($pdo)]);
}

$taken = false;

switch ($field) {
    case 'username':
        $taken = isUsernameTakenInDb($pdo, $value, $excludeId);
        break;

    case 'email':
        $taken = isEmailTakenInDb($pdo, $value, $excludeId);
        break;

    case 'mobile':
        $taken = isMobileTakenInDb($pdo, $value, $excludeId);
        break;

    case 'id':
        $idType   = trim((string) ($_GET['idType'] ?? ''));
        $idNumber = trim((string) ($_GET['idNumber'] ?? ''));
        $taken    = isNationalIdTakenInDb($pdo, $idType, $idNumber, $excludeId);
        break;

    default:
        sendError('Invalid uniqueness check field.', 400);
}

sendSuccess('Uniqueness check completed.', ['taken' => $taken]);

