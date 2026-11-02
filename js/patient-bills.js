let myPatientProfile = null;
let currentBillId = null;

document.addEventListener('DOMContentLoaded', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('status')) document.getElementById('filter-status').value = urlParams.get('status');
        await renderDashboard();
        
        if (urlParams.get('bill')) await viewBill(urlParams.get('bill'));
    }
});

window.addEventListener('primecare:rolechange', async () => {
    myPatientProfile = await api.getPatientProfile();
    if (myPatientProfile) await renderDashboard();
});

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    const activeTab = document.getElementById(`tab-${tab}`);
    if(activeTab) activeTab.classList.add('active');
};

async function renderDashboard() {
    await renderBills();
    await renderReceipts();
    await renderInsurance();

    const bills = await api.getMyBills();
    let bal = 0; let paid = 0; let open = 0;
    bills.forEach(b => {
        if (b.status !== 'Voided') {
            bal += b.balance;
            paid += b.amountPaid;
            if (b.balance > 0) open++;
        }
    });
    document.getElementById('s-balance').innerText = utils.formatCurrency(bal);
    document.getElementById('s-paid').innerText = utils.formatCurrency(paid);
    document.getElementById('s-open').innerText = open;
}

window.renderBills = async function() {
    const status = document.getElementById('filter-status').value;
    const bills = await api.getMyBills(status !== 'All' ? { status } : null);
    const tbody = document.getElementById('bills-tbody');

    if (bills.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No bills found.</td></tr>`;
    } else {
        tbody.innerHTML = bills.map(b => {
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
                <td class="num">${utils.formatCurrency(b.total)}</td>
                <td class="num" style="color: var(--color-success);">${utils.formatCurrency(b.amountPaid)}</td>
                <td class="num" style="color: var(--color-danger); font-weight: bold;">${utils.formatCurrency(b.balance)}</td>
                <td><span class="badge badge-${badge}">${b.status}</span></td>
                <td class="actions-cell">${actions}</td>
            </tr>`;
        }).join('');
    }
}

async function renderReceipts() {
    const receipts = await api.getMyReceipts();
    const tbody = document.getElementById('receipts-tbody');
    if (receipts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No receipts found.</td></tr>`;
    } else {
        tbody.innerHTML = receipts.map(r => `
            <tr>
                <td><strong>${r.receiptNo}</strong></td>
                <td>${utils.formatDate(r.paidAt.split('T')[0])}</td>
                <td>${r.billId}</td>
                <td>${r.method}</td>
                <td class="num" style="color: var(--color-success); font-weight: bold;">${utils.formatCurrency(r.amount)}</td>
                <td style="text-align: right;"><button class="btn btn-sm btn-outline" onclick="printReceipt('${r.receiptNo}')">Print</button></td>
            </tr>
        `).join('');
    }
}

async function renderInsurance() {
    const ins = await api.getMyInsuranceInfo();
    if (!ins) return;
    document.getElementById('ins-prov').innerText = ins.provider || 'None on file';
    document.getElementById('ins-num').innerText = ins.number || 'N/A';

    const tbody = document.getElementById('ins-tbody');
    if (ins.claims.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No insurance coverage applied to any bills yet.</td></tr>`;
    } else {
        tbody.innerHTML = ins.claims.map(c => `
            <tr>
                <td><strong>${c.billId}</strong></td>
                <td>${utils.formatDate(c.date)}</td>
                <td class="num" style="color: var(--color-success); font-weight: bold;">${utils.formatCurrency(c.amount)}</td>
            </tr>
        `).join('');
    }
}

window.viewBill = async function(id) {
    currentBillId = id;
    const b = await api.getMyBillById(id);
    if (!b) return;

    document.getElementById('v-id').innerText = b.id;
    document.getElementById('v-date').innerText = utils.formatDate(b.createdAt.split('T')[0]);
    
    let badge = 'success'; if (b.status === 'Unpaid') badge = 'danger'; if (b.status === 'Partial') badge = 'warning'; if (b.status === 'Voided') badge = 'secondary" style="background:var(--color-border);color:var(--color-text-muted);';
    document.getElementById('v-status').innerHTML = `<span class="badge badge-${badge}">${b.status}</span>`;

    document.getElementById('v-items').innerHTML = b.items.map(i => `<tr><td>${utils.escapeHTML(i.description)}</td><td>${i.qty}</td><td class="num">${utils.formatCurrency(i.amount)}</td></tr>`).join('');

    document.getElementById('v-subtotal').innerText = utils.formatCurrency(b.subtotal);
    document.getElementById('v-disc-type').innerText = b.discountType;
    document.getElementById('v-disc-amt').innerText = `-${utils.formatCurrency(b.discountAmount)}`;
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
    document.getElementById('btn-plan').style.display = (b.status === 'Unpaid' && b.balance > 0) ? '' : 'none';

    utils.openModal('view-bill-modal');
};

window.openPayModal = async function(id = currentBillId) {
    const b = await api.getMyBillById(id);
    if (!b || b.balance <= 0) return;
    document.getElementById('p-billId').value = b.id;
    document.getElementById('p-balance').innerText = utils.formatCurrency(b.balance);
    document.getElementById('p-amount').value = b.balance;
    
    document.getElementById('p-card-num').value = '';
    document.getElementById('p-card-exp').value = '';
    document.getElementById('p-card-cvv').value = '';
    document.getElementById('p-card-name').value = '';
    document.getElementById('p-gcash-num').value = '';
    
    selectMethod('Credit/Debit Card');
    utils.closeModal('view-bill-modal');
    utils.openModal('pay-modal');
};

window.selectMethod = function(method) {
    document.getElementById('p-method').value = method;
    document.getElementById('tile-card').classList.toggle('active', method === 'Credit/Debit Card');
    document.getElementById('tile-gcash').classList.toggle('active', method === 'GCash');
    document.getElementById('form-card').style.display = method === 'Credit/Debit Card' ? 'block' : 'none';
    document.getElementById('form-gcash').style.display = method === 'GCash' ? 'block' : 'none';
};

window.submitPayment = async function() {
    const id = document.getElementById('p-billId').value;
    const data = {
        amount: document.getElementById('p-amount').value,
        method: document.getElementById('p-method').value,
        cardNumber: document.getElementById('p-card-num').value,
        expiry: document.getElementById('p-card-exp').value,
        cvv: document.getElementById('p-card-cvv').value,
        mobile: document.getElementById('p-gcash-num').value
    };

    document.getElementById('pay-actions').style.display = 'none';
    document.getElementById('pay-processing').style.display = 'block';

    setTimeout(async () => {
        const res = await api.payMyBill(id, data);
        document.getElementById('pay-processing').style.display = 'none';
        document.getElementById('pay-actions').style.display = 'flex';

        if (res.success) {
            utils.closeModal('pay-modal');
            await renderDashboard();
            if (confirm(`Payment successful! Receipt No: ${res.receipt.receiptNo}\nWould you like to print the receipt now?`)) {
                await printReceipt(res.receipt.receiptNo);
            }
        } else {
            utils.showAlert('pay-alert', 'danger', res.message);
        }
    }, 1500);
};

window.openPlanModal = function() {
    document.getElementById('pl-billId').value = currentBillId;
    document.getElementById('pl-months').value = '3';
    document.getElementById('pl-reason').value = '';
    utils.closeModal('view-bill-modal');
    utils.openModal('plan-modal');
};

window.submitPlan = async function() {
    const id = document.getElementById('pl-billId').value;
    const months = parseInt(document.getElementById('pl-months').value);
    const reason = document.getElementById('pl-reason').value.trim();

    const res = await api.requestPaymentPlan(id, months, reason);
    if (res.success) {
        utils.closeModal('plan-modal');
        utils.showToast('Payment plan request submitted. The billing office will review it.', 'success');
    } else {
        utils.showAlert('plan-alert', 'danger', res.message);
    }
};

window.printInvoice = async function() {
    const b = await api.getMyBillById(currentBillId);
    document.getElementById('print-title').innerText = 'STATEMENT OF ACCOUNT';
    document.getElementById('print-content').innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 2rem;">
            <div><strong>Patient:</strong> ${myPatientProfile.fullName}<br><strong>Address:</strong> ${myPatientProfile.address}</div>
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
    const receipts = await api.getMyReceipts();
    const receipt = receipts.find(r => r.receiptNo === receiptNo);
    if (!receipt) return;
    const b = await api.getMyBillById(receipt.billId);

    document.getElementById('print-title').innerText = 'OFFICIAL RECEIPT';
    document.getElementById('print-content').innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 2rem;">
            <div><strong>Received From:</strong> ${myPatientProfile.fullName}<br><strong>Payment For:</strong> Bill ${b.id}</div>
            <div style="text-align: right;"><strong>Receipt No:</strong> ${receipt.receiptNo}<br><strong>Date:</strong> ${utils.formatDate(receipt.paidAt.split('T')[0])}</div>
        </div>
        <div style="font-size: var(--fs-xl); text-align: center; margin: 2rem 0; padding: 1rem; border: 2px solid var(--color-primary);">
            Amount Paid: <strong>${utils.formatCurrency(receipt.amount)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
            <div><strong>Method:</strong> ${receipt.method} ${receipt.reference ? `(Ref: ${receipt.reference})` : ''}</div>
            <div style="text-align: right;"><strong>Remaining Balance:</strong> ${utils.formatCurrency(b.balance)}</div>
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
