<?php
/**
 * Quotation follow-up — where each quotation stands after it is sent, and a
 * notes log of comments, price negotiation and price changes.
 *
 * Follow-up status (Quotation.followStatus): PENDING, PRICE_NEGOTIATION, TRIAL,
 * PO_RECEIVED, COMPARISON, PRICE_CONCERN, CLOSED, OTHER (with free text in
 * followNote). Shown on the MD desk (Quotations tab) and the quotation page.
 *
 * Notes (QuotationNote): kind COMMENT | NEGOTIATION | PRICE_CHANGE | STATUS,
 * optionally for one item (itemCode) with the old and new price.
 *
 * Super Admin / Admin / Manager see every quotation; others see their own.
 * The quotation's engineer and admins can add notes and change the status.
 *
 *   GET   /api/quote-follow?user=&status=&company=&q=      list + counts + people
 *   GET   /api/quote-follow/:id/notes                      quotation, items, notes
 *   POST  /api/quote-follow/:id/notes                      { kind, text, itemCode?, oldPrice?, newPrice? }
 *   PATCH /api/quote-follow/:id/status                     { status, note? }
 */
class QuoteFollowController
{
    public const STATUSES = ['PENDING' => 'Pending', 'PRICE_NEGOTIATION' => 'Price negotiation', 'TRIAL' => 'Trial', 'PO_RECEIVED' => 'PO received',
                             'COMPARISON' => 'Comparison', 'PRICE_CONCERN' => 'Price concern', 'CLOSED' => 'Closed', 'OTHER' => 'Other'];
    public const KINDS = ['COMMENT' => 'Comment', 'NEGOTIATION' => 'Price negotiation', 'PRICE_CHANGE' => 'Price changed', 'STATUS' => 'Status'];

    public static function schema(): array
    {
        return [
            'Quotation' => ['create' => '', 'columns' => [
                'followStatus' => "VARCHAR(20) NOT NULL DEFAULT 'PENDING'", 'followNote' => 'VARCHAR(255) NULL',
                'followUpdatedAt' => 'DATETIME NULL', 'followUpdatedById' => 'VARCHAR(30) NULL',
            ]],
            'QuotationNote' => ['create' => "CREATE TABLE IF NOT EXISTS `QuotationNote` (
  `id` VARCHAR(30) NOT NULL, `quotationId` VARCHAR(30) NOT NULL, `userId` VARCHAR(30) NOT NULL,
  `kind` VARCHAR(14) NOT NULL DEFAULT 'COMMENT', `itemCode` VARCHAR(120) NULL,
  `oldPrice` DECIMAL(14,2) NULL, `newPrice` DECIMAL(14,2) NULL, `status` VARCHAR(20) NULL, `text` TEXT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `QuotationNote_q_idx` (`quotationId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"],
        ];
    }

    public function __construct()
    {
        new QuotationController(); // its columns (priceRequestNo, item notes)
        ensure_schema(self::schema(), 'Quotation follow-up');
    }

    private static function seesAll(array $auth): bool { return is_admin_tier($auth['role']); }

    private static function quote(array $auth, string $id): array
    {
        $s = db()->prepare('SELECT q.*, c.companyName, u.name AS userName, u.role AS userRole FROM `Quotation` q
            LEFT JOIN `Customer` c ON c.id=q.customerId LEFT JOIN `User` u ON u.id=q.userId WHERE q.id=?');
        $s->execute([$id]);
        $q = $s->fetch();
        if (!$q || (!self::seesAll($auth) && $q['userId'] !== $auth['id'])) sendError('Quotation not found.', 404);
        return $q;
    }

    private static function money($v): ?float
    {
        if ($v === null || $v === '') return null;
        $v = str_replace([',', '₹', ' '], '', (string) $v);
        if (!is_numeric($v) || (float) $v < 0) sendError('Prices must be numbers.', 400);
        return round((float) $v, 2);
    }

    private static function shape(array $q): array
    {
        return ['id' => $q['id'], 'quotationNumber' => $q['quotationNumber'], 'company' => $q['company'] ?: 'TMS',
                'customer' => $q['companyName'] ?: $q['toName'], 'user' => ['id' => $q['userId'], 'name' => $q['userName'], 'role' => $q['userRole']],
                'totalAmount' => (float) $q['totalAmount'], 'quotationDate' => $q['quotationDate'] ?: $q['createdAt'], 'createdAt' => $q['createdAt'],
                'followStatus' => $q['followStatus'] ?: 'PENDING', 'followNote' => $q['followNote'], 'followUpdatedAt' => $q['followUpdatedAt'],
                'docStatus' => $q['status'], 'priceRequestNo' => $q['priceRequestNo'] ?? null];
    }

    // GET /api/quote-follow
    public function index(): void
    {
        $auth = authenticate();
        $where = []; $p = [];
        if (!self::seesAll($auth)) { $where[] = 'q.userId=?'; $p[] = $auth['id']; }
        elseif (qp('user')) { $where[] = 'q.userId=?'; $p[] = qp('user'); }
        if (($co = strtoupper((string) qp('company', ''))) !== '' && in_array($co, ['TMS', 'APJ'], true)) { $where[] = 'q.company=?'; $p[] = $co; }
        if (($q = trim((string) qp('q', ''))) !== '') { $where[] = '(q.quotationNumber LIKE ? OR c.companyName LIKE ? OR q.toName LIKE ? OR q.subject LIKE ?)'; array_push($p, "%$q%", "%$q%", "%$q%", "%$q%"); }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        // counts per status (before the status filter)
        $c = db()->prepare("SELECT COALESCE(q.followStatus,'PENDING') st, COUNT(*) n, SUM(q.totalAmount) v FROM `Quotation` q LEFT JOIN `Customer` c ON c.id=q.customerId $w GROUP BY COALESCE(q.followStatus,'PENDING')");
        $c->execute($p);
        $counts = array_fill_keys(array_keys(self::STATUSES), ['n' => 0, 'value' => 0]);
        foreach ($c->fetchAll() as $r) if (isset($counts[$r['st']])) $counts[$r['st']] = ['n' => (int) $r['n'], 'value' => round((float) $r['v'], 2)];
        if (($st = strtoupper((string) qp('status', ''))) !== '' && isset(self::STATUSES[$st])) { $where[] = "COALESCE(q.followStatus,'PENDING')=?"; $p[] = $st; $w = 'WHERE ' . implode(' AND ', $where); }
        $s = db()->prepare("SELECT q.*, c.companyName, u.name AS userName, u.role AS userRole,
                (SELECT COUNT(*) FROM `QuotationNote` n WHERE n.quotationId=q.id) AS noteCount
            FROM `Quotation` q LEFT JOIN `Customer` c ON c.id=q.customerId LEFT JOIN `User` u ON u.id=q.userId
            $w ORDER BY COALESCE(q.followUpdatedAt, q.updatedAt, q.createdAt) DESC LIMIT 500");
        $s->execute($p);
        $rows = $s->fetchAll();
        // latest note per quotation (for the list)
        $last = [];
        if ($rows) {
            $ids = array_column($rows, 'id'); $in = implode(',', array_fill(0, count($ids), '?'));
            $n = db()->prepare("SELECT n.*, u.name AS userName FROM `QuotationNote` n LEFT JOIN `User` u ON u.id=n.userId WHERE n.quotationId IN ($in) ORDER BY n.createdAt");
            $n->execute($ids);
            foreach ($n->fetchAll() as $r) $last[$r['quotationId']] = self::noteShape($r);
        }
        $items = array_map(function ($r) use ($last) { $o = self::shape($r); $o['noteCount'] = (int) $r['noteCount']; $o['lastNote'] = $last[$r['id']] ?? null; return $o; }, $rows);
        $people = self::seesAll($auth) ? db()->query('SELECT DISTINCT u.id, u.name, u.role FROM `Quotation` q JOIN `User` u ON u.id=q.userId ORDER BY u.name')->fetchAll() : [];
        sendSuccess(['items' => $items, 'counts' => $counts, 'people' => $people, 'statuses' => self::STATUSES, 'kinds' => self::KINDS, 'seesAll' => self::seesAll($auth)]);
    }

    private static function noteShape(array $r): array
    {
        return ['id' => $r['id'], 'kind' => $r['kind'], 'itemCode' => $r['itemCode'], 'oldPrice' => $r['oldPrice'] !== null ? (float) $r['oldPrice'] : null,
                'newPrice' => $r['newPrice'] !== null ? (float) $r['newPrice'] : null, 'status' => $r['status'], 'text' => $r['text'],
                'user' => $r['userName'] ?? null, 'userId' => $r['userId'], 'createdAt' => $r['createdAt']];
    }

    private function sendNotes(array $auth, string $id, string $msg = 'OK', int $code = 200): void
    {
        $q = self::quote($auth, $id);
        $it = db()->prepare('SELECT itemCode, productName, quantity, unitPrice, discount, netPrice FROM `QuotationItem` WHERE quotationId=? ORDER BY sortOrder, createdAt');
        $it->execute([$id]);
        $n = db()->prepare('SELECT n.*, u.name AS userName FROM `QuotationNote` n LEFT JOIN `User` u ON u.id=n.userId WHERE n.quotationId=? ORDER BY n.createdAt');
        $n->execute([$id]);
        sendSuccess(['quotation' => self::shape($q), 'items' => array_map(fn($r) => ['itemCode' => $r['itemCode'], 'productName' => $r['productName'], 'quantity' => (float) $r['quantity'],
                        'unitPrice' => (float) $r['unitPrice'], 'discount' => (float) $r['discount'], 'netPrice' => $r['netPrice'] !== null ? (float) $r['netPrice'] : null], $it->fetchAll()),
                     'notes' => array_map([self::class, 'noteShape'], $n->fetchAll()), 'statuses' => self::STATUSES, 'kinds' => self::KINDS], $msg, $code);
    }

    // GET /api/quote-follow/:id/notes
    public function notes(string $id): void
    {
        $this->sendNotes(authenticate(), $id);
    }

    // POST /api/quote-follow/:id/notes
    public function addNote(string $id): void
    {
        $auth = authenticate();
        $q = self::quote($auth, $id);
        $b = request_body();
        $kind = strtoupper((string) ($b['kind'] ?? 'COMMENT'));
        if (!isset(self::KINDS[$kind]) || $kind === 'STATUS') $kind = 'COMMENT';
        $text = trim((string) ($b['text'] ?? ''));
        $old = self::money($b['oldPrice'] ?? null); $new = self::money($b['newPrice'] ?? null);
        $code = mb_substr(trim((string) ($b['itemCode'] ?? '')), 0, 120) ?: null;
        if ($kind !== 'COMMENT' && $new === null) sendError('Enter the ' . ($kind === 'NEGOTIATION' ? 'price the customer asks for / we offered' : 'new price') . '.', 400);
        if ($text === '' && $new === null) sendError('Write the comment.', 400);
        db()->prepare('INSERT INTO `QuotationNote` (id,quotationId,userId,kind,itemCode,oldPrice,newPrice,text,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([gen_id(), $id, $auth['id'], $kind, $code, $old, $new, $text ?: null, now_sql()]);
        // negotiating moves a pending quotation to "Price negotiation"
        if ($kind === 'NEGOTIATION' && ($q['followStatus'] ?: 'PENDING') === 'PENDING')
            db()->prepare("UPDATE `Quotation` SET followStatus='PRICE_NEGOTIATION', followUpdatedAt=?, followUpdatedById=? WHERE id=?")->execute([now_sql(), $auth['id'], $id]);
        else db()->prepare('UPDATE `Quotation` SET followUpdatedAt=? WHERE id=?')->execute([now_sql(), $id]);
        log_activity($auth['id'], 'QUOTATION_NOTE', 'Quotation', $id, ['kind' => $kind, 'item' => $code, 'old' => $old, 'new' => $new]);
        $this->sendNotes($auth, $id, self::KINDS[$kind] . ' saved', 201);
    }

    // PATCH /api/quote-follow/:id/status
    public function setStatus(string $id): void
    {
        $auth = authenticate();
        $q = self::quote($auth, $id);
        $b = request_body();
        $st = strtoupper((string) ($b['status'] ?? ''));
        if (!isset(self::STATUSES[$st])) sendError('Pick the status.', 400);
        $note = mb_substr(trim((string) ($b['note'] ?? '')), 0, 255);
        if ($st === 'OTHER' && $note === '') sendError('Type the status for "Other".', 400);
        db()->prepare('UPDATE `Quotation` SET followStatus=?, followNote=?, followUpdatedAt=?, followUpdatedById=? WHERE id=?')
            ->execute([$st, $st === 'OTHER' ? $note : ($note ?: null), now_sql(), $auth['id'], $id]);
        db()->prepare("INSERT INTO `QuotationNote` (id,quotationId,userId,kind,status,text,createdAt) VALUES (?,?,?,'STATUS',?,?,?)")
            ->execute([gen_id(), $id, $auth['id'], $st, $note ?: null, now_sql()]);
        log_activity($auth['id'], 'QUOTATION_FOLLOW_STATUS', 'Quotation', $id, ['from' => $q['followStatus'], 'to' => $st]);
        $this->sendNotes($auth, $id, 'Status: ' . ($st === 'OTHER' ? $note : self::STATUSES[$st]));
    }
}
