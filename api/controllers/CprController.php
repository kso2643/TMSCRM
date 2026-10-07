<?php
/**
 * CPR — the customer opportunity register ("Master CPR" Excel) as forms,
 * plus the Saturday weekly review and the weekly / monthly reports.
 *
 *   GET    /api/cpr/meta              dropdown lists + sales engineers
 *   GET    /api/cpr                   register (filters: seId,status,rag,cpr,productGroup,search,page,limit)
 *   GET    /api/cpr/:id               one opportunity + its review history
 *   POST   /api/cpr                   add      PUT /api/cpr/:id  edit      DELETE /api/cpr/:id  remove
 *   GET    /api/cpr/review?date=      review sheet for that review date (default: this week's Saturday)
 *   POST   /api/cpr/review            {date, entries:[{opportunityId, remark, status, rag, expectedSale, orderValue, timeline}]}
 *   GET    /api/cpr/review-dates      review dates held, with counts
 *   GET    /api/cpr/report?period=week|month&date=YYYY-MM-DD[&seId=]   Excel in the Master CPR layout
 *   GET    /api/cpr/template          empty CPR Excel to fill in
 *   POST   /api/cpr/import            upload a CPR Excel (multipart "file"); "Remarks as on dd.mm.yyyy"
 *                                     columns become dated review entries. Re-importing updates, never duplicates.
 *
 * Sales engineers see and review their own opportunities; Manager / Admin /
 * Super Admin see everyone's. Money columns are in Rs lakhs, as in the sheet.
 */
class CprController
{
    public const CHANNELS = ['Channel', 'Direct'];
    public const PRODUCT_GROUPS = ['Endmills_SC', 'Endmills_HSS', 'Drills_SC', 'Drills_HSS', 'Taps_Hand', 'Taps_Machine', 'Turning Inserts',
        'Milling_Indexable', 'Drilling_Indexable', 'Systems', 'Others'];
    // Focus product: pick one, or "Other" and type it (any text is kept).
    public const FOCUS_GROUPS = ['Hi feed', 'Ceramic', 'CBN', 'Tap', 'EndMill', 'Other'];
    public const CPR = ['C', 'P', 'R'];
    public const STATUSES = ['Trial underway', 'Trial planned', 'Order awaited', 'Order received', 'Trial failed', 'Parked'];
    public const RAG = ['Red', 'Yellow', 'Green'];
    public const MATERIALS = ['Steel', 'Stainless Steel', 'Cast Iron', 'Non-Ferrous', 'Super Alloy', 'Hardened Steel'];

    /** field => [Excel heading, width] — the Master CPR column order (A..W). */
    private const COLUMNS = [
        'slNo'              => ['Sl.No.', 6],
        'region'            => ['Region & City', 14],
        'seName'            => ['SE', 11],
        'channel'           => ["Channel or \nDirect", 9],
        'distributor'       => ['Distributor', 12],
        'customerName'      => ['Customer', 28],
        'materialGroup'     => ['Material group', 11],
        'materialSubGroup'  => ["Material sub-group\n(For ex. C45, SS304, FCD700 etc)", 16],
        'capturedDate'      => ['Opportunity captured/ mapped date', 12],
        'component'         => ['Component', 16],
        'opportunity'       => ['Opportunity', 30],
        'edp'               => ['EDP', 14],
        'productGroup'      => ['Product Group', 14],
        'focusBrand'        => ["Focus brand\n(Select from the drop down list)", 13],
        'focusGroup'        => ["Focus product\n(Select from the drop down list)", 14],
        'cpr'               => ['C/P/R', 6],
        'annualPotential'   => ['Annual Potential of the Opportunity in Lacs', 12],
        'objective'         => ['Objective', 30],
        'competition'       => ['Competition', 14],
        'personResponsible' => ['Person responsible', 12],
        'timeline'          => ['Time Line', 12],
        'expectedSale'      => ['Expected annual Sale in Rs Lacs', 12],
        'orderValue'        => ['If Order Received. Total Value Till date in Lakhs', 12],
        'status'            => ["Status of the Opportunity\n(Select from the drop down list)", 14],
        'rag'               => ['Status Red/Yellow/Green', 9],
    ];
    private const NUM = ['annualPotential', 'expectedSale', 'orderValue'];
    private const DATES = ['capturedDate', 'timeline'];

    public function __construct()
    {
        ensure_schema([
            'CprOpportunity' => [
                'create' => "CREATE TABLE IF NOT EXISTS `CprOpportunity` (
                    `id` VARCHAR(30) NOT NULL, `slNo` INT NOT NULL AUTO_INCREMENT,
                    `region` VARCHAR(120) NULL, `seId` VARCHAR(30) NULL, `seName` VARCHAR(120) NULL,
                    `channel` VARCHAR(20) NULL, `distributor` VARCHAR(150) NULL,
                    `customerId` VARCHAR(30) NULL, `customerName` VARCHAR(255) NOT NULL,
                    `materialGroup` VARCHAR(80) NULL, `materialSubGroup` VARCHAR(150) NULL, `capturedDate` DATE NULL,
                    `component` VARCHAR(200) NULL, `opportunity` TEXT NULL, `edp` VARCHAR(100) NULL,
                    `productGroup` VARCHAR(80) NULL, `focusGroup` VARCHAR(80) NULL, `cpr` VARCHAR(1) NULL,
                    `annualPotential` DECIMAL(14,4) NULL, `objective` TEXT NULL, `competition` VARCHAR(200) NULL,
                    `personResponsible` VARCHAR(120) NULL, `timeline` DATE NULL,
                    `expectedSale` DECIMAL(14,4) NULL, `orderValue` DECIMAL(14,4) NULL,
                    `status` VARCHAR(40) NOT NULL DEFAULT 'Trial planned', `rag` VARCHAR(10) NULL,
                    `latestRemark` TEXT NULL, `lastReviewDate` DATE NULL, `importKey` VARCHAR(64) NULL,
                    `isActive` TINYINT(1) NOT NULL DEFAULT 1,
                    `createdById` VARCHAR(30) NULL, `updatedById` VARCHAR(30) NULL,
                    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`), UNIQUE KEY `CprOpportunity_slNo_key` (`slNo`), UNIQUE KEY `CprOpportunity_importKey_key` (`importKey`),
                    KEY `CprOpportunity_seId_idx` (`seId`), KEY `CprOpportunity_status_idx` (`status`), KEY `CprOpportunity_customerId_idx` (`customerId`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            ],
            'CprReview' => [
                'create' => "CREATE TABLE IF NOT EXISTS `CprReview` (
                    `id` VARCHAR(30) NOT NULL, `opportunityId` VARCHAR(30) NOT NULL, `reviewDate` DATE NOT NULL,
                    `remark` TEXT NULL, `status` VARCHAR(40) NULL, `prevStatus` VARCHAR(40) NULL, `rag` VARCHAR(10) NULL,
                    `expectedSale` DECIMAL(14,4) NULL, `orderValue` DECIMAL(14,4) NULL, `timeline` DATE NULL,
                    `reviewedById` VARCHAR(30) NULL,
                    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`), UNIQUE KEY `CprReview_opp_date_key` (`opportunityId`, `reviewDate`),
                    KEY `CprReview_date_idx` (`reviewDate`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            ],
        ], 'migration_cpr.sql');
        ensure_schema(['CprOpportunity' => ['create' => '', 'columns' => ['focusBrand' => 'VARCHAR(80) NULL']]], 'CPR focus brand');
    }

    /** Brands for the Focus brand dropdown: stock + products + already used, no duplicates (case-insensitive). */
    private function focusBrands(): array
    {
        $all = [];
        foreach (["SELECT DISTINCT brand FROM `Stock` WHERE brand IS NOT NULL AND brand<>''",
                  "SELECT DISTINCT brand FROM `Product` WHERE brand IS NOT NULL AND brand<>''",
                  "SELECT DISTINCT focusBrand FROM `CprOpportunity` WHERE focusBrand IS NOT NULL AND focusBrand<>''"] as $q) {
            try { foreach (db()->query($q)->fetchAll(PDO::FETCH_COLUMN) as $b) { $k = strtolower(trim($b)); if ($k !== '' && !isset($all[$k])) $all[$k] = trim($b); } }
            catch (Throwable $e) {}
        }
        natcasesort($all);
        return array_values($all);
    }

    /* ───────────────────────── helpers ───────────────────────── */

    private function isAdmin(array $auth): bool { return is_admin_tier($auth['role']); }

    /** WHERE fragment limiting rows to what this user may see. */
    private function scope(array $auth, array &$params, string $alias = 'o'): string
    {
        $w = "$alias.isActive=1";
        if (!$this->isAdmin($auth)) {
            $w .= " AND ($alias.seId=? OR $alias.createdById=?)";
            $params[] = $auth['id']; $params[] = $auth['id'];
        } elseif (($se = qp('seId', '')) !== '') {
            $w .= " AND $alias.seId=?"; $params[] = $se;
        }
        return $w;
    }

    private function canEdit(array $auth, array $row): bool
    {
        return $this->isAdmin($auth) || $row['seId'] === $auth['id'] || $row['createdById'] === $auth['id'];
    }

    private function find(string $id): array
    {
        $s = db()->prepare('SELECT * FROM `CprOpportunity` WHERE id=? AND isActive=1');
        $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) sendError('Opportunity not found.', 404);
        return $r;
    }

    private function shape(array $r): array
    {
        foreach (self::NUM as $k) $r[$k] = $r[$k] === null ? null : (float) $r[$k];
        $r['slNo'] = (int) $r['slNo'];
        $r['isActive'] = (bool) $r['isActive'];
        return $r;
    }

    private static function num($v): ?float
    {
        if ($v === null) return null;
        $v = str_replace([',', ' ', 'Rs', '₹'], '', trim((string) $v));
        return ($v !== '' && is_numeric($v)) ? round((float) $v, 4) : null;
    }

    private static function date($v): ?string
    {
        $v = trim((string) ($v ?? ''));
        if ($v === '') return null;
        if (preg_match('/^\d{4}-\d{2}-\d{2}/', $v)) return substr($v, 0, 10);
        if (is_numeric($v) && (float) $v > 20000 && (float) $v < 80000) return gmdate('Y-m-d', (int) round(((float) $v - 25569) * 86400)); // Excel serial
        if (preg_match('/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/', $v, $m)) {
            $y = strlen($m[3]) === 2 ? 2000 + (int) $m[3] : (int) $m[3];
            if (checkdate((int) $m[2], (int) $m[1], $y)) return sprintf('%04d-%02d-%02d', $y, $m[2], $m[1]);
        }
        $t = strtotime($v);
        return $t ? date('Y-m-d', $t) : null;
    }

    /** Matches $v to a list value ignoring case/spaces/underscores; unknown values are kept as typed. */
    private static function pick(?string $v, array $list): ?string
    {
        $v = trim((string) $v);
        if ($v === '') return null;
        $norm = fn($s) => strtolower(preg_replace('/[\s_\-]+/', '', $s));
        foreach ($list as $opt) if ($norm($opt) === $norm($v)) return $opt;
        return $v;
    }

    /** Saturday of the week (Sun..Sat) containing $ymd. */
    public static function weekSaturday(string $ymd): string
    {
        $t = strtotime($ymd);
        return date('Y-m-d', strtotime('+' . (6 - (int) date('w', $t)) . ' days', $t));
    }

    private function salesUsers(): array
    {
        return db()->query("SELECT id, name, role FROM `User` WHERE isActive=1 ORDER BY name")->fetchAll();
    }

    /** Values from a request body, cleaned and validated. */
    private function fields(array $b, bool $partial): array
    {
        $out = [];
        $text = ['focusBrand' => 80, 'region' => 120, 'seName' => 120, 'distributor' => 150, 'customerName' => 255, 'materialSubGroup' => 150,
                 'component' => 200, 'opportunity' => 5000, 'edp' => 100, 'objective' => 5000, 'competition' => 200,
                 'personResponsible' => 120, 'latestRemark' => 5000];
        foreach ($text as $k => $max) if (array_key_exists($k, $b)) { $v = trim((string) $b[$k]); $out[$k] = $v === '' ? null : mb_substr($v, 0, $max); }
        $lists = ['channel' => self::CHANNELS, 'materialGroup' => self::MATERIALS, 'productGroup' => self::PRODUCT_GROUPS,
                  'focusGroup' => self::FOCUS_GROUPS, 'cpr' => self::CPR, 'status' => self::STATUSES, 'rag' => self::RAG];
        foreach ($lists as $k => $l) if (array_key_exists($k, $b)) $out[$k] = self::pick($b[$k], $l);
        foreach (self::NUM as $k) if (array_key_exists($k, $b)) {
            if (trim((string) $b[$k]) !== '' && self::num($b[$k]) === null) sendError(ucfirst(preg_replace('/([A-Z])/', ' $1', $k)) . ' must be a number (Rs lakhs).', 400);
            $out[$k] = self::num($b[$k]);
        }
        foreach (self::DATES as $k) if (array_key_exists($k, $b)) $out[$k] = self::date($b[$k]);
        foreach (['seId', 'customerId'] as $k) if (array_key_exists($k, $b)) $out[$k] = ($b[$k] ?? '') ?: null;
        if (isset($out['cpr']) && $out['cpr'] !== null && !in_array($out['cpr'], self::CPR, true)) sendError('C/P/R must be C, P or R.', 400);
        if (isset($out['rag']) && $out['rag'] !== null && !in_array($out['rag'], self::RAG, true)) sendError('Status colour must be Red, Yellow or Green.', 400);
        if (!$partial || array_key_exists('customerName', $out)) {
            if (empty($out['customerName']) && empty($out['customerId'])) sendError('Customer is required.', 400);
        }
        if (!empty($out['customerId']) && empty($out['customerName'])) {
            $s = db()->prepare('SELECT companyName FROM `Customer` WHERE id=?'); $s->execute([$out['customerId']]);
            $out['customerName'] = $s->fetchColumn() ?: null;
            if (!$out['customerName']) sendError('Customer not found.', 404);
        }
        if (!empty($out['seId']) && empty($out['seName'])) {
            $s = db()->prepare('SELECT name FROM `User` WHERE id=?'); $s->execute([$out['seId']]);
            $out['seName'] = $s->fetchColumn() ?: null;
        }
        return $out;
    }

    /* ───────────────────────── register ───────────────────────── */

    public function meta(): void
    {
        $auth = authenticate();
        sendSuccess([
            'channels' => self::CHANNELS, 'productGroups' => self::PRODUCT_GROUPS, 'focusGroups' => self::FOCUS_GROUPS, 'focusBrands' => $this->focusBrands(),
            'cpr' => self::CPR, 'statuses' => self::STATUSES, 'rag' => self::RAG, 'materials' => self::MATERIALS,
            'users' => $this->salesUsers(), 'canSeeAll' => $this->isAdmin($auth),
            'thisSaturday' => self::weekSaturday(date('Y-m-d')),
        ]);
    }

    public function index(): void
    {
        $auth = authenticate();
        $params = [];
        $w = $this->scope($auth, $params);
        foreach (['status', 'rag', 'cpr', 'productGroup'] as $k) {
            if (($v = qp($k, '')) !== '') { $w .= " AND o.$k=?"; $params[] = $v; }
        }
        if (($q = trim((string) qp('search', ''))) !== '') {
            $like = "%$q%";
            $w .= ' AND (o.customerName LIKE ? OR o.opportunity LIKE ? OR o.edp LIKE ? OR o.component LIKE ? OR o.competition LIKE ? OR o.region LIKE ? OR o.seName LIKE ?)';
            array_push($params, $like, $like, $like, $like, $like, $like, $like);
        }
        if (qp('open', '') === '1') { $w .= " AND o.status NOT IN ('Order received','Parked')"; }
        [$page, $limit, $offset] = paginate(50);
        $s = db()->prepare("SELECT COUNT(*) AS n, COALESCE(SUM(annualPotential),0) AS pot, COALESCE(SUM(expectedSale),0) AS exp, COALESCE(SUM(orderValue),0) AS ord FROM `CprOpportunity` o WHERE $w");
        $s->execute($params);
        $tot = $s->fetch();
        $sort = ['potential' => 'o.annualPotential DESC', 'recent' => 'o.updatedAt DESC', 'customer' => 'o.customerName ASC', 'slno' => 'o.slNo ASC'][qp('sort', 'potential')] ?? 'o.annualPotential DESC';
        $s = db()->prepare("SELECT o.* FROM `CprOpportunity` o WHERE $w ORDER BY $sort, o.slNo ASC LIMIT $limit OFFSET $offset");
        $s->execute($params);
        $items = array_map([$this, 'shape'], $s->fetchAll());
        $p2 = []; $s = db()->prepare("SELECT o.status, COUNT(*) AS n FROM `CprOpportunity` o WHERE " . $this->scope($auth, $p2) . " GROUP BY o.status");
        $s->execute($p2);
        $byStatus = [];
        foreach ($s->fetchAll() as $r) $byStatus[$r['status']] = (int) $r['n'];
        sendSuccess([
            'items' => $items, 'total' => (int) $tot['n'], 'page' => $page, 'limit' => $limit, 'totalPages' => (int) ceil($tot['n'] / max(1, $limit)),
            'totals' => ['annualPotential' => round((float) $tot['pot'], 2), 'expectedSale' => round((float) $tot['exp'], 2), 'orderValue' => round((float) $tot['ord'], 2)],
            'byStatus' => $byStatus,
        ]);
    }

    public function show(string $id): void
    {
        $auth = authenticate();
        $r = $this->find($id);
        if (!$this->isAdmin($auth) && $r['seId'] !== $auth['id'] && $r['createdById'] !== $auth['id']) sendError('Not your opportunity.', 403);
        $s = db()->prepare('SELECT rv.*, u.name AS reviewedByName FROM `CprReview` rv LEFT JOIN `User` u ON u.id=rv.reviewedById WHERE rv.opportunityId=? ORDER BY rv.reviewDate DESC');
        $s->execute([$id]);
        sendSuccess(['opportunity' => $this->shape($r), 'reviews' => $s->fetchAll()]);
    }

    public function create(): void
    {
        $auth = authenticate();
        $f = $this->fields(request_body(), false);
        // A sales engineer's entries are always their own; admins may pick the SE
        // (or leave it blank to make it theirs).
        if (!$this->isAdmin($auth) || (empty($f['seId']) && empty($f['seName']))) {
            $f['seId'] = $auth['id'];
            $f['seName'] = $auth['name'];
        }
        $f['status'] = $f['status'] ?? 'Trial planned';
        $f['capturedDate'] = $f['capturedDate'] ?? date('Y-m-d');
        $f['personResponsible'] = $f['personResponsible'] ?? $f['seName'] ?? null;
        $id = gen_id();
        $cols = array_merge(['id', 'createdById', 'updatedById', 'createdAt', 'updatedAt'], array_keys($f));
        $vals = array_merge([$id, $auth['id'], $auth['id'], now_sql(), now_sql()], array_values($f));
        db()->prepare('INSERT INTO `CprOpportunity` (' . implode(',', array_map(fn($c) => "`$c`", $cols)) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')')->execute($vals);
        log_activity($auth['id'], 'CPR_CREATED', 'CprOpportunity', $id, ['customer' => $f['customerName']]);
        sendSuccess(['opportunity' => $this->shape($this->find($id))], 'Opportunity added', 201);
    }

    public function update(string $id): void
    {
        $auth = authenticate();
        $row = $this->find($id);
        if (!$this->canEdit($auth, $row)) sendError('You can only edit your own opportunities.', 403);
        $f = $this->fields(request_body(), true);
        if (!$this->isAdmin($auth)) { unset($f['seId']); }
        if (!$f) sendError('Nothing to update.', 400);
        $sets = implode(',', array_map(fn($c) => "`$c`=?", array_keys($f)));
        db()->prepare("UPDATE `CprOpportunity` SET $sets, updatedById=?, updatedAt=? WHERE id=?")->execute(array_merge(array_values($f), [$auth['id'], now_sql(), $id]));
        log_activity($auth['id'], 'CPR_UPDATED', 'CprOpportunity', $id, ['fields' => array_keys($f)]);
        sendSuccess(['opportunity' => $this->shape($this->find($id))], 'Opportunity updated');
    }

    public function delete(string $id): void
    {
        $auth = authenticate();
        $row = $this->find($id);
        if (!$this->canEdit($auth, $row)) sendError('You can only remove your own opportunities.', 403);
        db()->prepare('UPDATE `CprOpportunity` SET isActive=0, updatedById=?, updatedAt=? WHERE id=?')->execute([$auth['id'], now_sql(), $id]);
        log_activity($auth['id'], 'CPR_DELETED', 'CprOpportunity', $id, ['customer' => $row['customerName']]);
        sendSuccess([], 'Opportunity removed');
    }

    /* ───────────────────────── weekly review ───────────────────────── */

    public function reviewSheet(): void
    {
        $auth = authenticate();
        $date = self::date(qp('date', '')) ?? self::weekSaturday(date('Y-m-d'));
        $params = [];
        $w = $this->scope($auth, $params);
        $s = db()->prepare("SELECT o.* FROM `CprOpportunity` o WHERE $w ORDER BY o.seName, FIELD(o.status,'Trial underway','Trial planned','Order awaited','Trial failed','Order received','Parked'), o.annualPotential DESC, o.slNo");
        $s->execute($params);
        $opps = array_map([$this, 'shape'], $s->fetchAll());
        $ids = array_column($opps, 'id');
        $this_ = []; $last = [];
        if ($ids) {
            foreach (array_chunk($ids, 500) as $chunk) {
                $in = implode(',', array_fill(0, count($chunk), '?'));
                $q = db()->prepare("SELECT rv.*, u.name AS reviewedByName FROM `CprReview` rv LEFT JOIN `User` u ON u.id=rv.reviewedById WHERE rv.reviewDate=? AND rv.opportunityId IN ($in)");
                $q->execute(array_merge([$date], $chunk));
                foreach ($q->fetchAll() as $r) $this_[$r['opportunityId']] = $r;
                $q = db()->prepare("SELECT rv.* FROM `CprReview` rv JOIN (SELECT opportunityId, MAX(reviewDate) d FROM `CprReview` WHERE reviewDate<? AND opportunityId IN ($in) GROUP BY opportunityId) x
                                     ON x.opportunityId=rv.opportunityId AND x.d=rv.reviewDate");
                $q->execute(array_merge([$date], $chunk));
                foreach ($q->fetchAll() as $r) $last[$r['opportunityId']] = $r;
            }
        }
        foreach ($opps as &$o) { $o['review'] = $this_[$o['id']] ?? null; $o['lastReview'] = $last[$o['id']] ?? null; }
        unset($o);
        sendSuccess(['date' => $date, 'isSaturday' => date('w', strtotime($date)) === '6', 'items' => $opps,
                     'reviewed' => count($this_), 'total' => count($opps)]);
    }

    public function saveReview(): void
    {
        $auth = authenticate();
        $b = request_body();
        $date = self::date($b['date'] ?? '') ?? self::weekSaturday(date('Y-m-d'));
        if ($date > date('Y-m-d', strtotime('+7 days'))) sendError('Review date is too far in the future.', 400);
        $entries = is_array($b['entries'] ?? null) ? $b['entries'] : [];
        if (!$entries) sendError('Nothing to save — enter a remark or update for at least one opportunity.', 400);
        $saved = 0; $errors = [];
        $pdo = db();
        $pdo->beginTransaction();
        try {
            foreach ($entries as $i => $e) {
                $oid = (string) ($e['opportunityId'] ?? '');
                $s = $pdo->prepare('SELECT * FROM `CprOpportunity` WHERE id=? AND isActive=1'); $s->execute([$oid]);
                $o = $s->fetch();
                if (!$o) { $errors[] = "Entry " . ($i + 1) . ': opportunity not found'; continue; }
                if (!$this->canEdit($auth, $o)) { $errors[] = $o['customerName'] . ': not your opportunity'; continue; }
                $remark = trim((string) ($e['remark'] ?? ''));
                $status = array_key_exists('status', $e) ? self::pick($e['status'], self::STATUSES) : $o['status'];
                $rag = array_key_exists('rag', $e) ? self::pick($e['rag'], self::RAG) : $o['rag'];
                if ($rag !== null && !in_array($rag, self::RAG, true)) $rag = null;
                $exp = array_key_exists('expectedSale', $e) ? self::num($e['expectedSale']) : ($o['expectedSale'] === null ? null : (float) $o['expectedSale']);
                $ord = array_key_exists('orderValue', $e) ? self::num($e['orderValue']) : ($o['orderValue'] === null ? null : (float) $o['orderValue']);
                $tl = array_key_exists('timeline', $e) ? self::date($e['timeline']) : $o['timeline'];
                $changed = $status !== $o['status'] || $rag !== $o['rag'] || $tl !== $o['timeline']
                    || $exp !== ($o['expectedSale'] === null ? null : (float) $o['expectedSale']) || $ord !== ($o['orderValue'] === null ? null : (float) $o['orderValue']);
                if ($remark === '' && !$changed) continue;
                $s = $pdo->prepare('SELECT id, prevStatus FROM `CprReview` WHERE opportunityId=? AND reviewDate=?'); $s->execute([$oid, $date]);
                $ex = $s->fetch();
                if ($ex) {
                    $pdo->prepare('UPDATE `CprReview` SET remark=?, status=?, rag=?, expectedSale=?, orderValue=?, timeline=?, reviewedById=?, updatedAt=? WHERE id=?')
                        ->execute([$remark ?: null, $status, $rag, $exp, $ord, $tl, $auth['id'], now_sql(), $ex['id']]);
                } else {
                    $pdo->prepare('INSERT INTO `CprReview` (id, opportunityId, reviewDate, remark, status, prevStatus, rag, expectedSale, orderValue, timeline, reviewedById, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
                        ->execute([gen_id(), $oid, $date, $remark ?: null, $status, $o['status'], $rag, $exp, $ord, $tl, $auth['id'], now_sql(), now_sql()]);
                }
                // The opportunity shows its newest review values.
                if (!$o['lastReviewDate'] || $date >= $o['lastReviewDate']) {
                    $pdo->prepare('UPDATE `CprOpportunity` SET status=?, rag=?, expectedSale=?, orderValue=?, timeline=?, latestRemark=COALESCE(?, latestRemark), lastReviewDate=?, updatedById=?, updatedAt=? WHERE id=?')
                        ->execute([$status, $rag, $exp, $ord, $tl, $remark ?: null, $date, $auth['id'], now_sql(), $oid]);
                }
                $saved++;
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        if ($saved) log_activity($auth['id'], 'CPR_REVIEW_SAVED', 'CprReview', null, ['date' => $date, 'entries' => $saved]);
        sendSuccess(['saved' => $saved, 'errors' => $errors, 'date' => $date], $saved ? "Review saved for $saved opportunit" . ($saved === 1 ? 'y' : 'ies') : 'No changes to save');
    }

    public function reviewDates(): void
    {
        $auth = authenticate();
        $params = [];
        $w = $this->scope($auth, $params);
        $s = db()->prepare("SELECT rv.reviewDate AS date, COUNT(*) AS entries, COUNT(DISTINCT o.seId) AS engineers
                            FROM `CprReview` rv JOIN `CprOpportunity` o ON o.id=rv.opportunityId WHERE $w
                            GROUP BY rv.reviewDate ORDER BY rv.reviewDate DESC LIMIT 60");
        $s->execute($params);
        sendSuccess(['dates' => $s->fetchAll()]);
    }

    /* ───────────────────────── reports ───────────────────────── */

    public function report(): void
    {
        $auth = authenticate();
        $period = qp('period', 'week') === 'month' ? 'month' : 'week';
        $d = self::date(qp('date', '')) ?? date('Y-m-d');
        if ($period === 'week') {
            $to = self::weekSaturday($d);
            $from = date('Y-m-d', strtotime($to . ' -6 days'));
            $label = 'Week ending ' . date('d-M-Y', strtotime($to));
            $file = 'CPR-weekly-' . $to;
        } else {
            $from = date('Y-m-01', strtotime($d));
            $to = date('Y-m-t', strtotime($d));
            $label = date('F Y', strtotime($from));
            $file = 'CPR-monthly-' . date('Y-m', strtotime($from));
        }
        $params = [];
        $w = $this->scope($auth, $params);
        $s = db()->prepare("SELECT o.* FROM `CprOpportunity` o WHERE $w ORDER BY o.seName, o.annualPotential DESC, o.slNo");
        $s->execute($params);
        $opps = array_map([$this, 'shape'], $s->fetchAll());
        $seLabel = '';
        if (($se = qp('seId', '')) !== '' && $this->isAdmin($auth)) {
            $q = db()->prepare('SELECT name FROM `User` WHERE id=?'); $q->execute([$se]); $seLabel = (string) $q->fetchColumn();
            $file .= '-' . preg_replace('/[^A-Za-z0-9]+/', '-', $seLabel);
        } elseif (!$this->isAdmin($auth)) { $seLabel = $auth['name']; }

        // Reviews: every review in the period gets its own "Remarks as on" column
        // (newest first, like the sheet); the weekly report also shows the
        // review before it, for comparison.
        $byOpp = []; $dates = [];
        $ids = array_column($opps, 'id');
        $prevDate = null;
        if ($ids) {
            $p2 = []; $w2 = $this->scope($auth, $p2);
            $q = db()->prepare("SELECT MAX(rv.reviewDate) FROM `CprReview` rv JOIN `CprOpportunity` o ON o.id=rv.opportunityId WHERE $w2 AND rv.reviewDate<?");
            $q->execute(array_merge($p2, [$from]));
            $prevDate = $q->fetchColumn() ?: null;
            $lo = ($period === 'week' && $prevDate) ? $prevDate : $from;
            foreach (array_chunk($ids, 500) as $chunk) {
                $in = implode(',', array_fill(0, count($chunk), '?'));
                $q = db()->prepare("SELECT rv.*, u.name AS reviewer FROM `CprReview` rv LEFT JOIN `User` u ON u.id=rv.reviewedById WHERE rv.reviewDate BETWEEN ? AND ? AND rv.opportunityId IN ($in)");
                $q->execute(array_merge([$lo, $to], $chunk));
                foreach ($q->fetchAll() as $r) { $byOpp[$r['opportunityId']][$r['reviewDate']] = $r; $dates[$r['reviewDate']] = true; }
            }
        }
        $periodDates = array_values(array_filter(array_keys($dates), fn($x) => $x >= $from && $x <= $to));
        rsort($periodDates);
        if ($period === 'week' && !$periodDates) $periodDates = [$to];
        $remarkCols = $periodDates;
        if ($period === 'week' && $prevDate && !in_array($prevDate, $remarkCols, true)) $remarkCols[] = $prevDate;

        $wb = new StyledXlsxWriter();

        /* Sheet 1 — Master CPR (same columns as the Excel) */
        $sh = $wb->addSheet('Master CPR');
        $fields = array_keys(self::COLUMNS);
        $nBase = count($fields);
        $widths = array_column(array_values(self::COLUMNS), 1);
        foreach ($remarkCols as $_) $widths[] = 34;
        $wb->setWidths($sh, $widths);
        $n = count($opps);
        $last = $n + 2;
        $iPot = array_search('annualPotential', $fields); $iExp = array_search('expectedSale', $fields); $iOrd = array_search('orderValue', $fields);
        $top = array_fill(0, $nBase + count($remarkCols), '');
        $top[$iPot - 1] = ['v' => 'Total in Lakhs', 's' => 'totallbl'];
        $top[$iPot] = ['f' => 'SUBTOTAL(9,' . StyledXlsxWriter::col($iPot) . '3:' . StyledXlsxWriter::col($iPot) . max(3, $last) . ')', 's' => 'total'];
        $top[$iExp - 1] = ['v' => 'Total in Lakhs', 's' => 'totallbl'];
        $top[$iExp] = ['f' => 'SUBTOTAL(9,' . StyledXlsxWriter::col($iExp) . '3:' . StyledXlsxWriter::col($iExp) . max(3, $last) . ')', 's' => 'total'];
        $top[$iOrd] = ['f' => 'SUBTOTAL(9,' . StyledXlsxWriter::col($iOrd) . '3:' . StyledXlsxWriter::col($iOrd) . max(3, $last) . ')', 's' => 'total'];
        $top[0] = ['v' => 'CPR · ' . $label . ($seLabel ? ' · ' . $seLabel : ''), 's' => 'bold'];
        $wb->addRow($sh, $top, 'plain', 18);
        $hdr = array_map(fn($c) => $c[0], array_values(self::COLUMNS));
        foreach ($remarkCols as $rd) $hdr[] = 'Remarks as on ' . date('d.m.Y', strtotime($rd));
        $wb->addRow($sh, $hdr, 'header', 48);
        foreach ($opps as $i => $o) {
            $cells = [];
            foreach ($fields as $f) {
                $v = $o[$f];
                if ($f === 'slNo') $cells[] = ['v' => $i + 1, 's' => 'center'];
                elseif (in_array($f, self::NUM, true)) $cells[] = ['v' => $v, 's' => 'num'];
                elseif (in_array($f, self::DATES, true)) $cells[] = ['v' => $v, 't' => 'date', 's' => 'date'];
                elseif ($f === 'rag') $cells[] = ['v' => $v, 's' => $v ? strtolower($v) : 'center'];
                elseif (in_array($f, ['opportunity', 'objective', 'customerName', 'materialSubGroup', 'component'], true)) $cells[] = ['v' => $v, 's' => 'wrap'];
                elseif (in_array($f, ['cpr', 'channel'], true)) $cells[] = ['v' => $v, 's' => 'center'];
                else $cells[] = $v;
            }
            foreach ($remarkCols as $rd) {
                $r = $byOpp[$o['id']][$rd] ?? null;
                $txt = $r ? trim(($r['remark'] ?? '') . (($r['status'] && $r['prevStatus'] && $r['status'] !== $r['prevStatus']) ? "\n[" . $r['prevStatus'] . ' → ' . $r['status'] . ']' : '')) : '';
                $cells[] = ['v' => $txt, 's' => 'wrap'];
            }
            $wb->addRow($sh, $cells);
        }
        $wb->freeze($sh, 2);
        $wb->autoFilter($sh, 'A2:' . StyledXlsxWriter::col(count($hdr) - 1) . max(2, $last));

        /* Sheet 2 — Summary */
        $sm = $wb->addSheet('Summary');
        $wb->setWidths($sm, [30, 14, 16, 16, 16, 14, 10, 10, 10]);
        $wb->addRow($sm, [['v' => ($period === 'week' ? 'CPR weekly review report' : 'CPR monthly report'), 's' => 'title']], 'plain', 22);
        $wb->addRow($sm, [['v' => $label . ' (' . date('d-M-Y', strtotime($from)) . ' to ' . date('d-M-Y', strtotime($to)) . ')' . ($seLabel ? ' · ' . $seLabel : ' · All engineers'), 's' => 'subtitle']], 'plain');
        $wb->addRow($sm, [['v' => 'Generated ' . date('d-M-Y H:i') . ' by ' . $auth['name'], 's' => 'subtitle']], 'plain');
        $wb->addRow($sm, [], 'plain');
        $reviewedIds = [];
        foreach ($byOpp as $oid => $rv) foreach ($rv as $rd => $_) if ($rd >= $from && $rd <= $to) $reviewedIds[$oid] = true;
        $sum = fn($list, $k) => round(array_sum(array_map(fn($o) => (float) ($o[$k] ?? 0), $list)), 2);
        $open = array_filter($opps, fn($o) => !in_array($o['status'], ['Order received', 'Parked'], true));
        $kpis = [
            ['Opportunities in register', count($opps)], ['Open opportunities (not ordered / parked)', count($open)],
            ['Reviewed in this period', count($reviewedIds)], ['Not reviewed in this period', count($opps) - count($reviewedIds)],
            ['Review meetings (dates) in period', count($periodDates)],
            ['Total annual potential (Rs lakhs)', $sum($opps, 'annualPotential')], ['Expected annual sale (Rs lakhs)', $sum($opps, 'expectedSale')],
            ['Order value till date (Rs lakhs)', $sum($opps, 'orderValue')],
        ];
        $wb->addRow($sm, ['Key figures', 'Value'], 'header');
        foreach ($kpis as [$k, $v]) $wb->addRow($sm, [$k, ['v' => $v, 's' => is_float($v) ? 'num' : 'int']]);
        $wb->addRow($sm, [], 'plain');

        $group = function (string $title, callable $key, array $order = []) use ($wb, $sm, $opps, $reviewedIds, $sum) {
            $g = [];
            foreach ($opps as $o) $g[$key($o) ?: '(not set)'][] = $o;
            if ($order) uksort($g, fn($a, $b) => ((array_search($a, $order) === false ? 99 : array_search($a, $order)) <=> (array_search($b, $order) === false ? 99 : array_search($b, $order))) ?: strcmp($a, $b));
            else ksort($g);
            $wb->addRow($sm, [$title, 'Opportunities', 'Potential (L)', 'Expected (L)', 'Order value (L)', 'Reviewed', 'Red', 'Yellow', 'Green'], 'header', 30);
            $tot = [0, 0, 0, 0, 0, 0, 0, 0];
            foreach ($g as $name => $list) {
                $rev = count(array_filter($list, fn($o) => isset($reviewedIds[$o['id']])));
                $rag = fn($c) => count(array_filter($list, fn($o) => $o['rag'] === $c));
                $row = [count($list), $sum($list, 'annualPotential'), $sum($list, 'expectedSale'), $sum($list, 'orderValue'), $rev, $rag('Red'), $rag('Yellow'), $rag('Green')];
                foreach ($row as $i => $v) $tot[$i] += $v;
                $wb->addRow($sm, [$name, ['v' => $row[0], 's' => 'int'], ['v' => $row[1], 's' => 'num'], ['v' => $row[2], 's' => 'num'], ['v' => $row[3], 's' => 'num'],
                    ['v' => $row[4], 's' => 'int'], ['v' => $row[5], 's' => 'int'], ['v' => $row[6], 's' => 'int'], ['v' => $row[7], 's' => 'int']]);
            }
            $wb->addRow($sm, [['v' => 'Total', 's' => 'totallbl'], ['v' => $tot[0], 's' => 'total'], ['v' => round($tot[1], 2), 's' => 'total'], ['v' => round($tot[2], 2), 's' => 'total'],
                ['v' => round($tot[3], 2), 's' => 'total'], ['v' => $tot[4], 's' => 'total'], ['v' => $tot[5], 's' => 'total'], ['v' => $tot[6], 's' => 'total'], ['v' => $tot[7], 's' => 'total']]);
            $wb->addRow($sm, [], 'plain');
        };
        $group('By status', fn($o) => $o['status'], self::STATUSES);
        $group('By sales engineer', fn($o) => $o['seName']);
        $group('By product group', fn($o) => $o['productGroup'], self::PRODUCT_GROUPS);
        $group('By C / P / R', fn($o) => $o['cpr'], self::CPR);

        /* Sheet 3 — This period's review (one line per review entry) */
        $rv = $wb->addSheet($period === 'week' ? 'This week review' : 'Reviews this month');
        $wb->setWidths($rv, [12, 12, 26, 26, 14, 16, 16, 12, 12, 12, 44, 14]);
        $wb->addRow($rv, ['Review date', 'SE', 'Customer', 'Opportunity', 'EDP', 'Status before', 'Status now', 'Colour', 'Expected (L)', 'Order value (L)', 'Remark', 'Updated by'], 'header', 30);
        $oppById = array_column($opps, null, 'id');
        $lines = [];
        foreach ($byOpp as $oid => $list) foreach ($list as $rd => $r) if ($rd >= $from && $rd <= $to && isset($oppById[$oid])) $lines[] = [$rd, $oppById[$oid], $r];
        usort($lines, fn($a, $b) => strcmp($b[0], $a[0]) ?: strcmp((string) $a[1]['seName'], (string) $b[1]['seName']) ?: ($b[1]['annualPotential'] <=> $a[1]['annualPotential']));
        foreach ($lines as [$rd, $o, $r]) {
            $wb->addRow($rv, [['v' => $rd, 't' => 'date', 's' => 'date'], $o['seName'], ['v' => $o['customerName'], 's' => 'wrap'], ['v' => $o['opportunity'], 's' => 'wrap'], $o['edp'],
                $r['prevStatus'], ['v' => $r['status'], 's' => ($r['status'] !== $r['prevStatus'] && $r['prevStatus']) ? 'bold' : 'default'],
                ['v' => $r['rag'], 's' => $r['rag'] ? strtolower($r['rag']) : 'center'],
                ['v' => $r['expectedSale'] === null ? null : (float) $r['expectedSale'], 's' => 'num'], ['v' => $r['orderValue'] === null ? null : (float) $r['orderValue'], 's' => 'num'],
                ['v' => $r['remark'], 's' => 'wrap'], $r['reviewer']]);
        }
        if (!$lines) $wb->addRow($rv, [['v' => 'No review entries in this period yet.', 's' => 'muted']], 'plain');
        $wb->freeze($rv, 1);

        /* Sheet 4 — New opportunities captured in the period */
        $nw = $wb->addSheet('New opportunities');
        $wb->setWidths($nw, [12, 12, 26, 26, 14, 14, 6, 12, 14]);
        $wb->addRow($nw, ['Captured', 'SE', 'Customer', 'Opportunity', 'EDP', 'Product group', 'C/P/R', 'Potential (L)', 'Status'], 'header', 30);
        $newOnes = array_filter($opps, fn($o) => ($o['capturedDate'] && $o['capturedDate'] >= $from && $o['capturedDate'] <= $to));
        foreach ($newOnes as $o) {
            $wb->addRow($nw, [['v' => $o['capturedDate'], 't' => 'date', 's' => 'date'], $o['seName'], ['v' => $o['customerName'], 's' => 'wrap'], ['v' => $o['opportunity'], 's' => 'wrap'],
                $o['edp'], $o['productGroup'], ['v' => $o['cpr'], 's' => 'center'], ['v' => $o['annualPotential'], 's' => 'num'], $o['status']]);
        }
        if (!$newOnes) $wb->addRow($nw, [['v' => 'No new opportunities captured in this period.', 's' => 'muted']], 'plain');

        /* Sheet 5 — List Master (the dropdown lists, as in the sheet) */
        $lm = $wb->addSheet('List Master');
        $lists = [['SE', array_values(array_unique(array_filter(array_column($opps, 'seName'))))], ['Channel Or Direct', self::CHANNELS], ['Product Group', self::PRODUCT_GROUPS],
                  ['Focus product group', self::FOCUS_GROUPS], ['C/P/R', self::CPR], ['Status of the Opportunity', self::STATUSES], ['Status Red/Green/Yellow', self::RAG], ['Material', self::MATERIALS]];
        $wb->setWidths($lm, array_fill(0, count($lists), 22));
        $wb->addRow($lm, array_column($lists, 0), 'header');
        $max = max(array_map(fn($l) => count($l[1]), $lists));
        for ($i = 0; $i < $max; $i++) $wb->addRow($lm, array_map(fn($l) => $l[1][$i] ?? '', $lists));

        log_activity($auth['id'], 'CPR_REPORT', 'CprOpportunity', null, ['period' => $period, 'from' => $from, 'to' => $to]);
        $bytes = $wb->output();
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . $file . '.xlsx"');
        header('Content-Length: ' . strlen($bytes));
        echo $bytes;
        exit;
    }

    public function template(): void
    {
        authenticate();
        $wb = new StyledXlsxWriter();
        $sh = $wb->addSheet('Master CPR');
        $wb->setWidths($sh, array_merge(array_column(array_values(self::COLUMNS), 1), [34]));
        $wb->addRow($sh, ['Fill one row per opportunity. Money columns are in Rs lakhs. Dates as dd.mm.yyyy. Add "Remarks as on dd.mm.yyyy" columns for review remarks.'], 'subtitle');
        $wb->addRow($sh, array_merge(array_map(fn($c) => $c[0], array_values(self::COLUMNS)), ['Remarks as on ' . date('d.m.Y', strtotime(self::weekSaturday(date('Y-m-d'))))]), 'header', 48);
        $wb->freeze($sh, 2);
        $lm = $wb->addSheet('List Master');
        $lists = [['Channel Or Direct', self::CHANNELS], ['Product Group', self::PRODUCT_GROUPS], ['Focus product group', self::FOCUS_GROUPS], ['C/P/R', self::CPR],
                  ['Status of the Opportunity', self::STATUSES], ['Status Red/Green/Yellow', self::RAG], ['Material', self::MATERIALS]];
        $wb->setWidths($lm, array_fill(0, count($lists), 22));
        $wb->addRow($lm, array_column($lists, 0), 'header');
        $max = max(array_map(fn($l) => count($l[1]), $lists));
        for ($i = 0; $i < $max; $i++) $wb->addRow($lm, array_map(fn($l) => $l[1][$i] ?? '', $lists));
        $bytes = $wb->output();
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="CPR-template.xlsx"');
        echo $bytes;
        exit;
    }

    /* ───────────────────────── import ───────────────────────── */

    public function import(): void
    {
        $auth = authenticate();
        require_manager($auth);
        @set_time_limit(300);
        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) sendError('Please choose the CPR Excel file (.xlsx).', 400);
        try {
            $rows = XlsxReader::readFirstSheetRows($_FILES['file']['tmp_name']);
        } catch (Throwable $e) {
            sendError($e->getMessage(), 400);
        }
        // Find the heading row: the one naming Customer and Opportunity.
        $hIdx = null;
        foreach (array_slice($rows, 0, 15, true) as $i => $r) {
            $t = strtolower(implode('|', $r));
            if (strpos($t, 'customer') !== false && strpos($t, 'opportunity') !== false) { $hIdx = $i; break; }
        }
        if ($hIdx === null) sendError('Could not find the heading row (with "Customer" and "Opportunity") in the first sheet.', 400);
        $aliases = [
            'region' => ['region'], 'seName' => ['^se$', 'sales engineer'], 'channel' => ['channel'], 'distributor' => ['distributor'],
            'customerName' => ['^customer'], 'materialSubGroup' => ['material sub'], 'materialGroup' => ['^material group', '^material$'],
            'capturedDate' => ['captured', 'mapped date'], 'component' => ['component'], 'opportunity' => ['^opportunity$'], 'edp' => ['^edp'],
            'focusBrand' => ['focus brand'], 'focusGroup' => ['focus product', 'focus group', '^focus$'], 'productGroup' => ['^product group'], 'cpr' => ['c/p/r', '^cpr'], 'annualPotential' => ['annual potential', 'potential'],
            'objective' => ['objective'], 'competition' => ['competit'], 'personResponsible' => ['responsible'], 'timeline' => ['time line', 'timeline'],
            'expectedSale' => ['expected'], 'orderValue' => ['order received', 'value till', 'order value'], 'rag' => ['red/', 'rag', 'colour', 'color'],
            'status' => ['^status'],
        ];
        $map = []; $remarkCols = [];
        foreach ($rows[$hIdx] as $ci => $h) {
            $h = strtolower(trim(preg_replace('/\s+/', ' ', (string) $h)));
            if ($h === '') continue;
            if (preg_match('/remarks?\s+(as\s+)?on\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/', $h, $m)) { $d = self::date($m[2]); if ($d) $remarkCols[$ci] = $d; continue; }
            foreach ($aliases as $field => $pats) {
                if (isset($map[$field])) continue;
                foreach ($pats as $p) {
                    $re = '/' . str_replace('/', '\/', $p) . '/';
                    if (preg_match($re, $h)) {
                        if ($field === 'status' && preg_match('/red\//', $h)) continue;
                        $map[$field] = $ci; continue 3;
                    }
                }
            }
        }
        if (!isset($map['customerName'])) sendError('The sheet has no Customer column.', 400);

        $users = $this->salesUsers();
        $userByName = [];
        foreach ($users as $u) { $userByName[strtolower(trim($u['name']))] = $u; $first = strtolower(strtok($u['name'], ' ')); $userByName[$first] = $userByName[$first] ?? $u; }
        $custByName = [];
        foreach (db()->query('SELECT id, companyName FROM `Customer`')->fetchAll() as $c) $custByName[self::normName($c['companyName'])] = $c['id'];

        $inserted = 0; $updated = 0; $reviews = 0; $errors = []; $seen = [];
        $pdo = db();
        $pdo->beginTransaction();
        try {
            foreach ($rows as $ri => $r) {
                if ($ri <= $hIdx) continue;
                $get = fn($f) => isset($map[$f]) ? trim((string) ($r[$map[$f]] ?? '')) : '';
                $cust = $get('customerName');
                if ($cust === '') continue;
                $v = [];
                foreach (array_keys(self::COLUMNS) as $f) if ($f !== 'slNo' && isset($map[$f])) $v[$f] = $get($f);
                foreach (self::NUM as $f) if (isset($v[$f])) $v[$f] = self::num($v[$f]);
                foreach (self::DATES as $f) if (isset($v[$f])) $v[$f] = self::date($v[$f]);
                foreach (['channel' => self::CHANNELS, 'materialGroup' => self::MATERIALS, 'productGroup' => self::PRODUCT_GROUPS, 'focusGroup' => self::FOCUS_GROUPS,
                          'cpr' => self::CPR, 'status' => self::STATUSES, 'rag' => self::RAG] as $f => $l) if (isset($v[$f])) $v[$f] = self::pick($v[$f], $l);
                if (isset($v['cpr']) && !in_array($v['cpr'], self::CPR, true)) $v['cpr'] = null;
                if (isset($v['rag']) && !in_array($v['rag'], self::RAG, true)) $v['rag'] = null;
                foreach ($v as $k => $x) if ($x === '') $v[$k] = null;
                $v['customerName'] = mb_substr($cust, 0, 255);
                $v['status'] = $v['status'] ?? 'Trial planned';
                $u = $userByName[strtolower($v['seName'] ?? '')] ?? null;
                $v['seId'] = $u['id'] ?? null;
                $v['customerId'] = $custByName[self::normName($cust)] ?? null;
                // Same row content → same key, so re-importing the sheet updates instead of
                // duplicating. Identical rows within one sheet are numbered so none is merged away.
                $base = strtolower(implode('|', [$cust, $v['seName'] ?? '', $v['component'] ?? '', $v['opportunity'] ?? '', $v['edp'] ?? '', $v['productGroup'] ?? '']));
                $seen[$base] = ($seen[$base] ?? 0) + 1;
                $key = substr(hash('sha256', $base . '#' . $seen[$base]), 0, 64);
                $s = $pdo->prepare('SELECT id, status FROM `CprOpportunity` WHERE importKey=?'); $s->execute([$key]);
                $ex = $s->fetch();
                if ($ex) {
                    $oid = $ex['id'];
                    $sets = implode(',', array_map(fn($c) => "`$c`=?", array_keys($v)));
                    $pdo->prepare("UPDATE `CprOpportunity` SET $sets, isActive=1, updatedById=?, updatedAt=? WHERE id=?")->execute(array_merge(array_values($v), [$auth['id'], now_sql(), $oid]));
                    $updated++;
                } else {
                    $oid = gen_id();
                    $cols = array_merge(['id', 'importKey', 'createdById', 'updatedById', 'createdAt', 'updatedAt'], array_keys($v));
                    $pdo->prepare('INSERT INTO `CprOpportunity` (' . implode(',', array_map(fn($c) => "`$c`", $cols)) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')')
                        ->execute(array_merge([$oid, $key, $auth['id'], $auth['id'], now_sql(), now_sql()], array_values($v)));
                    $inserted++;
                }
                // Remarks columns → dated reviews (oldest first so the newest wins as "latest").
                $rc = $remarkCols; asort($rc);
                foreach ($rc as $ci => $d) {
                    $txt = trim((string) ($r[$ci] ?? ''));
                    if ($txt === '') continue;
                    $pdo->prepare('INSERT INTO `CprReview` (id, opportunityId, reviewDate, remark, status, prevStatus, rag, reviewedById, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)
                                   ON DUPLICATE KEY UPDATE remark=VALUES(remark), updatedAt=VALUES(updatedAt)')
                        ->execute([gen_id(), $oid, $d, $txt, $v['status'], $v['status'], $v['rag'] ?? null, $auth['id'], now_sql(), now_sql()]);
                    $pdo->prepare('UPDATE `CprOpportunity` SET latestRemark=?, lastReviewDate=? WHERE id=? AND (lastReviewDate IS NULL OR lastReviewDate<=?)')->execute([$txt, $d, $oid, $d]);
                    $reviews++;
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            sendError('Import failed and nothing was changed: ' . $e->getMessage(), 400);
        }
        log_activity($auth['id'], 'CPR_IMPORTED', 'CprOpportunity', null, ['inserted' => $inserted, 'updated' => $updated, 'reviews' => $reviews]);
        sendSuccess(['inserted' => $inserted, 'updated' => $updated, 'reviews' => $reviews, 'remarkDates' => array_values($remarkCols), 'errors' => $errors],
            "Imported: $inserted new, $updated updated, $reviews review remarks");
    }

    private static function normName(string $s): string
    {
        return strtolower(preg_replace('/[^a-z0-9]+/i', '', preg_replace('/\b(pvt|private|ltd|limited|india|co|company)\b/i', '', $s)));
    }
}
