<?php
/**
 * Customer Orders — verbal commitments and purchase orders, with delivery
 * tracking. One row (CustomerOrder) per order, with one or more product
 * lines (CustomerOrderItem, mirrors QuotationItem's snapshot-on-the-row
 * shape so an order stays readable even if the Product catalog changes
 * later).
 *
 *   orderType='PO'     → a document is attached (see the document*
 *                        endpoints below).
 *   orderType='VERBAL' → verbalDetails holds what was agreed instead.
 *
 * Every authenticated user can see the full order list (same visibility
 * model as Meetings/Appointments). Creating one self-assigns engineerId
 * unless the caller is admin-tier and explicitly names someone else —
 * these are meant to be self-reported by the engineer who took the order.
 * Editing/deleting requires being the creator or admin-tier.
 */
class OrderController
{
    private const ORDER_TYPES = ['VERBAL', 'PO'];
    private const DELIVERY_STATUSES = ['PENDING', 'DELIVERED', 'PARTIALLY_DELIVERED', 'NOT_DELIVERED'];
    /** Delivery statuses that must carry a reason (stored in notDeliveredReason). */
    private const STATUSES_NEEDING_REASON = ['PARTIALLY_DELIVERED', 'NOT_DELIVERED'];
    /** Has the company ordered this from its own supplier yet? Set by admin-tier only. */
    private const PROCUREMENT_STATUSES = ['NOT_ORDERED', 'ORDERED'];
    /** Has the price / proforma invoice been confirmed with the customer? */
    private const PROFORMA_STATUSES = ['NOT_CONFIRMED', 'CONFIRMED'];

    /** extension => expected real MIME type, checked against the file's actual bytes via finfo. */
    private const ALLOWED_EXTENSIONS = [
        'pdf'  => 'application/pdf',
        'jpg'  => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png'  => 'image/png',
    ];
    private const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

    public function __construct()
    {
        // Safety net for "Internal server error" on /api/orders when one of the
        // orders migrations hasn't been run on the live DB — see SchemaGuard.php.
        ensure_schema(self::schema(), 'migration_orders_all.sql');

        // One-time catch-up for orders that reached Delivered/Partially
        // delivered before autoMarkProcured() existed, so they don't keep
        // showing "Not ordered" next to "Delivered" forever. Matches
        // nothing once existing orders are fixed, so this is a cheap
        // no-op on every request after the first.
        db()->exec(
            "UPDATE `CustomerOrder` SET procurementStatus='ORDERED'
             WHERE procurementStatus='NOT_ORDERED' AND deliveryStatus IN ('DELIVERED','PARTIALLY_DELIVERED')"
        );
        // Same catch-up, now at the line level: any item already ticked
        // supplied before per-item procurement tracking existed.
        db()->exec(
            "UPDATE `CustomerOrderItem` SET procurementStatus='ORDERED'
             WHERE procurementStatus='NOT_ORDERED' AND supplied=1"
        );
    }

    /** Full current shape of the two orders tables — kept in sync with database/migration_orders_all.sql. */
    public static function schema(): array
    {
        $orderCols = "
  `id`                     VARCHAR(30)   NOT NULL,
  `customerId`             VARCHAR(30)   NOT NULL,
  `engineerId`             VARCHAR(30)   NOT NULL,
  `orderType`              VARCHAR(10)   NOT NULL DEFAULT 'VERBAL',
  `poDocumentOriginalName` VARCHAR(255)      NULL,
  `poDocumentStoredName`   VARCHAR(255)      NULL,
  `poDocumentMime`         VARCHAR(100)      NULL,
  `poDocumentSize`         INT               NULL,
  `verbalDetails`          TEXT              NULL,
  `orderDate`              DATE          NOT NULL,
  `deliveryStatus`         VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  `notDeliveredReason`     TEXT              NULL,
  `deliveredDate`          DATE              NULL,
  `notes`                  TEXT              NULL,
  `expectedDeliveryDate`   DATE              NULL,
  `procurementStatus`      VARCHAR(20)   NOT NULL DEFAULT 'NOT_ORDERED',
  `proformaStatus`         VARCHAR(20)   NOT NULL DEFAULT 'NOT_CONFIRMED',
  `createdAt`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `CustomerOrder_customerId_idx` (`customerId`),
  KEY `CustomerOrder_engineerId_idx` (`engineerId`),
  KEY `CustomerOrder_orderDate_idx` (`orderDate`),
  KEY `CustomerOrder_deliveryStatus_idx` (`deliveryStatus`)";
        $orderFks = ",
  CONSTRAINT `CustomerOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CustomerOrder_engineerId_fkey` FOREIGN KEY (`engineerId`) REFERENCES `User` (`id`)     ON DELETE RESTRICT ON UPDATE CASCADE";

        $itemCols = "
  `id`          VARCHAR(30)   NOT NULL,
  `orderId`     VARCHAR(30)   NOT NULL,
  `productId`   VARCHAR(30)       NULL,
  `itemCode`    VARCHAR(100)  NOT NULL,
  `productName` VARCHAR(255)  NOT NULL,
  `unit`        VARCHAR(20)       NULL,
  `category`    VARCHAR(100)      NULL,
  `brand`       VARCHAR(100)      NULL,
  `quantity`    DECIMAL(14,2) NOT NULL,
  `supplied`    TINYINT(1)    NOT NULL DEFAULT 0,
  `suppliedAt`  DATETIME          NULL,
  `procurementStatus`    VARCHAR(20) NOT NULL DEFAULT 'NOT_ORDERED',
  `expectedDeliveryDate` DATE        NULL,
  `createdAt`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `CustomerOrderItem_orderId_idx` (`orderId`),
  KEY `CustomerOrderItem_productId_idx` (`productId`)";
        $itemFks = ",
  CONSTRAINT `CustomerOrderItem_orderId_fkey`   FOREIGN KEY (`orderId`)   REFERENCES `CustomerOrder` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `CustomerOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`)       ON DELETE SET NULL ON UPDATE CASCADE";

        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        return [
            'CustomerOrder' => [
                'create'   => "CREATE TABLE IF NOT EXISTS `CustomerOrder` ($orderCols$orderFks\n$tail",
                'fallback' => "CREATE TABLE IF NOT EXISTS `CustomerOrder` ($orderCols\n$tail",
                // Every column the table should have, not just the ones added
                // after the original CREATE TABLE — a half-pasted migration can
                // leave ANY of these missing, not only the newest ones. Columns
                // that have no sensible retrofit default (customerId, orderDate,
                // ...) go in as NULL-able here even though the fresh-create path
                // above makes them NOT NULL — the app always supplies them on
                // insert either way, and a repair that can fail on existing rows
                // isn't a safety net.
                'columns'  => [
                    'customerId'             => 'VARCHAR(30) NULL',
                    'engineerId'             => 'VARCHAR(30) NULL',
                    'orderType'              => "VARCHAR(10) NOT NULL DEFAULT 'VERBAL'",
                    'poDocumentOriginalName' => 'VARCHAR(255) NULL',
                    'poDocumentStoredName'   => 'VARCHAR(255) NULL',
                    'poDocumentMime'         => 'VARCHAR(100) NULL',
                    'poDocumentSize'         => 'INT NULL',
                    'verbalDetails'          => 'TEXT NULL',
                    'orderDate'              => 'DATE NULL',
                    'deliveryStatus'         => "VARCHAR(20) NOT NULL DEFAULT 'PENDING'",
                    'notDeliveredReason'     => 'TEXT NULL',
                    'deliveredDate'          => 'DATE NULL',
                    'notes'                  => 'TEXT NULL',
                    'expectedDeliveryDate'   => 'DATE NULL',
                    'procurementStatus'      => "VARCHAR(20) NOT NULL DEFAULT 'NOT_ORDERED'",
                    'proformaStatus'         => "VARCHAR(20) NOT NULL DEFAULT 'NOT_CONFIRMED'",
                    'createdAt'              => 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
                    'updatedAt'              => 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
                ],
                // Seen on at least one live DB: a leftover `userId` column +
                // FK from an earlier/abandoned version of this table, never
                // part of this app's schema. Harmless if NULL-able, but if
                // it's NOT NULL with a default that matches no real user
                // (e.g. DEFAULT ''), it silently breaks every single insert
                // with a 1452 FK violation, since this app never sets it.
                'drop_columns' => [
                    'userId' => 'CustomerOrder_userId_fkey',
                    'orderNumber' => 'CustomerOrder_orderNumber_key',
                ],
            ],
            'CustomerOrderItem' => [
                'create'   => "CREATE TABLE IF NOT EXISTS `CustomerOrderItem` ($itemCols$itemFks\n$tail",
                'fallback' => "CREATE TABLE IF NOT EXISTS `CustomerOrderItem` ($itemCols\n$tail",
                'columns'  => [
                    'orderId'     => 'VARCHAR(30) NULL',
                    'productId'   => 'VARCHAR(30) NULL',
                    'itemCode'    => 'VARCHAR(100) NULL',
                    'productName' => 'VARCHAR(255) NULL',
                    'unit'        => 'VARCHAR(20) NULL',
                    'category'    => 'VARCHAR(100) NULL',
                    'brand'       => 'VARCHAR(100) NULL',
                    'quantity'    => 'DECIMAL(14,2) NULL',
                    'supplied'    => 'TINYINT(1) NOT NULL DEFAULT 0',
                    'suppliedAt'  => 'DATETIME NULL',
                    'procurementStatus'    => "VARCHAR(20) NOT NULL DEFAULT 'NOT_ORDERED'",
                    'expectedDeliveryDate' => 'DATE NULL',
                    'createdAt'   => 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
                    // quantity supplied so far (partial supply); NULL on old lines = all or nothing by "supplied"
                    'suppliedQty' => 'DECIMAL(14,2) NULL',
                ],
            ],
        ];
    }

    private function storageDir(): string
    {
        $dir = UPLOADS_PATH . '/orders';
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        return $dir;
    }

    private function fetchRow(string $id): ?array
    {
        $s = db()->prepare(
            'SELECT o.*, c.companyName, c.contactPerson, c.contactNumber,
                    u.name AS engineerName, u.role AS engineerRole
             FROM `CustomerOrder` o
             LEFT JOIN `Customer` c ON c.id = o.customerId
             LEFT JOIN `User` u ON u.id = o.engineerId
             WHERE o.id=? LIMIT 1'
        );
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private function fetchItems(string $orderId): array
    {
        $s = db()->prepare('SELECT * FROM `CustomerOrderItem` WHERE orderId=? ORDER BY createdAt ASC');
        $s->execute([$orderId]);
        return $s->fetchAll();
    }

    private function shape(array $row, ?array $items = null): array
    {
        return [
            'id'                 => $row['id'],
            'customer'           => [
                'id' => $row['customerId'], 'companyName' => $row['companyName'],
                'contactPerson' => $row['contactPerson'], 'contactNumber' => $row['contactNumber'],
            ],
            'engineer'           => ['id' => $row['engineerId'], 'name' => $row['engineerName'], 'role' => $row['engineerRole']],
            'orderType'          => $row['orderType'],
            'poDocument'         => $row['poDocumentStoredName'] ? [
                'originalName' => $row['poDocumentOriginalName'],
                'mime'         => $row['poDocumentMime'],
                'size'         => (int) $row['poDocumentSize'],
                'url'          => "/api/orders/{$row['id']}/document",
            ] : null,
            'verbalDetails'      => $row['verbalDetails'],
            'orderDate'          => $row['orderDate'],
            'deliveryStatus'     => $row['deliveryStatus'],
            'notDeliveredReason' => $row['notDeliveredReason'],
            'deliveredDate'      => $row['deliveredDate'],
            'procurementStatus'  => $row['procurementStatus'],
            'expectedDeliveryDate' => $row['expectedDeliveryDate'],
            'proformaStatus'     => $row['proformaStatus'],
            'notes'              => $row['notes'],
            'items'              => $items !== null ? array_map(fn($i) => [
                'id' => $i['id'], 'productId' => $i['productId'], 'itemCode' => $i['itemCode'],
                'productName' => $i['productName'], 'unit' => $i['unit'], 'category' => $i['category'],
                'brand' => $i['brand'], 'quantity' => (float) $i['quantity'],
                'supplied' => (bool) $i['supplied'], 'suppliedAt' => $i['suppliedAt'],
                'suppliedQty' => self::suppliedQty($i), 'pendingQty' => max(0, round((float) $i['quantity'] - self::suppliedQty($i), 2)),
                'stock' => $i['_stock'] ?? null,
                'procurementStatus' => $i['procurementStatus'], 'expectedDeliveryDate' => $i['expectedDeliveryDate'],
            ], $items) : null,
            'createdAt'          => $row['createdAt'],
            'updatedAt'          => $row['updatedAt'],
        ];
    }

    /** Quantity supplied on a line (old lines only have the supplied tick). */
    private static function suppliedQty(array $i): float
    {
        if ($i['supplied']) return (float) $i['quantity'];
        return isset($i['suppliedQty']) && $i['suppliedQty'] !== null ? (float) $i['suppliedQty'] : 0.0;
    }

    /** Stock per item code: hand / local / state / total and what open orders still need. */
    public static function stockFor(array $codes): array
    {
        $out = [];
        $codes = array_values(array_unique(array_filter(array_map(fn($c) => strtoupper(trim((string) $c)), $codes), fn($c) => $c !== '' && $c !== 'MANUAL')));
        if (!$codes) return $out;
        try {
            StockLedger::ensure();
            $in = implode(',', array_fill(0, count($codes), '?'));
            $s = db()->prepare("SELECT id, itemCode, availableStock, minimumStock FROM `Stock` WHERE isActive=1 AND UPPER(itemCode) IN ($in)");
            $s->execute($codes);
            $rows = $s->fetchAll();
            $lv = StockLedger::levels(array_column($rows, 'id'));
            $res = StockLedger::reserved(array_column($rows, 'id'));
            foreach ($rows as $r) {
                $l = $lv[$r['id']] ?? ['HAND' => 0, 'LOCAL' => 0, 'local' => [], 'states' => []];
                $total = (float) $r['availableStock']; $on = (float) ($res[$r['id']] ?? 0);
                $out[strtoupper($r['itemCode'])] = ['hand' => (float) $l['HAND'], 'local' => (float) $l['LOCAL'], 'state' => (float) array_sum($l['states']),
                    'total' => $total, 'onOrder' => $on, 'free' => round($total - $on, 2), 'minimum' => (float) $r['minimumStock'],
                    'places' => array_merge(array_map(fn($c, $q) => ['place' => 'Local – ' . $c, 'qty' => $q], array_keys($l['local']), $l['local']),
                                            array_map(fn($st, $q) => ['place' => $st, 'qty' => $q], array_keys($l['states']), $l['states']))];
            }
        } catch (Throwable $e) { error_log('order stockFor: ' . $e->getMessage()); }
        return $out;
    }

    /** Items with their stock attached (for show / pdf). */
    private function itemsWithStock(string $orderId): array
    {
        $items = $this->fetchItems($orderId);
        $st = self::stockFor(array_column($items, 'itemCode'));
        foreach ($items as &$i) $i['_stock'] = $st[strtoupper((string) $i['itemCode'])] ?? null;
        unset($i);
        return $items;
    }

    // GET /api/orders/stock-check?codes=A,B — stock for item codes typed in the order form
    public function stockCheck(): void
    {
        authenticate();
        $codes = array_filter(array_map('trim', explode(',', (string) qp('codes', ''))));
        sendSuccess(['stock' => self::stockFor(array_slice($codes, 0, 100))]);
    }

    private function canEdit(array $auth, array $row): bool
    {
        return is_admin_tier($auth['role']) || $row['engineerId'] === $auth['id'];
    }

    /**
     * Parses + validates the `items` field, present as a JSON string
     * (multipart) or a native array (JSON body). Each line is either:
     *   - a catalog product: {productId, quantity}
     *   - a manual/ad-hoc line, for something not in the Products catalog
     *     yet: {productName, quantity, itemCode?, unit?, category?} with no
     *     productId. itemCode defaults to a short placeholder if left out,
     *     since the column doesn't allow empty — everything else is exactly
     *     what was typed, no catalog lookup involved.
     */
    private function parseItems($raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($raw)) $raw = [];

        $items = [];
        foreach ($raw as $line) {
            $qty = is_numeric($line['quantity'] ?? null) ? (float) $line['quantity'] : 0;
            if ($qty <= 0) continue;

            $productId = trim((string) ($line['productId'] ?? ''));
            if ($productId) {
                $p = db()->prepare('SELECT id,itemCode,productName,unit FROM `Product` WHERE id=? LIMIT 1');
                $p->execute([$productId]);
                $product = $p->fetch();
                if (!$product) sendError("Product not found: $productId", 404);

                $items[] = [
                    'productId' => $product['id'], 'itemCode' => $product['itemCode'],
                    'productName' => $product['productName'], 'unit' => $product['unit'],
                    'category' => trim((string) ($line['category'] ?? '')) ?: null,
                    'brand' => trim((string) ($line['brand'] ?? '')) ?: null, 'quantity' => $qty,
                ];
                continue;
            }

            // Manual line — not in the Products catalog.
            $productName = trim((string) ($line['productName'] ?? ''));
            if (!$productName) continue; // need at least a name to be a real line
            $items[] = [
                'productId' => null,
                'itemCode' => trim((string) ($line['itemCode'] ?? '')) ?: 'MANUAL',
                'productName' => $productName,
                'unit' => trim((string) ($line['unit'] ?? '')) ?: null,
                'category' => trim((string) ($line['category'] ?? '')) ?: null,
                'brand' => trim((string) ($line['brand'] ?? '')) ?: null,
                'quantity' => $qty,
            ];
        }
        return $items;
    }

    private function replaceItems(string $orderId, array $items): void
    {
        // Editing an order rewrites its lines — carry each product's
        // "supplied" tick and per-item procurement tracking over, keyed by
        // productId, so an edit (e.g. a quantity change) doesn't silently
        // reset tracking someone already did on that line. Manual lines
        // (no productId) have no stable identity across an edit, so their
        // tracking always starts fresh — same limitation "supplied" already
        // had here before this.
        $prev = [];
        foreach ($this->fetchItems($orderId) as $old) {
            if (!$old['productId']) continue;
            $prev[$old['productId']] = [
                'supplied' => $old['supplied'], 'suppliedAt' => $old['suppliedAt'], 'suppliedQty' => $old['suppliedQty'] ?? null,
                'procurementStatus' => $old['procurementStatus'], 'expectedDeliveryDate' => $old['expectedDeliveryDate'],
            ];
        }

        db()->prepare('DELETE FROM `CustomerOrderItem` WHERE orderId=?')->execute([$orderId]);
        $ins = db()->prepare(
            'INSERT INTO `CustomerOrderItem`
                (id,orderId,productId,itemCode,productName,unit,category,brand,quantity,supplied,suppliedAt,procurementStatus,expectedDeliveryDate,createdAt,suppliedQty)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        foreach ($items as $it) {
            $carry = $prev[$it['productId']] ?? null;
            $ins->execute([
                gen_id(), $orderId, $it['productId'], $it['itemCode'], $it['productName'], $it['unit'], $it['category'], $it['brand'], $it['quantity'],
                $carry && $carry['supplied'] ? 1 : 0, $carry && $carry['supplied'] ? $carry['suppliedAt'] : null,
                $carry ? $carry['procurementStatus'] : 'NOT_ORDERED', $carry ? $carry['expectedDeliveryDate'] : null,
                now_sql(),
                // a partly supplied line keeps what was already sent (never more than the new quantity)
                $carry && !$carry['supplied'] && $carry['suppliedQty'] !== null ? min((float) $carry['suppliedQty'], (float) $it['quantity']) : null,
            ]);
        }
    }

    /** Sets every line on the order to supplied (true) or not (false). */
    private function setAllItemsSupplied(string $orderId, bool $supplied): void
    {
        $sql = $supplied
            ? "UPDATE `CustomerOrderItem` SET supplied=1,suppliedAt=?,suppliedQty=quantity,
                 procurementStatus=IF(procurementStatus='NOT_ORDERED','ORDERED',procurementStatus) WHERE orderId=?"
            : 'UPDATE `CustomerOrderItem` SET supplied=0,suppliedAt=NULL,suppliedQty=NULL WHERE orderId=?';
        $params = $supplied ? [now_sql(), $orderId] : [$orderId];
        db()->prepare($sql)->execute($params);
    }

    /**
     * You can't supply something that was never procured — if any item is
     * being marked supplied and procurement is still sitting at the
     * NOT_ORDERED default, bring it in line automatically rather than
     * leave the order showing a contradiction (delivered, but "not
     * ordered"). Never overwrites a procurement status someone already
     * set deliberately, and never flips ORDERED back to NOT_ORDERED —
     * this only ever moves forward.
     */
    private function autoMarkProcured(string $orderId): void
    {
        db()->prepare("UPDATE `CustomerOrder` SET procurementStatus='ORDERED' WHERE id=? AND procurementStatus='NOT_ORDERED'")
            ->execute([$orderId]);
    }

    /** Validates + moves an uploaded PO file to storage. Returns [originalName, storedName, mime, size]. */
    private function handleUpload(): array
    {
        if (empty($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) {
            sendError('Please attach the purchase order document.', 400);
        }
        $file = $_FILES['file'];
        if ($file['error'] !== UPLOAD_ERR_OK) sendError('Upload failed (error code ' . $file['error'] . ').', 400);
        if (!is_uploaded_file($file['tmp_name'])) sendError('Invalid upload.', 400);
        if ($file['size'] <= 0 || $file['size'] > self::MAX_FILE_SIZE_BYTES) {
            $mb = self::MAX_FILE_SIZE_BYTES / (1024 * 1024);
            sendError("File must be between 1 byte and {$mb}MB.", 400);
        }
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!array_key_exists($ext, self::ALLOWED_EXTENSIONS)) {
            sendError('Only PDF, JPG, and PNG files are allowed.', 400);
        }
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $realMime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);
        if ($realMime !== self::ALLOWED_EXTENSIONS[$ext]) {
            sendError('File content does not match a PDF, JPG, or PNG file.', 400);
        }

        $storedName = gen_id() . '.' . $ext;
        if (!move_uploaded_file($file['tmp_name'], $this->storageDir() . '/' . $storedName)) {
            sendError('Could not save the uploaded file.', 500);
        }
        return [basename($file['name']), $storedName, $realMime, (int) $file['size']];
    }

    private function deleteFileIfAny(array $row): void
    {
        if (!$row['poDocumentStoredName']) return;
        $path = $this->storageDir() . '/' . $row['poDocumentStoredName'];
        if (is_file($path)) @unlink($path);
    }

    // GET /api/orders/meta
    public function meta(): void
    {
        authenticate();
        sendSuccess([
            'orderTypes' => self::ORDER_TYPES,
            'deliveryStatuses' => self::DELIVERY_STATUSES,
            'procurementStatuses' => self::PROCUREMENT_STATUSES,
            'proformaStatuses' => self::PROFORMA_STATUSES,
        ]);
    }

    // GET /api/orders/engineers
    public function engineers(): void
    {
        authenticate();
        $s = db()->query(
            "SELECT id, name, role, department FROM `User` WHERE isActive=1
             ORDER BY (role='SALES_ENGINEER') DESC, name ASC"
        );
        sendSuccess(['engineers' => $s->fetchAll()]);
    }

    // GET /api/orders
    public function index(): void
    {
        authenticate();
        [$page, $limit, $offset] = paginate(20);

        $where = []; $params = [];
        if (qp('from')) { $where[] = 'o.orderDate>=?'; $params[] = to_date_only(qp('from')); }
        if (qp('to'))   { $where[] = 'o.orderDate<=?'; $params[] = to_date_only(qp('to')); }
        if (qp('engineerId'))     { $where[] = 'o.engineerId=?';     $params[] = qp('engineerId'); }
        if (qp('deliveryStatus')) { $where[] = 'o.deliveryStatus=?'; $params[] = qp('deliveryStatus'); }
        if (qp('procurementStatus')) { $where[] = 'o.procurementStatus=?'; $params[] = qp('procurementStatus'); }
        if (qp('proformaStatus'))    { $where[] = 'o.proformaStatus=?';    $params[] = qp('proformaStatus'); }
        if (qp('orderType'))      { $where[] = 'o.orderType=?';      $params[] = qp('orderType'); }
        if (qp('customerId'))     { $where[] = 'o.customerId=?';     $params[] = qp('customerId'); }
        if (qp('search')) {
            $like = '%' . qp('search') . '%';
            $where[] = '(c.companyName LIKE ? OR c.contactPerson LIKE ?)';
            $params[] = $like; $params[] = $like;
        }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare("SELECT COUNT(*) FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId $w");
        $s->execute($params);
        $total = (int) $s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT o.*, c.companyName, c.contactPerson, c.contactNumber, u.name AS engineerName, u.role AS engineerRole,
                    (SELECT GROUP_CONCAT(productName SEPARATOR ', ') FROM `CustomerOrderItem` WHERE orderId=o.id) AS productNames,
                    (SELECT COUNT(*) FROM `CustomerOrderItem` WHERE orderId=o.id) AS itemCount,
                    (SELECT COUNT(*) FROM `CustomerOrderItem` WHERE orderId=o.id AND supplied=1) AS suppliedCount
             FROM `CustomerOrder` o
             LEFT JOIN `Customer` c ON c.id=o.customerId
             LEFT JOIN `User` u ON u.id=o.engineerId
             $w ORDER BY o.orderDate DESC, o.createdAt DESC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $items = array_map(function ($r) {
            $shaped = $this->shape($r);
            $shaped['productSummary'] = $r['productNames'];
            $shaped['itemCount'] = (int) $r['itemCount'];
            $shaped['suppliedCount'] = (int) $r['suppliedCount'];
            return $shaped;
        }, $s2->fetchAll());

        sendPaginated($items, $total, $page, $limit, 'Orders fetched');
    }

    // GET /api/orders/:id
    public function show(string $id, int $statusCode = 200): void
    {
        authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        sendSuccess(['order' => $this->shape($row, $this->itemsWithStock($id))], 'Success', $statusCode);
    }

    // POST /api/orders  (multipart/form-data when orderType=PO, JSON otherwise)
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();

        $customerId = trim((string) ($b['customerId'] ?? ''));
        $orderType = strtoupper(trim((string) ($b['orderType'] ?? 'VERBAL')));
        if (!$customerId) sendError('Please choose a customer.', 400);
        if (!in_array($orderType, self::ORDER_TYPES, true)) {
            sendError('orderType must be one of: ' . implode(', ', self::ORDER_TYPES), 400);
        }

        $cs = db()->prepare('SELECT id,companyName FROM `Customer` WHERE id=? LIMIT 1');
        $cs->execute([$customerId]);
        $customer = $cs->fetch();
        if (!$customer) sendError('Customer not found.', 404);

        $items = $this->parseItems($b['items'] ?? []);
        if (!$items) sendError('Add at least one product to the order.', 400);

        $engineerId = $auth['id'];
        if (is_admin_tier($auth['role']) && !empty($b['engineerId'])) {
            $es = db()->prepare('SELECT id FROM `User` WHERE id=? AND isActive=1 LIMIT 1');
            $es->execute([$b['engineerId']]);
            if (!$es->fetch()) sendError('Selected engineer not found or inactive.', 404);
            $engineerId = $b['engineerId'];
        }

        $orderDate = to_date_only($b['orderDate'] ?? null) ?? (new DateTime('now'))->format('Y-m-d');

        $poOriginal = $poStored = $poMime = null; $poSize = null;
        $verbalDetails = null;
        if ($orderType === 'PO') {
            [$poOriginal, $poStored, $poMime, $poSize] = $this->handleUpload();
        } else {
            $verbalDetails = trim((string) ($b['verbalDetails'] ?? ''));
            if (!$verbalDetails) sendError('Please note what was verbally agreed.', 400);
        }

        $id = gen_id();
        db()->prepare(
            'INSERT INTO `CustomerOrder`
                (id,customerId,engineerId,orderType,poDocumentOriginalName,poDocumentStoredName,poDocumentMime,poDocumentSize,
                 verbalDetails,orderDate,deliveryStatus,notes,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,\'PENDING\',?,?,?)'
        )->execute([
            $id, $customerId, $engineerId, $orderType, $poOriginal, $poStored, $poMime, $poSize,
            $verbalDetails, $orderDate, bp_trim($b, 'notes'), now_sql(), now_sql(),
        ]);
        $this->replaceItems($id, $items);

        StockLedger::syncOrder($id, $auth['id']); // supplied lines come out of stock (undo puts them back)
        log_activity($auth['id'], 'ORDER_CREATED', 'CustomerOrder', $id, ['customer' => $customer['companyName'], 'orderType' => $orderType]);
        $this->show($id, 201);
    }

    // PUT /api/orders/:id  (JSON only — see uploadDocument() for attaching/replacing the PO file)
    public function update(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to edit this order.', 403);

        $b = request_body();
        $customerId = bp_has($b, 'customerId') ? trim((string) $b['customerId']) : $row['customerId'];
        if ($customerId !== $row['customerId']) {
            $cs = db()->prepare('SELECT id FROM `Customer` WHERE id=? LIMIT 1');
            $cs->execute([$customerId]);
            if (!$cs->fetch()) sendError('Customer not found.', 404);
        }

        $orderType = bp_has($b, 'orderType') ? strtoupper(trim((string) $b['orderType'])) : $row['orderType'];
        if (!in_array($orderType, self::ORDER_TYPES, true)) {
            sendError('orderType must be one of: ' . implode(', ', self::ORDER_TYPES), 400);
        }
        // Becoming PO happens only by attaching a document (POST .../document)
        // — a plain JSON PUT can't carry file bytes, so this path only ever
        // handles staying PO, staying VERBAL, or going PO -> VERBAL.
        if ($orderType === 'PO' && $row['orderType'] !== 'PO') {
            sendError('To make this a PO, upload the purchase order document instead.', 400);
        }

        $poOriginal = $row['poDocumentOriginalName']; $poStored = $row['poDocumentStoredName'];
        $poMime = $row['poDocumentMime']; $poSize = $row['poDocumentSize'];
        $verbalDetails = $row['verbalDetails'];

        if ($orderType === 'VERBAL') {
            $verbalDetails = bp_has($b, 'verbalDetails') ? trim((string) $b['verbalDetails']) : $verbalDetails;
            if (!$verbalDetails) sendError('Please note what was verbally agreed.', 400);
            if ($row['orderType'] === 'PO') {
                $this->deleteFileIfAny($row);
                $poOriginal = $poStored = $poMime = $poSize = null;
            }
        }
        // orderType === 'PO' here means it already was — file fields carry over untouched.

        $orderDate = bp_has($b, 'orderDate') ? (to_date_only($b['orderDate']) ?? $row['orderDate']) : $row['orderDate'];
        $notes = bp_has($b, 'notes') ? bp_trim($b, 'notes') : $row['notes'];

        db()->prepare(
            'UPDATE `CustomerOrder` SET customerId=?,orderType=?,poDocumentOriginalName=?,poDocumentStoredName=?,
             poDocumentMime=?,poDocumentSize=?,verbalDetails=?,orderDate=?,notes=?,updatedAt=? WHERE id=?'
        )->execute([$customerId, $orderType, $poOriginal, $poStored, $poMime, $poSize, $verbalDetails, $orderDate, $notes, now_sql(), $id]);

        if (bp_has($b, 'items')) {
            $items = $this->parseItems($b['items']);
            if (!$items) sendError('Add at least one product to the order.', 400);
            $this->replaceItems($id, $items);
        }

        StockLedger::syncOrder($id, $auth['id']); // supplied lines come out of stock (undo puts them back)
        log_activity($auth['id'], 'ORDER_UPDATED', 'CustomerOrder', $id, []);
        $this->show($id);
    }

    // POST /api/orders/:id/document  (multipart/form-data — attaches or replaces the PO
    // document and switches the order to PO type; PHP only populates $_FILES on POST,
    // which is why this is a separate endpoint rather than folded into the PUT above)
    public function uploadDocument(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to edit this order.', 403);

        [$poOriginal, $poStored, $poMime, $poSize] = $this->handleUpload();
        $this->deleteFileIfAny($row);

        db()->prepare(
            "UPDATE `CustomerOrder` SET orderType='PO',poDocumentOriginalName=?,poDocumentStoredName=?,
             poDocumentMime=?,poDocumentSize=?,verbalDetails=NULL,updatedAt=? WHERE id=?"
        )->execute([$poOriginal, $poStored, $poMime, $poSize, now_sql(), $id]);

        log_activity($auth['id'], 'ORDER_DOCUMENT_ATTACHED', 'CustomerOrder', $id, []);
        $this->show($id);
    }

    // PATCH /api/orders/:id/delivery
    public function updateDelivery(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to update this order.', 403);

        $b = request_body();
        $status = strtoupper(trim((string) ($b['deliveryStatus'] ?? '')));
        if (!in_array($status, self::DELIVERY_STATUSES, true)) {
            sendError('deliveryStatus must be one of: ' . implode(', ', self::DELIVERY_STATUSES), 400);
        }

        $reason = null; $deliveredDate = null;
        if (in_array($status, self::STATUSES_NEEDING_REASON, true)) {
            $reason = trim((string) ($b['notDeliveredReason'] ?? ''));
            if (!$reason) {
                sendError($status === 'PARTIALLY_DELIVERED'
                    ? 'Please give a reason why the order is only partially delivered.'
                    : 'Please give a reason for the non-delivery.', 400);
            }
        }
        if ($status === 'DELIVERED' || $status === 'PARTIALLY_DELIVERED') {
            $deliveredDate = to_date_only($b['deliveredDate'] ?? null) ?? (new DateTime('now'))->format('Y-m-d');
        }

        db()->prepare(
            'UPDATE `CustomerOrder` SET deliveryStatus=?,notDeliveredReason=?,deliveredDate=?,updatedAt=? WHERE id=?'
        )->execute([$status, $reason, $deliveredDate, now_sql(), $id]);

        // Keep the per-line supplied ticks consistent with the headline status.
        // PARTIALLY_DELIVERED leaves them as-is — use PATCH .../supply to pick lines.
        if ($status === 'DELIVERED') $this->setAllItemsSupplied($id, true);
        elseif ($status === 'PENDING' || $status === 'NOT_DELIVERED') $this->setAllItemsSupplied($id, false);
        if ($status === 'DELIVERED' || $status === 'PARTIALLY_DELIVERED') $this->autoMarkProcured($id);

        StockLedger::syncOrder($id, $auth['id']); // supplied lines come out of stock (undo puts them back)
        log_activity($auth['id'], 'ORDER_DELIVERY_UPDATED', 'CustomerOrder', $id, ['status' => $status]);
        $this->show($id);
    }

    // PATCH /api/orders/:id/supply — body { suppliedItemIds: [...], reason }
    // Ticks which product lines were actually supplied and derives the order's
    // delivery status from that: every line ticked → DELIVERED; some → PARTIALLY_DELIVERED;
    // none → NOT_DELIVERED. Anything short of complete needs a reason.
    public function updateSupply(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to update this order.', 403);

        $b = request_body();
        $ids = $b['suppliedItemIds'] ?? [];
        if (is_string($ids)) { $d = json_decode($ids, true); $ids = is_array($d) ? $d : []; }
        if (!is_array($ids)) $ids = [];
        $ids = array_values(array_unique(array_map('strval', $ids)));
        // Partial supply: { quantities: { itemId: qty supplied so far } } — wins over suppliedItemIds.
        $qmap = $b['quantities'] ?? null;
        if (is_string($qmap)) { $d = json_decode($qmap, true); $qmap = is_array($d) ? $d : null; }

        $items = $this->fetchItems($id);
        if (!$items) sendError('This order has no product lines to supply.', 400);
        $known = array_column($items, 'id');
        foreach (array_merge($ids, is_array($qmap) ? array_map('strval', array_keys($qmap)) : []) as $itemId) {
            if (!in_array($itemId, $known, true)) sendError('One of the selected items does not belong to this order.', 400);
        }
        $want = [];
        foreach ($items as $it) {
            $q = (float) $it['quantity'];
            if (is_array($qmap) && array_key_exists($it['id'], $qmap)) {
                $v = $qmap[$it['id']];
                if ($v !== '' && $v !== null && !is_numeric($v)) sendError('Enter a number for the quantity supplied of ' . $it['itemCode'] . '.', 400);
                $v = round((float) $v, 2);
                if ($v < 0) sendError('Quantity supplied cannot be negative.', 400);
                if ($v > $q) sendError($it['itemCode'] . ': supplied ' . qtyfmt($v) . ' is more than ordered ' . qtyfmt($q) . '.', 400);
                $want[$it['id']] = $v;
            } elseif (is_array($qmap)) {
                $want[$it['id']] = self::suppliedQty($it);
            } else {
                $want[$it['id']] = in_array($it['id'], $ids, true) ? $q : 0.0;
            }
        }

        $total = count($items);
        $full = count(array_filter($items, fn($it) => $want[$it['id']] >= (float) $it['quantity']));
        $any = array_sum($want) > 0;
        $status = $full === $total ? 'DELIVERED' : ($any ? 'PARTIALLY_DELIVERED' : 'NOT_DELIVERED');
        $ticked = $full;
        $reason = null;
        if ($status !== 'DELIVERED') {
            $reason = trim((string) ($b['reason'] ?? ''));
            if (!$reason) {
                sendError($status === 'PARTIALLY_DELIVERED'
                    ? 'Not everything is supplied yet — please give a reason for the partial delivery.'
                    : 'Nothing is supplied — please give a reason for the non-delivery.', 400);
            }
        }
        $deliveredDate = $status === 'NOT_DELIVERED' ? null
            : (to_date_only($b['deliveredDate'] ?? null) ?? (new DateTime('now'))->format('Y-m-d'));

        $now = now_sql();
        $upd = db()->prepare(
            "UPDATE `CustomerOrderItem` SET supplied=?,suppliedAt=?,suppliedQty=?,
                procurementStatus=IF(?=1 AND procurementStatus='NOT_ORDERED','ORDERED',procurementStatus)
             WHERE id=? AND orderId=?"
        );
        foreach ($items as $it) {
            $v = $want[$it['id']];
            $on = $v >= (float) $it['quantity'];
            // Keep the original timestamp for lines that already had something supplied.
            $at = $v > 0 ? (self::suppliedQty($it) > 0 && $it['suppliedAt'] ? $it['suppliedAt'] : $now) : null;
            // A line can't be supplied without having been procured — bring its procurement status along.
            $upd->execute([$on ? 1 : 0, $at, $v > 0 ? $v : null, $v > 0 ? 1 : 0, $it['id'], $id]);
        }
        db()->prepare(
            'UPDATE `CustomerOrder` SET deliveryStatus=?,notDeliveredReason=?,deliveredDate=?,updatedAt=? WHERE id=?'
        )->execute([$status, $reason, $deliveredDate, $now, $id]);
        if ($any) $this->autoMarkProcured($id);

        StockLedger::syncOrder($id, $auth['id']); // supplied quantities come out of stock (undo puts them back)
        log_activity($auth['id'], 'ORDER_SUPPLY_UPDATED', 'CustomerOrder', $id, ['status' => $status, 'supplied' => $ticked, 'of' => $total, 'qty' => array_sum($want)]);
        $this->show($id);
    }

    // PATCH /api/orders/:id/proforma — body { proformaStatus: NOT_CONFIRMED|CONFIRMED }
    // Whether the price / proforma invoice has been confirmed. The order's
    // engineer or admin-tier can set it (same rule as editing the order).
    public function updateProforma(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to update this order.', 403);

        $b = request_body();
        $status = strtoupper(trim((string) ($b['proformaStatus'] ?? '')));
        if (!in_array($status, self::PROFORMA_STATUSES, true)) {
            sendError('proformaStatus must be one of: ' . implode(', ', self::PROFORMA_STATUSES), 400);
        }
        db()->prepare('UPDATE `CustomerOrder` SET proformaStatus=?,updatedAt=? WHERE id=?')->execute([$status, now_sql(), $id]);

        log_activity($auth['id'], 'ORDER_PROFORMA_UPDATED', 'CustomerOrder', $id, ['status' => $status]);
        $this->show($id);
    }

    // PATCH /api/orders/:id/eta — admin-tier only. Separate from update() since
    // this is the one field on an order a non-admin creator should never be
    // able to touch, even though they can edit everything else about it.
    public function updateEta(string $id): void
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Only admins can set the expected delivery date.', 403);
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);

        $b = request_body();
        if (!array_key_exists('expectedDeliveryDate', $b)) sendError('expectedDeliveryDate is required.', 400);
        $raw = $b['expectedDeliveryDate'];
        $eta = ($raw === null || $raw === '') ? null : to_date_only($raw);

        db()->prepare('UPDATE `CustomerOrder` SET expectedDeliveryDate=?,updatedAt=? WHERE id=?')->execute([$eta, now_sql(), $id]);

        log_activity($auth['id'], 'ORDER_ETA_UPDATED', 'CustomerOrder', $id, ['expectedDeliveryDate' => $eta]);
        $this->show($id);
    }

    // PATCH /api/orders/:id/procurement — admin-tier only. Whether the company
    // has placed its own order with its supplier yet — separate from
    // deliveryStatus, which is about handing the item to the customer.
    // Clearing back to NOT_ORDERED also clears the ETA, since an ETA for an
    // order that was never placed doesn't mean anything.
    public function updateProcurement(string $id): void
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Only admins can update the procurement status.', 403);
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);

        $b = request_body();
        $status = strtoupper(trim((string) ($b['procurementStatus'] ?? '')));
        if (!in_array($status, self::PROCUREMENT_STATUSES, true)) {
            sendError('procurementStatus must be one of: ' . implode(', ', self::PROCUREMENT_STATUSES), 400);
        }

        if ($status === 'NOT_ORDERED') {
            db()->prepare('UPDATE `CustomerOrder` SET procurementStatus=?,expectedDeliveryDate=NULL,updatedAt=? WHERE id=?')
                ->execute([$status, now_sql(), $id]);
        } else {
            db()->prepare('UPDATE `CustomerOrder` SET procurementStatus=?,updatedAt=? WHERE id=?')
                ->execute([$status, now_sql(), $id]);
        }

        log_activity($auth['id'], 'ORDER_PROCUREMENT_UPDATED', 'CustomerOrder', $id, ['status' => $status]);
        $this->show($id);
    }

    private function findItem(string $orderId, string $itemId): array
    {
        $s = db()->prepare('SELECT * FROM `CustomerOrderItem` WHERE id=? AND orderId=? LIMIT 1');
        $s->execute([$itemId, $orderId]);
        $item = $s->fetch();
        if (!$item) sendError('Item not found on this order.', 404);
        return $item;
    }

    // PATCH /api/orders/:id/items/:itemId/procurement — admin-tier only.
    // Same idea as updateProcurement() above, but scoped to one product
    // line — a multi-product order routinely has each line at a different
    // stage, from a different supplier, on a different timeline.
    public function updateItemProcurement(string $orderId, string $itemId): void
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Only admins can update procurement.', 403);
        if (!$this->fetchRow($orderId)) sendError('Order not found.', 404);
        $this->findItem($orderId, $itemId);

        $b = request_body();
        $status = strtoupper(trim((string) ($b['procurementStatus'] ?? '')));
        if (!in_array($status, self::PROCUREMENT_STATUSES, true)) {
            sendError('procurementStatus must be one of: ' . implode(', ', self::PROCUREMENT_STATUSES), 400);
        }

        if ($status === 'NOT_ORDERED') {
            db()->prepare('UPDATE `CustomerOrderItem` SET procurementStatus=?,expectedDeliveryDate=NULL WHERE id=?')
                ->execute([$status, $itemId]);
        } else {
            db()->prepare('UPDATE `CustomerOrderItem` SET procurementStatus=? WHERE id=?')->execute([$status, $itemId]);
        }

        log_activity($auth['id'], 'ORDER_ITEM_PROCUREMENT_UPDATED', 'CustomerOrder', $orderId, ['itemId' => $itemId, 'status' => $status]);
        $this->show($orderId);
    }

    // PATCH /api/orders/:id/items/:itemId/eta — admin-tier only, per line.
    public function updateItemEta(string $orderId, string $itemId): void
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Only admins can set the expected delivery date.', 403);
        if (!$this->fetchRow($orderId)) sendError('Order not found.', 404);
        $this->findItem($orderId, $itemId);

        $b = request_body();
        if (!array_key_exists('expectedDeliveryDate', $b)) sendError('expectedDeliveryDate is required.', 400);
        $raw = $b['expectedDeliveryDate'];
        $eta = ($raw === null || $raw === '') ? null : to_date_only($raw);

        db()->prepare('UPDATE `CustomerOrderItem` SET expectedDeliveryDate=? WHERE id=?')->execute([$eta, $itemId]);

        log_activity($auth['id'], 'ORDER_ITEM_ETA_UPDATED', 'CustomerOrder', $orderId, ['itemId' => $itemId, 'expectedDeliveryDate' => $eta]);
        $this->show($orderId);
    }

    // DELETE /api/orders/:id
    public function delete(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to delete this order.', 403);

        $this->deleteFileIfAny($row);
        db()->prepare('DELETE FROM `CustomerOrder` WHERE id=?')->execute([$id]); // items cascade

        StockLedger::syncOrder($id, $auth['id']); // supplied lines come out of stock (undo puts them back)
        log_activity($auth['id'], 'ORDER_DELETED', 'CustomerOrder', $id, ['customer' => $row['companyName']]);
        sendSuccess([], 'Order deleted');
    }

    // GET /api/orders/:id/pdf?company=TMS|APJ — the order as a PDF (lines, supplied / pending, stock)
    public function pdf(string $id): void
    {
        authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        $items = $this->itemsWithStock($id);
        $co = strtoupper((string) qp('company', 'TMS')) === 'APJ' ? 'APJ' : 'TMS';
        $C = PayrollController::COMPANIES[$co] ?? PayrollController::COMPANIES['TMS'];
        $ref = self::orderRef($row);
        $pdf = new SimplePdf();
        $W = SimplePdf::A4_WIDTH; $H = SimplePdf::A4_HEIGHT; $m = 32; $cw = $W - 2 * $m;
        $q = fn($v) => qtyfmt((float) $v);
        $d = fn($v) => $v ? date('d-m-Y', strtotime($v)) : '—';
        $label = ['PENDING' => 'Pending', 'DELIVERED' => 'Delivered', 'PARTIALLY_DELIVERED' => 'Partially delivered', 'NOT_DELIVERED' => 'Not delivered',
                  'NOT_ORDERED' => 'Not ordered', 'ORDERED' => 'Ordered', 'RECEIVED' => 'Received', 'CONFIRMED' => 'Confirmed', 'NOT_CONFIRMED' => 'Not confirmed'];
        $L = fn($k) => $label[$k] ?? ucwords(strtolower(str_replace('_', ' ', (string) $k)));

        $header = function () use ($pdf, $C, $co, $W, $m, $cw, $ref, $row, $L) {
            $pdf->addPage();
            $y = $m; $lh = 42; $lw = $lh * $C['logoRatio'];
            if (!$pdf->addImage(__DIR__ . '/../assets/' . $C['logo'], $m, $y, $lw, $lh)) { $pdf->setFont('Helvetica-Bold', 16); $pdf->setFillColor('#1E3A5F'); $pdf->text($co, $m, $y + 12); }
            $pdf->setFont('Helvetica-Bold', 12); $pdf->setFillColor('#1E3A5F'); $pdf->text($C['name'], $W - $m, $y + 2, ['align' => 'right']);
            $pdf->setFont('Helvetica', 7.5); $pdf->setFillColor('#4B5563');
            foreach ($C['lines'] as $i => $line) $pdf->text($line, $W - $m, $y + 18 + $i * 9.5, ['align' => 'right']);
            $y += $lh + 12;
            $pdf->rect($m, $y, $cw, 24, '#1E3A5F');
            $pdf->setFont('Helvetica-Bold', 12); $pdf->setFillColor('#FFFFFF'); $pdf->text('SALES ORDER  ' . $ref, $m + 10, $y + 6.5);
            $pdf->setFont('Helvetica', 9); $pdf->text($L($row['deliveryStatus']), $W - $m - 10, $y + 8, ['align' => 'right']);
            return $y + 34;
        };
        $y = $header();
        // details
        $left = [['Customer', $row['companyName']], ['Contact', trim(($row['contactPerson'] ?? '') . ' ' . ($row['contactNumber'] ?? ''))], ['Engineer', $row['engineerName']],
                 ['Order type', $row['orderType'] === 'PO' ? 'Purchase order' . ($row['poDocumentOriginalName'] ? ' (' . $row['poDocumentOriginalName'] . ')' : '') : 'Verbal order']];
        $right = [['Order date', $d($row['orderDate'])], ['Expected delivery', $d($row['expectedDeliveryDate'])],
                  ['Procurement', $L($row['procurementStatus']) . ' · Proforma ' . strtolower($L($row['proformaStatus']))],
                  ['Delivered', $row['deliveredDate'] ? $d($row['deliveredDate']) : '—']];
        $half = $cw / 2; $top = $y;
        foreach ($left as $i => $r) {
            foreach ([[$r, $m], [$right[$i], $m + $half]] as [[$k, $v], $x]) {
                $pdf->setFont('Helvetica', 8); $pdf->setFillColor('#6B7280'); $pdf->text($k, $x + 8, $y + 5);
                $pdf->setFont('Helvetica-Bold', 9); $pdf->setFillColor('#111827'); $pdf->text((string) ($v ?: '—'), $x + 92, $y + 5, ['width' => $half - 100]);
            }
            $y += 16;
        }
        $bc = '#E5E7EB'; $bh = $y - $top + 4;
        foreach ([[$m, $top, $m + $cw, $top], [$m, $top + $bh, $m + $cw, $top + $bh], [$m, $top, $m, $top + $bh], [$m + $cw, $top, $m + $cw, $top + $bh]] as $ln) $pdf->line($ln[0], $ln[1], $ln[2], $ln[3], $bc);
        $y += 16;
        // lines
        $cols = [['#', 20, 'left'], ['Item code', 92, 'left'], ['Product', 150, 'left'], ['Brand', 56, 'left'], ['Ordered', 42, 'right'], ['Supplied', 44, 'right'],
                 ['Pending', 42, 'right'], ['Stock (hand / total)', 85, 'right']];
        $thead = function ($y) use ($pdf, $cols, $m, $cw) {
            $pdf->rect($m, $y, $cw, 18, '#EEF2F7');
            $pdf->setFont('Helvetica-Bold', 7.8); $pdf->setFillColor('#1E3A5F');
            $x = $m + 4;
            foreach ($cols as [$t, $w, $al]) { $pdf->text($t, $x, $y + 5, ['width' => $w - 6, 'align' => $al]); $x += $w; }
            return $y + 20;
        };
        $y = $thead($y);
        $tq = $ts = $tp = 0;
        foreach ($items as $n => $it) {
            $supplied = self::suppliedQty($it); $pending = max(0, (float) $it['quantity'] - $supplied);
            $tq += (float) $it['quantity']; $ts += $supplied; $tp += $pending;
            $st = $it['_stock'];
            $pdf->setFont('Helvetica', 8.2);
            $nameLines = $pdf->splitTextToSize((string) $it['productName'], $cols[2][1] - 6);
            $rh = max(16, 11 * count($nameLines) + 5);
            if ($y + $rh > $H - 70) { $y = $thead($header()); }
            if ($n % 2) $pdf->rect($m, $y - 2, $cw, $rh, '#FAFBFC');
            $vals = [(string) ($n + 1), (string) $it['itemCode'], (string) $it['productName'], (string) ($it['brand'] ?? ''), $q($it['quantity']), $q($supplied),
                     $pending > 0 ? $q($pending) : '-', $st ? $q($st['hand']) . ' / ' . $q($st['total']) : 'not in stock list'];
            $x = $m + 4;
            foreach ($cols as $ci => [$t, $w, $al]) {
                $pdf->setFont($ci === 1 ? 'Helvetica-Bold' : 'Helvetica', 8.2);
                $pdf->setFillColor($ci === 6 && $pending > 0 ? '#B45309' : ($ci === 7 && $st && $st['total'] < $pending ? '#B91C1C' : '#111827'));
                $pdf->text($vals[$ci], $x, $y + 2, ['width' => $w - 6, 'align' => $al, 'lineGap' => 2.8]);
                $x += $w;
            }
            $y += $rh;
            $pdf->line($m, $y - 2, $m + $cw, $y - 2, '#E5E7EB', 0.5);
        }
        if (!$items) { $pdf->setFont('Helvetica', 9); $pdf->setFillColor('#6B7280'); $pdf->text('No product lines on this order.', $m + 6, $y + 4); $y += 20; }
        else {
            $pdf->setFont('Helvetica-Bold', 8.6); $pdf->setFillColor('#111827');
            $x = $m + 4 + 20 + 92 + 150 + 56;
            $pdf->text('Total', $m + 4, $y + 3);
            foreach ([[$tq, 42], [$ts, 44], [$tp, 42]] as [$v, $w]) { $pdf->text($q($v), $x, $y + 3, ['width' => $w - 6, 'align' => 'right']); $x += $w; }
            $y += 22;
        }
        foreach ([['Verbal order details', $row['verbalDetails']], ['Notes', $row['notes']], ['Reason (not / partly delivered)', $row['notDeliveredReason']]] as [$k, $v]) {
            if (!trim((string) $v)) continue;
            if ($y > $H - 110) $y = $header();
            $pdf->setFont('Helvetica-Bold', 8.5); $pdf->setFillColor('#1E3A5F'); $pdf->text($k, $m, $y);
            $pdf->setFont('Helvetica', 8.5); $pdf->setFillColor('#111827');
            $lines = $pdf->splitTextToSize((string) $v, $cw);
            foreach (array_slice($lines, 0, 12) as $li => $ln) $pdf->text($ln, $m, $y + 13 + $li * 11);
            $y += 18 + 11 * min(12, count($lines));
        }
        // footer on every page
        for ($p = 0; $p < $pdf->pageCount(); $p++) {
            $pdf->setActivePage($p);
            $pdf->setFont('Helvetica', 7.5); $pdf->setFillColor('#6B7280');
            $pdf->text('Generated ' . date('d-m-Y h:i A') . ' · ' . $ref . ' · page ' . ($p + 1) . ' of ' . $pdf->pageCount(), $W / 2, $H - 26, ['align' => 'center']);
        }
        $fn = 'order-' . preg_replace('/[^A-Za-z0-9]+/', '-', ($row['companyName'] ?: 'customer')) . '-' . date('d-m-Y', strtotime($row['orderDate'])) . '.pdf';
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/pdf');
        header('Content-Disposition: ' . (qp('inline') === '1' ? 'inline' : 'attachment') . '; filename="' . $fn . '"');
        echo $pdf->output(); exit;
    }

    /** Short readable order reference: ORD-YYMMDD-XXXX. */
    public static function orderRef(array $row): string
    {
        return 'ORD-' . date('ymd', strtotime($row['orderDate'])) . '-' . strtoupper(substr($row['id'], -4));
    }

    // GET /api/orders/:id/document
    public function downloadDocument(string $id): void
    {
        authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        if (!$row['poDocumentStoredName']) sendError('No document attached to this order.', 404);

        $path = $this->storageDir() . '/' . $row['poDocumentStoredName'];
        if (!is_file($path)) sendError('File missing on server.', 404);

        $safeName = str_replace(['"', "\r", "\n"], '', $row['poDocumentOriginalName']);
        $disposition = qp('download') ? 'attachment' : 'inline';

        header('Content-Type: ' . $row['poDocumentMime']);
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . filesize($path));
        header("Content-Disposition: $disposition; filename=\"$safeName\"");
        readfile($path);
        exit;
    }
}
