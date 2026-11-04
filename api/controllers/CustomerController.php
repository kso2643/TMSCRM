<?php
class CustomerController
{
    // GET /api/customers
    public function index(): void
    {
        $auth = authenticate();
        [$page, $limit, $offset] = paginate(20);
        $search      = qp('search', '');
        $category    = qp('category', '');
        $industryType = qp('industryType', '');
        $status      = qp('status', '');

        $where = ['c.isActive=1']; $params = [];
        if ($search) {
            $like = "%$search%";
            $where[] = '(c.companyName LIKE ? OR c.contactPerson LIKE ? OR c.contactNumber LIKE ? OR c.location LIKE ? OR c.email LIKE ?)';
            $params = array_merge($params, [$like,$like,$like,$like,$like]);
        }
        if ($category)    { $where[] = 'c.category=?';    $params[] = $category; }
        if ($industryType){ $where[] = 'c.industryType=?';$params[] = $industryType; }
        if ($status)      { $where[] = 'c.status=?';      $params[] = $status; }
        $w = 'WHERE ' . implode(' AND ', $where);

        $s = db()->prepare("SELECT COUNT(*) FROM `Customer` c $w"); $s->execute($params);
        $total = (int)$s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT c.*, u.id AS cb_id, u.name AS cb_name,
                    (SELECT COUNT(*) FROM `Meeting` m WHERE m.customerId=c.id) AS meetings_count
             FROM `Customer` c
             LEFT JOIN `User` u ON u.id=c.createdById
             $w ORDER BY c.updatedAt DESC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $rows = $s2->fetchAll();
        $items = array_map([$this, 'shape'], $rows);
        sendPaginated($items, $total, $page, $limit, 'Customers fetched');
    }

    // GET /api/customers/with-location
    public function withLocation(): void
    {
        authenticate();
        $s = db()->query(
            'SELECT id,companyName,contactPerson,contactNumber,lat,lng,address,location,category,status,geoFenceRadius,
                    (SELECT COUNT(*) FROM `Meeting` m WHERE m.customerId=`Customer`.id) AS meetings_count
             FROM `Customer` WHERE isActive=1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY companyName ASC'
        );
        $rows = $s->fetchAll();
        $customers = array_map(function($r) {
            $r['lat'] = $r['lat'] !== null ? (float)$r['lat'] : null;
            $r['lng'] = $r['lng'] !== null ? (float)$r['lng'] : null;
            $r['geoFenceRadius'] = (int)$r['geoFenceRadius'];
            $r['_count'] = ['meetings' => (int)$r['meetings_count']];
            unset($r['meetings_count']);
            return $r;
        }, $rows);
        sendSuccess(['customers' => $customers, 'count' => count($customers)]);
    }

    // GET /api/customers/filter-meta
    public function filterMeta(): void
    {
        authenticate();
        $cats = db()->query("SELECT DISTINCT category FROM `Customer` WHERE isActive=1 AND category IS NOT NULL AND category!='' ORDER BY category")->fetchAll(PDO::FETCH_COLUMN);
        $inds = db()->query("SELECT DISTINCT industryType FROM `Customer` WHERE isActive=1 AND industryType IS NOT NULL AND industryType!='' ORDER BY industryType")->fetchAll(PDO::FETCH_COLUMN);
        $stats = db()->query("SELECT DISTINCT status FROM `Customer` WHERE isActive=1 AND status IS NOT NULL ORDER BY status")->fetchAll(PDO::FETCH_COLUMN);
        sendSuccess(['categories' => array_values($cats), 'industries' => array_values($inds), 'statuses' => array_values($stats)]);
    }

    // GET /api/customers/:id
    public function show(string $id): void
    {
        authenticate();
        $s = db()->prepare(
            'SELECT c.*, u.id AS cb_id, u.name AS cb_name
             FROM `Customer` c LEFT JOIN `User` u ON u.id=c.createdById
             WHERE c.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) sendError('Customer not found.', 404);
        $customer = $this->shape($row);

        $ms = db()->prepare(
            'SELECT m.*, u.name AS user_name FROM `Meeting` m LEFT JOIN `User` u ON u.id=m.userId
             WHERE m.customerId=? ORDER BY m.meetingDate DESC LIMIT 20'
        );
        $ms->execute([$id]);
        $meetings = array_map(function($m) {
            $m['user'] = ['name' => $m['user_name']]; unset($m['user_name']);
            return $m;
        }, $ms->fetchAll());
        $customer['meetings'] = $meetings;
        sendSuccess(['customer' => $customer]);
    }

    // POST /api/customers
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();
        $companyName   = trim($b['companyName'] ?? '');
        $contactPerson = trim($b['contactPerson'] ?? '');
        $contactNumber = trim($b['contactNumber'] ?? '');
        if (!$companyName || !$contactPerson || !$contactNumber)
            sendError('Company name, contact person, and number are required.', 400);

        $s = db()->prepare("SELECT id FROM `Customer` WHERE companyName=? AND isActive=1 LIMIT 1");
        $s->execute([$companyName]);
        $dup = $s->fetch();
        if ($dup) sendError("\"$companyName\" already exists in the database (ID: {$dup['id']}).", 409);

        $id = gen_id();
        $lat = isset($b['lat']) && $b['lat'] !== '' ? (float)$b['lat'] : null;
        $lng = isset($b['lng']) && $b['lng'] !== '' ? (float)$b['lng'] : null;
        db()->prepare(
            'INSERT INTO `Customer`
             (id,companyName,contactPerson,contactNumber,designation,email,location,address,
              lat,lng,geoFenceRadius,mapsLink,category,industryType,machineDetails,status,remarks,
              isActive,createdById,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)'
        )->execute([
            $id, $companyName, $contactPerson, $contactNumber,
            trim($b['designation'] ?? '') ?: null,
            strtolower(trim($b['email'] ?? '')) ?: null,
            trim($b['location'] ?? '') ?: null,
            trim($b['address'] ?? '') ?: null,
            $lat, $lng,
            isset($b['geoFenceRadius']) ? (int)$b['geoFenceRadius'] : 200,
            trim($b['mapsLink'] ?? '') ?: null,
            trim($b['category'] ?? '') ?: null,
            trim($b['industryType'] ?? '') ?: null,
            $b['machineDetails'] ?? null,
            $b['status'] ?? 'ACTIVE',
            trim($b['remarks'] ?? '') ?: null,
            $auth['id'], now_sql(), now_sql(),
        ]);
        log_activity($auth['id'], 'CUSTOMER_CREATED', 'Customer', $id, ['companyName' => $companyName]);
        $this->show($id);
    }

    // PUT /api/customers/:id
    public function update(string $id): void
    {
        $auth = authenticate();
        $b = request_body();
        $s = db()->prepare('SELECT id FROM `Customer` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        if (!$s->fetch()) sendError('Customer not found.', 404);

        $sets = []; $params = [];
        $str = fn($k) => trim($b[$k] ?? '');
        if (!empty($b['companyName']))    { $sets[]='companyName=?';   $params[]=$str('companyName'); }
        if (!empty($b['contactPerson']))  { $sets[]='contactPerson=?'; $params[]=$str('contactPerson'); }
        if (!empty($b['contactNumber']))  { $sets[]='contactNumber=?'; $params[]=$str('contactNumber'); }
        if (array_key_exists('designation',$b))   { $sets[]='designation=?';   $params[]=$str('designation') ?: null; }
        if (array_key_exists('email',$b))         { $sets[]='email=?';         $params[]=strtolower($str('email')) ?: null; }
        if (array_key_exists('location',$b))      { $sets[]='location=?';      $params[]=$str('location') ?: null; }
        if (array_key_exists('address',$b))       { $sets[]='address=?';       $params[]=$str('address') ?: null; }
        if (array_key_exists('lat',$b))           { $sets[]='lat=?';           $params[]=($b['lat']!==''&&$b['lat']!==null)?(float)$b['lat']:null; }
        if (array_key_exists('lng',$b))           { $sets[]='lng=?';           $params[]=($b['lng']!==''&&$b['lng']!==null)?(float)$b['lng']:null; }
        if (array_key_exists('geoFenceRadius',$b)){ $sets[]='geoFenceRadius=?';$params[]=(int)$b['geoFenceRadius']; }
        if (array_key_exists('mapsLink',$b))      { $sets[]='mapsLink=?';      $params[]=$str('mapsLink') ?: null; }
        if (array_key_exists('category',$b))      { $sets[]='category=?';      $params[]=$str('category') ?: null; }
        if (array_key_exists('industryType',$b))  { $sets[]='industryType=?';  $params[]=$str('industryType') ?: null; }
        if (array_key_exists('machineDetails',$b)){ $sets[]='machineDetails=?';$params[]=$b['machineDetails']; }
        if (!empty($b['status']))                 { $sets[]='status=?';        $params[]=$b['status']; }
        if (array_key_exists('remarks',$b))       { $sets[]='remarks=?';       $params[]=$str('remarks') ?: null; }

        if ($sets) {
            $sets[] = 'updatedAt=?'; $params[] = now_sql(); $params[] = $id;
            db()->prepare('UPDATE `Customer` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        }
        log_activity($auth['id'], 'CUSTOMER_UPDATED', 'Customer', $id);
        $this->show($id);
    }

    // DELETE /api/customers/:id  (soft-delete)
    public function delete(string $id): void
    {
        $auth = authenticate();
        // Super Admin / Admin / Manager, or the person who added the customer (v11.46)
        $c = db()->prepare('SELECT createdById, companyName FROM `Customer` WHERE id=? AND isActive=1'); $c->execute([$id]);
        $row = $c->fetch();
        if (!$row) sendError('Customer not found.', 404);
        if (!is_admin_tier($auth['role']) && ($row['createdById'] ?? null) !== $auth['id']) sendError('Only an admin or the person who added this customer can delete it.', 403);
        log_activity($auth['id'], 'CUSTOMER_DELETED', 'Customer', $id, ['customer' => $row['companyName']]);
        $s = db()->prepare('UPDATE `Customer` SET isActive=0,updatedAt=? WHERE id=?');
        if (!$s->execute([now_sql(), $id]) || $s->rowCount() === 0) sendError('Customer not found.', 404);
        sendSuccess([], 'Customer deleted');
    }

    // GET /api/customers/import/template
    public function importTemplate(): void
    {
        authenticate();
        $w = new XlsxWriter('Customers Template');
        $w->addRow(['Company Name','Contact Person','Contact Number','Designation','Email','Location','Address','Category','Industry Type','Machine Details','Status','Remarks']);
        $w->addRow(['Acme Engineering Pvt Ltd','Rajesh Kumar','9876543210','Purchase Manager','rajesh@acme.com','Coimbatore','12 Industrial Estate, Coimbatore','OEM','Automotive','VMC, CNC Lathe','ACTIVE','Key account']);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="customers-upload-template.xlsx"');
        echo $w->output(); exit;
    }

    // POST /api/customers/import
    public function import(): void
    {
        $auth = authenticate();
        if (empty($_FILES['file'])) sendError('No file uploaded.', 400);
        $tmpPath = $_FILES['file']['tmp_name'];
        $origName = $_FILES['file']['name'] ?? '';

        // Support CSV as well as XLSX, same as the stock importer.
        if (preg_match('/\.csv$/i', $origName)) {
            $rows = [];
            if (($fh = fopen($tmpPath, 'r')) !== false) {
                while (($row = fgetcsv($fh)) !== false) $rows[] = $row;
                fclose($fh);
            }
        } else {
            try { $rows = XlsxReader::readFirstSheetRows($tmpPath); }
            catch (\Exception $e) { sendError('Failed to parse file: ' . $e->getMessage(), 400); }
        }

        if (count($rows) < 2) sendError('The uploaded file has no data rows.', 400);
        $inserted = $updated = $skipped = 0; $errors = [];

        foreach ($rows as $i => $row) {
            if ($i === 0) continue; // header row
            $companyName   = trim((string)($row[0] ?? ''));
            $contactPerson = trim((string)($row[1] ?? ''));
            $contactNumber = trim((string)($row[2] ?? ''));
            if (!$companyName || !$contactPerson || !$contactNumber) { $skipped++; continue; }
            try {
                $data = [
                    'companyName'    => $companyName,
                    'contactPerson'  => $contactPerson,
                    'contactNumber'  => $contactNumber,
                    'designation'    => trim((string)($row[3] ?? '')) ?: null,
                    'email'          => strtolower(trim((string)($row[4] ?? ''))) ?: null,
                    'location'       => trim((string)($row[5] ?? '')) ?: null,
                    'address'        => trim((string)($row[6] ?? '')) ?: null,
                    'category'       => trim((string)($row[7] ?? '')) ?: null,
                    'industryType'   => trim((string)($row[8] ?? '')) ?: null,
                    'machineDetails' => trim((string)($row[9] ?? '')) ?: null,
                    'status'         => trim((string)($row[10] ?? '')) ?: 'ACTIVE',
                    'remarks'        => trim((string)($row[11] ?? '')) ?: null,
                ];
                // Same duplicate rule as single-add (create()): companyName is the business key.
                $es = db()->prepare('SELECT id FROM `Customer` WHERE companyName=? AND isActive=1 LIMIT 1');
                $es->execute([$companyName]);
                $ex = $es->fetch();
                if ($ex) {
                    $sets = []; $ps = [];
                    foreach ($data as $k => $v) { if ($k === 'companyName') continue; $sets[] = "$k=?"; $ps[] = $v; }
                    $sets[] = 'updatedAt=?'; $ps[] = now_sql();
                    $ps[] = $ex['id'];
                    db()->prepare('UPDATE `Customer` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($ps);
                    $updated++;
                } else {
                    $id = gen_id();
                    db()->prepare(
                        'INSERT INTO `Customer`
                         (id,companyName,contactPerson,contactNumber,designation,email,location,address,
                          category,industryType,machineDetails,status,remarks,geoFenceRadius,isActive,createdById,createdAt,updatedAt)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,200,1,?,?,?)'
                    )->execute([
                        $id, $data['companyName'], $data['contactPerson'], $data['contactNumber'], $data['designation'],
                        $data['email'], $data['location'], $data['address'], $data['category'], $data['industryType'],
                        $data['machineDetails'], $data['status'], $data['remarks'], $auth['id'], now_sql(), now_sql(),
                    ]);
                    $inserted++;
                }
            } catch (\Throwable $e) {
                $errors[] = ['row' => $i + 1, 'error' => $e->getMessage()];
            }
        }

        if ($inserted === 0 && $updated === 0)
            sendError('No valid rows found. Check that Company Name, Contact Person, and Contact Number (columns A-C) are populated.', 400);
        log_activity($auth['id'], 'CUSTOMER_BULK_IMPORT', 'Customer', null, ['inserted'=>$inserted,'updated'=>$updated,'skipped'=>$skipped,'errorCount'=>count($errors)]);
        $msg = "Import complete: {$inserted} added, {$updated} updated." . ($skipped ? " {$skipped} row(s) skipped (missing company/contact/number)." : '');
        sendSuccess(['inserted'=>$inserted,'updated'=>$updated,'skipped'=>$skipped,'errors'=>$errors], $msg);
    }

    private function shape(array $row): array
    {
        $row['isActive'] = (bool)$row['isActive'];
        $row['lat']  = $row['lat']  !== null ? (float)$row['lat']  : null;
        $row['lng']  = $row['lng']  !== null ? (float)$row['lng']  : null;
        $row['geoFenceRadius'] = (int)($row['geoFenceRadius'] ?? 200);
        $row['createdBy'] = ['id' => $row['cb_id'] ?? null, 'name' => $row['cb_name'] ?? null];
        $row['_count']    = ['meetings' => (int)($row['meetings_count'] ?? 0)];
        unset($row['cb_id'], $row['cb_name'], $row['meetings_count']);
        return $row;
    }

    // GET /api/customers/by-engineer?month=&year=   admin-tier: per engineer — customers they added (all time / this month),
    // customers visited, meetings, quotations and orders in the month (count + value).
    public function byEngineer(): void
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Only admins can see everyone\'s totals.', 403);
        $y = (int) (qp('year') ?: date('Y')); $m = (int) (qp('month') ?: date('n'));
        if ($y < 2000 || $y > 2100 || $m < 1 || $m > 12) sendError('Choose a valid month.', 400);
        $from = sprintf('%04d-%02d-01', $y, $m); $to = date('Y-m-d', strtotime("$from +1 month"));
        $q = function (string $sql, array $p) { try { $s = db()->prepare($sql); $s->execute($p); return $s->fetchAll(); } catch (Throwable $e) { return []; } };
        $by = [];
        $put = function (array $rows, array $map) use (&$by) { foreach ($rows as $r) { if (!$r['u']) continue; foreach ($map as $k => $col) $by[$r['u']][$k] = ($by[$r['u']][$k] ?? 0) + (float) $r[$col]; } };
        $put($q("SELECT createdById u, COUNT(*) n, SUM(createdAt>=? AND createdAt<?) nm FROM `Customer` WHERE isActive=1 GROUP BY createdById", [$from, $to]), ['customers' => 'n', 'newCustomers' => 'nm']);
        $put($q("SELECT COALESCE(assignedToId,userId) u, COUNT(*) n, COUNT(DISTINCT customerId) c FROM `Meeting` WHERE meetingDate>=? AND meetingDate<? GROUP BY COALESCE(assignedToId,userId)", [$from, $to]), ['meetings' => 'n', 'visitedCustomers' => 'c']);
        $put($q("SELECT userId u, COUNT(*) n, COALESCE(SUM(totalAmount),0) v FROM `Quotation` WHERE COALESCE(quotationDate, DATE(createdAt))>=? AND COALESCE(quotationDate, DATE(createdAt))<? GROUP BY userId", [$from, $to]), ['quotations' => 'n', 'quotationValue' => 'v']);
        $put($q("SELECT engineerId u, COUNT(*) n, COALESCE(SUM(orderValue),0) v FROM `CustomerOrder` WHERE orderDate>=? AND orderDate<? GROUP BY engineerId", [$from, $to]), ['orders' => 'n', 'orderValue' => 'v']);
        $names = [];
        foreach ($q('SELECT id, name, role FROM `User`', []) as $u) $names[$u['id']] = $u;
        $keys = ['customers', 'newCustomers', 'visitedCustomers', 'meetings', 'quotations', 'quotationValue', 'orders', 'orderValue'];
        $rows = []; $tot = array_fill_keys($keys, 0);
        foreach ($by as $uid => $v) {
            if (!isset($names[$uid])) continue;
            $r = ['id' => $uid, 'name' => $names[$uid]['name'], 'role' => $names[$uid]['role']];
            foreach ($keys as $k) { $r[$k] = round((float) ($v[$k] ?? 0), 2); $tot[$k] += $r[$k]; }
            $rows[] = $r;
        }
        usort($rows, fn($a, $b) => [$b['customers'], $a['name']] <=> [$a['customers'], $b['name']]);
        sendSuccess(['engineers' => $rows, 'totals' => $tot, 'from' => $from, 'to' => date('Y-m-d', strtotime("$to -1 day"))]);
    }

    // GET /api/customers/:id/updates — the latest activity for one customer from every module,
    // newest first (meetings, follow-ups, quotations, price requests, orders, invoices, trials,
    // appointments, CEO Desk), for the "Latest updates" card on the customer page.
    public function updates(string $id): void
    {
        authenticate();
        $c = db()->prepare('SELECT id, companyName FROM `Customer` WHERE id=? LIMIT 1'); $c->execute([$id]);
        if (!$c->fetch()) sendError('Customer not found.', 404);
        $out = []; $next = null;
        $add = function ($type, $icon, $at, $title, $sub, $link, $by = null, $status = null) use (&$out) {
            if (!$at) return;
            $out[] = ['type' => $type, 'icon' => $icon, 'at' => $at, 'title' => $title, 'sub' => $sub, 'link' => $link, 'by' => $by, 'status' => $status];
        };
        $rows = function (string $sql, array $p) { try { $q = db()->prepare($sql); $q->execute($p); return $q->fetchAll(); } catch (Throwable $e) { return []; } };
        $h = fn($v) => ucwords(strtolower(str_replace('_', ' ', (string) $v)));
        foreach ($rows("SELECT m.id, m.meetingDate, m.createdAt, m.updatedAt, m.meetingType, m.status, m.summary, m.notes, m.nextFollowUp, m.followUpTime, u.name AS byName
                        FROM `Meeting` m LEFT JOIN `User` u ON u.id=m.userId WHERE m.customerId=? ORDER BY m.meetingDate DESC LIMIT 25", [$id]) as $r) {
            $txt = trim((string) ($r['summary'] ?: $r['notes']));
            $add('MEETING', $r['meetingType'] === 'CALL' ? '📞' : '🤝', $r['meetingDate'], $h($r['meetingType']) . ' · ' . $h($r['status']),
                 $txt !== '' ? mb_substr(preg_replace('/\s+/', ' ', $txt), 0, 220) : 'No notes', '/meetings/#m-' . $r['id'], $r['byName'], $r['status']);
            if ($r['nextFollowUp'] && $r['nextFollowUp'] >= date('Y-m-d 00:00:00') && (!$next || $r['nextFollowUp'] < $next['at']))
                $next = ['at' => $r['nextFollowUp'], 'time' => $r['followUpTime'], 'meetingId' => $r['id'], 'by' => $r['byName']];
        }
        foreach ($rows("SELECT q.id, q.company, q.quotationNumber, q.totalAmount, q.status, q.followStatus, q.createdAt, u.name AS byName FROM `Quotation` q LEFT JOIN `User` u ON u.id=q.userId
                        WHERE q.customerId=? ORDER BY q.createdAt DESC LIMIT 15", [$id]) as $r)
            $add('QUOTATION', '📄', $r['createdAt'], 'Quotation ' . $r['quotationNumber'],
                 ($r['totalAmount'] !== null ? '₹' . number_format((float) $r['totalAmount'], 2) . ' · ' : '') . $h($r['followStatus'] ?: $r['status']), '/quotations/', $r['byName'], $r['company']);
        foreach ($rows("SELECT b.id, b.requestNo, b.firm, b.createdAt, u.name AS byName,
                               (SELECT COUNT(*) FROM `PriceRequest` r WHERE r.batchId=b.id) AS n,
                               (SELECT COUNT(*) FROM `PriceRequest` r WHERE r.batchId=b.id AND r.status='PENDING') AS pending
                        FROM `PriceRequestBatch` b LEFT JOIN `User` u ON u.id=b.requestedById WHERE b.customerId=? ORDER BY b.createdAt DESC LIMIT 15", [$id]) as $r)
            $add('PRICE_REQUEST', '💰', $r['createdAt'], 'Price request ' . $r['requestNo'],
                 $r['n'] . ' item' . ($r['n'] == 1 ? '' : 's') . ' · ' . ($r['pending'] ? $r['pending'] . ' waiting for price' : 'all answered'), '/price-requests/?q=' . rawurlencode($r['requestNo']), $r['byName'], $r['firm']);
        foreach ($rows("SELECT o.id, o.orderNo, o.orderType, o.deliveryStatus, o.procurementStatus, o.orderValue, o.firm, o.createdAt, u.name AS byName
                        FROM `CustomerOrder` o LEFT JOIN `User` u ON u.id=o.engineerId WHERE o.customerId=? ORDER BY o.createdAt DESC LIMIT 15", [$id]) as $r)
            $add('ORDER', '📦', $r['createdAt'], 'Order ' . ($r['orderNo'] ?: '') . ' · ' . ($r['orderType'] === 'PO' ? 'PO' : 'Verbal'),
                 'Delivery: ' . $h($r['deliveryStatus']) . ' · Procurement: ' . $h($r['procurementStatus']) . ($r['orderValue'] !== null ? ' · ₹' . number_format((float) $r['orderValue'], 2) : ''),
                 '/orders/?q=' . rawurlencode((string) $r['orderNo']), $r['byName'], $r['firm']);
        foreach ($rows("SELECT i.invoiceNo, i.amount, i.createdAt, o.orderNo, u.name AS byName FROM `OrderInvoice` i JOIN `CustomerOrder` o ON o.id=i.orderId LEFT JOIN `User` u ON u.id=i.createdById
                        WHERE o.customerId=? ORDER BY i.createdAt DESC LIMIT 10", [$id]) as $r)
            $add('INVOICE', '🧾', $r['createdAt'], 'Invoice ' . $r['invoiceNo'], 'Order ' . ($r['orderNo'] ?: '') . ($r['amount'] !== null ? ' · ₹' . number_format((float) $r['amount'], 2) : ''),
                 '/orders/?q=' . rawurlencode((string) $r['orderNo']), $r['byName']);
        foreach ($rows("SELECT t.trialNo, t.component, t.status, t.createdAt, t.updatedAt, u.name AS byName FROM `Trial` t LEFT JOIN `User` u ON u.id=t.requestedById
                        WHERE t.customerId=? ORDER BY t.createdAt DESC LIMIT 10", [$id]) as $r)
            $add('TRIAL', '🧪', $r['createdAt'], 'Trial ' . ($r['trialNo'] ?: '') . ($r['component'] ? ' · ' . $r['component'] : ''), $h($r['status']), '/trials/', $r['byName'], $r['status']);
        foreach ($rows("SELECT a.title, a.appointmentDate, a.appointmentTime, a.status, a.visitStatus, u.name AS byName FROM `Appointment` a LEFT JOIN `User` u ON u.id=COALESCE(a.assignedToId, a.userId)
                        WHERE a.customerId=? ORDER BY a.appointmentDate DESC LIMIT 10", [$id]) as $r)
            $add('APPOINTMENT', '📅', substr((string) $r['appointmentDate'], 0, 10) . ' ' . ($r['appointmentTime'] ?: '00:00') . (strlen((string) $r['appointmentTime']) === 5 ? ':00' : ''),
                 'Appointment · ' . ($r['title'] ?: 'Visit'), $h($r['visitStatus'] ?: $r['status']), '/appointments/', $r['byName']);
        foreach ($rows("SELECT d.id, d.type, d.title, d.status, d.createdAt, u.name AS byName FROM `MdDeskItem` d LEFT JOIN `User` u ON u.id=d.fromId
                        WHERE d.customerId=? ORDER BY d.createdAt DESC LIMIT 10", [$id]) as $r)
            $add('CEO_DESK', '🗂', $r['createdAt'], 'CEO Desk · ' . $r['title'], $h($r['status']), '/md-desk/#' . $r['id'], $r['byName']);
        usort($out, fn($a, $b) => strcmp((string) $b['at'], (string) $a['at']));
        $counts = array_count_values(array_column($out, 'type'));
        sendSuccess(['updates' => array_slice($out, 0, 40), 'counts' => $counts, 'nextFollowUp' => $next]);
    }
}
