let state = { keyword: '', spec: 'All', status: 'All', sortBy: 'id', sortDir: 'asc', page: 1, limit: 10, currentDocId: null };
const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

document.addEventListener('DOMContentLoaded', async () => { await initUI(); await renderTable(); });
window.addEventListener('primecare:rolechange', async () => { await initUI(); await renderTable(); });

async function initUI() {
    const user = await api.getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');

    const doctors = await api.getDoctors();
    const specs = [...new Set(doctors.map(d => d.specialization))];
    const filterSpec = document.getElementById('filter-spec');
    filterSpec.innerHTML = '<option value="All">All Specialties</option>' + specs.map(s => `<option value="${s}">${s}</option>`).join('');

    const departments = await api.getDepartments();
    const deptSelect = document.getElementById('e-dept');
    deptSelect.innerHTML = departments.map(d => `<option value="${d.name}">${d.name}</option>`).join('');

    let timeout = null;
    document.getElementById('search-box').addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => { state.keyword = e.target.value; state.page = 1; await renderTable(); }, 300);
    });
    document.getElementById('filter-spec').addEventListener('change', async (e) => { state.spec = e.target.value; state.page = 1; await renderTable(); });
    document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);

    // Fix: Cleaned up schedule editor layout to respect Dark Mode
    document.getElementById('e-schedule').innerHTML = daysOfWeek.map(day => `
        <div class="schedule-row">
            <div class="schedule-day">
                <input type="checkbox" id="chk-${day}" onchange="toggleDay('${day}')"> <label for="chk-${day}" style="margin:0;">${day}</label>
            </div>
            <div class="schedule-times">
                <input type="time" id="start-${day}" disabled value="09:00"> 
                <span style="color: var(--color-text-muted); font-size: 12px;">to</span> 
                <input type="time" id="end-${day}" disabled value="17:00">
            </div>
        </div>
    `).join('');
}

window.toggleDay = function(day) {
    const isChecked = document.getElementById(`chk-${day}`).checked;
    document.getElementById(`start-${day}`).disabled = !isChecked;
    document.getElementById(`end-${day}`).disabled = !isChecked;
};

window.resetFilters = async function() {
    state.keyword = ''; state.spec = 'All'; state.status = 'All'; state.page = 1;
    document.getElementById('search-box').value = ''; document.getElementById('filter-spec').value = 'All';
    await renderTable();
};

window.setStatusFilter = async function(status) { state.status = status; state.page = 1; await renderTable(); };
window.setSort = async function(col) { state.sortDir = (state.sortBy === col && state.sortDir === 'asc') ? 'desc' : 'asc'; state.sortBy = col; await renderTable(); };
window.setPage = async function(p) { state.page = p; await renderTable(); };

async function renderTable() {
    let docs = await api.getDoctors();
    
    document.getElementById('count-all').innerText = docs.length;
    document.getElementById('count-active').innerText = docs.filter(d => d.status === 'active').length;
    document.getElementById('count-leave').innerText = docs.filter(d => d.status === 'on-leave').length;
    document.getElementById('count-inactive').innerText = docs.filter(d => d.status === 'inactive').length;

    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    const activeChip = document.querySelector(`.chip[onclick="setStatusFilter('${state.status}')"]`);
    if(activeChip) activeChip.classList.add('active');

    if (state.keyword) {
        const kw = state.keyword.toLowerCase();
        docs = docs.filter(d => d.name.toLowerCase().includes(kw) || d.specialization.toLowerCase().includes(kw));
    }
    if (state.spec !== 'All') docs = docs.filter(d => d.specialization === state.spec);
    if (state.status !== 'All') docs = docs.filter(d => d.status === state.status);

    docs.sort((a, b) => {
        let valA = a[state.sortBy] || ''; let valB = b[state.sortBy] || '';
        if (valA < valB) return state.sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return state.sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    const totalPages = Math.ceil(docs.length / state.limit);
    if (state.page > totalPages && totalPages > 0) state.page = totalPages;
    const paginated = docs.slice((state.page - 1) * state.limit, state.page * state.limit);

    const tbody = document.getElementById('table-body');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No doctors found.</td></tr>`;
    } else {
        const user = await api.getCurrentUser();
        const isAdmin = user && user.role === 'admin';
        const todayDay = daysOfWeek[(new Date().getDay() + 6) % 7];

        tbody.innerHTML = paginated.map(d => {
            let badge = 'success';
            if (d.status === 'on-leave') badge = 'warning';
            if (d.status === 'inactive') badge = 'danger';

            const worksToday = d.status === 'active' && d.schedule.some(s => s.day === todayDay);
            const todayBadge = worksToday ? `<span class="badge badge-success">Available</span>` : `<span class="badge badge-neutral">Not in clinic</span>`;

            return `
            <tr>
                <td><strong>${d.id}</strong></td>
                <td>
                    <div class="doc-name-cell">
                        <div class="doc-avatar-sm">${d.photoInitials || 'DR'}</div>
                        ${utils.escapeHTML(utils.formatDoctorName(d.name))}
                    </div>
                </td>
                <td>${d.specialization}</td>
                <td>${d.department}</td>
                <td>${d.contact}</td>
                <td><span class="badge badge-${badge}">${d.status}</span></td>
                <td>${todayBadge}</td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-outline" onclick="viewDoctor('${d.id}')">View</button>
                    ${isAdmin ? `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem;" onclick="editDoctor('${d.id}')">Edit</button>` : ''}
                </td>
            </tr>`;
        }).join('');
    }

    document.getElementById('pagination').innerHTML = Array.from({length: totalPages}, (_, i) => `<button class="page-btn ${i+1 === state.page ? 'active' : ''}" onclick="setPage(${i+1})">${i+1}</button>`).join('');
}

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    const activeTab = document.getElementById(`tab-${tab}`);
    if(activeTab) activeTab.classList.add('active');
};

window.viewDoctor = async function(id) {
    state.currentDocId = id;
    const d = await api.getDoctorById(id);
    if (!d) return;
    document.getElementById('v-avatar').innerText = d.photoInitials || 'DR';
    document.getElementById('v-name').innerText = utils.formatDoctorName(d.name);
    document.getElementById('v-spec').innerText = d.specialization;
    
    let badge = 'success'; if (d.status === 'on-leave') badge = 'warning'; if (d.status === 'inactive') badge = 'danger';
    document.getElementById('v-status').innerHTML = `<span class="badge badge-${badge}">${d.status.toUpperCase()}</span>`;
    
    document.getElementById('v-dept').innerText = d.department;
    document.getElementById('v-contact').innerText = d.contact;
    document.getElementById('v-email').innerText = d.email || 'N/A';
    document.getElementById('v-qual').innerText = d.qualifications || 'N/A';
    document.getElementById('v-lang').innerText = d.languages.join(', ') || 'N/A';
    document.getElementById('v-ins').innerText = d.acceptedInsurance.join(', ') || 'N/A';
    document.getElementById('v-fee').innerText = utils.formatCurrency(d.consultationFee);
    document.getElementById('v-slot').innerText = d.slotMinutes;

    let schedRow = '';
    daysOfWeek.forEach(day => {
        const s = d.schedule.find(x => x.day === day);
        if (s) schedRow += `<td class="active-day">${s.start}<br>to<br>${s.end}</td>`;
        else schedRow += `<td style="color: var(--color-text-muted);">-</td>`;
    });
    document.getElementById('v-sched-body').innerHTML = `<tr>${schedRow}</tr>`;

    switchTab('profile');
    utils.openModal('view-modal');
};

window.goToAppointments = function() {
    window.location.href = `appointments.html?doctor=${state.currentDocId}&date=today`;
};

window.openAddModal = function() {
    document.getElementById('edit-form').reset();
    document.getElementById('e-id').value = '';
    document.getElementById('modal-title').innerText = 'Add Doctor';
    daysOfWeek.forEach(day => {
        document.getElementById(`chk-${day}`).checked = false;
        toggleDay(day);
    });
    utils.openModal('edit-modal');
};

window.editDoctor = async function(id) {
    const d = await api.getDoctorById(id);
    if (!d) return;
    document.getElementById('e-id').value = d.id;
    document.getElementById('e-name').value = d.name;
    document.getElementById('e-spec').value = d.specialization;
    document.getElementById('e-dept').value = d.department;
    document.getElementById('e-contact').value = d.contact;
    document.getElementById('e-email').value = d.email || '';
    document.getElementById('e-qual').value = d.qualifications || '';
    document.getElementById('e-lang').value = d.languages.join(', ');
    document.getElementById('e-ins').value = d.acceptedInsurance.join(', ');
    document.getElementById('e-fee').value = d.consultationFee;
    document.getElementById('e-slot').value = d.slotMinutes;
    document.getElementById('e-status').value = d.status;
    document.getElementById('modal-title').innerText = 'Edit Doctor';

    daysOfWeek.forEach(day => {
        const s = d.schedule.find(x => x.day === day);
        const chk = document.getElementById(`chk-${day}`);
        if (s) {
            chk.checked = true;
            document.getElementById(`start-${day}`).value = s.start;
            document.getElementById(`end-${day}`).value = s.end;
        } else {
            chk.checked = false;
        }
        toggleDay(day);
    });
    utils.openModal('edit-modal');
};

async function handleEditSubmit(e) {
    e.preventDefault();
    const schedule = [];
    daysOfWeek.forEach(day => {
        if (document.getElementById(`chk-${day}`).checked) {
            const start = document.getElementById(`start-${day}`).value;
            const end = document.getElementById(`end-${day}`).value;
            if (start >= end) {
                utils.showAlert('edit-alert-container', 'danger', `${day}: End time must be after start time.`);
                throw new Error('Invalid time');
            }
            schedule.push({ day, start, end });
        }
    });

    if (schedule.length === 0) return utils.showAlert('edit-alert-container', 'danger', 'Please select at least one working day.');

    const doc = {
        id: document.getElementById('e-id').value,
        name: document.getElementById('e-name').value,
        specialization: document.getElementById('e-spec').value,
        department: document.getElementById('e-dept').value,
        contact: document.getElementById('e-contact').value,
        email: document.getElementById('e-email').value,
        qualifications: document.getElementById('e-qual').value,
        languages: document.getElementById('e-lang').value.split(',').map(s => s.trim()).filter(s => s),
        acceptedInsurance: document.getElementById('e-ins').value.split(',').map(s => s.trim()).filter(s => s),
        consultationFee: parseInt(document.getElementById('e-fee').value) || 0,
        slotMinutes: parseInt(document.getElementById('e-slot').value) || 30,
        status: document.getElementById('e-status').value,
        schedule: schedule
    };

    const res = await api.saveDoctor(doc);
    if (res.success) {
        utils.closeModal('edit-modal');
        utils.showToast(`Doctor saved successfully. ${res.doctor.name} added as ${res.doctor.id}.`, 'success');
        await renderTable();
    } else {
        utils.showAlert('edit-alert-container', 'danger', res.message);
    }
}

window.promptDelete = async function() {
    const d = await api.getDoctorById(state.currentDocId);
    if (!d) return;
    if (confirm(`WARNING: Deletion is permanent.\nAre you sure you want to delete ${d.name}?`)) {
        const res = await api.deleteDoctor(d.id);
        if (res.success) {
            utils.showToast(res.message, 'success');
            utils.closeModal('view-modal');
            await renderTable();
        } else {
            utils.showToast(res.message, 'danger');
        }
    }
};