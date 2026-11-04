<?php
/**
 * PrimeCare - CLI probe used by tests/billing-smoke-test.mjs
 * Phase 5.9.2: Proves that a failure during bill item insertion rolls back the entire bill creation.
 *
 * Usage: C:\xampp\php\php.exe tests/billing-rollback-probe.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers/billing.php';

$pdo  = getDatabaseConnection();
$user = ['id' => 'U-001', 'username' => 'admin', 'fullName' => 'System Admin', 'role' => 'admin'];

// Counts before
$countBillsBefore = (int) $pdo->query('SELECT COUNT(*) FROM bills')->fetchColumn();
$countItemsBefore = (int) $pdo->query('SELECT COUNT(*) FROM bill_items')->fetchColumn();

$threw = false;
$pdo->beginTransaction();
try {
    $billId = allocateNextId($pdo, 'bills', 'bills', 'B', 3);

    $insBill = $pdo->prepare('
        INSERT INTO bills (
            id, patient_id, admission_id, subtotal, discount_type, discount_amount,
            insurance_provider, insurance_coverage, total, amount_paid, balance,
            status, void_reason, created_by, created_at
        ) VALUES (
            :id, :patient_id, NULL, 500.00, "None", 0.00,
            "", 0.00, 500.00, 0.00, 500.00,
            "Unpaid", NULL, :created_by, NOW()
        )
    ');
    $insBill->execute([
        ':id'         => $billId,
        ':patient_id' => 'P-001',
        ':created_by' => $user['id'],
    ]);

    // Deliberate simulated failure
    throw new RuntimeException('Simulated failure during bill items insertion in rollback probe');

    $pdo->commit();
} catch (Throwable $e) {
    $threw = true;
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}

// Counts after
$countBillsAfter = (int) $pdo->query('SELECT COUNT(*) FROM bills')->fetchColumn();
$countItemsAfter = (int) $pdo->query('SELECT COUNT(*) FROM bill_items')->fetchColumn();

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'threw'            => $threw,
    'inTransaction'    => $pdo->inTransaction(),
    'countBillsBefore' => $countBillsBefore,
    'countBillsAfter'  => $countBillsAfter,
    'countItemsBefore' => $countItemsBefore,
    'countItemsAfter'  => $countItemsAfter,
    'billsUnchanged'   => ($countBillsBefore === $countBillsAfter),
    'itemsUnchanged'   => ($countItemsBefore === $countItemsAfter),
], JSON_PRETTY_PRINT);

