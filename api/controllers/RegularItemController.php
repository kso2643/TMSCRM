<?php
/**
 * Regular items per customer, and restock reminders.
 *
 * A customer's regular items come from two places:
 *   - added by hand (item, usual qty, how often, stock to keep for them)
 *   - found from their order history: anything they ordered in 2 or more
 *     orders in the last 12 months (average qty per order, average gap
 *     between orders, when the next order is expected)
 * Each regular item is checked against stock (free = total − still needed
 * on open orders). When the free stock is below what the customer usually
 * takes, it needs restocking for that company.
 *
 *   GET    /api/regular-items?customerId=          that customer's regular items with stock + status
 *   POST   /api/regular-items                      add / update one by hand { customerId, itemCode, productName, brand, usualQty, everyDays, keepQty, notes }
 *   DELETE /api/regular-items/:id                  remove a hand-added item (a found one is hidden from the list)
 *   POST   /api/regular-items/hide                 { customerId, itemCode } — not a regular item any more
 *   GET    /api/regular-items/restock?days=30       every customer's regular items that need restocking
 */
class RegularItemController
{
    private const WINDOW_DAYS = 365;

    public static function ensure(): void
    {
        ensure_schema(['CustomerRegularItem' => ['create' => "CREATE TABLE IF NOT EXISTS `CustomerRegularItem` (
  `id` VARCHAR(30) NOT NULL, `customerId` VARCHAR(30) NOT NULL, `itemCode` VARCHAR(120) NOT NULL,
  `productName` VARCHAR(255) NULL, `brand` VARCHAR(100) NULL,
  `usualQty` DECIMAL(14,2) NULL, `everyDays` INT NULL, `keepQty` DECIMAL(14,2) NULL, `notes` VARCHAR(500) NULL,
  `hidden` TINYINT(1) NOT NULL DEFAULT 0, `createdById` VARCHAR(30) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `CustomerRegularItem_cust_code` (`customerId`, `itemCode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]], 'Customer regular items');
        if (class_exists('StockLedger')) StockLedger::ensure();
    }

    public function __construct() { self::ensure(); }

    private static function num($v): ?float
    {
        $v = trim(str_replace(',', '', (string) $v));
        return $v === '' || !is_numeric($v) ? null : (float) $v;
    }

    /**
     * Regular items for the given customers (null = all customers that have any).
     * Returns rows keyed customerId => [items…], each item with stock and status.
     */
    public static function analyse(?array $customerIds = null): array
    {
        self::ensure();
        $since = date('Y-m-d', strtotime('-' . self::WINDOW_DAYS . ' days'));
        $cw = ''; $cp = [];
        if ($customerIds !== null) {
            if (!$customerIds) return [];
            $cw = ' AND o.customerId IN (' . implode(',', array_fill(0, count($customerIds), '?')) . ')';
            $cp = array_values($customerIds);
        }
        // order history: one row per customer + item code + order
        $rows = [];
        try {
            $s = db()->prepare("SELECT o.customerId, o.id AS orderId, o.orderDate, UPPER(i.itemCode) AS code, MAX(i.productName) AS productName, MAX(i.brand) AS brand, SUM(i.quantity) AS qty
                                FROM `CustomerOrderItem` i JOIN `CustomerOrder` o ON o.id=i.orderId
                                WHERE o.orderDate>=? AND i.itemCode<>'' AND i.itemCode<>'MANUAL' $cw
                                GROUP BY o.customerId, o.id, o.orderDate, UPPER(i.itemCode) ORDER BY o.orderDate");
            $s->execute(array_merge([$since], $cp));
            $rows = $s->fetchAll();
        } catch (Throwable $e) { error_log('regular analyse: ' . $e->getMessage()); }
        $hist = [];
        foreach ($rows as $r) {
            $h = &$hist[$r['customerId']][$r['code']];
            $h = $h ?? ['productName' => $r['productName'], 'brand' => $r['brand'], 'dates' => [], 'qty' => 0.0, 'orders' => 0];
            $h['orders']++; $h['qty'] += (float) $r['qty'];
            $h['dates'][] = substr($r['orderDate'], 0, 10);
            if ($r['productName']) $h['productName'] = $r['productName'];
            if ($r['brand']) $h['brand'] = $r['brand'];
            unset($h);
        }
        // hand-added (and hidden) items
        $manual = [];
        $s = db()->prepare('SELECT * FROM `CustomerRegularItem`' . ($customerIds !== null ? ' WHERE customerId IN (' . implode(',', array_fill(0, count($customerIds), '?')) . ')' : ''));
        $s->execute($customerIds !== null ? array_values($customerIds) : []);
        foreach ($s->fetchAll() as $m) $manual[$m['customerId']][strtoupper($m['itemCode'])] = $m;

        $out = []; $codes = [];
        foreach (array_unique(array_merge(array_keys($hist), array_keys($manual))) as $cid) {
            foreach (array_unique(array_merge(array_keys($hist[$cid] ?? []), array_keys($manual[$cid] ?? []))) as $code) {
                $h = $hist[$cid][$code] ?? null; $m = $manual[$cid][$code] ?? null;
                if ($m && $m['hidden']) continue;
                if (!$m && (!$h || $h['orders'] < 2)) continue; // one order is not "regular"
                $dates = $h ? array_values(array_unique($h['dates'])) : [];
                $gap = null;
                if (count($dates) >= 2) $gap = (int) round((strtotime(end($dates)) - strtotime($dates[0])) / 86400 / (count($dates) - 1));
                $every = $m && $m['everyDays'] ? (int) $m['everyDays'] : $gap;
                $last = $dates ? end($dates) : null;
                $avg = $h ? round($h['qty'] / max(1, $h['orders']), 2) : null;
                $usual = $m && $m['usualQty'] !== null ? (float) $m['usualQty'] : $avg;
                $keep = $m && $m['keepQty'] !== null ? (float) $m['keepQty'] : $usual;
                $out[$cid][] = [
                    'id' => $m['id'] ?? null, 'customerId' => $cid, 'itemCode' => $code,
                    'productName' => ($m['productName'] ?? null) ?: ($h['productName'] ?? $code), 'brand' => ($m['brand'] ?? null) ?: ($h['brand'] ?? null),
                    'source' => $m && $h ? 'BOTH' : ($m ? 'MANUAL' : 'ORDERS'),
                    'orders' => $h['orders'] ?? 0, 'totalQty' => $h ? round($h['qty'], 2) : 0, 'avgQty' => $avg,
                    'monthlyQty' => $h ? round($h['qty'] / 12, 2) : null,
                    'lastOrdered' => $last, 'everyDays' => $every, 'gapFromOrders' => $gap,
                    'nextExpected' => $last && $every ? date('Y-m-d', strtotime($last . " +$every days")) : null,
                    'usualQty' => $usual, 'keepQty' => $keep, 'notes' => $m['notes'] ?? null,
                ];
                $codes[$code] = 1;
            }
        }
        $stock = class_exists('OrderController') ? OrderController::stockFor(array_keys($codes)) : [];
        $today = date('Y-m-d');
        foreach ($out as &$list) {
            foreach ($list as &$it) {
                $st = $stock[$it['itemCode']] ?? null;
                $it['stock'] = $st;
                $need = (float) ($it['keepQty'] ?? 0);
                if (!$st) { $it['status'] = 'NOT_STOCKED'; $it['shortBy'] = $need ?: null; }
                elseif ($st['total'] <= 0) { $it['status'] = 'OUT'; $it['shortBy'] = $need ?: null; }
                elseif ($need > 0 && $st['free'] < $need) { $it['status'] = 'LOW'; $it['shortBy'] = round($need - max(0, $st['free']), 2); }
                else { $it['status'] = 'OK'; $it['shortBy'] = 0; }
                $it['dueInDays'] = $it['nextExpected'] ? (int) round((strtotime($it['nextExpected']) - strtotime($today)) / 86400) : null;
            }
            unset($it);
            usort($list, fn($a, $b) => [self::rank($a['status']), $a['dueInDays'] ?? 9999, $a['itemCode']] <=> [self::rank($b['status']), $b['dueInDays'] ?? 9999, $b['itemCode']]);
        }
        unset($list);
        return $out;
    }
    private static function rank(string $s): int { return ['OUT' => 0, 'NOT_STOCKED' => 1, 'LOW' => 2, 'OK' => 3][$s] ?? 4; }

    /** Everything that needs restocking, due within $days (or with no expected date), across customers. */
    public static function restockList(int $days = 30): array
    {
        $names = [];
        try { foreach (db()->query('SELECT id, companyName FROM `Customer`')->fetchAll() as $c) $names[$c['id']] = $c['companyName']; } catch (Throwable $e) {}
        $list = [];
        foreach (self::analyse(null) as $cid => $items) {
            if (!isset($names[$cid])) continue; // customer deleted
            foreach ($items as $it) {
                if ($it['status'] === 'OK') continue;
                if ($it['dueInDays'] !== null && $it['dueInDays'] > $days) continue;
                $it['customerName'] = $names[$cid] ?? '—';
                $list[] = $it;
            }
        }
        usort($list, fn($a, $b) => [$a['dueInDays'] ?? 9999, self::rank($a['status'])] <=> [$b['dueInDays'] ?? 9999, self::rank($b['status'])]);
        return $list;
    }

    // GET /api/regular-items?customerId=
    public function index(): void
    {
        authenticate();
        $cid = trim((string) qp('customerId', ''));
        if ($cid === '') sendError('Choose the customer.', 400);
        $c = db()->prepare('SELECT id, companyName FROM `Customer` WHERE id=?'); $c->execute([$cid]);
        $cust = $c->fetch();
        if (!$cust) sendError('Customer not found.', 404);
        $items = self::analyse([$cid])[$cid] ?? [];
        $sum = ['total' => count($items), 'restock' => count(array_filter($items, fn($i) => $i['status'] !== 'OK'))];
        sendSuccess(['customer' => $cust, 'items' => $items, 'summary' => $sum]);
    }

    // POST /api/regular-items
    public function save(): void
    {
        $auth = authenticate();
        $b = request_body();
        $cid = trim((string) ($b['customerId'] ?? ''));
        $code = strtoupper(trim((string) ($b['itemCode'] ?? '')));
        if ($cid === '') sendError('Choose the customer.', 400);
        if ($code === '') sendError('Enter the item code.', 400);
        $c = db()->prepare('SELECT id FROM `Customer` WHERE id=?'); $c->execute([$cid]);
        if (!$c->fetch()) sendError('Customer not found.', 404);
        $usual = self::num($b['usualQty'] ?? ''); $keep = self::num($b['keepQty'] ?? '');
        $every = self::num($b['everyDays'] ?? '');
        if (($usual !== null && $usual < 0) || ($keep !== null && $keep < 0) || ($every !== null && $every < 0)) sendError('Quantities and days cannot be negative.', 400);
        $name = trim((string) ($b['productName'] ?? ''));
        if ($name === '') {
            $p = db()->prepare('SELECT productName FROM `Product` WHERE itemCode=? LIMIT 1'); $p->execute([$code]);
            $name = (string) ($p->fetchColumn() ?: '');
        }
        $s = db()->prepare('SELECT id FROM `CustomerRegularItem` WHERE customerId=? AND itemCode=?'); $s->execute([$cid, $code]);
        $id = $s->fetchColumn();
        $vals = [mb_substr($name, 0, 255) ?: null, mb_substr(trim((string) ($b['brand'] ?? '')), 0, 100) ?: null, $usual, $every === null ? null : (int) $every, $keep,
                 mb_substr(trim((string) ($b['notes'] ?? '')), 0, 500) ?: null];
        if ($id) {
            db()->prepare('UPDATE `CustomerRegularItem` SET productName=?, brand=?, usualQty=?, everyDays=?, keepQty=?, notes=?, hidden=0, updatedAt=? WHERE id=?')
                ->execute(array_merge($vals, [now_sql(), $id]));
        } else {
            $id = gen_id();
            db()->prepare('INSERT INTO `CustomerRegularItem` (id,customerId,itemCode,productName,brand,usualQty,everyDays,keepQty,notes,hidden,createdById,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?)')
                ->execute(array_merge([$id, $cid, $code], $vals, [$auth['id'], now_sql(), now_sql()]));
        }
        log_activity($auth['id'], 'REGULAR_ITEM_SAVED', 'Customer', $cid, ['itemCode' => $code]);
        sendSuccess(['id' => $id], $code . ' saved as a regular item', 201);
    }

    // POST /api/regular-items/hide { customerId, itemCode }
    public function hide(): void
    {
        $auth = authenticate();
        $b = request_body();
        $cid = trim((string) ($b['customerId'] ?? '')); $code = strtoupper(trim((string) ($b['itemCode'] ?? '')));
        if ($cid === '' || $code === '') sendError('Customer and item code are needed.', 400);
        db()->prepare('INSERT INTO `CustomerRegularItem` (id,customerId,itemCode,hidden,createdById,createdAt,updatedAt) VALUES (?,?,?,1,?,?,?)
                       ON DUPLICATE KEY UPDATE hidden=1, updatedAt=VALUES(updatedAt)')
            ->execute([gen_id(), $cid, $code, $auth['id'], now_sql(), now_sql()]);
        sendSuccess([], $code . ' removed from the regular items');
    }

    // DELETE /api/regular-items/:id — a hand-added item: hidden so the order history doesn't bring it straight back
    public function delete(string $id): void
    {
        authenticate();
        $s = db()->prepare('UPDATE `CustomerRegularItem` SET hidden=1, updatedAt=? WHERE id=?');
        $s->execute([now_sql(), $id]);
        if (!$s->rowCount()) sendError('Regular item not found.', 404);
        sendSuccess([], 'Removed from the regular items');
    }

    // GET /api/regular-items/restock?days=30
    public function restock(): void
    {
        authenticate();
        $days = max(1, min(365, (int) qp('days', 30)));
        $list = self::restockList($days);
        // per item code: total needed across customers
        $byCode = [];
        foreach ($list as $it) {
            $k = $it['itemCode'];
            $byCode[$k] = $byCode[$k] ?? ['itemCode' => $k, 'productName' => $it['productName'], 'brand' => $it['brand'], 'stock' => $it['stock'], 'need' => 0.0, 'customers' => []];
            $byCode[$k]['need'] += (float) ($it['keepQty'] ?? 0);
            $byCode[$k]['customers'][] = $it['customerName'];
        }
        foreach ($byCode as &$x) { $free = $x['stock'] ? max(0, $x['stock']['free']) : 0; $x['toOrder'] = round(max(0, $x['need'] - $free), 2); }
        unset($x);
        sendSuccess(['items' => $list, 'byItem' => array_values($byCode), 'days' => $days]);
    }
}
