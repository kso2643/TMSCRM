<?php
/**
 * CEO Desk (was "MD desk") — direct line between the Super Admin (CEO) and the staff.
 * One send can go to several people at once (toIds[]): each gets their own copy
 * with its own status and replies. Price / quotation items can carry item lines
 * (item code, product, qty, price, discount) and the customer they are for.
 *
 * One item is one of:
 *   MESSAGE    a direct message
 *   TASK       an important task (priority + due date)
 *   PRICE      "Get price": get the price from the supplier (item lines; the assignee
 *              fills supplier, price and discount per line). Customer optional.
 *   QUOTATION  a new quotation given (customer, quotation no, value)
 * sent to one person (any user), to all Admins (toId NULL, toGroup ADMINS)
 * or to everyone (toId NULL, toGroup EVERYONE). The Super Admin and Admins
 * can send to anyone; other users can send to the Super Admin / Admins.
 * Each item has a reply thread and a status: OPEN → SEEN → DONE.
 *
 * Super Admin sees every item; everyone else sees what they sent, what was
 * sent to them and what was sent to their group. New items, replies and
 * "done" show up as alerts (AlertFeedController), and unread items addressed
 * to you pop up on every page until you open or acknowledge them
 * (crm-global.js → GET /md-desk/unread, POST /md-desk/:id/ack).
 *
 *   GET    /api/md-desk                  items visible to me
 *   GET    /api/md-desk/recipients       who I can send to
 *   GET    /api/md-desk/unread           unread items to me (for the pop-up on every page)
 *   POST   /api/md-desk/:id/ack          mark read without opening
 *   GET    /api/md-desk/quotations?q=&customerId=   recent quotations to pick from (a customer's quotations)
 *   GET    /api/md-desk/quotations/:id   one quotation's item lines (code, qty, price, discount)
 *   POST   /api/md-desk                  new item
 *   GET    /api/md-desk/:id              item + replies (marks it seen)
 *   POST   /api/md-desk/:id/reply        { body }
 *   PATCH  /api/md-desk/:id              { status: OPEN | DONE }
 *   PATCH  /api/md-desk/:id/items        Get price: the assignee fills supplier / price / discount per line
 *   POST   /api/md-desk/:id/files        attach a screenshot / image / PDF / Excel (multipart "file")
 *   GET    /api/md-desk/:id/files/:fid   view / download (?download=1)
 *   DELETE /api/md-desk/:id/files/:fid   uploader, sender or Super Admin
 *
 * Several people picked = ONE shared item (assignees JSON, toGroup PEOPLE): all of them
 * see the same item, thread and status. "Report to" (reportTo JSON) = people who are
 * kept informed: they see the item, its replies and when it is done.
 *   DELETE /api/md-desk/:id              sender or Super Admin
 */
class MdDeskController
{
    public const TYPES = ['MESSAGE', 'TASK', 'PRICE', 'QUOTATION'];
    public const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL'];

    public static function schema(): array
    {
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        return [
            'MdDeskItem' => ['create' => "CREATE TABLE IF NOT EXISTS `MdDeskItem` (
  `id` VARCHAR(30) NOT NULL, `type` VARCHAR(12) NOT NULL DEFAULT 'MESSAGE', `title` VARCHAR(255) NOT NULL, `details` TEXT NULL,
  `priority` VARCHAR(10) NOT NULL DEFAULT 'NORMAL', `dueDate` DATE NULL,
  `customerName` VARCHAR(255) NULL, `itemCode` VARCHAR(120) NULL, `productName` VARCHAR(255) NULL,
  `price` DECIMAL(14,2) NULL, `discount` DECIMAL(6,2) NULL, `quotationId` VARCHAR(30) NULL, `quotationNo` VARCHAR(80) NULL, `amount` DECIMAL(14,2) NULL,
  `fromId` VARCHAR(30) NOT NULL, `toId` VARCHAR(30) NULL, `toGroup` VARCHAR(10) NOT NULL DEFAULT 'ADMINS',
  `status` VARCHAR(10) NOT NULL DEFAULT 'OPEN', `seenAt` DATETIME NULL, `doneAt` DATETIME NULL, `doneById` VARCHAR(30) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `MdDeskItem_to_idx` (`toId`), KEY `MdDeskItem_from_idx` (`fromId`), KEY `MdDeskItem_created_idx` (`createdAt`)
$tail", 'columns' => ['toGroup' => "VARCHAR(10) NOT NULL DEFAULT 'ADMINS'", 'items' => 'MEDIUMTEXT NULL', 'customerId' => 'VARCHAR(30) NULL', 'batchId' => 'VARCHAR(30) NULL',
                'assignees' => 'MEDIUMTEXT NULL', 'reportTo' => 'MEDIUMTEXT NULL',
                // CEO-yymm-nnnn — typed on the Quotations page to load the customer and items
                'deskNo' => 'VARCHAR(20) NULL']],
            'MdDeskFile' => ['create' => "CREATE TABLE IF NOT EXISTS `MdDeskFile` (
  `id` VARCHAR(30) NOT NULL, `itemId` VARCHAR(30) NOT NULL, `fileName` VARCHAR(255) NOT NULL, `storedName` VARCHAR(80) NOT NULL,
  `size` INT NOT NULL DEFAULT 0, `uploadedById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `MdDeskFile_item` (`itemId`)
$tail"],
            'MdDeskRead' => ['create' => "CREATE TABLE IF NOT EXISTS `MdDeskRead` (
  `itemId` VARCHAR(30) NOT NULL, `userId` VARCHAR(30) NOT NULL, `readAt` DATETIME NOT NULL,
  PRIMARY KEY (`itemId`, `userId`)
$tail"],
            'MdDeskReply' => ['create' => "CREATE TABLE IF NOT EXISTS `MdDeskReply` (
  `id` VARCHAR(30) NOT NULL, `itemId` VARCHAR(30) NOT NULL, `userId` VARCHAR(30) NOT NULL, `body` TEXT NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `MdDeskReply_item_idx` (`itemId`), KEY `MdDeskReply_created_idx` (`createdAt`)
$tail"],
        ];
    }

    public function __construct()
    {
        ensure_schema(self::schema(), 'MD desk');
        // number older items once
        try {
            $old = db()->query('SELECT id, createdAt FROM `MdDeskItem` WHERE deskNo IS NULL ORDER BY createdAt LIMIT 500')->fetchAll();
            foreach ($old as $o) db()->prepare('UPDATE `MdDeskItem` SET deskNo=? WHERE id=?')->execute([self::nextNo($o['createdAt']), $o['id']]);
        } catch (Throwable $e) {}
    }

    /** Next CEO-yymm-nnnn number (month of $when). */
    private static function nextNo(?string $when = null): string
    {
        $pre = 'CEO-' . date('ym', $when ? strtotime($when) : time()) . '-';
        $s = db()->prepare('SELECT MAX(deskNo) FROM `MdDeskItem` WHERE deskNo LIKE ?'); $s->execute([$pre . '%']);
        $last = (string) $s->fetchColumn();
        $n = $last !== '' ? (int) substr($last, strlen($pre)) + 1 : 1;
        return $pre . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    // GET /api/md-desk/by-no/:no — for the Quotations page: customer + item lines of a CEO Desk item
    public function byNumber(string $no): void
    {
        $auth = self::auth();
        $no = strtoupper(trim($no));
        [$w, $p] = self::visible($auth);
        $s = db()->prepare("SELECT i.* FROM `MdDeskItem` i WHERE i.deskNo=? AND $w LIMIT 1");
        $s->execute(array_merge([$no], $p));
        $r = $s->fetch();
        if (!$r) sendError("No CEO Desk item $no (or it was not sent to you).", 404);
        $r = self::shape($r);
        $cust = null;
        if ($r['customerId']) { $c = db()->prepare('SELECT id, companyName, address, location, contactPerson FROM `Customer` WHERE id=?'); $c->execute([$r['customerId']]); $cust = $c->fetch() ?: null; }
        if (!$cust && $r['customerName']) {
            $c = db()->prepare('SELECT id, companyName, address, location, contactPerson FROM `Customer` WHERE companyName=? LIMIT 1'); $c->execute([$r['customerName']]); $cust = $c->fetch() ?: null;
        }
        $lines = $r['items'] ?: ($r['itemCode'] || $r['productName'] ? [['itemCode' => $r['itemCode'], 'productName' => $r['productName'], 'quantity' => null, 'price' => $r['price'], 'discount' => $r['discount']]] : []);
        $items = array_map(fn($l) => ['itemCode' => $l['itemCode'] ?? '', 'productName' => $l['productName'] ?? '', 'brand' => $l['supplier'] ?? '', 'quantity' => $l['quantity'] ?? null,
            'approvedPrice' => $l['price'] ?? null, 'approvedDiscount' => $l['discount'] ?? 0, 'leadTime' => $l['leadTime'] ?? ''], $lines);
        sendSuccess(['deskNo' => $r['deskNo'], 'title' => $r['title'], 'type' => $r['type'], 'quotationNo' => $r['quotationNo'],
            'customer' => $cust ?: ($r['customerName'] ? ['id' => null, 'companyName' => $r['customerName']] : null), 'items' => $items, 'pending' => 0, 'rejected' => 0]);
    }

    private static function auth(): array
    {
        return authenticate();
    }

    private static function isAdmin(array $auth): bool
    {
        return in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true);
    }

    /** SQL condition (alias i) for the items addressed to $auth (directly or through a group). */
    public static function toMeSql(array $auth): array
    {
        $groups = self::isAdmin($auth) ? "'ADMINS','EVERYONE'" : "'EVERYONE'";
        $like = '%"' . $auth['id'] . '"%';
        return ["(i.toId=? OR (i.toId IS NULL AND i.toGroup IN ($groups) AND i.fromId<>?) OR i.assignees LIKE ? OR i.reportTo LIKE ?)", [$auth['id'], $auth['id'], $like, $like]];
    }

    /** SQL condition (alias i) for the items $auth may see. */
    private static function visible(array $auth): array
    {
        if ($auth['role'] === 'SUPER_ADMIN') return ['1=1', []];
        [$w, $p] = self::toMeSql($auth);
        return ["(i.fromId=? OR $w)", array_merge([$auth['id']], $p)];
    }

    private static function markRead(string $id, string $userId): void
    {
        db()->prepare('INSERT IGNORE INTO `MdDeskRead` (itemId,userId,readAt) VALUES (?,?,?)')->execute([$id, $userId, now_sql()]);
    }

    private static function load(array $auth, string $id): array
    {
        [$w, $p] = self::visible($auth);
        $s = db()->prepare("SELECT i.*, f.name AS fromName, f.role AS fromRole, t.name AS toName, d.name AS doneByName
            FROM `MdDeskItem` i LEFT JOIN `User` f ON f.id=i.fromId LEFT JOIN `User` t ON t.id=i.toId LEFT JOIN `User` d ON d.id=i.doneById
            WHERE i.id=? AND $w LIMIT 1");
        $s->execute(array_merge([$id], $p));
        $r = $s->fetch();
        if (!$r) sendError('Item not found.', 404);
        return self::shape($r);
    }

    private static ?array $names = null;

    private static function userName(string $id): string
    {
        if (self::$names === null) self::$names = db()->query('SELECT id, name FROM `User`')->fetchAll(PDO::FETCH_KEY_PAIR);
        return self::$names[$id] ?? '—';
    }

    private static function shape(array $r): array
    {
        $r['items'] = !empty($r['items']) ? (json_decode($r['items'], true) ?: []) : [];
        foreach (['assignees', 'reportTo'] as $k) {
            $ids = !empty($r[$k]) ? (json_decode($r[$k], true) ?: []) : [];
            $r[$k] = array_map(fn($u) => ['id' => $u, 'name' => self::userName($u)], $ids);
        }
        if ($r['assignees'] && !$r['toId']) $r['toName'] = implode(', ', array_column($r['assignees'], 'name'));
        return $r;
    }

    private static function idsIn(array $people, string $id): bool
    {
        return in_array($id, array_column($people, 'id'), true);
    }

    /** List of user ids from the body → validated active users (not me). */
    private static function userIds($raw, string $me): array
    {
        $ids = array_values(array_unique(array_filter(array_map(fn($x) => trim((string) $x), (array) $raw))));
        if (count($ids) > 200) sendError('Too many people picked.', 400);
        $chk = db()->prepare('SELECT id FROM `User` WHERE id=? AND isActive=1');
        foreach ($ids as $u) { $chk->execute([$u]); if (!$chk->fetch()) sendError('One of the people picked is not an active user.', 400); }
        return array_values(array_filter($ids, fn($u) => $u !== $me));
    }

    private static function money($v): ?float
    {
        if ($v === null || $v === '') return null;
        $v = str_replace([',', '₹', ' '], '', (string) $v);
        if (!is_numeric($v)) sendError('Enter amounts as numbers.', 400);
        return round((float) $v, 2);
    }

    // GET /api/md-desk
    public function index(): void
    {
        $auth = self::auth();
        [$w, $p] = self::visible($auth);
        $s = db()->prepare("SELECT i.*, f.name AS fromName, f.role AS fromRole, t.name AS toName, d.name AS doneByName,
                (SELECT COUNT(*) FROM `MdDeskReply` r WHERE r.itemId=i.id) AS replyCount,
                (SELECT MAX(r.createdAt) FROM `MdDeskReply` r WHERE r.itemId=i.id) AS lastReplyAt,
                (SELECT COUNT(*) FROM `MdDeskFile` x WHERE x.itemId=i.id) AS fileCount
            FROM `MdDeskItem` i LEFT JOIN `User` f ON f.id=i.fromId LEFT JOIN `User` t ON t.id=i.toId LEFT JOIN `User` d ON d.id=i.doneById
            WHERE $w ORDER BY (i.status='DONE'), FIELD(i.priority,'URGENT','HIGH','NORMAL'), i.createdAt DESC LIMIT 500");
        $s->execute($p);
        $rd = db()->prepare('SELECT itemId FROM `MdDeskRead` WHERE userId=?'); $rd->execute([$auth['id']]);
        $read = array_flip($rd->fetchAll(PDO::FETCH_COLUMN));
        $admin = self::isAdmin($auth);
        $items = array_map(function ($r) use ($auth, $read, $admin) {
            $r['mine'] = $r['fromId'] === $auth['id'];
            $like = '"' . $auth['id'] . '"';
            $r['assignedToMe'] = str_contains((string) $r['assignees'], $like);
            $r['reportToMe'] = str_contains((string) $r['reportTo'], $like);
            $r['toMe'] = $r['toId'] === $auth['id'] || $r['assignedToMe'] || $r['reportToMe']
                || ($r['toId'] === null && $r['fromId'] !== $auth['id'] && ($r['toGroup'] === 'EVERYONE' || ($r['toGroup'] === 'ADMINS' && $admin)));
            $r['unread'] = $r['toMe'] && !isset($read[$r['id']]) && $r['status'] !== 'DONE';
            $r['overdue'] = $r['type'] === 'TASK' && $r['status'] !== 'DONE' && $r['dueDate'] && $r['dueDate'] < date('Y-m-d');
            return self::shape($r);
        }, $s->fetchAll());
        sendSuccess(['items' => $items, 'me' => $auth['id'], 'role' => $auth['role']]);
    }

    // GET /api/md-desk/unread — for the pop-up on every page
    public function unread(): void
    {
        $auth = self::auth();
        [$w, $p] = self::toMeSql($auth);
        $s = db()->prepare("SELECT i.id, i.type, i.title, i.priority, i.dueDate, i.createdAt, f.name AS fromName
            FROM `MdDeskItem` i LEFT JOIN `User` f ON f.id=i.fromId
            WHERE $w AND i.status<>'DONE' AND NOT EXISTS (SELECT 1 FROM `MdDeskRead` r WHERE r.itemId=i.id AND r.userId=?)
            ORDER BY FIELD(i.priority,'URGENT','HIGH','NORMAL'), i.createdAt DESC LIMIT 5");
        $s->execute(array_merge($p, [$auth['id']]));
        sendSuccess(['items' => $s->fetchAll()]);
    }

    // POST /api/md-desk/:id/ack
    public function ack(string $id): void
    {
        $auth = self::auth();
        self::load($auth, $id);
        self::markRead($id, $auth['id']);
        sendSuccess([], 'OK');
    }

    // GET /api/md-desk/recipients
    public function recipients(): void
    {
        $auth = self::auth();
        $only = self::isAdmin($auth) ? '' : "role IN ('SUPER_ADMIN','ADMIN') AND ";
        $s = db()->prepare("SELECT id, name, role, department FROM `User` WHERE {$only}isActive=1 AND id<>?
            ORDER BY FIELD(role,'SUPER_ADMIN','ADMIN','MANAGER','ACCOUNTS','SALES_ENGINEER','SALES'), name");
        $s->execute([$auth['id']]);
        $all = db()->prepare("SELECT id, name, role FROM `User` WHERE isActive=1 AND id<>? ORDER BY name");
        $all->execute([$auth['id']]);
        sendSuccess(['users' => $s->fetchAll(), 'allUsers' => $all->fetchAll(), 'canSendToGroups' => self::isAdmin($auth)]);
    }

    // GET /api/md-desk/quotations?q=
    public function quotations(): void
    {
        self::auth();
        $q = trim((string) qp('q', ''));
        $w = []; $p = [];
        if ($q !== '') { $w[] = '(q.quotationNumber LIKE ? OR c.companyName LIKE ?)'; array_push($p, "%$q%", "%$q%"); }
        if (($cid = trim((string) qp('customerId', ''))) !== '') { $w[] = 'q.customerId=?'; $p[] = $cid; }
        $where = $w ? 'WHERE ' . implode(' AND ', $w) : '';
        try {
            $s = db()->prepare("SELECT q.id, q.quotationNumber, q.totalAmount, COALESCE(q.quotationDate, q.createdAt) AS date, q.status,
                    COALESCE(c.companyName, q.toName) AS customerName, u.name AS byName
                FROM `Quotation` q LEFT JOIN `Customer` c ON c.id=q.customerId LEFT JOIN `User` u ON u.id=q.userId
                $where ORDER BY q.createdAt DESC LIMIT 20");
            $s->execute($p);
            $rows = $s->fetchAll();
        } catch (PDOException $e) { $rows = []; }
        sendSuccess(['quotations' => $rows]);
    }

    // GET /api/md-desk/quotations/:id — item lines to copy into a price / quotation item
    public function quotationItems(string $id): void
    {
        self::auth();
        $s = db()->prepare('SELECT q.id, q.quotationNumber, q.totalAmount, q.customerId, COALESCE(c.companyName, q.toName) AS customerName
            FROM `Quotation` q LEFT JOIN `Customer` c ON c.id=q.customerId WHERE q.id=?');
        $s->execute([$id]);
        $q = $s->fetch();
        if (!$q) sendError('Quotation not found.', 404);
        $i = db()->prepare('SELECT itemCode, productName, quantity, unitPrice, discount, netPrice FROM `QuotationItem` WHERE quotationId=? ORDER BY sortOrder, createdAt');
        $i->execute([$id]);
        $items = array_map(fn($r) => ['itemCode' => $r['itemCode'], 'productName' => $r['productName'], 'quantity' => (float) $r['quantity'],
            'price' => (float) $r['unitPrice'], 'discount' => (float) $r['discount'], 'net' => (float) $r['netPrice']], $i->fetchAll());
        $q['totalAmount'] = (float) $q['totalAmount'];
        sendSuccess(['quotation' => $q, 'items' => $items]);
    }

    /** Item lines from the body → clean list (code, product, qty, price, discount, net). */
    private static function itemLines($raw): array
    {
        $out = [];
        foreach ((array) $raw as $k => $it) {
            if (!is_array($it)) continue;
            $code = mb_substr(trim((string) ($it['itemCode'] ?? '')), 0, 120);
            $prod = mb_substr(trim((string) ($it['productName'] ?? '')), 0, 255);
            $qty = self::money($it['quantity'] ?? null); $price = self::money($it['price'] ?? null); $disc = self::money($it['discount'] ?? null);
            $sup = mb_substr(trim((string) ($it['supplier'] ?? '')), 0, 150);
            $lead = mb_substr(trim((string) ($it['leadTime'] ?? '')), 0, 60);
            if ($code === '' && $prod === '' && $price === null) continue;
            if ($code === '' && $prod === '') sendError('Line ' . ($k + 1) . ': enter the item code or product.', 400);
            if ($disc !== null && ($disc < 0 || $disc > 100)) sendError('Line ' . ($k + 1) . ': discount must be between 0 and 100 %.', 400);
            $net = $price === null ? null : round($price * (1 - ($disc ?? 0) / 100), 2);
            $out[] = ['itemCode' => $code, 'productName' => $prod, 'quantity' => $qty, 'supplier' => $sup, 'leadTime' => $lead, 'price' => $price, 'discount' => $disc, 'net' => $net];
        }
        return array_slice($out, 0, 100);
    }

    // POST /api/md-desk
    public function create(): void
    {
        $auth = self::auth();
        $b = request_body();
        $type = strtoupper(trim((string) ($b['type'] ?? 'MESSAGE')));
        if (!in_array($type, self::TYPES, true)) sendError('Pick what you are sending: message, task, price or quotation.', 400);
        $prio = strtoupper(trim((string) ($b['priority'] ?? 'NORMAL')));
        if (!in_array($prio, self::PRIORITIES, true)) $prio = 'NORMAL';
        // several people at once (toIds[]), one person (toId) or a group (toGroup, admins only)
        $toIds = array_values(array_unique(array_filter(array_map(fn($x) => trim((string) $x), (array) ($b['toIds'] ?? [])))));
        if (!$toIds && trim((string) ($b['toId'] ?? '')) !== '') $toIds = [trim((string) $b['toId'])];
        $group = strtoupper(trim((string) ($b['toGroup'] ?? 'ADMINS')));
        if (!in_array($group, ['ADMINS', 'EVERYONE'], true)) $group = 'ADMINS';
        if (count($toIds) > 200) sendError('Too many people picked.', 400);
        $reportTo = self::userIds($b['reportTo'] ?? [], $auth['id']);
        foreach ($toIds as $tid) {
            $s = db()->prepare('SELECT id, role FROM `User` WHERE id=? AND isActive=1');
            $s->execute([$tid]);
            $u = $s->fetch();
            if (!$u) sendError('Pick who to send it to.', 400);
            if ($tid === $auth['id']) sendError('Pick someone other than yourself.', 400);
            if (!self::isAdmin($auth) && !in_array($u['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('You can send to the CEO or an Admin.', 403);
        }
        if (!$toIds && !self::isAdmin($auth)) sendError('Pick the CEO or an Admin to send it to.', 400);
        $title = trim((string) ($b['title'] ?? ''));
        $details = trim((string) ($b['details'] ?? ''));
        $cust = trim((string) ($b['customerName'] ?? ''));
        $code = trim((string) ($b['itemCode'] ?? ''));
        $prod = trim((string) ($b['productName'] ?? ''));
        $qno = trim((string) ($b['quotationNo'] ?? ''));
        $price = self::money($b['price'] ?? null);
        $disc = self::money($b['discount'] ?? null);
        $amount = self::money($b['amount'] ?? null);
        $due = to_date_only($b['dueDate'] ?? null);
        if ($disc !== null && ($disc < 0 || $disc > 100)) sendError('Discount must be between 0 and 100 %.', 400);
        $lines = in_array($type, ['PRICE', 'QUOTATION'], true) ? self::itemLines($b['items'] ?? []) : [];
        $custId = trim((string) ($b['customerId'] ?? '')) ?: null;
        $deskNo = self::nextNo();

        if ($type === 'PRICE') {
            // "Get price": a task to get the price from the supplier — price filled in later by the assignee
            if (!$lines && ($code !== '' || $prod !== '')) $lines = self::itemLines([['itemCode' => $code, 'productName' => $prod, 'quantity' => $b['quantity'] ?? null, 'price' => $price, 'discount' => $disc]]);
            if (!$lines) sendError('Enter at least one item (code or product) to get the price for.', 400);
            $f = $lines[0];
            if ($code === '') $code = $f['itemCode']; if ($prod === '') $prod = $f['productName'];
            if ($price === null) $price = $f['price']; if ($disc === null) $disc = $f['discount'];
            if ($title === '') $title = 'Get price · ' . (count($lines) > 1 ? count($lines) . ' items' : ($code ?: $prod)) . ($cust !== '' ? ' · ' . $cust : '');
        } elseif ($type === 'QUOTATION') {
            if ($cust === '') sendError('Enter the customer the quotation was given to.', 400);
            if ($title === '') $title = 'New quotation ' . ($qno !== '' ? $qno : $deskNo) . ' · ' . $cust;
        } elseif ($type === 'TASK') {
            if ($title === '') sendError('Write the task.', 400);
        } else {
            if ($title === '' && $details === '') sendError('Write the message.', 400);
            if ($title === '') $title = mb_substr(preg_replace('/\s+/', ' ', $details), 0, 80);
        }
        if ($type === 'QUOTATION' && $amount === null && $lines) {
            $amount = 0.0; foreach ($lines as $l) $amount += ($l['net'] ?? 0) * ($l['quantity'] ?? 1);
            $amount = round($amount, 2);
        }
        $now = now_sql(); $id = gen_id();
        // several people = one shared item (assignees); one person = toId; nobody = a group
        $shared = count($toIds) > 1;
        $reportTo = array_values(array_diff($reportTo, $toIds));
        $ins = db()->prepare('INSERT INTO `MdDeskItem` (id,type,title,details,priority,dueDate,customerName,customerId,itemCode,productName,price,discount,quotationId,quotationNo,amount,items,fromId,toId,toGroup,assignees,reportTo,status,createdAt,updatedAt,deskNo)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'OPEN\',?,?,?)');
        $ins->execute([$id, $type, mb_substr($title, 0, 255), $details ?: null, $prio, in_array($type, ['TASK', 'PRICE'], true) ? $due : null, $cust ?: null, $custId, $code ?: null, $prod ?: null,
            $price, $disc, trim((string) ($b['quotationId'] ?? '')) ?: null, $qno ?: null, $amount, $lines ? json_encode($lines, JSON_UNESCAPED_UNICODE) : null,
            $auth['id'], $shared ? null : ($toIds[0] ?? null), $shared ? 'PEOPLE' : ($toIds ? 'ADMINS' : $group),
            $shared ? json_encode($toIds) : null, $reportTo ? json_encode($reportTo) : null, $now, $now, $deskNo]);
        log_activity($auth['id'], 'MD_DESK_SENT', 'MdDeskItem', $id, ['type' => $type, 'title' => $title, 'to' => count($toIds), 'reportTo' => count($reportTo)]);
        sendSuccess(['item' => self::load($auth, $id), 'count' => max(1, count($toIds))], $shared ? 'Sent to ' . count($toIds) . ' people (one shared task)' : 'Sent', 201);
    }

    // GET /api/md-desk/:id
    public function show(string $id): void
    {
        $auth = self::auth();
        $item = self::load($auth, $id);
        if ($item['fromId'] !== $auth['id']) self::markRead($id, $auth['id']);
        if ($item['fromId'] !== $auth['id'] && $item['status'] === 'OPEN') {
            db()->prepare("UPDATE `MdDeskItem` SET status='SEEN', seenAt=? WHERE id=? AND status='OPEN'")->execute([now_sql(), $id]);
            $item = self::load($auth, $id);
        }
        $s = db()->prepare('SELECT r.*, u.name AS userName, u.role AS userRole FROM `MdDeskReply` r LEFT JOIN `User` u ON u.id=r.userId WHERE r.itemId=? ORDER BY r.createdAt');
        $s->execute([$id]);
        sendSuccess(['item' => $item, 'replies' => $s->fetchAll(), 'files' => self::files($id)]);
    }

    // POST /api/md-desk/:id/reply
    public function reply(string $id): void
    {
        $auth = self::auth();
        self::load($auth, $id);
        $body = trim((string) (request_body()['body'] ?? ''));
        if ($body === '') sendError('Write a reply.', 400);
        db()->prepare('INSERT INTO `MdDeskReply` (id,itemId,userId,body,createdAt) VALUES (?,?,?,?,?)')->execute([gen_id(), $id, $auth['id'], $body, now_sql()]);
        db()->prepare('UPDATE `MdDeskItem` SET updatedAt=? WHERE id=?')->execute([now_sql(), $id]);
        $this->show($id);
    }

    // PATCH /api/md-desk/:id
    public function update(string $id): void
    {
        $auth = self::auth();
        $item = self::load($auth, $id);
        $st = strtoupper((string) (request_body()['status'] ?? ''));
        if (!in_array($st, ['OPEN', 'DONE'], true)) sendError('Status must be OPEN or DONE.', 400);
        if ($st === 'DONE') db()->prepare("UPDATE `MdDeskItem` SET status='DONE', doneAt=?, doneById=?, updatedAt=? WHERE id=?")->execute([now_sql(), $auth['id'], now_sql(), $id]);
        else db()->prepare("UPDATE `MdDeskItem` SET status=IF(seenAt IS NULL,'OPEN','SEEN'), doneAt=NULL, doneById=NULL, updatedAt=? WHERE id=?")->execute([now_sql(), $id]);
        log_activity($auth['id'], $st === 'DONE' ? 'MD_DESK_DONE' : 'MD_DESK_REOPENED', 'MdDeskItem', $id, ['title' => $item['title']]);
        sendSuccess(['item' => self::load($auth, $id)], $st === 'DONE' ? 'Marked done' : 'Reopened');
    }

    // DELETE /api/md-desk/:id
    public function delete(string $id): void
    {
        $auth = self::auth();
        $item = self::load($auth, $id);
        if ($auth['role'] !== 'SUPER_ADMIN') sendError('Only the Super Admin can delete CEO Desk items.', 403);
        $fs = db()->prepare('SELECT storedName FROM `MdDeskFile` WHERE itemId=?'); $fs->execute([$id]);
        foreach ($fs->fetchAll(PDO::FETCH_COLUMN) as $sn) @unlink(UPLOADS_PATH . '/md-desk/' . basename($sn));
        db()->prepare('DELETE FROM `MdDeskFile` WHERE itemId=?')->execute([$id]);
        db()->prepare('DELETE FROM `MdDeskReply` WHERE itemId=?')->execute([$id]);
        db()->prepare('DELETE FROM `MdDeskRead` WHERE itemId=?')->execute([$id]);
        db()->prepare('DELETE FROM `MdDeskItem` WHERE id=?')->execute([$id]);
        sendSuccess([], 'Deleted');
    }

    /** Who may work on an item: sender, assignee / direct recipient, Admins. */
    private static function canWork(array $auth, array $item): bool
    {
        return self::isAdmin($auth) || $item['fromId'] === $auth['id'] || $item['toId'] === $auth['id'] || self::idsIn($item['assignees'], $auth['id']);
    }

    // PATCH /api/md-desk/:id/items — Get price: fill supplier, price, discount, lead time per line
    public function updateItems(string $id): void
    {
        $auth = self::auth();
        $item = self::load($auth, $id);
        if (!self::canWork($auth, $item)) sendError('Only the people the task was given to (or the sender) can fill in the prices.', 403);
        $lines = self::itemLines(request_body()['items'] ?? []);
        if (!$lines) sendError('Enter at least one item.', 400);
        $f = $lines[0]; $now = now_sql();
        db()->prepare('UPDATE `MdDeskItem` SET items=?, itemCode=?, productName=?, price=?, discount=?, updatedAt=? WHERE id=?')
            ->execute([json_encode($lines, JSON_UNESCAPED_UNICODE), $f['itemCode'] ?: null, $f['productName'] ?: null, $f['price'], $f['discount'], $now, $id]);
        $priced = count(array_filter($lines, fn($l) => $l['price'] !== null));
        $note = ($item['type'] === 'QUOTATION' ? '✎ Items updated: ' : '💰 Prices updated: ') . $priced . ' of ' . count($lines) . ' item' . (count($lines) === 1 ? '' : 's') . ' priced' .
            implode('', array_map(fn($l) => "\n• " . ($l['itemCode'] ?: $l['productName']) . ($l['supplier'] ? ' · ' . $l['supplier'] : '') .
                ($l['price'] !== null ? ' · ₹' . number_format($l['price'], 2) . ($l['discount'] ? ' less ' . rtrim(rtrim(number_format($l['discount'], 2), '0'), '.') . '%' : '') : ' · (no price yet)') .
                ($l['leadTime'] ? ' · ' . $l['leadTime'] : ''), $lines));
        db()->prepare('INSERT INTO `MdDeskReply` (id,itemId,userId,body,createdAt) VALUES (?,?,?,?,?)')->execute([gen_id(), $id, $auth['id'], $note, $now]);
        log_activity($auth['id'], 'MD_DESK_PRICES', 'MdDeskItem', $id, ['priced' => $priced]);
        $this->show($id);
    }

    public const FILE_EXT = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp',
        'pdf' => 'application/pdf', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xls' => 'application/vnd.ms-excel',
        'csv' => 'text/csv', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc' => 'application/msword'];

    private static function files(string $id): array
    {
        $s = db()->prepare('SELECT f.id, f.fileName, f.size, f.uploadedById, f.createdAt, u.name AS uploadedByName FROM `MdDeskFile` f LEFT JOIN `User` u ON u.id=f.uploadedById WHERE f.itemId=? ORDER BY f.createdAt');
        $s->execute([$id]);
        return array_map(function ($f) {
            $ext = strtolower(pathinfo($f['fileName'], PATHINFO_EXTENSION));
            $f['kind'] = in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp'], true) ? 'IMAGE' : ($ext === 'pdf' ? 'PDF' : (in_array($ext, ['xlsx', 'xls', 'csv'], true) ? 'EXCEL' : 'DOC'));
            $f['size'] = (int) $f['size'];
            return $f;
        }, $s->fetchAll());
    }

    // POST /api/md-desk/:id/files — screenshot / image / PDF / Excel / Word, up to 25 MB
    public function uploadFile(string $id): void
    {
        $auth = self::auth();
        self::load($auth, $id);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('No file received (check the size — up to 25 MB).', 400);
        if ($f['size'] > 25 * 1024 * 1024) sendError('The file is larger than 25 MB.', 400);
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        if (!isset(self::FILE_EXT[$ext])) sendError('Attach an image / screenshot, PDF, Excel or Word file.', 400);
        $dir = UPLOADS_PATH . '/md-desk';
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the file on the server.', 500);
        $fid = gen_id(); $stored = $fid . '.' . $ext;
        if (!move_uploaded_file($f['tmp_name'], "$dir/$stored") && !rename($f['tmp_name'], "$dir/$stored")) sendError('Could not save the file on the server.', 500);
        $name = preg_replace('/[^\w.\- ()]+/u', '_', (string) $f['name']);
        db()->prepare('INSERT INTO `MdDeskFile` (id,itemId,fileName,storedName,size,uploadedById,createdAt) VALUES (?,?,?,?,?,?,?)')
            ->execute([$fid, $id, mb_substr($name, 0, 255), $stored, (int) $f['size'], $auth['id'], now_sql()]);
        db()->prepare('UPDATE `MdDeskItem` SET updatedAt=? WHERE id=?')->execute([now_sql(), $id]);
        sendSuccess(['files' => self::files($id)], 'File attached', 201);
    }

    // GET /api/md-desk/:id/files/:fid
    public function downloadFile(string $id, string $fid): void
    {
        $auth = self::auth();
        self::load($auth, $id);
        $s = db()->prepare('SELECT * FROM `MdDeskFile` WHERE id=? AND itemId=?'); $s->execute([$fid, $id]);
        $f = $s->fetch();
        if (!$f) sendError('File not found.', 404);
        $path = UPLOADS_PATH . '/md-desk/' . basename($f['storedName']);
        if (!is_file($path)) sendError('The file is missing on the server.', 404);
        $ext = strtolower(pathinfo($f['storedName'], PATHINFO_EXTENSION));
        $inline = in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'], true) && !qp('download');
        header('Content-Type: ' . (self::FILE_EXT[$ext] ?? 'application/octet-stream'));
        header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . str_replace('"', '', $f['fileName']) . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path); exit;
    }

    // DELETE /api/md-desk/:id/files/:fid
    public function deleteFile(string $id, string $fid): void
    {
        $auth = self::auth();
        $item = self::load($auth, $id);
        $s = db()->prepare('SELECT * FROM `MdDeskFile` WHERE id=? AND itemId=?'); $s->execute([$fid, $id]);
        $f = $s->fetch();
        if (!$f) sendError('File not found.', 404);
        if ($f['uploadedById'] !== $auth['id'] && $item['fromId'] !== $auth['id'] && $auth['role'] !== 'SUPER_ADMIN') sendError('Only the person who attached it, the sender or the Super Admin can remove it.', 403);
        @unlink(UPLOADS_PATH . '/md-desk/' . basename($f['storedName']));
        db()->prepare('DELETE FROM `MdDeskFile` WHERE id=?')->execute([$fid]);
        sendSuccess(['files' => self::files($id)], 'File removed');
    }
}
