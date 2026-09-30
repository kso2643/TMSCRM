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
    private const TYPES = ['CASUAL','SICK','PERMISSION','HALF_DAY'];

    // GET /api/leaves
    public function index(): void
    {
        $auth = authenticate();
        [$page, $limit, $offset] = paginate(20);
        $status = qp('status',''); $userId = qp('userId','');

        $where = []; $params = [];
        // Match JS logic exactly: non-ADMIN sees only own leaves
        if ($auth['role'] !== 'ADMIN') { $where[] = 'l.userId=?'; $params[] = $auth['id']; }
        elseif ($userId)               { $where[] = 'l.userId=?'; $params[] = $userId; }
        if ($status)                   { $where[] = 'l.status=?'; $params[] = $status; }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare("SELECT COUNT(*) FROM `Leave` l $w"); $s->execute($params);
        $total = (int)$s->fetchColumn();
        $s2 = db()->prepare(
            "SELECT l.*, u.id AS u_id, u.name AS u_name, u.department
             FROM `Leave` l LEFT JOIN `User` u ON u.id=l.userId
             $w ORDER BY l.createdAt DESC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $items = array_map(function($r) {
            $r['user'] = ['id'=>$r['u_id'],'name'=>$r['u_name'],'department'=>$r['department']];
            unset($r['u_id'],$r['u_name'],$r['department']); return $r;
        }, $s2->fetchAll());
        sendPaginated($items, $total, $page, $limit, 'Leaves fetched');
    }

    // POST /api/leaves
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();
        $leaveType = $b['leaveType'] ?? ''; $fromDate = $b['fromDate'] ?? ''; $toDate = $b['toDate'] ?? '';
        if (!$leaveType || !$fromDate || !$toDate) sendError('Leave type, from date, and to date are required.', 400);
        if (!in_array($leaveType, self::TYPES)) sendError('Invalid leave type.', 400);

        $from = strtotime($fromDate); $to = strtotime($toDate);
        $totalDays = $leaveType === 'HALF_DAY' ? 0.5 : (int)ceil(($to - $from) / 86400) + 1;
        $id = gen_id();
        db()->prepare(
            'INSERT INTO `Leave` (id,userId,leaveType,fromDate,toDate,totalDays,reason,status,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,\'PENDING\',?,?)'
        )->execute([$id, $auth['id'], $leaveType, to_dt($fromDate), to_dt($toDate), $totalDays, $b['reason']??null, now_sql(), now_sql()]);
        $s = db()->prepare('SELECT l.*,u.name AS u_name FROM `Leave` l LEFT JOIN `User` u ON u.id=l.userId WHERE l.id=? LIMIT 1');
        $s->execute([$id]);
        $row = $s->fetch(); $row['user'] = ['name'=>$row['u_name']]; unset($row['u_name']);
        sendSuccess(['leave' => $row], 'Leave request submitted', 201);
    }

    // PATCH /api/leaves/:id/approve
    public function approve(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body(); $status = $b['status'] ?? '';
        if (!in_array($status, ['APPROVED','REJECTED'])) sendError('Status must be APPROVED or REJECTED.', 400);
        $s = db()->prepare('UPDATE `Leave` SET status=?,adminNote=?,approvedById=?,approvedAt=?,updatedAt=? WHERE id=?');
        if (!$s->execute([$status,$b['adminNote']??null,$auth['id'],now_sql(),now_sql(),$id])||$s->rowCount()===0)
            sendError('Leave request not found.', 404);
        $s2 = db()->prepare('SELECT l.*,u.name AS u_name,u.email AS u_email FROM `Leave` l LEFT JOIN `User` u ON u.id=l.userId WHERE l.id=? LIMIT 1');
        $s2->execute([$id]);
        $row=$s2->fetch(); $row['user']=['name'=>$row['u_name'],'email'=>$row['u_email']]; unset($row['u_name'],$row['u_email']);
        sendSuccess(['leave'=>$row], 'Leave ' . strtolower($status));
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
