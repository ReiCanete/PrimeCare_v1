<?php
/**
 * PrimeCare - GET /api/billing/summary.php
 * Phase 5.9.2: Hospital billing summary and financial KPIs.
 *
 * Authorization:
 * - Admin, Staff only.
 * - Patient, Doctor, Nurse: 403 Forbidden.
 */

declare(strict_types=1);

require_once __DIR__ . '/../helpers/billing.php';

registerApiErrorHandlers();
requireMethod(['GET']);

$user = requireRole(PRIMECARE_BILLING_STAFF_ROLES);
$pdo  = getDatabaseConnection();

$summary = fetchBillingSummary($pdo);

sendSuccess('Billing summary retrieved successfully.', $summary);

