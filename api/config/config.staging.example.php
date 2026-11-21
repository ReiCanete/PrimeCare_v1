<?php
/**
 * PrimeCare - Staging Database Configuration Template
 *
 * Usage on staging server:
 * 1. Set environment variable `PRIMECARE_ENV=staging` in Apache / PHP-FPM.
 * 2. Copy this file to `api/config/config.local.php` (never commit `config.local.php`).
 * 3. Create a separate `primecare_staging_db` database populated only with schema and
 *    synthetic staging seed data — NEVER use production credentials or real patient data.
 */

return [
    'host'    => getenv('PRIMECARE_STAGING_DB_HOST') ?: '127.0.0.1',
    'port'    => getenv('PRIMECARE_STAGING_DB_PORT') ?: '3306',
    'dbname'  => getenv('PRIMECARE_STAGING_DB_NAME') ?: 'primecare_staging_db',
    'user'    => getenv('PRIMECARE_STAGING_DB_USER') ?: 'primecare_staging_user',
    'pass'    => getenv('PRIMECARE_STAGING_DB_PASS') ?: 'REPLACE_WITH_STAGING_PASSWORD',
    'charset' => 'utf8mb4',
];
