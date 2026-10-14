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
 *   PRICE      a price given to a customer (customer, item, price, discount)
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
$tail", 'columns' => ['toGroup' => "VARCHAR(10) NOT NULL DEFAULT 'ADMINS'", 'items' => 'MEDIUMTEXT NULL', 'customerId' => 'VARCHAR(30) NULL', 'batchId' => 'VARCHAR(30) NULL']],
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
        return ["(i.toId=? OR (i.toId IS NULL AND i.toGroup IN ($groups) AND i.fromId<>?))", [$auth['id'], $auth['id']]];
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

    private static function shape(array $r): array
    {
        $r['items'] = !empty($r['items']) ? (json_decode($r['items'], true) ?: []) : [];
        return $r;
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
                (SELECT MAX(r.createdAt) FROM `MdDeskReply` r WHERE r.itemId=i.id) AS lastReplyAt
            FROM `MdDeskItem` i LEFT JOIN `User` f ON f.id=i.fromId LEFT JOIN `User` t ON t.id=i.toId LEFT JOIN `User` d ON d.id=i.doneById
            WHERE $w ORDER BY (i.status='DONE'), FIELD(i.priority,'URGENT','HIGH','NORMAL'), i.createdAt DESC LIMIT 500");
        $s->execute($p);
        $rd = db()->prepare('SELECT itemId FROM `MdDeskRead` WHERE userId=?'); $rd->execute([$auth['id']]);
        $read = array_flip($rd->fetchAll(PDO::FETCH_COLUMN));
        $admin = self::isAdmin($auth);
        $items = array_map(function ($r) use ($auth, $read, $admin) {
            $r['mine'] = $r['fromId'] === $auth['id'];
            $r['toMe'] = $r['toId'] === $auth['id'] || ($r['toId'] === null && $r['fromId'] !== $auth['id'] && ($r['toGroup'] === 'EVERYONE' || $admin));
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
        sendSuccess(['users' => $s->fetchAll(), 'canSendToGroups' => self::isAdmin($auth)]);
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
            if ($code === '' && $prod === '' && $price === null) continue;
            if ($code === '' && $prod === '') sendError('Line ' . ($k + 1) . ': enter the item code or product.', 400);
            if ($disc !== null && ($disc < 0 || $disc > 100)) sendError('Line ' . ($k + 1) . ': discount must be between 0 and 100 %.', 400);
            $net = $price === null ? null : round($price * (1 - ($disc ?? 0) / 100), 2);
            $out[] = ['itemCode' => $code, 'productName' => $prod, 'quantity' => $qty, 'price' => $price, 'discount' => $disc, 'net' => $net];
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

        if ($type === 'PRICE') {
            if ($cust === '') sendError('Enter the customer the price was given to.', 400);
            if ($lines) {
                // first line also fills the single-item columns (lists, alerts, older screens)
                $f = $lines[0];
                if ($code === '') $code = $f['itemCode']; if ($prod === '') $prod = $f['productName'];
                if ($price === null) $price = $f['price']; if ($disc === null) $disc = $f['discount'];
                foreach ($lines as $k => $l) if ($l['price'] === null) sendError('Line ' . ($k + 1) . ' (' . ($l['itemCode'] ?: $l['productName']) . '): enter the price.', 400);
            }
            if ($code === '' && $prod === '') sendError('Enter the item code or product.', 400);
            if ($price === null) sendError('Enter the price given.', 400);
            if ($title === '') $title = 'Price given · ' . (count($lines) > 1 ? count($lines) . ' items' : ($code ?: $prod)) . ' · ' . $cust;
        } elseif ($type === 'QUOTATION') {
            if ($cust === '') sendError('Enter the customer the quotation was given to.', 400);
            if ($qno === '') sendError('Enter the quotation number.', 400);
            if ($title === '') $title = 'New quotation ' . $qno . ' · ' . $cust;
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
        $now = now_sql(); $batch = count($toIds) > 1 ? gen_id() : null; $ids = [];
        $ins = db()->prepare('INSERT INTO `MdDeskItem` (id,type,title,details,priority,dueDate,customerName,customerId,itemCode,productName,price,discount,quotationId,quotationNo,amount,items,fromId,toId,toGroup,batchId,status,createdAt,updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'OPEN\',?,?)');
        foreach ($toIds ?: [null] as $tid) {
            $id = gen_id(); $ids[] = $id;
            $ins->execute([$id, $type, mb_substr($title, 0, 255), $details ?: null, $prio, $type === 'TASK' ? $due : null, $cust ?: null, $custId, $code ?: null, $prod ?: null,
                $price, $disc, trim((string) ($b['quotationId'] ?? '')) ?: null, $qno ?: null, $amount, $lines ? json_encode($lines, JSON_UNESCAPED_UNICODE) : null,
                $auth['id'], $tid, $tid ? 'ADMINS' : $group, $batch, $now, $now]);
        }
        log_activity($auth['id'], 'MD_DESK_SENT', 'MdDeskItem', $ids[0], ['type' => $type, 'title' => $title, 'to' => count($ids)]);
        sendSuccess(['item' => self::load($auth, $ids[0]), 'count' => count($ids)], count($ids) > 1 ? 'Sent to ' . count($ids) . ' people' : 'Sent', 201);
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
        sendSuccess(['item' => $item, 'replies' => $s->fetchAll()]);
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
        db()->prepare('DELETE FROM `MdDeskReply` WHERE itemId=?')->execute([$id]);
        db()->prepare('DELETE FROM `MdDeskRead` WHERE itemId=?')->execute([$id]);
        db()->prepare('DELETE FROM `MdDeskItem` WHERE id=?')->execute([$id]);
        sendSuccess([], 'Deleted');
    }
}
