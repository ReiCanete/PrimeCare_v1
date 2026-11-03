<?php
/**
 * PrimeCare - API Entry Point & Health-Check Endpoint
 * Phase 5.1: Backend Foundation
 *
 * Verifies:
 * 1. Apache / PHP execution is working.
 * 2. PDO MySQL database connection succeeds.
 * 3. PrimeCare database schema is reachable.
 * 4. Standardized JSON response format is returned without exposing sensitive info.
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers/response.php';
require_once __DIR__ . '/config/database.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$action = $_GET['action'] ?? 'health';

if ($action !== 'health') {
    sendError('Unknown API action. Phase 5.1 provides the backend foundation and health-check endpoint only.', 404);
}

try {
    $pdo = getDatabaseConnection();

    // 1. Verify active query execution
    $pingStmt = $pdo->query('SELECT 1 AS ping');
    $pingRow  = $pingStmt ? $pingStmt->fetch() : false;
    $pingOk   = is_array($pingRow) && (int) ($pingRow['ping'] ?? 0) === 1;

    // 2. Check how many tables exist in the current database schema
    $tableStmt = $pdo->query(
        'SELECT COUNT(*) AS table_count
         FROM information_schema.tables
         WHERE table_schema = DATABASE()'
    );
    $tableRow   = $tableStmt ? $tableStmt->fetch() : ['table_count' => 0];
    $tableCount = (int) ($tableRow['table_count'] ?? 0);

    sendSuccess(
        'PrimeCare backend is online and database connection is healthy.',
        [
            'service'             => 'PrimeCare API',
            'phase'               => '5.1',
            'status'              => $pingOk ? 'healthy' : 'degraded',
            'php_execution'       => 'ok',
            'database_connection' => $pingOk ? 'connected' : 'failed',
            'schema_ready'        => $tableCount > 0,
            'tables_detected'     => $tableCount,
            'timestamp'           => date(DATE_ATOM),
        ],
        200
    );
} catch (Throwable $e) {
    sendError(
        'Database connection failed. Please ensure MySQL is running in XAMPP and the PrimeCare database has been imported.',
        503,
        [
            'service'             => 'PrimeCare API',
            'phase'               => '5.1',
            'status'              => 'unhealthy',
            'php_execution'       => 'ok',
            'database_connection' => 'disconnected',
            'schema_ready'        => false,
            'tables_detected'     => 0,
            'timestamp'           => date(DATE_ATOM),
        ]
    );
}

