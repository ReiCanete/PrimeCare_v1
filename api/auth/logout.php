<?php
/**
 * PrimeCare - POST /api/auth/logout.php
 * Phase 5.2: Authentication
 *
 * Destroys the server-side session and clears the session cookie.
 * Idempotent: if there is no session, it still returns success.
 * When a session exists, a valid CSRF token (X-CSRF-Token) is required.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/auth.php';

registerApiErrorHandlers();
requireMethod(['POST']);

$user = currentUser(); // also validates / starts the session if a cookie was sent

if ($user === null) {
    destroyApiSession(); // clears any stale cookie
    sendSuccess('Logged out.');
}

requireCsrf();
writeAuthAuditLog($user['id'], $user['username'], 'Logout', 'User logged out.');
destroyApiSession();

sendSuccess('Logged out.');

