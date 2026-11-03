let currentStep = 1;
let selectedDoctor = null;
let apptFilter = 'upcoming';

document.addEventListener('DOMContentLoaded', async () => {
    await initUI();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'my') switchTab('my-appts');
    if (urlParams.get('doctor')) {
        const d = await api.getDoctorById(urlParams.get('doctor'));
        if (d) selectDoctor(d.id);
    }
});

window.addEventListener('primecare:rolechange', async () => { await initUI(); });

async function initUI() {
    const ctx = await api._getPatientContext();
    if (ctx.error || (ctx.patient && ctx.patient.status !== 'verified')) {
        document.getElementById('booking-wizard').style.display = 'none';
        document.getElementById('locked-state').style.display = 'block';
        if (ctx.error) document.querySelector('#locked-state p').innerText = ctx.error;
    } else {
        document.getElementById('booking-wizard').style.display = 'block';
        document.getElementById('locked-state').style.display = 'none';
        
        const doctors = await api.getDoctors();
        const specs = [...new Set(doctors.filter(d => d.status === 'active').map(d => d.specialization))];
        const specSelect = document.getElementById('b-spec');
        specSelect.innerHTML = '<option value="All">All Specialties</option>' + specs.map(s => `<option value="${s}">${s}</option>`).join('');
        
        await renderDoctors();
        
        const today = new Date();
        const maxDate = new Date(); maxDate.setDate(today.getDate() + 60);
        document.getElementById('b-date').min = today.toLocaleDateString('en-CA');
        document.getElementById('b-date').max = maxDate.toLocaleDateString('en-CA');
        document.getElementById('res-date').min = today.toLocaleDateString('en-CA');
        document.getElementById('res-date').max = maxDate.toLocaleDateString('en-CA');
    }
    await renderMyAppointments();
}

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    const activeTab = document.getElementById(`tab-${tab}`);
    if(activeTab) activeTab.classList.add('active');
    if (tab === 'my-appts') renderMyAppointments();
};

window.renderDoctors = async function() {
    const spec = document.getElementById('b-spec').value;
    let docs = (await api.getDoctors()).filter(d => d.status === 'active');
    if (spec !== 'All') docs = docs.filter(d => d.specialization === spec);

    // Sort doctors by earliest upcoming availability
    const sortedDocs = [...docs].map(d => {
        const avail = utils.getNextDoctorAvailability(d);
        return { doc: d, avail };
    }).sort((a, b) => a.avail.sortRank - b.avail.sortRank);

    const list = document.getElementById('doctor-list');
    if (sortedDocs.length === 0) {
        list.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><div style="text-align: center; color: var(--color-text-muted); padding: 2rem;">No doctors available.</div></div>';
    } else {
        list.innerHTML = sortedDocs.map(({ doc: d, avail }) => {
            let schedText = 'Not set';
            if (Array.isArray(d.schedule)) schedText = d.schedule.map(s => s.day).join(', ');
            else if (typeof d.schedule === 'string') schedText = d.schedule;

            return `
            <div class="card row-clickable" style="padding: 16px; border: 2px solid var(--color-border);" onclick="selectDoctor('${d.id}')">
                <div class="doc-name-cell" style="margin-bottom: 8px;">
                    <div class="doc-avatar-sm">${d.photoInitials || 'DR'}</div>
                    <div>
                        <strong style="color: var(--color-primary);">${utils.escapeHTML(utils.formatDoctorName(d.name))}</strong><br>
                        <span style="font-size: 12px; color: var(--color-text-muted);">${d.specialization}</span>
                    </div>
                </div>

                <div style="margin-bottom: 8px;">
                    <span class="badge ${avail.badgeClass}" style="font-size: 11px; font-weight: 600;">
                        ${avail.statusText}
                    </span>
                </div>

                <div style="font-size: 12px; color: var(--color-text-muted); line-height: 1.6;">
                    <strong>Fee:</strong> ${utils.formatCurrency(d.consultationFee || 0)}<br>
                    <strong>Working Days:</strong> ${schedText}
                </div>
                <div style="margin-top: 12px; font-size: 12px; color: var(--color-accent); font-weight: bold; text-align: right;">
                    Select &amp; Schedule &rarr;
                </div>
            </div>
            `;
        }).join('');
    }
};

window.selectDoctor = async function(id) {
    selectedDoctor = await api.getDoctorById(id);
    document.getElementById('s2-doc-avatar').innerText = selectedDoctor.photoInitials || 'DR';
    document.getElementById('s2-doc-name').innerText = utils.formatDoctorName(selectedDoctor.name);
    document.getElementById('s2-doc-spec').innerText = selectedDoctor.specialization;
    
    // Render distinct Upcoming vs Past schedules for this doctor
    renderDoctorScheduleOverview(selectedDoctor);

    // Auto-select earliest upcoming date if available
    const avail = utils.getNextDoctorAvailability(selectedDoctor);
    if (avail.isAvailable && avail.nextSchedule) {
        document.getElementById('b-date').value = avail.nextSchedule.dateStr;
        await window.loadSlots();
    } else {
        document.getElementById('b-date').value = '';
        document.getElementById('b-slots').innerHTML = '<div style="grid-column: 1/-1; color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 12px; background: var(--color-bg); border-radius: var(--radius-sm);">Select a date to view slots.</div>';
    }

    window.nextStep(1);
};

function renderDoctorScheduleOverview(doctor) {
    const overviewContainer = document.getElementById('doctor-schedule-overview');
    if (!overviewContainer) return;

    const avail = utils.getNextDoctorAvailability(doctor);

    let upcomingHtml = '';
    if (avail.upcomingSchedules.length > 0) {
        upcomingHtml = `
            <div style="margin-bottom: 16px;">
                <h4 style="font-size: 13px; color: var(--color-primary); text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    📅 Upcoming Available Schedules (Next 7 Days)
                </h4>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${avail.upcomingSchedules.map(s => `
                        <button type="button" class="btn btn-sm btn-outline schedule-chip" onclick="pickScheduleDate('${s.dateStr}')" style="padding: 6px 12px; font-size: 12px; text-align: left; border-color: ${s.isActive ? 'var(--color-accent)' : 'var(--color-border)'};">
                            <strong>${s.dayName} (${s.formattedDate})</strong><br>
                            <span style="color: var(--color-text-muted);">${utils.formatTime(s.start)} - ${utils.formatTime(s.end)}</span>
                            ${s.isActive ? '<span class="badge badge-success" style="margin-left: 4px; font-size: 10px;">In Progress</span>' : ''}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    } else {
        upcomingHtml = `
            <div class="alert alert-warning" style="margin-bottom: 16px; font-size: 13px;">
                ⚠️ No upcoming clinic schedules found for this doctor in the next 7 days.
            </div>
        `;
    }

    let pastHtml = '';
    if (avail.pastSchedules.length > 0) {
        pastHtml = `
            <div style="opacity: 0.65; border-top: 1px dashed var(--color-border); padding-top: 12px;">
                <h4 style="font-size: 12px; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 8px;">
                    Past Schedules This Week
                </h4>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${avail.pastSchedules.map(s => `
                        <div style="padding: 6px 10px; font-size: 11px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-muted);">
                            <span style="text-decoration: line-through;">${s.dayName} (${s.formattedDate}): ${utils.formatTime(s.start)} - ${utils.formatTime(s.end)}</span>
                            <span class="badge badge-neutral" style="margin-left: 4px; font-size: 9px;">Completed</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    overviewContainer.innerHTML = upcomingHtml + pastHtml;
}

window.pickScheduleDate = async function(dateStr) {
    document.getElementById('b-date').value = dateStr;
    await window.loadSlots();
};

window.loadSlots = async function() {
    const dateStr = document.getElementById('b-date').value;
    const grid = document.getElementById('b-slots');
    document.getElementById('b-time').value = '';

    if (!dateStr) { grid.innerHTML = '<div style="grid-column: 1/-1; color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 12px; background: var(--color-bg); border-radius: var(--radius-sm);">Select a date to view slots.</div>'; return; }

    const slots = await api.getAvailableSlots(selectedDoctor.id, dateStr);
    if (slots.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; color: var(--color-danger); font-size: 14px; text-align: center; padding: 12px; background: var(--color-danger-bg); border-radius: var(--radius-sm);">Doctor is not in clinic on this day or no slots available.</div>';
        return;
    }

    grid.innerHTML = slots.map(s => `
        <button type="button" class="slot-btn ${s.available ? '' : 'disabled'}" ${!s.available ? 'disabled' : ''} onclick="selectSlot('${s.time}', this)">${utils.formatTime(s.time)}</button>
    `).join('');
};

window.selectSlot = function(time, btn) {
    document.querySelectorAll('#b-slots .slot-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('b-time').value = time;
    utils.showAlert('book-alert', '', '');
};

window.updateCharCount = function() {
    const len = document.getElementById('b-reason').value.length;
    document.getElementById('char-count').innerText = `${len} chars`;
    document.getElementById('char-count').style.color = len < 10 ? 'var(--color-danger)' : 'var(--color-success)';
};

window.nextStep = function(step) {
    utils.showAlert('book-alert', '', '');
    
    // Strict Validation before moving to the next step
    if (step === 1 && !selectedDoctor) {
        return utils.showToast('Please select a doctor first.', 'danger');
    }
    if (step === 2) {
        const dateVal = document.getElementById('b-date').value;
        const timeVal = document.getElementById('b-time').value;
        if (!dateVal || !timeVal) {
            utils.showAlert('book-alert', 'danger', 'Please select both an appointment date and an available time slot.');
            return utils.showToast('Please select a date and time slot.', 'danger');
        }
    }
    if (step === 3) {
        if (document.getElementById('b-reason').value.length < 10) {
            utils.showAlert('book-alert', 'danger', 'Reason for visit must be at least 10 characters.');
            return utils.showToast('Reason must be at least 10 characters.', 'danger');
        }
        document.getElementById('r-doc').innerText = utils.formatDoctorName(selectedDoctor.name);
        document.getElementById('r-spec').innerText = selectedDoctor.specialization;
        document.getElementById('r-date').innerText = utils.formatDate(document.getElementById('b-date').value);
        document.getElementById('r-time').innerText = utils.formatTime(document.getElementById('b-time').value);
        document.getElementById('r-type').innerText = document.getElementById('b-type').value;
        document.getElementById('r-fee').innerText = utils.formatCurrency(selectedDoctor.consultationFee || 0);
        document.getElementById('r-reason').innerText = utils.escapeHTML(document.getElementById('b-reason').value);
    }

    const cur = document.getElementById(`step-${step}`);
    const next = document.getElementById(`step-${step + 1}`);
    if (cur) cur.classList.remove('active');
    if (next) next.classList.add('active');
    updateStepIndicator(step + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.prevStep = function(step) {
    utils.showAlert('book-alert', '', '');
    const cur = document.getElementById(`step-${step}`);
    const prev = document.getElementById(`step-${step - 1}`);
    if (cur) cur.classList.remove('active');
    if (prev) prev.classList.add('active');
    updateStepIndicator(step - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function updateStepIndicator(step) {
    for(let i=1; i<=4; i++) {
        const ind = document.getElementById(`step-ind-${i}`);
        if (!ind) continue;
        ind.className = 'w-step';
        if (i < step) ind.classList.add('completed');
        if (i === step) ind.classList.add('active');
    }
}

window.submitBooking = async function() {
    const data = {
        doctorId: selectedDoctor.id,
        date: document.getElementById('b-date').value,
        time: document.getElementById('b-time').value,
        type: document.getElementById('b-type').value,
        reason: document.getElementById('b-reason').value
    };

    const res = await api.bookMyAppointment(data);
    if (res.success) {
        document.getElementById('booking-wizard').style.display = 'none';
        document.getElementById('booking-success').style.display = 'block';
        await renderMyAppointments();
    } else {
        utils.showAlert('book-alert', 'danger', res.message);
    }
};

window.resetWizard = function() {
    selectedDoctor = null;
    document.getElementById('b-date').value = '';
    document.getElementById('b-time').value = '';
    document.getElementById('b-reason').value = '';
    document.getElementById('b-slots').innerHTML = '<div style="grid-column: 1/-1; color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 12px; background: var(--color-bg); border-radius: var(--radius-sm);">Select a date to view slots.</div>';
    updateCharCount();
    
    document.querySelectorAll('.form-step').forEach(el => el.classList.remove('active'));
    document.getElementById('step-1').classList.add('active');
    updateStepIndicator(1);
    
    document.getElementById('booking-success').style.display = 'none';
    document.getElementById('booking-wizard').style.display = 'block';
};

window.setApptFilter = async function(filter) {
    apptFilter = filter;
    document.querySelectorAll('#tab-my-appts .chip').forEach(c => c.classList.remove('active'));
    const activeChip = document.querySelector(`#tab-my-appts .chip[onclick="setApptFilter('${filter}')"]`);
    if(activeChip) activeChip.classList.add('active');
    await renderMyAppointments();
};

async function renderMyAppointments() {
    const appts = await api.getMyAppointments({ scope: apptFilter });
    const list = document.getElementById('my-appts-list');

    if (appts.length === 0) {
        list.innerHTML = `<div class="empty-state"><div style="text-align: center; color: var(--color-text-muted); padding: 3rem;">No ${apptFilter} appointments found.</div></div>`;
        return;
    }

    const now = new Date();

    list.innerHTML = appts.map(a => {
        let badge = 'info';
        if (a.status === 'Confirmed' || a.status === 'Completed') badge = 'success';
        if (a.status === 'Pending') badge = 'warning';
        if (a.status === 'Cancelled') badge = 'danger';

        const apptDate = new Date(a.date + 'T' + a.time);
        const diffHours = (apptDate - now) / (1000 * 60 * 60);
        const canChange = diffHours > 24;

        let actions = '';
        if (apptFilter === 'upcoming') {
            if (canChange) {
                actions += `<button class="btn btn-sm btn-outline" onclick="openReschedule('${a.id}')">Reschedule</button>`;
                actions += `<button class="btn btn-sm btn-outline" style="margin-left: 8px; color: var(--color-danger); border-color: var(--color-danger);" onclick="promptCancel('${a.id}')">Cancel</button>`;
            } else {
                actions += `<span style="font-size: 12px; color: var(--color-text-muted); cursor: help;" title="Changes not allowed within 24 hours of appointment. Call the clinic.">🔒 Locked</span>`;
            }
            
            if (a.type === 'telehealth' && a.status === 'Confirmed') {
                actions += `<a href="telehealth.html" class="btn btn-sm btn-primary" style="margin-left: 8px;">Join Telehealth</a>`;
            }
        }

        return `
        <div class="card" style="margin-bottom: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                <div>
                    <div style="font-size: 20px; font-weight: bold; color: var(--color-primary);">${utils.formatDate(a.date)}</div>
                    <div style="color: var(--color-text-muted);">${utils.formatTime(a.time)}</div>
                </div>
                <span class="badge badge-${badge}">${a.status}</span>
            </div>
            <div class="grid grid-2" style="font-size: 14px; gap: 8px; margin-bottom: 16px;">
                <div><strong>Doctor:</strong> ${utils.formatDoctorName(a.doctorName)}<br><span style="color: var(--color-text-muted);">${a.specialization}</span></div>
                <div><strong>Type:</strong> <span class="badge badge-neutral">${a.type}</span></div>
                <div style="grid-column: 1/-1;"><strong>Reason:</strong> ${utils.escapeHTML(a.reason)}</div>
                ${a.status === 'Cancelled' ? `<div style="grid-column: 1/-1; color: var(--color-danger);"><strong>Cancel Reason:</strong> ${utils.escapeHTML(a.cancelReason)}</div>` : ''}
            </div>
            <div style="text-align: right; border-top: 1px solid var(--color-border); padding-top: 16px;">
                ${actions}
            </div>
        </div>`;
    }).join('');
}

window.openReschedule = async function(id) {
    const appts = await api.getMyAppointments({ scope: 'upcoming' });
    const a = appts.find(x => x.id === id);
    if (!a) return;

    document.getElementById('res-id').value = a.id;
    document.getElementById('res-docId').value = a.doctorId;
    document.getElementById('res-current').innerText = `${utils.formatDate(a.date)} at ${utils.formatTime(a.time)}`;
    document.getElementById('res-date').value = '';
    document.getElementById('res-time').value = '';
    document.getElementById('res-slots').innerHTML = '<div style="grid-column: 1/-1; color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 12px; background: var(--color-bg); border-radius: var(--radius-sm);">Select a date to view slots.</div>';
    
    utils.openModal('reschedule-modal');
};

window.loadRescheduleSlots = async function() {
    const docId = document.getElementById('res-docId').value;
    const dateStr = document.getElementById('res-date').value;
    const excludeId = document.getElementById('res-id').value || null;
    const grid = document.getElementById('res-slots');
    document.getElementById('res-time').value = '';

    if (!dateStr) return;
    const slots = await api.getAvailableSlots(docId, dateStr, excludeId);
    if (slots.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; color: var(--color-danger); font-size: 14px; text-align: center; padding: 12px; background: var(--color-danger-bg); border-radius: var(--radius-sm);">No available slots on this day.</div>';
        return;
    }
    grid.innerHTML = slots.map(s => `
        <button class="slot-btn" ${!s.available ? 'disabled' : ''} onclick="selectResSlot('${s.time}', this)">${utils.formatTime(s.time)}</button>
    `).join('');
};

window.selectResSlot = function(time, btn) {
    document.querySelectorAll('#res-slots .slot-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('res-time').value = time;
};

window.submitReschedule = async function() {
    const id = document.getElementById('res-id').value;
    const date = document.getElementById('res-date').value;
    const time = document.getElementById('res-time').value;

    if (!date || !time) return utils.showAlert('res-alert', 'danger', 'Please select a new date and time.');

    const res = await api.rescheduleMyAppointment(id, date, time);
    if (res.success) {
        utils.closeModal('reschedule-modal');
        utils.showToast('Appointment rescheduled successfully.', 'success');
        await renderMyAppointments();
    } else {
        utils.showAlert('res-alert', 'danger', res.message);
    }
};

window.promptCancel = function(id) {
    document.getElementById('can-id').value = id;
    document.getElementById('can-reason').value = '';
    utils.openModal('cancel-modal');
};

window.submitCancel = async function() {
    const id = document.getElementById('can-id').value;
    const reason = document.getElementById('can-reason').value.trim();

    const res = await api.cancelMyAppointment(id, reason);
    if (res.success) {
        utils.closeModal('cancel-modal');
        utils.showToast('Appointment cancelled.', 'success');
        await renderMyAppointments();
    } else {
        utils.showAlert('can-alert', 'danger', res.message);
    }
};