<?php
/**
 * PrimeCare - GET /api/auth/csrf.php
 * Phase 5.2: issues a CSRF token bound to the (possibly anonymous) session.
 * The login form needs this BEFORE authentication to prevent login CSRF.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/auth.php';

registerApiErrorHandlers();
requireMethod(['GET']);

startApiSession(true);

sendSuccess('Security token issued.', ['csrfToken' => getCsrfToken()]);

