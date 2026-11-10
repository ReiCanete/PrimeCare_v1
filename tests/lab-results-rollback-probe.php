<?php
/**
 * PrimeCare - CLI probe used by tests/lab-results-smoke-test.mjs
 * Phase 5.10.2: Proves transactional rollback integrity for lab results.
 *
 * Usage: C:\xampp\php\php.exe tests/lab-results-rollback-probe.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers/lab_results.php';

$pdo  = getDatabaseConnection();
$user = ['id' => 'U-001', 'username' => 'admin', 'fullName' => 'System Admin', 'role' => 'admin'];

// Count before
$countBefore = (int) $pdo->query('SELECT COUNT(*) FROM lab_results')->fetchColumn();
$seqBefore   = (int) $pdo->query("SELECT current_val FROM sequences WHERE entity_key = 'labResults'")->fetchColumn();

$threw = false;
$pdo->beginTransaction();
try {
    $labId = allocateNextId($pdo, 'labResults', 'lab_results', 'LAB', 3);

    $insert = $pdo->prepare('
        INSERT INTO lab_results (
            id, patient_id, ordered_by, test_name, category,
            status, result, unit, ref_range_min, ref_range_max,
            flag, attachment_name, ordered_date, result_date,
            performed_by, billed, bill_id
        ) VALUES (
            :id, "P-001", "D-001", "Rollback Test Lab", "Hematology",
            "Ordered", NULL, NULL, NULL, NULL,
            NULL, NULL, CURDATE(), NULL,
            NULL, 0, NULL
        )
    ');
    $insert->execute([':id' => $labId]);

    // Deliberate simulated mid-transaction failure
    throw new RuntimeException('Simulated runtime failure before commit in lab rollback probe');

    $pdo->commit();
} catch (Throwable $e) {
    $threw = true;
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}

$countAfter = (int) $pdo->query('SELECT COUNT(*) FROM lab_results')->fetchColumn();
$inTxAfter  = $pdo->inTransaction();

// Clean up sequence change caused by transaction rollback if needed
if ($seqBefore > 0) {
    $updSeq = $pdo->prepare("UPDATE sequences SET current_val = :val WHERE entity_key = 'labResults'");
    $updSeq->execute([':val' => $seqBefore]);
}

echo json_encode([
    'threw'        => $threw,
    'inTxAfter'    => $inTxAfter,
    'countMatches' => $countBefore === $countAfter,
]);
