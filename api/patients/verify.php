<?php
/**
 * PrimeCare - POST /api/patients/verify.php
 * Phase 5.3.2: Verify or Reject a patient registration (Staff or Admin only)
 *
 * Synchronizes both `patients.status` ('verified' / 'rejected') and the linked
 * `users.status` ('active' / 'rejected'), creates a portal notification on verification,
 * and records an audit log entry.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/patients.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$staff = requireRole(['admin', 'staff']);
requireCsrf();

$input  = getJsonInput();
$id     = trim((string) ($input['id'] ?? ''));
$action = strtolower(trim((string) ($input['action'] ?? 'verify')));
$reason = trim((string) ($input['reason'] ?? ''));

if ($id === '') {
    sendError('Patient ID is required.', 400);
}
if (!in_array($action, ['verify', 'reject'], true)) {
    sendError('Invalid action. Must be "verify" or "reject".', 400);
}
if ($action === 'reject' && mb_strlen($reason) < 10) {
    sendError('Rejection reason must be at least 10 characters.', 400);
}

$pdo  = getDatabaseConnection();
$stmt = $pdo->prepare('SELECT * FROM patients WHERE id = :id LIMIT 1');
$stmt->execute([':id' => $id]);
$row = $stmt->fetch();

if (!is_array($row)) {
    sendError('Patient not found.', 404);
}

$linkedUserId = $row['user_id'] !== null ? (string) $row['user_id'] : null;
$today        = date('Y-m-d');

$pdo->beginTransaction();
try {
    if ($action === 'verify') {
        $upd = $pdo->prepare(
            "UPDATE patients
             SET status = 'verified',
                 verified_by = :verified_by,
                 verified_at = :verified_at,
                 rejection_reason = NULL
             WHERE id = :id"
        );
        $upd->execute([
            ':verified_by' => mb_substr((string) $staff['fullName'], 0, 150),
            ':verified_at' => $today,
            ':id'          => $id,
        ]);

        if ($linkedUserId !== null && $linkedUserId !== '') {
            $uUpd = $pdo->prepare("UPDATE users SET status = 'active' WHERE id = :uid");
            $uUpd->execute([':uid' => $linkedUserId]);

            createPatientNotification(
                $pdo,
                $id,
                'account',
                'Account Verified',
                'Your account has been verified. You can now book appointments.',
                'home.html'
            );
        }
    } else {
        $upd = $pdo->prepare(
            "UPDATE patients
             SET status = 'rejected',
                 rejection_reason = :reason
             WHERE id = :id"
        );
        $upd->execute([
            ':reason' => $reason,
            ':id'     => $id,
        ]);

        if ($linkedUserId !== null && $linkedUserId !== '') {
            $uUpd = $pdo->prepare("UPDATE users SET status = 'rejected' WHERE id = :uid");
            $uUpd->execute([':uid' => $linkedUserId]);
        }
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

if ($action === 'verify') {
    writeAuthAuditLog($staff['id'], $staff['username'], 'Verify Patient', "Verified patient {$id}");
    $updated = findPatientById($pdo, $id);
    sendSuccess('Patient verified successfully.', ['patient' => $updated]);
} else {
    writeAuthAuditLog($staff['id'], $staff['username'], 'Reject Patient', "Rejected patient {$id}. Reason: {$reason}");
    $updated = findPatientById($pdo, $id);
    sendSuccess('Patient application rejected.', ['patient' => $updated]);
}

