<?php
/**
 * Price requests → get the price from a supplier (Admin / Super Admin).
 *
 * For a price request (batch) the admin picks a vendor and the items to ask
 * about; one SupplierQuote row is kept per vendor × item. The page shows a
 * ready message (copy / WhatsApp / e-mail) to send the vendor, and when the
 * vendor replies the admin types their price, discount and lead time
 * (editable at any time). Prices already on the vendor's price list
 * (VendorItem) are suggested straight away.
 *
 *   GET    /api/price-requests/batch/:bid/supplier      quotes + vendor price-list hits + vendors
 *   POST   /api/price-requests/batch/:bid/supplier      { vendorId | vendorName, itemIds[] } → asked rows + message
 *   PUT    /api/price-requests/supplier/:qid            { price, discount, leadTime, validity, note, status }
 *   DELETE /api/price-requests/supplier/:qid
 *   PATCH  /api/price-requests/supplier/:qid/choose     { chosen: true|false, note } — "buy from this supplier" for that item
 *                                                       (Super Admin / Admin; one per item; the others are told)
 *   GET    /api/price-requests/supplier-lookup?no=PR-…  the price request with that number (CEO Desk)
 *
 * Several suppliers can be asked for the same item (each gets its own message), so their prices
 * can be compared and one chosen.
 */
class SupplierQuoteController
{
    public static function schema(): array
    {
        return ['SupplierQuote' => ['create' => "CREATE TABLE IF NOT EXISTS `SupplierQuote` (
  `id` VARCHAR(30) NOT NULL, `batchId` VARCHAR(30) NOT NULL, `requestId` VARCHAR(30) NOT NULL,
  `vendorId` VARCHAR(30) NULL, `vendorName` VARCHAR(160) NOT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'ASKED', `price` DECIMAL(14,2) NULL, `discount` DECIMAL(6,2) NULL, `netPrice` DECIMAL(14,2) NULL,
  `leadTime` VARCHAR(60) NULL, `validity` VARCHAR(60) NULL, `note` TEXT NULL,
  `askedById` VARCHAR(30) NULL, `askedAt` DATETIME NULL, `receivedAt` DATETIME NULL, `updatedById` VARCHAR(30) NULL, `updatedAt` DATETIME NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `SupplierQuote_req_vendor` (`requestId`, `vendorName`), KEY `SupplierQuote_batch_idx` (`batchId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]];
    }

    public function __construct()
    {
        new PriceRequestController();
        ensure_schema(self::schema(), 'Supplier quotes');
        ensure_schema(['SupplierQuote' => ['create' => '', 'columns' => [
            'chosen' => 'TINYINT(1) NOT NULL DEFAULT 0', 'chosenById' => 'VARCHAR(30) NULL', 'chosenAt' => 'DATETIME NULL', 'chosenNote' => 'VARCHAR(500) NULL',
            // our selling price to the customer for this supplier's offer (v11.47) — supplier price = cost
            'customerPrice' => 'DECIMAL(14,2) NULL',
        ]]], 'Supplier choice');
    }

    private static function auth(): array
    {
        $auth = authenticate(); require_admin($auth);
        return $auth;
    }

    private static function items(string $bid): array
    {
        $s = db()->prepare('SELECT r.id, r.itemCode, r.productName, r.brand, r.quantity, r.unit, r.status, b.requestNo, c.companyName
            FROM `PriceRequest` r JOIN `PriceRequestBatch` b ON b.id=r.batchId LEFT JOIN `Customer` c ON c.id=b.customerId
            WHERE r.batchId=? ORDER BY r.sortOrder, r.id');
        $s->execute([$bid]);
        $rows = $s->fetchAll();
        if (!$rows) sendError('Price request not found.', 404);
        return $rows;
    }

    private static function quotes(string $bid): array
    {
        $s = db()->prepare('SELECT q.*, u.name AS updatedByName, cu.name AS chosenByName, cu.role AS chosenByRole FROM `SupplierQuote` q
            LEFT JOIN `User` u ON u.id=COALESCE(q.updatedById, q.askedById) LEFT JOIN `User` cu ON cu.id=q.chosenById WHERE q.batchId=? ORDER BY q.vendorName, q.askedAt');
        $s->execute([$bid]);
        return array_map(function ($q) {
            foreach (['price', 'discount', 'netPrice', 'customerPrice'] as $k) if ($q[$k] !== null) $q[$k] = (float) $q[$k];
            $q['chosen'] = !empty($q['chosen']);
            return $q;
        }, $s->fetchAll());
    }

    /** The message to send the vendor, listing the items asked about. */
    private static function message(string $vendor, array $items, ?string $requestNo, ?string $customer = null): string
    {
        $lines = ['Dear ' . $vendor . ',', '', 'Please send your best price, discount and delivery lead time for the following' . ($requestNo ? ' (our ref ' . $requestNo . ')' : '') . ':'];
        if ($customer) $lines[] = 'Customer: ' . $customer;
        $lines[] = '';
        foreach (array_values($items) as $i => $it) {
            $q = $it['quantity'] !== null ? rtrim(rtrim(number_format((float) $it['quantity'], 2, '.', ''), '0'), '.') . ' ' . ($it['unit'] ?: 'Nos') : '';
            $lines[] = ($i + 1) . '. ' . trim(($it['itemCode'] ? $it['itemCode'] . ' — ' : '') . $it['productName'] . ($it['brand'] ? ' (' . $it['brand'] . ')' : '')) . ($q ? ' — Qty ' . $q : '');
        }
        $lines[] = ''; $lines[] = 'Thank you.';
        return implode("\n", $lines);
    }

    // GET /api/price-requests/batch/:bid/supplier
    public function index(string $bid): void
    {
        self::auth();
        $items = self::items($bid);
        // Known prices on vendors' price lists for these item codes.
        $codes = array_values(array_unique(array_filter(array_map(fn($i) => strtoupper((string) $i['itemCode']), $items))));
        $known = [];
        if ($codes) {
            try {
                $in = implode(',', array_fill(0, count($codes), '?'));
                $s = db()->prepare("SELECT vi.itemCode, vi.price, vi.discount, vi.netPrice, vi.leadTime, vi.stockQty, vi.updatedAt, v.id AS vendorId, v.name AS vendorName
                    FROM `VendorItem` vi JOIN `Vendor` v ON v.id=vi.vendorId WHERE UPPER(vi.itemCode) IN ($in) AND v.isActive=1 ORDER BY COALESCE(vi.netPrice, vi.price)");
                $s->execute($codes);
                foreach ($s->fetchAll() as $r) $known[strtoupper($r['itemCode'])][] = $r;
            } catch (PDOException $e) { /* vendors module not set up yet */ }
        }
        $vendors = [];
        try { $vendors = db()->query('SELECT id, name, brands, phone, email, contactPerson FROM `Vendor` WHERE isActive=1 ORDER BY name')->fetchAll(); } catch (PDOException $e) {}
        sendSuccess(['items' => $items, 'quotes' => self::quotes($bid), 'priceList' => $known, 'vendors' => $vendors]);
    }

    // POST /api/price-requests/batch/:bid/supplier
    public function ask(string $bid): void
    {
        $auth = self::auth();
        $items = self::items($bid);
        $b = request_body();
        $vendorId = trim((string) ($b['vendorId'] ?? '')); $vendorName = trim((string) ($b['vendorName'] ?? ''));
        $vendor = null;
        if ($vendorId !== '') {
            try { $s = db()->prepare('SELECT id, name, phone, email FROM `Vendor` WHERE id=?'); $s->execute([$vendorId]); $vendor = $s->fetch() ?: null; } catch (PDOException $e) {}
            if (!$vendor) sendError('Vendor not found.', 404);
            $vendorName = $vendor['name'];
        }
        if ($vendorName === '') sendError('Choose the supplier (or type the supplier name).', 400);
        $ids = array_map('strval', (array) ($b['itemIds'] ?? []));
        $pick = $ids ? array_values(array_filter($items, fn($i) => in_array($i['id'], $ids, true))) : $items;
        if (!$pick) sendError('Choose the items to ask the supplier about.', 400);
        $ins = db()->prepare("INSERT INTO `SupplierQuote` (id,batchId,requestId,vendorId,vendorName,status,askedById,askedAt,updatedAt) VALUES (?,?,?,?,?,'ASKED',?,?,?)
                              ON DUPLICATE KEY UPDATE askedAt=VALUES(askedAt), askedById=VALUES(askedById)");
        foreach ($pick as $it) $ins->execute([gen_id(), $bid, $it['id'], $vendor['id'] ?? null, mb_substr($vendorName, 0, 160), $auth['id'], now_sql(), now_sql()]);
        log_activity($auth['id'], 'SUPPLIER_PRICE_ASKED', 'PriceRequestBatch', $bid, ['vendor' => $vendorName, 'items' => count($pick)]);
        sendSuccess(['quotes' => self::quotes($bid), 'message' => self::message($vendorName, $pick, $items[0]['requestNo'] ?? null, $items[0]['companyName'] ?? null),
                     'customer' => $items[0]['companyName'] ?? null,
                     'vendor' => ['name' => $vendorName, 'phone' => $vendor['phone'] ?? null, 'email' => $vendor['email'] ?? null]],
                    'Supplier request ready — send the message to ' . $vendorName, 201);
    }

    // PUT /api/price-requests/supplier/:qid — record / edit the supplier's price
    public function update(string $qid): void
    {
        $auth = self::auth();
        $s = db()->prepare('SELECT * FROM `SupplierQuote` WHERE id=?'); $s->execute([$qid]);
        $q = $s->fetch();
        if (!$q) sendError('Supplier quote not found.', 404);
        $b = request_body();
        $num = function ($v, string $what, float $max = 1e12) {
            $v = str_replace([',', '₹', '%', ' '], '', (string) ($v ?? ''));
            if ($v === '') return null;
            if (!is_numeric($v) || (float) $v < 0 || (float) $v > $max) sendError("Enter a valid $what.", 400);
            return round((float) $v, 2);
        };
        $price = $num($b['price'] ?? null, 'price'); $disc = $num($b['discount'] ?? null, 'discount (0–100 %)', 100);
        $net = $price !== null ? round($price * (1 - ($disc ?? 0) / 100), 2) : null;
        $status = strtoupper((string) ($b['status'] ?? ''));
        if (!in_array($status, ['ASKED', 'RECEIVED', 'NO_QUOTE'], true)) $status = $price !== null ? 'RECEIVED' : $q['status'];
        $lt = trim((string) ($b['leadTime'] ?? '')); if ($lt !== '' && is_numeric($lt)) $lt .= ' days';
        // customer price: keep the old one when the field is not sent (e.g. "No quote")
        $cust = array_key_exists('customerPrice', $b) ? $num($b['customerPrice'], 'customer price') : ($q['customerPrice'] !== null ? (float) $q['customerPrice'] : null);
        db()->prepare('UPDATE `SupplierQuote` SET status=?, price=?, discount=?, netPrice=?, customerPrice=?, leadTime=?, validity=?, note=?, receivedAt=IF(?=\'RECEIVED\', COALESCE(receivedAt, ?), receivedAt), updatedById=?, updatedAt=? WHERE id=?')
            ->execute([$status, $price, $disc, $net, $cust, $lt !== '' ? mb_substr($lt, 0, 60) : null, mb_substr(trim((string) ($b['validity'] ?? '')), 0, 60) ?: null,
                       trim((string) ($b['note'] ?? '')) ?: null, $status, now_sql(), $auth['id'], now_sql(), $qid]);
        log_activity($auth['id'], 'SUPPLIER_PRICE_SAVED', 'SupplierQuote', $qid, ['vendor' => $q['vendorName'], 'price' => $price, 'discount' => $disc, 'customerPrice' => $cust]);
        sendSuccess(['quotes' => self::quotes($q['batchId'])], 'Supplier price saved');
    }

    // PATCH /api/price-requests/supplier/:qid/choose
    public function choose(string $qid): void
    {
        $auth = self::auth();
        if (!in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('Only the Super Admin or an Admin can choose the supplier.', 403);
        $s = db()->prepare('SELECT q.*, r.itemCode, r.productName, b.requestNo, b.requestedById FROM `SupplierQuote` q
            JOIN `PriceRequest` r ON r.id=q.requestId JOIN `PriceRequestBatch` b ON b.id=q.batchId WHERE q.id=?');
        $s->execute([$qid]);
        $q = $s->fetch();
        if (!$q) sendError('Supplier quote not found.', 404);
        $b = request_body();
        $on = !array_key_exists('chosen', $b) || !empty($b['chosen']);
        $note = mb_substr(trim((string) ($b['note'] ?? '')), 0, 500) ?: null;
        $pdo = db();
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE `SupplierQuote` SET chosen=0, chosenById=NULL, chosenAt=NULL, chosenNote=NULL WHERE requestId=?')->execute([$q['requestId']]);
        if ($on) $pdo->prepare('UPDATE `SupplierQuote` SET chosen=1, chosenById=?, chosenAt=?, chosenNote=? WHERE id=?')->execute([$auth['id'], now_sql(), $note, $qid]);
        $pdo->commit();
        $item = trim(($q['itemCode'] ? $q['itemCode'] . ' ' : '') . $q['productName']);
        log_activity($auth['id'], $on ? 'SUPPLIER_CHOSEN' : 'SUPPLIER_UNCHOSEN', 'SupplierQuote', $qid, ['vendor' => $q['vendorName'], 'item' => $item, 'requestNo' => $q['requestNo']]);
        // Tell the other deciders (CEO → admins, admin → Super Admin) and the engineer who asked.
        try {
            ChangeNotice::ensure();
            $who = db()->prepare('SELECT name FROM `User` WHERE id=?'); $who->execute([$auth['id']]); $name = (string) $who->fetchColumn();
            $to = db()->prepare("SELECT id FROM `User` WHERE isActive=1 AND id<>? AND role IN ('SUPER_ADMIN','ADMIN')"); $to->execute([$auth['id']]);
            $ids = array_unique(array_merge($to->fetchAll(PDO::FETCH_COLUMN), $q['requestedById'] && $q['requestedById'] !== $auth['id'] ? [$q['requestedById']] : []));
            $title = mb_substr(($on ? '✔ ' . $name . ' chose ' . $q['vendorName'] : '↺ ' . $name . ' cleared the supplier') . ' for ' . $item, 0, 255);
            $body = mb_substr(($q['requestNo'] ?? '') . ($on && $q['netPrice'] !== null ? ' · ₹' . number_format((float) $q['netPrice'], 2) . ' net' : '') . ($note ? ' · ' . $note : ''), 0, 500);
            $ins = db()->prepare('INSERT INTO `ChangeNotice` (id,userId,byId,title,body,link,createdAt) VALUES (?,?,?,?,?,?,?)');
            $link = '/price-requests/?q=' . rawurlencode((string) $q['requestNo']);
            $to->execute([$auth['id']]); $deciders = $to->fetchAll(PDO::FETCH_COLUMN);
            foreach ($ids as $u) {
                // Supplier names and supplier prices are for the Super Admin / Admin only — the engineer is just told it is moving.
                if (in_array($u, $deciders, true)) $ins->execute([gen_id(), $u, $auth['id'], $title, $body, $link, now_sql()]);
                elseif ($on) $ins->execute([gen_id(), $u, $auth['id'], mb_substr('⏳ Supplier fixed for ' . $item . ' — price coming soon', 0, 255), (string) ($q['requestNo'] ?? ''), $link, now_sql()]);
            }
        } catch (Throwable $e) { error_log('Supplier choice notice: ' . $e->getMessage()); }
        sendSuccess(['quotes' => self::quotes($q['batchId'])], $on ? $q['vendorName'] . ' chosen for ' . $item : 'Choice cleared');
    }

    // POST /api/price-requests/batch/:bid/raise-po  { supplier?: "name" }
    // Approved items with a supplier (and no PO yet) → one purchase order per supplier, in the PO format
    // (TMS / APJ letterhead), at the supplier price. Super Admin / Admin.
    public function raisePo(string $bid): void
    {
        $auth = self::auth();
        $b = request_body();
        $only = mb_strtolower(trim((string) ($b['supplier'] ?? '')));
        $s = db()->prepare("SELECT r.*, b.requestNo, b.firm, b.customerId AS batchCustomerId, c.companyName FROM `PriceRequest` r JOIN `PriceRequestBatch` b ON b.id=r.batchId
            LEFT JOIN `Customer` c ON c.id=b.customerId WHERE r.batchId=? ORDER BY r.sortOrder, r.id");
        $s->execute([$bid]);
        $rows = $s->fetchAll();
        if (!$rows) sendError('Price request not found.', 404);
        $poCtrl = new PurchaseOrderController();
        $exists = db()->prepare('SELECT 1 FROM `PurchaseOrder` WHERE id=?');
        $groups = [];
        foreach ($rows as $r) {
            if ($r['status'] !== 'APPROVED' || trim((string) $r['supplierName']) === '') continue;
            if ($r['poId']) { $exists->execute([$r['poId']]); if ($exists->fetchColumn()) continue; }   // already on a PO
            $k = mb_strtolower(trim((string) $r['supplierName']));
            if ($only !== '' && $k !== $only) continue;
            $groups[$k][] = $r;
        }
        if (!$groups) sendError($only !== '' ? 'Nothing left to order from that supplier.' : 'No approved items with a supplier are waiting for a PO. Approve the prices first.', 400);
        $quote = db()->prepare('SELECT * FROM `SupplierQuote` WHERE requestId=? AND LOWER(vendorName)=? ORDER BY chosen DESC, updatedAt DESC LIMIT 1');
        $vend = db()->prepare('SELECT * FROM `Vendor` WHERE LOWER(name)=? AND isActive=1 LIMIT 1');
        $mark = db()->prepare('UPDATE `PriceRequest` SET poId=? WHERE id=?');
        $made = [];
        foreach ($groups as $k => $list) {
            $vendor = null;
            try { $vend->execute([$k]); $vendor = $vend->fetch() ?: null; } catch (PDOException $e) {}
            $items = []; $qdate = null;
            foreach ($list as $r) {
                $q = null;
                try { $quote->execute([$r['id'], $k]); $q = $quote->fetch() ?: null; } catch (PDOException $e) {}
                // the supplier's own rate and discount when we have them; otherwise the supplier price saved on the item
                $rate = $q && $q['price'] !== null ? (float) $q['price'] : ($r['supplierPrice'] !== null ? (float) $r['supplierPrice'] : null);
                $disc = $q && $q['price'] !== null && $q['discount'] !== null ? (float) $q['discount'] : null;
                if ($q && $q['receivedAt'] && (!$qdate || $q['receivedAt'] > $qdate)) $qdate = $q['receivedAt'];
                $items[] = ['itemCode' => $r['itemCode'], 'description' => $r['productName'], 'brand' => $r['brand'], 'quantity' => $r['quantity'] !== null && (float) $r['quantity'] > 0 ? (float) $r['quantity'] : 1,
                            'unit' => $r['unit'] ?: 'Nos', 'unitPrice' => $rate, 'discount' => $disc, 'delivery' => ($q['leadTime'] ?? null) ?: $r['approvedLeadTime'], 'customerName' => $r['companyName']];
            }
            $first = $list[0];
            $po = $poCtrl->createRecord([
                'company' => $first['firm'] ?: 'TMS', 'vendorId' => $vendor['id'] ?? null, 'vendorName' => $vendor['name'] ?? trim((string) $first['supplierName']),
                'poDate' => date('Y-m-d'), 'quoteDate' => $qdate ? substr($qdate, 0, 10) : null,
                'subject' => 'Purchase order against our ref ' . $first['requestNo'] . ($first['companyName'] ? ' — ' . $first['companyName'] : ''),
                'gstPercent' => 18, 'paymentTerms' => '30 days', 'freight' => 'Door delivery', 'status' => 'DRAFT',
                // delivered to us (our address + GSTIN, filled by the PO); the customer it is for, with their GSTIN
                'customerId' => $first['batchCustomerId'] ?: ($first['customerId'] ?? null),
                'signName' => $auth['name'] ?? '', 'items' => $items,
            ], $auth);
            foreach ($list as $r) $mark->execute([$po['id'], $r['id']]);
            log_activity($auth['id'], 'PO_RAISED_FROM_PRICE_REQUEST', 'PriceRequestBatch', $bid, ['poNumber' => $po['poNumber'], 'vendor' => $po['vendorName'], 'items' => count($list)]);
            $made[] = ['id' => $po['id'], 'poNumber' => $po['poNumber'], 'vendorName' => $po['vendorName'], 'items' => count($list), 'totalAmount' => (float) $po['totalAmount']];
        }
        sendSuccess(['orders' => $made], count($made) === 1 ? 'Purchase order ' . $made[0]['poNumber'] . ' raised to ' . $made[0]['vendorName'] : count($made) . ' purchase orders raised', 201);
    }

    // GET /api/price-requests/supplier-lookup?no=PR-2611-0005-JK
    public function lookup(): void
    {
        self::auth();
        $no = strtoupper(trim((string) qp('no', '')));
        if ($no === '') sendError('Type the price request number (e.g. PR-2611-0005-JK).', 400);
        $s = db()->prepare('SELECT b.id, b.requestNo, b.firm, b.createdAt, b.requestedById, c.companyName, u.name AS engineerName FROM `PriceRequestBatch` b
            LEFT JOIN `Customer` c ON c.id=b.customerId LEFT JOIN `User` u ON u.id=b.requestedById WHERE UPPER(b.requestNo)=? LIMIT 1');
        $s->execute([$no]);
        $b = $s->fetch();
        if (!$b) {   // let them type it without the initials: PR-2611-0005
            $s = db()->prepare('SELECT b.id, b.requestNo, b.firm, b.createdAt, b.requestedById, c.companyName, u.name AS engineerName FROM `PriceRequestBatch` b
                LEFT JOIN `Customer` c ON c.id=b.customerId LEFT JOIN `User` u ON u.id=b.requestedById WHERE UPPER(b.requestNo) LIKE ? ORDER BY b.createdAt DESC LIMIT 1');
            $s->execute([$no . '-%']);
            $b = $s->fetch();
        }
        if (!$b) sendError("No price request $no.", 404);
        sendSuccess(['batch' => $b]);
    }

    // DELETE /api/price-requests/supplier/:qid
    public function delete(string $qid): void
    {
        self::auth();
        $s = db()->prepare('SELECT batchId FROM `SupplierQuote` WHERE id=?'); $s->execute([$qid]);
        $bid = $s->fetchColumn();
        if (!$bid) sendError('Supplier quote not found.', 404);
        db()->prepare('DELETE FROM `SupplierQuote` WHERE id=?')->execute([$qid]);
        sendSuccess(['quotes' => self::quotes($bid)], 'Removed');
    }
}
