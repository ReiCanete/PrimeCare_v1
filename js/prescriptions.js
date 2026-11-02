let state = { keyword: '', status: 'All', doctorId: 'All', page: 1, limit: 10 };
let rxItems = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (await checkAccess()) { await initUI(); await renderTable(); }
});

window.addEventListener('primecare:rolechange', async () => {
    if (await checkAccess()) { await initUI(); await renderTable(); }
});

async function checkAccess() {
    const user = await api.getCurrentUser();
    if (!user || user.role === 'staff') {
        document.getElementById('access-denied').style.display = 'block';
        document.getElementById('rx-module').style.display = 'none';
        return false;
    }
    document.getElementById('access-denied').style.display = 'none';
    document.getElementById('rx-module').style.display = 'block';
    
    const isDocAdmin = user.role === 'admin' || user.role === 'doctor';
    document.querySelectorAll('.doc-admin-only').forEach(el => el.style.display = isDocAdmin ? '' : 'none');
    return true;
}

async function initUI() {
    const user = await api.getCurrentUser();
    
    const docFilter = document.getElementById('filter-doc');
    docFilter.innerHTML = '<option value="All">All Doctors</option>';
    const doctors = await api.getDoctors();
    
    if (user.role === 'doctor') {
        const myDoc = doctors.find(d => d.userId === user.id);
        if (myDoc) {
            docFilter.innerHTML = `<option value="${myDoc.id}">My Prescriptions</option>`;
            state.doctorId = myDoc.id;
            docFilter.disabled = true;
        }
    } else {
        doctors.forEach(d => docFilter.add(new Option(utils.formatDoctorName(d.name), d.id)));
        docFilter.value = state.doctorId;
    }

    const pSelect = document.getElementById('rx-patient');
    pSelect.innerHTML = '<option value="">Select Patient...</option>';
    const patients = await api.searchPatients({ status: 'verified' });
    patients.forEach(p => pSelect.add(new Option(`${p.fullName} (${p.id})`, p.id)));

    let timeout = null;
    document.getElementById('search-box').addEventListener('input', (e) => {
        clearTimeout(timeout); timeout = setTimeout(async () => { state.keyword = e.target.value; state.page = 1; await renderTable(); }, 300);
    });
    document.getElementById('filter-status').addEventListener('change', async (e) => { state.status = e.target.value; state.page = 1; await renderTable(); });
    document.getElementById('filter-doc').addEventListener('change', async (e) => { state.doctorId = e.target.value; state.page = 1; await renderTable(); });
}

window.resetFilters = async function() {
    state.keyword = ''; state.status = 'All'; state.page = 1;
    document.getElementById('search-box').value = ''; document.getElementById('filter-status').value = 'All';
    const user = await api.getCurrentUser();
    if (user.role !== 'doctor') { state.doctorId = 'All'; document.getElementById('filter-doc').value = 'All'; }
    await renderTable();
};

window.setPage = async function(p) { state.page = p; await renderTable(); };

async function renderTable() {
    const rxs = await api.getPrescriptions(state);
    const totalPages = Math.ceil(rxs.length / state.limit);
    if (state.page > totalPages && totalPages > 0) state.page = totalPages;
    const paginated = rxs.slice((state.page - 1) * state.limit, state.page * state.limit);

    const tbody = document.getElementById('table-body');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No prescriptions found.</td></tr>`;
    } else {
        const user = await api.getCurrentUser();
        const canCancel = user.role === 'admin' || user.role === 'doctor';
        const canDispense = user.role === 'admin' || user.role === 'nurse';

        tbody.innerHTML = paginated.map(rx => {
            let badge = 'info'; if (rx.status === 'Active') badge = 'success'; if (rx.status === 'Cancelled') badge = 'danger';
            
            let meds = rx.items[0].medicine;
            if (rx.items.length > 1) meds += ` <span style="color:var(--color-text-muted); font-size:var(--fs-xs);">+${rx.items.length - 1} more</span>`;

            let actions = `<button class="btn btn-sm btn-outline" onclick="printRx('${rx.id}')">View/Print</button>`;
            if (rx.status === 'Active') {
                if (canDispense) actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-success); border-color: var(--color-success);" onclick="updateRxStatus('${rx.id}', 'Dispensed')">Dispense</button>`;
                if (canCancel) actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-danger); border-color: var(--color-danger);" onclick="updateRxStatus('${rx.id}', 'Cancelled')">Cancel</button>`;
            }

            return `
            <tr>
                <td><strong>${rx.id}</strong></td>
                <td>${utils.formatDate(rx.date)}</td>
                <td>${utils.escapeHTML(rx.patientName)}</td>
                <td>${utils.escapeHTML(utils.formatDoctorName(rx.doctorName))}</td>
                <td>${meds}</td>
                <td><span class="badge badge-${badge}">${rx.status}</span></td>
                <td class="actions-cell">${actions}</td>
            </tr>`;
        }).join('');
    }
    document.getElementById('pagination').innerHTML = Array.from({length: totalPages}, (_, i) => `<button class="page-btn ${i+1 === state.page ? 'active' : ''}" onclick="setPage(${i+1})">${i+1}</button>`).join('');
}

window.openNewRxModal = function() {
    document.getElementById('rx-patient').value = '';
    document.getElementById('rx-allergy-banner').style.display = 'none';
    document.getElementById('rx-conflict-box').style.display = 'none';
    document.getElementById('rx-notes').value = '';
    rxItems = [{ id: Date.now() }];
    renderRxItems();
    utils.openModal('new-rx-modal');
};

window.checkPatientAllergies = async function() {
    const pid = document.getElementById('rx-patient').value;
    const banner = document.getElementById('rx-allergy-banner');
    if (!pid) { banner.style.display = 'none'; return; }
    
    const p = await api.getPatientById(pid);
    if (p && p.allergies && p.allergies.toLowerCase() !== 'none') {
        banner.style.display = 'flex';
        document.getElementById('rx-allergies-text').innerText = utils.escapeHTML(p.allergies);
    } else {
        banner.style.display = 'none';
    }
};

window.addRxItem = function() {
    rxItems.push({ id: Date.now() });
    renderRxItems();
};

window.removeRxItem = function(id) {
    if (rxItems.length === 1) return;
    rxItems = rxItems.filter(i => i.id !== id);
    renderRxItems();
};

function renderRxItems() {
    const container = document.getElementById('rx-items-container');
    container.innerHTML = rxItems.map((item, index) => `
        <div class="card" style="padding: 1rem; margin-bottom: 0; background: var(--color-bg);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <strong>Item ${index + 1}</strong>
                ${rxItems.length > 1 ? `<button class="btn btn-sm btn-outline" style="color: var(--color-danger); border-color: var(--color-danger);" onclick="removeRxItem(${item.id})">Remove</button>` : ''}
            </div>
            <div class="grid grid-2">
                <div class="form-group"><label>Medicine *</label><input type="text" id="med-${item.id}" class="form-control" placeholder="e.g., Amoxicillin 500mg"></div>
                <div class="form-group"><label>Dosage *</label><input type="text" id="dos-${item.id}" class="form-control" placeholder="e.g., 1 capsule"></div>
                <div class="form-group"><label>Frequency *</label><input type="text" id="freq-${item.id}" class="form-control" placeholder="e.g., 3x a day"></div>
                <div class="form-group"><label>Duration (Days) *</label><input type="number" id="dur-${item.id}" class="form-control" placeholder="7"></div>
                <div class="form-group" style="grid-column: 1/-1;"><label>Instructions</label><input type="text" id="inst-${item.id}" class="form-control" placeholder="e.g., Take after meals"></div>
            </div>
        </div>
    `).join('');
}

window.submitRx = async function(isOverride) {
    const pid = document.getElementById('rx-patient').value;
    if (!pid) return utils.showAlert('rx-alert', 'danger', 'Please select a patient.');

    const user = await api.getCurrentUser();
    let docId = null;
    if (user.role === 'doctor') {
        const doctors = await api.getDoctors();
        const myDoc = doctors.find(d => d.userId === user.id);
        docId = myDoc ? myDoc.id : null;
    } else if (user.role === 'admin') {
        docId = 'D-001';
    }

    const items = [];
    let valid = true;
    rxItems.forEach(item => {
        const med = document.getElementById(`med-${item.id}`).value.trim();
        const dos = document.getElementById(`dos-${item.id}`).value.trim();
        const freq = document.getElementById(`freq-${item.id}`).value.trim();
        const dur = document.getElementById(`dur-${item.id}`).value.trim();
        const inst = document.getElementById(`inst-${item.id}`).value.trim();
        if (!med || !dos || !freq || !dur) valid = false;
        items.push({ medicine: med, dosage: dos, frequency: freq, durationDays: parseInt(dur), instructions: inst });
    });

    if (!valid) return utils.showAlert('rx-alert', 'danger', 'Please complete all required fields for each medicine.');

    const rx = {
        patientId: pid, doctorId: docId, medicalRecordId: null,
        items: items, notes: document.getElementById('rx-notes').value,
        overrideAllergy: isOverride, overrideReason: isOverride ? document.getElementById('rx-override-reason').value : null
    };

    const res = await api.createPrescription(rx);
    
    if (res.allergyConflict) {
        document.getElementById('rx-conflict-box').style.display = 'block';
        document.getElementById('rx-conflict-meds').innerText = res.conflicts.join(', ');
        return;
    }

    if (res.success) {
        utils.closeModal('new-rx-modal');
        utils.showToast(res.message, 'success');
        await renderTable();
    } else {
        utils.showAlert('rx-alert', 'danger', res.message);
    }
};

window.updateRxStatus = async function(id, status) {
    if (confirm(`Mark prescription as ${status}?`)) {
        const res = await api.updatePrescriptionStatus(id, status);
        if (res.success) { utils.showToast(res.message, 'success'); await renderTable(); }
        else utils.showToast(res.message, 'danger');
    }
};

window.printRx = async function(id) {
    const rx = await api.getPrescriptionById(id);
    if(!rx) return;
    const p = await api.getPatientById(rx.patientId);
    const d = await api.getDoctorById(rx.doctorId);
    
    document.getElementById('p-patient').innerText = p ? p.fullName : 'Unknown';
    document.getElementById('p-agesex').innerText = p ? `${utils.calcAge(p.birthdate)} / ${p.sex}` : 'Unknown';
    document.getElementById('p-date').innerText = utils.formatDate(rx.date);
    document.getElementById('p-id').innerText = rx.id;
    
    document.getElementById('p-items').innerHTML = rx.items.map(i => `
        <tr style="border-bottom: 1px dashed #eee;">
            <td style="padding: 0.5rem 0;"><strong>${utils.escapeHTML(i.medicine)}</strong></td>
            <td>${utils.escapeHTML(i.dosage)}</td>
            <td>${utils.escapeHTML(i.frequency)} for ${i.durationDays} days<br><span style="font-size:var(--fs-xs); color:var(--color-text-muted);">${utils.escapeHTML(i.instructions)}</span></td>
        </tr>
    `).join('');

    document.getElementById('p-notes').innerText = utils.escapeHTML(rx.notes) || 'None';
    document.getElementById('p-doctor').innerText = d ? utils.formatDoctorName(d.name) : 'Unknown';
    document.getElementById('p-doc-details').innerText = d ? `Lic No: ${d.id} | ${d.specialization}` : '';

    utils.openModal('print-modal');
};
