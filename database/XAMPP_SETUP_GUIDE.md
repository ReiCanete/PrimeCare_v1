# PrimeCare — XAMPP Backend & Database Setup Guide (Phase 5.1)

This guide explains step-by-step how to set up and verify the **PrimeCare PHP & MySQL Backend** on Windows using **XAMPP**.

---

## 1. Prerequisites & Environment

PrimeCare resides inside the XAMPP web root directory:

```text
C:\xampp\htdocs\PrimeCare_v1
```

Detected XAMPP stack versions on this machine:
- **PHP:** `8.3.36` (`PDO`, `pdo_mysql`, `mysqlnd` enabled)
- **Database:** `10.11.16-MariaDB` (MySQL compatible)
- **Web Server:** Apache `2.4.x`

---

## 2. How to Start Apache and MySQL in XAMPP

1. Open the **XAMPP Control Panel** (`C:\xampp\xampp-control.exe`).
2. Locate the **Apache** row and click **Start**.
   - Wait until the module name highlights in **green** and shows ports `80, 443`.
3. Locate the **MySQL** row and click **Start**.
   - Wait until the module name highlights in **green** and shows port `3306`.

> **Tip:** Keep both **Apache** and **MySQL** running whenever you are developing or testing PrimeCare.

---

## 3. Where the SQL Schema File is Located

The complete database setup script (schema + baseline seed data) is located at:

```text
C:\xampp\htdocs\PrimeCare_v1\database\primecare.sql
```

This script automatically:
- Creates the `primecare_db` database (using `utf8mb4_unicode_ci` character set and collation) if it does not already exist.
- Creates **25 normalized relational tables** with primary keys, foreign keys, unique constraints, and indexes.
- Inserts the baseline seed data matching PrimeCare's frontend demo data (users, doctors, schedules, patients, wards, beds, admissions, bills, billing items, payments, appointments, medical records, prescriptions, lab results, immunizations, notifications, audit logs, and service pricing catalog).

---

## 4. How to Import the Database Using phpMyAdmin

### Option A: Using phpMyAdmin (Recommended for Beginners)

1. Make sure **Apache** and **MySQL** are running in XAMPP Control Panel.
2. Open your web browser and go to:
   - `http://localhost/phpmyadmin`
   - *(Or click the **Admin** button next to MySQL in the XAMPP Control Panel.)*
3. In the top navigation bar of phpMyAdmin, click the **Import** tab.
   - *(You do **not** need to manually create a database first — `primecare.sql` includes `CREATE DATABASE IF NOT EXISTS primecare_db;` and `USE primecare_db;`.)*
4. Under **File to import**, click **Choose File** (or **Browse**).
5. Navigate to:
   ```text
   C:\xampp\htdocs\PrimeCare_v1\database\primecare.sql
   ```
   and select `primecare.sql`.
6. Leave the **Format** set to `SQL` and click the **Import** (or **Go**) button at the bottom of the page.
7. Once finished, you will see a green success banner and `primecare_db` will appear in the left sidebar with all 25 tables populated.

### Option B: Using Command Prompt / PowerShell

If you prefer importing via the command line while MySQL is running:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root < "C:\xampp\htdocs\PrimeCare_v1\database\primecare.sql"
```

---

## 5. How to Configure the Database Connection Locally

Database connection settings are managed in the `api/config/` folder:

| File | Purpose | Tracked in Git? |
|---|---|---|
| `api/config/config.example.php` | Committed template showing safe default XAMPP settings | Yes |
| `api/config/config.local.php` | Local developer overrides (never committed to Git) | **No** (`.gitignore`) |
| `api/config/database.php` | PDO connection manager (`Database::getConnection()`) | Yes |

### Default XAMPP Configuration

For a standard XAMPP installation (`root` user with an empty password on port `3306`), `api/config/config.local.php` is already configured with:

```php
return [
    'host'     => '127.0.0.1',
    'port'     => 3306,
    'dbname'   => 'primecare_db',
    'username' => 'root',
    'password' => '',
    'charset'  => 'utf8mb4',
];
```

### Customizing for Your Machine

If you changed your MySQL root password or port in XAMPP:
1. Open `api/config/config.local.php` (if it does not exist on a fresh Git clone, copy `api/config/config.example.php` to `api/config/config.local.php`).
2. Update `'password'` or `'port'` to match your local MySQL settings.
3. Save the file. Because `api/config/config.local.php` is listed in `.gitignore`, your local credentials will never be pushed to Git.

---

## 6. How to Verify the Backend Health-Check Endpoint

### Method 1: Open in Your Browser

With Apache and MySQL running and `primecare.sql` imported, open either URL in your browser:

- `http://localhost/PrimeCare_v1/api/health.php`
- `http://localhost/PrimeCare_v1/api/`

You should see a JSON response with HTTP status `200 OK`:

```json
{
    "success": true,
    "message": "PrimeCare API and database connection are healthy.",
    "data": {
        "service": "PrimeCare Backend API",
        "phase": "5.1 - Backend Foundation & Database Setup",
        "status": "ok",
        "timestamp": "2026-11-03T06:00:00+08:00",
        "php_version": "8.3.36",
        "database": {
            "connected": true,
            "driver": "mysql",
            "server_version": "10.11.16-MariaDB",
            "database_name": "primecare_db",
            "schema_ready": true,
            "table_count": 25,
            "missing_core_tables": []
        }
    }
}
```

### Method 2: Test from the PrimeCare Frontend Browser Console

Open any PrimeCare page (for example, `http://localhost/PrimeCare_v1/index.html`), open **Browser DevTools (`F12` -> Console)**, and run:

```javascript
await api.checkBackendHealth()
```

It will return the parsed JSON object from the PHP backend without affecting any existing `localStorage` data.

---

## 7. Troubleshooting Common Database Connection Errors

### Error 1: `Database connection failed. Please ensure XAMPP MySQL is running...` (HTTP 503)
- **Cause:** MySQL service is stopped in XAMPP, or running on a different port.
- **Fix:**
  1. Open **XAMPP Control Panel** and verify **MySQL** is highlighted in green.
  2. Check the port number next to MySQL (default is `3306`). If your MySQL runs on `3307`, update `'port' => 3307` in `api/config/config.local.php`.

### Error 2: `SQLSTATE[HY000] [1049] Unknown database 'primecare_db'`
- **Cause:** MySQL is running, but the `primecare_db` database has not been created/imported yet.
- **Fix:** Follow **Section 4** above to import `database/primecare.sql` in phpMyAdmin.

### Error 3: `SQLSTATE[HY000] [1045] Access denied for user 'root'@'localhost'`
- **Cause:** Your local MySQL `root` account has a password set, or uses different credentials.
- **Fix:** Open `api/config/config.local.php` and set `'password'` to your MySQL root password.

### Error 4: `schema_ready: false` or `missing_core_tables` is not empty
- **Cause:** The `primecare_db` database exists, but not all tables were imported.
- **Fix:** Re-import `database/primecare.sql` in phpMyAdmin. Every table uses `CREATE TABLE IF NOT EXISTS` and safe `ON DUPLICATE KEY UPDATE` seeds, so re-importing is completely safe and idempotent.

### Error 5: Browser shows `404 Not Found` at `http://localhost/PrimeCare_v1/api/health.php`
- **Cause:** Apache is not running, or the project folder name inside `C:\xampp\htdocs\` is different.
- **Fix:** Ensure **Apache** is started in XAMPP Control Panel and the project folder is located at `C:\xampp\htdocs\PrimeCare_v1`.

