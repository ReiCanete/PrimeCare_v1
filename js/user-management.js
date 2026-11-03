
let uState = { keyword: '', role: 'All', status: 'All', page: 1, limit: 10 };
let lState = { keyword: '', dateFrom: '', dateTo: '', page: 1, limit: 15 };

document.addEventListener('DOMContentLoaded', async () => {
    if (await checkAccess()) { await initUI(); await renderUsersTable(); await renderLogsTable(); }
});

window.addEventListener('primecare:rolechange', async () => {
    if (await checkAccess()) { await initUI(); await renderUsersTable(); await renderLogsTable(); }
});

async function checkAccess() {
    const user = await api.getCurrentUser();
    if (!user || user.role !== 'admin') {
        document.getElementById('access-denied').style.display = 'block';
        document.getElementById('users-module').style.display = 'none';
        return false;
    }
    document.getElementById('access-denied').style.display = 'none';
    document.getElementById('users-module').style.display = 'block';
    return true;
}

async function initUI() {
    // Populate unlinked doctors for the dropdown
    const docSelect = document.getElementById('um-doctor');
    docSelect.innerHTML = '<option value="">Select Doctor Profile...</option>';
    const doctors = await api.getDoctors();
    doctors.filter(d => !d.userId).forEach(d => docSelect.add(new Option(utils.formatDoctorName(d.name), d.id)));

    // Debounce searches
    let uTimeout = null;
    document.getElementById('u-search').addEventListener('input', (e) => {
        clearTimeout(uTimeout); uTimeout = setTimeout(async () => { uState.keyword = e.target.value; uState.page = 1; await renderUsersTable(); }, 300);
    });
    document.getElementById('u-role').addEventListener('change', async (e) => { uState.role = e.target.value; uState.page = 1; await renderUsersTable(); });
    document.getElementById('u-status').addEventListener('change', async (e) => { uState.status = e.target.value; uState.page = 1; await renderUsersTable(); });

    let lTimeout = null;
    document.getElementById('l-search').addEventListener('input', (e) => {
        clearTimeout(lTimeout); lTimeout = setTimeout(async () => { lState.keyword = e.target.value; lState.page = 1; await renderLogsTable(); }, 300);
    });
    document.getElementById('l-from').addEventListener('change', async (e) => { lState.dateFrom = e.target.value; lState.page = 1; await renderLogsTable(); });
    document.getElementById('l-to').addEventListener('change', async (e) => { lState.dateTo = e.target.value; lState.page = 1; await renderLogsTable(); });
}

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    const activeTab = document.getElementById(`tab-${tab}`);
    if(activeTab) activeTab.classList.add('active');
};

// --- USERS TAB ---
window.setUserChipFilter = async function(type, val = null) {
    if (type === 'all') {
        uState.role = 'All';
        uState.status = 'All';
    } else if (type === 'role') {
        uState.role = val;
        uState.status = 'All';
    } else if (type === 'status') {
        uState.role = 'All';
        uState.status = val;
    }
    uState.page = 1;

    // Sync dropdown controls
    const roleSelect = document.getElementById('u-role');
    const statusSelect = document.getElementById('u-status');
    if (roleSelect) roleSelect.value = uState.role;
    if (statusSelect) statusSelect.value = uState.status;

    await renderUsersTable();
};

window.resetUserFilters = async function() {
    uState.keyword = ''; uState.role = 'All'; uState.status = 'All'; uState.page = 1;
    document.getElementById('u-search').value = '';
    document.getElementById('u-role').value = 'All';
    document.getElementById('u-status').value = 'All';
    await renderUsersTable();
};

window.setUPage = async function(p) { uState.page = p; await renderUsersTable(); };

async function renderUsersTable() {
    // Update active chip state to reflect current filters
    document.querySelectorAll('#user-chips .chip').forEach(c => c.classList.remove('active'));
    let activeSelector = '#user-chips .chip[data-chip="all"]';
    if (uState.role !== 'All' && uState.status === 'All') {
        activeSelector = `#user-chips .chip[data-chip="role:${uState.role}"]`;
    } else if (uState.status === 'inactive' && uState.role === 'All') {
        activeSelector = '#user-chips .chip[data-chip="status:inactive"]';
    }
    const matchedChip = document.querySelector(activeSelector);
    if (matchedChip) matchedChip.classList.add('active');

    const users = await api.getUsers(uState);
    const allUsers = await api.getUsers({ keyword: '', role: 'All', status: 'All' });

    document.getElementById('c-tot').innerText = allUsers.length;
    document.getElementById('c-adm').innerText = allUsers.filter(u => u.role === 'admin').length;
    document.getElementById('c-doc').innerText = allUsers.filter(u => u.role === 'doctor').length;
    document.getElementById('c-nur').innerText = allUsers.filter(u => u.role === 'nurse').length;
    document.getElementById('c-sta').innerText = allUsers.filter(u => u.role === 'staff').length;
    document.getElementById('c-pat').innerText = allUsers.filter(u => u.role === 'patient').length;
    document.getElementById('c-ina').innerText = allUsers.filter(u => u.status === 'inactive').length;

    const totalPages = Math.ceil(users.length / uState.limit);
    if (uState.page > totalPages && totalPages > 0) uState.page = totalPages;
    const paginated = users.slice((uState.page - 1) * uState.limit, uState.page * uState.limit);

    const tbody = document.getElementById('users-tbody');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No users found.</td></tr>`;
    } else {
        const currentUser = await api.getCurrentUser();
        
        tbody.innerHTML = paginated.map(u => {
            let sBadge = 'success';
            if (u.status === 'inactive') sBadge = 'secondary" style="background:var(--color-border);color:var(--color-text-muted);';
            if (u.status === 'pending') sBadge = 'warning';
            if (u.status === 'rejected') sBadge = 'danger';

            let actions = '';
            let roleDisplay = `<span class="role-badge role-${u.role}">${u.role}</span>`;

            if (u.role === 'patient') {
                actions = `<a href="patient-records.html" style="font-size: var(--fs-xs); color: var(--color-accent); text-decoration: none;">Manage in Patient Records &rarr;</a>`;
            } else {
                // Inline Role Dropdown
                const roles = ['admin', 'doctor', 'nurse', 'staff'];
                const roleOpts = roles.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('');
                roleDisplay = `<select class="form-control" style="padding: 0.1rem 0.25rem; font-size: var(--fs-xs); width: auto;" onchange="changeRole('${u.id}', this.value)">${roleOpts}</select>`;

                actions += `<button class="btn btn-sm btn-outline" onclick="openUserModal('${u.id}')">Edit</button>`;
                actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem;" onclick="resetPassword('${u.id}')">Reset PW</button>`;
                
                if (u.id !== currentUser.id) {
                    if (u.status === 'active') {
                        actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-warning); border-color: var(--color-warning);" onclick="toggleStatus('${u.id}', 'inactive')">Deactivate</button>`;
                    } else {
                        actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-success); border-color: var(--color-success);" onclick="toggleStatus('${u.id}', 'active')">Activate</button>`;
                    }
                    actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-danger); border-color: var(--color-danger);" onclick="deleteUser('${u.id}')">Delete</button>`;
                }
            }

            return `
            <tr>
                <td><strong>${utils.escapeHTML(u.username)}</strong><br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${u.id}</span></td>
                <td>${utils.escapeHTML(u.fullName)}<br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${utils.escapeHTML(u.email)}</span></td>
                <td>${roleDisplay}</td>
                <td><span class="badge badge-${sBadge}">${u.status}</span></td>
                <td>${u.lastLogin ? utils.formatDate(u.lastLogin) : '<span style="color:var(--color-text-muted);">Never</span>'}</td>
                <td class="actions-cell">${actions}</td>
            </tr>`;
        }).join('');
    }
    document.getElementById('u-pagination').innerHTML = Array.from({length: totalPages}, (_, i) => `<button class="page-btn ${i+1 === uState.page ? 'active' : ''}" onclick="setUPage(${i+1})">${i+1}</button>`).join('');
}

// --- ADD / EDIT USER ---
window.openUserModal = async function(id = null) {
    clearAllErrors();
    document.getElementById('um-alert').innerHTML = '';
    
    if (id) {
        const u = await api.getUserById(id);
        document.getElementById('um-id').value = u.id;
        document.getElementById('um-name').value = u.fullName;
        document.getElementById('um-username').value = u.username;
        document.getElementById('um-username').disabled = true; // Lock username
        document.getElementById('um-email').value = u.email;
        document.getElementById('um-role').value = u.role;
        document.getElementById('um-status').value = u.status;
        document.getElementById('um-title').innerText = 'Edit User';
    } else {
        document.getElementById('um-id').value = '';
        document.getElementById('um-name').value = '';
        document.getElementById('um-username').value = '';
        document.getElementById('um-username').disabled = false;
        document.getElementById('um-email').value = '';
        document.getElementById('um-role').value = 'staff';
        document.getElementById('um-status').value = 'active';
        document.getElementById('um-title').innerText = 'Add User';
    }
    toggleDoctorLink();
    utils.openModal('user-modal');
};

window.toggleDoctorLink = function() {
    const role = document.getElementById('um-role').value;
    const isNew = !document.getElementById('um-id').value;
    document.getElementById('um-doc-group').style.display = (role === 'doctor' && isNew) ? 'block' : 'none';
};

window.submitUser = async function() {
    clearAllErrors();
    const id = document.getElementById('um-id').value;
    const name = document.getElementById('um-name').value.trim();
    const username = document.getElementById('um-username').value.trim();
    const email = document.getElementById('um-email').value.trim();
    const role = document.getElementById('um-role').value;
    const status = document.getElementById('um-status').value;
    const linkedDoc = document.getElementById('um-doctor').value;

    let valid = true;
    if (!name) { showFieldError('um-name', 'Required'); valid = false; }
    if (!username) { showFieldError('um-username', 'Required'); valid = false; }
    else if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) { showFieldError('um-username', 'Invalid format'); valid = false; }
    if (!email) { showFieldError('um-email', 'Required'); valid = false; }
    if (role === 'doctor' && !id && !linkedDoc) { showFieldError('um-doctor', 'You must link a doctor profile'); valid = false; }

    if (!valid) return utils.showAlert('um-alert', 'danger', 'Please complete all required fields correctly.');

    const data = { id: id || null, fullName: name, username, email, role, status, linkedDoctorId: linkedDoc };
    const res = await api.saveUser(data);

    if (res.success) {
        utils.closeModal('user-modal');
        utils.showToast(res.message, 'success');
        await renderUsersTable();
        if (res.tempPassword) showTempPassword(res.tempPassword);
    } else {
        utils.showAlert('um-alert', 'danger', res.message);
    }
};

window.resetPassword = async function(id) {
    if (confirm('Are you sure you want to reset this user\'s password? They will be forced to change it on next login.')) {
        const res = await api.resetUserPassword(id);
        if (res.success) {
            utils.showToast(res.message, 'success');
            showTempPassword(res.tempPassword);
        } else {
            utils.showToast(res.message, 'danger');
        }
    }
};

window.toggleStatus = async function(id, status) {
    const res = await api.setUserStatus(id, status);
    if (res.success) {
        utils.showToast(res.message, 'success');
        await renderUsersTable();
    } else {
        utils.showToast(res.message, 'danger');
    }
};

window.changeRole = async function(id, role) {
    const res = await api.changeUserRole(id, role);
    if (res.success) {
        utils.showToast(res.message, 'success');
        await renderUsersTable();
    } else {
        utils.showToast(res.message, 'danger');
        await renderUsersTable(); // Re-render to revert the dropdown visually
    }
};

window.deleteUser = async function(id) {
    if (confirm('WARNING: Deletion is permanent. Are you sure you want to delete this user?')) {
        const res = await api.deleteUser(id);
        if (res.success) {
            utils.showToast(res.message, 'success');
            await renderUsersTable();
        } else {
            utils.showToast(res.message, 'danger');
        }
    }
};

window.showTempPassword = function(pw) {
    document.getElementById('tp-display').innerText = pw;
    utils.openModal('temp-pw-modal');
};

window.copyTempPassword = function() {
    const pw = document.getElementById('tp-display').innerText.trim();
    navigator.clipboard.writeText(pw).then(() => {
        utils.showToast('Password copied to clipboard!', 'success');
    });
};

// --- LOGS TAB ---
window.resetLogFilters = async function() {
    lState.keyword = ''; lState.dateFrom = ''; lState.dateTo = ''; lState.page = 1;
    document.getElementById('l-search').value = '';
    document.getElementById('l-from').value = '';
    document.getElementById('l-to').value = '';
    await renderLogsTable();
};

window.setLPage = async function(p) { lState.page = p; await renderLogsTable(); };

async function renderLogsTable() {
    const logs = await api.getAuditLog(lState);
    const totalPages = Math.ceil(logs.length / lState.limit);
    if (lState.page > totalPages && totalPages > 0) lState.page = totalPages;
    const paginated = logs.slice((lState.page - 1) * lState.limit, lState.page * lState.limit);

    const tbody = document.getElementById('logs-tbody');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No activity logs found.</td></tr>`;
    } else {
        tbody.innerHTML = paginated.map(l => `
            <tr>
                <td style="white-space: nowrap; font-size: var(--fs-xs); color: var(--color-text-muted);">${utils.formatDateTime(l.timestamp)}</td>
                <td><strong>${utils.escapeHTML(l.username)}</strong><br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${l.userId}</span></td>
                <td><span class="badge badge-neutral">${utils.escapeHTML(l.action)}</span></td>
                <td style="font-size: var(--fs-sm);">${utils.escapeHTML(l.details)}</td>
            </tr>
        `).join('');
    }
    document.getElementById('l-pagination').innerHTML = Array.from({length: totalPages}, (_, i) => `<button class="page-btn ${i+1 === lState.page ? 'active' : ''}" onclick="setLPage(${i+1})">${i+1}</button>`).join('');
}

// --- VALIDATION HELPERS ---
function showFieldError(id, msg) {
    const el = document.getElementById(id);
    el.classList.add('is-invalid');
    let err = el.nextElementSibling;
    if (!err || !err.classList.contains('error-text')) {
        err = document.createElement('div');
        err.className = 'error-text';
        el.parentNode.insertBefore(err, el.nextSibling);
    }
    err.innerText = msg;
}

function clearAllErrors() {
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    document.querySelectorAll('.error-text').forEach(el => el.remove());
}