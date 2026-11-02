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

// Helpers to categorize charges cleanly
function getBillingCategory(item) {
    const type = (item.type || '').trim().toLowerCase();
    if (type === 'room' || type.includes('board') || type.includes('accommodation')) {
        return 'Room Accommodation / Room & Board';
    }
    if (type === 'professional fee' || type.includes('doctor') || type.includes('consultation')) {
        return 'Professional Fees';
    }
    if (type === 'medication' || type.includes('pharmacy') || type.includes('medicine') || type.includes('supplies')) {
        return 'Pharmacy / Medications / Supplies';
    }
    if (type === 'laboratory' || type.includes('diagnostic') || type.includes('lab') || type.includes('test')) {
        return 'Laboratory / Diagnostics';
    }
    return item.type || 'Other Services / Miscellaneous';
}

function groupBillItems(items) {
    const groups = {};
    items.forEach(item => {
        const cat = getBillingCategory(item);
        if (!groups[cat]) {
            groups[cat] = { name: cat, items: [], subtotal: 0 };
        }
        groups[cat].items.push(item);
        groups[cat].subtotal += (item.amount || 0);
    });
    return groups;
}

window.viewBill = async function(id) {
    currentBillId = id;
    const b = await api.getMyBillById(id);
    if (!b) return;

    document.getElementById('v-id').innerText = b.id;
    document.getElementById('v-date').innerText = utils.formatDate(b.createdAt.split('T')[0]);
    
    let badge = 'success'; if (b.status === 'Unpaid') badge = 'danger'; if (b.status === 'Partial') badge = 'warning'; if (b.status === 'Voided') badge = 'secondary" style="background:var(--color-border);color:var(--color-text-muted);';
    document.getElementById('v-status').innerHTML = `<span class="badge badge-${badge}">${b.status}</span>`;

    // Render grouped charges with category subtotals
    const groups = groupBillItems(b.items);
    let itemsHtml = '';
    for (const catName in groups) {
        const grp = groups[catName];
        itemsHtml += `
            <tr class="bill-category-header" style="background: var(--color-bg); font-weight: 600;">
                <td colspan="5" style="color: var(--color-primary); padding: 8px 16px; border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border);">
                    📂 ${utils.escapeHTML(grp.name)}
                </td>
            </tr>
        `;
        grp.items.forEach(item => {
            const unitPrice = item.unitPrice !== undefined ? item.unitPrice : (item.qty ? item.amount / item.qty : item.amount);
            itemsHtml += `
                <tr>
                    <td style="color: var(--color-text-muted); font-size: 13px;">${utils.escapeHTML(item.type || 'Other')}</td>
                    <td><strong>${utils.escapeHTML(item.description)}</strong></td>
                    <td style="text-align: center;">${item.qty}</td>
                    <td class="num">${utils.formatCurrency(unitPrice)}</td>
                    <td class="num" style="font-weight: 600;">${utils.formatCurrency(item.amount)}</td>
                </tr>
            `;
        });
        itemsHtml += `
            <tr class="bill-category-subtotal" style="font-weight: 600; background: var(--color-surface);">
                <td colspan="4" style="text-align: right; color: var(--color-text-muted); font-size: 13px;">
                    Subtotal for ${utils.escapeHTML(grp.name)}:
                </td>
                <td class="num" style="color: var(--color-primary);">${utils.formatCurrency(grp.subtotal)}</td>
            </tr>
        `;
    }
    document.getElementById('v-items').innerHTML = itemsHtml;

    // Gross Subtotal
    document.getElementById('v-subtotal').innerText = utils.formatCurrency(b.subtotal);

    // Discount Breakdown
    const discBox = document.getElementById('v-discount-details');
    if (b.discountType && b.discountType !== 'None' && b.discountAmount > 0) {
        discBox.style.display = 'block';
        document.getElementById('v-disc-type').innerText = b.discountType === 'Senior Citizen' ? 'Senior Citizen 20%' : (b.discountType === 'PWD' ? 'PWD 20%' : b.discountType);
        document.getElementById('v-disc-amt').innerText = `-${utils.formatCurrency(b.discountAmount)}`;
        document.getElementById('v-disc-basis').innerText = `${utils.formatCurrency(b.subtotal)} @ 20%`;
    } else {
        discBox.style.display = 'none';
    }

    // Insurance Breakdown
    const insBox = document.getElementById('v-insurance-details');
    if (b.insuranceCoverage && b.insuranceCoverage > 0) {
        insBox.style.display = 'block';
        document.getElementById('v-ins-prov').innerText = b.insuranceProvider || (myPatientProfile && myPatientProfile.insuranceProvider ? myPatientProfile.insuranceProvider : 'Insurance Benefit');
        document.getElementById('v-ins-amt').innerText = `-${utils.formatCurrency(b.insuranceCoverage)}`;
    } else {
        insBox.style.display = 'none';
    }

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
    if (!b) return;

    document.getElementById('print-title').innerText = 'STATEMENT OF ACCOUNT';

    const groups = groupBillItems(b.items);
    let itemsRows = '';
    for (const catName in groups) {
        const grp = groups[catName];
        itemsRows += `
            <tr style="background: #f1f5f9; font-weight: bold; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1;">
                <td colspan="5" style="padding: 6px 10px; color: #0369a1; font-size: 13px;">${utils.escapeHTML(grp.name)}</td>
            </tr>
        `;
        grp.items.forEach(item => {
            const unitPrice = item.unitPrice !== undefined ? item.unitPrice : (item.qty ? item.amount / item.qty : item.amount);
            itemsRows += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 6px 10px; font-size: 12px; color: #64748b;">${utils.escapeHTML(item.type || 'Other')}</td>
                    <td style="padding: 6px 10px;">${utils.escapeHTML(item.description)}</td>
                    <td style="padding: 6px 10px; text-align: center;">${item.qty}</td>
                    <td style="padding: 6px 10px; text-align: right;">${utils.formatCurrency(unitPrice)}</td>
                    <td style="padding: 6px 10px; text-align: right; font-weight: 600;">${utils.formatCurrency(item.amount)}</td>
                </tr>
            `;
        });
        itemsRows += `
            <tr style="background: #f8fafc; font-weight: 600;">
                <td colspan="4" style="padding: 6px 10px; text-align: right; font-size: 12px; color: #475569;">Subtotal for ${utils.escapeHTML(grp.name)}:</td>
                <td style="padding: 6px 10px; text-align: right; color: #0369a1;">${utils.formatCurrency(grp.subtotal)}</td>
            </tr>
        `;
    }

    let discountHtml = '';
    if (b.discountType && b.discountType !== 'None' && b.discountAmount > 0) {
        discountHtml = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #dc2626;">
                <span>Discount (${b.discountType} - 20%):</span>
                <span>-${utils.formatCurrency(b.discountAmount)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 11px; color: #64748b;">
                <span>(Eligible Subtotal: ${utils.formatCurrency(b.subtotal)})</span>
                <span></span>
            </div>
        `;
    }

    let insuranceHtml = '';
    if (b.insuranceCoverage && b.insuranceCoverage > 0) {
        insuranceHtml = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #16a34a;">
                <span>Insurance (${b.insuranceProvider || (myPatientProfile && myPatientProfile.insuranceProvider ? myPatientProfile.insuranceProvider : 'Coverage')}):</span>
                <span>-${utils.formatCurrency(b.insuranceCoverage)}</span>
            </div>
        `;
    }

    document.getElementById('print-content').innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #e2e8f0; font-size: 13px;">
            <div>
                <div><strong>Patient Name:</strong> ${myPatientProfile ? myPatientProfile.fullName : 'Unknown'}</div>
                <div><strong>Patient ID:</strong> ${b.patientId}</div>
                <div><strong>Address:</strong> ${myPatientProfile && myPatientProfile.address ? myPatientProfile.address : 'Not provided'}</div>
            </div>
            <div style="text-align: right;">
                <div><strong>Statement / Bill No:</strong> ${b.id}</div>
                <div><strong>Billing Date:</strong> ${utils.formatDate(b.createdAt.split('T')[0])}</div>
                <div><strong>Payment Status:</strong> <span style="font-weight: bold; text-transform: uppercase;">${b.status}</span></div>
            </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 13px;">
            <thead>
                <tr style="background: #f1f5f9; text-align: left; border-bottom: 2px solid #cbd5e1;">
                    <th style="padding: 8px 10px; width: 20%;">Category</th>
                    <th style="padding: 8px 10px;">Description</th>
                    <th style="padding: 8px 10px; width: 60px; text-align: center;">Qty</th>
                    <th style="padding: 8px 10px; width: 110px; text-align: right;">Unit Price</th>
                    <th style="padding: 8px 10px; width: 110px; text-align: right;">Amount</th>
                </tr>
            </thead>
            <tbody>${itemsRows}</tbody>
        </table>

        <div style="display: flex; justify-content: space-between; align-items: flex-start; page-break-inside: avoid;">
            <div style="font-size: 12px; color: #64748b; max-width: 320px;">
                <p><strong>Notice:</strong> Please present this Statement of Account when settling payments at the hospital cashier or through PrimeCare online portal.</p>
            </div>
            <div style="width: 360px; font-size: 13px; border: 1px solid #e2e8f0; padding: 14px; border-radius: 4px; background: #fafafa;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <strong>Gross Subtotal:</strong>
                    <strong>${utils.formatCurrency(b.subtotal)}</strong>
                </div>
                ${discountHtml}
                ${insuranceHtml}
                <div style="display: flex; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 2px solid #0f172a; font-size: 16px; font-weight: bold; color: #0369a1;">
                    <span>Final Amount Due:</span>
                    <span>${utils.formatCurrency(b.total)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 6px; font-weight: 600; color: #0284c7;">
                    <span>Amount Paid:</span>
                    <span>${utils.formatCurrency(b.amountPaid)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 16px; font-weight: bold; color: ${b.balance > 0 ? '#dc2626' : '#16a34a'};">
                    <span>Outstanding Balance:</span>
                    <span>${utils.formatCurrency(b.balance)}</span>
                </div>
            </div>
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
