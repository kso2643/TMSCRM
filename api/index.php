<?php
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  Industrial CRM  —  PHP/MySQL Backend Entry Point        ║
 * ║  Drop-in replacement for the original Node/Express API   ║
 * ║  All /api/* routes map 1-to-1 with the Express version   ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Place this file at the root of the backend-php/ folder.
 * Apache: configure AllowOverride All and see .htaccess.
 * PHP built-in server: php -S localhost:5000 index.php
 *
 * All the original Express/Node dependencies are replaced by
 * pure-PHP equivalents with no Composer packages:
 *   express         → this router
 *   jsonwebtoken    → includes/JWT.php
 *   bcryptjs        → PHP's password_hash()/password_verify()
 *   multer          → PHP's built-in $_FILES
 *   pdfkit          → includes/SimplePdf.php
 *   xlsx (SheetJS)  → includes/XlsxWriter.php + XlsxReader.php
 *   prisma          → PDO/MySQL calls in every controller
 *   cors            → sendCorsHeaders() below
 *   dotenv          → load_env() in config.php
 */

declare(strict_types=1);

require __DIR__ . '/config/config.php';
require __DIR__ . '/config/database.php';

// PHP warnings / notices must never be printed into a response: a single
// warning in front of an Excel / PDF / zip download makes the file unreadable
// ("file format or extension is not valid") and breaks JSON too. They still
// go to the server error log.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
// Output is buffered, so headers can still be sent after stray output and
// anything printed before a file's first byte (a warning, a blank line from
// an edited file) is dropped from the download.
ob_start(static function (string $buf, int $phase): string {
    static $checked = false;
    if ($checked) return $buf;
    $checked = true;
    foreach (headers_list() as $h) {
        if (!preg_match('~^Content-Type:\s*(application/(vnd\.openxmlformats|pdf|zip|octet-stream))~i', $h)) continue;
        foreach (["PK\x03\x04", '%PDF'] as $sig) {
            $p = strpos($buf, $sig);
            if ($p !== false && $p > 0) return substr($buf, $p);
        }
        break;
    }
    return $buf;
}, 1 << 20);

require __DIR__ . '/includes/Helpers.php';
require __DIR__ . '/includes/Response.php';
require __DIR__ . '/includes/JWT.php';
require __DIR__ . '/includes/Auth.php';
require __DIR__ . '/includes/ActivityLogger.php';
require __DIR__ . '/includes/SchemaGuard.php';
require __DIR__ . '/includes/XlsxWriter.php';
require __DIR__ . '/includes/XlsxReader.php';
require __DIR__ . '/includes/StyledXlsxWriter.php';
require __DIR__ . '/includes/SimplePdf.php';
require __DIR__ . '/includes/ApjQuotationPdf.php';
require __DIR__ . '/includes/TMSQuotationPdf.php';

require __DIR__ . '/controllers/AuthController.php';
require __DIR__ . '/controllers/UserController.php';
require __DIR__ . '/controllers/CustomerController.php';
require __DIR__ . '/controllers/MeetingController.php';
require __DIR__ . '/controllers/ProductController.php';
require __DIR__ . '/controllers/StockController.php';
require __DIR__ . '/controllers/AttendanceController.php';
require __DIR__ . '/controllers/FuelExpenseController.php';
require __DIR__ . '/controllers/AppointmentController.php';
require __DIR__ . '/controllers/OrderController.php';
require __DIR__ . '/controllers/TaskController.php';
require __DIR__ . '/controllers/PriceRequestController.php';
require __DIR__ . '/controllers/TrialController.php';
require __DIR__ . '/controllers/AlertFeedController.php';
require __DIR__ . '/controllers/ChatController.php';
require __DIR__ . '/controllers/QuotationController.php';
require __DIR__ . '/controllers/DashboardAnalyticsController.php';
require __DIR__ . '/controllers/MiscControllers.php';    // Category, Leave, Activity
require __DIR__ . '/controllers/ExportController.php';
require __DIR__ . '/controllers/ReportsController.php';   // extends ExportController — must come after it
require __DIR__ . '/controllers/BackupController.php';
require __DIR__ . '/controllers/LocationHistoryController.php';
require __DIR__ . '/controllers/CprController.php';
require __DIR__ . '/controllers/MeetingAttachmentController.php'; // photos, files, voice notes on meetings      // CPR opportunity register + Saturday review + weekly/monthly reports
require __DIR__ . '/controllers/PayrollController.php';  // Payroll, Salary Advances, Advance Recovery, Employee Ledger

// ── CORS — mirrors the Express CORS config exactly ───────────────────
function sendCorsHeaders(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? FRONTEND_URL;
    // Allow the configured frontend origin and any localhost dev port
    $allowed = FRONTEND_URL;
    if (preg_match('/^https?:\/\/localhost(:\d+)?$/', $origin) || $origin === $allowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
    } else {
        header('Access-Control-Allow-Origin: ' . $allowed);
    }
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    // Let the CRM (a different origin) read download file names.
    header('Access-Control-Expose-Headers: Content-Disposition');
    header('Vary: Origin');
}

sendCorsHeaders();

// Handle CORS pre-flight — all routes
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Health check ─────────────────────────────────────────────────────
$rawUri = $_SERVER['REQUEST_URI'] ?? '/';
$path   = strtok(parse_url($rawUri, PHP_URL_PATH), '?') ?: '/';

if ($path === '/health') {
    header('Content-Type: application/json');
    echo json_encode(['status' => 'OK', 'timestamp' => date('c'), 'env' => APP_ENV]);
    exit;
}

// ── Static uploads (/uploads/meetings/filename.jpg, etc.) ────────────
if (str_starts_with($path, '/uploads/')) {
    // Only real files inside uploads/, never scripts, never the private
    // meeting-files folder (those go through /api/meetings/:id/attachments).
    $filePath = realpath(BASE_PATH . rawurldecode($path));
    $root = realpath(UPLOADS_PATH);
    if (!$filePath || !$root || !str_starts_with($filePath, $root . DIRECTORY_SEPARATOR) || !is_file($filePath)
        || preg_match('/\.(php\d?|phtml|phar|pht|pl|py|cgi|sh|shtml|htaccess|htpasswd|ini)$/i', $filePath)
        || str_starts_with($filePath, $root . DIRECTORY_SEPARATOR . 'meeting-files' . DIRECTORY_SEPARATOR)) { http_response_code(404); exit; }
    $mime = mime_content_type($filePath) ?: 'application/octet-stream';
    header('Content-Type: ' . $mime);
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . filesize($filePath));
    readfile($filePath);
    exit;
}

// ── API router ────────────────────────────────────────────────────────
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Strip /api prefix
if (!str_starts_with($path, '/api/') && $path !== '/api') {
    sendError("Route $path not found", 404);
}
$apiPath = substr($path, 4); // e.g. "/users/abc123/reset-password"

// Split into segments: ['users', 'abc123', 'reset-password']
$segs = array_values(array_filter(explode('/', $apiPath), fn($s) => $s !== ''));

$c0 = $segs[0] ?? '';
$c1 = $segs[1] ?? '';
$c2 = $segs[2] ?? '';
$c3 = $segs[3] ?? '';
$c4 = $segs[4] ?? '';

// Tiny router — match from most-specific to least-specific.
// Convention: segment variables (IDs) are captured as $c1, $c2, etc.
// Exactly mirrors the Express routes in index.js + all *.routes.js.

try {
    // ── Auth ───────────────────────────────────────────────────────
    if ($c0 === 'auth') {
        $ctrl = new AuthController();
        match (true) {
            $method === 'POST' && $c1 === 'login'           => $ctrl->login(),
            $method === 'GET'  && $c1 === 'me'              => $ctrl->me(),
            $method === 'PUT'  && $c1 === 'change-password' => $ctrl->changePassword(),
            $method === 'PUT'  && $c1 === 'profile'         => $ctrl->updateProfile(),
            $method === 'POST' && $c1 === 'logout'          => $ctrl->logout(),
            default => sendError("Route /api/auth/$c1 not found", 404),
        };
    }

    // ── Users ──────────────────────────────────────────────────────
    elseif ($c0 === 'users') {
        $ctrl = new UserController();
        match (true) {
            $method === 'GET'   && $c1 === 'export'             => $ctrl->export(),
            $method === 'GET'   && $c1 === ''                   => $ctrl->index(),
            $method === 'POST'  && $c1 === ''                   => $ctrl->create(),
            $method === 'GET'   && $c1 !== '' && $c2 === ''     => $ctrl->show($c1),
            $method === 'PUT'   && $c1 !== '' && $c2 === ''     => $ctrl->update($c1),
            $method === 'DELETE'&& $c1 !== '' && $c2 === ''     => $ctrl->delete($c1),
            $method === 'PATCH' && $c2 === 'reset-password'     => $ctrl->resetPassword($c1),
            $method === 'PATCH' && $c2 === 'toggle-lock'        => $ctrl->toggleLock($c1),
            $method === 'PATCH' && $c2 === 'reactivate'         => $ctrl->reactivate($c1),
            default => sendError("Route /api/users not matched ($method $c1/$c2)", 404),
        };
    }

    // ── Customers ─────────────────────────────────────────────────
    elseif ($c0 === 'customers') {
        $ctrl = new CustomerController(); $exp = new ExportController();
        match (true) {
            $method === 'GET'   && $c1 === 'meta'  && $c2 === 'filters' => $ctrl->filterMeta(),
            $method === 'GET'   && $c1 === 'with-location'              => $ctrl->withLocation(),
            $method === 'GET'   && $c1 === 'export'                     => $exp->exportCustomers(),
            $method === 'GET'   && $c1 === ''                           => $ctrl->index(),
            $method === 'POST'  && $c1 === ''                           => $ctrl->create(),
            $method === 'GET'   && $c1 !== '' && $c2 === ''             => $ctrl->show($c1),
            $method === 'PUT'   && $c1 !== '' && $c2 === ''             => $ctrl->update($c1),
            $method === 'DELETE'&& $c1 !== ''                           => $ctrl->delete($c1),
            default => sendError("Route /api/customers/$c1 not found", 404),
        };
    }

    // ── Meetings ──────────────────────────────────────────────────
    elseif ($c0 === 'meetings') {
        $ctrl = new MeetingController(); $exp = new ExportController();
        match (true) {
            $method === 'GET'   && $c1 === 'today-followups'            => $ctrl->todayFollowups(),
            $method === 'GET'   && $c1 === 'alerts'                     => $ctrl->alerts(),
            $method === 'PATCH' && $c1 === 'alerts' && $c3 === 'read'   => $ctrl->markAlertRead($c2),
            $method === 'GET'   && $c1 === 'export'                     => $exp->exportMeetings(),
            $method === 'GET'   && $c1 === 'customer' && $c3 === 'visits' => $ctrl->customerVisits($c2),
            $method === 'GET'   && $c1 === ''                           => $ctrl->index(),
            $method === 'POST'  && $c1 === ''                           => $ctrl->create(),
            $method === 'GET'   && $c1 !== '' && $c2 === ''             => $ctrl->show($c1),
            $method === 'PUT'   && $c1 !== '' && $c2 === ''             => $ctrl->update($c1),
            $method === 'POST'  && $c2 === 'checkin'                    => $ctrl->checkIn($c1),
            $method === 'PATCH' && $c2 === 'timer'                      => $ctrl->timer($c1),
            $method === 'GET'    && $c2 === 'attachments' && $c3 === ''  => (new MeetingAttachmentController())->index($c1),
            $method === 'POST'   && $c2 === 'attachments' && $c3 === ''  => (new MeetingAttachmentController())->upload($c1),
            $method === 'GET'    && $c2 === 'attachments' && $c3 !== ''  => (new MeetingAttachmentController())->file($c1, $c3),
            $method === 'DELETE' && $c2 === 'attachments' && $c3 !== ''  => (new MeetingAttachmentController())->delete($c1, $c3),
            default => sendError("Route /api/meetings/$c1/$c2 not found", 404),
        };
    }

    // ── Products + Stock ──────────────────────────────────────────
    elseif ($c0 === 'products') {
        $pc = new ProductController(); $sc = new StockController(); $exp = new ExportController();
        match (true) {
            // Stock sub-routes (must precede /:id)
            $method === 'GET'   && $c1 === 'stock' && $c2 === 'alerts'   => $sc->alerts(),
            $method === 'GET'   && $c1 === 'stock' && $c2 === 'stats'    => $sc->stats(),
            $method === 'GET'   && $c1 === 'stock' && $c2 === 'template' => $sc->template(),
            $method === 'GET'   && $c1 === 'stock' && $c2 === 'meta'     => $sc->meta(),
            $method === 'GET'   && $c1 === 'stock' && $c2 === 'brands' && $c3 === ''       => $sc->brands(),
            $method === 'GET'   && $c1 === 'stock' && $c2 === 'brands' && $c3 === 'export' => $sc->brandsExport(),
            $method === 'POST'  && $c1 === 'stock' && $c2 === 'entry'    => $sc->entry(),
            $method === 'GET'   && $c1 === 'stock' && $c2 === 'check'    => $sc->checkStatus(),
            $method === 'POST'  && $c1 === 'stock' && $c2 === 'check'    => $sc->checkDone(),
            $method === 'POST'  && $c1 === 'stock' && $c2 !== '' && $c3 === 'adjust'    => $sc->adjust($c2),
            $method === 'GET'   && $c1 === 'stock' && $c2 !== '' && $c3 === 'movements' => $sc->movements($c2),
            $method === 'POST'  && $c1 === 'stock' && $c2 === 'import'   => $sc->import(),
            $method === 'GET'   && $c1 === 'stock' && $c2 === ''         => $sc->index(),
            $method === 'POST'  && $c1 === 'stock' && $c2 === ''         => $sc->create(),
            $method === 'PUT'   && $c1 === 'stock' && $c2 !== ''         => $sc->update($c2),
            $method === 'DELETE'&& $c1 === 'stock' && $c2 !== ''         => $sc->delete($c2),
            // Product sub-routes
            $method === 'GET'   && $c1 === 'export'                      => $exp->exportProducts(),
            $method === 'GET'   && $c1 === 'template'                    => $pc->template(),
            $method === 'POST'  && $c1 === 'import'                      => $pc->import(),
            $method === 'GET'   && $c1 === 'search'                      => $pc->search(),
            $method === 'GET'   && $c1 === 'code' && $c2 !== ''          => $pc->byCode($c2),
            $method === 'GET'   && $c1 === ''                            => $pc->index(),
            $method === 'POST'  && $c1 === ''                            => $pc->create(),
            $method === 'GET'   && $c1 !== '' && $c2 === ''              => $pc->show($c1),
            $method === 'PUT'   && $c1 !== '' && $c2 === ''              => $pc->update($c1),
            default => sendError("Route /api/products/$c1/$c2 not found", 404),
        };
    }

    // ── Attendance ───────────────────────────────────────────────
    elseif ($c0 === 'attendance') {
        $ctrl = new AttendanceController(); $exp = new ExportController();
        match (true) {
            $method === 'POST'  && $c1 === 'checkin'                     => $ctrl->checkIn(),
            $method === 'POST'  && $c1 === 'checkout'                    => $ctrl->checkOut(),
            $method === 'POST'  && $c1 === 'ping'                        => $ctrl->ping(),
            $method === 'GET'   && $c1 === 'today'                       => $ctrl->today(),
            $method === 'GET'   && $c1 === 'live'                        => $ctrl->live(),
            $method === 'GET'   && $c1 === 'all'                         => $ctrl->all(),
            $method === 'GET'   && $c1 === 'export'                      => $exp->exportAttendance(),
            $method === 'GET'   && $c1 === ''                            => $ctrl->index(),
            $method === 'GET'   && $c2 === 'locations'                   => $ctrl->locations($c1),
            $method === 'PATCH' && $c2 === 'approve'                     => $ctrl->approve($c1),
            default => sendError("Route /api/attendance/$c1/$c2 not found", 404),
        };
    }

    // ── Fuel Expense ───────────────────────────────────────────────
    elseif ($c0 === 'fuel-expense') {
        $ctrl = new FuelExpenseController(); $exp = new ExportController();
        match (true) {
            $method === 'POST'  && $c1 === 'start'                        => $ctrl->start(),
            $method === 'POST'  && $c1 === 'close'                        => $ctrl->close(),
            $method === 'GET'   && $c1 === 'today'                        => $ctrl->today(),
            $method === 'GET'   && $c1 === 'all'                          => $ctrl->all(),
            $method === 'GET'   && $c1 === 'export'                       => $exp->exportFuelExpense(),
            $method === 'GET'   && $c1 === ''                             => $ctrl->index(),
            $method === 'PATCH' && $c1 !== '' && $c2 === ''               => $ctrl->update($c1),
            default => sendError("Route /api/fuel-expense/$c1/$c2 not found", 404),
        };
    }

    // ── Vehicle Profile (per-employee mileage / fuel price on file) ─
    elseif ($c0 === 'vehicle-profile') {
        $ctrl = new FuelExpenseController();
        match (true) {
            $method === 'GET' && $c1 === '' => $ctrl->getProfile(),
            $method === 'PUT' && $c1 === '' => $ctrl->updateProfile(),
            default => sendError("Route /api/vehicle-profile/$c1 not found", 404),
        };
    }

    // ── Appointments — engineer scheduling calendar ────────────────
    elseif ($c0 === 'appointments') {
        $ctrl = new AppointmentController();
        match (true) {
            $method === 'GET'   && $c1 === 'meta'                     => $ctrl->meta(),
            $method === 'GET'   && $c1 === 'engineers'                => $ctrl->engineers(),
            $method === 'GET'   && $c1 === 'reminders'                => $ctrl->reminders(),
            $method === 'PATCH' && $c1 === 'alerts' && $c3 === 'read' => $ctrl->markAlertRead($c2),
            $method === 'GET'   && $c1 === ''                         => $ctrl->index(),
            $method === 'POST'  && $c1 === ''                         => $ctrl->create(),
            $method === 'GET'   && $c1 !== '' && $c2 === ''           => $ctrl->show($c1),
            $method === 'PUT'   && $c1 !== '' && $c2 === ''           => $ctrl->update($c1),
            $method === 'DELETE'&& $c1 !== '' && $c2 === ''           => $ctrl->delete($c1),
            default => sendError("Route /api/appointments/$c1/$c2 not found", 404),
        };
    }

    // ── Customer Orders — verbal & PO tracking ──────────────────────
    elseif ($c0 === 'orders') {
        $ctrl = new OrderController();
        match (true) {
            $method === 'GET'   && $c1 === 'meta'                          => $ctrl->meta(),
            $method === 'GET'   && $c1 === 'engineers'                     => $ctrl->engineers(),
            $method === 'GET'   && $c1 !== '' && $c2 === 'document'        => $ctrl->downloadDocument($c1),
            $method === 'POST'  && $c1 !== '' && $c2 === 'document'        => $ctrl->uploadDocument($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'delivery'        => $ctrl->updateDelivery($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'eta'             => $ctrl->updateEta($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'procurement'     => $ctrl->updateProcurement($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'proforma'        => $ctrl->updateProforma($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'supply'          => $ctrl->updateSupply($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'items' && $c3 !== '' && $c4 === 'procurement' => $ctrl->updateItemProcurement($c1, $c3),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'items' && $c3 !== '' && $c4 === 'eta'         => $ctrl->updateItemEta($c1, $c3),
            $method === 'GET'   && $c1 === ''                              => $ctrl->index(),
            $method === 'POST'  && $c1 === ''                              => $ctrl->create(),
            $method === 'GET'   && $c1 !== '' && $c2 === ''                => $ctrl->show($c1),
            $method === 'PUT'   && $c1 !== '' && $c2 === ''                => $ctrl->update($c1),
            $method === 'DELETE'&& $c1 !== '' && $c2 === ''                => $ctrl->delete($c1),
            default => sendError("Route /api/orders/$c1/$c2 not found", 404),
        };
    }

    // ── Tasks — admin-assigned, worked as a queue with a timer ──────
    elseif ($c0 === 'tasks') {
        $ctrl = new TaskController();
        match (true) {
            $method === 'GET'   && $c1 === 'meta'                      => $ctrl->meta(),
            $method === 'GET'   && $c1 === 'assignees'                 => $ctrl->assignees(),
            $method === 'GET'   && $c1 === 'overview'                  => $ctrl->overview(),
            $method === 'GET'   && $c1 === 'general' && $c2 === ''     => $ctrl->general(),
            $method === 'POST'  && $c1 === 'general' && $c2 === 'start'=> $ctrl->generalStart(),
            $method === 'POST'  && $c1 === 'general' && $c2 === 'stop' => $ctrl->generalStop(),
            $method === 'GET'   && $c1 === 'completed'                 => $ctrl->completed(),
            $method === 'GET'   && $c1 === ''                          => $ctrl->index(),
            $method === 'POST'  && $c1 === ''                          => $ctrl->create(),
            $method === 'PUT'   && $c1 !== '' && $c2 === ''            => $ctrl->update($c1),
            $method === 'DELETE'&& $c1 !== '' && $c2 === ''            => $ctrl->delete($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'move'        => $ctrl->move($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'start'       => $ctrl->start($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'pause'       => $ctrl->pause($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'resume'      => $ctrl->resume($c1),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'complete'    => $ctrl->complete($c1),
            default => sendError("Route /api/tasks/$c1/$c2 not found", 404),
        };
    }

    // ── Price requests — raised by engineers, answered by admin ─────
    elseif ($c0 === 'price-requests') {
        $ctrl = new PriceRequestController();
        match (true) {
            $method === 'GET'   && $c1 === 'by-no' && $c2 !== ''       => $ctrl->byNumber($c2),
            $method === 'POST'  && $c1 === 'batch' && $c3 === 'remind' => $ctrl->remind($c2),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'revise'      => $ctrl->revise($c1),
            $method === 'GET'   && $c1 === 'batches'                   => $ctrl->batches(),
            $method === 'GET'   && $c1 === 'template'                  => $ctrl->template(),
            $method === 'POST'  && $c1 === 'parse'                     => $ctrl->parse(),
            $method === 'POST'  && $c1 === 'batch' && $c2 === ''       => $ctrl->createBatch(),
            $method === 'PATCH' && $c1 === 'batch' && $c3 === 'respond' => $ctrl->respondBatch($c2),
            $method === 'DELETE'&& $c1 === 'batch' && $c2 !== ''       => $ctrl->deleteBatch($c2),
            $method === 'GET'   && $c1 === ''                          => $ctrl->index(),
            $method === 'POST'  && $c1 === ''                          => $ctrl->create(),
            $method === 'PATCH' && $c1 !== '' && $c2 === 'respond'     => $ctrl->respond($c1),
            $method === 'DELETE'&& $c1 !== '' && $c2 === ''            => $ctrl->delete($c1),
            default => sendError("Route /api/price-requests/$c1/$c2 not found", 404),
        };
    }

    // ── Trials — request (existing data) → approval + recommendation → savings report
    elseif ($c0 === 'trials') {
        $ctrl = new TrialController();
        match (true) {
            $method === 'GET'    && $c1 === 'meta'                     => $ctrl->meta(),
            $method === 'GET'    && $c1 === ''                         => $ctrl->index(),
            $method === 'POST'   && $c1 === ''                         => $ctrl->create(),
            $method === 'GET'    && $c1 !== '' && $c2 === ''           => $ctrl->show($c1),
            $method === 'DELETE' && $c1 !== '' && $c2 === ''           => $ctrl->delete($c1),
            $method === 'PUT'    && $c1 !== '' && $c2 === 'existing'   => $ctrl->updateExisting($c1),
            $method === 'PUT'    && $c1 !== '' && $c2 === 'savings'    => $ctrl->updateSavings($c1),
            $method === 'PATCH'  && $c1 !== '' && $c2 === 'approve'    => $ctrl->approve($c1),
            $method === 'PATCH'  && $c1 !== '' && $c2 === 'reject'     => $ctrl->reject($c1),
            $method === 'PATCH'  && $c1 !== '' && $c2 === 'company'    => $ctrl->setCompany($c1),
            $method === 'PATCH'  && $c1 !== '' && $c2 === 'dc'         => $ctrl->approveDc($c1),
            $method === 'GET'    && $c1 !== '' && $c2 === 'related'    => $ctrl->related($c1),
            $method === 'POST'   && $c1 !== '' && $c2 === 'files' && $c3 === ''  => $ctrl->uploadFile($c1),
            $method === 'GET'    && $c1 !== '' && $c2 === 'files' && $c3 !== ''  => $ctrl->downloadFile($c1, $c3),
            default => sendError("Route /api/trials/$c1/$c2 not found", 404),
        };
    }

    // ── Live alert feed for the site-wide toast + sound (crm-global.js)
    elseif ($c0 === 'alerts-feed') {
        $ctrl = new AlertFeedController();
        match (true) {
            $method === 'GET' && $c1 === '' => $ctrl->feed(),
            $method === 'GET' && $c1 === 'history' => $ctrl->history(),
            default => sendError("Route /api/alerts-feed/$c1 not found", 404),
        };
    }

    // ── Reports for the newer modules (CSV / Excel / PDF) ─────────
    elseif ($c0 === 'reports') {
        $ctrl = new ReportsController();
        match (true) {
            $method === 'GET' && $c1 === 'orders'         => $ctrl->orders(),
            $method === 'GET' && $c1 === 'tasks'          => $ctrl->tasks(),
            $method === 'GET' && $c1 === 'price-requests' => $ctrl->priceRequests(),
            $method === 'GET' && $c1 === 'trials'         => $ctrl->trials(),
            $method === 'GET' && $c1 === 'appointments'   => $ctrl->appointments(),
            $method === 'GET' && $c1 === 'breaks'         => $ctrl->breaks(),
            $method === 'GET' && in_array($c1, ['tracking', 'daily-movement'], true)     => $ctrl->tracking(),
            default => sendError("Route /api/reports/$c1 not found", 404),
        };
    }

    // ── Chat (admin ↔ users) ────────────────────────────────────────
    elseif ($c0 === 'chat') {
        $ctrl = new ChatController();
        match (true) {
            $method === 'GET'  && $c1 === 'users'                => $ctrl->users(),
            $method === 'GET'  && $c1 === 'unread'               => $ctrl->unread(),
            $method === 'GET'  && $c1 === 'thread' && $c2 !== '' => $ctrl->thread($c2),
            $method === 'POST' && $c1 === 'send'                 => $ctrl->send(),
            default => sendError("Route /api/chat/$c1 not found", 404),
        };
    }

    // ── Full data backup (Super Admin) ──────────────────────────────
    elseif ($c0 === 'backup') {
        $ctrl = new BackupController();
        match (true) {
            $method === 'GET'  && $c1 === 'summary' => $ctrl->summary(),
            $method === 'GET'  && $c1 === 'export'  => $ctrl->export(),
            $method === 'POST' && $c1 === 'import'  => $ctrl->import(),
            default => sendError("Route /api/backup/$c1 not found", 404),
        };
    }

    // ── Location history (any day) + breaks / stationary alerts ────
    elseif ($c0 === 'tracking' || $c0 === 'route-log') { // route-log: same routes without the word ad blockers filter
        $ctrl = new LocationHistoryController();
        match (true) {
            $method === 'GET' && $c1 === 'users'   => $ctrl->users(),
            $method === 'GET' && $c1 === 'days'    => $ctrl->days(),
            $method === 'GET' && $c1 === 'history' => $ctrl->history(),
            default => sendError("Route /api/tracking/$c1 not found", 404),
        };
    }
    // ── CPR: opportunity register, Saturday review, weekly / monthly reports ──
    elseif ($c0 === 'cpr') {
        $ctrl = new CprController();
        match (true) {
            $method === 'GET'    && $c1 === 'meta'         => $ctrl->meta(),
            $method === 'GET'    && $c1 === 'review'       => $ctrl->reviewSheet(),
            $method === 'POST'   && $c1 === 'review'       => $ctrl->saveReview(),
            $method === 'GET'    && $c1 === 'review-dates' => $ctrl->reviewDates(),
            $method === 'GET'    && $c1 === 'report'       => $ctrl->report(),
            $method === 'GET'    && $c1 === 'template'     => $ctrl->template(),
            $method === 'POST'   && $c1 === 'import'       => $ctrl->import(),
            $method === 'GET'    && $c1 === ''             => $ctrl->index(),
            $method === 'POST'   && $c1 === ''             => $ctrl->create(),
            $method === 'GET'    && $c1 !== ''             => $ctrl->show($c1),
            $method === 'PUT'    && $c1 !== ''             => $ctrl->update($c1),
            $method === 'DELETE' && $c1 !== ''             => $ctrl->delete($c1),
            default => sendError("Route /api/cpr/$c1 not found", 404),
        };
    }
    elseif ($c0 === 'breaks') {
        $ctrl = new LocationHistoryController();
        match (true) {
            $method === 'GET'  && $c1 === 'today'      => $ctrl->today(),
            $method === 'POST' && $c1 === 'start'      => $ctrl->start(),
            $method === 'POST' && $c1 === 'end'        => $ctrl->end(),
            $method === 'POST' && $c1 === 'stationary' => $ctrl->stationary(),
            default => sendError("Route /api/breaks/$c1 not found", 404),
        };
    }

    // ── Leaves ───────────────────────────────────────────────────
    elseif ($c0 === 'leaves') {
        $ctrl = new LeaveController(); $exp = new ExportController();
        match (true) {
            $method === 'GET'   && $c1 === 'export'  => $exp->exportLeaves(),
            $method === 'GET'   && $c1 === 'summary' => $ctrl->summary(),
            $method === 'DELETE'&& $c1 !== '' && $c2 === '' => $ctrl->withdraw($c1),
            $method === 'GET'   && $c1 === ''        => $ctrl->index(),
            $method === 'POST'  && $c1 === ''        => $ctrl->create(),
            $method === 'PATCH' && $c2 === 'approve' => $ctrl->approve($c1),
            default => sendError("Route /api/leaves/$c1 not found", 404),
        };
    }

    // ── Payroll ──────────────────────────────────────────────────
    elseif ($c0 === 'payroll') {
        $ctrl = new PayrollController();
        match (true) {
            $method === 'GET'   && $c1 === 'stats'          => $ctrl->stats(),
            $method === 'GET'   && $c1 === 'export'         => $ctrl->export(),
            $method === 'GET'   && $c1 === 'payslips'       => $ctrl->payslipsForMonth(),
            $method === 'GET'   && $c1 === 'leave-summary'  => $ctrl->leaveSummaryEndpoint(),
            $method === 'GET'   && $c1 !== '' && $c2 === 'payslip' => $ctrl->payslip($c1),
            $method === 'GET'   && $c1 === ''               => $ctrl->index(),
            $method === 'POST'  && $c1 === ''               => $ctrl->create(),
            $method === 'GET'   && $c1 !== '' && $c2 === '' => $ctrl->show($c1),
            $method === 'PUT'   && $c1 !== '' && $c2 === '' => $ctrl->update($c1),
            $method === 'DELETE'&& $c1 !== '' && $c2 === '' => $ctrl->delete($c1),
            $method === 'PATCH' && $c2 === 'mark-paid'      => $ctrl->markPaid($c1),
            default => sendError("Route /api/payroll/$c1/$c2 not found", 404),
        };
    }

    // ── Salary Advances ──────────────────────────────────────────
    elseif ($c0 === 'salary-advances') {
        $ctrl = new PayrollController();
        match (true) {
            $method === 'GET'   && $c1 === ''         => $ctrl->listAdvances(),
            $method === 'POST'  && $c1 === ''         => $ctrl->createAdvance(),
            $method === 'PATCH' && $c2 === 'cancel'   => $ctrl->cancelAdvance($c1),
            $method === 'GET'   && $c2 === 'pdf'      => $ctrl->advancePdf($c1),
            $method === 'PUT'   && $c2 === 'recovery' => $ctrl->saveRecovery($c1),
            default => sendError("Route /api/salary-advances/$c1/$c2 not found", 404),
        };
    }

    // ── Advance Recovery ─────────────────────────────────────────
    elseif ($c0 === 'advance-recovery') {
        $ctrl = new PayrollController();
        match (true) {
            $method === 'GET' && $c1 === '' => $ctrl->recoveryList(),
            default => sendError("Route /api/advance-recovery/$c1 not found", 404),
        };
    }

    // ── Employee Ledger ──────────────────────────────────────────
    elseif ($c0 === 'employee-ledger') {
        $ctrl = new PayrollController();
        match (true) {
            $method === 'GET' && $c1 !== '' && $c2 === 'pdf'   => $ctrl->employeeLedgerPdf($c1),
            $method === 'GET' && $c1 !== '' && $c2 === 'excel' => $ctrl->employeeLedgerExcel($c1),
            $method === 'GET' && $c1 !== '' && $c2 === ''      => $ctrl->employeeLedger($c1),
            default => sendError("Route /api/employee-ledger/$c1/$c2 not found", 404),
        };
    }

    // ── Dashboard ────────────────────────────────────────────────
    elseif ($c0 === 'dashboard') {
        $ctrl = new DashboardController();
        match (true) {
            $method === 'GET' && $c1 === 'admin'   => $ctrl->admin(),
            $method === 'GET' && $c1 === 'user'    => $ctrl->user(),
            $method === 'GET' && $c1 === 'payroll' => $ctrl->payroll(),
            default => sendError("Route /api/dashboard/$c1 not found", 404),
        };
    }

    // ── Activity ─────────────────────────────────────────────────
    elseif ($c0 === 'activity') {
        $ctrl = new ActivityController(); $exp = new ExportController();
        match (true) {
            $method === 'GET' && $c1 === 'export' => $exp->exportActivity(),
            $method === 'GET' && $c1 === ''       => $ctrl->index(),
            default => sendError("Route /api/activity/$c1 not found", 404),
        };
    }

    // ── Quotations ───────────────────────────────────────────────
    elseif ($c0 === 'quotations') {
        $ctrl = new QuotationController(); $exp = new ExportController();
        match (true) {
            $method === 'GET'   && $c1 === 'stats'                   => $ctrl->stats(),
            $method === 'GET'   && $c1 === 'export'                  => $exp->exportQuotations(),
            $method === 'GET'   && $c1 === ''                        => $ctrl->index(),
            $method === 'POST'  && $c1 === ''                        => $ctrl->create(),
            $method === 'GET'   && $c1 !== '' && $c2 === ''          => $ctrl->show($c1),
            $method === 'PUT'   && $c1 !== '' && $c2 === ''          => $ctrl->update($c1),
            $method === 'DELETE'&& $c1 !== '' && $c2 === ''          => $ctrl->delete($c1),
            $method === 'GET'   && $c2 === 'pdf'                     => $ctrl->generatePdf($c1),
            $method === 'PATCH' && $c2 === 'approve'                 => $ctrl->approve($c1),
            default => sendError("Route /api/quotations/$c1/$c2 not found", 404),
        };
    }

    // ── Categories ───────────────────────────────────────────────
    elseif ($c0 === 'categories') {
        $ctrl = new CategoryController();
        match (true) {
            $method === 'GET'    && $c1 === ''        => $ctrl->index(),
            $method === 'POST'   && $c1 === ''        => $ctrl->create(),
            $method === 'PUT'    && $c1 !== ''        => $ctrl->update($c1),
            $method === 'DELETE' && $c1 !== ''        => $ctrl->delete($c1),
            default => sendError("Route /api/categories/$c1 not found", 404),
        };
    }

    // ── Analytics ────────────────────────────────────────────────
    elseif ($c0 === 'analytics') {
        $ctrl = new AnalyticsController();
        match (true) {
            $method === 'GET' && $c1 === 'overview'     => $ctrl->overview(),
            $method === 'GET' && $c1 === 'monthly'      => $ctrl->monthly(),
            $method === 'GET' && $c1 === 'employee'     => $ctrl->employee(),
            $method === 'GET' && $c1 === 'segmentation' => $ctrl->customerSegmentation(),
            $method === 'GET' && $c1 === 'win-loss'     => $ctrl->winLoss(),
            default => sendError("Route /api/analytics/$c1 not found", 404),
        };
    }

    else {
        sendError("Route /api/$c0 not found", 404);
    }

} catch (Throwable $e) {
    error_log('Unhandled error: ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    $payload = ['success' => false, 'message' => 'Internal server error'];
    // Super Admin / Admin see the underlying error (no trace) so production
    // problems can be diagnosed from the browser; everyone else gets the
    // generic message.
    $who = $GLOBALS['__auth_user'] ?? null;
    if ($who && in_array($who['role'], ['SUPER_ADMIN', 'ADMIN'], true)) {
        $payload['error'] = $e->getMessage();
    }
    if (APP_ENV === 'development') {
        $payload['error'] = $e->getMessage();
        $payload['trace'] = explode("\n", $e->getTraceAsString());
    }
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode($payload);
    exit;
}
