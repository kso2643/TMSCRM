<?php
class CategoryController
{
    // GET /api/categories
    public function index(): void
    {
        authenticate();
        $s = db()->query(
            'SELECT c.*, 
                    (SELECT COUNT(*) FROM `Product` p WHERE p.categoryId=c.id) AS products_count,
                    (SELECT COUNT(*) FROM `Stock` st WHERE st.categoryId=c.id) AS stock_count
             FROM `Category` c ORDER BY c.sortOrder ASC'
        );
        $cats = array_map(function($r) {
            $r['_count'] = ['products' => (int)$r['products_count'], 'stock' => (int)$r['stock_count']];
            unset($r['products_count'], $r['stock_count']);
            return $r;
        }, $s->fetchAll());
        sendSuccess(['categories' => $cats]);
    }

    // POST /api/categories
    public function create(): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();
        $name = trim($b['name'] ?? '');
        if (!$name) sendError('Category name is required.', 400);

        $s = db()->prepare('SELECT id FROM `Category` WHERE name=? LIMIT 1'); $s->execute([$name]);
        if ($s->fetch()) sendError("Category \"$name\" already exists.", 409);

        $maxSort = (int)db()->query('SELECT COALESCE(MAX(sortOrder),0) FROM `Category`')->fetchColumn();
        $id = gen_id();
        $color = trim($b['color'] ?? '') ?: '#64748b';
        db()->prepare('INSERT INTO `Category` (id,name,color,sortOrder,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
           ->execute([$id, $name, $color, $maxSort + 1, now_sql(), now_sql()]);
        $s2 = db()->prepare('SELECT * FROM `Category` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['category' => $s2->fetch()], 'Category added', 201);
    }

    // PUT /api/categories/:id
    public function update(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();
        $s = db()->prepare('SELECT id FROM `Category` WHERE id=? LIMIT 1'); $s->execute([$id]);
        if (!$s->fetch()) sendError('Category not found.', 404);

        $sets = []; $params = [];
        if (!empty($b['name']))               { $sets[] = 'name=?';      $params[] = trim($b['name']); }
        if (!empty($b['color']))              { $sets[] = 'color=?';     $params[] = trim($b['color']); }
        if (isset($b['sortOrder']))           { $sets[] = 'sortOrder=?'; $params[] = (int)$b['sortOrder']; }
        if ($sets) {
            $sets[] = 'updatedAt=?'; $params[] = now_sql(); $params[] = $id;
            db()->prepare('UPDATE `Category` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        }
        $s2 = db()->prepare('SELECT * FROM `Category` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['category' => $s2->fetch()], 'Category updated');
    }

    // DELETE /api/categories/:id
    public function delete(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $count = (int)db()->prepare('SELECT COUNT(*) FROM `Product` WHERE categoryId=?')
                          ->execute([$id]) ? 0 : 0;
        $s = db()->prepare('SELECT COUNT(*) FROM `Product` WHERE categoryId=?'); $s->execute([$id]);
        $count = (int)$s->fetchColumn();
        if ($count > 0) sendError("Cannot delete: {$count} product(s) are assigned to this category. Reassign them first.", 400);
        $d = db()->prepare('DELETE FROM `Category` WHERE id=?');
        if (!$d->execute([$id]) || $d->rowCount() === 0) sendError('Category not found.', 404);
        sendSuccess([], 'Category deleted');
    }
}

class LeaveController
{
    /** PERMISSION = a few hours off on one day (from–to time). */
    public const TYPES = ['CASUAL', 'SICK', 'PERSONAL', 'HALF_DAY', 'PERMISSION'];
    public const LABELS = ['CASUAL' => 'Casual leave', 'SICK' => 'Sick leave', 'PERSONAL' => 'Personal leave', 'HALF_DAY' => 'Half day', 'PERMISSION' => 'Permission (hourly)'];
    private const MAX_PERMISSION_HOURS = 8;

    public function __construct()
    {
        ensure_schema(['Leave' => ['create' => '', 'columns' => [
            'fromTime' => 'VARCHAR(5) NULL',
            'toTime'   => 'VARCHAR(5) NULL',
            'hours'    => 'DECIMAL(5,2) NULL',
        ]]], 'Leave permission-hours columns');
    }

    private function shape(array $r): array
    {
        $r['user'] = ['id' => $r['u_id'] ?? $r['userId'], 'name' => $r['u_name'] ?? null, 'department' => $r['department'] ?? null];
        $r['approvedBy'] = !empty($r['a_name']) ? ['name' => $r['a_name']] : null;
        unset($r['u_id'], $r['u_name'], $r['department'], $r['a_name']);
        $r['totalDays'] = $r['totalDays'] === null ? null : (float) $r['totalDays'];
        $r['hours'] = isset($r['hours']) && $r['hours'] !== null ? (float) $r['hours'] : null;
        $r['typeLabel'] = self::LABELS[$r['leaveType']] ?? $r['leaveType'];
        return $r;
    }

    // GET /api/leaves?status=&userId=&type=&year=
    public function index(): void
    {
        $auth = authenticate();
        [$page, $limit, $offset] = paginate(20);
        $status = qp('status', ''); $userId = qp('userId', ''); $type = qp('type', '');
        $isAdmin = is_admin_tier($auth['role']);

        $where = []; $params = [];
        // Manager / Admin / Super Admin see everyone's requests; others their own.
        if (!$isAdmin || qp('mine'))   { $where[] = 'l.userId=?'; $params[] = $auth['id']; }
        elseif ($userId)               { $where[] = 'l.userId=?'; $params[] = $userId; }
        if ($status)                   { $where[] = 'l.status=?'; $params[] = $status; }
        if ($type)                     { $where[] = 'l.leaveType=?'; $params[] = $type; }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare("SELECT COUNT(*) FROM `Leave` l $w"); $s->execute($params);
        $total = (int) $s->fetchColumn();
        $s2 = db()->prepare(
            "SELECT l.*, u.id AS u_id, u.name AS u_name, u.department, a.name AS a_name
             FROM `Leave` l LEFT JOIN `User` u ON u.id=l.userId LEFT JOIN `User` a ON a.id=l.approvedById
             $w ORDER BY (l.status='PENDING') DESC, l.fromDate DESC, l.createdAt DESC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $items = array_map([$this, 'shape'], $s2->fetchAll());
        sendPaginated($items, $total, $page, $limit, 'Leaves fetched');
    }

    // GET /api/leaves/summary?userId= — approved days this year per type, permission hours this month, pending count
    public function summary(): void
    {
        $auth = authenticate();
        $uid = (is_admin_tier($auth['role']) && qp('userId')) ? qp('userId') : $auth['id'];
        $y0 = date('Y-01-01 00:00:00'); $m0 = date('Y-m-01 00:00:00');
        $s = db()->prepare("SELECT leaveType, SUM(totalDays) d, SUM(COALESCE(hours,0)) h, COUNT(*) n FROM `Leave` WHERE userId=? AND status='APPROVED' AND fromDate>=? GROUP BY leaveType");
        $s->execute([$uid, $y0]);
        $year = [];
        foreach ($s->fetchAll() as $r) $year[$r['leaveType']] = ['days' => (float) $r['d'], 'hours' => (float) $r['h'], 'count' => (int) $r['n']];
        $s = db()->prepare("SELECT COALESCE(SUM(hours),0) FROM `Leave` WHERE userId=? AND status='APPROVED' AND leaveType='PERMISSION' AND fromDate>=?");
        $s->execute([$uid, $m0]);
        $permMonth = (float) $s->fetchColumn();
        $s = db()->prepare("SELECT COUNT(*) FROM `Leave` WHERE status='PENDING'" . (is_admin_tier($auth['role']) && !qp('userId') ? '' : ' AND userId=?'));
        $s->execute(is_admin_tier($auth['role']) && !qp('userId') ? [] : [$uid]);
        sendSuccess(['year' => $year, 'permissionHoursThisMonth' => $permMonth, 'pending' => (int) $s->fetchColumn(),
                     'types' => array_map(fn($k) => ['value' => $k, 'label' => self::LABELS[$k]], self::TYPES)]);
    }

    private static function hhmm($v): ?string
    {
        $v = trim((string) $v);
        if (!preg_match('/^(\d{1,2}):(\d{2})/', $v, $m) || (int) $m[1] > 23 || (int) $m[2] > 59) return null;
        return sprintf('%02d:%02d', $m[1], $m[2]);
    }

    // POST /api/leaves — { leaveType, fromDate, toDate?, fromTime?, toTime?, reason }
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();
        $leaveType = strtoupper(trim((string) ($b['leaveType'] ?? '')));
        $fromDate = substr((string) ($b['fromDate'] ?? ''), 0, 10);
        $toDate = substr((string) ($b['toDate'] ?? ''), 0, 10) ?: $fromDate;
        if (!in_array($leaveType, self::TYPES, true)) sendError('Choose a leave type.', 400);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromDate)) sendError('Choose the date.', 400);
        $reason = trim((string) ($b['reason'] ?? ''));
        if ($reason === '') sendError('Please give a reason.', 400);
        $fromTime = $toTime = null; $hours = null;
        if ($leaveType === 'PERMISSION' || $leaveType === 'HALF_DAY') $toDate = $fromDate;
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $toDate) || $toDate < $fromDate) sendError('The "to" date must be on or after the "from" date.', 400);
        if ($leaveType === 'PERMISSION') {
            $fromTime = self::hhmm($b['fromTime'] ?? ''); $toTime = self::hhmm($b['toTime'] ?? '');
            if (!$fromTime || !$toTime) sendError('Enter the permission time from and to (e.g. 10:00 to 12:00).', 400);
            [$fh, $fm] = array_map('intval', explode(':', $fromTime)); [$th, $tm] = array_map('intval', explode(':', $toTime));
            $mins = ($th * 60 + $tm) - ($fh * 60 + $fm);
            if ($mins <= 0) sendError('The "to" time must be after the "from" time.', 400);
            $hours = round($mins / 60, 2);
            if ($hours > self::MAX_PERMISSION_HOURS) sendError('Permission can be at most ' . self::MAX_PERMISSION_HOURS . ' hours — apply for leave instead.', 400);
            $totalDays = 0;
        } elseif ($leaveType === 'HALF_DAY') {
            $totalDays = 0.5;
        } else {
            $totalDays = (int) round((strtotime($toDate) - strtotime($fromDate)) / 86400) + 1;
        }
        // Don't allow two requests for the same time.
        $ov = db()->prepare("SELECT leaveType, fromDate, fromTime, toTime FROM `Leave` WHERE userId=? AND status IN ('PENDING','APPROVED') AND DATE(fromDate)<=? AND DATE(toDate)>=?");
        $ov->execute([$auth['id'], $toDate, $fromDate]);
        foreach ($ov->fetchAll() as $o) {
            $bothPermission = $o['leaveType'] === 'PERMISSION' && $leaveType === 'PERMISSION';
            if (!$bothPermission || ($o['fromTime'] < $toTime && $o['toTime'] > $fromTime)) {
                sendError('You already have a ' . strtolower(self::LABELS[$o['leaveType']] ?? 'leave') . ' request on ' . date('d M Y', strtotime($o['fromDate'])) . ($o['fromTime'] ? ' (' . $o['fromTime'] . '–' . $o['toTime'] . ')' : '') . ' that overlaps.', 400);
            }
        }
        $id = gen_id();
        db()->prepare(
            'INSERT INTO `Leave` (id,userId,leaveType,fromDate,toDate,fromTime,toTime,hours,totalDays,reason,status,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,\'PENDING\',?,?)'
        )->execute([$id, $auth['id'], $leaveType, $fromDate . ' ' . ($fromTime ?: '00:00') . ':00', $toDate . ' ' . ($toTime ?: '00:00') . ':00',
                    $fromTime, $toTime, $hours, $totalDays, mb_substr($reason, 0, 2000), now_sql(), now_sql()]);
        log_activity($auth['id'], 'LEAVE_REQUESTED', 'Leave', $id, ['type' => $leaveType, 'from' => $fromDate, 'to' => $toDate, 'hours' => $hours]);
        $s = db()->prepare('SELECT l.*,u.name AS u_name FROM `Leave` l LEFT JOIN `User` u ON u.id=l.userId WHERE l.id=? LIMIT 1');
        $s->execute([$id]);
        sendSuccess(['leave' => $this->shape($s->fetch())], ($leaveType === 'PERMISSION' ? 'Permission' : 'Leave') . ' request submitted', 201);
    }

    // PATCH /api/leaves/:id/approve
    public function approve(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body(); $status = $b['status'] ?? '';
        if (!in_array($status, ['APPROVED', 'REJECTED'])) sendError('Status must be APPROVED or REJECTED.', 400);
        if ($status === 'REJECTED' && trim((string) ($b['adminNote'] ?? '')) === '') sendError('Please give a reason for rejecting.', 400);
        $s = db()->prepare('UPDATE `Leave` SET status=?,adminNote=?,approvedById=?,approvedAt=?,updatedAt=? WHERE id=?');
        if (!$s->execute([$status, $b['adminNote'] ?? null, $auth['id'], now_sql(), now_sql(), $id]) || $s->rowCount() === 0)
            sendError('Leave request not found.', 404);
        $s2 = db()->prepare('SELECT l.*,u.name AS u_name,u.email AS u_email, a.name AS a_name FROM `Leave` l LEFT JOIN `User` u ON u.id=l.userId LEFT JOIN `User` a ON a.id=l.approvedById WHERE l.id=? LIMIT 1');
        $s2->execute([$id]);
        sendSuccess(['leave' => $this->shape($s2->fetch())], 'Leave ' . strtolower($status));
    }

    // DELETE /api/leaves/:id — withdraw your own pending request
    public function withdraw(string $id): void
    {
        $auth = authenticate();
        $s = db()->prepare('SELECT userId, status FROM `Leave` WHERE id=?'); $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) sendError('Leave request not found.', 404);
        if ($r['userId'] !== $auth['id'] || $r['status'] !== 'PENDING') sendError('Only your own pending request can be withdrawn.', 403);
        db()->prepare('DELETE FROM `Leave` WHERE id=?')->execute([$id]);
        sendSuccess([], 'Request withdrawn');
    }
}

class ActivityController
{
    // GET /api/activity
    public function index(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$page, $limit, $offset] = paginate(50);
        $userId = qp('userId',''); $action = qp('action',''); $search = qp('search','');

        $where = []; $params = [];
        if ($userId) { $where[] = 'al.userId=?';  $params[] = $userId; }
        if ($action) { $where[] = 'al.action=?';  $params[] = $action; }
        if ($search) {
            $like = "%$search%";
            $where[] = '(al.action LIKE ? OR al.entityType LIKE ? OR u.name LIKE ?)';
            $params = array_merge($params, [$like,$like,$like]);
        }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare("SELECT COUNT(*) FROM `ActivityLog` al LEFT JOIN `User` u ON u.id=al.userId $w");
        $s->execute($params); $total = (int)$s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT al.*, u.name AS u_name, u.role AS u_role
             FROM `ActivityLog` al LEFT JOIN `User` u ON u.id=al.userId
             $w ORDER BY al.createdAt DESC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $logs = array_map(function($r) {
            $r['user'] = ['name'=>$r['u_name'],'role'=>$r['u_role']];
            unset($r['u_name'],$r['u_role']); return $r;
        }, $s2->fetchAll());
        sendPaginated($logs, $total, $page, $limit, 'Activity logs fetched');
    }

    // GET /api/activity/export
    public function export(): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->query('SELECT al.createdAt,u.name,u.role,al.action,al.entityType,al.entityId,al.ipAddress FROM `ActivityLog` al LEFT JOIN `User` u ON u.id=al.userId ORDER BY al.createdAt DESC LIMIT 10000');
        $w = new XlsxWriter('Activity');
        $w->addRow(['Date','User','Role','Action','Entity Type','Entity ID','IP Address']);
        foreach($s->fetchAll() as $r) $w->addRow([$r['createdAt'],$r['name'],$r['role'],$r['action'],$r['entityType'],$r['entityId'],$r['ipAddress']]);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="activity-export.xlsx"');
        echo $w->output(); exit;
    }
}
