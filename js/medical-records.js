let currentPatientId = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (await checkAccess()) {
        await initUI();
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('patient')) await selectPatient(urlParams.get('patient'));
    }
});

window.addEventListener('primecare:rolechange', async () => {
    if (await checkAccess()) await initUI();
});

async function checkAccess() {
    const user = await api.getCurrentUser();
    if (!user || (user.role !== 'admin' && user.role !== 'doctor' && user.role !== 'nurse')) {
        document.getElementById('access-denied').style.display = 'block';
        document.getElementById('records-module').style.display = 'none';
        return false;
    }
    document.getElementById('access-denied').style.display = 'none';
    document.getElementById('records-module').style.display = 'block';
    
    const isDocAdmin = user.role === 'admin' || user.role === 'doctor';
    document.querySelectorAll('.doc-admin-only').forEach(el => el.style.display = isDocAdmin ? '' : 'none');
    return true;
}

async function initUI() {
    await renderPatientList();
    document.getElementById('search-patient').addEventListener('input', async (e) => await renderPatientList(e.target.value));

    const docSelect = document.getElementById('rm-doctor');
    docSelect.innerHTML = '<option value="">None</option>';
    const doctors = await api.getDoctors();
    doctors.forEach(d => docSelect.add(new Option(utils.formatDoctorName(d.name), d.id)));
    
    const user = await api.getCurrentUser();
    if (user.role === 'doctor') {
        const myDoc = doctors.find(d => d.userId === user.id);
        if (myDoc) {
            docSelect.value = myDoc.id;
            docSelect.disabled = true;
        }
    }
}

async function renderPatientList(keyword = '') {
    let patients = await api.searchPatients({ status: 'verified' });
    if (keyword) {
        const kw = keyword.toLowerCase();
        patients = patients.filter(p => p.fullName.toLowerCase().includes(kw) || p.id.toLowerCase().includes(kw));
    }
    
    const list = document.getElementById('patient-list');
    if (patients.length === 0) {
        list.innerHTML = `<div class="empty-state"><div style="padding: 1rem; text-align: center; color: var(--color-text-muted);">No patients found.</div></div>`;
        return;
    }

    list.innerHTML = patients.map(p => `
        <div class="list-item row-clickable" style="${currentPatientId === p.id ? 'border-color: var(--color-accent); background: var(--color-accent-light);' : ''}" onclick="selectPatient('${p.id}')">
            <div>
                <strong>${utils.escapeHTML(p.fullName)}</strong><br>
                <span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${p.id} | ${utils.calcAge(p.birthdate)} yrs</span>
            </div>
        </div>
    `).join('');
}

window.selectPatient = async function(id) {
    currentPatientId = id;
    await renderPatientList(document.getElementById('search-patient').value);
    document.getElementById('patient-chart').style.display = 'block';
    await loadPatientChart();
};

async function loadPatientChart() {
    const data = await api.getPatientSummary(currentPatientId);
    if (!data) return;

    document.getElementById('c-name').innerText = data.fullName;
    document.getElementById('c-id').innerText = data.id;
    document.getElementById('c-age').innerText = utils.calcAge(data.birthdate);
    document.getElementById('c-sex').innerText = data.sex;
    document.getElementById('c-blood').innerText = data.bloodType || 'Unknown';
    document.getElementById('c-location').innerText = data.admitType === 'Inpatient' ? `${data.ward} (Bed ${data.bedNumber})` : 'Outpatient';
    
    const doc = await api.getDoctorById(data.assignedDoctorId);
    document.getElementById('c-doctor').innerText = doc ? utils.formatDoctorName(doc.name) : 'Unassigned';

    const banner = document.getElementById('c-allergy-banner');
    if (data.allergies && data.allergies.toLowerCase() !== 'none') {
        banner.style.display = 'flex';
        document.getElementById('c-allergies').innerText = utils.escapeHTML(data.allergies);
    } else {
        banner.style.display = 'none';
    }

    const cond = document.getElementById('c-conditions');
    if (data.medicalConditions && data.medicalConditions.toLowerCase() !== 'none') {
        cond.style.display = 'block';
        document.getElementById('c-cond-text').innerText = utils.escapeHTML(data.medicalConditions);
    } else {
        cond.style.display = 'none';
    }

    const records = data.medicalRecords.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latestVitals = records.find(r => r.vitals && Object.keys(r.vitals).length > 0)?.vitals || {};
    
    document.getElementById('v-bp').innerText = latestVitals.bp || '--';
    document.getElementById('v-hr').innerText = latestVitals.heartRate || '--';
    document.getElementById('v-temp').innerText = latestVitals.temperature || '--';
    document.getElementById('v-spo2').innerText = latestVitals.spo2 || '--';
    document.getElementById('v-weight').innerText = latestVitals.weightKg || '--';
    
    if (latestVitals.weightKg && latestVitals.heightCm) {
        const m = latestVitals.heightCm / 100;
        const bmi = (latestVitals.weightKg / (m * m)).toFixed(1);
        document.getElementById('v-bmi').innerText = bmi;
    } else {
        document.getElementById('v-bmi').innerText = '--';
    }

    const user = await api.getCurrentUser();
    const isDocAdmin = user.role === 'admin' || user.role === 'doctor';

    const visitsHtmlPromises = records.filter(r => r.diagnosis || r.chiefComplaint).map(async r => {
        const d = await api.getDoctorById(r.attendingDoctorId);
        return `
        <div class="timeline-item">
            <div class="timeline-icon">${ICONS.records}</div>
            <div class="timeline-content card" style="padding: 1rem; margin-bottom: 0;">
                <div style="display: flex; justify-content: space-between;">
                    <strong>${utils.formatDate(r.createdAt.split('T')[0])}</strong>
                    ${isDocAdmin ? `<button class="btn btn-sm btn-outline print-area-hide" onclick="editRecord('${r.id}')">Edit</button>` : ''}
                </div>
                <div style="font-size: var(--fs-xs); color: var(--color-text-muted); margin-bottom: 0.5rem;">Attending: ${d ? utils.formatDoctorName(d.name) : 'Unknown'}</div>
                ${r.chiefComplaint ? `<div><strong>Complaint:</strong> ${utils.escapeHTML(r.chiefComplaint)}</div>` : ''}
                ${r.diagnosis ? `<div><strong>Diagnosis:</strong> ${utils.escapeHTML(r.diagnosis)}</div>` : ''}
                ${r.treatmentNotes ? `<div style="margin-top: 0.5rem;"><strong>Treatment:</strong><br>${utils.escapeHTML(r.treatmentNotes)}</div>` : ''}
                ${r.followUpDate ? `<div style="margin-top: 0.5rem; font-size: var(--fs-sm); color: var(--color-accent);">Follow-up: ${utils.formatDate(r.followUpDate)}</div>` : ''}
            </div>
        </div>`;
    });
    const visitsHtmlArray = await Promise.all(visitsHtmlPromises);
    document.getElementById('chart-visits').innerHTML = visitsHtmlArray.join('') || '<div class="empty-state"><div style="color:var(--color-text-muted);">No visits recorded.</div></div>';

    const rxs = await api.getPrescriptions({ patientId: currentPatientId });
    document.getElementById('chart-rx').innerHTML = rxs.map(rx => `
        <div class="list-item">
            <div>
                <strong>${utils.formatDate(rx.date)}</strong> - ${utils.formatDoctorName(rx.doctorName)}<br>
                <span style="font-size: var(--fs-sm);">${rx.items.map(i => i.medicine).join(', ')}</span>
            </div>
            <span class="badge badge-${rx.status === 'Active' ? 'success' : 'info'}">${rx.status}</span>
        </div>
    `).join('') || '<div class="empty-state"><div style="color:var(--color-text-muted);">No prescriptions.</div></div>';

    const labs = await api.getLabResults({ patientId: currentPatientId });
    document.getElementById('chart-labs').innerHTML = labs.map(l => {
        let fBadge = '';
        if (l.flag === 'Critical') fBadge = '<span class="badge badge-danger pulse-critical">Critical</span>';
        else if (l.flag === 'Abnormal') fBadge = '<span class="badge badge-warning">Abnormal</span>';
        return `
        <div class="list-item">
            <div>
                <strong>${utils.formatDate(l.orderedDate)}</strong> - ${l.testName}<br>
                <span style="font-size: var(--fs-sm);">Result: ${l.result || 'Pending'} ${l.unit || ''}</span>
            </div>
            <div>${fBadge} <span class="badge badge-info">${l.status}</span></div>
        </div>`;
    }).join('') || '<div class="empty-state"><div style="color:var(--color-text-muted);">No lab results.</div></div>';

    let historyEntries = [];
    records.forEach(r => {
        if (r.history) r.history.forEach(h => historyEntries.push({ ...h, recordId: r.id }));
    });
    historyEntries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    
    document.getElementById('chart-history').innerHTML = historyEntries.map(h => `
        <div class="timeline-item">
            <div class="timeline-icon" style="width: 16px; height: 16px; margin-top: 4px;"></div>
            <div class="timeline-content">
                <div class="timeline-text">${h.summary} (Record ${h.recordId})</div>
                <div class="timeline-time">${utils.formatDate(h.updatedAt.split('T')[0])} by ${h.updatedBy}</div>
            </div>
        </div>
    `).join('') || '<div class="empty-state"><div style="color:var(--color-text-muted);">No update history.</div></div>';
}

window.switchChartTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchChartTab('${tab}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    const activeTab = document.getElementById(`tab-${tab}`);
    if(activeTab) activeTab.classList.add('active');
};

window.openVitalsModal = function() {
    document.getElementById('i-bp').value = '';
    document.getElementById('i-hr').value = '';
    document.getElementById('i-temp').value = '';
    document.getElementById('i-spo2').value = '';
    document.getElementById('i-weight').value = '';
    document.getElementById('i-height').value = '';
    document.getElementById('i-resp').value = '';
    utils.openModal('vitals-modal');
};

window.saveVitals = async function() {
    const vitals = {};
    const bp = document.getElementById('i-bp').value; if(bp) vitals.bp = bp;
    const hr = document.getElementById('i-hr').value; if(hr) vitals.heartRate = parseInt(hr);
    const temp = document.getElementById('i-temp').value; if(temp) vitals.temperature = parseFloat(temp);
    const spo2 = document.getElementById('i-spo2').value; if(spo2) vitals.spo2 = parseInt(spo2);
    const weight = document.getElementById('i-weight').value; if(weight) vitals.weightKg = parseFloat(weight);
    const height = document.getElementById('i-height').value; if(height) vitals.heightCm = parseFloat(height);
    const resp = document.getElementById('i-resp').value; if(resp) vitals.respRate = parseInt(resp);

    const res = await api.saveVitals(currentPatientId, vitals);
    if (res.success) {
        utils.closeModal('vitals-modal');
        await loadPatientChart();
    } else {
        utils.showAlert('vitals-alert', 'danger', res.message);
    }
};

window.openRecordModal = async function() {
    document.getElementById('rm-id').value = '';
    document.getElementById('rm-complaint').value = '';
    document.getElementById('rm-diagnosis').value = '';
    document.getElementById('rm-treatment').value = '';
    document.getElementById('rm-followup').value = '';
    document.getElementById('rm-title').innerText = 'New Medical Record';
    
    const user = await api.getCurrentUser();
    if (user.role !== 'doctor') document.getElementById('rm-doctor').value = '';
    
    utils.openModal('record-modal');
};

window.editRecord = async function(id) {
    const r = await api.getMedicalRecordById(id);
    if (!r) return;
    document.getElementById('rm-id').value = r.id;
    document.getElementById('rm-complaint').value = r.chiefComplaint || '';
    document.getElementById('rm-diagnosis').value = r.diagnosis || '';
    document.getElementById('rm-treatment').value = r.treatmentNotes || '';
    document.getElementById('rm-followup').value = r.followUpDate || '';
    document.getElementById('rm-doctor').value = r.attendingDoctorId || '';
    document.getElementById('rm-title').innerText = 'Edit Medical Record';
    utils.openModal('record-modal');
};

window.saveRecord = async function() {
    const id = document.getElementById('rm-id').value;
    const diag = document.getElementById('rm-diagnosis').value.trim();
    const treat = document.getElementById('rm-treatment').value.trim();

    if (!diag || !treat) {
        return utils.showAlert('record-alert', 'danger', 'Please complete all required fields.');
    }

    const record = {
        id: id || null,
        patientId: currentPatientId,
        chiefComplaint: document.getElementById('rm-complaint').value,
        diagnosis: diag,
        treatmentNotes: treat,
        followUpDate: document.getElementById('rm-followup').value || null,
        attendingDoctorId: document.getElementById('rm-doctor').value || null
    };

    const res = await api.saveMedicalRecord(record);
    if (res.success) {
        utils.closeModal('record-modal');
        await loadPatientChart();
        utils.showToast('Medical record saved.', 'success');
    } else {
        utils.showAlert('record-alert', 'danger', res.message);
    }
};
