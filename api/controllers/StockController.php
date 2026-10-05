<?php
/**
 * Stock is held per location: Hand stock (with us), Local stock, and stock in
 * other states (one row per state). Stock.availableStock is always the total
 * of the StockLevel rows. Every change is written to StockMovement, and order
 * lines marked supplied reduce stock automatically (see syncOrder).
 */
class StockLedger
{
    public const LOC_TYPES = ['HAND' => 'Hand stock', 'LOCAL' => 'Local stock', 'STATE' => 'Other state stock'];
    public const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana',
        'Himachal Pradesh','Jammu & Kashmir','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya',
        'Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura',
        'Uttar Pradesh','Uttarakhand','West Bengal','Chandigarh','Ladakh','Andaman & Nicobar','Dadra & Nagar Haveli and Daman & Diu','Lakshadweep'];
    // Order lines are taken from these first (state stock last, largest first).
    private const DEDUCT_ORDER = ['HAND' => 0, 'LOCAL' => 1, 'STATE' => 2];

    private static bool $ready = false;

    public static function ensure(): void
    {
        if (self::$ready) return;
        self::$ready = true;
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        ensure_schema([
            'Stock' => ['create' => '', 'columns' => ['brand' => 'VARCHAR(100) NULL']],
            'StockLevel' => ['create' => "CREATE TABLE IF NOT EXISTS `StockLevel` (
  `id`        VARCHAR(30)   NOT NULL,
  `stockId`   VARCHAR(30)   NOT NULL,
  `locType`   VARCHAR(10)   NOT NULL,
  `state`     VARCHAR(60)   NOT NULL DEFAULT '',
  `quantity`  DECIMAL(14,2) NOT NULL DEFAULT 0,
  `updatedAt` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `StockLevel_loc_key` (`stockId`, `locType`, `state`)
$tail"],
            'StockMovement' => ['create' => "CREATE TABLE IF NOT EXISTS `StockMovement` (
  `id`        VARCHAR(30)   NOT NULL,
  `stockId`   VARCHAR(30)   NOT NULL,
  `locType`   VARCHAR(10)   NOT NULL,
  `state`     VARCHAR(60)   NOT NULL DEFAULT '',
  `qty`       DECIMAL(14,2) NOT NULL,
  `balance`   DECIMAL(14,2)     NULL,
  `reason`    VARCHAR(30)   NOT NULL,
  `orderId`   VARCHAR(30)       NULL,
  `note`      VARCHAR(255)      NULL,
  `userId`    VARCHAR(30)       NULL,
  `createdAt` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `StockMovement_stock_idx` (`stockId`, `createdAt`),
  KEY `StockMovement_order_idx` (`orderId`)
$tail"],
        ], 'Stock locations (StockLevel / StockMovement)');
        // One-off: quantities from before locations existed become Hand stock.
        try {
            $old = db()->query("SELECT s.id, s.availableStock FROM `Stock` s WHERE s.availableStock<>0
                                AND NOT EXISTS (SELECT 1 FROM `StockLevel` l WHERE l.stockId=s.id)")->fetchAll();
            foreach ($old as $r) self::setLevel($r['id'], 'HAND', '', (float) $r['availableStock'], 'OPENING', null, null, 'Existing stock moved to Hand stock');
        } catch (Throwable $e) { error_log('StockLedger opening: ' . $e->getMessage()); }
    }

    public static function label(string $type, string $state = ''): string
    {
        return $type === 'STATE' ? ($state . ' (state stock)') : (self::LOC_TYPES[$type] ?? $type);
    }

    /** Normalises a location from user input; halts with 400 when invalid. */
    public static function location($type, $state): array
    {
        $type = strtoupper(trim((string) $type));
        if (!isset(self::LOC_TYPES[$type])) sendError('Choose where the stock is: Hand stock, Local stock or Other state stock.', 400);
        $state = trim((string) $state);
        if ($type !== 'STATE') return [$type, ''];
        if ($state === '') sendError('Choose which state the stock is in.', 400);
        foreach (self::STATES as $st) if (strcasecmp($st, $state) === 0) return [$type, $st];
        return [$type, mb_substr($state, 0, 60)];
    }

    private static function current(string $stockId, string $type, string $state): float
    {
        $s = db()->prepare('SELECT quantity FROM `StockLevel` WHERE stockId=? AND locType=? AND state=?');
        $s->execute([$stockId, $type, $state]);
        $v = $s->fetchColumn();
        return $v === false ? 0.0 : (float) $v;
    }

    /** Adds $delta (can be negative) at one location and logs it. */
    public static function addLevel(string $stockId, string $type, string $state, float $delta, string $reason, ?string $userId, ?string $orderId = null, ?string $note = null): void
    {
        if (abs($delta) < 0.0001) return;
        $new = round(self::current($stockId, $type, $state) + $delta, 2);
        db()->prepare('INSERT INTO `StockLevel` (id,stockId,locType,state,quantity,updatedAt) VALUES (?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE quantity=VALUES(quantity), updatedAt=VALUES(updatedAt)')
            ->execute([gen_id(), $stockId, $type, $state, $new, now_sql()]);
        db()->prepare('INSERT INTO `StockMovement` (id,stockId,locType,state,qty,balance,reason,orderId,note,userId,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([gen_id(), $stockId, $type, $state, round($delta, 2), $new, $reason, $orderId, $note ? mb_substr($note, 0, 255) : null, $userId, now_sql()]);
        self::recalc($stockId);
    }

    /** Sets the quantity at one location (stock count / upload) and logs the difference. */
    public static function setLevel(string $stockId, string $type, string $state, float $qty, string $reason, ?string $userId, ?string $orderId = null, ?string $note = null): void
    {
        self::addLevel($stockId, $type, $state, round($qty, 2) - self::current($stockId, $type, $state), $reason, $userId, $orderId, $note);
    }

    public static function recalc(string $stockId): void
    {
        db()->prepare('UPDATE `Stock` SET availableStock=(SELECT COALESCE(SUM(quantity),0) FROM `StockLevel` WHERE stockId=?), lastUpdated=? WHERE id=?')
            ->execute([$stockId, now_sql(), $stockId]);
    }

    /** levels[stockId] = ['HAND'=>q, 'LOCAL'=>q, 'states'=>[state=>q]] */
    public static function levels(array $stockIds): array
    {
        $out = [];
        if (!$stockIds) return $out;
        $in = implode(',', array_fill(0, count($stockIds), '?'));
        $s = db()->prepare("SELECT stockId, locType, state, quantity FROM `StockLevel` WHERE stockId IN ($in)");
        $s->execute(array_values($stockIds));
        foreach ($s->fetchAll() as $r) {
            $o = &$out[$r['stockId']];
            $o = $o ?? ['HAND' => 0.0, 'LOCAL' => 0.0, 'states' => []];
            if ($r['locType'] === 'STATE') $o['states'][$r['state']] = (float) $r['quantity'];
            else $o[$r['locType']] = (float) $r['quantity'];
            unset($o);
        }
        return $out;
    }

    /** Quantity on open orders not yet supplied, per stock item ("reserved"). */
    public static function reserved(?array $stockIds = null): array
    {
        $sql = "SELECT s.id, SUM(i.quantity) AS q FROM `CustomerOrderItem` i
                JOIN `CustomerOrder` o ON o.id=i.orderId
                JOIN `Stock` s ON (s.itemCode=i.itemCode OR (s.productId IS NOT NULL AND s.productId=i.productId))
                WHERE i.supplied=0 AND o.deliveryStatus IN ('PENDING','PARTIALLY_DELIVERED')";
        $params = [];
        if ($stockIds !== null) {
            if (!$stockIds) return [];
            $sql .= ' AND s.id IN (' . implode(',', array_fill(0, count($stockIds), '?')) . ')';
            $params = array_values($stockIds);
        }
        $out = [];
        try {
            $s = db()->prepare($sql . ' GROUP BY s.id'); $s->execute($params);
            foreach ($s->fetchAll() as $r) $out[$r['id']] = (float) $r['q'];
        } catch (Throwable $e) { error_log('StockLedger reserved: ' . $e->getMessage()); }
        return $out;
    }

    private static function findStock(string $itemCode, ?string $productId): ?string
    {
        $s = db()->prepare('SELECT id FROM `Stock` WHERE isActive=1 AND (itemCode=? OR (productId IS NOT NULL AND productId=?)) LIMIT 1');
        $s->execute([strtoupper(trim($itemCode)), $productId ?? '']);
        $id = $s->fetchColumn();
        return $id ?: null;
    }

    /**
     * Brings stock in line with an order: supplied lines are taken out of
     * stock, lines un-ticked (or the order deleted / edited) are put back to
     * where they came from. Safe to call after any change to the order.
     */
    public static function syncOrder(string $orderId, ?string $userId): void
    {
        try {
            self::ensure();
            $want = [];
            $s = db()->prepare('SELECT itemCode, productId, SUM(CASE WHEN supplied=1 THEN quantity ELSE 0 END) AS q FROM `CustomerOrderItem` WHERE orderId=? GROUP BY itemCode, productId');
            $s->execute([$orderId]);
            foreach ($s->fetchAll() as $r) {
                $sid = self::findStock((string) $r['itemCode'], $r['productId']);
                if ($sid) $want[$sid] = ($want[$sid] ?? 0) + (float) $r['q'];
            }
            $have = [];
            $s = db()->prepare('SELECT stockId, -SUM(qty) AS q FROM `StockMovement` WHERE orderId=? GROUP BY stockId');
            $s->execute([$orderId]);
            foreach ($s->fetchAll() as $r) $have[$r['stockId']] = (float) $r['q'];
            $no = db()->prepare('SELECT c.companyName, o.orderDate FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId WHERE o.id=?');
            $no->execute([$orderId]); $o = $no->fetch();
            $ref = 'Order' . ($o ? ' — ' . ($o['companyName'] ?: 'customer') . ' ' . date('d-m-Y', strtotime($o['orderDate'])) : '');

            foreach (array_unique(array_merge(array_keys($want), array_keys($have))) as $sid) {
                $diff = round(($want[$sid] ?? 0) - ($have[$sid] ?? 0), 2);
                if ($diff > 0) self::deduct($sid, $diff, $userId, $orderId, $ref . ' supplied');
                elseif ($diff < 0) self::restore($sid, -$diff, $userId, $orderId, $ref . ' — supply undone');
            }
        } catch (Throwable $e) { error_log('StockLedger syncOrder: ' . $e->getMessage()); }
    }

    private static function deduct(string $sid, float $qty, ?string $userId, string $orderId, string $note): void
    {
        $s = db()->prepare('SELECT locType, state, quantity FROM `StockLevel` WHERE stockId=? AND quantity>0');
        $s->execute([$sid]);
        $lv = $s->fetchAll();
        usort($lv, fn($a, $b) => [self::DEDUCT_ORDER[$a['locType']] ?? 9, -(float) $a['quantity']] <=> [self::DEDUCT_ORDER[$b['locType']] ?? 9, -(float) $b['quantity']]);
        foreach ($lv as $l) {
            if ($qty <= 0) break;
            $take = min($qty, (float) $l['quantity']);
            self::addLevel($sid, $l['locType'], $l['state'], -$take, 'ORDER_SUPPLIED', $userId, $orderId, $note);
            $qty = round($qty - $take, 2);
        }
        // Not enough anywhere: Hand stock goes negative so the shortage shows.
        if ($qty > 0) self::addLevel($sid, 'HAND', '', -$qty, 'ORDER_SUPPLIED', $userId, $orderId, $note . ' (short)');
    }

    private static function restore(string $sid, float $qty, ?string $userId, string $orderId, string $note): void
    {
        $s = db()->prepare('SELECT locType, state, -SUM(qty) AS q FROM `StockMovement` WHERE stockId=? AND orderId=? GROUP BY locType, state HAVING q>0 ORDER BY MAX(createdAt) DESC');
        $s->execute([$sid, $orderId]);
        foreach ($s->fetchAll() as $m) {
            if ($qty <= 0) break;
            $back = min($qty, (float) $m['q']);
            self::addLevel($sid, $m['locType'], $m['state'], $back, 'ORDER_RESTORED', $userId, $orderId, $note);
            $qty = round($qty - $back, 2);
        }
    }
}

class StockController
{
    // Upload / template columns (A–O). The first 13 match the old template so old files still import.
    private const COLS = ['Item Type','Product Master','Product Family','Product Subfamily','Item Group','Category','ItemCode','ItemName',
                          'InStock','NetPrice','Xceed-LP','EDD','RAD','Brand','Minimum Stock'];

    public function __construct() { StockLedger::ensure(); }

    // GET /api/products/stock?search=&brand=&loc=HAND|LOCAL|STATE:<state>&status=low|out|ok&inStockOnly=
    public function index(): void
    {
        authenticate();
        [$page, $limit, $offset] = paginate(500);
        $search = qp('search',''); $categoryId = qp('categoryId',''); $brand = qp('brand','');
        $itemGroup = qp('itemGroup',''); $inStockOnly = qp('inStockOnly',''); $status = qp('status',''); $loc = qp('loc','');

        $where=['s.isActive=1']; $params=[];
        if($search){$like="%$search%";$where[]='(s.itemCode LIKE ? OR s.itemName LIKE ? OR s.itemGroup LIKE ? OR s.brand LIKE ?)';$params=array_merge($params,[$like,$like,$like,$like]);}
        if($categoryId){$where[]='s.categoryId=?';$params[]=$categoryId;}
        if($itemGroup){$where[]='s.itemGroup=?';$params[]=$itemGroup;}
        if($brand==='__none'){$where[]="(s.brand IS NULL OR s.brand='')";}
        elseif($brand){$where[]='s.brand=?';$params[]=$brand;}
        if($inStockOnly==='true'){$where[]='s.availableStock>0';}
        if($status==='out'){$where[]='s.availableStock<=0';}
        elseif($status==='low'){$where[]='s.availableStock>0 AND s.minimumStock>0 AND s.availableStock<=s.minimumStock';}
        if($loc){
            [$lt,$ls]=array_pad(explode(':',$loc,2),2,'');
            $where[]='EXISTS (SELECT 1 FROM `StockLevel` l WHERE l.stockId=s.id AND l.locType=? AND l.quantity<>0'.($lt==='STATE'&&$ls!==''?' AND l.state=?':'').')';
            $params[]=strtoupper($lt); if($lt==='STATE'&&$ls!=='') $params[]=$ls;
        }
        $w='WHERE '.implode(' AND ',$where);

        $s=db()->prepare("SELECT COUNT(*) FROM `Stock` s $w");$s->execute($params);
        $total=(int)$s->fetchColumn();
        $s2=db()->prepare(
            "SELECT s.*, c.id AS cat_id,c.name AS cat_name,c.color AS cat_color,
                    p.id AS prod_id,p.itemCode AS prod_code,p.productName,p.unit
             FROM `Stock` s LEFT JOIN `Category` c ON c.id=s.categoryId LEFT JOIN `Product` p ON p.id=s.productId
             $w ORDER BY s.brand IS NULL, s.brand ASC, s.itemGroup ASC, s.itemName ASC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params,[$limit,$offset]));
        $rows=$s2->fetchAll();
        $ids=array_column($rows,'id');
        $lv=StockLedger::levels($ids); $res=StockLedger::reserved($ids);
        $items=array_map(fn($r)=>$this->shape($r,$lv[$r['id']]??null,$res[$r['id']]??0),$rows);
        sendPaginated($items,$total,$page,$limit,'Stock fetched');
    }

    // GET /api/products/stock/meta — brands, states that hold stock, location types, all states
    public function meta(): void
    {
        authenticate();
        $brands=db()->query("SELECT DISTINCT brand FROM `Stock` WHERE isActive=1 AND brand IS NOT NULL AND brand<>'' ORDER BY brand")->fetchAll(PDO::FETCH_COLUMN);
        $states=db()->query("SELECT l.state, SUM(l.quantity) q, COUNT(*) n FROM `StockLevel` l JOIN `Stock` s ON s.id=l.stockId AND s.isActive=1
                             WHERE l.locType='STATE' AND l.state<>'' GROUP BY l.state HAVING SUM(ABS(l.quantity))>0 ORDER BY l.state")->fetchAll();
        $tot=db()->query("SELECT l.locType, SUM(l.quantity) q FROM `StockLevel` l JOIN `Stock` s ON s.id=l.stockId AND s.isActive=1 GROUP BY l.locType")->fetchAll(PDO::FETCH_KEY_PAIR);
        $catBrands=[];
        try { $catBrands=db()->query("SELECT DISTINCT brand FROM `CustomerOrderItem` WHERE brand IS NOT NULL AND brand<>'' ORDER BY brand LIMIT 100")->fetchAll(PDO::FETCH_COLUMN); } catch(Throwable $e) {}
        sendSuccess([
            'brands'=>array_values($brands),
            'suggestedBrands'=>array_values(array_unique(array_merge($brands,$catBrands))),
            'stateStock'=>array_map(fn($r)=>['state'=>$r['state'],'quantity'=>(float)$r['q'],'items'=>(int)$r['n']],$states),
            'totals'=>['HAND'=>(float)($tot['HAND']??0),'LOCAL'=>(float)($tot['LOCAL']??0),'STATE'=>(float)($tot['STATE']??0)],
            'locTypes'=>array_map(fn($k,$v)=>['value'=>$k,'label'=>$v],array_keys(StockLedger::LOC_TYPES),StockLedger::LOC_TYPES),
            'states'=>StockLedger::STATES,
        ]);
    }

    // GET /api/products/stock/alerts
    public function alerts(): void
    {
        authenticate();
        $s=db()->query('SELECT s.*,c.name AS cat_name,c.color AS cat_color FROM `Stock` s LEFT JOIN `Category` c ON c.id=s.categoryId WHERE s.isActive=1');
        $all=$s->fetchAll();
        $res=StockLedger::reserved();
        $out=fn($v)=>$v&&$v['cat_name']?['id'=>$v['categoryId'],'name'=>$v['cat_name'],'color'=>$v['cat_color']]:null;
        $outOfStock=$lowStock=$excessStock=$shortForOrders=[];
        foreach($all as $r){
            $av=(float)$r['availableStock'];$mn=(float)$r['minimumStock'];$rv=$res[$r['id']]??0;
            $r['categoryRef']=$out($r); $r['reserved']=$rv;
            if($av<=0) $outOfStock[]=$r;
            elseif($av>0&&$av<=$mn) $lowStock[]=$r;
            elseif($mn>0&&$av>$mn*3) $excessStock[]=$r;
            if($rv>0&&$rv>$av) $shortForOrders[]=$r;
        }
        sendSuccess(['outOfStock'=>$outOfStock,'lowStock'=>$lowStock,'excessStock'=>$excessStock,'shortForOrders'=>$shortForOrders,
            'summary'=>['outOfStock'=>count($outOfStock),'lowStock'=>count($lowStock),'excessStock'=>count($excessStock),'shortForOrders'=>count($shortForOrders),'total'=>count($all)]]);
    }

    // GET /api/products/stock/stats
    public function stats(): void
    {
        authenticate();
        $total=(int)db()->query('SELECT COUNT(*) FROM `Stock` WHERE isActive=1')->fetchColumn();
        $inStock=(int)db()->query('SELECT COUNT(*) FROM `Stock` WHERE isActive=1 AND availableStock>0')->fetchColumn();
        $low=(int)db()->query('SELECT COUNT(*) FROM `Stock` WHERE isActive=1 AND availableStock>0 AND minimumStock>0 AND availableStock<=minimumStock')->fetchColumn();
        $s=db()->query('SELECT availableStock,netPrice FROM `Stock` WHERE isActive=1');$rows=$s->fetchAll();
        $value=array_reduce($rows,fn($c,$r)=>$c+max(0,(float)$r['availableStock'])*(float)$r['netPrice'],0);
        $groups=db()->query("SELECT DISTINCT itemGroup FROM `Stock` WHERE isActive=1 AND itemGroup IS NOT NULL AND itemGroup!='' ORDER BY itemGroup")->fetchAll(PDO::FETCH_COLUMN);
        sendSuccess(['total'=>$total,'inStock'=>$inStock,'outOfStock'=>$total-$inStock,'lowStock'=>$low,'reservedItems'=>count(StockLedger::reserved()),'stockValue'=>round($value,2),'itemGroups'=>array_values($groups)]);
    }

    // GET /api/products/stock/template
    public function template(): void
    {
        authenticate();
        $wb=new StyledXlsxWriter();
        $sh=$wb->addSheet('Stock');
        $wb->setWidths($sh,[11,18,16,18,14,10,20,34,10,11,11,12,16,14,14]);
        $wb->addRow($sh,self::COLS,'header',30);
        $wb->addRow($sh,['Regular','Carbide Tooling','Inserts','Turning','Insert','INS','CNMG120408-MF','CNMG 120408-MF Turning Insert',150,250,310,'7-10 days','On confirmation','YG-1',50]);
        $wb->addRow($sh,['Regular','Holders','Collet Chucks','ER Series','Holder','HLD','ER32-COLLET-12','ER32 Collet Chuck 12mm',65,1100,1380,'7-10 days','On confirmation','',10]);
        $wb->freeze($sh,1);
        $hs=$wb->addSheet('How to fill');
        $wb->setWidths($hs,[90]);
        $wb->addRow($hs,['How to upload stock'],'header');
        foreach([
            '1. One row per item. ItemCode (column G) is required; it links the row to the item (new codes are added).',
            '2. InStock (column I) is the quantity you have at ONE place. When you upload you choose that place in the CRM:',
            '      • Hand stock — stock with us,  • Local stock — local brand / local dealer stock,  • Other state stock — then pick the state.',
            '   The uploaded quantity REPLACES the old quantity at that place only; the other places are not touched.',
            '3. Use one file per place: e.g. upload once for Hand stock, once for Karnataka state stock.',
            '4. Brand (column N): leave blank to use the brand you pick in the upload box; fill it to set a brand per row.',
            '5. Minimum Stock (column O, optional): when the total falls to this level the CRM reminds the admins (low stock).',
            '6. Orders: when an order line is marked supplied, its quantity is taken out of stock automatically (Hand stock first, then Local, then state stock).',
            '7. Delete the two sample rows before uploading. Excel (.xlsx) or CSV.',
        ] as $line) $wb->addRow($hs,[$line]);
        $ls=$wb->addSheet('States');
        $wb->setWidths($ls,[36]);
        $wb->addRow($ls,['States (for Other state stock)'],'header');
        foreach(StockLedger::STATES as $st) $wb->addRow($ls,[$st]);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="stock-upload-template.xlsx"');
        echo $wb->output(); exit;
    }

    // POST /api/products/stock/import — multipart: file, locType (HAND|LOCAL|STATE), state, brand
    public function import(): void
    {
        $auth=authenticate(); require_admin($auth);
        if(empty($_FILES['file'])) sendError('No file uploaded.',400);
        [$locType,$state]=StockLedger::location($_POST['locType']??'', $_POST['state']??'');
        $pickedBrand=mb_substr(trim((string)($_POST['brand']??'')),0,100);
        $tmpPath=$_FILES['file']['tmp_name'];
        $origName=$_FILES['file']['name']??'';

        if(preg_match('/\.csv$/i',$origName)){
            $rows=[];
            if(($fh=fopen($tmpPath,'r'))!==false){ while(($row=fgetcsv($fh))!==false) $rows[]=$row; fclose($fh); }
        } else {
            try { $rows=XlsxReader::readFirstSheetRows($tmpPath); }
            catch(\Exception $e){ sendError('Failed to parse file: '.$e->getMessage(),400); }
        }
        if(count($rows)<2) sendError('The uploaded file has no data rows.',400);
        $inserted=$updated=$skipped=$qtySet=0; $errors=[];
        $note='Upload '.mb_substr($origName,0,80);
        $num=function($v){ $v=trim(str_replace([',','₹'],'',(string)$v)); return $v===''?null:(is_numeric($v)?(float)$v:null); };

        foreach($rows as $i=>$row){
            if($i===0) continue;
            $itemCode=strtoupper(trim((string)($row[6]??'')));
            $itemName=trim((string)($row[7]??''));
            if(!$itemCode){$skipped++;continue;}
            try{
                $ig=trim((string)($row[4]??''));
                $categoryId=null;
                if($ig){
                    $ms=db()->prepare('SELECT categoryId FROM `ItemGroupMapping` WHERE itemGroup=? LIMIT 1');
                    $ms->execute([$ig]); $mp=$ms->fetch();
                    $categoryId=$mp?$mp['categoryId']:null;
                }
                $brand=trim((string)($row[13]??''))?:$pickedBrand;
                $data=['itemName'=>$itemName?:$itemCode,
                    'itemType'=>trim((string)($row[0]??'Regular'))?:'Regular',
                    'productMaster'=>trim((string)($row[1]??''))?:null,
                    'productFamily'=>trim((string)($row[2]??''))?:null,
                    'productSubfamily'=>trim((string)($row[3]??''))?:null,
                    'itemGroup'=>$ig?:null,
                    'categoryCode'=>strtoupper(trim((string)($row[5]??'')))?:null,
                    'categoryId'=>$categoryId,
                    'netPrice'=>$num($row[9]??'')??0,
                    'xceedLp'=>$num($row[10]??'')??0,
                    'edd'=>trim((string)($row[11]??''))?:null,
                    'rad'=>trim((string)($row[12]??''))?:null,
                    'lastUpdated'=>now_sql(),
                ];
                if($brand!=='') $data['brand']=mb_substr($brand,0,100);
                $min=$num($row[14]??''); if($min!==null) $data['minimumStock']=$min;
                $es=db()->prepare('SELECT id FROM `Stock` WHERE itemCode=? LIMIT 1');$es->execute([$itemCode]);$ex=$es->fetch();
                if($ex){
                    $sid=$ex['id'];
                    $sets=[];$ps=[];foreach($data as $k=>$v){$sets[]="$k=?";$ps[]=$v;}
                    $sets[]='isActive=1';
                    $ps[]=$sid;db()->prepare('UPDATE `Stock` SET '.implode(',',$sets).' WHERE id=?')->execute($ps);
                    $updated++;
                } else {
                    $sid=gen_id();
                    $cols=array_merge(['id','itemCode','isActive','updatedAt'],array_keys($data));
                    $vals=array_merge([$sid,$itemCode,1,now_sql()],array_values($data));
                    db()->prepare('INSERT INTO `Stock` ('.implode(',',$cols).') VALUES ('.implode(',',array_fill(0,count($cols),'?')).')')->execute($vals);
                    $inserted++;
                }
                $q=$num($row[8]??'');
                if($q!==null){ StockLedger::setLevel($sid,$locType,$state,$q,'IMPORT',$auth['id'],null,$note); $qtySet++; }
            }catch(\Throwable $e){$errors[]=['row'=>$i+1,'error'=>$e->getMessage()];}
        }
        if($inserted===0&&$updated===0) sendError('No valid rows found. Check that ItemCode (column G) is populated.',400);
        $where=StockLedger::label($locType,$state);
        log_activity($auth['id'],'STOCK_BULK_IMPORT','Stock',null,['inserted'=>$inserted,'updated'=>$updated,'skipped'=>$skipped,'location'=>$where,'brand'=>$pickedBrand,'errorCount'=>count($errors)]);
        $msg="Import complete: {$inserted} new, {$updated} updated — quantities set at {$where}".($pickedBrand!==''?" (brand {$pickedBrand})":'').'.'.($skipped?" {$skipped} row(s) skipped (no item code).":'');
        sendSuccess(['inserted'=>$inserted,'updated'=>$updated,'skipped'=>$skipped,'quantitiesSet'=>$qtySet,'location'=>$where,'errors'=>$errors],$msg);
    }

    // POST /api/products/stock
    public function create(): void
    {
        $auth=authenticate(); require_admin($auth);
        $b=request_body();
        $data=$this->parseBody($b);
        if(!$data['itemCode']||!($data['itemName']??'')) sendError('Item code and item name are required.',400);
        $s=db()->prepare('SELECT id FROM `Stock` WHERE itemCode=? LIMIT 1');$s->execute([$data['itemCode']]);
        if($s->fetch()) sendError('An item with this code already exists.',409);
        $id=gen_id();
        db()->prepare('INSERT INTO `Stock` (id,itemCode,itemName,itemType,productMaster,productFamily,productSubfamily,itemGroup,categoryCode,categoryId,brand,availableStock,reservedStock,minimumStock,netPrice,xceedLp,edd,rad,location,isActive,lastUpdated,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,1,?,?)')
           ->execute([$id,$data['itemCode'],$data['itemName'],$data['itemType'],$data['productMaster'],$data['productFamily'],$data['productSubfamily'],$data['itemGroup'],$data['categoryCode'],$data['categoryId'],$data['brand'],$data['minimumStock']??0,$data['netPrice']??0,$data['xceedLp']??0,$data['edd'],$data['rad'],$data['location'],now_sql(),now_sql()]);
        // Opening quantity goes to the chosen place (Hand stock by default).
        if(!empty($data['availableStock'])){
            [$lt,$ls]=StockLedger::location($b['locType']??'HAND',$b['state']??'');
            StockLedger::setLevel($id,$lt,$ls,(float)$data['availableStock'],'OPENING',$auth['id'],null,'Item added');
        }
        $this->sendOne($id,'Stock item added',201);
    }

    // PUT /api/products/stock/:id — item details (quantities change through /adjust or upload)
    public function update(string $id): void
    {
        $auth=authenticate(); require_admin($auth);
        $b=request_body();
        $data=$this->parseBody($b);
        unset($data['availableStock'],$data['reservedStock']);
        if(!array_key_exists('brand',$b)) unset($data['brand']);
        $sets=[];$params=[];
        foreach($data as $k=>$v){if($v!==null||in_array($k,['edd','rad','location','categoryId','brand'])){$sets[]="$k=?";$params[]=$v;}}
        $sets[]='lastUpdated=?';$params[]=now_sql();
        $sets[]='updatedAt=?';$params[]=now_sql();
        $params[]=$id;
        $s=db()->prepare('UPDATE `Stock` SET '.implode(',',$sets).' WHERE id=?');
        if(!$s->execute($params)||$s->rowCount()===0) sendError('Stock item not found.',404);
        $this->sendOne($id,'Stock item updated');
    }

    // POST /api/products/stock/:id/adjust — { locType, state, quantity, mode: set|add, note }
    public function adjust(string $id): void
    {
        $auth=authenticate(); require_admin($auth);
        $s=db()->prepare('SELECT id FROM `Stock` WHERE id=?');$s->execute([$id]);
        if(!$s->fetch()) sendError('Stock item not found.',404);
        $b=request_body();
        [$lt,$ls]=StockLedger::location($b['locType']??'',$b['state']??'');
        if(!isset($b['quantity'])||!is_numeric($b['quantity'])) sendError('Enter the quantity.',400);
        $q=(float)$b['quantity']; $note=trim((string)($b['note']??''))?:null;
        if(($b['mode']??'set')==='add') StockLedger::addLevel($id,$lt,$ls,$q,'ADJUST',$auth['id'],null,$note);
        else StockLedger::setLevel($id,$lt,$ls,$q,'ADJUST',$auth['id'],null,$note);
        log_activity($auth['id'],'STOCK_ADJUSTED','Stock',$id,['location'=>StockLedger::label($lt,$ls),'quantity'=>$q,'mode'=>$b['mode']??'set']);
        $this->sendOne($id,'Stock updated at '.StockLedger::label($lt,$ls));
    }

    // GET /api/products/stock/:id/movements
    public function movements(string $id): void
    {
        authenticate();
        $s=db()->prepare('SELECT m.*, u.name AS userName FROM `StockMovement` m LEFT JOIN `User` u ON u.id=m.userId WHERE m.stockId=? ORDER BY m.createdAt DESC, m.id DESC LIMIT 100');
        $s->execute([$id]);
        sendSuccess(['movements'=>array_map(function($r){
            $r['qty']=(float)$r['qty']; $r['balance']=$r['balance']===null?null:(float)$r['balance'];
            $r['location']=StockLedger::label($r['locType'],$r['state']);
            return $r;
        },$s->fetchAll())]);
    }

    // DELETE /api/products/stock/:id
    public function delete(string $id): void
    {
        $auth=authenticate(); require_admin($auth);
        $s=db()->prepare('DELETE FROM `Stock` WHERE id=?');
        if(!$s->execute([$id])||$s->rowCount()===0) sendError('Stock item not found.',404);
        db()->prepare('DELETE FROM `StockLevel` WHERE stockId=?')->execute([$id]);
        db()->prepare('DELETE FROM `StockMovement` WHERE stockId=?')->execute([$id]);
        sendSuccess([],'Stock item deleted');
    }

    private function sendOne(string $id, string $msg, int $code=200): void
    {
        $s=db()->prepare('SELECT s.*, c.id AS cat_id,c.name AS cat_name,c.color AS cat_color, p.id AS prod_id,p.itemCode AS prod_code,p.productName,p.unit
                          FROM `Stock` s LEFT JOIN `Category` c ON c.id=s.categoryId LEFT JOIN `Product` p ON p.id=s.productId WHERE s.id=? LIMIT 1');
        $s->execute([$id]); $r=$s->fetch();
        sendSuccess(['stock'=>$this->shape($r,StockLedger::levels([$id])[$id]??null,StockLedger::reserved([$id])[$id]??0)],$msg,$code);
    }

    private function parseBody(array $b): array
    {
        return [
            'itemCode'=>isset($b['itemCode'])?strtoupper(trim($b['itemCode'])):null,
            'itemName'=>isset($b['itemName'])?trim($b['itemName']):null,
            'itemType'=>trim($b['itemType']??'Regular')?:'Regular',
            'productMaster'=>trim($b['productMaster']??'')?:null,
            'productFamily'=>trim($b['productFamily']??'')?:null,
            'productSubfamily'=>trim($b['productSubfamily']??'')?:null,
            'itemGroup'=>trim($b['itemGroup']??'')?:null,
            'categoryCode'=>strtoupper(trim($b['categoryCode']??''))?:null,
            'categoryId'=>($b['categoryId']??null)?:null,
            'brand'=>mb_substr(trim((string)($b['brand']??'')),0,100)?:null,
            'availableStock'=>isset($b['availableStock'])&&$b['availableStock']!==''?(float)$b['availableStock']:null,
            'reservedStock'=>isset($b['reservedStock'])?(float)$b['reservedStock']:null,
            'minimumStock'=>isset($b['minimumStock'])&&$b['minimumStock']!==''?(float)$b['minimumStock']:null,
            'netPrice'=>isset($b['netPrice'])&&$b['netPrice']!==''?(float)$b['netPrice']:null,
            'xceedLp'=>isset($b['xceedLp'])&&$b['xceedLp']!==''?(float)$b['xceedLp']:null,
            'edd'=>trim($b['edd']??'')?:null,
            'rad'=>trim($b['rad']??'')?:null,
            'location'=>trim($b['location']??'')?:null,
        ];
    }

    private function shape(array $r, ?array $lv = null, float $reserved = 0): array
    {
        $r['isActive']=(bool)$r['isActive'];
        $r['availableStock']=(float)$r['availableStock'];
        $r['netPrice']=(float)$r['netPrice'];
        $r['xceedLp']=(float)$r['xceedLp'];
        $r['minimumStock']=(float)$r['minimumStock'];
        $lv=$lv??['HAND'=>0.0,'LOCAL'=>0.0,'states'=>[]];
        ksort($lv['states']);
        $r['handStock']=$lv['HAND']; $r['localStock']=$lv['LOCAL']; $r['stateStock']=$lv['states'];
        $r['reservedStock']=$reserved;                      // on open orders, not yet supplied
        $r['freeStock']=round($r['availableStock']-$reserved,2);
        $av=$r['availableStock'];$mn=$r['minimumStock'];
        $r['stockStatus']=$av<=0?'OUT':($mn>0&&$av<=$mn?'LOW':'OK');
        $r['categoryRef']=($r['cat_id']??null)?['id'=>$r['cat_id'],'name'=>$r['cat_name'],'color'=>$r['cat_color']]:null;
        $r['product']=($r['prod_id']??null)?['id'=>$r['prod_id'],'itemCode'=>$r['prod_code'],'productName'=>$r['productName'],'unit'=>$r['unit']]:null;
        foreach(['cat_id','cat_name','cat_color','prod_id','prod_code','productName','unit'] as $k) unset($r[$k]);
        return $r;
    }
}
