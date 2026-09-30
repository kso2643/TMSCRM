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
}
