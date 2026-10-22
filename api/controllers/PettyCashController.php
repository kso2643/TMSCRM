<?php
/**
 * Petty cash — a cash book shown as a tab on the Fuel expense page.
 *
 * Entries are cash received (IN, e.g. cash given from the bank / MD) or cash
 * spent (OUT: what for, paid to, category, bill no.), each with any number of
 * bill photos / PDFs. The list shows the opening balance before the period,
 * money in, money out and the closing balance.
 *
 * Who can see it is set on the Users page → Page access → "Petty cash": by
 * default only the Super Admin, Admin and Accounts have access, everyone else
 * is hidden until given a level (view only / edit / full). Writes are checked in
 * PageAccess::guard(); reads here.
 *
 *   GET    /api/petty-cash?from=&to=&type=&search=     entries + balances + my level
 *   GET    /api/petty-cash/export?from=&to=            Excel
 *   GET    /api/petty-cash/report?month=YYYY-MM&company=TMS|APJ   monthly PDF report
 *   POST   /api/petty-cash                              { entryDate, type, amount, category, description, paidTo, billNo, mode }
 *   PUT    /api/petty-cash/:id
 *   DELETE /api/petty-cash/:id
 *   POST   /api/petty-cash/:id/bills                    multipart "file" (photo / PDF)
 *   GET    /api/petty-cash/:id/bills/:bid[?download=1]
 *   DELETE /api/petty-cash/:id/bills/:bid
 *   PUT    /api/petty-cash/settings                     { limit, lowAlert }   Super Admin / Admin
 *
 * Limit and low-balance alert: the limit is the most cash kept in hand —
 * receiving cash that takes the balance above it is refused, and an expense
 * can never be more than the cash in hand. When an expense takes the balance
 * to the low-alert amount or below, everyone with petty cash access gets a
 * "Petty cash is low" alert (AlertFeedController) and the tab shows a red banner.
 */
class PettyCashController
{
    public const CATEGORIES = ['Travel', 'Food & refreshments', 'Courier & postage', 'Stationery & printing', 'Office supplies', 'Repairs & maintenance',
                               'Fuel', 'Labour / loading', 'Telephone & internet', 'Cleaning', 'Other'];
    private const MODES = ['CASH', 'UPI', 'CARD', 'BANK'];

    public function __construct()
    {
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        ensure_schema([
            'PettyCash' => ['create' => "CREATE TABLE IF NOT EXISTS `PettyCash` (
  `id` VARCHAR(30) NOT NULL, `entryDate` DATE NOT NULL, `type` VARCHAR(4) NOT NULL, `amount` DECIMAL(14,2) NOT NULL,
  `category` VARCHAR(80) NULL, `description` VARCHAR(500) NOT NULL, `paidTo` VARCHAR(160) NULL, `billNo` VARCHAR(80) NULL,
  `mode` VARCHAR(10) NOT NULL DEFAULT 'CASH',
  `createdById` VARCHAR(30) NOT NULL, `updatedById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NULL,
  PRIMARY KEY (`id`), KEY `PettyCash_date` (`entryDate`)
$tail"],
            'PettyCashBill' => ['create' => "CREATE TABLE IF NOT EXISTS `PettyCashBill` (
  `id` VARCHAR(30) NOT NULL, `entryId` VARCHAR(30) NOT NULL, `fileName` VARCHAR(255) NOT NULL, `storedName` VARCHAR(80) NOT NULL,
  `size` INT NULL, `uploadedById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `PettyCashBill_entry` (`entryId`)
$tail"],
            'PettyCashSetting' => ['create' => "CREATE TABLE IF NOT EXISTS `PettyCashSetting` (
  `id` TINYINT NOT NULL, `cashLimit` DECIMAL(14,2) NULL, `lowAlert` DECIMAL(14,2) NULL,
  `lowAt` DATETIME NULL, `lowBalance` DECIMAL(14,2) NULL, `updatedById` VARCHAR(30) NULL, `updatedAt` DATETIME NULL,
  PRIMARY KEY (`id`)
$tail"],
        ], 'Petty cash');
    }

    /** { limit, lowAlert, lowAt, lowBalance } — nulls when not set. */
    public static function settings(): array
    {
        $r = db()->query('SELECT * FROM `PettyCashSetting` WHERE id=1')->fetch() ?: [];
        $n = fn($v) => isset($v) && $v !== null ? (float) $v : null;
        return ['limit' => $n($r['cashLimit'] ?? null), 'lowAlert' => $n($r['lowAlert'] ?? null), 'lowAt' => $r['lowAt'] ?? null, 'lowBalance' => $n($r['lowBalance'] ?? null)];
    }

    /** Cash in hand now (all entries), leaving out one entry when it is being edited. */
    private static function balanceNow(string $except = ''): float
    {
        $s = db()->prepare("SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE -amount END),0) FROM `PettyCash` WHERE id<>?");
        $s->execute([$except]);
        return round((float) $s->fetchColumn(), 2);
    }

    private static function inr(float $v): string { return '₹' . number_format($v, $v == floor($v) ? 0 : 2); }

    /** Refuses an entry that breaks the limit or spends more than the cash in hand; returns [before, after]. */
    private static function checkLimits(array $f, string $except = ''): array
    {
        $before = self::balanceNow($except);
        $after = round($before + ($f['type'] === 'IN' ? $f['amount'] : -$f['amount']), 2);
        $set = self::settings();
        if ($f['type'] === 'OUT' && $after < 0) sendError('Not enough petty cash — only ' . self::inr(max($before, 0)) . ' in hand. Record the cash received first.', 400);
        if ($f['type'] === 'IN' && $set['limit'] !== null && $after > $set['limit'])
            sendError('This takes the cash in hand to ' . self::inr($after) . ', above the petty cash limit of ' . self::inr($set['limit']) . '. You can receive up to ' . self::inr(max(0, $set['limit'] - $before)) . '.', 400);
        return [$before, $after];
    }

    /** Raises the low-balance alert when the balance drops to / below the alert amount. */
    private static function markLow(float $before, float $after): void
    {
        $set = self::settings();
        if ($set['lowAlert'] === null || $after > $set['lowAlert'] || $before <= $set['lowAlert']) return;
        db()->prepare('INSERT INTO `PettyCashSetting` (id, lowAt, lowBalance) VALUES (1,?,?) ON DUPLICATE KEY UPDATE lowAt=VALUES(lowAt), lowBalance=VALUES(lowBalance)')
            ->execute([now_sql(), $after]);
    }

    // PUT /api/petty-cash/settings
    public function saveSettings(): void
    {
        [$auth] = $this->viewer();
        if (!in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('Only the Super Admin or an Admin can set the petty cash limit.', 403);
        $b = request_body();
        $num = function ($v, string $what) {
            $v = str_replace([',', '₹', ' '], '', (string) ($v ?? ''));
            if ($v === '') return null;
            if (!is_numeric($v) || (float) $v < 0) sendError("Enter the $what as a number.", 400);
            return round((float) $v, 2);
        };
        $limit = $num($b['limit'] ?? '', 'limit'); $low = $num($b['lowAlert'] ?? '', 'low-balance alert');
        if ($limit !== null && $limit <= 0) sendError('The limit must be more than 0.', 400);
        if ($limit !== null && $low !== null && $low >= $limit) sendError('The low-balance alert must be less than the limit.', 400);
        db()->prepare('INSERT INTO `PettyCashSetting` (id, cashLimit, lowAlert, updatedById, updatedAt) VALUES (1,?,?,?,?)
                       ON DUPLICATE KEY UPDATE cashLimit=VALUES(cashLimit), lowAlert=VALUES(lowAlert), updatedById=VALUES(updatedById), updatedAt=VALUES(updatedAt)')
            ->execute([$limit, $low, $auth['id'], now_sql()]);
        log_activity($auth['id'], 'PETTY_CASH_LIMIT_SET', 'PettyCashSetting', '1', ['limit' => $limit, 'lowAlert' => $low]);
        sendSuccess(['settings' => self::settings()], 'Petty cash limit saved');
    }

    private static function dir(): string { return UPLOADS_PATH . '/petty-cash'; }

    /** Signed-in user who may at least view petty cash, with their level. */
    private function viewer(): array
    {
        $auth = authenticate();
        $lvl = PageAccess::levelFor($auth, 'petty-cash');
        if ($lvl === 'hidden') sendError('You do not have access to petty cash — ask the Super Admin.', 403);
        return [$auth, $lvl];
    }

    private function row(string $id): array
    {
        $s = db()->prepare('SELECT * FROM `PettyCash` WHERE id=?'); $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) sendError('Entry not found.', 404);
        return $r;
    }

    private function billsFor(array $ids): array
    {
        if (!$ids) return [];
        $in = implode(',', array_fill(0, count($ids), '?'));
        $s = db()->prepare("SELECT id, entryId, fileName, size, createdAt FROM `PettyCashBill` WHERE entryId IN ($in) ORDER BY createdAt");
        $s->execute($ids);
        $out = [];
        foreach ($s->fetchAll() as $b) $out[$b['entryId']][] = ['id' => $b['id'], 'fileName' => $b['fileName'], 'size' => (int) $b['size'], 'createdAt' => $b['createdAt']];
        return $out;
    }

    private function shape(array $r, array $bills, array $names): array
    {
        return ['id' => $r['id'], 'entryDate' => $r['entryDate'], 'type' => $r['type'], 'amount' => (float) $r['amount'], 'category' => $r['category'],
                'description' => $r['description'], 'paidTo' => $r['paidTo'], 'billNo' => $r['billNo'], 'mode' => $r['mode'],
                'bills' => $bills[$r['id']] ?? [], 'createdBy' => ['id' => $r['createdById'], 'name' => $names[$r['createdById']] ?? '—'],
                'createdAt' => $r['createdAt'], 'updatedAt' => $r['updatedAt']];
    }

    private static function period(): array
    {
        $from = to_date_only(qp('from', '')) ?: date('Y-m-01');
        $to = to_date_only(qp('to', '')) ?: date('Y-m-t');
        if ($to < $from) [$from, $to] = [$to, $from];
        return [$from, $to];
    }

    private function entries(string $from, string $to): array
    {
        $where = ['entryDate BETWEEN ? AND ?']; $p = [$from, $to];
        if (in_array($t = strtoupper((string) qp('type', '')), ['IN', 'OUT'], true)) { $where[] = 'type=?'; $p[] = $t; }
        if (($q = trim((string) qp('search', ''))) !== '') { $where[] = '(description LIKE ? OR paidTo LIKE ? OR category LIKE ? OR billNo LIKE ?)'; array_push($p, "%$q%", "%$q%", "%$q%", "%$q%"); }
        $s = db()->prepare('SELECT * FROM `PettyCash` WHERE ' . implode(' AND ', $where) . ' ORDER BY entryDate, createdAt');
        $s->execute($p);
        return $s->fetchAll();
    }

    private static function balanceBefore(string $date): float
    {
        $s = db()->prepare("SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE -amount END),0) FROM `PettyCash` WHERE entryDate < ?");
        $s->execute([$date]);
        return round((float) $s->fetchColumn(), 2);
    }

    // GET /api/petty-cash
    public function index(): void
    {
        [$auth, $lvl] = $this->viewer();
        [$from, $to] = self::period();
        $rows = $this->entries($from, $to);
        $names = [];
        foreach (db()->query('SELECT id, name FROM `User`')->fetchAll() as $u) $names[$u['id']] = $u['name'];
        $bills = $this->billsFor(array_column($rows, 'id'));
        // running balance over the whole period (filters do not change the balances)
        $opening = self::balanceBefore($from);
        $s = db()->prepare("SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount END),0) AS i, COALESCE(SUM(CASE WHEN type='OUT' THEN amount END),0) AS o FROM `PettyCash` WHERE entryDate BETWEEN ? AND ?");
        $s->execute([$from, $to]); $t = $s->fetch();
        $out = []; $bal = $opening; $filtered = qp('type', '') !== '' || trim((string) qp('search', '')) !== '';
        foreach ($rows as $r) {
            $x = $this->shape($r, $bills, $names);
            if (!$filtered) { $bal += $r['type'] === 'IN' ? (float) $r['amount'] : -(float) $r['amount']; $x['balance'] = round($bal, 2); }
            $out[] = $x;
        }
        $in = round((float) $t['i'], 2); $o = round((float) $t['o'], 2);
        $noBill = count(array_filter($out, fn($x) => $x['type'] === 'OUT' && !$x['bills']));
        $set = self::settings(); $now = self::balanceNow();
        sendSuccess(['entries' => $out, 'from' => $from, 'to' => $to, 'level' => $lvl, 'categories' => self::CATEGORIES,
                     'limits' => ['limit' => $set['limit'], 'lowAlert' => $set['lowAlert'], 'balanceNow' => $now,
                                  'low' => $set['lowAlert'] !== null && $now <= $set['lowAlert'],
                                  'topUp' => $set['limit'] !== null ? max(0, round($set['limit'] - $now, 2)) : null,
                                  'canSet' => in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)],
                     'summary' => ['opening' => $opening, 'in' => $in, 'out' => $o, 'closing' => round($opening + $in - $o, 2), 'outWithoutBill' => $noBill]]);
    }

    private function fields(array $b): array
    {
        $type = strtoupper((string) ($b['type'] ?? ''));
        if (!in_array($type, ['IN', 'OUT'], true)) sendError('Choose cash received or cash spent.', 400);
        $date = to_date_only((string) ($b['entryDate'] ?? ''));
        if (!$date) sendError('Enter the date.', 400);
        if ($date > date('Y-m-d')) sendError('The date cannot be in the future.', 400);
        $amt = str_replace([',', '₹', ' '], '', (string) ($b['amount'] ?? ''));
        if (!is_numeric($amt) || (float) $amt <= 0) sendError('Enter the amount (more than 0).', 400);
        $desc = mb_substr(trim((string) ($b['description'] ?? '')), 0, 500);
        if ($desc === '') sendError($type === 'IN' ? 'Write where the cash came from.' : 'Write what the money was spent on.', 400);
        $mode = strtoupper((string) ($b['mode'] ?? 'CASH'));
        if (!in_array($mode, self::MODES, true)) $mode = 'CASH';
        $cat = mb_substr(trim((string) ($b['category'] ?? '')), 0, 80);
        return ['entryDate' => $date, 'type' => $type, 'amount' => round((float) $amt, 2), 'category' => $type === 'OUT' ? ($cat ?: 'Other') : ($cat ?: null),
                'description' => $desc, 'paidTo' => mb_substr(trim((string) ($b['paidTo'] ?? '')), 0, 160) ?: null,
                'billNo' => mb_substr(trim((string) ($b['billNo'] ?? '')), 0, 80) ?: null, 'mode' => $mode];
    }

    private function one(string $id): array
    {
        $r = $this->row($id);
        $names = [];
        foreach (db()->query('SELECT id, name FROM `User`')->fetchAll() as $u) $names[$u['id']] = $u['name'];
        return $this->shape($r, $this->billsFor([$id]), $names);
    }

    // POST /api/petty-cash
    public function create(): void
    {
        [$auth] = $this->viewer();
        $f = $this->fields(request_body());
        [$before, $after] = self::checkLimits($f);
        $id = gen_id();
        $cols = array_keys($f);
        db()->prepare('INSERT INTO `PettyCash` (id,' . implode(',', $cols) . ',createdById,createdAt,updatedAt) VALUES (?' . str_repeat(',?', count($cols)) . ',?,?,?)')
            ->execute(array_merge([$id], array_values($f), [$auth['id'], now_sql(), now_sql()]));
        log_activity($auth['id'], 'PETTY_CASH_ADDED', 'PettyCash', $id, ['type' => $f['type'], 'amount' => $f['amount']]);
        self::markLow($before, $after);
        sendSuccess(['entry' => $this->one($id)], ($f['type'] === 'IN' ? 'Cash received' : 'Expense') . ' saved — attach the bill if you have one', 201);
    }

    // PUT /api/petty-cash/:id
    public function update(string $id): void
    {
        [$auth] = $this->viewer();
        $old = $this->row($id);
        $f = $this->fields(request_body());
        [, $after] = self::checkLimits($f, $id);
        $before = round(self::balanceNow($id) + ($old['type'] === 'IN' ? (float) $old['amount'] : -(float) $old['amount']), 2);
        $sets = implode(',', array_map(fn($c) => "$c=?", array_keys($f)));
        db()->prepare("UPDATE `PettyCash` SET $sets, updatedById=?, updatedAt=? WHERE id=?")->execute(array_merge(array_values($f), [$auth['id'], now_sql(), $id]));
        self::markLow($before, $after);
        sendSuccess(['entry' => $this->one($id)], 'Entry updated');
    }

    // DELETE /api/petty-cash/:id
    public function delete(string $id): void
    {
        [$auth] = $this->viewer();
        $r = $this->row($id);
        $s = db()->prepare('SELECT storedName FROM `PettyCashBill` WHERE entryId=?'); $s->execute([$id]);
        foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $f) @unlink(self::dir() . '/' . basename($f));
        db()->prepare('DELETE FROM `PettyCashBill` WHERE entryId=?')->execute([$id]);
        db()->prepare('DELETE FROM `PettyCash` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'PETTY_CASH_DELETED', 'PettyCash', $id, ['type' => $r['type'], 'amount' => (float) $r['amount'], 'description' => $r['description']]);
        sendSuccess(null, 'Entry deleted');
    }

    // POST /api/petty-cash/:id/bills
    public function addBill(string $id): void
    {
        [$auth] = $this->viewer();
        $this->row($id);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('Choose the bill photo or PDF.', 400);
        if ($f['size'] <= 0 || $f['size'] > 15 * 1024 * 1024) sendError('The bill file must be under 15 MB.', 400);
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'], true)) sendError('Attach the bill as a photo (JPG / PNG) or PDF.', 400);
        $c = db()->prepare('SELECT COUNT(*) FROM `PettyCashBill` WHERE entryId=?'); $c->execute([$id]);
        if ((int) $c->fetchColumn() >= 10) sendError('At most 10 bills per entry.', 400);
        $dir = self::dir();
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the bill on the server.', 500);
        $stored = gen_id() . '.' . $ext;
        if (!move_uploaded_file($f['tmp_name'], "$dir/$stored") && !rename($f['tmp_name'], "$dir/$stored")) sendError('Could not save the bill on the server.', 500);
        $name = mb_substr(preg_replace('/[^\w.\- ()]+/u', '_', (string) $f['name']), 0, 255);
        db()->prepare('INSERT INTO `PettyCashBill` (id,entryId,fileName,storedName,size,uploadedById,createdAt) VALUES (?,?,?,?,?,?,?)')
            ->execute([gen_id(), $id, $name, $stored, (int) $f['size'], $auth['id'], now_sql()]);
        sendSuccess(['entry' => $this->one($id)], 'Bill attached', 201);
    }

    // GET /api/petty-cash/:id/bills/:bid
    public function billFile(string $id, string $bid): void
    {
        $this->viewer();
        $s = db()->prepare('SELECT * FROM `PettyCashBill` WHERE id=? AND entryId=?'); $s->execute([$bid, $id]);
        $b = $s->fetch();
        $path = $b ? self::dir() . '/' . basename($b['storedName']) : '';
        if (!$b || !is_file($path)) sendError('No bill file.', 404);
        $ext = strtolower(pathinfo($b['storedName'], PATHINFO_EXTENSION));
        $types = ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'heic' => 'image/heic'];
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
        header('Content-Disposition: ' . (qp('download') ? 'attachment' : 'inline') . '; filename="' . str_replace('"', '', $b['fileName']) . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path); exit;
    }

    // DELETE /api/petty-cash/:id/bills/:bid
    public function deleteBill(string $id, string $bid): void
    {
        $this->viewer();
        $s = db()->prepare('SELECT * FROM `PettyCashBill` WHERE id=? AND entryId=?'); $s->execute([$bid, $id]);
        $b = $s->fetch();
        if (!$b) sendError('Bill not found.', 404);
        @unlink(self::dir() . '/' . basename($b['storedName']));
        db()->prepare('DELETE FROM `PettyCashBill` WHERE id=?')->execute([$bid]);
        sendSuccess(['entry' => $this->one($id)], 'Bill removed');
    }

    // GET /api/petty-cash/export
    public function export(): void
    {
        $this->viewer();
        [$from, $to] = self::period();
        $rows = $this->entries($from, $to);
        $bills = $this->billsFor(array_column($rows, 'id'));
        $wb = new StyledXlsxWriter();
        $sh = $wb->addSheet('Petty cash');
        $wb->setWidths($sh, [12, 10, 22, 40, 22, 14, 10, 14, 14, 14, 8]);
        $wb->addRow($sh, ['Petty cash ' . date('d-m-Y', strtotime($from)) . ' to ' . date('d-m-Y', strtotime($to))], 'header');
        $wb->addRow($sh, ['Date', 'Type', 'Category', 'Description', 'Paid to', 'Bill no.', 'Mode', 'Received', 'Spent', 'Balance', 'Bills'], 'header', 22);
        $bal = self::balanceBefore($from);
        $wb->addRow($sh, ['', '', '', 'Opening balance', '', '', '', '', '', $bal, '']);
        $ti = $to2 = 0.0;
        foreach ($rows as $r) {
            $a = (float) $r['amount']; $in = $r['type'] === 'IN';
            $bal += $in ? $a : -$a; if ($in) $ti += $a; else $to2 += $a;
            $wb->addRow($sh, [date('d-m-Y', strtotime($r['entryDate'])), $in ? 'Received' : 'Spent', (string) $r['category'], $r['description'], (string) $r['paidTo'], (string) $r['billNo'], $r['mode'],
                              $in ? $a : '', $in ? '' : $a, round($bal, 2), count($bills[$r['id']] ?? [])]);
        }
        $wb->addRow($sh, ['', '', '', 'Total / closing balance', '', '', '', $ti, $to2, round($bal, 2), ''], 'header');
        $bytes = $wb->output();
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="petty-cash-' . $from . '-to-' . $to . '.xlsx"');
        echo $bytes; exit;
    }

    // GET /api/petty-cash/report?month=YYYY-MM&company=TMS|APJ   monthly PDF
    public function report(): void
    {
        [$auth] = $this->viewer();
        $m = (string) qp('month', date('Y-m'));
        if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $m)) sendError('Choose the month.', 400);
        $from = $m . '-01'; $to = date('Y-m-t', strtotime($from));
        $co = strtoupper((string) qp('company', 'TMS')) === 'APJ' ? 'APJ' : 'TMS';
        $s = db()->prepare('SELECT p.*, u.name AS byName FROM `PettyCash` p LEFT JOIN `User` u ON u.id=p.createdById WHERE p.entryDate BETWEEN ? AND ? ORDER BY p.entryDate, p.createdAt');
        $s->execute([$from, $to]);
        $rows = $s->fetchAll();
        $bills = $this->billsFor(array_column($rows, 'id'));
        $opening = self::balanceBefore($from);
        $names = db()->prepare('SELECT name FROM `User` WHERE id=?'); $names->execute([$auth['id']]);
        $pdf = (new PettyCashPdf([
            'month' => $m, 'from' => $from, 'to' => $to, 'rows' => $rows, 'bills' => $bills, 'opening' => $opening,
            'settings' => self::settings(), 'by' => (string) $names->fetchColumn(),
        ], PurchaseOrderController::profile($co), $co))->render();
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/pdf');
        header('Content-Disposition: ' . (qp('inline') === '1' ? 'inline' : 'attachment') . '; filename="Petty-cash-' . $m . '.pdf"');
        echo $pdf->output(); exit;
    }
}


/** Petty cash monthly report PDF on the TMS / APJ letterhead. */
class PettyCashPdf
{
    private const MM = 2.8346456693;
    private const BLUE = '#1A4FA0'; private const DARK = '#111827'; private const GREY = '#6B7280'; private const GREEN = '#166534'; private const RED = '#B91C1C';
    private const BGBLUE = '#EFF6FF'; private const CELL = '#E5E7EB'; private const ALT = '#F9FAFB';
    private const A4_W = 210.0; private const A4_H = 297.0; private const ML = 10.0; private const MR = 10.0; private const MT = 12.0; private const MB = 16.0;
    private SimplePdf $pdf; private float $y = 0; private float $cw = 190;
    public function __construct(private array $d, private array $co, private string $code) {}
    private function mm(float $v): float { return $v * self::MM; }
    private function t(string $s, float $x, float $y, array $o = []): void { $this->pdf->text($s, $this->mm($x), $this->mm($y), $o + ['baseline' => 'top']); }
    private function font(string $f, float $s, string $c): void { $this->pdf->setFont($f, $s); $this->pdf->setFillColor($c); }
    private function box(float $x, float $y, float $w, float $h, string $c, float $lw = 0.3): void
    {
        foreach ([[$x, $y, $x + $w, $y], [$x, $y + $h, $x + $w, $y + $h], [$x, $y, $x, $y + $h], [$x + $w, $y, $x + $w, $y + $h]] as $l)
            $this->pdf->line($this->mm($l[0]), $this->mm($l[1]), $this->mm($l[2]), $this->mm($l[3]), $c, $this->mm($lw));
    }
    private function wrap(string $s, float $w): array { return trim($s) === '' ? [''] : $this->pdf->splitTextToSize($s, $this->mm($w)); }
    private function rs(?float $v): string { return $v === null ? '' : 'Rs. ' . number_format($v, 2); }
    private function newPage(): void { $this->pdf->addPage($this->mm(self::A4_W), $this->mm(self::A4_H)); $this->box(5, 5, 200, 287, self::BLUE, 0.4); $this->y = self::MT; }
    private function need(float $h, ?callable $after = null): void { if ($this->y + $h > self::A4_H - self::MB) { $this->newPage(); if ($after) $after(); } }

    public function render(): SimplePdf
    {
        $d = $this->d; $c = $this->co;
        $this->pdf = new SimplePdf();
        $this->newPage();
        // letterhead
        if ($this->code === 'APJ') { $lw = 24; $lh = 24; $logo = __DIR__ . '/../assets/apj-logo.png'; }
        else { $lh = 18; $lw = 291 * 18 / 164; $logo = __DIR__ . '/../assets/tms-logo.png'; }
        if (!$this->pdf->addImage($logo, $this->mm(self::ML), $this->mm($this->y), $this->mm($lw), $this->mm($lh))) { $this->font('Helvetica-Bold', 16, self::BLUE); $this->t($this->code, self::ML, $this->y + 6); }
        $R = self::A4_W - self::MR;
        $this->font('Helvetica-Bold', 13, self::BLUE); $this->t((string) $c['name'], $R, $this->y + 1, ['align' => 'right']);
        $this->font('Helvetica', 7.5, self::DARK);
        $hy = $this->y + 7;
        $lines = array_filter(array_map('trim', explode("\n", (string) $c['address'])));
        $tail = array_filter([$c['phone'] ? (stripos($c['phone'], 'phone') === false && stripos($c['phone'], 'mobile') === false ? 'Phone: ' : '') . $c['phone'] : '', $c['email'] ? 'E-Mail: ' . $c['email'] : '', $c['gstin'] ? 'GST No: ' . $c['gstin'] : '']);
        foreach (array_merge($lines, [implode('  |  ', $tail)]) as $l) { foreach ($this->wrap($l, 150) as $w) { $this->t($w, $R, $hy, ['align' => 'right']); $hy += 3.8; } }
        $this->y = max($hy, $this->y + $lh) + 2;
        $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm($R), $this->mm($this->y), self::BLUE, $this->mm(0.8));
        $this->y += 3;
        $this->font('Helvetica-Bold', 12, self::BLUE); $this->t('PETTY CASH REPORT — ' . strtoupper(date('F Y', strtotime($d['from']))), self::A4_W / 2, $this->y, ['align' => 'center']);
        $this->y += 6;
        $this->font('Helvetica', 7.5, self::GREY); $this->t(date('d-m-Y', strtotime($d['from'])) . ' to ' . date('d-m-Y', strtotime($d['to'])) . '   ·   generated ' . date('d-m-Y H:i') . ' by ' . $d['by'], self::A4_W / 2, $this->y, ['align' => 'center']);
        $this->y += 7;
        // summary boxes
        $in = 0.0; $out = 0.0; $cats = [];
        foreach ($d['rows'] as $r) { $a = (float) $r['amount']; if ($r['type'] === 'IN') $in += $a; else { $out += $a; $k = $r['category'] ?: 'Other'; $cats[$k] = ($cats[$k] ?? 0) + $a; } }
        $close = $d['opening'] + $in - $out;
        $st = $d['settings'];
        $tiles = [['Opening balance', $d['opening'], self::DARK], ['Received', $in, self::GREEN], ['Spent', $out, self::RED], ['Closing balance', $close, self::BLUE]];
        $tw = ($this->cw - 3 * 3) / 4;
        foreach ($tiles as $k => [$lab, $v, $col]) {
            $x = self::ML + $k * ($tw + 3);
            $this->pdf->rect($this->mm($x), $this->mm($this->y), $this->mm($tw), $this->mm(15), self::ALT);
            $this->box($x, $this->y, $tw, 15, self::CELL);
            $this->font('Helvetica', 7, self::GREY); $this->t($lab, $x + 3, $this->y + 2.5);
            $this->font('Helvetica-Bold', 11, $col); $this->t($this->rs($v), $x + 3, $this->y + 7.5);
        }
        $this->y += 18;
        $noBill = 0; foreach ($d['rows'] as $r) if ($r['type'] === 'OUT' && empty($d['bills'][$r['id']])) $noBill++;
        $note = [];
        if ($st['limit'] !== null) $note[] = 'Limit ' . $this->rs($st['limit']);
        if ($st['lowAlert'] !== null) $note[] = 'Low-balance alert at ' . $this->rs($st['lowAlert']);
        $note[] = count($d['rows']) . ' entries';
        $note[] = $noBill ? $noBill . ' expense(s) without a bill' : 'every expense has a bill';
        $this->font('Helvetica', 7.5, self::DARK); $this->t(implode('   ·   ', $note), self::ML, $this->y);
        $this->y += 7;
        // entries table
        $cols = [['Date', 17, 'l'], ['Description', 58, 'l'], ['Category', 27, 'l'], ['Paid to / from', 26, 'l'], ['Bill', 9, 'c'], ['Received', 18, 'r'], ['Spent', 18, 'r'], ['Balance', 17, 'r']];
        $x = [self::ML]; foreach ($cols as $i => $col) if ($i) $x[] = $x[$i - 1] + $cols[$i - 1][1];
        $head = function () use ($cols, $x) {
            $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm(7), self::BLUE);
            $this->font('Helvetica-Bold', 7.3, '#FFFFFF');
            foreach ($cols as $i => $col) {
                $ax = $col[2] === 'r' ? $x[$i] + $col[1] - 1.5 : ($col[2] === 'c' ? $x[$i] + $col[1] / 2 : $x[$i] + 1.5);
                $this->t($col[0], $ax, $this->y + 2.2, ['align' => $col[2] === 'r' ? 'right' : ($col[2] === 'c' ? 'center' : 'left')]);
            }
            $this->y += 7;
        };
        $head();
        $this->font('Helvetica-Bold', 7.5, self::DARK);
        $this->t('Opening balance', $x[1] + 1.5, $this->y + 1.6); $this->t(number_format($d['opening'], 2), $x[7] + $cols[7][1] - 1.5, $this->y + 1.6, ['align' => 'right']);
        $this->y += 6;
        $bal = $d['opening'];
        foreach ($d['rows'] as $n => $r) {
            $a = (float) $r['amount']; $isIn = $r['type'] === 'IN'; $bal += $isIn ? $a : -$a;
            $this->font('Helvetica', 7.5, self::DARK);
            $desc = $this->wrap($r['description'] . ($r['billNo'] ? ' (bill ' . $r['billNo'] . ')' : ''), $cols[1][1] - 3);
            $paid = $this->wrap((string) $r['paidTo'], $cols[3][1] - 3);
            $cat = $this->wrap($isIn ? 'Cash received' : (string) $r['category'], $cols[2][1] - 3);
            $rh = max(6, 3.5 * max(count($desc), count($paid), count($cat)) + 2.6);
            $this->need($rh, $head);
            if ($n % 2) $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm($rh), self::ALT);
            $this->t(date('d-m-Y', strtotime($r['entryDate'])), $x[0] + 1.5, $this->y + 1.6);
            foreach ($desc as $k => $l) $this->t($l, $x[1] + 1.5, $this->y + 1.6 + 3.5 * $k);
            foreach ($cat as $k => $l) $this->t($l, $x[2] + 1.5, $this->y + 1.6 + 3.5 * $k);
            foreach ($paid as $k => $l) $this->t($l, $x[3] + 1.5, $this->y + 1.6 + 3.5 * $k);
            $nb = count($d['bills'][$r['id']] ?? []);
            $this->font('Helvetica', 7.5, $nb ? self::GREEN : ($isIn ? self::GREY : self::RED));
            $this->t($nb ? (string) $nb : ($isIn ? '-' : 'none'), $x[4] + $cols[4][1] / 2, $this->y + 1.6, ['align' => 'center']);
            $this->font('Helvetica-Bold', 7.5, self::GREEN); if ($isIn) $this->t(number_format($a, 2), $x[5] + $cols[5][1] - 1.5, $this->y + 1.6, ['align' => 'right']);
            $this->font('Helvetica-Bold', 7.5, self::RED); if (!$isIn) $this->t(number_format($a, 2), $x[6] + $cols[6][1] - 1.5, $this->y + 1.6, ['align' => 'right']);
            $this->font('Helvetica', 7.5, self::DARK); $this->t(number_format($bal, 2), $x[7] + $cols[7][1] - 1.5, $this->y + 1.6, ['align' => 'right']);
            for ($i = 1; $i < count($cols); $i++) $this->pdf->line($this->mm($x[$i]), $this->mm($this->y), $this->mm($x[$i]), $this->mm($this->y + $rh), self::CELL, $this->mm(0.2));
            $this->y += $rh;
            $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm(self::ML + $this->cw), $this->mm($this->y), self::CELL, $this->mm(0.2));
        }
        if (!$d['rows']) { $this->font('Helvetica', 8, self::GREY); $this->t('No petty cash entries in this month.', self::A4_W / 2, $this->y + 2, ['align' => 'center']); $this->y += 8; }
        $this->need(8);
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm(7), self::BGBLUE);
        $this->font('Helvetica-Bold', 8, self::BLUE); $this->t('Total / closing balance', $x[1] + 1.5, $this->y + 2.2);
        $this->font('Helvetica-Bold', 8, self::GREEN); $this->t(number_format($in, 2), $x[5] + $cols[5][1] - 1.5, $this->y + 2.2, ['align' => 'right']);
        $this->font('Helvetica-Bold', 8, self::RED); $this->t(number_format($out, 2), $x[6] + $cols[6][1] - 1.5, $this->y + 2.2, ['align' => 'right']);
        $this->font('Helvetica-Bold', 8, self::BLUE); $this->t(number_format($close, 2), $x[7] + $cols[7][1] - 1.5, $this->y + 2.2, ['align' => 'right']);
        $this->y += 11;
        // spent by category
        if ($cats) {
            arsort($cats);
            $this->need(10 + 5 * count($cats));
            $this->font('Helvetica-Bold', 9, self::BLUE); $this->t('Spent by category', self::ML, $this->y); $this->y += 6;
            foreach ($cats as $k => $v) {
                $this->font('Helvetica', 8, self::DARK); $this->t($k, self::ML + 2, $this->y);
                $this->font('Helvetica-Bold', 8, self::DARK); $this->t($this->rs($v), self::ML + 85, $this->y, ['align' => 'right']);
                $pct = $out > 0 ? $v / $out : 0;
                $this->pdf->rect($this->mm(self::ML + 90), $this->mm($this->y + 0.6), $this->mm(80), $this->mm(2.6), '#E5E7EB');
                $this->pdf->rect($this->mm(self::ML + 90), $this->mm($this->y + 0.6), $this->mm(max(0.5, 80 * $pct)), $this->mm(2.6), self::BLUE);
                $this->font('Helvetica', 7, self::GREY); $this->t(round($pct * 100) . '%', self::ML + 173, $this->y);
                $this->y += 5;
            }
            $this->y += 4;
        }
        // signatures
        $this->need(24);
        $this->y += 12;
        foreach ([['Prepared by', self::ML], ['Checked by (Accounts)', self::ML + 68], ['Approved by', $R - 55]] as [$lab, $sx]) {
            $this->pdf->line($this->mm($sx), $this->mm($this->y), $this->mm($sx + 55), $this->mm($this->y), self::GREY, $this->mm(0.3));
            $this->font('Helvetica-Bold', 8, self::DARK); $this->t($lab, $sx, $this->y + 2);
        }
        for ($i = 0; $i < $this->pdf->pageCount(); $i++) {
            $this->pdf->setActivePage($i);
            $this->font('Helvetica', 6.8, self::GREY);
            $this->t('Petty cash ' . date('F Y', strtotime($d['from'])) . '  ·  page ' . ($i + 1) . ' of ' . $this->pdf->pageCount(), self::A4_W / 2, self::A4_H - 10, ['align' => 'center']);
        }
        return $this->pdf;
    }
}
