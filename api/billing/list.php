<?php
/**
 * PrimeCare - GET /api/billing/list.php
 * Phase 5.9.2: List, search, and filter hospital bills.
 *
 * Query Parameters:
 * - patientId: string
 * - status: string ('All', 'Unpaid', 'Partial', 'Paid', 'Voided')
 * - keyword: string (matches bill ID or patient full name)
 * - dateFrom: string YYYY-MM-DD
 * - dateTo: string YYYY-MM-DD
 * - my: '1' or 'true' (patient portal scoped)
 *
 * Authorization:
 * - Admin, Staff: Allowed (all bills).
 * - Patient: Allowed (own bills only, IDOR protected).
 * - Doctor, Nurse: 403 Forbidden.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(['admin', 'staff', 'patient']);
$pdo  = getDatabaseConnection();
$role = (string) $user['role'];

$filters = [
    'patientId' => trim((string) ($_GET['patientId'] ?? '')),
    'status'    => trim((string) ($_GET['status'] ?? '')),
    'keyword'   => trim((string) ($_GET['keyword'] ?? '')),
    'dateFrom'  => trim((string) ($_GET['dateFrom'] ?? '')),
    'dateTo'    => trim((string) ($_GET['dateTo'] ?? '')),
];

$myFlag = isset($_GET['my']) && ((string) $_GET['my'] === '1' || strtolower((string) $_GET['my']) === 'true');

if ($role === 'patient') {
    $own = findPatientByUserId($pdo, (string) $user['id']);
    if ($own === null) {
        sendSuccess('Bills retrieved successfully.', ['bills' => [], 'count' => 0]);
    }
    $user['patient_id'] = (string) $own['id'];
    $filters['patientId'] = (string) $own['id'];
} elseif ($myFlag && $filters['patientId'] === '') {
    $filters['patientId'] = 'P-001';
}

$bills = fetchBills($pdo, $filters, $user);

sendSuccess('Bills retrieved successfully.', [
    'bills' => $bills,
    'count' => count($bills),
]);

