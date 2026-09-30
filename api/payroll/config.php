<?php
/**
 * Payroll app bootstrap.
 *
 * This app now lives INSIDE api/ (api/payroll/), not beside it — so it
 * reuses your existing DB connection and business logic in-process
 * instead of calling the REST API over HTTP or duplicating any of it:
 *   - db() / gen_id() / round2() / now_sql() from api/includes/Helpers.php
 *   - calc_advance_projection() / apply_advance_recovery() from
 *     api/includes/AdvanceRecoveryCalc.php — the exact same recovery math
 *     PayrollController and SalaryAdvanceController already use, so this
 *     app and the API can never drift out of sync with each other.
 *
 * API_DIR is just "one level up from this file" now (api/payroll/ → api/).
 * If you ever move this folder back out to sit beside api/ instead of
 * inside it, change this back to __DIR__ . '/../api'.
 */

define('API_DIR', dirname(__DIR__));

require API_DIR . '/config/config.php';
require API_DIR . '/config/database.php';
require API_DIR . '/includes/Helpers.php';
require API_DIR . '/includes/ActivityLogger.php';
require API_DIR . '/includes/AdvanceRecoveryCalc.php';

require __DIR__ . '/includes/auth.php';
require __DIR__ . '/includes/helpers.php';

session_start();
