let myPatientProfile = null;
let pendingContactData = null;
let originalMobile = '';
let originalEmail = '';

document.addEventListener('DOMContentLoaded', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) loadProfile();
});

window.addEventListener('primecare:rolechange', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) loadProfile();
});

function loadProfile() {
    const p = myPatientProfile;
    
    document.getElementById('p-name').innerText = p.fullName;
    document.getElementById('p-id').innerText = p.id;
    document.getElementById('p-dob').innerText = utils.formatDate(p.birthdate);
    document.getElementById('p-age').innerText = utils.calcAge(p.birthdate);
    document.getElementById('p-sex').innerText = p.sex;
    document.getElementById('p-civil').innerText = p.civilStatus || 'N/A';
    document.getElementById('p-idtype').innerText = p.idType || 'N/A';
    
    let idNum = p.idNumber || '';
    if (idNum.length > 4) idNum = '****' + idNum.slice(-4);
    document.getElementById('p-idnum').innerText = idNum || 'N/A';

    originalMobile = p.mobile;
    originalEmail = p.email || '';
    document.getElementById('c-mobile').value = originalMobile;
    document.getElementById('c-email').value = originalEmail;
    
    const parts = (p.address || '').split(', ');
    document.getElementById('c-street').value = parts[0] || '';
    document.getElementById('c-brgy').value = parts[1] || '';
    document.getElementById('c-city').value = parts[2] || '';
    document.getElementById('c-province').value = parts[3] || '';

    document.getElementById('c-em-name').value = p.emergencyContactName || '';
    document.getElementById('c-em-num').value = p.emergencyContactNumber || '';
    document.getElementById('c-em-rel').value = p.emergencyContactRelationship || '';
}

window.submitContact = async function() {
    const data = {
        mobile: document.getElementById('c-mobile').value.trim(),
        email: document.getElementById('c-email').value.trim(),
        street: document.getElementById('c-street').value.trim(),
        brgy: document.getElementById('c-brgy').value.trim(),
        city: document.getElementById('c-city').value.trim(),
        province: document.getElementById('c-province').value.trim(),
        emergencyContactName: document.getElementById('c-em-name').value.trim(),
        emergencyContactNumber: document.getElementById('c-em-num').value.trim(),
        emergencyContactRelationship: document.getElementById('c-em-rel').value.trim()
    };

    if (!data.mobile || !data.street || !data.brgy || !data.city || !data.province || !data.emergencyContactName || !data.emergencyContactNumber) {
        return utils.showAlert('contact-alert', 'danger', 'Please complete all required fields.');
    }

    pendingContactData = data;

    if (data.mobile !== originalMobile || data.email !== originalEmail) {
        if (await api.isMobileTaken(data.mobile, myPatientProfile.id)) return utils.showAlert('contact-alert', 'danger', 'Mobile is already registered.');
        if (data.email && await api.isEmailTaken(data.email, myPatientProfile.id)) return utils.showAlert('contact-alert', 'danger', 'Email is already registered.');

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        sessionStorage.setItem('primecare_profile_otp', code);
        document.getElementById('demo-otp').innerText = code;
        document.getElementById('otp-input').value = '';
        utils.openModal('otp-modal');
    } else {
        await executeSaveContact();
    }
};

window.verifyAndSave = async function() {
    const input = document.getElementById('otp-input').value;
    const stored = sessionStorage.getItem('primecare_profile_otp');
    if (input === stored) {
        utils.closeModal('otp-modal');
        await executeSaveContact();
    } else {
        alert('Invalid verification code.');
    }
};

async function executeSaveContact() {
    const res = await api.updateMyContact(pendingContactData);
    if (res.success) {
        utils.showToast('Profile updated successfully.', 'success');
        myPatientProfile = await api.getPatientProfile();
        originalMobile = pendingContactData.mobile;
        originalEmail = pendingContactData.email;
    } else {
        utils.showAlert('contact-alert', 'danger', res.message);
    }
}

window.submitPassword = async function() {
    const oldPw = document.getElementById('pw-old').value;
    const newPw = document.getElementById('pw-new').value;
    const confirmPw = document.getElementById('pw-confirm').value;

    if (!oldPw || !newPw || !confirmPw) return utils.showAlert('pw-alert', 'danger', 'All fields are required.');
    if (newPw !== confirmPw) return utils.showAlert('pw-alert', 'danger', 'New passwords do not match.');

    const res = await api.changeOwnPassword(oldPw, newPw);
    if (res.success) {
        utils.showToast(res.message, 'success');
        document.getElementById('pw-old').value = '';
        document.getElementById('pw-new').value = '';
        document.getElementById('pw-confirm').value = '';
    } else {
        utils.showAlert('pw-alert', 'danger', res.message);
    }
};