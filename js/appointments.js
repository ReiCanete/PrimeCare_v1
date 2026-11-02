let state = { keyword: '', status: 'All', doctorId: 'All', type: 'All', dateFrom: '', dateTo: '', sortBy: 'datetime', sortDir: 'desc', page: 1, limit: 10 };

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('doctor')) state.doctorId = urlParams.get('doctor');
    if (urlParams.get('status')) state.status = urlParams.get('status');
    if (urlParams.get('date') === 'today') {
        const today = new Date().toLocaleDateString('en-CA');
        state.dateFrom = today; state.dateTo = today;
    }

    await initUI();
    await renderTable();
});

window.addEventListener('primecare:rolechange', async () => { await initUI(); await renderTable(); });

async function initUI() {
    const user = await api.getCurrentUser();
    const isAdminStaff = user && (user.role === 'admin' || user.role === 'staff');
    document.querySelectorAll('.admin-staff-only').forEach(el => el.style.display = isAdminStaff ? '' : 'none');

    const docFilter = document.getElementById('filter-doc');
    docFilter.innerHTML = '<option value="All">All Doctors</option>';
    const doctors = await api.getDoctors();
    
    if (user.role === 'doctor') {
        const myDoc = doctors.find(d => d.userId === user.id);
        const myDocId = myDoc ? myDoc.id : 'None';
        
        docFilter.innerHTML = `<option value="${myDocId}">My Appointments</option>`;
        state.doctorId = myDocId;
        docFilter.disabled = true;
    } else {
        doctors.forEach(d => docFilter.add(new Option(utils.formatDoctorName(d.name), d.id)));
        docFilter.value = state.doctorId;
    }

    let timeout = null;
    document.getElementById('search-box').addEventListener('input', (e) => {
        clearTimeout(timeout); timeout = setTimeout(async () => { state.keyword = e.target.value; state.page = 1; await renderTable(); }, 300);
    });
    document.getElementById('filter-doc').addEventListener('change', async (e) => { state.doctorId = e.target.value; state.page = 1; await renderTable(); });
    document.getElementById('filter-type').addEventListener('change', async (e) => { state.type = e.target.value; state.page = 1; await renderTable(); });
    document.getElementById('filter-date').addEventListener('change', async (e) => { state.dateFrom = e.target.value; state.dateTo = e.target.value; state.page = 1; await renderTable(); });

    const pSelect = document.getElementById('b-patient');
    pSelect.innerHTML = '<option value="">Select Patient...</option>';
    const patients = await api.searchPatients({ status: 'verified' });
    patients.forEach(p => pSelect.add(new Option(`${p.fullName} (${p.id})`, p.id)));

    const dSelect = document.getElementById('b-doctor');
    dSelect.innerHTML = '<option value="">Select Doctor...</option>';
    const docGroups = await api.getDoctorsBySpecialization();
    for (const spec in docGroups) {
        const group = document.createElement('optgroup');
        group.label = spec;
        docGroups[spec].forEach(d => group.appendChild(new Option(utils.formatDoctorName(d.name), d.id)));
        dSelect.appendChild(group);
    }

    document.getElementById('b-date').min = new Date().toLocaleDateString('en-CA');
}

window.setDateFilter = async function(range) {
    if (range === 'today') {
        const today = new Date().toLocaleDateString('en-CA');
        state.dateFrom = today; state.dateTo = today;
        document.getElementById('filter-date').value = today;
    }
    state.page = 1; await renderTable();
};

window.resetFilters = async function() {
    state.keyword = ''; state.status = 'All'; state.type = 'All'; state.dateFrom = ''; state.dateTo = ''; state.page = 1;
    document.getElementById('search-box').value = '';
    document.getElementById('filter-type').value = 'All';
    document.getElementById('filter-date').value = '';
    const user = await api.getCurrentUser();
    if (user.role !== 'doctor') { state.doctorId = 'All'; document.getElementById('filter-doc').value = 'All'; }
    await renderTable();
};

window.setStatusFilter = async function(status) { state.status = status; state.page = 1; await renderTable(); };
window.setSort = async function(col) { state.sortDir = (state.sortBy === col && state.sortDir === 'asc') ? 'desc' : 'asc'; state.sortBy = col; await renderTable(); };
window.setPage = async function(p) { state.page = p; await renderTable(); };

async function renderTable() {
    let appts = await api.searchAppointments(state);
    
    const baseState = { ...state, status: 'All' };
    const allAppts = await api.searchAppointments(baseState);
    document.getElementById('c-all').innerText = allAppts.length;
    document.getElementById('c-pen').innerText = allAppts.filter(a => a.status === 'Pending').length;
    document.getElementById('c-con').innerText = allAppts.filter(a => a.status === 'Confirmed').length;
    document.getElementById('c-com').innerText = allAppts.filter(a => a.status === 'Completed').length;
    document.getElementById('c-can').innerText = allAppts.filter(a => a.status === 'Cancelled').length;

    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    const activeChip = document.querySelector(`.chip[onclick="setStatusFilter('${state.status}')"]`);
    if(activeChip) activeChip.classList.add('active');

    document.querySelectorAll('th.sortable').forEach(th => th.classList.remove('asc', 'desc'));
    const activeTh = document.querySelector(`th[onclick="setSort('${state.sortBy}')"]`);
    if (activeTh) activeTh.classList.add(state.sortDir);

    const totalPages = Math.ceil(appts.length / state.limit);
    if (state.page > totalPages && totalPages > 0) state.page = totalPages;
    const paginated = appts.slice((state.page - 1) * state.limit, state.page * state.limit);

    const tbody = document.getElementById('table-body');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No appointments found.</td></tr>`;
    } else {
        const user = await api.getCurrentUser();
        const isAdminStaff = user.role === 'admin' || user.role === 'staff';
        const isDoctor = user.role === 'doctor';

        tbody.innerHTML = paginated.map(a => {
            let badge = 'info';
            if (a.status === 'Confirmed') badge = 'success';
            if (a.status === 'Pending') badge = 'warning';
            if (a.status === 'Cancelled') badge = 'danger';

            let actions = `<button class="btn btn-sm btn-outline" onclick="viewAppt('${a.id}')">View</button>`;
            
            if (isAdminStaff) {
                if (a.status === 'Pending') actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-success); border-color: var(--color-success);" onclick="updateStatus('${a.id}', 'Confirmed')">Confirm</button>`;
                if (a.status === 'Pending' || a.status === 'Confirmed') {
                    actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem;" onclick="openReschedule('${a.id}')">Reschedule</button>`;
                    actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-danger); border-color: var(--color-danger);" onclick="promptCancel('${a.id}')">Cancel</button>`;
                }
            }
            if (isDoctor && a.status === 'Confirmed') {
                actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-success); border-color: var(--color-success);" onclick="updateStatus('${a.id}', 'Completed')">Complete</button>`;
            }

            return `
            <tr>
                <td><strong>${a.id}</strong></td>
                <td>${utils.formatDate(a.date)}<br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${utils.formatTime(a.time)}</span></td>
                <td>${utils.escapeHTML(a.patientName)}</td>
                <td>${utils.escapeHTML(utils.formatDoctorName(a.doctorName))}<br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${a.specialization}</span></td>
                <td><span class="badge badge-neutral">${a.type}</span></td>
                <td><span class="badge badge-${badge}">${a.status}</span></td>
                <td class="actions-cell">${actions}</td>
            </tr>`;
        }).join('');
    }
    document.getElementById('pagination').innerHTML = Array.from({length: totalPages}, (_, i) => `<button class="page-btn ${i+1 === state.page ? 'active' : ''}" onclick="setPage(${i+1})">${i+1}</button>`).join('');
}

window.openNewModal = function() {
    document.getElementById('b-id').value = '';
    document.getElementById('b-patient-group').style.display = 'block';
    document.getElementById('b-patient').value = '';
    document.getElementById('b-doctor').value = '';
    document.getElementById('b-date').value = '';
    document.getElementById('b-reason').value = '';
    document.getElementById('b-time').value = '';
    document.getElementById('b-slots').innerHTML = '<div style="grid-column: 1/-1; color: var(--color-text-muted); font-size: var(--fs-sm);">Select a doctor and date to view slots.</div>';
    document.getElementById('b-doc-info').innerText = '';
    document.getElementById('book-title').innerText = 'New Appointment';
    
    document.getElementById('book-form-area').style.display = 'block';
    document.getElementById('book-success-area').style.display = 'none';
    utils.openModal('book-modal');
};

window.openReschedule = async function(id) {
    const a = await api.getById('appointments', id);
    if (!a) return;
    openNewModal();
    document.getElementById('book-title').innerText = `Reschedule ${id}`;
    document.getElementById('b-id').value = a.id;
    document.getElementById('b-patient-group').style.display = 'none';
    document.getElementById('b-patient').value = a.patientId;
    document.getElementById('b-doctor').value = a.doctorId;
    document.getElementById('b-type').value = a.type;
    document.getElementById('b-reason').value = a.reason;
    await loadSlots();
};

window.loadSlots = async function() {
    const docId = document.getElementById('b-doctor').value;
    const dateStr = document.getElementById('b-date').value;
    const info = document.getElementById('b-doc-info');
    const grid = document.getElementById('b-slots');
    document.getElementById('b-time').value = '';

    if (!docId) { info.innerText = ''; grid.innerHTML = ''; return; }
    
    const doc = await api.getDoctorById(docId);
    if(!doc) return;
    const days = doc.schedule.map(s => s.day).join(', ');
    info.innerText = `Fee: ${utils.formatCurrency(doc.consultationFee)} | Works: ${days}`;

    if (!dateStr) { grid.innerHTML = '<div style="grid-column: 1/-1; color: var(--color-text-muted); font-size: var(--fs-sm);">Select a date.</div>'; return; }

    const slots = await api.getAvailableSlots(docId, dateStr);
    if (slots.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; color: var(--color-danger); font-size: var(--fs-sm);">Doctor is not in clinic on this day or no slots available.</div>';
        return;
    }

    grid.innerHTML = slots.map(s => `
        <button class="slot-btn" ${!s.available ? 'disabled' : ''} onclick="selectSlot('${s.time}', this)">${utils.formatTime(s.time)}</button>
    `).join('');
};

window.selectSlot = function(time, btn) {
    document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('b-time').value = time;
};

window.submitBooking = async function() {
    const id = document.getElementById('b-id').value;
    const data = {
        patientId: document.getElementById('b-patient').value,
        doctorId: document.getElementById('b-doctor').value,
        date: document.getElementById('b-date').value,
        time: document.getElementById('b-time').value,
        type: document.getElementById('b-type').value,
        reason: document.getElementById('b-reason').value
    };

    if (!data.patientId || !data.doctorId || !data.date || !data.time || !data.reason) {
        return utils.showAlert('book-alert-container', 'danger', 'Please complete all required fields and select a time slot.');
    }

    let res;
    if (id) {
        res = await api.rescheduleAppointment(id, data.date, data.time);
    } else {
        res = await api.bookAppointment(data);
    }

    if (res.success) {
        document.getElementById('book-form-area').style.display = 'none';
        document.getElementById('book-success-area').style.display = 'block';
        const p = await api.getPatientById(data.patientId);
        const d = await api.getDoctorById(data.doctorId);
        document.getElementById('book-success-msg').innerText = `${p ? p.fullName : 'Unknown'} with ${d ? utils.formatDoctorName(d.name) : 'Unknown'}, ${utils.formatDate(data.date)} at ${utils.formatTime(data.time)}`;
        await renderTable();
    } else {
        utils.showAlert('book-alert-container', 'danger', res.message);
    }
};

window.updateStatus = async function(id, status) {
    if (confirm(`Mark appointment as ${status}?`)) {
        const res = await api.updateAppointmentStatus(id, status);
        if (res.success) { utils.showToast(res.message, 'success'); await renderTable(); }
        else utils.showToast(res.message, 'danger');
    }
};

window.promptCancel = function(id) {
    document.getElementById('c-id').value = id;
    document.getElementById('c-reason').value = '';
    utils.openModal('cancel-modal');
};

window.submitCancel = async function() {
    const id = document.getElementById('c-id').value;
    const reason = document.getElementById('c-reason').value.trim();
    const res = await api.cancelAppointment(id, reason);
    if (res.success) {
        utils.closeModal('cancel-modal');
        utils.showToast(res.message, 'success');
        await renderTable();
    } else {
        utils.showToast(res.message, 'danger');
    }
};

window.viewAppt = async function(id) {
    const a = await api.getById('appointments', id);
    if(!a) return;
    const p = await api.getPatientById(a.patientId);
    const d = await api.getDoctorById(a.doctorId);
    
    document.getElementById('v-id').innerText = a.id;
    let badge = 'info'; if (a.status === 'Confirmed') badge = 'success'; if (a.status === 'Pending') badge = 'warning'; if (a.status === 'Cancelled') badge = 'danger';
    document.getElementById('v-status').innerHTML = `<span class="badge badge-${badge}">${a.status}</span>`;
    document.getElementById('v-date').innerText = utils.formatDate(a.date);
    document.getElementById('v-time').innerText = utils.formatTime(a.time);
    document.getElementById('v-patient').innerText = p ? p.fullName : 'Unknown';
    document.getElementById('v-doctor').innerText = d ? utils.formatDoctorName(d.name) : 'Unknown';
    document.getElementById('v-type').innerText = a.type;
    document.getElementById('v-reason').innerText = utils.escapeHTML(a.reason);
    
    if (a.status === 'Cancelled') {
        document.getElementById('v-cancel-box').style.display = 'block';
        document.getElementById('v-cancel').innerText = utils.escapeHTML(a.cancelReason);
    } else {
        document.getElementById('v-cancel-box').style.display = 'none';
    }

    document.getElementById('v-created').innerText = utils.formatDateTime(a.createdAt);
    document.getElementById('v-updated').innerText = utils.formatDateTime(a.updatedAt);
    
    utils.openModal('view-modal');
};