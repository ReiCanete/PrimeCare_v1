// js/app.js — Shared Layout, Route Guards, Role Simulator & Utilities for PRIMECARE

// Initialize Theme immediately to prevent flashing
const savedTheme = localStorage.getItem('primecare_theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

const FEATURES = {
    roleSimulator: true,
    notifications: true,
    telehealth: true,
    wards: true,
    labs: true,
    prescriptions: true,
    activityLog: true,
    publicSite: true,
    patientPortal: true
};

const svgBase = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="menu-icon" style="width: 1.2em; height: 1.2em; vertical-align: middle;">';
const ICONS = {
    dashboard: `${svgBase}<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`,
    registration: `${svgBase}<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
    patients: `${svgBase}<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    doctors: `${svgBase}<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle><line x1="12" y1="11" x2="12" y2="14"></line><line x1="10" y1="12.5" x2="14" y2="12.5"></line></svg>`,
    appointments: `${svgBase}<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
    records: `${svgBase}<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>`,
    wards: `${svgBase}<path d="M2 4v16"></path><path d="M2 8h18a2 2 0 0 1 2 2v10"></path><path d="M2 17h20"></path><path d="M6 8v9"></path></svg>`,
    prescriptions: `${svgBase}<path d="M10.5 20.5 19 12a4.95 4.95 0 1 0-7-7L3.5 13.5a4.95 4.95 0 1 0 7 7Z"></path><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"></line></svg>`,
    labs: `${svgBase}<path d="M9 2v2"></path><path d="M15 2v2"></path><path d="M12 2v2"></path><path d="M10 4V2"></path><path d="M14 4V2"></path><path d="M10 4h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"></path><path d="M8 12h8"></path><path d="M8 16h8"></path></svg>`,
    billing: `${svgBase}<rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
    reports: `${svgBase}<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
    users: `${svgBase}<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    home: `${svgBase}<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
    telehealth: `${svgBase}<rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
    profile: `${svgBase}<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    logout: `${svgBase}<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`,
    bell: `${svgBase}<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
    menu: `${svgBase}<line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`,
    x: `${svgBase}<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    moon: `${svgBase}<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
    sun: `${svgBase}<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
    eye: `${svgBase}<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    check: `${svgBase}<polyline points="20 6 9 17 4 12"></polyline></svg>`,
    warning: `${svgBase}<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    clock: `${svgBase}<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    lock: `${svgBase}<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
};

const PAGE_TITLES = {
    'dashboard': 'Dashboard',
    'patient-registration': 'Patient Registration',
    'patient-records': 'Patient Records',
    'doctor-management': 'Doctor Management',
    'appointments': 'Appointments',
    'medical-records': 'Medical Records',
    'wards': 'Ward & Beds',
    'prescriptions': 'e-Prescriptions',
    'lab-results': 'Lab Results',
    'billing': 'Billing',
    'reports': 'Reports',
    'user-management': 'User Management',
    'home': 'Home',
    'book-appointment': 'Book Appointment',
    'my-records': 'My Records',
    'my-bills': 'My Bills',
    'telehealth': 'Telehealth',
    'profile': 'My Profile'
};

const PARENT_PAGES = {
    'wards': 'medical-records',
    'prescriptions': 'medical-records',
    'lab-results': 'medical-records'
};

const MENU_CONFIG = {
    admin: [
        { label: 'Dashboard', page: 'dashboard', icon: ICONS.dashboard, link: '../staff/dashboard.html' },
        { label: 'Patient Records', page: 'patient-records', icon: ICONS.patients, link: '../staff/patient-records.html' },
        { label: 'Appointments', page: 'appointments', icon: ICONS.appointments, link: '../staff/appointments.html' },
        { label: 'Billing', page: 'billing', icon: ICONS.billing, link: '../staff/billing.html' },
        { label: 'Doctor Management', page: 'doctor-management', icon: ICONS.doctors, link: '../staff/doctor-management.html' },
        { label: 'Reports', page: 'reports', icon: ICONS.reports, link: '../staff/reports.html' },
        { label: 'User Management', page: 'user-management', icon: ICONS.users, link: '../staff/user-management.html' }
    ],
    staff: [
        { label: 'Dashboard', page: 'dashboard', icon: ICONS.dashboard, link: '../staff/dashboard.html' },
        { label: 'Patient Registration', page: 'patient-registration', icon: ICONS.registration, link: '../staff/patient-registration.html' },
        { label: 'Patient Records', page: 'patient-records', icon: ICONS.patients, link: '../staff/patient-records.html' },
        { label: 'Appointments', page: 'appointments', icon: ICONS.appointments, link: '../staff/appointments.html' },
        { label: 'Billing', page: 'billing', icon: ICONS.billing, link: '../staff/billing.html' }
    ],
    doctor: [
        { label: 'Dashboard', page: 'dashboard', icon: ICONS.dashboard, link: '../staff/dashboard.html' },
        { label: 'Patient Records', page: 'patient-records', icon: ICONS.patients, link: '../staff/patient-records.html' },
        { label: 'Appointments', page: 'appointments', icon: ICONS.appointments, link: '../staff/appointments.html' },
        { label: 'Medical Records', page: 'medical-records', icon: ICONS.records, link: '../staff/medical-records.html' }
    ],
    nurse: [
        { label: 'Dashboard', page: 'dashboard', icon: ICONS.dashboard, link: '../staff/dashboard.html' },
        { label: 'Patient Records', page: 'patient-records', icon: ICONS.patients, link: '../staff/patient-records.html' },
        { label: 'Ward & Beds', page: 'wards', icon: ICONS.wards, link: '../staff/wards.html' },
        { label: 'Medical Records', page: 'medical-records', icon: ICONS.records, link: '../staff/medical-records.html' }
    ],
    patient: [
        { label: 'Home', page: 'home', icon: ICONS.home, link: '../patient/home.html' },
        { label: 'Book Appointment', page: 'book-appointment', icon: ICONS.appointments, link: '../patient/book-appointment.html' },
        { label: 'My Records', page: 'my-records', icon: ICONS.patients, link: '../patient/my-records.html' },
        { label: 'My Bills', page: 'my-bills', icon: ICONS.billing, link: '../patient/my-bills.html' },
        { label: 'Telehealth', page: 'telehealth', icon: ICONS.telehealth, link: '../patient/telehealth.html' },
        { label: 'My Profile', page: 'profile', icon: ICONS.profile, link: '../patient/profile.html' }
    ]
};

// =============================================================================
// DEV ROLE SIMULATOR (UI-only) — Phase 5.2 notes
// -----------------------------------------------------------------------------
// The simulator is a development convenience for exercising the still-unmigrated
// mock-data screens as another role. It:
//   - NEVER calls PHP and never changes the PHP session, so it grants NO server-side
//     permissions. PHP endpoints use the role stored in the database for the real,
//     logged-in account (requireAuth()/requireRole()).
//   - Is only offered to a user whose REAL PHP-authenticated role is 'admin'.
//     Staff, doctors, nurses and patients never see it and cannot simulate.
//   - Is cleared on every login and logout.
// Set FEATURES.roleSimulator = false to switch it off completely.
// =============================================================================
function isRoleSimulatorAvailable(realUser) {
    const devFlag = FEATURES.roleSimulator || (new URLSearchParams(window.location.search).get('dev') === '1');
    return !!(devFlag && realUser && realUser.role === 'admin');
}

if (typeof api !== 'undefined' && typeof api.getCurrentUser === 'function') {
    const _rawGetCurrentUser = api.getCurrentUser.bind(api);
    api.getRealUser = async () => await _rawGetCurrentUser();

    api.getCurrentUser = async function () {
        const realUser = await _rawGetCurrentUser();
        if (!realUser) return null;

        const simRole = sessionStorage.getItem('primecare_sim_role');
        
        if (isRoleSimulatorAvailable(realUser) && simRole && simRole !== realUser.role) {
            const users = api.getAll ? api.getAll('users') : [];
            const target = users.find(u => u.role === simRole);
            if (target) {
                return Object.assign({}, target, {
                    _isSimulated: true,
                    _realRole: realUser.role,
                    _realName: realUser.fullName
                });
            }
        }
        return realUser;
    };
}

const utils = {
    formatDate: (dateStr) => {
        if (!dateStr) return 'N/A';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    },
    formatTime: (timeStr) => {
        if (!timeStr) return 'N/A';
        const [h, m] = String(timeStr).split(':');
        const date = new Date();
        date.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    },
    formatDateTime: (isoString) => {
        if (!isoString) return 'N/A';
        const normalized = (typeof isoString === 'string' && isoString.includes('T') && !isoString.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(isoString))
            ? isoString + 'Z'
            : isoString;
        const d = new Date(normalized);
        if (isNaN(d.getTime())) return isoString;
        return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
               d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true });
    },
    formatDoctorName: (name) => {
        if (!name) return 'Unknown';
        const clean = String(name).trim().replace(/^(dr\.?\s*)+/i, '');
        return `Dr. ${clean}`;
    },
    formatCurrency: (amount) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount) || 0),
    calcAge: (birthdate) => {
        if (!birthdate) return 0;
        const birth = new Date(birthdate);
        const today = new Date();
        if (isNaN(birth.getTime()) || birth > today) return 0;
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return Math.max(0, age);
    },
    escapeHTML: (str) => {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
    },
    openModal: (id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('active');
            document.body.classList.add('modal-open');
        }
    },
    closeModal: (id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('active');
            if (document.querySelectorAll('.modal.active').length === 0) {
                document.body.classList.remove('modal-open');
            }
        }
    },
    showAlert: (containerId, type, message) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!message) {
            container.innerHTML = '';
            return;
        }
        const alertType = type === 'error' ? 'danger' : type;
        container.innerHTML = `<div class="alert alert-${alertType}">${message}</div>`;
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
            if (container) container.innerHTML = '';
        }, 5000);
    },
    showToast: (message, type = 'info') => {
        let wrap = document.getElementById('toast-container');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'toast-container';
            wrap.className = 'toast-container print-area-hide';
            document.body.appendChild(wrap);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        wrap.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },
    getNextDoctorAvailability: (doctor, referenceDate = new Date()) => {
        if (!doctor || doctor.status !== 'active' || !Array.isArray(doctor.schedule) || doctor.schedule.length === 0) {
            return {
                isAvailable: false,
                statusText: 'No Upcoming Availability',
                badgeClass: 'badge-neutral',
                sortRank: Infinity,
                nextSchedule: null,
                upcomingSchedules: [],
                pastSchedules: []
            };
        }

        const now = new Date(referenceDate);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const fullDayNames = {
            'Sun': 'Sunday', 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday',
            'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday'
        };

        const upcomingSchedules = [];
        const pastSchedules = [];

        // Check a rolling 7-day window (i = 0 is today, up to i = 6)
        for (let i = 0; i < 7; i++) {
            const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
            const yyyy = targetDate.getFullYear();
            const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
            const dd = String(targetDate.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;
            const dayCode = dayNames[targetDate.getDay()];

            // Check if doctor works on this day
            const shift = doctor.schedule.find(s => s.day === dayCode);
            if (!shift) continue;

            const [startH, startM] = (shift.start || '00:00').split(':').map(Number);
            const [endH, endM] = (shift.end || '23:59').split(':').map(Number);

            const shiftStartTime = new Date(yyyy, targetDate.getMonth(), targetDate.getDate(), startH, startM, 0, 0);
            const shiftEndTime = new Date(yyyy, targetDate.getMonth(), targetDate.getDate(), endH, endM, 0, 0);

            const scheduleItem = {
                dayCode,
                dayName: fullDayNames[dayCode] || dayCode,
                dateStr,
                dateObj: targetDate,
                formattedDate: utils.formatDate(dateStr),
                start: shift.start,
                end: shift.end,
                startTime: shiftStartTime,
                endTime: shiftEndTime,
                daysOffset: i
            };

            if (now >= shiftEndTime) {
                // Shift has already ended
                pastSchedules.push({ ...scheduleItem, status: 'Completed' });
            } else {
                // Shift is active or upcoming
                const isActive = (now >= shiftStartTime && now < shiftEndTime);
                upcomingSchedules.push({
                    ...scheduleItem,
                    isActive,
                    status: isActive ? 'In Progress' : 'Upcoming'
                });
            }
        }

        if (upcomingSchedules.length === 0) {
            return {
                isAvailable: false,
                statusText: 'No Upcoming Availability',
                badgeClass: 'badge-neutral',
                sortRank: Infinity,
                nextSchedule: null,
                upcomingSchedules: [],
                pastSchedules
            };
        }

        const next = upcomingSchedules[0];
        let statusText = '';
        let badgeClass = 'badge-success';

        if (next.daysOffset === 0) {
            statusText = next.isActive ? `Available Now (until ${utils.formatTime(next.end)})` : `Available Today (${utils.formatTime(next.start)} - ${utils.formatTime(next.end)})`;
        } else if (next.daysOffset === 1) {
            statusText = `Available Tomorrow (${utils.formatTime(next.start)} - ${utils.formatTime(next.end)})`;
            badgeClass = 'badge-info';
        } else {
            statusText = `Next: ${next.dayName} (${utils.formatTime(next.start)} - ${utils.formatTime(next.end)})`;
            badgeClass = 'badge-secondary';
        }

        return {
            isAvailable: true,
            statusText,
            badgeClass,
            sortRank: next.startTime.getTime(),
            nextSchedule: next,
            upcomingSchedules,
            pastSchedules
        };
    }
};

window.utils = utils;
window.showToast = utils.showToast;

window.toggleTheme = function() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('primecare_theme', next);
    
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.innerHTML = next === 'dark' ? ICONS.sun : ICONS.moon;
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal.active');
        if (modals.length > 0) {
            modals[modals.length - 1].classList.remove('active');
            if (document.querySelectorAll('.modal.active').length === 0) {
                document.body.classList.remove('modal-open');
            }
        }
        document.getElementById('sidebar')?.classList.remove('open');
    }
});

document.addEventListener('click', (e) => {
    // Backdrop click to close modals
    if (e.target && e.target.classList && e.target.classList.contains('modal') && e.target.classList.contains('active')) {
        e.target.classList.remove('active');
        if (document.querySelectorAll('.modal.active').length === 0) {
            document.body.classList.remove('modal-open');
        }
    }
    const dropdown = document.getElementById('notif-dropdown');
    const wrapper = document.querySelector('.notif-wrapper');
    if (dropdown && dropdown.classList.contains('active') && (!wrapper || !wrapper.contains(e.target))) {
        dropdown.classList.remove('active');
    }
    
    const userMenu = document.getElementById('user-menu');
    const userChip = document.querySelector('.user-chip');
    if (userMenu && userMenu.classList.contains('active') && (!userChip || !userChip.contains(e.target))) {
        userMenu.classList.remove('active');
    }
});

function isPatientPending(user) {
    if (!user || user.role !== 'patient') return false;
    if (user.status === 'Pending' || user.verificationStatus === 'Pending' || user.verified === false) return true;
    if (typeof api !== 'undefined' && typeof api.getAll === 'function') {
        const patients = api.getAll('patients') || [];
        const p = patients.find(pt => pt.id === user.patientId || pt.userId === user.id || pt.username === user.username);
        if (p && (p.status === 'pending' || p.status === 'Pending' || p.verificationStatus === 'Pending' || p.verified === false)) {
            return true;
        }
    }
    return false;
}

function enforcePreviewReadOnly() {
    const pageContent = document.getElementById('page-content');
    if (!pageContent) return;

    const lockTargets = pageContent.querySelectorAll(
        'button[type="submit"], .btn-primary, .btn-danger, .payment-tile, input[type="submit"]'
    );
    lockTargets.forEach(btn => {
        const text = btn.textContent.toLowerCase();
        const onclick = (btn.getAttribute('onclick') || '').toLowerCase();
        // Do not disable navigation, stepper, wizard steps, tabs, modal, view, or print buttons
        if (text.includes('view') || text.includes('print') || text.includes('next') || text.includes('back') || text.includes('step') || text.includes('review') || text.includes('close') || text.includes('cancel')) return;
        if (onclick.includes('step') || onclick.includes('tab') || onclick.includes('modal') || onclick.includes('close') || onclick.includes('reset')) return;
        btn.disabled = true;
        btn.classList.add('preview-disabled');
        btn.title = 'Disabled in Preview Mode';
    });

    pageContent.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        utils.showToast('Preview mode is read-only. Actions are disabled.', 'warning');
    }, true);
}

async function renderShell() {
    const area = document.body.getAttribute('data-area');
    if (area === 'public' || area === 'auth') return;

    const isSubFolder = window.location.pathname.includes('/patient/') || window.location.pathname.includes('/staff/');

    // Phase 5.2: the PHP session is the source of truth. Verify it once per page load.
    // me() refreshes the UI cache from the server on success and clears it on 401.
    // If the session is missing/expired (or the server cannot be reached) we fail closed.
    if (api._backendConfig && api._backendConfig.modules.auth && api.auth && !window.__primecareSessionVerified) {
        const session = await api.auth.me();
        if (!session.success) {
            window.location.href = isSubFolder ? '../login.html' : 'login.html';
            return;
        }
        window.__primecareSessionVerified = true;
    }

    const user = await api.getCurrentUser();
    const realUser = typeof api.getRealUser === 'function' ? await api.getRealUser() : user;

    if (!user || !realUser) {
        window.location.href = isSubFolder ? '../login.html' : 'login.html';
        return;
    }

    // Patient role (real or simulated) should not access staff pages
    if (area === 'staff' && user.role === 'patient') {
        window.location.href = '../patient/home.html';
        return;
    }
    
    // Preview mode is active ONLY when staff/admin directly visits patient pages without simulating patient
    const isPreview = area === 'patient' && user.role !== 'patient';
    if (isPreview) {
        localStorage.setItem('primecare_preview', '1');
    } else {
        localStorage.removeItem('primecare_preview');
    }

    const currentPage = document.body.getAttribute('data-page') || '';
    if ((currentPage === 'telehealth' && !FEATURES.telehealth) ||
        (currentPage === 'wards' && !FEATURES.wards) ||
        (currentPage === 'lab-results' && !FEATURES.labs) ||
        (currentPage === 'prescriptions' && !FEATURES.prescriptions)) {
        utils.showToast('This feature is currently disabled.', 'warning');
        window.location.href = user.role === 'patient' ? '../patient/home.html' : '../staff/dashboard.html';
        return;
    }

    const shell = document.getElementById('app-shell');
    if (!shell) return;

    const roleMenu = MENU_CONFIG[user.role === 'patient' ? 'patient' : user.role] || MENU_CONFIG.staff;

    // Only fall back to the parent page if this role has no menu item for the current page
    const hasOwnItem = roleMenu.some(item => item.page === currentPage);
    const activeMenuPage = hasOwnItem ? currentPage : (PARENT_PAGES[currentPage] || currentPage);

const menuItems = roleMenu.map(item => `
        <li>
            <a href="${item.link}" class="${activeMenuPage === item.page ? 'active' : ''}" title="${item.label}">
                <span class="menu-icon">${item.icon}</span>
                <span class="menu-label">${item.label}</span>
            </a>
        </li>
    `).join('');

    const isCollapsed = localStorage.getItem('primecare_sidebar') === 'collapsed';
    const sidebarClass = isCollapsed ? 'sidebar print-area-hide collapsed' : 'sidebar print-area-hide';

    const sidebarHTML = `
        <div class="sidebar-overlay" onclick="document.getElementById('sidebar').classList.remove('open')"></div>
        <aside class="${sidebarClass}" id="sidebar">
            <div class="sidebar-brand">
                <img src="../assets/primecare.png" alt="Logo" class="sidebar-logo" onerror="this.style.display='none'" style="height: 32px; margin-right: 12px; object-fit: contain;">
                <span class="sidebar-brand-text">PRIME<span>CARE</span></span>
            </div>
            <ul class="sidebar-menu">
                ${menuItems}
            </ul>
            <div class="sidebar-footer">
                <a href="#" onclick="handleLogout()" title="Logout">
                    <span class="menu-icon">${ICONS.logout}</span>
                    <span class="menu-label">Logout</span>
                </a>
            </div>
        </aside>
    `;

    let simulatorHTML = '';
    if (isRoleSimulatorAvailable(realUser)) {
        const roles = ['admin', 'doctor', 'nurse', 'staff', 'patient'];
        const roleOptions = roles.map(r =>
            `<option value="${r}" ${user.role === r ? 'selected' : ''}>Simulate: ${r.toUpperCase()}</option>`
        ).join('');
        simulatorHTML = `
            <div class="dev-pill">
                <span class="dev-tag">DEV</span>
                <select class="role-sim-select" onchange="simulateRole(this.value)" title="Role Simulator (UI preview only: does not change your PHP login or server permissions)">
                    ${roleOptions}
                </select>
            </div>
        `;
    }

    let notifHTML = '';
    if (area === 'patient' && FEATURES.notifications) {
        const notifs = (typeof api.getMyNotifications === 'function' ? await api.getMyNotifications() : []) || [];
        const unread = notifs.filter(n => !n.read).length;
        const badge = unread > 0 ? `<div class="notif-badge" id="notif-count">${unread}</div>` : '';

        const notifList = notifs.length === 0
            ? '<div class="notif-item">No notifications.</div>'
            : notifs.slice(0, 5).map(n => `
                <div class="notif-item ${n.read ? '' : 'unread'}" onclick="handleNotifClick('${n.id}', '${n.link}')">
                    <div class="notif-date" style="font-size: 11px; color: var(--color-text-muted); margin-bottom: 4px;">${utils.formatDateTime(n.date)}</div>
                    <strong>${utils.escapeHTML(n.title)}</strong><br>
                    ${utils.escapeHTML(n.message)}
                </div>`).join('');

        notifHTML = `
            <div class="notif-wrapper" onclick="toggleNotifications()">
                <span class="notif-icon">${ICONS.bell}</span>
                ${badge}
                <div class="notif-dropdown" id="notif-dropdown">
                    <div class="notif-header">
                        <span>Notifications</span>
                        ${unread > 0 ? `<a href="#" class="notif-mark-read" style="font-size: 12px; color: var(--color-accent);" onclick="markAllRead(event)">Mark all read</a>` : ''}
                    </div>
                    ${notifList}
                </div>
            </div>
        `;
    }

    const pageTitle = PAGE_TITLES[currentPage] || currentPage.replace(/-/g, ' ');
    const initials = user.fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const themeIcon = currentTheme === 'dark' ? ICONS.sun : ICONS.moon;

    const topbarHTML = `
        <header class="topbar print-area-hide">
            <div class="topbar-left" style="display: flex; align-items: center; gap: 16px;">
                <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open')">${ICONS.menu}</button>
                <button class="sidebar-toggle print-area-hide" onclick="toggleSidebar()">${ICONS.menu}</button>
                <div class="topbar-title">${pageTitle}</div>
            </div>
            <div class="topbar-right">
                <button class="theme-toggle" id="theme-toggle-btn" onclick="toggleTheme()" title="Toggle Dark Mode">
                    ${themeIcon}
                </button>
                ${notifHTML}
                ${simulatorHTML}
                <div style="position: relative;">
                    <div class="user-chip" onclick="document.getElementById('user-menu').classList.toggle('active')">
                        <div class="user-avatar">${initials}</div>
                        <div class="user-meta">
                            <strong>${utils.escapeHTML(user.fullName)}</strong>
                            <span>${user.role}${user._isSimulated ? ' (SIM)' : ''}</span>
                        </div>
                    </div>
                    <div class="user-menu" id="user-menu">
                        <div style="padding: 8px 12px; border-bottom: 1px solid var(--color-border); margin-bottom: 4px;">
                            <strong>${utils.escapeHTML(user.fullName)}</strong><br>
                            <span style="font-size: 11px; color: var(--color-text-muted); text-transform: uppercase;">${user.role}${user._isSimulated ? ' (SIM)' : ''}</span>
                        </div>
                        ${user.role === 'patient' ? `<button onclick="window.location.href='../patient/profile.html'"><span class="menu-icon">${ICONS.profile}</span> My Profile</button>` : ''}
                        <button onclick="handleLogout()"><span class="menu-icon">${ICONS.logout}</span> Logout</button>
                    </div>
                </div>
            </div>
        </header>
    `;

    shell.innerHTML = sidebarHTML + topbarHTML;
    
    if (window.innerWidth > 768) {
        const toggleBtn = document.querySelector('.sidebar-toggle');
        if(toggleBtn) toggleBtn.style.display = 'flex';
    }

    const pageContent = document.getElementById('page-content');
    if (pageContent) {
        const inPreviewMode = isPreview;
        const existingPreview = document.getElementById('preview-banner');
        if (inPreviewMode) {
            if (!existingPreview) {
                const banner = document.createElement('div');
                banner.id = 'preview-banner';
                banner.className = 'alert alert-info print-area-hide';
                banner.style.cssText = 'background: var(--info-bg); color: var(--color-info); border: 1px solid var(--color-border); padding: 1rem; border-radius: 4px; margin-bottom: 1.5rem; font-weight: bold; display: flex; justify-content: space-between; align-items: center;';
                banner.innerHTML = `
                    <span><span class="menu-icon" style="margin-right:8px">${ICONS.eye}</span> <strong>Preview Mode:</strong> Viewing the Patient Portal as <strong>${utils.escapeHTML(user.fullName)}</strong>. Actions are read-only.</span>
                    <button class="btn btn-outline btn-sm" style="background: var(--color-surface);" onclick="simulateRole('${realUser.role}')">Return to Staff Portal</button>
                `;
                pageContent.insertBefore(banner, pageContent.firstChild);
            }
            setTimeout(enforcePreviewReadOnly, 50);
        } else if (existingPreview) {
            existingPreview.remove();
        }

        const existingPending = document.getElementById('pending-banner');
        if (area === 'patient' && isPatientPending(user)) {
            if (!existingPending) {
                const pBanner = document.createElement('div');
                pBanner.id = 'pending-banner';
                pBanner.className = 'alert alert-warning print-area-hide';
                pBanner.innerHTML = `<span class="menu-icon" style="margin-right:8px">${ICONS.clock}</span> <strong>Account Pending Verification:</strong> Your registration is awaiting staff verification. Booking is disabled until verified.`;
                pageContent.insertBefore(pBanner, pageContent.firstChild);
            }
        } else if (existingPending) {
            existingPending.remove();
        }
    }

    if (user.mustChangePassword && !user._isSimulated) injectPasswordModal();
}

function injectPasswordModal() {
    if (document.getElementById('force-pw-modal')) return;
    const modalHtml = `
    <div class="modal active force-pw-overlay" id="force-pw-modal" style="background-color: rgba(15,23,42,0.9); z-index: 9999;">
        <div class="modal-content force-pw-box" style="max-width: 400px;">
            <h2 class="force-pw-title" style="color: var(--color-danger); margin-bottom: 16px;">Change Required</h2>
            <p class="force-pw-desc" style="font-size: 13px; margin-bottom: 24px;">For security reasons, you must change your temporary password before continuing.</p>
            <div id="pw-alert"></div>
            <div class="form-group"><label>Current Password</label><input type="password" id="pw-old" class="form-control"></div>
            <div class="form-group">
                <label>New Password</label>
                <input type="password" id="pw-new" class="form-control">
                <div class="hint">Min 8 chars, 1 uppercase, 1 number</div>
            </div>
            <div class="form-group"><label>Confirm New Password</label><input type="password" id="pw-confirm" class="form-control"></div>
            <button class="btn btn-primary btn-block" style="width: 100%; margin-top: 16px;" onclick="submitPwChange()">Update Password</button>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.submitPwChange = async function () {
    const oldPw = document.getElementById('pw-old').value;
    const newPw = document.getElementById('pw-new').value;
    const confirmPw = document.getElementById('pw-confirm').value;
    if (newPw !== confirmPw) return utils.showAlert('pw-alert', 'danger', 'New passwords do not match.');
    const res = await api.changeOwnPassword(oldPw, newPw);
    if (res.success) {
        document.getElementById('force-pw-modal').remove();
        utils.showToast('Password updated successfully.', 'success');
    } else {
        utils.showAlert('pw-alert', 'danger', res.message);
    }
};

window.simulateRole = async function (role) {
    const realUser = typeof api.getRealUser === 'function' ? await api.getRealUser() : await api.getCurrentUser();
    if (!realUser || realUser.role === 'patient') return;

    // Switching to another role is a UI-only dev feature (admin sessions only).
    // Returning to your own real role is always allowed (used by the Preview banner).
    if (role !== realUser.role && !isRoleSimulatorAvailable(realUser)) return;
    if (role === realUser.role) {
        sessionStorage.removeItem('primecare_sim_role');
    } else {
        sessionStorage.setItem('primecare_sim_role', role);
    }

    const isPatientPage = window.location.pathname.includes('/patient/');
    if (role === 'patient' && !isPatientPage) {
        window.location.href = '../patient/home.html';
        return;
    }
    if (role !== 'patient' && isPatientPage) {
        window.location.href = '../staff/dashboard.html';
        return;
    }

    await renderShell();
    window.dispatchEvent(new CustomEvent('primecare:rolechange', { detail: role }));
    window.location.reload();
};

window.handleLogout = async function () {
    sessionStorage.removeItem('primecare_sim_role');
    sessionStorage.removeItem('primecare_preview');
    await api.logout();
    const isSubFolder = window.location.pathname.includes('/patient/') || window.location.pathname.includes('/staff/');
    window.location.href = isSubFolder ? '../login.html' : 'login.html';
};

window.toggleNotifications = function () {
    const el = document.getElementById('notif-dropdown');
    if (el) el.classList.toggle('active');
};
window.markAllRead = async function (e) {
    e.stopPropagation();
    await api.markAllNotificationsRead();
    await renderShell();
};
window.handleNotifClick = async function (id, link) {
    await api.markNotificationRead(id);
    if (link) window.location.href = link;
};

document.addEventListener('DOMContentLoaded', async () => {
    await renderShell();
});