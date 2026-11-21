let myPatientProfile = null;
let timerInterval = null;
let countdownInterval = null;
let connectTimeout = null;
let localStream = null;
let callSeconds = 0;
let rating = 0;
let currentDoctorName = '';

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) {
        await renderAppointments();
        countdownInterval = setInterval(renderAppointments, 60000);
    }
});

window.addEventListener('primecare:rolechange', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) await renderAppointments();
});

async function renderAppointments() {
    const appts = await api.getMyTelehealthAppointments();
    const list = $('appt-list');
    if (!list) return;

    if (appts.length === 0) {
        list.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div style="font-size: 32px; margin-bottom: 8px;">🖥️</div>
                <strong style="color: var(--color-primary);">No upcoming telehealth appointments</strong>
                <p style="margin-top: 4px;">Book an appointment and choose "telehealth" as the visit type.</p>
                <a href="book-appointment.html" class="btn btn-primary" style="margin-top: 16px;">Book Appointment</a>
            </div>`;
        return;
    }

    const now = new Date();

    const cards = await Promise.all(appts.map(async a => {
        const isConfirmed = a.status === 'Confirmed';
        const form = await api.getPreVisitForm(a.id);
        const hasForm = form !== undefined;

        const apptDate = new Date(a.date + 'T' + a.time);
        const diffMins = (apptDate - now) / (1000 * 60);
        const isWindowOpen = diffMins <= 15 && diffMins >= -30;

        let action;
        if (isConfirmed && hasForm) {
            action = `<button class="btn btn-outline" disabled title="External video link provided directly by clinic">External Video Link Required</button>
                      <div class="th-reason">In-app video streaming is unavailable. Check with the clinic for your link.</div>`;
        } else {
            let reason = 'Complete pre-visit form after confirmation';
            if (!isConfirmed) reason = 'Waiting for staff confirmation';
            else if (!hasForm) reason = 'Pre-visit form required';
            action = `<button class="btn btn-outline" disabled title="${utils.escapeHTML(reason)}">Video Unavailable 🔒</button>
                      <div class="th-reason">${utils.escapeHTML(reason)}</div>`;
        }

        return `
        <div class="card th-card">
            <div class="th-head">
                <div>
                    <div class="th-when">${utils.formatDate(a.date)} at ${utils.formatTime(a.time)}</div>
                    <div class="th-doctor">${utils.formatDoctorName(a.doctorName)}</div>
                </div>
                <span class="badge badge-${isConfirmed ? 'success' : 'warning'}">${utils.escapeHTML(a.status)}</span>
            </div>

            <div class="th-checklist">
                <div class="th-check">
                    <span>${isConfirmed ? '✅' : '⏳'}</span> Appointment confirmed
                </div>
                <div class="th-check">
                    <span>${hasForm ? '✅' : '❌'}</span> Pre-visit questionnaire
                    ${!hasForm && isConfirmed ? `<button class="btn btn-sm btn-outline" style="margin-left: auto;" onclick="openPreVisitForm('${a.id}')">Complete Now</button>` : ''}
                </div>
                <div class="th-check">
                    <span>${isWindowOpen ? '✅' : '⏳'}</span> Join window open
                </div>
            </div>

            <div class="th-actions">${action}</div>
        </div>`;
    }));

    list.innerHTML = cards.join('');
}

window.openPreVisitForm = function (apptId) {
    $('pv-apptId').value = apptId;
    $('pv-symptoms').value = '';
    $('pv-duration').value = '';
    $('pv-meds').value = '';
    $('pv-allergies').value = myPatientProfile.allergies || 'None';
    $('pv-temp').value = '';
    $('pv-consent').checked = false;
    $('pv-alert').innerHTML = '';
    utils.openModal('previsit-modal');
};

window.submitPreVisit = async function () {
    const data = {
        symptoms: $('pv-symptoms').value.trim(),
        symptomDuration: $('pv-duration').value.trim(),
        currentMedications: $('pv-meds').value.trim(),
        temperatureC: $('pv-temp').value,
        consent: $('pv-consent').checked
    };

    const res = await api.submitPreVisitForm($('pv-apptId').value, data);
    if (res.success) {
        utils.closeModal('previsit-modal');
        utils.showToast(res.message, 'success');
        await renderAppointments();
    } else {
        utils.showAlert('pv-alert', 'danger', res.message);
    }
};

window.joinCall = async function () {
    utils.showAlert(
        'alert-container',
        'info',
        'In-app video consultations are unavailable in this environment. Your confirmed clinic video link will be sent directly by staff.'
    );
};

window.toggleMic = function () {};
window.toggleCam = function () {};
window.endCall = function () {};
window.toggleChat = function () {};
window.sendChat = function () {};
window.setStars = function () {};
window.submitFeedback = function () {};