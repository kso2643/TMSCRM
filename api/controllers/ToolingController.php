<?php
/**
 * Projects · Tooled-up · New machine accessories
 *
 * One request = a customer + one or more machines (VMC, HMC, CNC, VTL or
 * another type typed in), each with the accessories / tools picked from the
 * machine's checklist (tick + quantity) or typed in by hand.
 *
 *   engineer   DRAFT → SUBMITTED (approval request)
 *   admin      fills item code, price, discount → APPROVED (number PRJ-/TUP-/ACC-yymm-nnnn) or REJECTED
 *   anyone     after approval: negotiate prices / discounts. An admin's change applies at once; an
 *              engineer's change is a proposal (status NEGOTIATION) until an admin approves it.
 *              Every change is kept in the price history.
 *   quotation  the approval number loads every priced item into the quotation (GET /tooling/by-no/:no)
 *
 * Engineers see their own requests; Admin / Super Admin / Manager see everyone's.
 *
 *   GET    /api/tooling?type=&status=&user=&q=     list + counts
 *   GET    /api/tooling/checklist?machine=          checklists (default ones come from the
 *                                                   VMC accessories checklist; admins can upload their own)
 *   POST   /api/tooling/checklist                   admin: upload Excel (Category, Item[, Machine]) for a machine type
 *   POST   /api/tooling                             new request { type, customerId, customerName, title, notes, machines[], submit }
 *   GET    /api/tooling/:id
 *   PUT    /api/tooling/:id                         edit (draft / rejected; admins also while pending)
 *   POST   /api/tooling/:id/submit
 *   PATCH  /api/tooling/:id/prices                  admin { items:[{id,itemCode,spec,price,discount,qty}], action: save|approve|reject, note }
 *   POST   /api/tooling/:id/negotiate               { items:[{id,price,discount}], note }
 *   GET    /api/tooling/by-no/:no                   for the quotation page
 *   DELETE /api/tooling/:id
 */
class ToolingController
{
    public const TYPES = ['PROJECT' => ['Project', 'PRJ'], 'TOOLEDUP' => ['Tooled-up', 'TUP'], 'ACCESSORIES' => ['New machine accessories', 'ACC']];
    public const MACHINES = ['VMC', 'HMC', 'CNC', 'VTL', 'OTHER'];
    public const STATUSES = ['DRAFT' => 'Draft', 'SUBMITTED' => 'Waiting for approval', 'APPROVED' => 'Approved', 'NEGOTIATION' => 'Negotiation', 'REJECTED' => 'Rejected'];
    private const DEFAULTS = [
        'VMC' => ['Tool Holders' => ['ER32 Collet Chuck Holder', 'ER40 Collet Chuck Holder', 'Side Lock / End Mill Holder', 'Face Mill Arbor', 'Shell Mill Arbor', 'Hydraulic Chuck', 'Shrink Fit Holder', 'Drill Chuck Holder', 'Morse Taper Holder', 'Tapping Chuck (Rigid/Floating)', 'Boring Head & Boring Bar Holder', 'Extension Holder', 'Pull Studs / Retention Knobs'], 'Collets' => ['ER16 Collet Set', 'ER20 Collet Set', 'ER25 Collet Set', 'ER32 Collet Set', 'ER40 Collet Set', 'ER Collets — single sizes', 'Sealing Collets (coolant)', 'Tapping Collets (ER-GB / quick-change)', 'Collet Nuts (ER)', 'Collet Spanners'], 'Cutting Tools' => ['Carbide End Mills', 'Ball Nose End Mills', 'Roughing End Mills', 'Chamfer Mills', 'Spot Drills', 'Carbide Drills', 'Reamers', 'Taps', 'Face Mill Cutter', 'High Feed Mill', 'Indexable End Mill', 'Boring Bars & Heads'], 'Measuring Instruments' => ['Vernier Caliper', 'Outside Micrometer', 'Depth Micrometer', 'Dial Indicator', 'Dial Test Indicator (DTI)', 'Magnetic Stand', 'Height Gauge', 'Bore Gauge', 'Slip Gauge Set', 'Edge Finder', 'Electronic Edge Finder', 'Tool Presetter', 'Gauge Blocks'], 'Work Holding' => ['Machine Vice', 'Angle Plate', 'Clamping Kit (T-slot)', 'Step Blocks', 'Strap Clamps', 'Stud & Nut Set', 'Parallels', 'Soft Jaws', 'V-Blocks'], 'Tool Storage' => ['Tool Trolley', 'Tool Holder Rack', 'Insert Cabinet', 'Tool Cabinet', 'Shadow Board'], 'Hand Tools' => ['Allen Key Set', 'Torque Wrench', 'Spanner Set', 'Screwdriver Set', 'Dead Blow Hammer', 'Copper Hammer', 'Pliers', 'Deburring Tool', 'Files'], 'Maintenance' => ['Coolant Refractometer', 'Coolant Mixing Unit', 'Grease Gun', 'Lubricating Oil', 'Air Blow Gun', 'Coolant Hose', 'Cleaning Brush', 'Chip Hook', 'Chip Tray', 'Shop Vacuum'], 'Inspection & Setup' => ['3D Probe', 'Tool Length Probe', 'Workpiece Probe', 'Zero Setter', 'Haimer 3D Sensor'], 'Consumables' => ['Inserts', 'Screws', 'Torx Keys', 'Shim', 'Collet Nuts', 'Pull Stud Spare Set', 'Coolant', 'Way Oil', 'Grease']],
        'HMC' => ['Tool Holders' => ['ER32 Collet Chuck Holder', 'ER40 Collet Chuck Holder', 'Side Lock / End Mill Holder', 'Face Mill Arbor', 'Shell Mill Arbor', 'Hydraulic Chuck', 'Shrink Fit Holder', 'Drill Chuck Holder', 'Morse Taper Holder', 'Tapping Chuck (Rigid/Floating)', 'Boring Head & Boring Bar Holder', 'Extension Holder', 'Pull Studs / Retention Knobs'], 'Collets' => ['ER16 Collet Set', 'ER20 Collet Set', 'ER25 Collet Set', 'ER32 Collet Set', 'ER40 Collet Set', 'ER Collets — single sizes', 'Sealing Collets (coolant)', 'Tapping Collets (ER-GB / quick-change)', 'Collet Nuts (ER)', 'Collet Spanners'], 'Cutting Tools' => ['Carbide End Mills', 'Ball Nose End Mills', 'Roughing End Mills', 'Chamfer Mills', 'Spot Drills', 'Carbide Drills', 'Reamers', 'Taps', 'Face Mill Cutter', 'High Feed Mill', 'Indexable End Mill', 'Boring Bars & Heads'], 'Measuring Instruments' => ['Vernier Caliper', 'Outside Micrometer', 'Depth Micrometer', 'Dial Indicator', 'Dial Test Indicator (DTI)', 'Magnetic Stand', 'Height Gauge', 'Bore Gauge', 'Slip Gauge Set', 'Edge Finder', 'Electronic Edge Finder', 'Tool Presetter', 'Gauge Blocks'], 'Work Holding' => ['Pallet / Tombstone Fixture', 'Rotary Table / Indexer', 'Machine Vice', 'Angle Plate', 'Clamping Kit (T-slot)', 'Step Blocks', 'Strap Clamps', 'Stud & Nut Set', 'Parallels', 'Soft Jaws', 'V-Blocks'], 'Tool Storage' => ['Tool Trolley', 'Tool Holder Rack', 'Insert Cabinet', 'Tool Cabinet', 'Shadow Board'], 'Hand Tools' => ['Allen Key Set', 'Torque Wrench', 'Spanner Set', 'Screwdriver Set', 'Dead Blow Hammer', 'Copper Hammer', 'Pliers', 'Deburring Tool', 'Files'], 'Maintenance' => ['Coolant Refractometer', 'Coolant Mixing Unit', 'Grease Gun', 'Lubricating Oil', 'Air Blow Gun', 'Coolant Hose', 'Cleaning Brush', 'Chip Hook', 'Chip Tray', 'Shop Vacuum'], 'Inspection & Setup' => ['3D Probe', 'Tool Length Probe', 'Workpiece Probe', 'Zero Setter', 'Haimer 3D Sensor'], 'Consumables' => ['Inserts', 'Screws', 'Torx Keys', 'Shim', 'Collet Nuts', 'Pull Stud Spare Set', 'Coolant', 'Way Oil', 'Grease']],
        'CNC' => ['Tool Holders' => ['OD Turning Tool Holder', 'ID Boring Bar', 'Boring Bar Sleeve / Holder', 'Grooving / Parting Holder', 'Threading Holder (OD / ID)', 'U-Drill / Indexable Drill Holder', 'Drill Reduction Sleeve', 'ER Collet Holder (static / live)', 'VDI / BMT Tool Block', 'Live (Driven) Tool Holder', 'Quick-Change Tool Post'], 'Collets' => ['ER16 Collet Set', 'ER20 Collet Set', 'ER25 Collet Set', 'ER32 Collet Set', 'ER40 Collet Set', 'ER Collets — single sizes', 'Sealing Collets (coolant)', 'Tapping Collets (ER-GB / quick-change)', 'Spring Collets (bar work)', 'Collet Nuts (ER)', 'Collet Spanners'], 'Cutting Tools' => ['Turning Inserts (CNMG / DNMG / WNMG / VNMG)', 'Boring Bars (steel / carbide)', 'Grooving Inserts', 'Parting Blades & Inserts', 'Threading Inserts', 'Indexable Drills (U-drill)', 'Carbide Drills', 'Centre Drills', 'Taps', 'Reamers'], 'Work Holding' => ['3-Jaw Hydraulic Chuck', 'Soft Jaws', 'Hard Jaws', 'Collet Chuck', 'Live Centre (tailstock)', 'Steady Rest', 'Face Driver', 'Mandrels / Arbors', 'Jaw Boring Ring'], 'Measuring Instruments' => ['Vernier Caliper', 'Outside Micrometer', 'Depth Micrometer', 'Dial Indicator', 'Dial Test Indicator (DTI)', 'Magnetic Stand', 'Height Gauge', 'Bore Gauge', 'Slip Gauge Set', 'Edge Finder', 'Electronic Edge Finder', 'Tool Presetter', 'Gauge Blocks', 'Thread Ring / Plug Gauges', 'Radius Gauge Set'], 'Tool Storage' => ['Tool Trolley', 'Tool Holder Rack', 'Insert Cabinet', 'Tool Cabinet', 'Shadow Board'], 'Hand Tools' => ['Allen Key Set', 'Torque Wrench', 'Spanner Set', 'Screwdriver Set', 'Dead Blow Hammer', 'Copper Hammer', 'Pliers', 'Deburring Tool', 'Files'], 'Maintenance' => ['Coolant Refractometer', 'Coolant Mixing Unit', 'Grease Gun', 'Lubricating Oil', 'Air Blow Gun', 'Coolant Hose', 'Cleaning Brush', 'Chip Hook', 'Chip Tray', 'Shop Vacuum'], 'Inspection & Setup' => ['Tool Setter Arm', 'Tool Presetter', 'Workpiece Probe'], 'Consumables' => ['Inserts', 'Screws', 'Torx Keys', 'Shim', 'Collet Nuts', 'Pull Stud Spare Set', 'Coolant', 'Way Oil', 'Grease']],
        'VTL' => ['Tool Holders' => ['OD Turning Tool Holder', 'ID Boring Bar', 'Boring Bar Sleeve / Holder', 'Grooving / Parting Holder', 'Threading Holder (OD / ID)', 'U-Drill / Indexable Drill Holder', 'Drill Reduction Sleeve', 'ER Collet Holder (static / live)', 'VDI / BMT Tool Block', 'Live (Driven) Tool Holder', 'Quick-Change Tool Post'], 'Collets' => ['ER16 Collet Set', 'ER20 Collet Set', 'ER25 Collet Set', 'ER32 Collet Set', 'ER40 Collet Set', 'ER Collets — single sizes', 'Sealing Collets (coolant)', 'Tapping Collets (ER-GB / quick-change)', 'Spring Collets (bar work)', 'Collet Nuts (ER)', 'Collet Spanners'], 'Cutting Tools' => ['Turning Inserts (CNMG / DNMG / WNMG / VNMG)', 'Boring Bars (steel / carbide)', 'Grooving Inserts', 'Parting Blades & Inserts', 'Threading Inserts', 'Indexable Drills (U-drill)', 'Carbide Drills', 'Centre Drills', 'Taps', 'Reamers'], 'Work Holding' => ['4-Jaw Chuck / Faceplate', '3-Jaw Hydraulic Chuck', 'Soft Jaws', 'Hard Jaws', 'Collet Chuck', 'Live Centre (tailstock)', 'Steady Rest', 'Face Driver', 'Mandrels / Arbors', 'Jaw Boring Ring'], 'Measuring Instruments' => ['Vernier Caliper', 'Outside Micrometer', 'Depth Micrometer', 'Dial Indicator', 'Dial Test Indicator (DTI)', 'Magnetic Stand', 'Height Gauge', 'Bore Gauge', 'Slip Gauge Set', 'Edge Finder', 'Electronic Edge Finder', 'Tool Presetter', 'Gauge Blocks', 'Thread Ring / Plug Gauges', 'Radius Gauge Set'], 'Tool Storage' => ['Tool Trolley', 'Tool Holder Rack', 'Insert Cabinet', 'Tool Cabinet', 'Shadow Board'], 'Hand Tools' => ['Allen Key Set', 'Torque Wrench', 'Spanner Set', 'Screwdriver Set', 'Dead Blow Hammer', 'Copper Hammer', 'Pliers', 'Deburring Tool', 'Files'], 'Maintenance' => ['Coolant Refractometer', 'Coolant Mixing Unit', 'Grease Gun', 'Lubricating Oil', 'Air Blow Gun', 'Coolant Hose', 'Cleaning Brush', 'Chip Hook', 'Chip Tray', 'Shop Vacuum'], 'Inspection & Setup' => ['Tool Setter Arm', 'Tool Presetter', 'Workpiece Probe'], 'Consumables' => ['Inserts', 'Screws', 'Torx Keys', 'Shim', 'Collet Nuts', 'Pull Stud Spare Set', 'Coolant', 'Way Oil', 'Grease']],
    ];

    public static function schema(): array
    {
        $t = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        return [
            'ToolingRequest' => ['create' => "CREATE TABLE IF NOT EXISTS `ToolingRequest` (
  `id` VARCHAR(30) NOT NULL, `type` VARCHAR(12) NOT NULL, `requestNo` VARCHAR(30) NULL, `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  `customerId` VARCHAR(30) NULL, `customerName` VARCHAR(255) NOT NULL, `title` VARCHAR(255) NULL, `notes` TEXT NULL, `adminNote` TEXT NULL,
  `createdById` VARCHAR(30) NOT NULL, `submittedAt` DATETIME NULL, `approvedById` VARCHAR(30) NULL, `approvedAt` DATETIME NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `ToolingRequest_no` (`requestNo`), KEY `ToolingRequest_by` (`createdById`), KEY `ToolingRequest_type_status` (`type`, `status`)
$t"],
            'ToolingMachine' => ['create' => "CREATE TABLE IF NOT EXISTS `ToolingMachine` (
  `id` VARCHAR(30) NOT NULL, `requestId` VARCHAR(30) NOT NULL, `sortOrder` INT NOT NULL DEFAULT 0,
  `machineType` VARCHAR(10) NOT NULL, `machineOther` VARCHAR(80) NULL, `make` VARCHAR(120) NULL, `count` INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`), KEY `ToolingMachine_req` (`requestId`)
$t"],
            'ToolingItem' => ['create' => "CREATE TABLE IF NOT EXISTS `ToolingItem` (
  `id` VARCHAR(30) NOT NULL, `requestId` VARCHAR(30) NOT NULL, `machineId` VARCHAR(30) NOT NULL, `sortOrder` INT NOT NULL DEFAULT 0,
  `category` VARCHAR(80) NULL, `item` VARCHAR(255) NOT NULL, `custom` TINYINT(1) NOT NULL DEFAULT 0, `quantity` DECIMAL(12,2) NOT NULL DEFAULT 1, `unit` VARCHAR(20) NULL,
  `itemCode` VARCHAR(120) NULL, `spec` VARCHAR(500) NULL, `price` DECIMAL(14,2) NULL, `discount` DECIMAL(6,2) NULL,
  `proposedPrice` DECIMAL(14,2) NULL, `proposedDiscount` DECIMAL(6,2) NULL,
  PRIMARY KEY (`id`), KEY `ToolingItem_req` (`requestId`)
$t", 'columns' => ['operation' => 'VARCHAR(120) NULL', 'toolType' => 'VARCHAR(40) NULL', 'brand' => 'VARCHAR(100) NULL', 'rpm' => 'VARCHAR(30) NULL',
                   'feed' => 'VARCHAR(30) NULL', 'vc' => 'VARCHAR(30) NULL', 'pockets' => 'VARCHAR(20) NULL', 'holder' => 'VARCHAR(160) NULL', 'toolSpec' => 'VARCHAR(500) NULL']],
            'ToolingFile' => ['create' => "CREATE TABLE IF NOT EXISTS `ToolingFile` (
  `id` VARCHAR(30) NOT NULL, `requestId` VARCHAR(30) NOT NULL, `kind` VARCHAR(10) NOT NULL DEFAULT 'OTHER', `fileName` VARCHAR(255) NOT NULL,
  `storedName` VARCHAR(80) NOT NULL, `size` INT NOT NULL DEFAULT 0, `note` VARCHAR(255) NULL, `uploadedById` VARCHAR(30) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `ToolingFile_req` (`requestId`)
$t"],
            'ToolingPriceLog' => ['create' => "CREATE TABLE IF NOT EXISTS `ToolingPriceLog` (
  `id` VARCHAR(30) NOT NULL, `requestId` VARCHAR(30) NOT NULL, `itemId` VARCHAR(30) NULL, `userId` VARCHAR(30) NOT NULL, `kind` VARCHAR(12) NOT NULL,
  `item` VARCHAR(255) NULL, `oldPrice` DECIMAL(14,2) NULL, `newPrice` DECIMAL(14,2) NULL, `oldDiscount` DECIMAL(6,2) NULL, `newDiscount` DECIMAL(6,2) NULL,
  `note` TEXT NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `ToolingPriceLog_req` (`requestId`)
$t"],
            'ToolingChecklist' => ['create' => "CREATE TABLE IF NOT EXISTS `ToolingChecklist` (
  `id` VARCHAR(30) NOT NULL, `machineType` VARCHAR(10) NOT NULL, `category` VARCHAR(80) NOT NULL, `item` VARCHAR(255) NOT NULL, `sortOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`), KEY `ToolingChecklist_m` (`machineType`)
$t"],
        ];
    }

    public function __construct() { ensure_schema(self::schema(), 'Projects / tooled-up / machine accessories'); }

    private static function seesAll(array $a): bool { return is_admin_tier($a['role']); }
    private static function isAdmin(array $a): bool { return in_array($a['role'], ['SUPER_ADMIN', 'ADMIN'], true); }
    private static function num($v, string $what): ?float
    {
        if ($v === null || $v === '') return null;
        $v = str_replace([',', '₹', ' '], '', (string) $v);
        if (!is_numeric($v) || (float) $v < 0) sendError("$what must be a number.", 400);
        return round((float) $v, 2);
    }

    /** Checklist for a machine type: uploaded one if any, else the built-in default. */
    private static function checklistFor(string $m): array
    {
        $s = db()->prepare('SELECT category, item FROM `ToolingChecklist` WHERE machineType=? ORDER BY sortOrder');
        $s->execute([$m]);
        $out = [];
        foreach ($s->fetchAll() as $r) $out[$r['category']][] = $r['item'];
        if ($out) return $out;
        return self::DEFAULTS[$m] ?? self::DEFAULTS['VMC'];
    }

    // GET /api/tooling/checklist
    public function checklist(): void
    {
        authenticate();
        $out = [];
        foreach (['VMC', 'HMC', 'CNC', 'VTL'] as $m) {
            $c = db()->prepare('SELECT COUNT(*) FROM `ToolingChecklist` WHERE machineType=?'); $c->execute([$m]);
            $out[$m] = ['categories' => self::checklistFor($m), 'uploaded' => (int) $c->fetchColumn() > 0];
        }
        $out['OTHER'] = ['categories' => self::DEFAULTS['VMC'], 'uploaded' => false];
        sendSuccess(['checklists' => $out, 'types' => array_map(fn($t) => $t[0], self::TYPES), 'statuses' => self::STATUSES, 'machines' => self::MACHINES]);
    }

    // POST /api/tooling/checklist   multipart: file (Excel / CSV: Category, Item[, Machine]), machine (VMC…); reset=1 back to default
    public function uploadChecklist(): void
    {
        $auth = authenticate();
        if (!self::isAdmin($auth)) sendError('Only an Admin can change the checklists.', 403);
        $m = strtoupper(trim((string) ($_POST['machine'] ?? '')));
        if (!in_array($m, ['VMC', 'HMC', 'CNC', 'VTL'], true)) sendError('Pick the machine type (VMC, HMC, CNC or VTL).', 400);
        if (($_POST['reset'] ?? '') === '1') {
            db()->prepare('DELETE FROM `ToolingChecklist` WHERE machineType=?')->execute([$m]);
            sendSuccess([], "$m checklist set back to the default");
        }
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('Choose the Excel file.', 400);
        try { $rows = preg_match('/\.csv$/i', (string) $f['name']) ? array_map('str_getcsv', file($f['tmp_name'])) : XlsxReader::readFirstSheetRows($f['tmp_name']); }
        catch (Throwable $e) { sendError('Could not read the file: ' . $e->getMessage(), 400); }
        $hdr = array_map(fn($x) => strtolower(trim((string) $x)), $rows[0] ?? []);
        $ci = array_search('category', $hdr); $ii = array_search('item', $hdr); $mi = array_search('machine', $hdr);
        if ($ci === false || $ii === false) sendError('The first row must have the headings Category and Item (optional: Machine).', 400);
        $list = [];
        foreach (array_slice($rows, 1) as $r) {
            $cat = trim((string) ($r[$ci] ?? '')); $it = trim((string) ($r[$ii] ?? ''));
            if ($cat === '' || $it === '') continue;
            if ($mi !== false && trim((string) ($r[$mi] ?? '')) !== '' && stripos((string) $r[$mi], $m) === false) continue;
            $list[] = [mb_substr($cat, 0, 80), mb_substr($it, 0, 255)];
        }
        if (!$list) sendError('No Category / Item rows found for ' . $m . '.', 400);
        $pdo = db(); $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM `ToolingChecklist` WHERE machineType=?')->execute([$m]);
        $ins = $pdo->prepare('INSERT INTO `ToolingChecklist` (id,machineType,category,item,sortOrder) VALUES (?,?,?,?,?)');
        foreach ($list as $k => $x) $ins->execute([gen_id(), $m, $x[0], $x[1], $k]);
        $pdo->commit();
        log_activity($auth['id'], 'TOOLING_CHECKLIST', 'ToolingChecklist', null, ['machine' => $m, 'items' => count($list)]);
        sendSuccess(['count' => count($list)], count($list) . " items loaded into the $m checklist");
    }

    private static function load(array $auth, string $id): array
    {
        $s = db()->prepare('SELECT r.*, u.name AS createdByName, u.role AS createdByRole, a.name AS approvedByName FROM `ToolingRequest` r
            LEFT JOIN `User` u ON u.id=r.createdById LEFT JOIN `User` a ON a.id=r.approvedById WHERE r.id=?');
        $s->execute([$id]);
        $r = $s->fetch();
        if (!$r || (!self::seesAll($auth) && $r['createdById'] !== $auth['id'])) sendError('Request not found.', 404);
        return $r;
    }

    private static function full(array $r): array
    {
        $m = db()->prepare('SELECT * FROM `ToolingMachine` WHERE requestId=? ORDER BY sortOrder'); $m->execute([$r['id']]);
        $machines = $m->fetchAll();
        $i = db()->prepare('SELECT * FROM `ToolingItem` WHERE requestId=? ORDER BY sortOrder'); $i->execute([$r['id']]);
        $by = []; $total = 0.0; $priced = 0; $n = 0; $proposals = 0;
        foreach ($i->fetchAll() as $it) {
            foreach (['quantity', 'price', 'discount', 'proposedPrice', 'proposedDiscount'] as $k) $it[$k] = $it[$k] === null ? null : (float) $it[$k];
            $it['custom'] = (bool) $it['custom'];
            $it['net'] = $it['price'] === null ? null : round($it['price'] * (1 - ($it['discount'] ?? 0) / 100), 2);
            $it['amount'] = $it['net'] === null ? null : round($it['net'] * $it['quantity'], 2);
            if ($it['amount'] !== null) { $total += $it['amount']; $priced++; }
            if ($it['proposedPrice'] !== null || $it['proposedDiscount'] !== null) $proposals++;
            $n++;
            $by[$it['machineId']][] = $it;
        }
        foreach ($machines as &$mm) { $mm['count'] = (int) $mm['count']; $mm['items'] = $by[$mm['id']] ?? []; $mm['label'] = self::machineLabel($mm); }
        unset($mm);
        $l = db()->prepare('SELECT l.*, u.name AS userName FROM `ToolingPriceLog` l LEFT JOIN `User` u ON u.id=l.userId WHERE l.requestId=? ORDER BY l.createdAt DESC, l.id DESC'); $l->execute([$r['id']]);
        $r['machines'] = $machines; $r['log'] = $l->fetchAll();
        $f = db()->prepare('SELECT f.id, f.kind, f.fileName, f.size, f.note, f.createdAt, u.name AS uploadedByName FROM `ToolingFile` f LEFT JOIN `User` u ON u.id=f.uploadedById WHERE f.requestId=? ORDER BY f.createdAt');
        $f->execute([$r['id']]); $r['files'] = $f->fetchAll();
        $r['total'] = round($total, 2); $r['itemCount'] = $n; $r['pricedCount'] = $priced; $r['proposals'] = $proposals;
        $r['typeLabel'] = self::TYPES[$r['type']][0] ?? $r['type']; $r['statusLabel'] = self::STATUSES[$r['status']] ?? $r['status'];
        return $r;
    }

    private static function machineLabel(array $m): string
    {
        $t = $m['machineType'] === 'OTHER' ? ($m['machineOther'] ?: 'Other machine') : $m['machineType'];
        return $t . ($m['make'] ? ' · ' . $m['make'] : '') . ((int) $m['count'] > 1 ? ' × ' . (int) $m['count'] : '');
    }

    // GET /api/tooling
    public function index(): void
    {
        $auth = authenticate();
        $w = []; $p = [];
        if (!self::seesAll($auth)) { $w[] = 'r.createdById=?'; $p[] = $auth['id']; }
        elseif (($u = (string) qp('user', '')) !== '') { $w[] = 'r.createdById=?'; $p[] = $u; }
        if (($t = strtoupper((string) qp('type', ''))) !== '' && isset(self::TYPES[$t])) {
            // the Machine accessories page was merged into Tooled-up: its requests (ACC- numbers) are listed there
            if ($t === 'TOOLEDUP') $w[] = "r.type IN ('TOOLEDUP','ACCESSORIES')"; else { $w[] = 'r.type=?'; $p[] = $t; }
        }
        if (($q = trim((string) qp('q', ''))) !== '') { $w[] = '(r.customerName LIKE ? OR r.requestNo LIKE ? OR r.title LIKE ?)'; array_push($p, "%$q%", "%$q%", "%$q%"); }
        $base = $w ? 'WHERE ' . implode(' AND ', $w) : '';
        $c = db()->prepare("SELECT r.status, COUNT(*) n FROM `ToolingRequest` r $base GROUP BY r.status"); $c->execute($p);
        $counts = []; foreach ($c->fetchAll() as $x) $counts[$x['status']] = (int) $x['n'];
        if (($st = strtoupper((string) qp('status', ''))) !== '' && isset(self::STATUSES[$st])) { $w[] = 'r.status=?'; $p[] = $st; }
        $where = $w ? 'WHERE ' . implode(' AND ', $w) : '';
        $s = db()->prepare("SELECT r.*, u.name AS createdByName, u.role AS createdByRole,
                (SELECT GROUP_CONCAT(CASE WHEN m.machineType='OTHER' THEN COALESCE(m.machineOther,'Other') ELSE m.machineType END, IF(m.count>1, CONCAT(' ×', m.count), '') ORDER BY m.sortOrder SEPARATOR ', ') FROM `ToolingMachine` m WHERE m.requestId=r.id) AS machineSummary,
                (SELECT COUNT(*) FROM `ToolingItem` i WHERE i.requestId=r.id) AS itemCount,
                (SELECT SUM(ROUND(i.price*(1-COALESCE(i.discount,0)/100),2)*i.quantity) FROM `ToolingItem` i WHERE i.requestId=r.id AND i.price IS NOT NULL) AS total
            FROM `ToolingRequest` r LEFT JOIN `User` u ON u.id=r.createdById $where
            ORDER BY FIELD(r.status,'SUBMITTED','NEGOTIATION','DRAFT','REJECTED','APPROVED'), r.updatedAt DESC LIMIT 500");
        $s->execute($p);
        $rows = array_map(function ($r) {
            $r['itemCount'] = (int) $r['itemCount']; $r['total'] = $r['total'] === null ? null : round((float) $r['total'], 2);
            $r['statusLabel'] = self::STATUSES[$r['status']] ?? $r['status']; $r['typeLabel'] = self::TYPES[$r['type']][0] ?? $r['type'];
            return $r;
        }, $s->fetchAll());
        $people = self::seesAll($auth) ? db()->query('SELECT DISTINCT u.id, u.name, u.role FROM `ToolingRequest` r JOIN `User` u ON u.id=r.createdById ORDER BY u.name')->fetchAll() : [];
        sendSuccess(['requests' => $rows, 'counts' => $counts, 'people' => $people, 'statuses' => self::STATUSES, 'seesAll' => self::seesAll($auth), 'isAdmin' => self::isAdmin($auth)]);
    }

    // GET /api/tooling/:id
    public function show(string $id): void
    {
        $auth = authenticate();
        sendSuccess(['request' => self::full(self::load($auth, $id)), 'isAdmin' => self::isAdmin($auth)]);
    }

    /** Body → [header, machines[] with items[]] (validated). */
    private static function clean(array $b): array
    {
        $type = strtoupper(trim((string) ($b['type'] ?? '')));
        if (!isset(self::TYPES[$type])) sendError('Pick Project, Tooled-up or New machine accessories.', 400);
        $cid = trim((string) ($b['customerId'] ?? '')) ?: null;
        $cname = trim((string) ($b['customerName'] ?? ''));
        if ($cid) {
            $s = db()->prepare('SELECT companyName FROM `Customer` WHERE id=?'); $s->execute([$cid]);
            $n = $s->fetchColumn();
            if ($n === false) sendError('Customer not found.', 404);
            if ($cname === '') $cname = $n;
        }
        if ($cname === '') sendError('Pick the customer.', 400);
        $machines = [];
        foreach ((array) ($b['machines'] ?? []) as $k => $m) {
            if (!is_array($m)) continue;
            $mt = strtoupper(trim((string) ($m['machineType'] ?? '')));
            if (!in_array($mt, self::MACHINES, true)) sendError('Machine ' . ($k + 1) . ': pick VMC, HMC, CNC, VTL or Other.', 400);
            $other = trim((string) ($m['machineOther'] ?? ''));
            if ($mt === 'OTHER' && $other === '') sendError('Machine ' . ($k + 1) . ': type the machine (e.g. Turn-mill, Grinding).', 400);
            $cnt = max(1, min(999, (int) ($m['count'] ?? 1)));
            $items = [];
            foreach ((array) ($m['items'] ?? []) as $j => $it) {
                if (!is_array($it)) continue;
                $name = mb_substr(trim((string) ($it['item'] ?? '')), 0, 255);
                if ($name === '') continue;
                $qty = self::num($it['quantity'] ?? 1, 'Quantity');
                if ($qty === null || $qty <= 0) sendError('Machine ' . ($k + 1) . ', "' . $name . '": enter the quantity.', 400);
                $str = fn($k, $n) => mb_substr(trim((string) ($it[$k] ?? '')), 0, $n) ?: null;
                $price = array_key_exists('price', $it) ? self::num($it['price'], 'Price') : null;
                $items[] = ['category' => mb_substr(trim((string) ($it['category'] ?? '')), 0, 80) ?: 'Other', 'item' => $name, 'custom' => !empty($it['custom']) ? 1 : 0,
                            'quantity' => $qty, 'unit' => mb_substr(trim((string) ($it['unit'] ?? '')), 0, 20) ?: 'Nos', 'id' => (string) ($it['id'] ?? ''),
                            // tool selection details (Projects): operation, tool type, code, brand, cutting data, holder, specification
                            'operation' => $str('operation', 120), 'toolType' => $str('toolType', 40), 'itemCode' => $str('itemCode', 120), 'brand' => $str('brand', 100),
                            'rpm' => $str('rpm', 30), 'feed' => $str('feed', 30), 'vc' => $str('vc', 30), 'pockets' => $str('pockets', 20), 'holder' => $str('holder', 160),
                            'toolSpec' => $str('toolSpec', 500), 'price' => $price];
            }
            $machines[] = ['machineType' => $mt, 'machineOther' => $mt === 'OTHER' ? mb_substr($other, 0, 80) : null, 'make' => mb_substr(trim((string) ($m['make'] ?? '')), 0, 120) ?: null, 'count' => $cnt, 'items' => $items];
        }
        if (!$machines) sendError('Add at least one machine.', 400);
        if (!array_sum(array_map(fn($m) => count($m['items']), $machines))) sendError('Tick at least one item (or add a component) with its quantity.', 400);
        return [['type' => $type, 'customerId' => $cid, 'customerName' => mb_substr($cname, 0, 255),
                 'title' => mb_substr(trim((string) ($b['title'] ?? '')), 0, 255) ?: null, 'notes' => trim((string) ($b['notes'] ?? '')) ?: null], $machines];
    }

    /** Replaces machines + items; prices already set on an item (matched by id) are kept. */
    private static function saveMachines(string $rid, array $machines): void
    {
        $old = []; $s = db()->prepare('SELECT * FROM `ToolingItem` WHERE requestId=?'); $s->execute([$rid]);
        foreach ($s->fetchAll() as $o) $old[$o['id']] = $o;
        db()->prepare('DELETE FROM `ToolingItem` WHERE requestId=?')->execute([$rid]);
        db()->prepare('DELETE FROM `ToolingMachine` WHERE requestId=?')->execute([$rid]);
        $im = db()->prepare('INSERT INTO `ToolingMachine` (id,requestId,sortOrder,machineType,machineOther,make,count) VALUES (?,?,?,?,?,?,?)');
        $ii = db()->prepare('INSERT INTO `ToolingItem` (id,requestId,machineId,sortOrder,category,item,custom,quantity,unit,itemCode,spec,price,discount,
            operation,toolType,brand,rpm,feed,vc,pockets,holder,toolSpec) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?)');
        $n = 0;
        foreach ($machines as $k => $m) {
            $mid = gen_id();
            $im->execute([$mid, $rid, $k, $m['machineType'], $m['machineOther'], $m['make'], $m['count']]);
            foreach ($m['items'] as $it) {
                $o = ($it['id'] !== '' && isset($old[$it['id']])) ? $old[$it['id']] : null;
                $ii->execute([$o ? $it['id'] : gen_id(), $rid, $mid, $n++, $it['category'], $it['item'], $it['custom'], $it['quantity'], $it['unit'],
                    $it['itemCode'] ?? ($o['itemCode'] ?? null), $o['spec'] ?? null, $it['price'] ?? ($o['price'] ?? null), $o['discount'] ?? null,
                    $it['operation'], $it['toolType'], $it['brand'], $it['rpm'], $it['feed'], $it['vc'], $it['pockets'], $it['holder'], $it['toolSpec']]);
            }
        }
    }

    // POST /api/tooling
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();
        [$h, $machines] = self::clean($b);
        $id = gen_id(); $now = now_sql(); $submit = !empty($b['submit']);
        $pdo = db(); $pdo->beginTransaction();
        $pdo->prepare('INSERT INTO `ToolingRequest` (id,type,status,customerId,customerName,title,notes,createdById,submittedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $h['type'], $submit ? 'SUBMITTED' : 'DRAFT', $h['customerId'], $h['customerName'], $h['title'], $h['notes'], $auth['id'], $submit ? $now : null, $now, $now]);
        self::saveMachines($id, $machines);
        $pdo->commit();
        log_activity($auth['id'], $submit ? 'TOOLING_SUBMITTED' : 'TOOLING_CREATED', 'ToolingRequest', $id, ['type' => $h['type'], 'customer' => $h['customerName']]);
        sendSuccess(['request' => self::full(self::load($auth, $id))], $submit ? 'Sent for approval' : 'Saved as draft', 201);
    }

    // PUT /api/tooling/:id
    public function update(string $id): void
    {
        $auth = authenticate();
        $r = self::load($auth, $id);
        $mine = $r['createdById'] === $auth['id'];
        $editable = in_array($r['status'], ['DRAFT', 'REJECTED'], true) || ($r['status'] === 'SUBMITTED' && ($mine || self::isAdmin($auth)));
        if (!$editable || (!$mine && !self::isAdmin($auth))) sendError('This request is ' . strtolower(self::STATUSES[$r['status']]) . ' — use Negotiate to change prices.', 409);
        $b = request_body(); $b['type'] = $r['type'];
        [$h, $machines] = self::clean($b);
        $submit = !empty($b['submit']); $now = now_sql();
        $status = $submit ? 'SUBMITTED' : ($r['status'] === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT');
        $pdo = db(); $pdo->beginTransaction();
        $pdo->prepare('UPDATE `ToolingRequest` SET customerId=?, customerName=?, title=?, notes=?, status=?, submittedAt=IF(?, ?, submittedAt), updatedAt=? WHERE id=?')
            ->execute([$h['customerId'], $h['customerName'], $h['title'], $h['notes'], $status, $submit ? 1 : 0, $now, $now, $id]);
        self::saveMachines($id, $machines);
        $pdo->commit();
        sendSuccess(['request' => self::full(self::load($auth, $id))], $submit ? 'Sent for approval' : 'Saved');
    }

    // POST /api/tooling/:id/submit
    public function submit(string $id): void
    {
        $auth = authenticate();
        $r = self::load($auth, $id);
        if (!in_array($r['status'], ['DRAFT', 'REJECTED'], true)) sendError('Already sent.', 409);
        db()->prepare("UPDATE `ToolingRequest` SET status='SUBMITTED', submittedAt=?, updatedAt=? WHERE id=?")->execute([now_sql(), now_sql(), $id]);
        log_activity($auth['id'], 'TOOLING_SUBMITTED', 'ToolingRequest', $id);
        sendSuccess(['request' => self::full(self::load($auth, $id))], 'Sent for approval');
    }

    private static function nextNo(string $type): string
    {
        $prefix = self::TYPES[$type][1] . '-' . date('ym') . '-';
        $s = db()->prepare('SELECT requestNo FROM `ToolingRequest` WHERE requestNo LIKE ? ORDER BY requestNo DESC LIMIT 1');
        $s->execute([$prefix . '%']);
        $last = $s->fetchColumn();
        return $prefix . str_pad((string) (($last ? (int) substr($last, strlen($prefix)) : 0) + 1), 4, '0', STR_PAD_LEFT);
    }

    private static function logPrice(string $rid, array $auth, string $kind, ?array $it, $oldP, $newP, $oldD, $newD, ?string $note): void
    {
        db()->prepare('INSERT INTO `ToolingPriceLog` (id,requestId,itemId,userId,kind,item,oldPrice,newPrice,oldDiscount,newDiscount,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([gen_id(), $rid, $it['id'] ?? null, $auth['id'], $kind, $it['item'] ?? null, $oldP, $newP, $oldD, $newD, $note ?: null, now_sql()]);
    }

    // PATCH /api/tooling/:id/prices  (admin)
    public function prices(string $id): void
    {
        $auth = authenticate();
        if (!self::isAdmin($auth)) sendError('Only an Admin can price and approve.', 403);
        $r = self::load($auth, $id);
        $b = request_body();
        $action = strtolower((string) ($b['action'] ?? 'save'));
        $note = trim((string) ($b['note'] ?? ''));
        if (!in_array($action, ['save', 'approve', 'reject'], true)) sendError('Unknown action.', 400);
        if ($r['status'] === 'DRAFT') sendError('The engineer has not sent this for approval yet.', 409);
        if ($action === 'reject' && $note === '') sendError('Write why it is rejected (the engineer sees this).', 400);
        $s = db()->prepare('SELECT * FROM `ToolingItem` WHERE requestId=?'); $s->execute([$id]);
        $items = []; foreach ($s->fetchAll() as $it) $items[$it['id']] = $it;
        $pdo = db(); $pdo->beginTransaction();
        $up = $pdo->prepare('UPDATE `ToolingItem` SET itemCode=?, spec=?, price=?, discount=?, quantity=?, proposedPrice=NULL, proposedDiscount=NULL WHERE id=?');
        $fresh = in_array($r['status'], ['SUBMITTED', 'REJECTED'], true);
        foreach ((array) ($b['items'] ?? []) as $x) {
            $iid = (string) ($x['id'] ?? ''); if (!isset($items[$iid])) continue;
            $o = $items[$iid];
            $price = self::num($x['price'] ?? null, 'Price'); $disc = self::num($x['discount'] ?? null, 'Discount');
            if ($disc !== null && $disc > 100) sendError('Discount must be 0–100 %.', 400);
            $qty = array_key_exists('quantity', $x) ? self::num($x['quantity'], 'Quantity') : (float) $o['quantity'];
            if (!$qty || $qty <= 0) sendError('"' . $o['item'] . '": quantity must be more than 0.', 400);
            $code = mb_substr(trim((string) ($x['itemCode'] ?? $o['itemCode'] ?? '')), 0, 120) ?: null;
            $spec = mb_substr(trim((string) ($x['spec'] ?? $o['spec'] ?? '')), 0, 500) ?: null;
            $up->execute([$code, $spec, $price, $disc, $qty, $iid]);
            $op = $o['price'] === null ? null : (float) $o['price']; $od = $o['discount'] === null ? null : (float) $o['discount'];
            if (!$fresh && ($op !== $price || $od !== $disc)) self::logPrice($id, $auth, 'ADMIN', $o, $op, $price, $od, $disc, $note);
            $items[$iid] = array_merge($o, ['price' => $price, 'discount' => $disc]);
        }
        $msg = 'Prices saved';
        if ($action === 'approve') {
            foreach ($items as $it) if ($it['price'] === null || $it['price'] === '') { $pdo->rollBack(); sendError('Enter the price for "' . $it['item'] . '" before approving.', 400); }
            $no = $r['requestNo'] ?: self::nextNo($r['type']);
            $pdo->prepare("UPDATE `ToolingRequest` SET status='APPROVED', requestNo=?, approvedById=?, approvedAt=?, adminNote=?, updatedAt=? WHERE id=?")
                ->execute([$no, $auth['id'], now_sql(), $note ?: $r['adminNote'], now_sql(), $id]);
            self::logPrice($id, $auth, $r['status'] === 'NEGOTIATION' ? 'NEGO_OK' : 'APPROVED', null, null, null, null, null, $note ?: ($r['requestNo'] ? 'Negotiated prices approved' : "Approved as $no"));
            $msg = $r['requestNo'] ? 'Negotiated prices approved' : "Approved — number $no";
        } elseif ($action === 'reject') {
            $st = $r['status'] === 'NEGOTIATION' ? 'APPROVED' : 'REJECTED';
            $pdo->prepare("UPDATE `ToolingRequest` SET status=?, adminNote=?, updatedAt=? WHERE id=?")->execute([$st, $note, now_sql(), $id]);
            if ($st === 'APPROVED') $pdo->prepare('UPDATE `ToolingItem` SET proposedPrice=NULL, proposedDiscount=NULL WHERE requestId=?')->execute([$id]);
            self::logPrice($id, $auth, 'REJECTED', null, null, null, null, null, $note);
            $msg = $st === 'APPROVED' ? 'Negotiation turned down — the approved prices stay' : 'Rejected — sent back to the engineer';
        } else {
            $pdo->prepare('UPDATE `ToolingRequest` SET updatedAt=? WHERE id=?')->execute([now_sql(), $id]);
        }
        $pdo->commit();
        log_activity($auth['id'], 'TOOLING_' . strtoupper($action), 'ToolingRequest', $id);
        sendSuccess(['request' => self::full(self::load($auth, $id))], $msg);
    }

    // POST /api/tooling/:id/negotiate
    public function negotiate(string $id): void
    {
        $auth = authenticate();
        $r = self::load($auth, $id);
        if (!in_array($r['status'], ['APPROVED', 'NEGOTIATION'], true)) sendError('Negotiation starts after the request is approved.', 409);
        $b = request_body(); $note = trim((string) ($b['note'] ?? ''));
        if ($note === '') sendError('Write the reason (e.g. customer asked ₹480 against ₹520).', 400);
        $admin = self::isAdmin($auth);
        $s = db()->prepare('SELECT * FROM `ToolingItem` WHERE requestId=?'); $s->execute([$id]);
        $items = []; foreach ($s->fetchAll() as $it) $items[$it['id']] = $it;
        $pdo = db(); $pdo->beginTransaction(); $changed = 0;
        foreach ((array) ($b['items'] ?? []) as $x) {
            $iid = (string) ($x['id'] ?? ''); if (!isset($items[$iid])) continue;
            $o = $items[$iid];
            $price = self::num($x['price'] ?? null, 'Price'); $disc = self::num($x['discount'] ?? null, 'Discount');
            if ($price === null) continue;
            if ($disc !== null && $disc > 100) sendError('Discount must be 0–100 %.', 400);
            $op = $o['price'] === null ? null : (float) $o['price']; $od = $o['discount'] === null ? null : (float) $o['discount'];
            if ($op === $price && $od === $disc) continue;
            if ($admin) $pdo->prepare('UPDATE `ToolingItem` SET price=?, discount=?, proposedPrice=NULL, proposedDiscount=NULL WHERE id=?')->execute([$price, $disc, $iid]);
            else $pdo->prepare('UPDATE `ToolingItem` SET proposedPrice=?, proposedDiscount=? WHERE id=?')->execute([$price, $disc, $iid]);
            self::logPrice($id, $auth, $admin ? 'NEGOTIATED' : 'PROPOSED', $o, $op, $price, $od, $disc, $note);
            $changed++;
        }
        if (!$changed) { $pdo->rollBack(); sendError('Change at least one price or discount.', 400); }
        if (!$admin) $pdo->prepare("UPDATE `ToolingRequest` SET status='NEGOTIATION', updatedAt=? WHERE id=?")->execute([now_sql(), $id]);
        else $pdo->prepare('UPDATE `ToolingRequest` SET updatedAt=? WHERE id=?')->execute([now_sql(), $id]);
        $pdo->commit();
        log_activity($auth['id'], $admin ? 'TOOLING_NEGOTIATED' : 'TOOLING_PROPOSED', 'ToolingRequest', $id, ['items' => $changed]);
        sendSuccess(['request' => self::full(self::load($auth, $id))], $admin ? "$changed price(s) updated" : "$changed new price(s) sent to the admin for approval");
    }

    // GET /api/tooling/by-no/:no  — for the quotation page
    public function byNumber(string $no): void
    {
        $auth = authenticate();
        $no = strtoupper(trim(urldecode($no)));
        $s = db()->prepare('SELECT id FROM `ToolingRequest` WHERE requestNo=?'); $s->execute([$no]);
        $id = $s->fetchColumn();
        if (!$id) sendError("$no not found.", 404);
        $r = self::full(self::load($auth, $id));
        $items = [];
        foreach ($r['machines'] as $m) foreach ($m['items'] as $it) {
            if ($it['price'] === null) continue;
            $detail = array_filter([$it['brand'] ?? null, (!empty($it['holder']) && $r['type'] !== 'PROJECT') ? 'size ' . $it['holder'] : null, $it['toolSpec'] ?? null, !empty($it['operation']) ? 'for ' . $it['operation'] : null]);
            $items[] = ['itemCode' => $it['itemCode'] ?: '', 'productName' => $it['item'] . ($it['spec'] ? ' — ' . $it['spec'] : '') . ($detail ? ' — ' . implode(', ', $detail) : '') . ' (' . $m['label'] . ')',
                        'quantity' => $it['quantity'], 'approvedPrice' => $it['price'], 'approvedDiscount' => $it['discount'] ?? 0, 'brand' => null];
        }
        if (!$items) sendError("$no has no priced items.", 400);
        $c = null;
        if ($r['customerId']) { $q = db()->prepare('SELECT id, companyName, address, location, contactPerson FROM `Customer` WHERE id=?'); $q->execute([$r['customerId']]); $c = $q->fetch() ?: null; }
        sendSuccess(['requestNo' => $no, 'customer' => $c, 'items' => $items, 'pending' => 0, 'rejected' => 0, 'negotiating' => $r['status'] === 'NEGOTIATION' ? $r['proposals'] : 0, 'kind' => $r['typeLabel']]);
    }

    private const FILE_EXT = ['step' => '3D', 'stp' => '3D', 'igs' => '3D', 'iges' => '3D', 'x_t' => '3D', 'sldprt' => '3D', 'stl' => '3D', 'prt' => '3D',
        'dwg' => '2D', 'dxf' => '2D', 'pdf' => 'PDF', 'png' => 'IMAGE', 'jpg' => 'IMAGE', 'jpeg' => 'IMAGE', 'xlsx' => 'DOC', 'xls' => 'DOC', 'docx' => 'DOC', 'pptx' => 'DOC', 'zip' => 'ZIP'];

    // POST /api/tooling/:id/files — 3D (STEP/IGES…), 2D drawing (DWG/DXF/PDF), PDF, images, Office, ZIP — up to 50 MB
    public function uploadFile(string $id): void
    {
        $auth = authenticate();
        $r = self::load($auth, $id);
        if ($r['createdById'] !== $auth['id'] && !self::isAdmin($auth)) sendError('Only the engineer who raised it or an Admin can add files.', 403);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('No file received (check the size — up to 50 MB).', 400);
        if ($f['size'] > 50 * 1024 * 1024) sendError('The file is larger than 50 MB.', 400);
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        if (!isset(self::FILE_EXT[$ext])) sendError('This file type is not allowed. Use STEP / IGES / DWG / DXF / PDF / images / Excel / Word / PowerPoint / ZIP.', 400);
        $kind = strtoupper((string) ($_POST['kind'] ?? '')) ?: self::FILE_EXT[$ext];
        if (!in_array($kind, ['3D', '2D', 'PDF', 'IMAGE', 'DOC', 'ZIP', 'OTHER'], true)) $kind = self::FILE_EXT[$ext];
        $dir = UPLOADS_PATH . '/tooling';
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the file on the server.', 500);
        $fid = gen_id(); $stored = $fid . '.' . $ext;
        if (!move_uploaded_file($f['tmp_name'], "$dir/$stored") && !rename($f['tmp_name'], "$dir/$stored")) sendError('Could not save the file on the server.', 500);
        $name = preg_replace('/[^\w.\- ()]+/u', '_', (string) $f['name']);
        db()->prepare('INSERT INTO `ToolingFile` (id,requestId,kind,fileName,storedName,size,note,uploadedById,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$fid, $id, $kind, mb_substr($name, 0, 255), $stored, (int) $f['size'], mb_substr(trim((string) ($_POST['note'] ?? '')), 0, 255) ?: null, $auth['id'], now_sql()]);
        log_activity($auth['id'], 'TOOLING_FILE', 'ToolingRequest', $id, ['file' => $name]);
        sendSuccess(['request' => self::full(self::load($auth, $id))], 'File uploaded', 201);
    }

    // GET /api/tooling/:id/files/:fid
    public function downloadFile(string $id, string $fid): void
    {
        $auth = authenticate();
        self::load($auth, $id);
        $s = db()->prepare('SELECT * FROM `ToolingFile` WHERE id=? AND requestId=?'); $s->execute([$fid, $id]);
        $f = $s->fetch();
        if (!$f) sendError('File not found.', 404);
        $path = UPLOADS_PATH . '/tooling/' . basename($f['storedName']);
        if (!is_file($path)) sendError('The file is missing on the server.', 404);
        $ext = strtolower(pathinfo($f['storedName'], PATHINFO_EXTENSION));
        $types = ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg'];
        header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
        header('Content-Disposition: ' . (isset($types[$ext]) && !qp('download') ? 'inline' : 'attachment') . '; filename="' . str_replace('"', '', $f['fileName']) . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path); exit;
    }

    // DELETE /api/tooling/:id/files/:fid
    public function deleteFile(string $id, string $fid): void
    {
        $auth = authenticate();
        $r = self::load($auth, $id);
        if ($r['createdById'] !== $auth['id'] && !self::isAdmin($auth)) sendError('Only the engineer who raised it or an Admin can remove files.', 403);
        $s = db()->prepare('SELECT * FROM `ToolingFile` WHERE id=? AND requestId=?'); $s->execute([$fid, $id]);
        $f = $s->fetch();
        if (!$f) sendError('File not found.', 404);
        @unlink(UPLOADS_PATH . '/tooling/' . basename($f['storedName']));
        db()->prepare('DELETE FROM `ToolingFile` WHERE id=?')->execute([$fid]);
        sendSuccess(['request' => self::full(self::load($auth, $id))], 'File removed');
    }

    // DELETE /api/tooling/:id
    public function delete(string $id): void
    {
        $auth = authenticate();
        $r = self::load($auth, $id);
        $ok = $auth['role'] === 'SUPER_ADMIN' || ($r['createdById'] === $auth['id'] && in_array($r['status'], ['DRAFT', 'REJECTED', 'SUBMITTED'], true));
        if (!$ok) sendError('Only drafts / pending requests can be deleted by the engineer (the Super Admin can delete any).', 403);
        $fs = db()->prepare('SELECT storedName FROM `ToolingFile` WHERE requestId=?'); $fs->execute([$id]);
        foreach ($fs->fetchAll(PDO::FETCH_COLUMN) as $sn) @unlink(UPLOADS_PATH . '/tooling/' . basename($sn));
        foreach (['ToolingPriceLog', 'ToolingItem', 'ToolingMachine', 'ToolingFile'] as $t) db()->prepare("DELETE FROM `$t` WHERE requestId=?")->execute([$id]);
        db()->prepare('DELETE FROM `ToolingRequest` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'TOOLING_DELETED', 'ToolingRequest', $id, ['customer' => $r['customerName']]);
        sendSuccess([], 'Deleted');
    }
}
