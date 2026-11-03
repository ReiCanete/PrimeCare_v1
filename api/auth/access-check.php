<?php
/**
 * PrimeCare - GET /api/auth/access-check.php?scope=<any|staff|clinical|admin|patient>
 * Phase 5.2: DIAGNOSTIC endpoint used to demonstrate and test the RBAC middleware.
 *
 * It is NOT a feature endpoint and exposes no data. Each scope maps to a role list
 * defined HERE on the server; the client only picks a scope name and can never
 * change which roles satisfy it. Later phases should call requireAuth()/requireRole()
 * directly inside real module endpoints. Remove this file before any real deployment.
 *
 * 200: caller satisfies the scope
 * 401: not authenticated
 * 403: authenticated but role not allowed for the scope
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/auth.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$scopes = [
    'any'      => null, // any authenticated user
    'staff'    => ['admin', 'doctor', 'nurse', 'staff'],
    'clinical' => ['admin', 'doctor', 'nurse'],
    'admin'    => ['admin'],
    'patient'  => ['patient'],
];

$scope = $_GET['scope'] ?? 'any';
if (!is_string($scope) || !array_key_exists($scope, $scopes)) {
    sendError('Unknown scope.', 400);
}

$user = ($scopes[$scope] === null) ? requireAuth() : requireRole($scopes[$scope]);

sendSuccess('Access granted.', [
    'scope' => $scope,
    'role'  => $user['role'],
]);

