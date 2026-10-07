<?php
/**
 * Purchase orders to vendors — in the same format as the quotations
 * (TMS or APJ letterhead), editable and deletable. The PDF carries the PO
 * data inside it, so a downloaded PDF can be uploaded again and edited.
 *
 * Company letterhead details (name, address, phone, e-mail, GST) are kept
 * per company (TMS / APJ): entered once, then fixed until someone presses
 * Edit and saves new ones.
 *
 *   GET    /api/purchase-orders?vendorId=&company=&q=     list
 *   GET    /api/purchase-orders/next-no?company=TMS        next PO number
 *   GET    /api/purchase-orders/:id                         one PO with lines
 *   POST   /api/purchase-orders                             create
 *   PUT    /api/purchase-orders/:id                         edit
 *   DELETE /api/purchase-orders/:id                         delete
 *   GET    /api/purchase-orders/:id/pdf                     PDF (quotation format)
 *   POST   /api/purchase-orders/read-pdf                    multipart "file": a downloaded PO PDF → its data (+ id if it still exists)
 *   GET    /api/company-profiles                            TMS + APJ letterhead details
 *   PUT    /api/company-profiles/:code                      save (Manager / Admin / Super Admin)
 */
class PurchaseOrderController
{
    public const COMPANIES = ['TMS', 'APJ'];
    public const STATUSES = ['DRAFT' => 'Draft', 'SENT' => 'Sent to vendor', 'RECEIVED' => 'Material received', 'CANCELLED' => 'Cancelled'];
    /** Letterhead used until someone saves their own (same as the quotations). */
    public const DEFAULT_PROFILES = [
        'TMS' => ['name' => 'TULIPS MACHINING SOLUTIONS',
                  'address' => "SF No 244, Palkarathottam, Opp. Sri Vignesh Nagar,\nJeeva Nagar, Cheran Managar, Villankurichi, Coimbatore - 641 035",
                  'phone' => '+91-0422 316 1934 | Mobile: 6379510936 / 7845843225', 'email' => 'uthaya@tulipsmachining.com', 'gstin' => '33BRHPA9794E1ZO'],
        'APJ' => ['name' => 'APJ Technologies Private Limited',
                  'address' => "No. 26/2, Kongu Maa Nagar, Villankurichi Road,\nCoimbatore - 641 035",
                  'phone' => 'Mobile: 6379510936', 'email' => 'operations@apjtech.in', 'gstin' => '33ABECA9840L1Z'],
    ];

    public static function ensure(): void
    {
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        ensure_schema([
            'PurchaseOrder' => ['create' => "CREATE TABLE IF NOT EXISTS `PurchaseOrder` (
  `id` VARCHAR(30) NOT NULL, `poNumber` VARCHAR(40) NOT NULL, `company` VARCHAR(5) NOT NULL DEFAULT 'TMS',
  `vendorId` VARCHAR(30) NULL, `vendorName` VARCHAR(160) NOT NULL, `vendorAddress` TEXT NULL, `vendorGstin` VARCHAR(30) NULL,
  `vendorPhone` VARCHAR(60) NULL, `vendorEmail` VARCHAR(160) NULL, `kindAttn` VARCHAR(120) NULL, `brand` VARCHAR(160) NULL,
  `poDate` DATE NOT NULL, `quoteRef` VARCHAR(120) NULL, `quoteDate` DATE NULL, `requiredBy` DATE NULL, `subject` VARCHAR(255) NULL,
  `deliveryAddress` TEXT NULL, `paymentTerms` VARCHAR(160) NULL, `deliveryTerms` VARCHAR(160) NULL, `freight` VARCHAR(120) NULL,
  `taxes` VARCHAR(120) NULL, `gstPercent` DECIMAL(5,2) NULL, `notes` TEXT NULL,
  `signName` VARCHAR(120) NULL, `signDesignation` VARCHAR(120) NULL,
  `subTotal` DECIMAL(14,2) NOT NULL DEFAULT 0, `taxAmount` DECIMAL(14,2) NOT NULL DEFAULT 0, `totalAmount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT', `createdById` VARCHAR(30) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `PurchaseOrder_no` (`poNumber`), KEY `PurchaseOrder_vendor_idx` (`vendorId`), KEY `PurchaseOrder_date_idx` (`poDate`)
$tail"],
            'PurchaseOrderItem' => ['create' => "CREATE TABLE IF NOT EXISTS `PurchaseOrderItem` (
  `id` VARCHAR(30) NOT NULL, `poId` VARCHAR(30) NOT NULL, `sortOrder` INT NOT NULL DEFAULT 0,
  `itemCode` VARCHAR(120) NULL, `description` VARCHAR(500) NULL, `brand` VARCHAR(100) NULL,
  `quantity` DECIMAL(14,2) NOT NULL DEFAULT 0, `unit` VARCHAR(20) NULL, `unitPrice` DECIMAL(14,2) NULL, `discount` DECIMAL(6,2) NULL,
  `netPrice` DECIMAL(14,2) NULL, `totalPrice` DECIMAL(14,2) NULL, `delivery` VARCHAR(80) NULL,
  PRIMARY KEY (`id`), KEY `PurchaseOrderItem_po_idx` (`poId`)
$tail"],
            'CompanyProfile' => ['create' => "CREATE TABLE IF NOT EXISTS `CompanyProfile` (
  `code` VARCHAR(5) NOT NULL, `name` VARCHAR(160) NOT NULL, `address` TEXT NULL, `phone` VARCHAR(160) NULL,
  `email` VARCHAR(160) NULL, `gstin` VARCHAR(30) NULL, `updatedById` VARCHAR(30) NULL, `updatedAt` DATETIME NULL,
  PRIMARY KEY (`code`)
$tail"],
        ], 'Purchase orders + company letterhead');
    }

    public function __construct() { self::ensure(); }

    private function guard(): array
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Purchase orders are for Manager / Admin / Super Admin.', 403);
        return $auth;
    }
    private static function co($v): string { $v = strtoupper(trim((string) $v)); return in_array($v, self::COMPANIES, true) ? $v : 'TMS'; }
    private static function str($v, int $max): ?string { $v = trim((string) $v); return $v === '' ? null : mb_substr($v, 0, $max); }
    private static function num($v): ?float { $v = trim(str_replace([',', '₹', '%'], '', (string) $v)); return $v === '' || !is_numeric($v) ? null : (float) $v; }

    // ── company letterhead ───────────────────────────────────────────────
    public static function profile(string $code): array
    {
        self::ensure();
        $s = db()->prepare('SELECT * FROM `CompanyProfile` WHERE code=?'); $s->execute([$code]);
        $r = $s->fetch();
        $d = self::DEFAULT_PROFILES[$code] ?? self::DEFAULT_PROFILES['TMS'];
        if (!$r) return $d + ['code' => $code, 'saved' => false];
        return ['code' => $code, 'name' => $r['name'] ?: $d['name'], 'address' => $r['address'], 'phone' => $r['phone'], 'email' => $r['email'],
                'gstin' => $r['gstin'], 'saved' => true, 'updatedAt' => $r['updatedAt']];
    }
    public function profiles(): void
    {
        authenticate();
        sendSuccess(['profiles' => ['TMS' => self::profile('TMS'), 'APJ' => self::profile('APJ')]]);
    }
    public function saveProfile(string $code): void
    {
        $auth = $this->guard();
        $code = strtoupper($code);
        if (!in_array($code, self::COMPANIES, true)) sendError('Unknown company.', 404);
        $b = request_body();
        $name = self::str($b['name'] ?? '', 160);
        $addr = trim((string) ($b['address'] ?? ''));
        if (!$name) sendError('Enter the company name.', 400);
        if ($addr === '') sendError('Enter the address.', 400);
        db()->prepare('INSERT INTO `CompanyProfile` (code,name,address,phone,email,gstin,updatedById,updatedAt) VALUES (?,?,?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE name=VALUES(name), address=VALUES(address), phone=VALUES(phone), email=VALUES(email), gstin=VALUES(gstin), updatedById=VALUES(updatedById), updatedAt=VALUES(updatedAt)')
            ->execute([$code, $name, mb_substr($addr, 0, 1000), self::str($b['phone'] ?? '', 160), self::str($b['email'] ?? '', 160), self::str($b['gstin'] ?? '', 30), $auth['id'], now_sql()]);
        log_activity($auth['id'], 'COMPANY_PROFILE_SAVED', 'CompanyProfile', $code, []);
        sendSuccess(['profile' => self::profile($code)], $code . ' letterhead saved');
    }

    // ── purchase orders ──────────────────────────────────────────────────
    private function nextNumber(string $co): string
    {
        $prefix = $co . '/PO/' . date('Y') . '/';
        $s = db()->prepare('SELECT poNumber FROM `PurchaseOrder` WHERE poNumber LIKE ? ORDER BY poNumber DESC LIMIT 1'); $s->execute([$prefix . '%']);
        $last = $s->fetchColumn();
        return $prefix . str_pad((string) ($last ? (int) substr($last, strlen($prefix)) + 1 : 1), 4, '0', STR_PAD_LEFT);
    }
    public function nextNo(): void
    {
        $this->guard();
        sendSuccess(['poNumber' => $this->nextNumber(self::co(qp('company', 'TMS')))]);
    }

    private function load(string $id): array
    {
        $s = db()->prepare('SELECT p.*, u.name AS createdByName FROM `PurchaseOrder` p LEFT JOIN `User` u ON u.id=p.createdById WHERE p.id=?'); $s->execute([$id]);
        $p = $s->fetch();
        if (!$p) sendError('Purchase order not found.', 404);
        $i = db()->prepare('SELECT * FROM `PurchaseOrderItem` WHERE poId=? ORDER BY sortOrder, id'); $i->execute([$id]);
        $p['items'] = array_map(function ($r) {
            foreach (['quantity', 'unitPrice', 'discount', 'netPrice', 'totalPrice'] as $k) $r[$k] = $r[$k] === null ? null : (float) $r[$k];
            return $r;
        }, $i->fetchAll());
        foreach (['subTotal', 'taxAmount', 'totalAmount', 'gstPercent'] as $k) $p[$k] = $p[$k] === null ? null : (float) $p[$k];
        $p['statusLabel'] = self::STATUSES[$p['status']] ?? $p['status'];
        return $p;
    }

    public function index(): void
    {
        $this->guard();
        $w = []; $p = [];
        if (qp('vendorId')) { $w[] = 'p.vendorId=?'; $p[] = qp('vendorId'); }
        if (qp('company')) { $w[] = 'p.company=?'; $p[] = self::co(qp('company')); }
        if (qp('status')) { $w[] = 'p.status=?'; $p[] = strtoupper(qp('status')); }
        if (($q = trim((string) qp('q', ''))) !== '') {
            $w[] = '(p.poNumber LIKE ? OR p.vendorName LIKE ? OR p.subject LIKE ? OR p.quoteRef LIKE ? OR EXISTS (SELECT 1 FROM `PurchaseOrderItem` x WHERE x.poId=p.id AND (x.itemCode LIKE ? OR x.description LIKE ?)))';
            array_push($p, "%$q%", "%$q%", "%$q%", "%$q%", "%$q%", "%$q%");
        }
        $s = db()->prepare('SELECT p.*, u.name AS createdByName, (SELECT COUNT(*) FROM `PurchaseOrderItem` x WHERE x.poId=p.id) AS lineCount
                            FROM `PurchaseOrder` p LEFT JOIN `User` u ON u.id=p.createdById ' . ($w ? 'WHERE ' . implode(' AND ', $w) : '') . '
                            ORDER BY p.poDate DESC, p.poNumber DESC LIMIT 300');
        $s->execute($p);
        sendSuccess(['orders' => array_map(function ($r) {
            $r['totalAmount'] = (float) $r['totalAmount']; $r['lineCount'] = (int) $r['lineCount'];
            $r['statusLabel'] = self::STATUSES[$r['status']] ?? $r['status'];
            return $r;
        }, $s->fetchAll()), 'statuses' => self::STATUSES]);
    }

    public function show(string $id): void
    {
        $this->guard();
        sendSuccess(['order' => $this->load($id)]);
    }

    /** Validates the body → [header fields, item rows]. */
    private function clean(array $b): array
    {
        $vendor = null;
        if (!empty($b['vendorId'])) {
            $s = db()->prepare('SELECT * FROM `Vendor` WHERE id=?'); $s->execute([(string) $b['vendorId']]);
            $vendor = $s->fetch() ?: null;
            if (!$vendor) sendError('Vendor not found.', 404);
        }
        $vendorName = self::str($b['vendorName'] ?? '', 160) ?: ($vendor['name'] ?? null);
        if (!$vendorName) sendError('Choose the vendor.', 400);
        $poDate = to_date_only($b['poDate'] ?? '') ?: date('Y-m-d');
        $items = []; $sub = 0.0;
        foreach ((array) ($b['items'] ?? []) as $k => $it) {
            $code = self::str($it['itemCode'] ?? '', 120); $desc = self::str($it['description'] ?? '', 500);
            $qty = self::num($it['quantity'] ?? '');
            if (!$code && !$desc && !$qty) continue;
            if (!$code && !$desc) sendError('Line ' . ($k + 1) . ': enter the item code or description.', 400);
            if (!$qty || $qty <= 0) sendError('Line ' . ($k + 1) . ' (' . ($code ?: $desc) . '): enter the quantity.', 400);
            $price = self::num($it['unitPrice'] ?? ''); $disc = self::num($it['discount'] ?? '');
            if ($disc !== null && ($disc < 0 || $disc > 100)) sendError('Line ' . ($k + 1) . ': discount must be 0–100 %.', 400);
            $net = self::num($it['netPrice'] ?? '');
            if ($price !== null) $net = round($price * (1 - ($disc ?? 0) / 100), 2);
            $total = $net !== null ? round($net * $qty, 2) : null;
            $sub += $total ?? 0;
            $items[] = ['itemCode' => $code ? strtoupper($code) : null, 'description' => $desc, 'brand' => self::str($it['brand'] ?? '', 100), 'quantity' => $qty,
                        'unit' => self::str($it['unit'] ?? '', 20), 'unitPrice' => $price, 'discount' => $disc, 'netPrice' => $net, 'totalPrice' => $total,
                        'delivery' => self::str($it['delivery'] ?? '', 80)];
        }
        if (!$items) sendError('Add at least one item.', 400);
        $gst = self::num($b['gstPercent'] ?? '');
        if ($gst !== null && ($gst < 0 || $gst > 40)) sendError('GST % must be 0–40.', 400);
        $tax = $gst ? round($sub * $gst / 100, 2) : 0.0;
        $status = strtoupper((string) ($b['status'] ?? 'DRAFT'));
        if (!isset(self::STATUSES[$status])) $status = 'DRAFT';
        $h = [
            'company' => self::co($b['company'] ?? 'TMS'), 'vendorId' => $vendor['id'] ?? null, 'vendorName' => $vendorName,
            'vendorAddress' => trim((string) ($b['vendorAddress'] ?? ($vendor['address'] ?? ''))) ?: null,
            'vendorGstin' => self::str($b['vendorGstin'] ?? ($vendor['gstin'] ?? ''), 30), 'vendorPhone' => self::str($b['vendorPhone'] ?? ($vendor['phone'] ?? ''), 60),
            'vendorEmail' => self::str($b['vendorEmail'] ?? ($vendor['email'] ?? ''), 160), 'kindAttn' => self::str($b['kindAttn'] ?? ($vendor['contactPerson'] ?? ''), 120),
            'brand' => self::str($b['brand'] ?? '', 160), 'poDate' => $poDate, 'quoteRef' => self::str($b['quoteRef'] ?? '', 120),
            'quoteDate' => to_date_only($b['quoteDate'] ?? '') ?: null, 'requiredBy' => to_date_only($b['requiredBy'] ?? '') ?: null,
            'subject' => self::str($b['subject'] ?? '', 255), 'deliveryAddress' => trim((string) ($b['deliveryAddress'] ?? '')) ?: null,
            'paymentTerms' => self::str($b['paymentTerms'] ?? '', 160), 'deliveryTerms' => self::str($b['deliveryTerms'] ?? '', 160),
            'freight' => self::str($b['freight'] ?? '', 120), 'taxes' => self::str($b['taxes'] ?? '', 120), 'gstPercent' => $gst,
            'notes' => trim((string) ($b['notes'] ?? '')) ?: null, 'signName' => self::str($b['signName'] ?? '', 120), 'signDesignation' => self::str($b['signDesignation'] ?? '', 120),
            'subTotal' => round($sub, 2), 'taxAmount' => $tax, 'totalAmount' => round($sub + $tax, 2), 'status' => $status,
        ];
        return [$h, $items];
    }

    private function saveItems(string $id, array $items): void
    {
        db()->prepare('DELETE FROM `PurchaseOrderItem` WHERE poId=?')->execute([$id]);
        $ins = db()->prepare('INSERT INTO `PurchaseOrderItem` (id,poId,sortOrder,itemCode,description,brand,quantity,unit,unitPrice,discount,netPrice,totalPrice,delivery) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
        foreach ($items as $k => $it) $ins->execute([gen_id(), $id, $k + 1, $it['itemCode'], $it['description'], $it['brand'], $it['quantity'], $it['unit'], $it['unitPrice'], $it['discount'], $it['netPrice'], $it['totalPrice'], $it['delivery']]);
    }

    public function create(): void
    {
        $auth = $this->guard();
        [$h, $items] = $this->clean(request_body());
        $id = gen_id();
        db()->beginTransaction();
        try {
            for ($try = 0; ; $try++) {
                $h['poNumber'] = $this->nextNumber($h['company']);
                try {
                    $row = $h + ['id' => $id, 'createdById' => $auth['id'], 'createdAt' => now_sql(), 'updatedAt' => now_sql()];
                    db()->prepare('INSERT INTO `PurchaseOrder` (' . implode(',', array_map(fn($k) => "`$k`", array_keys($row))) . ') VALUES (' . implode(',', array_fill(0, count($row), '?')) . ')')->execute(array_values($row));
                    break;
                } catch (PDOException $e) { if ($try >= 2 || $e->getCode() !== '23000') throw $e; }
            }
            $this->saveItems($id, $items);
            db()->commit();
        } catch (Throwable $e) { db()->rollBack(); sendError('Could not save the PO: ' . $e->getMessage(), 500); }
        log_activity($auth['id'], 'PO_CREATED', 'PurchaseOrder', $id, ['poNumber' => $h['poNumber'], 'vendor' => $h['vendorName']]);
        sendSuccess(['order' => $this->load($id)], 'Purchase order ' . $h['poNumber'] . ' saved', 201);
    }

    public function update(string $id): void
    {
        $auth = $this->guard();
        $old = $this->load($id);
        [$h, $items] = $this->clean(request_body());
        if ($h['company'] !== $old['company']) $h['poNumber'] = $this->nextNumber($h['company']); // a TMS PO moved to APJ gets an APJ number
        $h['updatedAt'] = now_sql();
        db()->beginTransaction();
        try {
            db()->prepare('UPDATE `PurchaseOrder` SET ' . implode(',', array_map(fn($k) => "`$k`=?", array_keys($h))) . ' WHERE id=?')->execute(array_merge(array_values($h), [$id]));
            $this->saveItems($id, $items);
            db()->commit();
        } catch (Throwable $e) { db()->rollBack(); sendError('Could not save the PO: ' . $e->getMessage(), 500); }
        log_activity($auth['id'], 'PO_UPDATED', 'PurchaseOrder', $id, ['poNumber' => $h['poNumber'] ?? $old['poNumber']]);
        sendSuccess(['order' => $this->load($id)], 'Purchase order saved');
    }

    public function delete(string $id): void
    {
        $auth = $this->guard();
        $old = $this->load($id);
        db()->prepare('DELETE FROM `PurchaseOrderItem` WHERE poId=?')->execute([$id]);
        db()->prepare('DELETE FROM `PurchaseOrder` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'PO_DELETED', 'PurchaseOrder', $id, ['poNumber' => $old['poNumber']]);
        sendSuccess([], 'Purchase order ' . $old['poNumber'] . ' deleted');
    }

    public function pdf(string $id): void
    {
        $this->guard();
        $po = $this->load($id);
        $pdf = (new PurchaseOrderPdf($po, self::profile($po['company'])))->render();
        // the PO travels inside the PDF, so the file can be uploaded again and edited
        $data = $po; unset($data['createdByName']);
        $pdf->embeddedData = json_encode(['kind' => 'tmscrm-po', 'v' => 1, 'po' => $data], JSON_UNESCAPED_UNICODE);
        $fn = preg_replace('/[^A-Za-z0-9]+/', '-', $po['poNumber']) . '-' . preg_replace('/[^A-Za-z0-9]+/', '-', $po['vendorName']) . '.pdf';
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/pdf');
        header('Content-Disposition: ' . (qp('inline') === '1' ? 'inline' : 'attachment') . '; filename="' . $fn . '"');
        echo $pdf->output(); exit;
    }

    public function readPdf(): void
    {
        $this->guard();
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('Choose the PO PDF.', 400);
        $bytes = (string) file_get_contents($f['tmp_name']);
        if (strpos($bytes, '%PDF') !== 0) sendError('That is not a PDF file.', 400);
        $raw = SimplePdf::readEmbedded($bytes);
        $d = $raw ? json_decode($raw, true) : null;
        if (!is_array($d) || ($d['kind'] ?? '') !== 'tmscrm-po' || !is_array($d['po'] ?? null)) {
            sendError('This PDF was not downloaded from the CRM purchase orders, so it cannot be opened for editing.', 400);
        }
        $po = $d['po'];
        // still in the CRM? → edit that one; otherwise it opens as a new PO with the same details
        $exists = null;
        if (!empty($po['id'])) { $s = db()->prepare('SELECT id FROM `PurchaseOrder` WHERE id=?'); $s->execute([$po['id']]); $exists = $s->fetchColumn() ?: null; }
        if ($exists) $po = $this->load($exists);
        sendSuccess(['order' => $po, 'existing' => (bool) $exists],
            $exists ? 'Opened ' . $po['poNumber'] . ' for editing' : 'PO read from the PDF — it is no longer in the CRM, saving creates it again');
    }
}

/** Purchase order PDF in the quotation layout (logo + letterhead, TO / PO info boxes, subject bar, table, terms, signatory). */
class PurchaseOrderPdf
{
    private const MM = 2.8346456693;
    private const BLUE = '#1A4FA0'; private const DARK = '#111827'; private const GREY = '#6B7280'; private const GREEN = '#166534';
    private const BGBLUE = '#EFF6FF'; private const BOX = '#D1D5DB'; private const CELL = '#ECECEC'; private const ALT = '#F9FAFB';
    private const A4_W = 210.0; private const A4_H = 297.0; private const ML = 10.0; private const MR = 10.0; private const MT = 12.0; private const MB = 14.0;
    private SimplePdf $pdf; private float $y = 0; private float $cw = 190;
    public function __construct(private array $po, private array $co) {}
    private function mm(float $v): float { return $v * self::MM; }
    private function t(string $s, float $x, float $y, array $o = []): void { $this->pdf->text($s, $this->mm($x), $this->mm($y), $o + ['baseline' => 'top']); }
    private function font(string $f, float $s, string $c): void { $this->pdf->setFont($f, $s); $this->pdf->setFillColor($c); }
    private function box(float $x, float $y, float $w, float $h, string $c, float $lw = 0.3): void
    {
        foreach ([[$x, $y, $x + $w, $y], [$x, $y + $h, $x + $w, $y + $h], [$x, $y, $x, $y + $h], [$x + $w, $y, $x + $w, $y + $h]] as $l)
            $this->pdf->line($this->mm($l[0]), $this->mm($l[1]), $this->mm($l[2]), $this->mm($l[3]), $c, $this->mm($lw));
    }
    private function wrap(string $s, float $wmm): array { return $s === '' ? [] : $this->pdf->splitTextToSize($s, $this->mm($wmm)); }
    private function money(?float $n): string { return $n === null ? '—' : 'Rs. ' . number_format($n, 2); }
    private function q(float $n): string { return rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.'); }
    private function d(?string $d): string { return $d ? date('d-m-Y', strtotime($d)) : '—'; }
    private function newPage(): void { $this->pdf->addPage($this->mm(self::A4_W), $this->mm(self::A4_H)); $this->box(5, 5, 200, 287, self::BLUE, 0.4); $this->y = self::MT; }
    private function need(float $h, ?callable $after = null): void { if ($this->y + $h > self::A4_H - self::MB) { $this->newPage(); if ($after) $after(); } }

    public function render(): SimplePdf
    {
        $p = $this->po; $c = $this->co; $isApj = $p['company'] === 'APJ';
        $this->pdf = new SimplePdf();
        $this->newPage();
        // ── header: logo + letterhead ──
        if ($isApj) { $lw = 24; $lh = 24; $logo = __DIR__ . '/../assets/apj-logo.png'; }
        else { $lh = 18; $lw = 291 * 18 / 164; $logo = __DIR__ . '/../assets/tms-logo.png'; }
        if (!$this->pdf->addImage($logo, $this->mm(self::ML), $this->mm($this->y), $this->mm($lw), $this->mm($lh))) { $this->font('Helvetica-Bold', 16, self::BLUE); $this->t($p['company'], self::ML, $this->y + 6); }
        $R = self::A4_W - self::MR;
        $this->font('Helvetica-Bold', 13, self::BLUE); $this->t((string) $c['name'], $R, $this->y + 1, ['align' => 'right']);
        $this->font('Helvetica', 7.5, self::DARK);
        $hy = $this->y + 7;
        $lines = array_filter(array_map('trim', explode("\n", (string) $c['address'])));
        $tail = array_filter([$c['phone'] ? (stripos($c['phone'], 'phone') === false && stripos($c['phone'], 'mobile') === false ? 'Phone: ' : '') . $c['phone'] : '', $c['email'] ? 'E-Mail: ' . $c['email'] : '', $c['gstin'] ? 'GST No: ' . $c['gstin'] : '']);
        foreach (array_merge($lines, [implode('  |  ', $tail)]) as $l) { foreach ($this->wrap($l, 150) as $w) { $this->t($w, $R, $hy, ['align' => 'right']); $hy += 3.8; } }
        $this->y = max($hy, $this->y + $lh) + 2;
        $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm($R), $this->mm($this->y), self::BLUE, $this->mm(0.8));
        $this->y += 3;
        $this->font('Helvetica-Bold', 12, self::BLUE); $this->t('PURCHASE ORDER', self::A4_W / 2, $this->y, ['align' => 'center']);
        $this->y += 7;
        // ── TO box (vendor) + PO info box ──
        $toW = $this->cw * 0.56; $mW = $this->cw * 0.40; $mX = self::ML + $this->cw - $mW; $top = $this->y;
        $toLines = [];
        foreach ($this->wrap((string) ($p['vendorAddress'] ?? ''), $toW - 6) as $w) $toLines[] = $w;
        $extra = array_filter([$p['vendorGstin'] ? 'GSTIN: ' . $p['vendorGstin'] : '', trim(($p['vendorPhone'] ? 'Ph: ' . $p['vendorPhone'] : '') . ($p['vendorEmail'] ? '  ' . $p['vendorEmail'] : '')), $p['brand'] ? 'Brand: ' . $p['brand'] : '']);
        $meta = [['PO No.', $p['poNumber']], ['PO Date', $this->d($p['poDate'])], ['Your Quote Ref.', $p['quoteRef'] ?: '—'], ['Quote Date', $this->d($p['quoteDate'])], ['Required By', $this->d($p['requiredBy'])], ['Kind Attn', $p['kindAttn'] ?: '—']];
        $boxH = max(36, 15 + 4 * (count($toLines) + count($extra)) + 2, 10 + 4.5 * count($meta) + 2);
        $this->box(self::ML, $top, $toW, $boxH, self::BOX);
        $this->font('Helvetica-Bold', 6.5, self::BLUE); $this->t('TO (VENDOR)', self::ML + 3, $top + 3);
        $this->font('Helvetica-Bold', 9.5, self::DARK); $this->t((string) $p['vendorName'], self::ML + 3, $top + 8);
        $this->font('Helvetica', 8, '#374151');
        $ay = $top + 13;
        foreach ($toLines as $l) { $this->t($l, self::ML + 3, $ay); $ay += 4; }
        $this->font('Helvetica', 7.5, self::GREY);
        foreach ($extra as $l) { $this->t($l, self::ML + 3, $ay); $ay += 4; }
        $this->box($mX, $top, $mW, $boxH, self::BOX);
        $this->font('Helvetica-Bold', 6.5, self::BLUE); $this->t('PURCHASE ORDER INFO', $mX + 3, $top + 3);
        $my = $top + 8;
        foreach ($meta as [$k, $v]) {
            $this->font('Helvetica', 7.5, self::GREY); $this->t($k, $mX + 3, $my);
            $this->font('Helvetica-Bold', 7.5, self::DARK); $this->t((string) $v, $mX + $mW - 3, $my, ['align' => 'right']);
            $my += 4.5;
        }
        $this->y = $top + $boxH + 3;
        // ── subject ──
        $sub = $p['subject'] ?: 'Purchase order for the items below';
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm(8), self::BGBLUE);
        $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm(self::ML), $this->mm($this->y + 8), self::BLUE, $this->mm(0.8));
        $this->font('Helvetica-Bold', 8.5, self::BLUE); $this->t('Sub: ' . $sub, self::ML + 4, $this->y + 2.6);
        $this->y += 10;
        $this->font('Helvetica', 8, self::DARK); $this->t('Dear Sir / Madam, please supply the following items as per the terms below.', self::ML, $this->y);
        $this->y += 6;
        // ── table ──
        $col = [8, 27, 52, 13, 19, 12, 19, 22, 18]; // 190
        $hd = ['S.No', 'Item Code', 'Description', 'Qty', 'Rate', 'Disc%', 'Net Rate', 'Amount', 'Delivery'];
        $x = [self::ML]; for ($i = 1; $i < count($col); $i++) $x[] = $x[$i - 1] + $col[$i - 1];
        $head = function () use ($col, $hd, $x) {
            $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm(7.5), self::BLUE);
            $this->font('Helvetica-Bold', 7.3, '#FFFFFF');
            foreach ($hd as $i => $h) $this->t($h, $x[$i] + $col[$i] / 2, $this->y + 2.3, ['align' => 'center']);
            $this->y += 7.5;
        };
        $head();
        foreach ($p['items'] as $n => $it) {
            $desc = trim(($it['description'] ?? '') . ($it['brand'] ? ' (' . $it['brand'] . ')' : ''));
            $this->font('Helvetica', 7.5, self::DARK);
            $dl = $this->wrap($desc ?: '—', $col[2] - 4);
            $this->font('Helvetica-Bold', 7.5, self::DARK);
            $cl = $this->wrap((string) ($it['itemCode'] ?? '—'), $col[1] - 3);
            $rh = max(6, 3.6 * max(count($dl), count($cl)) + 2.4);
            $this->need($rh, $head);
            if ($n % 2) $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm($rh), self::ALT);
            $this->font('Helvetica', 7.5, self::DARK);
            $this->t((string) ($n + 1), $x[0] + $col[0] / 2, $this->y + 1.6, ['align' => 'center']);
            $this->font('Helvetica-Bold', 7.5, self::DARK);
            foreach ($cl as $k => $l) $this->t($l, $x[1] + 1.5, $this->y + 1.6 + 3.6 * $k);
            $this->font('Helvetica', 7.5, self::DARK);
            foreach ($dl as $k => $l) $this->t($l, $x[2] + 1.5, $this->y + 1.6 + 3.6 * $k);
            $vals = [3 => $this->q((float) $it['quantity']) . ($it['unit'] ? ' ' . $it['unit'] : ''), 4 => $it['unitPrice'] === null ? '—' : number_format($it['unitPrice'], 2),
                     5 => $it['discount'] ? $this->q($it['discount']) . '%' : '—', 6 => $it['netPrice'] === null ? '—' : number_format($it['netPrice'], 2),
                     7 => $it['totalPrice'] === null ? '—' : number_format($it['totalPrice'], 2)];
            foreach ($vals as $i => $v) $this->t($v, $x[$i] + $col[$i] - 1.5, $this->y + 1.6, ['align' => 'right']);
            $this->font('Helvetica', 7, self::DARK);
            foreach ($this->wrap((string) ($it['delivery'] ?: '—'), $col[8] - 2) as $k => $l) $this->t($l, $x[8] + $col[8] / 2, $this->y + 1.6 + 3.4 * $k, ['align' => 'center']);
            for ($i = 1; $i < count($col); $i++) $this->pdf->line($this->mm($x[$i]), $this->mm($this->y), $this->mm($x[$i]), $this->mm($this->y + $rh), self::CELL, $this->mm(0.2));
            $this->y += $rh;
            $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm(self::ML + $this->cw), $this->mm($this->y), self::CELL, $this->mm(0.2));
        }
        $this->box(self::ML, $this->y - 0.01, $this->cw, 0.01, self::CELL);
        // ── totals ──
        $rows = [['Sub Total', $p['subTotal']]];
        if ($p['gstPercent']) $rows[] = ['GST @ ' . $this->q($p['gstPercent']) . '%', $p['taxAmount']];
        $rows[] = ['Grand Total', $p['totalAmount']];
        $this->need(8 * count($rows) + 2);
        $qtyTot = array_sum(array_map(fn($i) => (float) $i['quantity'], $p['items']));
        foreach ($rows as $k => [$lab, $val]) {
            $last = $k === count($rows) - 1;
            $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm(7), $last ? self::BGBLUE : '#FFFFFF');
            $this->box(self::ML, $this->y, $this->cw, 7, '#DCDCDC', 0.2);
            if ($k === 0) { $this->font('Helvetica-Bold', 8.5, self::BLUE); $this->t('Total Qty', $x[3] - 2, $this->y + 2.2, ['align' => 'right']); $this->font('Helvetica-Bold', 8.5, self::GREEN); $this->t($this->q($qtyTot), $x[4] - 2, $this->y + 2.2, ['align' => 'right']); }
            $this->font('Helvetica-Bold', $last ? 9 : 8.5, self::BLUE); $this->t($lab, $x[7] - 2, $this->y + 2.2, ['align' => 'right']);
            $this->font('Helvetica-Bold', $last ? 9 : 8.5, $last ? self::GREEN : self::DARK); $this->t($this->money((float) $val), self::ML + $this->cw - 2, $this->y + 2.2, ['align' => 'right']);
            $this->y += 7;
        }
        $this->y += 3;
        // ── terms + delivery address + signatory ──
        $terms = [['Payment', $p['paymentTerms']], ['Delivery', $p['deliveryTerms']], ['Freight', $p['freight']], ['Taxes', $p['taxes'] ?: ($p['gstPercent'] ? 'GST ' . $this->q($p['gstPercent']) . '% extra' : null)]];
        $terms = array_values(array_filter($terms, fn($t) => $t[1]));
        $dLines = $this->wrap((string) ($p['deliveryAddress'] ?? ''), 100);
        $nLines = $this->wrap((string) ($p['notes'] ?? ''), $this->cw - 6);
        $h = max(30, 10 + 4.5 * count($terms) + ($dLines ? 5 + 4 * count($dLines) : 0) + ($nLines ? 5 + 3.8 * count($nLines) : 0) + 3);
        $this->need($h + 4);
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm($h), '#FAFAFA');
        $this->box(self::ML, $this->y, $this->cw, $h, '#E5E7EB');
        $ty = $this->y + 3;
        $this->font('Helvetica-Bold', 8, self::DARK); $this->t('Terms & Conditions', self::ML + 3, $ty); $ty += 5.5;
        foreach ($terms as [$k, $v]) { $this->font('Helvetica', 7.5, self::GREY); $this->t($k, self::ML + 3, $ty); $this->font('Helvetica-Bold', 7.5, self::DARK); $this->t(': ' . $v, self::ML + 28, $ty); $ty += 4.5; }
        if ($dLines) { $ty += 1; $this->font('Helvetica-Bold', 7.5, self::DARK); $this->t('Deliver to:', self::ML + 3, $ty); $this->font('Helvetica', 7.5, self::DARK); foreach ($dLines as $l) { $this->t($l, self::ML + 28, $ty); $ty += 4; } }
        if ($nLines) { $ty += 1; $this->font('Helvetica-Bold', 7.5, self::DARK); $this->t('Note:', self::ML + 3, $ty); $ty += 4; $this->font('Helvetica', 7.3, '#374151'); foreach ($nLines as $l) { $this->t($l, self::ML + 3, $ty); $ty += 3.8; } }
        $sx = $R - 3;
        $this->font('Helvetica-Bold', 8, self::DARK); $this->t('For ' . $c['name'], $sx, $this->y + 3, ['align' => 'right']);
        $this->font('Helvetica', 7.5, '#374151');
        $this->t((string) ($p['signName'] ?? ''), $sx, $this->y + 16, ['align' => 'right']);
        $this->t((string) ($p['signDesignation'] ?: 'Authorised Signatory'), $sx, $this->y + 20, ['align' => 'right']);
        $this->y += $h + 3;
        // footer on each page
        for ($i = 0; $i < $this->pdf->pageCount(); $i++) {
            $this->pdf->setActivePage($i);
            $this->font('Helvetica', 6.8, self::GREY);
            $this->t($p['poNumber'] . '  ·  page ' . ($i + 1) . ' of ' . $this->pdf->pageCount() . '  ·  Please quote the PO number on your invoice and delivery challan.', self::A4_W / 2, self::A4_H - 10, ['align' => 'center']);
        }
        return $this->pdf;
    }
}
