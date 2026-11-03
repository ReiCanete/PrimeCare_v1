// API Layer - Abstracts data access so we can easily swap to PHP/fetch later.
//
// =============================================================================
// PHASE 5.1 MIGRATION ARCHITECTURE & GUIDELINES FOR FUTURE PHASES
// =============================================================================
// All frontend controllers call methods on the global `api` object (e.g.,
// `await api.getDoctors()`, `await api.bookAppointment(data)`).
//
// To migrate a module in Phase 5.2+ without rewriting frontend controllers:
// 1. Create the PHP endpoint in `api/` returning the standard JSON envelope:
//    `{ "success": true|false, "message": "...", "data": ... }`
// 2. Enable the corresponding module flag in `api._backendConfig.modules`.
// 3. Inside the existing `api.<methodName>` function, check the module flag:
//      if (this._backendConfig.modules.patients) {
//          const res = await this._request('patients.php', { method: 'GET', params: filters });
//          return res.data;
//      }
// 4. Keep the existing function name, parameter signature, and return shape identical
//    so the UI controllers (`js/*.js`) require zero changes.
// =============================================================================

const api = {
    // ==========================================
    // 0. PHP BACKEND TRANSPORT & HEALTH CHECK (Phase 5.1)
    // ==========================================
    _backendConfig: {
        // Feature flags for incremental module migration.
        // `auth` (Phase 5.2) and `patients` (Phase 5.3) are enabled; remaining flags stay
        // `false` so unmigrated modules keep running on localStorage mock data unchanged.
        modules: {
            auth: true,     // Phase 5.2: login/logout/session handled by PHP (api.auth.*)
            users: false,
            publicData: false,
            patients: true, // Phase 5.3: patient management & self-registration handled by PHP (api/patients/*.php)
            doctors: true,  // Phase 5.5: doctor management, departments & scheduling handled by PHP (api/doctors/*.php)
            appointments: true, // Phase 5.6: appointment management, online booking & pre-visit forms handled by PHP (api/appointments/*.php)
            clinical: false,
            wards: false,
            billing: false,
            reports: false,
            patientPortal: false
        }
    },

    /**
     * Resolves an API endpoint path relative to the current HTML page location
     * (handles root public pages vs `/staff/*` and `/patient/*` subfolders).
     */
    _getApiUrl: function(endpoint, queryParams = null) {
        const path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
        const isSubfolder = path.includes('/staff/') || path.includes('/patient/');
        const basePath = isSubfolder ? '../api' : 'api';
        const cleanEndpoint = String(endpoint || 'index.php').replace(/^\/+/, '');
        let url = `${basePath}/${cleanEndpoint}`;

        if (queryParams && typeof queryParams === 'object') {
            const searchParams = new URLSearchParams();
            Object.entries(queryParams).forEach(([key, val]) => {
                if (val !== undefined && val !== null && val !== '') {
                    searchParams.append(key, String(val));
                }
            });
            const qs = searchParams.toString();
            if (qs) {
                url += (url.includes('?') ? '&' : '?') + qs;
            }
        }
        return url;
    },

    /**
     * Standardized HTTP client for communicating with PrimeCare PHP endpoints.
     * Always returns `{ success: boolean, message: string, data: any, status: number }`.
     */
    _request: async function(endpoint, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const url = this._getApiUrl(endpoint, options.params || null);

        const fetchOptions = {
            method,
            headers: {
                'Accept': 'application/json',
                ...(options.headers || {})
            },
            credentials: 'same-origin'
        };

        if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
            fetchOptions.headers['Content-Type'] = 'application/json; charset=utf-8';
            fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, fetchOptions);
            const payload = await response.json().catch(() => null);

            if (!payload || typeof payload !== 'object') {
                return {
                    success: false,
                    message: `Invalid JSON response from server (HTTP ${response.status}).`,
                    data: null,
                    status: response.status
                };
            }

            return {
                success: Boolean(payload.success),
                message: payload.message || (response.ok ? 'Success' : 'Request failed'),
                data: payload.data !== undefined ? payload.data : null,
                status: response.status
            };
        } catch (err) {
            return {
                success: false,
                message: 'Unable to reach the PrimeCare backend server.',
                data: null,
                status: 0
            };
        }
    },

    /**
     * Calls the Phase 5.1 PHP health-check endpoint (`api/health.php`) to verify
     * Apache PHP execution and MySQL database connectivity.
     */
    checkBackendHealth: async function() {
        return await this._request('health.php', { method: 'GET' });
    },

    /**
     * Ensures a valid CSRF token is cached in memory before sending a state-changing POST request.
     */
    _ensureCsrfToken: async function() {
        if (this.auth && this.auth._csrfToken) {
            return this.auth._csrfToken;
        }
        if (this._backendConfig.modules.auth) {
            const meRes = await this.auth.me();
            if (meRes.success && this.auth._csrfToken) {
                return this.auth._csrfToken;
            }
            const csrfRes = await this.auth._fetchCsrfToken();
            if (csrfRes.success && this.auth._csrfToken) {
                return this.auth._csrfToken;
            }
        }
        return '';
    },

    /**
     * Mirrors MySQL patient records into localStorage (`primecare_patients`) so
     * still-unmigrated frontend modules (appointments, clinical, wards, billing, reports,
     * and app.js shell banner checks) continue resolving live patient data synchronously.
     */
    _syncPatientCache: function(patientOrList, options = {}) {
        try {
            let current = this.getAll('patients');
            if (options.replaceAll && Array.isArray(patientOrList)) {
                localStorage.setItem('primecare_patients', JSON.stringify(patientOrList));
                return;
            }
            if (options.deletedId) {
                current = current.filter(p => p.id !== options.deletedId);
            }
            const items = Array.isArray(patientOrList) ? patientOrList : (patientOrList ? [patientOrList] : []);
            items.forEach(item => {
                if (!item || !item.id) return;
                const idx = current.findIndex(p => p.id === item.id);
                if (idx !== -1) {
                    current[idx] = { ...current[idx], ...item };
                } else {
                    current.push(item);
                }
            });
            localStorage.setItem('primecare_patients', JSON.stringify(current));
        } catch (e) {
            // Ignore localStorage quota/serialization errors
        }
    },

    _patientsFetchPromise: null,
    _lastNextPreviewId: null,
    _doctorsFetchPromise: null,
    _appointmentsFetchPromise: null,

    /**
     * Helper used by unmigrated async methods (dashboard stats, appointments, clinical, billing)
     * to ensure the local patient cache is refreshed from MySQL before joining patient names.
     */
    _getPatientsListForMockJoin: async function() {
        if (!this._backendConfig.modules.patients) {
            return this.getAll('patients');
        }
        if (!this._patientsFetchPromise) {
            this._patientsFetchPromise = this.searchPatients({}).finally(() => {
                setTimeout(() => { this._patientsFetchPromise = null; }, 1500);
            });
        }
        try {
            const list = await this._patientsFetchPromise;
            if (Array.isArray(list) && list.length > 0) return list;
        } catch (e) {}
        return this.getAll('patients');
    },

    /**
     * Mirrors MySQL doctor records into localStorage (`primecare_doctors`) so
     * still-unmigrated synchronous helpers continue resolving current doctor profiles.
     */
    _syncDoctorCache: function(doctorOrList, options = {}) {
        try {
            let current = this.getAll('doctors');
            if (options.replaceAll && Array.isArray(doctorOrList)) {
                localStorage.setItem('primecare_doctors', JSON.stringify(doctorOrList));
                return;
            }
            if (options.deletedId) {
                current = current.filter(d => d.id !== options.deletedId);
            }
            const items = Array.isArray(doctorOrList) ? doctorOrList : (doctorOrList ? [doctorOrList] : []);
            items.forEach(item => {
                if (!item || !item.id) return;
                const idx = current.findIndex(d => d.id === item.id);
                if (idx !== -1) {
                    current[idx] = { ...current[idx], ...item };
                } else {
                    current.push(item);
                }
            });
            localStorage.setItem('primecare_doctors', JSON.stringify(current));
        } catch (e) {
            // Ignore localStorage quota/serialization errors
        }
    },

    /**
     * Helper used by unmigrated async methods (dashboard stats, appointments, clinical, wards, reports)
     * to ensure doctor profiles are fetched from MySQL before joining doctor names/specializations.
     */
    _getDoctorsListForMockJoin: async function() {
        if (!this._backendConfig.modules.doctors) {
            return this.getAll('doctors');
        }
        if (!this._doctorsFetchPromise) {
            this._doctorsFetchPromise = this.getDoctors({}).finally(() => {
                setTimeout(() => { this._doctorsFetchPromise = null; }, 1500);
            });
        }
        try {
            const list = await this._doctorsFetchPromise;
            if (Array.isArray(list) && list.length > 0) return list;
        } catch (e) {}
        return this.getAll('doctors');
    },

    /**
     * Mirrors MySQL appointment records (and any embedded preVisitForm) into localStorage
     * (`primecare_appointments` and `primecare_preVisitForms`) so still-unmigrated synchronous
     * helpers continue resolving current appointment data.
     */
    _syncAppointmentCache: function(apptOrList, options = {}) {
        try {
            let current = this.getAll('appointments');
            let forms = this.getAll('preVisitForms');
            if (options.replaceAll && Array.isArray(apptOrList)) {
                localStorage.setItem('primecare_appointments', JSON.stringify(apptOrList));
                apptOrList.forEach(item => {
                    if (item && item.preVisitForm) {
                        const fIdx = forms.findIndex(f => f.appointmentId === item.id);
                        if (fIdx !== -1) forms[fIdx] = item.preVisitForm;
                        else forms.push(item.preVisitForm);
                    }
                });
                localStorage.setItem('primecare_preVisitForms', JSON.stringify(forms));
                return;
            }
            if (options.deletedId) {
                current = current.filter(a => a.id !== options.deletedId);
            }
            const items = Array.isArray(apptOrList) ? apptOrList : (apptOrList ? [apptOrList] : []);
            items.forEach(item => {
                if (!item || !item.id) return;
                const idx = current.findIndex(a => a.id === item.id);
                if (idx !== -1) {
                    current[idx] = { ...current[idx], ...item };
                } else {
                    current.push(item);
                }
                if (item.preVisitForm) {
                    const fIdx = forms.findIndex(f => f.appointmentId === item.id);
                    if (fIdx !== -1) forms[fIdx] = item.preVisitForm;
                    else forms.push(item.preVisitForm);
                }
            });
            localStorage.setItem('primecare_appointments', JSON.stringify(current));
            localStorage.setItem('primecare_preVisitForms', JSON.stringify(forms));
        } catch (e) {
            // Ignore localStorage quota/serialization errors
        }
    },

    /**
     * Helper used by unmigrated async methods (dashboard stats, billing, reports, user/patient deletion checks)
     * to ensure appointments are fetched from MySQL before computing aggregates or checking unbilled items.
     */
    _getAppointmentsListForMockJoin: async function() {
        if (!this._backendConfig.modules.appointments) {
            return this.getAll('appointments');
        }
        if (!this._appointmentsFetchPromise) {
            this._appointmentsFetchPromise = this.searchAppointments({}).finally(() => {
                setTimeout(() => { this._appointmentsFetchPromise = null; }, 1500);
            });
        }
        try {
            const list = await this._appointmentsFetchPromise;
            if (Array.isArray(list)) return list;
        } catch (e) {}
        return this.getAll('appointments');
    },

    // ==========================================
    // 0b. PHP AUTHENTICATION (Phase 5.2)
    // ==========================================
    // The PHP session (HttpOnly cookie, invisible to JavaScript) is the ONLY source of
    // truth for "who is logged in". Nothing in this block touches the mock-data
    // authentication logic further below; `api.login()` / `api.logout()` simply delegate
    // here while `_backendConfig.modules.auth` is true.
    //
    // Every method is async and resolves to the standard envelope:
    //   { success, message, data, status }   (status 0 = network error)
    //
    // Security notes:
    //  - No password, password hash, or session ID is ever stored in localStorage.
    //  - The CSRF token is kept in JavaScript MEMORY only and re-fetched via `me()`
    //    after each page load.
    //  - For the still-unmigrated mock modules, a SAFE copy of the user (no password) is
    //    cached in `primecare_currentUser` after the server confirms the session. That cache
    //    is UI-only: it grants nothing on the server and is overwritten/cleared from the
    //    server's answer on every page load (see app.js renderShell).
    auth: {
        _csrfToken: null,

        /** Fetch a CSRF token bound to the current (maybe anonymous) session. */
        _fetchCsrfToken: async function() {
            const res = await api._request('auth/csrf.php', { method: 'GET' });
            if (res.success && res.data && res.data.csrfToken) {
                api.auth._csrfToken = res.data.csrfToken;
            }
            return res;
        },

        /**
         * Store a safe, legacy-shaped copy of the server-confirmed user so the mock-data
         * modules (which still read `primecare_currentUser`) keep working.
         * Mock-record extras (createdBy, etc.) are merged in, but the mock `password`
         * field is always dropped and server values always win.
         */
        _cacheLegacyUser: function(serverUser) {
            let mock = {};
            try { mock = api.getAll('users').find(u => u.id === serverUser.id) || {}; } catch (e) { mock = {}; }
            const { password, ...mockSafe } = mock;
            const merged = Object.assign({}, mockSafe, {
                id: serverUser.id,
                username: serverUser.username,
                fullName: serverUser.fullName,
                role: serverUser.role,
                status: serverUser.status,
                email: serverUser.email,
                mobile: serverUser.mobile,
                mustChangePassword: serverUser.mustChangePassword,
                lastLogin: serverUser.lastLogin,
                createdAt: serverUser.createdAt || mockSafe.createdAt
            });
            localStorage.setItem('primecare_currentUser', JSON.stringify(merged));
            // A simulated role belongs to one login only.
            sessionStorage.removeItem('primecare_sim_role');
        },

        /** Forget everything the browser knows about the signed-in user (UI state only). */
        _clearClientState: function() {
            api.auth._csrfToken = null;
            localStorage.removeItem('primecare_currentUser');
            localStorage.removeItem('primecare_preview');
            sessionStorage.removeItem('primecare_sim_role');
            sessionStorage.removeItem('primecare_preview');
        },

        /**
         * Log in through PHP.
         * @param {{username: string, password: string}} credentials
         * @returns {Promise<{success, message, data: ({user, csrfToken}|null), status}>}
         */
        login: async function(credentials) {
            const username = String((credentials && credentials.username) || '').trim();
            const password = String((credentials && credentials.password) || '');
            if (!username || !password) {
                return { success: false, message: 'Please enter your username and password.', data: null, status: 400 };
            }

            const csrf = await api.auth._fetchCsrfToken();
            if (!csrf.success) {
                return {
                    success: false,
                    message: csrf.status === 0
                        ? csrf.message
                        : 'Unable to start a secure login session. Please try again.',
                    data: null,
                    status: csrf.status
                };
            }

            const res = await api._request('auth/login.php', {
                method: 'POST',
                headers: { 'X-CSRF-Token': api.auth._csrfToken },
                body: { username, password }
            });

            if (res.success && res.data && res.data.user) {
                api.auth._csrfToken = res.data.csrfToken || null;
                api.auth._cacheLegacyUser(res.data.user);
            }
            return res;
        },

        /**
         * Ask PHP who is logged in. 401 clears the local UI cache.
         * Network errors (status 0) leave the cache untouched so callers can decide.
         */
        me: async function() {
            const res = await api._request('auth/me.php', { method: 'GET' });
            if (res.success && res.data && res.data.user) {
                api.auth._csrfToken = res.data.csrfToken || null;
                api.auth._cacheLegacyUser(res.data.user);
            } else if (res.status === 401) {
                api.auth._clearClientState();
            }
            return res;
        },

        /**
         * Log out through PHP (destroys the server session + cookie), then always clear
         * local UI state, even if the request fails.
         */
        logout: async function() {
            let res = { success: true, message: 'Logged out.', data: null, status: 200 };
            try {
                if (!api.auth._csrfToken) await api.auth.me();   // recovers the token after a page load
                res = await api._request('auth/logout.php', {
                    method: 'POST',
                    headers: api.auth._csrfToken ? { 'X-CSRF-Token': api.auth._csrfToken } : {},
                    body: {}
                });
            } finally {
                api.auth._clearClientState();
            }
            return res;
        }
    },

    // ==========================================
    // 1. GENERIC HELPERS & SYSTEM
    // ==========================================
    getAll: function(collection) { return JSON.parse(localStorage.getItem(`primecare_${collection}`)) || []; },
    getById: function(collection, id) { return this.getAll(collection).find(item => item.id === id); },
    save: function(collection, item, prefix = 'ID') {
        let items = this.getAll(collection);
        if (item.id) { 
            items = items.map(i => i.id === item.id ? item : i); 
        } else {
            let maxNum = 0;
            items.forEach(i => {
                if (i && i.id) {
                    const match = String(i.id).match(/\d+$/);
                    if (match) {
                        const num = parseInt(match[0], 10);
                        if (!isNaN(num) && num > maxNum) maxNum = num;
                    }
                }
            });
            let counters = this.getAll('counters')[0] || { bill: 1, receipt: 1 };
            const counterVal = counters[collection] || 0;
            let nextNum = Math.max(maxNum, counterVal) + 1;
            let candidateId = `${prefix}-${nextNum.toString().padStart(3, '0')}`;
            while (items.some(i => i.id === candidateId)) {
                nextNum++;
                candidateId = `${prefix}-${nextNum.toString().padStart(3, '0')}`;
            }
            item.id = candidateId;
            counters[collection] = nextNum;
            localStorage.setItem('primecare_counters', JSON.stringify([counters]));
            items.push(item);
        }
        localStorage.setItem(`primecare_${collection}`, JSON.stringify(items));
        return item;
    },
    remove: function(collection, id) {
        let items = this.getAll(collection);
        items = items.filter(i => i.id !== id);
        localStorage.setItem(`primecare_${collection}`, JSON.stringify(items));
    },
    logActivity: function(action, details) {
        const user = JSON.parse(localStorage.getItem('primecare_currentUser'));
        if (!user) return;
        let logs = this.getAll('auditLog');
        logs.push({ id: `LOG-${Date.now()}`, userId: user.id, username: user.fullName, action, details, timestamp: new Date().toISOString() });
        localStorage.setItem('primecare_auditLog', JSON.stringify(logs));
    },
    createNotification: function(patientId, type, title, message, link) {
        let notifs = this.getAll('notifications');
        notifs.push({ id: `N-${Date.now()}`, patientId, type, title, message, link, read: false, date: new Date().toISOString() });
        localStorage.setItem('primecare_notifications', JSON.stringify(notifs));
    },

    // ==========================================
    // 2. AUTHENTICATION & USER MANAGEMENT
    // ==========================================
    login: async function(username, password) {
        // Phase 5.2: when PHP auth is enabled this delegates to the real server login.
        // The mock-data login below only runs if `_backendConfig.modules.auth` is turned off.
        if (this._backendConfig.modules.auth) {
            const res = await this.auth.login({ username, password });
            if (res.success) this.logActivity('Login', 'User logged in.');
            return { success: res.success, message: res.message, user: res.success && res.data ? res.data.user : undefined };
        }
        let users = this.getAll('users');
        const cleanUser = username.trim().toLowerCase();
        const idx = users.findIndex(u => u.username.trim().toLowerCase() === cleanUser && u.password === password);
        if (idx === -1) return { success: false, message: 'Invalid username or password.' };
        if (users[idx].status !== 'active') return { success: false, message: 'Account is inactive or rejected.' };
        
        users[idx].lastLogin = new Date().toISOString().split('T')[0];
        localStorage.setItem('primecare_users', JSON.stringify(users));
        localStorage.setItem('primecare_currentUser', JSON.stringify(users[idx]));
        this.logActivity('Login', 'User logged in.');
        return { success: true, message: 'Login successful.', user: users[idx] };
    },
    logout: async function() {
        this.logActivity('Logout', 'User logged out.');
        // Phase 5.2: destroy the PHP session too (also clears local UI state).
        if (this._backendConfig.modules.auth) { await this.auth.logout(); return; }
        localStorage.removeItem('primecare_currentUser');
    },
    getCurrentUser: async function() { return JSON.parse(localStorage.getItem('primecare_currentUser')); },
    changeOwnPassword: async function(oldPw, newPw) {
        if (this._backendConfig.modules.auth) {
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request('auth/change-password.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: { oldPassword: oldPw, newPassword: newPw }
            });
            if (res.success && res.data && res.data.user) {
                this.auth._cacheLegacyUser(res.data.user);
                try {
                    let users = this.getAll('users');
                    const idx = users.findIndex(u => u.id === res.data.user.id);
                    if (idx !== -1) {
                        users[idx].mustChangePassword = false;
                        delete users[idx].password;
                        localStorage.setItem('primecare_users', JSON.stringify(users));
                    }
                } catch (e) {}
                this.logActivity('Change Password', 'User changed their own password.');
            }
            return { success: res.success, message: res.message };
        }
        const user = await this.getCurrentUser();
        let users = this.getAll('users');
        const idx = users.findIndex(u => u.id === user.id);
        if (users[idx].password !== oldPw) return { success: false, message: 'Incorrect current password.' };
        if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPw)) return { success: false, message: 'Password must be min 8 chars, 1 uppercase, 1 number.' };
        
        users[idx].password = newPw;
        users[idx].mustChangePassword = false;
        localStorage.setItem('primecare_users', JSON.stringify(users));
        localStorage.setItem('primecare_currentUser', JSON.stringify(users[idx]));
        this.logActivity('Change Password', 'User changed their own password.');
        return { success: true, message: 'Password updated successfully.' };
    },
    getUsers: async function(filters) {
        let users = this.getAll('users');
        if (filters.role && filters.role !== 'All') users = users.filter(u => u.role === filters.role);
        if (filters.status && filters.status !== 'All') users = users.filter(u => u.status === filters.status);
        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            users = users.filter(u => u.fullName.toLowerCase().includes(kw) || u.username.toLowerCase().includes(kw) || u.email.toLowerCase().includes(kw));
        }
        return users.sort((a, b) => a.fullName.localeCompare(b.fullName));
    },
    getUserById: async function(id) { return this.getById('users', id); },
    saveUser: async function(data) {
        const currentUser = await this.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') return { success: false, message: 'Unauthorized.' };
        
        let users = this.getAll('users');
        if (!data.id && users.some(u => u.username.toLowerCase() === data.username.toLowerCase())) return { success: false, message: 'Username is already taken.' };
        if (users.some(u => u.email.toLowerCase() === data.email.toLowerCase() && u.id !== data.id)) return { success: false, message: 'Email is already taken.' };

        let tempPw = null;
        let userObj = { ...data };
        
        if (!data.id) {
            tempPw = Math.random().toString(36).slice(-8) + 'A1';
            userObj.password = tempPw;
            userObj.mustChangePassword = true;
            userObj.createdBy = currentUser.id;
            userObj.createdAt = new Date().toISOString().split('T')[0];
            userObj.lastLogin = null;
            
            let maxNum = 0;
            users.forEach(u => {
                if (u && u.id) {
                    const match = String(u.id).match(/\d+$/);
                    if (match) {
                        const num = parseInt(match[0], 10);
                        if (!isNaN(num) && num > maxNum) maxNum = num;
                    }
                }
            });
            let counters = this.getAll('counters')[0] || { bill: 1, receipt: 1 };
            const counterVal = counters.users || 0;
            let nextNum = Math.max(maxNum, counterVal) + 1;
            let candidateId = `U-${nextNum.toString().padStart(3, '0')}`;
            while (users.some(u => u.id === candidateId)) {
                nextNum++;
                candidateId = `U-${nextNum.toString().padStart(3, '0')}`;
            }
            userObj.id = candidateId;
            counters.users = nextNum;
            localStorage.setItem('primecare_counters', JSON.stringify([counters]));
            users.push(userObj);
        } else {
            const idx = users.findIndex(u => u.id === data.id);
            userObj = { ...users[idx], fullName: data.fullName, email: data.email, role: data.role, status: data.status };
            users[idx] = userObj;
        }
        localStorage.setItem('primecare_users', JSON.stringify(users));

        if (userObj.role === 'doctor' && data.linkedDoctorId) {
            let docs = this.getAll('doctors');
            const dIdx = docs.findIndex(d => d.id === data.linkedDoctorId);
            if (dIdx !== -1) { docs[dIdx].userId = userObj.id; localStorage.setItem('primecare_doctors', JSON.stringify(docs)); }
        }

        this.logActivity(data.id ? 'Update User' : 'Create User', `User ${userObj.username} (${userObj.role})`);
        return { success: true, message: 'User saved successfully.', tempPassword: tempPw };
    },
    setUserStatus: async function(id, status) {
        const currentUser = await this.getCurrentUser();
        if (currentUser.id === id) return { success: false, message: 'You cannot deactivate your own account.' };
        let users = this.getAll('users');
        if (status === 'inactive' && users.filter(u => u.role === 'admin' && u.status === 'active').length <= 1 && users.find(u => u.id === id).role === 'admin') {
            return { success: false, message: 'Cannot deactivate the last active admin.' };
        }
        const idx = users.findIndex(u => u.id === id);
        users[idx].status = status;
        localStorage.setItem('primecare_users', JSON.stringify(users));
        this.logActivity('Change User Status', `Set user ${id} to ${status}`);
        return { success: true, message: `User status set to ${status}.` };
    },
    changeUserRole: async function(id, role) {
        const currentUser = await this.getCurrentUser();
        if (currentUser.id === id) return { success: false, message: 'You cannot change your own role.' };
        let users = this.getAll('users');
        if (users.find(u => u.id === id).role === 'admin' && users.filter(u => u.role === 'admin' && u.status === 'active').length <= 1) {
            return { success: false, message: 'Cannot demote the last active admin.' };
        }
        const idx = users.findIndex(u => u.id === id);
        users[idx].role = role;
        localStorage.setItem('primecare_users', JSON.stringify(users));
        this.logActivity('Change User Role', `Set user ${id} to ${role}`);
        return { success: true, message: `User role changed to ${role}.` };
    },
    resetUserPassword: async function(id) {
        const currentUser = await this.getCurrentUser();
        if (currentUser.role !== 'admin') return { success: false, message: 'Unauthorized.' };
        let users = this.getAll('users');
        const idx = users.findIndex(u => u.id === id);
        const tempPw = Math.random().toString(36).slice(-8) + 'A1';
        users[idx].password = tempPw;
        users[idx].mustChangePassword = true;
        localStorage.setItem('primecare_users', JSON.stringify(users));
        this.logActivity('Reset Password', `Reset password for user ${id}`);
        return { success: true, message: 'Password reset successfully.', tempPassword: tempPw };
    },
    deleteUser: async function(id) {
        const currentUser = await this.getCurrentUser();
        if (currentUser.id === id) return { success: false, message: 'You cannot delete yourself.' };
        const allAppts = await this._getAppointmentsListForMockJoin();
        const appts = allAppts.filter(a => a.createdBy === id);
        const logs = this.getAll('auditLog').filter(l => l.userId === id);
        if (appts.length > 0 || logs.length > 0) return { success: false, message: 'Cannot delete user with existing system records. Please deactivate them instead.' };
        this.remove('users', id);
        this.logActivity('Delete User', `Deleted user ${id}`);
        return { success: true, message: 'User deleted.' };
    },
    getAuditLog: async function(filters) {
        let logs = this.getAll('auditLog');
        if (filters.userId) logs = logs.filter(l => l.userId === filters.userId);
        if (filters.dateFrom) logs = logs.filter(l => l.timestamp.split('T')[0] >= filters.dateFrom);
        if (filters.dateTo) logs = logs.filter(l => l.timestamp.split('T')[0] <= filters.dateTo);
        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            logs = logs.filter(l => l.username.toLowerCase().includes(kw) || l.action.toLowerCase().includes(kw) || l.details.toLowerCase().includes(kw));
        }
        return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    },

    // ==========================================
    // 3. DASHBOARD & PUBLIC DATA
    // ==========================================
   getStats: async function() {
        const patients = await this._getPatientsListForMockJoin(); const doctors = await this._getDoctorsListForMockJoin();
        const appointments = await this._getAppointmentsListForMockJoin(); const bills = this.getAll('bills');
        const beds = this.getAll('beds'); const labs = this.getAll('labResults');
        const admissions = this.getAll('admissions');
        const todayStr = new Date().toLocaleDateString('en-CA');
        
        return {
            totalPatients: patients.length,
            totalDoctors: doctors.length,
            appointmentsToday: appointments.filter(a => a.date === todayStr).length,
            pendingBills: bills.filter(b => b.status === 'Unpaid' || b.status === 'Partial').length,
            pendingVerifications: patients.filter(p => p.status === 'pending').length,
            admittedInpatients: admissions.filter(a => a.status === 'Admitted').length,
            availableBeds: beds.filter(b => b.status === 'Available').length,
            criticalLabResults: labs.filter(l => l.flag === 'Critical').length
        };
    },
    getTodaysAppointments: async function() {
        const todayStr = new Date().toLocaleDateString('en-CA');
        if (this._backendConfig.modules.appointments) {
            const list = await this.searchAppointments({
                dateFrom: todayStr,
                dateTo: todayStr,
                sortBy: 'datetime',
                sortDir: 'asc'
            });
            return list.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        }
        const appts = this.getAll('appointments').filter(a => a.date === todayStr);
        const patients = await this._getPatientsListForMockJoin(); const doctors = await this._getDoctorsListForMockJoin();
        return appts.map(a => {
            const p = patients.find(x => x.id === a.patientId);
            const d = doctors.find(x => x.id === a.doctorId);
            return { ...a, patientName: p ? p.fullName : 'Unknown', doctorName: d ? d.name : 'Unknown' };
        }).sort((a, b) => a.time.localeCompare(b.time));
    },
    getPendingVerifications: async function(limit = 5) {
        const patients = await this._getPatientsListForMockJoin();
        return patients.filter(p => p.status === 'pending').slice(0, limit);
    },
    getAppointmentsPerDay: async function(days = 7) {
        const appts = await this._getAppointmentsListForMockJoin(); const result = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const dateStr = d.toLocaleDateString('en-CA');
            result.push({ date: d.toLocaleDateString('en-US', { weekday: 'short' }), count: appts.filter(a => a.date === dateStr).length });
        }
        return result;
    },
    getRecentActivity: async function(limit = 5) {
        let activities = []; const todayStr = new Date().toLocaleDateString('en-CA');
        const patients = await this._getPatientsListForMockJoin();
        const appts = await this._getAppointmentsListForMockJoin();
        patients.filter(p => p.createdAt === todayStr).forEach(p => activities.push({ icon: '👤', text: `New patient registered: ${p.fullName}`, time: 'Today' }));
        appts.filter(a => a.date === todayStr && a.status === 'Completed').forEach(a => activities.push({ icon: '✅', text: `Appointment completed for ${a.patientId}`, time: 'Today' }));
        this.getAll('bills').filter(b => b.date === todayStr && b.status === 'Paid').forEach(b => activities.push({ icon: '💳', text: `Payment received: ${b.id}`, time: 'Today' }));
        return activities.slice(0, limit);
    },
    getDepartments: async function() {
        if (this._backendConfig.modules.doctors) {
            const res = await this._request('doctors/departments.php', { method: 'GET' });
            if (res.success && res.data && Array.isArray(res.data.departments)) {
                try {
                    localStorage.setItem('primecare_departments', JSON.stringify(res.data.departments));
                } catch (e) {}
                return res.data.departments;
            }
        }
        return this.getAll('departments');
    },
    getIdTypes: async function() {
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/check-unique.php', {
                method: 'GET',
                params: { field: 'idTypes' }
            });
            if (res.success && res.data && Array.isArray(res.data.idTypes) && res.data.idTypes.length > 0) {
                localStorage.setItem('primecare_idTypes', JSON.stringify(res.data.idTypes));
                return res.data.idTypes;
            }
        }
        return this.getAll('idTypes');
    },
    searchDoctors: async function(filters = {}) {
        const safeFilters = filters || {};
        if (this._backendConfig.modules.doctors) {
            const res = await this._request('doctors/list.php', {
                method: 'GET',
                params: {
                    keyword: safeFilters.keyword || '',
                    specialization: safeFilters.specialization || safeFilters.spec || 'All',
                    department: safeFilters.department || 'All',
                    departmentId: safeFilters.departmentId || '',
                    language: safeFilters.language || '',
                    insurance: safeFilters.insurance || '',
                    status: safeFilters.status || 'All',
                    sortBy: safeFilters.sortBy || 'id',
                    sortDir: safeFilters.sortDir || 'asc'
                }
            });
            if (res.success && res.data && Array.isArray(res.data.doctors)) {
                const isUnfiltered = !safeFilters.keyword
                    && (!safeFilters.specialization || safeFilters.specialization === 'All')
                    && (!safeFilters.spec || safeFilters.spec === 'All')
                    && (!safeFilters.department || safeFilters.department === 'All')
                    && !safeFilters.departmentId
                    && !safeFilters.language
                    && !safeFilters.insurance
                    && (!safeFilters.status || safeFilters.status === 'All');
                this._syncDoctorCache(res.data.doctors, { replaceAll: isUnfiltered });
                return res.data.doctors;
            }
        }
        let docs = this.getAll('doctors');
        if (safeFilters.keyword) {
            const kw = safeFilters.keyword.trim().toLowerCase();
            docs = docs.filter(d => 
                (d.name && d.name.toLowerCase().includes(kw)) ||
                (d.specialization && d.specialization.toLowerCase().includes(kw)) ||
                (d.department && d.department.toLowerCase().includes(kw))
            );
        }
        if (safeFilters.specialization && safeFilters.specialization !== 'All' && safeFilters.specialization !== '') {
            docs = docs.filter(d => d.specialization.toLowerCase() === safeFilters.specialization.toLowerCase());
        }
        if (safeFilters.language && safeFilters.language !== 'All' && safeFilters.language !== '') {
            docs = docs.filter(d => Array.isArray(d.languages) && d.languages.some(l => l.toLowerCase() === safeFilters.language.toLowerCase()));
        }
        if (safeFilters.insurance && safeFilters.insurance !== 'All' && safeFilters.insurance !== '') {
            docs = docs.filter(d => Array.isArray(d.acceptedInsurance) && d.acceptedInsurance.some(i => i.toLowerCase() === safeFilters.insurance.toLowerCase()));
        }
        if (safeFilters.status && safeFilters.status !== 'All' && safeFilters.status !== '') {
            docs = docs.filter(d => d.status.toLowerCase() === safeFilters.status.toLowerCase());
        }
        return docs;
    },
    getEmergencyInfo: async function() {
        const stored = localStorage.getItem('primecare_emergencyInfo');
        if (stored) {
            try { return JSON.parse(stored); } catch (e) { console.error('Failed to parse emergencyInfo:', e); }
        }
        return (typeof seedData !== 'undefined' && seedData.emergencyInfo) ? seedData.emergencyInfo : null;
    },
    getTriageGuide: async function() {
        const stored = this.getAll('triageGuide');
        if (stored && stored.length > 0) return stored;
        return (typeof seedData !== 'undefined' && seedData.triageGuide) ? seedData.triageGuide : [];
    },
    getVisitorInfo: async function() {
        const stored = localStorage.getItem('primecare_visitorInfo');
        if (stored) {
            try { return JSON.parse(stored); } catch (e) { console.error('Failed to parse visitorInfo:', e); }
        }
        return (typeof seedData !== 'undefined' && seedData.visitorInfo) ? seedData.visitorInfo : null;
    },

    // ==========================================
    // 4. PATIENTS (STAFF SIDE)
    // ==========================================
    getNextPatientPreviewId: async function() {
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/check-unique.php', {
                method: 'GET',
                params: { field: 'nextId' }
            });
            if (res.success && res.data && res.data.nextPreviewId) {
                this._lastNextPreviewId = res.data.nextPreviewId;
                return res.data.nextPreviewId;
            }
            if (this._lastNextPreviewId) return this._lastNextPreviewId;
        }
        const patients = await this.searchPatients({});
        return `P-${(patients.length + 1).toString().padStart(3, '0')}`;
    },
    getPatientById: async function(id) {
        if (!id) return null;
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/get.php', {
                method: 'GET',
                params: { id }
            });
            if (res.success && res.data && res.data.patient) {
                this._syncPatientCache(res.data.patient);
                return res.data.patient;
            }
            if (res.status === 404) return null;
        }
        return this.getById('patients', id);
    },
    searchPatients: async function(filters = {}) {
        const safeFilters = filters || {};
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/list.php', {
                method: 'GET',
                params: {
                    keyword: safeFilters.keyword || '',
                    status: safeFilters.status || 'All',
                    admitType: safeFilters.admitType || 'All',
                    sortBy: safeFilters.sortBy || 'createdAt',
                    sortDir: safeFilters.sortDir || 'desc'
                }
            });
            if (res.success && res.data && Array.isArray(res.data.patients)) {
                const isUnfiltered = !safeFilters.keyword
                    && (!safeFilters.status || safeFilters.status === 'All')
                    && (!safeFilters.admitType || safeFilters.admitType === 'All');
                this._syncPatientCache(res.data.patients, { replaceAll: isUnfiltered });
                if (res.data.nextPreviewId) {
                    this._lastNextPreviewId = res.data.nextPreviewId;
                }
                return res.data.patients;
            }
        }
        let patients = this.getAll('patients');
        if (safeFilters.keyword) {
            const kw = safeFilters.keyword.toLowerCase();
            patients = patients.filter(p => p.id.toLowerCase().includes(kw) || p.fullName.toLowerCase().includes(kw) || p.mobile.includes(kw) || (p.email && p.email.toLowerCase().includes(kw)));
        }
        if (safeFilters.status && safeFilters.status !== 'All') patients = patients.filter(p => p.status.toLowerCase() === safeFilters.status.toLowerCase());
        if (safeFilters.admitType && safeFilters.admitType !== 'All') patients = patients.filter(p => p.admitType === safeFilters.admitType);
        if (safeFilters.sortBy) {
            patients.sort((a, b) => {
                let valA = a[safeFilters.sortBy] || ''; let valB = b[safeFilters.sortBy] || '';
                if (valA < valB) return safeFilters.sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return safeFilters.sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return patients;
    },
    registerPatientByStaff: async function(formData) {
        if (this._backendConfig.modules.patients) {
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request('patients/create.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: formData
            });
            if (res.success && res.data && res.data.patient) {
                this._syncPatientCache(res.data.patient);
                this.logActivity('Register Patient', `Registered walk-in patient ${res.data.patient.id} (${res.data.patient.fullName})`);
                return { success: true, message: res.message, patient: res.data.patient };
            }
            return { success: false, message: res.message || 'Failed to register patient.' };
        }
        const staff = await this.getCurrentUser();
        const patient = {
            ...formData, userId: null, fullName: `${formData.firstName} ${formData.lastName}`,
            status: 'verified', verifiedBy: staff.fullName, verifiedAt: new Date().toISOString().split('T')[0],
            createdAt: new Date().toISOString().split('T')[0], rejectionReason: null
        };
        const saved = this.save('patients', patient, 'P');
        return { success: true, message: 'Patient registered successfully.', patient: saved };
    },
    registerPatientSelf: async function(formData) {
        if (this._backendConfig.modules.patients) {
            const csrfRes = await this.auth._fetchCsrfToken();
            const csrfToken = (csrfRes.success && csrfRes.data && csrfRes.data.csrfToken)
                ? csrfRes.data.csrfToken
                : (this.auth._csrfToken || '');
            const res = await this._request('patients/register.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: formData
            });
            if (res.success && res.data && res.data.patient) {
                this._syncPatientCache(res.data.patient);
                return {
                    success: true,
                    message: res.message,
                    patient: res.data.patient,
                    user: res.data.user || null
                };
            }
            return { success: false, message: res.message || 'Registration failed.' };
        }
        return await this.registerPatientByStaff(formData);
    },
    updatePatient: async function(id, changes) {
        if (this._backendConfig.modules.patients) {
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request('patients/update.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: { id, ...changes }
            });
            if (res.success && res.data && res.data.patient) {
                this._syncPatientCache(res.data.patient);
                return { success: true, message: res.message, patient: res.data.patient };
            }
            return { success: false, message: res.message || 'Failed to update patient.' };
        }
        let patients = this.getAll('patients');
        const idx = patients.findIndex(p => p.id === id);
        if (idx === -1) return { success: false, message: 'Patient not found.' };
        
        if (changes.admitType === 'Inpatient' && patients[idx].status !== 'verified') {
            return { success: false, message: 'Cannot set Inpatient status for an unverified patient.' };
        }

        patients[idx] = { ...patients[idx], ...changes, fullName: `${changes.firstName || patients[idx].firstName} ${changes.lastName || patients[idx].lastName}` };
        localStorage.setItem('primecare_patients', JSON.stringify(patients));
        return { success: true, message: 'Patient updated successfully.' };
    },
    verifyPatient: async function(id) {
        if (this._backendConfig.modules.patients) {
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request('patients/verify.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: { id, action: 'verify' }
            });
            if (res.success && res.data && res.data.patient) {
                const p = res.data.patient;
                this._syncPatientCache(p);
                if (p.userId) {
                    let users = this.getAll('users');
                    const uIdx = users.findIndex(u => u.id === p.userId);
                    if (uIdx !== -1) {
                        users[uIdx].status = 'active';
                        localStorage.setItem('primecare_users', JSON.stringify(users));
                    }
                    this.createNotification(id, 'account', 'Account Verified', 'Your account has been verified. You can now book appointments.', 'home.html');
                }
                this.logActivity('Verify Patient', `Verified patient ${id}`);
                return { success: true, message: res.message, patient: p };
            }
            return { success: false, message: res.message || 'Failed to verify patient.' };
        }
        const staff = await this.getCurrentUser(); let patients = this.getAll('patients');
        const pIdx = patients.findIndex(p => p.id === id);
        if (pIdx === -1) return { success: false, message: 'Patient not found.' };
        patients[pIdx].status = 'verified'; patients[pIdx].verifiedBy = staff.fullName; patients[pIdx].verifiedAt = new Date().toISOString().split('T')[0];
        localStorage.setItem('primecare_patients', JSON.stringify(patients));
        if (patients[pIdx].userId) {
            let users = this.getAll('users'); const uIdx = users.findIndex(u => u.id === patients[pIdx].userId);
            if (uIdx !== -1) { users[uIdx].status = 'active'; localStorage.setItem('primecare_users', JSON.stringify(users)); }
            this.createNotification(id, 'account', 'Account Verified', 'Your account has been verified. You can now book appointments.', 'home.html');
        }
        this.logActivity('Verify Patient', `Verified patient ${id}`);
        return { success: true, message: 'Patient verified successfully.' };
    },
    rejectPatient: async function(id, reason) {
        if (this._backendConfig.modules.patients) {
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request('patients/verify.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: { id, action: 'reject', reason }
            });
            if (res.success && res.data && res.data.patient) {
                const p = res.data.patient;
                this._syncPatientCache(p);
                if (p.userId) {
                    let users = this.getAll('users');
                    const uIdx = users.findIndex(u => u.id === p.userId);
                    if (uIdx !== -1) {
                        users[uIdx].status = 'rejected';
                        localStorage.setItem('primecare_users', JSON.stringify(users));
                    }
                }
                this.logActivity('Reject Patient', `Rejected patient ${id}`);
                return { success: true, message: res.message, patient: p };
            }
            return { success: false, message: res.message || 'Failed to reject patient.' };
        }
        let patients = this.getAll('patients'); const pIdx = patients.findIndex(p => p.id === id);
        if (pIdx === -1) return { success: false, message: 'Patient not found.' };
        patients[pIdx].status = 'rejected'; patients[pIdx].rejectionReason = reason;
        localStorage.setItem('primecare_patients', JSON.stringify(patients));
        if (patients[pIdx].userId) {
            let users = this.getAll('users'); const uIdx = users.findIndex(u => u.id === patients[pIdx].userId);
            if (uIdx !== -1) { users[uIdx].status = 'rejected'; localStorage.setItem('primecare_users', JSON.stringify(users)); }
        }
        this.logActivity('Reject Patient', `Rejected patient ${id}`);
        return { success: true, message: 'Patient application rejected.' };
    },
    deletePatient: async function(id) {
        if (!this._backendConfig.modules.patients) {
            const appts = this.getAll('appointments').filter(a => a.patientId === id);
            const records = this.getAll('medicalRecords').filter(r => r.patientId === id);
            const bills = this.getAll('bills').filter(b => b.patientId === id);
            const rxs = this.getAll('prescriptions').filter(r => r.patientId === id);
            const labs = this.getAll('labResults').filter(l => l.patientId === id);
            const adms = this.getAll('admissions').filter(a => a.patientId === id);
            if (appts.length > 0 || records.length > 0 || bills.length > 0 || rxs.length > 0 || labs.length > 0 || adms.length > 0) {
                return { success: false, message: 'Cannot delete patient. They have existing records.' };
            }
        }
        if (this._backendConfig.modules.patients) {
            const p = this.getById('patients', id);
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request('patients/delete.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: { id }
            });
            if (res.success) {
                this._syncPatientCache(null, { deletedId: id });
                if (p && p.userId) this.remove('users', p.userId);
                this.logActivity('Delete Patient', `Deleted patient ${id}`);
                return { success: true, message: res.message };
            }
            return { success: false, message: res.message || 'Failed to delete patient.' };
        }
        const p = this.getById('patients', id);
        if (p && p.userId) this.remove('users', p.userId);
        this.remove('patients', id);
        return { success: true, message: 'Patient deleted successfully.' };
    },
    getPatientSummary: async function(id) {
        const patient = await this.getPatientById(id);
        if (!patient) return null;
        const appts = this._backendConfig.modules.appointments
            ? await this.searchAppointments({ patientId: id, sortBy: 'datetime', sortDir: 'desc' })
            : this.getAll('appointments').filter(a => a.patientId === id);
        return {
            ...patient,
            appointments: appts,
            medicalRecords: this.getAll('medicalRecords').filter(r => r.patientId === id),
            bills: this.getAll('bills').filter(b => b.patientId === id)
        };
    },
    isUsernameTaken: async function(username) {
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/check-unique.php', {
                method: 'GET',
                params: { field: 'username', value: username }
            });
            if (res.success && res.data && typeof res.data.taken === 'boolean') {
                return res.data.taken;
            }
        }
        return this.getAll('users').some(u => u.username.toLowerCase() === String(username || '').toLowerCase());
    },
    isEmailTaken: async function(email, excludeId = null) {
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/check-unique.php', {
                method: 'GET',
                params: { field: 'email', value: email, excludeId: excludeId || '' }
            });
            if (res.success && res.data && typeof res.data.taken === 'boolean') {
                return res.data.taken;
            }
        }
        return this.getAll('patients').some(p => p.email && p.email.toLowerCase() === String(email || '').toLowerCase() && p.id !== excludeId);
    },
    isMobileTaken: async function(mobile, excludeId = null) {
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/check-unique.php', {
                method: 'GET',
                params: { field: 'mobile', value: mobile, excludeId: excludeId || '' }
            });
            if (res.success && res.data && typeof res.data.taken === 'boolean') {
                return res.data.taken;
            }
        }
        return this.getAll('patients').some(p => p.mobile === mobile && p.id !== excludeId);
    },
    isIdTaken: async function(idType, idNumber, excludeId = null) {
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/check-unique.php', {
                method: 'GET',
                params: { field: 'id', idType: idType || '', idNumber: idNumber || '', excludeId: excludeId || '' }
            });
            if (res.success && res.data && typeof res.data.taken === 'boolean') {
                return res.data.taken;
            }
        }
        return this.getAll('patients').some(p => p.idType === idType && p.idNumber === idNumber && p.id !== excludeId);
    },

    // ==========================================
    // 5. DOCTORS & APPOINTMENTS (STAFF SIDE)
    // ==========================================
    getDoctorById: async function(id) {
        if (!id) return null;
        if (this._backendConfig.modules.doctors) {
            const res = await this._request('doctors/get.php', {
                method: 'GET',
                params: { id }
            });
            if (res.success && res.data && res.data.doctor) {
                this._syncDoctorCache(res.data.doctor);
                return res.data.doctor;
            }
            if (res.status === 404) return null;
        }
        return this.getById('doctors', id);
    },
    getDoctors: async function(filters = {}) {
        if (this._backendConfig.modules.doctors) {
            return await this.searchDoctors(filters || {});
        }
        return this.getAll('doctors');
    },
    getDoctorsBySpecialization: async function() {
        const allDocs = await this.getDoctors({ status: 'active' });
        const docs = allDocs.filter(d => d.status === 'active');
        const grouped = {};
        docs.forEach(d => {
            if (!grouped[d.specialization]) grouped[d.specialization] = [];
            grouped[d.specialization].push(d);
        });
        return grouped;
    },
    saveDoctor: async function(doctor) {
        if (this._backendConfig.modules.doctors) {
            const isUpdate = Boolean(doctor && doctor.id && String(doctor.id).trim() !== '');
            const endpoint = isUpdate ? 'doctors/update.php' : 'doctors/create.php';
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request(endpoint, {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: doctor
            });
            if (res.success && res.data && res.data.doctor) {
                this._syncDoctorCache(res.data.doctor);
                this.logActivity(
                    isUpdate ? 'Update Doctor' : 'Create Doctor',
                    `${isUpdate ? 'Updated' : 'Created'} doctor ${res.data.doctor.id} (${res.data.doctor.name})`
                );
                return {
                    success: true,
                    message: res.message || 'Doctor saved successfully.',
                    doctor: res.data.doctor,
                    upcomingAppointments: res.data.upcomingAppointments || 0
                };
            }
            return { success: false, message: res.message || 'Failed to save doctor.' };
        }
        const parts = doctor.name.replace('Dr. ', '').split(' ');
        doctor.photoInitials = parts.length > 1 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : parts[0].substring(0,2).toUpperCase();
        const saved = this.save('doctors', doctor, 'D');
        return { success: true, message: 'Doctor saved successfully.', doctor: saved };
    },
    setDoctorStatus: async function(id, status) {
        if (this._backendConfig.modules.doctors) {
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request('doctors/update.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: { id, status }
            });
            if (res.success && res.data && res.data.doctor) {
                this._syncDoctorCache(res.data.doctor);
                return {
                    success: true,
                    message: res.message,
                    doctor: res.data.doctor,
                    upcomingAppointments: res.data.upcomingAppointments || 0
                };
            }
            return { success: false, message: res.message || 'Failed to update doctor status.' };
        }
        const doc = this.getById('doctors', id);
        if (!doc) return { success: false, message: 'Doctor not found.' };
        doc.status = status;
        const saved = this.save('doctors', doc, 'D');
        return { success: true, message: `Doctor status set to ${status}.`, doctor: saved };
    },
    deleteDoctor: async function(id) {
        if (this._backendConfig.modules.doctors) {
            // Also guard against unmigrated localStorage appointments/medicalRecords created during the session
            const localAppts = this.getAll('appointments').filter(a => a.doctorId === id && (a.status === 'Pending' || a.status === 'Confirmed'));
            const localRecords = this.getAll('medicalRecords').filter(r => r.attendingDoctorId === id || r.doctorId === id);
            if (localAppts.length > 0 || localRecords.length > 0) {
                return {
                    success: false,
                    message: 'Cannot delete doctor. They have upcoming appointments or medical records. Please set status to Inactive instead.'
                };
            }
            const csrfToken = await this._ensureCsrfToken();
            const res = await this._request('doctors/delete.php', {
                method: 'POST',
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
                body: { id }
            });
            if (res.success) {
                this._syncDoctorCache(null, { deletedId: id });
                this.logActivity('Delete Doctor', `Deleted doctor ${id}`);
                return { success: true, message: res.message || 'Doctor deleted successfully.' };
            }
            return { success: false, message: res.message || 'Cannot delete doctor.' };
        }
        const appts = this.getAll('appointments').filter(a => a.doctorId === id && (a.status === 'Pending' || a.status === 'Confirmed'));
        const records = this.getAll('medicalRecords').filter(r => r.doctorId === id);
        if (appts.length > 0 || records.length > 0) return { success: false, message: 'Cannot delete doctor. They have upcoming appointments or medical records. Please set status to Inactive instead.' };
        this.remove('doctors', id);
        return { success: true, message: 'Doctor deleted successfully.' };
    },
    getDoctorSchedules: async function(filters = {}) {
        const safeFilters = filters || {};
        if (this._backendConfig.modules.doctors) {
            const res = await this._request('doctors/schedules.php', {
                method: 'GET',
                params: {
                    doctorId: safeFilters.doctorId || '',
                    day: safeFilters.day || safeFilters.dayOfWeek || ''
                }
            });
            if (res.success && res.data && Array.isArray(res.data.schedules)) {
                return res.data.schedules;
            }
        }
        const docs = await this.getDoctors({});
        let list = [];
        docs.forEach(d => {
            if (safeFilters.doctorId && d.id !== safeFilters.doctorId) return;
            (d.schedule || []).forEach(s => {
                if (safeFilters.day && s.day !== safeFilters.day) return;
                list.push({ ...s, doctorId: d.id, doctorName: d.name });
            });
        });
        return list;
    },
    getDoctorSchedule: async function(doctorId) {
        if (!doctorId) return [];
        if (this._backendConfig.modules.doctors) {
            const res = await this._request('doctors/schedules.php', {
                method: 'GET',
                params: { doctorId }
            });
            if (res.success && res.data && Array.isArray(res.data.schedules)) {
                return res.data.schedules;
            }
        }
        const doc = await this.getDoctorById(doctorId);
        return doc ? doc.schedule : [];
    },
    createDoctorSchedule: async function(data) {
        const csrfToken = await this._ensureCsrfToken();
        const res = await this._request('doctors/schedules.php', {
            method: 'POST',
            headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
            body: { action: 'create', ...data }
        });
        if (res.success && res.data) {
            if (data && data.doctorId) await this.getDoctorById(data.doctorId);
            return { success: true, message: res.message, schedule: res.data.schedule, schedules: res.data.schedules };
        }
        return { success: false, message: res.message || 'Failed to create schedule.' };
    },
    updateDoctorSchedule: async function(id, data) {
        const csrfToken = await this._ensureCsrfToken();
        const res = await this._request('doctors/schedules.php', {
            method: 'POST',
            headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
            body: { action: 'update', id, ...data }
        });
        if (res.success && res.data) {
            if (data && data.doctorId) await this.getDoctorById(data.doctorId);
            return { success: true, message: res.message, schedule: res.data.schedule, schedules: res.data.schedules };
        }
        return { success: false, message: res.message || 'Failed to update schedule.' };
    },
    deleteDoctorSchedule: async function(id, doctorId = null) {
        const csrfToken = await this._ensureCsrfToken();
        const res = await this._request('doctors/schedules.php', {
            method: 'POST',
            headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
            body: { action: 'delete', id, ...(doctorId ? { doctorId } : {}) }
        });
        if (res.success && res.data) {
            if (res.data.doctorId) await this.getDoctorById(res.data.doctorId);
            return { success: true, message: res.message, schedules: res.data.schedules };
        }
        return { success: false, message: res.message || 'Failed to delete schedule.' };
    },
    getAvailableSlots: async function(doctorId, dateString, excludeId = null) {
        if (this._backendConfig.modules.appointments) {
            if (!doctorId || !dateString) return [];
            const params = { doctorId, date: dateString };
            if (excludeId) params.excludeId = excludeId;
            const res = await this._request('appointments/slots.php', { method: 'GET', params });
            if (res.success && res.data && Array.isArray(res.data.slots)) {
                return res.data.slots;
            }
            return [];
        }

        const doc = await this.getDoctorById(doctorId);
        if (!doc || doc.status !== 'active') return [];
        const parts = dateString.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = days[dateObj.getDay()];
        const daySchedule = doc.schedule.find(s => s.day === dayName);
        if (!daySchedule) return [];

        const slots = [];
        let [hour, min] = daySchedule.start.split(':').map(Number);
        const [endHour, endMin] = daySchedule.end.split(':').map(Number);
        const slotMins = doc.slotMinutes || 30;
        const todayStr = new Date().toLocaleDateString('en-CA');
        const now = new Date();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();
        const existingAppts = this.getAll('appointments').filter(a => a.doctorId === doctorId && a.date === dateString && a.status !== 'Cancelled' && (!excludeId || a.id !== excludeId));

        while (hour < endHour || (hour === endHour && min < endMin)) {
            const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
            let isAvailable = true;
            if (dateString === todayStr) {
                if (hour < currentHour || (hour === currentHour && min <= currentMin)) isAvailable = false;
            }
            if (existingAppts.some(a => a.time === timeStr)) isAvailable = false;
            slots.push({ time: timeStr, available: isAvailable });
            min += slotMins;
            if (min >= 60) { hour += Math.floor(min / 60); min = min % 60; }
        }
        return slots;
    },
    searchAppointments: async function(filters = {}) {
        if (this._backendConfig.modules.appointments) {
            const params = {};
            if (filters.keyword) params.keyword = filters.keyword;
            if (filters.doctorId && filters.doctorId !== 'All') params.doctorId = filters.doctorId;
            if (filters.patientId && filters.patientId !== 'All') params.patientId = filters.patientId;
            if (filters.status && filters.status !== 'All') params.status = filters.status;
            if (filters.type && filters.type !== 'All') params.type = filters.type;
            if (filters.dateFrom) params.dateFrom = filters.dateFrom;
            if (filters.dateTo) params.dateTo = filters.dateTo;
            if (filters.scope) params.scope = filters.scope;
            if (filters.sortBy) params.sortBy = filters.sortBy;
            if (filters.sortDir) params.sortDir = filters.sortDir;

            const isUnfiltered = !params.keyword && !params.doctorId && !params.patientId && !params.status && !params.type && !params.dateFrom && !params.dateTo && !params.scope;
            const res = await this._request('appointments/list.php', { method: 'GET', params });
            if (res.success && res.data && Array.isArray(res.data.appointments)) {
                this._syncAppointmentCache(res.data.appointments, isUnfiltered);
                if (res.data.counts) {
                    this._lastAppointmentCounts = res.data.counts;
                }
                return res.data.appointments;
            }
            return [];
        }

        let appts = this.getAll('appointments');
        const patients = await this._getPatientsListForMockJoin();
        const doctors = await this._getDoctorsListForMockJoin();

        if (filters.doctorId && filters.doctorId !== 'All') appts = appts.filter(a => a.doctorId === filters.doctorId);
        if (filters.status && filters.status !== 'All') appts = appts.filter(a => a.status === filters.status);
        if (filters.type && filters.type !== 'All') appts = appts.filter(a => a.type === filters.type);
        if (filters.dateFrom) appts = appts.filter(a => a.date >= filters.dateFrom);
        if (filters.dateTo) appts = appts.filter(a => a.date <= filters.dateTo);

        appts = appts.map(a => {
            const p = patients.find(x => x.id === a.patientId);
            const d = doctors.find(x => x.id === a.doctorId);
            return { ...a, patientName: p ? p.fullName : 'Unknown', doctorName: d ? d.name : 'Unknown', specialization: d ? d.specialization : '' };
        });

        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            appts = appts.filter(a => a.id.toLowerCase().includes(kw) || a.patientName.toLowerCase().includes(kw) || a.doctorName.toLowerCase().includes(kw));
        }

        if (filters.sortBy) {
            appts.sort((a, b) => {
                let valA = a[filters.sortBy]; let valB = b[filters.sortBy];
                if (filters.sortBy === 'datetime') { valA = a.date + a.time; valB = b.date + b.time; }
                if (valA < valB) return filters.sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return filters.sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return appts;
    },
    getAppointmentById: async function(id) {
        if (!id) return null;
        if (this._backendConfig.modules.appointments) {
            const res = await this._request('appointments/get.php', { method: 'GET', params: { id } });
            if (res.success && res.data && res.data.appointment) {
                this._syncAppointmentCache(res.data.appointment);
                return res.data.appointment;
            }
            return null;
        }
        return this.getById('appointments', id);
    },
    bookAppointment: async function(data) {
        if (this._backendConfig.modules.appointments) {
            const res = await this._request('appointments/create.php', {
                method: 'POST',
                body: data
            });
            if (res.success && res.data && res.data.appointment) {
                const appt = res.data.appointment;
                this._syncAppointmentCache(appt);
                this.createNotification(
                    appt.patientId,
                    'appointment',
                    `Appointment ${appt.status}`,
                    `Your appointment with ${appt.doctorName || appt.doctorId} on ${appt.date} at ${appt.time} is ${appt.status}.`,
                    'book-appointment.html?tab=my'
                );
                return { success: true, message: res.message || 'Appointment scheduled successfully.', appointment: appt };
            }
            return { success: false, message: res.message || 'Failed to schedule appointment.' };
        }

        const patient = await this.getPatientById(data.patientId);
        if (!patient) return { success: false, message: 'Patient not found.' };
        if (patient.status !== 'verified') return { success: false, message: 'Only verified patients can book appointments.' };

        const doc = await this.getDoctorById(data.doctorId);
        if (!doc || doc.status !== 'active') return { success: false, message: 'Doctor is not available.' };

        const todayStr = new Date().toLocaleDateString('en-CA');
        if (data.date < todayStr) return { success: false, message: 'Cannot book appointments in the past.' };

        const slots = await this.getAvailableSlots(data.doctorId, data.date);
        if (slots.length === 0) return { success: false, message: 'Doctor is not in clinic on this day.' };
        
        const targetSlot = slots.find(s => s.time === data.time);
        if (!targetSlot) return { success: false, message: 'Time is outside doctor schedule.' };
        if (!targetSlot.available) return { success: false, message: 'Time slot is already taken.' };

        const patientAppts = this.getAll('appointments').filter(a => a.patientId === data.patientId && a.date === data.date && a.time === data.time && a.status !== 'Cancelled');
        if (patientAppts.length > 0) return { success: false, message: 'Patient already has an appointment at this date and time.' };

        const user = await this.getCurrentUser();
        const status = (user && (user.role === 'admin' || user.role === 'staff')) ? 'Confirmed' : 'Pending';

        const appt = {
            patientId: data.patientId, doctorId: data.doctorId, date: data.date, time: data.time,
            type: data.type, reason: data.reason, notes: '', status: status, cancelReason: null,
            createdBy: user ? user.id : patient.userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };

        const saved = this.save('appointments', appt, 'A');
        this.createNotification(data.patientId, 'appointment', `Appointment ${status}`, `Your appointment with ${doc.name} on ${data.date} at ${data.time} is ${status}.`, 'book-appointment.html?tab=my');

        return { success: true, message: 'Appointment scheduled successfully.', appointment: saved };
    },
    rescheduleAppointment: async function(id, newDate, newTime, extra = {}) {
        if (this._backendConfig.modules.appointments) {
            const payload = { id, date: newDate, time: newTime };
            if (extra && extra.type) payload.type = extra.type;
            if (extra && extra.reason !== undefined) payload.reason = extra.reason;
            if (extra && extra.notes !== undefined) payload.notes = extra.notes;

            const res = await this._request('appointments/reschedule.php', {
                method: 'POST',
                body: payload
            });
            if (res.success && res.data && res.data.appointment) {
                const appt = res.data.appointment;
                this._syncAppointmentCache(appt);
                this.createNotification(
                    appt.patientId,
                    'appointment',
                    'Appointment Rescheduled',
                    `Your appointment (${appt.id}) with ${appt.doctorName || appt.doctorId} was rescheduled to ${appt.date} at ${appt.time}.`,
                    'book-appointment.html?tab=my'
                );
                return { success: true, message: res.message || 'Appointment rescheduled successfully.', appointment: appt };
            }
            return { success: false, message: res.message || 'Failed to reschedule appointment.' };
        }

        const appt = this.getById('appointments', id);
        if (!appt) return { success: false, message: 'Appointment not found.' };
        const oldStatus = appt.status;
        appt.status = 'Cancelled';
        localStorage.setItem('primecare_appointments', JSON.stringify(this.getAll('appointments').map(a => a.id === id ? appt : a)));

        const res = await this.bookAppointment({ ...appt, date: newDate, time: newTime });
        if (res.success) {
            this.remove('appointments', id);
            return { success: true, message: 'Appointment rescheduled successfully.' };
        } else {
            appt.status = oldStatus;
            localStorage.setItem('primecare_appointments', JSON.stringify(this.getAll('appointments').map(a => a.id === id ? appt : a)));
            return res;
        }
    },
    cancelAppointment: async function(id, reason) {
        if (this._backendConfig.modules.appointments) {
            const res = await this._request('appointments/status.php', {
                method: 'POST',
                body: { id, status: 'Cancelled', cancelReason: reason }
            });
            if (res.success && res.data && res.data.appointment) {
                const appt = res.data.appointment;
                this._syncAppointmentCache(appt);
                this.createNotification(
                    appt.patientId,
                    'appointment',
                    'Appointment Cancelled',
                    `Your appointment on ${appt.date} was cancelled. Reason: ${appt.cancelReason || reason}`,
                    'book-appointment.html?tab=my'
                );
                return { success: true, message: res.message || 'Appointment cancelled.', appointment: appt };
            }
            return { success: false, message: res.message || 'Failed to cancel appointment.' };
        }

        if (!reason || reason.length < 5) return { success: false, message: 'Cancellation reason must be at least 5 characters.' };
        let appts = this.getAll('appointments');
        const idx = appts.findIndex(a => a.id === id);
        if (idx === -1) return { success: false, message: 'Appointment not found.' };
        if (appts[idx].status === 'Completed') return { success: false, message: 'Cannot cancel a completed appointment.' };
        
        appts[idx].status = 'Cancelled'; appts[idx].cancelReason = reason; appts[idx].updatedAt = new Date().toISOString();
        localStorage.setItem('primecare_appointments', JSON.stringify(appts));

        this.createNotification(appts[idx].patientId, 'appointment', 'Appointment Cancelled', `Your appointment on ${appts[idx].date} was cancelled. Reason: ${reason}`, 'book-appointment.html?tab=my');

        return { success: true, message: 'Appointment cancelled.' };
    },
    updateAppointmentStatus: async function(id, status, cancelReason = null) {
        if (this._backendConfig.modules.appointments) {
            const body = { id, status };
            if (cancelReason) body.cancelReason = cancelReason;
            else if (status === 'Cancelled') body.allowDefaultReason = true;

            const res = await this._request('appointments/status.php', {
                method: 'POST',
                body
            });
            if (res.success && res.data && res.data.appointment) {
                const appt = res.data.appointment;
                this._syncAppointmentCache(appt);
                if (status === 'Confirmed') {
                    this.createNotification(
                        appt.patientId,
                        'appointment',
                        'Appointment Confirmed',
                        `Your appointment with ${appt.doctorName || appt.doctorId} on ${appt.date} is confirmed.`,
                        'book-appointment.html?tab=my'
                    );
                }
                return { success: true, message: res.message || 'Status updated.', appointment: appt };
            }
            return { success: false, message: res.message || 'Failed to update status.' };
        }

        let appts = this.getAll('appointments');
        const idx = appts.findIndex(a => a.id === id);
        if (idx === -1) return { success: false, message: 'Not found.' };
        const current = appts[idx].status;
        if (current === 'Cancelled' || current === 'Completed') return { success: false, message: `Cannot change status from ${current}.` };
        
        appts[idx].status = status; appts[idx].updatedAt = new Date().toISOString();
        localStorage.setItem('primecare_appointments', JSON.stringify(appts));
        
        if (status === 'Confirmed') {
            const doc = await this.getDoctorById(appts[idx].doctorId);
            this.createNotification(appts[idx].patientId, 'appointment', 'Appointment Confirmed', `Your appointment with ${doc.name} on ${appts[idx].date} is confirmed.`, 'book-appointment.html?tab=my');
        }
        return { success: true, message: 'Status updated.' };
    },

    // ==========================================
    // 6. CLINICAL (STAFF SIDE)
    // ==========================================
    getMedicalRecords: async function(filters) {
        let records = this.getAll('medicalRecords');
        const patients = await this._getPatientsListForMockJoin();
        const doctors = await this._getDoctorsListForMockJoin();

        if (filters.patientId) records = records.filter(r => r.patientId === filters.patientId);
        if (filters.doctorId) records = records.filter(r => r.attendingDoctorId === filters.doctorId);
        if (filters.dateFrom) records = records.filter(r => r.createdAt.split('T')[0] >= filters.dateFrom);
        if (filters.dateTo) records = records.filter(r => r.createdAt.split('T')[0] <= filters.dateTo);

        records = records.map(r => {
            const p = patients.find(x => x.id === r.patientId);
            const d = doctors.find(x => x.id === r.attendingDoctorId);
            return { ...r, patientName: p ? p.fullName : 'Unknown', doctorName: d ? d.name : 'Unknown' };
        });

        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            records = records.filter(r => r.id.toLowerCase().includes(kw) || r.patientName.toLowerCase().includes(kw) || (r.diagnosis && r.diagnosis.toLowerCase().includes(kw)));
        }
        return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    getMedicalRecordById: async function(id) { return this.getById('medicalRecords', id); },
    getPatientMedicalHistory: async function(patientId) { return await this.getMedicalRecords({ patientId }); },
    saveMedicalRecord: async function(record) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'doctor' && user.role !== 'admin')) {
            return { success: false, message: 'Unauthorized. Only doctors or admins can update diagnoses and treatments.' };
        }
        if (!record.diagnosis || !record.treatmentNotes) {
            return { success: false, message: 'Diagnosis and treatment notes are required.' };
        }

        let existing = this.getById('medicalRecords', record.id);
        const now = new Date().toISOString();
        
        if (existing) {
            existing.history = existing.history || [];
            existing.history.push({ updatedBy: user.fullName, updatedAt: now, summary: 'Record updated.' });
            existing = { ...existing, ...record, updatedAt: now };
            this.save('medicalRecords', existing, 'M');
            return { success: true, message: 'Medical record updated successfully.', record: existing };
        } else {
            record.createdBy = user.id;
            record.createdAt = now;
            record.updatedAt = now;
            record.history = [];
            const saved = this.save('medicalRecords', record, 'M');
            return { success: true, message: 'Medical record created successfully.', record: saved };
        }
    },
    saveVitals: async function(patientId, vitals) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'nurse' && user.role !== 'doctor' && user.role !== 'admin')) {
            return { success: false, message: 'Unauthorized to record vitals.' };
        }

        if (vitals.bp && !/^\d{2,3}\/\d{2,3}$/.test(vitals.bp)) return { success: false, message: 'BP must be in format SYS/DIA (e.g., 120/80).' };
        if (vitals.temperature && (vitals.temperature < 30 || vitals.temperature > 45)) return { success: false, message: 'Temperature out of realistic range (30-45 °C).' };
        if (vitals.heartRate && (vitals.heartRate < 20 || vitals.heartRate > 250)) return { success: false, message: 'Heart rate out of realistic range (20-250 bpm).' };
        if (vitals.spo2 && (vitals.spo2 < 50 || vitals.spo2 > 100)) return { success: false, message: 'SpO2 out of realistic range (50-100%).' };

        const todayStr = new Date().toLocaleDateString('en-CA');
        let records = this.getAll('medicalRecords').filter(r => r.patientId === patientId && r.createdAt.startsWith(todayStr));
        
        if (records.length > 0) {
            let latest = records[records.length - 1];
            latest.vitals = { ...latest.vitals, ...vitals };
            latest.updatedAt = new Date().toISOString();
            latest.history.push({ updatedBy: user.fullName, updatedAt: latest.updatedAt, summary: 'Vitals updated.' });
            this.save('medicalRecords', latest, 'M');
        } else {
            const newRecord = {
                patientId: patientId, chiefComplaint: 'Vitals check', vitals: vitals, diagnosis: '', treatmentNotes: '',
                followUpDate: null, appointmentId: null, attendingDoctorId: null, createdBy: user.id,
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: []
            };
            this.save('medicalRecords', newRecord, 'M');
        }
        return { success: true, message: 'Vitals recorded successfully.' };
    },
    getPrescriptions: async function(filters) {
        let rxs = this.getAll('prescriptions');
        const patients = await this._getPatientsListForMockJoin();
        const doctors = await this._getDoctorsListForMockJoin();

        if (filters.patientId) rxs = rxs.filter(r => r.patientId === filters.patientId);
        if (filters.doctorId && filters.doctorId !== 'All') rxs = rxs.filter(r => r.doctorId === filters.doctorId);
        if (filters.status && filters.status !== 'All') rxs = rxs.filter(r => r.status === filters.status);

        rxs = rxs.map(r => {
            const p = patients.find(x => x.id === r.patientId);
            const d = doctors.find(x => x.id === r.doctorId);
            return { ...r, patientName: p ? p.fullName : 'Unknown', doctorName: d ? d.name : 'Unknown' };
        });

        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            rxs = rxs.filter(r => r.id.toLowerCase().includes(kw) || r.patientName.toLowerCase().includes(kw) || r.items.some(i => i.medicine.toLowerCase().includes(kw)));
        }
        return rxs.sort((a, b) => b.date.localeCompare(a.date));
    },
    getPrescriptionById: async function(id) { return this.getById('prescriptions', id); },
    checkAllergyConflict: async function(patientId, items) {
        const p = await this.getPatientById(patientId);
        if (!p || !p.allergies || p.allergies.toLowerCase() === 'none') return [];
        
        const allergies = p.allergies.toLowerCase().split(',').map(s => s.trim());
        const conflicts = [];
        items.forEach(item => {
            const med = item.medicine.toLowerCase();
            if (allergies.some(a => med.includes(a) || a.includes(med))) {
                conflicts.push(item.medicine);
            }
        });
        return conflicts;
    },
    createPrescription: async function(rx) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'doctor' && user.role !== 'admin')) return { success: false, message: 'Unauthorized.' };
        if (!rx.items || rx.items.length === 0) return { success: false, message: 'At least one medicine is required.' };

        if (!rx.overrideAllergy) {
            const conflicts = await this.checkAllergyConflict(rx.patientId, rx.items);
            if (conflicts.length > 0) {
                return { success: false, allergyConflict: true, conflicts: conflicts, message: 'Allergy conflict detected.' };
            }
        } else if (rx.overrideAllergy && (!rx.overrideReason || rx.overrideReason.length < 10)) {
            return { success: false, message: 'Override reason must be at least 10 characters.' };
        }

        if (rx.overrideAllergy) this.logActivity('Allergy Override', `Overrode allergy for patient ${rx.patientId}. Reason: ${rx.overrideReason}`);
        rx.status = 'Active'; rx.date = new Date().toLocaleDateString('en-CA');
        const saved = this.save('prescriptions', rx, 'RX');
        return { success: true, message: 'Prescription created successfully.', prescription: saved };
    },
    updatePrescriptionStatus: async function(id, status) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'nurse' && user.role !== 'admin' && user.role !== 'doctor')) return { success: false, message: 'Unauthorized.' };
        
        let rxs = this.getAll('prescriptions');
        const idx = rxs.findIndex(r => r.id === id);
        if (idx === -1) return { success: false, message: 'Prescription not found.' };
        
        if (rxs[idx].status !== 'Active') return { success: false, message: `Cannot change status from ${rxs[idx].status}.` };
        
        rxs[idx].status = status;
        localStorage.setItem('primecare_prescriptions', JSON.stringify(rxs));
        return { success: true, message: `Prescription marked as ${status}.` };
    },
    getLabResults: async function(filters) {
        let labs = this.getAll('labResults');
        const patients = await this._getPatientsListForMockJoin();

        if (filters.patientId) labs = labs.filter(l => l.patientId === filters.patientId);
        if (filters.status && filters.status !== 'All') labs = labs.filter(l => l.status === filters.status);
        if (filters.flag && filters.flag !== 'All') labs = labs.filter(l => l.flag === filters.flag);
        if (filters.category && filters.category !== 'All') labs = labs.filter(l => l.category === filters.category);
        if (filters.dateFrom) labs = labs.filter(l => l.orderedDate >= filters.dateFrom);
        if (filters.dateTo) labs = labs.filter(l => l.orderedDate <= filters.dateTo);

        labs = labs.map(l => {
            const p = patients.find(x => x.id === l.patientId);
            return { ...l, patientName: p ? p.fullName : 'Unknown' };
        });

        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            labs = labs.filter(l => l.id.toLowerCase().includes(kw) || l.patientName.toLowerCase().includes(kw) || l.testName.toLowerCase().includes(kw));
        }
        return labs.sort((a, b) => b.orderedDate.localeCompare(a.orderedDate));
    },
    getLabResultById: async function(id) { return this.getById('labResults', id); },
    getCriticalLabResults: async function(limit = 5) { return (await this.getLabResults({ flag: 'Critical' })).slice(0, limit); },
    orderLabTest: async function(data) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'doctor' && user.role !== 'admin')) return { success: false, message: 'Unauthorized.' };
        
        const doctors = await this._getDoctorsListForMockJoin();
        const docId = user.role === 'doctor' ? doctors.find(d => d.userId === user.id)?.id : null;
        
        const lab = {
            patientId: data.patientId, orderedBy: docId, testName: data.testName, category: data.category,
            status: 'Ordered', result: null, unit: null, referenceRange: null, flag: null, attachmentName: null,
            orderedDate: new Date().toLocaleDateString('en-CA'), resultDate: null, performedBy: null
        };
        const saved = this.save('labResults', lab, 'LAB');
        return { success: true, message: 'Lab test ordered successfully.', lab: saved };
    },
    saveLabResult: async function(id, data) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'nurse' && user.role !== 'doctor' && user.role !== 'admin')) return { success: false, message: 'Unauthorized.' };

        let labs = this.getAll('labResults');
        const idx = labs.findIndex(l => l.id === id);
        if (idx === -1) return { success: false, message: 'Lab test not found.' };

        let flag = data.flag || 'Normal';
        if (data.referenceRange && data.referenceRange.min !== '' && data.referenceRange.max !== '') {
            const val = parseFloat(data.result);
            if (!isNaN(val)) {
                const min = parseFloat(data.referenceRange.min); const max = parseFloat(data.referenceRange.max);
                const critThreshold = (max - min) * 0.3;
                if (val >= min && val <= max) flag = 'Normal';
                else if (val < min - critThreshold || val > max + critThreshold) flag = 'Critical';
                else flag = 'Abnormal';
            }
        }

        labs[idx] = { ...labs[idx], result: data.result, unit: data.unit, referenceRange: data.referenceRange, flag: flag, attachmentName: data.attachmentName, status: 'Completed', resultDate: new Date().toLocaleDateString('en-CA'), performedBy: user.fullName };
        localStorage.setItem('primecare_labResults', JSON.stringify(labs));
        
        this.createNotification(labs[idx].patientId, 'lab', 'Lab Results Ready', `Your results for ${labs[idx].testName} are now available.`, 'my-records.html?tab=labs');
        return { success: true, message: 'Lab result saved successfully.' };
    },
    getWards: async function() { return this.getAll('wards'); },
    getBeds: async function(filters) {
        let beds = this.getAll('beds');
        if (filters && filters.wardId && filters.wardId !== 'All') beds = beds.filter(b => b.wardId === filters.wardId);
        if (filters && filters.status && filters.status !== 'All') beds = beds.filter(b => b.status === filters.status);
        return beds;
    },
    getWardOccupancy: async function() {
        const wards = this.getAll('wards');
        const beds = this.getAll('beds');
        return wards.map(w => {
            const wBeds = beds.filter(b => b.wardId === w.id);
            const occupied = wBeds.filter(b => b.status === 'Occupied').length;
            const total = wBeds.length;
            return { id: w.id, name: w.name, type: w.type, total: total, occupied: occupied, percent: total === 0 ? 0 : Math.round((occupied / total) * 100) };
        });
    },
    getAdmissions: async function(filters) {
        let adms = this.getAll('admissions');
        const patients = await this._getPatientsListForMockJoin();
        const doctors = await this._getDoctorsListForMockJoin();
        const beds = this.getAll('beds');
        const wards = this.getAll('wards');

        if (filters && filters.status && filters.status !== 'All') adms = adms.filter(a => a.status === filters.status);

        return adms.map(a => {
            const p = patients.find(x => x.id === a.patientId);
            const d = doctors.find(x => x.id === a.attendingDoctorId);
            const b = beds.find(x => x.id === a.bedId);
            const w = b ? wards.find(x => x.id === b.wardId) : null;
            return {
                ...a, patientName: p ? p.fullName : 'Unknown', doctorName: d ? d.name : 'Unknown',
                bedName: b ? b.bedNumber : 'Unknown', wardName: w ? w.name : 'Unknown'
            };
        }).sort((a, b) => b.admitDate.localeCompare(a.admitDate));
    },
    admitPatient: async function(data) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'admin' && user.role !== 'nurse')) return { success: false, message: 'Unauthorized.' };

        const patient = await this.getPatientById(data.patientId);
        if (!patient) return { success: false, message: 'Patient not found.' };
        if (patient.status !== 'verified') return { success: false, message: 'Only verified patients can be admitted.' };
        if (patient.admitType === 'Inpatient') return { success: false, message: 'Patient is already admitted.' };

        let beds = this.getAll('beds');
        const bIdx = beds.findIndex(b => b.id === data.bedId);
        if (bIdx === -1 || beds[bIdx].status !== 'Available') return { success: false, message: 'Bed is not available.' };

        const ward = this.getById('wards', beds[bIdx].wardId);

        beds[bIdx].status = 'Occupied';
        beds[bIdx].currentPatientId = data.patientId;
        localStorage.setItem('primecare_beds', JSON.stringify(beds));

        const adm = {
            patientId: data.patientId, bedId: data.bedId, attendingDoctorId: data.attendingDoctorId,
            admitDate: new Date().toLocaleDateString('en-CA'), dischargeDate: null,
            dailyRate: ward ? ward.dailyRate : 0, dischargeSummary: null, status: 'Admitted'
        };
        this.save('admissions', adm, 'ADM');

        await this.updatePatient(data.patientId, { admitType: 'Inpatient', ward: ward.name, bedNumber: beds[bIdx].bedNumber, assignedDoctorId: data.attendingDoctorId });

        return { success: true, message: 'Patient admitted successfully.' };
    },
    transferPatient: async function(admissionId, newBedId) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'admin' && user.role !== 'nurse')) return { success: false, message: 'Unauthorized.' };

        let adms = this.getAll('admissions');
        const aIdx = adms.findIndex(a => a.id === admissionId);
        if (aIdx === -1 || adms[aIdx].status !== 'Admitted') return { success: false, message: 'Active admission not found.' };

        let beds = this.getAll('beds');
        const newBIdx = beds.findIndex(b => b.id === newBedId);
        if (newBIdx === -1 || beds[newBIdx].status !== 'Available') return { success: false, message: 'New bed is not available.' };

        const oldBIdx = beds.findIndex(b => b.id === adms[aIdx].bedId);
        if (oldBIdx !== -1) { beds[oldBIdx].status = 'Available'; beds[oldBIdx].currentPatientId = null; }
        
        beds[newBIdx].status = 'Occupied';
        beds[newBIdx].currentPatientId = adms[aIdx].patientId;
        localStorage.setItem('primecare_beds', JSON.stringify(beds));

        adms[aIdx].bedId = newBedId;
        const ward = this.getById('wards', beds[newBIdx].wardId);
        if (ward) adms[aIdx].dailyRate = ward.dailyRate;
        localStorage.setItem('primecare_admissions', JSON.stringify(adms));

        await this.updatePatient(adms[aIdx].patientId, { ward: ward ? ward.name : '', bedNumber: beds[newBIdx].bedNumber });

        return { success: true, message: 'Patient transferred successfully.' };
    },
    dischargePatient: async function(admissionId, summary) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'admin' && user.role !== 'nurse' && user.role !== 'doctor')) return { success: false, message: 'Unauthorized.' };
        if (!summary || summary.length < 10) return { success: false, message: 'Discharge summary must be at least 10 characters.' };

        let adms = this.getAll('admissions');
        const aIdx = adms.findIndex(a => a.id === admissionId);
        if (aIdx === -1 || adms[aIdx].status !== 'Admitted') return { success: false, message: 'Active admission not found.' };

        let beds = this.getAll('beds');
        const bIdx = beds.findIndex(b => b.id === adms[aIdx].bedId);
        if (bIdx !== -1) {
            beds[bIdx].status = 'Available';
            beds[bIdx].currentPatientId = null;
            localStorage.setItem('primecare_beds', JSON.stringify(beds));
        }

        adms[aIdx].status = 'Discharged';
        adms[aIdx].dischargeDate = new Date().toLocaleDateString('en-CA');
        adms[aIdx].dischargeSummary = summary;
        localStorage.setItem('primecare_admissions', JSON.stringify(adms));

        await this.updatePatient(adms[aIdx].patientId, { admitType: 'Outpatient', ward: '', bedNumber: '' });

        return { success: true, message: 'Patient discharged successfully.' };
    },
    setBedStatus: async function(bedId, status) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'admin' && user.role !== 'nurse')) return { success: false, message: 'Unauthorized.' };
        if (status !== 'Available' && status !== 'Maintenance') return { success: false, message: 'Invalid status.' };

        let beds = this.getAll('beds');
        const bIdx = beds.findIndex(b => b.id === bedId);
        if (bIdx === -1) return { success: false, message: 'Bed not found.' };
        if (beds[bIdx].status === 'Occupied') return { success: false, message: 'Cannot change status of an occupied bed.' };

        beds[bIdx].status = status;
        localStorage.setItem('primecare_beds', JSON.stringify(beds));
        return { success: true, message: `Bed status set to ${status}.` };
    },

    // ==========================================
    // 7. BILLING & REPORTS (STAFF SIDE)
    // ==========================================
    getBills: async function(filters) {
        let bills = this.getAll('bills');
        const patients = await this._getPatientsListForMockJoin();
        if (filters.patientId) bills = bills.filter(b => b.patientId === filters.patientId);
        if (filters.status && filters.status !== 'All') bills = bills.filter(b => b.status === filters.status);
        if (filters.dateFrom) bills = bills.filter(b => b.createdAt.split('T')[0] >= filters.dateFrom);
        if (filters.dateTo) bills = bills.filter(b => b.createdAt.split('T')[0] <= filters.dateTo);
        
        bills = bills.map(b => {
            const p = patients.find(x => x.id === b.patientId);
            return { ...b, patientName: p ? p.fullName : 'Unknown' };
        });

        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            bills = bills.filter(b => b.id.toLowerCase().includes(kw) || b.patientName.toLowerCase().includes(kw));
        }
        return bills.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    getBillById: async function(id) { return this.getById('bills', id); },
    previewBillCharges: async function(patientId) {
        const items = [];
        this.getAll('admissions').filter(a => a.patientId === patientId && !a.billed).forEach(a => {
            const bed = this.getById('beds', a.bedId);
            const ward = bed ? this.getById('wards', bed.wardId) : null;
            const rate = ward ? ward.dailyRate : a.dailyRate;
            const end = a.dischargeDate ? new Date(a.dischargeDate) : new Date();
            const start = new Date(a.admitDate);
            let days = Math.floor((end - start) / (1000 * 60 * 60 * 24));
            if (days < 1) days = 1;
            items.push({ type: 'Room', description: `Room Charge (${ward ? ward.name : 'Unknown'}) - ${days} days`, qty: days, unitPrice: rate, amount: days * rate, sourceType: 'admissions', sourceId: a.id });
        });
        const appts = await this._getAppointmentsListForMockJoin();
        const doctors = await this._getDoctorsListForMockJoin();
        appts.filter(a => a.patientId === patientId && a.status === 'Completed' && !a.billed).forEach(a => {
            const doc = doctors.find(d => d.id === a.doctorId) || this.getById('doctors', a.doctorId);
            const docName = a.doctorName || (doc ? doc.name : 'Unknown Doctor');
            const fee = (a.fee !== undefined && a.fee !== null) ? a.fee : (doc ? doc.consultationFee : 0);
            if (doc || a.doctorName) {
                items.push({ type: 'Professional Fee', description: `Consultation - ${docName}`, qty: 1, unitPrice: fee, amount: fee, sourceType: 'appointments', sourceId: a.id });
            }
        });
        const medPrices = this.getAll('medicinePrices')[0] || {};
        this.getAll('prescriptions').filter(r => r.patientId === patientId && r.status === 'Dispensed' && !r.billed).forEach(r => {
            r.items.forEach(i => {
                const price = medPrices[i.medicine] || 10;
                const qty = i.durationDays ? (i.durationDays * 3) : 1;
                items.push({ type: 'Medication', description: i.medicine, qty: qty, unitPrice: price, amount: qty * price, sourceType: 'prescriptions', sourceId: r.id });
            });
        });
        const labPrices = this.getAll('labPrices')[0] || {};
        this.getAll('labResults').filter(l => l.patientId === patientId && l.status === 'Completed' && !l.billed).forEach(l => {
            const price = labPrices[l.testName] || 500;
            items.push({ type: 'Laboratory', description: l.testName, qty: 1, unitPrice: price, amount: price, sourceType: 'labResults', sourceId: l.id });
        });
        return items;
    },
    createBill: async function(data) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'admin' && user.role !== 'staff')) return { success: false, message: 'Unauthorized.' };
        if (!data.items || data.items.length === 0) return { success: false, message: 'Bill must contain at least one item.' };
        const p = await this.getPatientById(data.patientId);
        if (!p || p.status !== 'verified') return { success: false, message: 'Patient must be verified.' };

        let subtotal = data.items.reduce((sum, i) => sum + i.amount, 0);
        let discount = 0;
        if (data.discountType === 'Senior Citizen' || data.discountType === 'PWD') discount = Math.round((subtotal * 0.20) * 100) / 100;
        let afterDiscount = subtotal - discount;
        let insurance = parseFloat(data.insuranceCoverage) || 0;
        if (insurance > afterDiscount) insurance = afterDiscount;
        let total = Math.round((afterDiscount - insurance) * 100) / 100;

        let counters = this.getAll('counters')[0] || { bill: 1, receipt: 1 };
        const billId = `B-${counters.bill.toString().padStart(3, '0')}`;
        counters.bill++;
        localStorage.setItem('primecare_counters', JSON.stringify([counters]));

        const bill = {
            id: billId, patientId: data.patientId, admissionId: null, items: data.items,
            subtotal, discountType: data.discountType, discountAmount: discount,
            insuranceProvider: data.insuranceProvider || '', insuranceCoverage: insurance,
            total, amountPaid: 0, balance: total, status: 'Unpaid', voidReason: null,
            createdBy: user.id, createdAt: new Date().toISOString(), payments: []
        };

        let bills = this.getAll('bills'); bills.push(bill);
        localStorage.setItem('primecare_bills', JSON.stringify(bills));

        data.items.forEach(i => {
            if (i.sourceType && i.sourceId) {
                let records = this.getAll(i.sourceType);
                let idx = records.findIndex(r => r.id === i.sourceId);
                if (idx !== -1) { records[idx].billed = true; records[idx].billId = billId; localStorage.setItem(`primecare_${i.sourceType}`, JSON.stringify(records)); }
            }
        });

        this.logActivity('Create Bill', `Created bill ${billId} for patient ${data.patientId}`);
        this.createNotification(data.patientId, 'bill', 'New Bill Generated', `A new bill (${billId}) for ₱${total} has been generated.`, 'my-bills.html');
        return { success: true, message: 'Bill created successfully.', bill: bill };
    },
    addBillItem: async function(billId, item) {
        let bills = this.getAll('bills');
        const idx = bills.findIndex(b => b.id === billId);
        if (idx === -1 || bills[idx].status !== 'Unpaid' || bills[idx].payments.length > 0) return { success: false, message: 'Cannot modify this bill.' };
        
        bills[idx].items.push(item);
        bills[idx].subtotal = bills[idx].items.reduce((sum, i) => sum + i.amount, 0);
        if (bills[idx].discountType === 'Senior Citizen' || bills[idx].discountType === 'PWD') bills[idx].discountAmount = Math.round((bills[idx].subtotal * 0.20) * 100) / 100;
        let afterDiscount = bills[idx].subtotal - bills[idx].discountAmount;
        if (bills[idx].insuranceCoverage > afterDiscount) bills[idx].insuranceCoverage = afterDiscount;
        bills[idx].total = Math.round((afterDiscount - bills[idx].insuranceCoverage) * 100) / 100;
        bills[idx].balance = bills[idx].total;
        
        localStorage.setItem('primecare_bills', JSON.stringify(bills));
        return { success: true, message: 'Item added.' };
    },
    removeBillItem: async function(billId, itemIndex) {
        let bills = this.getAll('bills');
        const idx = bills.findIndex(b => b.id === billId);
        if (idx === -1 || bills[idx].status !== 'Unpaid' || bills[idx].payments.length > 0) return { success: false, message: 'Cannot modify this bill.' };
        
        bills[idx].items.splice(itemIndex, 1);
        bills[idx].subtotal = bills[idx].items.reduce((sum, i) => sum + i.amount, 0);
        if (bills[idx].discountType === 'Senior Citizen' || bills[idx].discountType === 'PWD') bills[idx].discountAmount = Math.round((bills[idx].subtotal * 0.20) * 100) / 100;
        let afterDiscount = bills[idx].subtotal - bills[idx].discountAmount;
        if (bills[idx].insuranceCoverage > afterDiscount) bills[idx].insuranceCoverage = afterDiscount;
        bills[idx].total = Math.round((afterDiscount - bills[idx].insuranceCoverage) * 100) / 100;
        bills[idx].balance = bills[idx].total;
        
        localStorage.setItem('primecare_bills', JSON.stringify(bills));
        return { success: true, message: 'Item removed.' };
    },
    recordPayment: async function(billId, data) {
        const user = await this.getCurrentUser();
        if (!user || (user.role !== 'admin' && user.role !== 'staff' && user.role !== 'patient')) return { success: false, message: 'Unauthorized.' };
        
        let bills = this.getAll('bills');
        const idx = bills.findIndex(b => b.id === billId);
        if (idx === -1) return { success: false, message: 'Bill not found.' };
        
        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount <= 0) return { success: false, message: 'Invalid amount.' };
        if (amount > bills[idx].balance) return { success: false, message: 'Payment exceeds balance.' };
        if (['Credit/Debit Card', 'GCash', 'Bank Transfer'].includes(data.method) && !data.reference) return { success: false, message: 'Reference number required for this method.' };

        let counters = this.getAll('counters')[0] || { bill: 1, receipt: 1 };
        const receiptNo = `R-${counters.receipt.toString().padStart(4, '0')}`;
        counters.receipt++;
        localStorage.setItem('primecare_counters', JSON.stringify([counters]));

        const payment = { receiptNo, amount, method: data.method, reference: data.reference || '', paidAt: new Date().toISOString(), receivedBy: user.role === 'patient' ? 'Online Payment' : user.fullName };
        bills[idx].payments.push(payment);
        bills[idx].amountPaid = Math.round((bills[idx].amountPaid + amount) * 100) / 100;
        bills[idx].balance = Math.round((bills[idx].total - bills[idx].amountPaid) * 100) / 100;
        bills[idx].status = bills[idx].balance <= 0 ? 'Paid' : 'Partial';

        localStorage.setItem('primecare_bills', JSON.stringify(bills));
        if (user.role !== 'patient') this.logActivity('Record Payment', `Recorded payment ${receiptNo} for bill ${billId}`);
        
        this.createNotification(bills[idx].patientId, 'bill', 'Payment Received', `Payment of ₱${amount} received for Bill ${billId}.`, 'my-bills.html');
        return { success: true, message: 'Payment recorded successfully.', receipt: payment, bill: bills[idx] };
    },
    voidBill: async function(id, reason) {
        const user = await this.getCurrentUser();
        if (!user || user.role !== 'admin') return { success: false, message: 'Only admins can void bills.' };
        if (!reason || reason.length < 10) return { success: false, message: 'Reason must be at least 10 characters.' };

        let bills = this.getAll('bills');
        const idx = bills.findIndex(b => b.id === id);
        if (idx === -1) return { success: false, message: 'Bill not found.' };
        if (bills[idx].payments.length > 0) return { success: false, message: 'Cannot void a bill with existing payments.' };

        bills[idx].status = 'Voided';
        bills[idx].voidReason = reason;
        localStorage.setItem('primecare_bills', JSON.stringify(bills));

        bills[idx].items.forEach(i => {
            if (i.sourceType && i.sourceId) {
                let records = this.getAll(i.sourceType);
                let rIdx = records.findIndex(r => r.id === i.sourceId);
                if (rIdx !== -1) {
                    records[rIdx].billed = false;
                    records[rIdx].billId = null;
                    localStorage.setItem(`primecare_${i.sourceType}`, JSON.stringify(records));
                }
            }
        });

        this.logActivity('Void Bill', `Voided bill ${id}. Reason: ${reason}`);
        return { success: true, message: 'Bill voided successfully.' };
    },
    getReceipt: async function(receiptNo) {
        const bills = this.getAll('bills');
        for (let b of bills) {
            const p = b.payments.find(x => x.receiptNo === receiptNo);
            if (p) return { receipt: p, bill: b };
        }
        return null;
    },
    getBillingSummary: async function() {
        const bills = this.getAll('bills');
        let unpaidTotal = 0, collectedToday = 0, collectedMonth = 0;
        const todayStr = new Date().toLocaleDateString('en-CA');
        const monthStr = todayStr.substring(0, 7);

        bills.forEach(b => {
            if (b.status === 'Unpaid' || b.status === 'Partial') unpaidTotal += b.balance;
            b.payments.forEach(p => {
                const pDate = p.paidAt.split('T')[0];
                if (pDate === todayStr) collectedToday += p.amount;
                if (pDate.startsWith(monthStr)) collectedMonth += p.amount;
            });
        });

        return {
            unpaidTotal, collectedToday, collectedMonth,
            countUnpaid: bills.filter(b => b.status === 'Unpaid').length,
            countPartial: bills.filter(b => b.status === 'Partial').length,
            countPaid: bills.filter(b => b.status === 'Paid').length
        };
    },
    generateReport: async function(type, filters) {
        const user = await this.getCurrentUser();
        if (!user || user.role !== 'admin') return { success: false, message: 'Unauthorized.' };

        const { dateFrom, dateTo } = filters;
        let columns = [], rows = [], summary = {}, chartData = [];

        if (type === 'daily-admissions') {
            columns = ['Date', 'Patient ID', 'Patient Name', 'Ward', 'Doctor'];
            const adms = this.getAll('admissions').filter(a => a.admitDate >= dateFrom && a.admitDate <= dateTo);
            const patients = await this._getPatientsListForMockJoin(); const doctors = await this._getDoctorsListForMockJoin(); const beds = this.getAll('beds'); const wards = this.getAll('wards');
            
            let dailyCounts = {};
            adms.forEach(a => {
                const p = patients.find(x => x.id === a.patientId);
                const d = doctors.find(x => x.id === a.attendingDoctorId);
                const b = beds.find(x => x.id === a.bedId);
                const w = b ? wards.find(x => x.id === b.wardId) : null;
                rows.push([a.admitDate, a.patientId, p ? p.fullName : 'Unknown', w ? w.name : 'Unknown', d ? d.name : 'Unknown']);
                dailyCounts[a.admitDate] = (dailyCounts[a.admitDate] || 0) + 1;
            });
            summary = { 'Total Admissions': adms.length };
            chartData = Object.keys(dailyCounts).sort().map(date => ({ label: date, value: dailyCounts[date] }));
        }
        else if (type === 'appointments-summary') {
            columns = ['Date', 'Doctor', 'Type', 'Status', 'Count'];
            const allAppts = await this._getAppointmentsListForMockJoin();
            const appts = allAppts.filter(a => a.date >= dateFrom && a.date <= dateTo);
            const doctors = await this._getDoctorsListForMockJoin();
            let statusCounts = { Confirmed: 0, Completed: 0, Cancelled: 0, Pending: 0 };
            
            appts.forEach(a => {
                const d = doctors.find(x => x.id === a.doctorId);
                rows.push([a.date, a.doctorName || (d ? d.name : 'Unknown'), a.type, a.status, 1]);
                if (statusCounts[a.status] !== undefined) statusCounts[a.status]++;
            });
            summary = { 'Total Appointments': appts.length, 'Completed': statusCounts.Completed, 'Cancelled': statusCounts.Cancelled };
            chartData = Object.keys(statusCounts).map(k => ({ label: k, value: statusCounts[k] }));
        }
        else if (type === 'revenue') {
            columns = ['Date', 'Receipt No', 'Bill ID', 'Method', 'Amount'];
            const bills = this.getAll('bills');
            let totalRev = 0; let methodCounts = {};
            
            bills.forEach(b => {
                b.payments.forEach(p => {
                    const pDate = p.paidAt.split('T')[0];
                    if (pDate >= dateFrom && pDate <= dateTo) {
                        rows.push([pDate, p.receiptNo, b.id, p.method, p.amount]);
                        totalRev += p.amount;
                        methodCounts[p.method] = (methodCounts[p.method] || 0) + p.amount;
                    }
                });
            });
            summary = { 'Total Revenue Collected': totalRev };
            chartData = Object.keys(methodCounts).map(k => ({ label: k, value: methodCounts[k] }));
        }
        else if (type === 'doctor-workload') {
            columns = ['Doctor', 'Completed Appointments', 'Medical Records Written', 'Prescriptions Issued'];
            const docs = await this._getDoctorsListForMockJoin();
            const allAppts = await this._getAppointmentsListForMockJoin();
            const appts = allAppts.filter(a => a.date >= dateFrom && a.date <= dateTo && a.status === 'Completed');
            const records = this.getAll('medicalRecords').filter(r => r.createdAt.split('T')[0] >= dateFrom && r.createdAt.split('T')[0] <= dateTo);
            const rxs = this.getAll('prescriptions').filter(r => r.date >= dateFrom && r.date <= dateTo);
            
            docs.forEach(d => {
                const aCount = appts.filter(a => a.doctorId === d.id).length;
                const rCount = records.filter(r => r.attendingDoctorId === d.id).length;
                const rxCount = rxs.filter(r => r.doctorId === d.id).length;
                if (aCount > 0 || rCount > 0 || rxCount > 0) {
                    rows.push([d.name, aCount, rCount, rxCount]);
                    chartData.push({ label: d.name, value: aCount });
                }
            });
            summary = { 'Active Doctors in Period': rows.length };
        }
        else if (type === 'bed-occupancy') {
            columns = ['Ward', 'Total Beds', 'Occupied', 'Occupancy %'];
            const wards = await this.getWardOccupancy();
            wards.forEach(w => {
                rows.push([w.name, w.total, w.occupied, `${w.percent}%`]);
                chartData.push({ label: w.name, value: w.percent });
            });
            summary = { 'Overall Occupancy': Math.round((wards.reduce((sum, w) => sum + w.occupied, 0) / wards.reduce((sum, w) => sum + w.total, 0)) * 100) + '%' };
        }
        else if (type === 'lab-summary') {
            columns = ['Category', 'Test Name', 'Normal', 'Abnormal', 'Critical', 'Total'];
            const labs = this.getAll('labResults').filter(l => l.orderedDate >= dateFrom && l.orderedDate <= dateTo && l.status === 'Completed');
            let grouped = {};
            labs.forEach(l => {
                const key = `${l.category}|${l.testName}`;
                if (!grouped[key]) grouped[key] = { Normal: 0, Abnormal: 0, Critical: 0, Total: 0 };
                if (l.flag) grouped[key][l.flag]++;
                grouped[key].Total++;
            });
            for (const key in grouped) {
                const [cat, test] = key.split('|');
                rows.push([cat, test, grouped[key].Normal, grouped[key].Abnormal, grouped[key].Critical, grouped[key].Total]);
            }
            summary = { 'Total Tests Completed': labs.length, 'Critical Findings': labs.filter(l => l.flag === 'Critical').length };
        }
        else if (type === 'registrations') {
            columns = ['Date', 'Patient ID', 'Name', 'Type', 'Status'];
            const allPatients = await this._getPatientsListForMockJoin();
            const patients = allPatients.filter(p => p.createdAt >= dateFrom && p.createdAt <= dateTo);
            let statusCounts = { pending: 0, verified: 0, rejected: 0 };
            patients.forEach(p => {
                rows.push([p.createdAt, p.id, p.fullName, p.admitType, p.status]);
                if (statusCounts[p.status] !== undefined) statusCounts[p.status]++;
            });
            summary = { 'Total Registrations': patients.length, 'Verified': statusCounts.verified, 'Pending': statusCounts.pending };
            chartData = Object.keys(statusCounts).map(k => ({ label: k.toUpperCase(), value: statusCounts[k] }));
        }
        else {
            return { success: false, message: 'Invalid report type.' };
        }

        this.logActivity('Generate Report', `Generated ${type} report from ${dateFrom} to ${dateTo}`);
        return { success: true, columns, rows, summary, chartData };
    },

    // ==========================================
    // 8. PATIENT PORTAL (PATIENT SIDE)
    // ==========================================

    _getPatientContext: async function(requireWrite = false) {
        const user = await this.getCurrentUser();
        if (!user) return { error: 'Not logged in' };
        if (user.role !== 'patient') {
            if (requireWrite) return { error: 'Preview mode: actions are disabled.' };
            if (this._backendConfig.modules.patients) {
                const res = await this._request('patients/get.php', { method: 'GET', params: { me: 1 } });
                if (res.success && res.data && res.data.patient) {
                    this._syncPatientCache(res.data.patient);
                    return { patient: res.data.patient, previewMode: true };
                }
            }
            const demoPatient = this.getAll('patients').find(p => p.id === 'P-001');
            return { patient: demoPatient, previewMode: true };
        }
        if (this._backendConfig.modules.patients) {
            const res = await this._request('patients/get.php', { method: 'GET', params: { me: 1 } });
            if (res.success && res.data && res.data.patient) {
                this._syncPatientCache(res.data.patient);
                return { patient: res.data.patient, previewMode: false };
            }
            if (res.status === 404) {
                return { error: 'No linked patient record found. Please visit the hospital to register.' };
            }
        }
        const patient = this.getAll('patients').find(p => p.userId === user.id);
        if (!patient) return { error: 'No linked patient record found. Please visit the hospital to register.' };
        return { patient, previewMode: false };
    },

    getMyPatient: async function() {
        const ctx = await this._getPatientContext();
        return ctx.error ? null : ctx.patient;
    },

    getMyDashboard: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return null;
        const pid = ctx.patient.id;
        const todayStr = new Date().toLocaleDateString('en-CA');
        
        let appts = [];
        if (this._backendConfig.modules.appointments) {
            appts = await this.getMyAppointments({ scope: 'upcoming' });
        } else {
            appts = this.getAll('appointments').filter(a => a.patientId === pid && a.date >= todayStr && a.status !== 'Cancelled' && a.status !== 'Completed').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        }

        const labs = this.getAll('labResults').filter(l => l.patientId === pid && l.status === 'Completed').sort((a, b) => b.resultDate.localeCompare(a.resultDate)).slice(0, 3);
        const bills = this.getAll('bills').filter(b => b.patientId === pid && (b.status === 'Unpaid' || b.status === 'Partial'));
        const notifs = this.getAll('notifications').filter(n => n.patientId === pid).sort((a, b) => b.date.localeCompare(a.date));

        const nextAppt = appts.length > 0 ? { ...appts[0], doctorName: appts[0].doctorName || (await this.getDoctorById(appts[0].doctorId))?.name } : null;
        const unpaidTotal = bills.reduce((sum, b) => sum + b.balance, 0);

        return {
            nextAppointment: nextAppt,
            upcomingCount: appts.length,
            latestLabs: labs,
            unpaidBalance: unpaidTotal,
            unreadNotifs: notifs.filter(n => !n.read).length,
            recentNotifs: notifs.slice(0, 3)
        };
    },

    getMyAppointments: async function(filters = {}) {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];

        if (this._backendConfig.modules.appointments) {
            const params = { my: 1 };
            if (filters && filters.scope) params.scope = filters.scope;
            if (filters && filters.type) params.type = filters.type;
            if (filters && filters.status) params.status = filters.status;
            const res = await this._request('appointments/list.php', { method: 'GET', params });
            if (res.success && res.data && Array.isArray(res.data.appointments)) {
                this._syncAppointmentCache(res.data.appointments);
                return res.data.appointments;
            }
            return [];
        }

        const todayStr = new Date().toLocaleDateString('en-CA');
        let appts = this.getAll('appointments').filter(a => a.patientId === ctx.patient.id);
        
        if (filters.scope === 'upcoming') appts = appts.filter(a => a.date >= todayStr && a.status !== 'Cancelled' && a.status !== 'Completed');
        else if (filters.scope === 'past') appts = appts.filter(a => a.date < todayStr || a.status === 'Completed');
        else if (filters.scope === 'cancelled') appts = appts.filter(a => a.status === 'Cancelled');

        const doctors = await this._getDoctorsListForMockJoin();
        return appts.map(a => {
            const d = doctors.find(x => x.id === a.doctorId);
            return { ...a, doctorName: d ? d.name : 'Unknown', specialization: d ? d.specialization : '', fee: d ? d.consultationFee : 0 };
        }).sort((a, b) => filters.scope === 'upcoming' ? (a.date + a.time).localeCompare(b.date + b.time) : (b.date + b.time).localeCompare(a.date + a.time));
    },

    bookMyAppointment: async function(data) {
        const ctx = await this._getPatientContext(true);
        if (ctx.error) return { success: false, message: ctx.error };

        if (this._backendConfig.modules.appointments) {
            const res = await this._request('appointments/create.php', {
                method: 'POST',
                body: { ...data, patientId: ctx.patient.id }
            });
            if (res.success && res.data && res.data.appointment) {
                const appt = res.data.appointment;
                this._syncAppointmentCache(appt);
                this.createNotification(
                    ctx.patient.id,
                    'appointment',
                    'Appointment Request Submitted',
                    `Your request for ${appt.date} at ${appt.time} with ${appt.doctorName || appt.doctorId} is pending staff confirmation.`,
                    'book-appointment.html?tab=my'
                );
                return { success: true, message: res.message || 'Appointment request submitted and is pending confirmation.', appointment: appt };
            }
            return { success: false, message: res.message || 'Failed to submit appointment request.' };
        }

        if (ctx.patient.status !== 'verified') return { success: false, message: 'Only verified patients can book appointments. Your account is pending verification by hospital staff.' };
        if (!data.reason || data.reason.length < 10) return { success: false, message: 'Reason for visit must be at least 10 characters.' };

        const todayStr = new Date().toLocaleDateString('en-CA');
        const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 60);
        const maxDateStr = maxDate.toLocaleDateString('en-CA');
        if (data.date > maxDateStr) return { success: false, message: 'Cannot book more than 60 days in advance.' };

        const activeAppts = this.getAll('appointments').filter(a => a.patientId === ctx.patient.id && a.date >= todayStr && a.status !== 'Cancelled' && a.status !== 'Completed');
        if (activeAppts.length >= 3) return { success: false, message: 'You can only have a maximum of 3 active upcoming appointments.' };

        const res = await this.bookAppointment({ ...data, patientId: ctx.patient.id });
        if (res.success) {
            this.createNotification(ctx.patient.id, 'appointment', 'Appointment Request Submitted', `Your request for ${data.date} is pending staff confirmation.`, 'book-appointment.html?tab=my');
        }
        return res;
    },

    rescheduleMyAppointment: async function(id, newDate, newTime) {
        const ctx = await this._getPatientContext(true);
        if (ctx.error) return { success: false, message: ctx.error };

        if (this._backendConfig.modules.appointments) {
            return await this.rescheduleAppointment(id, newDate, newTime);
        }
        
        const appt = this.getById('appointments', id);
        if (!appt || appt.patientId !== ctx.patient.id) return { success: false, message: 'Appointment not found.' };
        
        const apptDate = new Date(appt.date + 'T' + appt.time);
        if (apptDate - new Date() < 24 * 60 * 60 * 1000) return { success: false, message: 'Cannot reschedule within 24 hours of the appointment.' };

        return await this.rescheduleAppointment(id, newDate, newTime);
    },

    cancelMyAppointment: async function(id, reason) {
        const ctx = await this._getPatientContext(true);
        if (ctx.error) return { success: false, message: ctx.error };

        if (this._backendConfig.modules.appointments) {
            return await this.cancelAppointment(id, reason);
        }

        const appt = this.getById('appointments', id);
        if (!appt || appt.patientId !== ctx.patient.id) return { success: false, message: 'Appointment not found.' };
        
        const apptDate = new Date(appt.date + 'T' + appt.time);
        if (apptDate - new Date() < 24 * 60 * 60 * 1000) return { success: false, message: 'Cannot cancel within 24 hours of the appointment. Please call the hospital.' };

        return await this.cancelAppointment(id, reason);
    },

    getMyMedicalRecords: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];
        const doctors = await this._getDoctorsListForMockJoin();
        return this.getAll('medicalRecords').filter(r => r.patientId === ctx.patient.id).map(r => {
            const d = doctors.find(x => x.id === r.attendingDoctorId);
            return { id: r.id, date: r.createdAt.split('T')[0], chiefComplaint: r.chiefComplaint, diagnosis: r.diagnosis, treatmentNotes: r.treatmentNotes, followUpDate: r.followUpDate, doctorName: d ? d.name : 'Unknown' };
        }).sort((a, b) => b.date.localeCompare(a.date));
    },

    getMyPrescriptions: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];
        const doctors = await this._getDoctorsListForMockJoin();
        return this.getAll('prescriptions').filter(r => r.patientId === ctx.patient.id).map(r => {
            const d = doctors.find(x => x.id === r.doctorId);
            return { ...r, doctorName: d ? d.name : 'Unknown' };
        }).sort((a, b) => b.date.localeCompare(a.date));
    },

    getMyLabResults: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];
        return this.getAll('labResults').filter(l => l.patientId === ctx.patient.id && l.status === 'Completed').sort((a, b) => b.resultDate.localeCompare(a.resultDate));
    },

    getMyImmunizations: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];
        return this.getAll('immunizations').filter(i => i.patientId === ctx.patient.id).sort((a, b) => b.date.localeCompare(a.date));
    },

    getMyAdmissions: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];
        const doctors = await this._getDoctorsListForMockJoin();
        const wards = this.getAll('wards');
        const beds = this.getAll('beds');
        return this.getAll('admissions').filter(a => a.patientId === ctx.patient.id).map(a => {
            const d = doctors.find(x => x.id === a.attendingDoctorId);
            const b = beds.find(x => x.id === a.bedId);
            const w = b ? wards.find(x => x.id === b.wardId) : null;
            return { ...a, doctorName: d ? d.name : 'Unknown', wardName: w ? w.name : 'Unknown' };
        }).sort((a, b) => b.admitDate.localeCompare(a.admitDate));
    },

    getMyBills: async function(filters) {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];
        let bills = this.getAll('bills').filter(b => b.patientId === ctx.patient.id);
        if (filters && filters.status && filters.status !== 'All') bills = bills.filter(b => b.status === filters.status);
        return bills.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    getMyBillById: async function(id) {
        const ctx = await this._getPatientContext();
        if (ctx.error) return null;
        const b = this.getById('bills', id);
        return (b && b.patientId === ctx.patient.id) ? b : null;
    },

    getMyReceipts: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];
        const bills = this.getAll('bills').filter(b => b.patientId === ctx.patient.id);
        let receipts = [];
        bills.forEach(b => b.payments.forEach(p => receipts.push({ ...p, billId: b.id })));
        return receipts.sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    },

    payMyBill: async function(billId, data) {
        const ctx = await this._getPatientContext(true);
        if (ctx.error) return { success: false, message: ctx.error };

        const b = this.getById('bills', billId);
        if (!b || b.patientId !== ctx.patient.id) return { success: false, message: 'Bill not found.' };

        if (data.method === 'Credit/Debit Card') {
            const cleanCard = data.cardNumber.replace(/\s+/g, '');
            if (cleanCard === '4000000000000002') return { success: false, message: 'Payment declined by bank.' };
            
            let sum = 0; let shouldDouble = false;
            for (let i = cleanCard.length - 1; i >= 0; i--) {
                let digit = parseInt(cleanCard.charAt(i));
                if (shouldDouble) { digit *= 2; if (digit > 9) digit -= 9; }
                sum += digit; shouldDouble = !shouldDouble;
            }
            if (sum % 10 !== 0) return { success: false, message: 'Invalid card number.' };

            const [mm, yy] = data.expiry.split('/');
            const exp = new Date(2000 + parseInt(yy), parseInt(mm), 0);
            if (exp < new Date()) return { success: false, message: 'Card has expired.' };
            
            data.reference = 'CARD-****' + cleanCard.slice(-4);
        } else if (data.method === 'GCash') {
            if (!/^09\d{9}$/.test(data.mobile)) return { success: false, message: 'Invalid GCash mobile number.' };
            data.reference = 'GCASH-' + data.mobile.slice(-4);
        }

        return await this.recordPayment(billId, data);
    },

    requestPaymentPlan: async function(billId, months, reason) {
        const ctx = await this._getPatientContext(true);
        if (ctx.error) return { success: false, message: ctx.error };
        if (months < 2 || months > 12) return { success: false, message: 'Months must be between 2 and 12.' };
        if (!reason || reason.length < 10) return { success: false, message: 'Reason must be at least 10 characters.' };

        const b = this.getById('bills', billId);
        if (!b || b.patientId !== ctx.patient.id || b.balance <= 0) return { success: false, message: 'Invalid bill.' };

        let plans = this.getAll('paymentPlanRequests');
        if (plans.some(p => p.billId === billId && p.status === 'Pending')) return { success: false, message: 'A request is already pending for this bill.' };

        plans.push({ id: `PLAN-${Date.now()}`, billId, patientId: ctx.patient.id, months, reason, status: 'Pending', createdAt: new Date().toISOString() });
        localStorage.setItem('primecare_paymentPlanRequests', JSON.stringify(plans));
        return { success: true, message: 'Payment plan request submitted.' };
    },

    getMyInsuranceInfo: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return null;
        const bills = this.getAll('bills').filter(b => b.patientId === ctx.patient.id && b.insuranceCoverage > 0);
        return { provider: ctx.patient.insuranceProvider, number: ctx.patient.insuranceNumber, claims: bills.map(b => ({ billId: b.id, date: b.createdAt.split('T')[0], amount: b.insuranceCoverage })) };
    },

    getMyTelehealthAppointments: async function() {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];

        if (this._backendConfig.modules.appointments) {
            const res = await this._request('appointments/list.php', {
                method: 'GET',
                params: { my: 1, scope: 'upcoming', type: 'telehealth' }
            });
            if (res.success && res.data && Array.isArray(res.data.appointments)) {
                this._syncAppointmentCache(res.data.appointments);
                return res.data.appointments;
            }
            return [];
        }

        const todayStr = new Date().toLocaleDateString('en-CA');
        const doctors = await this._getDoctorsListForMockJoin();
        return this.getAll('appointments').filter(a => a.patientId === ctx.patient.id && a.type === 'telehealth' && a.date >= todayStr && (a.status === 'Confirmed' || a.status === 'Pending')).map(a => {
            const d = doctors.find(x => x.id === a.doctorId);
            return { ...a, doctorName: d ? d.name : 'Unknown' };
        }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    },

    submitPreVisitForm: async function(appointmentId, form) {
        const ctx = await this._getPatientContext(true);
        if (ctx.error) return { success: false, message: ctx.error };

        if (this._backendConfig.modules.appointments) {
            const res = await this._request('appointments/pre-visit.php', {
                method: 'POST',
                body: { appointmentId, ...form }
            });
            if (res.success && res.data) {
                if (res.data.appointment) {
                    this._syncAppointmentCache(res.data.appointment);
                } else if (res.data.form) {
                    const cachedAppt = this.getById('appointments', appointmentId);
                    if (cachedAppt) {
                        this._syncAppointmentCache({ ...cachedAppt, preVisitForm: res.data.form });
                    }
                }
                return {
                    success: true,
                    message: res.message || 'Pre-visit form submitted.',
                    form: res.data.form || null,
                    canJoin: res.data.canJoin || null
                };
            }
            return { success: false, message: res.message || 'Failed to submit pre-visit form.' };
        }

        if (!form.symptoms || form.symptoms.length < 5) return { success: false, message: 'Please describe your symptoms.' };
        if (!form.consent) return { success: false, message: 'You must consent to the telehealth session.' };

        let forms = this.getAll('preVisitForms');
        const idx = forms.findIndex(f => f.appointmentId === appointmentId);
        const data = { id: `PVF-${Date.now()}`, appointmentId, ...form, submittedAt: new Date().toISOString() };
        if (idx !== -1) forms[idx] = data; else forms.push(data);
        localStorage.setItem('primecare_preVisitForms', JSON.stringify(forms));
        return { success: true, message: 'Pre-visit form submitted.' };
    },

    getPreVisitForm: async function(appointmentId) {
        if (!appointmentId) return undefined;
        if (this._backendConfig.modules.appointments) {
            const res = await this._request('appointments/pre-visit.php', {
                method: 'GET',
                params: { appointmentId }
            });
            if (res.success && res.data) {
                if (res.data.form) {
                    let forms = this.getAll('preVisitForms');
                    const idx = forms.findIndex(f => f.appointmentId === appointmentId);
                    if (idx !== -1) forms[idx] = res.data.form; else forms.push(res.data.form);
                    localStorage.setItem('primecare_preVisitForms', JSON.stringify(forms));
                    return res.data.form;
                }
                return undefined;
            }
            return undefined;
        }
        return this.getAll('preVisitForms').find(f => f.appointmentId === appointmentId);
    },

    canJoinTelehealth: async function(appointmentId) {
        const ctx = await this._getPatientContext();
        if (ctx.error) return { allowed: false, reason: ctx.error };

        if (this._backendConfig.modules.appointments) {
            const res = await this._request('appointments/pre-visit.php', {
                method: 'GET',
                params: { appointmentId }
            });
            if (res.success && res.data && res.data.canJoin) {
                return res.data.canJoin;
            }
            return { allowed: false, reason: res.message || 'Appointment not found.' };
        }

        const appt = this.getById('appointments', appointmentId);
        if (!appt || appt.patientId !== ctx.patient.id) return { allowed: false, reason: 'Appointment not found.' };
        if (appt.status !== 'Confirmed') return { allowed: false, reason: 'Appointment is not confirmed yet.' };

        const form = await this.getPreVisitForm(appointmentId);
        if (!form) return { allowed: false, reason: 'Pre-visit questionnaire not submitted.' };

        const apptDate = new Date(appt.date + 'T' + appt.time);
        const now = new Date();
        const diffMins = (apptDate - now) / (1000 * 60);

        if (diffMins > 15) return { allowed: false, reason: `Join window opens 15 minutes before.`, minutesUntil: Math.ceil(diffMins - 15) };
        if (diffMins < -30) return { allowed: false, reason: 'Appointment time has passed.' };

        return { allowed: true };
    },

    getMyNotifications: async function(filters) {
        const ctx = await this._getPatientContext();
        if (ctx.error) return [];
        let notifs = this.getAll('notifications').filter(n => n.patientId === ctx.patient.id);
        if (filters && filters.unreadOnly) notifs = notifs.filter(n => !n.read);
        return notifs.sort((a, b) => b.date.localeCompare(a.date));
    },
    markNotificationRead: async function(id) {
        let notifs = this.getAll('notifications');
        const idx = notifs.findIndex(n => n.id === id);
        if (idx !== -1) { notifs[idx].read = true; localStorage.setItem('primecare_notifications', JSON.stringify(notifs)); }
    },
    markAllNotificationsRead: async function() {
        const ctx = await this._getPatientContext(true);
        if (ctx.error) return;
        let notifs = this.getAll('notifications');
        notifs.forEach(n => { if (n.patientId === ctx.patient.id) n.read = true; });
        localStorage.setItem('primecare_notifications', JSON.stringify(notifs));
    },

    updateMyContact: async function(data) {
        const ctx = await this._getPatientContext(true);
        if (ctx.error) return { success: false, message: ctx.error };

        if (!/^09\d{9}$/.test(data.mobile)) return { success: false, message: 'Invalid mobile format.' };
        if (await this.isMobileTaken(data.mobile, ctx.patient.id)) return { success: false, message: 'Mobile is already registered.' };
        if (data.email && await this.isEmailTaken(data.email, ctx.patient.id)) return { success: false, message: 'Email is already registered.' };

        const changes = {
            mobile: data.mobile,
            email: data.email,
            street: data.street,
            brgy: data.brgy,
            barangay: data.brgy,
            city: data.city,
            province: data.province,
            address: `${data.street}, ${data.brgy}, ${data.city}, ${data.province}`,
            emergencyContactName: data.emergencyContactName,
            emergencyContactNumber: data.emergencyContactNumber,
            emergencyContactRelationship: data.emergencyContactRelationship
        };
        return await this.updatePatient(ctx.patient.id, changes);
    },
    
    getPatientProfile: async function() {
        const ctx = await this._getPatientContext();
        return ctx.error ? null : ctx.patient;
    }
};

