<?php
/**
 * Price requests — an engineer asks admin for a price on a product
 * (optionally for a specific customer / quantity, optionally proposing the
 * price they'd like to offer). An Admin / Super Admin approves it with a
 * final price, or rejects it, with an optional note back.
 *
 * Requests are raised for a company with one or more items (each item is a
 * PriceRequest row; a PriceRequestBatch groups them under a request number
 * like PR-2610-0007). Items can be typed in or uploaded from the Excel
 * template (GET /template, POST /parse). Each item carries the product,
 * category, brand, Regular / One-time, quantity, target price, discount and
 * a note; admin answers per item (approved price + discount) or all at once.
 *
 * Anyone signed in can raise one and sees their own; admin-tier (incl.
 * Manager) sees all of them. Responding needs ADMIN or higher, matching who
 * can assign tasks. The requester can withdraw (delete) one while it's
 * still pending; admins can delete any.
 */
class PriceRequestController
{
    private const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
    public const SUPPLY_TYPES = ['REGULAR' => 'Regular', 'ONE_TIME' => 'One time'];
    // Engineers set how urgent each item is; the admin gives price, discount and lead time.
    public const PRIORITIES = ['URGENT' => 'Urgent', 'HIGH' => 'High', 'NORMAL' => 'Normal', 'LOW' => 'Low'];
    private const MAX_ITEMS = 200;

    public function __construct()
    {
        ensure_schema(self::schema(), 'migration_tasks_price_requests.sql');
    }

    /** Kept in sync with database/migration_tasks_price_requests.sql. */
    public static function schema(): array
    {
        $cols = "
  `id`             VARCHAR(30)   NOT NULL,
  `requestedById`  VARCHAR(30)   NOT NULL,
  `customerId`     VARCHAR(30)       NULL,
  `productId`      VARCHAR(30)       NULL,
  `itemCode`       VARCHAR(100)      NULL,
  `productName`    VARCHAR(255)  NOT NULL,
  `quantity`       DECIMAL(14,2)     NULL,
  `listPrice`      DECIMAL(14,2)     NULL,
  `requestedPrice` DECIMAL(14,2)     NULL,
  `notes`          TEXT              NULL,
  `status`         VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  `approvedPrice`  DECIMAL(14,2)     NULL,
  `responseNote`   TEXT              NULL,
  `respondedById`  VARCHAR(30)       NULL,
  `respondedAt`    DATETIME          NULL,
  `createdAt`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `PriceRequest_requestedById_idx` (`requestedById`),
  KEY `PriceRequest_status_idx` (`status`)";
        $fks = ",
  CONSTRAINT `PriceRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE";
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        return [
            'PriceRequest' => [
                'create'   => "CREATE TABLE IF NOT EXISTS `PriceRequest` ($cols$fks\n$tail",
                'fallback' => "CREATE TABLE IF NOT EXISTS `PriceRequest` ($cols\n$tail",
                // Multi-item requests (price requests page)
                'columns'  => [
                    'batchId'          => 'VARCHAR(30) NULL',
                    'category'         => 'VARCHAR(120) NULL',
                    'brand'            => 'VARCHAR(120) NULL',
                    'supplyType'       => 'VARCHAR(10) NULL',
                    'unit'             => 'VARCHAR(20) NULL',
                    'discount'         => 'DECIMAL(6,2) NULL',
                    'approvedDiscount' => 'DECIMAL(6,2) NULL',
                    'sortOrder'        => 'INT NOT NULL DEFAULT 0',
                    'leadTime'         => 'VARCHAR(60) NULL',
                    'expectedDelivery' => 'DATE NULL',
                    'approvedLeadTime' => 'VARCHAR(60) NULL',
                    'revisionCount'    => 'INT NOT NULL DEFAULT 0',
                    'history'          => 'TEXT NULL',
                    'originalItemCode' => 'VARCHAR(255) NULL',
                    'priority'         => 'VARCHAR(10) NULL',
                ],
            ],
            'PriceRequestBatch' => [
                'create' => "CREATE TABLE IF NOT EXISTS `PriceRequestBatch` (
  `id` VARCHAR(30) NOT NULL, `requestNo` VARCHAR(20) NOT NULL, `requestedById` VARCHAR(30) NOT NULL,
  `customerId` VARCHAR(30) NULL, `notes` TEXT NULL, `source` VARCHAR(10) NOT NULL DEFAULT 'FORM',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `PriceRequestBatch_requestNo_key` (`requestNo`), KEY `PriceRequestBatch_by_idx` (`requestedById`)
$tail",
                'columns' => [
                    'lastRemindedAt' => 'DATETIME NULL',
                    'remindCount'    => 'INT NOT NULL DEFAULT 0',
                ],
            ],
        ];
    }

    private const SELECT = 'SELECT r.*, u.name AS requestedByName, u.role AS requestedByRole, a.name AS respondedByName,
                                   c.companyName AS customerName, b.requestNo, b.notes AS batchNotes, b.lastRemindedAt, b.remindCount
                            FROM `PriceRequest` r
                            LEFT JOIN `User` u ON u.id = r.requestedById
                            LEFT JOIN `User` a ON a.id = r.respondedById
                            LEFT JOIN `Customer` c ON c.id = r.customerId
                            LEFT JOIN `PriceRequestBatch` b ON b.id = r.batchId';

    private function fetchRow(string $id): ?array
    {
        $s = db()->prepare(self::SELECT . ' WHERE r.id=? LIMIT 1');
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function money($v): ?float
    {
        return $v === null ? null : (float) $v;
    }

    private function shape(array $r): array
    {
        return [
            'id'             => $r['id'],
            'requestedBy'    => ['id' => $r['requestedById'], 'name' => $r['requestedByName'], 'role' => $r['requestedByRole']],
            'customer'       => $r['customerId'] ? ['id' => $r['customerId'], 'companyName' => $r['customerName']] : null,
            'productId'      => $r['productId'],
            'itemCode'       => $r['itemCode'],
            'productName'    => $r['productName'],
            'quantity'       => self::money($r['quantity']),
            'listPrice'      => self::money($r['listPrice']),
            'requestedPrice' => self::money($r['requestedPrice']),
            'notes'          => $r['notes'],
            'status'         => $r['status'],
            'approvedPrice'  => self::money($r['approvedPrice']),
            'responseNote'   => $r['responseNote'],
            'respondedBy'    => $r['respondedById'] ? ['id' => $r['respondedById'], 'name' => $r['respondedByName']] : null,
            'respondedAt'    => $r['respondedAt'],
            'createdAt'      => $r['createdAt'],
            'batchId'        => $r['batchId'] ?? null,
            'sortOrder'      => (int) ($r['sortOrder'] ?? 0),
            'requestNo'      => $r['requestNo'] ?? null,
            'category'       => $r['category'] ?? null,
            'brand'          => $r['brand'] ?? null,
            'supplyType'     => $r['supplyType'] ?? null,
            'unit'           => $r['unit'] ?? null,
            'discount'       => isset($r['discount']) ? self::money($r['discount']) : null,
            'approvedDiscount' => isset($r['approvedDiscount']) ? self::money($r['approvedDiscount']) : null,
            'leadTime'       => $r['leadTime'] ?? null,
            'expectedDelivery' => $r['expectedDelivery'] ?? null,
            'approvedLeadTime' => $r['approvedLeadTime'] ?? null,
            'revisionCount'  => (int) ($r['revisionCount'] ?? 0),
            'history'        => !empty($r['history']) ? (json_decode($r['history'], true) ?: []) : [],
            'originalItemCode' => $r['originalItemCode'] ?? null,
            'priority'       => $r['priority'] ?? null,
        ];
    }

    /** Positive number or null; halts with 400 on garbage. */
    private static function optionalAmount(array $b, string $key, string $label): ?float
    {
        if (!array_key_exists($key, $b) || $b[$key] === null || $b[$key] === '') return null;
        if (!is_numeric($b[$key]) || (float) $b[$key] < 0) sendError("$label must be a positive number.", 400);
        return (float) $b[$key];
    }

    // GET /api/price-requests?status=PENDING|APPROVED|REJECTED|ALL&mine=1&requestedById=
    public function index(): void
    {
        $auth = authenticate();
        // Scope = whose requests this caller may see (and optionally filters to one engineer).
        $scope = []; $scopeParams = [];
        if (!is_admin_tier($auth['role']) || qp('mine')) {
            $scope[] = 'r.requestedById=?'; $scopeParams[] = $auth['id'];
        } elseif (qp('requestedById')) {
            $scope[] = 'r.requestedById=?'; $scopeParams[] = qp('requestedById');
        }

        $where = $scope; $params = $scopeParams;
        $status = strtoupper((string) qp('status', 'ALL'));
        if ($status !== 'ALL') {
            if (!in_array($status, self::STATUSES, true)) sendError('Unknown status filter.', 400);
            $where[] = 'r.status=?'; $params[] = $status;
        }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $s = db()->prepare(self::SELECT . " $w ORDER BY (r.status='PENDING') DESC, r.createdAt DESC LIMIT 300");
        $s->execute($params);
        $rows = $s->fetchAll();

        // Counts per status within the same scope, for the summary tiles and filter pills.
        $sw = $scope ? 'WHERE ' . implode(' AND ', $scope) : '';
        $c = db()->prepare("SELECT r.status, COUNT(*) AS n FROM `PriceRequest` r $sw GROUP BY r.status");
        $c->execute($scopeParams);
        $counts = ['PENDING' => 0, 'APPROVED' => 0, 'REJECTED' => 0];
        foreach ($c->fetchAll() as $r) {
            $r = array_change_key_case($r, CASE_LOWER);
            if (isset($counts[$r['status']])) $counts[$r['status']] = (int) $r['n'];
        }

        // Badge count for the tab — pending ones this user would act on (admin) or is waiting on (everyone else).
        if (is_admin_tier($auth['role'])) {
            $pc = db()->prepare("SELECT COUNT(*) FROM `PriceRequest` WHERE status='PENDING'");
            $pc->execute();
        } else {
            $pc = db()->prepare("SELECT COUNT(*) FROM `PriceRequest` WHERE status='PENDING' AND requestedById=?");
            $pc->execute([$auth['id']]);
        }

        // Engineers who have raised requests — for the admin's "Requested by" filter.
        $requesters = [];
        if (is_admin_tier($auth['role'])) {
            $rq = db()->query("SELECT DISTINCT u.id, u.name FROM `PriceRequest` r JOIN `User` u ON u.id = r.requestedById ORDER BY u.name");
            $requesters = $rq->fetchAll();
        }

        sendSuccess([
            'requests'     => array_map(fn($r) => $this->shape($r), $rows),
            'pendingCount' => (int) $pc->fetchColumn(),
            'counts'       => $counts,
            'requesters'   => $requesters,
        ]);
    }

    // POST /api/price-requests — body { productId? | productName, customerId?, quantity?, requestedPrice?, notes? }
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();

        $productId = trim((string) ($b['productId'] ?? ''));
        $itemCode = null; $listPrice = null;
        if ($productId !== '') {
            $p = db()->prepare('SELECT id,itemCode,productName,standardPrice FROM `Product` WHERE id=? LIMIT 1');
            $p->execute([$productId]);
            $product = $p->fetch();
            if (!$product) sendError('Product not found.', 404);
            $productName = $product['productName'];
            $itemCode = $product['itemCode'];
            $listPrice = $product['standardPrice'] !== null ? (float) $product['standardPrice'] : null;
        } else {
            $productId = null;
            $productName = trim((string) ($b['productName'] ?? ''));
            if ($productName === '') sendError('Please choose a product or describe the item.', 400);
        }

        $customerId = trim((string) ($b['customerId'] ?? ''));
        if ($customerId !== '') {
            $c = db()->prepare('SELECT id FROM `Customer` WHERE id=? LIMIT 1');
            $c->execute([$customerId]);
            if (!$c->fetch()) sendError('Customer not found.', 404);
        } else {
            $customerId = null;
        }

        $id = gen_id();
        db()->prepare(
            'INSERT INTO `PriceRequest` (id,requestedById,customerId,productId,itemCode,productName,quantity,listPrice,requestedPrice,notes,status,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,\'PENDING\',?,?)'
        )->execute([
            $id, $auth['id'], $customerId, $productId, $itemCode, $productName,
            self::optionalAmount($b, 'quantity', 'Quantity'), $listPrice,
            self::optionalAmount($b, 'requestedPrice', 'Requested price'), bp_trim($b, 'notes'), now_sql(), now_sql(),
        ]);

        log_activity($auth['id'], 'PRICE_REQUEST_RAISED', 'PriceRequest', $id, ['product' => $productName]);
        sendSuccess(['request' => $this->shape($this->fetchRow($id))], 'Price request sent', 201);
    }

    // PATCH /api/price-requests/:id/respond (admin) — body { status: APPROVED|REJECTED, approvedPrice?, responseNote? }
    public function respond(string $id): void
    {
        $auth = authenticate();
        require_admin($auth);
        $row = $this->fetchRow($id);
        if (!$row) sendError('Price request not found.', 404);

        $b = request_body();
        $status = strtoupper(trim((string) ($b['status'] ?? '')));
        if (!in_array($status, ['APPROVED', 'REJECTED'], true)) sendError('status must be APPROVED or REJECTED.', 400);
        $approvedPrice = null;
        if ($status === 'APPROVED') {
            $approvedPrice = self::optionalAmount($b, 'approvedPrice', 'Approved price');
            if ($approvedPrice === null) sendError('Please enter the approved price.', 400);
        }
        $note = bp_trim($b, 'responseNote');
        if ($status === 'REJECTED' && !$note) sendError('Please give a reason for rejecting the request.', 400);
        $approvedDiscount = $status === 'APPROVED' ? self::percent($b, 'approvedDiscount', 'Approved discount') : null;

        db()->prepare(
            'UPDATE `PriceRequest` SET status=?,approvedPrice=?,approvedDiscount=?,responseNote=?,respondedById=?,respondedAt=?,updatedAt=? WHERE id=?'
        )->execute([$status, $approvedPrice, $approvedDiscount, $note, $auth['id'], now_sql(), now_sql(), $id]);

        log_activity($auth['id'], 'PRICE_REQUEST_' . $status, 'PriceRequest', $id, ['approvedPrice' => $approvedPrice]);
        sendSuccess(['request' => $this->shape($this->fetchRow($id))], 'Response saved');
    }

    // DELETE /api/price-requests/:id — requester while pending, or admin
    public function delete(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Price request not found.', 404);
        $isAdmin = (ROLE_LEVELS[$auth['role']] ?? 0) >= ROLE_LEVELS['ADMIN'];
        if (!$isAdmin && !($row['requestedById'] === $auth['id'] && $row['status'] === 'PENDING')) {
            sendError('Only a pending request you raised can be withdrawn.', 403);
        }
        db()->prepare('DELETE FROM `PriceRequest` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'PRICE_REQUEST_DELETED', 'PriceRequest', $id, []);
        sendSuccess([], 'Price request removed');
    }

    /** 0–100 or null; halts with 400 on garbage. */
    private static function percent(array $b, string $key, string $label): ?float
    {
        if (!array_key_exists($key, $b) || $b[$key] === null || trim((string) $b[$key]) === '') return null;
        $v = str_replace('%', '', trim((string) $b[$key]));
        if (!is_numeric($v) || (float) $v < 0 || (float) $v > 100) sendError("$label must be a percentage between 0 and 100.", 400);
        return round((float) $v, 2);
    }

    private static function supplyType($v): ?string
    {
        $k = strtoupper(preg_replace('/[\s\-_]+/', '', (string) $v));
        if (in_array($k, ['REGULAR', 'R', 'REPEAT', 'RECURRING'], true)) return 'REGULAR';
        if (in_array($k, ['ONETIME', 'SINGLE', 'SINGLETIME', 'ONCE', 'O', 'S', 'ONEOFF'], true)) return 'ONE_TIME';
        return null;
    }

    private function nextRequestNo(): string
    {
        $prefix = 'PR-' . date('ym') . '-';
        $s = db()->prepare("SELECT requestNo FROM `PriceRequestBatch` WHERE requestNo LIKE ? ORDER BY requestNo DESC LIMIT 1");
        $s->execute([$prefix . '%']);
        $last = $s->fetchColumn();
        $n = $last ? ((int) substr($last, strlen($prefix))) + 1 : 1;
        return $prefix . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    /** Validates one item; returns [clean, errors[]]. Matches the product by id or item code. */
    private function cleanItem(array $it, int $n): array
    {
        $errs = [];
        $label = "Item $n";
        $productId = trim((string) ($it['productId'] ?? ''));
        $code = trim((string) ($it['itemCode'] ?? ''));
        $name = trim((string) ($it['productName'] ?? ''));
        $product = null;
        if ($productId !== '' || $code !== '') {
            $p = db()->prepare('SELECT p.id, p.itemCode, p.productName, p.standardPrice, p.unit, c.name AS cat FROM `Product` p LEFT JOIN `Category` c ON c.id=p.categoryId WHERE ' . ($productId !== '' ? 'p.id=?' : 'p.itemCode=?') . ' LIMIT 1');
            $p->execute([$productId !== '' ? $productId : $code]);
            $product = $p->fetch() ?: null;
            if (!$product && $productId !== '') $errs[] = "$label: product not found";
        }
        if ($product) { $name = $name !== '' ? $name : $product['productName']; $code = $product['itemCode']; }
        if ($name === '') $errs[] = "$label: product name is required";
        $category = trim((string) ($it['category'] ?? '')) ?: ($product['cat'] ?? '');
        if ($category === '') $errs[] = "$label: category is required";
        $brand = trim((string) ($it['brand'] ?? ''));
        if ($brand === '') $errs[] = "$label: brand is required";
        $type = self::supplyType($it['supplyType'] ?? '');
        if (!$type) $errs[] = "$label: choose Regular or One time";
        $qtyRaw = trim((string) ($it['quantity'] ?? ''));
        $qty = is_numeric(str_replace(',', '', $qtyRaw)) ? (float) str_replace(',', '', $qtyRaw) : null;
        if ($qty === null || $qty <= 0) $errs[] = "$label: quantity must be more than 0";
        $priceRaw = str_replace([',', '₹', 'Rs', 'rs', ' '], '', (string) ($it['requestedPrice'] ?? ''));
        $price = null;
        if ($priceRaw === '') $errs[] = "$label: target price is required";
        elseif (!is_numeric($priceRaw) || (float) $priceRaw <= 0) $errs[] = "$label: price must be a number more than 0";
        else $price = round((float) $priceRaw, 2);
        // Priority (engineers no longer give discount, lead time or delivery date — the admin does)
        $prio = self::priority($it['priority'] ?? '');
        if ($prio === false) $errs[] = "$label: priority must be Urgent, High, Normal or Low";
        return [[
            'productId' => $product['id'] ?? null, 'itemCode' => $code ?: null, 'productName' => mb_substr($name, 0, 255),
            'category' => mb_substr($category, 0, 120) ?: null, 'brand' => mb_substr($brand, 0, 120) ?: null, 'supplyType' => $type,
            'quantity' => $qty, 'unit' => mb_substr(trim((string) ($it['unit'] ?? '')) ?: ($product['unit'] ?? ''), 0, 20) ?: null,
            'listPrice' => isset($product['standardPrice']) && $product['standardPrice'] !== null ? (float) $product['standardPrice'] : null,
            'requestedPrice' => $price, 'discount' => null, 'notes' => trim((string) ($it['notes'] ?? '')) ?: null,
            'leadTime' => null, 'expectedDelivery' => null, 'priority' => $prio ?: 'NORMAL',
        ], $errs];
    }

    /** "Urgent" / "high" / "URGENT" → key; blank → NORMAL; anything else → false. */
    private static function priority($v)
    {
        $v = strtoupper(trim((string) $v));
        if ($v === '') return 'NORMAL';
        if (isset(self::PRIORITIES[$v])) return $v;
        foreach (self::PRIORITIES as $k => $l) if (strtoupper($l) === $v) return $k;
        if (in_array($v, ['MEDIUM', 'MED'], true)) return 'NORMAL';
        if (in_array($v, ['CRITICAL', 'ASAP', 'IMMEDIATE'], true)) return 'URGENT';
        return false;
    }

    /** "2026-10-20", "20/10/2026", "20-10-26", Excel serial → Y-m-d, or null. */
    private static function parseDate(string $v): ?string
    {
        $v = trim($v);
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $v, $m)) return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? "$m[1]-$m[2]-$m[3]" : null;
        if (is_numeric($v) && (float) $v > 30000 && (float) $v < 80000) return gmdate('Y-m-d', (int) round(((float) $v - 25569) * 86400));
        if (preg_match('/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/', $v, $m)) {
            $y = strlen($m[3]) === 2 ? 2000 + (int) $m[3] : (int) $m[3];
            return checkdate((int) $m[2], (int) $m[1], $y) ? sprintf('%04d-%02d-%02d', $y, $m[2], $m[1]) : null;
        }
        $t = strtotime($v);
        return $t ? date('Y-m-d', $t) : null;
    }

    // POST /api/price-requests/batch — { customerId, notes?, source?, items:[{productId?|itemCode?, productName, category, brand, supplyType, quantity, unit?, requestedPrice?, discount?, notes?}] }
    public function createBatch(): void
    {
        $auth = authenticate();
        $b = request_body();
        $customerId = trim((string) ($b['customerId'] ?? ''));
        if ($customerId === '') sendError('Please select the company.', 400);
        $c = db()->prepare('SELECT id, companyName FROM `Customer` WHERE id=? LIMIT 1');
        $c->execute([$customerId]);
        $cust = $c->fetch();
        if (!$cust) sendError('Company not found.', 404);
        $items = is_array($b['items'] ?? null) ? array_values($b['items']) : [];
        if (!$items) sendError('Add at least one item.', 400);
        if (count($items) > self::MAX_ITEMS) sendError('At most ' . self::MAX_ITEMS . ' items per request.', 400);
        $clean = []; $errors = [];
        foreach ($items as $i => $it) {
            [$ci, $e] = $this->cleanItem(is_array($it) ? $it : [], $i + 1);
            $clean[] = $ci; $errors = array_merge($errors, $e);
        }
        if ($errors) sendError(implode(' · ', array_slice($errors, 0, 8)) . (count($errors) > 8 ? ' · …' : ''), 400);

        $pdo = db();
        $pdo->beginTransaction();
        try {
            $bid = gen_id();
            $no = $this->nextRequestNo();
            $pdo->prepare('INSERT INTO `PriceRequestBatch` (id, requestNo, requestedById, customerId, notes, source, createdAt) VALUES (?,?,?,?,?,?,?)')
                ->execute([$bid, $no, $auth['id'], $customerId, bp_trim($b, 'notes'), ($b['source'] ?? '') === 'EXCEL' ? 'EXCEL' : 'FORM', now_sql()]);
            $ins = $pdo->prepare('INSERT INTO `PriceRequest` (id,requestedById,customerId,productId,itemCode,productName,quantity,listPrice,requestedPrice,notes,status,
                                  batchId,category,brand,supplyType,unit,discount,leadTime,expectedDelivery,sortOrder,createdAt,updatedAt,priority)
                                  VALUES (?,?,?,?,?,?,?,?,?,?,\'PENDING\',?,?,?,?,?,?,?,?,?,?,?,?)');
            foreach ($clean as $pos => $ci) {
                $ins->execute([gen_id(), $auth['id'], $customerId, $ci['productId'], $ci['itemCode'], $ci['productName'], $ci['quantity'], $ci['listPrice'],
                    $ci['requestedPrice'], $ci['notes'], $bid, $ci['category'], $ci['brand'], $ci['supplyType'], $ci['unit'], $ci['discount'],
                    $ci['leadTime'], $ci['expectedDelivery'], $pos + 1, now_sql(), now_sql(), $ci['priority']]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        log_activity($auth['id'], 'PRICE_REQUEST_RAISED', 'PriceRequestBatch', $bid, ['requestNo' => $no, 'customer' => $cust['companyName'], 'items' => count($clean)]);
        sendSuccess(['batch' => $this->batch($bid)], "Price request $no sent (" . count($clean) . ' item' . (count($clean) === 1 ? '' : 's') . ')', 201);
    }

    /** One request (batch) with its items. Legacy single requests are their own batch, keyed by the row id. */
    private function batch(string $bid): ?array
    {
        $s = db()->prepare(self::SELECT . ' WHERE r.batchId=? OR (r.batchId IS NULL AND r.id=?) ORDER BY r.sortOrder, r.createdAt, r.id');
        $s->execute([$bid, $bid]);
        $rows = $s->fetchAll();
        return $rows ? $this->groupBatches($rows)[0] : null;
    }

    private function groupBatches(array $rows): array
    {
        $out = [];
        foreach ($rows as $r) {
            $key = $r['batchId'] ?: $r['id'];
            if (!isset($out[$key])) {
                $out[$key] = [
                    'id' => $key, 'requestNo' => $r['requestNo'] ?? null, 'legacy' => !$r['batchId'],
                    'customer' => $r['customerId'] ? ['id' => $r['customerId'], 'companyName' => $r['customerName']] : null,
                    'requestedBy' => ['id' => $r['requestedById'], 'name' => $r['requestedByName']],
                    'notes' => $r['batchNotes'] ?? null, 'createdAt' => $r['createdAt'], 'items' => [],
                    'lastRemindedAt' => $r['lastRemindedAt'] ?? null, 'remindCount' => (int) ($r['remindCount'] ?? 0),
                ];
            }
            $out[$key]['items'][] = $this->shape($r);
        }
        foreach ($out as &$bt) {
            $st = array_count_values(array_column($bt['items'], 'status'));
            $bt['counts'] = ['PENDING' => $st['PENDING'] ?? 0, 'APPROVED' => $st['APPROVED'] ?? 0, 'REJECTED' => $st['REJECTED'] ?? 0];
            $bt['status'] = $bt['counts']['PENDING'] ? ($bt['counts']['PENDING'] === count($bt['items']) ? 'PENDING' : 'PARTIAL')
                : ($bt['counts']['REJECTED'] === count($bt['items']) ? 'REJECTED' : ($bt['counts']['APPROVED'] === count($bt['items']) ? 'APPROVED' : 'DONE'));
            $bt['value'] = round(array_sum(array_map(fn($i) => ($i['requestedPrice'] ?? 0) * ($i['quantity'] ?? 0), $bt['items'])), 2);
        }
        unset($bt);
        return array_values($out);
    }

    // GET /api/price-requests/batches?status=OPEN|DONE|ALL&requestedById=&search=
    public function batches(): void
    {
        $auth = authenticate();
        $where = []; $params = [];
        if (!is_admin_tier($auth['role']) || qp('mine')) { $where[] = 'r.requestedById=?'; $params[] = $auth['id']; }
        elseif (qp('requestedById')) { $where[] = 'r.requestedById=?'; $params[] = qp('requestedById'); }
        if (($q = trim((string) qp('search', ''))) !== '') {
            $like = "%$q%";
            $where[] = '(c.companyName LIKE ? OR r.productName LIKE ? OR r.itemCode LIKE ? OR r.brand LIKE ? OR b.requestNo LIKE ?)';
            array_push($params, $like, $like, $like, $like, $like);
        }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        // Newest requests first; a request is "open" while any of its items is pending.
        $s = db()->prepare(self::SELECT . " $w ORDER BY r.createdAt DESC, b.requestNo DESC, r.sortOrder ASC, r.id ASC LIMIT 2000");
        $s->execute($params);
        $all = $this->groupBatches($s->fetchAll());
        foreach ($all as &$bt) usort($bt['items'], fn($x, $y) => [$x['sortOrder'] ?? 0, $x['id']] <=> [$y['sortOrder'] ?? 0, $y['id']]);
        unset($bt);
        $counts = ['OPEN' => 0, 'DONE' => 0];
        foreach ($all as $bt) $counts[$bt['counts']['PENDING'] ? 'OPEN' : 'DONE']++;
        $status = strtoupper((string) qp('status', 'ALL'));
        if ($status === 'OPEN') $all = array_values(array_filter($all, fn($bt) => $bt['counts']['PENDING'] > 0));
        elseif ($status === 'DONE') $all = array_values(array_filter($all, fn($bt) => $bt['counts']['PENDING'] === 0));
        $requesters = [];
        if (is_admin_tier($auth['role'])) $requesters = db()->query("SELECT DISTINCT u.id, u.name FROM `PriceRequest` r JOIN `User` u ON u.id = r.requestedById ORDER BY u.name")->fetchAll();
        sendSuccess(['batches' => array_slice($all, 0, 200), 'counts' => $counts, 'requesters' => $requesters,
                     'canRespond' => (ROLE_LEVELS[$auth['role']] ?? 0) >= ROLE_LEVELS['ADMIN'], 'supplyTypes' => self::SUPPLY_TYPES]);
    }

    // PATCH /api/price-requests/batch/:id/respond (admin) — { items:[{id, status, approvedPrice?, approvedDiscount?, responseNote?}] }
    public function respondBatch(string $bid): void
    {
        $auth = authenticate();
        require_admin($auth);
        $bt = $this->batch($bid);
        if (!$bt) sendError('Price request not found.', 404);
        $ids = array_column($bt['items'], 'id');
        $entries = is_array(request_body()['items'] ?? null) ? request_body()['items'] : [];
        if (!$entries) sendError('Nothing to save.', 400);
        $errs = []; $ok = [];
        foreach ($entries as $e) {
            $id = (string) ($e['id'] ?? '');
            if (!in_array($id, $ids, true)) { $errs[] = 'Unknown item'; continue; }
            $item = array_values(array_filter($bt['items'], fn($i) => $i['id'] === $id))[0];
            $status = strtoupper(trim((string) ($e['status'] ?? '')));
            if (!in_array($status, ['APPROVED', 'REJECTED'], true)) { $errs[] = $item['productName'] . ': choose approve or reject'; continue; }
            $price = null; $disc = null; $note = trim((string) ($e['responseNote'] ?? '')) ?: null;
            if ($status === 'APPROVED') {
                $pr = str_replace(',', '', (string) ($e['approvedPrice'] ?? ''));
                if ($pr === '' || !is_numeric($pr) || (float) $pr < 0) { $errs[] = $item['productName'] . ': enter the approved price'; continue; }
                $price = round((float) $pr, 2);
                $d = str_replace('%', '', (string) ($e['approvedDiscount'] ?? ''));
                if ($d !== '') { if (!is_numeric($d) || (float) $d < 0 || (float) $d > 100) { $errs[] = $item['productName'] . ': discount must be 0–100 %'; continue; } $disc = round((float) $d, 2); }
            } elseif (!$note) { $errs[] = $item['productName'] . ': give a reason for rejecting'; continue; }
            $lt = trim((string) ($e['approvedLeadTime'] ?? '')) ?: ($status === 'APPROVED' ? ($item['leadTime'] ?? null) : null);
            if ($lt !== null && is_numeric($lt)) $lt .= ' days';
            // Admin corrects a wrong product code (and name, if the code is in the product list).
            $fix = null;
            $newCode = strtoupper(trim((string) ($e['correctedCode'] ?? '')));
            if ($newCode !== '' && $newCode !== strtoupper((string) $item['itemCode'])) {
                $ps = db()->prepare('SELECT id, productName FROM `Product` WHERE itemCode=? LIMIT 1'); $ps->execute([$newCode]);
                $prod = $ps->fetch() ?: null;
                $newName = trim((string) ($e['correctedName'] ?? '')) ?: ($prod['productName'] ?? $item['productName']);
                $fix = ['code' => mb_substr($newCode, 0, 100), 'name' => mb_substr($newName, 0, 255), 'productId' => $prod['id'] ?? null, 'old' => $item['itemCode'] ?: $item['productName']];
                $msg = 'Product code corrected: ' . ($item['itemCode'] ?: '(none)') . ' → ' . $newCode;
                $note = $note ? $msg . ' — ' . $note : $msg;
            }
            $ok[] = [$status, $price, $disc, $note, $id, $lt ? mb_substr($lt, 0, 60) : null, $fix];
        }
        if ($errs) sendError(implode(' · ', array_slice($errs, 0, 8)), 400);
        $u = db()->prepare('UPDATE `PriceRequest` SET status=?,approvedPrice=?,approvedDiscount=?,approvedLeadTime=?,responseNote=?,respondedById=?,respondedAt=?,updatedAt=?,history=? WHERE id=?');
        $fixU = db()->prepare('UPDATE `PriceRequest` SET originalItemCode=COALESCE(originalItemCode, itemCode, productName), itemCode=?, productName=?, productId=COALESCE(?, productId) WHERE id=?');
        foreach ($ok as [$st, $pr, $di, $no, $id, $lt, $fix]) {
            if ($fix) $fixU->execute([$fix['code'], $fix['name'], $fix['productId'], $id]);
            $h = $this->historyOf($id);
            if ($fix) $h[] = ['type' => 'CODE_FIX', 'at' => now_sql(), 'by' => $auth['name'], 'from' => $fix['old'], 'to' => $fix['code'], 'note' => $no];
            $h[] = ['type' => 'ANSWER', 'at' => now_sql(), 'by' => $auth['name'], 'status' => $st, 'price' => $pr, 'discount' => $di, 'leadTime' => $lt, 'note' => $no];
            $u->execute([$st, $pr, $di, $lt, $no, $auth['id'], now_sql(), now_sql(), json_encode($h, JSON_UNESCAPED_UNICODE), $id]);
        }
        log_activity($auth['id'], 'PRICE_REQUEST_ANSWERED', 'PriceRequestBatch', $bid, ['items' => count($ok)]);
        sendSuccess(['batch' => $this->batch($bid)], 'Saved ' . count($ok) . ' answer' . (count($ok) === 1 ? '' : 's'));
    }

    // DELETE /api/price-requests/batch/:id — requester while every item is pending, or admin
    public function deleteBatch(string $bid): void
    {
        $auth = authenticate();
        $bt = $this->batch($bid);
        if (!$bt) sendError('Price request not found.', 404);
        $isAdmin = (ROLE_LEVELS[$auth['role']] ?? 0) >= ROLE_LEVELS['ADMIN'];
        if (!$isAdmin && !($bt['requestedBy']['id'] === $auth['id'] && $bt['counts']['PENDING'] === count($bt['items']))) {
            sendError('Only a request you raised, still fully pending, can be withdrawn.', 403);
        }
        db()->prepare('DELETE FROM `PriceRequest` WHERE batchId=? OR (batchId IS NULL AND id=?)')->execute([$bid, $bid]);
        db()->prepare('DELETE FROM `PriceRequestBatch` WHERE id=?')->execute([$bid]);
        log_activity($auth['id'], 'PRICE_REQUEST_DELETED', 'PriceRequestBatch', $bid, ['requestNo' => $bt['requestNo']]);
        sendSuccess([], 'Price request withdrawn');
    }

    private const TEMPLATE_COLS = ['Item Code', 'Product Name *', 'Category *', 'Brand *', 'Regular / One time *', 'Quantity *', 'Unit', 'Target Price (Rs) *', 'Priority (Urgent / High / Normal / Low)', 'Note'];

    // GET /api/price-requests/template
    public function template(): void
    {
        authenticate();
        $wb = new StyledXlsxWriter();
        $sh = $wb->addSheet('Price request items');
        $wb->setWidths($sh, [16, 34, 18, 16, 18, 10, 8, 16, 18, 36]);
        $wb->addRow($sh, self::TEMPLATE_COLS, 'header', 32);
        $wb->addRow($sh, ['CNMG120408-MF', 'CNMG 120408-MF Turning Insert', 'Inserts', 'YG-1', 'Regular', 100, 'PCS', 245, 'High', 'Customer currently buys from competitor at Rs 230']);
        $wb->addRow($sh, ['', 'Special step drill D8.5 x 120', 'Drills', 'YG-1', 'One time', 5, 'PCS', 2850, 'Normal', 'Drawing attached by mail']);
        $wb->freeze($sh, 1);
        $ls = $wb->addSheet('Lists');
        $cats = [];
        try { $cats = array_column(db()->query('SELECT name FROM `Category` ORDER BY name')->fetchAll(), 'name'); } catch (Throwable $e) {}
        $wb->setWidths($ls, [24, 20, 60]);
        $wb->addRow($ls, ['Category (any, these exist)', 'Regular / One time', 'How to fill'], 'header');
        $help = ['Delete the two sample rows, one row per item.', 'Item Code fills the product from your product list (optional).',
                 'Product Name, Category, Brand, Regular / One time, Quantity and Target Price are required.', 'Priority: Urgent, High, Normal or Low (blank = Normal). Discount, lead time and delivery are given by the admin.',
                 'Upload the file on the Price requests page, choose the company, check the items, then Raise request.'];
        $n = max(count($cats), 2, count($help));
        for ($i = 0; $i < $n; $i++) $wb->addRow($ls, [$cats[$i] ?? '', ['Regular', 'One time'][$i] ?? '', $help[$i] ?? '']);
        $bytes = $wb->output();
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="price-request-template.xlsx"');
        echo $bytes;
        exit;
    }

    // POST /api/price-requests/parse — multipart "file" (.xlsx / .csv) → items for the form (nothing is saved)
    public function parse(): void
    {
        authenticate();
        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) sendError('Please choose the filled Excel template (.xlsx or .csv).', 400);
        $f = $_FILES['file'];
        $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
        try {
            if ($ext === 'csv') {
                $rows = [];
                $fh = fopen($f['tmp_name'], 'r');
                while (($r = fgetcsv($fh)) !== false) $rows[] = $r;
                fclose($fh);
                if ($rows && isset($rows[0][0])) $rows[0][0] = preg_replace('/^\xEF\xBB\xBF/', '', $rows[0][0]);
            } elseif ($ext === 'xlsx') {
                $rows = XlsxReader::readFirstSheetRows($f['tmp_name']);
            } else sendError('Upload the template as .xlsx (or .csv).', 400);
        } catch (Throwable $e) { sendError($e->getMessage(), 400); }
        $hIdx = null;
        foreach (array_slice($rows, 0, 10, true) as $i => $r) { if (preg_match('/product/i', implode('|', $r)) && preg_match('/brand/i', implode('|', $r))) { $hIdx = $i; break; } }
        if ($hIdx === null) sendError('Could not find the heading row (Product Name, Brand …). Use the template from "Download template".', 400);
        $alias = ['itemCode' => '/item\s*code|^code|edp/i', 'productName' => '/product|description/i', 'category' => '/categor/i', 'brand' => '/brand|make/i',
                  'supplyType' => '/regular|one\s*time|single|type/i', 'quantity' => '/qty|quantity/i', 'unit' => '/^unit|uom/i',
                  'priority' => '/priority|urgen/i', 'requestedPrice' => '/price|rate/i', 'notes' => '/note|remark/i'];
        $map = [];
        foreach ($rows[$hIdx] as $ci => $h) {
            $h = trim((string) $h);
            foreach ($alias as $k => $re) { if (!isset($map[$k]) && preg_match($re, $h)) { $map[$k] = $ci; break; } }
        }
        if (!isset($map['productName']) && !isset($map['itemCode'])) sendError('The file has no Product Name or Item Code column.', 400);
        $items = []; $problems = [];
        foreach ($rows as $ri => $r) {
            if ($ri <= $hIdx) continue;
            $it = [];
            foreach ($map as $k => $ci) $it[$k] = trim((string) ($r[$ci] ?? ''));
            if (!array_filter($it, fn($v) => $v !== '')) continue;
            [$clean, $errs] = $this->cleanItem($it, $ri + 1);
            // Keep what the file said (for editing) but use matched product data where found.
            $clean['supplyType'] = $clean['supplyType'] ?? ($it['supplyType'] ?? '');
            $clean['row'] = $ri + 1;
            $clean['problems'] = array_map(fn($e) => preg_replace('/^Item (\d+)/', 'Row $1', $e), $errs);
            $items[] = $clean;
            foreach ($clean['problems'] as $p) $problems[] = $p;
        }
        if (!$items) sendError('No item rows found under the heading row.', 400);
        if (count($items) > self::MAX_ITEMS) sendError('At most ' . self::MAX_ITEMS . ' items per request (file has ' . count($items) . ').', 400);
        sendSuccess(['items' => $items, 'problems' => $problems], count($items) . ' item' . (count($items) === 1 ? '' : 's') . ' read from the file');
    }

    private function historyOf(string $id): array
    {
        $s = db()->prepare('SELECT history FROM `PriceRequest` WHERE id=?'); $s->execute([$id]);
        $h = $s->fetchColumn();
        return $h ? (json_decode($h, true) ?: []) : [];
    }

    // PATCH /api/price-requests/:id/revise — engineer asks for a revised price after an answer
    // { requestedPrice, discount, leadTime?, expectedDelivery?, note }
    public function revise(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Price request not found.', 404);
        if ($row['requestedById'] !== $auth['id'] && !is_admin_tier($auth['role'])) sendError('Only the engineer who raised it can ask for a revised price.', 403);
        if ($row['status'] === 'PENDING') sendError('This item is still waiting for an answer.', 400);
        $b = request_body();
        $price = str_replace([',', '₹', ' '], '', (string) ($b['requestedPrice'] ?? ''));
        if ($price === '' || !is_numeric($price) || (float) $price <= 0) sendError('Enter the revised price you need.', 400);
        $disc = null; // the admin gives the discount
        $note = trim((string) ($b['note'] ?? ''));
        if ($note === '') sendError('Say why a revised price is needed (e.g. competitor price, customer counter-offer).', 400);
        $lead = trim((string) ($b['leadTime'] ?? '')) ?: $row['leadTime'];
        if ($lead !== null && is_numeric($lead)) $lead .= ' days';
        $ed = isset($b['expectedDelivery']) && trim((string) $b['expectedDelivery']) !== '' ? self::parseDate((string) $b['expectedDelivery']) : $row['expectedDelivery'];
        $h = $row['history'] ? (json_decode($row['history'], true) ?: []) : [];
        // First revision: put the original ask (and the answer, if it predates history) at the start.
        $types = array_column($h, 'type');
        if (!in_array('REQUEST', $types, true)) {
            if (!in_array('ANSWER', $types, true) && $row['respondedAt']) {
                array_unshift($h, ['type' => 'ANSWER', 'at' => $row['respondedAt'], 'by' => $row['respondedByName'], 'status' => $row['status'], 'price' => $row['approvedPrice'] === null ? null : (float) $row['approvedPrice'], 'discount' => $row['approvedDiscount'] === null ? null : (float) $row['approvedDiscount'], 'leadTime' => $row['approvedLeadTime'], 'note' => $row['responseNote']]);
            }
            array_unshift($h, ['type' => 'REQUEST', 'at' => $row['createdAt'], 'by' => $row['requestedByName'], 'price' => (float) $row['requestedPrice'], 'discount' => $row['discount'] === null ? null : (float) $row['discount'], 'leadTime' => $row['leadTime'], 'note' => $row['notes']]);
        }
        $h[] = ['type' => 'REVISION', 'at' => now_sql(), 'by' => $auth['name'], 'price' => round((float) $price, 2), 'discount' => null, 'leadTime' => $lead, 'note' => $note];
        db()->prepare('UPDATE `PriceRequest` SET status=\'PENDING\', requestedPrice=?, discount=?, leadTime=?, expectedDelivery=?, approvedPrice=NULL, approvedDiscount=NULL, approvedLeadTime=NULL,
                       responseNote=NULL, respondedById=NULL, respondedAt=NULL, revisionCount=revisionCount+1, history=?, createdAt=?, updatedAt=? WHERE id=?')
            ->execute([round((float) $price, 2), round((float) $disc, 2), $lead, $ed, json_encode($h, JSON_UNESCAPED_UNICODE), now_sql(), now_sql(), $id]);
        log_activity($auth['id'], 'PRICE_REQUEST_REVISED', 'PriceRequest', $id, ['price' => (float) $price]);
        sendSuccess(['request' => $this->shape($this->fetchRow($id))], 'Revised price request sent');
    }

    // POST /api/price-requests/batch/:id/remind — requester nudges the admins (at most every 2 hours)
    public function remind(string $bid): void
    {
        $auth = authenticate();
        $bt = $this->batch($bid);
        if (!$bt) sendError('Price request not found.', 404);
        if ($bt['requestedBy']['id'] !== $auth['id']) sendError('Only the engineer who raised it can send a reminder.', 403);
        if (!$bt['counts']['PENDING']) sendError('Nothing in this request is waiting for an answer.', 400);
        if ($bt['legacy']) sendError('This older request cannot send reminders — raise it again from the Price requests page.', 400);
        $s = db()->prepare('SELECT lastRemindedAt FROM `PriceRequestBatch` WHERE id=?'); $s->execute([$bid]);
        $last = $s->fetchColumn();
        if ($last && strtotime($last) > time() - 2 * 3600) {
            $mins = (int) ceil((strtotime($last) + 2 * 3600 - time()) / 60);
            sendError('A reminder was sent at ' . date('h:i A', strtotime($last)) . '. You can remind again in ' . ($mins >= 60 ? floor($mins / 60) . ' h ' . ($mins % 60) . ' min' : $mins . ' min') . '.', 429);
        }
        db()->prepare('UPDATE `PriceRequestBatch` SET lastRemindedAt=?, remindCount=remindCount+1 WHERE id=?')->execute([now_sql(), $bid]);
        log_activity($auth['id'], 'PRICE_REQUEST_REMINDER', 'PriceRequestBatch', $bid, ['requestNo' => $bt['requestNo']]);
        sendSuccess(['batch' => $this->batch($bid)], 'Reminder sent to the admins');
    }

    // GET /api/price-requests/by-no/:requestNo — approved items for a quotation
    public function byNumber(string $no): void
    {
        $auth = authenticate();
        $no = strtoupper(trim(urldecode($no)));
        $s = db()->prepare('SELECT id FROM `PriceRequestBatch` WHERE requestNo=?'); $s->execute([$no]);
        $bid = $s->fetchColumn();
        if (!$bid) sendError("Price request $no not found.", 404);
        $bt = $this->batch($bid);
        if (!is_admin_tier($auth['role']) && $bt['requestedBy']['id'] !== $auth['id']) sendError("Price request $no was raised by someone else.", 403);
        $approved = array_values(array_filter($bt['items'], fn($i) => $i['status'] === 'APPROVED'));
        if (!$approved) sendError("Price request $no has no approved items yet.", 400);
        $c = null;
        if ($bt['customer']) {
            $q = db()->prepare('SELECT id, companyName, address, location, contactPerson FROM `Customer` WHERE id=?'); $q->execute([$bt['customer']['id']]);
            $c = $q->fetch() ?: null;
        }
        sendSuccess(['requestNo' => $bt['requestNo'], 'customer' => $c, 'items' => $approved,
                     'pending' => $bt['counts']['PENDING'], 'rejected' => $bt['counts']['REJECTED']]);
    }
}
