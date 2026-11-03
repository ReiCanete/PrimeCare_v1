<?php
/**
 * PrimeCare - Authentication, Authorization (RBAC) & CSRF Helpers
 * Phase 5.2: Authentication & Session Management
 *
 * Public helpers for every protected endpoint:
 *   currentUser()        -> authenticated user (fresh from the database) or null
 *   requireAuth()        -> 401 JSON unless authenticated; returns the user
 *   requireRole([...])   -> 401 unless authenticated, 403 unless role is allowed
 *   requireCsrf()        -> 403 JSON unless a valid CSRF token / same-origin request
 *
 * Roles come from the existing `users.role` ENUM: admin, doctor, nurse, staff, patient.
 * The role is ALWAYS read from the database on each request - never from the client
 * and never cached in the session - so deactivation or role changes apply immediately.
 */

declare(strict_types=1);

// Prevent direct HTTP access to this helper file
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

require_once __DIR__ . '/response.php';
require_once __DIR__ . '/session.php';
require_once __DIR__ . '/../config/database.php';

/** Roles that exist in `users.role` (see database/primecare.sql). */
const PRIMECARE_ROLES = ['admin', 'doctor', 'nurse', 'staff', 'patient'];

/** Hash used only to keep response time similar when a username does not exist. */
const PRIMECARE_DUMMY_PASSWORD_HASH = '$2y$10$cyDVrz9mWImPJjrDPlsOW.NNGdhIYGcwS39LQ0Zdlu4lDmeQa/SXW';

/** Login throttle: this many failures within the window blocks further attempts. */
const PRIMECARE_LOGIN_MAX_FAILURES  = 5;
const PRIMECARE_LOGIN_WINDOW_SECONDS = 300;

// -----------------------------------------------------------------------------
// User lookup & serialization
// -----------------------------------------------------------------------------

/**
 * Convert a `users` row to the safe, client-facing shape (camelCase, matching the
 * legacy frontend user object). NEVER includes password_hash or other internals.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function sanitizeUser(array $row): array
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
        'createdAt'          => $row['created_at'] !== null ? (string) $row['created_at'] : null,
    ];
}

/**
 * Return the authenticated user for this request, or null.
 *
 * The user is re-loaded from the database on every request. If the account no
 * longer exists or is no longer `active`, the session is destroyed.
 *
 * @return array<string, mixed>|null Safe user array (see sanitizeUser()).
 */
function currentUser(): ?array
{
    static $resolved = false;
    static $user     = null;

    if ($resolved) {
        return $user;
    }

    if (!startApiSession(false)) {
        $resolved = true;
        return null;
    }

    $uid = $_SESSION['uid'] ?? null;
    if (!is_string($uid) || $uid === '') {
        $resolved = true;
        return null;
    }

    $stmt = getDatabaseConnection()->prepare(
        'SELECT id, username, full_name, role, status, email, mobile,
                must_change_password, last_login, created_at
         FROM users
         WHERE id = :id
         LIMIT 1'
    );
    $stmt->execute([':id' => $uid]);
    $row = $stmt->fetch();

    if (!is_array($row) || $row['status'] !== 'active' || !in_array($row['role'], PRIMECARE_ROLES, true)) {
        destroyApiSession();
        $resolved = true;
        return null;
    }

    $user     = sanitizeUser($row);
    $resolved = true;

    return $user;
}

/**
 * Require an authenticated session. Sends 401 JSON and stops otherwise.
 *
 * @return array<string, mixed> The authenticated (safe) user.
 */
function requireAuth(): array
{
    $user = currentUser();
    if ($user === null) {
        sendError('Authentication required.', 401);
    }

    return $user;
}

/**
 * Require an authenticated user holding one of the given roles.
 * 401 when not authenticated, 403 when authenticated with the wrong role.
 *
 * @param array<int, string> $allowedRoles Subset of PRIMECARE_ROLES.
 * @return array<string, mixed> The authenticated (safe) user.
 */
function requireRole(array $allowedRoles): array
{
    if ($allowedRoles === [] || array_diff($allowedRoles, PRIMECARE_ROLES) !== []) {
        // Programming error: fail closed rather than silently granting or denying.
        throw new InvalidArgumentException('requireRole() received an empty or unknown role list.');
    }

    $user = requireAuth();
    if (!in_array($user['role'], $allowedRoles, true)) {
        sendError('You do not have permission to access this resource.', 403);
    }

    return $user;
}

// -----------------------------------------------------------------------------
// CSRF protection
//
// Approach (cookie-session architecture): synchronizer token + same-origin checks.
//  1. A random token is stored server-side in the session ($_SESSION['csrf']).
//  2. It is handed to the frontend in JSON (csrf.php / login / me) and kept in
//     JavaScript memory only. State-changing requests echo it in `X-CSRF-Token`.
//  3. The token is rotated at login together with session_regenerate_id().
//  4. If an Origin/Referer header is present it must match the request host.
//  5. State-changing endpoints also require Content-Type: application/json, which
//     a cross-site HTML form cannot send and which is blocked by CORS preflight.
// The token is not the session ID, and the session cookie stays HttpOnly.
// -----------------------------------------------------------------------------

/**
 * Get (creating if needed) the CSRF token bound to the current session.
 */
function getCsrfToken(): string
{
    startApiSession(true);

    if (empty($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf'];
}

/**
 * Replace the CSRF token (call after login so a pre-login token cannot be reused).
 */
function rotateCsrfToken(): string
{
    startApiSession(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(32));

    return $_SESSION['csrf'];
}

/**
 * Validate the CSRF protections for the current state-changing request.
 * Sends 403 JSON and stops when validation fails.
 */
function requireCsrf(): void
{
    // Same-origin check: Origin (preferred) or Referer, when the browser sends one.
    $hostHeader = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $origin     = $_SERVER['HTTP_ORIGIN'] ?? null;
    $referer    = $_SERVER['HTTP_REFERER'] ?? null;
    $source     = null;

    if (is_string($origin) && $origin !== '') {
        $source = $origin;
    } elseif (is_string($referer) && $referer !== '') {
        $source = $referer;
    }

    if ($source !== null) {
        $parts      = parse_url($source);
        $sourceHost = is_array($parts) && isset($parts['host']) ? strtolower($parts['host']) : '';
        if ($sourceHost !== '' && isset($parts['port'])) {
            $sourceHost .= ':' . $parts['port'];
        }

        if ($sourceHost === '' || $hostHeader === '' || $sourceHost !== $hostHeader) {
            sendError('Request rejected: invalid origin.', 403);
        }
    }

    // Synchronizer token check.
    $sent   = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $stored = (session_status() === PHP_SESSION_ACTIVE && isset($_SESSION['csrf']) && is_string($_SESSION['csrf']))
        ? $_SESSION['csrf']
        : '';

    if (!is_string($sent) || $sent === '' || $stored === '' || !hash_equals($stored, $sent)) {
        sendError('Request rejected: missing or invalid security token. Please refresh the page and try again.', 403);
    }
}

/**
 * Require a JSON Content-Type for state-changing requests (sends 415 otherwise).
 */
function requireJsonContentType(): void
{
    $type = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with(trim($type), 'application/json')) {
        sendError('Unsupported media type. Use application/json.', 415);
    }
}

// -----------------------------------------------------------------------------
// Login throttling (file based - no schema change required)
//
// Keyed by client IP + lowercase username. Slows online password guessing.
// Failures are stored as timestamps in the OS temp directory and reset on success.
// -----------------------------------------------------------------------------

function loginThrottleFile(string $username): string
{
    $dir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'primecare_auth_throttle';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }

    $key = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'cli') . '|' . strtolower($username));

    return $dir . DIRECTORY_SEPARATOR . $key . '.json';
}

/**
 * @return array<int, int> Failure timestamps still inside the throttle window.
 */
function loginThrottleLoad(string $username): array
{
    $file = loginThrottleFile($username);
    if (!is_file($file)) {
        return [];
    }

    $decoded = json_decode((string) @file_get_contents($file), true);
    if (!is_array($decoded)) {
        return [];
    }

    $cutoff = time() - PRIMECARE_LOGIN_WINDOW_SECONDS;

    return array_values(array_filter($decoded, static fn($t) => is_int($t) && $t > $cutoff));
}

/**
 * Seconds the caller must wait before another login attempt (0 when allowed).
 */
function loginThrottleRetryAfter(string $username): int
{
    $failures = loginThrottleLoad($username);
    if (count($failures) < PRIMECARE_LOGIN_MAX_FAILURES) {
        return 0;
    }

    $oldestRelevant = $failures[count($failures) - PRIMECARE_LOGIN_MAX_FAILURES];

    return max(1, $oldestRelevant + PRIMECARE_LOGIN_WINDOW_SECONDS - time());
}

function loginThrottleRecordFailure(string $username): void
{
    $failures   = loginThrottleLoad($username);
    $failures[] = time();
    @file_put_contents(loginThrottleFile($username), json_encode($failures), LOCK_EX);
}

function loginThrottleReset(string $username): void
{
    $file = loginThrottleFile($username);
    if (is_file($file)) {
        @unlink($file);
    }
}

// -----------------------------------------------------------------------------
// Audit logging (existing `audit_logs` table)
// -----------------------------------------------------------------------------

/**
 * Write one row to `audit_logs`. Failures are logged server-side and never block auth.
 */
function writeAuthAuditLog(?string $userId, string $username, string $action, string $details): void
{
    try {
        $clean = static fn(string $s, int $max): string => mb_substr(preg_replace('/[\x00-\x1F\x7F]/u', ' ', $s) ?? '', 0, $max);

        $stmt = getDatabaseConnection()->prepare(
            'INSERT INTO audit_logs (log_code, user_id, username, action, details, created_at)
             VALUES (:code, :uid, :uname, :action, :details, NOW())'
        );
        $stmt->execute([
            ':code'    => 'LOG-' . date('YmdHis') . '-' . bin2hex(random_bytes(3)),
            ':uid'     => $userId,
            ':uname'   => $clean($username, 150),
            ':action'  => $clean($action, 100),
            ':details' => $clean($details . ' (IP: ' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . ')', 1000),
        ]);
    } catch (Throwable $e) {
        error_log('[PrimeCare Audit Log Error] ' . $e->getMessage());
    }
}

