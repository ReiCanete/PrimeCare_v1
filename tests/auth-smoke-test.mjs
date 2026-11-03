/**
 * PrimeCare Phase 5.2 - Authentication / Session / RBAC smoke tests
 *
 * Usage (Apache + MySQL running, database/primecare.sql imported):
 *   node tests/auth-smoke-test.mjs
 *   node tests/auth-smoke-test.mjs http://localhost/PrimeCare_v1
 *
 * Uses only the seeded demo accounts (password123) and does not modify any data
 * other than the normal side effects of logging in (users.last_login, audit_logs rows
 * and the temporary login-throttle files).
 */

const BASE = (process.argv[2] || 'http://localhost/PrimeCare_v1').replace(/\/+$/, '');
const API = `${BASE}/api`;
const HOST = new URL(BASE).host;

let passed = 0;
let failed = 0;
const allBodies = [];
const seenSessionIds = new Set();

function check(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  PASS  ${name}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`);
    }
}

/** Minimal cookie jar so each "browser" keeps its own session. */
class Browser {
    constructor() { this.cookies = {}; this.csrf = null; this.lastSetCookies = []; }

    cookieHeader() {
        return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    async request(path, { method = 'GET', headers = {}, body, contentType = 'application/json' } = {}) {
        const h = { Accept: 'application/json', ...headers };
        const ch = this.cookieHeader();
        if (ch) h.Cookie = ch;
        let payload;
        if (body !== undefined) {
            h['Content-Type'] = contentType;
            payload = typeof body === 'string' ? body : JSON.stringify(body);
        }
        const res = await fetch(`${API}/${path}`, { method, headers: h, body: payload, redirect: 'manual' });
        const text = await res.text();
        allBodies.push(text);
        let json = null;
        try { json = JSON.parse(text); } catch { /* keep null */ }

        this.lastSetCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        for (const sc of this.lastSetCookies) {
            const [pair] = sc.split(';');
            const idx = pair.indexOf('=');
            const name = pair.slice(0, idx).trim();
            const value = pair.slice(idx + 1).trim();
            if (/expires=Thu, 01 Jan 1970|max-age=0|expires=.*-\d{2}-/i.test(sc) || value === '' || value === 'deleted') {
                delete this.cookies[name];
            } else {
                this.cookies[name] = value;
                if (name === 'PRIMECARE_SESSID') seenSessionIds.add(value);
            }
        }
        return { status: res.status, json, text, headers: res.headers };
    }

    async fetchCsrf() {
        const r = await this.request('auth/csrf.php');
        this.csrf = r.json && r.json.data ? r.json.data.csrfToken : null;
        return r;
    }

    async login(username, password) {
        await this.fetchCsrf();
        const r = await this.request('auth/login.php', {
            method: 'POST', headers: { 'X-CSRF-Token': this.csrf }, body: { username, password }
        });
        if (r.json && r.json.data && r.json.data.csrfToken) this.csrf = r.json.data.csrfToken;
        return r;
    }

    logout() {
        return this.request('auth/logout.php', {
            method: 'POST', headers: this.csrf ? { 'X-CSRF-Token': this.csrf } : {}, body: {}
        });
    }
}

async function main() {
    console.log(`PrimeCare auth smoke tests against ${BASE}\n`);

    // ---- Health / environment
    const probe = new Browser();
    let health;
    try { health = await probe.request('health.php'); } catch (e) { health = { status: 0 }; }
    if (health.status !== 200) {
        console.log('Backend/database not reachable. Start Apache + MySQL in XAMPP and import database/primecare.sql.');
        process.exit(2);
    }

    // ---- 1. Cookie attributes & CSRF endpoint
    console.log('[Session cookie & CSRF token]');
    const anon = new Browser();
    const csrfRes = await anon.fetchCsrf();
    const sc = (anon.lastSetCookies[0] || '');
    check('csrf.php returns 200 and a token', csrfRes.status === 200 && !!anon.csrf);
    check('session cookie is HttpOnly', /;\s*httponly/i.test(sc), sc);
    check('session cookie has SameSite=Lax', /samesite=lax/i.test(sc), sc);
    check('cookie is not Secure over plain-HTTP localhost', BASE.startsWith('https') ? /;\s*secure/i.test(sc) : !/;\s*secure/i.test(sc), sc);
    check('cookie path is scoped to the project folder (not "/")', /path=\/[^;\s]+/i.test(sc), sc);
    check('cookie name is PRIMECARE_SESSID', sc.startsWith('PRIMECARE_SESSID='), sc);

    // ---- 2/3. Unauthenticated access
    console.log('\n[Unauthenticated requests]');
    const noAuth = new Browser();
    const meAnon = await noAuth.request('auth/me.php');
    check('me.php without login -> 401 JSON', meAnon.status === 401 && meAnon.json && meAnon.json.success === false, `status ${meAnon.status}`);
    check('anonymous me.php does not create a session cookie', noAuth.lastSetCookies.length === 0);
    const protAnon = await noAuth.request('auth/access-check.php?scope=any');
    check('protected endpoint without login -> 401', protAnon.status === 401, `status ${protAnon.status}`);
    const protAnonAdmin = await noAuth.request('auth/access-check.php?scope=admin');
    check('admin-only endpoint without login -> 401', protAnonAdmin.status === 401, `status ${protAnonAdmin.status}`);

    // ---- Request hardening
    console.log('\n[Login request hardening]');
    const hard = new Browser();
    await hard.fetchCsrf();
    const getLogin = await hard.request('auth/login.php');
    check('GET login.php -> 405 (POST only)', getLogin.status === 405, `status ${getLogin.status}`);
    const noToken = await hard.request('auth/login.php', { method: 'POST', body: { username: 'patient', password: 'password123' } });
    check('login without CSRF token -> 403', noToken.status === 403, `status ${noToken.status}`);
    const badToken = await hard.request('auth/login.php', { method: 'POST', headers: { 'X-CSRF-Token': 'deadbeef' }, body: { username: 'patient', password: 'password123' } });
    check('login with wrong CSRF token -> 403', badToken.status === 403, `status ${badToken.status}`);
    const evil = await hard.request('auth/login.php', { method: 'POST', headers: { 'X-CSRF-Token': hard.csrf, Origin: 'http://evil.example' }, body: { username: 'patient', password: 'password123' } });
    check('login from foreign Origin -> 403', evil.status === 403, `status ${evil.status}`);
    const formType = await hard.request('auth/login.php', { method: 'POST', headers: { 'X-CSRF-Token': hard.csrf }, body: 'username=patient&password=password123', contentType: 'application/x-www-form-urlencoded' });
    check('login with form content-type -> 415', formType.status === 415, `status ${formType.status}`);
    const missing = await hard.request('auth/login.php', { method: 'POST', headers: { 'X-CSRF-Token': hard.csrf }, body: { username: '' } });
    check('login with missing fields -> 400', missing.status === 400, `status ${missing.status}`);
    const sameOrigin = await hard.request('auth/login.php', { method: 'POST', headers: { 'X-CSRF-Token': hard.csrf, Origin: `http://${HOST}` }, body: { username: 'no_such_user_zz', password: 'x' } });
    check('same-origin Origin header is accepted (reaches credential check -> 401)', sameOrigin.status === 401, `status ${sameOrigin.status}`);

    // ---- 4/5. Bad credentials & inactive account
    console.log('\n[Invalid credentials & account status]');
    const b1 = new Browser();
    const wrongPw = await b1.login('patient', 'definitely-wrong');
    const unknown = await b1.login('no_such_user_zz', 'password123');
    check('wrong password -> 401', wrongPw.status === 401);
    check('unknown username -> 401', unknown.status === 401);
    check('both failures use the SAME generic message', wrongPw.json && unknown.json && wrongPw.json.message === unknown.json.message, `${wrongPw.json && wrongPw.json.message} | ${unknown.json && unknown.json.message}`);
    const pending = await b1.login('patient2', 'password123');
    check('pending/inactive account with correct password -> 403', pending.status === 403, `status ${pending.status}`);
    check('inactive account gets no session (me -> 401)', (await b1.request('auth/me.php')).status === 401);

    // ---- 3/6/7. Valid login, persistence, me
    console.log('\n[Valid login: patient]');
    const patient = new Browser();
    const pLogin = await patient.login('patient', 'password123');
    check('valid login -> 200', pLogin.status === 200 && pLogin.json && pLogin.json.success === true, `status ${pLogin.status}`);
    const pUser = pLogin.json && pLogin.json.data && pLogin.json.data.user;
    check('login returns role "patient"', pUser && pUser.role === 'patient');
    check('login returns only safe fields', pUser && !('password' in pUser) && !('password_hash' in pUser) && !('passwordHash' in pUser), JSON.stringify(Object.keys(pUser || {})));
    const postLoginSid = patient.cookies.PRIMECARE_SESSID;
    const rotated = new Browser();
    await rotated.fetchCsrf();
    const beforeSid = rotated.cookies.PRIMECARE_SESSID;
    await rotated.request('auth/login.php', { method: 'POST', headers: { 'X-CSRF-Token': rotated.csrf }, body: { username: 'patient', password: 'password123' } });
    check('session ID changes after login (fixation defence)', !!beforeSid && rotated.cookies.PRIMECARE_SESSID !== beforeSid, `${beforeSid} -> ${rotated.cookies.PRIMECARE_SESSID}`);
    check('login response body does not contain the session ID', !pLogin.text.includes(postLoginSid));

    const pMe = await patient.request('auth/me.php');
    check('me.php after login -> 200 with same user', pMe.status === 200 && pMe.json.data.user.id === pUser.id && pMe.json.data.user.username === 'patient');
    check('session persists across a "page refresh" (new request, same cookie)', (await patient.request('auth/me.php')).status === 200);

    console.log('\n[RBAC: patient session]');
    const pAny = await patient.request('auth/access-check.php?scope=any');
    const pPatient = await patient.request('auth/access-check.php?scope=patient');
    const pAdmin = await patient.request('auth/access-check.php?scope=admin');
    const pStaff = await patient.request('auth/access-check.php?scope=staff');
    check('patient -> scope any = 200', pAny.status === 200);
    check('patient -> scope patient = 200', pPatient.status === 200);
    check('patient -> scope admin = 403 (wrong role)', pAdmin.status === 403, `status ${pAdmin.status}`);
    check('patient -> scope staff = 403 (wrong role)', pStaff.status === 403, `status ${pStaff.status}`);
    check('unknown scope -> 400', (await patient.request('auth/access-check.php?scope=nope')).status === 400);

    console.log('\n[Dev Role Simulator cannot grant backend access]');
    // The simulator lives in the browser (sessionStorage + localStorage). Even if a client
    // sends simulator-looking values in every way it can, PHP only trusts its own session.
    const sim = new Browser();
    sim.cookies.primecare_sim_role = 'admin';
    const simAnon = await sim.request('auth/access-check.php?scope=admin&role=admin&sim_role=admin', { headers: { 'X-Simulated-Role': 'admin', 'X-Role': 'admin' } });
    check('anonymous + simulator values -> still 401', simAnon.status === 401, `status ${simAnon.status}`);
    const simPatientRes = await patient.request('auth/access-check.php?scope=admin&role=admin&sim_role=admin', { headers: { 'X-Simulated-Role': 'admin', 'X-Role': 'admin', Cookie: `${patient.cookieHeader()}; primecare_sim_role=admin` } });
    check('patient session + simulator values -> still 403 on admin scope', simPatientRes.status === 403, `status ${simPatientRes.status}`);

    // ---- 9. Logout
    console.log('\n[Logout]');
    const oldSid = patient.cookies.PRIMECARE_SESSID;
    const oldCookie = patient.cookieHeader();
    const noCsrfLogout = await patient.request('auth/logout.php', { method: 'POST', body: {} });
    check('logout without CSRF token -> 403 (session kept)', noCsrfLogout.status === 403, `status ${noCsrfLogout.status}`);
    check('GET logout.php -> 405', (await patient.request('auth/logout.php')).status === 405);
    check('session still valid after rejected logout', (await patient.request('auth/me.php')).status === 200);
    const out = await patient.logout();
    check('logout with CSRF token -> 200', out.status === 200 && out.json.success === true, `status ${out.status}`);
    const clearing = patient.lastSetCookies.find(c => c.startsWith('PRIMECARE_SESSID='));
    check('logout sends a cookie-clearing Set-Cookie', !!clearing && /expires=.*1970|max-age=0/i.test(clearing), clearing || '(none)');
    check('me.php after logout -> 401', (await patient.request('auth/me.php')).status === 401);
    const replay = new Browser();
    const replayRes = await replay.request('auth/me.php', { headers: { Cookie: oldCookie } });
    check('replaying the OLD session cookie -> 401 (session destroyed server-side)', replayRes.status === 401, `status ${replayRes.status}`);
    const replayProtected = await replay.request('auth/access-check.php?scope=any', { headers: { Cookie: oldCookie } });
    check('replaying the OLD session on a protected endpoint -> 401', replayProtected.status === 401, `status ${replayProtected.status}`);
    const idempotent = new Browser();
    check('logout with no session is idempotent (200)', (await idempotent.logout()).status === 200);

    // ---- RBAC: admin and other roles
    console.log('\n[RBAC: other roles]');
    for (const [user, scopes] of [
        ['admin',  { any: 200, staff: 200, clinical: 200, admin: 200, patient: 403 }],
        ['staff',  { any: 200, staff: 200, clinical: 403, admin: 403, patient: 403 }],
        ['doctor', { any: 200, staff: 200, clinical: 200, admin: 403, patient: 403 }],
        ['nurse',  { any: 200, staff: 200, clinical: 200, admin: 403, patient: 403 }],
    ]) {
        const b = new Browser();
        const l = await b.login(user, 'password123');
        check(`${user}: login -> 200 with role "${user}"`, l.status === 200 && l.json.data.user.role === user, `status ${l.status}`);
        for (const [scope, expected] of Object.entries(scopes)) {
            const r = await b.request(`auth/access-check.php?scope=${scope}`);
            check(`${user}: scope ${scope} -> ${expected}`, r.status === expected, `status ${r.status}`);
        }
        await b.logout();
    }

    // ---- Throttle
    console.log('\n[Brute-force throttle]');
    const t = new Browser();
    const probeUser = `throttle_probe_${Date.now()}`;
    let last = 0;
    for (let i = 0; i < 6; i++) {
        const r = await t.login(probeUser, 'wrong');
        last = r.status;
        if (i < 5) check(`attempt ${i + 1} -> 401`, r.status === 401, `status ${r.status}`);
    }
    check('6th attempt -> 429 (throttled)', last === 429, `status ${last}`);

    // ---- Leak scan
    console.log('\n[Sensitive data scan across ALL responses]');
    const joined = allBodies.join('\n');
    check('no bcrypt hashes in any response', !/\$2y\$/.test(joined));
    check('no "password_hash" key in any response', !/password_hash/i.test(joined));
    let leakedSid = false;
    for (const sid of seenSessionIds) if (joined.includes(sid)) leakedSid = true;
    check(`no session ID appears in any response body (${seenSessionIds.size} IDs checked)`, !leakedSid);

    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
