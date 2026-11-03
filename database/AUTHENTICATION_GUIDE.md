# PrimeCare — Authentication & Session Guide (Phase 5.2)

> **Scope:** local XAMPP development of a school/portfolio project. This is **not** production-ready and **not** compliant for real hospital use (no HTTPS enforcement, no MFA, no password-reset by email, limited audit trail, no formal security review).

---

## 1. How authentication works

```text
Browser (login.html + js/auth.js + js/api.js)             PHP (api/auth/*)                         MariaDB
-------------------------------------------------------------------------------------------------------------
1. GET  auth/csrf.php                                  -> start session, make CSRF token
2. POST auth/login.php  (X-CSRF-Token, JSON body)      -> check CSRF + Origin + JSON type
                                                          throttle check (5 fails / 5 min)
                                                          SELECT ... FROM users WHERE username=:u   (PDO prepared)
                                                          password_verify()  (never plaintext)
                                                          status must be 'active'
                                                          session_regenerate_id(true)
                                                          store ONLY the user id in $_SESSION
                                                          rotate CSRF token, write audit_logs row
   <- { user: {safe fields}, csrfToken }  + HttpOnly cookie PRIMECARE_SESSID
3. Every protected page: GET auth/me.php (cookie)      -> re-reads the user from the DB (role + status)
   401 -> js/app.js sends you to login.html
4. POST auth/logout.php (X-CSRF-Token)                 -> destroy session data, expire cookie, audit row
```

Key properties

| Topic | Implementation |
|---|---|
| Source of truth | The **PHP session**. The browser only holds an HttpOnly cookie it cannot read. |
| Passwords | `password_verify()` against `users.password_hash` (bcrypt). Hashes are upgraded with `password_needs_rehash()`. |
| Session contents | Only the user ID (+ timestamps and CSRF token). **Role and status are re-read from the database on every request**, so deactivating an account or changing its role takes effect immediately. |
| Generic errors | Unknown user and wrong password both return `401 Invalid username or password.` (a dummy `password_verify()` keeps timing similar). |
| Inactive accounts | After a *correct* password, any status other than `active` (`inactive`, `pending`, `rejected`) returns `403 This account is not active…`. |
| Timeouts | 30 min idle, 8 h absolute (`api/helpers/session.php`). |
| Brute force | 5 failed attempts per IP + username in 5 minutes → `429` + `Retry-After`. State lives in `<temp dir>/primecare_auth_throttle/` (delete that folder to reset while testing). Not a substitute for real rate limiting. |
| Audit | `Login`, `Login Failed` (known accounts only), `Login Blocked`, `Logout` rows are written to the existing `audit_logs` table. |
| Schema | **No schema changes.** Existing `users` columns are reused. |

### Files

| File | Purpose |
|---|---|
| `api/helpers/session.php` | Secure session start/destroy, cookie attributes, timeouts |
| `api/helpers/auth.php` | `currentUser()`, `requireAuth()`, `requireRole([...])`, CSRF helpers, throttle, audit |
| `api/auth/csrf.php` | `GET` – issue CSRF token |
| `api/auth/login.php` | `POST` – log in |
| `api/auth/logout.php` | `POST` – log out |
| `api/auth/me.php` | `GET` – current session (401 if none) |
| `api/auth/access-check.php` | `GET ?scope=any\|staff\|clinical\|admin\|patient` – **diagnostic** RBAC demo/test endpoint (delete before any real deployment) |
| `api/config/.htaccess`, `api/helpers/.htaccess` | Deny direct web access (Apache) |
| `js/api.js` | `api.auth.login / logout / me` (async, `fetch`, `credentials: 'same-origin'`) |
| `js/auth.js`, `js/app.js`, `js/public.js` | Login form, route guard, public nav use the PHP session |
| `tests/auth-smoke-test.mjs` | Automated backend test suite (78 checks) |

---

## 2. Existing roles

Read from the existing `users.role` ENUM (no new roles invented):

| Role | Portal | Notes |
|---|---|---|
| `admin` | Staff portal | Everything; only role that may use the UI role simulator |
| `doctor` | Staff portal | Clinical |
| `nurse` | Staff portal | Clinical |
| `staff` | Staff portal | Front desk / billing |
| `patient` | Patient portal | |

Account `status` ENUM: `active`, `inactive`, `pending`, `rejected` — **only `active` can log in**.

### Using RBAC in a future endpoint

```php
require_once __DIR__ . '/../helpers/auth.php';
registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'staff']);   // 401 if not logged in, 403 if wrong role
// ... $user['id'], $user['role'] are trustworthy (read from the DB) ...
```

State-changing endpoints must additionally call `requireCsrf()` and `requireJsonContentType()`.

---

## 3. Seeded demo accounts & creating a safe development account

`database/primecare.sql` seeds six accounts whose `password_hash` is a **real bcrypt hash** of the demo password `password123` (verified by the test suite):

`admin`, `doctor`, `nurse`, `staff`, `patient` (active) and `patient2` (`pending` → login is refused, which is the inactive-account test).

> These demo credentials are for **local development only**. Change or delete them before the project is ever hosted anywhere shared.

To add your own account **without storing a plaintext password**:

1. Generate a hash locally (the password never goes in a file):

   ```powershell
   C:\xampp\php\php.exe -r "echo password_hash('Choose-A-Strong-Password-1', PASSWORD_DEFAULT), PHP_EOL;"
   ```

2. Insert it in phpMyAdmin → `primecare_db` → **SQL** (replace the placeholders; IDs follow the `U-###` convention):

   ```sql
   INSERT INTO users (id, username, password_hash, full_name, role, status, email, mobile, must_change_password, created_by, created_at)
   VALUES ('U-007', 'myadmin', '<paste the hash here>', 'My Name', 'admin', 'active', 'me@example.com', NULL, 0, 'U-001', CURDATE());
   ```

To **disable** an account instead of deleting it: `UPDATE users SET status = 'inactive' WHERE username = 'someone';` — their next request returns 401.

---

## 4. Session & cookie configuration

| Setting | Value | Why |
|---|---|---|
| Cookie name | `PRIMECARE_SESSID` | Avoids clashing with other apps on `localhost` |
| `HttpOnly` | on | JavaScript (and XSS) cannot read the session ID |
| `SameSite` | `Lax` | Cookie is not sent on cross-site POST/fetch |
| `Secure` | **only when the request is really HTTPS** | `http://localhost` would lose the cookie if `Secure` were forced |
| Path | project folder, e.g. `/PrimeCare_v1/` | Scoped to this app |
| Lifetime | browser-session cookie | No persistent "remember me" |
| `session.use_strict_mode` | `1` | PHP rejects session IDs it did not create |
| `session.use_only_cookies` / `use_trans_sid` | `1` / `0` | Session ID never in URLs |
| ID regeneration | `session_regenerate_id(true)` at login | Prevents session fixation |

### When you deploy behind HTTPS

- Nothing needs to be edited: `isHttpsRequest()` sees `HTTPS=on` (or port 443) and automatically adds `Secure` to the cookie.
- If TLS is terminated by a **trusted reverse proxy** (so PHP sees plain HTTP), set the environment variable `PRIMECARE_TRUST_PROXY=1` so `X-Forwarded-Proto: https` is honoured. Never enable it unless a proxy you control overwrites that header.
- Also: redirect HTTP→HTTPS, add HSTS at the web server, set `session.cookie_secure=1` in `php.ini` if you want it enforced globally, and consider `SameSite=Strict`.

---

## 5. CSRF protection

Because authentication uses a cookie session, state-changing requests (login, logout) are protected by:

1. **Synchronizer token** – random token stored in the PHP session, sent to the page in JSON, kept in JavaScript **memory only**, echoed back in the `X-CSRF-Token` header. Rotated at login. The login form fetches a token first (prevents *login CSRF*).
2. **Origin / Referer check** – if the browser sends one, its host must equal the request host.
3. **`Content-Type: application/json` required** – cross-site HTML forms cannot send it, and CORS pre-flight is never granted.
4. **`SameSite=Lax` cookie** – defence in depth.

The CSRF token is not the session ID. `GET` endpoints must stay read-only.

---

## 6. Dev Role Simulator vs. PHP authentication

| | PHP authentication (Phase 5.2) | Dev Role Simulator |
|---|---|---|
| Where it runs | Server (`api/auth/*`) | Browser only (`js/app.js`, `sessionStorage`) |
| Proves identity | Yes – password + session | No |
| Grants server permissions | Yes, by the role stored in `users.role` | **Never** – PHP never sees it |
| Who can use it | Anyone with valid credentials | Only a user whose **real PHP role is `admin`** (`isRoleSimulatorAvailable()` in `app.js`) |
| Purpose | Real access control | Previewing the **mock-data** screens as another role |

Behaviour details

- Switching role only changes what the legacy localStorage UI shows; it sends nothing to PHP. `tests/auth-smoke-test.mjs` proves that simulator-style cookies/headers/query values never change a PHP decision.
- It is cleared on login, logout, and whenever the server re-confirms the session (`me()`).
- Hover text on the DEV pill states "UI preview only".
- Turn it off entirely with `FEATURES.roleSimulator = false` in `js/app.js`.
- Once a module is migrated to PHP, its page must rely on `requireRole()`; the simulator will not be able to exercise that module as another role.

---

## 7. How to test

### Automated (backend)

```powershell
cd C:\xampp\htdocs\PrimeCare_v1
node tests\auth-smoke-test.mjs
```

Needs Apache + MySQL running and `primecare.sql` imported. Expected: `Result: 78 passed, 0 failed`.
(Side effects: `users.last_login` updated, a few `audit_logs` rows, temp throttle files.)

### Manual (browser)

1. Start Apache + MySQL, open `http://localhost/PrimeCare_v1/login.html`.
2. Log in with `staff` / `password123` → lands on `staff/dashboard.html`.
3. **Refresh** (F5) several times → still logged in. Open another tab on `staff/billing.html` → still logged in.
4. DevTools → **Application → Cookies**: `PRIMECARE_SESSID` is `HttpOnly`, `SameSite=Lax`, **not** `Secure` (plain HTTP). DevTools → **Local Storage**: `primecare_currentUser` has no password; no session ID anywhere.
5. Click **Logout** → back at login. Press **Back** and refresh a staff page → redirected to login. In DevTools → Network, `api/auth/me.php` returns `401`.
6. Wrong password → "Invalid username or password." (same text for an unknown username). `patient2` / `password123` → "This account is not active…".
7. Log in as `admin` → the **DEV** role pill appears. Log in as `staff`/`doctor`/`nurse`/`patient` → no pill.
8. Open `http://localhost/PrimeCare_v1/api/auth/access-check.php?scope=admin` in the address bar: `401` when logged out, `403` as `staff`, `200` as `admin`.

---

## 8. Remaining limitations (by design for this phase)

- **All other modules still use browser localStorage mock data** and trust the browser. PHP RBAC only protects endpoints that call `requireAuth()/requireRole()` — currently just the `api/auth/*` ones. Editing localStorage can change what the *UI* shows, never what PHP allows.
- **Accounts created through the mock User Management or Register screens exist only in localStorage**, so they cannot log in until those modules are migrated. Use SQL (section 3) for extra accounts for now.
- **Force-change-password** modal and **Forgot Password** still operate on mock data; they do not change the real `password_hash`. (A `must_change_password = 1` user would be re-prompted at every login until a PHP password-change endpoint exists.)
- Mock `primecare_users` in localStorage still contains the demo passwords (legacy mock data, not used for login anymore).
- Login throttle is per IP + username and file based; no CAPTCHA, no account lockout, no MFA.
- No HTTPS in XAMPP by default; credentials travel in clear text over `http://localhost` (acceptable on one machine only).
- `api/auth/access-check.php` is a diagnostic endpoint and should be removed before real deployment.

