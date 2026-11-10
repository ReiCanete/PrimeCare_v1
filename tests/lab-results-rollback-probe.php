<?php
/**
 * PrimeCare - CLI probe used by tests/lab-results-smoke-test.mjs
 * Phase 5.10.2 (remediation H3): proves rollback through the REAL production writers.
 *
 * Usage: C:\xampp\php\php.exe tests/lab-results-rollback-probe.php [orderedLabId]
 *
 * It calls createLabOrderRecord() / updateLabResultRecord() exactly as the API endpoints do, but
 * passes a `$failureInjector` that throws INSIDE the real transaction (after every write, including
 * the sequence allocation and audit log, and before commit). It then verifies that nothing leaked:
 *
 *  A. create  - no lab row, no sequence advance, no audit row, no open transaction
 *  B. update  - the disposable Ordered record is byte-for-byte unchanged, no audit row
 *  C. control - the same update with a NON-failing injector commits (proves A/B are real rollbacks)
 *
 * Scenarios B and C need a disposable `Ordered` lab record created by the smoke test (never a seed
 * record); omit the argument to run scenario A only. Scenario C completes that disposable record.
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers/lab_results.php';

$labId = strtoupper((string) ($argv[1] ?? ''));
if ($labId !== '' && (in_array($labId, ['LAB-001', 'LAB-002'], true) || preg_match('/^LAB-\d{3,}$/', $labId) !== 1)) {
    echo json_encode(['error' => 'A disposable test record ID (never LAB-001 / LAB-002) is required.']);
    exit(2);
}

$pdo   = getDatabaseConnection();
$admin = ['id' => 'U-001', 'username' => 'admin', 'fullName' => 'System Admin', 'role' => 'admin'];

$labIds = static function (PDO $pdo): array {
    $ids = $pdo->query('SELECT id FROM lab_results ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
    return array_map('strval', $ids);
};
$sequence = static fn(PDO $pdo): int => (int) $pdo->query("SELECT current_val FROM sequences WHERE entity_key = 'labResults'")->fetchColumn();
$auditCount = static function (PDO $pdo, string $action): int {
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM audit_logs WHERE action = :a');
    $stmt->execute([':a' => $action]);
    return (int) $stmt->fetchColumn();
};
$labRow = static function (PDO $pdo, string $id): ?array {
    $stmt = $pdo->prepare('SELECT * FROM lab_results WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : $row;
};

$out = [];

// --- A. createLabOrderRecord with failure injected inside the real transaction ---------------------
$idsBefore   = $labIds($pdo);
$seqBefore   = $sequence($pdo);
$auditBefore = $auditCount($pdo, 'Create Lab Order');
$injectedA   = false;
$seenStageA  = null;
$seenIdA     = null;

$resA = createLabOrderRecord(
    $pdo,
    ['patientId' => 'P-001', 'testName' => 'ROLLBACK-PROBE create', 'category' => 'Hematology'],
    $admin,
    static function (string $stage, string $allocatedId) use (&$injectedA, &$seenStageA, &$seenIdA): void {
        $injectedA  = true;
        $seenStageA = $stage;
        $seenIdA    = $allocatedId;
        throw new RuntimeException('Injected failure inside createLabOrderRecord transaction');
    }
);

$out['create'] = [
    'injectorRan'         => $injectedA,
    'stage'               => $seenStageA,
    'allocatedId'         => $seenIdA,
    'ok'                  => $resA['ok'] ?? null,
    'status'              => $resA['status'] ?? null,
    'labIdsUnchanged'     => $idsBefore === $labIds($pdo),
    'allocatedIdAbsent'   => $seenIdA !== null && !in_array($seenIdA, $labIds($pdo), true),
    'sequenceUnchanged'   => $seqBefore === $sequence($pdo),
    'auditUnchanged'      => $auditBefore === $auditCount($pdo, 'Create Lab Order'),
    'inTransaction'       => $pdo->inTransaction(),
];

// --- B / C. updateLabResultRecord on a disposable Ordered record ----------------------------------
if ($labId !== '') {
    $before = $labRow($pdo, $labId);
    if ($before === null || (string) $before['status'] !== 'Ordered') {
        echo json_encode(['error' => "{$labId} must exist and be in 'Ordered' status for the update scenarios."]);
        exit(2);
    }

    $payload = [
        'id'             => $labId,
        'result'         => '5.0',
        'unit'           => 'mg/dL',
        'referenceRange' => ['min' => '3', 'max' => '8'],
    ];

    $auditUpdBefore = $auditCount($pdo, 'Update Lab Result');
    $injectedB      = false;

    $resB = updateLabResultRecord(
        $pdo,
        $labId,
        $payload,
        $admin,
        static function (string $stage, string $id) use (&$injectedB): void {
            $injectedB = true;
            throw new RuntimeException('Injected failure inside updateLabResultRecord transaction');
        }
    );

    $afterB = $labRow($pdo, $labId);
    $out['update'] = [
        'injectorRan'     => $injectedB,
        'ok'              => $resB['ok'] ?? null,
        'status'          => $resB['status'] ?? null,
        'rowUnchanged'    => $before == $afterB,
        'stillOrdered'    => ($afterB['status'] ?? '') === 'Ordered' && array_key_exists('result', $afterB ?? []) && $afterB['result'] === null,
        'auditUnchanged'  => $auditUpdBefore === $auditCount($pdo, 'Update Lab Result'),
        'inTransaction'   => $pdo->inTransaction(),
    ];

    // Control: identical call with an injector that does NOT throw must commit.
    $stageC = null;
    $resC = updateLabResultRecord(
        $pdo,
        $labId,
        $payload,
        $admin,
        static function (string $stage, string $id) use (&$stageC): void {
            $stageC = $stage;
        }
    );
    $afterC = $labRow($pdo, $labId);
    $out['control'] = [
        'injectorRan'   => $stageC !== null,
        'ok'            => $resC['ok'] ?? null,
        'completed'     => ($afterC['status'] ?? '') === 'Completed' && ($afterC['flag'] ?? '') === 'Normal',
        'inTransaction' => $pdo->inTransaction(),
    ];
}

echo json_encode($out, JSON_UNESCAPED_SLASHES);
