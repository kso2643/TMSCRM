<?php
/**
 * Price requests — an engineer asks admin for a price on a product
 * (optionally for a specific customer / quantity, optionally proposing the
 * price they'd like to offer). An Admin / Super Admin approves it with a
 * final price, or rejects it, with an optional note back.
 *
 * Anyone signed in can raise one and sees their own; admin-tier (incl.
 * Manager) sees all of them. Responding needs ADMIN or higher, matching who
 * can assign tasks. The requester can withdraw (delete) one while it's
 * still pending; admins can delete any.
 */
class PriceRequestController
{
    private const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

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
            ],
        ];
    }

    private const SELECT = 'SELECT r.*, u.name AS requestedByName, u.role AS requestedByRole, a.name AS respondedByName,
                                   c.companyName AS customerName
                            FROM `PriceRequest` r
                            LEFT JOIN `User` u ON u.id = r.requestedById
                            LEFT JOIN `User` a ON a.id = r.respondedById
                            LEFT JOIN `Customer` c ON c.id = r.customerId';

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

        db()->prepare(
            'UPDATE `PriceRequest` SET status=?,approvedPrice=?,responseNote=?,respondedById=?,respondedAt=?,updatedAt=? WHERE id=?'
        )->execute([$status, $approvedPrice, $note, $auth['id'], now_sql(), now_sql(), $id]);

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
}
