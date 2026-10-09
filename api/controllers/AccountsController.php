<?php
/**
 * Accounts — for the accounts team (role ACCOUNTS) plus Super Admin / Admin.
 *
 * One ledger table (AccEntry) holds every kind of entry, so they all share
 * Tally posting, bill-copy upload and Excel export:
 *   INVOICE  sales invoice to a customer (taxable + GST = total, due date)
 *   RECEIPT  money received from a customer (optionally against an invoice)
 *   BILL     purchase bill from a vendor (taxable + GST = total, due date)
 *   PAYMENT  money paid to a vendor (optionally against a bill)
 *   VOUCHER  any other Tally voucher (journal, contra, credit / debit note, expense)
 *
 * Invoices and bills get paid / balance / status (PAID, PARTIAL, UNPAID,
 * OVERDUE) from the receipts / payments linked to them. "Tally works" is
 * every entry with tallyStatus PENDING — mark it POSTED with the Tally
 * voucher number once it is entered in Tally.
 *
 *   GET    /api/accounts/summary
 *   GET    /api/accounts/entries?kind=&status=&q=&from=&to=
 *   POST   /api/accounts/entries                PUT / DELETE /api/accounts/entries/:id
 *   PATCH  /api/accounts/entries/:id/tally      { status: POSTED|PENDING, voucherNo }
 *   POST   /api/accounts/entries/:id/file       multipart "file" (bill / invoice copy)
 *   GET    /api/accounts/entries/:id/file
 *   GET    /api/accounts/tally?status=PENDING|POSTED|ALL
 *   GET    /api/accounts/parties?type=customer|vendor&q=
 *   GET    /api/accounts/orders?q=              recent orders, to start an invoice from
 *   GET    /api/accounts/claims?month=&year=    staff fuel claims to pay
 *   GET    /api/accounts/export?kind=INVOICE|RECEIPT|BILL|PAYMENT|VOUCHER|TALLY|OUTSTANDING
 */
class AccountsController
{
    public const ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTS'];
    public const KINDS = ['INVOICE' => 'Invoice', 'RECEIPT' => 'Receipt', 'BILL' => 'Vendor bill', 'PAYMENT' => 'Vendor payment', 'VOUCHER' => 'Voucher'];
    public const MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER'];
    public const VOUCHER_TYPES = ['Journal', 'Contra', 'Credit Note', 'Debit Note', 'Expense', 'Salary', 'Other'];
    // Tally voucher type for each kind (used in the Tally list and export).
    private const TALLY_TYPE = ['INVOICE' => 'Sales', 'RECEIPT' => 'Receipt', 'BILL' => 'Purchase', 'PAYMENT' => 'Payment'];

    public static function schema(): array
    {
        return ['AccEntry' => ['create' => "CREATE TABLE IF NOT EXISTS `AccEntry` (
  `id` VARCHAR(30) NOT NULL, `kind` VARCHAR(10) NOT NULL, `company` VARCHAR(10) NOT NULL DEFAULT 'TMS',
  `docNo` VARCHAR(80) NULL, `docDate` DATE NOT NULL, `partyId` VARCHAR(30) NULL, `partyName` VARCHAR(255) NULL, `partyGstin` VARCHAR(30) NULL,
  `linkId` VARCHAR(30) NULL, `orderId` VARCHAR(30) NULL, `orderRef` VARCHAR(80) NULL, `poRef` VARCHAR(120) NULL,
  `taxable` DECIMAL(14,2) NULL, `gstPercent` DECIMAL(5,2) NULL, `gstAmount` DECIMAL(14,2) NULL, `amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `dueDate` DATE NULL, `mode` VARCHAR(12) NULL, `reference` VARCHAR(120) NULL, `voucherType` VARCHAR(30) NULL, `notes` TEXT NULL,
  `tallyStatus` VARCHAR(10) NOT NULL DEFAULT 'PENDING', `tallyVoucherNo` VARCHAR(60) NULL, `tallyPostedAt` DATETIME NULL, `tallyPostedById` VARCHAR(30) NULL,
  `fileName` VARCHAR(255) NULL, `fileStored` VARCHAR(80) NULL,
  `createdById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `AccEntry_kind_date_idx` (`kind`, `docDate`), KEY `AccEntry_link_idx` (`linkId`),
  KEY `AccEntry_tally_idx` (`tallyStatus`), KEY `AccEntry_party_idx` (`partyName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]];
    }

    public function __construct()
    {
        ensure_schema(self::schema(), 'Accounts');
    }

    private static function auth(): array
    {
        $auth = authenticate();
        if (!in_array($auth['role'], self::ROLES, true)) sendError('Accounts is for the accounts team, Admins and the Super Admin.', 403);
        return $auth;
    }

    private static function str($v, int $max): ?string
    {
        $v = trim((string) ($v ?? ''));
        return $v === '' ? null : mb_substr($v, 0, $max);
    }

    private static function money($v, string $what, bool $required = false): ?float
    {
        if ($v === null || $v === '') { if ($required) sendError("Enter the $what.", 400); return null; }
        $v = str_replace([',', '₹', ' '], '', (string) $v);
        if (!is_numeric($v)) sendError(ucfirst($what) . ' must be a number.', 400);
        return round((float) $v, 2);
    }

    private static function entry(string $id): array
    {
        $s = db()->prepare('SELECT * FROM `AccEntry` WHERE id=?'); $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) sendError('Entry not found.', 404);
        return $r;
    }

    /** Invoices / bills with paid, balance, payStatus, daysOverdue from their linked receipts / payments. */
    private static function withBalances(array $rows): array
    {
        $ids = array_column(array_filter($rows, fn($r) => in_array($r['kind'], ['INVOICE', 'BILL'], true)), 'id');
        $paid = [];
        if ($ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            $s = db()->prepare("SELECT linkId, SUM(amount) AS paid FROM `AccEntry` WHERE kind IN ('RECEIPT','PAYMENT') AND linkId IN ($in) GROUP BY linkId");
            $s->execute($ids);
            foreach ($s->fetchAll() as $p) $paid[$p['linkId']] = (float) $p['paid'];
        }
        $today = date('Y-m-d');
        foreach ($rows as &$r) {
            foreach (['taxable', 'gstPercent', 'gstAmount', 'amount'] as $k) if ($r[$k] !== null) $r[$k] = (float) $r[$k];
            $r['hasFile'] = !empty($r['fileStored']);
            unset($r['fileStored']);
            $r['tallyType'] = self::TALLY_TYPE[$r['kind']] ?? ($r['voucherType'] ?: 'Journal');
            if (!in_array($r['kind'], ['INVOICE', 'BILL'], true)) continue;
            $p = round($paid[$r['id']] ?? 0, 2);
            $bal = round($r['amount'] - $p, 2);
            $r['paid'] = $p; $r['balance'] = $bal;
            $r['daysOverdue'] = ($bal > 0 && $r['dueDate'] && $r['dueDate'] < $today) ? (int) ((strtotime($today) - strtotime($r['dueDate'])) / 86400) : 0;
            $r['payStatus'] = $bal <= 0 ? 'PAID' : ($r['daysOverdue'] ? 'OVERDUE' : ($p > 0 ? 'PARTIAL' : 'UNPAID'));
        }
        return $rows;
    }

    private static function query(array $f): array
    {
        $where = []; $p = [];
        if (!empty($f['kind'])) {
            $kinds = array_values(array_intersect(array_map('strtoupper', (array) $f['kind']), array_keys(self::KINDS)));
            if (!$kinds) return [];
            $where[] = 'e.kind IN (' . implode(',', array_fill(0, count($kinds), '?')) . ')'; $p = array_merge($p, $kinds);
        }
        if (!empty($f['tally']) && $f['tally'] !== 'ALL') { $where[] = 'e.tallyStatus=?'; $p[] = $f['tally']; }
        if (!empty($f['from'])) { $where[] = 'e.docDate>=?'; $p[] = $f['from']; }
        if (!empty($f['to']))   { $where[] = 'e.docDate<=?'; $p[] = $f['to']; }
        if (!empty($f['company'])) { $where[] = 'e.company=?'; $p[] = $f['company']; }
        if (!empty($f['q'])) {
            $where[] = '(e.docNo LIKE ? OR e.partyName LIKE ? OR e.reference LIKE ? OR e.poRef LIKE ? OR e.orderRef LIKE ? OR e.tallyVoucherNo LIKE ? OR e.notes LIKE ?)';
            $p = array_merge($p, array_fill(0, 7, '%' . $f['q'] . '%'));
        }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $s = db()->prepare("SELECT e.*, l.docNo AS linkNo, u.name AS createdByName, t.name AS tallyPostedByName
            FROM `AccEntry` e LEFT JOIN `AccEntry` l ON l.id=e.linkId LEFT JOIN `User` u ON u.id=e.createdById LEFT JOIN `User` t ON t.id=e.tallyPostedById
            $w ORDER BY e.docDate DESC, e.createdAt DESC LIMIT 2000");
        $s->execute($p);
        $rows = self::withBalances($s->fetchAll());
        if (!empty($f['pay'])) $rows = array_values(array_filter($rows, fn($r) => ($r['payStatus'] ?? '') === $f['pay'] || ($f['pay'] === 'DUE' && in_array($r['payStatus'] ?? '', ['UNPAID', 'PARTIAL', 'OVERDUE'], true))));
        return $rows;
    }

    private static function filters(): array
    {
        return ['kind' => qp('kind') ? explode(',', (string) qp('kind')) : null, 'tally' => strtoupper((string) qp('tally', '')), 'q' => trim((string) qp('q', '')),
                'from' => to_date_only(qp('from')), 'to' => to_date_only(qp('to')), 'pay' => strtoupper((string) qp('pay', '')), 'company' => strtoupper((string) qp('company', ''))];
    }

    // GET /api/accounts/entries
    public function index(): void
    {
        self::auth();
        sendSuccess(['entries' => self::query(self::filters()), 'modes' => self::MODES, 'voucherTypes' => self::VOUCHER_TYPES]);
    }

    // GET /api/accounts/tally
    public function tally(): void
    {
        self::auth();
        $st = strtoupper((string) qp('status', 'PENDING'));
        $rows = self::query(['tally' => in_array($st, ['PENDING', 'POSTED'], true) ? $st : 'ALL', 'q' => trim((string) qp('q', '')), 'from' => to_date_only(qp('from')), 'to' => to_date_only(qp('to'))]);
        $count = db()->query("SELECT kind, COUNT(*) AS n FROM `AccEntry` WHERE tallyStatus='PENDING' GROUP BY kind")->fetchAll(PDO::FETCH_KEY_PAIR);
        sendSuccess(['entries' => $rows, 'pendingByKind' => array_map('intval', $count)]);
    }

    private function read(array $b, ?array $old): array
    {
        $kind = strtoupper((string) ($old['kind'] ?? $b['kind'] ?? ''));
        if (!isset(self::KINDS[$kind])) sendError('Pick the entry type.', 400);
        $d = ['kind' => $kind];
        $d['company'] = in_array(strtoupper((string) ($b['company'] ?? 'TMS')), ['TMS', 'APJ'], true) ? strtoupper((string) ($b['company'] ?? 'TMS')) : 'TMS';
        $d['docDate'] = to_date_only($b['docDate'] ?? null) ?: sendError('Enter the date.', 400);
        $d['docNo'] = self::str($b['docNo'] ?? '', 80);
        $d['partyId'] = self::str($b['partyId'] ?? '', 30);
        $d['partyName'] = self::str($b['partyName'] ?? '', 255);
        $d['partyGstin'] = self::str(strtoupper((string) ($b['partyGstin'] ?? '')), 30);
        $d['linkId'] = null; $d['orderId'] = self::str($b['orderId'] ?? '', 30); $d['orderRef'] = self::str($b['orderRef'] ?? '', 80); $d['poRef'] = self::str($b['poRef'] ?? '', 120);
        $d['taxable'] = $d['gstPercent'] = $d['gstAmount'] = null; $d['dueDate'] = null; $d['mode'] = null; $d['voucherType'] = null;
        $d['reference'] = self::str($b['reference'] ?? '', 120);
        $d['notes'] = self::str($b['notes'] ?? '', 4000);

        if ($kind === 'INVOICE' || $kind === 'BILL') {
            $who = $kind === 'INVOICE' ? 'customer' : 'vendor';
            if (!$d['docNo']) sendError($kind === 'INVOICE' ? 'Enter the invoice number.' : 'Enter the vendor\'s bill number.', 400);
            if (!$d['partyName']) sendError("Enter the $who.", 400);
            $taxable = self::money($b['taxable'] ?? null, 'taxable value', true);
            $gp = self::money($b['gstPercent'] ?? 18, 'GST %') ?? 0;
            if ($taxable < 0) sendError('The taxable value cannot be negative.', 400);
            if ($gp < 0 || $gp > 40) sendError('GST % must be between 0 and 40.', 400);
            $d['taxable'] = $taxable; $d['gstPercent'] = $gp;
            $d['gstAmount'] = round($taxable * $gp / 100, 2);
            $d['amount'] = round($taxable + $d['gstAmount'] + (self::money($b['roundOff'] ?? null, 'round off') ?? 0), 2);
            $d['dueDate'] = to_date_only($b['dueDate'] ?? null);
            if ($d['dueDate'] && $d['dueDate'] < $d['docDate']) sendError('The due date is before the ' . ($kind === 'INVOICE' ? 'invoice' : 'bill') . ' date.', 400);
            $s = db()->prepare('SELECT id FROM `AccEntry` WHERE kind=? AND docNo=? AND ' . ($kind === 'INVOICE' ? 'company=?' : 'partyName=?') . ' AND id<>? LIMIT 1');
            $s->execute([$kind, $d['docNo'], $kind === 'INVOICE' ? $d['company'] : $d['partyName'], $old['id'] ?? '']);
            if ($s->fetch()) sendError($kind === 'INVOICE' ? 'Invoice ' . $d['docNo'] . ' already exists.' : 'Bill ' . $d['docNo'] . ' from ' . $d['partyName'] . ' is already entered.', 409);
        } else {
            $d['amount'] = self::money($b['amount'] ?? null, 'amount', true);
            if ($d['amount'] <= 0) sendError('The amount must be more than zero.', 400);
        }
        if ($kind === 'RECEIPT' || $kind === 'PAYMENT') {
            $mode = strtoupper((string) ($b['mode'] ?? ''));
            if (!in_array($mode, self::MODES, true)) sendError('Pick how it was ' . ($kind === 'RECEIPT' ? 'received' : 'paid') . ' (NEFT, UPI, cheque, cash…).', 400);
            $d['mode'] = $mode;
            $link = self::str($b['linkId'] ?? '', 30);
            if ($link) {
                $want = $kind === 'RECEIPT' ? 'INVOICE' : 'BILL';
                $l = self::entry($link);
                if ($l['kind'] !== $want) sendError('Link a ' . ($kind === 'RECEIPT' ? 'receipt to an invoice' : 'payment to a vendor bill') . '.', 400);
                $d['linkId'] = $link;
                if (!$d['partyName']) { $d['partyName'] = $l['partyName']; $d['partyId'] = $l['partyId']; }
                $s = db()->prepare("SELECT COALESCE(SUM(amount),0) FROM `AccEntry` WHERE linkId=? AND kind=? AND id<>?");
                $s->execute([$link, $kind, $old['id'] ?? '']);
                $bal = round((float) $l['amount'] - (float) $s->fetchColumn(), 2);
                if ($d['amount'] > $bal + 0.009) sendError('That is more than the balance of ' . $l['docNo'] . ' (₹' . number_format($bal, 2) . ').', 400);
            }
            if (!$d['partyName']) sendError('Enter the ' . ($kind === 'RECEIPT' ? 'customer' : 'vendor') . '.', 400);
        }
        if ($kind === 'VOUCHER') {
            $vt = (string) ($b['voucherType'] ?? '');
            if (!in_array($vt, self::VOUCHER_TYPES, true)) sendError('Pick the voucher type.', 400);
            $d['voucherType'] = $vt;
            if (!$d['partyName'] && !$d['notes']) sendError('Enter the ledger / party or a narration.', 400);
        }
        return $d;
    }

    // POST /api/accounts/entries
    public function create(): void
    {
        $auth = self::auth();
        $d = $this->read(request_body(), null);
        $id = gen_id(); $now = now_sql();
        $cols = array_keys($d);
        db()->prepare('INSERT INTO `AccEntry` (id,' . implode(',', $cols) . ',createdById,createdAt,updatedAt) VALUES (?' . str_repeat(',?', count($cols)) . ',?,?,?)')
            ->execute(array_merge([$id], array_values($d), [$auth['id'], $now, $now]));
        log_activity($auth['id'], 'ACCOUNTS_' . $d['kind'] . '_ADDED', 'AccEntry', $id, ['no' => $d['docNo'], 'party' => $d['partyName'], 'amount' => $d['amount']]);
        sendSuccess(['entry' => self::withBalances([self::entry($id)])[0]], self::KINDS[$d['kind']] . ' saved', 201);
    }

    // PUT /api/accounts/entries/:id
    public function update(string $id): void
    {
        $auth = self::auth();
        $old = self::entry($id);
        $d = $this->read(request_body(), $old);
        if (in_array($old['kind'], ['INVOICE', 'BILL'], true)) {
            $s = db()->prepare('SELECT COALESCE(SUM(amount),0) FROM `AccEntry` WHERE linkId=?'); $s->execute([$id]);
            $paid = (float) $s->fetchColumn();
            if ($d['amount'] + 0.009 < $paid) sendError('The total cannot be less than what is already ' . ($old['kind'] === 'INVOICE' ? 'received' : 'paid') . ' (₹' . number_format($paid, 2) . ').', 400);
        }
        unset($d['kind']);
        $sets = implode(',', array_map(fn($c) => "`$c`=?", array_keys($d)));
        db()->prepare("UPDATE `AccEntry` SET $sets, updatedAt=? WHERE id=?")->execute(array_merge(array_values($d), [now_sql(), $id]));
        log_activity($auth['id'], 'ACCOUNTS_' . $old['kind'] . '_EDITED', 'AccEntry', $id, ['no' => $d['docNo'], 'amount' => $d['amount']]);
        sendSuccess(['entry' => self::withBalances([self::entry($id)])[0]], 'Saved');
    }

    // DELETE /api/accounts/entries/:id
    public function delete(string $id): void
    {
        $auth = self::auth();
        $e = self::entry($id);
        if ($auth['role'] === 'ACCOUNTS' && $e['createdById'] !== $auth['id']) sendError('Only the person who entered it, or an Admin, can delete this.', 403);
        if ($e['tallyStatus'] === 'POSTED' && $auth['role'] === 'ACCOUNTS') sendError('This is already posted in Tally — mark it pending first, or ask an Admin.', 400);
        $s = db()->prepare('SELECT COUNT(*) FROM `AccEntry` WHERE linkId=?'); $s->execute([$id]);
        if ((int) $s->fetchColumn()) sendError('Receipts / payments are linked to this. Delete or unlink them first.', 400);
        if ($e['fileStored']) @unlink(UPLOADS_PATH . '/accounts/' . basename($e['fileStored']));
        db()->prepare('DELETE FROM `AccEntry` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'ACCOUNTS_' . $e['kind'] . '_DELETED', 'AccEntry', $id, ['no' => $e['docNo'], 'amount' => $e['amount']]);
        sendSuccess([], 'Deleted');
    }

    // PATCH /api/accounts/entries/:id/tally
    public function setTally(string $id): void
    {
        $auth = self::auth();
        self::entry($id);
        $b = request_body();
        $st = strtoupper((string) ($b['status'] ?? 'POSTED'));
        if (!in_array($st, ['POSTED', 'PENDING'], true)) sendError('Status must be POSTED or PENDING.', 400);
        if ($st === 'POSTED') {
            db()->prepare("UPDATE `AccEntry` SET tallyStatus='POSTED', tallyVoucherNo=?, tallyPostedAt=?, tallyPostedById=?, updatedAt=? WHERE id=?")
                ->execute([self::str($b['voucherNo'] ?? '', 60), now_sql(), $auth['id'], now_sql(), $id]);
        } else {
            db()->prepare("UPDATE `AccEntry` SET tallyStatus='PENDING', tallyVoucherNo=NULL, tallyPostedAt=NULL, tallyPostedById=NULL, updatedAt=? WHERE id=?")->execute([now_sql(), $id]);
        }
        log_activity($auth['id'], 'ACCOUNTS_TALLY_' . $st, 'AccEntry', $id, []);
        sendSuccess(['entry' => self::withBalances([self::entry($id)])[0]], $st === 'POSTED' ? 'Marked as posted in Tally' : 'Moved back to Tally pending');
    }

    // POST /api/accounts/entries/:id/file
    public function uploadFile(string $id): void
    {
        $auth = self::auth();
        $e = self::entry($id);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('No file received.', 400);
        if ($f['size'] > 20 * 1024 * 1024) sendError('The file is larger than 20 MB.', 400);
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        if (!preg_match('/^(pdf|png|jpe?g|webp|xlsx|xls)$/', $ext)) sendError('Upload a PDF, image or Excel file.', 400);
        $dir = UPLOADS_PATH . '/accounts';
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the file on the server.', 500);
        $stored = gen_id() . '.' . $ext;
        if (!(@move_uploaded_file($f['tmp_name'], "$dir/$stored") || @rename($f['tmp_name'], "$dir/$stored"))) sendError('Could not save the file on the server.', 500);
        if ($e['fileStored']) @unlink("$dir/" . basename($e['fileStored']));
        $clean = mb_substr(preg_replace('/[^\w.\- ()]+/u', '_', (string) $f['name']), 0, 255);
        db()->prepare('UPDATE `AccEntry` SET fileName=?, fileStored=?, updatedAt=? WHERE id=?')->execute([$clean, $stored, now_sql(), $id]);
        log_activity($auth['id'], 'ACCOUNTS_FILE_UPLOADED', 'AccEntry', $id, ['file' => $clean]);
        sendSuccess(['entry' => self::withBalances([self::entry($id)])[0]], 'File attached', 201);
    }

    // GET /api/accounts/entries/:id/file
    public function file(string $id): void
    {
        self::auth();
        $e = self::entry($id);
        $path = UPLOADS_PATH . '/accounts/' . basename((string) $e['fileStored']);
        if (!$e['fileStored'] || !is_file($path)) sendError('No file attached.', 404);
        $types = ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp',
                  'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xls' => 'application/vnd.ms-excel'];
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: ' . (qp('inline') === '1' ? 'inline' : 'attachment') . '; filename="' . str_replace('"', '', $e['fileName'] ?: "file.$ext") . '"');
        readfile($path); exit;
    }

    // GET /api/accounts/summary
    public function summary(): void
    {
        self::auth();
        $ms = date('Y-m-01'); $me = date('Y-m-t'); $today = date('Y-m-d'); $wk = date('Y-m-d', strtotime('+7 days'));
        $sum = function (string $kind, string $from, string $to): float {
            $s = db()->prepare('SELECT COALESCE(SUM(amount),0) FROM `AccEntry` WHERE kind=? AND docDate BETWEEN ? AND ?'); $s->execute([$kind, $from, $to]);
            return round((float) $s->fetchColumn(), 2);
        };
        $inv = self::query(['kind' => ['INVOICE']]);
        $bills = self::query(['kind' => ['BILL']]);
        $aging = ['notDue' => 0, 'd30' => 0, 'd60' => 0, 'd90' => 0, 'd90plus' => 0];
        $recv = 0; $overdue = 0; $overdueN = 0; $byCust = [];
        foreach ($inv as $r) {
            if ($r['balance'] <= 0) continue;
            $recv += $r['balance'];
            $d = $r['daysOverdue'];
            $aging[$d <= 0 ? 'notDue' : ($d <= 30 ? 'd30' : ($d <= 60 ? 'd60' : ($d <= 90 ? 'd90' : 'd90plus')))] += $r['balance'];
            if ($d > 0) { $overdue += $r['balance']; $overdueN++; }
            $k = $r['partyName'] ?: '—';
            $byCust[$k] = $byCust[$k] ?? ['party' => $k, 'invoices' => 0, 'balance' => 0, 'overdue' => 0, 'oldestDue' => null];
            $byCust[$k]['invoices']++; $byCust[$k]['balance'] += $r['balance']; if ($d > 0) $byCust[$k]['overdue'] += $r['balance'];
            if ($r['dueDate'] && (!$byCust[$k]['oldestDue'] || $r['dueDate'] < $byCust[$k]['oldestDue'])) $byCust[$k]['oldestDue'] = $r['dueDate'];
        }
        usort($byCust, fn($a, $b) => $b['balance'] <=> $a['balance']);
        $pay = 0; $payDue7 = 0; $payOver = 0; $upcoming = [];
        foreach ($bills as $r) {
            if ($r['balance'] <= 0) continue;
            $pay += $r['balance'];
            if ($r['daysOverdue'] > 0) $payOver += $r['balance'];
            elseif ($r['dueDate'] && $r['dueDate'] <= $wk) $payDue7 += $r['balance'];
            $upcoming[] = ['id' => $r['id'], 'docNo' => $r['docNo'], 'partyName' => $r['partyName'], 'dueDate' => $r['dueDate'], 'balance' => $r['balance'], 'payStatus' => $r['payStatus']];
        }
        usort($upcoming, fn($a, $b) => strcmp($a['dueDate'] ?: '9999', $b['dueDate'] ?: '9999'));
        $s = db()->query("SELECT COALESCE(SUM(amount),0) FROM `AccEntry` WHERE kind='RECEIPT' AND linkId IS NULL");
        $onAccount = round((float) $s->fetchColumn(), 2);
        $tally = db()->query("SELECT kind, COUNT(*) AS n FROM `AccEntry` WHERE tallyStatus='PENDING' GROUP BY kind")->fetchAll(PDO::FETCH_KEY_PAIR);
        // Last 6 months: invoiced vs received
        $trend = [];
        for ($i = 5; $i >= 0; $i--) {
            $a = date('Y-m-01', strtotime("first day of -$i month")); $b = date('Y-m-t', strtotime($a));
            $trend[] = ['month' => date('M Y', strtotime($a)), 'invoiced' => $sum('INVOICE', $a, $b), 'received' => $sum('RECEIPT', $a, $b), 'billed' => $sum('BILL', $a, $b), 'paid' => $sum('PAYMENT', $a, $b)];
        }
        sendSuccess([
            'month' => ['invoiced' => $sum('INVOICE', $ms, $me), 'received' => $sum('RECEIPT', $ms, $me), 'billed' => $sum('BILL', $ms, $me), 'paid' => $sum('PAYMENT', $ms, $me)],
            'receivable' => round($recv, 2), 'overdue' => round($overdue, 2), 'overdueCount' => $overdueN, 'onAccount' => $onAccount,
            'aging' => array_map(fn($v) => round($v, 2), $aging),
            'payable' => round($pay, 2), 'payableDue7' => round($payDue7, 2), 'payableOverdue' => round($payOver, 2),
            'tallyPending' => array_map('intval', $tally), 'tallyPendingTotal' => array_sum(array_map('intval', $tally)),
            'customers' => array_slice(array_map(fn($c) => array_merge($c, ['balance' => round($c['balance'], 2), 'overdue' => round($c['overdue'], 2)]), $byCust), 0, 10),
            'upcomingBills' => array_slice($upcoming, 0, 8),
            'trend' => $trend, 'today' => $today,
        ]);
    }

    // GET /api/accounts/parties?type=customer|vendor&q=
    public function parties(): void
    {
        self::auth();
        $q = '%' . trim((string) qp('q', '')) . '%';
        $out = [];
        try {
            if (qp('type') === 'vendor') {
                $s = db()->prepare('SELECT id, name, gstin, city FROM `Vendor` WHERE isActive=1 AND name LIKE ? ORDER BY name LIMIT 15'); $s->execute([$q]);
                foreach ($s->fetchAll() as $r) $out[] = ['id' => $r['id'], 'name' => $r['name'], 'gstin' => $r['gstin'], 'sub' => $r['city']];
            } else {
                $s = db()->prepare('SELECT id, companyName, location FROM `Customer` WHERE companyName LIKE ? ORDER BY companyName LIMIT 15'); $s->execute([$q]);
                foreach ($s->fetchAll() as $r) $out[] = ['id' => $r['id'], 'name' => $r['companyName'], 'gstin' => null, 'sub' => $r['location']];
            }
        } catch (PDOException $e) { /* table not created yet */ }
        // Names typed earlier in accounts, too (parties not in the CRM).
        $s = db()->prepare("SELECT DISTINCT partyName, partyGstin FROM `AccEntry` WHERE kind IN (" . (qp('type') === 'vendor' ? "'BILL','PAYMENT'" : "'INVOICE','RECEIPT'") . ") AND partyName LIKE ? LIMIT 10");
        $s->execute([$q]);
        $seen = array_map('mb_strtolower', array_column($out, 'name'));
        foreach ($s->fetchAll() as $r) if (!in_array(mb_strtolower($r['partyName']), $seen, true)) $out[] = ['id' => null, 'name' => $r['partyName'], 'gstin' => $r['partyGstin'], 'sub' => 'used before'];
        sendSuccess(['parties' => array_slice($out, 0, 20)]);
    }

    // GET /api/accounts/orders?q=
    public function orders(): void
    {
        self::auth();
        $q = '%' . trim((string) qp('q', '')) . '%';
        try {
            $s = db()->prepare("SELECT o.id, o.orderNumber, o.orderDate, o.customerId, c.companyName, o.deliveryStatus,
                    (SELECT e.docNo FROM `AccEntry` e WHERE e.kind='INVOICE' AND e.orderId=o.id LIMIT 1) AS invoiceNo
                FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId
                WHERE o.orderNumber LIKE ? OR c.companyName LIKE ? ORDER BY o.createdAt DESC LIMIT 15");
            $s->execute([$q, $q]);
            $rows = $s->fetchAll();
        } catch (PDOException $e) { $rows = []; }
        sendSuccess(['orders' => $rows]);
    }

    // GET /api/accounts/claims?month=&year=
    public function claims(): void
    {
        self::auth();
        $m = max(1, min(12, (int) qp('month', date('n')))); $y = (int) qp('year', date('Y'));
        $from = sprintf('%04d-%02d-01', $y, $m); $to = date('Y-m-d', strtotime("$from +1 month"));
        try {
            $s = db()->prepare("SELECT u.id, u.name, u.department, COUNT(*) AS days, SUM(f.officialKm) AS km, SUM(f.fuelCost) AS fuel, SUM(f.miscAmount) AS misc, SUM(f.totalAmount) AS total,
                    SUM(f.status<>'CLOSED') AS openDays
                FROM `FuelExpense` f JOIN `User` u ON u.id=f.userId WHERE f.date>=? AND f.date<? GROUP BY u.id, u.name, u.department ORDER BY total DESC");
            $s->execute([$from, $to]);
            $rows = array_map(fn($r) => ['id' => $r['id'], 'name' => $r['name'], 'department' => $r['department'], 'days' => (int) $r['days'], 'openDays' => (int) $r['openDays'],
                'km' => round((float) $r['km'], 1), 'fuel' => round((float) $r['fuel'], 2), 'misc' => round((float) $r['misc'], 2), 'total' => round((float) $r['total'], 2)], $s->fetchAll());
        } catch (PDOException $e) { $rows = []; }
        sendSuccess(['claims' => $rows, 'month' => $m, 'year' => $y, 'total' => round(array_sum(array_column($rows, 'total')), 2)]);
    }

    // GET /api/accounts/export?kind=
    public function export(): void
    {
        self::auth();
        $kind = strtoupper((string) qp('kind', 'INVOICE'));
        $f = self::filters();
        $d = fn($v) => $v ? date('d-m-Y', strtotime($v)) : '';
        if ($kind === 'TALLY') {
            $rows = self::query(['tally' => strtoupper((string) qp('tally', 'PENDING')) ?: 'PENDING', 'from' => $f['from'], 'to' => $f['to']]);
            $head = ['Date', 'Tally voucher type', 'Entry', 'Number', 'Party / ledger', 'GSTIN', 'Taxable', 'GST %', 'GST', 'Amount', 'Mode', 'Reference', 'Against', 'Narration', 'Tally status', 'Tally voucher no'];
            $map = fn($r) => [$d($r['docDate']), $r['tallyType'], self::KINDS[$r['kind']], $r['docNo'], $r['partyName'], $r['partyGstin'], $r['taxable'], $r['gstPercent'], $r['gstAmount'], $r['amount'],
                $r['mode'], $r['reference'], $r['linkNo'], $r['notes'], $r['tallyStatus'], $r['tallyVoucherNo']];
            $name = 'tally-' . strtolower(qp('tally', 'pending'));
        } elseif ($kind === 'OUTSTANDING') {
            $rows = array_values(array_filter(self::query(['kind' => ['INVOICE', 'BILL']]), fn($r) => $r['balance'] > 0));
            $head = ['Type', 'Number', 'Date', 'Party', 'Total', 'Paid', 'Balance', 'Due date', 'Days overdue', 'Status'];
            $map = fn($r) => [$r['kind'] === 'INVOICE' ? 'Receivable' : 'Payable', $r['docNo'], $d($r['docDate']), $r['partyName'], $r['amount'], $r['paid'], $r['balance'], $d($r['dueDate']), $r['daysOverdue'], $r['payStatus']];
            $name = 'outstanding';
        } elseif (isset(self::KINDS[$kind])) {
            $f['kind'] = [$kind];
            $rows = self::query($f);
            if ($kind === 'INVOICE' || $kind === 'BILL') {
                $head = ['Company', $kind === 'INVOICE' ? 'Invoice no' : 'Bill no', 'Date', $kind === 'INVOICE' ? 'Customer' : 'Vendor', 'GSTIN', 'Order / PO ref', 'Taxable', 'GST %', 'GST', 'Total', 'Paid', 'Balance', 'Due date', 'Status', 'Tally', 'Tally voucher no', 'Notes'];
                $map = fn($r) => [$r['company'], $r['docNo'], $d($r['docDate']), $r['partyName'], $r['partyGstin'], trim(($r['orderRef'] ?? '') . ' ' . ($r['poRef'] ?? '')), $r['taxable'], $r['gstPercent'], $r['gstAmount'], $r['amount'],
                    $r['paid'], $r['balance'], $d($r['dueDate']), $r['payStatus'], $r['tallyStatus'], $r['tallyVoucherNo'], $r['notes']];
            } elseif ($kind === 'VOUCHER') {
                $head = ['Date', 'Voucher type', 'Number', 'Ledger / party', 'Amount', 'Reference', 'Narration', 'Tally', 'Tally voucher no'];
                $map = fn($r) => [$d($r['docDate']), $r['voucherType'], $r['docNo'], $r['partyName'], $r['amount'], $r['reference'], $r['notes'], $r['tallyStatus'], $r['tallyVoucherNo']];
            } else {
                $head = ['Date', 'Number', $kind === 'RECEIPT' ? 'Customer' : 'Vendor', 'Amount', 'Mode', 'Reference', $kind === 'RECEIPT' ? 'Against invoice' : 'Against bill', 'Notes', 'Tally', 'Tally voucher no'];
                $map = fn($r) => [$d($r['docDate']), $r['docNo'], $r['partyName'], $r['amount'], $r['mode'], $r['reference'], $r['linkNo'] ?: 'On account', $r['notes'], $r['tallyStatus'], $r['tallyVoucherNo']];
            }
            $name = strtolower(str_replace(' ', '-', self::KINDS[$kind])) . 's';
        } else {
            sendError('Unknown export.', 400);
        }
        $w = new XlsxWriter(ucfirst(str_replace('-', ' ', $name)));
        $w->addRow($head);
        foreach ($rows as $r) $w->addRow(array_map(fn($v) => $v ?? '', $map($r)));
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . $name . '-' . date('Y-m-d') . '.xlsx"');
        echo $w->output(); exit;
    }
}
