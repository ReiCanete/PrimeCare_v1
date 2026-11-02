let state = {
    keyword: '',
    status: 'All',
    admitType: 'All',
    sortBy: 'dateAdmitted',
    sortDir: 'desc',
    page: 1,
    limit: 10,
    currentPatientId: null
};

document.addEventListener('DOMContentLoaded', async () => {
    // Read URL param for pending filter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('filter') === 'pending') state.status = 'pending';

    await initUI();
    await renderTable();
});

window.addEventListener('primecare:rolechange', async () => {
    await initUI();
    await renderTable();
});

async function initUI() {
    const user = await api.getCurrentUser();
    const isAdminStaff = user && (user.role === 'admin' || user.role === 'staff');
    const isAdmin = user && user.role === 'admin';

    document.querySelectorAll('.admin-staff-only').forEach(el => el.style.display = isAdminStaff ? '' : 'none');
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');

    // Populate Edit Ward Dropdown
    const wardSelect = document.getElementById('e-ward');
    wardSelect.innerHTML = '<option value="">None</option>';
    const wards = await api.getWards();
    wards.forEach(w => wardSelect.add(new Option(w.name, w.name)));

    // Search Debounce
    const searchBox = document.getElementById('search-box');
    let timeout = null;
    searchBox.addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            state.keyword = e.target.value;
            state.page = 1;
            await renderTable();
        }, 300);
    });

    document.getElementById('filter-type').addEventListener('change', async (e) => {
        state.admitType = e.target.value;
        state.page = 1;
        await renderTable();
    });

    document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);
    
    // Age display logic for edit form
    document.getElementById('birthdate')?.addEventListener('change', (e) => {
        const display = document.getElementById('age-display');
        if(!display) return;
        const dateVal = e.target.value;
        if (dateVal) {
            const age = utils.calcAge(dateVal);
            if (new Date(dateVal) > new Date()) {
                display.style.display = 'block';
                display.style.color = 'var(--color-danger)';
                display.innerText = 'Invalid future date';
            } else {
                display.style.display = 'block';
                display.style.color = 'var(--color-text-muted)';
                display.innerText = `Age: ${age}`;
            }
        } else {
            display.style.display = 'none';
        }
    });
}

window.resetFilters = async function() {
    state.keyword = '';
    state.status = 'All';
    state.admitType = 'All';
    state.page = 1;
    document.getElementById('search-box').value = '';
    document.getElementById('filter-type').value = 'All';
    await renderTable();
};

window.setStatusFilter = async function(status) {
    state.status = status;
    state.page = 1;
    await renderTable();
};

window.setSort = async function(col) {
    if (state.sortBy === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortBy = col;
        state.sortDir = 'asc';
    }
    await renderTable();
};

window.setPage = async function(p) {
    state.page = p;
    await renderTable();
};

async function renderTable() {
    const allPatients = await api.searchPatients({ keyword: '', status: 'All', admitType: 'All' });
    
    document.getElementById('count-all').innerText = allPatients.length;
    document.getElementById('count-pending').innerText = allPatients.filter(p => p.status === 'pending').length;
    document.getElementById('count-verified').innerText = allPatients.filter(p => p.status === 'verified').length;
    document.getElementById('count-rejected').innerText = allPatients.filter(p => p.status === 'rejected').length;

    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    const activeChip = document.querySelector(`.chip[onclick="setStatusFilter('${state.status}')"]`);
    if(activeChip) activeChip.classList.add('active');

    const filtered = await api.searchPatients(state);
    
    document.querySelectorAll('th.sortable').forEach(th => th.classList.remove('asc', 'desc'));
    const activeTh = document.querySelector(`th[onclick="setSort('${state.sortBy}')"]`);
    if (activeTh) activeTh.classList.add(state.sortDir);

    const totalPages = Math.ceil(filtered.length / state.limit);
    if (state.page > totalPages && totalPages > 0) state.page = totalPages;
    
    const start = (state.page - 1) * state.limit;
    const paginated = filtered.slice(start, start + state.limit);

    const tbody = document.getElementById('table-body');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No patients found.</td></tr>`;
    } else {
        const user = await api.getCurrentUser();
        const canEdit = user.role === 'admin' || user.role === 'staff';

        tbody.innerHTML = paginated.map(p => {
            let badge = 'success';
            if (p.status === 'pending') badge = 'warning';
            if (p.status === 'rejected') badge = 'danger';

            return `
            <tr>
                <td><strong>${p.id}</strong></td>
                <td>${utils.escapeHTML(p.fullName)}</td>
                <td>${utils.calcAge(p.birthdate)} / ${p.sex[0]}</td>
                <td><span class="badge badge-neutral">${p.admitType}</span></td>
                <td>${utils.formatDate(p.dateAdmitted)}</td>
                <td><span class="badge badge-${badge}">${p.status}</span></td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-outline" onclick="viewPatient('${p.id}')">View</button>
                    ${canEdit ? `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem;" onclick="editPatient('${p.id}')">Edit</button>` : ''}
                </td>
            </tr>`;
        }).join('');
    }

    let pageHTML = '';
    for (let i = 1; i <= totalPages; i++) {
        pageHTML += `<button class="page-btn ${i === state.page ? 'active' : ''}" onclick="setPage(${i})">${i}</button>`;
    }
    document.getElementById('pagination').innerHTML = pageHTML;
}

async function renderTable() {
    const allPatients = await api.searchPatients({ keyword: '', status: 'All', admitType: 'All' });
    
    document.getElementById('count-all').innerText = allPatients.length;
    document.getElementById('count-pending').innerText = allPatients.filter(p => p.status === 'pending').length;
    document.getElementById('count-verified').innerText = allPatients.filter(p => p.status === 'verified').length;
    document.getElementById('count-rejected').innerText = allPatients.filter(p => p.status === 'rejected').length;

    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    const activeChip = document.querySelector(`.chip[onclick="setStatusFilter('${state.status}')"]`);
    if(activeChip) activeChip.classList.add('active');

    const filtered = await api.searchPatients(state);
    
    document.querySelectorAll('th.sortable').forEach(th => th.classList.remove('asc', 'desc'));
    const activeTh = document.querySelector(`th[onclick="setSort('${state.sortBy}')"]`);
    if (activeTh) activeTh.classList.add(state.sortDir);

    const totalPages = Math.ceil(filtered.length / state.limit);
    if (state.page > totalPages && totalPages > 0) state.page = totalPages;
    
    const start = (state.page - 1) * state.limit;
    const paginated = filtered.slice(start, start + state.limit);

    const tbody = document.getElementById('table-body');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No patients found.</td></tr>`;
    } else {
        const user = await api.getCurrentUser();
        const canEdit = user.role === 'admin' || user.role === 'staff';

        tbody.innerHTML = paginated.map(p => {
            let badge = 'success';
            if (p.status === 'pending') badge = 'warning';
            if (p.status === 'rejected') badge = 'danger';

            return `
            <tr>
                <td><strong>${p.id}</strong></td>
                <td>${utils.escapeHTML(p.fullName)}</td>
                <td>${utils.calcAge(p.birthdate)} / ${p.sex[0]}</td>
                <td><span class="badge badge-neutral">${p.admitType}</span></td>
                <td>${utils.formatDate(p.dateAdmitted)}</td>
                <td><span class="badge badge-${badge}">${p.status}</span></td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-outline" onclick="viewPatient('${p.id}')">View</button>
                    ${canEdit ? `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem;" onclick="editPatient('${p.id}')">Edit</button>` : ''}
                </td>
            </tr>`;
        }).join('');
    }

    let pageHTML = '';
    for (let i = 1; i <= totalPages; i++) {
        pageHTML += `<button class="page-btn ${i === state.page ? 'active' : ''}" onclick="setPage(${i})">${i}</button>`;
    }
    document.getElementById('pagination').innerHTML = pageHTML;
}

window.viewPatient = async function(id) {
    state.currentPatientId = id;
    const data = await api.getPatientSummary(id);
    if (!data) return;

    document.getElementById('v-name').innerText = data.fullName;
    document.getElementById('v-id').innerText = data.id;
    
    let badge = 'success';
    if (data.status === 'pending') badge = 'warning';
    if (data.status === 'rejected') badge = 'danger';
    document.getElementById('v-status').innerHTML = `<span class="badge badge-${badge}">${data.status.toUpperCase()}</span>`;
    
    document.getElementById('v-dob').innerText = utils.formatDate(data.birthdate);
    document.getElementById('v-sex').innerText = data.sex;
    document.getElementById('v-civil').innerText = data.civilStatus || 'N/A';
    document.getElementById('v-blood').innerText = data.bloodType || 'N/A';
    document.getElementById('v-address').innerText = utils.escapeHTML(data.address);
    document.getElementById('v-mobile').innerText = data.mobile;
    document.getElementById('v-email').innerText = data.email || 'N/A';
    document.getElementById('v-idtype').innerText = data.idType || 'N/A';
    document.getElementById('v-idnum').innerText = utils.escapeHTML(data.idNumber) || 'N/A';
    
    document.getElementById('v-emname').innerText = utils.escapeHTML(data.emergencyContactName);
    document.getElementById('v-emrel').innerText = utils.escapeHTML(data.emergencyContactRelationship);
    document.getElementById('v-emnum').innerText = data.emergencyContactNumber;

    document.getElementById('v-admit').innerText = data.admitType;
    document.getElementById('v-date').innerText = utils.formatDate(data.dateAdmitted);
    document.getElementById('v-ward').innerText = data.ward ? `${data.ward} (Bed ${data.bedNumber})` : 'N/A';
    
    const doc = await api.getDoctorById(data.assignedDoctorId);
    document.getElementById('v-doc').innerText = doc ? utils.formatDoctorName(doc.name) : 'N/A';

    let audit = `Registered: ${utils.formatDate(data.createdAt)}`;
    if (data.status === 'verified') audit += ` | Verified by: ${data.verifiedBy} on ${utils.formatDate(data.verifiedAt)}`;
    if (data.status === 'rejected') audit += ` | Rejected Reason: ${utils.escapeHTML(data.rejectionReason)}`;
    document.getElementById('v-audit').innerText = audit;

    const user = await api.getCurrentUser();
    const isAdminStaff = user && (user.role === 'admin' || user.role === 'staff');
    
    // Fix: Replaced inline styles with btn-success class
    if (data.status === 'pending' && isAdminStaff) {
        document.getElementById('v-action-bar').style.display = 'flex';
        document.getElementById('v-action-bar').innerHTML = `
            <div><strong>Pending Verification</strong><br><span style="font-size: var(--fs-xs);">Review details and verify to allow portal access.</span></div>
            <div style="display: flex; gap: 8px;">
                <button class="btn btn-danger" onclick="promptReject()">Reject</button>
                <button class="btn btn-success" onclick="confirmVerify()">Verify Patient</button>
            </div>
        `;
    } else {
        document.getElementById('v-action-bar').style.display = 'none';
    }
    document.getElementById('v-reject-box').style.display = 'none';

    document.getElementById('v-appts-list').innerHTML = data.appointments.length ? data.appointments.map(a => `<div class="list-item"><div><strong>${utils.formatDate(a.date)} ${utils.formatTime(a.time)}</strong><br><span style="font-size:var(--fs-xs); color:var(--color-text-muted);">${a.type}</span></div><span class="badge badge-info">${a.status}</span></div>`).join('') : '<div style="color:var(--color-text-muted);">No appointments.</div>';
    document.getElementById('v-records-list').innerHTML = data.medicalRecords.length ? data.medicalRecords.map(r => `<div class="list-item"><div><strong>${utils.formatDate(r.date || r.createdAt.split('T')[0])}</strong><br><span style="font-size:var(--fs-sm);">${utils.escapeHTML(r.diagnosis)}</span></div></div>`).join('') : '<div style="color:var(--color-text-muted);">No medical records.</div>';
    document.getElementById('v-bills-list').innerHTML = data.bills.length ? data.bills.map(b => `<div class="list-item"><div><strong>${utils.formatDate(b.date || b.createdAt.split('T')[0])}</strong><br><span style="font-size:var(--fs-sm);">Total: ${utils.formatCurrency(b.items.reduce((sum,i)=>sum+i.amount,0))}</span></div><span class="badge badge-${b.status==='Paid'?'success':'danger'}">${b.status}</span></div>`).join('') : '<div style="color:var(--color-text-muted);">No bills.</div>';

    switchTab('profile');
    utils.openModal('view-modal');
};

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    const activeTab = document.getElementById(`tab-${tab}`);
    if(activeTab) activeTab.classList.add('active');
};

// --- VERIFY / REJECT ---
window.confirmVerify = async function() {
    if (confirm('Are you sure you want to verify this patient? They will be granted access to the patient portal.')) {
        const res = await api.verifyPatient(state.currentPatientId);
        if (res.success) {
            utils.showToast(res.message, 'success');
            utils.closeModal('view-modal');
            await renderTable();
        } else {
             utils.showToast(res.message, 'danger');
        }
    }
};

window.promptReject = function() {
    document.getElementById('v-reject-box').style.display = 'block';
    document.getElementById('v-reject-reason').value = '';
};

window.submitReject = async function() {
    const reason = document.getElementById('v-reject-reason').value.trim();
    if (reason.length < 10) return utils.showToast('Please provide a reason of at least 10 characters.', 'warning');
    
    const res = await api.rejectPatient(state.currentPatientId, reason);
    if (res.success) {
        utils.showToast(res.message, 'success');
        utils.closeModal('view-modal');
        await renderTable();
    } else {
         utils.showToast(res.message, 'danger');
    }
};

// --- EDIT MODAL ---
window.editPatient = async function(id) {
    const p = await api.getPatientById(id);
    if (!p) return;
    document.getElementById('e-id').value = p.id;
    document.getElementById('e-firstName').value = p.firstName;
    document.getElementById('e-lastName').value = p.lastName;
    document.getElementById('e-mobile').value = p.mobile;
    document.getElementById('e-email').value = p.email || '';
    document.getElementById('e-address').value = p.address;
    document.getElementById('e-admitType').value = p.admitType;
    document.getElementById('e-ward').value = p.ward || '';
    
    utils.openModal('edit-modal');
};

async function handleEditSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('e-id').value;
    const mobile = document.getElementById('e-mobile').value;
    const email = document.getElementById('e-email').value;

    if (!/^09\d{9}$/.test(mobile)) return utils.showAlert('edit-alert-container', 'danger', 'Invalid mobile format.');
    if (await api.isMobileTaken(mobile, id)) return utils.showAlert('edit-alert-container', 'danger', 'Mobile is already in use.');
    if (email && await api.isEmailTaken(email, id)) return utils.showAlert('edit-alert-container', 'danger', 'Email is already in use.');

    const changes = {
        firstName: document.getElementById('e-firstName').value,
        lastName: document.getElementById('e-lastName').value,
        mobile: mobile,
        email: email,
        address: document.getElementById('e-address').value,
        admitType: document.getElementById('e-admitType').value,
        ward: document.getElementById('e-ward').value
    };

    const res = await api.updatePatient(id, changes);
    if (res.success) {
        utils.closeModal('edit-modal');
        utils.showToast(res.message, 'success');
        await renderTable();
    } else {
         utils.showAlert('edit-alert-container', 'danger', res.message);
    }
}

// --- DELETE ---
window.promptDelete = async function() {
    const p = await api.getPatientById(state.currentPatientId);
    const confirmId = prompt(`WARNING: Deletion is permanent.\nType the Patient ID (${p.id}) to confirm deletion:`);
    if (confirmId === p.id) {
        const res = await api.deletePatient(p.id);
        if (res.success) {
            utils.showToast(res.message, 'success');
            utils.closeModal('view-modal');
            await renderTable();
        } else {
            utils.showToast(res.message, 'danger');
        }
    } else if (confirmId !== null) {
        utils.showToast('ID did not match. Deletion cancelled.', 'info');
    }
};