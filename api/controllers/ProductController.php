<?php
class ProductController
{
    // GET /api/products
    public function index(): void
    {
        authenticate();
        [$page, $limit, $offset] = paginate(20);
        $search = qp('search',''); $category = qp('category',''); $categoryId = qp('categoryId','');

        $where = ['p.isActive=1']; $params = [];
        if ($search) {
            $like = "%$search%";
            $where[] = '(p.itemCode LIKE ? OR p.productName LIKE ? OR p.description LIKE ?)';
            $params = array_merge($params,[$like,$like,$like]);
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

    // GET /api/products/search?q=
    public function search(): void
    {
        authenticate();
        $q = trim(qp('q',''));
        if (strlen($q)<1) { sendSuccess(['results' => []]); }
        $like = "%$q%";
        $s = db()->prepare(
            "SELECT p.id,p.itemCode,p.productName,p.description,p.unit,p.standardPrice,p.hsnCode,p.categoryId,
                    c.name AS cat_name, c.color AS cat_color
             FROM `Product` p LEFT JOIN `Category` c ON c.id=p.categoryId
             WHERE p.isActive=1 AND (p.itemCode LIKE ? OR p.description LIKE ? OR p.productName LIKE ?)
             ORDER BY p.itemCode ASC LIMIT 15"
        );
        $s->execute([$like,$like,$like]);
        $results = array_map(function($r){
            $r['categoryRef'] = $r['cat_name'] ? ['name'=>$r['cat_name'],'color'=>$r['cat_color']] : null;
            unset($r['cat_name'],$r['cat_color']); return $r;
        },$s->fetchAll());
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
             productRef,isCustom,drawingNumber,revisionNumber,hsnCode,isActive,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)'
        )->execute([
            $id,$itemCode,$productName,
            $b['description']??null,$b['unit']??null,
            (float)($b['standardPrice']??0),
            $b['category']??null,($b['categoryId']??null)?:null,
            $b['productRef']??null,(int)!empty($b['isCustom']),
            $b['drawingNumber']??null,$b['revisionNumber']??null,$b['hsnCode']??null,
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
        foreach(['productName','description','unit','category','productRef','drawingNumber','revisionNumber','hsnCode'] as $f) {
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
        $s = db()->query('SELECT p.itemCode,p.productName,p.category,p.unit,p.standardPrice,p.hsnCode,p.isActive,c.name AS catName FROM `Product` p LEFT JOIN `Category` c ON c.id=p.categoryId ORDER BY p.itemCode');
        $w = new XlsxWriter('Products');
        $w->addRow(['Item Code','Product Name','Category','Unit','Standard Price','HSN Code','Active']);
        foreach($s->fetchAll() as $r) $w->addRow([$r['itemCode'],$r['productName'],$r['catName']??$r['category'],$r['unit'],$r['standardPrice'],$r['hsnCode'],$r['isActive']?'Yes':'No']);
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
        'itemCode'       => ['item code', 'itemcode', 'code', 'item no', 'part no'],
        'productName'    => ['product name', 'productname', 'name', 'item name', 'itemname', 'product'],
        'description'    => ['description', 'desc'],
        'unit'           => ['unit', 'uom'],
        'standardPrice'  => ['standard price', 'price', 'rate', 'list price', 'price (₹)', 'standardprice'],
        'category'       => ['category', 'item group', 'group'],
        'hsnCode'        => ['hsn code', 'hsn', 'hsncode'],
        'drawingNumber'  => ['drawing number', 'drawing', 'drawing no'],
        'revisionNumber' => ['revision number', 'revision', 'rev'],
        'productRef'     => ['product ref', 'reference', 'ref'],
        'isActive'       => ['active', 'is active', 'status'],
    ];

    // GET /api/products/template
    public function template(): void
    {
        authenticate();
        $w = new XlsxWriter('Products');
        $w->setForceTextColumns([0, 6]); // keep item codes / HSN like 0012 as text
        $w->addRow(['Item Code *', 'Product Name *', 'Description', 'Unit', 'Standard Price', 'Category', 'HSN Code', 'Drawing Number', 'Revision Number', 'Product Ref', 'Active (Yes/No)']);
        $w->addRow(['CNMG120408-MF', 'CNMG 120408-MF Turning Insert', 'Carbide insert for steel finishing', 'nos', 250, 'Inserts', '82090090', '', '', '', 'Yes']);
        $w->addRow(['ER32-COLLET-12', 'ER32 Collet 12mm', '', 'nos', 1100, 'Holders', '84669310', '', '', '', 'Yes']);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="product-upload-template.xlsx"');
        echo $w->output(); exit;
    }

    // POST /api/products/import  (multipart "file": .xlsx or .csv)
    // Upserts by item code: existing codes are updated, new codes are created.
    // Blank cells leave an existing product's value unchanged.
    public function import(): void
    {
        $auth = authenticate(); require_admin($auth);
        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) sendError('Please choose the filled-in Excel (.xlsx) or CSV file.', 400);
        $tmp = $_FILES['file']['tmp_name']; $name = $_FILES['file']['name'] ?? '';
        $rows = [];
        if (preg_match('/\.csv$/i', $name)) {
            if (($fh = fopen($tmp, 'r')) !== false) { while (($r = fgetcsv($fh)) !== false) $rows[] = $r; fclose($fh); }
        } elseif (preg_match('/\.xlsx$/i', $name)) {
            try { $rows = XlsxReader::readFirstSheetRows($tmp); } catch (\Exception $e) { sendError('Could not read the Excel file: ' . $e->getMessage(), 400); }
        } else {
            sendError('Upload an .xlsx (Excel) or .csv file. Old .xls files: open in Excel and "Save As" .xlsx first.', 400);
        }
        if (count($rows) < 2) sendError('The file has no product rows under the header.', 400);

        // Map headers -> fields
        $norm = fn($h) => trim(preg_replace('/\s+/', ' ', strtolower(str_replace(['*', '(yes/no)'], '', (string) $h))));
        $map = [];
        foreach ($rows[0] as $i => $h) {
            $h = $norm($h);
            foreach (self::IMPORT_COLUMNS as $field => $aliases) {
                if (!isset($map[$field]) && in_array($h, $aliases, true)) { $map[$field] = $i; break; }
            }
        }
        if (!isset($map['itemCode']) || !isset($map['productName'])) {
            sendError('The first row must have "Item Code" and "Product Name" columns — download the template to see the layout.', 400);
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
            ];
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
                    if ($pname === '') { $errors[] = "Row $line ($code): product name is needed for a new product."; $skipped++; continue; }
                    db()->prepare(
                        'INSERT INTO `Product` (id,itemCode,productName,description,unit,standardPrice,category,categoryId,hsnCode,drawingNumber,revisionNumber,productRef,isActive,createdAt,updatedAt)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
                    )->execute([gen_id(), $code, $pname, $vals['description'] ?: null, $vals['unit'] ?: null, $vals['standardPrice'] ?? 0,
                        $cat ?: null, $vals['categoryId'], $vals['hsnCode'] ?: null, $vals['drawingNumber'] ?: null, $vals['revisionNumber'] ?: null,
                        $vals['productRef'] ?: null, $active ?? 1, now_sql(), now_sql()]);
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
