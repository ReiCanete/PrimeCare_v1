<?php
/**
 * PrimeCare - POST /api/auth/login.php
 * Phase 5.2: Authentication
 *
 * Request  (application/json, header X-CSRF-Token from csrf.php):
 *   { "username": "staff", "password": "..." }
 *
 * Success 200: { success: true,  data: { user: {...safe fields...}, csrfToken: "..." } }
 * Failure 400: missing / malformed fields
 *         401: invalid credentials (generic message - never says which part was wrong)
 *         403: valid credentials but account is not active, or CSRF failure
 *         429: too many failed attempts
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/auth.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

startApiSession(true);
requireCsrf();

$input    = getJsonInput();
$username = $input['username'] ?? null;
$password = $input['password'] ?? null;

if (!is_string($username) || !is_string($password) || trim($username) === '' || $password === '') {
    sendError('Username and password are required.', 400);
}

$username = trim($username);
if (mb_strlen($username) > 50 || strlen($password) > 255) {
    sendError('Invalid username or password.', 401);
}

$retryAfter = loginThrottleRetryAfter($username);
if ($retryAfter > 0) {
    header('Retry-After: ' . $retryAfter);
    sendError('Too many failed login attempts. Please try again in ' . $retryAfter . ' seconds.', 429);
}

$pdo  = getDatabaseConnection();
$stmt = $pdo->prepare(
    'SELECT id, username, password_hash, full_name, role, status, email, mobile,
            must_change_password, last_login, created_at
     FROM users
     WHERE username = :username
     LIMIT 1'
);
$stmt->execute([':username' => $username]);
$row = $stmt->fetch();

// Always run one password_verify() so unknown usernames cost the same time as wrong passwords.
$hashToCheck = is_array($row) ? (string) $row['password_hash'] : PRIMECARE_DUMMY_PASSWORD_HASH;
$passwordOk  = password_verify($password, $hashToCheck);

if (!is_array($row) || !$passwordOk) {
    loginThrottleRecordFailure($username);
    if (is_array($row)) {
        writeAuthAuditLog((string) $row['id'], (string) $row['username'], 'Login Failed', 'Incorrect credentials supplied.');
    }
    sendError('Invalid username or password.', 401);
}

// Credentials are correct. Only now reveal (and enforce) account state.
if ($row['status'] !== 'active' || !in_array($row['role'], PRIMECARE_ROLES, true)) {
    writeAuthAuditLog((string) $row['id'], (string) $row['username'], 'Login Blocked', 'Account status: ' . $row['status']);
    sendError('This account is not active. Please contact the hospital administrator.', 403);
}

// Upgrade the hash transparently if the algorithm/cost defaults have changed.
if (password_needs_rehash((string) $row['password_hash'], PASSWORD_DEFAULT)) {
    $rehash = $pdo->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
    $rehash->execute([':hash' => password_hash($password, PASSWORD_DEFAULT), ':id' => $row['id']]);
}

$touch = $pdo->prepare('UPDATE users SET last_login = CURDATE() WHERE id = :id');
$touch->execute([':id' => $row['id']]);

// Session fixation defence: new session ID (old one deleted) + fresh CSRF token.
session_regenerate_id(true);
$_SESSION['uid']           = (string) $row['id'];
$_SESSION['login_at']      = time();
$_SESSION['created_at']    = time();
$_SESSION['last_activity'] = time();
$csrfToken = rotateCsrfToken();

loginThrottleReset($username);
writeAuthAuditLog((string) $row['id'], (string) $row['username'], 'Login', 'User logged in.');

$user = currentUser();
if ($user === null) {
    sendError('Unable to establish a session. Please try again.', 500);
}

sendSuccess('Login successful.', [
    'user'      => $user,
    'csrfToken' => $csrfToken,
]);

