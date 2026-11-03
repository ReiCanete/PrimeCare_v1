<?php
/**
 * PrimeCare - Secure PHP Session Handling
 * Phase 5.2: Authentication & Session Management
 *
 * Responsibilities:
 * - One consistent place that configures and starts the PHP session.
 * - HttpOnly + SameSite cookies, Secure flag only when the request really is HTTPS.
 * - Strict session mode (PHP rejects session IDs it did not issue).
 * - Idle and absolute session timeouts.
 * - Proper destruction (server data + cookie).
 *
 * Session IDs are never placed in JSON responses, URLs or JavaScript-readable storage.
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

/** Name of the PrimeCare session cookie (distinct from other localhost apps' PHPSESSID). */
const PRIMECARE_SESSION_NAME = 'PRIMECARE_SESSID';

/** Sessions with no activity for this many seconds are discarded (30 minutes). */
const PRIMECARE_SESSION_IDLE_TIMEOUT = 1800;

/** Sessions older than this many seconds are discarded regardless of activity (8 hours). */
const PRIMECARE_SESSION_ABSOLUTE_TIMEOUT = 28800;

/**
 * Determine whether the CURRENT request really arrived over HTTPS.
 *
 * XAMPP on localhost normally uses plain HTTP, so `Secure` must NOT be forced on
 * (the browser would refuse to send the cookie back and login would silently break).
 * `X-Forwarded-Proto` is only honoured when PRIMECARE_TRUST_PROXY=1 is set, because
 * the header is client-controlled unless a trusted reverse proxy overwrites it.
 */
function isHttpsRequest(): bool
{
    $https = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
    if ($https !== '' && $https !== 'off') {
        return true;
    }

    if ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443) {
        return true;
    }

    if (getenv('PRIMECARE_TRUST_PROXY') === '1'
        && strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
        return true;
    }

    return false;
}

/**
 * Cookie path scoped to the PrimeCare project folder (e.g. "/PrimeCare_v1/"),
 * derived from the API script location so it works whatever the folder is called.
 */
function getSessionCookiePath(): string
{
    $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/'));
    $pos    = strpos($script, '/api/');
    $base   = ($pos === false) ? '' : substr($script, 0, $pos);

    return ($base === '') ? '/' : $base . '/';
}

/**
 * Cookie attributes shared by session start and session cookie removal.
 *
 * @return array{lifetime: int, path: string, domain: string, secure: bool, httponly: bool, samesite: string}
 */
function getSessionCookieParams(): array
{
    return [
        'lifetime' => 0,                      // browser-session cookie (no persistent login)
        'path'     => getSessionCookiePath(),
        'domain'   => '',                     // host-only cookie
        'secure'   => isHttpsRequest(),
        'httponly' => true,                   // not readable from JavaScript
        'samesite' => 'Lax',                  // not sent on cross-site POST/fetch requests
    ];
}

/**
 * Start (or resume) the PrimeCare PHP session. Safe to call repeatedly.
 *
 * @param bool $createIfMissing When false, no session is started unless the browser
 *                              already sent a PrimeCare session cookie. This stops
 *                              anonymous /me or logout requests from creating sessions.
 * @return bool True when a session is active after the call.
 */
function startApiSession(bool $createIfMissing = true): bool
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return true;
    }

    if (!$createIfMissing && empty($_COOKIE[PRIMECARE_SESSION_NAME])) {
        return false;
    }

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.cookie_httponly', '1');

    session_name(PRIMECARE_SESSION_NAME);
    session_set_cookie_params(getSessionCookieParams());
    session_cache_limiter(''); // sendResponse() already sends Cache-Control: no-store

    if (!session_start()) {
        throw new RuntimeException('Unable to start the PHP session.');
    }

    $now     = time();
    $created = $_SESSION['created_at'] ?? null;
    $last    = $_SESSION['last_activity'] ?? null;

    $idleExpired     = is_int($last) && ($now - $last) > PRIMECARE_SESSION_IDLE_TIMEOUT;
    $absoluteExpired = is_int($created) && ($now - $created) > PRIMECARE_SESSION_ABSOLUTE_TIMEOUT;

    if ($idleExpired || $absoluteExpired) {
        // Drop all stale data and move to a brand-new session ID.
        $_SESSION = [];
        session_regenerate_id(true);
        $created = null;
    }

    if (!is_int($created)) {
        $_SESSION['created_at'] = $now;
    }
    $_SESSION['last_activity'] = $now;

    return true;
}

/**
 * Tell the browser to delete the session cookie (using the same attributes it was set with).
 */
function clearSessionCookie(): void
{
    if (headers_sent()) {
        return;
    }

    $params = getSessionCookieParams();
    setcookie(PRIMECARE_SESSION_NAME, '', [
        'expires'  => time() - 42000,
        'path'     => $params['path'],
        'domain'   => $params['domain'],
        'secure'   => $params['secure'],
        'httponly' => $params['httponly'],
        'samesite' => $params['samesite'],
    ]);
}

/**
 * Fully destroy the current session: server-side data and the browser cookie.
 */
function destroyApiSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        $_SESSION = [];
        session_destroy();
    }

    clearSessionCookie();
}

