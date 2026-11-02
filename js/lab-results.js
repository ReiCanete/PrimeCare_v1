let state = { keyword: '', status: 'All', flag: 'All', category: 'All', dateFrom: '', dateTo: '', page: 1, limit: 10 };

document.addEventListener('DOMContentLoaded', async () => {
    if (await checkAccess()) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('flag') === 'critical') state.flag = 'Critical';
        await initUI();
        await renderTable();
    }
});

window.addEventListener('primecare:rolechange', async () => {
    if (await checkAccess()) { await initUI(); await renderTable(); }
});

async function checkAccess() {
    const user = await api.getCurrentUser();
    if (!user || user.role === 'staff') {
        document.getElementById('access-denied').style.display = 'block';
        document.getElementById('lab-module').style.display = 'none';
        return false;
    }
    document.getElementById('access-denied').style.display = 'none';
    document.getElementById('lab-module').style.display = 'block';
    
    const isDocAdmin = user.role === 'admin' || user.role === 'doctor';
    document.querySelectorAll('.doc-admin-only').forEach(el => el.style.display = isDocAdmin ? '' : 'none');
    return true;
}

async function initUI() {
    const pSelect = document.getElementById('o-patient');
    pSelect.innerHTML = '<option value="">Select Patient...</option>';
    const patients = await api.searchPatients({ status: 'verified' });
    patients.forEach(p => pSelect.add(new Option(`${p.fullName} (${p.id})`, p.id)));

    let timeout = null;
    document.getElementById('search-box').addEventListener('input', (e) => {
        clearTimeout(timeout); timeout = setTimeout(async () => { state.keyword = e.target.value; state.page = 1; await renderTable(); }, 300);
    });
    document.getElementById('filter-category').addEventListener('change', async (e) => { state.category = e.target.value; state.page = 1; await renderTable(); });
    document.getElementById('filter-status').addEventListener('change', async (e) => { state.status = e.target.value; state.page = 1; await renderTable(); });
    document.getElementById('filter-date').addEventListener('change', async (e) => { state.dateFrom = e.target.value; state.dateTo = e.target.value; state.page = 1; await renderTable(); });
}

window.resetFilters = async function() {
    state.keyword = ''; state.status = 'All'; state.flag = 'All'; state.category = 'All'; state.dateFrom = ''; state.dateTo = ''; state.page = 1;
    document.getElementById('search-box').value = '';
    document.getElementById('filter-category').value = 'All';
    document.getElementById('filter-status').value = 'All';
    document.getElementById('filter-date').value = '';
    await renderTable();
};

window.setFlagFilter = async function(flag) { state.flag = flag; state.page = 1; await renderTable(); };
window.setPage = async function(p) { state.page = p; await renderTable(); };

async function renderTable() {
    const labs = await api.getLabResults(state);
    const allLabs = await api.getLabResults({ ...state, flag: 'All' });

    document.getElementById('c-all').innerText = allLabs.length;
    document.getElementById('c-nor').innerText = allLabs.filter(l => l.flag === 'Normal').length;
    document.getElementById('c-abn').innerText = allLabs.filter(l => l.flag === 'Abnormal').length;
    document.getElementById('c-cri').innerText = allLabs.filter(l => l.flag === 'Critical').length;

    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    const activeChip = document.querySelector(`.chip[onclick="setFlagFilter('${state.flag}')"]`);
    if(activeChip) activeChip.classList.add('active');

    const totalPages = Math.ceil(labs.length / state.limit);
    if (state.page > totalPages && totalPages > 0) state.page = totalPages;
    const paginated = labs.slice((state.page - 1) * state.limit, state.page * state.limit);

    const tbody = document.getElementById('table-body');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No lab results found.</td></tr>`;
    } else {
        tbody.innerHTML = paginated.map(l => {
            let sBadge = l.status === 'Completed' ? 'success' : 'warning';
            let fBadge = '-';
            let rowStyle = '';
            if (l.flag === 'Normal') fBadge = '<span class="badge badge-success">Normal</span>';
            if (l.flag === 'Abnormal') fBadge = '<span class="badge badge-warning">Abnormal</span>';
            if (l.flag === 'Critical') {
                fBadge = '<span class="badge badge-danger pulse-critical">Critical</span>';
                rowStyle = 'background: var(--color-danger-bg);';
            }

            let actions = `<button class="btn btn-sm btn-outline" onclick="viewLab('${l.id}')">View</button>`;
            if (l.status !== 'Completed') {
                actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-accent); border-color: var(--color-accent);" onclick="openResultModal('${l.id}')">Enter Result</button>`;
            }

            return `
            <tr style="${rowStyle}">
                <td><strong>${l.id}</strong><br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${utils.formatDate(l.orderedDate)}</span></td>
                <td>${utils.escapeHTML(l.patientName)}</td>
                <td>${utils.escapeHTML(l.testName)}<br><span style="font-size: var(--fs-xs); color: var(--color-text-muted);">${l.category}</span></td>
                <td><span class="badge badge-${sBadge}">${l.status}</span></td>
                <td>${l.result ? `${utils.escapeHTML(l.result)} ${utils.escapeHTML(l.unit || '')}` : '<span style="color:var(--color-text-muted);">Pending</span>'}</td>
                <td>${fBadge}</td>
                <td class="actions-cell">${actions}</td>
            </tr>`;
        }).join('');
    }
    document.getElementById('pagination').innerHTML = Array.from({length: totalPages}, (_, i) => `<button class="page-btn ${i+1 === state.page ? 'active' : ''}" onclick="setPage(${i+1})">${i+1}</button>`).join('');
}

window.openOrderModal = function() {
    document.getElementById('o-patient').value = '';
    document.getElementById('o-test').value = '';
    document.getElementById('o-category').value = 'Hematology';
    utils.openModal('order-modal');
};

window.submitOrder = async function() {
    const data = {
        patientId: document.getElementById('o-patient').value,
        testName: document.getElementById('o-test').value.trim(),
        category: document.getElementById('o-category').value
    };
    if (!data.patientId || !data.testName) return utils.showAlert('order-alert', 'danger', 'Patient and Test Name are required.');

    const res = await api.orderLabTest(data);
    if (res.success) {
        utils.closeModal('order-modal');
        utils.showToast(res.message, 'success');
        await renderTable();
    } else {
        utils.showAlert('order-alert', 'danger', res.message);
    }
};

window.openResultModal = async function(id) {
    const l = await api.getLabResultById(id);
    if (!l) return;
    document.getElementById('r-id').value = l.id;
    document.getElementById('r-test-name').innerText = l.testName;
    const p = await api.getPatientById(l.patientId);
    document.getElementById('r-patient-name').innerText = p ? p.fullName : 'Unknown';
    
    document.getElementById('r-value').value = '';
    document.getElementById('r-unit').value = '';
    document.getElementById('r-min').value = '';
    document.getElementById('r-max').value = '';
    document.getElementById('r-manual-flag').value = '';
    document.getElementById('r-file').value = '';
    calculateLiveFlag();
    
    utils.openModal('result-modal');
};

window.calculateLiveFlag = function() {
    const valStr = document.getElementById('r-value').value;
    const minStr = document.getElementById('r-min').value;
    const maxStr = document.getElementById('r-max').value;
    const manual = document.getElementById('r-manual-flag').value;
    const badge = document.getElementById('r-live-flag');

    if (manual) {
        setLiveBadge(manual);
        return;
    }

    if (valStr && minStr && maxStr) {
        const val = parseFloat(valStr);
        const min = parseFloat(minStr);
        const max = parseFloat(maxStr);
        if (!isNaN(val) && !isNaN(min) && !isNaN(max)) {
            const rangeSpan = max - min;
            const critThreshold = rangeSpan * 0.3;
            if (val >= min && val <= max) setLiveBadge('Normal');
            else if (val < min - critThreshold || val > max + critThreshold) setLiveBadge('Critical');
            else setLiveBadge('Abnormal');
            return;
        }
    }
    setLiveBadge('Pending');
};

function setLiveBadge(flag) {
    const badge = document.getElementById('r-live-flag');
    if (flag === 'Normal') { badge.className = 'badge badge-success'; badge.innerText = 'Normal'; }
    else if (flag === 'Abnormal') { badge.className = 'badge badge-warning'; badge.innerText = 'Abnormal'; }
    else if (flag === 'Critical') { badge.className = 'badge badge-danger pulse-critical'; badge.innerText = 'Critical'; }
    else { badge.className = 'badge badge-neutral'; badge.innerText = 'Pending'; }
}

window.submitResult = async function() {
    const id = document.getElementById('r-id').value;
    const val = document.getElementById('r-value').value.trim();
    if (!val) return utils.showAlert('result-alert', 'danger', 'Result value is required.');

    const min = document.getElementById('r-min').value;
    const max = document.getElementById('r-max').value;
    const manual = document.getElementById('r-manual-flag').value;
    const fileInput = document.getElementById('r-file');

    const data = {
        result: val,
        unit: document.getElementById('r-unit').value.trim(),
        referenceRange: (min && max) ? { min, max } : null,
        flag: manual || null,
        attachmentName: fileInput.files.length > 0 ? fileInput.files[0].name : null
    };

    const res = await api.saveLabResult(id, data);
    if (res.success) {
        utils.closeModal('result-modal');
        utils.showToast(res.message, 'success');
        await renderTable();
    } else {
        utils.showAlert('result-alert', 'danger', res.message);
    }
};

window.viewLab = async function(id) {
    const l = await api.getLabResultById(id);
    if(!l) return;
    const p = await api.getPatientById(l.patientId);
    
    document.getElementById('v-id').innerText = l.id;
    document.getElementById('v-status').innerHTML = `<span class="badge badge-${l.status === 'Completed' ? 'success' : 'warning'}">${l.status}</span>`;
    document.getElementById('v-patient').innerText = p ? p.fullName : 'Unknown';
    document.getElementById('v-test').innerText = l.testName;
    document.getElementById('v-cat').innerText = l.category;
    
    document.getElementById('v-result').innerText = l.result || 'Pending';
    document.getElementById('v-unit').innerText = l.unit || '';
    document.getElementById('v-ref').innerText = l.referenceRange ? `${l.referenceRange.min} - ${l.referenceRange.max}` : 'N/A';
    
    let fBadge = 'N/A';
    if (l.flag === 'Normal') fBadge = '<span class="badge badge-success">Normal</span>';
    if (l.flag === 'Abnormal') fBadge = '<span class="badge badge-warning">Abnormal</span>';
    if (l.flag === 'Critical') fBadge = '<span class="badge badge-danger pulse-critical">Critical</span>';
    document.getElementById('v-flag').innerHTML = fBadge;

    document.getElementById('v-ordered').innerText = utils.formatDate(l.orderedDate);
    document.getElementById('v-performed').innerText = l.resultDate ? `${utils.formatDate(l.resultDate)} by ${l.performedBy}` : 'Pending';

    const user = await api.getCurrentUser();
    if (user.role === 'doctor' && l.status === 'Completed') {
        document.getElementById('v-review-box').innerHTML = `<button class="btn btn-primary" onclick="markReviewed('${l.id}')">Mark as Reviewed</button>`;
    } else {
        document.getElementById('v-review-box').innerHTML = '';
    }

    utils.openModal('view-modal');
};

window.markReviewed = function(id) {
    utils.closeModal('view-modal');
    utils.showToast('Lab result marked as reviewed.', 'success');
};