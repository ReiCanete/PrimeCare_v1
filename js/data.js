// js/data.js — Seed Data & Versioned LocalStorage Initialization

const DATA_VERSION = "1.3"; // Bumped to force re-seed of empty/missing public collections

function getLocalYYYYMMDD(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const today = new Date(); const todayStr = getLocalYYYYMMDD(today);
const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1); const yesterdayStr = getLocalYYYYMMDD(yesterday);
const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1); const tomorrowStr = getLocalYYYYMMDD(tomorrow);

const seedData = {
    counters: { bill: 7, receipt: 3 },
    medicinePrices: [{ 'Amoxicillin 500mg': 15, 'Paracetamol 500mg': 5, 'Artificial Tears': 250, 'Losartan 50mg': 20, 'Metformin 500mg': 12, 'Ibuprofen 400mg': 8, 'Omeprazole 20mg': 25, 'Cetirizine 10mg': 15 }],
    labPrices: [{ 'Complete Blood Count': 500, 'Fasting Blood Sugar': 250, 'Lipid Profile': 800, 'Urinalysis': 150, 'Chest X-ray': 600, 'ECG': 750, 'Creatinine': 300 }],
    idTypes: ["PhilSys National ID", "Driver's License", "Passport", "UMID", "Voter's ID", "PRC ID", "Postal ID", "Student ID"],

    users: [
        { id: 'U-001', username: 'admin', password: 'password123', fullName: 'System Admin', role: 'admin', status: 'active', email: 'admin@primecare.ph', mobile: '09170000000', createdAt: '2026-01-01', lastLogin: todayStr, createdBy: null, mustChangePassword: false },
        { id: 'U-002', username: 'doctor', password: 'password123', fullName: 'Dr. Jose Rizal', role: 'doctor', status: 'active', email: 'jrizal@primecare.ph', mobile: '09170000001', createdAt: '2026-01-01', lastLogin: yesterdayStr, createdBy: 'U-001', mustChangePassword: false },
        { id: 'U-003', username: 'nurse', password: 'password123', fullName: 'Nurse Maria Clara', role: 'nurse', status: 'active', email: 'mclara@primecare.ph', mobile: '09170000002', createdAt: '2026-01-01', lastLogin: todayStr, createdBy: 'U-001', mustChangePassword: false },
        { id: 'U-004', username: 'staff', password: 'password123', fullName: 'Andres Bonifacio', role: 'staff', status: 'active', email: 'abonifacio@primecare.ph', mobile: '09170000003', createdAt: '2026-01-01', lastLogin: todayStr, createdBy: 'U-001', mustChangePassword: false },
        { id: 'U-005', username: 'patient', password: 'password123', fullName: 'Juan Dela Cruz', role: 'patient', status: 'active', email: 'juan@example.com', mobile: '09171234567', createdAt: '2026-10-10', lastLogin: todayStr, createdBy: null, mustChangePassword: false },
        { id: 'U-006', username: 'patient2', password: 'password123', fullName: 'Leonor Rivera', role: 'patient', status: 'pending', email: 'leonor@example.com', mobile: '09181234567', createdAt: todayStr, lastLogin: null, createdBy: null, mustChangePassword: false }
    ],

   patients: [
        { id: 'P-001', userId: 'U-005', firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz', suffix: '', fullName: 'Juan Dela Cruz', birthdate: '1985-05-15', sex: 'Male', civilStatus: 'Married', address: 'Quezon City', mobile: '09171234567', email: 'juan@example.com', emergencyContactName: 'Maria Dela Cruz', emergencyContactNumber: '09177654321', emergencyContactRelationship: 'Spouse', idType: 'Passport', idNumber: 'P1234567A', admitType: 'Outpatient', dateAdmitted: yesterdayStr, status: 'verified', verifiedBy: 'System Admin', verifiedAt: yesterdayStr, rejectionReason: null, createdAt: yesterdayStr, bloodType: 'O+', allergies: 'Penicillin, Aspirin', medicalConditions: 'Hypertension', insuranceProvider: 'PhilHealth', insuranceNumber: 'PH-12345', assignedDoctorId: 'D-001', ward: '', bedNumber: '', notes: 'Regular checkups.' },
        { id: 'P-002', userId: 'U-006', firstName: 'Leonor', middleName: 'Bautista', lastName: 'Rivera', suffix: '', fullName: 'Leonor Rivera', birthdate: '1990-08-22', sex: 'Female', civilStatus: 'Single', address: 'Manila', mobile: '09181234567', email: 'leonor@example.com', emergencyContactName: 'Antonio Rivera', emergencyContactNumber: '09187654321', emergencyContactRelationship: 'Father', idType: 'UMID', idNumber: 'CRN-123-456', admitType: 'Outpatient', dateAdmitted: todayStr, status: 'verified', verifiedBy: 'System Admin', verifiedAt: todayStr, rejectionReason: null, createdAt: todayStr, bloodType: 'A-', allergies: 'None', medicalConditions: 'Asthma', insuranceProvider: 'Maxicare', insuranceNumber: 'MAX-999', assignedDoctorId: 'D-002', ward: '', bedNumber: '', notes: 'Verified patient.' }
    ],
    doctors: [
        { id: 'D-001', userId: 'U-002', name: 'Dr. Jose Rizal', photoInitials: 'JR', specialization: 'Ophthalmology', department: 'Surgery', contact: '09170000001', email: 'jrizal@primecare.ph', languages: ['English', 'Tagalog', 'Spanish'], acceptedInsurance: ['PhilHealth', 'Maxicare'], qualifications: 'MD, PhD', status: 'active', consultationFee: 1000, slotMinutes: 30, schedule: [{day: 'Mon', start: '09:00', end: '17:00'}, {day: 'Tue', start: '09:00', end: '17:00'}, {day: 'Wed', start: '09:00', end: '17:00'}, {day: 'Thu', start: '09:00', end: '17:00'}, {day: 'Fri', start: '09:00', end: '17:00'}, {day: 'Sat', start: '09:00', end: '17:00'}, {day: 'Sun', start: '09:00', end: '17:00'}] },
        { id: 'D-002', userId: null, name: 'Dr. Antonio Luna', photoInitials: 'AL', specialization: 'Cardiology', department: 'Internal Medicine', contact: '09170000002', email: 'aluna@primecare.ph', languages: ['English', 'Tagalog'], acceptedInsurance: ['PhilHealth', 'Intellicare'], qualifications: 'MD, FACC', status: 'active', consultationFee: 1500, slotMinutes: 30, schedule: [{day: 'Mon', start: '08:00', end: '16:00'}, {day: 'Tue', start: '08:00', end: '16:00'}, {day: 'Wed', start: '08:00', end: '16:00'}, {day: 'Thu', start: '08:00', end: '16:00'}, {day: 'Fri', start: '08:00', end: '16:00'}, {day: 'Sat', start: '08:00', end: '16:00'}, {day: 'Sun', start: '08:00', end: '16:00'}] },
        { id: 'D-003', userId: null, name: 'Dr. Melchora Aquino', photoInitials: 'MA', specialization: 'Pediatrics', department: 'Pediatrics', contact: '09170000003', email: 'maquino@primecare.ph', languages: ['English', 'Tagalog'], acceptedInsurance: ['PhilHealth'], qualifications: 'MD, DPPS', status: 'active', consultationFee: 800, slotMinutes: 20, schedule: [{day: 'Mon', start: '10:00', end: '15:00'}, {day: 'Tue', start: '10:00', end: '15:00'}, {day: 'Wed', start: '10:00', end: '15:00'}, {day: 'Thu', start: '10:00', end: '15:00'}, {day: 'Fri', start: '10:00', end: '15:00'}] },
        { id: 'D-004', userId: null, name: 'Dr. Marcelo H. del Pilar', photoInitials: 'MP', specialization: 'Neurology', department: 'Internal Medicine', contact: '09170000004', email: 'mdelpilar@primecare.ph', languages: ['English', 'Tagalog'], acceptedInsurance: ['PhilHealth', 'Medicard'], qualifications: 'MD', status: 'active', consultationFee: 1200, slotMinutes: 30, schedule: [{day: 'Wed', start: '09:00', end: '17:00'}, {day: 'Thu', start: '09:00', end: '17:00'}, {day: 'Fri', start: '09:00', end: '17:00'}, {day: 'Sat', start: '09:00', end: '17:00'}] },
        { id: 'D-005', userId: null, name: 'Dr. Gregorio del Pilar', photoInitials: 'GP', specialization: 'Dermatology', department: 'Dermatology', contact: '09170000005', email: 'gdelpilar@primecare.ph', languages: ['English', 'Tagalog'], acceptedInsurance: ['PhilHealth'], qualifications: 'MD, DPDS', status: 'active', consultationFee: 1000, slotMinutes: 15, schedule: [{day: 'Mon', start: '13:00', end: '18:00'}, {day: 'Tue', start: '13:00', end: '18:00'}, {day: 'Wed', start: '13:00', end: '18:00'}, {day: 'Thu', start: '13:00', end: '18:00'}] }
    ],

    appointments: [
        { id: 'A-001', patientId: 'P-001', doctorId: 'D-001', date: yesterdayStr, time: '09:00', type: 'in-person', status: 'Completed', reason: 'Routine eye checkup', notes: '', cancelReason: null, createdBy: 'U-001', createdAt: yesterdayStr, updatedAt: yesterdayStr, billed: true, billId: 'B-001' },
        { id: 'A-002', patientId: 'P-001', doctorId: 'D-002', date: tomorrowStr, time: '10:00', type: 'telehealth', status: 'Confirmed', reason: 'Follow-up on heart palpitations', notes: '', cancelReason: null, createdBy: 'U-005', createdAt: todayStr, updatedAt: todayStr, billed: false }
    ],

    medicalRecords: [
        { id: 'M-001', patientId: 'P-001', chiefComplaint: 'Blurry vision', vitals: { bp: '120/80', heartRate: 75, temperature: 36.5, respRate: 16, weightKg: 70, heightCm: 170, spo2: 98 }, diagnosis: 'Myopia', treatmentNotes: 'Prescribed new corrective lenses.', followUpDate: null, appointmentId: 'A-001', attendingDoctorId: 'D-001', createdBy: 'U-002', createdAt: yesterdayStr, updatedAt: yesterdayStr, history: [] }
    ],

    prescriptions: [
        { id: 'RX-001', patientId: 'P-001', doctorId: 'D-001', medicalRecordId: 'M-001', items: [{ medicine: 'Artificial Tears', dosage: '1 drop', frequency: '3x a day', durationDays: 30, instructions: 'Apply to both eyes.' }], status: 'Dispensed', date: yesterdayStr, notes: 'Avoid rubbing eyes.', billed: true, billId: 'B-001' }
    ],

    labResults: [
        { id: 'LAB-001', patientId: 'P-001', orderedBy: 'D-001', testName: 'Complete Blood Count', category: 'Hematology', status: 'Completed', result: '13.5', unit: 'g/dL', referenceRange: { min: 13.8, max: 17.2 }, flag: 'Abnormal', attachmentName: null, orderedDate: yesterdayStr, resultDate: yesterdayStr, performedBy: 'System Admin', billed: true, billId: 'B-001' },
        { id: 'LAB-002', patientId: 'P-001', orderedBy: 'D-002', testName: 'Lipid Profile', category: 'Chemistry', status: 'Completed', result: '180', unit: 'mg/dL', referenceRange: { min: 0, max: 200 }, flag: 'Normal', attachmentName: null, orderedDate: todayStr, resultDate: todayStr, performedBy: 'System Admin', billed: false }
    ],

    immunizations: [
        { id: 'IMM-001', patientId: 'P-001', vaccine: 'COVID-19 (Pfizer)', dose: '1st Dose', date: '2021-06-15', administeredBy: 'Dr. Jose Rizal' },
        { id: 'IMM-002', patientId: 'P-001', vaccine: 'COVID-19 (Pfizer)', dose: '2nd Dose', date: '2021-07-15', administeredBy: 'Dr. Jose Rizal' }
    ],

    wards: [
        { id: 'W1', name: 'General Ward A', type: 'General', dailyRate: 1500 },
        { id: 'W2', name: 'ICU', type: 'ICU', dailyRate: 5000 },
        { id: 'W3', name: 'Maternity', type: 'Maternity', dailyRate: 2500 },
        { id: 'W4', name: 'Pediatrics', type: 'Pediatrics', dailyRate: 2000 },
        { id: 'W5', name: 'Emergency', type: 'Emergency', dailyRate: 1000 }
    ],
    beds: [],

    admissions: [
        { id: 'ADM-001', patientId: 'P-001', bedId: 'W1-B01', attendingDoctorId: 'D-002', admitDate: '2025-01-10', dischargeDate: '2025-01-12', dailyRate: 1500, dischargeSummary: 'Patient stabilized and discharged with oral meds.', status: 'Discharged', billed: true }
    ],

    bills: [
        { id: 'B-001', patientId: 'P-001', admissionId: null, items: [
            { type: 'Professional Fee', description: 'Consultation - Dr. Jose Rizal', qty: 1, unitPrice: 1000, amount: 1000, sourceType: 'appointments', sourceId: 'A-001' },
            { type: 'Medication', description: 'Artificial Tears', qty: 1, unitPrice: 250, amount: 250, sourceType: 'prescriptions', sourceId: 'RX-001' },
            { type: 'Laboratory', description: 'Complete Blood Count', qty: 1, unitPrice: 500, amount: 500, sourceType: 'labResults', sourceId: 'LAB-001' }
        ], subtotal: 1750, discountType: 'None', discountAmount: 0, insuranceProvider: 'PhilHealth', insuranceCoverage: 500, total: 1250, amountPaid: 1250, balance: 0, status: 'Paid', voidReason: null, createdBy: 'U-004', createdAt: yesterdayStr, payments: [
            { receiptNo: 'R-0001', amount: 1250, method: 'Cash', reference: '', paidAt: yesterdayStr, receivedBy: 'Andres Bonifacio' }
        ]},
        { id: 'B-002', patientId: 'P-001', admissionId: null, items: [{ type: 'Laboratory', description: 'Lipid Profile', qty: 1, unitPrice: 800, amount: 800 }], subtotal: 800, discountType: 'None', discountAmount: 0, insuranceProvider: '', insuranceCoverage: 0, total: 800, amountPaid: 0, balance: 800, status: 'Unpaid', voidReason: null, createdBy: 'U-001', createdAt: todayStr, payments: [] }
    ],

    notifications: [
        { id: 'N-001', patientId: 'P-001', type: 'system', title: 'Welcome', message: 'Welcome to the PRIMECARE Patient Portal!', link: 'home.html', read: false, date: yesterdayStr + 'T08:00:00.000Z' }
    ],

    preVisitForms: [], paymentPlanRequests: [], auditLog: [],

    departments: [
        { name: 'Cardiology', description: 'Comprehensive heart and cardiovascular care.', services: ['ECG', 'Echocardiogram', 'Angioplasty'] },
        { name: 'Pediatrics', description: 'Infant, child, and adolescent healthcare.', services: ['Vaccinations', 'Newborn Screening', 'Wellness Checks'] },
        { name: 'Oncology', description: 'Cancer diagnosis, treatment, and care.', services: ['Chemotherapy', 'Radiation Therapy', 'Tumor Removal'] },
        { name: 'Internal Medicine', description: 'Adult diseases and general health management.', services: ['Routine Checkups', 'Diabetes Management', 'Hypertension Care'] },
        { name: 'Surgery', description: 'General and specialized surgical procedures.', services: ['Appendectomy', 'Hernia Repair', 'Minimally Invasive Surgery'] },
        { name: 'Dermatology', description: 'Skin, hair, and nail care.', services: ['Acne Treatment', 'Skin Biopsy', 'Laser Therapy'] }
    ],

    emergencyInfo: {
        hotline: "(02) 8123-4567",
        address: "123 Rizal St., Quezon City",
        erWaitTimes: [
            { area: "Triage", minutes: 5 },
            { area: "Adult ER", minutes: 25 },
            { area: "Pediatric ER", minutes: 12 },
            { area: "Trauma", minutes: 0 }
        ]
    },

    triageGuide: [
        { level: "Critical", desc: "Immediate life-saving intervention needed.", symptoms: "Cardiac arrest, severe bleeding, unconsciousness", color: "danger" },
        { level: "Urgent", desc: "Requires quick attention, but not immediately life-threatening.", symptoms: "Severe pain, difficulty breathing, suspected stroke", color: "warning" },
        { level: "Semi-urgent", desc: "Needs care within a few hours.", symptoms: "Fractures, moderate cuts, high fever", color: "info" },
        { level: "Non-urgent", desc: "Minor conditions that can wait or be treated at a clinic.", symptoms: "Minor burns, colds, sprains", color: "success" }
    ],

    visitorInfo: {
        visitingHours: [
            { area: "General Ward", hours: "9:00 AM - 8:00 PM" },
            { area: "ICU", hours: "10:00 AM - 11:00 AM, 5:00 PM - 6:00 PM" },
            { area: "Maternity", hours: "10:00 AM - 7:00 PM" }
        ],
        icuProtocols: "Only 2 visitors allowed at a time. Protective gear must be worn. No children under 12.",
        infectionControl: "Masks are required in all patient areas. Sanitize hands upon entry and exit.",
        parking: "Visitor parking is located at the East Wing. Rate is ₱50 for the first 3 hours.",
        cafeteria: "Open daily from 6:00 AM to 9:00 PM on the Ground Floor."
    }
};

// Generate 6 beds per ward
seedData.wards.forEach(w => {
    for (let i = 1; i <= 6; i++) {
        const bedId = `${w.id}-B${String(i).padStart(2, '0')}`;
        seedData.beds.push({ id: bedId, wardId: w.id, bedNumber: `B${String(i).padStart(2, '0')}`, status: 'Available', currentPatientId: null });
    }
});

function initializeMockData() {
    const currentVersion = localStorage.getItem('primecare_dataVersion');
    const staticKeys = ['departments', 'emergencyInfo', 'triageGuide', 'visitorInfo', 'idTypes', 'medicinePrices', 'labPrices'];

    for (const key in seedData) {
        const storageKey = `primecare_${key}`;
        const existing = localStorage.getItem(storageKey);
        const isEmpty = !existing || existing === '[]' || existing === '{}' || existing === 'null';

        // Seed if missing/empty, or refresh static reference data when version bumps
        if (isEmpty || (currentVersion !== DATA_VERSION && staticKeys.includes(key))) {
            localStorage.setItem(storageKey, JSON.stringify(seedData[key]));
        }
    }
    localStorage.setItem('primecare_dataVersion', DATA_VERSION);
}
initializeMockData();