-- =============================================================================
-- PRIMECARE HEALTHCARE MANAGEMENT SYSTEM
-- Phase 5.1: Normalized Relational Database Schema & Seed Data
-- Target DBMS: MySQL 8.0+ / MariaDB 10.11+ (XAMPP)
-- Character Set: utf8mb4 (Full Unicode & Philippine Peso Symbol Support)
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET time_zone = '+08:00';

-- -----------------------------------------------------------------------------
-- 0. DATABASE CREATION
-- -----------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `primecare_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `primecare_db`;

-- Drop tables in reverse dependency order for clean re-imports
DROP TABLE IF EXISTS `audit_logs`;
DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `payment_plan_requests`;
DROP TABLE IF EXISTS `payments`;
DROP TABLE IF EXISTS `bill_items`;
DROP TABLE IF EXISTS `immunizations`;
DROP TABLE IF EXISTS `lab_results`;
DROP TABLE IF EXISTS `prescription_items`;
DROP TABLE IF EXISTS `prescriptions`;
DROP TABLE IF EXISTS `medical_record_history`;
DROP TABLE IF EXISTS `medical_records`;
DROP TABLE IF EXISTS `pre_visit_forms`;
DROP TABLE IF EXISTS `appointments`;
DROP TABLE IF EXISTS `bills`;
DROP TABLE IF EXISTS `admissions`;
DROP TABLE IF EXISTS `beds`;
DROP TABLE IF EXISTS `wards`;
DROP TABLE IF EXISTS `patients`;
DROP TABLE IF EXISTS `doctor_schedules`;
DROP TABLE IF EXISTS `doctors`;
DROP TABLE IF EXISTS `departments`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `service_catalog`;
DROP TABLE IF EXISTS `id_types`;
DROP TABLE IF EXISTS `public_info`;
DROP TABLE IF EXISTS `sequences`;

-- -----------------------------------------------------------------------------
-- 1. SEQUENCES (Replaces localStorage.primecare_counters)
-- -----------------------------------------------------------------------------
CREATE TABLE `sequences` (
    `entity_key`  VARCHAR(50) NOT NULL,
    `prefix`      VARCHAR(10) NOT NULL,
    `current_val` INT UNSIGNED NOT NULL DEFAULT 0,
    `pad_length`  TINYINT UNSIGNED NOT NULL DEFAULT 3,
    `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`entity_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. USERS (Authentication & Role-Based Access Control)
-- -----------------------------------------------------------------------------
CREATE TABLE `users` (
    `id`                   VARCHAR(20) NOT NULL,
    `username`             VARCHAR(50) NOT NULL,
    `password_hash`        VARCHAR(255) NOT NULL,
    `full_name`            VARCHAR(150) NOT NULL,
    `role`                 ENUM('admin', 'doctor', 'nurse', 'staff', 'patient') NOT NULL,
    `status`               ENUM('active', 'inactive', 'pending', 'rejected') NOT NULL DEFAULT 'active',
    `email`                VARCHAR(150) NOT NULL,
    `mobile`               VARCHAR(20) DEFAULT NULL,
    `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
    `last_login`           DATE DEFAULT NULL,
    `created_by`           VARCHAR(20) DEFAULT NULL,
    `created_at`           DATE NOT NULL,
    `updated_at`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_username` (`username`),
    UNIQUE KEY `uq_users_email` (`email`),
    KEY `idx_users_role_status` (`role`, `status`),
    CONSTRAINT `fk_users_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. DEPARTMENTS (Public & Clinical Directory)
-- -----------------------------------------------------------------------------
CREATE TABLE `departments` (
    `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name`          VARCHAR(100) NOT NULL,
    `description`   TEXT NOT NULL,
    `services_json` LONGTEXT NOT NULL COMMENT 'JSON array of offered clinical services',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_departments_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. DOCTORS & NORMALIZED DOCTOR SCHEDULES
-- -----------------------------------------------------------------------------
CREATE TABLE `doctors` (
    `id`                      VARCHAR(20) NOT NULL,
    `user_id`                 VARCHAR(20) DEFAULT NULL,
    `name`                    VARCHAR(150) NOT NULL,
    `photo_initials`          VARCHAR(10) NOT NULL DEFAULT 'DR',
    `specialization`          VARCHAR(100) NOT NULL,
    `department`              VARCHAR(100) NOT NULL,
    `contact`                 VARCHAR(20) DEFAULT NULL,
    `email`                   VARCHAR(150) DEFAULT NULL,
    `languages_json`          LONGTEXT DEFAULT NULL COMMENT 'JSON array of spoken languages',
    `accepted_insurance_json` LONGTEXT DEFAULT NULL COMMENT 'JSON array of accepted HMOs/insurers',
    `qualifications`          VARCHAR(150) DEFAULT NULL,
    `status`                  ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `consultation_fee`        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `slot_minutes`            INT UNSIGNED NOT NULL DEFAULT 30,
    `created_at`              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_doctors_user_id` (`user_id`),
    KEY `idx_doctors_specialization` (`specialization`),
    KEY `idx_doctors_department` (`department`),
    KEY `idx_doctors_status` (`status`),
    CONSTRAINT `fk_doctors_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `doctor_schedules` (
    `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `doctor_id`   VARCHAR(20) NOT NULL,
    `day_of_week` ENUM('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun') NOT NULL,
    `start_time`  TIME NOT NULL,
    `end_time`    TIME NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_doctor_schedule_day` (`doctor_id`, `day_of_week`),
    KEY `idx_doctor_schedules_day` (`day_of_week`),
    CONSTRAINT `fk_doctor_schedules_doctor`
        FOREIGN KEY (`doctor_id`) REFERENCES `doctors` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. PATIENTS (Demographics, Contact, Emergency, Clinical & Verification)
-- -----------------------------------------------------------------------------
CREATE TABLE `patients` (
    `id`                             VARCHAR(20) NOT NULL,
    `user_id`                        VARCHAR(20) DEFAULT NULL,
    `first_name`                     VARCHAR(100) NOT NULL,
    `middle_name`                    VARCHAR(100) DEFAULT '',
    `last_name`                      VARCHAR(100) NOT NULL,
    `suffix`                         VARCHAR(20) DEFAULT '',
    `full_name`                      VARCHAR(255) NOT NULL,
    `birthdate`                      DATE NOT NULL,
    `sex`                            ENUM('Male', 'Female', 'Other') NOT NULL,
    `civil_status`                   VARCHAR(30) NOT NULL,
    `street`                         VARCHAR(150) DEFAULT '',
    `barangay`                       VARCHAR(100) DEFAULT '',
    `city`                           VARCHAR(100) DEFAULT '',
    `province`                       VARCHAR(100) DEFAULT '',
    `address`                        VARCHAR(500) NOT NULL,
    `mobile`                         VARCHAR(20) NOT NULL,
    `email`                          VARCHAR(150) DEFAULT NULL,
    `emergency_contact_name`         VARCHAR(150) NOT NULL,
    `emergency_contact_number`       VARCHAR(20) NOT NULL,
    `emergency_contact_relationship` VARCHAR(50) NOT NULL,
    `id_type`                        VARCHAR(80) DEFAULT NULL,
    `id_number`                      VARCHAR(80) DEFAULT NULL,
    `admit_type`                     ENUM('Outpatient', 'Inpatient') NOT NULL DEFAULT 'Outpatient',
    `date_admitted`                  DATE DEFAULT NULL,
    `status`                         ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
    `verified_by`                    VARCHAR(150) DEFAULT NULL,
    `verified_at`                    DATE DEFAULT NULL,
    `rejection_reason`               TEXT DEFAULT NULL,
    `blood_type`                     VARCHAR(10) DEFAULT NULL,
    `allergies`                      TEXT DEFAULT NULL,
    `medical_conditions`             TEXT DEFAULT NULL,
    `insurance_provider`             VARCHAR(100) DEFAULT NULL,
    `insurance_number`               VARCHAR(100) DEFAULT NULL,
    `assigned_doctor_id`             VARCHAR(20) DEFAULT NULL,
    `ward`                           VARCHAR(100) DEFAULT '',
    `bed_number`                     VARCHAR(20) DEFAULT '',
    `notes`                          TEXT DEFAULT NULL,
    `created_at`                     DATE NOT NULL,
    `updated_at`                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_patients_user_id` (`user_id`),
    KEY `idx_patients_full_name` (`full_name`),
    KEY `idx_patients_mobile` (`mobile`),
    KEY `idx_patients_email` (`email`),
    KEY `idx_patients_status_admit` (`status`, `admit_type`),
    KEY `idx_patients_national_id` (`id_type`, `id_number`),
    KEY `idx_patients_assigned_doctor` (`assigned_doctor_id`),
    CONSTRAINT `fk_patients_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_patients_assigned_doctor`
        FOREIGN KEY (`assigned_doctor_id`) REFERENCES `doctors` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. WARDS, BEDS & INPATIENT ADMISSIONS
-- -----------------------------------------------------------------------------
CREATE TABLE `wards` (
    `id`         VARCHAR(20) NOT NULL,
    `name`       VARCHAR(100) NOT NULL,
    `type`       VARCHAR(50) NOT NULL,
    `daily_rate` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_wards_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `beds` (
    `id`                 VARCHAR(20) NOT NULL,
    `ward_id`            VARCHAR(20) NOT NULL,
    `bed_number`         VARCHAR(20) NOT NULL,
    `status`             ENUM('Available', 'Occupied', 'Maintenance') NOT NULL DEFAULT 'Available',
    `current_patient_id` VARCHAR(20) DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_beds_ward_bed_number` (`ward_id`, `bed_number`),
    KEY `idx_beds_status` (`status`),
    KEY `idx_beds_current_patient` (`current_patient_id`),
    CONSTRAINT `fk_beds_ward`
        FOREIGN KEY (`ward_id`) REFERENCES `wards` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_beds_current_patient`
        FOREIGN KEY (`current_patient_id`) REFERENCES `patients` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admissions` (
    `id`                  VARCHAR(20) NOT NULL,
    `patient_id`          VARCHAR(20) NOT NULL,
    `bed_id`              VARCHAR(20) NOT NULL,
    `attending_doctor_id` VARCHAR(20) DEFAULT NULL,
    `admit_date`          DATE NOT NULL,
    `discharge_date`      DATE DEFAULT NULL,
    `daily_rate`          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `discharge_summary`   TEXT DEFAULT NULL,
    `status`              ENUM('Admitted', 'Discharged') NOT NULL DEFAULT 'Admitted',
    `billed`              TINYINT(1) NOT NULL DEFAULT 0,
    `bill_id`             VARCHAR(20) DEFAULT NULL,
    `created_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_admissions_patient` (`patient_id`),
    KEY `idx_admissions_bed` (`bed_id`),
    KEY `idx_admissions_doctor` (`attending_doctor_id`),
    KEY `idx_admissions_status_date` (`status`, `admit_date`),
    CONSTRAINT `fk_admissions_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_admissions_bed`
        FOREIGN KEY (`bed_id`) REFERENCES `beds` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_admissions_doctor`
        FOREIGN KEY (`attending_doctor_id`) REFERENCES `doctors` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. BILLING, NORMALIZED BILL ITEMS, PAYMENTS & PAYMENT PLANS
-- -----------------------------------------------------------------------------
CREATE TABLE `bills` (
    `id`                 VARCHAR(20) NOT NULL,
    `patient_id`         VARCHAR(20) NOT NULL,
    `admission_id`       VARCHAR(20) DEFAULT NULL,
    `subtotal`           DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `discount_type`      VARCHAR(50) NOT NULL DEFAULT 'None',
    `discount_amount`    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `insurance_provider` VARCHAR(100) DEFAULT '',
    `insurance_coverage` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `total`              DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `amount_paid`        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `balance`            DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `status`             ENUM('Unpaid', 'Partial', 'Paid', 'Voided') NOT NULL DEFAULT 'Unpaid',
    `void_reason`        TEXT DEFAULT NULL,
    `created_by`         VARCHAR(20) DEFAULT NULL,
    `created_at`         DATETIME NOT NULL,
    `updated_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_bills_patient` (`patient_id`),
    KEY `idx_bills_admission` (`admission_id`),
    KEY `idx_bills_status_date` (`status`, `created_at`),
    CONSTRAINT `fk_bills_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_bills_admission`
        FOREIGN KEY (`admission_id`) REFERENCES `admissions` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_bills_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bill_items` (
    `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `bill_id`     VARCHAR(20) NOT NULL,
    `item_type`   VARCHAR(50) NOT NULL COMMENT 'Room, Professional Fee, Medication, Laboratory, etc.',
    `description` VARCHAR(255) NOT NULL,
    `qty`         INT UNSIGNED NOT NULL DEFAULT 1,
    `unit_price`  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `amount`      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `source_type` VARCHAR(50) DEFAULT NULL COMMENT 'admissions, appointments, prescriptions, labResults',
    `source_id`   VARCHAR(20) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_bill_items_bill` (`bill_id`),
    KEY `idx_bill_items_source` (`source_type`, `source_id`),
    CONSTRAINT `fk_bill_items_bill`
        FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payments` (
    `receipt_no`   VARCHAR(20) NOT NULL,
    `bill_id`      VARCHAR(20) NOT NULL,
    `amount`       DECIMAL(10,2) NOT NULL,
    `method`       VARCHAR(50) NOT NULL COMMENT 'Cash, Credit/Debit Card, GCash, Bank Transfer',
    `reference_no` VARCHAR(100) DEFAULT '',
    `paid_at`      DATETIME NOT NULL,
    `received_by`  VARCHAR(150) NOT NULL,
    PRIMARY KEY (`receipt_no`),
    KEY `idx_payments_bill` (`bill_id`),
    KEY `idx_payments_paid_at` (`paid_at`),
    CONSTRAINT `fk_payments_bill`
        FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payment_plan_requests` (
    `id`         VARCHAR(30) NOT NULL,
    `bill_id`    VARCHAR(20) NOT NULL,
    `patient_id` VARCHAR(20) NOT NULL,
    `months`     INT UNSIGNED NOT NULL,
    `reason`     TEXT NOT NULL,
    `status`     ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
    `created_at` DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_payment_plans_bill` (`bill_id`),
    KEY `idx_payment_plans_patient` (`patient_id`),
    CONSTRAINT `fk_payment_plans_bill`
        FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_payment_plans_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. APPOINTMENTS & TELEHEALTH PRE-VISIT FORMS
-- -----------------------------------------------------------------------------
CREATE TABLE `appointments` (
    `id`               VARCHAR(20) NOT NULL,
    `patient_id`       VARCHAR(20) NOT NULL,
    `doctor_id`        VARCHAR(20) NOT NULL,
    `appointment_date` DATE NOT NULL,
    `appointment_time` TIME NOT NULL,
    `type`             ENUM('in-person', 'telehealth') NOT NULL DEFAULT 'in-person',
    `status`           ENUM('Pending', 'Confirmed', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Pending',
    `reason`           TEXT NOT NULL,
    `notes`            TEXT DEFAULT NULL,
    `cancel_reason`    TEXT DEFAULT NULL,
    `billed`           TINYINT(1) NOT NULL DEFAULT 0,
    `bill_id`          VARCHAR(20) DEFAULT NULL,
    `created_by`       VARCHAR(20) DEFAULT NULL,
    `created_at`       DATETIME NOT NULL,
    `updated_at`       DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_appointments_doctor_slot` (`doctor_id`, `appointment_date`, `appointment_time`),
    KEY `idx_appointments_patient_date` (`patient_id`, `appointment_date`),
    KEY `idx_appointments_status_date` (`status`, `appointment_date`),
    KEY `idx_appointments_bill` (`bill_id`),
    CONSTRAINT `fk_appointments_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_appointments_doctor`
        FOREIGN KEY (`doctor_id`) REFERENCES `doctors` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_appointments_bill`
        FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_appointments_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pre_visit_forms` (
    `id`             VARCHAR(30) NOT NULL,
    `appointment_id` VARCHAR(20) NOT NULL,
    `symptoms`       TEXT NOT NULL,
    `duration`       VARCHAR(100) DEFAULT NULL,
    `medications`    TEXT DEFAULT NULL,
    `allergies`      TEXT DEFAULT NULL,
    `consent`        TINYINT(1) NOT NULL DEFAULT 1,
    `submitted_at`   DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_pre_visit_appointment` (`appointment_id`),
    CONSTRAINT `fk_pre_visit_appointment`
        FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. MEDICAL RECORDS & REVISION HISTORY
-- -----------------------------------------------------------------------------
CREATE TABLE `medical_records` (
    `id`                  VARCHAR(20) NOT NULL,
    `patient_id`          VARCHAR(20) NOT NULL,
    `appointment_id`      VARCHAR(20) DEFAULT NULL,
    `attending_doctor_id` VARCHAR(20) DEFAULT NULL,
    `chief_complaint`     TEXT NOT NULL,
    `vital_bp`            VARCHAR(20) DEFAULT NULL,
    `vital_heart_rate`    INT DEFAULT NULL,
    `vital_temperature`   DECIMAL(4,1) DEFAULT NULL,
    `vital_resp_rate`     INT DEFAULT NULL,
    `vital_weight_kg`     DECIMAL(5,2) DEFAULT NULL,
    `vital_height_cm`     DECIMAL(5,2) DEFAULT NULL,
    `vital_spo2`          INT DEFAULT NULL,
    `diagnosis`           TEXT DEFAULT NULL,
    `treatment_notes`     TEXT DEFAULT NULL,
    `follow_up_date`      DATE DEFAULT NULL,
    `created_by`          VARCHAR(20) DEFAULT NULL,
    `created_at`          DATETIME NOT NULL,
    `updated_at`          DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_med_records_patient` (`patient_id`, `created_at`),
    KEY `idx_med_records_doctor` (`attending_doctor_id`),
    KEY `idx_med_records_appointment` (`appointment_id`),
    CONSTRAINT `fk_med_records_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_med_records_appointment`
        FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_med_records_doctor`
        FOREIGN KEY (`attending_doctor_id`) REFERENCES `doctors` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_med_records_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `medical_record_history` (
    `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `medical_record_id` VARCHAR(20) NOT NULL,
    `updated_by`        VARCHAR(150) NOT NULL,
    `updated_at`        DATETIME NOT NULL,
    `summary`           TEXT NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_med_history_record` (`medical_record_id`),
    CONSTRAINT `fk_med_history_record`
        FOREIGN KEY (`medical_record_id`) REFERENCES `medical_records` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. PRESCRIPTIONS & PRESCRIPTION LINE ITEMS
-- -----------------------------------------------------------------------------
CREATE TABLE `prescriptions` (
    `id`                VARCHAR(20) NOT NULL,
    `patient_id`        VARCHAR(20) NOT NULL,
    `doctor_id`         VARCHAR(20) NOT NULL,
    `medical_record_id` VARCHAR(20) DEFAULT NULL,
    `status`            ENUM('Active', 'Dispensed', 'Cancelled') NOT NULL DEFAULT 'Active',
    `prescribed_date`   DATE NOT NULL,
    `notes`             TEXT DEFAULT NULL,
    `override_allergy`  TINYINT(1) NOT NULL DEFAULT 0,
    `override_reason`   TEXT DEFAULT NULL,
    `billed`            TINYINT(1) NOT NULL DEFAULT 0,
    `bill_id`           VARCHAR(20) DEFAULT NULL,
    `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_prescriptions_patient` (`patient_id`, `prescribed_date`),
    KEY `idx_prescriptions_doctor` (`doctor_id`),
    KEY `idx_prescriptions_med_record` (`medical_record_id`),
    KEY `idx_prescriptions_bill` (`bill_id`),
    CONSTRAINT `fk_prescriptions_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_prescriptions_doctor`
        FOREIGN KEY (`doctor_id`) REFERENCES `doctors` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_prescriptions_med_record`
        FOREIGN KEY (`medical_record_id`) REFERENCES `medical_records` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_prescriptions_bill`
        FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `prescription_items` (
    `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `prescription_id` VARCHAR(20) NOT NULL,
    `medicine`        VARCHAR(150) NOT NULL,
    `dosage`          VARCHAR(100) NOT NULL,
    `frequency`       VARCHAR(100) NOT NULL,
    `duration_days`   INT UNSIGNED DEFAULT NULL,
    `instructions`    TEXT DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_rx_items_prescription` (`prescription_id`),
    CONSTRAINT `fk_rx_items_prescription`
        FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. LABORATORY RESULTS & IMMUNIZATIONS
-- -----------------------------------------------------------------------------
CREATE TABLE `lab_results` (
    `id`              VARCHAR(20) NOT NULL,
    `patient_id`      VARCHAR(20) NOT NULL,
    `ordered_by`      VARCHAR(20) DEFAULT NULL,
    `test_name`       VARCHAR(150) NOT NULL,
    `category`        VARCHAR(80) NOT NULL,
    `status`          ENUM('Ordered', 'Completed') NOT NULL DEFAULT 'Ordered',
    `result`          VARCHAR(100) DEFAULT NULL,
    `unit`            VARCHAR(50) DEFAULT NULL,
    `ref_range_min`   DECIMAL(10,2) DEFAULT NULL,
    `ref_range_max`   DECIMAL(10,2) DEFAULT NULL,
    `flag`            ENUM('Normal', 'Abnormal', 'Critical') DEFAULT NULL,
    `attachment_name` VARCHAR(255) DEFAULT NULL,
    `ordered_date`    DATE NOT NULL,
    `result_date`     DATE DEFAULT NULL,
    `performed_by`    VARCHAR(150) DEFAULT NULL,
    `billed`          TINYINT(1) NOT NULL DEFAULT 0,
    `bill_id`         VARCHAR(20) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_labs_patient` (`patient_id`, `ordered_date`),
    KEY `idx_labs_ordered_by` (`ordered_by`),
    KEY `idx_labs_status_flag` (`status`, `flag`),
    KEY `idx_labs_bill` (`bill_id`),
    CONSTRAINT `fk_labs_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_labs_ordered_by`
        FOREIGN KEY (`ordered_by`) REFERENCES `doctors` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_labs_bill`
        FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `immunizations` (
    `id`              VARCHAR(20) NOT NULL,
    `patient_id`      VARCHAR(20) NOT NULL,
    `vaccine`         VARCHAR(150) NOT NULL,
    `dose`            VARCHAR(50) NOT NULL,
    `date_given`      DATE NOT NULL,
    `administered_by` VARCHAR(150) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_immunizations_patient` (`patient_id`, `date_given`),
    CONSTRAINT `fk_immunizations_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 12. NOTIFICATIONS & AUDIT LOGS
-- -----------------------------------------------------------------------------
CREATE TABLE `notifications` (
    `id`         VARCHAR(30) NOT NULL,
    `patient_id` VARCHAR(20) NOT NULL,
    `type`       VARCHAR(50) NOT NULL,
    `title`      VARCHAR(150) NOT NULL,
    `message`    TEXT NOT NULL,
    `link`       VARCHAR(255) DEFAULT NULL,
    `is_read`    TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_notifications_patient_read` (`patient_id`, `is_read`, `created_at`),
    CONSTRAINT `fk_notifications_patient`
        FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `log_code`   VARCHAR(40) NOT NULL,
    `user_id`    VARCHAR(20) DEFAULT NULL,
    `username`   VARCHAR(150) NOT NULL,
    `action`     VARCHAR(100) NOT NULL,
    `details`    TEXT NOT NULL,
    `created_at` DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_audit_logs_code` (`log_code`),
    KEY `idx_audit_logs_user` (`user_id`),
    KEY `idx_audit_logs_created_at` (`created_at`),
    CONSTRAINT `fk_audit_logs_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 13. REFERENCE CATALOGS (Service Prices, National ID Types, Public Site Info)
-- -----------------------------------------------------------------------------
CREATE TABLE `service_catalog` (
    `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `category`   ENUM('medicine', 'laboratory') NOT NULL,
    `item_name`  VARCHAR(150) NOT NULL,
    `unit_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_service_catalog_item` (`category`, `item_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `id_types` (
    `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name`       VARCHAR(100) NOT NULL,
    `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_id_types_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `public_info` (
    `info_key`   VARCHAR(50) NOT NULL,
    `info_value` LONGTEXT NOT NULL COMMENT 'JSON structure for emergencyInfo, triageGuide, visitorInfo',
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`info_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SEED DATA (Preserving PrimeCare Mock Data from js/data.js)
-- =============================================================================

-- 1. Sequences
INSERT INTO `sequences` (`entity_key`, `prefix`, `current_val`, `pad_length`) VALUES
('users',          'U',   6, 3),
('patients',       'P',   2, 3),
('doctors',        'D',   5, 3),
('appointments',   'A',   2, 3),
('medicalRecords', 'M',   1, 3),
('prescriptions',  'RX',  1, 3),
('labResults',     'LAB', 2, 3),
('immunizations',  'IMM', 2, 3),
('admissions',     'ADM', 1, 3),
('bills',          'B',   2, 3),
('receipts',       'R',   1, 4);

-- 2. Users (Default password for all demo accounts: 'password123' hashed with bcrypt)
INSERT INTO `users` (`id`, `username`, `password_hash`, `full_name`, `role`, `status`, `email`, `mobile`, `must_change_password`, `last_login`, `created_by`, `created_at`) VALUES
('U-001', 'admin',    '$2y$10$cyDVrz9mWImPJjrDPlsOW.NNGdhIYGcwS39LQ0Zdlu4lDmeQa/SXW', 'System Admin',     'admin',   'active',  'admin@primecare.ph',      '09170000000', 0, CURDATE(),                      NULL,    '2026-01-01'),
('U-002', 'doctor',   '$2y$10$cyDVrz9mWImPJjrDPlsOW.NNGdhIYGcwS39LQ0Zdlu4lDmeQa/SXW', 'Dr. Jose Rizal',   'doctor',  'active',  'jrizal@primecare.ph',     '09170000001', 0, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'U-001', '2026-01-01'),
('U-003', 'nurse',    '$2y$10$cyDVrz9mWImPJjrDPlsOW.NNGdhIYGcwS39LQ0Zdlu4lDmeQa/SXW', 'Nurse Maria Clara','nurse',   'active',  'mclara@primecare.ph',     '09170000002', 0, CURDATE(),                      'U-001', '2026-01-01'),
('U-004', 'staff',    '$2y$10$cyDVrz9mWImPJjrDPlsOW.NNGdhIYGcwS39LQ0Zdlu4lDmeQa/SXW', 'Andres Bonifacio', 'staff',   'active',  'abonifacio@primecare.ph', '09170000003', 0, CURDATE(),                      'U-001', '2026-01-01'),
('U-005', 'patient',  '$2y$10$cyDVrz9mWImPJjrDPlsOW.NNGdhIYGcwS39LQ0Zdlu4lDmeQa/SXW', 'Juan Dela Cruz',   'patient', 'active',  'juan@example.com',        '09171234567', 0, CURDATE(),                      NULL,    '2026-10-10'),
('U-006', 'patient2', '$2y$10$cyDVrz9mWImPJjrDPlsOW.NNGdhIYGcwS39LQ0Zdlu4lDmeQa/SXW', 'Leonor Rivera',    'patient', 'pending', 'leonor@example.com',      '09181234567', 0, NULL,                           NULL,    CURDATE());

-- 3. Departments
INSERT INTO `departments` (`name`, `description`, `services_json`) VALUES
('Cardiology',        'Comprehensive heart and cardiovascular care.',     '["ECG","Echocardiogram","Angioplasty"]'),
('Pediatrics',        'Infant, child, and adolescent healthcare.',        '["Vaccinations","Newborn Screening","Wellness Checks"]'),
('Oncology',          'Cancer diagnosis, treatment, and care.',           '["Chemotherapy","Radiation Therapy","Tumor Removal"]'),
('Internal Medicine', 'Adult diseases and general health management.',    '["Routine Checkups","Diabetes Management","Hypertension Care"]'),
('Surgery',           'General and specialized surgical procedures.',     '["Appendectomy","Hernia Repair","Minimally Invasive Surgery"]'),
('Dermatology',       'Skin, hair, and nail care.',                       '["Acne Treatment","Skin Biopsy","Laser Therapy"]');

-- 4. Doctors
INSERT INTO `doctors` (`id`, `user_id`, `name`, `photo_initials`, `specialization`, `department`, `contact`, `email`, `languages_json`, `accepted_insurance_json`, `qualifications`, `status`, `consultation_fee`, `slot_minutes`) VALUES
('D-001', 'U-002', 'Dr. Jose Rizal',          'JR', 'Ophthalmology', 'Surgery',           '09170000001', 'jrizal@primecare.ph',    '["English","Tagalog","Spanish"]', '["PhilHealth","Maxicare"]',    'MD, PhD',  'active', 1000.00, 30),
('D-002', NULL,    'Dr. Antonio Luna',        'AL', 'Cardiology',    'Internal Medicine', '09170000002', 'aluna@primecare.ph',     '["English","Tagalog"]',           '["PhilHealth","Intellicare"]', 'MD, FACC', 'active', 1500.00, 30),
('D-003', NULL,    'Dr. Melchora Aquino',     'MA', 'Pediatrics',    'Pediatrics',        '09170000003', 'maquino@primecare.ph',   '["English","Tagalog"]',           '["PhilHealth"]',               'MD, DPPS', 'active',  800.00, 20),
('D-004', NULL,    'Dr. Marcelo H. del Pilar','MP', 'Neurology',     'Internal Medicine', '09170000004', 'mdelpilar@primecare.ph', '["English","Tagalog"]',           '["PhilHealth","Medicard"]',    'MD',       'active', 1200.00, 30),
('D-005', NULL,    'Dr. Gregorio del Pilar',  'GP', 'Dermatology',   'Dermatology',       '09170000005', 'gdelpilar@primecare.ph', '["English","Tagalog"]',           '["PhilHealth"]',               'MD, DPDS', 'active', 1000.00, 15);

-- 5. Doctor Schedules
INSERT INTO `doctor_schedules` (`doctor_id`, `day_of_week`, `start_time`, `end_time`) VALUES
-- D-001: Mon-Sun 09:00-17:00
('D-001', 'Mon', '09:00:00', '17:00:00'),
('D-001', 'Tue', '09:00:00', '17:00:00'),
('D-001', 'Wed', '09:00:00', '17:00:00'),
('D-001', 'Thu', '09:00:00', '17:00:00'),
('D-001', 'Fri', '09:00:00', '17:00:00'),
('D-001', 'Sat', '09:00:00', '17:00:00'),
('D-001', 'Sun', '09:00:00', '17:00:00'),
-- D-002: Mon-Sun 08:00-16:00
('D-002', 'Mon', '08:00:00', '16:00:00'),
('D-002', 'Tue', '08:00:00', '16:00:00'),
('D-002', 'Wed', '08:00:00', '16:00:00'),
('D-002', 'Thu', '08:00:00', '16:00:00'),
('D-002', 'Fri', '08:00:00', '16:00:00'),
('D-002', 'Sat', '08:00:00', '16:00:00'),
('D-002', 'Sun', '08:00:00', '16:00:00'),
-- D-003: Mon-Fri 10:00-15:00
('D-003', 'Mon', '10:00:00', '15:00:00'),
('D-003', 'Tue', '10:00:00', '15:00:00'),
('D-003', 'Wed', '10:00:00', '15:00:00'),
('D-003', 'Thu', '10:00:00', '15:00:00'),
('D-003', 'Fri', '10:00:00', '15:00:00'),
-- D-004: Wed-Sat 09:00-17:00
('D-004', 'Wed', '09:00:00', '17:00:00'),
('D-004', 'Thu', '09:00:00', '17:00:00'),
('D-004', 'Fri', '09:00:00', '17:00:00'),
('D-004', 'Sat', '09:00:00', '17:00:00'),
-- D-005: Mon-Thu 13:00-18:00
('D-005', 'Mon', '13:00:00', '18:00:00'),
('D-005', 'Tue', '13:00:00', '18:00:00'),
('D-005', 'Wed', '13:00:00', '18:00:00'),
('D-005', 'Thu', '13:00:00', '18:00:00');

-- 6. Patients
INSERT INTO `patients` (`id`, `user_id`, `first_name`, `middle_name`, `last_name`, `suffix`, `full_name`, `birthdate`, `sex`, `civil_status`, `city`, `address`, `mobile`, `email`, `emergency_contact_name`, `emergency_contact_number`, `emergency_contact_relationship`, `id_type`, `id_number`, `admit_type`, `date_admitted`, `status`, `verified_by`, `verified_at`, `rejection_reason`, `blood_type`, `allergies`, `medical_conditions`, `insurance_provider`, `insurance_number`, `assigned_doctor_id`, `ward`, `bed_number`, `notes`, `created_at`) VALUES
('P-001', 'U-005', 'Juan',   'Santos',   'Dela Cruz', '', 'Juan Dela Cruz', '1985-05-15', 'Male',   'Married', 'Quezon City', 'Quezon City', '09171234567', 'juan@example.com',   'Maria Dela Cruz', '09177654321', 'Spouse', 'Passport', 'P1234567A',   'Outpatient', DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'verified', 'System Admin', DATE_SUB(CURDATE(), INTERVAL 1 DAY), NULL, 'O+', 'Penicillin, Aspirin', 'Hypertension', 'PhilHealth', 'PH-12345', 'D-001', '', '', 'Regular checkups.', DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
('P-002', 'U-006', 'Leonor', 'Bautista', 'Rivera',    '', 'Leonor Rivera',  '1990-08-22', 'Female', 'Single',  'Manila',      'Manila',      '09181234567', 'leonor@example.com', 'Antonio Rivera',  '09187654321', 'Father', 'UMID',     'CRN-123-456', 'Outpatient', CURDATE(),                           'verified', 'System Admin', CURDATE(),                           NULL, 'A-', 'None',                'Asthma',       'Maxicare',   'MAX-999',  'D-002', '', '', 'Verified patient.', CURDATE());

-- 7. Wards & Beds
INSERT INTO `wards` (`id`, `name`, `type`, `daily_rate`) VALUES
('W1', 'General Ward A', 'General',   1500.00),
('W2', 'ICU',            'ICU',       5000.00),
('W3', 'Maternity',      'Maternity', 2500.00),
('W4', 'Pediatrics',     'Pediatrics',2000.00),
('W5', 'Emergency',      'Emergency', 1000.00);

INSERT INTO `beds` (`id`, `ward_id`, `bed_number`, `status`, `current_patient_id`) VALUES
('W1-B01', 'W1', 'B01', 'Available', NULL), ('W1-B02', 'W1', 'B02', 'Available', NULL), ('W1-B03', 'W1', 'B03', 'Available', NULL),
('W1-B04', 'W1', 'B04', 'Available', NULL), ('W1-B05', 'W1', 'B05', 'Available', NULL), ('W1-B06', 'W1', 'B06', 'Available', NULL),
('W2-B01', 'W2', 'B01', 'Available', NULL), ('W2-B02', 'W2', 'B02', 'Available', NULL), ('W2-B03', 'W2', 'B03', 'Available', NULL),
('W2-B04', 'W2', 'B04', 'Available', NULL), ('W2-B05', 'W2', 'B05', 'Available', NULL), ('W2-B06', 'W2', 'B06', 'Available', NULL),
('W3-B01', 'W3', 'B01', 'Available', NULL), ('W3-B02', 'W3', 'B02', 'Available', NULL), ('W3-B03', 'W3', 'B03', 'Available', NULL),
('W3-B04', 'W3', 'B04', 'Available', NULL), ('W3-B05', 'W3', 'B05', 'Available', NULL), ('W3-B06', 'W3', 'B06', 'Available', NULL),
('W4-B01', 'W4', 'B01', 'Available', NULL), ('W4-B02', 'W4', 'B02', 'Available', NULL), ('W4-B03', 'W4', 'B03', 'Available', NULL),
('W4-B04', 'W4', 'B04', 'Available', NULL), ('W4-B05', 'W4', 'B05', 'Available', NULL), ('W4-B06', 'W4', 'B06', 'Available', NULL),
('W5-B01', 'W5', 'B01', 'Available', NULL), ('W5-B02', 'W5', 'B02', 'Available', NULL), ('W5-B03', 'W5', 'B03', 'Available', NULL),
('W5-B04', 'W5', 'B04', 'Available', NULL), ('W5-B05', 'W5', 'B05', 'Available', NULL), ('W5-B06', 'W5', 'B06', 'Available', NULL);

-- 8. Admissions
INSERT INTO `admissions` (`id`, `patient_id`, `bed_id`, `attending_doctor_id`, `admit_date`, `discharge_date`, `daily_rate`, `discharge_summary`, `status`, `billed`, `bill_id`) VALUES
('ADM-001', 'P-001', 'W1-B01', 'D-002', '2025-01-10', '2025-01-12', 1500.00, 'Patient stabilized and discharged with oral meds.', 'Discharged', 1, NULL);

-- 9. Bills, Bill Items & Payments
INSERT INTO `bills` (`id`, `patient_id`, `admission_id`, `subtotal`, `discount_type`, `discount_amount`, `insurance_provider`, `insurance_coverage`, `total`, `amount_paid`, `balance`, `status`, `void_reason`, `created_by`, `created_at`) VALUES
('B-001', 'P-001', NULL, 1750.00, 'None', 0.00, 'PhilHealth', 500.00, 1250.00, 1250.00,   0.00, 'Paid',   NULL, 'U-004', CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 10:00:00')),
('B-002', 'P-001', NULL,  800.00, 'None', 0.00, '',             0.00,  800.00,    0.00, 800.00, 'Unpaid', NULL, 'U-001', CONCAT(CURDATE(), ' 11:00:00'));

INSERT INTO `bill_items` (`bill_id`, `item_type`, `description`, `qty`, `unit_price`, `amount`, `source_type`, `source_id`) VALUES
('B-001', 'Professional Fee', 'Consultation - Dr. Jose Rizal', 1, 1000.00, 1000.00, 'appointments',  'A-001'),
('B-001', 'Medication',       'Artificial Tears',              1,  250.00,  250.00, 'prescriptions', 'RX-001'),
('B-001', 'Laboratory',       'Complete Blood Count',          1,  500.00,  500.00, 'labResults',    'LAB-001'),
('B-002', 'Laboratory',       'Lipid Profile',                 1,  800.00,  800.00, NULL,            NULL);

INSERT INTO `payments` (`receipt_no`, `bill_id`, `amount`, `method`, `reference_no`, `paid_at`, `received_by`) VALUES
('R-0001', 'B-001', 1250.00, 'Cash', '', CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 14:30:00'), 'Andres Bonifacio');

-- 10. Appointments
INSERT INTO `appointments` (`id`, `patient_id`, `doctor_id`, `appointment_date`, `appointment_time`, `type`, `status`, `reason`, `notes`, `cancel_reason`, `billed`, `bill_id`, `created_by`, `created_at`, `updated_at`) VALUES
('A-001', 'P-001', 'D-001', DATE_SUB(CURDATE(), INTERVAL 1 DAY), '09:00:00', 'in-person',  'Completed', 'Routine eye checkup',            '', NULL, 1, 'B-001', 'U-001', CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 08:00:00'), CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 09:30:00')),
('A-002', 'P-001', 'D-002', DATE_ADD(CURDATE(), INTERVAL 1 DAY), '10:00:00', 'telehealth', 'Confirmed', 'Follow-up on heart palpitations','', NULL, 0, NULL,    'U-005', CONCAT(CURDATE(), ' 09:00:00'),                           CONCAT(CURDATE(), ' 09:00:00'));

-- 11. Medical Records
INSERT INTO `medical_records` (`id`, `patient_id`, `appointment_id`, `attending_doctor_id`, `chief_complaint`, `vital_bp`, `vital_heart_rate`, `vital_temperature`, `vital_resp_rate`, `vital_weight_kg`, `vital_height_cm`, `vital_spo2`, `diagnosis`, `treatment_notes`, `follow_up_date`, `created_by`, `created_at`, `updated_at`) VALUES
('M-001', 'P-001', 'A-001', 'D-001', 'Blurry vision', '120/80', 75, 36.5, 16, 70.00, 170.00, 98, 'Myopia', 'Prescribed new corrective lenses.', NULL, 'U-002', CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 09:30:00'), CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 09:30:00'));

-- 12. Prescriptions & Prescription Items
INSERT INTO `prescriptions` (`id`, `patient_id`, `doctor_id`, `medical_record_id`, `status`, `prescribed_date`, `notes`, `override_allergy`, `override_reason`, `billed`, `bill_id`) VALUES
('RX-001', 'P-001', 'D-001', 'M-001', 'Dispensed', DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Avoid rubbing eyes.', 0, NULL, 1, 'B-001');

INSERT INTO `prescription_items` (`prescription_id`, `medicine`, `dosage`, `frequency`, `duration_days`, `instructions`) VALUES
('RX-001', 'Artificial Tears', '1 drop', '3x a day', 30, 'Apply to both eyes.');

-- 13. Lab Results & Immunizations
INSERT INTO `lab_results` (`id`, `patient_id`, `ordered_by`, `test_name`, `category`, `status`, `result`, `unit`, `ref_range_min`, `ref_range_max`, `flag`, `attachment_name`, `ordered_date`, `result_date`, `performed_by`, `billed`, `bill_id`) VALUES
('LAB-001', 'P-001', 'D-001', 'Complete Blood Count', 'Hematology', 'Completed', '13.5', 'g/dL',  13.80, 17.20, 'Abnormal', NULL, DATE_SUB(CURDATE(), INTERVAL 1 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'System Admin', 1, 'B-001'),
('LAB-002', 'P-001', 'D-002', 'Lipid Profile',        'Chemistry',  'Completed', '180',  'mg/dL',  0.00, 200.00, 'Normal',   NULL, CURDATE(),                           CURDATE(),                           'System Admin', 0, NULL);

INSERT INTO `immunizations` (`id`, `patient_id`, `vaccine`, `dose`, `date_given`, `administered_by`) VALUES
('IMM-001', 'P-001', 'COVID-19 (Pfizer)', '1st Dose', '2021-06-15', 'Dr. Jose Rizal'),
('IMM-002', 'P-001', 'COVID-19 (Pfizer)', '2nd Dose', '2021-07-15', 'Dr. Jose Rizal');

-- 14. Notifications
INSERT INTO `notifications` (`id`, `patient_id`, `type`, `title`, `message`, `link`, `is_read`, `created_at`) VALUES
('N-001', 'P-001', 'system', 'Welcome', 'Welcome to the PRIMECARE Patient Portal!', 'home.html', 0, CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 08:00:00'));

-- 15. Reference Catalogs (Service Catalog, ID Types, Public Site Info)
INSERT INTO `service_catalog` (`category`, `item_name`, `unit_price`) VALUES
('medicine',   'Amoxicillin 500mg',    15.00),
('medicine',   'Paracetamol 500mg',     5.00),
('medicine',   'Artificial Tears',    250.00),
('medicine',   'Losartan 50mg',        20.00),
('medicine',   'Metformin 500mg',      12.00),
('medicine',   'Ibuprofen 400mg',       8.00),
('medicine',   'Omeprazole 20mg',      25.00),
('medicine',   'Cetirizine 10mg',      15.00),
('laboratory', 'Complete Blood Count',500.00),
('laboratory', 'Fasting Blood Sugar', 250.00),
('laboratory', 'Lipid Profile',       800.00),
('laboratory', 'Urinalysis',          150.00),
('laboratory', 'Chest X-ray',         600.00),
('laboratory', 'ECG',                 750.00),
('laboratory', 'Creatinine',          300.00);

INSERT INTO `id_types` (`name`, `sort_order`) VALUES
('PhilSys National ID', 1),
('Driver''s License',   2),
('Passport',            3),
('UMID',                4),
('Voter''s ID',         5),
('PRC ID',              6),
('Postal ID',           7),
('Student ID',          8);

INSERT INTO `public_info` (`info_key`, `info_value`) VALUES
('emergencyInfo', '{"hotline":"(02) 8123-4567","address":"123 Rizal St., Quezon City","erWaitTimes":[{"area":"Triage","minutes":5},{"area":"Adult ER","minutes":25},{"area":"Pediatric ER","minutes":12},{"area":"Trauma","minutes":0}]}'),
('triageGuide',   '[{"level":"Critical","desc":"Immediate life-saving intervention needed.","symptoms":"Cardiac arrest, severe bleeding, unconsciousness","color":"danger"},{"level":"Urgent","desc":"Requires quick attention, but not immediately life-threatening.","symptoms":"Severe pain, difficulty breathing, suspected stroke","color":"warning"},{"level":"Semi-urgent","desc":"Needs care within a few hours.","symptoms":"Fractures, moderate cuts, high fever","color":"info"},{"level":"Non-urgent","desc":"Minor conditions that can wait or be treated at a clinic.","symptoms":"Minor burns, colds, sprains","color":"success"}]'),
('visitorInfo',   '{"visitingHours":[{"area":"General Ward","hours":"9:00 AM - 8:00 PM"},{"area":"ICU","hours":"10:00 AM - 11:00 AM, 5:00 PM - 6:00 PM"},{"area":"Maternity","hours":"10:00 AM - 7:00 PM"}],"icuProtocols":"Only 2 visitors allowed at a time. Protective gear must be worn. No children under 12.","infectionControl":"Masks are required in all patient areas. Sanitize hands upon entry and exit.","parking":"Visitor parking is located at the East Wing. Rate is ₱50 for the first 3 hours.","cafeteria":"Open daily from 6:00 AM to 9:00 PM on the Ground Floor."}');

SET FOREIGN_KEY_CHECKS = 1;

