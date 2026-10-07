<?php
/**
 * Downloads for the modules added after the original build, so the
 * Reports page covers every page: Orders, Tasks, Price requests, Trials,
 * Appointments, Breaks, and a daily location-tracking summary.
 *
 * GET /api/reports/<name>?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|excel|pdf
 *
 * Same output (CSV / Excel / PDF) and date-range rules as ExportController,
 * whose helpers this reuses. Manager and above, like the existing reports.
 * Each report reads a table that may not exist yet if its module was never
 * opened; that gives an empty report instead of an error.
 */
class ReportsController extends ExportController
{
    private function rows(string $sql, array $params): array
    {
        try {
            $s = db()->prepare($sql);
            $s->execute($params);
            return $s->fetchAll();
        } catch (PDOException $e) {
            if ($e->getCode() === '42S02') return []; // table doesn't exist yet
            throw $e;
        }
    }
    private static function d(?string $v): string { return $v ? date('d/m/Y', strtotime($v)) : ''; }
    private static function dt(?string $v): string { return $v ? date('d/m/Y h:i A', strtotime($v)) : ''; }
    private static function hms($sec): string
    {
        $sec = (int) $sec;
        return sprintf('%02d:%02d:%02d', intdiv($sec, 3600), intdiv($sec % 3600, 60), $sec % 60);
    }
    private function where(string $col, array $extra = []): array
    {
        [$c, $p] = $this->dateRange($col);
        $c = array_merge($c, $extra);
        return [$c ? 'WHERE ' . implode(' AND ', $c) : '', $p];
    }

    // GET /api/reports/orders
    public function orders(): void
    {
        $auth = authenticate(); require_manager($auth);
        StockLedger::ensure(); // also makes sure order lines have suppliedQty
        [$w, $p] = $this->where('o.orderDate');
        $rows = $this->rows(
            "SELECT o.*, c.companyName, u.name AS engineerName,
                    (SELECT GROUP_CONCAT(CONCAT(i.productName, ' x', i.quantity + 0, IF(i.supplied=1, ' (supplied)', IF(COALESCE(i.suppliedQty,0)>0, CONCAT(' (', i.suppliedQty + 0, ' supplied)'), ''))) SEPARATOR '; ')
                       FROM `CustomerOrderItem` i WHERE i.orderId=o.id) AS items
             FROM `CustomerOrder` o
             LEFT JOIN `Customer` c ON c.id=o.customerId
             LEFT JOIN `User` u ON u.id=o.engineerId
             $w ORDER BY o.orderDate DESC", $p);
        if (in_array(strtolower(qp('format', 'csv')), ['excel', 'xlsx'], true)) $this->orderSheets($w, $p);
        $this->sendExport($rows, [
            ['label' => 'Order ref',       'value' => fn($r) => OrderController::orderRef($r)],
            ['label' => 'Order date',      'value' => fn($r) => self::d($r['orderDate'])],
            ['label' => 'Customer',        'value' => fn($r) => $r['companyName'] ?? ''],
            ['label' => 'Sales engineer',  'value' => fn($r) => $r['engineerName'] ?? ''],
            ['label' => 'Type',            'value' => fn($r) => $r['orderType']],
            ['label' => 'Items',           'value' => fn($r) => $r['items'] ?? ''],
            ['label' => 'Price/proforma',  'value' => fn($r) => $r['proformaStatus'] ?? ''],
            ['label' => 'Procurement',     'value' => fn($r) => $r['procurementStatus'] ?? ''],
            ['label' => 'Expected date',   'value' => fn($r) => self::d($r['expectedDeliveryDate'] ?? null)],
            ['label' => 'Delivery',        'value' => fn($r) => $r['deliveryStatus']],
            ['label' => 'Delivered date',  'value' => fn($r) => self::d($r['deliveredDate'])],
            ['label' => 'Reason',          'value' => fn($r) => $r['notDeliveredReason'] ?? ''],
        ], 'orders-' . $this->stamp(), 'Orders Report');
    }

    /** Orders: one row per line (with supplied / pending and current stock), week-wise orders, week-wise stock out. */
    private function orderSheets(string $w, array $p): void
    {
        $lines = $this->rows(
            "SELECT o.id AS oid, o.orderDate, o.deliveryStatus, o.id, c.companyName, u.name AS engineerName, i.*
             FROM `CustomerOrderItem` i JOIN `CustomerOrder` o ON o.id=i.orderId
             LEFT JOIN `Customer` c ON c.id=o.customerId LEFT JOIN `User` u ON u.id=o.engineerId
             $w ORDER BY o.orderDate DESC, c.companyName, i.createdAt", $p);
        $stock = OrderController::stockFor(array_column($lines, 'itemCode'));
        $out = [];
        foreach ($lines as $l) {
            $q = (float) $l['quantity'];
            $sup = $l['supplied'] ? $q : (float) ($l['suppliedQty'] ?? 0);
            $st = $stock[strtoupper((string) $l['itemCode'])] ?? null;
            $out[] = [OrderController::orderRef(['orderDate' => $l['orderDate'], 'id' => $l['oid']]), ['v' => substr($l['orderDate'], 0, 10), 't' => 'date', 's' => 'date'],
                $l['companyName'], $l['engineerName'], $l['itemCode'], $l['productName'], $l['brand'], $l['category'],
                $q, $sup, max(0, $q - $sup), $sup >= $q ? 'Supplied' : ($sup > 0 ? 'Partly supplied' : 'Pending'),
                $l['suppliedAt'] ? date('d-m-Y', strtotime($l['suppliedAt'])) : '', $l['procurementStatus'],
                $l['expectedDeliveryDate'] ? date('d-m-Y', strtotime($l['expectedDeliveryDate'])) : '',
                $st ? $st['hand'] : '', $st ? $st['total'] : '', $st ? $st['onOrder'] : ''];
        }
        $this->extraSheets[] = ['name' => 'Order lines', 'title' => 'Order lines — ordered, supplied, pending and stock today',
            'header' => ['Order ref', 'Order date', 'Customer', 'Engineer', 'Item code', 'Product', 'Brand', 'Category', 'Ordered', 'Supplied', 'Pending', 'Line status',
                         'Supplied on', 'Procurement', 'Expected', 'Stock in hand', 'Stock total', 'On open orders'],
            'widths' => [18, 12, 26, 18, 18, 30, 12, 12, 9, 9, 9, 14, 12, 12, 12, 10, 10, 10], 'rows' => $out];

        // week-wise (Monday start)
        $weeks = [];
        foreach ($lines as $l) {
            $wk = date('Y-m-d', strtotime('monday this week', strtotime($l['orderDate'])));
            $x = &$weeks[$wk];
            $x = $x ?? ['orders' => [], 'lines' => 0, 'qty' => 0, 'sup' => 0];
            $x['orders'][$l['oid']] = 1; $x['lines']++; $x['qty'] += (float) $l['quantity'];
            $x['sup'] += $l['supplied'] ? (float) $l['quantity'] : (float) ($l['suppliedQty'] ?? 0);
            unset($x);
        }
        krsort($weeks);
        $wr = [];
        foreach ($weeks as $wk => $x) $wr[] = [['v' => $wk, 't' => 'date', 's' => 'date'], date('d M', strtotime($wk)) . ' – ' . date('d M Y', strtotime($wk . ' +6 days')),
            count($x['orders']), $x['lines'], $x['qty'], $x['sup'], max(0, $x['qty'] - $x['sup'])];
        $this->extraSheets[] = ['name' => 'Week-wise orders', 'title' => 'Orders week by week (by order date)',
            'header' => ['Week from', 'Week', 'Orders', 'Lines', 'Qty ordered', 'Qty supplied', 'Qty pending'], 'widths' => [12, 22, 9, 9, 12, 12, 12], 'rows' => $wr];

        // stock taken out for orders, week by week and item
        [$sc, $sp] = $this->dateRange('m.createdAt');
        $mv = $this->rows("SELECT m.createdAt, m.qty, m.reason, s.itemCode, s.itemName, s.brand FROM `StockMovement` m JOIN `Stock` s ON s.id=m.stockId
                           WHERE m.reason IN ('ORDER_SUPPLIED','ORDER_RESTORED')" . ($sc ? ' AND ' . implode(' AND ', $sc) : '') . ' ORDER BY m.createdAt', $sp);
        $agg = [];
        foreach ($mv as $m) {
            $wk = date('Y-m-d', strtotime('monday this week', strtotime($m['createdAt'])));
            $k = $wk . '|' . $m['itemCode'];
            $agg[$k] = $agg[$k] ?? [$wk, $m['itemCode'], $m['itemName'], $m['brand'], 0];
            $agg[$k][4] += -(float) $m['qty'];
        }
        krsort($agg);
        $this->extraSheets[] = ['name' => 'Week-wise stock out', 'title' => 'Stock taken out for orders, week by week',
            'header' => ['Week from', 'Item code', 'Item', 'Brand', 'Qty out'], 'widths' => [12, 20, 34, 14, 10],
            'rows' => array_map(fn($a) => [['v' => $a[0], 't' => 'date', 's' => 'date'], $a[1], $a[2], $a[3], round($a[4], 2)], array_values($agg))];
    }

    // GET /api/reports/stock — every stock item with places, on open orders, free; movements in the period
    public function stock(): void
    {
        $auth = authenticate(); require_manager($auth);
        StockLedger::ensure();
        $items = $this->rows("SELECT s.* FROM `Stock` s WHERE s.isActive=1 ORDER BY s.brand, s.itemCode", []);
        $lv = StockLedger::levels(array_column($items, 'id'));
        $res = StockLedger::reserved(array_column($items, 'id'));
        foreach ($items as &$r) {
            $l = $lv[$r['id']] ?? ['HAND' => 0, 'LOCAL' => 0, 'local' => [], 'states' => []];
            $r['_hand'] = $l['HAND']; $r['_local'] = $l['LOCAL']; $r['_state'] = array_sum($l['states']);
            $r['_places'] = implode('; ', array_merge(array_map(fn($c, $q) => "$c: " . qtyfmt($q), array_keys($l['local']), $l['local']), array_map(fn($c, $q) => "$c: " . qtyfmt($q), array_keys($l['states']), $l['states'])));
            $r['_on'] = $res[$r['id']] ?? 0;
        }
        unset($r);
        if (in_array(strtolower(qp('format', 'csv')), ['excel', 'xlsx'], true)) {
            [$sc, $sp] = $this->dateRange('m.createdAt');
            $mv = $this->rows("SELECT m.*, s.itemCode, s.itemName, s.brand, u.name AS byName FROM `StockMovement` m JOIN `Stock` s ON s.id=m.stockId LEFT JOIN `User` u ON u.id=m.userId"
                              . ($sc ? ' WHERE ' . implode(' AND ', $sc) : '') . ' ORDER BY m.createdAt DESC LIMIT 20000', $sp);
            $this->extraSheets[] = ['name' => 'Movements', 'title' => 'Stock movements (in / out) in the period',
                'header' => ['Date', 'Item code', 'Item', 'Brand', 'Place', 'In / out', 'Balance there', 'Why', 'Note', 'By'], 'widths' => [17, 20, 30, 12, 22, 9, 11, 16, 40, 16],
                'rows' => array_map(fn($m) => [date('d-m-Y h:i A', strtotime($m['createdAt'])), $m['itemCode'], $m['itemName'], $m['brand'], StockLedger::label($m['locType'], $m['state']),
                                             (float) $m['qty'], $m['balance'] === null ? '' : (float) $m['balance'], $m['reason'], $m['note'], $m['byName']], $mv)];
            $brands = [];
            foreach ($items as $r) { $b = $r['brand'] ?: '(no brand)'; $brands[$b] = $brands[$b] ?? [0, 0, 0, 0]; $brands[$b][0]++; $brands[$b][1] += $r['_hand']; $brands[$b][2] += (float) $r['availableStock']; $brands[$b][3] += (float) $r['availableStock'] * (float) $r['netPrice']; }
            ksort($brands);
            $this->extraSheets[] = ['name' => 'Brand-wise', 'header' => ['Brand', 'Items', 'In hand', 'Total stock', 'Stock value (net price)'], 'widths' => [22, 9, 11, 11, 18],
                'rows' => array_map(fn($b, $x) => [$b, $x[0], $x[1], $x[2], ['v' => round($x[3], 2), 's' => 'num']], array_keys($brands), $brands)];
        }
        $this->sendExport($items, [
            ['label' => 'Item code',       'value' => fn($r) => $r['itemCode']],
            ['label' => 'Item',            'value' => fn($r) => $r['itemName']],
            ['label' => 'Brand',           'value' => fn($r) => $r['brand'] ?? ''],
            ['label' => 'Item group',      'value' => fn($r) => $r['itemGroup'] ?? ''],
            ['label' => 'In hand qty',     'value' => fn($r) => qtyfmt((float) $r['_hand'])],
            ['label' => 'Local stock qty', 'value' => fn($r) => qtyfmt((float) $r['_local'])],
            ['label' => 'State stock qty', 'value' => fn($r) => qtyfmt((float) $r['_state'])],
            ['label' => 'Total stock',     'value' => fn($r) => qtyfmt((float) $r['availableStock'])],
            ['label' => 'On open orders qty', 'value' => fn($r) => qtyfmt((float) $r['_on'])],
            ['label' => 'Free stock',      'value' => fn($r) => qtyfmt((float) $r['availableStock'] - (float) $r['_on'])],
            ['label' => 'Minimum stock',   'value' => fn($r) => qtyfmt((float) $r['minimumStock'])],
            ['label' => 'Net price',       'value' => fn($r) => number_format((float) $r['netPrice'], 2, '.', '')],
            ['label' => 'Places',          'value' => fn($r) => $r['_places']],
            ['label' => 'Last updated',    'value' => fn($r) => self::dt($r['lastUpdated'] ?? null)],
        ], 'stock-' . $this->stamp(), 'Stock Report');
    }

    // GET /api/reports/inwards — goods received from suppliers, one row per line
    public function inwards(): void
    {
        $auth = authenticate(); require_manager($auth);
        try { new VendorController(); } catch (Throwable $e) {}
        [$w, $p] = $this->where('w.receivedDate');
        $rows = $this->rows("SELECT w.*, x.itemCode, x.productName, x.brand, x.quantity, x.rate, x.amount, u.name AS byName
                             FROM `StockInward` w JOIN `StockInwardItem` x ON x.inwardId=w.id LEFT JOIN `User` u ON u.id=w.createdById
                             $w ORDER BY w.receivedDate DESC, w.inwardNo, x.itemCode", $p);
        $this->sendExport($rows, [
            ['label' => 'Received',     'value' => fn($r) => self::d($r['receivedDate'])],
            ['label' => 'Inward no.',   'value' => fn($r) => $r['inwardNo']],
            ['label' => 'Supplier',     'value' => fn($r) => $r['supplierName']],
            ['label' => 'Invoice no.',  'value' => fn($r) => $r['invoiceNo'] ?? ''],
            ['label' => 'Invoice date', 'value' => fn($r) => self::d($r['invoiceDate'])],
            ['label' => 'Added to (place)', 'value' => fn($r) => StockLedger::label($r['locType'], $r['state'])],
            ['label' => 'Item code',    'value' => fn($r) => $r['itemCode']],
            ['label' => 'Product',      'value' => fn($r) => $r['productName'] ?? ''],
            ['label' => 'Brand',        'value' => fn($r) => $r['brand'] ?? ''],
            ['label' => 'Qty',          'value' => fn($r) => qtyfmt((float) $r['quantity'])],
            ['label' => 'Rate',         'value' => fn($r) => $r['rate'] === null ? '' : number_format((float) $r['rate'], 2, '.', '')],
            ['label' => 'Amount',       'value' => fn($r) => $r['amount'] === null ? '' : number_format((float) $r['amount'], 2, '.', '')],
            ['label' => 'Entered by',   'value' => fn($r) => $r['byName'] ?? ''],
        ], 'stock-inward-' . $this->stamp(), 'Stock Inward Report');
    }

    // GET /api/reports/vendors — every vendor product with price, net price and stock
    public function vendors(): void
    {
        $auth = authenticate(); require_manager($auth);
        try { new VendorController(); } catch (Throwable $e) {}
        $rows = $this->rows("SELECT i.*, v.name AS vendorName, v.phone, v.city FROM `VendorItem` i JOIN `Vendor` v ON v.id=i.vendorId ORDER BY v.name, i.brand, i.itemCode", []);
        $this->sendExport($rows, [
            ['label' => 'Vendor',       'value' => fn($r) => $r['vendorName']],
            ['label' => 'Brand',        'value' => fn($r) => $r['brand'] ?? ''],
            ['label' => 'Item code',    'value' => fn($r) => $r['itemCode']],
            ['label' => 'Product',      'value' => fn($r) => $r['productName'] ?? ''],
            ['label' => 'Grade',        'value' => fn($r) => $r['grade'] ?? ''],
            ['label' => 'Specification','value' => fn($r) => $r['specification'] ?? ''],
            ['label' => 'Price',        'value' => fn($r) => $r['price'] === null ? '' : (string) (float) $r['price']],
            ['label' => 'Discount %',   'value' => fn($r) => $r['discount'] === null ? '' : (string) (float) $r['discount']],
            ['label' => 'Net price',    'value' => fn($r) => $r['netPrice'] === null ? '' : (string) (float) $r['netPrice']],
            ['label' => 'Vendor stock qty', 'value' => fn($r) => $r['stockQty'] === null ? '' : qtyfmt((float) $r['stockQty'])],
            ['label' => 'Lead time',    'value' => fn($r) => $r['leadTime'] ?? ''],
            ['label' => 'Updated',      'value' => fn($r) => self::d($r['updatedAt'])],
        ], 'vendor-price-lists-' . $this->stamp(), 'Vendor Price Lists');
    }

    // GET /api/reports/tasks
    public function tasks(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('t.createdAt');
        $rows = $this->rows(
            "SELECT t.*, a.name AS toName, b.name AS byName, c.companyName FROM `AdminTask` t
             LEFT JOIN `User` a ON a.id=t.assignedToId LEFT JOIN `User` b ON b.id=t.assignedById
             LEFT JOIN `Customer` c ON c.id=t.customerId
             $w ORDER BY t.createdAt DESC", $p);
        $this->sendExport($rows, [
            ['label' => 'Task',          'value' => fn($r) => $r['title']],
            ['label' => 'Assigned to',   'value' => fn($r) => $r['toName'] ?? ''],
            ['label' => 'Assigned by',   'value' => fn($r) => $r['byName'] ?? ''],
            ['label' => 'Customer',      'value' => fn($r) => $r['companyName'] ?? ''],
            ['label' => 'Priority',      'value' => fn($r) => $r['priority']],
            ['label' => 'Status',        'value' => fn($r) => $r['status']],
            ['label' => 'Assigned at',   'value' => fn($r) => self::dt($r['createdAt'])],
            ['label' => 'Started at',    'value' => fn($r) => self::dt($r['startedAt'])],
            ['label' => 'Completed at',  'value' => fn($r) => self::dt($r['completedAt'])],
            ['label' => 'Time worked',   'value' => fn($r) => self::hms($r['workedSeconds'])],
            ['label' => 'Due date',      'value' => fn($r) => self::d($r['dueDate'])],
            ['label' => 'Completion note','value' => fn($r) => $r['completionNote'] ?? ''],
        ], 'tasks-' . $this->stamp(), 'Tasks Report');
    }

    // GET /api/reports/price-requests
    public function priceRequests(): void
    {
        $auth = authenticate(); require_manager($auth);
        try { ensure_schema(PriceRequestController::schema(), 'migration_tasks_price_requests.sql'); } catch (Throwable $e) {}
        [$w, $p] = $this->where('r.createdAt');
        $rows = $this->rows(
            "SELECT r.*, u.name AS byName, a.name AS respName, c.companyName, b.requestNo FROM `PriceRequest` r
             LEFT JOIN `User` u ON u.id=r.requestedById LEFT JOIN `User` a ON a.id=r.respondedById
             LEFT JOIN `Customer` c ON c.id=r.customerId LEFT JOIN `PriceRequestBatch` b ON b.id=r.batchId
             $w ORDER BY r.createdAt DESC, r.batchId, r.sortOrder", $p);
        $this->sendExport($rows, [
            ['label' => 'Raised',          'value' => fn($r) => self::dt($r['createdAt'])],
            ['label' => 'Request no.',     'value' => fn($r) => $r['requestNo'] ?? ''],
            ['label' => 'Requested by',    'value' => fn($r) => $r['byName'] ?? ''],
            ['label' => 'Customer',        'value' => fn($r) => $r['companyName'] ?? ''],
            ['label' => 'Product',         'value' => fn($r) => $r['productName'] . ($r['itemCode'] ? ' (' . $r['itemCode'] . ')' : '')],
            ['label' => 'Category',        'value' => fn($r) => $r['category'] ?? ''],
            ['label' => 'Brand',           'value' => fn($r) => $r['brand'] ?? ''],
            ['label' => 'Regular / One time', 'value' => fn($r) => PriceRequestController::SUPPLY_TYPES[$r['supplyType'] ?? ''] ?? ''],
            ['label' => 'Priority',        'value' => fn($r) => PriceRequestController::PRIORITIES[$r['priority'] ?? ''] ?? ''],
            ['label' => 'Qty',             'value' => fn($r) => ($r['quantity'] ?? '') . (!empty($r['unit']) ? ' ' . $r['unit'] : '')],
            ['label' => 'List price',      'value' => fn($r) => $r['listPrice'] ?? ''],
            ['label' => 'Asked price',     'value' => fn($r) => $r['requestedPrice'] ?? ''],
            ['label' => 'Asked discount %', 'value' => fn($r) => $r['discount'] ?? ''],
            ['label' => 'Engineer note',   'value' => fn($r) => $r['notes'] ?? ''],
            ['label' => 'Status',          'value' => fn($r) => $r['status']],
            ['label' => 'Approved price',  'value' => fn($r) => $r['approvedPrice'] ?? ''],
            ['label' => 'Approved discount %', 'value' => fn($r) => $r['approvedDiscount'] ?? ''],
            ['label' => 'Decided by',      'value' => fn($r) => $r['respName'] ?? ''],
            ['label' => 'Note',            'value' => fn($r) => $r['responseNote'] ?? ''],
        ], 'price-requests-' . $this->stamp(), 'Price Requests Report');
    }

    // GET /api/reports/trials
    public function trials(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('t.createdAt');
        $rows = $this->rows(
            "SELECT t.id, t.trialNo, t.customerName, t.component, t.status, t.recommendations, t.approvalNote, t.decidedAt,
                    t.bestTool, t.savingsPerYear, t.savingsPct, t.completedAt, t.createdAt,
                    u.name AS byName, d.name AS decName, c.companyName
             FROM `Trial` t LEFT JOIN `User` u ON u.id=t.requestedById LEFT JOIN `User` d ON d.id=t.decidedById
             LEFT JOIN `Customer` c ON c.id=t.customerId
             $w ORDER BY t.createdAt DESC", $p);
        $recs = function ($r) {
            $a = json_decode((string) $r['recommendations'], true) ?: [];
            return implode('; ', array_map(fn($x) => $x['category'] . ': ' . $x['spec'] . (!empty($x['grade']) ? ' / ' . $x['grade'] : ''), $a));
        };
        $this->sendExport($rows, [
            ['label' => 'Trial no.',       'value' => fn($r) => $r['trialNo']],
            ['label' => 'Raised',          'value' => fn($r) => self::d($r['createdAt'])],
            ['label' => 'Customer',        'value' => fn($r) => $r['companyName'] ?: ($r['customerName'] ?? '')],
            ['label' => 'Component',       'value' => fn($r) => $r['component'] ?? ''],
            ['label' => 'Requested by',    'value' => fn($r) => $r['byName'] ?? ''],
            ['label' => 'Status',          'value' => fn($r) => $r['status']],
            ['label' => 'Recommendation',  'value' => $recs],
            ['label' => 'Decided by',      'value' => fn($r) => $r['decName'] ?? ''],
            ['label' => 'Best tool',       'value' => fn($r) => $r['bestTool'] ?? ''],
            ['label' => 'Saving / year',   'value' => fn($r) => $r['savingsPerYear'] ?? ''],
            ['label' => 'Saving %',        'value' => fn($r) => $r['savingsPct'] ?? ''],
            ['label' => 'Completed',       'value' => fn($r) => self::d($r['completedAt'])],
        ], 'trials-' . $this->stamp(), 'Trials Report');
    }

    // GET /api/reports/appointments
    public function appointments(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('a.appointmentDate');
        $rows = $this->rows(
            "SELECT a.*, c.companyName, u.name AS byName, e.name AS engName FROM `Appointment` a
             LEFT JOIN `Customer` c ON c.id=a.customerId LEFT JOIN `User` u ON u.id=a.userId LEFT JOIN `User` e ON e.id=a.assignedToId
             $w ORDER BY a.appointmentDate DESC, a.appointmentTime", $p);
        $this->sendExport($rows, [
            ['label' => 'Date',      'value' => fn($r) => self::d($r['appointmentDate'])],
            ['label' => 'Time',      'value' => fn($r) => $r['appointmentTime'] ?? ''],
            ['label' => 'Title',     'value' => fn($r) => $r['title']],
            ['label' => 'Customer',  'value' => fn($r) => $r['companyName'] ?? ''],
            ['label' => 'Engineer',  'value' => fn($r) => $r['engName'] ?? ''],
            ['label' => 'Booked by', 'value' => fn($r) => $r['byName'] ?? ''],
            ['label' => 'Status',    'value' => fn($r) => $r['status']],
            ['label' => 'Notes',     'value' => fn($r) => $r['notes'] ?? ''],
        ], 'appointments-' . $this->stamp(), 'Appointments Report');
    }

    // GET /api/reports/breaks
    public function breaks(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('b.startedAt');
        $rows = $this->rows(
            "SELECT b.*, u.name AS who FROM `AttendanceBreak` b LEFT JOIN `User` u ON u.id=b.userId
             $w ORDER BY b.startedAt DESC", $p);
        $this->sendExport($rows, [
            ['label' => 'Employee',  'value' => fn($r) => $r['who'] ?? ''],
            ['label' => 'Date',      'value' => fn($r) => self::d($r['startedAt'])],
            ['label' => 'Break',     'value' => fn($r) => $r['breakType']],
            ['label' => 'Started',   'value' => fn($r) => $r['startedAt'] ? date('h:i A', strtotime($r['startedAt'])) : ''],
            ['label' => 'Ended',     'value' => fn($r) => $r['endedAt'] ? date('h:i A', strtotime($r['endedAt'])) : 'Still on break'],
            ['label' => 'Duration',  'value' => fn($r) => $r['endedAt'] ? self::hms($r['durationSeconds']) : ''],
            ['label' => 'How',       'value' => fn($r) => $r['triggerType'] === 'AUTO' ? 'After 30+ min stationary prompt' : 'Started by employee'],
        ], 'breaks-' . $this->stamp(), 'Breaks Report');
    }

    // GET /api/reports/tracking — one row per person per day: punch times,
    // location points recorded, distance travelled, breaks taken.
    public function tracking(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('a.date', ['a.checkIn IS NOT NULL']);
        $rows = $this->rows(
            "SELECT a.id, a.date, a.checkIn, a.checkOut, a.workingHours, a.checkInLat, a.checkOutLat, u.name AS who
             FROM `Attendance` a LEFT JOIN `User` u ON u.id=a.userId $w ORDER BY a.date DESC, u.name", $p);
        $ping = db()->prepare('SELECT lat,lng FROM `LocationPing` WHERE attendanceId=? ORDER BY capturedAt');
        foreach ($rows as &$r) {
            $ping->execute([$r['id']]);
            $pts = $ping->fetchAll();
            $r['points'] = count($pts);
            $r['km'] = round(LocationHistoryController::distanceKm($pts), 2);
            $b = $this->rows("SELECT COUNT(*) AS n, COALESCE(SUM(durationSeconds),0) AS s FROM `AttendanceBreak` WHERE attendanceId=?", [$r['id']]);
            $r['breaks'] = $b ? (int) $b[0]['n'] : 0;
            $r['breakSec'] = $b ? (int) $b[0]['s'] : 0;
        }
        unset($r);
        $this->sendExport($rows, [
            ['label' => 'Employee',         'value' => fn($r) => $r['who'] ?? ''],
            ['label' => 'Date',             'value' => fn($r) => self::d($r['date'])],
            ['label' => 'Punch in',         'value' => fn($r) => $r['checkIn'] ? date('h:i A', strtotime($r['checkIn'])) : ''],
            ['label' => 'Punch out',        'value' => fn($r) => $r['checkOut'] ? date('h:i A', strtotime($r['checkOut'])) : ''],
            ['label' => 'Hours',            'value' => fn($r) => $r['workingHours'] ?? ''],
            ['label' => 'Location at punch in', 'value' => fn($r) => $r['checkInLat'] !== null ? 'Yes' : 'No'],
            ['label' => 'Location points',  'value' => fn($r) => $r['points']],
            ['label' => 'Distance (km)',    'value' => fn($r) => $r['km']],
            ['label' => 'Breaks',           'value' => fn($r) => $r['breaks']],
            ['label' => 'Break time',       'value' => fn($r) => self::hms($r['breakSec'])],
        ], 'tracking-' . $this->stamp(), 'Daily Tracking Report');
    }
}
