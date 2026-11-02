let myPatientProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) {
        await initUI();
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('tab')) switchTab(urlParams.get('tab'));
    }
});

window.addEventListener('primecare:rolechange', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) await initUI();
});

async function initUI() {
    // NOTE: innerText/textContent are already safe, so no escapeHTML here
    // (escaping first made "&" and "'" show up as entities).
    const allergyBanner = document.getElementById('allergy-banner');
    if (myPatientProfile.allergies && myPatientProfile.allergies.toLowerCase() !== 'none') {
        allergyBanner.style.display = 'flex';
        document.getElementById('allergies-text').innerText = myPatientProfile.allergies;
    } else {
        allergyBanner.style.display = 'none';
    }

    const condBanner = document.getElementById('conditions-banner');
    if (myPatientProfile.medicalConditions && myPatientProfile.medicalConditions.toLowerCase() !== 'none') {
        condBanner.style.display = 'block';
        document.getElementById('cond-text').innerText = myPatientProfile.medicalConditions;
    } else {
        condBanner.style.display = 'none';
    }

    await renderVisits();
    await renderPrescriptions();
    await renderLabs();
    await renderImmunizations();
    await renderAdmissions();
}

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
    if (activeBtn) activeBtn.classList.add('active');
    const activeTab = document.getElementById(`tab-${tab}`);
    if (activeTab) activeTab.classList.add('active');
};

async function renderVisits() {
    const records = await api.getMyMedicalRecords();
    const list = document.getElementById('visits-list');

    if (records.length === 0) {
        list.innerHTML = '<div class="empty-state"><div style="color:var(--color-text-muted); text-align: center; padding: 2rem;">No clinical history found.</div></div>';
        return;
    }

    list.innerHTML = records.map(r => `
        <div class="timeline-item">
            <div class="timeline-icon">${ICONS.records}</div>
            <div class="timeline-content card" style="padding: var(--space-16) var(--space-24); margin-bottom: 0;">
                <div style="font-size: var(--fs-lg); font-weight: bold; color: var(--color-primary);">${utils.formatDate(r.date)}</div>
                <div style="font-size: var(--fs-sm); color: var(--color-text-muted); margin-bottom: var(--space-12);">Attending: ${utils.formatDoctorName(r.doctorName)}</div>
                ${r.chiefComplaint ? `<div><strong>Complaint:</strong> ${utils.escapeHTML(r.chiefComplaint)}</div>` : ''}
                ${r.diagnosis ? `<div><strong>Diagnosis:</strong> ${utils.escapeHTML(r.diagnosis)}</div>` : ''}
                ${r.treatmentNotes ? `<div style="margin-top: var(--space-8);"><strong>Treatment Plan:</strong><br>${utils.escapeHTML(r.treatmentNotes)}</div>` : ''}
                ${r.followUpDate ? `<div style="margin-top: var(--space-8); font-size: var(--fs-sm); color: var(--color-accent); font-weight: bold;">Follow-up: ${utils.formatDate(r.followUpDate)}</div>` : ''}
            </div>
        </div>
    `).join('');
}

async function renderPrescriptions() {
    const rxs = await api.getMyPrescriptions();
    const list = document.getElementById('rx-list');

    if (rxs.length === 0) {
        list.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><div style="color:var(--color-text-muted); text-align: center; padding: 2rem;">No prescriptions found.</div></div>';
        return;
    }

    list.innerHTML = rxs.map(rx => {
        let badge = rx.status === 'Active' ? 'success' : 'info';
        if (rx.status === 'Cancelled') badge = 'danger';

        const itemsHtml = rx.items.map(i => `<li><strong>${utils.escapeHTML(i.medicine)}</strong>: ${utils.escapeHTML(i.dosage)} - ${utils.escapeHTML(i.frequency)}</li>`).join('');

        return `
        <div class="card" style="display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-16);">
                <div>
                    <strong>${utils.formatDate(rx.date)}</strong><br>
                    <span style="font-size: var(--fs-sm); color: var(--color-text-muted);">${utils.formatDoctorName(rx.doctorName)}</span>
                </div>
                <span class="badge badge-${badge}">${utils.escapeHTML(rx.status)}</span>
            </div>
            <ul style="font-size: var(--fs-sm); padding-left: var(--space-24); margin-bottom: var(--space-24); flex: 1;">
                ${itemsHtml}
            </ul>
            <div style="text-align: right; border-top: 1px solid var(--color-border); padding-top: var(--space-16);">
                <button class="btn btn-sm btn-outline" onclick="printRx('${rx.id}')">🖨️ Print / View</button>
            </div>
        </div>`;
    }).join('');
}

async function renderLabs() {
    const labs = await api.getMyLabResults();
    const tbody = document.getElementById('labs-list');

    if (labs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color:var(--color-text-muted); padding: 2rem;">No lab results found.</td></tr>';
        return;
    }

    const history = {};
    [...labs].reverse().forEach(l => {
        if (!history[l.testName]) history[l.testName] = [];
        const val = parseFloat(l.result);
        if (!isNaN(val)) history[l.testName].push(val);
    });

    tbody.innerHTML = labs.map(l => {
        let fBadge = '';
        if (l.flag === 'Normal') fBadge = '<span class="badge badge-success">Normal</span>';
        else if (l.flag === 'Abnormal') fBadge = '<span class="badge badge-warning">Abnormal</span>';
        else if (l.flag === 'Critical') fBadge = '<span class="badge badge-danger pulse-critical">Critical</span><div style="font-size: var(--fs-xs); color: var(--color-danger); margin-top: var(--space-4);">Please contact your doctor.</div>';

        let trend = '';
        const val = parseFloat(l.result);
        if (!isNaN(val) && history[l.testName] && history[l.testName].length > 1) {
            const idx = history[l.testName].lastIndexOf(val);
            if (idx > 0) {
                const prev = history[l.testName][idx - 1];
                if (val > prev) trend = '<span style="color: var(--color-danger); font-size: var(--fs-lg);" title="Higher than previous">⬆️</span>';
                else if (val < prev) trend = '<span style="color: var(--color-success); font-size: var(--fs-lg);" title="Lower than previous">⬇️</span>';
            }
            history[l.testName].splice(idx, 1);
        }

        return `
        <tr>
            <td>${utils.formatDate(l.resultDate)}</td>
            <td><strong>${utils.escapeHTML(l.testName)}</strong><br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${utils.escapeHTML(l.category)}</span></td>
            <td style="font-size: var(--fs-lg); font-weight: bold;">${utils.escapeHTML(l.result)} ${utils.escapeHTML(l.unit || '')} ${trend}</td>
            <td style="font-size: var(--fs-sm); color: var(--color-text-muted);">${l.referenceRange ? `${l.referenceRange.min} - ${l.referenceRange.max}` : 'N/A'}</td>
            <td>${fBadge}</td>
        </tr>`;
    }).join('');
}

async function renderImmunizations() {
    const imms = await api.getMyImmunizations();
    const tbody = document.getElementById('imm-list');
    if (imms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color:var(--color-text-muted); padding: 2rem;">No immunizations recorded.</td></tr>';
        return;
    }
    tbody.innerHTML = imms.map(i => `
        <tr>
            <td>${utils.formatDate(i.date)}</td>
            <td><strong>${utils.escapeHTML(i.vaccine)}</strong></td>
            <td>${utils.escapeHTML(i.dose)}</td>
            <td>${utils.formatDoctorName(i.administeredBy)}</td>
        </tr>
    `).join('');
}

async function renderAdmissions() {
    const adms = await api.getMyAdmissions();
    const list = document.getElementById('adm-list');
    if (adms.length === 0) {
        list.innerHTML = '<div class="empty-state"><div style="color:var(--color-text-muted); text-align: center; padding: 2rem;">No hospital admissions found.</div></div>';
        return;
    }
    list.innerHTML = adms.map(a => `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-16);">
                <div>
                    <h3 style="color: var(--color-primary);">${utils.escapeHTML(a.wardName)}</h3>
                    <div style="font-size: var(--fs-sm); color: var(--color-text-muted);">Attending: ${utils.formatDoctorName(a.doctorName)}</div>
                </div>
                <span class="badge badge-${a.status === 'Admitted' ? 'info' : 'success'}">${utils.escapeHTML(a.status)}</span>
            </div>
            <div class="grid grid-2" style="font-size: var(--fs-sm); margin-bottom: var(--space-16); gap: var(--space-8);">
                <div><strong>Admitted:</strong> ${utils.formatDate(a.admitDate)}</div>
                <div><strong>Discharged:</strong> ${a.dischargeDate ? utils.formatDate(a.dischargeDate) : '-'}</div>
            </div>
            ${a.dischargeSummary ? `<div style="background: var(--color-bg); border: 1px solid var(--color-border); padding: var(--space-16); border-radius: var(--radius-sm); font-size: var(--fs-sm);"><strong>Discharge Summary:</strong><br>${utils.escapeHTML(a.dischargeSummary)}</div>` : ''}
        </div>
    `).join('');
}

window.printRx = async function(id) {
    const rx = await api.getPrescriptionById(id);
    if (!rx || rx.patientId !== myPatientProfile.id) return;

    document.getElementById('p-patient').innerText = myPatientProfile.fullName;
    document.getElementById('p-agesex').innerText = `${utils.calcAge(myPatientProfile.birthdate)} / ${myPatientProfile.sex}`;
    document.getElementById('p-date').innerText = utils.formatDate(rx.date);
    document.getElementById('p-id').innerText = rx.id;

    document.getElementById('p-items').innerHTML = rx.items.map(i => `
        <tr style="border-bottom: 1px dashed #ccc;">
            <td style="padding: var(--space-8) 0;"><strong>${utils.escapeHTML(i.medicine)}</strong></td>
            <td>${utils.escapeHTML(i.dosage)}</td>
            <td>${utils.escapeHTML(i.frequency)} for ${utils.escapeHTML(i.durationDays)} days<br><span style="font-size:var(--fs-xs); color:#666;">${utils.escapeHTML(i.instructions)}</span></td>
        </tr>
    `).join('');

    document.getElementById('p-notes').innerText = rx.notes || 'None';

    const d = await api.getDoctorById(rx.doctorId);
    document.getElementById('p-doctor').innerText = d ? utils.formatDoctorName(d.name) : 'Unknown';

    utils.openModal('print-rx-modal');
};