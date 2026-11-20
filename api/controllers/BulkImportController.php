<?php
/**
 * Excel templates + upload for the pages (v11.57).
 *
 *   GET  /api/bulk/:page/template        the page's own Excel template (+ "How to fill" sheet)
 *   POST /api/bulk/:page/import          multipart "file" (.xlsx / .csv); ?save=1 saves, otherwise a preview
 *   GET  /api/bulk                        which pages this person may upload to
 *
 * Pages: vendors, customers, hr (fill in details of existing employees), tasks, appointments,
 * petty-cash, accounts. (Products, Stock, Price requests, Sales report, CPR and vendor price lists
 * keep their own templates.)
 *
 * The upload is checked row by row first: each row shows "new", "update", "no change" or what is
 * wrong with it; nothing is saved until the preview is accepted (?save=1). Columns are found by
 * their heading, in any order; extra columns are ignored.
 */
class BulkImportController
{
    private const MAX_ROWS = 3000;

    // ── column types ────────────────────────────────────────────────────
    private static function norm(string $s): string { return preg_replace('/[^a-z0-9]/', '', strtolower($s)); }

    private static function date($v): ?string
    {
        $v = trim((string) $v);
        if ($v === '') return null;
        if (is_numeric($v) && (float) $v > 20000 && (float) $v < 80000) return gmdate('Y-m-d', (int) round(((float) $v - 25569) * 86400));
        if (preg_match('~^(\d{4})-(\d{1,2})-(\d{1,2})~', $v, $m)) return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]) : null;
        if (preg_match('~^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$~', $v, $m)) {
            $y = (int) $m[3]; if ($y < 100) $y += 2000;
            return checkdate((int) $m[2], (int) $m[1], $y) ? sprintf('%04d-%02d-%02d', $y, $m[2], $m[1]) : null;
        }
        if (preg_match('~^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})$~', $v, $m)) { $t = strtotime("$m[1] $m[2] " . ((int) $m[3] < 100 ? 2000 + (int) $m[3] : $m[3])); return $t ? date('Y-m-d', $t) : null; }
        return null;
    }

    private static $users = null, $customers = null;
    private static function userId(string $v): ?string
    {
        if (self::$users === null) {
            self::$users = [];
            foreach (db()->query('SELECT id, name, email, employeeCode FROM `User` WHERE isActive=1')->fetchAll() as $u) {
                foreach ([$u['email'], $u['employeeCode'], $u['name']] as $k) if ($k) self::$users[mb_strtolower(trim($k))] ??= $u['id'];
            }
        }
        return self::$users[mb_strtolower(trim($v))] ?? null;
    }
    private static function customerId(string $v): ?string
    {
        if (self::$customers === null) {
            self::$customers = [];
            foreach (db()->query('SELECT id, companyName FROM `Customer` WHERE isActive=1')->fetchAll() as $c) self::$customers[mb_strtolower(trim($c['companyName']))] ??= $c['id'];
        }
        return self::$customers[mb_strtolower(trim($v))] ?? null;
    }

    /** Cell → value, or [null, 'error message']. */
    private static function value(array $col, $raw): array
    {
        $t = $col[3] ?? 'text';
        $s = trim(str_replace(["\r", "\u{00A0}"], ['', ' '], (string) ($raw ?? '')));
        if ($s === '') return [null, null];
        switch ($t) {
            case 'email':
                $s = strtolower($s);
                return filter_var($s, FILTER_VALIDATE_EMAIL) ? [$s, null] : [null, 'not an e-mail address'];
            case 'phone':
                $s = preg_replace('/\.0+$/', '', $s); // Excel number 9876543210.0
                return preg_match('/^[+\d][\d\s\-\/()]{5,40}$/', $s) ? [$s, null] : [null, 'not a phone number'];
            case 'gstin':
                $s = strtoupper(preg_replace('/\s+/', '', $s));
                return preg_match('/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/', $s) ? [$s, null] : [null, 'GSTIN must look like 33ABCDE1234F1Z5'];
            case 'date':
                $d = self::date($s);
                return $d ? [$d, null] : [null, 'not a date (use 25-11-2026)'];
            case 'number':
                $n = str_replace([',', '₹', ' ', '%'], '', $s);
                return is_numeric($n) ? [round((float) $n, 2), null] : [null, 'not a number'];
            case 'enum':
                foreach ($col['options'] as $val => $label) {
                    if (self::norm($s) === self::norm((string) $val) || self::norm($s) === self::norm((string) $label)) return [$val, null];
                    foreach ((array) ($col['also'][$val] ?? []) as $a) if (self::norm($s) === self::norm($a)) return [$val, null];
                }
                return [null, 'use one of: ' . implode(', ', array_values($col['options']))];
            case 'user':
                $id = self::userId($s);
                return $id ? [$id, null] : [null, "no active user \"$s\" (use the e-mail, employee ID or exact name)"];
            case 'customer':
                $id = self::customerId($s);
                return $id ? [$id, null] : [null, "no customer \"$s\" (exact name as on the Customers page)"];
            case 'time':
                if (is_numeric($s) && (float) $s < 1) { $m = (int) round((float) $s * 1440); return [sprintf('%02d:%02d', intdiv($m, 60), $m % 60), null]; }
                if (!preg_match('/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i', $s, $m)) return [null, 'time like 10:30 or 2:15 pm'];
                $h = (int) $m[1];
                if (!empty($m[3])) $h = $h % 12 + (strtolower($m[3]) === 'pm' ? 12 : 0);
                return $h < 24 && (int) $m[2] < 60 ? [sprintf('%02d:%02d', $h, $m[2]), null] : [null, 'time like 10:30 or 2:15 pm'];
            default:
                return [mb_substr($s, 0, $col['max'] ?? 255), null];
        }
    }

    // ── the pages ───────────────────────────────────────────────────────
    private static function pages(): array
    {
        $adminTier = fn($a) => is_admin_tier($a['role']);
        return [
            'vendors' => [
                'title' => 'Vendors', 'file' => 'vendors-template.xlsx', 'can' => $adminTier,
                'help' => 'One row per vendor (supplier). A vendor whose name is already on the Vendors page is updated; blank cells keep what is there. Price lists are uploaded per vendor (open the vendor → Upload).',
                'cols' => [
                    ['name', 'Vendor name', 1, 'text', 'Sandvik Dealer Coimbatore', 'max' => 200],
                    ['brands', 'Brands', 0, 'text', 'Sandvik, Taegutec', 'Several brands: separate with commas'],
                    ['contactPerson', 'Contact person', 0, 'text', 'Mr. Kumar', 'max' => 150],
                    ['phone', 'Phone', 0, 'phone', '9876543210'],
                    ['email', 'E-mail', 0, 'email', 'sales@vendor.com'],
                    ['gstin', 'GSTIN', 0, 'gstin', '33ABCDE1234F1Z5'],
                    ['city', 'City', 0, 'text', 'Coimbatore', 'max' => 100],
                    ['address', 'Address', 0, 'text', '12, Avinashi Road', 'max' => 1000],
                    ['notes', 'Notes', 0, 'text', 'Credit 30 days', 'max' => 2000],
                ],
                'find' => function (array $v) { $s = db()->prepare('SELECT * FROM `Vendor` WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1'); $s->execute([$v['name']]); return $s->fetch() ?: null; },
                'table' => 'Vendor', 'extra' => fn($a) => ['isActive' => 1, 'createdById' => $a['id']],
            ],
            'customers' => [
                'title' => 'Customers', 'file' => 'customers-template.xlsx', 'can' => fn($a) => true,
                'help' => 'One row per customer company. A company already on the Customers page (same name) is updated; blank cells keep what is there. Sales engineers can only update customers they added. The map location is set on the Customer map / first visit.',
                'cols' => [
                    ['companyName', 'Company name', 1, 'text', 'Velavan Industries', 'max' => 200],
                    ['contactPerson', 'Contact person', 1, 'text', 'Mr. Lathip Raja', 'max' => 150],
                    ['contactNumber', 'Contact number', 1, 'phone', '9876543210'],
                    ['designation', 'Designation', 0, 'text', 'Purchase Manager', 'max' => 120],
                    ['email', 'E-mail', 0, 'email', 'purchase@velavan.com'],
                    ['gstin', 'GSTIN', 0, 'gstin', '33ABCDE1234F1Z5'],
                    ['location', 'City / area', 0, 'text', 'Coimbatore', 'max' => 150],
                    ['address', 'Address', 0, 'text', 'SIDCO, Kurichi', 'max' => 1000],
                    ['category', 'Category', 0, 'text', 'A', 'max' => 60, 'e.g. A / B / C or OEM / Dealer'],
                    ['industryType', 'Industry', 0, 'text', 'Automotive', 'max' => 120],
                    ['machineDetails', 'Machines', 0, 'text', '2 VMC, 1 CNC lathe', 'max' => 2000],
                    ['remarks', 'Remarks', 0, 'text', '', 'max' => 2000],
                    ['createdById', 'Sales engineer', 0, 'user', 'raj@tms.com', 'E-mail, employee ID or name of the engineer who owns the customer (admins only; blank = you)'],
                ],
                'find' => function (array $v) { $s = db()->prepare('SELECT * FROM `Customer` WHERE isActive=1 AND LOWER(TRIM(companyName))=LOWER(TRIM(?)) LIMIT 1'); $s->execute([$v['companyName']]); return $s->fetch() ?: null; },
                'table' => 'Customer', 'extra' => fn($a) => ['isActive' => 1, 'createdById' => $a['id'], 'geoFenceRadius' => 200],
                'check' => function (array $v, ?array $old, array $a) {
                    $admin = is_admin_tier($a['role']);
                    if (!$admin && $old && $old['createdById'] !== $a['id']) return 'this customer belongs to another engineer — ask an admin';
                    if (!$admin && !empty($v['createdById']) && $v['createdById'] !== $a['id']) return 'only admins can give a customer to another engineer';
                    return null;
                },
            ],
            'hr' => [
                'title' => 'HR — employee details', 'file' => 'hr-employee-details-template.xlsx', 'can' => fn($a) => in_array($a['role'], ['SUPER_ADMIN', 'ADMIN'], true), 'updateOnly' => true,
                'help' => 'Fills in the details of employees who already have a login (match by Employee ID or login e-mail). Blank cells keep what is there. New employees are added with "+ New employee" on the HR page (their documents are required).',
                'cols' => [
                    ['employeeCode', 'Employee ID', 0, 'text', 'TMS-024', 'Employee ID or Login e-mail is needed to find the person', 'max' => 40],
                    ['email', 'Login e-mail', 0, 'email', 'priya@tms.com', 'used only to find the person, not changed'],
                    ['designation', 'Designation', 0, 'text', 'Sales Executive', 'max' => 120],
                    ['department', 'Department', 0, 'text', 'Sales', 'max' => 120],
                    ['phone', 'Mobile', 0, 'phone', '9876512345'],
                    ['dateOfJoining', 'Date of joining', 0, 'date', '01-04-2024'],
                    ['dateOfBirth', 'Date of birth', 0, 'date', '02-04-1998'],
                    ['gender', 'Gender', 0, 'enum', 'Female', 'options' => ['Male' => 'Male', 'Female' => 'Female', 'Other' => 'Other']],
                    ['bloodGroup', 'Blood group', 0, 'text', 'O+', 'max' => 5],
                    ['fatherName', "Father's name", 0, 'text', 'Ravi', 'max' => 150],
                    ['personalEmail', 'Personal e-mail', 0, 'email', 'priya@gmail.com'],
                    ['permanentAddress', 'Permanent address', 0, 'text', '12 Gandhi St', 'max' => 1000],
                    ['permanentCity', 'City', 0, 'text', 'Coimbatore', 'max' => 100],
                    ['permanentState', 'State', 0, 'text', 'Tamil Nadu', 'max' => 100],
                    ['permanentPincode', 'Pincode', 0, 'text', '641001', 'max' => 12],
                    ['emergencyContactName', 'Emergency contact', 0, 'text', 'Ravi', 'max' => 150],
                    ['emergencyContactPhone', 'Emergency phone', 0, 'phone', '9876500000'],
                    ['aadharNumber', 'Aadhaar number', 0, 'text', '123456789012', 'max' => 20],
                    ['panNumber', 'PAN', 0, 'text', 'ABCDE1234F', 'max' => 20],
                    ['bankName', 'Bank name', 0, 'text', 'SBI', 'max' => 150],
                    ['bankAccountNumber', 'Account number', 0, 'text', '12345678901', 'max' => 40],
                    ['bankIFSC', 'IFSC', 0, 'text', 'SBIN0001234', 'max' => 20],
                    ['uanNumber', 'UAN', 0, 'text', '', 'max' => 30],
                    ['pfNumber', 'PF number', 0, 'text', '', 'max' => 40],
                    ['esiNumber', 'ESI number', 0, 'text', '', 'max' => 40],
                ],
                'find' => function (array $v) {
                    if (!empty($v['employeeCode'])) { $s = db()->prepare('SELECT * FROM `User` WHERE UPPER(employeeCode)=UPPER(?) LIMIT 1'); $s->execute([$v['employeeCode']]); if ($r = $s->fetch()) return $r; }
                    if (!empty($v['email'])) { $s = db()->prepare('SELECT * FROM `User` WHERE email=? LIMIT 1'); $s->execute([$v['email']]); if ($r = $s->fetch()) return $r; }
                    return null;
                },
                'table' => 'User', 'readonly' => ['email', 'employeeCode'],
                'check' => function (array $v, ?array $old, array $a) {
                    if (empty($v['employeeCode']) && empty($v['email'])) return 'Employee ID or Login e-mail is needed';
                    if (!$old) return 'no employee with this Employee ID / e-mail — add new employees with "+ New employee"';
                    if ($old['role'] === 'SUPER_ADMIN' && $a['role'] !== 'SUPER_ADMIN') return 'only the Super Admin can change this person';
                    if (!empty($v['aadharNumber'])) { $d = preg_replace('/\s+/', '', $v['aadharNumber']); if (!preg_match('/^\d{12}$/', $d)) return 'Aadhaar number must be 12 digits'; }
                    if (!empty($v['panNumber']) && !preg_match('/^[A-Z]{5}\d{4}[A-Z]$/', strtoupper($v['panNumber']))) return 'PAN must look like ABCDE1234F';
                    if (!empty($v['bankIFSC']) && !preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', strtoupper($v['bankIFSC']))) return 'IFSC must look like SBIN0001234';
                    return null;
                },
                'tidy' => function (array $v) {
                    if (!empty($v['aadharNumber'])) $v['aadharNumber'] = preg_replace('/\s+/', '', $v['aadharNumber']);
                    foreach (['panNumber', 'bankIFSC'] as $k) if (!empty($v[$k])) $v[$k] = strtoupper($v[$k]);
                    return $v;
                },
            ],
            'tasks' => [
                'title' => 'Tasks', 'file' => 'tasks-template.xlsx', 'can' => fn($a) => true, 'createOnly' => true,
                'help' => 'One row per task. Every row is added as a new task in the person\'s queue. Only Admins can give tasks to other people; others can add tasks for themselves.',
                'cols' => [
                    ['title', 'Task', 1, 'text', 'Send quotation to Velavan', 'max' => 255],
                    ['assignedToId', 'Assigned to', 1, 'user', 'raj@tms.com', 'E-mail, employee ID or name'],
                    ['description', 'Details', 0, 'text', 'ZECHA end mills, 6 Nos', 'max' => 4000],
                    ['priority', 'Priority', 0, 'enum', 'Normal', 'options' => ['LOW' => 'Low', 'NORMAL' => 'Normal', 'HIGH' => 'High', 'URGENT' => 'Urgent']],
                    ['dueDate', 'Due date', 0, 'date', '25-11-2026'],
                    ['customerId', 'Customer', 0, 'customer', 'Velavan Industries', 'Exact customer name (optional)'],
                ],
                'table' => 'AdminTask',
                'check' => function (array $v, ?array $old, array $a) {
                    if ($v['assignedToId'] !== $a['id'] && !in_array($a['role'], ['SUPER_ADMIN', 'ADMIN'], true)) return 'only Admins can give tasks to other people';
                    return null;
                },
                'extra' => fn($a) => ['assignedById' => $a['id'], 'status' => 'QUEUED'],
                'before' => function (array &$row, array $a) {
                    $row['priority'] = $row['priority'] ?? 'NORMAL';
                    $s = db()->prepare("SELECT COALESCE(MAX(queuePosition),0)+1 FROM `AdminTask` WHERE assignedToId=? AND status IN ('QUEUED','IN_PROGRESS','PAUSED')");
                    $s->execute([$row['assignedToId']]); $row['queuePosition'] = (int) $s->fetchColumn();
                },
            ],
            'appointments' => [
                'title' => 'Appointments', 'file' => 'appointments-template.xlsx', 'can' => fn($a) => true, 'createOnly' => true,
                'help' => 'One row per appointment (customer visit planned for a day). Only Admins / Managers can plan for other people.',
                'cols' => [
                    ['customerId', 'Customer', 1, 'customer', 'Velavan Industries', 'Exact customer name as on the Customers page'],
                    ['appointmentDate', 'Date', 1, 'date', '25-11-2026'],
                    ['appointmentTime', 'Time', 0, 'time', '10:30'],
                    ['title', 'Purpose', 1, 'text', 'Trial of ZECHA end mills', 'max' => 255],
                    ['assignedToId', 'Engineer', 0, 'user', 'raj@tms.com', 'blank = you'],
                    ['notes', 'Notes', 0, 'text', '', 'max' => 4000],
                ],
                'table' => 'Appointment',
                'extra' => fn($a) => ['userId' => $a['id'], 'assignedToId' => $a['id'], 'status' => 'SCHEDULED'],
                'check' => function (array $v, ?array $old, array $a) {
                    if (!empty($v['assignedToId']) && $v['assignedToId'] !== $a['id'] && !is_admin_tier($a['role'])) return 'only Admins / Managers can plan for other people';
                    return null;
                },
            ],
            'petty-cash' => [
                'title' => 'Petty cash', 'file' => 'petty-cash-template.xlsx', 'createOnly' => true,
                'can' => function ($a) { return class_exists('PageAccess') ? PageAccess::levelFor($a, 'petty-cash') !== 'hidden' && PageAccess::levelFor($a, 'petty-cash') !== 'view' : is_admin_tier($a['role']); },
                'help' => 'One row per cash entry. Type: Spent (money paid out) or Received (cash put in). Bills can be attached on the Petty cash page afterwards.',
                'cols' => [
                    ['entryDate', 'Date', 1, 'date', '20-11-2026'],
                    ['type', 'Type', 1, 'enum', 'Spent', 'options' => ['OUT' => 'Spent', 'IN' => 'Received'], 'also' => ['OUT' => ['out', 'expense', 'paid'], 'IN' => ['in', 'receipt', 'cash in']]],
                    ['amount', 'Amount', 1, 'number', '450'],
                    ['description', 'Description', 1, 'text', 'Courier to Velavan', 'max' => 500],
                    ['category', 'Category', 0, 'text', 'Courier & postage', 'max' => 80],
                    ['paidTo', 'Paid to / from', 0, 'text', 'Professional Couriers', 'max' => 160],
                    ['billNo', 'Bill no.', 0, 'text', 'PC-2231', 'max' => 80],
                    ['mode', 'Mode', 0, 'enum', 'Cash', 'options' => ['CASH' => 'Cash', 'UPI' => 'UPI', 'CARD' => 'Card', 'BANK' => 'Bank']],
                ],
                'table' => 'PettyCash',
                'check' => function (array $v) { if (isset($v['amount']) && $v['amount'] <= 0) return 'amount must be more than 0'; if (($v['entryDate'] ?? '') > date('Y-m-d')) return 'the date is in the future'; return null; },
                'before' => function (array &$row) { $row['mode'] = $row['mode'] ?? 'CASH'; if ($row['type'] === 'OUT' && empty($row['category'])) $row['category'] = 'Other'; },
                'extra' => fn($a) => ['createdById' => $a['id']],
            ],
            'accounts' => [
                'title' => 'Accounts entries', 'file' => 'accounts-entries-template.xlsx', 'createOnly' => true,
                'can' => fn($a) => in_array($a['role'], ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTS'], true),
                'help' => 'One row per entry: Invoice (to a customer), Receipt (money received), Vendor bill, Vendor payment or Voucher. For invoices / bills give Taxable + GST % (the total is worked out) or the Total. Receipts / payments are matched to an invoice / bill when "Against no." is filled.',
                'cols' => [
                    ['kind', 'Type', 1, 'enum', 'Invoice', 'options' => ['INVOICE' => 'Invoice', 'RECEIPT' => 'Receipt', 'BILL' => 'Vendor bill', 'PAYMENT' => 'Vendor payment', 'VOUCHER' => 'Voucher'], 'also' => ['BILL' => ['bill', 'purchase'], 'PAYMENT' => ['payment', 'paid']]],
                    ['company', 'Company', 0, 'enum', 'TMS', 'options' => ['TMS' => 'TMS', 'APJ' => 'APJ']],
                    ['docNo', 'Number', 0, 'text', 'TMS/2026-27/0154', 'Invoice / bill / receipt no.', 'max' => 80],
                    ['docDate', 'Date', 1, 'date', '20-11-2026'],
                    ['partyName', 'Party', 1, 'text', 'Velavan Industries', 'Customer or vendor name', 'max' => 255],
                    ['partyGstin', 'GSTIN', 0, 'gstin', ''],
                    ['taxable', 'Taxable', 0, 'number', '34010'],
                    ['gstPercent', 'GST %', 0, 'number', '18'],
                    ['amount', 'Total', 0, 'number', '', 'Total with GST; for receipts / payments the amount'],
                    ['dueDate', 'Due date', 0, 'date', '20-12-2026'],
                    ['linkNo', 'Against no.', 0, 'text', '', 'For a receipt: the invoice no.; for a payment: the vendor bill no.', 'max' => 80],
                    ['mode', 'Mode', 0, 'enum', 'NEFT', 'options' => ['NEFT' => 'NEFT', 'RTGS' => 'RTGS', 'IMPS' => 'IMPS', 'UPI' => 'UPI', 'CHEQUE' => 'Cheque', 'CASH' => 'Cash', 'CARD' => 'Card', 'OTHER' => 'Other']],
                    ['reference', 'UTR / cheque no.', 0, 'text', '', 'max' => 120],
                    ['notes', 'Notes', 0, 'text', '', 'max' => 2000],
                ],
                'table' => 'AccEntry',
                'check' => function (array $v) {
                    $big = in_array($v['kind'], ['INVOICE', 'BILL'], true);
                    if ($big && empty($v['docNo'])) return 'the invoice / bill number is needed';
                    if ($big && !isset($v['taxable']) && !isset($v['amount'])) return 'give Taxable (+ GST %) or the Total';
                    if (!$big && !isset($v['amount'])) return 'give the amount (Total)';
                    if ($big) {
                        $s = db()->prepare('SELECT id FROM `AccEntry` WHERE kind=? AND LOWER(TRIM(docNo))=LOWER(TRIM(?)) AND LOWER(TRIM(partyName))=LOWER(TRIM(?)) LIMIT 1');
                        $s->execute([$v['kind'], $v['docNo'], $v['partyName']]);
                        if ($s->fetch()) return 'already in Accounts (' . $v['docNo'] . ')';
                    }
                    if (!empty($v['linkNo'])) {
                        $s = db()->prepare('SELECT id FROM `AccEntry` WHERE kind=? AND LOWER(TRIM(docNo))=LOWER(TRIM(?)) LIMIT 1');
                        $s->execute([$v['kind'] === 'PAYMENT' ? 'BILL' : 'INVOICE', $v['linkNo']]);
                        if (!$s->fetch()) return 'no ' . ($v['kind'] === 'PAYMENT' ? 'vendor bill' : 'invoice') . ' "' . $v['linkNo'] . '" in Accounts';
                    }
                    return null;
                },
                'before' => function (array &$row) {
                    $row['company'] = $row['company'] ?? 'TMS';
                    if (isset($row['taxable'])) {
                        $p = $row['gstPercent'] ?? 18.0; $row['gstPercent'] = $p;
                        $row['gstAmount'] = round($row['taxable'] * $p / 100, 2);
                        if (!isset($row['amount'])) $row['amount'] = round($row['taxable'] + $row['gstAmount'], 2);
                    }
                    if (!empty($row['linkNo'])) {
                        $s = db()->prepare('SELECT id FROM `AccEntry` WHERE kind=? AND LOWER(TRIM(docNo))=LOWER(TRIM(?)) LIMIT 1');
                        $s->execute([$row['kind'] === 'PAYMENT' ? 'BILL' : 'INVOICE', $row['linkNo']]);
                        $row['linkId'] = $s->fetchColumn() ?: null;
                    }
                    unset($row['linkNo']);
                    if (in_array($row['kind'], ['INVOICE', 'BILL'], true) && empty($row['dueDate'])) $row['dueDate'] = date('Y-m-d', strtotime($row['docDate'] . ' +30 days'));
                },
                'extra' => fn($a) => ['createdById' => $a['id'], 'tallyStatus' => 'PENDING'],
            ],
        ];
    }

    private static function page(string $key, array $auth): array
    {
        $p = self::pages()[$key] ?? null;
        if (!$p) sendError('No Excel upload for this page.', 404);
        if (!($p['can'])($auth)) sendError('You cannot upload ' . strtolower($p['title']) . '.', 403);
        // make sure the tables / columns exist (they are created by the page's own controller)
        try {
            match ($key) {
                'vendors' => new VendorController(), 'accounts' => new AccountsController(), 'petty-cash' => new PettyCashController(),
                'tasks' => new TaskController(), 'appointments' => new AppointmentController(), default => null,
            };
        } catch (Throwable $e) { /* page tables are created on first use */ }
        return $p;
    }

    // GET /api/bulk
    public function index(): void
    {
        $a = authenticate();
        $out = [];
        foreach (self::pages() as $k => $p) if (($p['can'])($a)) $out[$k] = $p['title'];
        sendSuccess(['pages' => $out]);
    }

    // GET /api/bulk/:page/template
    public function template(string $key): void
    {
        $a = authenticate();
        $p = self::page($key, $a);
        $wb = new StyledXlsxWriter();
        $sh = $wb->addSheet($p['title'] === 'HR — employee details' ? 'Employees' : $p['title']);
        $wb->setWidths($sh, array_map(fn($c) => max(14, min(36, mb_strlen($c[1]) + 6, mb_strlen((string) ($c[4] ?? '')) + 4)), $p['cols']));
        $wb->addRow($sh, array_map(fn($c) => $c[1] . ($c[2] ? ' *' : ''), $p['cols']), 'header', 30);
        $wb->freeze($sh, 1);
        $hs = $wb->addSheet('How to fill');
        $wb->setWidths($hs, [26, 12, 34, 70]);
        $wb->addRow($hs, [$p['title'] . ' — how to fill'], 'header');
        $wb->addRow($hs, [$p['help']]);
        $wb->addRow($hs, ['Fill the first sheet: one row per line, from row 2. Columns marked * must be filled. Keep the heading row; extra columns are ignored.']);
        $wb->addRow($hs, ['']);
        $wb->addRow($hs, ['Column', 'Required', 'Example', 'What to write'], 'header');
        foreach ($p['cols'] as $c) {
            $t = $c[3];
            $how = $c[5] ?? '';
            if (is_array($how)) $how = '';
            $fmt = match ($t) {
                'date' => 'Date: 25-11-2026 (or an Excel date)', 'time' => 'Time: 10:30 or 2:15 pm', 'number' => 'Number', 'email' => 'E-mail address',
                'phone' => 'Phone number', 'gstin' => 'GSTIN (15 characters)', 'user' => 'E-mail, employee ID or name of a CRM user', 'customer' => 'Customer name exactly as on the Customers page',
                'enum' => 'One of: ' . implode(' / ', array_values($c['options'])), default => 'Text',
            };
            $wb->addRow($hs, [$c[1], $c[2] ? 'Yes' : '', (string) ($c[4] ?? ''), trim($fmt . ($how && is_string($how) ? ' — ' . $how : ''))]);
        }
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . $p['file'] . '"');
        echo $wb->output(); exit;
    }

    /** First sheet (or CSV) → rows of cells. */
    private static function readRows(array $f): array
    {
        $name = strtolower((string) ($f['name'] ?? ''));
        if (str_ends_with($name, '.csv')) {
            $rows = [];
            if (($fh = fopen($f['tmp_name'], 'r')) !== false) { while (($r = fgetcsv($fh)) !== false) $rows[] = $r; fclose($fh); }
            if ($rows && isset($rows[0][0])) $rows[0][0] = preg_replace('/^\xEF\xBB\xBF/', '', (string) $rows[0][0]);
            return $rows;
        }
        if (!str_ends_with($name, '.xlsx')) sendError('Upload the filled template as .xlsx (or .csv).', 400);
        try { return XlsxReader::readFirstSheetRows($f['tmp_name']); }
        catch (Throwable $e) { sendError('Could not read the Excel file: ' . $e->getMessage(), 400); }
        return [];
    }

    // POST /api/bulk/:page/import[?save=1]
    public function import(string $key): void
    {
        $a = authenticate();
        $p = self::page($key, $a);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('Choose the filled Excel file.', 400);
        $rows = self::readRows($f);
        // heading row: the first of the first 10 rows that names the most columns
        $best = -1; $hdr = null; $map = [];
        foreach (array_slice($rows, 0, 10, true) as $i => $r) {
            $m = [];
            foreach ((array) $r as $ci => $cell) {
                $n = self::norm((string) $cell);
                if ($n === '') continue;
                foreach ($p['cols'] as $c) if (!isset($m[$c[0]]) && $n === self::norm($c[1])) $m[$c[0]] = $ci;
            }
            if (count($m) > $best) { $best = count($m); $hdr = $i; $map = $m; }
        }
        $missing = array_values(array_map(fn($c) => $c[1], array_filter($p['cols'], fn($c) => $c[2] && !isset($map[$c[0]]))));
        if ($best < 1) sendError('This is not the ' . $p['title'] . ' template — no heading row with ' . implode(', ', array_map(fn($c) => '"' . $c[1] . '"', array_slice(array_values(array_filter($p['cols'], fn($c) => $c[2])) ?: $p['cols'], 0, 3))) . ' was found. Download the template and fill that.', 400);
        if ($missing) sendError('These columns are missing in the heading row: ' . implode(', ', $missing) . '.', 400);
        $save = (bool) qp('save');
        $out = []; $counts = ['new' => 0, 'update' => 0, 'same' => 0, 'error' => 0];
        $data = array_slice($rows, $hdr + 1, null, true);
        if (count($data) > self::MAX_ROWS) sendError('Up to ' . self::MAX_ROWS . ' rows at a time.', 400);
        $seen = [];
        $pdo = db();
        if ($save) $pdo->beginTransaction();
        try {
            foreach ($data as $i => $r) {
                $line = $i + 1;
                $cells = [];
                foreach ($map as $k => $ci) $cells[$k] = $r[$ci] ?? '';
                if (implode('', array_map(fn($x) => trim((string) $x), $cells)) === '') continue;
                $v = []; $errs = [];
                foreach ($p['cols'] as $c) {
                    if (!isset($map[$c[0]])) continue;
                    [$val, $err] = self::value($c, $cells[$c[0]]);
                    if ($err) $errs[] = $c[1] . ': ' . $err;
                    elseif ($val !== null) $v[$c[0]] = $val;
                    elseif ($c[2]) $errs[] = $c[1] . ' is required';
                }
                if (isset($p['tidy'])) $v = ($p['tidy'])($v);
                $old = (!$errs && isset($p['find'])) ? ($p['find'])($v) : null;
                if (!$errs && isset($p['check']) && ($e = ($p['check'])($v, $old, $a))) $errs[] = $e;
                if (!$errs && !empty($p['updateOnly']) && !$old) $errs[] = 'not found';
                $label = (string) ($v[$p['cols'][0][0]] ?? $cells[$p['cols'][0][0]] ?? '');
                if (!$errs && isset($p['find'])) {
                    $dk = mb_strtolower(json_encode($old ? $old['id'] : $label));
                    if (isset($seen[$dk])) $errs[] = 'the same ' . strtolower($p['cols'][0][1]) . ' is also on row ' . $seen[$dk];
                    $seen[$dk] = $line;
                }
                if ($errs) { $counts['error']++; $out[] = ['row' => $line, 'action' => 'error', 'label' => $label, 'errors' => $errs]; continue; }
                $ro = $p['readonly'] ?? [];
                if ($old) {
                    $chg = [];
                    foreach ($v as $k => $val) {
                        if (in_array($k, $ro, true)) continue;
                        $o = (string) ($old[$k] ?? '');
                        if ($k === $p['cols'][0][0] && mb_strtolower(trim($o)) === mb_strtolower(trim((string) $val))) continue; // the name it was found by
                        if ($o === (string) $val || (is_float($val) && is_numeric($o) && abs((float) $o - $val) < 0.005) || ($o !== '' && preg_match('/^\d{4}-\d\d-\d\d$/', (string) $val) && str_starts_with($o, (string) $val))) continue;
                        $chg[$k] = $val;
                    }
                    if (!$chg) { $counts['same']++; $out[] = ['row' => $line, 'action' => 'same', 'label' => $label]; continue; }
                    $counts['update']++;
                    $out[] = ['row' => $line, 'action' => 'update', 'label' => $label, 'changes' => array_map(fn($k) => self::colLabel($p, $k), array_keys($chg))];
                    if ($save) {
                        $sets = implode(',', array_map(fn($k) => "`$k`=?", array_keys($chg)));
                        $pdo->prepare("UPDATE `{$p['table']}` SET $sets, updatedAt=? WHERE id=?")->execute(array_merge(array_values($chg), [now_sql(), $old['id']]));
                    }
                } else {
                    $counts['new']++;
                    $out[] = ['row' => $line, 'action' => 'new', 'label' => $label];
                    if ($save) {
                        $row = array_merge(isset($p['extra']) ? ($p['extra'])($a) : [], array_diff_key($v, array_flip($ro)));
                        if ($key === 'customers' && empty($v['createdById'])) $row['createdById'] = $a['id'];
                        if (isset($p['before'])) ($p['before'])($row, $a);
                        $row = ['id' => gen_id()] + $row + ['createdAt' => now_sql(), 'updatedAt' => now_sql()];
                        $cols = array_keys($row);
                        $pdo->prepare("INSERT INTO `{$p['table']}` (" . implode(',', array_map(fn($k) => "`$k`", $cols)) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')')->execute(array_values($row));
                    }
                }
            }
            if ($save) {
                if ($counts['error']) { $pdo->rollBack(); sendError('Fix the rows with problems first — nothing was saved.', 400, ['rows' => $out, 'counts' => $counts]); }
                $pdo->commit();
                log_activity($a['id'], 'BULK_IMPORT', $p['table'], null, ['page' => $key, 'new' => $counts['new'], 'updated' => $counts['update']]);
            }
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($e instanceof PDOException) sendError('Could not save: ' . $e->getMessage(), 500);
            throw $e;
        }
        sendSuccess(['rows' => $out, 'counts' => $counts, 'saved' => $save, 'title' => $p['title']],
            $save ? ($counts['new'] . ' added, ' . $counts['update'] . ' updated') : 'Checked — nothing saved yet');
    }

    private static function colLabel(array $p, string $k): string
    {
        foreach ($p['cols'] as $c) if ($c[0] === $k) return $c[1];
        return $k;
    }
}
