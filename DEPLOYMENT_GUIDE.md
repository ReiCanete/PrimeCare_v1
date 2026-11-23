# PrimeCare HIS — Production & Staging Deployment Guide

**Stack:** Apache 2.4 (or Nginx + PHP-FPM) · PHP 8.2/8.3 (`pdo_mysql`, `mbstring`, `json`, `session`) · MariaDB 10.4+ / MySQL 8.0+  
**Important:** Do **not** expose local Windows XAMPP directly to the public internet.

---

## 1. Server & PHP Hardening (`php.ini`)

Configure the following in production `php.ini` (or PHP-FPM pool):

```ini
display_errors = Off
display_startup_errors = Off
log_errors = On
error_log = /var/log/php/primecare-error.log
expose_php = Off
session.use_strict_mode = 1
session.use_only_cookies = 1
session.use_trans_sid = 0
session.cookie_httponly = 1
session.cookie_secure = 1
session.cookie_samesite = Lax
```

---

## 2. Apache Virtual Host & HTTPS Checklist

- Enable modules: `mod_ssl`, `mod_rewrite`, `mod_headers`.
- Set `ServerTokens Prod` and `ServerSignature Off` in global Apache config.
- Point `DocumentRoot` to the deployed PrimeCare directory (do **not** upload `.git/`, `tests/`, `PHASE_*.md`, or `database/` to production; root [`.htaccess`](.htaccess) also denies them with `403`).
- Allow `.htaccess` overrides (`AllowOverride All` on the application `<Directory>`).
- Pass environment variables in the HTTPS `<VirtualHost *:443>`:
  ```apache
  SetEnv PRIMECARE_ENV production
  SetEnv PRIMECARE_DB_HOST 127.0.0.1
  SetEnv PRIMECARE_DB_PORT 3306
  SetEnv PRIMECARE_DB_NAME primecare_prod_db
  SetEnv PRIMECARE_DB_USER primecare_app
  SetEnv PRIMECARE_DB_PASS "<strong-secret>"
  # Uncomment ONLY if TLS terminates at a trusted reverse proxy / load balancer:
  # SetEnv PRIMECARE_TRUST_PROXY 1
  ```
- **HTTPS Checklist:**
  - [ ] Valid TLS certificate installed (e.g., Let's Encrypt / Certbot with auto-renewal).
  - [ ] HTTP port `80` permanently redirects (`301`) to `https://<domain>/`.
  - [ ] Enable HSTS header on HTTPS vhost once verified: `Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"`.
  - [ ] Confirm `PRIMECARE_SESSID` cookie carries `Secure; HttpOnly; SameSite=Lax` over HTTPS (`api/helpers/session.php` enables `Secure` automatically when `isHttpsRequest()` is true).

---

## 3. Database Setup & Least-Privilege User

1. Create database (`utf8mb4_unicode_ci`):
   ```sql
   CREATE DATABASE primecare_prod_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'primecare_app'@'127.0.0.1' IDENTIFIED BY '<strong-random-password>';
   GRANT SELECT, INSERT, UPDATE, DELETE ON primecare_prod_db.* TO 'primecare_app'@'127.0.0.1';
   FLUSH PRIVILEGES;
   ```
2. Import **schema DDL only** from `database/primecare.sql` (lines 1–620; do **not** import synthetic demo patients `P-001`/`P-002` or default `password123` accounts into production).
3. Initialize clean `sequences` baseline rows (`0`) and reference tables (`departments`, `wards`, `beds`, `service_catalog`, `id_types`, `public_info`) for your hospital.
4. Configure DB connection via server env vars (recommended) or copy `api/config/config.production.example.php` to `api/config/config.local.php`.

---

## 4. Secure Initial Administrator Provisioning

Generate a bcrypt hash on the server via PHP CLI (never use a shared default password):

```bash
php -r 'echo password_hash("REPLACE_WITH_UNIQUE_STRONG_PASSWORD", PASSWORD_BCRYPT), PHP_EOL;'
```

Insert the initial administrator account with `must_change_password = 1`:

```sql
INSERT INTO users (
  id, username, password_hash, full_name, role, status, email, mobile,
  must_change_password, last_login, created_by, created_at
) VALUES (
  'U-001', 'hosp_admin', '<PASTE_BCRYPT_HASH>', 'Hospital System Administrator',
  'admin', 'active', 'admin@your-hospital-domain.tld', NULL,
  1, NULL, NULL, CURDATE()
);
UPDATE sequences SET current_val = 1 WHERE entity_key = 'users';
```

Log in once over HTTPS and change the password immediately when prompted.

---

## 5. Recommended Linux File & Folder Permissions

Assuming application owner `deploy` and web server group `www-data`:

```bash
chown -R deploy:www-data /var/www/primecare
find /var/www/primecare -type d -exec chmod 755 {} \;
find /var/www/primecare -type f -exec chmod 644 {} \;
# If using api/config/config.local.php:
chmod 640 /var/www/primecare/api/config/config.local.php
# Ensure PHP error log directory is writable by www-data only:
mkdir -p /var/log/php && chown www-data:www-data /var/log/php && chmod 750 /var/log/php
```

---

## 6. Database Backup & Restoration

- **Daily Automated Backup (cron / systemd timer):**
  ```bash
  mysqldump --single-transaction --routines --triggers --quick \
    -u primecare_backup -p primecare_prod_db | gzip > /var/backups/primecare/primecare_$(date +%F).sql.gz
  chmod 600 /var/backups/primecare/primecare_*.sql.gz
  ```
  Sync encrypted backups off-server (e.g., S3/object storage with server-side encryption) and retain at least 30 days.
- **Periodic Restoration Test (into a separate scratch DB, never production):**
  ```bash
  gunzip -c /var/backups/primecare/primecare_YYYY-MM-DD.sql.gz | mysql -u root -p primecare_restore_test
  ```

---

## 7. Post-Deployment Verification Checklist

- [ ] `GET https://<domain>/api/health.php` returns `200` with `"status": "healthy"` and `"tables_detected": 26`.
- [ ] `GET https://<domain>/database/primecare.sql`, `/tests/`, `/.git/HEAD`, `/api/config/config.local.php`, `/api/config/config.production.example.php`, `/DEPLOYMENT_GUIDE.md` all return `403` or `404`.
- [ ] `GET https://<domain>/login.html` loads over HTTPS with no demo credentials and sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`.
- [ ] Admin login sets `PRIMECARE_SESSID` with `Secure; HttpOnly; SameSite=Lax`, forces initial password change, and redirects cleanly on logout.
- [ ] Unauthenticated `POST /api/billing/create.php` returns `401`; authenticated `POST` without `X-CSRF-Token` returns `403`.
- [ ] Non-admin roles cannot access `api/users/list.php` or `api/reports/generate.php` (`403`).
