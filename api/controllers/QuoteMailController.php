<?php
/**
 * Quotation e-mails (v11.52) — TMS and APJ.
 *
 * Anyone who can see a quotation drafts the mail (To / CC / subject / text — all editable,
 * pre-filled with the company's wording), picks catalogues to attach, and sends it for
 * approval. A Super Admin, Admin or Manager checks it (can still edit), then "Approve & send"
 * — the server e-mails it with the quotation PDF and the catalogues. Or rejects it with a note.
 * Two kinds: QUOTATION (the offer) and CONFIRMATION (order / quotation confirmation).
 *
 *   GET  /api/quote-mail/draft?quotationId=&kind=      pre-filled draft + catalogue list
 *   GET  /api/quote-mail?quotationId=&status=           mails (approvers: all; others: their own)
 *   POST /api/quote-mail                                 save + send for approval (approvers may "sendNow")
 *   PUT  /api/quote-mail/:id                             edit (requester while not sent; approvers)
 *   POST /api/quote-mail/:id/approve                     approve + send now
 *   POST /api/quote-mail/:id/reject  { note }
 *   GET  /api/quote-mail/templates  PUT /api/quote-mail/templates   default wording per company / kind (approvers)
 */
class QuoteMailController
{
    public const APPROVERS = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];
    public const KINDS = ['QUOTATION' => 'Quotation', 'CONFIRMATION' => 'Quotation confirmation'];
    private const MAX_ATTACH = 20 * 1024 * 1024;

    public function __construct()
    {
        ensure_schema(['QuoteMail' => ['create' => "CREATE TABLE IF NOT EXISTS `QuoteMail` (
  `id` VARCHAR(30) NOT NULL, `quotationId` VARCHAR(30) NOT NULL, `kind` VARCHAR(14) NOT NULL DEFAULT 'QUOTATION', `company` VARCHAR(10) NOT NULL DEFAULT 'TMS',
  `toEmails` VARCHAR(1000) NOT NULL, `ccEmails` VARCHAR(1000) NULL, `subject` VARCHAR(300) NOT NULL, `body` MEDIUMTEXT NOT NULL,
  `attachPdf` TINYINT(1) NOT NULL DEFAULT 1, `catalogueIds` TEXT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING', `requestedById` VARCHAR(30) NULL, `reviewedById` VARCHAR(30) NULL, `reviewedAt` DATETIME NULL,
  `reviewNote` VARCHAR(500) NULL, `sentAt` DATETIME NULL, `sendError` VARCHAR(500) NULL, `driver` VARCHAR(8) NULL,
  `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`), KEY `QuoteMail_q` (`quotationId`), KEY `QuoteMail_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]], 'Quotation e-mails');
        new AppSettingsController();
        new CatalogController();
    }

    private static function isApprover(array $a): bool { return in_array($a['role'], self::APPROVERS, true); }

    private static function quotation(string $id): array
    {
        $s = db()->prepare('SELECT q.*, c.companyName, c.contactPerson, c.email AS c_email, u.name AS u_name, u.email AS u_email, u.phone AS u_phone
            FROM `Quotation` q LEFT JOIN `Customer` c ON c.id=q.customerId LEFT JOIN `User` u ON u.id=q.userId WHERE q.id=?');
        $s->execute([$id]);
        $q = $s->fetch();
        if (!$q) sendError('Quotation not found.', 404);
        return $q;
    }

    private static function canSee(array $a, array $q): bool
    {
        return self::isApprover($a) || $q['userId'] === $a['id'] || in_array($a['role'], ['SALES_ENGINEER', 'SALES', 'ACCOUNTS'], true);
    }

    // ── wording ─────────────────────────────────────────────────────────
    private static function defaults(): array
    {
        // v11.54: the company's own wording (same for TMS and APJ, the company name changes);
        // the subject is the quotation's own subject.
        $q = "Kind Attn: {attn}\n\nDear Sir,\n\nGreetings From {COMPANY}….!\n\n"
           . "We thank you for your valuable enquiry given to us for {quotationSubject}\n\n"
           . "Kindly find the attached best final offer for the same.\n\n"
           . "Request you to kindly confirm us your valuable feedback at the earliest.\n\n"
           . "Please do not hesitate to contact us, in case of any doubts{catalogueLine}"; // no signature (v11.55)
        $c = "Kind Attn: {attn}\n\nDear Sir,\n\nGreetings From {COMPANY}….!\n\n"
           . "We thank you for your valuable order confirmation given to us for {quotationSubject}\n\n"
           . "Kindly find the attached order confirmation for the same (our offer ref. {quotationNo}).\n\n"
           . "We will process your order at the earliest and keep you informed about the delivery.\n\n"
           . "Please do not hesitate to contact us, in case of any doubts{catalogueLine}"; // no signature (v11.55)
        $out = [];
        foreach (['TMS', 'APJ'] as $co) $out[$co] = [
            'QUOTATION' => ['subject' => '{quotationSubject}', 'body' => $q],
            'CONFIRMATION' => ['subject' => 'Order confirmation — {quotationSubject}', 'body' => $c],
        ];
        return $out;
    }

    private static function templates(): array
    {
        $s = db()->prepare("SELECT v FROM `AppSetting` WHERE k='qmail-tpl'"); $s->execute();
        $saved = json_decode((string) $s->fetchColumn(), true) ?: [];
        $d = self::defaults();
        foreach ($d as $co => $kinds) foreach ($kinds as $k => $t) if (!empty($saved[$co][$k]['body'])) $d[$co][$k] = ['subject' => (string) ($saved[$co][$k]['subject'] ?? $t['subject']), 'body' => (string) $saved[$co][$k]['body']];
        return $d;
    }

    private static function fill(string $t, array $q): string
    {
        $co = in_array($q['company'], ['TMS', 'APJ'], true) ? $q['company'] : 'TMS';
        $p = PurchaseOrderController::profile($co);
        $d = $q['quotationDate'] ?: substr((string) $q['createdAt'], 0, 10);
        $total = (float) $q['totalAmount'];
        if ($total <= 0) {
            $s = db()->prepare('SELECT COALESCE(SUM(COALESCE(NULLIF(totalPrice,0), quantity*unitPrice*(1-COALESCE(discount,0)/100))),0) FROM `QuotationItem` WHERE quotationId=?');
            $s->execute([$q['id']]);
            $total = (float) $s->fetchColumn();
        }
        $v = [
            '{attn}' => trim((string) ($q['kindAttn'] ?: ($q['contactPerson'] ?: ($q['toName'] ?: ($q['companyName'] ?: 'Sir / Madam'))))),
            '{customer}' => (string) ($q['toName'] ?: $q['companyName']),
            '{company}' => (string) ($p['name'] ?? $co), '{COMPANY}' => mb_strtoupper((string) ($p['name'] ?? $co)),
            '{quotationSubject}' => trim((string) ($q['subject'] ?? '')) !== '' ? trim((string) $q['subject']) : 'Quotation ' . $q['quotationNumber'], '{companyPhone}' => (string) ($p['phone'] ?? ''), '{companyEmail}' => (string) ($p['email'] ?? ''),
            '{quotationNo}' => (string) $q['quotationNumber'], '{date}' => $d ? date('d-m-Y', strtotime($d)) : '',
            '{enquiryRef}' => $q['enquiryRef'] ? ' (your ref: ' . $q['enquiryRef'] . ')' : '',
            '{subjectLine}' => $q['subject'] ? ' for ' . $q['subject'] : '',
            '{total}' => number_format($total, 2), '{validity}' => (string) ($q['validity'] ?: '30 days'),
            '{signName}' => (string) ($q['signName'] ?: $q['u_name']), '{signDesignation}' => (string) ($q['signDesignation'] ?? ''),
        ];
        if (($v['{signDesignation}'] ?? '') === '') $t = str_replace("{signDesignation}\n", '', $t);
        return trim(preg_replace("/\n{3,}/", "\n\n", strtr($t, $v)));
    }

    private static function catalogues(): array
    {
        $rows = db()->query("SELECT id, title, brand, brands, docType, fileName, storedName, linkUrl, size FROM `ProductCatalogueFile` ORDER BY brand, title")->fetchAll();
        return array_map(fn($r) => ['id' => $r['id'], 'title' => $r['title'], 'brand' => $r['brands'] ?: $r['brand'], 'docType' => $r['docType'] ?: 'CATALOGUE',
            'isLink' => $r['storedName'] === '' && $r['linkUrl'], 'linkUrl' => $r['linkUrl'], 'size' => (int) $r['size'], 'fileName' => $r['fileName']], $rows);
    }

    // GET /api/quote-mail/draft?quotationId=&kind=
    public function draft(): void
    {
        $a = authenticate();
        $q = self::quotation((string) qp('quotationId'));
        if (!self::canSee($a, $q)) sendError('Access denied.', 403);
        $kind = strtoupper((string) qp('kind', 'QUOTATION'));
        if (!isset(self::KINDS[$kind])) $kind = 'QUOTATION';
        $co = in_array($q['company'], ['TMS', 'APJ'], true) ? $q['company'] : 'TMS';
        $t = self::templates()[$co][$kind];
        $body = str_replace("{catalogueLine}\n", '', str_replace('{catalogueLine}', '', $t['body'])); // attachments are listed when it is sent
        sendSuccess([
            'draft' => ['quotationId' => $q['id'], 'kind' => $kind, 'company' => $co, 'to' => (string) ($q['c_email'] ?? ''), 'cc' => (string) ($a['email'] ?? ''),
                'subject' => self::fill($t['subject'], $q), 'body' => self::fill($body, $q), 'attachPdf' => true],
            'quotation' => ['id' => $q['id'], 'quotationNumber' => $q['quotationNumber'], 'customer' => $q['toName'] ?: $q['companyName'], 'company' => $co, 'total' => (float) $q['totalAmount']],
            'catalogues' => self::catalogues(),
            'canApprove' => self::isApprover($a), 'kinds' => self::KINDS, 'driver' => Mailer::driver(),
        ]);
    }

    private static function read(array $b, array $q): array
    {
        $to = Mailer::list($b['to'] ?? '');
        $cc = Mailer::list($b['cc'] ?? '');
        if (!$to) sendError('Enter the customer\'s e-mail address (To).', 400);
        $subject = trim((string) ($b['subject'] ?? ''));
        $body = trim(str_replace("\r", '', (string) ($b['body'] ?? '')));
        if ($subject === '') sendError('Enter the subject.', 400);
        if ($body === '') sendError('Write the mail text.', 400);
        $kind = strtoupper((string) ($b['kind'] ?? 'QUOTATION'));
        if (!isset(self::KINDS[$kind])) $kind = 'QUOTATION';
        $cats = array_values(array_unique(array_filter(array_map('strval', (array) ($b['catalogueIds'] ?? [])))));
        return ['toEmails' => implode(', ', $to), 'ccEmails' => $cc ? implode(', ', $cc) : null, 'subject' => mb_substr($subject, 0, 300), 'body' => $body,
                'kind' => $kind, 'attachPdf' => array_key_exists('attachPdf', $b) ? (bool_val($b['attachPdf']) ? 1 : 0) : 1, 'catalogueIds' => json_encode($cats)];
    }

    private static function row(string $id): array
    {
        $s = db()->prepare('SELECT m.*, q.quotationNumber, q.toName, c.companyName, r.name AS requestedBy, v.name AS reviewedBy
            FROM `QuoteMail` m JOIN `Quotation` q ON q.id=m.quotationId LEFT JOIN `Customer` c ON c.id=q.customerId
            LEFT JOIN `User` r ON r.id=m.requestedById LEFT JOIN `User` v ON v.id=m.reviewedById WHERE m.id=?');
        $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) sendError('Mail not found.', 404);
        return self::shape($r);
    }

    private static function shape(array $r): array
    {
        $r['catalogueIds'] = json_decode((string) $r['catalogueIds'], true) ?: [];
        $r['attachPdf'] = (bool) $r['attachPdf'];
        $r['customer'] = $r['toName'] ?: $r['companyName'];
        $r['kindLabel'] = self::KINDS[$r['kind']] ?? $r['kind'];
        unset($r['toName'], $r['companyName']);
        return $r;
    }

    private static function notify(array $userIds, string $byId, string $title, string $body, string $link): void
    {
        foreach (array_unique(array_filter($userIds)) as $u) {
            if ($u === $byId) continue;
            try {
                db()->prepare('INSERT INTO `ChangeNotice` (id,userId,byId,title,body,link,createdAt) VALUES (?,?,?,?,?,?,?)')
                    ->execute([gen_id(), $u, $byId, mb_substr($title, 0, 190), mb_substr($body, 0, 500), $link, now_sql()]);
            } catch (Throwable $e) { /* alerts are best-effort */ }
        }
    }

    private static function approverIds(): array
    {
        return db()->query("SELECT id FROM `User` WHERE isActive=1 AND role IN ('SUPER_ADMIN','ADMIN','MANAGER')")->fetchAll(PDO::FETCH_COLUMN);
    }

    // POST /api/quote-mail
    public function create(): void
    {
        $a = authenticate();
        $b = request_body();
        $q = self::quotation((string) ($b['quotationId'] ?? ''));
        if (!self::canSee($a, $q)) sendError('Access denied.', 403);
        $d = self::read($b, $q);
        $id = gen_id();
        db()->prepare('INSERT INTO `QuoteMail` (id,quotationId,kind,company,toEmails,ccEmails,subject,body,attachPdf,catalogueIds,status,requestedById,createdAt,updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,\'PENDING\',?,?,?)')
            ->execute([$id, $q['id'], $d['kind'], in_array($q['company'], ['TMS', 'APJ'], true) ? $q['company'] : 'TMS', $d['toEmails'], $d['ccEmails'], $d['subject'], $d['body'],
                $d['attachPdf'], $d['catalogueIds'], $a['id'], now_sql(), now_sql()]);
        log_activity($a['id'], 'QUOTE_MAIL_REQUESTED', 'Quotation', $q['id'], ['mailId' => $id, 'kind' => $d['kind']]);
        if (self::isApprover($a) && bool_val($b['sendNow'] ?? false)) { $this->doApprove($a, $id); return; }
        self::notify(self::approverIds(), $a['id'], '✉ Approve ' . strtolower(self::KINDS[$d['kind']]) . ' mail — ' . $q['quotationNumber'],
            ($a['name'] ?? 'Someone') . ' wants to e-mail ' . ($q['toName'] ?: $q['companyName']) . ' (' . $d['toEmails'] . '). Check and approve.', '/quotations/#mail-approvals');
        sendSuccess(['mail' => self::row($id)], 'Sent for approval to the Manager / Admin', 201);
    }

    // GET /api/quote-mail
    public function index(): void
    {
        $a = authenticate();
        $w = []; $p = [];
        if (qp('quotationId')) { $w[] = 'm.quotationId=?'; $p[] = qp('quotationId'); }
        if (qp('status')) { $w[] = 'm.status=?'; $p[] = strtoupper((string) qp('status')); }
        if (!self::isApprover($a)) { $w[] = 'm.requestedById=?'; $p[] = $a['id']; }
        $s = db()->prepare('SELECT m.*, q.quotationNumber, q.toName, c.companyName, r.name AS requestedBy, v.name AS reviewedBy
            FROM `QuoteMail` m JOIN `Quotation` q ON q.id=m.quotationId LEFT JOIN `Customer` c ON c.id=q.customerId
            LEFT JOIN `User` r ON r.id=m.requestedById LEFT JOIN `User` v ON v.id=m.reviewedById'
            . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY m.createdAt DESC LIMIT 200');
        $s->execute($p);
        $rows = array_map([self::class, 'shape'], $s->fetchAll());
        $pending = self::isApprover($a) ? (int) db()->query("SELECT COUNT(*) FROM `QuoteMail` WHERE status='PENDING'")->fetchColumn() : 0;
        sendSuccess(['mails' => $rows, 'pendingForMe' => $pending, 'canApprove' => self::isApprover($a), 'driver' => Mailer::driver()]);
    }

    // PUT /api/quote-mail/:id
    public function update(string $id): void
    {
        $a = authenticate();
        $m = self::row($id);
        if ($m['status'] === 'SENT') sendError('This mail is already sent.', 409);
        if (!self::isApprover($a) && $m['requestedById'] !== $a['id']) sendError('Access denied.', 403);
        $q = self::quotation($m['quotationId']);
        $d = self::read(request_body() + ['kind' => $m['kind']], $q);
        $st = self::isApprover($a) ? $m['status'] : 'PENDING'; // a rejected mail edited by the requester goes back for approval
        if ($st === 'REJECTED' || $st === 'FAILED') $st = $st === 'FAILED' ? 'FAILED' : 'PENDING';
        db()->prepare('UPDATE `QuoteMail` SET kind=?,toEmails=?,ccEmails=?,subject=?,body=?,attachPdf=?,catalogueIds=?,status=?,updatedAt=? WHERE id=?')
            ->execute([$d['kind'], $d['toEmails'], $d['ccEmails'], $d['subject'], $d['body'], $d['attachPdf'], $d['catalogueIds'], $st, now_sql(), $id]);
        if ($m['status'] === 'REJECTED' && $st === 'PENDING') self::notify(self::approverIds(), $a['id'], '✉ Mail corrected — approve ' . $m['quotationNumber'], 'The rejected mail was changed and sent again for approval.', '/quotations/#mail-approvals');
        sendSuccess(['mail' => self::row($id)], 'Saved');
    }

    // POST /api/quote-mail/:id/approve
    public function approve(string $id): void
    {
        $a = authenticate();
        if (!self::isApprover($a)) sendError('Only a Manager, Admin or the Super Admin can approve quotation mails.', 403);
        $b = request_body();
        if (!empty($b['subject']) || !empty($b['body']) || !empty($b['to'])) { // approver edited before approving
            $m = self::row($id);
            $d = self::read($b + ['kind' => $m['kind']], self::quotation($m['quotationId']));
            db()->prepare('UPDATE `QuoteMail` SET toEmails=?,ccEmails=?,subject=?,body=?,attachPdf=?,catalogueIds=?,updatedAt=? WHERE id=? AND status<>\'SENT\'')
                ->execute([$d['toEmails'], $d['ccEmails'], $d['subject'], $d['body'], $d['attachPdf'], $d['catalogueIds'], now_sql(), $id]);
        }
        $this->doApprove($a, $id);
    }

    private function doApprove(array $a, string $id): void
    {
        $m = self::row($id);
        if ($m['status'] === 'SENT') sendError('This mail is already sent.', 409);
        $q = self::quotation($m['quotationId']);
        $co = $m['company'];
        $prof = PurchaseOrderController::profile($co);
        $from = (string) (env('MAIL_FROM_' . $co) ?: (env('SMTP_USER') ?: ($prof['email'] ?? '')));
        if (!filter_var($from, FILTER_VALIDATE_EMAIL)) sendError("No sender address for $co: add the e-mail on the $co letterhead (Vendors → Purchase orders) or MAIL_FROM_$co in api/.env.", 400);
        $att = []; $size = 0; $links = [];
        if ($m['attachPdf']) {
            $pdf = QuotationController::pdfBytes($q['id']);
            if ($pdf) { $att[] = [$pdf[0], 'application/pdf', $pdf[1]]; $size += strlen($pdf[1]); }
        }
        if ($m['catalogueIds']) {
            $in = implode(',', array_fill(0, count($m['catalogueIds']), '?'));
            $s = db()->prepare("SELECT * FROM `ProductCatalogueFile` WHERE id IN ($in)"); $s->execute($m['catalogueIds']);
            foreach ($s->fetchAll() as $f) {
                if ($f['storedName'] === '' && $f['linkUrl']) { $links[] = $f['title'] . ': ' . $f['linkUrl']; continue; }
                $path = UPLOADS_PATH . '/catalogues/' . basename($f['storedName']);
                if (!is_file($path)) continue;
                $size += filesize($path);
                if ($size > self::MAX_ATTACH) sendError('The attachments are bigger than 20 MB — pick fewer catalogues.', 400);
                $ext = strtolower(pathinfo($f['storedName'], PATHINFO_EXTENSION));
                $name = preg_replace('/[^\w.\- ()]+/u', '_', $f['title'] ?: pathinfo($f['fileName'], PATHINFO_FILENAME)) . '.' . $ext;
                $att[] = [$name, $ext === 'pdf' ? 'application/pdf' : (mime_content_type($path) ?: 'application/octet-stream'), file_get_contents($path)];
            }
        }
        $catLine = '';
        $catNames = array_map(fn($x) => $x[0], array_slice($att, $m['attachPdf'] ? 1 : 0));
        if ($catNames) $catLine .= "\nAlso attached: " . implode(', ', $catNames) . '.';
        if ($links) $catLine .= "\nCatalogues online:\n" . implode("\n", $links);
        $body = $m['body'];
        if ($catLine !== '') {
            $pos = stripos($body, "\nThanks & regards");
            if ($pos === false) $pos = stripos($body, "\nRegards");
            $body = $pos === false ? $body . "\n" . $catLine : rtrim(substr($body, 0, $pos)) . "\n" . $catLine . "\n" . substr($body, $pos);
        }
        $req = null;
        if ($m['requestedById']) { $s = db()->prepare('SELECT email FROM `User` WHERE id=?'); $s->execute([$m['requestedById']]); $req = $s->fetchColumn() ?: null; }
        $res = Mailer::send(['from' => $from, 'fromName' => (string) ($prof['name'] ?? $co), 'replyTo' => $req ?: null,
            'to' => Mailer::list($m['toEmails']), 'cc' => Mailer::list($m['ccEmails'] ?? ''), 'subject' => $m['subject'], 'text' => trim($body), 'attachments' => $att]);
        $st = $res['ok'] ? 'SENT' : 'FAILED';
        db()->prepare('UPDATE `QuoteMail` SET status=?, reviewedById=?, reviewedAt=?, sentAt=?, sendError=?, driver=?, updatedAt=? WHERE id=?')
            ->execute([$st, $a['id'], now_sql(), $res['ok'] ? now_sql() : null, $res['error'] ? mb_substr($res['error'], 0, 500) : null, $res['driver'], now_sql(), $id]);
        log_activity($a['id'], $res['ok'] ? 'QUOTE_MAIL_SENT' : 'QUOTE_MAIL_FAILED', 'Quotation', $q['id'], ['mailId' => $id, 'error' => $res['error']]);
        if ($m['requestedById'] && $m['requestedById'] !== $a['id'])
            self::notify([$m['requestedById']], $a['id'], $res['ok'] ? '✅ Quotation mail sent — ' . $m['quotationNumber'] : '⚠ Quotation mail approved but not sent — ' . $m['quotationNumber'],
                $res['ok'] ? 'Approved by ' . ($a['name'] ?? 'the approver') . ' and e-mailed to ' . $m['toEmails'] . '.' : (string) $res['error'], '/quotations/');
        if (!$res['ok']) sendError('Approved, but the e-mail could not be sent: ' . $res['error'], 502, ['mail' => self::row($id)]);
        sendSuccess(['mail' => self::row($id)], 'Approved and e-mailed to ' . $m['toEmails']);
    }

    // POST /api/quote-mail/:id/reject
    public function reject(string $id): void
    {
        $a = authenticate();
        if (!self::isApprover($a)) sendError('Only a Manager, Admin or the Super Admin can reject quotation mails.', 403);
        $m = self::row($id);
        if ($m['status'] === 'SENT') sendError('This mail is already sent.', 409);
        $note = trim((string) (request_body()['note'] ?? ''));
        if ($note === '') sendError('Write what should be corrected.', 400);
        db()->prepare("UPDATE `QuoteMail` SET status='REJECTED', reviewedById=?, reviewedAt=?, reviewNote=?, updatedAt=? WHERE id=?")->execute([$a['id'], now_sql(), mb_substr($note, 0, 500), now_sql(), $id]);
        self::notify([$m['requestedById']], $a['id'], '✖ Quotation mail not approved — ' . $m['quotationNumber'], $note, '/quotations/');
        sendSuccess(['mail' => self::row($id)], 'Sent back with your note');
    }

    public function getTemplates(): void
    {
        $a = authenticate();
        if (!self::isApprover($a)) sendError('Access denied.', 403);
        sendSuccess(['templates' => self::templates(), 'placeholders' => ['{attn}', '{quotationSubject}', '{COMPANY}', '{customer}', '{company}', '{quotationNo}', '{date}', '{enquiryRef}', '{subjectLine}', '{total}', '{validity}', '{catalogueLine}', '{signName}', '{signDesignation}', '{companyPhone}', '{companyEmail}']]);
    }

    public function saveTemplate(): void
    {
        $a = authenticate();
        if (!self::isApprover($a)) sendError('Only a Manager, Admin or the Super Admin can change the standard wording.', 403);
        $b = request_body();
        $co = strtoupper((string) ($b['company'] ?? '')); $k = strtoupper((string) ($b['kind'] ?? ''));
        if (!in_array($co, ['TMS', 'APJ'], true) || !isset(self::KINDS[$k])) sendError('Pick the company and the kind.', 400);
        $s = db()->prepare("SELECT v FROM `AppSetting` WHERE k='qmail-tpl'"); $s->execute();
        $all = json_decode((string) $s->fetchColumn(), true) ?: [];
        $all[$co][$k] = ['subject' => mb_substr(trim((string) ($b['subject'] ?? '')), 0, 300), 'body' => trim(str_replace("\r", '', (string) ($b['body'] ?? '')))];
        if ($all[$co][$k]['body'] === '') unset($all[$co][$k]);
        db()->prepare("INSERT INTO `AppSetting` (k,v,updatedById,updatedAt) VALUES ('qmail-tpl',?,?,?) ON DUPLICATE KEY UPDATE v=VALUES(v), updatedById=VALUES(updatedById), updatedAt=VALUES(updatedAt)")
            ->execute([json_encode($all), $a['id'], now_sql()]);
        sendSuccess(['templates' => self::templates()], 'Standard wording saved for ' . $co);
    }
}
