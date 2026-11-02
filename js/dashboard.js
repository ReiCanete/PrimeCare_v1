document.addEventListener('DOMContentLoaded', async () => {
    const user = await api.getCurrentUser();
    if (user) await renderDashboard(user.role);
});

window.addEventListener('primecare:rolechange', async (e) => {
    await renderDashboard(e.detail);
});

window.refreshDashboard = async function() {
    const user = await api.getCurrentUser();
    if (user) await renderDashboard(user.role);
};

async function renderDashboard(role) {
    const user = await api.getCurrentUser();
    const stats = await api.getStats();
    
    const hour = new Date().getHours();
    let greeting = 'Good evening';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 18) greeting = 'Good afternoon';
    
    const hints = {
        admin: 'System overview and hospital metrics are looking good.',
        doctor: 'You have appointments scheduled for today.',
        nurse: 'Check the ward occupancy and critical labs.',
        staff: 'Please review pending patient verifications.'
    };

    document.getElementById('greeting-card').innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
                <h1 style="margin-bottom: 4px;">${greeting}, ${utils.escapeHTML(user.fullName)}</h1>
                <p style="color: var(--color-text-muted); margin: 0;">${hints[role]}</p>
            </div>
            <span class="badge badge-neutral" style="text-transform: uppercase;">${role}</span>
        </div>
        <div style="margin-top: 16px; font-size: 13px; color: var(--color-text-muted); display: flex; align-items: center; gap: 8px;">
            <span class="menu-icon" style="width: 16px; height: 16px;">${ICONS.appointments || '📅'}</span> ${new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
        <div class="greeting-actions" style="margin-top: 16px;">
             <button class="btn btn-sm btn-outline" onclick="refreshDashboard()">↻ Refresh</button>
        </div>
    `;

    document.getElementById('last-updated').innerText = `Last updated: ${new Date().toLocaleTimeString()}`;

    document.getElementById('main-stats').innerHTML = `
        <div class="card stat-card row-clickable" onclick="window.location.href='patient-records.html'">
            <h3>Total Patients</h3>
            <div class="value" id="val-pat">0</div>
            <div class="stat-icon">${ICONS.users}</div>
        </div>
        <div class="card stat-card row-clickable" onclick="window.location.href='doctor-management.html'">
            <h3>Total Doctors</h3>
            <div class="value" id="val-doc">0</div>
            <div class="stat-icon">${ICONS.doctors}</div>
        </div>
        <div class="card stat-card row-clickable" onclick="window.location.href='appointments.html'">
            <h3>Appointments Today</h3>
            <div class="value" id="val-app">0</div>
            <div class="stat-icon">${ICONS.appointments}</div>
        </div>
        <div class="card stat-card row-clickable" onclick="window.location.href='billing.html'">
            <h3>Pending Bills</h3>
            <div class="value" id="val-bil">0</div>
            <div class="stat-icon">${ICONS.billing}</div>
        </div>
    `;
    animateValue('val-pat', 0, stats.totalPatients, 1000);
    animateValue('val-doc', 0, stats.totalDoctors, 1000);
    animateValue('val-app', 0, stats.appointmentsToday, 1000);
    animateValue('val-bil', 0, stats.pendingBills, 1000);

    let roleStatsHTML = '';
    if (role === 'admin') {
        roleStatsHTML = `
            <div class="card stat-card"><h3>Pending Verifications</h3><div class="value" style="color: var(--color-warning);">${stats.pendingVerifications}</div></div>
            <div class="card stat-card"><h3>Admitted Inpatients</h3><div class="value">${stats.admittedInpatients}</div></div>
            <div class="card stat-card"><h3>Available Beds</h3><div class="value" style="color: var(--color-success);">${stats.availableBeds}</div></div>
        `;
    } else if (role === 'doctor') {
        const doctors = await api.getDoctors();
        const myDoc = doctors.find(d => d.userId === user.id);
        const myDocId = myDoc ? myDoc.id : 'None';
        const todaysAppts = await api.getTodaysAppointments();
        const myAppts = todaysAppts.filter(a => a.doctorId === myDocId).length;
        roleStatsHTML = `
            <div class="card stat-card"><h3>My Appointments Today</h3><div class="value">${myAppts}</div></div>
            <div class="card stat-card"><h3>Critical Lab Results</h3><div class="value" style="color: var(--color-danger);">${stats.criticalLabResults}</div></div>
        `;
    } else if (role === 'nurse') {
        roleStatsHTML = `
            <div class="card stat-card"><h3>Available Beds</h3><div class="value" style="color: var(--color-success);">${stats.availableBeds}</div></div>
            <div class="card stat-card"><h3>Admitted Inpatients</h3><div class="value">${stats.admittedInpatients}</div></div>
            <div class="card stat-card"><h3>Critical Lab Results</h3><div class="value" style="color: var(--color-danger);">${stats.criticalLabResults}</div></div>
        `;
    } else if (role === 'staff') {
        roleStatsHTML = `
            <div class="card stat-card"><h3>Pending Verifications</h3><div class="value" style="color: var(--color-warning);">${stats.pendingVerifications}</div></div>
            <div class="card stat-card"><h3>Unpaid Bills</h3><div class="value" style="color: var(--color-danger);">${stats.pendingBills}</div></div>
        `;
    }
    document.getElementById('role-stats').innerHTML = roleStatsHTML;

    let appts = await api.getTodaysAppointments();
    if (role === 'doctor') {
        const doctors = await api.getDoctors();
        const myDoc = doctors.find(d => d.userId === user.id);
        appts = appts.filter(a => a.doctorId === (myDoc ? myDoc.id : 'None'));
    }

    const th = document.getElementById('appt-table-head');
    if (role === 'doctor' || role === 'nurse') {
        th.innerHTML = `<th>Time</th><th>Patient</th><th>Type</th><th>Status</th>`;
    } else {
        th.innerHTML = `<th>Time</th><th>Patient</th><th>Doctor</th><th>Status</th><th class="text-right">Action</th>`;
    }

    const tb = document.getElementById('appt-table-body');
    if (appts.length === 0) {
        tb.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 2rem;">No appointments today.</td></tr>`;
    } else {
        tb.innerHTML = appts.map(a => {
            let badge = 'info';
            if (a.status === 'Confirmed') badge = 'success';
            if (a.status === 'Pending') badge = 'warning';
            if (a.status === 'Cancelled') badge = 'danger';

            let row = `<td><strong>${utils.formatTime(a.time)}</strong></td><td>${utils.escapeHTML(a.patientName)}</td>`;
            if (role !== 'doctor' && role !== 'nurse') row += `<td>${utils.formatDoctorName(a.doctorName)}</td>`;
            if (role === 'doctor' || role === 'nurse') row += `<td><span class="badge badge-neutral">${a.type}</span></td>`;
            
            row += `<td><span class="badge badge-${badge}">${a.status}</span></td>`;
            
            if (role === 'admin' || role === 'staff') {
                row += `
                <td class="actions-cell">
                    <select class="status-select" onchange="changeApptStatus('${a.id}', this.value)">
                        <option value="">Update...</option>
                        <option value="Confirmed">Confirm</option>
                        <option value="Completed">Complete</option>
                        <option value="Cancelled">Cancel</option>
                    </select>
                </td>`;
            }
            return `<tr>${row}</tr>`;
        }).join('');
    }

    const actions = {
        admin: [
            { icon: ICONS.registration, label: 'Register Patient', link: 'patient-registration.html' }, { icon: ICONS.doctors, label: 'Add Doctor', link: 'doctor-management.html' },
            { icon: ICONS.appointments, label: 'New Appointment', link: 'appointments.html' }, { icon: ICONS.reports, label: 'Generate Report', link: 'reports.html' },
            { icon: ICONS.users, label: 'Manage Users', link: 'user-management.html' }, { icon: ICONS.records, label: 'Treatment', link: 'medical-records.html' }, 
            { icon: ICONS.billing, label: 'Billing', link: 'billing.html' }
        ],
        doctor: [
            { icon: ICONS.records, label: 'Consult', link: 'medical-records.html' }, { icon: ICONS.prescriptions, label: 'e-Prescription', link: 'prescriptions.html' },
            { icon: ICONS.labs, label: 'Lab Results', link: 'lab-results.html' }, { icon: ICONS.appointments, label: 'My Schedule', link: 'appointments.html' }
        ],
        nurse: [
            { icon: ICONS.wards, label: 'Ward & Beds', link: 'wards.html' }, { icon: ICONS.patients, label: 'Patient Records', link: 'patient-records.html' },
            { icon: ICONS.records, label: 'Medical Records', link: 'medical-records.html' }
        ],
        staff: [
            { icon: ICONS.registration, label: 'Register Patient', link: 'patient-registration.html' }, { icon: ICONS.appointments, label: 'New Appointment', link: 'appointments.html' },
            { icon: ICONS.billing, label: 'Billing', link: 'billing.html' }, { icon: ICONS.check, label: 'Verify Patients', link: 'patient-records.html?filter=pending' },
            { icon: ICONS.records, label: 'Consult', link: 'medical-records.html' }
        ]
    };
    document.getElementById('quick-actions').innerHTML = actions[role].map(a => `
        <a href="${a.link}" class="action-btn">
            <span class="icon" style="color: var(--color-primary);">${a.icon}</span>
            <span>${a.label}</span>
        </a>
    `).join('');

    const secPending = document.getElementById('section-pending');
    const secLabs = document.getElementById('section-labs');
    secPending.style.display = 'none';
    secLabs.style.display = 'none';

    if (role === 'admin' || role === 'staff') {
        secPending.style.display = 'block';
        const pending = await api.getPendingVerifications();
        if (pending.length === 0) {
            document.getElementById('pending-list').innerHTML = `<div class="empty-state"><div style="text-align: center; color: var(--color-text-muted); padding: 1rem;">All caught up!</div></div>`;
        } else {
            document.getElementById('pending-list').innerHTML = pending.map(p => `
                <div class="list-item">
                    <div>
                        <strong>${utils.escapeHTML(p.fullName)}</strong><br>
                        <span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${p.idType}</span>
                    </div>
                    <button class="btn btn-sm btn-outline" onclick="window.location.href='patient-records.html?filter=pending'">Review</button>
                </div>
            `).join('');
        }
    }

    if (role === 'admin' || role === 'doctor' || role === 'nurse') {
        secLabs.style.display = 'block';
        const labs = await api.getCriticalLabResults();
        if (labs.length === 0) {
            document.getElementById('labs-list').innerHTML = `<div class="empty-state"><div style="text-align: center; color: var(--color-text-muted); padding: 1rem;">No critical results.</div></div>`;
        } else {
            document.getElementById('labs-list').innerHTML = labs.map(l => `
                <div class="list-item" style="border-left: 4px solid var(--color-danger);">
                    <div>
                        <strong>${utils.escapeHTML(l.patientName)}</strong><br>
                        <span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${utils.escapeHTML(l.testName)}: ${utils.escapeHTML(l.result)}</span>
                    </div>
                    <span class="badge badge-danger">Critical</span>
                </div>
            `).join('');
        }
    }

    // Fix: Bar Chart Layout
    const chartData = await api.getAppointmentsPerDay();
    const maxCount = Math.max(...chartData.map(d => d.count), 5);
    document.getElementById('appt-chart').innerHTML = chartData.map(d => {
        const pct = (d.count / maxCount) * 100;
        return `
        <div class="chart-col">
            <div class="chart-track">
                <div class="chart-value">${d.count}</div>
                <div class="chart-bar" style="height: ${pct}%;"></div>
            </div>
            <div class="chart-label" title="${d.date}">${d.date}</div>
        </div>`;
    }).join('');

    // Fix: Ward Occupancy Pie Chart
    const wards = await api.getWardOccupancy();
    let totalBeds = 0;
    let occupiedBeds = 0;
    
    let wardDetailsHTML = wards.map(w => {
        totalBeds += w.total;
        occupiedBeds += w.occupied;
        return `<div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; color: var(--color-text);">
                    <span>${utils.escapeHTML(w.name)}</span>
                    <strong>${w.occupied}/${w.total}</strong>
                </div>`;
    }).join('');

    const occPct = totalBeds === 0 ? 0 : Math.round((occupiedBeds / totalBeds) * 100);
    const availPct = 100 - occPct;

    document.getElementById('ward-progress').innerHTML = `
        <div style="display: flex; align-items: center; gap: 24px;">
            <div class="pie-chart" style="background: conic-gradient(var(--color-danger) 0% ${occPct}%, var(--color-success) ${occPct}% 100%);"></div>
            <div class="pie-legend" style="flex: 1;">
                <div class="legend-item">
                    <div class="legend-color" style="background: var(--color-danger);"></div>
                    <span style="flex: 1;">Occupied</span>
                    <strong>${occupiedBeds} (${occPct}%)</strong>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: var(--color-success);"></div>
                    <span style="flex: 1;">Available</span>
                    <strong>${totalBeds - occupiedBeds} (${availPct}%)</strong>
                </div>
                <hr style="border: 0; border-top: 1px solid var(--color-border); margin: 8px 0;">
                ${wardDetailsHTML}
            </div>
        </div>
    `;

    const activity = await api.getRecentActivity();
    if (activity.length === 0) {
        document.getElementById('recent-activity').innerHTML = `<div class="empty-state"><div style="color: var(--color-text-muted);">No recent activity.</div></div>`;
    } else {
        document.getElementById('recent-activity').innerHTML = activity.map(a => {
            let iconSvg = ICONS.check;
            if (a.icon === '👤') iconSvg = ICONS.profile;
            if (a.icon === '💳') iconSvg = ICONS.billing;
            
            return `
            <div class="timeline-item">
                <div class="timeline-icon">${iconSvg}</div>
                <div class="timeline-content">
                    <div class="timeline-text">${utils.escapeHTML(a.text)}</div>
                    <div class="timeline-time">${a.time}</div>
                </div>
            </div>
        `}).join('');
    }
}

window.changeApptStatus = async function(id, status) {
    if (!status) return;
    const res = await api.updateAppointmentStatus(id, status);
    if(res.success) {
        utils.showToast(res.message, 'success');
        refreshDashboard();
    } else {
         utils.showToast(res.message, 'danger');
    }
};

function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}