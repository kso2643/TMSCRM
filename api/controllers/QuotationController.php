<?php
class QuotationController
{
    public function __construct()
    {
        // sortOrder keeps line items in the order they were entered: every item
        // of a save shares one createdAt (second precision), so ordering by that
        // alone returned them shuffled. notes = the per-item note in the editor.
        ensure_schema(['QuotationItem' => ['create' => '', 'columns' => [
            'sortOrder' => 'INT NOT NULL DEFAULT 0',
            'notes'     => 'TEXT NULL',
        ]]], 'QuotationItem sortOrder/notes columns');
    }

    /** Recognised brands. First entry is the fallback/default for legacy rows. */
    private const COMPANIES = ['TMS', 'APJ'];

    /** Per-brand letterhead info used by generatePdf(). Edit these to change the printed name/tagline/accent. */
    private const BRANDS = [
        'TMS' => [
            'name'    => 'Tulips Machining Solutions',
            'tagline' => 'Cutting Tools & Solutions',
            'accent'  => '#1E3A5F',
        ],
        'APJ' => [
            'name'    => 'APJ Technologies Private Limited',
            'tagline' => 'Precision Cutting Tools & Solutions',
            'accent'  => '#0E2A47',
        ],
    ];

    private function brand(string $company): array
    {
        return self::BRANDS[$company] ?? self::BRANDS['TMS'];
    }

    /** Normalises + validates the incoming `company` field; sends a 400 if it's neither APJ nor TMS. */
    private function resolveCompany(array $b, ?string $fallback = null): string
    {
        $raw = strtoupper(trim((string)($b['company'] ?? '')));
        if ($raw === '' && $fallback !== null) return $fallback;
        if (!in_array($raw, self::COMPANIES, true)) {
            sendError('Company is required and must be either APJ or TMS.', 400);
        }
        return $raw;
    }

    /**
     * {COMPANY}/{year}/{4-digit sequence} — each brand gets its own sequence that resets
     * every year. Seeded from the highest sequence actually issued for that company+year
     * (not a raw COUNT, so a delete doesn't cause a future collision), then double-checked
     * against the table as a whole and bumped past anything already taken — belt and
     * suspenders, since update() lets a quotation's company be corrected after creation,
     * which could otherwise leave a stale higher number "orphaned" under the old brand.
     */
    private function nextQuotationNumber(string $company): string
    {
        $prefix = $company . '/' . date('Y') . '/';
        $s = db()->prepare('SELECT quotationNumber FROM `Quotation` WHERE company=? AND quotationNumber LIKE ?');
        $s->execute([$company, $prefix . '%']);
        $max = 0;
        foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $existingNumber) {
            $seq = (int)substr($existingNumber, strlen($prefix));
            if ($seq > $max) $max = $seq;
        }

        $exists = db()->prepare('SELECT 1 FROM `Quotation` WHERE quotationNumber=? LIMIT 1');
        do {
            $max++;
            $candidate = $prefix . str_pad((string)$max, 4, '0', STR_PAD_LEFT);
            $exists->execute([$candidate]);
        } while ($exists->fetch());

        return $candidate;
    }

    /**
     * Resolves the quotation number for create(): a manually-supplied value (trimmed) wins,
     * after checking it isn't already taken by another quotation; an empty/omitted value
     * falls back to the existing {COMPANY}/{year}/{seq} auto-numbering untouched.
     */
    private function resolveQuotationNumber(array $b, string $company): string
    {
        $manual = trim((string)($b['quotationNumber'] ?? ''));
        if ($manual === '') {
            return $this->nextQuotationNumber($company);
        }
        $chk = db()->prepare('SELECT 1 FROM `Quotation` WHERE quotationNumber=? LIMIT 1');
        $chk->execute([$manual]);
        if ($chk->fetch()) {
            sendError('Quotation number "' . $manual . '" is already in use.', 400);
        }
        return $manual;
    }

    /**
     * Per-line price calc — ported exactly from the JS calcItem() function.
     * net = unitPrice × (1 − discount/100);  total = net × quantity
     */
    private function calcItem(array $item): array
    {
        $quantity  = (float)($item['quantity']  ?? 0);
        $unitPrice = (float)($item['unitPrice'] ?? 0);
        $discount  = (float)($item['discount']  ?? 0);
        $netPrice  = round($unitPrice * (1 - $discount / 100) * 100) / 100;
        $totalPrice= round($netPrice * $quantity * 100) / 100;
        return compact('quantity','unitPrice','discount','netPrice','totalPrice');
    }

    /** Shared letterhead field extraction — mirrors letterheadFields() in the JS. */
    private function letterheadFields(array $b): array
    {
        $s = fn($k) => trim($b[$k] ?? '');
        return [
            'quotationDate'   => to_dt($b['quotationDate']  ?? null) ?? now_sql(),
            'enquiryDate'     => to_dt($b['enquiryDate']    ?? null),
            'toName'          => $s('toName'),
            'toAddr1'         => $s('toAddr1'),
            'toAddr2'         => $s('toAddr2'),
            'toState'         => $s('toState'),
            'kindAttn'        => $s('kindAttn'),
            'toDesignation'   => $s('toDesignation'),
            'enquiryRef'      => $s('enquiryRef'),
            'subject'         => $s('subject')         ?: 'Quotation for Cutting Tools',
            'salesTax'        => $s('salesTax')        ?: '18% GST Extra',
            'paymentTerms'    => $s('paymentTerms'),
            'validity'        => $s('validity')        ?: '15 Days',
            'deliveryCharges' => $s('deliveryCharges'),
            'signCompany'     => $s('signCompany'),
            'signName'        => $s('signName'),
            'signDesignation' => $s('signDesignation'),
        ];
    }

    // GET /api/quotations
    public function index(): void
    {
        $auth = authenticate();
        [$page, $limit, $offset] = paginate(20);
        $search     = qp('search', '');
        $status     = qp('status', '');
        $customerId = qp('customerId', '');
        $company    = strtoupper(qp('company', ''));

        $where = []; $params = [];
        if ($auth['role'] !== 'ADMIN' && $auth['role'] !== 'SUPER_ADMIN') {
            $where[] = 'q.userId=?'; $params[] = $auth['id'];
        }
        if ($status)     { $where[] = 'q.status=?';      $params[] = $status; }
        if ($customerId) { $where[] = 'q.customerId=?';  $params[] = $customerId; }
        if (in_array($company, self::COMPANIES, true)) { $where[] = 'q.company=?'; $params[] = $company; }
        if ($search) {
            $like = "%$search%";
            $where[] = '(q.quotationNumber LIKE ? OR q.toName LIKE ? OR q.subject LIKE ? OR c.companyName LIKE ?)';
            $params = array_merge($params, [$like,$like,$like,$like]);
        }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare(
            "SELECT COUNT(*) FROM `Quotation` q LEFT JOIN `Customer` c ON c.id=q.customerId $w"
        );
        $s->execute($params);
        $total = (int)$s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT q.id,q.company,q.quotationNumber,q.status,q.totalAmount,q.approvalStatus,q.version,q.createdAt,q.updatedAt,
                    c.id AS c_id, c.companyName, c.contactPerson,
                    u.id AS u_id, u.name AS u_name,
                    (SELECT COUNT(*) FROM `QuotationItem` qi WHERE qi.quotationId=q.id) AS items_count
             FROM `Quotation` q
             LEFT JOIN `Customer` c ON c.id=q.customerId
             LEFT JOIN `User` u ON u.id=q.userId
             $w ORDER BY q.createdAt DESC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $rows = $s2->fetchAll();
        $items = array_map(function($r) {
            $r['customer'] = ['id'=>$r['c_id'],'companyName'=>$r['companyName'],'contactPerson'=>$r['contactPerson']];
            $r['user']     = ['id'=>$r['u_id'],'name'=>$r['u_name']];
            $r['_count']   = ['items' => (int)$r['items_count']];
            $r['totalAmount'] = (float)$r['totalAmount'];
            foreach(['c_id','companyName','contactPerson','u_id','u_name','items_count'] as $k) unset($r[$k]);
            return $r;
        }, $rows);
        sendPaginated($items, $total, $page, $limit, 'Quotations fetched');
    }

    // GET /api/quotations/stats
    public function stats(): void
    {
        $auth = authenticate();
        $uf = ($auth['role'] === 'ADMIN' || $auth['role'] === 'SUPER_ADMIN') ? '' : ' AND userId=?';
        $up = ($auth['role'] === 'ADMIN' || $auth['role'] === 'SUPER_ADMIN') ? [] : [$auth['id']];
        $cnt = fn($extra='') => (function() use ($uf,$up,$extra) {
            $s = db()->prepare("SELECT COUNT(*) FROM `Quotation` WHERE 1=1 $uf $extra");
            $s->execute($up); return (int)$s->fetchColumn();
        })();
        sendSuccess([
            'total'         => $cnt(),
            'draft'         => $cnt("AND status='DRAFT'"),
            'submitted'     => $cnt("AND status='QUOTATION_SUBMITTED'"),
            'negotiation'   => $cnt("AND status='NEGOTIATION'"),
            'purchaseOrder' => $cnt("AND status='PURCHASE_ORDER'"),
            'closed'        => $cnt("AND status='CLOSED'"),
            'lost'          => $cnt("AND status='LOST'"),
        ]);
    }

    // GET /api/quotations/:id
    public function show(string $id): void
    {
        authenticate();
        $s = db()->prepare(
            'SELECT q.*, c.id AS c_id, c.companyName, c.contactPerson, c.contactNumber, c.email AS c_email,
                    c.location AS c_location, c.address AS c_address,
                    u.id AS u_id, u.name AS u_name, u.email AS u_email, u.phone AS u_phone
             FROM `Quotation` q
             LEFT JOIN `Customer` c ON c.id=q.customerId
             LEFT JOIN `User` u ON u.id=q.userId
             WHERE q.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) sendError('Quotation not found.', 404);

        $is = db()->prepare(
            'SELECT qi.*, p.itemCode AS p_code, p.hsnCode AS p_hsn
             FROM `QuotationItem` qi LEFT JOIN `Product` p ON p.id=qi.productId
             WHERE qi.quotationId=? ORDER BY qi.sortOrder ASC, qi.createdAt ASC, qi.id ASC'
        );
        $is->execute([$id]);
        $quotItems = array_map(function($r) {
            $r['product'] = ($r['productId'] ?? null) ? ['itemCode'=>$r['p_code'],'hsnCode'=>$r['p_hsn']] : null;
            foreach(['p_code','p_hsn'] as $k) unset($r[$k]);
            $r['quantity']   = (float)$r['quantity'];
            $r['unitPrice']  = (float)$r['unitPrice'];
            $r['discount']   = (float)$r['discount'];
            $r['netPrice']   = (float)$r['netPrice'];
            $r['totalPrice'] = (float)$r['totalPrice'];
            return $r;
        }, $is->fetchAll());

        $as = db()->prepare(
            'SELECT a.*, u.name AS req_name FROM `Approval` a LEFT JOIN `User` u ON u.id=a.requestById
             WHERE a.quotationId=? ORDER BY a.createdAt DESC'
        );
        $as->execute([$id]);
        $approvals = array_map(function($r) {
            $r['requestBy'] = ['name'=>$r['req_name']]; unset($r['req_name']); return $r;
        }, $as->fetchAll());

        $q = $row;
        $q['customer']  = ['id'=>$row['c_id'],'companyName'=>$row['companyName'],'contactPerson'=>$row['contactPerson'],
                           'contactNumber'=>$row['contactNumber'],'email'=>$row['c_email'],
                           'location'=>$row['c_location'],'address'=>$row['c_address']];
        $q['user']      = ['id'=>$row['u_id'],'name'=>$row['u_name'],'email'=>$row['u_email'],'phone'=>$row['u_phone']];
        $q['items']     = $quotItems;
        $q['approvals'] = $approvals;
        $q['totalAmount'] = (float)$q['totalAmount'];
        foreach(['c_id','companyName','contactPerson','contactNumber','c_email','c_location','c_address',
                 'u_id','u_name','u_email','u_phone'] as $k) unset($q[$k]);
        sendSuccess(['quotation' => $q]);
    }

    // POST /api/quotations
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();
        $customerId = $b['customerId'] ?? '';
        $items      = $b['items'] ?? [];
        if (!$customerId)     sendError('Customer is required.', 400);
        if (!count($items))   sendError('At least one item is required.', 400);
        $company = $this->resolveCompany($b);

        $cs = db()->prepare('SELECT id FROM `Customer` WHERE id=? LIMIT 1');
        $cs->execute([$customerId]);
        if (!$cs->fetch()) sendError('Customer not found.', 404);

        $quotationNumber = $this->resolveQuotationNumber($b, $company);
        $lh = $this->letterheadFields($b);
        $id = gen_id();
        $now = now_sql();

        $calcedItems = array_map(fn($item) => array_merge([
            'productId'   => ($item['productId'] ?? null) ?: null,
            'itemCode'    => $item['itemCode']    ?? '',
            'productName' => $item['productName'] ?? '',
            'description' => $item['description'] ?? '',
            'category'    => $item['category']    ?? '',
            'unit'        => $item['unit']        ?? 'PCS',
            'delivery'    => $item['delivery']    ?? '',
            'hsnCode'     => $item['hsnCode']     ?? '',
            'notes'       => ($item['notes'] ?? '') === '' ? null : (string) $item['notes'],
        ], $this->calcItem($item)), $items);

        $totalAmount = round(array_sum(array_column($calcedItems, 'totalPrice')) * 100) / 100;

        db()->prepare(
            'INSERT INTO `Quotation` (id,company,quotationNumber,customerId,userId,status,version,totalAmount,notes,validUntil,
             approvalStatus,quotationDate,enquiryDate,toName,toAddr1,toAddr2,toState,kindAttn,toDesignation,
             enquiryRef,subject,salesTax,paymentTerms,validity,deliveryCharges,signCompany,signName,signDesignation,
             createdAt,updatedAt)
             VALUES (?,?,?,?,?,\'DRAFT\',1,?,?,?,\'PENDING\',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $id, $company, $quotationNumber, $customerId, $auth['id'], $totalAmount,
            $b['notes'] ?? null,
            to_dt($b['validUntil'] ?? null),
            $lh['quotationDate'], $lh['enquiryDate'],
            $lh['toName'],   $lh['toAddr1'],  $lh['toAddr2'], $lh['toState'],
            $lh['kindAttn'], $lh['toDesignation'], $lh['enquiryRef'], $lh['subject'],
            $lh['salesTax'], $lh['paymentTerms'],  $lh['validity'],   $lh['deliveryCharges'],
            $lh['signCompany'], $lh['signName'],    $lh['signDesignation'],
            $now, $now,
        ]);

        $ins = db()->prepare(
            'INSERT INTO `QuotationItem` (id,quotationId,productId,itemCode,productName,description,category,unit,
             quantity,unitPrice,discount,netPrice,totalPrice,delivery,hsnCode,notes,sortOrder,createdAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        foreach (array_values($calcedItems) as $pos => $ci) {
            $ins->execute([
                gen_id(), $id, $ci['productId'], $ci['itemCode'], $ci['productName'],
                $ci['description'], $ci['category'], $ci['unit'],
                $ci['quantity'], $ci['unitPrice'], $ci['discount'], $ci['netPrice'], $ci['totalPrice'],
                $ci['delivery'], $ci['hsnCode'], $ci['notes'], $pos + 1, $now,
            ]);
        }

        log_activity($auth['id'], 'QUOTATION_CREATED', 'Quotation', $id,
            ['quotationNumber'=>$quotationNumber,'customerId'=>$customerId,'totalAmount'=>$totalAmount]);
        $this->show($id);
    }

    // PUT /api/quotations/:id
    public function update(string $id): void
    {
        authenticate();
        $b = request_body();
        $s = db()->prepare('SELECT * FROM `Quotation` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        $existing = $s->fetch();
        if (!$existing) sendError('Quotation not found.', 404);
        if ($existing['approvalStatus'] === 'APPROVED')
            sendError('Cannot edit an approved quotation.', 400);

        $lh   = $this->letterheadFields($b);
        $company = $this->resolveCompany($b, $existing['company']);
        $sets = ['company=?','version=?','notes=?','status=?','validUntil=?',
                 'quotationDate=?','enquiryDate=?','toName=?','toAddr1=?','toAddr2=?','toState=?',
                 'kindAttn=?','toDesignation=?','enquiryRef=?','subject=?','salesTax=?',
                 'paymentTerms=?','validity=?','deliveryCharges=?',
                 'signCompany=?','signName=?','signDesignation=?','updatedAt=?'];
        $params = [
            $company,
            (int)$existing['version'] + 1,
            $b['notes'] ?? $existing['notes'],
            $b['status'] ?? $existing['status'],
            isset($b['validUntil']) ? to_dt($b['validUntil']) : $existing['validUntil'],
            $lh['quotationDate'], $lh['enquiryDate'],
            $lh['toName'],   $lh['toAddr1'],  $lh['toAddr2'],  $lh['toState'],
            $lh['kindAttn'], $lh['toDesignation'], $lh['enquiryRef'], $lh['subject'],
            $lh['salesTax'], $lh['paymentTerms'], $lh['validity'], $lh['deliveryCharges'],
            $lh['signCompany'], $lh['signName'], $lh['signDesignation'],
            now_sql(),
        ];

        $items = $b['items'] ?? [];
        if ($items) {
            $calcedItems = array_map(fn($item) => array_merge([
                'productId'   => ($item['productId'] ?? null) ?: null,
                'itemCode'    => $item['itemCode']    ?? '',
                'productName' => $item['productName'] ?? '',
                'description' => $item['description'] ?? '',
                'category'    => $item['category']    ?? '',
                'unit'        => $item['unit']        ?? 'PCS',
                'delivery'    => $item['delivery']    ?? '',
                'hsnCode'     => $item['hsnCode']     ?? '',
                'notes'       => ($item['notes'] ?? '') === '' ? null : (string) $item['notes'],
            ], $this->calcItem($item)), $items);

            $totalAmount = round(array_sum(array_column($calcedItems, 'totalPrice')) * 100) / 100;
            $sets[]    = 'totalAmount=?';
            $params[]  = $totalAmount;

            db()->prepare('DELETE FROM `QuotationItem` WHERE quotationId=?')->execute([$id]);
            $now = now_sql();
            $ins = db()->prepare(
                'INSERT INTO `QuotationItem` (id,quotationId,productId,itemCode,productName,description,category,unit,
                 quantity,unitPrice,discount,netPrice,totalPrice,delivery,hsnCode,notes,sortOrder,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
            );
            foreach (array_values($calcedItems) as $pos => $ci) {
                $ins->execute([
                    gen_id(), $id, $ci['productId'], $ci['itemCode'], $ci['productName'],
                    $ci['description'], $ci['category'], $ci['unit'],
                    $ci['quantity'], $ci['unitPrice'], $ci['discount'], $ci['netPrice'], $ci['totalPrice'],
                    $ci['delivery'], $ci['hsnCode'], $ci['notes'], $pos + 1, $now,
                ]);
            }
        }
        $params[] = $id;
        db()->prepare('UPDATE `Quotation` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        $this->show($id);
    }

    // DELETE /api/quotations/:id
    public function delete(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $d = db()->prepare('DELETE FROM `Quotation` WHERE id=?');
        if (!$d->execute([$id]) || $d->rowCount() === 0) sendError('Quotation not found.', 404);
        sendSuccess([], 'Quotation deleted');
    }

    // PATCH /api/quotations/:id/approve
    public function approve(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();
        $action = $b['action'] ?? '';
        if (!in_array($action, ['APPROVED','REJECTED'])) sendError('Invalid action.', 400);

        $newStatus = $action === 'APPROVED' ? 'QUOTATION_SUBMITTED' : 'DRAFT';
        $up = db()->prepare(
            'UPDATE `Quotation` SET approvalStatus=?,approvedById=?,approvedAt=?,status=?,updatedAt=? WHERE id=?'
        );
        if (!$up->execute([$action, $auth['id'], now_sql(), $newStatus, now_sql(), $id]) || $up->rowCount() === 0)
            sendError('Quotation not found.', 404);

        db()->prepare(
            'INSERT INTO `Approval` (id,type,entityId,requestById,status,note,quotationId,createdAt,updatedAt)
             VALUES (?,\'QUOTATION\',?,?,?,?,?,?,?)'
        )->execute([gen_id(), $id, $auth['id'], $action, $b['note']??null, $id, now_sql(), now_sql()]);

        $s = db()->prepare('SELECT * FROM `Quotation` WHERE id=? LIMIT 1'); $s->execute([$id]);
        sendSuccess(['quotation' => $s->fetch()], 'Quotation ' . strtolower($action) . ' successfully');
    }

    // GET /api/quotations/:id/pdf — letterhead PDF, branched per company. APJ uses
    // ApjQuotationPdf, TMS uses TMSQuotationPdf — both pixel-faithful ports of
    // quotation-creator-tms-apj-main's own per-brand templates (logo, TO/META boxes,
    // items table, terms + signatory, etc). Any other/legacy company falls back to the
    // original generic layout further below — a pixel-accurate port of the old PDFKit code,
    // branched via brand() for colour/name/tagline only.
    public function generatePdf(string $id): void
    {
        authenticate();
        $s = db()->prepare(
            'SELECT q.*, c.companyName, c.contactPerson, c.contactNumber, c.email AS c_email,
                    c.location AS c_location, c.address AS c_address,
                    u.name AS u_name, u.email AS u_email, u.phone AS u_phone
             FROM `Quotation` q
             LEFT JOIN `Customer` c ON c.id=q.customerId
             LEFT JOIN `User` u ON u.id=q.userId
             WHERE q.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $q = $s->fetch();
        if (!$q) sendError('Quotation not found.', 404);

        $is = db()->prepare(
            'SELECT qi.* FROM `QuotationItem` qi WHERE qi.quotationId=? ORDER BY qi.sortOrder ASC, qi.createdAt ASC, qi.id ASC'
        );
        $is->execute([$id]);
        $q['items'] = $is->fetchAll();

        $filename = str_replace('/', '-', $q['quotationNumber']) . '.pdf';
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . $filename . '"');

        if (($q['company'] ?? 'TMS') === 'APJ') {
            // Pixel-faithful port of quotation-creator-tms-apj-main's apj_downloadPDF() —
            // see includes/ApjQuotationPdf.php for the full port + unit-conversion notes.
            $pdf = (new ApjQuotationPdf($q, $q['items']))->render();
            echo $pdf->output();
            exit;
        }

        if (($q['company'] ?? 'TMS') === 'TMS') {
            // Pixel-faithful port of quotation-creator-tms-apj-main's tms_downloadPDF() —
            // see includes/TMSQuotationPdf.php for the full port + unit-conversion notes.
            $pdf = (new TMSQuotationPdf($q, $q['items']))->render();
            echo $pdf->output();
            exit;
        }

        // ── Any other/legacy company falls back to the original generic letterhead below. ──
        $brand = $this->brand($q['company'] ?? 'TMS');

        $fmtDate = function($d) {
            if (!$d) return '—';
            return (new DateTime($d))->format('d M Y');
        };
        $fmtMoney = function($n) {
            return 'Rs.' . number_format((float)$n, 2, '.', ',');
        };

        $pdf = new SimplePdf();
        $pdf->addPage(SimplePdf::A4_WIDTH, SimplePdf::A4_HEIGHT);

        // ── Header ───────────────────────────────────────────────────
        $pdf->setFont('Helvetica-Bold', 15);
        $pdf->setFillColor($brand['accent']);
        $pdf->text($q['signCompany'] ?: $brand['name'], 50, 50);

        $pdf->setFont('Helvetica', 9);
        $pdf->setFillColor('#64748B');
        $pdf->text($brand['tagline'], 50, 68);

        $pdf->setFont('Helvetica-Bold', 13);
        $pdf->setFillColor('#111827');
        $pdf->text('QUOTATION', 350, 50, ['width' => 195, 'align' => 'right']);

        $pdf->setFont('Helvetica', 9);
        $pdf->setFillColor('#374151');
        $pdf->text('No: ' . $q['quotationNumber'], 350, 68, ['width' => 195, 'align' => 'right']);
        $pdf->text('Date: ' . $fmtDate($q['quotationDate'] ?: $q['createdAt']), 350, 81, ['width' => 195, 'align' => 'right']);

        $pdf->line(50, 105, 545, 105, '#E2E8F0', 1);

        // ── To / Enquiry block ───────────────────────────────────────
        $pdf->setFont('Helvetica-Bold', 8.5);
        $pdf->setFillColor('#374151');
        $pdf->text('TO', 50, 118);

        $pdf->setFont('Helvetica-Bold', 10);
        $pdf->setFillColor('#111827');
        // Module 11 fix: this line had no 'width', so a long company name ran
        // straight off the page edge instead of wrapping — same bug as the
        // address lines below, same fix (bound it to the left column's
        // actual width, which ends before the right-aligned quotation-number
        // block starting at x=350).
        $pdf->text($q['toName'] ?: $q['companyName'], 50, 131, ['width' => 270]);

        $pdf->setFont('Helvetica', 8.5);
        $pdf->setFillColor('#6B7280');
        // Module 11 — "Customer Address field exceeds the layout width and
        // breaks page alignment": these three calls had no 'width', so
        // text() (see SimplePdf::text()) never wrapped them — it just drew
        // one unbroken line starting at x=50 with nothing stopping it from
        // running past the page's right edge for a long address. Every
        // other field in this function that needed to stay inside a column
        // already passes 'width' (see 'QUOTATION' and the date/number lines
        // above) — these three just never got it. Now that they wrap, a
        // fixed Y offset per line no longer works (a 2-line address would
        // run into the next line), so $toY cascades the same way $y already
        // cascades further down this function (kindAttn/subject/table).
        $toBlockLineHeight = 8.5 + 2; // mirrors text()'s own fontSize+lineGap default, so this stays exactly in sync with its wrapping
        $toY = 146;
        foreach (array_filter([$q['toAddr1'] ?? '', $q['toAddr2'] ?? '', $q['toState'] ?? '']) as $line) {
            $pdf->text($line, 50, $toY, ['width' => 270]);
            $toY += count($pdf->splitTextToSize($line, 270)) * $toBlockLineHeight;
        }

        $y = max(184, $toY + 12); // never starts earlier than before; grows only if the address actually wrapped
        if ($q['kindAttn']) {
            $pdf->textSegments(50, $y, [
                ['text' => 'Kind Attn: ', 'font' => 'Helvetica-Bold', 'size' => 8.5, 'color' => '#374151'],
                ['text' => $q['kindAttn'] . ($q['toDesignation'] ? ', ' . $q['toDesignation'] : ''),
                 'font' => 'Helvetica', 'size' => 8.5, 'color' => '#374151'],
            ]);
            $y += 14;
        }

        // Right column — Enquiry ref / date
        $pdf->setFont('Helvetica-Bold', 8.5);
        $pdf->setFillColor('#374151');
        $pdf->text('ENQUIRY REF', 350, 118);
        $pdf->setFont('Helvetica', 9);
        $pdf->setFillColor('#111827');
        $pdf->text($q['enquiryRef'] ?: '—', 350, 131);
        $pdf->setFont('Helvetica-Bold', 8.5);
        $pdf->setFillColor('#374151');
        $pdf->text('ENQUIRY DATE', 350, 148);
        $pdf->setFont('Helvetica', 9);
        $pdf->setFillColor('#111827');
        $pdf->text($fmtDate($q['enquiryDate']), 350, 161);

        if ($q['subject']) {
            $pdf->textSegments(50, $y + 6, [
                ['text' => 'Sub: ', 'font' => 'Helvetica-Bold', 'size' => 9, 'color' => '#374151'],
                ['text' => $q['subject'], 'font' => 'Helvetica', 'size' => 9, 'color' => '#374151'],
            ]);
            $y += 22;
        }

        // ── Items table ──────────────────────────────────────────────
        $tableTop = $y + 24;
        $cols    = [50, 78, 165, 295, 335, 380, 420, 460, 500];
        $widths  = [28, 87, 130, 40, 45, 40, 40, 40, 45];
        $headers = ['#', 'Code', 'Description', 'Cat', 'MOQ', 'Rate', 'Disc%', 'Net', 'Amount'];

        $pdf->rect(50, $tableTop, 495, 18, $brand['accent']);
        $pdf->setFont('Helvetica-Bold', 7.5);
        $pdf->setFillColor('#FFFFFF');
        foreach ($headers as $i => $h) {
            $align = $i >= 4 ? 'right' : 'left';
            $pdf->text($h, $cols[$i], $tableTop + 5, ['width' => $widths[$i], 'align' => $align]);
        }

        $rowY = $tableTop + 22;
        $rowH = 20;
        foreach ($q['items'] as $idx => $item) {
            if ($idx % 2 === 0) $pdf->rect(50, $rowY - 3, 495, $rowH, '#F8FAFC');
            $pdf->setFont('Helvetica', 7.5);
            $pdf->setFillColor('#374151');
            $pdf->text((string)($idx + 1), $cols[0], $rowY, ['width' => $widths[0]]);
            $pdf->text((string)$item['itemCode'], $cols[1], $rowY, ['width' => $widths[1]]);
            $desc = substr($item['description'] ?: $item['productName'] ?: '', 0, 60);
            $pdf->text($desc, $cols[2], $rowY, ['width' => $widths[2]]);
            $pdf->text((string)($item['category'] ?? ''), $cols[3], $rowY, ['width' => $widths[3], 'align' => 'right']);
            $pdf->text(number_format((float)$item['quantity'], 0), $cols[4], $rowY, ['width' => $widths[4], 'align' => 'right']);
            $pdf->text(number_format((float)$item['unitPrice'], 2), $cols[5], $rowY, ['width' => $widths[5], 'align' => 'right']);
            $disc = (float)$item['discount'] > 0 ? number_format((float)$item['discount'], 1) . '%' : '—';
            $pdf->text($disc, $cols[6], $rowY, ['width' => $widths[6], 'align' => 'right']);
            $pdf->text(number_format((float)$item['netPrice'], 2), $cols[7], $rowY, ['width' => $widths[7], 'align' => 'right']);
            $pdf->setFont('Helvetica-Bold', 7.5);
            $pdf->text(number_format((float)$item['totalPrice'], 2), $cols[8], $rowY, ['width' => $widths[8], 'align' => 'right']);
            $rowY += $rowH;
        }

        // Grand total bar
        $pdf->rect(50, $rowY, 495, 22, $brand['accent']);
        $pdf->setFont('Helvetica-Bold', 9.5);
        $pdf->setFillColor('#FFFFFF');
        $pdf->text('Grand Total', 50, $rowY + 6, ['width' => 405, 'align' => 'right']);
        $pdf->text($fmtMoney($q['totalAmount']), 500, $rowY + 6, ['width' => 45, 'align' => 'right']);

        // ── Terms ─────────────────────────────────────────────────────
        $termsY = $rowY + 38;
        $terms = array_filter([
            $q['salesTax']        ? ['Sales Tax',        $q['salesTax']]        : null,
            $q['paymentTerms']    ? ['Payment Terms',    $q['paymentTerms']]    : null,
            $q['validity']        ? ['Validity',         $q['validity']]        : null,
            $q['deliveryCharges'] ? ['Delivery Charges', $q['deliveryCharges']] : null,
        ]);
        $terms = array_values($terms);
        if ($terms) {
            $colW = 495 / min(count($terms), 4);
            foreach (array_slice($terms, 0, 4) as $i => [$label, $val]) {
                $pdf->setFont('Helvetica-Bold', 8);
                $pdf->setFillColor('#374151');
                $pdf->text("$label:", 50 + $i * $colW, $termsY, ['width' => $colW - 8]);
                $pdf->setFont('Helvetica', 8);
                $pdf->setFillColor('#6B7280');
                $pdf->text($val, 50 + $i * $colW, $termsY + 11, ['width' => $colW - 8]);
            }
            $termsY += 36;
        }

        // ── Signature ─────────────────────────────────────────────────
        $pdf->setFont('Helvetica-Bold', 9);
        $pdf->setFillColor('#374151');
        $pdf->text($q['signCompany'] ?: '', 380, $termsY + 20, ['width' => 165, 'align' => 'right']);
        $pdf->line(380, $termsY + 60, 545, $termsY + 60, '#CBD5E1', 1);
        $pdf->setFont('Helvetica-Bold', 8.5);
        $pdf->setFillColor('#111827');
        $pdf->text($q['signName'] ?: '', 380, $termsY + 64, ['width' => 165, 'align' => 'right']);
        $pdf->setFont('Helvetica', 8);
        $pdf->setFillColor('#6B7280');
        $pdf->text($q['signDesignation'] ?: '', 380, $termsY + 76, ['width' => 165, 'align' => 'right']);

        // Footer
        $pdf->setFont('Helvetica', 7.5);
        $pdf->setFillColor('#9CA3AF');
        $pdf->text('This is a computer-generated document.', 50, 780, ['width' => 495, 'align' => 'center']);

        echo $pdf->output();
        exit;
    }
}
