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
  `quantity`    DECIMAL(14,2) NOT NULL,
  `supplied`    TINYINT(1)    NOT NULL DEFAULT 0,
  `suppliedAt`  DATETIME          NULL,
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
                'columns'  => [
                    'expectedDeliveryDate' => 'DATE NULL',
                    'procurementStatus'    => "VARCHAR(20) NOT NULL DEFAULT 'NOT_ORDERED'",
                    'proformaStatus'       => "VARCHAR(20) NOT NULL DEFAULT 'NOT_CONFIRMED'",
                ],
            ],
            'CustomerOrderItem' => [
                'create'   => "CREATE TABLE IF NOT EXISTS `CustomerOrderItem` ($itemCols$itemFks\n$tail",
                'fallback' => "CREATE TABLE IF NOT EXISTS `CustomerOrderItem` ($itemCols\n$tail",
                'columns'  => [
                    'supplied'   => 'TINYINT(1) NOT NULL DEFAULT 0',
                    'suppliedAt' => 'DATETIME NULL',
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
                'productName' => $i['productName'], 'unit' => $i['unit'], 'quantity' => (float) $i['quantity'],
                'supplied' => (bool) $i['supplied'], 'suppliedAt' => $i['suppliedAt'],
            ], $items) : null,
            'createdAt'          => $row['createdAt'],
            'updatedAt'          => $row['updatedAt'],
        ];
    }

    private function canEdit(array $auth, array $row): bool
    {
        return is_admin_tier($auth['role']) || $row['engineerId'] === $auth['id'];
    }

    /** Parses + validates the `items` field, present as a JSON string (multipart) or a native array (JSON body). */
    private function parseItems($raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($raw)) $raw = [];

        $items = [];
        foreach ($raw as $line) {
            $productId = trim((string) ($line['productId'] ?? ''));
            $qty = is_numeric($line['quantity'] ?? null) ? (float) $line['quantity'] : 0;
            if (!$productId || $qty <= 0) continue;

            $p = db()->prepare('SELECT id,itemCode,productName,unit FROM `Product` WHERE id=? LIMIT 1');
            $p->execute([$productId]);
            $product = $p->fetch();
            if (!$product) sendError("Product not found: $productId", 404);

            $items[] = [
                'productId' => $product['id'], 'itemCode' => $product['itemCode'],
                'productName' => $product['productName'], 'unit' => $product['unit'], 'quantity' => $qty,
            ];
        }
        return $items;
    }

    private function replaceItems(string $orderId, array $items): void
    {
        // Editing an order rewrites its lines — carry each product's
        // "supplied" tick over so an edit doesn't silently un-deliver it.
        $prev = [];
        foreach ($this->fetchItems($orderId) as $old) {
            if ($old['productId'] && $old['supplied']) $prev[$old['productId']] = $old['suppliedAt'];
        }

        db()->prepare('DELETE FROM `CustomerOrderItem` WHERE orderId=?')->execute([$orderId]);
        $ins = db()->prepare(
            'INSERT INTO `CustomerOrderItem` (id,orderId,productId,itemCode,productName,unit,quantity,supplied,suppliedAt,createdAt)
             VALUES (?,?,?,?,?,?,?,?,?,?)'
        );
        foreach ($items as $it) {
            $wasSupplied = array_key_exists($it['productId'], $prev);
            $ins->execute([
                gen_id(), $orderId, $it['productId'], $it['itemCode'], $it['productName'], $it['unit'], $it['quantity'],
                $wasSupplied ? 1 : 0, $wasSupplied ? $prev[$it['productId']] : null, now_sql(),
            ]);
        }
    }

    /** Sets every line on the order to supplied (true) or not (false). */
    private function setAllItemsSupplied(string $orderId, bool $supplied): void
    {
        db()->prepare('UPDATE `CustomerOrderItem` SET supplied=?,suppliedAt=? WHERE orderId=?')
            ->execute([$supplied ? 1 : 0, $supplied ? now_sql() : null, $orderId]);
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
        sendSuccess(['order' => $this->shape($row, $this->fetchItems($id))], 'Success', $statusCode);
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

        $items = $this->fetchItems($id);
        if (!$items) sendError('This order has no product lines to supply.', 400);
        $known = array_column($items, 'id');
        foreach ($ids as $itemId) {
            if (!in_array($itemId, $known, true)) sendError('One of the selected items does not belong to this order.', 400);
        }

        $total = count($items); $ticked = count($ids);
        $status = $ticked === $total ? 'DELIVERED' : ($ticked > 0 ? 'PARTIALLY_DELIVERED' : 'NOT_DELIVERED');
        $reason = null;
        if ($status !== 'DELIVERED') {
            $reason = trim((string) ($b['reason'] ?? ''));
            if (!$reason) {
                sendError($status === 'PARTIALLY_DELIVERED'
                    ? 'Not every item is selected — please give a reason for the partial delivery.'
                    : 'No items are selected — please give a reason for the non-delivery.', 400);
            }
        }
        $deliveredDate = $status === 'NOT_DELIVERED' ? null
            : (to_date_only($b['deliveredDate'] ?? null) ?? (new DateTime('now'))->format('Y-m-d'));

        $now = now_sql();
        $upd = db()->prepare('UPDATE `CustomerOrderItem` SET supplied=?,suppliedAt=? WHERE id=? AND orderId=?');
        foreach ($items as $it) {
            $on = in_array($it['id'], $ids, true);
            // Keep the original timestamp for lines that were already ticked.
            $at = $on ? ($it['supplied'] ? $it['suppliedAt'] : $now) : null;
            $upd->execute([$on ? 1 : 0, $at, $it['id'], $id]);
        }
        db()->prepare(
            'UPDATE `CustomerOrder` SET deliveryStatus=?,notDeliveredReason=?,deliveredDate=?,updatedAt=? WHERE id=?'
        )->execute([$status, $reason, $deliveredDate, $now, $id]);

        log_activity($auth['id'], 'ORDER_SUPPLY_UPDATED', 'CustomerOrder', $id, ['status' => $status, 'supplied' => $ticked, 'of' => $total]);
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

    // DELETE /api/orders/:id
    public function delete(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Order not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to delete this order.', 403);

        $this->deleteFileIfAny($row);
        db()->prepare('DELETE FROM `CustomerOrder` WHERE id=?')->execute([$id]); // items cascade

        log_activity($auth['id'], 'ORDER_DELETED', 'CustomerOrder', $id, ['customer' => $row['companyName']]);
        sendSuccess([], 'Order deleted');
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
