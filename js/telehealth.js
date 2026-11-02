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
        if (isConfirmed && hasForm && isWindowOpen) {
            action = `<button class="btn btn-primary" onclick="joinCall('${a.id}')">Join Call</button>`;
        } else {
            let reason = 'Join window opens 15 mins before';
            if (!isConfirmed) reason = 'Waiting for staff confirmation';
            else if (!hasForm) reason = 'Pre-visit form required';
            else if (diffMins < -30) reason = 'Appointment missed';
            action = `<button class="btn btn-outline" disabled title="${utils.escapeHTML(reason)}">Join Call 🔒</button>
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

window.joinCall = async function (apptId) {
    const check = await api.canJoinTelehealth(apptId);
    if (!check.allowed) return utils.showAlert('alert-container', 'danger', check.reason);

    const appt = (await api.getMyTelehealthAppointments()).find(a => a.id === apptId);
    currentDoctorName = utils.formatDoctorName(appt ? appt.doctorName : 'Unknown');

    $('lobby-view').style.display = 'none';
    $('call-view').style.display = 'block';
    $('call-doc-name').innerText = currentDoctorName;
    $('call-timer').innerText = '00:00';

    startWaitingRoom();
};

async function startWaitingRoom() {
    const waiting = $('waiting-msg');
    const remote = $('doctor-video');

    waiting.style.display = 'flex';
    remote.style.display = 'none';
    remote.innerHTML = '';
    $('chat-messages').innerHTML = '<div class="chat-note">Chat started</div>';
    $('chat-panel').classList.remove('open');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        $('local-video').srcObject = localStream;
        $('no-cam-msg').style.display = 'none';
    } catch (err) {
        console.warn('Camera access denied or unavailable:', err);
        $('no-cam-msg').style.display = 'block';
    }

    clearTimeout(connectTimeout);
    connectTimeout = setTimeout(() => {
        if ($('call-view').style.display !== 'block') return;
        waiting.style.display = 'none';
        remote.innerHTML = `
            <div class="remote-avatar">${ICONS.doctors}</div>
            <h2>${utils.escapeHTML(currentDoctorName)}</h2>
            <p>Connected</p>`;
        remote.style.display = 'block';
        startTimer();
    }, 8000);
}

function startTimer() {
    clearInterval(timerInterval);
    callSeconds = 0;
    timerInterval = setInterval(() => {
        callSeconds++;
        const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const s = String(callSeconds % 60).padStart(2, '0');
        $('call-timer').innerText = `${m}:${s}`;
    }, 1000);
}

window.toggleMic = function () {
    const btn = $('btn-mic');
    if (localStream && localStream.getAudioTracks().length > 0) {
        const track = localStream.getAudioTracks()[0];
        track.enabled = !track.enabled;
        btn.innerText = track.enabled ? '🎤' : '🔇';
        btn.className = track.enabled ? 'control-btn normal' : 'control-btn danger';
    }
};

window.toggleCam = function () {
    const btn = $('btn-cam');
    if (localStream && localStream.getVideoTracks().length > 0) {
        const track = localStream.getVideoTracks()[0];
        track.enabled = !track.enabled;
        btn.innerText = track.enabled ? '📷' : '🚫';
        btn.className = track.enabled ? 'control-btn normal' : 'control-btn danger';
    }
};

window.endCall = function () {
    clearInterval(timerInterval);
    clearTimeout(connectTimeout);
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        $('local-video').srcObject = null;
    }

    // reset control buttons for the next call
    $('btn-mic').innerText = '🎤'; $('btn-mic').className = 'control-btn normal';
    $('btn-cam').innerText = '📷'; $('btn-cam').className = 'control-btn normal';

    $('call-view').style.display = 'none';
    $('lobby-view').style.display = 'block';

    setStars(0);
    $('fb-comment').value = '';
    utils.openModal('feedback-modal');
};

window.toggleChat = function () {
    $('chat-panel').classList.toggle('open');
};

function addChatMessage(kind, who, text) {
    const box = $('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${kind}`;
    div.innerHTML = `<strong>${who}:</strong> ${utils.escapeHTML(text)}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

window.sendChat = function () {
    const input = $('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    addChatMessage('me', 'You', msg);
    input.value = '';

    setTimeout(() => {
        if ($('call-view').style.display === 'block') {
            receiveChat("I understand. Let's discuss that.");
        }
    }, 3000);
};

function receiveChat(msg) {
    addChatMessage('doctor', 'Doctor', msg);
    if (!$('chat-panel').classList.contains('open')) toggleChat();
}

window.setStars = function (num) {
    rating = num;
    const spans = $('star-rating').children;
    for (let i = 0; i < 5; i++) {
        spans[i].innerText = i < num ? '★' : '☆';
        spans[i].style.color = i < num ? 'var(--color-warning)' : 'var(--color-text-muted)';
    }
};

window.submitFeedback = function () {
    utils.closeModal('feedback-modal');
    utils.showToast('Thank you for your feedback!', 'success');
};