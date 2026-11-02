document.addEventListener('DOMContentLoaded', async () => {
    if (await checkAccess()) { await initUI(); await renderDashboard(); await renderAdmissions(); }
});

window.addEventListener('primecare:rolechange', async () => {
    if (await checkAccess()) { await initUI(); await renderDashboard(); await renderAdmissions(); }
});

async function checkAccess() {
    const user = await api.getCurrentUser();
    if (!user || user.role === 'staff') {
        document.getElementById('access-denied').style.display = 'block';
        document.getElementById('ward-module').style.display = 'none';
        return false;
    }
    document.getElementById('access-denied').style.display = 'none';
    document.getElementById('ward-module').style.display = 'block';
    
    const isManage = user.role === 'admin' || user.role === 'nurse';
    document.querySelectorAll('.admin-nurse-only').forEach(el => el.style.display = isManage ? '' : 'none');
    return true;
}

async function initUI() {
    const wardFilter = document.getElementById('filter-ward');
    wardFilter.innerHTML = '<option value="All">All Wards</option>';
    const wards = await api.getWards();
    wards.forEach(w => wardFilter.add(new Option(w.name, w.id)));
}

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    const activeTab = document.getElementById(`tab-${tab}`);
    if(activeTab) activeTab.classList.add('active');
};

async function renderDashboard() {
    const wards = await api.getWardOccupancy();
    const beds = await api.getBeds();

    document.getElementById('t-total').innerText = beds.length;
    document.getElementById('t-occ').innerText = beds.filter(b => b.status === 'Occupied').length;
    document.getElementById('t-avail').innerText = beds.filter(b => b.status === 'Available').length;
    document.getElementById('t-maint').innerText = beds.filter(b => b.status === 'Maintenance').length;

    document.getElementById('ward-cards').innerHTML = wards.map(w => {
        let color = 'progress-green';
        if (w.percent >= 70) color = 'progress-yellow';
        if (w.percent >= 90) color = 'progress-red';
        return `
        <div class="card" style="margin-bottom: 0;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <strong>${utils.escapeHTML(w.name)}</strong>
                <span class="badge badge-neutral">${w.type}</span>
            </div>
            <div style="font-size: var(--fs-sm); color: var(--color-text-muted); margin-bottom: 0.5rem;">Occupied: ${w.occupied} / ${w.total}</div>
            <div class="progress-bg"><div class="progress-fill ${color}" style="width: ${w.percent}%"></div></div>
        </div>`;
    }).join('');

    await renderBeds();
}

window.renderBeds = async function() {
    const wardId = document.getElementById('filter-ward').value;
    const beds = await api.getBeds(wardId !== 'All' ? { wardId } : null);
    const wards = await api.getWards();
    const patients = await api.searchPatients({ status: 'verified' }); 
    const container = document.getElementById('bed-grid');
    
    if (beds.length === 0) {
        container.innerHTML = '<div class="empty-state"><div style="grid-column: 1/-1; text-align: center; color: var(--color-text-muted); padding: 2rem;">No beds found.</div></div>';
        return;
    }

    const grouped = {};
    beds.forEach(b => {
        if (!grouped[b.wardId]) grouped[b.wardId] = [];
        grouped[b.wardId].push(b);
    });

    let html = '';
    for (const wId in grouped) {
        const ward = wards.find(w => w.id === wId);
        const wBeds = grouped[wId];
        const occupied = wBeds.filter(b => b.status === 'Occupied').length;
        
        html += `<div style="grid-column: 1/-1; margin-top: 1.5rem; margin-bottom: 0.5rem; border-bottom: 2px solid var(--color-border); padding-bottom: 0.5rem;">
                    <h3 style="color: var(--color-primary); display: inline-block; margin-right: 1rem;">${ward ? utils.escapeHTML(ward.name) : 'Unknown Ward'}</h3>
                    <span class="badge badge-neutral">${ward ? ward.type : ''}</span>
                    <span style="float: right; font-size: var(--fs-sm); color: var(--color-text-muted);">Occupied: ${occupied}/${wBeds.length}</span>
                 </div>`;
        
        wBeds.forEach(b => {
            let cls = 'bed-available'; let text = 'Available';
            if (b.status === 'Occupied') {
                cls = 'bed-occupied';
                const p = patients.find(x => x.id === b.currentPatientId);
                text = p ? utils.escapeHTML(p.fullName) : 'Occupied';
            } else if (b.status === 'Maintenance') {
                cls = 'bed-maintenance'; text = 'Maintenance';
            }
            html += `
            <div class="bed-card ${cls}" onclick="openBedModal('${b.id}')">
                <div style="font-weight: bold; font-size: var(--fs-lg); color: var(--color-primary);">${b.bedNumber}</div>
                <div style="font-size: var(--fs-xs); color: var(--color-text-muted); margin-top: 0.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${text}</div>
            </div>`;
        });
    }
    container.innerHTML = html;
};

window.openBedModal = async function(bedId) {
    const beds = await api.getBeds();
    const bed = beds.find(b => b.id === bedId);
    if(!bed) return;
    const wards = await api.getWards();
    const ward = wards.find(w => w.id === bed.wardId);
    
    document.getElementById('bm-bedId').value = bed.id;
    document.getElementById('bm-title').innerText = `${ward.name} - Bed ${bed.bedNumber}`;
    document.getElementById('bed-alert').innerHTML = '';

    const info = document.getElementById('bm-info');
    const availDiv = document.getElementById('bm-available-actions');
    const occDiv = document.getElementById('bm-occupied-actions');
    const maintDiv = document.getElementById('bm-maintenance-actions');

    availDiv.style.display = 'none'; occDiv.style.display = 'none'; maintDiv.style.display = 'none';

    if (bed.status === 'Available') {
        info.innerHTML = `<strong>Status:</strong> <span style="color: var(--color-success);">Available</span><br><strong>Daily Rate:</strong> ${utils.formatCurrency(ward.dailyRate)}`;
        availDiv.style.display = 'block';
        
        const pSelect = document.getElementById('bm-patient');
        pSelect.innerHTML = '<option value="">Select Patient...</option>';
        const patients = await api.searchPatients({ status: 'verified', admitType: 'Outpatient' });
        patients.forEach(p => pSelect.add(new Option(`${p.fullName} (${p.id})`, p.id)));
        
        const dSelect = document.getElementById('bm-doctor');
        dSelect.innerHTML = '<option value="">Select Doctor...</option>';
        const doctors = await api.getDoctors();
        doctors.forEach(d => dSelect.add(new Option(utils.formatDoctorName(d.name), d.id)));

    } else if (bed.status === 'Occupied') {
        const p = await api.getPatientById(bed.currentPatientId);
        const adms = await api.getAdmissions({ status: 'Admitted' });
        const adm = adms.find(a => a.patientId === bed.currentPatientId && a.bedId === bed.id);
        
        if (adm) {
            document.getElementById('bm-admId').value = adm.id;
            const days = Math.floor((new Date() - new Date(adm.admitDate)) / (1000 * 60 * 60 * 24));
            const chargeDays = days === 0 ? 1 : days;
            const estCharge = chargeDays * adm.dailyRate;

            info.innerHTML = `
                <strong>Patient:</strong> ${p ? utils.escapeHTML(p.fullName) : 'Unknown'} (${bed.currentPatientId})<br>
                <strong>Admitted:</strong> ${utils.formatDate(adm.admitDate)} (${days} days ago)<br>
                <strong>Daily Rate:</strong> ${utils.formatCurrency(adm.dailyRate)}<br>
                <strong>Est. Room Charge:</strong> <span style="color: var(--color-danger); font-weight: bold;">${utils.formatCurrency(estCharge)}</span>
            `;
            occDiv.style.display = 'block';

            const tSelect = document.getElementById('bm-transfer-bed');
            tSelect.innerHTML = '<option value="">Select Available Bed...</option>';
            const availBeds = await api.getBeds({ status: 'Available' });
            wards.forEach(w => {
                const wBeds = availBeds.filter(b => b.wardId === w.id);
                if (wBeds.length > 0) {
                    const group = document.createElement('optgroup');
                    group.label = w.name;
                    wBeds.forEach(b => group.appendChild(new Option(`Bed ${b.bedNumber}`, b.id)));
                    tSelect.appendChild(group);
                }
            });
            document.getElementById('bm-discharge-summary').value = '';
        }
    } else if (bed.status === 'Maintenance') {
        info.innerHTML = `<strong>Status:</strong> <span style="color: var(--color-text-muted);">Maintenance</span>`;
        maintDiv.style.display = 'block';
    }

    utils.openModal('bed-modal');
};

window.submitAdmit = async function() {
    const data = {
        bedId: document.getElementById('bm-bedId').value,
        patientId: document.getElementById('bm-patient').value,
        attendingDoctorId: document.getElementById('bm-doctor').value
    };
    if (!data.patientId || !data.attendingDoctorId) return utils.showAlert('bed-alert', 'danger', 'Patient and Doctor are required.');

    const res = await api.admitPatient(data);
    if (res.success) {
        utils.closeModal('bed-modal');
        utils.showToast(res.message, 'success');
        await renderDashboard(); await renderAdmissions();
    } else {
        utils.showAlert('bed-alert', 'danger', res.message);
    }
};

window.submitTransfer = async function() {
    const admId = document.getElementById('bm-admId').value;
    const newBedId = document.getElementById('bm-transfer-bed').value;
    if (!newBedId) return utils.showAlert('bed-alert', 'danger', 'Please select a new bed.');

    const res = await api.transferPatient(admId, newBedId);
    if (res.success) {
        utils.closeModal('bed-modal');
        utils.showToast(res.message, 'success');
        await renderDashboard(); await renderAdmissions();
    } else {
        utils.showAlert('bed-alert', 'danger', res.message);
    }
};

window.submitDischarge = async function() {
    const admId = document.getElementById('bm-admId').value;
    const summary = document.getElementById('bm-discharge-summary').value.trim();
    if (summary.length < 10) return utils.showAlert('bed-alert', 'danger', 'Discharge summary must be at least 10 characters.');

    const res = await api.dischargePatient(admId, summary);
    if (res.success) {
        utils.closeModal('bed-modal');
        utils.showToast(res.message, 'success');
        await renderDashboard(); await renderAdmissions();
    } else {
        utils.showAlert('bed-alert', 'danger', res.message);
    }
};

window.setStatus = async function(status) {
    const bedId = document.getElementById('bm-bedId').value;
    const res = await api.setBedStatus(bedId, status);
    if (res.success) {
        utils.closeModal('bed-modal');
        utils.showToast(res.message, 'success');
        await renderDashboard();
    } else {
        utils.showAlert('bed-alert', 'danger', res.message);
    }
};

window.renderAdmissions = async function() {
    const status = document.getElementById('filter-adm-status').value;
    const adms = await api.getAdmissions(status !== 'All' ? { status } : null);
    
    const tbody = document.getElementById('adm-table-body');
    if (adms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No admissions found.</td></tr>`;
    } else {
        tbody.innerHTML = adms.map(a => `
            <tr>
                <td><strong>${utils.escapeHTML(a.patientName)}</strong><br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${a.patientId}</span></td>
                <td>${utils.escapeHTML(a.wardName)}<br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">Bed ${a.bedName}</span></td>
                <td>${utils.escapeHTML(utils.formatDoctorName(a.doctorName))}</td>
                <td>${utils.formatDate(a.admitDate)}</td>
                <td>${a.dischargeDate ? utils.formatDate(a.dischargeDate) : '-'}</td>
                <td><span class="badge badge-${a.status === 'Admitted' ? 'info' : 'success'}">${a.status}</span></td>
            </tr>
        `).join('');
    }
};