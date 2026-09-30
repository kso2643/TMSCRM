<?php
/**
 * Seed script — inserts the same demo data as the original
 * backend/prisma/seed.js. Run once after creating the schema:
 *
 *   php scripts/seed.php
 *
 * Safe to re-run: skips records that already exist (matched by email
 * for users, companyName for customers, itemCode for products/stock).
 */

declare(strict_types=1);
require __DIR__ . '/../config/config.php';
require __DIR__ . '/../config/database.php';
require __DIR__ . '/../includes/Helpers.php';

function seed_log(string $msg): void { echo $msg . PHP_EOL; }

$pdo = db();

// ── Users ─────────────────────────────────────────────────────────────
$users = [
    ['name'=>'Super Admin',      'email'=>'superadmin@tms.com',  'password'=>'Admin@123',   'role'=>'SUPER_ADMIN',    'department'=>'Management'],
    ['name'=>'Admin User',       'email'=>'admin@tms.com',       'password'=>'Admin@123',   'role'=>'ADMIN',          'department'=>'Management'],
    ['name'=>'Sales Manager',    'email'=>'manager@tms.com',     'password'=>'Manager@123', 'role'=>'MANAGER',        'department'=>'Sales'],
    ['name'=>'Raj Kumar',        'email'=>'raj@tms.com',         'password'=>'Sales@123',   'role'=>'SALES',          'department'=>'Sales'],
    ['name'=>'Priya Singh',      'email'=>'priya@tms.com',       'password'=>'Sales@123',   'role'=>'SALES_ENGINEER', 'department'=>'Technical Sales'],
    ['name'=>'Amit Sharma',      'email'=>'amit@tms.com',        'password'=>'Sales@123',   'role'=>'SALES',          'department'=>'Sales'],
];

$createdUsers = [];
foreach ($users as $u) {
    $s = $pdo->prepare('SELECT id FROM `User` WHERE email=? LIMIT 1');
    $s->execute([$u['email']]);
    $existing = $s->fetchColumn();
    if ($existing) { $createdUsers[$u['role']] = $existing; seed_log("  SKIP user {$u['email']}"); continue; }
    $id   = gen_id();
    $hash = password_hash($u['password'], PASSWORD_BCRYPT, ['cost' => 12]);
    $pdo->prepare(
        'INSERT INTO `User` (id,name,email,password,role,department,isActive,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,1,?,?)'
    )->execute([$id, $u['name'], $u['email'], $hash, $u['role'], $u['department'], now_sql(), now_sql()]);
    $createdUsers[$u['role']] = $id;
    seed_log("  + user {$u['email']} ({$u['role']})");
}
// alias helpers
$adminId   = $createdUsers['ADMIN']   ?? $createdUsers['SUPER_ADMIN'];
$salesId   = $createdUsers['SALES']   ?? $adminId;
$engId     = $createdUsers['SALES_ENGINEER'] ?? $salesId;

// ── Categories ────────────────────────────────────────────────────────
$categories = [
    ['name'=>'Turning Inserts',   'color'=>'#3B82F6', 'sortOrder'=>1],
    ['name'=>'Milling Inserts',   'color'=>'#8B5CF6', 'sortOrder'=>2],
    ['name'=>'Drill Bits',        'color'=>'#F59E0B', 'sortOrder'=>3],
    ['name'=>'End Mills',         'color'=>'#10B981', 'sortOrder'=>4],
    ['name'=>'Boring Bars',       'color'=>'#EF4444', 'sortOrder'=>5],
    ['name'=>'Tool Holders',      'color'=>'#6366F1', 'sortOrder'=>6],
    ['name'=>'Threading Tools',   'color'=>'#EC4899', 'sortOrder'=>7],
    ['name'=>'Parting & Grooving','color'=>'#14B8A6', 'sortOrder'=>8],
];
$catMap = [];
foreach ($categories as $c) {
    $s = $pdo->prepare('SELECT id FROM `Category` WHERE name=? LIMIT 1'); $s->execute([$c['name']]);
    $ex = $s->fetchColumn();
    if ($ex) { $catMap[$c['name']] = $ex; seed_log("  SKIP cat {$c['name']}"); continue; }
    $id = gen_id();
    $pdo->prepare('INSERT INTO `Category` (id,name,color,sortOrder,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
       ->execute([$id,$c['name'],$c['color'],$c['sortOrder'],now_sql(),now_sql()]);
    $catMap[$c['name']] = $id;
    seed_log("  + category {$c['name']}");
}

// ── Customers ─────────────────────────────────────────────────────────
$customers = [
    ['companyName'=>'Precision Auto Parts Pvt Ltd','contactPerson'=>'Mr. Suresh Kumar','contactNumber'=>'9876543210',
     'designation'=>'Purchase Manager','email'=>'suresh@precisionauto.com','location'=>'Pune, Maharashtra',
     'category'=>'Automobile','industryType'=>'Manufacturing','status'=>'ACTIVE',
     'lat'=>18.5204,'lng'=>73.8567,'geoFenceRadius'=>300],
    ['companyName'=>'Bharat Engineering Works','contactPerson'=>'Mr. Ramesh Patel','contactNumber'=>'9876543211',
     'designation'=>'Director','email'=>'ramesh@bharateng.com','location'=>'Ahmedabad, Gujarat',
     'category'=>'General Engineering','industryType'=>'Manufacturing','status'=>'ACTIVE',
     'lat'=>23.0225,'lng'=>72.5714,'geoFenceRadius'=>200],
    ['companyName'=>'TechCraft Industries','contactPerson'=>'Ms. Kavitha Nair','contactNumber'=>'9876543212',
     'designation'=>'Production Head','email'=>'kavitha@techcraft.in','location'=>'Coimbatore, Tamil Nadu',
     'category'=>'Aerospace','industryType'=>'Manufacturing','status'=>'ACTIVE',
     'lat'=>11.0168,'lng'=>76.9558,'geoFenceRadius'=>250],
    ['companyName'=>'Metro Machine Tools','contactPerson'=>'Mr. Dinesh Mehta','contactNumber'=>'9876543213',
     'designation'=>'Proprietor','email'=>'dinesh@metromotools.com','location'=>'Chennai, Tamil Nadu',
     'category'=>'Machine Tool','industryType'=>'Manufacturing','status'=>'ACTIVE',
     'lat'=>13.0827,'lng'=>80.2707,'geoFenceRadius'=>200],
    ['companyName'=>'Aero Components Ltd','contactPerson'=>'Mr. Vikram Singh','contactNumber'=>'9876543214',
     'designation'=>'Technical Manager','email'=>'vikram@aerocomp.com','location'=>'Bengaluru, Karnataka',
     'category'=>'Aerospace','industryType'=>'Defense & Aerospace','status'=>'FOLLOW_UP_PENDING',
     'lat'=>12.9716,'lng'=>77.5946,'geoFenceRadius'=>200],
];
$custMap = [];
foreach ($customers as $cu) {
    $s = $pdo->prepare('SELECT id FROM `Customer` WHERE companyName=? AND isActive=1 LIMIT 1');
    $s->execute([$cu['companyName']]);
    $ex = $s->fetchColumn();
    if ($ex) { $custMap[$cu['companyName']] = $ex; seed_log("  SKIP customer {$cu['companyName']}"); continue; }
    $id = gen_id();
    $pdo->prepare(
        'INSERT INTO `Customer` (id,companyName,contactPerson,contactNumber,designation,email,location,
         category,industryType,status,lat,lng,geoFenceRadius,isActive,createdById,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)'
    )->execute([
        $id,$cu['companyName'],$cu['contactPerson'],$cu['contactNumber'],
        $cu['designation'],$cu['email'],$cu['location'],
        $cu['category'],$cu['industryType'],$cu['status'],
        $cu['lat'],$cu['lng'],$cu['geoFenceRadius'],
        $salesId, now_sql(), now_sql(),
    ]);
    $custMap[$cu['companyName']] = $id;
    seed_log("  + customer {$cu['companyName']}");
}

// ── Products ──────────────────────────────────────────────────────────
$products = [
    ['itemCode'=>'CNMG120408-MF','productName'=>'CNMG 120408-MF Turning Insert','description'=>'Carbide turning insert for steel','unit'=>'PCS','standardPrice'=>285,'category'=>'Turning Inserts','hsnCode'=>'82079010'],
    ['itemCode'=>'WNMG080408-PM','productName'=>'WNMG 080408-PM Turning Insert','description'=>'Positive turning insert for cast iron','unit'=>'PCS','standardPrice'=>320,'category'=>'Turning Inserts','hsnCode'=>'82079010'],
    ['itemCode'=>'APKT1604PDR-DP','productName'=>'APKT 1604PDR-DP Milling Insert','description'=>'Double positive milling insert','unit'=>'PCS','standardPrice'=>245,'category'=>'Milling Inserts','hsnCode'=>'82079010'],
    ['itemCode'=>'SPMG050204-DG','productName'=>'SPMG 050204-DG Drill Insert','description'=>'Replaceable drill insert','unit'=>'PCS','standardPrice'=>180,'category'=>'Drill Bits','hsnCode'=>'82079010'],
    ['itemCode'=>'EM-D10-4F-HRC45','productName'=>'10mm 4-Flute End Mill HRC45','description'=>'Solid carbide end mill for hardened steel','unit'=>'PCS','standardPrice'=>1250,'category'=>'End Mills','hsnCode'=>'82079010'],
    ['itemCode'=>'BB-S20T-SCLCR','productName'=>'S20T-SCLCR Boring Bar','description'=>'Steel boring bar with SCLCR head','unit'=>'PCS','standardPrice'=>2800,'category'=>'Boring Bars','hsnCode'=>'84669200'],
    ['itemCode'=>'MCLNR2020K12','productName'=>'MCLNR 2020K12 Tool Holder','description'=>'External turning tool holder','unit'=>'PCS','standardPrice'=>1800,'category'=>'Tool Holders','hsnCode'=>'84669200'],
    ['itemCode'=>'SER2020K16','productName'=>'SER 2020K16 Threading Holder','description'=>'External threading tool holder','unit'=>'PCS','standardPrice'=>1650,'category'=>'Threading Tools','hsnCode'=>'84669200'],
    ['itemCode'=>'MGMN300-M','productName'=>'MGMN 300-M Grooving Insert','description'=>'3mm width grooving insert for steel','unit'=>'PCS','standardPrice'=>195,'category'=>'Parting & Grooving','hsnCode'=>'82079010'],
];
$prodMap = [];
foreach ($products as $p) {
    $s = $pdo->prepare('SELECT id FROM `Product` WHERE itemCode=? LIMIT 1'); $s->execute([$p['itemCode']]);
    $ex = $s->fetchColumn();
    if ($ex) { $prodMap[$p['itemCode']] = $ex; seed_log("  SKIP product {$p['itemCode']}"); continue; }
    $id = gen_id();
    $catId = null;
    foreach ($catMap as $cname => $cid) {
        if (stripos($p['category'], $cname) !== false || stripos($cname, $p['category']) !== false) { $catId=$cid; break; }
    }
    $pdo->prepare(
        'INSERT INTO `Product` (id,itemCode,productName,description,unit,standardPrice,category,categoryId,hsnCode,isActive,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,1,?,?)'
    )->execute([$id,$p['itemCode'],$p['productName'],$p['description'],$p['unit'],$p['standardPrice'],$p['category'],$catId,$p['hsnCode'],now_sql(),now_sql()]);
    $prodMap[$p['itemCode']] = $id;
    seed_log("  + product {$p['itemCode']}");
}

// ── Stock ─────────────────────────────────────────────────────────────
$stocks = [
    ['itemCode'=>'CNMG120408-MF','itemName'=>'CNMG 120408-MF Turning Insert','itemGroup'=>'Insert','categoryCode'=>'INS','availableStock'=>150,'netPrice'=>285,'xceedLp'=>355],
    ['itemCode'=>'WNMG080408-PM','itemName'=>'WNMG 080408-PM Turning Insert','itemGroup'=>'Insert','categoryCode'=>'INS','availableStock'=>80,'netPrice'=>320,'xceedLp'=>400],
    ['itemCode'=>'APKT1604PDR-DP','itemName'=>'APKT 1604PDR-DP Milling Insert','itemGroup'=>'Insert','categoryCode'=>'INS','availableStock'=>120,'netPrice'=>245,'xceedLp'=>305],
    ['itemCode'=>'EM-D10-4F-HRC45','itemName'=>'10mm 4-Flute End Mill HRC45','itemGroup'=>'End Mill','categoryCode'=>'EM','availableStock'=>25,'netPrice'=>1250,'xceedLp'=>1560],
    ['itemCode'=>'MCLNR2020K12','itemName'=>'MCLNR 2020K12 Tool Holder','itemGroup'=>'Holder','categoryCode'=>'HLD','availableStock'=>15,'netPrice'=>1800,'xceedLp'=>2250],
    ['itemCode'=>'MGMN300-M','itemName'=>'MGMN 300-M Grooving Insert','itemGroup'=>'Insert','categoryCode'=>'INS','availableStock'=>0,'netPrice'=>195,'xceedLp'=>243,'minimumStock'=>50],
];
foreach ($stocks as $st) {
    $s = $pdo->prepare('SELECT id FROM `Stock` WHERE itemCode=? LIMIT 1'); $s->execute([$st['itemCode']]);
    if ($s->fetchColumn()) { seed_log("  SKIP stock {$st['itemCode']}"); continue; }
    $prodId = $prodMap[$st['itemCode']] ?? null;
    $catId  = null;
    if ($prodId) { $cs=$pdo->prepare('SELECT categoryId FROM `Product` WHERE id=? LIMIT 1');$cs->execute([$prodId]);$row=$cs->fetch();$catId=$row?$row['categoryId']:null; }
    $pdo->prepare(
        'INSERT INTO `Stock` (id,itemCode,itemName,itemType,itemGroup,categoryCode,categoryId,productId,
         availableStock,minimumStock,netPrice,xceedLp,isActive,lastUpdated,updatedAt)
         VALUES (?,?,?,\'Regular\',?,?,?,?,?,?,?,?,1,?,?)'
    )->execute([gen_id(),$st['itemCode'],$st['itemName'],$st['itemGroup'],$st['categoryCode'],$catId,$prodId,
        $st['availableStock'],$st['minimumStock']??0,$st['netPrice'],$st['xceedLp'],now_sql(),now_sql()]);
    seed_log("  + stock {$st['itemCode']}");
}

// ── Sample meeting ────────────────────────────────────────────────────
if ($custMap) {
    $custId = array_values($custMap)[0];
    $s = $pdo->prepare('SELECT id FROM `Meeting` WHERE customerId=? AND userId=? LIMIT 1');
    $s->execute([$custId, $salesId]);
    if (!$s->fetchColumn()) {
        $nfu = date('Y-m-d H:i:s', strtotime('+3 days'));
        $pdo->prepare(
            'INSERT INTO `Meeting` (id,customerId,userId,meetingDate,meetingType,status,notes,nextFollowUp,followUpPriority,createdAt,updatedAt)
             VALUES (?,?,?,?,\'VISIT\',\'FOLLOW_UP_PENDING\',\'Initial discussion about cutting tool requirements for new CNC machine line.\',?,\'HIGH\',?,?)'
        )->execute([gen_id(),$custId,$salesId,now_sql(),$nfu,now_sql(),now_sql()]);
        seed_log("  + sample meeting");
    } else {
        seed_log("  SKIP sample meeting");
    }
}

seed_log('');
seed_log('✅  Seed complete. Login credentials:');
seed_log('   superadmin@tms.com / Admin@123   (SUPER_ADMIN)');
seed_log('   admin@tms.com     / Admin@123   (ADMIN)');
seed_log('   manager@tms.com   / Manager@123 (MANAGER)');
seed_log('   raj@tms.com       / Sales@123   (SALES)');
