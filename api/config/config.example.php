<?php
/**
 * PrimeCare - Local Database Configuration Example
 *
 * Copy this file to `api/config/config.local.php` and adjust the values
 * if your local XAMPP MySQL setup uses a custom port, username, or password.
 *
 * IMPORTANT: `config.local.php` is listed in `.gitignore` so local credentials
 * are never committed to version control.
 */

return [
    'host'    => '127.0.0.1',
    'port'    => '3306',
    'dbname'  => 'primecare_db',
    'user'    => 'root',
    'pass'    => '',
    'charset' => 'utf8mb4',
];

