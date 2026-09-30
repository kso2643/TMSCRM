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
}
