<?php
/**
 * PrimeCare - GET /api/auth/me.php
 * Phase 5.2: current session information.
 *
 * 200: { user: {...safe fields...}, csrfToken: "..." }
 * 401: not authenticated (or session expired / account deactivated)
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/auth.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireAuth();

sendSuccess('Authenticated.', [
    'user'      => $user,
    'csrfToken' => getCsrfToken(),
]);

