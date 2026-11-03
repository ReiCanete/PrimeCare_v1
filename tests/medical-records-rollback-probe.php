<?php
/**
 * PrimeCare - CLI probe used by tests/medical-records-smoke-test.mjs
 * Phase 5.7.2: proves that a failing history insert rolls back the matching record change.
 *
 * Usage: php tests/medical-records-rollback-probe.php <recordId> <patientId>
 *
 * It calls the REAL transactional writers (updateClinicalRecord / saveVitalsRecord) but injects a
 * history appender that throws, then reports whether the record row was left untouched.
 * The record passed in must be a disposable test record created by the smoke test - never M-001.
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers/medical_records.php';

$recordId  = strtoupper((string) ($argv[1] ?? ''));
$patientId = strtoupper((string) ($argv[2] ?? ''));

if ($recordId === '' || $recordId === 'M-001' || $patientId === '') {
    echo json_encode(['error' => 'A disposable test record ID (not M-001) and patient ID are required.']);
    exit(2);
}

$pdo  = getDatabaseConnection();
$user = ['id' => 'U-001', 'username' => 'admin', 'fullName' => 'System Admin', 'role' => 'admin'];

$failingAppender = static function (PDO $pdo, string $id, string $by, string $summary, string $ts): void {
    throw new RuntimeException('Simulated history insertion failure');
};

$snapshot = static function (PDO $pdo, string $id): array {
    $r = $pdo->prepare('SELECT diagnosis, treatment_notes, vital_heart_rate, updated_at FROM medical_records WHERE id = :id');
    $r->execute([':id' => $id]);
    $row = $r->fetch() ?: [];
    $h = $pdo->prepare('SELECT COUNT(*) FROM medical_record_history WHERE medical_record_id = :id');
    $h->execute([':id' => $id]);
    $row['history_count'] = (int) $h->fetchColumn();
    return $row;
};

$out = [];

// --- Scenario A: clinical update with failing history insert --------------------------------------
$beforeA = $snapshot($pdo, $recordId);
$threwA  = false;
try {
    updateClinicalRecord($pdo, $user, $recordId, [
        'id'             => $recordId,
        'patientId'      => $patientId,
        'diagnosis'      => 'ROLLBACK-PROBE diagnosis',
        'treatmentNotes' => 'ROLLBACK-PROBE treatment',
    ], $failingAppender);
} catch (Throwable $e) {
    $threwA = true;
}
$afterA = $snapshot($pdo, $recordId);
$out['update'] = [
    'threw'            => $threwA,
    'rowUnchanged'     => $beforeA === $afterA,
    'historyUnchanged' => ($beforeA['history_count'] ?? -1) === ($afterA['history_count'] ?? -2),
    'notTouched'       => ($afterA['diagnosis'] ?? '') !== 'ROLLBACK-PROBE diagnosis',
    'inTransaction'    => $pdo->inTransaction(),
];

// --- Scenario B: vitals update with failing history insert ---------------------------------------
$beforeB = $snapshot($pdo, $recordId);
$newHr   = ((int) ($beforeB['vital_heart_rate'] ?? 0)) === 123 ? 124 : 123;
$threwB  = false;
try {
    saveVitalsRecord($pdo, $user, $patientId, ['heartRate' => $newHr], $failingAppender);
} catch (Throwable $e) {
    $threwB = true;
}
$afterB = $snapshot($pdo, $recordId);
$out['vitals'] = [
    'threw'            => $threwB,
    'rowUnchanged'     => $beforeB === $afterB,
    'historyUnchanged' => ($beforeB['history_count'] ?? -1) === ($afterB['history_count'] ?? -2),
    'inTransaction'    => $pdo->inTransaction(),
];

echo json_encode($out, JSON_UNESCAPED_SLASHES);

