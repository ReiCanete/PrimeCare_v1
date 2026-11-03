<?php
/**
 * PrimeCare - Reusable API JSON Response & Request Helpers
 * Phase 5.1: Backend Foundation
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

/**
 * Configure safe API error handling so stack traces, file paths,
 * and credentials are never leaked to the client.
 */
function registerApiErrorHandlers(): void
{
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');

    set_exception_handler(function (Throwable $e): void {
        error_log('[PrimeCare Uncaught Exception] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        sendError('An internal server error occurred. Please try again later.', 500);
    });
}

/**
 * Send a standardized JSON response and terminate script execution.
 *
 * @param bool   $success    Whether the operation succeeded.
 * @param string $message    Human-readable status message.
 * @param mixed  $data       Response payload (object/array) or null.
 * @param int    $statusCode HTTP status code (e.g., 200, 201, 400, 404, 405, 500).
 * @return never
 */
function sendResponse(bool $success, string $message, mixed $data = null, int $statusCode = 200): never
{
    if (!headers_sent()) {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    }

    echo json_encode(
        [
            'success' => $success,
            'message' => $message,
            'data'    => $data,
        ],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

/**
 * Send a standardized JSON success response.
 *
 * @param string $message    Human-readable success message.
 * @param mixed  $data       Response payload.
 * @param int    $statusCode HTTP status code (default 200).
 * @return never
 */
function sendSuccess(string $message = 'Request completed successfully', mixed $data = null, int $statusCode = 200): never
{
    sendResponse(true, $message, $data, $statusCode);
}

/**
 * Send a standardized JSON error response.
 *
 * @param string $message    Human-readable error message.
 * @param int    $statusCode HTTP status code (default 400).
 * @param mixed  $data       Optional additional safe context (default null).
 * @return never
 */
function sendError(string $message = 'An error occurred', int $statusCode = 400, mixed $data = null): never
{
    sendResponse(false, $message, $data, $statusCode);
}

/**
 * Ensure the incoming HTTP request uses an allowed method.
 *
 * @param string|array<int, string> $allowedMethods Allowed HTTP method(s), e.g., 'GET' or ['GET', 'POST'].
 * @return void
 */
function requireMethod(string|array $allowedMethods): void
{
    $allowed = array_map('strtoupper', (array) $allowedMethods);
    $method  = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    if (!in_array($method, $allowed, true)) {
        if (!headers_sent()) {
            header('Allow: ' . implode(', ', $allowed));
        }
        sendError('Method not allowed.', 405);
    }
}

/**
 * Parse and return JSON request body as an associative array.
 *
 * @return array<string, mixed>
 */
function getJsonInput(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
        sendError('Invalid JSON request payload.', 400);
    }

    return $decoded;
}

