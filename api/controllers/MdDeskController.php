<?php
/**
 * MD desk — direct line between the Super Admin (MD) and the Admins.
 *
 * One item is one of:
 *   MESSAGE    a direct message
 *   TASK       an important task (priority + due date)
 *   PRICE      a price given to a customer (customer, item, price, discount)
 *   QUOTATION  a new quotation given (customer, quotation no, value)
 * sent to one Admin / Super Admin, or to all of them (toId NULL).
 * Each item has a reply thread and a status: OPEN → SEEN → DONE.
 *
 * Super Admin sees every item; an Admin sees what they sent, what was sent
 * to them, and what was sent to everyone. New items, replies and "done"
 * show up as alerts (AlertFeedController).
 *
 *   GET    /api/md-desk                  items visible to me
 *   GET    /api/md-desk/recipients       Super Admins + Admins (not me)
 *   GET    /api/md-desk/quotations?q=    recent quotations to pick from
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
  `fromId` VARCHAR(30) NOT NULL, `toId` VARCHAR(30) NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'OPEN', `seenAt` DATETIME NULL, `doneAt` DATETIME NULL, `doneById` VARCHAR(30) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `MdDeskItem_to_idx` (`toId`), KEY `MdDeskItem_from_idx` (`fromId`), KEY `MdDeskItem_created_idx` (`createdAt`)
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
        $auth = authenticate();
        if (!in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('The MD desk is for the Super Admin and Admins.', 403);
        return $auth;
    }

    /** SQL condition (alias i) for the items $auth may see. */
    private static function visible(array $auth): array
    {
        if ($auth['role'] === 'SUPER_ADMIN') return ['1=1', []];
        return ['(i.fromId=? OR i.toId=? OR i.toId IS NULL)', [$auth['id'], $auth['id']]];
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
        $items = array_map(function ($r) use ($auth) {
            $r['mine'] = $r['fromId'] === $auth['id'];
            $r['toMe'] = $r['toId'] === $auth['id'] || ($r['toId'] === null && $r['fromId'] !== $auth['id']);
            $r['overdue'] = $r['type'] === 'TASK' && $r['status'] !== 'DONE' && $r['dueDate'] && $r['dueDate'] < date('Y-m-d');
            return $r;
        }, $s->fetchAll());
        sendSuccess(['items' => $items, 'me' => $auth['id'], 'role' => $auth['role']]);
    }

    // GET /api/md-desk/recipients
    public function recipients(): void
    {
        $auth = self::auth();
        $s = db()->prepare("SELECT id, name, role, department FROM `User` WHERE role IN ('SUPER_ADMIN','ADMIN') AND isActive=1 AND id<>? ORDER BY role='ADMIN' DESC, name");
        $s->execute([$auth['id']]);
        sendSuccess(['users' => $s->fetchAll()]);
    }

    // GET /api/md-desk/quotations?q=
    public function quotations(): void
    {
        self::auth();
        $q = trim((string) qp('q', ''));
        $where = ''; $p = [];
        if ($q !== '') { $where = 'WHERE q.quotationNumber LIKE ? OR c.companyName LIKE ?'; $p = ["%$q%", "%$q%"]; }
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

    // POST /api/md-desk
    public function create(): void
    {
        $auth = self::auth();
        $b = request_body();
        $type = strtoupper(trim((string) ($b['type'] ?? 'MESSAGE')));
        if (!in_array($type, self::TYPES, true)) sendError('Pick what you are sending: message, task, price or quotation.', 400);
        $prio = strtoupper(trim((string) ($b['priority'] ?? 'NORMAL')));
        if (!in_array($prio, self::PRIORITIES, true)) $prio = 'NORMAL';
        $toId = trim((string) ($b['toId'] ?? ''));
        if ($toId !== '') {
            $s = db()->prepare("SELECT id FROM `User` WHERE id=? AND role IN ('SUPER_ADMIN','ADMIN') AND isActive=1");
            $s->execute([$toId]);
            if (!$s->fetch()) sendError('Send to a Super Admin or an Admin.', 400);
            if ($toId === $auth['id']) sendError('Pick someone other than yourself.', 400);
        }
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

        if ($type === 'PRICE') {
            if ($cust === '') sendError('Enter the customer the price was given to.', 400);
            if ($code === '' && $prod === '') sendError('Enter the item code or product.', 400);
            if ($price === null) sendError('Enter the price given.', 400);
            if ($title === '') $title = 'Price given · ' . ($code ?: $prod) . ' · ' . $cust;
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
        $id = gen_id(); $now = now_sql();
        db()->prepare('INSERT INTO `MdDeskItem` (id,type,title,details,priority,dueDate,customerName,itemCode,productName,price,discount,quotationId,quotationNo,amount,fromId,toId,status,createdAt,updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'OPEN\',?,?)')
            ->execute([$id, $type, mb_substr($title, 0, 255), $details ?: null, $prio, $type === 'TASK' ? $due : null, $cust ?: null, $code ?: null, $prod ?: null,
                $price, $disc, trim((string) ($b['quotationId'] ?? '')) ?: null, $qno ?: null, $amount, $auth['id'], $toId ?: null, $now, $now]);
        log_activity($auth['id'], 'MD_DESK_SENT', 'MdDeskItem', $id, ['type' => $type, 'title' => $title]);
        sendSuccess(['item' => self::load($auth, $id)], 'Sent', 201);
    }

    // GET /api/md-desk/:id
    public function show(string $id): void
    {
        $auth = self::auth();
        $item = self::load($auth, $id);
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
        if ($item['fromId'] !== $auth['id'] && $auth['role'] !== 'SUPER_ADMIN') sendError('Only the sender can delete this.', 403);
        db()->prepare('DELETE FROM `MdDeskReply` WHERE itemId=?')->execute([$id]);
        db()->prepare('DELETE FROM `MdDeskItem` WHERE id=?')->execute([$id]);
        sendSuccess([], 'Deleted');
    }
}
