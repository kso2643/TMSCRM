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
        $s = db()->prepare('SELECT q.*, u.name AS updatedByName FROM `SupplierQuote` q LEFT JOIN `User` u ON u.id=COALESCE(q.updatedById, q.askedById) WHERE q.batchId=? ORDER BY q.vendorName, q.askedAt');
        $s->execute([$bid]);
        return array_map(function ($q) {
            foreach (['price', 'discount', 'netPrice'] as $k) if ($q[$k] !== null) $q[$k] = (float) $q[$k];
            return $q;
        }, $s->fetchAll());
    }

    /** The message to send the vendor, listing the items asked about. */
    private static function message(string $vendor, array $items, ?string $requestNo): string
    {
        $lines = ['Dear ' . $vendor . ',', '', 'Please send your best price, discount and delivery lead time for the following' . ($requestNo ? ' (our ref ' . $requestNo . ')' : '') . ':', ''];
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
        sendSuccess(['quotes' => self::quotes($bid), 'message' => self::message($vendorName, $pick, $items[0]['requestNo'] ?? null),
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
        db()->prepare('UPDATE `SupplierQuote` SET status=?, price=?, discount=?, netPrice=?, leadTime=?, validity=?, note=?, receivedAt=IF(?=\'RECEIVED\', COALESCE(receivedAt, ?), receivedAt), updatedById=?, updatedAt=? WHERE id=?')
            ->execute([$status, $price, $disc, $net, $lt !== '' ? mb_substr($lt, 0, 60) : null, mb_substr(trim((string) ($b['validity'] ?? '')), 0, 60) ?: null,
                       trim((string) ($b['note'] ?? '')) ?: null, $status, now_sql(), $auth['id'], now_sql(), $qid]);
        log_activity($auth['id'], 'SUPPLIER_PRICE_SAVED', 'SupplierQuote', $qid, ['vendor' => $q['vendorName'], 'price' => $price, 'discount' => $disc]);
        sendSuccess(['quotes' => self::quotes($q['batchId'])], 'Supplier price saved');
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
