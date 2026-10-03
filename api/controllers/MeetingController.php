<?php
class MeetingController
{
    private const VALID_STATUSES = [
        'NEW_LEAD','FOLLOW_UP_PENDING','TRIAL_PLANNED','TRIAL_COMPLETED',
        'QUOTATION_SUBMITTED','WAITING_APPROVAL','NEGOTIATION','PURCHASE_ORDER',
        'TECHNICAL_DISCUSSION_COMPLETED','PENDING_CUSTOMER_RESPONSE','LOST','CLOSED',
    ];
    private const VALID_TYPES = [
        'VISIT','CALL','ONLINE','TRIAL_SUPPORT','QUOTATION_DISCUSSION','TECHNICAL_DISCUSSION',
    ];

    // GET /api/meetings/meta
    public function meta(): void
    {
        authenticate();
        sendSuccess(['statuses' => self::VALID_STATUSES, 'types' => self::VALID_TYPES]);
    }

    // GET /api/meetings
    public function index(): void
    {
        $auth = authenticate();
        [$page, $limit, $offset] = paginate(20);
        $isAdmin = is_admin_tier($auth['role']);

        $where = []; $params = [];
        // if (!$isAdmin) { $where[] = 'm.userId=?'; $params[] = $auth['id']; }
        if (qp('userId') && $isAdmin)           { $where[] = 'm.userId=?';      $params[] = qp('userId'); }
        if (qp('customerId'))                   { $where[] = 'm.customerId=?';  $params[] = qp('customerId'); }
        if (qp('status'))                       { $where[] = 'm.status=?';      $params[] = qp('status'); }
        if (qp('type'))                         { $where[] = 'm.meetingType=?'; $params[] = qp('type'); }
        if (qp('assignedToMe') === 'true')      { $where[] = 'm.assignedToId=?';$params[] = $auth['id']; }
        if (qp('overdueOnly') === 'true') {
            $where[] = 'm.nextFollowUp < ?';    $params[] = now_sql();
            $where[] = "m.status NOT IN ('CLOSED','LOST')";
        }
        if (qp('search')) {
            $where[] = '(c.companyName LIKE ? OR c.contactPerson LIKE ?)';
            $needle = '%' . qp('search') . '%';
            $params[] = $needle; $params[] = $needle;
        }
        if (qp('dateFrom')) { $where[] = 'm.meetingDate >= ?'; $params[] = qp('dateFrom') . ' 00:00:00'; }
        if (qp('dateTo'))   { $where[] = 'm.meetingDate <= ?'; $params[] = qp('dateTo') . ' 23:59:59'; }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare(
            "SELECT COUNT(*) FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId $w"
        );
        $s->execute($params);
        $total = (int)$s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT m.*,
                    c.id AS c_id, c.companyName, c.contactPerson, c.lat AS c_lat, c.lng AS c_lng,
                    u.id AS u_id, u.name AS u_name,
                    a.id AS a_id, a.name AS a_name
             FROM `Meeting` m
             LEFT JOIN `Customer` c ON c.id=m.customerId
             LEFT JOIN `User` u ON u.id=m.userId
             LEFT JOIN `User` a ON a.id=m.assignedToId
             $w ORDER BY m.meetingDate DESC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $items = array_map([$this, 'shape'], $s2->fetchAll());
        // Photo / file / voice-note counts for the list badges.
        $counts = class_exists('MeetingAttachmentController') ? MeetingAttachmentController::counts(array_column($items, 'id')) : [];
        foreach ($items as &$it) $it['attachmentCounts'] = $counts[$it['id']] ?? new stdClass();
        unset($it);
        sendPaginated($items, $total, $page, $limit, 'Meetings fetched');
    }

    // GET /api/meetings/today-followups
    public function todayFollowups(): void
    {
        $auth = authenticate();
        $isAdmin = is_admin_tier($auth['role']);
        $start = start_of_day(); $end = start_of_day_plus(1);
        $extra = $isAdmin ? '' : 'AND m.userId=?';
        $params = $isAdmin ? [$start,$end] : [$start,$end,$auth['id']];
        $s = db()->prepare(
            "SELECT m.*, c.id AS c_id, c.companyName, c.contactPerson, c.contactNumber, c.lat AS c_lat, c.lng AS c_lng,
                    u.id AS u_id, u.name AS u_name
             FROM `Meeting` m
             LEFT JOIN `Customer` c ON c.id=m.customerId
             LEFT JOIN `User` u ON u.id=m.userId
             WHERE m.nextFollowUp>=? AND m.nextFollowUp<? $extra
             ORDER BY m.nextFollowUp ASC"
        );
        $s->execute($params);
        $meetings = array_map([$this, 'shape'], $s->fetchAll());
        sendSuccess(['meetings' => $meetings, 'count' => count($meetings)]);
    }

    // GET /api/meetings/alerts
    public function alerts(): void
    {
        $auth = authenticate();
        $s = db()->prepare(
            "SELECT fa.*, m.customerId, m.meetingDate, m.nextFollowUp, m.status AS meeting_status,
                    c.companyName
             FROM `FollowUpAlert` fa
             LEFT JOIN `Meeting` m ON m.id=fa.meetingId
             LEFT JOIN `Customer` c ON c.id=m.customerId
             WHERE fa.userId=? AND fa.isRead=0
             ORDER BY fa.createdAt DESC LIMIT 50"
        );
        $s->execute([$auth['id']]);
        $rows = $s->fetchAll();
        $alerts = array_map(function($r) {
            $r['isRead'] = (bool)$r['isRead'];
            $r['meeting'] = [
                'id'          => $r['meetingId'],
                'customerId'  => $r['customerId'],
                'meetingDate' => $r['meetingDate'],
                'nextFollowUp'=> $r['nextFollowUp'],
                'status'      => $r['meeting_status'],
                'customer'    => ['companyName' => $r['companyName']],
            ];
            foreach (['customerId','meetingDate','nextFollowUp','meeting_status','companyName'] as $k) unset($r[$k]);
            return $r;
        }, $rows);
        sendSuccess(['alerts' => $alerts, 'count' => count($alerts)]);
    }

    // PATCH /api/meetings/alerts/:id/read
    public function markAlertRead(string $id): void
    {
        authenticate();
        db()->prepare('UPDATE `FollowUpAlert` SET isRead=1 WHERE id=?')->execute([$id]);
        sendSuccess([], 'Alert marked as read');
    }

    // GET /api/meetings/:id
    public function show(string $id): void
    {
        authenticate();
        $s = db()->prepare(
            "SELECT m.*,
                    c.id AS c_id, c.companyName, c.contactPerson, c.contactNumber, c.email AS c_email,
                    c.location AS c_location, c.address AS c_address, c.lat AS c_lat, c.lng AS c_lng,
                    c.geoFenceRadius, c.status AS c_status, c.category AS c_category,
                    u.id AS u_id, u.name AS u_name, u.email AS u_email,
                    a.id AS a_id, a.name AS a_name
             FROM `Meeting` m
             LEFT JOIN `Customer` c ON c.id=m.customerId
             LEFT JOIN `User` u ON u.id=m.userId
             LEFT JOIN `User` a ON a.id=m.assignedToId
             WHERE m.id=? LIMIT 1"
        );
        $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) sendError('Meeting not found.', 404);

        $as = db()->prepare(
            'SELECT * FROM `FollowUpAlert` WHERE meetingId=? ORDER BY createdAt DESC LIMIT 10'
        );
        $as->execute([$id]);
        $alerts = $as->fetchAll();

        $meeting = $this->shape($row);
        $meeting['customer'] = [
            'id'            => $row['c_id'],
            'companyName'   => $row['c_id'] ? $row['companyName'] : null,
            'contactPerson' => $row['contactPerson'],
            'contactNumber' => $row['c_email'] !== null ? $row['contactNumber'] : ($row['contactNumber'] ?? null),
            'email'         => $row['c_email'],
            'location'      => $row['c_location'],
            'address'       => $row['c_address'],
            'lat'           => $row['c_lat'] !== null ? (float)$row['c_lat'] : null,
            'lng'           => $row['c_lng'] !== null ? (float)$row['c_lng'] : null,
            'geoFenceRadius'=> (int)($row['geoFenceRadius'] ?? 200),
            'status'        => $row['c_status'],
            'category'      => $row['c_category'],
        ];
        $meeting['followUpAlerts'] = $alerts;
        sendSuccess(['meeting' => $meeting]);
    }

    // POST /api/meetings
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();
        $customerId  = $b['customerId'] ?? '';
        $meetingDate = $b['meetingDate'] ?? '';
        $meetingType = $b['meetingType'] ?? '';
        if (!$customerId || !$meetingDate || !$meetingType)
            sendError('Customer, date, and type are required.', 400);
        if (!in_array($meetingType, self::VALID_TYPES))
            sendError('Invalid meeting type.', 400);
        $status = $b['status'] ?? 'NEW_LEAD';
        if (!in_array($status, self::VALID_STATUSES))
            sendError('Invalid status.', 400);

        $cs = db()->prepare('SELECT companyName FROM `Customer` WHERE id=? LIMIT 1');
        $cs->execute([$customerId]);
        $customer = $cs->fetch();
        if (!$customer) sendError('Customer not found.', 404);

        $id = gen_id();
        $nfu = to_dt($b['nextFollowUp'] ?? null);
        db()->prepare(
            'INSERT INTO `Meeting`
             (id,customerId,userId,assignedToId,meetingDate,meetingType,status,
              notes,summary,actionItems,customerRequirements,competitorInfo,opportunities,
              nextFollowUp,followUpTime,followUpPriority,
              trialDate,trialStatus,trialFeedback,quotationDate,quotationStatus,
              createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $id, $customerId, $auth['id'],
            ($b['assignedToId'] ?? null) ?: null,
            to_dt($meetingDate), $meetingType, $status,
            $b['notes'] ?? null, $b['summary'] ?? null,
            $b['actionItems'] ?? null, $b['customerRequirements'] ?? null,
            $b['competitorInfo'] ?? null, $b['opportunities'] ?? null,
            $nfu,
            $b['followUpTime'] ?? null,
            $b['followUpPriority'] ?? 'MEDIUM',
            to_dt($b['trialDate'] ?? null),
            $b['trialStatus'] ?? null, $b['trialFeedback'] ?? null,
            to_dt($b['quotationDate'] ?? null), $b['quotationStatus'] ?? null,
            now_sql(), now_sql(),
        ]);

        if ($nfu) $this->scheduleAlerts($id, $auth['id'], $nfu);

        $assignedToId = ($b['assignedToId'] ?? null) ?: null;
        if ($assignedToId) $this->notifyAssignment($id, $assignedToId, $auth['id'], $customer['companyName']);

        log_activity($auth['id'], 'MEETING_CREATED', 'Meeting', $id,
            ['customer' => $customer['companyName'], 'type' => $meetingType]);
        $this->show($id);
    }

    // PUT /api/meetings/:id
    public function update(string $id): void
    {
        $auth = authenticate();
        $b = request_body();
        $isAdmin = is_admin_tier($auth['role']);

        $s = db()->prepare('SELECT * FROM `Meeting` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        $existing = $s->fetch();
        if (!$existing) sendError('Meeting not found.', 404);
        if (!$isAdmin && $existing['userId'] !== $auth['id'])
            sendError('Can only edit your own meetings.', 403);

        $sets = []; $params = [];
        $maybe = function($key, $col) use ($b, &$sets, &$params) {
            if (!empty($b[$key])) { $sets[] = "$col=?"; $params[] = $b[$key]; }
        };
        $maybe('meetingType', 'meetingType');
        if (!empty($b['meetingDate']))    { $sets[]='meetingDate=?';  $params[]=to_dt($b['meetingDate']); }
        if (!empty($b['status']))         { $sets[]='status=?';       $params[]=$b['status']; }
        foreach (['notes','summary','actionItems','customerRequirements','competitorInfo','opportunities',
                  'trialStatus','trialFeedback','quotationStatus'] as $f) {
            if (array_key_exists($f,$b)) { $sets[]="$f=?"; $params[]=$b[$f]; }
        }
        $nfu = isset($b['nextFollowUp']) ? to_dt($b['nextFollowUp']) : null;
        if ($nfu !== null)                 { $sets[]='nextFollowUp=?';     $params[]=$nfu; }
        if (array_key_exists('followUpTime',$b))     { $sets[]='followUpTime=?';     $params[]=$b['followUpTime']; }
        if (!empty($b['followUpPriority']))           { $sets[]='followUpPriority=?'; $params[]=$b['followUpPriority']; }
        if (array_key_exists('assignedToId',$b))     { $sets[]='assignedToId=?';     $params[]=($b['assignedToId'] ?: null); }
        if (isset($b['trialDate']))        { $sets[]='trialDate=?';       $params[]=to_dt($b['trialDate']); }
        if (isset($b['quotationDate']))    { $sets[]='quotationDate=?';   $params[]=to_dt($b['quotationDate']); }

        if ($sets) {
            $sets[] = 'updatedAt=?'; $params[] = now_sql(); $params[] = $id;
            db()->prepare('UPDATE `Meeting` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        }

        if ($nfu && $nfu !== $existing['nextFollowUp']) {
            db()->prepare('DELETE FROM `FollowUpAlert` WHERE meetingId=? AND isRead=0')->execute([$id]);
            $this->scheduleAlerts($id, $existing['userId'], $nfu);
        }

        if (array_key_exists('assignedToId', $b)) {
            $newAssignee = $b['assignedToId'] ?: null;
            if ($newAssignee && $newAssignee !== $existing['assignedToId']) {
                $cs = db()->prepare('SELECT companyName FROM `Customer` WHERE id=? LIMIT 1');
                $cs->execute([$existing['customerId']]);
                $companyName = $cs->fetch()['companyName'] ?? null;
                $this->notifyAssignment($id, $newAssignee, $auth['id'], $companyName);
            }
        }

        $this->show($id);
    }

    // POST /api/meetings/:id/checkin
    public function checkIn(string $id): void
    {
        authenticate();
        $b = request_body();
        $lat = $b['lat'] ?? null; $lng = $b['lng'] ?? null;
        if ($lat === null || $lng === null) sendError('GPS coordinates required.', 400);

        $s = db()->prepare(
            'SELECT m.*, c.lat AS c_lat, c.lng AS c_lng, c.geoFenceRadius, c.companyName
             FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId
             WHERE m.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $meeting = $s->fetch();
        if (!$meeting) sendError('Meeting not found.', 404);
        if ($meeting['checkedInAt']) sendError('Already checked in for this meeting.', 400);

        $distance = null; $isGeoVerified = false;
        if ($meeting['c_lat'] !== null && $meeting['c_lng'] !== null) {
            $distance = (int)round($this->haversine((float)$lat, (float)$lng, (float)$meeting['c_lat'], (float)$meeting['c_lng']));
            $radius   = (int)($meeting['geoFenceRadius'] ?? 200);
            $isGeoVerified = $distance <= $radius;
            if (!$isGeoVerified)
                sendError("You are {$distance}m away from {$meeting['companyName']}. Check-in is only allowed within {$radius}m.", 400);
        }

        $newStatus = $meeting['status'] === 'NEW_LEAD' ? 'FOLLOW_UP_PENDING' : $meeting['status'];
        db()->prepare(
            'UPDATE `Meeting` SET checkInLat=?,checkInLng=?,checkInDistance=?,checkedInAt=?,
             isGeoVerified=?,timerStartedAt=?,status=?,updatedAt=? WHERE id=?'
        )->execute([(float)$lat,(float)$lng,$distance,now_sql(),(int)$isGeoVerified,now_sql(),$newStatus,now_sql(),$id]);

        $s2 = db()->prepare('SELECT * FROM `Meeting` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['meeting' => $s2->fetch(), 'distance' => $distance, 'isGeoVerified' => $isGeoVerified], 'Checked in successfully');
    }

    // PATCH /api/meetings/:id/timer
    public function timer(string $id): void
    {
        authenticate();
        $b = request_body();
        $action = $b['action'] ?? '';
        $s = db()->prepare('SELECT * FROM `Meeting` WHERE id=? LIMIT 1'); $s->execute([$id]);
        $m = $s->fetch();
        if (!$m) sendError('Meeting not found.', 404);

        $now = now_sql();
        $sets = []; $params = [];

        if ($action === 'start' && !$m['timerStartedAt']) {
            $sets[] = 'timerStartedAt=?'; $params[] = $now;
        } elseif ($action === 'pause' && $m['timerStartedAt'] && !$m['timerEndedAt']) {
            $startTs = strtotime($m['timerStartedAt']);
            $elapsed = (int)(time() - $startTs) - (int)$m['timerPausedSeconds'];
            $sets[] = 'timerPausedSeconds=?'; $params[] = (int)$m['timerPausedSeconds'] + $elapsed;
            $sets[] = 'timerStartedAt=?'; $params[] = $now;
        } elseif ($action === 'stop') {
            $totalSec = $m['timerStartedAt']
                ? max(0, (int)(time() - strtotime($m['timerStartedAt'])) - (int)$m['timerPausedSeconds'])
                : 0;
            $sets[] = 'timerEndedAt=?';         $params[] = $now;
            $sets[] = 'visitDurationMinutes=?';  $params[] = (int)round($totalSec / 60);
        }

        if ($sets) {
            $sets[] = 'updatedAt=?'; $params[] = $now; $params[] = $id;
            db()->prepare('UPDATE `Meeting` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        }
        $s2 = db()->prepare('SELECT * FROM `Meeting` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['meeting' => $s2->fetch()], "Timer {$action}ed");
    }

    // Superseded by MeetingAttachmentController (the route now points there):
    // this version accepted any file type into the public uploads folder.
    // Kept only for reference; not routed.
    public function uploadAttachment(string $id): void
    {
        sendError('Use /api/meetings/:id/attachments (MeetingAttachmentController).', 410);
        authenticate();
        if (empty($_FILES['file'])) sendError('No file uploaded.', 400);
        $s = db()->prepare('SELECT attachments FROM `Meeting` WHERE id=? LIMIT 1'); $s->execute([$id]);
        $meeting = $s->fetch();
        if (!$meeting) sendError('Meeting not found.', 404);

        $file   = $_FILES['file'];
        $safeName = time() . '-' . preg_replace('/\s+/', '_', basename($file['name']));
        $dest   = UPLOADS_PATH . '/meetings/' . $safeName;
        if (!move_uploaded_file($file['tmp_name'], $dest)) sendError('Upload failed.', 500);

        $existing = $meeting['attachments'] ? json_decode($meeting['attachments'], true) : [];
        $fileInfo = [
            'filename'     => $safeName,
            'originalname' => $file['name'],
            'mimetype'     => $file['type'],
            'size'         => $file['size'],
            'url'          => '/uploads/meetings/' . $safeName,
            'uploadedAt'   => date('c'),
        ];
        $existing[] = $fileInfo;
        db()->prepare('UPDATE `Meeting` SET attachments=?,updatedAt=? WHERE id=?')
          ->execute([json_encode($existing), now_sql(), $id]);
        sendSuccess(['file' => $fileInfo], 'File uploaded');
    }

    // GET /api/meetings/customer/:customerId/visits
    public function customerVisits(string $customerId): void
    {
        authenticate();
        $s = db()->prepare(
            'SELECT m.*, u.name AS u_name FROM `Meeting` m LEFT JOIN `User` u ON u.id=m.userId
             WHERE m.customerId=? AND m.checkedInAt IS NOT NULL
             ORDER BY m.checkedInAt DESC LIMIT 50'
        );
        $s->execute([$customerId]);
        $visits = array_map(function($r) {
            $r['user'] = ['name' => $r['u_name']]; unset($r['u_name']); return $r;
        }, $s->fetchAll());
        sendSuccess(['visits' => $visits, 'count' => count($visits)]);
    }

    // GET /api/meetings/export
    public function export(): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->query(
            'SELECT m.meetingDate,c.companyName,c.contactPerson,m.meetingType,m.status,
                    u.name AS salesPerson, m.notes, m.nextFollowUp, m.visitDurationMinutes
             FROM `Meeting` m
             LEFT JOIN `Customer` c ON c.id=m.customerId
             LEFT JOIN `User` u ON u.id=m.userId
             ORDER BY m.meetingDate DESC LIMIT 5000'
        );
        $rows = $s->fetchAll();
        $w = new XlsxWriter('Meetings');
        $w->addRow(['Date','Company','Contact','Type','Status','Sales Person','Notes','Next Follow-up','Duration (min)']);
        foreach ($rows as $r) {
            $w->addRow([
                $r['meetingDate'], $r['companyName'], $r['contactPerson'],
                $r['meetingType'], $r['status'], $r['salesPerson'],
                $r['notes'], $r['nextFollowUp'], $r['visitDurationMinutes'],
            ]);
        }
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="meetings-export.xlsx"');
        echo $w->output(); exit;
    }

    // ── Private helpers ───────────────────────────────────────────────
    private function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $R = 6371000;
        $dLat = ($lat2-$lat1)*M_PI/180;
        $dLng = ($lng2-$lng1)*M_PI/180;
        $a = sin($dLat/2)**2 + cos($lat1*M_PI/180)*cos($lat2*M_PI/180)*sin($dLng/2)**2;
        return $R*2*atan2(sqrt($a), sqrt(1-$a));
    }

    private function scheduleAlerts(string $meetingId, string $userId, string $followUpSql): void
    {
        $now = time();
        $fuTs = strtotime($followUpSql);
        $alerts = [];
        if (($fuTs - 86400) > $now)        $alerts[] = 'UPCOMING_24H';
        if (($fuTs - 0) > $now)            $alerts[] = 'UPCOMING_SAME_DAY';
        if ($fuTs < $now)                  $alerts[] = 'OVERDUE';
        foreach ($alerts as $type) {
            try {
                $s = db()->prepare('SELECT id FROM `FollowUpAlert` WHERE meetingId=? AND userId=? AND alertType=? LIMIT 1');
                $s->execute([$meetingId,$userId,$type]);
                if ($s->fetch()) continue;
                db()->prepare(
                    'INSERT INTO `FollowUpAlert` (id,meetingId,userId,alertType,isRead,createdAt) VALUES (?,?,?,?,0,?)'
                )->execute([gen_id(),$meetingId,$userId,$type,now_sql()]);
            } catch (\Throwable $e) { /* skip duplicates */ }
        }
    }

    private function notifyAssignment(string $meetingId, string $assignedToId, string $assignedById, ?string $companyName = null): void
    {
        if (!$assignedToId || $assignedToId === $assignedById) return; // no self-assign alert
        try {
            db()->prepare(
                'INSERT INTO `FollowUpAlert` (id,meetingId,userId,alertType,isRead,createdAt) VALUES (?,?,?,?,0,?)'
            )->execute([gen_id(), $meetingId, $assignedToId, 'TASK_ASSIGNED', now_sql()]);
            log_activity($assignedById, 'MEETING_ASSIGNED', 'Meeting', $meetingId,
                ['assignedTo' => $assignedToId, 'customer' => $companyName]);
        } catch (\Throwable $e) { /* non-fatal, don't block the request */ }
    }

    private function shape(array $row): array
    {
        foreach (['isGeoVerified','reminderSent'] as $k) {
            if (array_key_exists($k,$row)) $row[$k] = (bool)$row[$k];
        }
        $row['customer'] = [
            'id'            => $row['c_id']   ?? $row['customerId'],
            'companyName'   => $row['companyName'] ?? null,
            'contactPerson' => $row['contactPerson'] ?? null,
            'lat'           => isset($row['c_lat']) && $row['c_lat'] !== null ? (float)$row['c_lat'] : null,
            'lng'           => isset($row['c_lng']) && $row['c_lng'] !== null ? (float)$row['c_lng'] : null,
        ];
        $row['user']       = ['id' => $row['u_id'] ?? null, 'name' => $row['u_name'] ?? null];
        $row['assignedTo'] = ($row['a_id'] ?? null) ? ['id' => $row['a_id'], 'name' => $row['a_name']] : null;
        foreach (['c_id','companyName','contactPerson','c_lat','c_lng','u_id','u_name','a_id','a_name'] as $k) unset($row[$k]);
        return $row;
    }
}




























// class MeetingController
// {
//     private const VALID_STATUSES = [
//         'NEW_LEAD','FOLLOW_UP_PENDING','TRIAL_PLANNED','TRIAL_COMPLETED',
//         'QUOTATION_SUBMITTED','WAITING_APPROVAL','NEGOTIATION','PURCHASE_ORDER',
//         'TECHNICAL_DISCUSSION_COMPLETED','PENDING_CUSTOMER_RESPONSE','LOST','CLOSED',
//     ];
//     private const VALID_TYPES = [
//         'VISIT','CALL','ONLINE','TRIAL_SUPPORT','QUOTATION_DISCUSSION','TECHNICAL_DISCUSSION',
//     ];

//     // GET /api/meetings
//     public function index(): void
//     {
//         $auth = authenticate();
//         [$page, $limit, $offset] = paginate(20);
//         $isAdmin = is_admin_tier($auth['role']);

//         $where = []; $params = [];
//         if (!$isAdmin) { $where[] = 'm.userId=?'; $params[] = $auth['id']; }
//         if (qp('userId') && $isAdmin)           { $where[] = 'm.userId=?';      $params[] = qp('userId'); }
//         // "Updated by" (last editor) is a distinct concept from "userId" (owner/logged-by) — see
//         // migration_meeting_updated_by.sql. Admin-only, same reasoning as the owner filter above:
//         // non-admins only ever see their own meetings regardless, so the filter would be moot for them.
//         if (qp('updatedById') && $isAdmin)      { $where[] = 'm.updatedById=?'; $params[] = qp('updatedById'); }
//         if (qp('customerId'))                   { $where[] = 'm.customerId=?';  $params[] = qp('customerId'); }
//         if (qp('status'))                       { $where[] = 'm.status=?';      $params[] = qp('status'); }
//         if (qp('type'))                         { $where[] = 'm.meetingType=?'; $params[] = qp('type'); }
//         if (qp('assignedToMe') === 'true')      { $where[] = 'm.assignedToId=?';$params[] = $auth['id']; }
//         if (qp('overdueOnly') === 'true') {
//             $where[] = 'm.nextFollowUp < ?';    $params[] = now_sql();
//             $where[] = "m.status NOT IN ('CLOSED','LOST')";
//         }
//         if (qp('search')) {
//             $where[] = '(c.companyName LIKE ? OR c.contactPerson LIKE ?)';
//             $needle = '%' . qp('search') . '%';
//             $params[] = $needle; $params[] = $needle;
//         }
//         if (qp('dateFrom')) { $where[] = 'm.meetingDate >= ?'; $params[] = qp('dateFrom') . ' 00:00:00'; }
//         if (qp('dateTo'))   { $where[] = 'm.meetingDate <= ?'; $params[] = qp('dateTo') . ' 23:59:59'; }
//         $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

//         $s = db()->prepare(
//             "SELECT COUNT(*) FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId $w"
//         );
//         $s->execute($params);
//         $total = (int)$s->fetchColumn();

//         $s2 = db()->prepare(
//             "SELECT m.*,
//                     c.id AS c_id, c.companyName, c.contactPerson, c.lat AS c_lat, c.lng AS c_lng,
//                     u.id AS u_id, u.name AS u_name,
//                     a.id AS a_id, a.name AS a_name,
//                     ub.id AS ub_id, ub.name AS ub_name
//              FROM `Meeting` m
//              LEFT JOIN `Customer` c ON c.id=m.customerId
//              LEFT JOIN `User` u ON u.id=m.userId
//              LEFT JOIN `User` a ON a.id=m.assignedToId
//              LEFT JOIN `User` ub ON ub.id=m.updatedById
//              $w ORDER BY m.meetingDate DESC LIMIT ? OFFSET ?"
//         );
//         $s2->execute(array_merge($params, [$limit, $offset]));
//         $items = array_map([$this, 'shape'], $s2->fetchAll());
//         sendPaginated($items, $total, $page, $limit, 'Meetings fetched');
//     }

//     // GET /api/meetings/today-followups
//     public function todayFollowups(): void
//     {
//         $auth = authenticate();
//         $isAdmin = is_admin_tier($auth['role']);
//         $start = start_of_day(); $end = start_of_day_plus(1);
//         $extra = $isAdmin ? '' : 'AND m.userId=?';
//         $params = $isAdmin ? [$start,$end] : [$start,$end,$auth['id']];
//         if ($isAdmin && qp('updatedById')) {
//             $extra .= ' AND m.updatedById=?';
//             $params[] = qp('updatedById');
//         }
//         $s = db()->prepare(
//             "SELECT m.*, c.id AS c_id, c.companyName, c.contactPerson, c.contactNumber, c.lat AS c_lat, c.lng AS c_lng,
//                     u.id AS u_id, u.name AS u_name,
//                     ub.id AS ub_id, ub.name AS ub_name
//              FROM `Meeting` m
//              LEFT JOIN `Customer` c ON c.id=m.customerId
//              LEFT JOIN `User` u ON u.id=m.userId
//              LEFT JOIN `User` ub ON ub.id=m.updatedById
//              WHERE m.nextFollowUp>=? AND m.nextFollowUp<? $extra
//              ORDER BY m.nextFollowUp ASC"
//         );
//         $s->execute($params);
//         $meetings = array_map([$this, 'shape'], $s->fetchAll());
//         sendSuccess(['meetings' => $meetings, 'count' => count($meetings)]);
//     }

//     // GET /api/meetings/alerts
//     public function alerts(): void
//     {
//         $auth = authenticate();
//         $s = db()->prepare(
//             "SELECT fa.*, m.customerId, m.meetingDate, m.nextFollowUp, m.status AS meeting_status,
//                     c.companyName
//              FROM `FollowUpAlert` fa
//              LEFT JOIN `Meeting` m ON m.id=fa.meetingId
//              LEFT JOIN `Customer` c ON c.id=m.customerId
//              WHERE fa.userId=? AND fa.isRead=0
//              ORDER BY fa.createdAt DESC LIMIT 50"
//         );
//         $s->execute([$auth['id']]);
//         $rows = $s->fetchAll();
//         $alerts = array_map(function($r) {
//             $r['isRead'] = (bool)$r['isRead'];
//             $r['meeting'] = [
//                 'id'          => $r['meetingId'],
//                 'customerId'  => $r['customerId'],
//                 'meetingDate' => $r['meetingDate'],
//                 'nextFollowUp'=> $r['nextFollowUp'],
//                 'status'      => $r['meeting_status'],
//                 'customer'    => ['companyName' => $r['companyName']],
//             ];
//             foreach (['customerId','meetingDate','nextFollowUp','meeting_status','companyName'] as $k) unset($r[$k]);
//             return $r;
//         }, $rows);
//         sendSuccess(['alerts' => $alerts, 'count' => count($alerts)]);
//     }

//     // PATCH /api/meetings/alerts/:id/read
//     public function markAlertRead(string $id): void
//     {
//         authenticate();
//         db()->prepare('UPDATE `FollowUpAlert` SET isRead=1 WHERE id=?')->execute([$id]);
//         sendSuccess([], 'Alert marked as read');
//     }

//     // GET /api/meetings/:id
//     public function show(string $id): void
//     {
//         authenticate();
//         $s = db()->prepare(
//             "SELECT m.*,
//                     c.id AS c_id, c.companyName, c.contactPerson, c.contactNumber, c.email AS c_email,
//                     c.location AS c_location, c.address AS c_address, c.lat AS c_lat, c.lng AS c_lng,
//                     c.geoFenceRadius, c.status AS c_status, c.category AS c_category,
//                     u.id AS u_id, u.name AS u_name, u.email AS u_email,
//                     a.id AS a_id, a.name AS a_name,
//                     ub.id AS ub_id, ub.name AS ub_name
//              FROM `Meeting` m
//              LEFT JOIN `Customer` c ON c.id=m.customerId
//              LEFT JOIN `User` u ON u.id=m.userId
//              LEFT JOIN `User` a ON a.id=m.assignedToId
//              LEFT JOIN `User` ub ON ub.id=m.updatedById
//              WHERE m.id=? LIMIT 1"
//         );
//         $s->execute([$id]);
//         $row = $s->fetch();
//         if (!$row) sendError('Meeting not found.', 404);

//         $as = db()->prepare(
//             'SELECT * FROM `FollowUpAlert` WHERE meetingId=? ORDER BY createdAt DESC LIMIT 10'
//         );
//         $as->execute([$id]);
//         $alerts = $as->fetchAll();

//         $meeting = $this->shape($row);
//         $meeting['customer'] = [
//             'id'            => $row['c_id'],
//             'companyName'   => $row['c_id'] ? $row['companyName'] : null,
//             'contactPerson' => $row['contactPerson'],
//             'contactNumber' => $row['c_email'] !== null ? $row['contactNumber'] : ($row['contactNumber'] ?? null),
//             'email'         => $row['c_email'],
//             'location'      => $row['c_location'],
//             'address'       => $row['c_address'],
//             'lat'           => $row['c_lat'] !== null ? (float)$row['c_lat'] : null,
//             'lng'           => $row['c_lng'] !== null ? (float)$row['c_lng'] : null,
//             'geoFenceRadius'=> (int)($row['geoFenceRadius'] ?? 200),
//             'status'        => $row['c_status'],
//             'category'      => $row['c_category'],
//         ];
//         $meeting['followUpAlerts'] = $alerts;
//         sendSuccess(['meeting' => $meeting]);
//     }

//     // POST /api/meetings
//     public function create(): void
//     {
//         $auth = authenticate();
//         $b = request_body();
//         $customerId  = $b['customerId'] ?? '';
//         $meetingDate = $b['meetingDate'] ?? '';
//         $meetingType = $b['meetingType'] ?? '';
//         if (!$customerId || !$meetingDate || !$meetingType)
//             sendError('Customer, date, and type are required.', 400);
//         if (!in_array($meetingType, self::VALID_TYPES))
//             sendError('Invalid meeting type.', 400);
//         $status = $b['status'] ?? 'NEW_LEAD';
//         if (!in_array($status, self::VALID_STATUSES))
//             sendError('Invalid status.', 400);

//         $cs = db()->prepare('SELECT companyName FROM `Customer` WHERE id=? LIMIT 1');
//         $cs->execute([$customerId]);
//         $customer = $cs->fetch();
//         if (!$customer) sendError('Customer not found.', 404);

//         $id = gen_id();
//         $nfu = to_dt($b['nextFollowUp'] ?? null);
//         db()->prepare(
//             'INSERT INTO `Meeting`
//              (id,customerId,userId,assignedToId,meetingDate,meetingType,status,
//               notes,summary,actionItems,customerRequirements,competitorInfo,opportunities,
//               nextFollowUp,followUpTime,followUpPriority,
//               trialDate,trialStatus,trialFeedback,quotationDate,quotationStatus,
//               createdAt,updatedAt)
//              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
//         )->execute([
//             $id, $customerId, $auth['id'],
//             ($b['assignedToId'] ?? null) ?: null,
//             to_dt($meetingDate), $meetingType, $status,
//             $b['notes'] ?? null, $b['summary'] ?? null,
//             $b['actionItems'] ?? null, $b['customerRequirements'] ?? null,
//             $b['competitorInfo'] ?? null, $b['opportunities'] ?? null,
//             $nfu,
//             $b['followUpTime'] ?? null,
//             $b['followUpPriority'] ?? 'MEDIUM',
//             to_dt($b['trialDate'] ?? null),
//             $b['trialStatus'] ?? null, $b['trialFeedback'] ?? null,
//             to_dt($b['quotationDate'] ?? null), $b['quotationStatus'] ?? null,
//             now_sql(), now_sql(),
//         ]);

//         if ($nfu) $this->scheduleAlerts($id, $auth['id'], $nfu);

//         $assignedToId = ($b['assignedToId'] ?? null) ?: null;
//         if ($assignedToId) $this->notifyAssignment($id, $assignedToId, $auth['id'], $customer['companyName']);

//         log_activity($auth['id'], 'MEETING_CREATED', 'Meeting', $id,
//             ['customer' => $customer['companyName'], 'type' => $meetingType]);
//         $this->show($id);
//     }

//     // PUT /api/meetings/:id
//     public function update(string $id): void
//     {
//         $auth = authenticate();
//         $b = request_body();
//         $isAdmin = is_admin_tier($auth['role']);

//         $s = db()->prepare('SELECT * FROM `Meeting` WHERE id=? LIMIT 1');
//         $s->execute([$id]);
//         $existing = $s->fetch();
//         if (!$existing) sendError('Meeting not found.', 404);
//         if (!$isAdmin && $existing['userId'] !== $auth['id'])
//             sendError('Can only edit your own meetings.', 403);

//         $sets = []; $params = [];
//         $maybe = function($key, $col) use ($b, &$sets, &$params) {
//             if (!empty($b[$key])) { $sets[] = "$col=?"; $params[] = $b[$key]; }
//         };
//         $maybe('meetingType', 'meetingType');
//         if (!empty($b['meetingDate']))    { $sets[]='meetingDate=?';  $params[]=to_dt($b['meetingDate']); }
//         if (!empty($b['status']))         { $sets[]='status=?';       $params[]=$b['status']; }
//         foreach (['notes','summary','actionItems','customerRequirements','competitorInfo','opportunities',
//                   'trialStatus','trialFeedback','quotationStatus'] as $f) {
//             if (array_key_exists($f,$b)) { $sets[]="$f=?"; $params[]=$b[$f]; }
//         }
//         $nfu = isset($b['nextFollowUp']) ? to_dt($b['nextFollowUp']) : null;
//         if ($nfu !== null)                 { $sets[]='nextFollowUp=?';     $params[]=$nfu; }
//         if (array_key_exists('followUpTime',$b))     { $sets[]='followUpTime=?';     $params[]=$b['followUpTime']; }
//         if (!empty($b['followUpPriority']))           { $sets[]='followUpPriority=?'; $params[]=$b['followUpPriority']; }
//         if (array_key_exists('assignedToId',$b))     { $sets[]='assignedToId=?';     $params[]=($b['assignedToId'] ?: null); }
//         if (isset($b['trialDate']))        { $sets[]='trialDate=?';       $params[]=to_dt($b['trialDate']); }
//         if (isset($b['quotationDate']))    { $sets[]='quotationDate=?';   $params[]=to_dt($b['quotationDate']); }

//         if ($sets) {
//             // Column names touched by this request (before the bookkeeping columns below are appended) — this
//             // becomes the audit-log detail, e.g. {"fields":["status","notes","nextFollowUp"]}.
//             $changedFields = array_map(fn($set) => explode('=', $set)[0], $sets);

//             $sets[] = 'updatedById=?'; $params[] = $auth['id'];
//             $sets[] = 'updatedAt=?';   $params[] = now_sql();
//             $params[] = $id;
//             db()->prepare('UPDATE `Meeting` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
//             log_activity($auth['id'], 'MEETING_UPDATED', 'Meeting', $id, ['fields' => $changedFields]);
//         }

//         if ($nfu && $nfu !== $existing['nextFollowUp']) {
//             db()->prepare('DELETE FROM `FollowUpAlert` WHERE meetingId=? AND isRead=0')->execute([$id]);
//             $this->scheduleAlerts($id, $existing['userId'], $nfu);
//         }

//         if (array_key_exists('assignedToId', $b)) {
//             $newAssignee = $b['assignedToId'] ?: null;
//             if ($newAssignee && $newAssignee !== $existing['assignedToId']) {
//                 $cs = db()->prepare('SELECT companyName FROM `Customer` WHERE id=? LIMIT 1');
//                 $cs->execute([$existing['customerId']]);
//                 $companyName = $cs->fetch()['companyName'] ?? null;
//                 $this->notifyAssignment($id, $newAssignee, $auth['id'], $companyName);
//             }
//         }

//         $this->show($id);
//     }

//     // POST /api/meetings/:id/checkin
//     public function checkIn(string $id): void
//     {
//         authenticate();
//         $b = request_body();
//         $lat = $b['lat'] ?? null; $lng = $b['lng'] ?? null;
//         if ($lat === null || $lng === null) sendError('GPS coordinates required.', 400);

//         $s = db()->prepare(
//             'SELECT m.*, c.lat AS c_lat, c.lng AS c_lng, c.geoFenceRadius, c.companyName
//              FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId
//              WHERE m.id=? LIMIT 1'
//         );
//         $s->execute([$id]);
//         $meeting = $s->fetch();
//         if (!$meeting) sendError('Meeting not found.', 404);
//         if ($meeting['checkedInAt']) sendError('Already checked in for this meeting.', 400);

//         $distance = null; $isGeoVerified = false;
//         if ($meeting['c_lat'] !== null && $meeting['c_lng'] !== null) {
//             $distance = (int)round($this->haversine((float)$lat, (float)$lng, (float)$meeting['c_lat'], (float)$meeting['c_lng']));
//             $radius   = (int)($meeting['geoFenceRadius'] ?? 200);
//             $isGeoVerified = $distance <= $radius;
//             if (!$isGeoVerified)
//                 sendError("You are {$distance}m away from {$meeting['companyName']}. Check-in is only allowed within {$radius}m.", 400);
//         }

//         $newStatus = $meeting['status'] === 'NEW_LEAD' ? 'FOLLOW_UP_PENDING' : $meeting['status'];
//         db()->prepare(
//             'UPDATE `Meeting` SET checkInLat=?,checkInLng=?,checkInDistance=?,checkedInAt=?,
//              isGeoVerified=?,timerStartedAt=?,status=?,updatedAt=? WHERE id=?'
//         )->execute([(float)$lat,(float)$lng,$distance,now_sql(),(int)$isGeoVerified,now_sql(),$newStatus,now_sql(),$id]);

//         $s2 = db()->prepare('SELECT * FROM `Meeting` WHERE id=? LIMIT 1'); $s2->execute([$id]);
//         sendSuccess(['meeting' => $s2->fetch(), 'distance' => $distance, 'isGeoVerified' => $isGeoVerified], 'Checked in successfully');
//     }

//     // PATCH /api/meetings/:id/timer
//     public function timer(string $id): void
//     {
//         authenticate();
//         $b = request_body();
//         $action = $b['action'] ?? '';
//         $s = db()->prepare('SELECT * FROM `Meeting` WHERE id=? LIMIT 1'); $s->execute([$id]);
//         $m = $s->fetch();
//         if (!$m) sendError('Meeting not found.', 404);

//         $now = now_sql();
//         $sets = []; $params = [];

//         if ($action === 'start' && !$m['timerStartedAt']) {
//             $sets[] = 'timerStartedAt=?'; $params[] = $now;
//         } elseif ($action === 'pause' && $m['timerStartedAt'] && !$m['timerEndedAt']) {
//             $startTs = strtotime($m['timerStartedAt']);
//             $elapsed = (int)(time() - $startTs) - (int)$m['timerPausedSeconds'];
//             $sets[] = 'timerPausedSeconds=?'; $params[] = (int)$m['timerPausedSeconds'] + $elapsed;
//             $sets[] = 'timerStartedAt=?'; $params[] = $now;
//         } elseif ($action === 'stop') {
//             $totalSec = $m['timerStartedAt']
//                 ? max(0, (int)(time() - strtotime($m['timerStartedAt'])) - (int)$m['timerPausedSeconds'])
//                 : 0;
//             $sets[] = 'timerEndedAt=?';         $params[] = $now;
//             $sets[] = 'visitDurationMinutes=?';  $params[] = (int)round($totalSec / 60);
//         }

//         if ($sets) {
//             $sets[] = 'updatedAt=?'; $params[] = $now; $params[] = $id;
//             db()->prepare('UPDATE `Meeting` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
//         }
//         $s2 = db()->prepare('SELECT * FROM `Meeting` WHERE id=? LIMIT 1'); $s2->execute([$id]);
//         sendSuccess(['meeting' => $s2->fetch()], "Timer {$action}ed");
//     }

//     // POST /api/meetings/:id/attachments
//     public function uploadAttachment(string $id): void
//     {
//         authenticate();
//         if (empty($_FILES['file'])) sendError('No file uploaded.', 400);
//         $s = db()->prepare('SELECT attachments FROM `Meeting` WHERE id=? LIMIT 1'); $s->execute([$id]);
//         $meeting = $s->fetch();
//         if (!$meeting) sendError('Meeting not found.', 404);

//         $file   = $_FILES['file'];
//         $safeName = time() . '-' . preg_replace('/\s+/', '_', basename($file['name']));
//         $dest   = UPLOADS_PATH . '/meetings/' . $safeName;
//         if (!move_uploaded_file($file['tmp_name'], $dest)) sendError('Upload failed.', 500);

//         $existing = $meeting['attachments'] ? json_decode($meeting['attachments'], true) : [];
//         $fileInfo = [
//             'filename'     => $safeName,
//             'originalname' => $file['name'],
//             'mimetype'     => $file['type'],
//             'size'         => $file['size'],
//             'url'          => '/uploads/meetings/' . $safeName,
//             'uploadedAt'   => date('c'),
//         ];
//         $existing[] = $fileInfo;
//         db()->prepare('UPDATE `Meeting` SET attachments=?,updatedAt=? WHERE id=?')
//           ->execute([json_encode($existing), now_sql(), $id]);
//         sendSuccess(['file' => $fileInfo], 'File uploaded');
//     }

//     // GET /api/meetings/customer/:customerId/visits
//     public function customerVisits(string $customerId): void
//     {
//         authenticate();
//         $s = db()->prepare(
//             'SELECT m.*, u.name AS u_name FROM `Meeting` m LEFT JOIN `User` u ON u.id=m.userId
//              WHERE m.customerId=? AND m.checkedInAt IS NOT NULL
//              ORDER BY m.checkedInAt DESC LIMIT 50'
//         );
//         $s->execute([$customerId]);
//         $visits = array_map(function($r) {
//             $r['user'] = ['name' => $r['u_name']]; unset($r['u_name']); return $r;
//         }, $s->fetchAll());
//         sendSuccess(['visits' => $visits, 'count' => count($visits)]);
//     }

//     // GET /api/meetings/export
//     public function export(): void
//     {
//         $auth = authenticate(); require_admin($auth);
//         $s = db()->query(
//             'SELECT m.meetingDate,c.companyName,c.contactPerson,m.meetingType,m.status,
//                     u.name AS salesPerson, m.notes, m.nextFollowUp, m.visitDurationMinutes
//              FROM `Meeting` m
//              LEFT JOIN `Customer` c ON c.id=m.customerId
//              LEFT JOIN `User` u ON u.id=m.userId
//              ORDER BY m.meetingDate DESC LIMIT 5000'
//         );
//         $rows = $s->fetchAll();
//         $w = new XlsxWriter('Meetings');
//         $w->addRow(['Date','Company','Contact','Type','Status','Sales Person','Notes','Next Follow-up','Duration (min)']);
//         foreach ($rows as $r) {
//             $w->addRow([
//                 $r['meetingDate'], $r['companyName'], $r['contactPerson'],
//                 $r['meetingType'], $r['status'], $r['salesPerson'],
//                 $r['notes'], $r['nextFollowUp'], $r['visitDurationMinutes'],
//             ]);
//         }
//         header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//         header('Content-Disposition: attachment; filename="meetings-export.xlsx"');
//         echo $w->output(); exit;
//     }

//     // ── Private helpers ───────────────────────────────────────────────
//     private function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float
//     {
//         $R = 6371000;
//         $dLat = ($lat2-$lat1)*M_PI/180;
//         $dLng = ($lng2-$lng1)*M_PI/180;
//         $a = sin($dLat/2)**2 + cos($lat1*M_PI/180)*cos($lat2*M_PI/180)*sin($dLng/2)**2;
//         return $R*2*atan2(sqrt($a), sqrt(1-$a));
//     }

//     private function scheduleAlerts(string $meetingId, string $userId, string $followUpSql): void
//     {
//         $now = time();
//         $fuTs = strtotime($followUpSql);
//         $alerts = [];
//         if (($fuTs - 86400) > $now)        $alerts[] = 'UPCOMING_24H';
//         if (($fuTs - 0) > $now)            $alerts[] = 'UPCOMING_SAME_DAY';
//         if ($fuTs < $now)                  $alerts[] = 'OVERDUE';
//         foreach ($alerts as $type) {
//             try {
//                 $s = db()->prepare('SELECT id FROM `FollowUpAlert` WHERE meetingId=? AND userId=? AND alertType=? LIMIT 1');
//                 $s->execute([$meetingId,$userId,$type]);
//                 if ($s->fetch()) continue;
//                 db()->prepare(
//                     'INSERT INTO `FollowUpAlert` (id,meetingId,userId,alertType,isRead,createdAt) VALUES (?,?,?,?,0,?)'
//                 )->execute([gen_id(),$meetingId,$userId,$type,now_sql()]);
//             } catch (\Throwable $e) { /* skip duplicates */ }
//         }
//     }

//     private function notifyAssignment(string $meetingId, string $assignedToId, string $assignedById, ?string $companyName = null): void
//     {
//         if (!$assignedToId || $assignedToId === $assignedById) return; // no self-assign alert
//         try {
//             db()->prepare(
//                 'INSERT INTO `FollowUpAlert` (id,meetingId,userId,alertType,isRead,createdAt) VALUES (?,?,?,?,0,?)'
//             )->execute([gen_id(), $meetingId, $assignedToId, 'TASK_ASSIGNED', now_sql()]);
//             log_activity($assignedById, 'MEETING_ASSIGNED', 'Meeting', $meetingId,
//                 ['assignedTo' => $assignedToId, 'customer' => $companyName]);
//         } catch (\Throwable $e) { /* non-fatal, don't block the request */ }
//     }

//     private function shape(array $row): array
//     {
//         foreach (['isGeoVerified','reminderSent'] as $k) {
//             if (array_key_exists($k,$row)) $row[$k] = (bool)$row[$k];
//         }
//         $row['customer'] = [
//             'id'            => $row['c_id']   ?? $row['customerId'],
//             'companyName'   => $row['companyName'] ?? null,
//             'contactPerson' => $row['contactPerson'] ?? null,
//             'lat'           => isset($row['c_lat']) && $row['c_lat'] !== null ? (float)$row['c_lat'] : null,
//             'lng'           => isset($row['c_lng']) && $row['c_lng'] !== null ? (float)$row['c_lng'] : null,
//         ];
//         $row['user']       = ['id' => $row['u_id'] ?? null, 'name' => $row['u_name'] ?? null];
//         $row['assignedTo'] = ($row['a_id'] ?? null) ? ['id' => $row['a_id'], 'name' => $row['a_name']] : null;
//         // Last editor (distinct from `user` above, which is the owner/who-logged-it) — null for rows
//         // never edited since migration_meeting_updated_by.sql ran, or rows joined without the `ub` alias.
//         $row['updatedBy']  = ($row['ub_id'] ?? null) ? ['id' => $row['ub_id'], 'name' => $row['ub_name']] : null;
//         // Pre-formatted so every page (Meetings list, Follow-up tab, meeting detail) renders the same
//         // string without each re-implementing AM/PM parsing client-side. Raw `followUpTime` is still
//         // included below for anything that needs the underlying value (e.g. pre-filling an edit form).
//         if (array_key_exists('followUpTime', $row)) {
//             $row['followUpTimeDisplay'] = fmt_freetext_time_12h($row['followUpTime']);
//         }
//         foreach (['c_id','companyName','contactPerson','c_lat','c_lng','u_id','u_name','a_id','a_name','ub_id','ub_name'] as $k) unset($row[$k]);
//         return $row;
//     }
// }
