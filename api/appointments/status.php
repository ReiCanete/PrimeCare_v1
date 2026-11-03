<?php
/**
 * PrimeCare - POST /api/appointments/status.php
 * Phase 5.6.2: Confirm, Complete, or Cancel an appointment with strict role and state-machine enforcement.
 *
 * Role & State Transition Rules:
 * - Requires authenticated session (`requireRole(['admin', 'staff', 'doctor', 'patient'])`) and valid CSRF token (`requireCsrf()`).
 * - Nurses have read-only access and are blocked (403).
 * - Terminal states: `'Completed'` and `'Cancelled'` cannot transition to any other status (400).
 * - Target status `'Confirmed'`:
 *   - Only `admin` and `staff` may confirm a `'Pending'` appointment.
 *   - Current status must be `'Pending'`.
 * - Target status `'Completed'`:
 *   - Allowed for `admin`, `staff`, and `doctor` (if `doctor`, must be the appointment's assigned doctor).
 *   - Current status must be `'Confirmed'`.
 * - Target status `'Cancelled'`:
 *   - Allowed for `admin` and `staff` on `'Pending'` or `'Confirmed'` appointments.
 *   - Allowed for `patient` ONLY on their own `'Pending'` or `'Confirmed'` appointment AND only if
 *     the appointment is strictly more than 24 hours in the future (`isAppointmentMoreThan24HoursAway`).
 *   - Requires a cancellation reason (`reason` / `cancelReason`) of at least 5 characters when provided by modal,
 *     or defaults to `'Cancelled by staff'` only if updated via the dashboard quick status dropdown by admin/staff.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/appointments.php';

registerApiErrorHandlers();
requireMethod(['POST']);
requireJsonContentType();

$user = requireRole(['admin', 'staff', 'doctor', 'patient']);
requireCsrf();

$input = getJsonInput();
$pdo   = getDatabaseConnection();

$id           = strtoupper(trim((string) ($input['id'] ?? '')));
$rawStatus    = trim((string) ($input['status'] ?? ''));
$cancelReason = trim((string) ($input['cancelReason'] ?? $input['reason'] ?? ''));

if ($id === '' || !preg_match('/^A-\d{3,}$/i', $id)) {
    sendError('A valid Appointment ID (e.g., A-001) is required.', 400);
}

$targetStatus = null;
foreach (PRIMECARE_APPOINTMENT_STATUSES as $validSt) {
    if (strcasecmp($rawStatus, $validSt) === 0) {
        $targetStatus = $validSt;
        break;
    }
}

if ($targetStatus === null || $targetStatus === 'Pending') {
    sendError('Invalid target status. Allowed transitions: Confirmed, Completed, or Cancelled.', 400);
}

$existing = findAppointmentById($pdo, $id);
if ($existing === null) {
    sendError('Appointment not found.', 404);
}

$currentStatus = (string) $existing['status'];
$role          = (string) $user['role'];

// Enforce patient ownership first so a patient cannot probe other patients' appointment states
if ($role === 'patient') {
    $ownPatient = findPatientByUserId($pdo, (string) $user['id']);
    if ($ownPatient === null || (string) $ownPatient['id'] !== (string) $existing['patientId']) {
        sendError('Forbidden: You can only manage your own appointments.', 403);
    }
    if ($targetStatus !== 'Cancelled') {
        sendError('Forbidden: Patients may only cancel their appointments.', 403);
    }
}

// Terminal state check
if ($currentStatus === 'Completed' || $currentStatus === 'Cancelled') {
    if ($targetStatus === 'Cancelled' && $currentStatus === 'Completed') {
        sendError('Cannot cancel a completed appointment.', 400);
    }
    sendError("Cannot change status from {$currentStatus}.", 400);
}

if ($targetStatus === 'Confirmed') {
    if ($role !== 'admin' && $role !== 'staff') {
        sendError('Forbidden: Only administrators or staff can confirm pending appointments.', 403);
    }
    if ($currentStatus !== 'Pending') {
        sendError("Cannot confirm an appointment with status {$currentStatus}.", 400);
    }
} elseif ($targetStatus === 'Completed') {
    if ($role === 'doctor') {
        // Verify this doctor user owns the doctor profile assigned to the appointment
        $docStmt = $pdo->prepare('SELECT id FROM doctors WHERE user_id = :uid LIMIT 1');
        $docStmt->execute([':uid' => (string) $user['id']]);
        $myDoc = $docStmt->fetch();
        if (!is_array($myDoc) || (string) $myDoc['id'] !== (string) $existing['doctorId']) {
            sendError('Forbidden: Doctors may only complete appointments assigned to them.', 403);
        }
    } elseif ($role !== 'admin' && $role !== 'staff') {
        sendError('Forbidden: You are not authorized to complete appointments.', 403);
    }

    if ($currentStatus !== 'Confirmed') {
        sendError('Only Confirmed appointments can be marked as Completed.', 400);
    }
} elseif ($targetStatus === 'Cancelled') {
    if ($role === 'doctor') {
        sendError('Forbidden: Only staff, administrators, or the patient may cancel an appointment.', 403);
    }

    if ($role === 'patient') {
        if (!isAppointmentMoreThan24HoursAway((string) $existing['date'], (string) $existing['time'])) {
            sendError('Cannot cancel within 24 hours of the appointment. Please call the hospital.', 400);
        }
        if (mb_strlen($cancelReason) < 5) {
            sendError('Cancellation reason must be at least 5 characters.', 400);
        }
    } else {
        // Staff/Admin cancellation: if invoked via cancelAppointment(), require >= 5 chars;
        // if invoked via dashboard quick status dropdown without reason, allow only if allowDefaultReason is set
        $allowDefault = !empty($input['allowDefaultReason']);
        if ($cancelReason === '' && $allowDefault) {
            $cancelReason = 'Cancelled by hospital staff';
        } elseif (mb_strlen($cancelReason) < 5) {
            sendError('Cancellation reason must be at least 5 characters.', 400);
        }
    }
}

$nowStr = date('Y-m-d H:i:s');

if ($targetStatus === 'Cancelled') {
    $stmt = $pdo->prepare(
        'UPDATE appointments
         SET status = :status,
             cancel_reason = :cancel_reason,
             updated_at = :updated_at
         WHERE id = :id'
    );
    $stmt->execute([
        ':status'        => 'Cancelled',
        ':cancel_reason' => $cancelReason,
        ':updated_at'    => $nowStr,
        ':id'            => $id,
    ]);
} else {
    $stmt = $pdo->prepare(
        'UPDATE appointments
         SET status = :status,
             updated_at = :updated_at
         WHERE id = :id'
    );
    $stmt->execute([
        ':status'     => $targetStatus,
        ':updated_at' => $nowStr,
        ':id'         => $id,
    ]);
}

$updated = findAppointmentById($pdo, $id);
$actionLabel = $targetStatus === 'Cancelled' ? 'Cancel Appointment' : 'Update Appointment Status';
$detailMsg   = $targetStatus === 'Cancelled'
    ? "Cancelled appointment {$id}. Reason: {$cancelReason}"
    : "Updated appointment {$id} status from {$currentStatus} to {$targetStatus}";

writeAuthAuditLog((string) $user['id'], (string) $user['username'], $actionLabel, $detailMsg);

$responseMessage = $targetStatus === 'Cancelled' ? 'Appointment cancelled.' : 'Status updated.';
sendSuccess($responseMessage, [
    'appointment' => $updated,
]);

