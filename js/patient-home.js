let myPatientProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) {
        document.getElementById('welcome-msg').innerText = `Welcome, ${myPatientProfile.firstName}!`;
        await initUI();
        await loadDashboard();
    }
});

window.addEventListener('primecare:rolechange', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) {
        document.getElementById('welcome-msg').innerText = `Welcome, ${myPatientProfile.firstName}!`;
        await initUI();
        await loadDashboard();
    }
});

async function initUI() {
    const dSelect = document.getElementById('b-doctor');
    if(dSelect) {
        dSelect.innerHTML = '<option value="">Select Doctor...</option>';
        const docGroups = await api.getDoctorsBySpecialization();
        for (const spec in docGroups) {
            const group = document.createElement('optgroup');
            group.label = spec;
            docGroups[spec].forEach(d => group.appendChild(new Option(utils.formatDoctorName(d.name), d.id)));
            dSelect.appendChild(group);
        }
    }
    const bDate = document.getElementById('b-date');
    if(bDate) bDate.min = new Date().toLocaleDateString('en-CA');
}

async function loadDashboard() {
    const ctx = await api._getPatientContext();
    if (ctx.error) return;

    const p = ctx.patient;
    document.getElementById('welcome-msg').innerText = `Welcome, ${p.firstName}!`;
    document.getElementById('p-id').innerText = p.id;
    
    let sBadge = 'success'; if (p.status === 'pending') sBadge = 'warning'; if (p.status === 'rejected') sBadge = 'danger';
    document.getElementById('p-status').innerHTML = `<span class="badge badge-${sBadge}">${p.status.toUpperCase()}</span>`;

    const bannerDiv = document.getElementById('status-banner');
    if (p.status === 'pending') {
        bannerDiv.innerHTML = `
            <div class="card" style="border-left: 4px solid var(--color-warning); background: var(--color-warning-bg);">
                <h3 style="color: var(--color-warning); margin-bottom: 8px;">Your account is under review</h3>
                <p style="font-size: 14px; margin-bottom: 16px;">Our staff is currently verifying your identity. You can view your portal, but booking is disabled.</p>
                <div style="display: flex; gap: 16px; font-size: 13px; align-items: center;">
                    <span style="color: var(--color-success); display: flex; align-items: center; gap: 4px;"><span style="width:16px;height:16px">${ICONS.check}</span> Registration submitted</span> &rarr;
                    <strong style="color: var(--color-warning); display: flex; align-items: center; gap: 4px;"><span style="width:16px;height:16px">${ICONS.clock}</span> Under staff review</strong> &rarr;
                    <span style="color: var(--color-text-muted); display: flex; align-items: center; gap: 4px;"><span style="width:16px;height:16px">${ICONS.check}</span> Verified</span>
                </div>
            </div>`;
    } else if (p.status === 'rejected') {
        bannerDiv.innerHTML = `
            <div class="card" style="border-left: 4px solid var(--color-danger); background: var(--color-danger-bg);">
                <h3 style="color: var(--color-danger); margin-bottom: 8px;">Account Rejected</h3>
                <p style="font-size: 14px;">Reason: <strong>${utils.escapeHTML(p.rejectionReason)}</strong></p>
                <p style="font-size: 14px; margin-top: 8px;">Please visit the hospital registration desk with a valid ID to correct your details.</p>
            </div>`;
    } else {
        bannerDiv.innerHTML = '';
    }

    const dash = await api.getMyDashboard();
    if (!dash) return;

    const apptDiv = document.getElementById('next-appt');
    if (!dash.nextAppointment) {
        apptDiv.innerHTML = `
            <div class="empty-state" style="padding: 32px 16px;">
                <div style="color: var(--color-primary); margin-bottom: 16px; width: 48px; height: 48px;">${ICONS.appointments}</div>
                <p style="color: var(--color-text-muted); margin-bottom: 16px;">No upcoming appointments.</p>
                <a href="book-appointment.html" class="btn btn-primary">Book Now</a>
            </div>`;
    } else {
        const a = dash.nextAppointment;
        let badge = a.status === 'Confirmed' ? 'success' : 'warning';
        let action = '';
        if (a.type === 'telehealth' && a.status === 'Confirmed') {
            action = `<a href="telehealth.html" class="btn btn-sm btn-primary">Join Call</a>`;
        }
        apptDiv.innerHTML = `
            <div style="padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                    <div>
                        <div style="font-size: 20px; font-weight: bold; color: var(--color-primary);">${utils.formatDate(a.date)}</div>
                        <div style="color: var(--color-text-muted); font-size: 14px;">${utils.formatTime(a.time)}</div>
                    </div>
                    <span class="badge badge-${badge}">${a.status}</span>
                </div>
                <div style="margin-bottom: 16px; font-size: 14px;">
                    <strong>${utils.formatDoctorName(a.doctorName)}</strong><br>
                    <span style="font-size: 13px; color: var(--color-text-muted);">${a.type}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border); padding-top: 16px;">
                    <a href="book-appointment.html?tab=my" style="font-size: 13px; color: var(--color-text-muted); text-decoration: underline;">Manage</a>
                    ${action}
                </div>
            </div>
            ${dash.upcomingCount > 1 ? `<div style="font-size: 12px; color: var(--color-text-muted); text-align: center; margin-top: 12px;">+ ${dash.upcomingCount - 1} more upcoming</div>` : ''}
        `;
    }

    document.getElementById('unpaid-bal').innerText = utils.formatCurrency(dash.unpaidBalance);

    const labDiv = document.getElementById('latest-labs');
    if (dash.latestLabs.length === 0) {
        labDiv.innerHTML = '<div class="empty-state" style="padding: 32px 16px;"><div style="color: var(--color-text-muted);">No recent lab results.</div></div>';
    } else {
        labDiv.innerHTML = dash.latestLabs.map(l => {
            let fBadge = '';
            if (l.flag === 'Normal') fBadge = '<span class="badge badge-success">Normal</span>';
            else if (l.flag === 'Abnormal') fBadge = '<span class="badge badge-warning">Abnormal</span>';
            else if (l.flag === 'Critical') fBadge = '<span class="badge badge-danger">Critical</span>';
            return `
            <div style="padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong style="color: var(--color-text); font-size: 14px;">${utils.escapeHTML(l.testName)}</strong><br>
                    <span style="font-size: 12px; color: var(--color-text-muted);">${utils.formatDate(l.resultDate)}</span>
                </div>
                <div>${fBadge}</div>
            </div>`;
        }).join('');
    }
    
    const quickActionsDiv = document.querySelector('.grid-2[style="gap: 16px;"]');
    if(quickActionsDiv) {
        quickActionsDiv.innerHTML = `
            <a href="book-appointment.html" class="btn btn-outline" style="padding: 16px; text-align: center; display: flex; flex-direction: column; height: auto; gap: 8px;"><span style="color: var(--color-primary); width: 24px; height: 24px;">${ICONS.appointments}</span> Book Appointment</a>
            <a href="my-records.html" class="btn btn-outline" style="padding: 16px; text-align: center; display: flex; flex-direction: column; height: auto; gap: 8px;"><span style="color: var(--color-primary); width: 24px; height: 24px;">${ICONS.records}</span> My Records</a>
            <a href="telehealth.html" class="btn btn-outline" style="padding: 16px; text-align: center; display: flex; flex-direction: column; height: auto; gap: 8px;"><span style="color: var(--color-primary); width: 24px; height: 24px;">${ICONS.telehealth}</span> Join Telehealth</a>
            <a href="profile.html" class="btn btn-outline" style="padding: 16px; text-align: center; display: flex; flex-direction: column; height: auto; gap: 8px;"><span style="color: var(--color-primary); width: 24px; height: 24px;">${ICONS.profile}</span> Update Profile</a>
        `;
    }
}