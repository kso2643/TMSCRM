<?php
/**
 * Sales report by engineer — how much each engineer got (orders) and how much
 * was made (delivered / billed), from the Orders page plus manual entries.
 *
 *   Orders: every CustomerOrder in the period counts for its engineer — number
 *   of orders, order value (CustomerOrder.orderValue, typed on the order or
 *   here), item quantity ordered and supplied, delivered orders and their value.
 *   Manual entries (SalesEntry): orders / billing that are not in the Orders
 *   page (old orders, phone orders, direct billing) — engineer, date, customer,
 *   reference, order value, billed value, quantity, note.
 *
 * Admins / managers see everyone; other users see only themselves.
 *
 *   GET    /api/sales-report?from=&to=&engineerId=    summary per engineer + orders + manual entries
 *   PATCH  /api/sales-report/orders/:id               { orderValue }
 *   POST   /api/sales-report/entries                  manual entry
 *   PUT    /api/sales-report/entries/:id
 *   DELETE /api/sales-report/entries/:id
 *   POST   /api/sales-report/import                  Excel / CSV of tax invoices: Engineer, Tax invoice date,
 *                                                    Tax invoice no, Customer, Sales value, Order value, Qty, Note
 *
 * A manual entry is usually a tax invoice: date = tax invoice date, reference =
 * tax invoice no., billed value = sales value (before tax), engineer = who made the sale.
 */
class SalesReportController
{
    public function __construct()
    {
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        ensure_schema([
            'CustomerOrder' => ['create' => '', 'columns' => ['orderValue' => 'DECIMAL(14,2) NULL']],
            'SalesEntry' => ['create' => "CREATE TABLE IF NOT EXISTS `SalesEntry` (
  `id` VARCHAR(30) NOT NULL, `engineerId` VARCHAR(30) NOT NULL, `entryDate` DATE NOT NULL,
  `customerName` VARCHAR(255) NULL, `reference` VARCHAR(120) NULL,
  `orderValue` DECIMAL(14,2) NULL, `billedValue` DECIMAL(14,2) NULL, `quantity` DECIMAL(14,2) NULL, `note` TEXT NULL,
  `createdById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NULL,
  PRIMARY KEY (`id`), KEY `SalesEntry_eng` (`engineerId`), KEY `SalesEntry_date` (`entryDate`)
$tail"],
        ], 'Sales report');
    }

    private static function seesAll(array $auth): bool { return is_admin_tier($auth['role']); }

    private static function money($v, string $what): ?float
    {
        $v = str_replace([',', '₹', ' '], '', (string) ($v ?? ''));
        if ($v === '') return null;
        if (!is_numeric($v) || (float) $v < 0) sendError("Enter the $what as a number.", 400);
        return round((float) $v, 2);
    }

    /** [from, to] from the query — default: this month. */
    private static function period(): array
    {
        $from = to_date_only(qp('from', '')) ?: date('Y-m-01');
        $to = to_date_only(qp('to', '')) ?: date('Y-m-t');
        if ($to < $from) [$from, $to] = [$to, $from];
        return [$from, $to];
    }

    // GET /api/sales-report
    public function index(): void
    {
        $auth = authenticate();
        [$from, $to] = self::period();
        $all = self::seesAll($auth);
        $eng = $all ? trim((string) qp('engineerId', '')) : $auth['id'];

        $w = 'o.orderDate BETWEEN ? AND ?'; $p = [$from, $to];
        if ($eng !== '') { $w .= ' AND o.engineerId=?'; $p[] = $eng; }
        $s = db()->prepare("SELECT o.id, o.orderDate, o.orderType, o.deliveryStatus, o.deliveredDate, o.orderValue, o.engineerId,
                c.companyName AS customerName, u.name AS engineerName,
                (SELECT COUNT(*) FROM `CustomerOrderItem` i WHERE i.orderId=o.id) AS itemCount,
                (SELECT COALESCE(SUM(i.quantity),0) FROM `CustomerOrderItem` i WHERE i.orderId=o.id) AS qty,
                (SELECT COALESCE(SUM(CASE WHEN i.suppliedQty IS NOT NULL THEN i.suppliedQty WHEN i.supplied=1 THEN i.quantity ELSE 0 END),0) FROM `CustomerOrderItem` i WHERE i.orderId=o.id) AS suppliedQty
            FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId LEFT JOIN `User` u ON u.id=o.engineerId
            WHERE $w ORDER BY o.orderDate DESC, o.createdAt DESC LIMIT 2000");
        $s->execute($p);
        $orders = array_map(function ($r) {
            foreach (['orderValue'] as $k) $r[$k] = $r[$k] === null ? null : (float) $r[$k];
            $r['itemCount'] = (int) $r['itemCount']; $r['qty'] = (float) $r['qty']; $r['suppliedQty'] = (float) $r['suppliedQty'];
            return $r;
        }, $s->fetchAll());

        $w = 'e.entryDate BETWEEN ? AND ?'; $p = [$from, $to];
        if ($eng !== '') { $w .= ' AND e.engineerId=?'; $p[] = $eng; }
        $s = db()->prepare("SELECT e.*, u.name AS engineerName, cb.name AS createdByName FROM `SalesEntry` e
            LEFT JOIN `User` u ON u.id=e.engineerId LEFT JOIN `User` cb ON cb.id=e.createdById WHERE $w ORDER BY e.entryDate DESC, e.createdAt DESC LIMIT 2000");
        $s->execute($p);
        $entries = array_map(function ($r) {
            foreach (['orderValue', 'billedValue', 'quantity'] as $k) $r[$k] = $r[$k] === null ? null : (float) $r[$k];
            return $r;
        }, $s->fetchAll());

        // engineers to show: every sales person (so 0s show too), or just me
        if ($all) {
            $us = db()->query("SELECT id, name, role FROM `User` WHERE isActive=1 AND role IN ('SALES_ENGINEER','SALES','MANAGER','ADMIN','SUPER_ADMIN') ORDER BY FIELD(role,'SALES_ENGINEER','SALES','MANAGER','ADMIN','SUPER_ADMIN'), name")->fetchAll();
        } else {
            $us = [['id' => $auth['id'], 'name' => $auth['name'] ?? 'Me', 'role' => $auth['role']]];
        }
        $sum = [];
        $blank = fn($id, $name, $role) => ['engineerId' => $id, 'name' => $name, 'role' => $role, 'orders' => 0, 'orderValue' => 0.0, 'unpricedOrders' => 0,
            'qty' => 0.0, 'suppliedQty' => 0.0, 'delivered' => 0, 'deliveredValue' => 0.0,
            'manualCount' => 0, 'manualOrderValue' => 0.0, 'manualBilled' => 0.0, 'manualQty' => 0.0];
        foreach ($us as $u) $sum[$u['id']] = $blank($u['id'], $u['name'], $u['role']);
        foreach ($orders as $o) {
            $k = $o['engineerId'];
            $sum[$k] ??= $blank($k, $o['engineerName'] ?: '—', '');
            $x = &$sum[$k];
            $x['orders']++; $x['qty'] += $o['qty']; $x['suppliedQty'] += $o['suppliedQty'];
            if ($o['orderValue'] === null) $x['unpricedOrders']++; else $x['orderValue'] += $o['orderValue'];
            if ($o['deliveryStatus'] === 'DELIVERED') { $x['delivered']++; $x['deliveredValue'] += $o['orderValue'] ?? 0; }
            elseif ($o['deliveryStatus'] === 'PARTIALLY_DELIVERED' && $o['qty'] > 0 && $o['orderValue'] !== null) $x['deliveredValue'] += round($o['orderValue'] * min(1, $o['suppliedQty'] / $o['qty']), 2);
            unset($x);
        }
        foreach ($entries as $e) {
            $k = $e['engineerId'];
            $sum[$k] ??= $blank($k, $e['engineerName'] ?: '—', '');
            $sum[$k]['manualCount']++; $sum[$k]['manualOrderValue'] += $e['orderValue'] ?? 0; $sum[$k]['manualBilled'] += $e['billedValue'] ?? 0; $sum[$k]['manualQty'] += $e['quantity'] ?? 0;
        }
        foreach ($sum as &$x) {
            $x['totalGot'] = round($x['orderValue'] + $x['manualOrderValue'], 2);
            $x['totalMade'] = round($x['deliveredValue'] + $x['manualBilled'], 2);
            $x['totalOrders'] = $x['orders'] + $x['manualCount'];
        }
        unset($x);
        $rows = array_values(array_filter($sum, fn($x) => $eng === '' || $x['engineerId'] === $eng));
        usort($rows, fn($a, $b) => $b['totalGot'] <=> $a['totalGot'] ?: $b['totalOrders'] <=> $a['totalOrders'] ?: strcmp($a['name'], $b['name']));

        sendSuccess(['from' => $from, 'to' => $to, 'seesAll' => $all, 'me' => $auth['id'], 'engineers' => $all ? $us : [],
            'summary' => $rows, 'orders' => $orders, 'entries' => $entries]);
    }

    // PATCH /api/sales-report/orders/:id — set the order value
    public function setOrderValue(string $id): void
    {
        $auth = authenticate();
        $s = db()->prepare('SELECT id, engineerId FROM `CustomerOrder` WHERE id=?'); $s->execute([$id]);
        $o = $s->fetch();
        if (!$o) sendError('Order not found.', 404);
        if (!self::seesAll($auth) && $o['engineerId'] !== $auth['id']) sendError('You can set the value only on your own orders.', 403);
        $v = self::money(request_body()['orderValue'] ?? null, 'order value');
        db()->prepare('UPDATE `CustomerOrder` SET orderValue=?, updatedAt=? WHERE id=?')->execute([$v, now_sql(), $id]);
        log_activity($auth['id'], 'ORDER_VALUE_SET', 'CustomerOrder', $id, ['orderValue' => $v]);
        sendSuccess(['id' => $id, 'orderValue' => $v], 'Order value saved');
    }

    private static function entryFields(array $auth, array $b): array
    {
        $eng = trim((string) ($b['engineerId'] ?? '')) ?: $auth['id'];
        if ($eng !== $auth['id'] && !self::seesAll($auth)) sendError('You can add entries only for yourself.', 403);
        $chk = db()->prepare('SELECT id FROM `User` WHERE id=?'); $chk->execute([$eng]);
        if (!$chk->fetch()) sendError('Pick the engineer.', 400);
        $date = to_date_only($b['entryDate'] ?? null);
        if (!$date) sendError('Enter the tax invoice date.', 400);
        $ov = self::money($b['orderValue'] ?? null, 'order value');
        $bv = self::money($b['billedValue'] ?? null, 'billed value');
        $qty = self::money($b['quantity'] ?? null, 'quantity');
        if ($ov === null && $bv === null && $qty === null) sendError('Enter the sales value (or the order value / quantity).', 400);
        return [$eng, $date, mb_substr(trim((string) ($b['customerName'] ?? '')), 0, 255) ?: null, mb_substr(trim((string) ($b['reference'] ?? '')), 0, 120) ?: null,
            $ov, $bv, $qty, trim((string) ($b['note'] ?? '')) ?: null];
    }

    private static function loadEntry(array $auth, string $id): array
    {
        $s = db()->prepare('SELECT * FROM `SalesEntry` WHERE id=?'); $s->execute([$id]);
        $e = $s->fetch();
        if (!$e) sendError('Entry not found.', 404);
        if (!self::seesAll($auth) && $e['engineerId'] !== $auth['id'] && $e['createdById'] !== $auth['id']) sendError('You can change only your own entries.', 403);
        return $e;
    }

    // POST /api/sales-report/entries
    public function createEntry(): void
    {
        $auth = authenticate();
        $f = self::entryFields($auth, request_body());
        $id = gen_id();
        db()->prepare('INSERT INTO `SalesEntry` (id,engineerId,entryDate,customerName,reference,orderValue,billedValue,quantity,note,createdById,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            ->execute(array_merge([$id], $f, [$auth['id'], now_sql()]));
        log_activity($auth['id'], 'SALES_ENTRY_ADDED', 'SalesEntry', $id, ['orderValue' => $f[4], 'billedValue' => $f[5]]);
        sendSuccess(['id' => $id], 'Entry added', 201);
    }

    // PUT /api/sales-report/entries/:id
    public function updateEntry(string $id): void
    {
        $auth = authenticate();
        self::loadEntry($auth, $id);
        $f = self::entryFields($auth, request_body());
        db()->prepare('UPDATE `SalesEntry` SET engineerId=?,entryDate=?,customerName=?,reference=?,orderValue=?,billedValue=?,quantity=?,note=?,updatedAt=? WHERE id=?')
            ->execute(array_merge($f, [now_sql(), $id]));
        sendSuccess(['id' => $id], 'Entry saved');
    }

    /** "15-10-2026", "15/10/26", "2026-10-15" or an Excel day number → Y-m-d (Indian day-first order). */
    private static function anyDate($v): ?string
    {
        $v = trim((string) $v);
        if ($v === '') return null;
        if (is_numeric($v) && (float) $v > 20000 && (float) $v < 80000) return gmdate('Y-m-d', (int) round(((float) $v - 25569) * 86400));
        if (preg_match('~^(\d{4})-(\d{1,2})-(\d{1,2})~', $v, $m)) return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]) : null;
        if (preg_match('~^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$~', $v, $m)) {
            $y = (int) $m[3]; if ($y < 100) $y += 2000;
            return checkdate((int) $m[2], (int) $m[1], $y) ? sprintf('%04d-%02d-%02d', $y, $m[2], $m[1]) : null;
        }
        $t = strtotime($v);
        return $t ? date('Y-m-d', $t) : null;
    }

    // POST /api/sales-report/import — rows of tax invoices (admins: any engineer; engineers: their own)
    public function import(): void
    {
        $auth = authenticate();
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('Choose the Excel / CSV file.', 400);
        try {
            $rows = preg_match('/\.csv$/i', (string) $f['name'])
                ? array_map(fn($l) => str_getcsv(preg_replace('/^\xEF\xBB\xBF/', '', $l)), file($f['tmp_name'], FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES))
                : XlsxReader::readFirstSheetRows($f['tmp_name']);
        } catch (Throwable $e) { sendError('Could not read the file: ' . $e->getMessage(), 400); }
        // find the heading row (first row with an "invoice"/"date" and a "value"/"amount" column)
        $col = []; $start = 0;
        foreach (array_slice($rows, 0, 10) as $ri => $r) {
            $h = array_map(fn($x) => strtolower(trim((string) $x)), (array) $r);
            $find = function (array $words, array $not = []) use ($h) { foreach ($h as $i => $x) { foreach ($words as $w) if ($x !== '' && str_contains($x, $w)) { foreach ($not as $n) if (str_contains($x, $n)) continue 3; return $i; } } return null; };
            $c = ['eng' => $find(['engineer', 'sales person', 'salesman', 'executive']), 'date' => $find(['invoice date', 'inv date', 'inv. date', 'date']),
                  'no' => $find(['invoice no', 'inv no', 'inv. no', 'invoice number', 'bill no', 'reference', 'ref']),
                  'cust' => $find(['customer', 'party', 'company', 'client']), 'sales' => $find(['sales value', 'taxable', 'invoice value', 'billed', 'sales', 'amount', 'value'], ['order', 'person', 'engineer', 'salesman', 'executive']),
                  'order' => $find(['order value', 'order']), 'qty' => $find(['qty', 'quantity', 'nos']), 'note' => $find(['note', 'remark'])];
            if ($c['date'] !== null && ($c['sales'] !== null || $c['order'] !== null)) { $col = $c; $start = $ri + 1; break; }
        }
        if (!$col) sendError('The first row must have the headings: Engineer, Tax invoice date, Tax invoice no, Customer, Sales value (optional: Order value, Qty, Note).', 400);
        $users = db()->query('SELECT id, name, email FROM `User`')->fetchAll();
        $byName = []; foreach ($users as $u) { $byName[mb_strtolower(trim($u['name']))] = $u['id']; $byName[mb_strtolower(trim($u['email']))] = $u['id']; }
        $all = self::seesAll($auth);
        $ins = db()->prepare('INSERT INTO `SalesEntry` (id,engineerId,entryDate,customerName,reference,orderValue,billedValue,quantity,note,createdById,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        $dup = db()->prepare('SELECT COUNT(*) FROM `SalesEntry` WHERE engineerId=? AND reference=? AND entryDate=?');
        $done = 0; $skipped = 0; $errors = [];
        $get = fn($r, $k) => $col[$k] === null ? '' : trim((string) ($r[$col[$k]] ?? ''));
        $num = function ($v) { $v = str_replace([',', '₹', ' ', 'Rs.', 'Rs'], '', (string) $v); return $v === '' || !is_numeric($v) ? null : round((float) $v, 2); };
        foreach (array_slice($rows, $start) as $i => $r) {
            $line = $start + $i + 1;
            if (!array_filter((array) $r, fn($x) => trim((string) $x) !== '')) continue;
            $date = self::anyDate($get($r, 'date'));
            $sales = $num($get($r, 'sales')); $ord = $num($get($r, 'order')); $qty = $num($get($r, 'qty'));
            if (!$date) { $errors[] = "Row $line: tax invoice date missing or not a date"; continue; }
            if ($sales === null && $ord === null) { $errors[] = "Row $line: no sales value"; continue; }
            $engName = $get($r, 'eng');
            if ($all) {
                $eng = $engName === '' ? $auth['id'] : ($byName[mb_strtolower($engName)] ?? null);
                if (!$eng) { $errors[] = "Row $line: engineer \"$engName\" not found"; continue; }
            } else $eng = $auth['id'];
            $ref = mb_substr($get($r, 'no'), 0, 120) ?: null;
            if ($ref) { $dup->execute([$eng, $ref, $date]); if ((int) $dup->fetchColumn() > 0) { $skipped++; continue; } }
            $ins->execute([gen_id(), $eng, $date, mb_substr($get($r, 'cust'), 0, 255) ?: null, $ref, $ord, $sales, $qty, $get($r, 'note') ?: null, $auth['id'], now_sql()]);
            $done++;
        }
        log_activity($auth['id'], 'SALES_ENTRY_IMPORT', 'SalesEntry', null, ['rows' => $done]);
        sendSuccess(['saved' => $done, 'skipped' => $skipped, 'errors' => array_slice($errors, 0, 30)],
            "$done invoice" . ($done === 1 ? '' : 's') . ' imported' . ($skipped ? ", $skipped already there" : '') . ($errors ? ', ' . count($errors) . ' row(s) skipped' : ''));
    }

    // DELETE /api/sales-report/entries/:id
    public function deleteEntry(string $id): void
    {
        $auth = authenticate();
        self::loadEntry($auth, $id);
        db()->prepare('DELETE FROM `SalesEntry` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'SALES_ENTRY_DELETED', 'SalesEntry', $id);
        sendSuccess([], 'Entry deleted');
    }
}
