<?php
/**
 * Product catalogue — products by type, each with the details that matter
 * for that type, on the same Product table the rest of the CRM uses
 * (quotations, orders, price requests…):
 *
 *   INSERT   grade, corner radius, chip breaker, materials it cuts (ISO P M K N S H)
 *   CUTTER   diameter, no. of pockets, inserts that fit, arbor / shank
 *   ENDMILL  diameter, flutes, flute / overall length, corner radius, coating
 *   DRILL    diameter, length (xD), coolant through, point angle, coating
 *   TAP      thread size, pitch, tap type, coating
 *   GENERAL  anything else
 *
 * Every product gets a serial no. (1, 2, 3… in the order they were added).
 * Several brands; brands come from the products and the vendor master.
 * Catalogue PDFs can be uploaded per brand / type.
 *
 *   GET    /api/catalog?type=&brand=&q=          products + counts + brands
 *   POST   /api/catalog   PUT / DELETE /api/catalog/:id          (Admin)
 *   GET    /api/catalog/template?type=           Excel template for that type
 *   POST   /api/catalog/import?type=             multipart "file" (Admin)
 *   GET    /api/catalog/files    POST /api/catalog/files (multipart file, brand, type, title)
 *   GET    /api/catalog/files/:id    DELETE /api/catalog/files/:id
 */
class CatalogController
{
    public const TYPES = ['INSERT' => 'Insert', 'CUTTER' => 'Cutter', 'ENDMILL' => 'End mill', 'DRILL' => 'Drill', 'TAP' => 'Tap', 'GENERAL' => 'General'];
    public const ISO = ['P', 'M', 'K', 'N', 'S', 'H'];
    /** Type-specific fields: key => [label, kind] (kind: text | num | iso | bool). */
    public const FIELDS = [
        'INSERT'  => ['grade' => ['Grade', 'text'], 'cornerRadius' => ['Corner radius (mm)', 'num'], 'chipBreaker' => ['Chip breaker', 'text'], 'isoMaterials' => ['Materials it cuts (ISO)', 'iso'], 'coating' => ['Coating', 'text']],
        'CUTTER'  => ['diameter' => ['Cutter diameter (mm)', 'num'], 'pockets' => ['No. of pockets', 'num'], 'fitsInsert' => ['Insert that fits', 'text'], 'shank' => ['Arbor / shank', 'text']],
        'ENDMILL' => ['diameter' => ['Diameter (mm)', 'num'], 'flutes' => ['No. of flutes', 'num'], 'fluteLength' => ['Flute length (mm)', 'num'], 'overallLength' => ['Overall length (mm)', 'num'], 'cornerRadius' => ['Corner radius (mm)', 'num'], 'coating' => ['Coating', 'text'], 'isoMaterials' => ['Materials (ISO)', 'iso']],
        'DRILL'   => ['diameter' => ['Diameter (mm)', 'num'], 'lengthXd' => ['Length (xD)', 'text'], 'coolantThrough' => ['Coolant through', 'bool'], 'pointAngle' => ['Point angle (°)', 'num'], 'coating' => ['Coating', 'text'], 'isoMaterials' => ['Materials (ISO)', 'iso']],
        'TAP'     => ['threadSize' => ['Thread size', 'text'], 'pitch' => ['Pitch (mm)', 'num'], 'tapType' => ['Tap type', 'text'], 'coating' => ['Coating', 'text'], 'isoMaterials' => ['Materials (ISO)', 'iso']],
        'GENERAL' => [],
    ];
    private const NUM_COLS = ['cornerRadius', 'diameter', 'pockets', 'flutes', 'fluteLength', 'overallLength', 'pointAngle', 'pitch'];

    public static function schema(): array
    {
        return [
            'Product' => ['create' => '', 'columns' => [
                'brand' => 'VARCHAR(100) NULL', 'grade' => 'VARCHAR(100) NULL', 'specification' => 'VARCHAR(255) NULL', 'productType' => 'VARCHAR(60) NULL',
                'serialNo' => 'INT NULL', 'catType' => 'VARCHAR(10) NULL',
                'cornerRadius' => 'DECIMAL(8,3) NULL', 'chipBreaker' => 'VARCHAR(60) NULL', 'isoMaterials' => 'VARCHAR(20) NULL', 'coating' => 'VARCHAR(80) NULL',
                'diameter' => 'DECIMAL(10,3) NULL', 'pockets' => 'INT NULL', 'fitsInsert' => 'VARCHAR(255) NULL', 'shank' => 'VARCHAR(80) NULL',
                'flutes' => 'INT NULL', 'fluteLength' => 'DECIMAL(10,2) NULL', 'overallLength' => 'DECIMAL(10,2) NULL',
                'lengthXd' => 'VARCHAR(20) NULL', 'coolantThrough' => 'TINYINT(1) NULL', 'pointAngle' => 'DECIMAL(6,1) NULL',
                'threadSize' => 'VARCHAR(40) NULL', 'pitch' => 'DECIMAL(6,3) NULL', 'tapType' => 'VARCHAR(60) NULL',
            ]],
            'ProductCatalogueFile' => ['create' => "CREATE TABLE IF NOT EXISTS `ProductCatalogueFile` (
  `id` VARCHAR(30) NOT NULL, `brand` VARCHAR(100) NULL, `catType` VARCHAR(10) NULL, `title` VARCHAR(255) NOT NULL,
  `fileName` VARCHAR(255) NOT NULL, `storedName` VARCHAR(80) NOT NULL, `size` INT NOT NULL DEFAULT 0,
  `uploadedById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `ProductCatalogueFile_brand_idx` (`brand`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"],
        ];
    }

    public function __construct()
    {
        ensure_schema(self::schema(), 'Product catalogue');
        self::assignSerials();
    }

    /** Gives every product without one the next serial no., oldest first. Also guesses the type from the old free-text type. */
    public static function assignSerials(): void
    {
        try {
            $n = (int) db()->query('SELECT COUNT(*) FROM `Product` WHERE serialNo IS NULL')->fetchColumn();
            if ($n) {
                $max = (int) db()->query('SELECT COALESCE(MAX(serialNo),0) FROM `Product`')->fetchColumn();
                $ids = db()->query('SELECT id FROM `Product` WHERE serialNo IS NULL ORDER BY createdAt, id')->fetchAll(PDO::FETCH_COLUMN);
                $u = db()->prepare('UPDATE `Product` SET serialNo=? WHERE id=?');
                foreach ($ids as $id) $u->execute([++$max, $id]);
            }
            $m = db()->query('SELECT COUNT(*) FROM `Product` WHERE catType IS NULL')->fetchColumn();
            if ($m) {
                $rows = db()->query('SELECT id, productType, productName, category FROM `Product` WHERE catType IS NULL')->fetchAll();
                $u = db()->prepare('UPDATE `Product` SET catType=? WHERE id=?');
                foreach ($rows as $r) $u->execute([self::guessType($r['productType'] . ' ' . $r['category'] . ' ' . $r['productName']), $r['id']]);
            }
        } catch (PDOException $e) { error_log('assignSerials: ' . $e->getMessage()); }
    }

    public static function guessType(string $text): string
    {
        $t = strtolower($text);
        if (preg_match('/\binsert/', $t)) return 'INSERT';
        if (preg_match('/end ?mill|endmill/', $t)) return 'ENDMILL';
        if (preg_match('/cutter|face ?mill|milling body|hi-?feed/', $t)) return 'CUTTER';
        if (preg_match('/\bdrill/', $t)) return 'DRILL';
        if (preg_match('/\btap\b|\btaps\b|tapping/', $t)) return 'TAP';
        return 'GENERAL';
    }

    private static function auth(bool $write = false): array
    {
        $auth = authenticate();
        if ($write) require_admin($auth);
        return $auth;
    }

    private static function shape(array $r): array
    {
        $out = ['id' => $r['id'], 'serialNo' => $r['serialNo'] !== null ? (int) $r['serialNo'] : null, 'type' => $r['catType'] ?: 'GENERAL',
                'itemCode' => $r['itemCode'], 'productName' => $r['productName'], 'description' => $r['description'], 'brand' => $r['brand'],
                'specification' => $r['specification'], 'unit' => $r['unit'], 'standardPrice' => (float) $r['standardPrice'], 'hsnCode' => $r['hsnCode'],
                'category' => $r['category'], 'isActive' => (bool) $r['isActive'], 'createdAt' => $r['createdAt']];
        foreach (array_unique(array_merge(...array_map('array_keys', array_values(self::FIELDS)))) as $k) {
            $v = $r[$k] ?? null;
            if ($v !== null && in_array($k, self::NUM_COLS, true)) $v = (float) $v;
            if ($k === 'coolantThrough' && $v !== null) $v = (bool) $v;
            $out[$k] = $v;
        }
        return $out;
    }

    // GET /api/catalog
    public function index(): void
    {
        $auth = self::auth();
        $where = ['p.isActive=1']; $p = [];
        $type = strtoupper((string) qp('type', ''));
        if (isset(self::TYPES[$type])) { $where[] = 'p.catType=?'; $p[] = $type; }
        if (($b = trim((string) qp('brand', ''))) !== '') { $where[] = 'p.brand=?'; $p[] = $b; }
        if (($iso = strtoupper((string) qp('iso', ''))) !== '' && in_array($iso, self::ISO, true)) { $where[] = 'FIND_IN_SET(?, p.isoMaterials)'; $p[] = $iso; }
        if (($q = trim((string) qp('q', ''))) !== '') {
            $where[] = '(p.itemCode LIKE ? OR p.productName LIKE ? OR p.specification LIKE ? OR p.grade LIKE ? OR p.brand LIKE ? OR p.fitsInsert LIKE ? OR p.description LIKE ? OR p.serialNo=?)';
            $p = array_merge($p, array_fill(0, 7, "%$q%"), [ctype_digit($q) ? (int) $q : -1]);
        }
        $s = db()->prepare('SELECT p.* FROM `Product` p WHERE ' . implode(' AND ', $where) . ' ORDER BY p.serialNo DESC LIMIT 1000');
        $s->execute($p);
        $items = array_map([self::class, 'shape'], $s->fetchAll());
        // Which cutters an insert fits (reverse of "Insert that fits")
        $cutters = db()->query("SELECT itemCode, brand, fitsInsert FROM `Product` WHERE isActive=1 AND catType='CUTTER' AND fitsInsert IS NOT NULL AND fitsInsert<>''")->fetchAll();
        foreach ($items as &$it) {
            if ($it['type'] !== 'INSERT') continue;
            $code = ProductController::squash($it['itemCode']); $fits = [];
            foreach ($cutters as $c) foreach (preg_split('/[,;\/]+/', $c['fitsInsert']) as $f) {
                $f = ProductController::squash(trim($f));
                if ($f !== '' && (strpos($code, $f) === 0 || strpos($f, $code) === 0)) { $fits[] = $c['itemCode']; break; }
            }
            $it['fitsCutters'] = $fits;
        }
        unset($it);
        $counts = array_fill_keys(array_keys(self::TYPES), 0);
        foreach (db()->query("SELECT COALESCE(catType,'GENERAL') t, COUNT(*) n FROM `Product` WHERE isActive=1 GROUP BY COALESCE(catType,'GENERAL')")->fetchAll() as $r) $counts[$r['t']] = (int) $r['n'];
        sendSuccess(['items' => $items, 'counts' => $counts, 'brands' => self::brands(), 'types' => self::TYPES, 'fields' => self::FIELDS, 'iso' => self::ISO,
                     'canEdit' => in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)]);
    }

    private static function brands(): array
    {
        $b = db()->query("SELECT DISTINCT brand FROM `Product` WHERE brand IS NOT NULL AND brand<>'' ORDER BY brand")->fetchAll(PDO::FETCH_COLUMN);
        try {
            foreach (db()->query("SELECT brands FROM `Vendor` WHERE isActive=1 AND brands IS NOT NULL")->fetchAll(PDO::FETCH_COLUMN) as $list)
                foreach (preg_split('/[,;\/]+/', $list) as $x) { $x = trim($x); if ($x !== '' && !in_array(mb_strtolower($x), array_map('mb_strtolower', $b), true)) $b[] = $x; }
        } catch (PDOException $e) {}
        sort($b, SORT_NATURAL | SORT_FLAG_CASE);
        return $b;
    }

    /** Validated column => value for one product from the form / an Excel row. */
    private static function read(array $b, ?array $old): array
    {
        $type = strtoupper((string) ($b['type'] ?? ($old['catType'] ?? 'GENERAL')));
        if (!isset(self::TYPES[$type])) $type = 'GENERAL';
        $code = strtoupper(trim((string) ($b['itemCode'] ?? ($old['itemCode'] ?? ''))));
        if ($code === '') throw new InvalidArgumentException('Enter the product code.');
        $name = trim((string) ($b['productName'] ?? ''));
        $spec = trim((string) ($b['specification'] ?? ''));
        $d = ['catType' => $type, 'itemCode' => mb_substr($code, 0, 100), 'brand' => mb_substr(trim((string) ($b['brand'] ?? '')), 0, 100) ?: null,
              'specification' => mb_substr($spec, 0, 255) ?: null, 'description' => trim((string) ($b['description'] ?? '')) ?: null,
              'unit' => mb_substr(trim((string) ($b['unit'] ?? '')), 0, 20) ?: 'Nos', 'hsnCode' => mb_substr(trim((string) ($b['hsnCode'] ?? '')), 0, 30) ?: null,
              'productType' => self::TYPES[$type]];
        $price = str_replace([',', '₹', ' '], '', (string) ($b['standardPrice'] ?? ''));
        if ($price !== '' && !is_numeric($price)) throw new InvalidArgumentException('Price must be a number.');
        $d['standardPrice'] = $price === '' ? ($old['standardPrice'] ?? 0) : round((float) $price, 2);
        // every type-specific column: set for this type, cleared for others
        $all = array_unique(array_merge(...array_map('array_keys', array_values(self::FIELDS))));
        foreach ($all as $k) $d[$k] = null;
        foreach (self::FIELDS[$type] as $k => [$label, $kind]) {
            $v = $b[$k] ?? null;
            if ($kind === 'iso') {
                $list = is_array($v) ? $v : preg_split('/[\s,;\/]+/', strtoupper((string) $v));
                $list = array_values(array_intersect(self::ISO, array_map('strtoupper', array_map('trim', $list))));
                $d[$k] = $list ? implode(',', $list) : null;
            } elseif ($kind === 'bool') {
                $d[$k] = $v === null || $v === '' ? null : (in_array(strtolower((string) $v), ['1', 'yes', 'y', 'true', 'on'], true) ? 1 : 0);
            } elseif ($kind === 'num') {
                $v = str_replace([',', 'mm', 'R', 'r', '°', ' '], '', (string) ($v ?? ''));
                if ($v === '') continue;
                if (!is_numeric($v) || (float) $v < 0) throw new InvalidArgumentException("$label must be a number.");
                $d[$k] = in_array($k, ['pockets', 'flutes'], true) ? (int) $v : (float) $v;
            } else {
                $d[$k] = mb_substr(trim((string) ($v ?? '')), 0, 255) ?: null;
            }
        }
        if ($type === 'INSERT' && $d['grade']) $d['grade'] = strtoupper($d['grade']);
        if ($name === '') {
            // Build a readable name when none is typed: "SNMX 1206 · grade YG602 · R0.8"
            $bits = [$spec ?: $code];
            if ($type === 'INSERT') { if ($d['grade']) $bits[] = 'grade ' . $d['grade']; if ($d['cornerRadius'] !== null) $bits[] = 'R' . rtrim(rtrim(number_format($d['cornerRadius'], 3, '.', ''), '0'), '.'); }
            if (in_array($type, ['CUTTER', 'ENDMILL', 'DRILL'], true) && $d['diameter'] !== null) $bits[] = 'D' . rtrim(rtrim(number_format($d['diameter'], 3, '.', ''), '0'), '.');
            if ($type === 'CUTTER' && $d['pockets']) $bits[] = 'Z' . $d['pockets'];
            if ($type === 'TAP' && $d['threadSize']) $bits[] = $d['threadSize'];
            $name = self::TYPES[$type] . ' ' . implode(' · ', $bits);
        }
        $d['productName'] = mb_substr($name, 0, 255);
        return $d;
    }

    private static function save(array $d, ?string $id, string $userId): string
    {
        $dup = db()->prepare('SELECT id FROM `Product` WHERE itemCode=? AND id<>? LIMIT 1');
        $dup->execute([$d['itemCode'], $id ?? '']);
        if ($ex = $dup->fetchColumn()) {
            if ($id) throw new InvalidArgumentException('Product code ' . $d['itemCode'] . ' already exists.');
            $id = $ex; // same code → update that product (e.g. re-uploading a list)
            db()->prepare('UPDATE `Product` SET isActive=1 WHERE id=?')->execute([$id]);
        }
        if ($id) {
            $sets = implode(',', array_map(fn($c) => "`$c`=?", array_keys($d)));
            db()->prepare("UPDATE `Product` SET $sets, updatedAt=? WHERE id=?")->execute(array_merge(array_values($d), [now_sql(), $id]));
            return $id;
        }
        $id = gen_id();
        $serial = (int) db()->query('SELECT COALESCE(MAX(serialNo),0)+1 FROM `Product`')->fetchColumn();
        $d += ['id' => $id, 'serialNo' => $serial, 'isActive' => 1, 'createdAt' => now_sql(), 'updatedAt' => now_sql()];
        $cols = array_keys($d);
        db()->prepare('INSERT INTO `Product` (`' . implode('`,`', $cols) . '`) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')')->execute(array_values($d));
        return $id;
    }

    private static function one(string $id): array
    {
        $s = db()->prepare('SELECT * FROM `Product` WHERE id=?'); $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) sendError('Product not found.', 404);
        return $r;
    }

    // POST /api/catalog
    public function create(): void
    {
        $auth = self::auth(true);
        try { $id = self::save(self::read(request_body(), null), null, $auth['id']); }
        catch (InvalidArgumentException $e) { sendError($e->getMessage(), 400); }
        log_activity($auth['id'], 'CATALOG_PRODUCT_SAVED', 'Product', $id, []);
        sendSuccess(['item' => self::shape(self::one($id))], 'Product saved', 201);
    }

    // PUT /api/catalog/:id
    public function update(string $id): void
    {
        $auth = self::auth(true);
        $old = self::one($id);
        try { self::save(self::read(request_body(), $old), $id, $auth['id']); }
        catch (InvalidArgumentException $e) { sendError($e->getMessage(), 400); }
        log_activity($auth['id'], 'CATALOG_PRODUCT_SAVED', 'Product', $id, []);
        sendSuccess(['item' => self::shape(self::one($id))], 'Product saved');
    }

    // DELETE /api/catalog/:id — hides it (old quotations / orders still point at it)
    public function delete(string $id): void
    {
        $auth = self::auth(true);
        self::one($id);
        db()->prepare('UPDATE `Product` SET isActive=0, updatedAt=? WHERE id=?')->execute([now_sql(), $id]);
        log_activity($auth['id'], 'CATALOG_PRODUCT_REMOVED', 'Product', $id, []);
        sendSuccess([], 'Product removed');
    }

    private static function templateCols(string $type): array
    {
        $cols = ['itemCode' => 'Product code *', 'brand' => 'Brand', 'specification' => 'Specification / designation', 'productName' => 'Product name (optional)'];
        foreach (self::FIELDS[$type] as $k => [$label, $kind]) $cols[$k] = $label . ($kind === 'iso' ? ' — e.g. P,M,K' : ($kind === 'bool' ? ' (Yes/No)' : ''));
        return $cols + ['standardPrice' => 'Price (Rs)', 'unit' => 'Unit', 'hsnCode' => 'HSN code', 'description' => 'Description'];
    }

    // GET /api/catalog/template?type=
    public function template(): void
    {
        self::auth();
        $type = strtoupper((string) qp('type', 'INSERT')); if (!isset(self::TYPES[$type])) $type = 'GENERAL';
        $cols = self::templateCols($type);
        $w = new XlsxWriter(self::TYPES[$type] . 's');
        $w->setForceTextColumns([0]);
        $w->addRow(array_values($cols));
        $ex = ['INSERT' => ['itemCode' => 'SNMX1206ANN-MM-YG602', 'brand' => 'YG-1', 'specification' => 'SNMX 1206ANN-MM', 'grade' => 'YG602', 'cornerRadius' => '0.8', 'chipBreaker' => 'MM', 'isoMaterials' => 'P,M,K', 'standardPrice' => '420'],
               'CUTTER' => ['itemCode' => 'HF-D63-Z5', 'brand' => 'YG-1', 'specification' => 'Hi-feed face mill', 'diameter' => '63', 'pockets' => '5', 'fitsInsert' => 'SNMX1206', 'shank' => 'Arbor 22', 'standardPrice' => '18500'],
               'ENDMILL' => ['itemCode' => 'EM-10-4F', 'brand' => 'YG-1', 'specification' => 'Solid carbide end mill', 'diameter' => '10', 'flutes' => '4', 'fluteLength' => '22', 'overallLength' => '72', 'coating' => 'TiAlN', 'isoMaterials' => 'P,M'],
               'DRILL' => ['itemCode' => 'DR-8.5-5D', 'brand' => 'Taegutec', 'specification' => 'Solid carbide drill', 'diameter' => '8.5', 'lengthXd' => '5xD', 'coolantThrough' => 'Yes', 'pointAngle' => '140'],
               'TAP' => ['itemCode' => 'TAP-M10-SP', 'brand' => 'YG-1', 'specification' => 'Spiral point tap', 'threadSize' => 'M10', 'pitch' => '1.5', 'tapType' => 'Spiral point'],
               'GENERAL' => ['itemCode' => 'ER32-COLLET-10', 'brand' => 'Rego-Fix', 'specification' => 'ER32 collet 10 mm']][$type];
        $w->addRow(array_map(fn($k) => $ex[$k] ?? '', array_keys($cols)));
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . strtolower(str_replace(' ', '-', self::TYPES[$type])) . '-upload-template.xlsx"');
        echo $w->output(); exit;
    }

    // POST /api/catalog/import?type= — the type's template, or any sheet with those headings
    public function import(): void
    {
        $auth = self::auth(true);
        $type = strtoupper((string) (qp('type') ?: ($_POST['type'] ?? 'GENERAL'))); if (!isset(self::TYPES[$type])) $type = 'GENERAL';
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('Choose the Excel file.', 400);
        try { $sheets = preg_match('/\.csv$/i', (string) $f['name']) ? [['rows' => array_map('str_getcsv', file($f['tmp_name']))]] : XlsxReader::readAllSheets($f['tmp_name']); }
        catch (\Exception $e) { sendError('Could not read the file: ' . $e->getMessage(), 400); }
        $aliases = [];
        foreach (self::templateCols($type) as $k => $label) $aliases[$k] = [preg_replace('/\s*(\*|\(.*\)|—.*)$/u', '', $label), $label, $k];
        $g = ColumnGuess::productRules();
        $fuzzy = ['itemCode' => $g['itemCode'], 'brand' => $g['brand'], 'standardPrice' => $g['price'], 'grade' => [['grade'], []],
                  'cornerRadius' => [['corner', 'radius', 're', 'nose'], []], 'pockets' => [['pocket', 'teeth', 'z'], []], 'diameter' => [['dia', 'diameter', 'dc', 'd1'], []],
                  'fitsInsert' => [['insert'], []], 'flutes' => [['flute', 'flutes'], ['length']], 'isoMaterials' => [['material', 'iso', 'application'], []],
                  'threadSize' => [['thread', 'size'], ['pitch']], 'pitch' => [['pitch'], []], 'specification' => [['specification', 'designation', 'description', 'name'], ['code']]];
        $done = 0; $errors = [];
        foreach ($sheets as $sh) {
            $hit = ColumnGuess::find($sh['rows'], $aliases, $fuzzy, 'itemCode', 15);
            if (!$hit) continue;
            foreach (array_slice($sh['rows'], $hit['row'] + 1, null, true) as $i => $row) {
                $b = ['type' => $type];
                foreach ($hit['map'] as $k => $ci) $b[$k] = $row[$ci] ?? '';
                if (trim((string) ($b['itemCode'] ?? '')) === '') continue;
                if (empty($b['description']) && ($extra = ColumnGuess::extraText($row, $hit['extra']))) $b['description'] = $extra;
                try { self::save(self::read($b, null), null, $auth['id']); $done++; }
                catch (\Throwable $e) { $errors[] = 'Row ' . ($i + 1) . ': ' . $e->getMessage(); }
            }
        }
        if (!$done && !$errors) sendError('No product code column found — download the ' . self::TYPES[$type] . ' template to see the layout.', 400);
        log_activity($auth['id'], 'CATALOG_IMPORTED', 'Product', null, ['type' => $type, 'rows' => $done]);
        sendSuccess(['saved' => $done, 'errors' => array_slice($errors, 0, 30)], "$done " . strtolower(self::TYPES[$type]) . ($done === 1 ? '' : 's') . ' saved' . ($errors ? ', ' . count($errors) . ' row(s) skipped' : ''));
    }

    // ── catalogue PDFs ────────────────────────────────────────────────
    public function files(): void
    {
        self::auth();
        $rows = db()->query('SELECT f.*, u.name AS uploadedBy FROM `ProductCatalogueFile` f LEFT JOIN `User` u ON u.id=f.uploadedById ORDER BY f.brand, f.createdAt DESC')->fetchAll();
        sendSuccess(['files' => $rows]);
    }

    public function uploadFile(): void
    {
        $auth = self::auth(true);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('Choose the catalogue PDF.', 400);
        if ($f['size'] > 60 * 1024 * 1024) sendError('The PDF is larger than 60 MB.', 400);
        if (strpos((string) file_get_contents($f['tmp_name'], false, null, 0, 5), '%PDF') !== 0) sendError('Upload the catalogue as a PDF file.', 400);
        $dir = UPLOADS_PATH . '/catalogues';
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the file on the server.', 500);
        $id = gen_id(); $stored = $id . '.pdf';
        if (!(@move_uploaded_file($f['tmp_name'], "$dir/$stored") || @rename($f['tmp_name'], "$dir/$stored"))) sendError('Could not save the file on the server.', 500);
        $type = strtoupper((string) ($_POST['type'] ?? '')); if (!isset(self::TYPES[$type])) $type = null;
        $name = mb_substr(preg_replace('/[^\w.\- ()]+/u', '_', (string) $f['name']), 0, 255);
        $title = mb_substr(trim((string) ($_POST['title'] ?? '')), 0, 255) ?: preg_replace('/\.pdf$/i', '', $name);
        db()->prepare('INSERT INTO `ProductCatalogueFile` (id,brand,catType,title,fileName,storedName,size,uploadedById,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$id, mb_substr(trim((string) ($_POST['brand'] ?? '')), 0, 100) ?: null, $type, $title, $name, $stored, (int) $f['size'], $auth['id'], now_sql()]);
        log_activity($auth['id'], 'CATALOGUE_PDF_UPLOADED', 'ProductCatalogueFile', $id, ['title' => $title]);
        sendSuccess(['id' => $id], 'Catalogue uploaded', 201);
    }

    public function downloadFile(string $id): void
    {
        self::auth();
        $s = db()->prepare('SELECT * FROM `ProductCatalogueFile` WHERE id=?'); $s->execute([$id]);
        $f = $s->fetch();
        $path = $f ? UPLOADS_PATH . '/catalogues/' . basename($f['storedName']) : '';
        if (!$f || !is_file($path)) sendError('Catalogue not found.', 404);
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/pdf');
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: ' . (qp('download') ? 'attachment' : 'inline') . '; filename="' . str_replace('"', '', $f['fileName']) . '"');
        readfile($path); exit;
    }

    public function deleteFile(string $id): void
    {
        self::auth(true);
        $s = db()->prepare('SELECT storedName FROM `ProductCatalogueFile` WHERE id=?'); $s->execute([$id]);
        $st = $s->fetchColumn();
        if (!$st) sendError('Catalogue not found.', 404);
        @unlink(UPLOADS_PATH . '/catalogues/' . basename($st));
        db()->prepare('DELETE FROM `ProductCatalogueFile` WHERE id=?')->execute([$id]);
        sendSuccess([], 'Catalogue removed');
    }
}
