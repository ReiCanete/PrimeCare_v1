<?php
/**
 * PrimeCare - Reusable PDO Database Connection
 * Phase 5.1: Backend Foundation
 */

declare(strict_types=1);

// Prevent direct HTTP access to this configuration file
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => 'Direct access to configuration files is forbidden.',
        'data'    => null,
    ]);
    exit;
}

class Database
{
    private static ?PDO $instance = null;

    /**
     * Load database configuration from config.local.php, environment variables,
     * or safe XAMPP local development defaults.
     *
     * @return array{host: string, port: string, dbname: string, user: string, pass: string, charset: string}
     */
    private static function getConfig(): array
    {
        $defaults = [
            'host'    => getenv('PRIMECARE_DB_HOST') ?: '127.0.0.1',
            'port'    => getenv('PRIMECARE_DB_PORT') ?: '3306',
            'dbname'  => getenv('PRIMECARE_DB_NAME') ?: 'primecare_db',
            'user'    => getenv('PRIMECARE_DB_USER') ?: 'root',
            'pass'    => getenv('PRIMECARE_DB_PASS') !== false ? (string) getenv('PRIMECARE_DB_PASS') : '',
            'charset' => 'utf8mb4',
        ];

        $localConfigFile = __DIR__ . '/config.local.php';
        if (is_file($localConfigFile)) {
            $localConfig = require $localConfigFile;
            if (is_array($localConfig)) {
                return array_merge($defaults, $localConfig);
            }
        }

        return $defaults;
    }

    /**
     * Get the shared PDO database connection instance.
     *
     * @return PDO
     * @throws RuntimeException If the database connection cannot be established.
     */
    public static function getConnection(): PDO
    {
        if (self::$instance !== null) {
            return self::$instance;
        }

        $cfg = self::getConfig();

        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            $cfg['host'],
            $cfg['port'],
            $cfg['dbname'],
            $cfg['charset']
        );

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ];

        try {
            self::$instance = new PDO($dsn, $cfg['user'], $cfg['pass'], $options);
            return self::$instance;
        } catch (PDOException $e) {
            // Log full technical details server-side only; never expose credentials or DSN to client
            error_log('[PrimeCare DB Connection Error] ' . $e->getMessage());
            throw new RuntimeException('Unable to connect to the PrimeCare database.');
        }
    }
}

/**
 * Convenience helper to retrieve the shared PDO connection.
 *
 * @return PDO
 * @throws RuntimeException
 */
function getDatabaseConnection(): PDO
{
    return Database::getConnection();
}

