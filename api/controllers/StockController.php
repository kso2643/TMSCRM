<?php
class StockController
{
    // GET /api/products/stock
    public function index(): void
    {
        authenticate();
        [$page, $limit, $offset] = paginate(500);
        $search = qp('search',''); $categoryId = qp('categoryId','');
        $itemGroup = qp('itemGroup',''); $inStockOnly = qp('inStockOnly','');

        $where=['s.isActive=1']; $params=[];
        if($search){$like="%$search%";$where[]='(s.itemCode LIKE ? OR s.itemName LIKE ? OR s.itemGroup LIKE ?)';$params=array_merge($params,[$like,$like,$like]);}
        if($categoryId){$where[]='s.categoryId=?';$params[]=$categoryId;}
        if($itemGroup){$where[]='s.itemGroup=?';$params[]=$itemGroup;}
        if($inStockOnly==='true'){$where[]='s.availableStock>0';}
        $w='WHERE '.implode(' AND ',$where);

        $s=db()->prepare("SELECT COUNT(*) FROM `Stock` s $w");$s->execute($params);
        $total=(int)$s->fetchColumn();

        $s2=db()->prepare(
            "SELECT s.*, c.id AS cat_id,c.name AS cat_name,c.color AS cat_color,
                    p.id AS prod_id,p.itemCode AS prod_code,p.productName,p.unit
             FROM `Stock` s LEFT JOIN `Category` c ON c.id=s.categoryId LEFT JOIN `Product` p ON p.id=s.productId
             $w ORDER BY s.itemGroup ASC,s.itemName ASC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params,[$limit,$offset]));
        $items=array_map([$this,'shape'],$s2->fetchAll());
        sendPaginated($items,$total,$page,$limit,'Stock fetched');
    }

    // GET /api/products/stock/alerts
    public function alerts(): void
    {
        authenticate();
        $s=db()->query('SELECT s.*,c.name AS cat_name,c.color AS cat_color FROM `Stock` s LEFT JOIN `Category` c ON c.id=s.categoryId WHERE s.isActive=1');
        $all=$s->fetchAll();
        $out=fn($v)=>$v&&$v['cat_name']?['id'=>$v['categoryId'],'name'=>$v['cat_name'],'color'=>$v['cat_color']]:null;
        $outOfStock=$lowStock=$excessStock=[];
        foreach($all as $r){
            $av=(float)$r['availableStock'];$mn=(float)$r['minimumStock'];
            $r['categoryRef']=$out($r);
            if($av==0) $outOfStock[]=$r;
            elseif($av>0&&$av<=$mn) $lowStock[]=$r;
            elseif($mn>0&&$av>$mn*3) $excessStock[]=$r;
        }
        sendSuccess(['outOfStock'=>$outOfStock,'lowStock'=>$lowStock,'excessStock'=>$excessStock,
            'summary'=>['outOfStock'=>count($outOfStock),'lowStock'=>count($lowStock),'excessStock'=>count($excessStock),'total'=>count($all)]]);
    }

    // GET /api/products/stock/stats
    public function stats(): void
    {
        authenticate();
        $total=(int)db()->query('SELECT COUNT(*) FROM `Stock` WHERE isActive=1')->fetchColumn();
        $inStock=(int)db()->query('SELECT COUNT(*) FROM `Stock` WHERE isActive=1 AND availableStock>0')->fetchColumn();
        $s=db()->query('SELECT availableStock,netPrice FROM `Stock` WHERE isActive=1');$rows=$s->fetchAll();
        $value=array_reduce($rows,fn($c,$r)=>$c+(float)$r['availableStock']*(float)$r['netPrice'],0);
        $groups=db()->query("SELECT DISTINCT itemGroup FROM `Stock` WHERE isActive=1 AND itemGroup IS NOT NULL AND itemGroup!='' ORDER BY itemGroup")->fetchAll(PDO::FETCH_COLUMN);
        sendSuccess(['total'=>$total,'inStock'=>$inStock,'outOfStock'=>$total-$inStock,'stockValue'=>round($value,2),'itemGroups'=>array_values($groups)]);
    }

    // GET /api/products/stock/template
    public function template(): void
    {
        authenticate();
        $w=new XlsxWriter('Stock Template');
        $w->addRow(['Item Type','Product Master','Product Family','Product Subfamily','Item Group','Category','ItemCode','ItemName','InStock','NetPrice','Xceed-LP','EDD','RAD']);
        $w->addRow(['Regular','Carbide Tooling','Inserts','Turning','Insert','INS','CNMG120408-MF','CNMG 120408-MF Turning Insert',150,250,310,'7-10 days','On confirmation']);
        $w->addRow(['Regular','Holders','Collet Chucks','ER Series','Holder','HLD','ER32-COLLET-12','ER32 Collet Chuck 12mm',65,1100,1380,'7-10 days','On confirmation']);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="stock-upload-template.xlsx"');
        echo $w->output(); exit;
    }

    // POST /api/products/stock/import
    public function import(): void
    {
        $auth=authenticate(); require_admin($auth);
        if(empty($_FILES['file'])) sendError('No file uploaded.',400);
        $tmpPath=$_FILES['file']['tmp_name'];
        $origName=$_FILES['file']['name']??'';

        // Support CSV as well as XLSX
        if(preg_match('/\.csv$/i',$origName)){
            $rows=[];
            if(($fh=fopen($tmpPath,'r'))!==false){
                while(($row=fgetcsv($fh))!==false) $rows[]=$row;
                fclose($fh);
            }
        } else {
            try { $rows=XlsxReader::readFirstSheetRows($tmpPath); }
            catch(\Exception $e){ sendError('Failed to parse file: '.$e->getMessage(),400); }
        }

        if(count($rows)<2) sendError('The uploaded file has no data rows.',400);
        $inserted=$updated=$skipped=0; $errors=[];

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
                $data=['itemCode'=>$itemCode,'itemName'=>$itemName?:$itemCode,
                    'itemType'=>trim((string)($row[0]??'Regular'))?:'Regular',
                    'productMaster'=>trim((string)($row[1]??''))?:null,
                    'productFamily'=>trim((string)($row[2]??''))?:null,
                    'productSubfamily'=>trim((string)($row[3]??''))?:null,
                    'itemGroup'=>$ig?:null,
                    'categoryCode'=>strtoupper(trim((string)($row[5]??'')))?:null,
                    'categoryId'=>$categoryId,
                    'availableStock'=>(float)($row[8]??0),
                    'netPrice'=>(float)($row[9]??0),
                    'xceedLp'=>(float)($row[10]??0),
                    'edd'=>trim((string)($row[11]??''))?:null,
                    'rad'=>trim((string)($row[12]??''))?:null,
                    'lastUpdated'=>now_sql(),
                ];
                $es=db()->prepare('SELECT id FROM `Stock` WHERE itemCode=? LIMIT 1');$es->execute([$itemCode]);$ex=$es->fetch();
                if($ex){
                    $sets=[];$ps=[];foreach($data as $k=>$v){if($k==='itemCode')continue;$sets[]="$k=?";$ps[]=$v;}
                    $ps[]=$itemCode;db()->prepare('UPDATE `Stock` SET '.implode(',',$sets).' WHERE itemCode=?')->execute($ps);
                    $updated++;
                } else {
                    $id=gen_id();
                    db()->prepare('INSERT INTO `Stock` (id,itemCode,itemName,itemType,productMaster,productFamily,productSubfamily,itemGroup,categoryCode,categoryId,availableStock,netPrice,xceedLp,edd,rad,isActive,lastUpdated,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
                       ->execute([$id,$data['itemCode'],$data['itemName'],$data['itemType'],$data['productMaster'],$data['productFamily'],$data['productSubfamily'],$data['itemGroup'],$data['categoryCode'],$data['categoryId'],$data['availableStock'],$data['netPrice'],$data['xceedLp'],$data['edd'],$data['rad'],now_sql(),now_sql()]);
                    $inserted++;
                }
            }catch(\Throwable $e){$errors[]=['row'=>$i+1,'error'=>$e->getMessage()];}
        }
        if($inserted===0&&$updated===0) sendError('No valid rows found. Check that ItemCode (column G) is populated.',400);
        log_activity($auth['id'],'STOCK_BULK_IMPORT','Stock',null,['inserted'=>$inserted,'updated'=>$updated,'skipped'=>$skipped,'errorCount'=>count($errors)]);
        $msg="Import complete: {$inserted} inserted, {$updated} updated.".($skipped?" {$skipped} row(s) skipped (no item code).":'');
        sendSuccess(['inserted'=>$inserted,'updated'=>$updated,'skipped'=>$skipped,'errors'=>$errors],$msg);
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
        db()->prepare('INSERT INTO `Stock` (id,itemCode,itemName,itemType,productMaster,productFamily,productSubfamily,itemGroup,categoryCode,categoryId,availableStock,reservedStock,minimumStock,netPrice,xceedLp,edd,rad,location,isActive,lastUpdated,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
           ->execute([$id,$data['itemCode'],$data['itemName'],$data['itemType'],$data['productMaster'],$data['productFamily'],$data['productSubfamily'],$data['itemGroup'],$data['categoryCode'],$data['categoryId'],$data['availableStock']??0,$data['reservedStock']??0,$data['minimumStock']??0,$data['netPrice']??0,$data['xceedLp']??0,$data['edd'],$data['rad'],$data['location'],now_sql(),now_sql()]);
        $s2=db()->prepare('SELECT * FROM `Stock` WHERE id=? LIMIT 1');$s2->execute([$id]);
        sendSuccess(['stock'=>$s2->fetch()],'Stock item added',201);
    }

    // PUT /api/products/stock/:id
    public function update(string $id): void
    {
        $auth=authenticate(); require_admin($auth);
        $data=$this->parseBody(request_body());
        $sets=[];$params=[];
        foreach($data as $k=>$v){if($v!==null||in_array($k,['edd','rad','location','categoryId'])){$sets[]="$k=?";$params[]=$v;}}
        $sets[]='lastUpdated=?';$params[]=now_sql();
        $sets[]='updatedAt=?';$params[]=now_sql();
        $params[]=$id;
        $s=db()->prepare('UPDATE `Stock` SET '.implode(',',$sets).' WHERE id=?');
        if(!$s->execute($params)||$s->rowCount()===0) sendError('Stock item not found.',404);
        $s2=db()->prepare('SELECT * FROM `Stock` WHERE id=? LIMIT 1');$s2->execute([$id]);
        sendSuccess(['stock'=>$s2->fetch()],'Stock item updated');
    }

    // DELETE /api/products/stock/:id
    public function delete(string $id): void
    {
        $auth=authenticate(); require_admin($auth);
        $s=db()->prepare('DELETE FROM `Stock` WHERE id=?');
        if(!$s->execute([$id])||$s->rowCount()===0) sendError('Stock item not found.',404);
        sendSuccess([],'Stock item deleted');
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
            'availableStock'=>isset($b['availableStock'])?(float)$b['availableStock']:null,
            'reservedStock'=>isset($b['reservedStock'])?(float)$b['reservedStock']:null,
            'minimumStock'=>isset($b['minimumStock'])?(float)$b['minimumStock']:null,
            'netPrice'=>isset($b['netPrice'])?(float)$b['netPrice']:null,
            'xceedLp'=>isset($b['xceedLp'])?(float)$b['xceedLp']:null,
            'edd'=>trim($b['edd']??'')?:null,
            'rad'=>trim($b['rad']??'')?:null,
            'location'=>trim($b['location']??'')?:null,
        ];
    }

    private function shape(array $r): array
    {
        $r['isActive']=(bool)$r['isActive'];
        $r['availableStock']=(float)$r['availableStock'];
        $r['netPrice']=(float)$r['netPrice'];
        $r['xceedLp']=(float)$r['xceedLp'];
        $r['minimumStock']=(float)$r['minimumStock'];
        $r['reservedStock']=(float)$r['reservedStock'];
        $r['categoryRef']=($r['cat_id']??null)?['id'=>$r['cat_id'],'name'=>$r['cat_name'],'color'=>$r['cat_color']]:null;
        $r['product']=($r['prod_id']??null)?['id'=>$r['prod_id'],'itemCode'=>$r['prod_code'],'productName'=>$r['productName'],'unit'=>$r['unit']]:null;
        foreach(['cat_id','cat_name','cat_color','prod_id','prod_code','productName','unit'] as $k) unset($r[$k]);
        return $r;
    }
}
