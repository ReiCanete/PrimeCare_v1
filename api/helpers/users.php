<?php
/**
 * PrimeCare - User Management & Audit Log Helpers
 *
 * Tables used (zero DDL changes):
 * - `users`
 * - `doctors`
 * - `patients`
 * - `appointments`
 * - `medical_records`
 * - `bills`
 * - `audit_logs`
 * - `sequences`
 */

declare(strict_types=1);

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => 'Direct access to helper files is forbidden.',
        'data'    => null,
    ]);
    exit;
}

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/patients.php';

const PRIMECARE_STAFF_MANAGED_ROLES = ['admin', 'doctor', 'nurse', 'staff'];
const PRIMECARE_MANAGED_STATUSES    = ['active', 'inactive'];

/**
 * Convert a `users` DB row to the safe camelCase user payload.
 * Never includes `password_hash`.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function serializeManagedUser(array $row): array
{
    return [
        'id'                 => (string) $row['id'],
        'username'           => (string) $row['username'],
        'fullName'           => (string) $row['full_name'],
        'role'               => (string) $row['role'],
        'status'             => (string) $row['status'],
        'email'              => (string) $row['email'],
        'mobile'             => $row['mobile'] !== null ? (string) $row['mobile'] : null,
        'mustChangePassword' => (bool) $row['must_change_password'],
        'lastLogin'          => $row['last_login'] !== null ? (string) $row['last_login'] : null,
        'createdBy'          => $row['created_by'] !== null ? (string) $row['created_by'] : null,
        'createdAt'          => $row['created_at'] !== null ? (string) $row['created_at'] : null,
    ];
}

/**
 * Generate a cryptographically random temporary password (>= 12 chars with uppercase, lowercase, digit).
 */
function generateTemporaryPassword(): string
{
    $upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    $lower = 'abcdefghijkmnopqrstuvwxyz';
    $digit = '23456789';
    $all   = $upper . $lower . $digit;

    $chars = [
        $upper[random_int(0, strlen($upper) - 1)],
        $lower[random_int(0, strlen($lower) - 1)],
        $digit[random_int(0, strlen($digit) - 1)],
    ];

    for ($i = 0; $i < 9; $i++) {
        $chars[] = $all[random_int(0, strlen($all) - 1)];
    }

    // Fisher-Yates shuffle with CSPRNG
    for ($i = count($chars) - 1; $i > 0; $i--) {
        $j         = random_int(0, $i);
        $tmp       = $chars[$i];
        $chars[$i] = $chars[$j];
        $chars[$j] = $tmp;
    }

    return implode('', $chars);
}

/**
 * Write one user-management audit entry into `audit_logs`.
 *
 * @param PDO                  $pdo
 * @param array<string, mixed> $actor
 * @param string               $action
 * @param string               $details
 */
function writeUserAuditLog(PDO $pdo, array $actor, string $action, string $details): void
{
    $clean = static fn(string $s, int $max): string => mb_substr(preg_replace('/[\x00-\x1F\x7F]/u', ' ', $s) ?? '', 0, $max);
    $stmt  = $pdo->prepare(
        'INSERT INTO audit_logs (log_code, user_id, username, action, details, created_at)
         VALUES (:code, :uid, :uname, :action, :details, NOW())'
    );
    $stmt->execute([
        ':code'    => 'LOG-' . date('YmdHis') . '-' . bin2hex(random_bytes(3)),
        ':uid'     => $actor['id'] ?? null,
        ':uname'   => $clean((string) ($actor['username'] ?? 'admin'), 150),
        ':action'  => $clean($action, 100),
        ':details' => $clean($details, 1000),
    ]);
}

/**
 * Count active administrators, optionally excluding one user ID.
 */
function countActiveAdmins(PDO $pdo, ?string $excludeUserId = null): int
{
    if ($excludeUserId !== null && $excludeUserId !== '') {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active' AND id != :uid");
        $stmt->execute([':uid' => $excludeUserId]);
        return (int) $stmt->fetchColumn();
    }

    $stmt = $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'");
    return (int) ($stmt ? $stmt->fetchColumn() : 0);
}

/**
 * Fetch a single managed user row by ID (without password_hash), or null if not found.
 *
 * @return array<string, mixed>|null
 */
function findManagedUserById(PDO $pdo, string $id): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, username, full_name, role, status, email, mobile,
                must_change_password, last_login, created_by, created_at
         FROM users
         WHERE id = :id
         LIMIT 1'
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    return is_array($row) ? serializeManagedUser($row) : null;
}
