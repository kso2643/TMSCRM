<?php
/**
 * Vendors (suppliers) and stock inward.
 *
 * A vendor can carry several brands. Per vendor we keep:
 *   - a product list with the vendor's price, discount, net price and stock
 *     (added by hand or uploaded from the vendor's Excel price list / stock
 *     list — any layout, every sheet; the header row is found automatically)
 *   - files: catalogues, price lists, stock lists (PDF / Excel / images)
 * Uploaded items also appear on the Products page (new item codes are added
 * as products; brand / grade / specification fill in where blank), and the
 * product suggestions show the vendor prices to Manager / Admin.
 *
 * Inward: goods received from a supplier (vendor or free text) with invoice
 * no. and lines; every line is added to stock at the chosen place. Deleting
 * an inward takes the quantities back out.
 *
 *   GET    /api/vendors                       list (+ item / file counts)
 *   POST   /api/vendors                       add          PUT /api/vendors/:id    edit
 *   DELETE /api/vendors/:id                   delete (with its products and files)
 *   GET    /api/vendors/:id                   vendor + files
 *   GET    /api/vendors/:id/items?q=          vendor product / price / stock list
 *   POST   /api/vendors/:id/items             add / update one product
 *   DELETE /api/vendors/:id/items/:itemId     remove one   (DELETE /api/vendors/:id/items → clear all)
 *   POST   /api/vendors/:id/import            Excel price / stock list (multipart: file, kind=PRICE_LIST|STOCK_LIST)
 *   GET    /api/vendors/:id/export            vendor list as Excel
 *   GET    /api/vendors/template              blank Excel template
 *   GET    /api/vendors/compare?q=            one item code across all vendors
 *   POST   /api/vendors/:id/files             upload a catalogue / file (multipart: file, kind)
 *   GET    /api/vendors/:id/files/:fid        download     DELETE …/files/:fid  remove
 *
 *   GET    /api/inwards?vendorId=&from=&to=&q=   list        GET /api/inwards/:id
 *   POST   /api/inwards                          add (adds to stock)
 *   DELETE /api/inwards/:id                      delete (takes the stock back out)
 *   GET    /api/inwards/export?from=&to=         Excel (one row per line)
 */
class VendorController
{
    private const KINDS = ['CATALOGUE' => 'Catalogue', 'PRICE_LIST' => 'Price list', 'STOCK_LIST' => 'Stock list', 'OTHER' => 'Other'];
    private const COLS = ['Item Code', 'Product Name', 'Brand', 'Grade', 'Specification', 'Category', 'Unit', 'Price', 'Discount %', 'Net Price', 'Stock', 'MOQ', 'Lead Time'];

    public function __construct()
    {
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        ensure_schema([
            'Vendor' => ['create' => "CREATE TABLE IF NOT EXISTS `Vendor` (
  `id` VARCHAR(30) NOT NULL, `name` VARCHAR(160) NOT NULL, `brands` VARCHAR(500) NULL,
  `contactPerson` VARCHAR(120) NULL, `phone` VARCHAR(40) NULL, `email` VARCHAR(160) NULL, `gstin` VARCHAR(30) NULL,
  `city` VARCHAR(80) NULL, `address` TEXT NULL, `notes` TEXT NULL, `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `Vendor_name_idx` (`name`)
$tail"],
            'VendorItem' => ['create' => "CREATE TABLE IF NOT EXISTS `VendorItem` (
  `id` VARCHAR(30) NOT NULL, `vendorId` VARCHAR(30) NOT NULL, `itemCode` VARCHAR(120) NOT NULL,
  `productName` VARCHAR(255) NULL, `brand` VARCHAR(100) NULL, `grade` VARCHAR(80) NULL, `specification` VARCHAR(255) NULL,
  `category` VARCHAR(120) NULL, `unit` VARCHAR(20) NULL,
  `price` DECIMAL(14,2) NULL, `discount` DECIMAL(6,2) NULL, `netPrice` DECIMAL(14,2) NULL, `stockQty` DECIMAL(14,2) NULL,
  `moq` VARCHAR(40) NULL, `leadTime` VARCHAR(60) NULL, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `VendorItem_vendor_code` (`vendorId`, `itemCode`), KEY `VendorItem_code_idx` (`itemCode`)
$tail"],
            'VendorFile' => ['create' => "CREATE TABLE IF NOT EXISTS `VendorFile` (
  `id` VARCHAR(30) NOT NULL, `vendorId` VARCHAR(30) NOT NULL, `kind` VARCHAR(20) NOT NULL DEFAULT 'CATALOGUE',
  `fileName` VARCHAR(255) NOT NULL, `storedName` VARCHAR(80) NOT NULL, `size` INT NOT NULL DEFAULT 0, `brand` VARCHAR(100) NULL,
  `uploadedById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `VendorFile_vendor_idx` (`vendorId`)
$tail"],
            'StockInward' => ['create' => "CREATE TABLE IF NOT EXISTS `StockInward` (
  `id` VARCHAR(30) NOT NULL, `inwardNo` VARCHAR(30) NOT NULL, `vendorId` VARCHAR(30) NULL, `supplierName` VARCHAR(160) NOT NULL,
  `invoiceNo` VARCHAR(60) NULL, `invoiceDate` DATE NULL, `receivedDate` DATE NOT NULL,
  `locType` VARCHAR(10) NOT NULL DEFAULT 'HAND', `state` VARCHAR(60) NOT NULL DEFAULT '',
  `notes` TEXT NULL, `totalQty` DECIMAL(14,2) NOT NULL DEFAULT 0, `totalAmount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `createdById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `StockInward_no` (`inwardNo`), KEY `StockInward_vendor_idx` (`vendorId`), KEY `StockInward_date_idx` (`receivedDate`)
$tail"],
            'StockInwardItem' => ['create' => "CREATE TABLE IF NOT EXISTS `StockInwardItem` (
  `id` VARCHAR(30) NOT NULL, `inwardId` VARCHAR(30) NOT NULL, `stockId` VARCHAR(30) NULL, `itemCode` VARCHAR(120) NOT NULL,
  `productName` VARCHAR(255) NULL, `brand` VARCHAR(100) NULL, `quantity` DECIMAL(14,2) NOT NULL, `rate` DECIMAL(14,2) NULL, `amount` DECIMAL(14,2) NULL,
  PRIMARY KEY (`id`), KEY `StockInwardItem_inward_idx` (`inwardId`), KEY `StockInwardItem_code_idx` (`itemCode`)
$tail"],
        ], 'Vendors and stock inward');
    }

    private function guard(): array
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Vendors are for Manager / Admin / Super Admin.', 403);
        return $auth;
    }
    private static function num($v): ?float
    {
        $v = trim(str_replace([',', '₹', 'Rs.', 'Rs', 'INR', '%'], '', (string) $v));
        return $v === '' || !is_numeric($v) ? null : (float) $v;
    }
    private static function str($v, int $max): ?string { $v = trim(preg_replace('/\s+/', ' ', (string) $v)); return $v === '' ? null : mb_substr($v, 0, $max); }
    private function vendor(string $id): array
    {
        $s = db()->prepare('SELECT * FROM `Vendor` WHERE id=?'); $s->execute([$id]);
        $v = $s->fetch();
        if (!$v) sendError('Vendor not found.', 404);
        return $v;
    }

    // ── vendors ──────────────────────────────────────────────────────────
    public function index(): void
    {
        $this->guard();
        $q = trim((string) qp('q', ''));
        $w = ''; $p = [];
        if ($q !== '') { $w = 'WHERE v.name LIKE ? OR v.brands LIKE ? OR v.city LIKE ? OR v.contactPerson LIKE ?'; $p = array_fill(0, 4, "%$q%"); }
        $s = db()->prepare("SELECT v.*,
                (SELECT COUNT(*) FROM `VendorItem` i WHERE i.vendorId=v.id) AS itemCount,
                (SELECT COALESCE(SUM(i.stockQty),0) FROM `VendorItem` i WHERE i.vendorId=v.id) AS stockQty,
                (SELECT COUNT(*) FROM `VendorFile` f WHERE f.vendorId=v.id) AS fileCount,
                (SELECT MAX(i.updatedAt) FROM `VendorItem` i WHERE i.vendorId=v.id) AS listUpdatedAt,
                (SELECT COUNT(*) FROM `StockInward` w WHERE w.vendorId=v.id) AS inwardCount
            FROM `Vendor` v $w ORDER BY v.name");
        $s->execute($p);
        $rows = array_map(function ($r) {
            foreach (['itemCount', 'fileCount', 'inwardCount'] as $k) $r[$k] = (int) $r[$k];
            $r['stockQty'] = (float) $r['stockQty'];
            $r['brandList'] = array_values(array_filter(array_map('trim', explode(',', (string) $r['brands']))));
            return $r;
        }, $s->fetchAll());
        sendSuccess(['vendors' => $rows]);
    }

    private function fields(array $b, bool $create): array
    {
        $name = self::str($b['name'] ?? '', 160);
        if ($create && !$name) sendError('Enter the vendor name.', 400);
        $brands = $b['brands'] ?? '';
        if (is_array($brands)) $brands = implode(',', $brands);
        $brands = implode(', ', array_unique(array_filter(array_map(fn($x) => trim($x), explode(',', (string) $brands)))));
        $out = ['brands' => $brands ?: null];
        if ($name) $out['name'] = $name;
        foreach (['contactPerson' => 120, 'phone' => 40, 'email' => 160, 'gstin' => 30, 'city' => 80] as $k => $m) if (array_key_exists($k, $b)) $out[$k] = self::str($b[$k], $m);
        foreach (['address', 'notes'] as $k) if (array_key_exists($k, $b)) $out[$k] = trim((string) $b[$k]) ?: null;
        return $out;
    }

    public function create(): void
    {
        $auth = $this->guard();
        $f = $this->fields(request_body(), true);
        $d = db()->prepare('SELECT id FROM `Vendor` WHERE name=?'); $d->execute([$f['name']]);
        if ($d->fetch()) sendError('A vendor with this name already exists.', 409);
        $id = gen_id();
        $f += ['id' => $id, 'createdById' => $auth['id'], 'createdAt' => now_sql(), 'updatedAt' => now_sql()];
        db()->prepare('INSERT INTO `Vendor` (' . implode(',', array_keys($f)) . ') VALUES (' . implode(',', array_fill(0, count($f), '?')) . ')')->execute(array_values($f));
        log_activity($auth['id'], 'VENDOR_ADDED', 'Vendor', $id, ['name' => $f['name']]);
        $this->vendor($id);
        sendSuccess(['vendor' => $this->vendor($id)], 'Vendor added', 201);
    }

    public function update(string $id): void
    {
        $this->guard(); $this->vendor($id);
        $f = $this->fields(request_body(), false);
        $f['updatedAt'] = now_sql();
        $sets = implode(',', array_map(fn($k) => "`$k`=?", array_keys($f)));
        db()->prepare("UPDATE `Vendor` SET $sets WHERE id=?")->execute(array_merge(array_values($f), [$id]));
        sendSuccess(['vendor' => $this->vendor($id)], 'Vendor saved');
    }

    public function delete(string $id): void
    {
        $auth = $this->guard(); $v = $this->vendor($id);
        $s = db()->prepare('SELECT storedName FROM `VendorFile` WHERE vendorId=?'); $s->execute([$id]);
        foreach ($s->fetchAll() as $f) @unlink(UPLOADS_PATH . '/vendors/' . basename($f['storedName']));
        db()->prepare('DELETE FROM `VendorFile` WHERE vendorId=?')->execute([$id]);
        db()->prepare('DELETE FROM `VendorItem` WHERE vendorId=?')->execute([$id]);
        // inward history stays (with the supplier name), only the link goes
        db()->prepare('UPDATE `StockInward` SET vendorId=NULL WHERE vendorId=?')->execute([$id]);
        db()->prepare('DELETE FROM `Vendor` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'VENDOR_DELETED', 'Vendor', $id, ['name' => $v['name']]);
        sendSuccess([], 'Vendor deleted');
    }

    public function show(string $id): void
    {
        $this->guard(); $v = $this->vendor($id);
        $s = db()->prepare('SELECT f.*, u.name AS uploadedByName FROM `VendorFile` f LEFT JOIN `User` u ON u.id=f.uploadedById WHERE f.vendorId=? ORDER BY f.createdAt DESC');
        $s->execute([$id]);
        $files = array_map(fn($f) => $f + ['kindLabel' => self::KINDS[$f['kind']] ?? $f['kind']], $s->fetchAll());
        $c = db()->prepare('SELECT COUNT(*), COALESCE(SUM(stockQty),0) FROM `VendorItem` WHERE vendorId=?'); $c->execute([$id]);
        [$cnt, $stk] = $c->fetch(PDO::FETCH_NUM);
        $v['brandList'] = array_values(array_filter(array_map('trim', explode(',', (string) $v['brands']))));
        sendSuccess(['vendor' => $v, 'files' => $files, 'itemCount' => (int) $cnt, 'stockQty' => (float) $stk]);
    }

    // ── vendor products ──────────────────────────────────────────────────
    public function items(string $id): void
    {
        $this->guard(); $this->vendor($id);
        $q = trim((string) qp('q', '')); $brand = trim((string) qp('brand', ''));
        $w = ['i.vendorId=?']; $p = [$id];
        if ($q !== '') {
            $sq = '%' . preg_replace('/[\s\-\.\/_]+/', '', $q) . '%';
            $w[] = "(i.itemCode LIKE ? OR i.productName LIKE ? OR i.specification LIKE ? OR i.grade LIKE ? OR REPLACE(REPLACE(REPLACE(REPLACE(i.itemCode,' ',''),'-',''),'.',''),'/','') LIKE ?)";
            array_push($p, "%$q%", "%$q%", "%$q%", "%$q%", $sq);
        }
        if ($brand !== '') { $w[] = 'i.brand=?'; $p[] = $brand; }
        if (qp('inStock') === '1') $w[] = 'i.stockQty>0';
        $limit = max(1, min(1000, (int) qp('limit', 300)));
        $s = db()->prepare('SELECT COUNT(*) FROM `VendorItem` i WHERE ' . implode(' AND ', $w)); $s->execute($p); $total = (int) $s->fetchColumn();
        $s = db()->prepare('SELECT i.* FROM `VendorItem` i WHERE ' . implode(' AND ', $w) . " ORDER BY i.brand, i.itemCode LIMIT $limit");
        $s->execute($p);
        $rows = array_map(function ($r) { foreach (['price', 'discount', 'netPrice', 'stockQty'] as $k) $r[$k] = $r[$k] === null ? null : (float) $r[$k]; return $r; }, $s->fetchAll());
        $b = db()->prepare("SELECT DISTINCT brand FROM `VendorItem` WHERE vendorId=? AND brand IS NOT NULL AND brand<>'' ORDER BY brand"); $b->execute([$id]);
        sendSuccess(['items' => $rows, 'total' => $total, 'brands' => $b->fetchAll(PDO::FETCH_COLUMN)]);
    }

    /** Insert or update one vendor item (by item code). Returns 'new' | 'updated'. */
    private function upsertItem(string $vendorId, array $d): string
    {
        $code = strtoupper(self::str($d['itemCode'] ?? '', 120) ?? '');
        if ($code === '') return 'skip';
        $price = $d['price'] ?? null; $disc = $d['discount'] ?? null; $net = $d['netPrice'] ?? null;
        if ($net === null && $price !== null) $net = round($price * (1 - ($disc ?? 0) / 100), 2);
        $s = db()->prepare('SELECT * FROM `VendorItem` WHERE vendorId=? AND itemCode=?'); $s->execute([$vendorId, $code]);
        $old = $s->fetch();
        $vals = ['productName' => self::str($d['productName'] ?? '', 255), 'brand' => self::str($d['brand'] ?? '', 100), 'grade' => self::str($d['grade'] ?? '', 80),
                 'specification' => self::str($d['specification'] ?? '', 255), 'category' => self::str($d['category'] ?? '', 120), 'unit' => self::str($d['unit'] ?? '', 20),
                 'price' => $price, 'discount' => $disc, 'netPrice' => $net, 'stockQty' => $d['stockQty'] ?? null,
                 'moq' => self::str($d['moq'] ?? '', 40), 'leadTime' => self::str($d['leadTime'] ?? '', 60)];
        if ($old) {
            // blank cells keep what we had (a stock list doesn't wipe the prices, and the other way round)
            $set = array_filter($vals, fn($v) => $v !== null);
            $set['updatedAt'] = now_sql();
            db()->prepare('UPDATE `VendorItem` SET ' . implode(',', array_map(fn($k) => "`$k`=?", array_keys($set))) . ' WHERE id=?')->execute(array_merge(array_values($set), [$old['id']]));
            return 'updated';
        }
        $vals += ['id' => gen_id(), 'vendorId' => $vendorId, 'itemCode' => $code, 'updatedAt' => now_sql()];
        db()->prepare('INSERT INTO `VendorItem` (' . implode(',', array_keys($vals)) . ') VALUES (' . implode(',', array_fill(0, count($vals), '?')) . ')')->execute(array_values($vals));
        return 'new';
    }

    /** Makes the item show on the Products page: adds new codes, fills blank brand / grade / spec. Returns true when a product was added. */
    private function syncProduct(array $d): bool
    {
        $code = strtoupper(self::str($d['itemCode'] ?? '', 120) ?? '');
        if ($code === '') return false;
        $s = db()->prepare('SELECT id, brand, grade, specification, productName FROM `Product` WHERE itemCode=? LIMIT 1'); $s->execute([$code]);
        $p = $s->fetch();
        $brand = self::str($d['brand'] ?? '', 100); $grade = self::str($d['grade'] ?? '', 80); $spec = self::str($d['specification'] ?? '', 255);
        if ($p) {
            $set = [];
            foreach (['brand' => $brand, 'grade' => $grade, 'specification' => $spec] as $k => $v) if ($v && !trim((string) $p[$k])) $set[$k] = $v;
            if ($set) { $set['updatedAt'] = now_sql(); db()->prepare('UPDATE `Product` SET ' . implode(',', array_map(fn($k) => "`$k`=?", array_keys($set))) . ' WHERE id=?')->execute(array_merge(array_values($set), [$p['id']])); }
            return false;
        }
        $name = self::str($d['productName'] ?? '', 255) ?: trim(implode(' ', array_filter([$spec ?: $code, $grade ? 'Grade ' . $grade : ''])));
        $desc = implode(' · ', array_filter([$spec, $grade ? 'Grade ' . $grade : null, $brand]));
        try {
            db()->prepare('INSERT INTO `Product` (id,itemCode,productName,description,unit,standardPrice,category,brand,grade,specification,isActive,createdAt,updatedAt)
                           VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)')
                ->execute([gen_id(), $code, mb_substr($name, 0, 255), $desc ?: null, self::str($d['unit'] ?? '', 20) ?: 'Nos', 0, self::str($d['category'] ?? '', 120),
                           $brand, $grade, $spec, now_sql(), now_sql()]);
            return true;
        } catch (Throwable $e) { error_log('vendor syncProduct: ' . $e->getMessage()); return false; }
    }

    public function saveItem(string $id): void
    {
        $auth = $this->guard(); $this->vendor($id);
        $b = request_body();
        if (!self::str($b['itemCode'] ?? '', 120)) sendError('Enter the item code.', 400);
        $d = $b;
        foreach (['price', 'discount', 'netPrice', 'stockQty'] as $k) $d[$k] = self::num($b[$k] ?? '');
        $r = $this->upsertItem($id, $d);
        $added = $this->syncProduct($d);
        log_activity($auth['id'], 'VENDOR_ITEM_SAVED', 'Vendor', $id, ['itemCode' => $b['itemCode']]);
        sendSuccess(['result' => $r, 'productAdded' => $added], $r === 'new' ? 'Product added to the vendor list' . ($added ? ' and to Products' : '') : 'Product updated', $r === 'new' ? 201 : 200);
    }

    public function deleteItem(string $id, string $itemId): void
    {
        $this->guard();
        if ($itemId === '') {
            $s = db()->prepare('DELETE FROM `VendorItem` WHERE vendorId=?'); $s->execute([$id]);
            sendSuccess(['deleted' => $s->rowCount()], $s->rowCount() . ' products removed from this vendor');
        }
        $s = db()->prepare('DELETE FROM `VendorItem` WHERE id=? AND vendorId=?'); $s->execute([$itemId, $id]);
        if (!$s->rowCount()) sendError('Product not found.', 404);
        sendSuccess([], 'Removed');
    }

    /** Header row in the first 12 rows, columns mapped by name. */
    private static function headerMap(array $rows): ?array
    {
        $alias = [
            'itemCode' => ['item code', 'itemcode', 'product code', 'order code', 'ordering code', 'code', 'code no', 'edp', 'edp no', 'edp code', 'article no', 'article number',
                           'article', 'part no', 'part number', 'cat no', 'catalogue no', 'catalog no', 'material code', 'material', 'sku', 'item no', 'item number', 'ref no', 'reference'],
            'productName' => ['product name', 'item name', 'itemname', 'description', 'item description', 'product description', 'product', 'material description', 'name'],
            'brand' => ['brand', 'make', 'manufacturer', 'mfr', 'company'],
            'grade' => ['grade', 'insert grade', 'carbide grade'],
            'specification' => ['specification', 'spec', 'designation', 'size', 'dimension', 'dimensions', 'iso code', 'iso designation'],
            'category' => ['category', 'item group', 'group', 'family', 'product family', 'type', 'product type'],
            'unit' => ['unit', 'uom', 'units'],
            'price' => ['price', 'list price', 'lp', 'mrp', 'rate', 'unit price', 'basic price', 'basic rate', 'xceed-lp', 'price inr', 'price (inr)', 'list price inr', 'gross price'],
            'discount' => ['discount', 'disc', 'disc %', 'discount %', 'discount (%)', 'disc%'],
            'netPrice' => ['net price', 'netprice', 'net rate', 'net', 'net amount', 'nett price', 'special price', 'dealer price', 'purchase price', 'cost'],
            'stockQty' => ['stock', 'qty', 'quantity', 'in stock', 'instock', 'available', 'available qty', 'available stock', 'free stock', 'closing stock', 'stock qty', 'balance', 'soh', 'stock on hand'],
            'moq' => ['moq', 'min qty', 'minimum order', 'pack qty', 'pack size'],
            'leadTime' => ['lead time', 'delivery', 'edd', 'delivery time', 'availability'],
        ];
        $norm = fn($v) => trim(preg_replace('/\s+/', ' ', strtolower(str_replace(['_', '.', ':'], ' ', (string) $v))));
        for ($r = 0; $r < min(12, count($rows)); $r++) {
            $map = [];
            foreach (($rows[$r] ?? []) as $ci => $cell) {
                $h = $norm($cell);
                if ($h === '') continue;
                foreach ($alias as $k => $names) if (!isset($map[$k]) && in_array($h, $names, true)) { $map[$k] = $ci; break; }
            }
            if (isset($map['itemCode']) && count($map) >= 2) return ['row' => $r, 'map' => $map];
        }
        return null;
    }

    public function import(string $id): void
    {
        $auth = $this->guard(); $v = $this->vendor($id);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('No file uploaded.', 400);
        $kind = strtoupper((string) ($_POST['kind'] ?? 'PRICE_LIST'));
        if (!in_array($kind, ['PRICE_LIST', 'STOCK_LIST'], true)) $kind = 'PRICE_LIST';
        $pickedBrand = self::str($_POST['brand'] ?? '', 100);
        $toProducts = ($_POST['syncProducts'] ?? '1') !== '0';
        $name = (string) ($f['name'] ?? '');
        if (preg_match('/\.csv$/i', $name)) {
            $rows = [];
            if (($fh = fopen($f['tmp_name'], 'r')) !== false) { while (($row = fgetcsv($fh)) !== false) $rows[] = $row; fclose($fh); }
            $sheets = [['name' => 'CSV', 'rows' => $rows]];
        } else {
            try { $sheets = XlsxReader::readAllSheets($f['tmp_name']); }
            catch (\Throwable $e) { sendError('Could not read the Excel file: ' . $e->getMessage(), 400); }
        }
        $new = $upd = $skip = $prodAdded = 0; $report = [];
        db()->beginTransaction();
        try {
            foreach ($sheets as $sh) {
                $hm = self::headerMap($sh['rows']);
                if (!$hm) { $report[] = ['sheet' => $sh['name'], 'status' => 'skipped', 'reason' => 'no item code column']; continue; }
                $map = $hm['map']; $n = 0;
                // a sheet named after a brand ("Taegutec", "YG-1") gives the brand when the rows don't
                $sheetBrand = preg_match('/^(sheet\s*\d*|price\s*list|stock|data|list)$/i', trim($sh['name'])) ? null : self::str($sh['name'], 100);
                foreach ($sh['rows'] as $i => $row) {
                    if ($i <= $hm['row'] || !$row) continue;
                    $d = [];
                    foreach ($map as $k => $ci) $d[$k] = $row[$ci] ?? '';
                    if (!trim((string) ($d['itemCode'] ?? ''))) { $skip++; continue; }
                    foreach (['price', 'discount', 'netPrice', 'stockQty'] as $k) $d[$k] = isset($d[$k]) ? self::num($d[$k]) : null;
                    if ($d['discount'] !== null && $d['discount'] > 0 && $d['discount'] < 1) $d['discount'] = round($d['discount'] * 100, 2); // 0.35 → 35 %
                    if (!trim((string) ($d['brand'] ?? ''))) $d['brand'] = $pickedBrand ?: (count($v['brands'] ? explode(',', $v['brands']) : []) === 1 ? trim($v['brands']) : $sheetBrand);
                    $r = $this->upsertItem($id, $d);
                    if ($r === 'new') $new++; elseif ($r === 'updated') $upd++; else { $skip++; continue; }
                    if ($toProducts && $this->syncProduct($d)) $prodAdded++;
                    $n++;
                }
                $report[] = ['sheet' => $sh['name'], 'status' => 'ok', 'rows' => $n];
            }
            db()->commit();
        } catch (Throwable $e) { db()->rollBack(); sendError('Upload failed: ' . $e->getMessage(), 500); }
        if ($new + $upd === 0) sendError('No products found — the file needs an Item Code (or Product code / EDP / Article no.) column.', 400);
        // keep the uploaded file with the vendor's documents
        $this->storeFile($id, $f['tmp_name'], $name, (int) $f['size'], $kind, $pickedBrand, $auth['id'], true);
        // brands seen in the upload are added to the vendor
        $bs = db()->prepare("SELECT DISTINCT brand FROM `VendorItem` WHERE vendorId=? AND brand IS NOT NULL AND brand<>''"); $bs->execute([$id]);
        $all = array_unique(array_filter(array_merge(array_map('trim', explode(',', (string) $v['brands'])), $bs->fetchAll(PDO::FETCH_COLUMN))));
        db()->prepare('UPDATE `Vendor` SET brands=?, updatedAt=? WHERE id=?')->execute([mb_substr(implode(', ', $all), 0, 500) ?: null, now_sql(), $id]);
        log_activity($auth['id'], 'VENDOR_LIST_UPLOADED', 'Vendor', $id, ['kind' => $kind, 'new' => $new, 'updated' => $upd]);
        sendSuccess(['inserted' => $new, 'updated' => $upd, 'skipped' => $skip, 'productsAdded' => $prodAdded, 'sheets' => $report],
            "$new new, $upd updated" . ($prodAdded ? ", $prodAdded added to Products" : ''));
    }

    public function template(): void
    {
        authenticate();
        $wb = new StyledXlsxWriter();
        foreach (['Taegutec' => [['SNMX1206ANN-MM', 'SNMX 1206ANN-MM Milling Insert', 'Taegutec', 'TT9080', 'SNMX 1206ANN-MM', 'Insert', 'Nos', 820, 35, '', 240, 10, '1 week']],
                  'YG-1' => [['EM4F-10', 'Solid carbide end mill 4F D10', 'YG-1', 'X5070', 'D10 x 22 x 72 4F', 'EndMill', 'Nos', 2450, 30, '', 18, 1, 'Ex-stock']]] as $sn => $rows) {
            $sh = $wb->addSheet($sn);
            $wb->setWidths($sh, [22, 34, 14, 12, 26, 14, 8, 11, 11, 11, 10, 8, 14]);
            $wb->addRow($sh, self::COLS, 'header', 28);
            foreach ($rows as $r) $wb->addRow($sh, $r);
            $wb->freeze($sh, 1);
        }
        $hs = $wb->addSheet('How to fill');
        $wb->setWidths($hs, [110]);
        $wb->addRow($hs, ['Vendor price list / stock list'], 'header');
        foreach ([
            '1. One row per product. Item Code is required (Product code, Order code, EDP, Article no. also work as the column name).',
            '2. Any number of sheets — e.g. one per brand. If Brand is blank, the sheet name (or the brand picked in the upload box) is used.',
            '3. Price + Discount % → Net Price is worked out when Net Price is blank. Stock is the vendor\'s available quantity.',
            '4. Uploading again updates the same item codes; blank cells keep the old value (a stock list does not wipe prices).',
            '5. New item codes are also added to the Products page so they appear in quotation / order suggestions.',
            '6. The vendor\'s own Excel layout works too, as long as the header row has recognisable names in the first 12 rows.',
        ] as $l) $wb->addRow($hs, [$l]);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="vendor-price-list-template.xlsx"');
        echo $wb->output(); exit;
    }

    public function export(string $id): void
    {
        $this->guard(); $v = $this->vendor($id);
        $s = db()->prepare('SELECT * FROM `VendorItem` WHERE vendorId=? ORDER BY brand, itemCode'); $s->execute([$id]);
        $rows = $s->fetchAll();
        $wb = new StyledXlsxWriter();
        $byBrand = [];
        foreach ($rows as $r) $byBrand[$r['brand'] ?: 'Other'][] = $r;
        if (!$byBrand) $byBrand = ['Products' => []];
        foreach ($byBrand as $brand => $list) {
            $sh = $wb->addSheet($brand);
            $wb->setWidths($sh, [22, 34, 14, 12, 26, 14, 8, 11, 11, 11, 10, 8, 14, 18]);
            $wb->addRow($sh, [$v['name'] . ' — ' . $brand . ' (' . count($list) . ' products)'], 'title');
            $wb->addRow($sh, array_merge(self::COLS, ['Updated']), 'header', 28);
            foreach ($list as $r) $wb->addRow($sh, [$r['itemCode'], $r['productName'], $r['brand'], $r['grade'], $r['specification'], $r['category'], $r['unit'],
                ['v' => $r['price'] === null ? '' : (float) $r['price'], 's' => 'num'], $r['discount'] === null ? '' : (float) $r['discount'],
                ['v' => $r['netPrice'] === null ? '' : (float) $r['netPrice'], 's' => 'num'], $r['stockQty'] === null ? '' : (float) $r['stockQty'], $r['moq'], $r['leadTime'],
                date('d-m-Y', strtotime($r['updatedAt']))]);
            $wb->freeze($sh, 2); $wb->autoFilter($sh, 'A2:N2');
        }
        $fn = preg_replace('/[^\w\-]+/', '-', $v['name']);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="vendor-' . $fn . '-' . date('Y-m-d') . '.xlsx"');
        echo $wb->output(); exit;
    }

    /** One item code (or text) across all vendors: price / net price / stock side by side. */
    public function compare(): void
    {
        $this->guard();
        $q = trim((string) qp('q', ''));
        if (mb_strlen($q) < 2) sendSuccess(['items' => []]);
        $sq = '%' . preg_replace('/[\s\-\.\/_]+/', '', $q) . '%';
        $s = db()->prepare("SELECT i.*, v.name AS vendorName, v.phone AS vendorPhone FROM `VendorItem` i JOIN `Vendor` v ON v.id=i.vendorId
            WHERE i.itemCode LIKE ? OR i.productName LIKE ? OR i.specification LIKE ? OR REPLACE(REPLACE(REPLACE(REPLACE(i.itemCode,' ',''),'-',''),'.',''),'/','') LIKE ?
            ORDER BY i.itemCode, (i.netPrice IS NULL), i.netPrice LIMIT 200");
        $s->execute(["%$q%", "%$q%", "%$q%", $sq]);
        sendSuccess(['items' => array_map(function ($r) { foreach (['price', 'discount', 'netPrice', 'stockQty'] as $k) $r[$k] = $r[$k] === null ? null : (float) $r[$k]; return $r; }, $s->fetchAll())]);
    }

    /** Vendor offers for item codes (used by the product search for Manager / Admin). */
    public static function offers(array $codes): array
    {
        $out = [];
        if (!$codes) return $out;
        try {
            $in = implode(',', array_fill(0, count($codes), '?'));
            $s = db()->prepare("SELECT i.itemCode, i.netPrice, i.price, i.stockQty, v.name FROM `VendorItem` i JOIN `Vendor` v ON v.id=i.vendorId
                                WHERE i.itemCode IN ($in) ORDER BY (i.netPrice IS NULL), i.netPrice");
            $s->execute(array_map('strtoupper', $codes));
            foreach ($s->fetchAll() as $r) $out[strtoupper($r['itemCode'])][] = ['vendor' => $r['name'], 'netPrice' => $r['netPrice'] === null ? ($r['price'] === null ? null : (float) $r['price']) : (float) $r['netPrice'],
                                                                                  'stock' => $r['stockQty'] === null ? null : (float) $r['stockQty']];
        } catch (Throwable $e) { /* tables not created yet */ }
        return $out;
    }

    // ── files (catalogues etc.) ──────────────────────────────────────────
    private function storeFile(string $vendorId, string $tmp, string $name, int $size, string $kind, ?string $brand, string $userId, bool $copy = false): string
    {
        $dir = UPLOADS_PATH . '/vendors';
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the file on the server.', 500);
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!preg_match('/^(pdf|xlsx|xls|csv|png|jpe?g|webp|docx?)$/', $ext)) $ext = 'bin';
        $fid = gen_id(); $stored = "$fid.$ext";
        $ok = $copy ? @copy($tmp, "$dir/$stored") : (@move_uploaded_file($tmp, "$dir/$stored") || @rename($tmp, "$dir/$stored"));
        if (!$ok) sendError('Could not save the file on the server.', 500);
        $clean = preg_replace('/[^\w.\- ()]+/u', '_', $name ?: "file.$ext");
        db()->prepare('INSERT INTO `VendorFile` (id,vendorId,kind,fileName,storedName,size,brand,uploadedById,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$fid, $vendorId, $kind, mb_substr($clean, 0, 255), $stored, $size, $brand, $userId, now_sql()]);
        return $fid;
    }

    public function uploadFile(string $id): void
    {
        $auth = $this->guard(); $this->vendor($id);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('No file received.', 400);
        if ($f['size'] > 40 * 1024 * 1024) sendError('The file is larger than 40 MB.', 400);
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        if (!preg_match('/^(pdf|xlsx|xls|csv|png|jpe?g|webp|docx?)$/', $ext)) sendError('Upload a PDF, Excel, Word or image file.', 400);
        $kind = strtoupper((string) ($_POST['kind'] ?? 'CATALOGUE'));
        if (!isset(self::KINDS[$kind])) $kind = 'CATALOGUE';
        $fid = $this->storeFile($id, $f['tmp_name'], (string) $f['name'], (int) $f['size'], $kind, self::str($_POST['brand'] ?? '', 100), $auth['id']);
        log_activity($auth['id'], 'VENDOR_FILE_UPLOADED', 'Vendor', $id, ['kind' => $kind]);
        sendSuccess(['id' => $fid], self::KINDS[$kind] . ' uploaded', 201);
    }

    public function downloadFile(string $id, string $fid): void
    {
        $this->guard();
        $s = db()->prepare('SELECT * FROM `VendorFile` WHERE id=? AND vendorId=?'); $s->execute([$fid, $id]);
        $f = $s->fetch();
        if (!$f) sendError('File not found.', 404);
        $path = UPLOADS_PATH . '/vendors/' . basename($f['storedName']);
        if (!is_file($path)) sendError('The file is missing on the server.', 404);
        $types = ['pdf' => 'application/pdf', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xls' => 'application/vnd.ms-excel',
                  'csv' => 'text/csv', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp',
                  'doc' => 'application/msword', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: ' . (qp('inline') === '1' ? 'inline' : 'attachment') . '; filename="' . str_replace('"', '', $f['fileName']) . '"');
        readfile($path); exit;
    }

    public function deleteFile(string $id, string $fid): void
    {
        $this->guard();
        $s = db()->prepare('SELECT storedName FROM `VendorFile` WHERE id=? AND vendorId=?'); $s->execute([$fid, $id]);
        $f = $s->fetch();
        if (!$f) sendError('File not found.', 404);
        @unlink(UPLOADS_PATH . '/vendors/' . basename($f['storedName']));
        db()->prepare('DELETE FROM `VendorFile` WHERE id=?')->execute([$fid]);
        sendSuccess([], 'File deleted');
    }

    // ── stock inward ─────────────────────────────────────────────────────
    private function nextInwardNo(): string
    {
        $prefix = 'INW/' . date('Y') . '/';
        $s = db()->prepare('SELECT inwardNo FROM `StockInward` WHERE inwardNo LIKE ? ORDER BY inwardNo DESC LIMIT 1'); $s->execute([$prefix . '%']);
        $last = $s->fetchColumn();
        return $prefix . str_pad((string) ($last ? ((int) substr($last, strlen($prefix)) + 1) : 1), 4, '0', STR_PAD_LEFT);
    }

    public function inwards(): void
    {
        $this->guard();
        $w = []; $p = [];
        if (qp('vendorId')) { $w[] = 'w.vendorId=?'; $p[] = qp('vendorId'); }
        if ($d = to_date_only(qp('from'))) { $w[] = 'w.receivedDate>=?'; $p[] = $d; }
        if ($d = to_date_only(qp('to'))) { $w[] = 'w.receivedDate<=?'; $p[] = $d; }
        if (($q = trim((string) qp('q', ''))) !== '') {
            $w[] = '(w.inwardNo LIKE ? OR w.supplierName LIKE ? OR w.invoiceNo LIKE ? OR EXISTS (SELECT 1 FROM `StockInwardItem` x WHERE x.inwardId=w.id AND x.itemCode LIKE ?))';
            array_push($p, "%$q%", "%$q%", "%$q%", "%$q%");
        }
        $s = db()->prepare('SELECT w.*, u.name AS createdByName, (SELECT COUNT(*) FROM `StockInwardItem` x WHERE x.inwardId=w.id) AS lineCount
                            FROM `StockInward` w LEFT JOIN `User` u ON u.id=w.createdById ' . ($w ? 'WHERE ' . implode(' AND ', $w) : '') . '
                            ORDER BY w.receivedDate DESC, w.createdAt DESC LIMIT 300');
        $s->execute($p);
        sendSuccess(['inwards' => array_map(function ($r) {
            $r['totalQty'] = (float) $r['totalQty']; $r['totalAmount'] = (float) $r['totalAmount']; $r['lineCount'] = (int) $r['lineCount'];
            $r['location'] = StockLedger::label($r['locType'], $r['state']);
            return $r;
        }, $s->fetchAll())]);
    }

    public function inward(string $id): void
    {
        $this->guard();
        $s = db()->prepare('SELECT w.*, u.name AS createdByName FROM `StockInward` w LEFT JOIN `User` u ON u.id=w.createdById WHERE w.id=?'); $s->execute([$id]);
        $w = $s->fetch();
        if (!$w) sendError('Inward not found.', 404);
        $i = db()->prepare('SELECT * FROM `StockInwardItem` WHERE inwardId=? ORDER BY itemCode'); $i->execute([$id]);
        $w['location'] = StockLedger::label($w['locType'], $w['state']);
        $w['items'] = array_map(function ($r) { foreach (['quantity', 'rate', 'amount'] as $k) $r[$k] = $r[$k] === null ? null : (float) $r[$k]; return $r; }, $i->fetchAll());
        sendSuccess(['inward' => $w]);
    }

    public function createInward(): void
    {
        $auth = $this->guard();
        StockLedger::ensure();
        $b = request_body();
        $vendor = null;
        if (!empty($b['vendorId'])) $vendor = $this->vendor((string) $b['vendorId']);
        $supplier = $vendor ? $vendor['name'] : self::str($b['supplierName'] ?? '', 160);
        if (!$supplier) sendError('Choose the vendor (or type the supplier name).', 400);
        [$lt, $ls] = StockLedger::location($b['locType'] ?? 'HAND', $b['state'] ?? '');
        $lines = [];
        foreach ((array) ($b['items'] ?? []) as $k => $it) {
            $code = strtoupper(self::str($it['itemCode'] ?? '', 120) ?? '');
            $qty = self::num($it['quantity'] ?? '');
            if ($code === '' && !$qty) continue;
            if ($code === '') sendError('Line ' . ($k + 1) . ': enter the item code.', 400);
            if (!$qty || $qty <= 0) sendError("Line " . ($k + 1) . " ($code): enter the quantity received.", 400);
            $lines[] = ['itemCode' => $code, 'quantity' => $qty, 'rate' => self::num($it['rate'] ?? ''), 'productName' => self::str($it['productName'] ?? '', 255), 'brand' => self::str($it['brand'] ?? '', 100)];
        }
        if (!$lines) sendError('Add at least one item with its quantity.', 400);
        $recv = to_date_only($b['receivedDate'] ?? '') ?: date('Y-m-d');
        $id = gen_id();
        db()->beginTransaction();
        try {
            $no = $this->nextInwardNo();
            $tq = 0; $ta = 0;
            $note = "Inward $no — $supplier" . (!empty($b['invoiceNo']) ? ' inv ' . self::str($b['invoiceNo'], 60) : '');
            foreach ($lines as &$l) {
                // find or create the stock item
                $s = db()->prepare('SELECT id, itemName, brand FROM `Stock` WHERE itemCode=? LIMIT 1'); $s->execute([$l['itemCode']]);
                $st = $s->fetch();
                $info = null;
                if (!$l['productName'] || !$l['brand']) {
                    $p = db()->prepare('SELECT productName, brand FROM `Product` WHERE itemCode=? LIMIT 1'); $p->execute([$l['itemCode']]); $info = $p->fetch() ?: null;
                    if (!$info && $vendor) { $p = db()->prepare('SELECT productName, brand FROM `VendorItem` WHERE vendorId=? AND itemCode=?'); $p->execute([$vendor['id'], $l['itemCode']]); $info = $p->fetch() ?: null; }
                }
                $l['productName'] = $l['productName'] ?: ($st['itemName'] ?? null) ?: ($info['productName'] ?? null) ?: $l['itemCode'];
                $l['brand'] = $l['brand'] ?: ($st['brand'] ?? null) ?: ($info['brand'] ?? null);
                if (!$st) {
                    $sid = gen_id();
                    db()->prepare('INSERT INTO `Stock` (id,itemCode,itemName,itemType,brand,minimumStock,netPrice,isActive,lastUpdated,updatedAt) VALUES (?,?,?,?,?,0,?,1,?,?)')
                        ->execute([$sid, $l['itemCode'], mb_substr($l['productName'], 0, 255), 'Regular', $l['brand'], $l['rate'] ?? 0, now_sql(), now_sql()]);
                } else {
                    $sid = $st['id'];
                    db()->prepare('UPDATE `Stock` SET isActive=1 WHERE id=?')->execute([$sid]);
                }
                StockLedger::addLevel($sid, $lt, $ls, $l['quantity'], 'INWARD', $auth['id'], null, $note);
                $l['stockId'] = $sid;
                $l['amount'] = $l['rate'] !== null ? round($l['rate'] * $l['quantity'], 2) : null;
                $tq += $l['quantity']; $ta += $l['amount'] ?? 0;
                db()->prepare('INSERT INTO `StockInwardItem` (id,inwardId,stockId,itemCode,productName,brand,quantity,rate,amount) VALUES (?,?,?,?,?,?,?,?,?)')
                    ->execute([gen_id(), $id, $sid, $l['itemCode'], mb_substr($l['productName'], 0, 255), $l['brand'], $l['quantity'], $l['rate'], $l['amount']]);
            }
            unset($l);
            db()->prepare('INSERT INTO `StockInward` (id,inwardNo,vendorId,supplierName,invoiceNo,invoiceDate,receivedDate,locType,state,notes,totalQty,totalAmount,createdById,createdAt)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id, $no, $vendor['id'] ?? null, $supplier, self::str($b['invoiceNo'] ?? '', 60), to_date_only($b['invoiceDate'] ?? '') ?: null, $recv,
                           $lt, $ls, trim((string) ($b['notes'] ?? '')) ?: null, round($tq, 2), round($ta, 2), $auth['id'], now_sql()]);
            db()->commit();
        } catch (Throwable $e) { db()->rollBack(); sendError('Could not save the inward: ' . $e->getMessage(), 500); }
        log_activity($auth['id'], 'STOCK_INWARD', 'StockInward', $id, ['inwardNo' => $no, 'supplier' => $supplier, 'qty' => $tq]);
        sendSuccess(['id' => $id, 'inwardNo' => $no], "Inward $no saved — " . qtyfmt($tq) . ' added to ' . StockLedger::label($lt, $ls), 201);
    }

    public function deleteInward(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        StockLedger::ensure();
        $s = db()->prepare('SELECT * FROM `StockInward` WHERE id=?'); $s->execute([$id]);
        $w = $s->fetch();
        if (!$w) sendError('Inward not found.', 404);
        $i = db()->prepare('SELECT * FROM `StockInwardItem` WHERE inwardId=?'); $i->execute([$id]);
        db()->beginTransaction();
        try {
            foreach ($i->fetchAll() as $l) {
                if ($l['stockId']) StockLedger::addLevel($l['stockId'], $w['locType'], $w['state'], -(float) $l['quantity'], 'INWARD_REVERSED', $auth['id'], null, 'Inward ' . $w['inwardNo'] . ' deleted');
            }
            db()->prepare('DELETE FROM `StockInwardItem` WHERE inwardId=?')->execute([$id]);
            db()->prepare('DELETE FROM `StockInward` WHERE id=?')->execute([$id]);
            db()->commit();
        } catch (Throwable $e) { db()->rollBack(); sendError('Could not delete: ' . $e->getMessage(), 500); }
        log_activity($auth['id'], 'STOCK_INWARD_DELETED', 'StockInward', $id, ['inwardNo' => $w['inwardNo']]);
        sendSuccess([], 'Inward ' . $w['inwardNo'] . ' deleted — stock taken back out');
    }

    public function exportInwards(): void
    {
        $this->guard();
        StockLedger::ensure();
        $from = to_date_only(qp('from')) ?: date('Y-m-01'); $to = to_date_only(qp('to')) ?: date('Y-m-d');
        $s = db()->prepare('SELECT w.*, x.itemCode, x.productName, x.brand, x.quantity, x.rate, x.amount, u.name AS byName
                            FROM `StockInward` w JOIN `StockInwardItem` x ON x.inwardId=w.id LEFT JOIN `User` u ON u.id=w.createdById
                            WHERE w.receivedDate BETWEEN ? AND ? ' . (qp('vendorId') ? 'AND w.vendorId=? ' : '') . 'ORDER BY w.receivedDate, w.inwardNo, x.itemCode');
        $s->execute(array_merge([$from, $to], qp('vendorId') ? [qp('vendorId')] : []));
        $rows = $s->fetchAll();
        $wb = new StyledXlsxWriter();
        $sh = $wb->addSheet('Inward register');
        $wb->setWidths($sh, [12, 16, 26, 16, 12, 22, 22, 34, 14, 10, 11, 13, 18]);
        $wb->addRow($sh, ['Stock inward register ' . date('d-m-Y', strtotime($from)) . ' to ' . date('d-m-Y', strtotime($to))], 'title');
        $wb->addRow($sh, ['Received', 'Inward No', 'Supplier', 'Invoice No', 'Invoice date', 'Added to', 'Item Code', 'Product', 'Brand', 'Qty', 'Rate', 'Amount', 'Entered by'], 'header', 26);
        $tq = $ta = 0;
        foreach ($rows as $r) {
            $wb->addRow($sh, [['v' => substr($r['receivedDate'], 0, 10), 't' => 'date', 's' => 'date'], $r['inwardNo'], $r['supplierName'], $r['invoiceNo'],
                $r['invoiceDate'] ? ['v' => substr($r['invoiceDate'], 0, 10), 't' => 'date', 's' => 'date'] : '', StockLedger::label($r['locType'], $r['state']),
                $r['itemCode'], $r['productName'], $r['brand'], (float) $r['quantity'], $r['rate'] === null ? '' : ['v' => (float) $r['rate'], 's' => 'num'],
                $r['amount'] === null ? '' : ['v' => (float) $r['amount'], 's' => 'num'], $r['byName']]);
            $tq += (float) $r['quantity']; $ta += (float) $r['amount'];
        }
        $wb->addRow($sh, ['', '', '', '', '', '', '', '', 'Total', ['v' => $tq, 's' => 'total'], '', ['v' => $ta, 's' => 'total'], ''], 'totallbl');
        $wb->freeze($sh, 2); $wb->autoFilter($sh, 'A2:M2');
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="stock-inward-' . $from . '-to-' . $to . '.xlsx"');
        echo $wb->output(); exit;
    }
}
