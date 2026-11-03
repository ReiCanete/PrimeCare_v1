

document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.getAttribute('data-page');
    if (page === 'login') await initLogin();
    if (page === 'register') await initRegister();
    if (page === 'forgot-password') initForgot();
});

// --- LOGIN ---
// Phase 5.2: authentication is performed by the PHP backend (api.auth.login).
// The server-side PHP session is the source of truth; nothing here decides who is logged in.
async function initLogin() {
    const form = document.getElementById('login-form');
    const btn = document.getElementById('login-btn');
    const toggle = document.getElementById('toggle-password');
    const passInput = document.getElementById('password');
    let submitting = false;

    const portalFor = (user) => user.role === 'patient' ? 'patient/home.html' : 'staff/dashboard.html';

    // Redirect if the PHP session is still valid (survives refresh). A 401 simply
    // clears any stale UI cache and leaves the login form visible.
    const existing = await api.auth.me();
    if (existing.success && existing.data && existing.data.user) {
        window.location.href = portalFor(existing.data.user);
        return;
    }

    toggle.addEventListener('click', () => {
        const type = passInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passInput.setAttribute('type', type);
        toggle.innerText = type === 'password' ? '👁️' : '🙈';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (submitting) return; // prevent duplicate submissions

        const u = document.getElementById('username').value.trim();
        const p = passInput.value;

        if (!u || !p) {
            utils.showAlert('alert-container', 'danger', 'Please enter your username and password.');
            return;
        }

        submitting = true;
        btn.disabled = true;
        btn.innerText = 'Processing...';

        try {
            const res = await api.auth.login({ username: u, password: p });
            if (res.success && res.data && res.data.user) {
                passInput.value = '';
                window.location.href = portalFor(res.data.user);
                return;
            }
            // Server messages are intentionally generic (never reveal which field was wrong).
            utils.showAlert('alert-container', 'danger', utils.escapeHTML(res.message || 'Unable to log in. Please try again.'));
        } catch (error) {
            utils.showAlert('alert-container', 'danger', 'An error occurred during login.');
        }

        submitting = false;
        btn.disabled = false;
        btn.innerText = 'Log In';
    });
}

// --- REGISTER ---
let currentStep = 1;
const totalSteps = 5; // Step 6 is success
let regData = {};

async function initRegister() {
    // Populate ID Types from backend (with fallback)
    try {
        const idTypes = api.getIdTypes ? await api.getIdTypes() : api.getAll('idTypes');
        const idSelect = document.getElementById('idType');
        if (idSelect && Array.isArray(idTypes) && idTypes.length > 0) {
            // Keep the placeholder and only append options if not already populated in HTML
            if (idSelect.options.length <= 1) {
                idTypes.forEach(type => {
                    idSelect.add(new Option(type, type));
                });
            }
        }
    } catch (e) {
        console.warn('Failed to dynamically load idTypes:', e);
    }

    // Live Age Calculation
    document.getElementById('birthdate').addEventListener('change', (e) => {
        const display = document.getElementById('age-display');
        const dateVal = e.target.value;
        if (dateVal) {
            const age = utils.calcAge(dateVal);
            if (new Date(dateVal) > new Date()) {
                display.style.display = 'block';
                display.style.color = 'var(--danger)';
                display.innerText = 'Invalid future date';
            } else {
                display.style.display = 'block';
                display.style.color = 'var(--text-muted)';
                display.innerText = `Age: ${age}`;
            }
        } else {
            display.style.display = 'none';
        }
    });

    // Password Strength
    document.getElementById('password').addEventListener('input', (e) => {
        const val = e.target.value;
        const bar = document.getElementById('strength-bar');
        let strength = 0;
        if (val.length >= 8) strength++;
        if (/[A-Z]/.test(val)) strength++;
        if (/\d/.test(val)) strength++;
        
        bar.className = 'strength-bar';
        if (strength === 1) bar.classList.add('strength-weak');
        if (strength === 2) bar.classList.add('strength-medium');
        if (strength === 3) bar.classList.add('strength-strong');
    });

    // Username Live Check
    document.getElementById('username').addEventListener('blur', async (e) => {
        const val = e.target.value;
        if (val.length >= 4) {
            const isTaken = await api.isUsernameTaken(val);
            if (isTaken) {
                showFieldError('username', 'Username is already taken.');
            } else {
                clearFieldError('username');
            }
        } else {
            clearFieldError('username');
        }
    });
}

async function nextStep(step) {
    if (!validateStep(step)) return;
    
    // Save data from current step
    document.querySelectorAll(`#step${step} input, #step${step} select`).forEach(el => {
        if (el.id) regData[el.id] = el.value;
    });

    if (step === 4) {
        // Final validation before sending code
        const [userTaken, emailTaken, mobileTaken, idTaken] = await Promise.all([
            api.isUsernameTaken(regData.username),
            api.isEmailTaken(regData.email),
            api.isMobileTaken(regData.mobile),
            api.isIdTaken(regData.idType, regData.idNumber)
        ]);

        if (userTaken) return showFieldError('username', 'Username taken.');
        if (emailTaken) return showFieldError('email', 'Email already registered.');
        if (mobileTaken) return showFieldError('mobile', 'Mobile already registered.');
        if (idTaken) return showFieldError('idNumber', 'ID already registered.');
        
        // Send Demo Code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = Date.now() + (5 * 60 * 1000); // 5 mins
        sessionStorage.setItem('primecare_verification', JSON.stringify({ code, expiry, target: regData.mobile }));
        document.getElementById('demo-code-display').innerText = code;
    }

    document.getElementById(`step${step}`).classList.remove('active');
    document.getElementById(`step${step+1}`).classList.add('active');
    updateStepper(step + 1);
}

function prevStep(step) {
    document.getElementById(`step${step}`).classList.remove('active');
    document.getElementById(`step${step-1}`).classList.add('active');
    updateStepper(step - 1);
}

function updateStepper(step) {
    if (step > 5) return;
    document.querySelectorAll('.step-indicator').forEach((el, idx) => {
        el.classList.remove('active', 'completed');
        if (idx + 1 < step) el.classList.add('completed');
        if (idx + 1 === step) el.classList.add('active');
    });
}

function validateStep(step) {
    let isValid = true;
    clearAllErrors(`step${step}`);

    if (step === 1) {
        isValid &= checkRequired(['firstName', 'lastName', 'birthdate', 'sex', 'civilStatus']);
        const dob = document.getElementById('birthdate').value;
        if (dob && utils.calcAge(dob) < 18) {
            showFieldError('birthdate', 'Must be 18 or older. Minors must be registered by a guardian at the hospital.');
            isValid = false;
        }
    }
    if (step === 2) {
        isValid &= checkRequired(['mobile', 'email', 'street', 'brgy', 'city', 'province']);
        isValid &= checkPattern('mobile', /^09\d{9}$/, 'Must be a valid PH mobile (09XXXXXXXXX)');
        isValid &= checkPattern('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format');
    }
    if (step === 3) {
        isValid &= checkRequired(['idType', 'idNumber', 'emergencyContactName', 'emergencyContactNumber', 'emergencyContactRelationship']);
    }
    if (step === 4) {
        isValid &= checkRequired(['username', 'password', 'confirmPassword']);
        isValid &= checkPattern('username', /^[a-zA-Z0-9_]{4,20}$/, '4-20 chars, letters, numbers, underscore only');
        isValid &= checkPattern('password', /^(?=.*[A-Z])(?=.*\d).{8,}$/, 'Min 8 chars, 1 uppercase, 1 number');
        
        const p1 = document.getElementById('password').value;
        const p2 = document.getElementById('confirmPassword').value;
        if (p1 !== p2) {
            showFieldError('confirmPassword', 'Passwords do not match');
            isValid = false;
        }
        if (!document.getElementById('privacyConsent').checked) {
            utils.showAlert('alert-container', 'danger', 'You must agree to the Data Privacy Consent.');
            isValid = false;
        }
    }

    if (!isValid) utils.showAlert('alert-container', 'danger', 'Please fix the errors below before proceeding.');
    return isValid;
}

async function verifyAndRegister() {
    const code = document.getElementById('verificationCode').value;
    
    // Inline verifyCode logic
    const stored = JSON.parse(sessionStorage.getItem('primecare_verification'));
    let isValidCode = false;
    if (stored && stored.target === regData.mobile && stored.code === code && Date.now() <= stored.expiry) {
        sessionStorage.removeItem('primecare_verification');
        isValidCode = true;
    }

    if (!isValidCode) {
        utils.showAlert('alert-container', 'danger', 'Invalid or expired code.');
        return;
    }

    try {
        const res = await (api.registerPatientSelf ? api.registerPatientSelf(regData) : api.registerPatientByStaff(regData));
        if (res.success) {
            document.getElementById('step5').classList.remove('active');
            document.getElementById('step6').classList.add('active');
            document.getElementById('success-pid').innerText = res.patient.id;
            document.querySelector('.stepper').style.display = 'none';
        } else {
            utils.showAlert('alert-container', 'danger', res.message || 'Registration failed. Try again.');
        }
    } catch (error) {
        utils.showAlert('alert-container', 'danger', 'An error occurred during registration.');
    }
}

// --- FORGOT PASSWORD ---
let resetTarget = '';
function initForgot() {
    document.getElementById('forgot-step1-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = document.getElementById('f-username').value;
        const em = document.getElementById('f-email').value;
        
        const users = api.getAll('users');
        const user = users.find(x => x.username === u && x.email === em);
        
        if (!user) {
            utils.showAlert('alert-container', 'danger', 'No account found with that username and email.');
            return;
        }
        
        resetTarget = u;
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = Date.now() + (5 * 60 * 1000);
        sessionStorage.setItem('primecare_verification', JSON.stringify({ code, expiry, target: u }));
        document.getElementById('demo-reset-code').innerText = code;
        
        document.getElementById('forgot-step1').style.display = 'none';
        document.getElementById('forgot-step2').style.display = 'block';
    });

    document.getElementById('forgot-step2-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('f-code').value;
        const p1 = document.getElementById('f-password').value;
        const p2 = document.getElementById('f-confirm').value;

        const stored = JSON.parse(sessionStorage.getItem('primecare_verification'));
        if (!stored || stored.target !== resetTarget || stored.code !== code || Date.now() > stored.expiry) {
            return utils.showAlert('alert-container', 'danger', 'Invalid or expired code.');
        }

        if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(p1)) return utils.showAlert('alert-container', 'danger', 'Password does not meet requirements.');
        if (p1 !== p2) return utils.showAlert('alert-container', 'danger', 'Passwords do not match.');

        try {
            let users = api.getAll('users');
            const userIndex = users.findIndex(u => u.username === resetTarget && u.email === document.getElementById('f-email').value);
            if (userIndex !== -1) {
                users[userIndex].password = p1;
                localStorage.setItem('primecare_users', JSON.stringify(users));
                document.getElementById('forgot-step2').style.display = 'none';
                document.getElementById('forgot-step3').style.display = 'block';
            } else {
                 utils.showAlert('alert-container', 'danger', 'User not found during reset.');
            }
            
        } catch (error) {
             utils.showAlert('alert-container', 'danger', 'An error occurred during password reset.');
        }
    });
}

// --- VALIDATION HELPERS ---
function checkRequired(ids) {
    let valid = true;
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el.value.trim()) {
            showFieldError(id, 'This field is required');
            valid = false;
        }
    });
    return valid;
}

function checkPattern(id, regex, msg) {
    const el = document.getElementById(id);
    if (el.value && !regex.test(el.value)) {
        showFieldError(id, msg);
        return false;
    }
    return true;
}

function showFieldError(id, msg) {
    const el = document.getElementById(id);
    el.classList.add('is-invalid');
    let err = el.nextElementSibling;
    if (!err || !err.classList.contains('error-text')) {
        err = document.createElement('div');
        err.className = 'error-text';
        el.parentNode.insertBefore(err, el.nextSibling);
    }
    err.innerText = msg;
}

function clearFieldError(id) {
    const el = document.getElementById(id);
    el.classList.remove('is-invalid');
    const err = el.nextElementSibling;
    if (err && err.classList.contains('error-text')) err.remove();
}

function clearAllErrors(containerId) {
    document.querySelectorAll(`#${containerId} .is-invalid`).forEach(el => el.classList.remove('is-invalid'));
    document.querySelectorAll(`#${containerId} .error-text`).forEach(el => el.remove());
}
