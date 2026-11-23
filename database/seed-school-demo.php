<?php
/**
 * PrimeCare HIS — Repeatable School Demo Data Seeder & Cleanup Tool
 *
 * Populates realistic, 100% fictional hospital data for school presentations
 * without modifying the database schema or overwriting existing non-demo records.
 *
 * USAGE (CLI only):
 *   php database/seed-school-demo.php --seed --confirm-school-demo
 *   php database/seed-school-demo.php --remove --confirm-school-demo
 *
 * SAFEGUARDS:
 * - Refuses to run over HTTP or when PRIMECARE_ENV=production.
 * - Requires explicit --confirm-school-demo flag.
 * - Uses isolated demo ID ranges (101+ / R-1001+) so non-demo rows are untouched.
 * - Writes unique generated passwords ONLY to git-ignored `database/demo-credentials.local.txt`
 *   and never prints passwords to stdout or stderr.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Forbidden: CLI execution only.';
    exit(1);
}

if (strtolower((string) getenv('PRIMECARE_ENV')) === 'production') {
    fwrite(STDERR, "REFUSED: School demo seeder cannot run when PRIMECARE_ENV=production.\n");
    exit(1);
}

$args        = array_slice($argv, 1);
$doSeed      = in_array('--seed', $args, true);
$doRemove    = in_array('--remove', $args, true);
$confirmed   = in_array('--confirm-school-demo', $args, true);

if (!$confirmed || ($doSeed === $doRemove)) {
    echo "PrimeCare School Demo Seeder\n";
    echo "Usage:\n";
    echo "  php database/seed-school-demo.php --seed --confirm-school-demo\n";
    echo "  php database/seed-school-demo.php --remove --confirm-school-demo\n";
    exit(1);
}

require_once __DIR__ . '/../api/config/database.php';

$pdo       = getDatabaseConnection();
$credsFile = __DIR__ . '/demo-credentials.local.txt';

function generateDemoPassword(): string
{
    $upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    $lower = 'abcdefghijkmnopqrstuvwxyz';
    $digit = '23456789';
    $all   = $upper . $lower . $digit;
    $chars = [
        $upper[random_int(0, strlen($upper) - 1)],
        $lower[random_int(0, strlen($lower) - 1)],
        $digit[random_int(0, strlen($digit) - 1)],
    ];
    for ($i = 0; $i < 11; $i++) {
        $chars[] = $all[random_int(0, strlen($all) - 1)];
    }
    for ($i = count($chars) - 1; $i > 0; $i--) {
        $j         = random_int(0, $i);
        $tmp       = $chars[$i];
        $chars[$i] = $chars[$j];
        $chars[$j] = $tmp;
    }
    return implode('', $chars);
}

function removeDemoRecords(PDO $pdo): void
{
    // Reverse FK order; strictly scoped to demo ID ranges (101+ / R-1001+)
    $stmts = [
        "DELETE FROM payments WHERE receipt_no REGEXP '^R-10[0-9]{2}$'",
        "DELETE FROM payment_plan_requests WHERE bill_id REGEXP '^B-1[0-9]{2}$'",
        "DELETE FROM bill_items WHERE bill_id REGEXP '^B-1[0-9]{2}$'",
        "UPDATE appointments SET billed = 0, bill_id = NULL WHERE bill_id REGEXP '^B-1[0-9]{2}$'",
        "UPDATE admissions SET billed = 0, bill_id = NULL WHERE bill_id REGEXP '^B-1[0-9]{2}$'",
        "UPDATE prescriptions SET billed = 0, bill_id = NULL WHERE bill_id REGEXP '^B-1[0-9]{2}$'",
        "UPDATE lab_results SET billed = 0, bill_id = NULL WHERE bill_id REGEXP '^B-1[0-9]{2}$'",
        "DELETE FROM bills WHERE id REGEXP '^B-1[0-9]{2}$'",
        "DELETE FROM prescription_items WHERE prescription_id REGEXP '^RX-1[0-9]{2}$'",
        "DELETE FROM prescriptions WHERE id REGEXP '^RX-1[0-9]{2}$'",
        "DELETE FROM medical_record_history WHERE medical_record_id REGEXP '^M-1[0-9]{2}$'",
        "DELETE FROM medical_records WHERE id REGEXP '^M-1[0-9]{2}$'",
        "DELETE FROM lab_results WHERE id REGEXP '^LAB-1[0-9]{2}$'",
        "DELETE FROM pre_visit_forms WHERE appointment_id REGEXP '^A-1[0-9]{2}$'",
        "DELETE FROM appointments WHERE id REGEXP '^A-1[0-9]{2}$'",
        "UPDATE beds SET status = 'Available', current_patient_id = NULL WHERE current_patient_id REGEXP '^P-1[0-9]{2}$' OR id IN ('W1-B06', 'W4-B06')",
        "DELETE FROM admissions WHERE id REGEXP '^ADM-1[0-9]{2}$'",
        "DELETE FROM notifications WHERE patient_id REGEXP '^P-1[0-9]{2}$'",
        "DELETE FROM immunizations WHERE patient_id REGEXP '^P-1[0-9]{2}$'",
        "DELETE FROM patients WHERE id REGEXP '^P-1[0-9]{2}$'",
        "DELETE FROM doctor_schedules WHERE doctor_id REGEXP '^D-1[0-9]{2}$'",
        "DELETE FROM doctors WHERE id REGEXP '^D-1[0-9]{2}$'",
        "DELETE FROM audit_logs WHERE user_id REGEXP '^U-1[0-9]{2}$' OR details LIKE '%[SCHOOL DEMO]%'",
        "DELETE FROM users WHERE id REGEXP '^U-1[0-9]{2}$'",
    ];

    foreach ($stmts as $sql) {
        $pdo->exec($sql);
    }

    // Resync sequences cleanly to max remaining numeric suffix
    $seqMap = [
        ['users',          'users',           'id',         'U-'],
        ['patients',       'patients',        'id',         'P-'],
        ['doctors',        'doctors',         'id',         'D-'],
        ['appointments',   'appointments',    'id',         'A-'],
        ['medicalRecords', 'medical_records', 'id',         'M-'],
        ['prescriptions',  'prescriptions',   'id',         'RX-'],
        ['labResults',     'lab_results',     'id',         'LAB-'],
        ['admissions',     'admissions',      'id',         'ADM-'],
        ['bills',          'bills',           'id',         'B-'],
        ['receipts',       'payments',        'receipt_no', 'R-'],
    ];

    $updSeq = $pdo->prepare('UPDATE sequences SET current_val = :val WHERE entity_key = :key');
    foreach ($seqMap as [$key, $table, $col, $prefix]) {
        $offset = strlen($prefix) + 1;
        $maxVal = (int) $pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(`{$col}`, {$offset}) AS UNSIGNED)), 0) FROM `{$table}` WHERE `{$col}` LIKE '{$prefix}%'")->fetchColumn();
        $updSeq->execute([':val' => $maxVal, ':key' => $key]);
    }
}

if ($doRemove) {
    $pdo->beginTransaction();
    try {
        removeDemoRecords($pdo);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fwrite(STDERR, 'Cleanup failed: ' . $e->getMessage() . "\n");
        exit(1);
    }
    if (is_file($credsFile)) {
        @unlink($credsFile);
    }
    echo "School demo data removed cleanly. Non-demo records preserved.\n";
    exit(0);
}

// =============================================================================
// SEED SCHOOL DEMO DATA
// =============================================================================
$today = new DateTimeImmutable('today');
$dayStr = static fn(int $offsetDays): string => $today->modify(($offsetDays >= 0 ? '+' : '') . $offsetDays . ' days')->format('Y-m-d');

$demoUsers = [
    ['U-101', 'demo_admin',     'Dr. Elena Santos',        'admin',   'active',  'demo.admin@demo.primecare.local',     '09995550101', 'Hospital Administrator'],
    ['U-102', 'demo_reception', 'Camille Mendoza',         'staff',   'active',  'demo.reception@demo.primecare.local', '09995550102', 'Receptionist / Front Desk'],
    ['U-103', 'demo_billing',   'Rafael Villanueva',       'staff',   'active',  'demo.billing@demo.primecare.local',   '09995550103', 'Billing & Cashier Staff'],
    ['U-104', 'demo_doctor',    'Dr. Marco Reyes',         'doctor',  'active',  'demo.doctor@demo.primecare.local',    '09995550104', 'Cardiology Attending Physician (D-101)'],
    ['U-105', 'demo_doctor2',   'Dr. Clarissa Bautista',   'doctor',  'active',  'demo.doctor2@demo.primecare.local',   '09995550105', 'Pediatrics Attending Physician (D-102)'],
    ['U-106', 'demo_nurse',     'Nurse Angela Flores',     'nurse',   'active',  'demo.nurse@demo.primecare.local',     '09995550106', 'Ward & Triage Nurse'],
    ['U-107', 'demo_lab',       'Patricia Navarro, RMT',   'nurse',   'active',  'demo.lab@demo.primecare.local',       '09995550107', 'Laboratory & Clinical Support'],
    ['U-108', 'demo_patient',   'Miguel Torres',           'patient', 'active',  'demo.patient@demo.primecare.local',   '09995550108', 'Verified Demo Patient (P-101)'],
    ['U-109', 'demo_patient2',  'Sofia Ramos',             'patient', 'pending', 'demo.patient2@demo.primecare.local',  '09995550109', 'Pending Verification Demo Patient (P-102)'],
];

$generatedCreds = [];
foreach ($demoUsers as $u) {
    $generatedCreds[$u[1]] = [
        'id'       => $u[0],
        'username' => $u[1],
        'password' => generateDemoPassword(),
        'fullName' => $u[2],
        'role'     => $u[3],
        'status'   => $u[4],
        'label'    => $u[7],
    ];
}

$demoDoctors = [
    ['D-101', 'U-104', 'Dr. Marco Reyes',         'MR', 'Cardiology',        'Cardiology',        '09995551001', 'mreyes@demo.primecare.local',    'MD, FPCP, FPCC',  1500.00, 30, ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], '08:00:00', '16:00:00'],
    ['D-102', 'U-105', 'Dr. Clarissa Bautista',   'CB', 'Pediatrics',        'Pediatrics',        '09995551002', 'cbautista@demo.primecare.local', 'MD, DPPS',         900.00, 20, ['Mon','Tue','Wed','Thu','Fri','Sat'],       '09:00:00', '16:00:00'],
    ['D-103', null,    'Dr. Victorino Castillo',  'VC', 'General Surgery',   'Surgery',           '09995551003', 'vcastillo@demo.primecare.local', 'MD, FPCS',        1800.00, 30, ['Mon','Tue','Wed','Thu','Fri'],             '09:00:00', '17:00:00'],
    ['D-104', null,    'Dr. Beatrice Soriano',    'BS', 'Internal Medicine', 'Internal Medicine', '09995551004', 'bsoriano@demo.primecare.local',  'MD, FPCP',        1100.00, 30, ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], '08:30:00', '16:30:00'],
    ['D-105', null,    'Dr. Lorenzo Aquino',      'LA', 'Medical Oncology',  'Oncology',          '09995551005', 'laquino@demo.primecare.local',   'MD, FPSMO',       2000.00, 30, ['Tue','Wed','Thu','Fri'],                   '10:00:00', '17:00:00'],
    ['D-106', null,    'Dr. Katrina Velasco',     'KV', 'Dermatology',       'Dermatology',       '09995551006', 'kvelasco@demo.primecare.local',  'MD, FPDS',        1200.00, 20, ['Mon','Wed','Fri','Sat'],                   '10:00:00', '16:00:00'],
    ['D-107', null,    'Dr. Gabriel Tolentino',   'GT', 'Pulmonology',       'Internal Medicine', '09995551007', 'gtolentino@demo.primecare.local','MD, FPCCP',       1300.00, 30, ['Mon','Tue','Thu','Fri','Sat'],             '08:00:00', '15:00:00'],
    ['D-108', null,    'Dr. Hannah Evangelista',  'HE', 'OB-Gynecology',     'Pediatrics',        '09995551008', 'hevangelista@demo.primecare.local','MD, FPOGS',     1400.00, 30, ['Mon','Tue','Wed','Thu','Fri','Sat'],       '09:00:00', '17:00:00'],
];

$patientProfiles = [
    ['Miguel',    'A.', 'Torres',     'Male',   '1984-03-14', 'Married', 'O+',  'Penicillin',            'Hypertension',           'PhilHealth', 'verified', 'U-108'],
    ['Sofia',     'L.', 'Ramos',      'Female', '1995-07-22', 'Single',  'A+',  'None',                  'Seasonal Rhinitis',      'Maxicare',   'pending',  'U-109'],
    ['Daniel',    'R.', 'Navarro',    'Male',   '1976-11-05', 'Married', 'B+',  'Aspirin',               'Type 2 Diabetes',        'PhilHealth', 'verified', null],
    ['Isabela',   'M.', 'Fernandez',  'Female', '1991-02-18', 'Single',  'AB+', 'None',                  'Migraine',               'Intellicare','verified', null],
    ['Mateo',     'C.', 'Salazar',    'Male',   '1968-09-30', 'Married', 'O-',  'Sulfonamides',          'Coronary Artery Disease','PhilHealth', 'verified', null],
    ['Gabriela',  'S.', 'Morales',    'Female', '1988-06-11', 'Married', 'A-',  'Latex',                 'Asthma',                 'Medicard',   'verified', null],
    ['Lucas',     'D.', 'Pascual',    'Male',   '1999-12-03', 'Single',  'B-',  'None',                  'None',                   'PhilHealth', 'verified', null],
    ['Andrea',    'P.', 'Ocampo',     'Female', '1982-04-25', 'Married', 'O+',  'Ibuprofen',             'Hypothyroidism',         'Maxicare',   'verified', null],
    ['Nathaniel', 'G.', 'De Leon',    'Male',   '1974-08-19', 'Married', 'A+',  'None',                  'Hyperlipidemia',         'PhilHealth', 'verified', null],
    ['Bianca',    'V.', 'Herrera',    'Female', '1993-10-08', 'Single',  'B+',  'Shellfish',             'Eczema',                 'Intellicare','verified', null],
    ['Sebastian', 'T.', 'Dominguez',  'Male',   '1965-01-27', 'Widowed', 'O+',  'None',                  'Osteoarthritis',         'PhilHealth', 'verified', null],
    ['Valeria',   'E.', 'Castro',     'Female', '1997-05-16', 'Single',  'AB-', 'None',                  'Iron Deficiency Anemia', 'Maxicare',   'verified', null],
    ['Enrique',   'F.', 'Alvarez',    'Male',   '1980-07-04', 'Married', 'A+',  'None',                  'GERD',                   'PhilHealth', 'verified', null],
    ['Camila',    'J.', 'Mendoza',    'Female', '1986-09-12', 'Married', 'O+',  'Codeine',               'Gestational Follow-up',  'Medicard',   'verified', null],
    ['Joaquin',   'B.', 'Mercado',    'Male',   '1972-03-29', 'Married', 'B+',  'None',                  'Chronic Bronchitis',     'PhilHealth', 'verified', null],
    ['Patricia',  'N.', 'Velasquez',  'Female', '1990-11-21', 'Single',  'A+',  'None',                  'None',                   'PhilHealth', 'verified', null],
    ['Diego',     'H.', 'Serrano',    'Male',   '1985-02-09', 'Married', 'O+',  'Penicillin',            'Hypertension',           'Intellicare','verified', null],
    ['Mariana',   'K.', 'Aguilar',    'Female', '1979-06-30', 'Married', 'B+',  'None',                  'Type 2 Diabetes',        'PhilHealth', 'verified', null],
    ['Rafael',    'Q.', 'Padilla',    'Male',   '1994-04-17', 'Single',  'O-',  'None',                  'Sports Injury Recovery', 'Maxicare',   'verified', null],
    ['Lucia',     'W.', 'Santiago',   'Female', '1963-12-11', 'Widowed', 'A+',  'NSAIDs',                'Hypertension, Arthritis','PhilHealth', 'verified', null],
    ['Adrian',    'Z.', 'Bautista',   'Male',   '1989-08-03', 'Married', 'AB+', 'None',                  'Allergic Rhinitis',      'Medicard',   'verified', null],
    ['Elena',     'R.', 'Villareal',  'Female', '1996-01-24', 'Single',  'O+',  'None',                  'None',                   'PhilHealth', 'verified', null],
    ['Tomas',     'M.', 'Pineda',     'Male',   '1971-05-06', 'Married', 'B-',  'None',                  'Gout',                   'PhilHealth', 'verified', null],
    ['Beatriz',   'C.', 'Rosario',    'Female', '1983-10-15', 'Married', 'A-',  'Peanuts',               'Asthma',                 'Maxicare',   'verified', null],
    ['Carlos',    'L.', 'Manalo',     'Male',   '1977-09-28', 'Married', 'O+',  'None',                  'Hypertension',           'PhilHealth', 'verified', null],
    ['Diana',     'A.', 'Galvez',     'Female', '1992-03-07', 'Single',  'A+',  'None',                  'Migraine',               'Intellicare','verified', null],
    ['Lorenzo',   'P.', 'Corpuz',     'Male',   '1969-11-14', 'Married', 'B+',  'None',                  'COPD',                   'PhilHealth', 'verified', null],
    ['Katrina',   'S.', 'Estrella',   'Female', '1998-07-19', 'Single',  'O+',  'None',                  'None',                   'PhilHealth', 'pending',  null],
    ['Marco',     'D.', 'Jimenez',    'Male',   '1991-04-02', 'Single',  'A+',  'None',                  'None',                   'Maxicare',   'pending',  null],
    ['Teresita',  'G.', 'Valdez',     'Female', '1987-08-26', 'Married', 'B+',  'None',                  'None',                   'PhilHealth', 'rejected', null],
];

$cities = [
    ['Quezon City', 'Metro Manila', 'Loyola Heights'],
    ['Makati City', 'Metro Manila', 'Bel-Air'],
    ['Pasig City',  'Metro Manila', 'Kapitolyo'],
    ['Taguig City', 'Metro Manila', 'Fort Bonifacio'],
    ['Manila',      'Metro Manila', 'Ermita'],
];

$pdo->beginTransaction();
try {
    // Clean any prior demo rows first (idempotent)
    removeDemoRecords($pdo);

    // 1. Insert 9 Demo Users
    $insUser = $pdo->prepare(
        'INSERT INTO users (id, username, password_hash, full_name, role, status, email, mobile, must_change_password, last_login, created_by, created_at)
         VALUES (:id, :u, :hash, :fn, :role, :st, :em, :mob, 0, :ll, :cb, :ca)'
    );
    foreach ($demoUsers as $idx => $u) {
        $plain = $generatedCreds[$u[1]]['password'];
        $insUser->execute([
            ':id'   => $u[0],
            ':u'    => $u[1],
            ':hash' => password_hash($plain, PASSWORD_BCRYPT),
            ':fn'   => $u[2],
            ':role' => $u[3],
            ':st'   => $u[4],
            ':em'   => $u[5],
            ':mob'  => $u[6],
            ':ll'   => $u[4] === 'active' ? $dayStr(-($idx % 3)) : null,
            ':cb'   => $u[0] === 'U-101' ? null : 'U-101',
            ':ca'   => $dayStr(-25 + $idx),
        ]);
    }

    // 2. Insert 8 Fictional Doctors + Schedules
    $insDoc = $pdo->prepare(
        'INSERT INTO doctors (id, user_id, name, photo_initials, specialization, department, contact, email, languages_json, accepted_insurance_json, qualifications, status, consultation_fee, slot_minutes)
         VALUES (:id, :uid, :name, :init, :spec, :dept, :cont, :em, :lang, :ins, :qual, \'active\', :fee, :slot)'
    );
    $insSched = $pdo->prepare(
        'INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (:did, :dow, :st, :et)'
    );
    foreach ($demoDoctors as $d) {
        $insDoc->execute([
            ':id'   => $d[0],
            ':uid'  => $d[1],
            ':name' => $d[2],
            ':init' => $d[3],
            ':spec' => $d[4],
            ':dept' => $d[5],
            ':cont' => $d[6],
            ':em'   => $d[7],
            ':lang' => json_encode(['English', 'Tagalog']),
            ':ins'  => json_encode(['PhilHealth', 'Maxicare', 'Intellicare']),
            ':qual' => $d[8],
            ':fee'  => $d[9],
            ':slot' => $d[10],
        ]);
        foreach ($d[11] as $dow) {
            $insSched->execute([':did' => $d[0], ':dow' => $dow, ':st' => $d[12], ':et' => $d[13]]);
        }
    }

    // 3. Insert 30 Fictional Patients
    $insPat = $pdo->prepare(
        'INSERT INTO patients (
            id, user_id, first_name, middle_name, last_name, suffix, full_name,
            birthdate, sex, civil_status, street, barangay, city, province, address,
            mobile, email, emergency_contact_name, emergency_contact_number, emergency_contact_relationship,
            id_type, id_number, admit_type, date_admitted, status, verified_by, verified_at, rejection_reason,
            blood_type, allergies, medical_conditions, insurance_provider, insurance_number,
            assigned_doctor_id, ward, bed_number, notes, created_at
         ) VALUES (
            :id, :uid, :fn, :mn, :ln, \'\', :full,
            :dob, :sex, :cs, :st, :brgy, :city, :prov, :addr,
            :mob, :em, :ecn, :ecnum, :ecrel,
            :idt, :idn, \'Outpatient\', :da, :status, :vby, :vat, :rej,
            :bt, :alg, :cond, :ins, :insn,
            :doc, \'\', \'\', :notes, :ca
         )'
    );
    $idTypes = ['PhilSys National ID', "Driver's License", 'Passport', 'UMID', 'PRC ID'];
    foreach ($patientProfiles as $i => $p) {
        $num   = 101 + $i;
        $pid   = 'P-' . $num;
        $full  = "{$p[0]} {$p[2]}";
        $loc   = $cities[$i % count($cities)];
        $st    = (100 + $i) . ' Demo Oak St.';
        $addr  = "{$st}, {$loc[2]}, {$loc[0]}, {$loc[1]}";
        $ca    = $dayStr(-22 + ($i % 22));
        $docId = 'D-' . (101 + ($i % 8));
        $insPat->execute([
            ':id'     => $pid,
            ':uid'    => $p[11],
            ':fn'     => $p[0],
            ':mn'     => $p[1],
            ':ln'     => $p[2],
            ':full'   => $full,
            ':dob'    => $p[4],
            ':sex'    => $p[3],
            ':cs'     => $p[5],
            ':st'     => $st,
            ':brgy'   => $loc[2],
            ':city'   => $loc[0],
            ':prov'   => $loc[1],
            ':addr'   => $addr,
            ':mob'    => '0999555' . str_pad((string) (2000 + $i), 4, '0', STR_PAD_LEFT),
            ':em'     => strtolower($p[0] . '.' . str_replace(' ', '', $p[2])) . '@demo.primecare.local',
            ':ecn'    => 'Elena ' . $p[2],
            ':ecnum'  => '0999555' . str_pad((string) (3000 + $i), 4, '0', STR_PAD_LEFT),
            ':ecrel'  => $p[5] === 'Married' ? 'Spouse' : 'Sibling',
            ':idt'    => $idTypes[$i % count($idTypes)],
            ':idn'    => 'DEMO-ID-' . str_pad((string) $num, 5, '0', STR_PAD_LEFT),
            ':da'     => $ca,
            ':status' => $p[10],
            ':vby'    => $p[10] === 'verified' ? 'Camille Mendoza' : null,
            ':vat'    => $p[10] === 'verified' ? $ca : null,
            ':rej'    => $p[10] === 'rejected' ? '[SCHOOL DEMO] Incomplete ID image submitted.' : null,
            ':bt'     => $p[6],
            ':alg'    => $p[7],
            ':cond'   => $p[8],
            ':ins'    => $p[9],
            ':insn'   => strtoupper(substr($p[9], 0, 3)) . '-' . (50000 + $num),
            ':doc'    => $docId,
            ':notes'  => '[SCHOOL DEMO] Fictional patient profile for classroom demonstration.',
            ':ca'     => $ca,
        ]);
    }

    // 4. Insert 10 Fictional Admissions (6 active occupying beds + 4 discharged) + 2 maintenance beds
    $demoAdmissions = [
        // Active Inpatients (6)
        ['ADM-101', 'P-105', 'W2-B01', 'D-101', -4, null, 5000.00, 'Admitted',   null, 'ICU',            'B01'],
        ['ADM-102', 'P-106', 'W1-B02', 'D-107', -3, null, 1500.00, 'Admitted',   null, 'General Ward A', 'B02'],
        ['ADM-103', 'P-114', 'W3-B01', 'D-108', -2, null, 2500.00, 'Admitted',   null, 'Maternity',      'B01'],
        ['ADM-104', 'P-115', 'W1-B03', 'D-104', -2, null, 1500.00, 'Admitted',   null, 'General Ward A', 'B03'],
        ['ADM-105', 'P-120', 'W4-B01', 'D-102', -1, null, 2000.00, 'Admitted',   null, 'Pediatrics',     'B01'],
        ['ADM-106', 'P-127', 'W5-B01', 'D-103',  0, null, 1000.00, 'Admitted',   null, 'Emergency',      'B01'],
        // Discharged Stays (4)
        ['ADM-107', 'P-101', 'W1-B04', 'D-101', -12, -9,  1500.00, 'Discharged', '[SCHOOL DEMO] Blood pressure stabilized; discharged on maintenance oral therapy.', 'General Ward A', 'B04'],
        ['ADM-108', 'P-103', 'W1-B05', 'D-104', -10, -7,  1500.00, 'Discharged', '[SCHOOL DEMO] Glycemic control achieved; outpatient endocrinology follow-up advised.', 'General Ward A', 'B05'],
        ['ADM-109', 'P-111', 'W2-B02', 'D-103', -8,  -5,  5000.00, 'Discharged', '[SCHOOL DEMO] Post-operative recovery uneventful; cleared for home care.', 'ICU', 'B02'],
        ['ADM-110', 'P-118', 'W3-B02', 'D-108', -6,  -4,  2500.00, 'Discharged', '[SCHOOL DEMO] Condition resolved; follow-up scheduled in 2 weeks.', 'Maternity', 'B02'],
    ];
    $insAdm = $pdo->prepare(
        'INSERT INTO admissions (id, patient_id, bed_id, attending_doctor_id, admit_date, discharge_date, daily_rate, discharge_summary, status, billed, bill_id)
         VALUES (:id, :pid, :bid, :did, :ad, :dd, :rate, :sum, :st, 0, NULL)'
    );
    $updBed = $pdo->prepare('UPDATE beds SET status = :st, current_patient_id = :pid WHERE id = :bid');
    $updPatIn = $pdo->prepare("UPDATE patients SET admit_type = 'Inpatient', ward = :w, bed_number = :bn, assigned_doctor_id = :did, date_admitted = :ad WHERE id = :pid");
    foreach ($demoAdmissions as $a) {
        $insAdm->execute([
            ':id'   => $a[0],
            ':pid'  => $a[1],
            ':bid'  => $a[2],
            ':did'  => $a[3],
            ':ad'   => $dayStr($a[4]),
            ':dd'   => $a[5] !== null ? $dayStr($a[5]) : null,
            ':rate' => $a[6],
            ':sum'  => $a[8],
            ':st'   => $a[7],
        ]);
        if ($a[7] === 'Admitted') {
            $updBed->execute([':st' => 'Occupied', ':pid' => $a[1], ':bid' => $a[2]]);
            $updPatIn->execute([':w' => $a[9], ':bn' => $a[10], ':did' => $a[3], ':ad' => $dayStr($a[4]), ':pid' => $a[1]]);
        }
    }
    $updBed->execute([':st' => 'Maintenance', ':pid' => null, ':bid' => 'W1-B06']);
    $updBed->execute([':st' => 'Maintenance', ':pid' => null, ':bid' => 'W4-B06']);

    // 5. Insert 48 Fictional Appointments across past 12 days, today (6), and next 12 days
    $verifiedPids = array_values(array_map(
        static fn(int $idx): string => 'P-' . (101 + $idx),
        array_keys(array_filter($patientProfiles, static fn(array $p): bool => $p[10] === 'verified'))
    ));
    $reasons = [
        'Annual cardiovascular checkup', 'Follow-up blood pressure monitoring', 'Persistent cough evaluation',
        'Routine pediatric wellness visit', 'Skin rash consultation', 'Diabetes lab review',
        'Post-discharge follow-up', 'Migraine management review', 'Pre-operative clearance',
        'Medication refill consultation',
    ];
    $times = ['08:30:00', '09:00:00', '09:30:00', '10:00:00', '10:30:00', '11:00:00', '13:30:00', '14:00:00', '14:30:00', '15:00:00'];
    $insAppt = $pdo->prepare(
        'INSERT INTO appointments (id, patient_id, doctor_id, appointment_date, appointment_time, type, status, reason, notes, cancel_reason, billed, bill_id, created_by, created_at, updated_at)
         VALUES (:id, :pid, :did, :ad, :at, :type, :st, :reason, :notes, :creason, 0, NULL, :cb, :ca, :ua)'
    );
    $completedAppts = [];
    for ($i = 0; $i < 48; $i++) {
        $aid   = 'A-' . (101 + $i);
        $pid   = $verifiedPids[$i % count($verifiedPids)];
        $did   = 'D-' . (101 + ($i % 8));
        if ($i < 24) {
            // Past 12 days -> mostly Completed, 3 Cancelled
            $offset = -12 + (int) floor($i / 2);
            $status = ($i % 8 === 7) ? 'Cancelled' : 'Completed';
        } elseif ($i < 30) {
            // Today -> 6 appointments (Confirmed / Pending / Completed)
            $offset = 0;
            $status = $i < 26 ? 'Completed' : ($i < 28 ? 'Confirmed' : 'Pending');
        } else {
            // Future 1..12 days -> Confirmed / Pending
            $offset = 1 + (($i - 30) % 12);
            $status = ($i % 3 === 0) ? 'Pending' : 'Confirmed';
        }
        $aDate = $dayStr($offset);
        $aTime = $times[$i % count($times)];
        $type  = ($i % 5 === 0) ? 'telehealth' : 'in-person';
        $insAppt->execute([
            ':id'      => $aid,
            ':pid'     => $pid,
            ':did'     => $did,
            ':ad'      => $aDate,
            ':at'      => $aTime,
            ':type'    => $type,
            ':st'      => $status,
            ':reason'  => $reasons[$i % count($reasons)],
            ':notes'   => '[SCHOOL DEMO] Sample appointment record.',
            ':creason' => $status === 'Cancelled' ? '[SCHOOL DEMO] Rescheduled by patient.' : null,
            ':cb'      => $i % 4 === 0 ? 'U-108' : 'U-102',
            ':ca'      => $aDate . ' 08:00:00',
            ':ua'      => $aDate . ' 08:15:00',
        ]);
        if ($status === 'Completed') {
            $completedAppts[] = [$aid, $pid, $did, $aDate];
        }
    }

    // 6. Insert 24 Fictional Medical Records (linked to completed demo appointments)
    $diagnoses = [
        ['Elevated blood pressure readings', 'Essential Hypertension (Controlled)', 'Continue Losartan 50mg daily; low-sodium diet and home BP log.'],
        ['Dry cough for 5 days',             'Acute Upper Respiratory Infection',   'Supportive hydration, Paracetamol PRN for fever, rest 3 days.'],
        ['Routine diabetes follow-up',       'Type 2 Diabetes Mellitus',            'Continue Metformin 500mg BID; repeat FBS in 4 weeks.'],
        ['Intermittent temporal headache',   'Tension-type Headache',               'Hydration, ergonomic breaks, Ibuprofen 400mg PRN.'],
        ['Pruritic skin patches on arms',    'Contact Dermatitis',                  'Topical emollient and Cetirizine 10mg nightly for 7 days.'],
        ['Epigastric discomfort after meals','Gastroesophageal Reflux Disease',     'Omeprazole 20mg before breakfast for 14 days; avoid late meals.'],
    ];
    $insMed = $pdo->prepare(
        'INSERT INTO medical_records (
            id, patient_id, appointment_id, attending_doctor_id, chief_complaint,
            vital_bp, vital_heart_rate, vital_temperature, vital_resp_rate, vital_weight_kg, vital_height_cm, vital_spo2,
            diagnosis, treatment_notes, follow_up_date, created_by, created_at, updated_at
         ) VALUES (
            :id, :pid, :aid, :did, :cc,
            :bp, :hr, :temp, :rr, :wt, :ht, :spo2,
            :diag, :tx, :fup, :cb, :ca, :ua
         )'
    );
    $medRecords = [];
    for ($i = 0; $i < min(24, count($completedAppts)); $i++) {
        [$aid, $pid, $did, $aDate] = $completedAppts[$i];
        $mid = 'M-' . (101 + $i);
        $d   = $diagnoses[$i % count($diagnoses)];
        $insMed->execute([
            ':id'   => $mid,
            ':pid'  => $pid,
            ':aid'  => $aid,
            ':did'  => $did,
            ':cc'   => $d[0],
            ':bp'   => (115 + ($i % 25)) . '/' . (72 + ($i % 15)),
            ':hr'   => 68 + ($i % 18),
            ':temp' => 36.4 + (($i % 7) * 0.2),
            ':rr'   => 16 + ($i % 4),
            ':wt'   => 58.0 + ($i % 22),
            ':ht'   => 160.0 + ($i % 18),
            ':spo2' => 96 + ($i % 4),
            ':diag' => $d[1],
            ':tx'   => '[SCHOOL DEMO] ' . $d[2],
            ':fup'  => $dayStr(14 + ($i % 10)),
            ':cb'   => $i % 2 === 0 ? 'U-104' : 'U-105',
            ':ca'   => $aDate . ' 10:30:00',
            ':ua'   => $aDate . ' 10:45:00',
        ]);
        $medRecords[] = [$mid, $pid, $did, $aDate];
    }

    // 7. Insert 20 Fictional Prescriptions + Prescription Items
    $medCatalog = [
        ['Losartan 50mg',    '1 tablet', 'Once daily',  30, 'Take in the morning with water.'],
        ['Metformin 500mg',  '1 tablet', 'Twice daily', 30, 'Take with meals.'],
        ['Paracetamol 500mg','1 tablet', 'Every 6 hrs',  5, 'Take as needed for fever or pain.'],
        ['Omeprazole 20mg',  '1 capsule','Once daily',  14, 'Take 30 minutes before breakfast.'],
        ['Cetirizine 10mg',  '1 tablet', 'Once nightly', 7, 'May cause mild drowsiness.'],
        ['Amoxicillin 500mg','1 capsule','3x daily',     7, 'Complete full 7-day course.'],
    ];
    $insRx = $pdo->prepare(
        'INSERT INTO prescriptions (id, patient_id, doctor_id, medical_record_id, status, prescribed_date, notes, override_allergy, override_reason, billed, bill_id)
         VALUES (:id, :pid, :did, :mid, :st, :pd, :notes, 0, NULL, 0, NULL)'
    );
    $insRxItem = $pdo->prepare(
        'INSERT INTO prescription_items (prescription_id, medicine, dosage, frequency, duration_days, instructions)
         VALUES (:rxid, :med, :dos, :freq, :dur, :inst)'
    );
    for ($i = 0; $i < min(20, count($medRecords)); $i++) {
        [$mid, $pid, $did, $aDate] = $medRecords[$i];
        $rxId   = 'RX-' . (101 + $i);
        $status = $i < 12 ? 'Dispensed' : ($i < 18 ? 'Active' : 'Cancelled');
        $insRx->execute([
            ':id'    => $rxId,
            ':pid'   => $pid,
            ':did'   => $did,
            ':mid'   => $mid,
            ':st'    => $status,
            ':pd'    => $aDate,
            ':notes' => '[SCHOOL DEMO] Fictional prescription entry.',
        ]);
        $m = $medCatalog[$i % count($medCatalog)];
        $insRxItem->execute([':rxid' => $rxId, ':med' => $m[0], ':dos' => $m[1], ':freq' => $m[2], ':dur' => $m[3], ':inst' => $m[4]]);
    }

    // 8. Insert 24 Fictional Laboratory Orders & Results (including 3 Critical, 5 Abnormal, 10 Normal, 6 Ordered)
    $labTemplates = [
        ['Complete Blood Count', 'Hematology', 'g/dL',  13.5, 17.5, '14.8', 'Normal'],
        ['Fasting Blood Sugar',  'Chemistry',  'mg/dL', 70.0, 100.0,'92',   'Normal'],
        ['Lipid Profile',        'Chemistry',  'mg/dL',  0.0, 200.0,'238',  'Abnormal'],
        ['Creatinine',           'Chemistry',  'mg/dL',  0.6,  1.2, '1.0',  'Normal'],
        ['Fasting Blood Sugar',  'Chemistry',  'mg/dL', 70.0, 100.0,'265',  'Critical'],
        ['Urinalysis',           'Urinalysis', 'WBC/hpf',0.0,  5.0, '12',   'Abnormal'],
        ['Complete Blood Count', 'Hematology', 'g/dL',  12.0, 16.0, '7.4',  'Critical'],
        ['ECG',                  'Imaging',    'bpm',   60.0, 100.0,'78',   'Normal'],
    ];
    $insLab = $pdo->prepare(
        'INSERT INTO lab_results (id, patient_id, ordered_by, test_name, category, status, result, unit, ref_range_min, ref_range_max, flag, attachment_name, ordered_date, result_date, performed_by, billed, bill_id)
         VALUES (:id, :pid, :did, :tn, :cat, :st, :res, :unit, :rmin, :rmax, :flag, NULL, :od, :rd, :pb, 0, NULL)'
    );
    for ($i = 0; $i < 24; $i++) {
        $lid   = 'LAB-' . (101 + $i);
        $pid   = $verifiedPids[$i % count($verifiedPids)];
        $did   = 'D-' . (101 + ($i % 8));
        $tpl   = $labTemplates[$i % count($labTemplates)];
        $isOrd = $i >= 18; // 18 Completed, 6 Ordered
        $oDate = $dayStr(-10 + ($i % 11));
        $insLab->execute([
            ':id'   => $lid,
            ':pid'  => $pid,
            ':did'  => $did,
            ':tn'   => $tpl[0],
            ':cat'  => $tpl[1],
            ':st'   => $isOrd ? 'Ordered' : 'Completed',
            ':res'  => $isOrd ? null : $tpl[5],
            ':unit' => $tpl[2],
            ':rmin' => $tpl[3],
            ':rmax' => $tpl[4],
            ':flag' => $isOrd ? null : $tpl[6],
            ':od'   => $oDate,
            ':rd'   => $isOrd ? null : $oDate,
            ':pb'   => $isOrd ? null : 'Patricia Navarro, RMT',
        ]);
    }

    // 9. Insert 22 Fictional Bills, Bill Items & 18 Payments (Paid, Partial, Unpaid, Voided)
    $insBill = $pdo->prepare(
        'INSERT INTO bills (id, patient_id, admission_id, subtotal, discount_type, discount_amount, insurance_provider, insurance_coverage, total, amount_paid, balance, status, void_reason, created_by, created_at)
         VALUES (:id, :pid, :admid, :sub, :dt, :da, :ip, :ic, :tot, :paid, :bal, :st, :vr, :cb, :ca)'
    );
    $insBillItem = $pdo->prepare(
        'INSERT INTO bill_items (bill_id, item_type, description, qty, unit_price, amount, source_type, source_id)
         VALUES (:bid, :it, :desc, :qty, :up, :amt, :stype, :sid)'
    );
    $insPay = $pdo->prepare(
        'INSERT INTO payments (receipt_no, bill_id, amount, method, reference_no, paid_at, received_by)
         VALUES (:rno, :bid, :amt, :meth, :ref, :pat, :rby)'
    );
    $methods = ['Cash', 'Credit/Debit Card', 'GCash', 'Bank Transfer'];
    $receiptSeq = 1001;
    for ($i = 0; $i < 22; $i++) {
        $bid      = 'B-' . (101 + $i);
        $pid      = $verifiedPids[$i % count($verifiedPids)];
        $admLink  = $i < 4 ? 'ADM-' . (107 + $i) : null;
        $bDate    = $dayStr(-14 + ($i % 15));
        $sub      = $admLink !== null ? 4500.00 : (1000.00 + (($i % 5) * 350.00));
        $discType = $i % 6 === 0 ? 'Senior Citizen' : 'None';
        $discAmt  = $discType === 'Senior Citizen' ? round($sub * 0.20, 2) : 0.00;
        $insProv  = $i % 3 === 0 ? 'PhilHealth' : '';
        $insCov   = $insProv !== '' ? 500.00 : 0.00;
        $total    = max(0.00, round($sub - $discAmt - $insCov, 2));

        if ($i < 12) {
            $status  = 'Paid';
            $paid    = $total;
            $balance = 0.00;
        } elseif ($i < 18) {
            $status  = 'Partial';
            $paid    = round($total * 0.50, 2);
            $balance = round($total - $paid, 2);
        } elseif ($i < 21) {
            $status  = 'Unpaid';
            $paid    = 0.00;
            $balance = $total;
        } else {
            $status  = 'Voided';
            $paid    = 0.00;
            $balance = 0.00;
        }

        $insBill->execute([
            ':id'    => $bid,
            ':pid'   => $pid,
            ':admid' => $admLink,
            ':sub'   => $sub,
            ':dt'    => $discType,
            ':da'    => $discAmt,
            ':ip'    => $insProv,
            ':ic'    => $insCov,
            ':tot'   => $total,
            ':paid'  => $paid,
            ':bal'   => $balance,
            ':st'    => $status,
            ':vr'    => $status === 'Voided' ? '[SCHOOL DEMO] Duplicate invoice voided.' : null,
            ':cb'    => 'U-103',
            ':ca'    => $bDate . ' 11:00:00',
        ]);

        if ($admLink !== null) {
            $insBillItem->execute([':bid' => $bid, ':it' => 'Room', ':desc' => 'Inpatient Room & Board (3 days)', ':qty' => 3, ':up' => 1500.00, ':amt' => 4500.00, ':stype' => 'admissions', ':sid' => $admLink]);
            $pdo->prepare('UPDATE admissions SET billed = 1, bill_id = :bid WHERE id = :aid')->execute([':bid' => $bid, ':aid' => $admLink]);
        } else {
            $insBillItem->execute([':bid' => $bid, ':it' => 'Professional Fee', ':desc' => 'Outpatient Specialist Consultation', ':qty' => 1, ':up' => 1000.00, ':amt' => 1000.00, ':stype' => null, ':sid' => null]);
            if ($sub > 1000.00) {
                $extra = round($sub - 1000.00, 2);
                $insBillItem->execute([':bid' => $bid, ':it' => 'Laboratory', ':desc' => 'Diagnostic Panel', ':qty' => 1, ':up' => $extra, ':amt' => $extra, ':stype' => null, ':sid' => null]);
            }
        }

        if ($paid > 0.00) {
            $rno = 'R-' . $receiptSeq++;
            $insPay->execute([
                ':rno'  => $rno,
                ':bid'  => $bid,
                ':amt'  => $paid,
                ':meth' => $methods[$i % count($methods)],
                ':ref'  => $methods[$i % count($methods)] === 'Cash' ? '' : 'DEMO-REF-' . $receiptSeq,
                ':pat'  => $bDate . ' 14:30:00',
                ':rby'  => 'Rafael Villanueva',
            ]);
        }
    }

    // 10. Insert sample Audit Log entries for School Demo visibility
    $insAudit = $pdo->prepare(
        'INSERT INTO audit_logs (log_code, user_id, username, action, details, created_at)
         VALUES (:code, :uid, :uname, :act, :det, :ca)'
    );
    $auditEntries = [
        ['U-101', 'demo_admin',     'Create User',       '[SCHOOL DEMO] Provisioned demo clinical & operations accounts.'],
        ['U-102', 'demo_reception', 'Verify Patient',    '[SCHOOL DEMO] Verified patient identity records for outpatient queue.'],
        ['U-106', 'demo_nurse',     'Admit Patient',     '[SCHOOL DEMO] Admitted inpatient cases across General, ICU, Maternity, and Pediatrics wards.'],
        ['U-103', 'demo_billing',   'Record Payment',    '[SCHOOL DEMO] Posted inpatient and outpatient billing receipts.'],
    ];
    foreach ($auditEntries as $idx => $ae) {
        $insAudit->execute([
            ':code'  => 'LOG-DEMO-' . str_pad((string) (101 + $idx), 4, '0', STR_PAD_LEFT),
            ':uid'   => $ae[0],
            ':uname' => $ae[1],
            ':act'   => $ae[2],
            ':det'   => $ae[3],
            ':ca'    => $dayStr(-$idx) . ' 09:00:00',
        ]);
    }

    // 11. Advance sequences safely past demo IDs
    $seqUpdates = [
        ['users', 109], ['patients', 130], ['doctors', 108], ['appointments', 148],
        ['medicalRecords', 124], ['prescriptions', 120], ['labResults', 124],
        ['admissions', 110], ['bills', 122], ['receipts', $receiptSeq - 1],
    ];
    $updSeq = $pdo->prepare('UPDATE sequences SET current_val = GREATEST(current_val, :val) WHERE entity_key = :key');
    foreach ($seqUpdates as [$k, $v]) {
        $updSeq->execute([':val' => $v, ':key' => $k]);
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'Demo seeding failed: ' . $e->getMessage() . "\n");
    exit(1);
}

// Write private credentials file (git-ignored, never printed to stdout)
$lines = [
    '# PRIMECARE — SCHOOL DEMO ACCOUNTS (LOCAL ONLY — GIT-IGNORED)',
    '# Generated: ' . date(DATE_ATOM),
    '# WARNING: For local/school demonstration only. Never commit or use in production.',
    '',
    sprintf("%-16s | %-8s | %-8s | %-18s | %s", 'USERNAME', 'ROLE', 'STATUS', 'PASSWORD', 'DESCRIPTION'),
    str_repeat('-', 96),
];
foreach ($generatedCreds as $c) {
    $lines[] = sprintf(
        "%-16s | %-8s | %-8s | %-18s | %s",
        $c['username'],
        $c['role'],
        $c['status'],
        $c['password'],
        $c['label']
    );
}
$lines[] = '';
file_put_contents($credsFile, implode(PHP_EOL, $lines));

echo "School demo dataset seeded successfully.\n";
echo "Summary: 9 demo accounts, 8 doctors, 30 patients, 48 appointments, 24 medical records, 20 prescriptions, 24 lab results, 10 admissions (6 active), 22 bills, 18 payments.\n";
echo "Private credentials written to: database/demo-credentials.local.txt (git-ignored; passwords not printed).\n";
