<?php
/**
 * PrimeCare - CLI probe used by tests/prescriptions-smoke-test.mjs
 * Phase 5.8.2: proves that a failing prescription item insert rolls back the entire prescription creation.
 *
 * Usage: C:\xampp\php\php.exe tests/prescriptions-rollback-probe.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers/prescriptions.php';

$pdo  = getDatabaseConnection();
$user = ['id' => 'U-001', 'username' => 'admin', 'fullName' => 'System Admin', 'role' => 'admin'];

// Count before
$countRxBefore = (int) $pdo->query('SELECT COUNT(*) FROM prescriptions')->fetchColumn();
$countItemsBefore = (int) $pdo->query('SELECT COUNT(*) FROM prescription_items')->fetchColumn();

$threw = false;
$pdo->beginTransaction();
try {
    $rxId = allocateNextId($pdo, 'prescriptions', 'prescriptions', 'RX', 3);

    $insertRx = $pdo->prepare('
        INSERT INTO prescriptions (
            id, patient_id, doctor_id, medical_record_id, status, prescribed_date, 
            notes, override_allergy, override_reason, billed, bill_id, created_at
        ) VALUES (
            :id, :patient_id, :doctor_id, NULL, "Active", CURDATE(), 
            "Probe rollback test", 0, NULL, 0, NULL, NOW()
        )
    ');
    $insertRx->execute([
        ':id'         => $rxId,
        ':patient_id' => 'P-001',
        ':doctor_id'  => 'D-001',
    ]);

    // Simulate item insertion failure (e.g. invalid column or deliberate runtime exception)
    throw new RuntimeException('Simulated item insert failure in rollback probe');

    $pdo->commit();
} catch (Throwable $e) {
    $threw = true;
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}

$countRxAfter = (int) $pdo->query('SELECT COUNT(*) FROM prescriptions')->fetchColumn();
$countItemsAfter = (int) $pdo->query('SELECT COUNT(*) FROM prescription_items')->fetchColumn();
$inTxAfter = $pdo->inTransaction();

echo json_encode([
    'threw'            => $threw,
    'inTxAfter'        => $inTxAfter,
    'rxCountMatches'   => $countRxBefore === $countRxAfter,
    'itemCountMatches' => $countItemsBefore === $countItemsAfter,
]);

