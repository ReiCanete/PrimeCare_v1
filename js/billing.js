let state = { keyword: '', status: 'All', dateFrom: '', dateTo: '', page: 1, limit: 10 };
let newBillItems = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (await checkAccess()) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('patient')) {
            document.getElementById('search-box').value = urlParams.get('patient');
            state.keyword = urlParams.get('patient');
        }
        if (urlParams.get('status')) state.status = urlParams.get('status');
        
        await initUI(); await renderTable(); await updateSummary();
    }
});

window.addEventListener('primecare:rolechange', async () => {
    if (await checkAccess()) { await initUI(); await renderTable(); await updateSummary(); }
});

async function checkAccess() {
    const user = await api.getCurrentUser();
    if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
        document.getElementById('access-denied').style.display = 'block';
        document.getElementById('billing-module').style.display = 'none';
        return false;
    }
    document.getElementById('access-denied').style.display = 'none';
    document.getElementById('billing-module').style.display = 'block';
    
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = user.role === 'admin' ? '' : 'none');
    return true;
}

async function initUI() {
    const pSelect = document.getElementById('nb-patient');
    pSelect.innerHTML = '<option value="">Select Patient...</option>';
    const patients = await api.searchPatients({ status: 'verified' });
    patients.forEach(p => pSelect.add(new Option(`${p.fullName} (${p.id})`, p.id)));

    let timeout = null;
    document.getElementById('search-box').addEventListener('input', (e) => {
        clearTimeout(timeout); timeout = setTimeout(async () => { state.keyword = e.target.value; state.page = 1; await renderTable(); }, 300);
    });
    document.getElementById('filter-status').addEventListener('change', async (e) => { state.status = e.target.value; state.page = 1; await renderTable(); });
    document.getElementById('filter-dateFrom').addEventListener('change', async (e) => { state.dateFrom = e.target.value; state.page = 1; await renderTable(); });
    document.getElementById('filter-dateTo').addEventListener('change', async (e) => { state.dateTo = e.target.value; state.page = 1; await renderTable(); });
}

window.resetFilters = async function() {
    state.keyword = ''; state.status = 'All'; state.dateFrom = ''; state.dateTo = ''; state.page = 1;
    document.getElementById('search-box').value = '';
    document.getElementById('filter-status').value = 'All';
    document.getElementById('filter-dateFrom').value = '';
    document.getElementById('filter-dateTo').value = '';
    await renderTable();
};

window.setStatusFilter = async function(status) {
    state.status = status; state.page = 1;
    document.getElementById('filter-status').value = status;
    await renderTable();
};

window.setPage = async function(p) { state.page = p; await renderTable(); };

async function updateSummary() {
    const sum = await api.getBillingSummary();
    document.getElementById('s-unpaid').innerText = utils.formatCurrency(sum.unpaidTotal);
    document.getElementById('s-today').innerText = utils.formatCurrency(sum.collectedToday);
    document.getElementById('s-month').innerText = utils.formatCurrency(sum.collectedMonth);
    document.getElementById('s-pending').innerText = sum.countUnpaid + sum.countPartial;
}

async function renderTable() {
    const bills = await api.getBills(state);
    const totalPages = Math.ceil(bills.length / state.limit);
    if (state.page > totalPages && totalPages > 0) state.page = totalPages;
    const paginated = bills.slice((state.page - 1) * state.limit, state.page * state.limit);

    const tbody = document.getElementById('table-body');
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No bills found.</td></tr>`;
    } else {
        tbody.innerHTML = paginated.map(b => {
            let badge = 'success';
            if (b.status === 'Unpaid') badge = 'danger';
            if (b.status === 'Partial') badge = 'warning';
            if (b.status === 'Voided') badge = 'secondary" style="background:var(--color-border);color:var(--color-text-muted);';

            let actions = `<button class="btn btn-sm btn-outline" onclick="viewBill('${b.id}')">View</button>`;
            if (b.status === 'Unpaid' || b.status === 'Partial') {
                actions += `<button class="btn btn-sm btn-outline" style="margin-left: 0.25rem; color: var(--color-accent); border-color: var(--color-accent);" onclick="openPayModal('${b.id}')">Pay</button>`;
            }

            return `
            <tr>
                <td><strong>${b.id}</strong></td>
                <td>${utils.formatDate(b.createdAt.split('T')[0])}</td>
                <td>${utils.escapeHTML(b.patientName)}</td>
                <td class="num">${utils.formatCurrency(b.total)}</td>
                <td class="num" style="color: var(--color-success);">${utils.formatCurrency(b.amountPaid)}</td>
                <td class="num" style="color: var(--color-danger); font-weight: bold;">${utils.formatCurrency(b.balance)}</td>
                <td><span class="badge badge-${badge}">${b.status}</span></td>
                <td class="actions-cell">${actions}</td>
            </tr>`;
        }).join('');
    }
    document.getElementById('pagination').innerHTML = Array.from({length: totalPages}, (_, i) => `<button class="page-btn ${i+1 === state.page ? 'active' : ''}" onclick="setPage(${i+1})">${i+1}</button>`).join('');
}

// --- NEW BILL ---
window.openNewBillModal = function() {
    document.getElementById('nb-patient').value = '';
    document.getElementById('nb-discount').value = 'None';
    document.getElementById('nb-ins-prov').value = '';
    document.getElementById('nb-ins-cov').value = '0';
    newBillItems = [];
    renderNewBillItems();
    utils.openModal('new-bill-modal');
};

window.loadCharges = async function() {
    const pid = document.getElementById('nb-patient').value;
    if (!pid) return utils.showAlert('new-bill-alert', 'danger', 'Please select a patient first.');
    
    newBillItems = await api.previewBillCharges(pid);
    if (newBillItems.length === 0) utils.showAlert('new-bill-alert', 'warning', 'No pending charges found for this patient.');
    renderNewBillItems();
};

window.addCustomItem = function() {
    newBillItems.push({ type: 'Other', description: '', qty: 1, unitPrice: 0, amount: 0 });
    renderNewBillItems();
};

window.removeNewBillItem = function(index) {
    newBillItems.splice(index, 1);
    renderNewBillItems();
};

window.updateNewBillItem = function(index, field, value) {
    if (field === 'qty' || field === 'unitPrice') {
        newBillItems[index][field] = parseFloat(value) || 0;
        newBillItems[index].amount = newBillItems[index].qty * newBillItems[index].unitPrice;
    } else {
        newBillItems[index][field] = value;
    }
    calcNewBillTotals();
};

function renderNewBillItems() {
    const tbody = document.getElementById('nb-items-body');
    if (newBillItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted);">No items.</td></tr>`;
    } else {
        tbody.innerHTML = newBillItems.map((item, i) => `
            <tr>
                <td>
                    <select class="form-control" style="padding: var(--space-4);" onchange="updateNewBillItem(${i}, 'type', this.value)">
                        <option value="Room" ${item.type==='Room'?'selected':''}>Room</option>
                        <option value="Professional Fee" ${item.type==='Professional Fee'?'selected':''}>Prof. Fee</option>
                        <option value="Medication" ${item.type==='Medication'?'selected':''}>Medication</option>
                        <option value="Laboratory" ${item.type==='Laboratory'?'selected':''}>Laboratory</option>
                        <option value="Other" ${item.type==='Other'?'selected':''}>Other</option>
                    </select>
                </td>
                <td><input type="text" class="form-control" style="padding: var(--space-4);" value="${utils.escapeHTML(item.description)}" onchange="updateNewBillItem(${i}, 'description', this.value)"></td>
                <td><input type="number" class="form-control" style="padding: var(--space-4);" value="${item.qty}" min="1" onchange="updateNewBillItem(${i}, 'qty', this.value)"></td>
                <td><input type="number" class="form-control" style="padding: var(--space-4);" value="${item.unitPrice}" step="0.01" onchange="updateNewBillItem(${i}, 'unitPrice', this.value)"></td>
                <td class="num">${utils.formatCurrency(item.amount)}</td>
                <td style="text-align: right;"><button class="btn btn-sm btn-outline" style="color: var(--color-danger); border-color: var(--color-danger);" onclick="removeNewBillItem(${i})">&times;</button></td>
            </tr>
        `).join('');
    }
    calcNewBillTotals();
}

window.calcNewBillTotals = function() {
    const subtotal = newBillItems.reduce((sum, i) => sum + i.amount, 0);
    const discType = document.getElementById('nb-discount').value;
    let discount = 0;
    if (discType === 'Senior Citizen' || discType === 'PWD') discount = Math.round((subtotal * 0.20) * 100) / 100;
    
    let afterDisc = subtotal - discount;
    let insCov = parseFloat(document.getElementById('nb-ins-cov').value) || 0;
    if (insCov > afterDisc) { insCov = afterDisc; document.getElementById('nb-ins-cov').value = insCov; }
    
    const total = Math.round((afterDisc - insCov) * 100) / 100;

    document.getElementById('nb-subtotal').innerText = utils.formatCurrency(subtotal);
    document.getElementById('nb-disc-amt').innerText = `-${utils.formatCurrency(discount)}`;
    document.getElementById('nb-ins-amt').innerText = `-${utils.formatCurrency(insCov)}`;
    document.getElementById('nb-total').innerText = utils.formatCurrency(total);
};

window.submitNewBill = async function() {
    const pid = document.getElementById('nb-patient').value;
    if (!pid) return utils.showAlert('new-bill-alert', 'danger', 'Patient is required.');
    
    for (let i of newBillItems) {
        if (!i.description.trim()) return utils.showAlert('new-bill-alert', 'danger', 'All items must have a description.');
    }

    const data = {
        patientId: pid,
        items: newBillItems,
        discountType: document.getElementById('nb-discount').value,
        insuranceProvider: document.getElementById('nb-ins-prov').value.trim(),
        insuranceCoverage: parseFloat(document.getElementById('nb-ins-cov').value) || 0
    };

    const res = await api.createBill(data);
    if (res.success) {
        utils.closeModal('new-bill-modal');
        utils.showToast(`Bill ${res.bill.id} created successfully.`, 'success');
        await renderTable(); await updateSummary();
    } else {
        utils.showAlert('new-bill-alert', 'danger', res.message);
    }
};

// --- VIEW & PAY ---
let currentBillId = null;

window.viewBill = async function(id) {
    currentBillId = id;
    const b = await api.getBillById(id);
    if(!b) return;
    const p = await api.getPatientById(b.patientId);

    document.getElementById('v-id').innerText = b.id;
    document.getElementById('v-date').innerText = utils.formatDate(b.createdAt.split('T')[0]);
    document.getElementById('v-patient').innerText = p ? p.fullName : 'Unknown';
    
    let badge = 'success'; if (b.status === 'Unpaid') badge = 'danger'; if (b.status === 'Partial') badge = 'warning'; if (b.status === 'Voided') badge = 'secondary" style="background:var(--color-border);color:var(--color-text-muted);';
    document.getElementById('v-status').innerHTML = `<span class="badge badge-${badge}">${b.status}</span>`;

    if (b.status === 'Voided') {
        document.getElementById('v-void-reason').style.display = 'block';
        document.getElementById('v-void-reason').innerText = `Void Reason: ${utils.escapeHTML(b.voidReason)}`;
    } else {
        document.getElementById('v-void-reason').style.display = 'none';
    }

    document.getElementById('v-items').innerHTML = b.items.map(i => `
        <tr><td>${i.type}</td><td>${utils.escapeHTML(i.description)}</td><td>${i.qty}</td><td class="num">${utils.formatCurrency(i.amount)}</td></tr>
    `).join('');

    document.getElementById('v-subtotal').innerText = utils.formatCurrency(b.subtotal);
    document.getElementById('v-disc-type').innerText = b.discountType;
    document.getElementById('v-disc-amt').innerText = `-${utils.formatCurrency(b.discountAmount)}`;
    document.getElementById('v-ins-prov').innerText = b.insuranceProvider || 'None';
    document.getElementById('v-ins-amt').innerText = `-${utils.formatCurrency(b.insuranceCoverage)}`;
    document.getElementById('v-total').innerText = utils.formatCurrency(b.total);
    document.getElementById('v-paid').innerText = utils.formatCurrency(b.amountPaid);
    document.getElementById('v-balance').innerText = utils.formatCurrency(b.balance);

    const payDiv = document.getElementById('v-payments');
    if (b.payments.length === 0) {
        payDiv.innerHTML = '<div style="color: var(--color-text-muted);">No payments recorded.</div>';
    } else {
        payDiv.innerHTML = b.payments.map(p => `
            <div style="display: flex; justify-content: space-between; padding: var(--space-8); background: var(--color-bg); border-radius: var(--radius-sm); margin-bottom: var(--space-4);">
                <div><strong>${utils.formatDate(p.paidAt.split('T')[0])}</strong> - ${p.receiptNo} (${p.method})</div>
                <div style="color: var(--color-success); font-weight: bold;">${utils.formatCurrency(p.amount)}</div>
            </div>
        `).join('');
    }

    document.getElementById('btn-pay').disabled = (b.status === 'Paid' || b.status === 'Voided');
    
    const user = await api.getCurrentUser();
    document.getElementById('btn-void').style.display = (b.status === 'Unpaid' && b.payments.length === 0 && user.role === 'admin') ? '' : 'none';

    utils.openModal('view-bill-modal');
};

window.openPayModal = async function(id = currentBillId) {
    const b = await api.getBillById(id);
    if (!b || b.balance <= 0) return;
    document.getElementById('p-billId').value = b.id;
    document.getElementById('p-balance').innerText = utils.formatCurrency(b.balance);
    document.getElementById('p-amount').value = b.balance;
    document.getElementById('p-method').value = 'Cash';
    document.getElementById('p-ref').value = '';
    toggleRef();
    utils.closeModal('view-bill-modal');
    utils.openModal('pay-modal');
};

window.toggleRef = function() {
    const method = document.getElementById('p-method').value;
    document.getElementById('p-ref-group').style.display = method === 'Cash' ? 'none' : 'block';
};

window.submitPayment = async function() {
    const id = document.getElementById('p-billId').value;
    const data = {
        amount: document.getElementById('p-amount').value,
        method: document.getElementById('p-method').value,
        reference: document.getElementById('p-ref').value.trim()
    };

    const res = await api.recordPayment(id, data);
    if (res.success) {
        utils.closeModal('pay-modal');
        utils.showToast(res.message, 'success');
        await renderTable(); await updateSummary();
        
        if (confirm(`Payment successful! Receipt No: ${res.receipt.receiptNo}\nWould you like to print the receipt now?`)) {
            await printReceipt(res.receipt.receiptNo);
        }
    } else {
        utils.showAlert('pay-alert', 'danger', res.message);
    }
};

window.promptVoid = async function() {
    const reason = prompt('Enter reason for voiding this bill (min 10 characters):');
    if (reason !== null) {
        const res = await api.voidBill(currentBillId, reason);
        if (res.success) {
            utils.closeModal('view-bill-modal');
            utils.showToast(res.message, 'success');
            await renderTable(); await updateSummary();
        } else {
            utils.showToast(res.message, 'danger');
        }
    }
};

// --- PRINTING ---
window.printInvoice = async function() {
    const b = await api.getBillById(currentBillId);
    if(!b) return;
    const p = await api.getPatientById(b.patientId);
    
    document.getElementById('print-title').innerText = 'STATEMENT OF ACCOUNT';
    document.getElementById('print-content').innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 2rem;">
            <div><strong>Patient:</strong> ${p ? p.fullName : 'Unknown'}<br><strong>Address:</strong> ${p ? p.address : 'Unknown'}</div>
            <div style="text-align: right;"><strong>Bill No:</strong> ${b.id}<br><strong>Date:</strong> ${utils.formatDate(b.createdAt.split('T')[0])}</div>
        </div>
        <table class="bill-table">
            <thead><tr><th>Description</th><th>Qty</th><th class="num">Amount</th></tr></thead>
            <tbody>${b.items.map(i => `<tr><td>${i.description}</td><td>${i.qty}</td><td class="num">${utils.formatCurrency(i.amount)}</td></tr>`).join('')}</tbody>
        </table>
        <div style="width: 300px; margin-left: auto; text-align: right;">
            <div>Subtotal: ${utils.formatCurrency(b.subtotal)}</div>
            <div>Discount: -${utils.formatCurrency(b.discountAmount)}</div>
            <div>Insurance: -${utils.formatCurrency(b.insuranceCoverage)}</div>
            <div style="font-size: var(--fs-lg); font-weight: bold; margin-top: var(--space-8);">Total Due: ${utils.formatCurrency(b.total)}</div>
        </div>
    `;
    
    utils.closeModal('view-bill-modal');
    document.getElementById('print-section').style.display = 'block';
    window.print();
    document.getElementById('print-section').style.display = 'none';
};

window.printReceipt = async function(receiptNo) {
    const data = await api.getReceipt(receiptNo);
    if (!data) return;
    const { receipt, bill } = data;
    const p = await api.getPatientById(bill.patientId);

    document.getElementById('print-title').innerText = 'OFFICIAL RECEIPT';
    document.getElementById('print-content').innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 2rem;">
            <div><strong>Received From:</strong> ${p ? p.fullName : 'Unknown'}<br><strong>Payment For:</strong> Bill ${bill.id}</div>
            <div style="text-align: right;"><strong>Receipt No:</strong> ${receipt.receiptNo}<br><strong>Date:</strong> ${utils.formatDate(receipt.paidAt.split('T')[0])}</div>
        </div>
        <div style="font-size: var(--fs-xl); text-align: center; margin: 2rem 0; padding: 1rem; border: 2px solid var(--color-primary);">
            Amount Paid: <strong>${utils.formatCurrency(receipt.amount)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
            <div><strong>Method:</strong> ${receipt.method} ${receipt.reference ? `(Ref: ${receipt.reference})` : ''}</div>
            <div style="text-align: right;"><strong>Remaining Balance:</strong> ${utils.formatCurrency(bill.balance)}</div>
        </div>
        <div style="margin-top: 4rem; text-align: right;">
            <div style="border-bottom: 1px solid black; width: 200px; margin-left: auto;"></div>
            <div style="margin-top: var(--space-8);">Received By: ${receipt.receivedBy}</div>
        </div>
    `;
    
    document.getElementById('print-section').style.display = 'block';
    window.print();
    document.getElementById('print-section').style.display = 'none';
};

