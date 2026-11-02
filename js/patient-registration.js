
let isFormDirty = false;

document.addEventListener('DOMContentLoaded', async () => {
    if(await checkAccess()) {
        await initForm();
    }
});

window.addEventListener('primecare:rolechange', async () => {
    await checkAccess();
});

async function checkAccess() {
    const user = await api.getCurrentUser();
    if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
        document.getElementById('access-denied').style.display = 'block';
        document.getElementById('registration-module').style.display = 'none';
        return false;
    } else {
        document.getElementById('access-denied').style.display = 'none';
        document.getElementById('registration-module').style.display = 'block';
        return true;
    }
}

async function initForm() {
    // Populate Dropdowns
    const docSelect = document.getElementById('assignedDoctorId');
    const doctors = await api.getDoctors();
    doctors.forEach(d => docSelect.add(new Option(d.name, d.id)));
    
    const wardSelect = document.getElementById('ward');
    const wards = await api.getWards();
    wards.forEach(w => wardSelect.add(new Option(w.name, w.name)));
    
    const idSelect = document.getElementById('idType');
    const idTypes = await api.getIdTypes();
    idTypes.forEach(type => idSelect.add(new Option(type, type)));

    // Set Defaults
    const today = new Date().toLocaleDateString('en-CA');
    document.getElementById('dateAdmitted').value = today;
    document.getElementById('dateAdmitted').max = today;
    await updatePreviewId();

    // Live Age
    document.getElementById('birthdate').addEventListener('change', (e) => {
        const display = document.getElementById('age-display');
        const dateVal = e.target.value;
        if (dateVal) {
            const age = utils.calcAge(dateVal);
            if (new Date(dateVal) > new Date()) {
                display.style.display = 'block';
                display.style.color = 'var(--color-danger)';
                display.innerText = 'Invalid future date';
            } else {
                display.style.display = 'block';
                display.style.color = 'var(--color-text-muted)';
                display.innerText = `Age: ${age}`;
            }
        } else {
            display.style.display = 'none';
        }
    });

    // Dirty Form Tracking
    document.getElementById('reg-form').addEventListener('input', () => isFormDirty = true);
    window.addEventListener('beforeunload', (e) => {
        if (isFormDirty) e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    });

    // Submit
    document.getElementById('reg-form').addEventListener('submit', handleRegistration);
}

async function updatePreviewId() {
    const patients = await api.searchPatients({}); // Getting all to count
    const count = patients.length + 1;
    document.getElementById('preview-id').innerText = `P-${count.toString().padStart(3, '0')}`;
}

window.setAdmitType = function(type) {
    document.getElementById('admitType').value = type;
    document.getElementById('btn-outpatient').classList.toggle('active', type === 'Outpatient');
    document.getElementById('btn-inpatient').classList.toggle('active', type === 'Inpatient');
    document.getElementById('inpatient-fields').style.display = type === 'Inpatient' ? 'grid' : 'none';
};

window.toggleCollapsible = function(id) {
    document.getElementById(id).classList.toggle('active');
};

window.confirmCancel = async function() {
    if (isFormDirty && !confirm('Are you sure you want to cancel? All entered data will be lost.')) return;
    await resetForm();
};

async function handleRegistration(e) {
    e.preventDefault();
    clearAllErrors();
    let isValid = true;

    // Required fields
    const req = ['firstName', 'lastName', 'birthdate', 'sex', 'civilStatus', 'mobile', 'street', 'brgy', 'city', 'province', 'emergencyContactName', 'emergencyContactNumber', 'dateAdmitted'];
    req.forEach(id => {
        const el = document.getElementById(id);
        if (!el.value.trim()) {
            showFieldError(id, 'Required field');
            isValid = false;
        }
    });

    const mobile = document.getElementById('mobile').value;
    if (mobile && !/^09\d{9}$/.test(mobile)) {
        showFieldError('mobile', 'Must be a valid PH mobile (09XXXXXXXXX)');
        isValid = false;
    } else if (mobile && await api.isMobileTaken(mobile)) {
        showFieldError('mobile', 'Mobile number is already registered.');
        isValid = false;
    }

    const email = document.getElementById('email').value;
    if (email && await api.isEmailTaken(email)) {
        showFieldError('email', 'Email is already registered.');
        isValid = false;
    }

    if (!isValid) {
        utils.showAlert('alert-container', 'danger', 'Please complete all required fields correctly.');
        return;
    }

    // Build Data
    const formData = {};
    document.querySelectorAll('#reg-form input, #reg-form select, #reg-form textarea').forEach(el => {
        if (el.id) formData[el.id] = el.value;
    });
    formData.address = `${formData.street}, ${formData.brgy}, ${formData.city}, ${formData.province}`;

    try {
        const res = await api.registerPatientByStaff(formData);
        if (res.success) {
            isFormDirty = false;
            document.getElementById('form-container').style.display = 'none';
            document.getElementById('success-container').style.display = 'block';
            document.getElementById('success-msg').innerHTML = `<strong>${utils.escapeHTML(res.patient.fullName)}</strong> has been added as patient <strong>${res.patient.id}</strong>.`;
        } else {
             utils.showAlert('alert-container', 'danger', res.message);
        }
    } catch (error) {
         utils.showAlert('alert-container', 'danger', 'An error occurred during registration.');
    }
}

window.resetForm = async function() {
    document.getElementById('reg-form').reset();
    setAdmitType('Outpatient');
    document.getElementById('age-display').innerText = 'Age: 0';
    document.getElementById('dateAdmitted').value = new Date().toLocaleDateString('en-CA');
    await updatePreviewId();
    clearAllErrors();
    isFormDirty = false;
    document.getElementById('form-container').style.display = 'block';
    document.getElementById('success-container').style.display = 'none';
    window.scrollTo(0, 0);
};

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

function clearAllErrors() {
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    document.querySelectorAll('.error-text').forEach(el => el.remove());
}