<?php
/**
 * PrimeCare - Production Database Configuration Template
 *
 * Deployment Instructions:
 * 1. Set environment variable `PRIMECARE_ENV=production` in Apache (`SetEnv`) or PHP-FPM (`env[...]`).
 * 2. Prefer injecting `PRIMECARE_DB_HOST`, `PRIMECARE_DB_PORT`, `PRIMECARE_DB_NAME`,
 *    `PRIMECARE_DB_USER`, and `PRIMECARE_DB_PASS` via server environment variables.
 * 3. Alternatively, copy this file to `api/config/config.local.php` (git-ignored, `chmod 640`,
 *    owned by root:www-data) and fill in a least-privilege MariaDB/MySQL application user.
 *
 * SECURITY:
 * - Never commit `config.local.php` or real credentials to Git.
 * - `api/config/database.php` refuses empty-password `root` connections when `PRIMECARE_ENV=production`.
 */

return [
    'host'    => getenv('PRIMECARE_DB_HOST') ?: '127.0.0.1',
    'port'    => getenv('PRIMECARE_DB_PORT') ?: '3306',
    'dbname'  => getenv('PRIMECARE_DB_NAME') ?: 'primecare_prod_db',
    'user'    => getenv('PRIMECARE_DB_USER') ?: '',
    'pass'    => getenv('PRIMECARE_DB_PASS') !== false ? (string) getenv('PRIMECARE_DB_PASS') : '',
    'charset' => 'utf8mb4',
];
