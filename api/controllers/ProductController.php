<?php
class ProductController
{
    public function __construct()
    {
        // Catalogue details: brand, insert grade, specification (e.g. SNMX 1206ANN-MM), tool type.
        ensure_schema(['Product' => ['create' => '', 'columns' => [
            'brand'         => 'VARCHAR(100) NULL',
            'grade'         => 'VARCHAR(100) NULL',
            'specification' => 'VARCHAR(255) NULL',
            'productType'   => 'VARCHAR(60) NULL',
        ]]], 'Product catalogue columns');
    }

    /** Lower-case, no spaces / dashes / dots / slashes — so "SNMX1206" finds "SNMX 1206-ANN". */
    public static function squash(string $s): string { return strtolower(preg_replace('/[\s\-\.\/_]+/', '', $s)); }
    private const SQ = "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(%s,' ',''),'-',''),'.',''),'/',''),'_',''))";

    // GET /api/products
    public function index(): void
    {
        authenticate();
        [$page, $limit, $offset] = paginate(20);
        $search = qp('search',''); $category = qp('category',''); $categoryId = qp('categoryId','');

        $where = ['p.isActive=1']; $params = [];
        if ($search) {
            $like = "%$search%";
            $sq = '%' . self::squash($search) . '%';
            $where[] = '(p.itemCode LIKE ? OR p.productName LIKE ? OR p.description LIKE ? OR p.grade LIKE ? OR p.brand LIKE ? OR '
                     . sprintf(self::SQ, 'p.itemCode') . ' LIKE ? OR ' . sprintf(self::SQ, "COALESCE(p.specification,'')") . ' LIKE ?)';
            $params = array_merge($params,[$like,$like,$like,$like,$like,$sq,$sq]);
        }
        if ($category)   { $where[] = 'p.category=?';   $params[] = $category; }
        if ($categoryId) { $where[] = 'p.categoryId=?'; $params[] = $categoryId; }
        $w = 'WHERE ' . implode(' AND ', $where);

        $s = db()->prepare("SELECT COUNT(*) FROM `Product` p $w"); $s->execute($params);
        $total = (int)$s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT p.*, c.id AS cat_id, c.name AS cat_name, c.color AS cat_color,
                    st.id AS stock_id, st.availableStock, st.netPrice AS stock_price,
                    st.minimumStock, st.xceedLp
             FROM `Product` p
             LEFT JOIN `Category` c ON c.id=p.categoryId
             LEFT JOIN `Stock` st ON st.productId=p.id
             $w ORDER BY c.sortOrder ASC, p.itemCode ASC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params,[$limit,$offset]));
        $items = array_map([$this,'shape'],$s2->fetchAll());
        sendPaginated($items,$total,$page,$limit,'Products fetched');
    }

    // GET /api/products/search?q=&limit= — type-ahead for quotations / orders / price requests.
    // Matches item code, specification, name, grade and brand; spaces and dashes are ignored
    // (SNMX, snmx1206, "SNMX 1206 ANN" all match). Code / spec prefix matches come first.
    // Each result carries the stock (hand stock + total) when the item is in Stock.
    public function search(): void
    {
        $auth = authenticate();
        $q = trim(qp('q',''));
        if (strlen($q)<1) { sendSuccess(['results' => []]); }
        $limit = max(1, min(50, (int) qp('limit', 20)));
        $like = "%$q%"; $sq = self::squash($q); $sqLike = "%$sq%"; $sqPre = "$sq%";
        $code = sprintf(self::SQ, 'p.itemCode'); $spec = sprintf(self::SQ, "COALESCE(p.specification,'')");
        $s = db()->prepare(
            "SELECT p.id,p.itemCode,p.productName,p.description,p.unit,p.standardPrice,p.hsnCode,p.categoryId,p.category,
                    p.brand,p.grade,p.specification,p.productType,
                    c.name AS cat_name, c.color AS cat_color
             FROM `Product` p LEFT JOIN `Category` c ON c.id=p.categoryId
             WHERE p.isActive=1 AND (p.itemCode LIKE ? OR p.description LIKE ? OR p.productName LIKE ? OR p.grade LIKE ? OR p.brand LIKE ?
                                     OR $code LIKE ? OR $spec LIKE ?)
             ORDER BY ($code LIKE ? OR $spec LIKE ?) DESC, ($code = ? OR $spec = ?) DESC, p.itemCode ASC LIMIT $limit"
        );
        $s->execute([$like,$like,$like,$like,$like,$sqLike,$sqLike,$sqPre,$sqPre,$sq,$sq]);
        $rows = $s->fetchAll();
        // stock for the results (by product id or item code)
        $stock = [];
        if ($rows) {
            try {
                StockLedger::ensure();
                $codes = array_column($rows, 'itemCode'); $ids = array_column($rows, 'id');
                $in1 = implode(',', array_fill(0, count($codes), '?')); $in2 = implode(',', array_fill(0, count($ids), '?'));
                $st = db()->prepare("SELECT id,itemCode,productId,availableStock,netPrice FROM `Stock` WHERE isActive=1 AND (itemCode IN ($in1) OR productId IN ($in2))");
                $st->execute(array_merge($codes, $ids));
                $srows = $st->fetchAll();
                $lv = StockLedger::levels(array_column($srows, 'id'));
                $res = StockLedger::reserved(array_column($srows, 'id'));
                foreach ($srows as $r) {
                    $l = $lv[$r['id']] ?? ['HAND' => 0, 'LOCAL' => 0, 'states' => []];
                    $info = ['hand' => (float) $l['HAND'], 'local' => (float) $l['LOCAL'], 'state' => (float) array_sum($l['states']),
                             'total' => (float) $r['availableStock'], 'onOrder' => (float) ($res[$r['id']] ?? 0), 'netPrice' => (float) $r['netPrice']];
                    if ($r['productId']) $stock['id:' . $r['productId']] = $info;
                    $stock['code:' . strtoupper($r['itemCode'])] = $info;
                }
            } catch (Throwable $e) { error_log('product search stock: ' . $e->getMessage()); }
        }
        // vendor prices / stock — for Manager / Admin only (buying prices)
        $offers = ($rows && is_admin_tier($auth['role']) && class_exists('VendorController')) ? VendorController::offers(array_column($rows, 'itemCode')) : [];
        $results = array_map(function($r) use ($stock, $offers) {
            if ($offers) $r['vendors'] = array_slice($offers[strtoupper($r['itemCode'])] ?? [], 0, 4);
            $r['categoryRef'] = $r['cat_name'] ? ['name'=>$r['cat_name'],'color'=>$r['cat_color']] : null;
            $r['standardPrice'] = (float) $r['standardPrice'];
            $r['stock'] = $stock['id:' . $r['id']] ?? $stock['code:' . strtoupper($r['itemCode'])] ?? null;
            unset($r['cat_name'],$r['cat_color']); return $r;
        },$rows);
        sendSuccess(['results'=>$results]);
    }

    // GET /api/products/code/:code
    public function byCode(string $code): void
    {
        authenticate();
        $s = db()->prepare(
            'SELECT p.*, c.id AS cat_id,c.name AS cat_name,c.color AS cat_color,
                    st.id AS stock_id,st.availableStock,st.netPrice AS stock_price,st.minimumStock,st.xceedLp
             FROM `Product` p LEFT JOIN `Category` c ON c.id=p.categoryId LEFT JOIN `Stock` st ON st.productId=p.id
             WHERE p.itemCode=? LIMIT 1'
        );
        $s->execute([$code]);
        $row = $s->fetch();
        if (!$row) sendError('Item code not found.',404);
        sendSuccess(['product'=>$this->shape($row)]);
    }

    // GET /api/products/:id
    public function show(string $id): void
    {
        authenticate();
        $s = db()->prepare(
            'SELECT p.*, c.id AS cat_id,c.name AS cat_name,c.color AS cat_color,
                    st.id AS stock_id,st.availableStock,st.netPrice AS stock_price,st.minimumStock,st.xceedLp
             FROM `Product` p LEFT JOIN `Category` c ON c.id=p.categoryId LEFT JOIN `Stock` st ON st.productId=p.id
             WHERE p.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) sendError('Product not found.',404);
        sendSuccess(['product'=>$this->shape($row)]);
    }

    // POST /api/products
    public function create(): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();
        $itemCode = strtoupper(trim($b['itemCode']??''));
        $productName = trim($b['productName']??'');
        if (!$itemCode||!$productName) sendError('Item code and product name are required.',400);

        $s = db()->prepare('SELECT id FROM `Product` WHERE itemCode=? LIMIT 1'); $s->execute([$itemCode]);
        if ($s->fetch()) sendError('Item code already exists.',409);

        $id = gen_id();
        db()->prepare(
            'INSERT INTO `Product` (id,itemCode,productName,description,unit,standardPrice,category,categoryId,
             productRef,isCustom,drawingNumber,revisionNumber,hsnCode,brand,grade,specification,productType,isActive,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)'
        )->execute([
            $id,$itemCode,$productName,
            $b['description']??null,$b['unit']??null,
            (float)($b['standardPrice']??0),
            $b['category']??null,($b['categoryId']??null)?:null,
            $b['productRef']??null,(int)!empty($b['isCustom']),
            $b['drawingNumber']??null,$b['revisionNumber']??null,$b['hsnCode']??null,
            ($b['brand']??null)?:null,($b['grade']??null)?:null,($b['specification']??null)?:null,($b['productType']??null)?:null,
            now_sql(),now_sql(),
        ]);
        $this->show($id);
    }

    // PUT /api/products/:id
    public function update(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();
        $sets=[]; $params=[];
        $str=fn($k)=>$b[$k]??null;
        foreach(['productName','description','unit','category','productRef','drawingNumber','revisionNumber','hsnCode','brand','grade','specification','productType'] as $f) {
            if(array_key_exists($f,$b)){$sets[]="$f=?";$params[]=$str($f);}
        }
        if(array_key_exists('standardPrice',$b)){$sets[]='standardPrice=?';$params[]=(float)$b['standardPrice'];}
        if(array_key_exists('categoryId',$b)){$sets[]='categoryId=?';$params[]=$b['categoryId']?:null;}
        if(array_key_exists('isCustom',$b)){$sets[]='isCustom=?';$params[]=(int)(bool)$b['isCustom'];}
        if($sets){$sets[]='updatedAt=?';$params[]=now_sql();$params[]=$id;
            db()->prepare('UPDATE `Product` SET '.implode(',',$sets).' WHERE id=?')->execute($params);}
        $this->show($id);
    }

    // GET /api/products/export
    public function export(): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->query('SELECT p.itemCode,p.productName,p.category,p.unit,p.standardPrice,p.hsnCode,p.isActive,p.brand,p.productType,p.specification,p.grade,c.name AS catName FROM `Product` p LEFT JOIN `Category` c ON c.id=p.categoryId ORDER BY p.itemCode');
        $w = new XlsxWriter('Products');
        $w->addRow(['Item Code','Product Name','Category','Unit','Standard Price','HSN Code','Active','Brand','Product Type','Specification','Grade']);
        foreach($s->fetchAll() as $r) $w->addRow([$r['itemCode'],$r['productName'],$r['catName']??$r['category'],$r['unit'],$r['standardPrice'],$r['hsnCode'],$r['isActive']?'Yes':'No',$r['brand'],$r['productType'],$r['specification'],$r['grade']]);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="products-export.xlsx"');
        echo $w->output(); exit;
    }

    private function shape(array $r): array
    {
        $r['isActive']=(bool)$r['isActive']; $r['isCustom']=(bool)$r['isCustom'];
        $r['standardPrice']=(float)$r['standardPrice'];
        $r['categoryRef'] = ($r['cat_id']??null) ? ['id'=>$r['cat_id'],'name'=>$r['cat_name'],'color'=>$r['cat_color']] : null;
        $r['stock'] = ($r['stock_id']??null) ? ['id'=>$r['stock_id'],'availableStock'=>(float)$r['availableStock'],'netPrice'=>(float)$r['stock_price'],'minimumStock'=>(float)$r['minimumStock'],'xceedLp'=>(float)$r['xceedLp']] : null;
        foreach(['cat_id','cat_name','cat_color','stock_id','availableStock','stock_price','minimumStock','xceedLp'] as $k) unset($r[$k]);
        return $r;
    }

    // ── Excel template + bulk import ─────────────────────────────────
    // Columns are matched by their header text (any order, case-insensitive),
    // so an exported product list can be edited and imported straight back.
    private const IMPORT_COLUMNS = [
        'itemCode'       => ['item code', 'itemcode', 'code', 'item no', 'part no', 'product code', 'cutter code', 'insert code', 'order code', 'ordering code',
                             'article no', 'article number', 'catalogue no', 'catalog no', 'cat no', 'edp', 'edp no', 'edp number', 'part number', 'sku'],
        'productName'    => ['product name', 'productname', 'name', 'item name', 'itemname', 'product', 'item description'],
        'description'    => ['description', 'desc'],
        'unit'           => ['unit', 'uom'],
        'standardPrice'  => ['standard price', 'price', 'rate', 'list price', 'price (₹)', 'standardprice'],
        'category'       => ['category', 'item group', 'group'],
        'hsnCode'        => ['hsn code', 'hsn', 'hsncode'],
        'drawingNumber'  => ['drawing number', 'drawing', 'drawing no'],
        'revisionNumber' => ['revision number', 'revision', 'rev'],
        'productRef'     => ['product ref', 'reference', 'ref'],
        'isActive'       => ['active', 'is active', 'status'],
        'brand'          => ['brand', 'make', 'manufacturer'],
        'productType'    => ['product type', 'type', 'tool type', 'item type'],
        'specification'  => ['specification', 'spec', 'insert specification', 'insert spec', 'cutter specification', 'iso code', 'iso designation', 'designation', 'geometry'],
        'grade'          => ['grade', 'insert grade', 'carbide grade', 'grades'],
    ];

    // GET /api/products/template
    public function template(): void
    {
        authenticate();
        $w = new XlsxWriter('Products');
        $w->setForceTextColumns([0, 6]); // keep item codes / HSN like 0012 as text
        $w->addRow(['Item Code *', 'Product Name *', 'Description', 'Unit', 'Standard Price', 'Category', 'HSN Code', 'Drawing Number', 'Revision Number', 'Product Ref', 'Active (Yes/No)', 'Brand', 'Product Type', 'Specification', 'Grade']);
        $w->addRow(['CNMG120408-MF', 'CNMG 120408-MF Turning Insert', 'Carbide insert for steel finishing', 'nos', 250, 'Inserts', '82090090', '', '', '', 'Yes', 'YG-1', 'Insert', 'CNMG 120408-MF', 'YG3020']);
        $w->addRow(['SNMX1206ANN-MM-YG602', 'SNMX 1206ANN-MM Milling Insert', '', 'nos', 420, 'Inserts', '82090090', '', '', '', 'Yes', 'YG-1', 'Insert', 'SNMX 1206ANN-MM', 'YG602']);
        $w->addRow(['HF-D50-Z5', 'Hi-feed cutter D50 Z5', '', 'nos', 18500, 'Cutters', '82077090', '', '', '', 'Yes', 'YG-1', 'Cutter', 'SNMX12 D50 Z5 Arbor 22', '']);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="product-upload-template.xlsx"');
        echo $w->output(); exit;
    }

    private static function normHeader($h): string { return trim(preg_replace('/\s+/', ' ', strtolower(str_replace(['*', '(yes/no)', '.', ':'], '', (string) $h)))); }
    private static function fieldOf(string $h): ?string { foreach (self::IMPORT_COLUMNS as $f => $al) if (in_array($h, $al, true)) return $f; return null; }
    /** Index of the header row (has an item-code column) in the first 10 rows, or null. */
    private static function headerRow(array $rows): ?int
    {
        foreach (array_slice($rows, 0, 10, true) as $i => $r) {
            foreach ((array) $r as $h) if (self::fieldOf(self::normHeader($h)) === 'itemCode') return $i;
        }
        return null;
    }
    /** Rewrites a sheet (header + rows) into the column order of $header. */
    private static function remap(array $header, array $body): array
    {
        $target = [];
        foreach ($header as $i => $h) if (($f = self::fieldOf(self::normHeader($h)))) $target[$f] = $i;
        $src = [];
        foreach ($body[0] as $i => $h) if (($f = self::fieldOf(self::normHeader($h)))) $src[$f] = $i;
        $out = [];
        foreach (array_slice($body, 1) as $r) {
            $row = array_fill(0, count($header), '');
            foreach ($src as $f => $i) if (isset($target[$f])) $row[$target[$f]] = $r[$i] ?? '';
            $out[] = $row;
        }
        return $out;
    }

    // POST /api/products/import  (multipart "file": .xlsx or .csv)
    // Upserts by item code: existing codes are updated, new codes are created.
    // Blank cells leave an existing product's value unchanged.
    public function import(): void
    {
        $auth = authenticate(); require_admin($auth);
        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) sendError('Please choose the filled-in Excel (.xlsx) or CSV file.', 400);
        $tmp = $_FILES['file']['tmp_name']; $name = $_FILES['file']['name'] ?? '';
        $sheets = [];
        if (preg_match('/\.csv$/i', $name)) {
            $rr = [];
            if (($fh = fopen($tmp, 'r')) !== false) { while (($r = fgetcsv($fh)) !== false) $rr[] = $r; fclose($fh); }
            $sheets[] = ['rows' => $rr];
        } elseif (preg_match('/\.xlsx$/i', $name)) {
            // Catalogues often have several sheets (inserts, cutters, drills…): read them all.
            try { $sheets = XlsxReader::readAllSheets($tmp); }
            catch (\Exception $e) { sendError('Could not read the Excel file: ' . $e->getMessage(), 400); }
        } else {
            sendError('Upload an .xlsx (Excel) or .csv file. Old .xls files: open in Excel and "Save As" .xlsx first.', 400);
        }
        // Any layout: each sheet's columns are recognised by name (exact, then by keywords —
        // ColumnGuess) and copied into one table in our field order. Only a product code and a
        // name / description are needed; unrecognised columns are kept in the description.
        $fields = array_keys(self::IMPORT_COLUMNS);
        $map = array_flip($fields); $map['extra'] = count($fields);
        $rows = [array_merge($fields, ['extra'])];
        $g = ColumnGuess::productRules();
        $fuzzy = ['itemCode' => $g['itemCode'], 'standardPrice' => $g['price'], 'brand' => $g['brand'], 'unit' => $g['unit'], 'category' => $g['group'],
                  'hsnCode' => $g['hsn'], 'grade' => $g['grade'], 'productName' => [['product name', 'item name', 'name', 'particular', 'particulars', 'product', 'goods', 'material'], ['code', 'no', 'group', 'type', 'brand', 'hsn']],
                  'description' => [['description', 'desc', 'details', 'remarks'], ['code']], 'specification' => [['specification', 'spec', 'designation', 'size', 'geometry'], []]];
        $noName = false;
        foreach ($sheets as $sh) {
            $hit = ColumnGuess::find($sh['rows'], self::IMPORT_COLUMNS, $fuzzy, 'itemCode', 15);
            if (!$hit) continue;
            if (!isset($hit['map']['productName']) && !isset($hit['map']['specification']) && !isset($hit['map']['description'])) { $noName = true; continue; }
            foreach (array_slice($sh['rows'], $hit['row'] + 1) as $r) {
                $out = [];
                foreach ($fields as $f) $out[] = isset($hit['map'][$f]) ? ($r[$hit['map'][$f]] ?? '') : '';
                $out[] = ColumnGuess::extraText($r, $hit['extra']) ?? '';
                $rows[] = $out;
            }
        }
        if (count($rows) < 2) {
            sendError($noName ? 'Found the product code column but no description / name column — add one (e.g. "Description").'
                : 'Could not find a product / item code column. The sheet needs a product code column and a description (any other columns are optional).', 400);
        }

        $cats = [];
        try { foreach (db()->query('SELECT id, name FROM `Category`')->fetchAll() as $c) $cats[strtolower(trim($c['name']))] = $c['id']; } catch (PDOException $e) {}
        $find = db()->prepare('SELECT * FROM `Product` WHERE itemCode=? LIMIT 1');
        $created = $updated = $skipped = 0; $errors = [];
        $seen = [];

        foreach ($rows as $i => $r) {
            if ($i === 0) continue;
            $get = function ($f) use ($r, $map) { return isset($map[$f]) ? trim((string) ($r[$map[$f]] ?? '')) : ''; };
            $code = strtoupper($get('itemCode'));
            $pname = $get('productName');
            if ($pname === '' && $get('specification') === '') $pname = $get('description');
            if ($code === '' && $pname === '') continue; // blank line
            $line = $i + 1;
            if ($code === '') { $errors[] = "Row $line: item code is missing."; $skipped++; continue; }
            if (isset($seen[$code])) { $errors[] = "Row $line: item code $code appears twice — only the first was used."; $skipped++; continue; }
            $seen[$code] = true;
            $priceRaw = str_replace([',', '₹', ' '], '', $get('standardPrice'));
            if ($priceRaw !== '' && !is_numeric($priceRaw)) { $errors[] = "Row $line ($code): price \"" . $get('standardPrice') . "\" is not a number."; $skipped++; continue; }
            $activeRaw = strtolower($get('isActive'));
            $active = $activeRaw === '' ? null : (in_array($activeRaw, ['no', 'n', '0', 'false', 'inactive'], true) ? 0 : 1);
            $cat = $get('category');
            $vals = [
                'productName' => $pname, 'description' => $get('description'), 'unit' => $get('unit'),
                'standardPrice' => $priceRaw === '' ? null : (float) $priceRaw, 'category' => $cat,
                'categoryId' => $cat !== '' ? ($cats[strtolower($cat)] ?? null) : null,
                'hsnCode' => $get('hsnCode'), 'drawingNumber' => $get('drawingNumber'),
                'revisionNumber' => $get('revisionNumber'), 'productRef' => $get('productRef'), 'isActive' => $active,
                'brand' => $get('brand'), 'productType' => $get('productType'), 'specification' => $get('specification'), 'grade' => $get('grade'),
            ];
            if ($get('extra') !== '') $vals['description'] = trim($vals['description'] . ($vals['description'] !== '' ? ' · ' : '') . $get('extra'));
            // The Products page lists the description: show the catalogue details there when none is given.
            if ($vals['description'] === '' && ($vals['specification'] !== '' || $vals['grade'] !== '')) {
                $vals['description'] = implode(' · ', array_filter([$vals['specification'], $vals['grade'] !== '' ? 'Grade ' . $vals['grade'] : '', $vals['brand']]));
            }
            try {
                $find->execute([$code]);
                $ex = $find->fetch();
                if ($ex) {
                    $sets = []; $params = [];
                    foreach ($vals as $k => $v) {
                        if ($v === null || $v === '') continue; // blank = keep existing
                        if ($k === 'categoryId' && $v === null) continue;
                        $sets[] = "`$k`=?"; $params[] = $v;
                    }
                    if ($sets) {
                        $params[] = now_sql(); $params[] = $ex['id'];
                        db()->prepare('UPDATE `Product` SET ' . implode(',', $sets) . ',updatedAt=? WHERE id=?')->execute($params);
                    }
                    $updated++;
                } else {
                    // Catalogues often have no separate name: build one from specification / grade.
                    if ($pname === '') $pname = trim(implode(' ', array_filter([$vals['specification'] ?: $code, $vals['grade'], $vals['productType']])));
                    db()->prepare(
                        'INSERT INTO `Product` (id,itemCode,productName,description,unit,standardPrice,category,categoryId,hsnCode,drawingNumber,revisionNumber,productRef,brand,productType,specification,grade,isActive,createdAt,updatedAt)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
                    )->execute([gen_id(), $code, $pname, $vals['description'] ?: null, $vals['unit'] ?: null, $vals['standardPrice'] ?? 0,
                        $cat ?: null, $vals['categoryId'], $vals['hsnCode'] ?: null, $vals['drawingNumber'] ?: null, $vals['revisionNumber'] ?: null,
                        $vals['productRef'] ?: null, $vals['brand'] ?: null, $vals['productType'] ?: null, $vals['specification'] ?: null, $vals['grade'] ?: null,
                        $active ?? 1, now_sql(), now_sql()]);
                    $created++;
                }
            } catch (PDOException $e) {
                $errors[] = "Row $line ($code): " . $e->getMessage(); $skipped++;
            }
        }
        log_activity($auth['id'], 'PRODUCTS_IMPORTED', 'Product', null, ['created' => $created, 'updated' => $updated, 'skipped' => $skipped, 'file' => $name]);
        sendSuccess(['created' => $created, 'updated' => $updated, 'skipped' => $skipped, 'errors' => array_slice($errors, 0, 50)],
            "Imported: $created new, $updated updated" . ($skipped ? ", $skipped skipped" : ''));
    }
}
