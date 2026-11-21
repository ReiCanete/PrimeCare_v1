<?php
/**
 * PrimeCare - POST /api/users/save.php
 * Admin-only create or update staff user account (admin, doctor, nurse, staff).
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/users.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$admin = requireRole(['admin']);
requireCsrf();

$input    = getJsonInput();
$id       = trim((string) ($input['id'] ?? ''));
$fullName = trim((string) ($input['fullName'] ?? ''));
$username = trim((string) ($input['username'] ?? ''));
$email    = trim((string) ($input['email'] ?? ''));
$role     = trim((string) ($input['role'] ?? 'staff'));
$status   = trim((string) ($input['status'] ?? 'active'));
$linkedDoctorId = trim((string) ($input['linkedDoctorId'] ?? ''));

if ($fullName === '' || mb_strlen($fullName) > 150) {
    sendError('Full name is required (max 150 characters).', 422);
}

if ($email === '' || mb_strlen($email) > 150 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    sendError('A valid email address is required.', 422);
}

if (!in_array($role, PRIMECARE_STAFF_MANAGED_ROLES, true)) {
    sendError('Role must be one of: admin, doctor, nurse, staff.', 422);
}

if (!in_array($status, PRIMECARE_MANAGED_STATUSES, true)) {
    sendError('Status must be active or inactive.', 422);
}

$pdo = getDatabaseConnection();

if ($id === '') {
    // --- CREATE USER ---
    if ($username === '' || preg_match('/^[a-zA-Z0-9_]{4,20}$/', $username) !== 1) {
        sendError('Username must be 4-20 characters using letters, numbers, and underscores only.', 422);
    }

    if (isUsernameTakenInDb($pdo, $username)) {
        sendError('Username is already taken.', 409);
    }
    if (isEmailTakenInDb($pdo, $email)) {
        sendError('Email is already taken.', 409);
    }

    if ($role === 'doctor' && $linkedDoctorId !== '') {
        $docStmt = $pdo->prepare('SELECT id, user_id FROM doctors WHERE id = :did LIMIT 1');
        $docStmt->execute([':did' => $linkedDoctorId]);
        $docRow = $docStmt->fetch();
        if (!is_array($docRow)) {
            sendError('Linked doctor profile was not found.', 404);
        }
        if ($docRow['user_id'] !== null && $docRow['user_id'] !== '') {
            sendError('Selected doctor profile is already linked to another user.', 409);
        }
    }

    $tempPw   = generateTemporaryPassword();
    $pwHash   = password_hash($tempPw, PASSWORD_BCRYPT);

    $pdo->beginTransaction();
    try {
        $newId = allocateNextId($pdo, 'users', 'users', 'U', 3);

        $ins = $pdo->prepare(
            'INSERT INTO users (
                id, username, password_hash, full_name, role, status, email, mobile,
                must_change_password, last_login, created_by, created_at
             ) VALUES (
                :id, :username, :pw_hash, :full_name, :role, :status, :email, NULL,
                1, NULL, :created_by, CURDATE()
             )'
        );
        $ins->execute([
            ':id'         => $newId,
            ':username'   => $username,
            ':pw_hash'    => $pwHash,
            ':full_name'  => $fullName,
            ':role'       => $role,
            ':status'     => $status,
            ':email'      => $email,
            ':created_by' => $admin['id'],
        ]);

        if ($role === 'doctor' && $linkedDoctorId !== '') {
            $linkStmt = $pdo->prepare('UPDATE doctors SET user_id = :uid WHERE id = :did AND user_id IS NULL');
            $linkStmt->execute([':uid' => $newId, ':did' => $linkedDoctorId]);
            if ($linkStmt->rowCount() === 0) {
                throw new RuntimeException('Selected doctor profile is already linked.');
            }
        }

        writeUserAuditLog($pdo, $admin, 'Create User', "Created user {$username} ({$newId}, role: {$role})");
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        sendError('Failed to create user account.', 500);
    }

    $createdUser = findManagedUserById($pdo, $newId);
    sendSuccess('User created successfully.', [
        'user'         => $createdUser,
        'tempPassword' => $tempPw,
    ], 201);
}

// --- UPDATE EXISTING USER ---
$existing = findManagedUserById($pdo, $id);
if ($existing === null) {
    sendError('User not found.', 404);
}
if ($existing['role'] === 'patient') {
    sendError('Patient accounts must be managed through Patient Records.', 422);
}

if ($id === $admin['id']) {
    if ($role !== $existing['role']) {
        sendError('You cannot change your own role.', 422);
    }
    if ($status !== 'active') {
        sendError('You cannot deactivate your own account.', 422);
    }
}

if ($existing['role'] === 'admin' && $existing['status'] === 'active' && ($role !== 'admin' || $status !== 'active')) {
    if (countActiveAdmins($pdo, $id) < 1) {
        sendError('Cannot demote or deactivate the last active admin.', 409);
    }
}

if (isEmailTakenInDb($pdo, $email, null, $id)) {
    sendError('Email is already taken.', 409);
}

$pdo->beginTransaction();
try {
    $upd = $pdo->prepare(
        'UPDATE users
         SET full_name = :full_name,
             email     = :email,
             role      = :role,
             status    = :status
         WHERE id = :id'
    );
    $upd->execute([
        ':full_name' => $fullName,
        ':email'     => $email,
        ':role'      => $role,
        ':status'    => $status,
        ':id'        => $id,
    ]);

    writeUserAuditLog($pdo, $admin, 'Update User', "Updated user {$existing['username']} ({$id}, role: {$role}, status: {$status})");
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendError('Failed to update user account.', 500);
}

$updatedUser = findManagedUserById($pdo, $id);
sendSuccess('User saved successfully.', [
    'user'         => $updatedUser,
    'tempPassword' => null,
]);
