<?php
/**
 * "Your request was changed" notices.
 *
 * When someone (the CEO, an admin, a manager…) changes or deletes a record that
 * belongs to another person — their leave, order, trial, task, appointment, fuel
 * entry, quotation, price request, MOM… — that person gets an alert:
 * "✎ <name> changed your leave (Casual 24 Oct)". Alerts come through the alert feed
 * (toast + sound on every page, phone notification in the app, Alerts page).
 *
 * How: before routing, index.php calls ChangeNotice::watch(). If the request is a
 * write that matches a rule below, the record's owner(s) are looked up while the record
 * still exists; when the request finishes with a 2xx answer, a notice is saved for each
 * owner who is not the person making the change. Changes that already have their own
 * alert (leave / trial approve-reject, price answers, CEO Desk replies) are not repeated.
 */
class ChangeNotice
{
    /**
     * [regex on "resource/rest", methods, owner SQL (u = owner, u2 = second owner, s = sender,
     *  l = label, a = JSON array of more owners), what, link, actions by sub-path, senderOnly]
     */
    private static function rules(): array
    {
        return [
            ['#^orders/([^/]+)(?:/(delivery|eta|procurement|proforma|supply|items))?(?:/[^/]+/(procurement|eta))?$#', ['PUT', 'PATCH', 'DELETE'],
             'SELECT o.engineerId AS u, c.companyName AS l FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId WHERE o.id=?', 'order', '/orders/',
             ['delivery' => 'changed the delivery status of', 'eta' => 'changed the expected date of', 'procurement' => 'changed the procurement status of',
              'proforma' => 'changed the price / proforma status of', 'supply' => 'updated the supplied materials of', 'items' => 'updated an item of']],
            ['#^orders/([^/]+)/(invoices)(?:/[^/]+)?$#', ['POST', 'DELETE'],
             'SELECT o.engineerId AS u, c.companyName AS l FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId WHERE o.id=?', 'order', '/orders/',
             ['invoices' => 'updated the invoices of']],
            ['#^leaves/([^/]+)/(convert)$#', ['PATCH'],
             "SELECT userId AS u, CONCAT(leaveType, ' ', DATE_FORMAT(fromDate,'%d %b')) AS l FROM `Leave` WHERE id=?", 'leave', '/leaves/', ['convert' => 'changed']],
            ['#^leaves/([^/]+)$#', ['DELETE'],
             "SELECT userId AS u, CONCAT(leaveType, ' ', DATE_FORMAT(fromDate,'%d %b')) AS l FROM `Leave` WHERE id=?", 'leave', '/leaves/', []],
            ['#^leaves/(assign)$#', ['POST'], 'BODY:userId', 'leave', '/leaves/', ['assign' => 'marked a leave for']],
            ['#^attendance/(mark)$#', ['POST'], 'BODY:userId', 'attendance', '/attendance/', ['mark' => 'marked']],
            ['#^attendance/mark/([^/]+)$#', ['DELETE'],
             "SELECT userId AS u, CONCAT(leaveType, ' ', DATE_FORMAT(fromDate,'%d %b')) AS l FROM `Leave` WHERE id=?", 'attendance', '/attendance/', []],
            ['#^fuel-expense/([^/]+)(?:/(bills))?(?:/[^/]+)?$#', ['PATCH', 'POST', 'DELETE'],
             "SELECT userId AS u, DATE_FORMAT(date,'%d %b') AS l FROM `FuelExpense` WHERE id=?", 'fuel expense', '/fuel-expense/', ['bills' => 'changed the bills of']],
            ['#^trials/([^/]+)(?:/(progress|existing|savings|dc))?$#', ['PUT', 'PATCH', 'DELETE'],
             'SELECT requestedById AS u, trialNo AS l FROM `Trial` WHERE id=?', 'trial', '/trials/',
             ['progress' => 'changed the trial progress of', 'existing' => 'edited the request data of', 'savings' => 'edited the savings report of', 'dc' => 'approved the DC of']],
            ['#^appointments/([^/]+)$#', ['PUT', 'DELETE'],
             "SELECT COALESCE(a.assignedToId, a.userId) AS u, a.userId AS u2, CONCAT(COALESCE(c.companyName,''), ' · ', DATE_FORMAT(a.appointmentDate,'%d %b')) AS l FROM `Appointment` a LEFT JOIN `Customer` c ON c.id=a.customerId WHERE a.id=?",
             'appointment', '/appointments/', []],
            ['#^meetings/([^/]+)$#', ['PUT', 'DELETE'],
             "SELECT COALESCE(m.assignedToId, m.userId) AS u, CONCAT(COALESCE(c.companyName,''), ' · ', DATE_FORMAT(m.meetingDate,'%d %b')) AS l FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId WHERE m.id=?",
             'meeting / follow-up', '/meetings/', []],
            ['#^tasks/([^/]+)(?:/(move))?$#', ['PUT', 'PATCH', 'DELETE'],
             'SELECT assignedToId AS u, title AS l FROM `AdminTask` WHERE id=?', 'task', '/md-desk/#tasks', ['move' => 'moved']],
            ['#^price-requests/([^/]+)(?:/(revise))?$#', ['PATCH', 'DELETE'],
             "SELECT r.requestedById AS u, CONCAT(COALESCE(b.requestNo,''), ' ', COALESCE(r.itemCode, r.productName)) AS l FROM `PriceRequest` r LEFT JOIN `PriceRequestBatch` b ON b.id=r.batchId WHERE r.id=?",
             'price request', '/price-requests/', ['revise' => 'revised']],
            ['#^price-requests/batch/([^/]+)$#', ['DELETE'],
             'SELECT requestedById AS u, requestNo AS l FROM `PriceRequestBatch` WHERE id=?', 'price request', '/price-requests/', []],
            ['#^quotations/([^/]+)$#', ['PUT', 'DELETE'],
             'SELECT userId AS u, quotationNumber AS l FROM `Quotation` WHERE id=?', 'quotation', '/quotations/', []],
            ['#^md-desk/([^/]+)/(items)$#', ['PATCH'],
             'SELECT toId AS u, fromId AS s, assignees AS a, COALESCE(deskNo, title) AS l FROM `MdDeskItem` WHERE id=?', 'CEO Desk item', '/md-desk/', ['items' => 'changed the items of'], true],
            ['#^mom/([^/]+)$#', ['PUT', 'DELETE'], 'SELECT createdById AS u, momNo AS l FROM `Mom` WHERE id=?', 'MOM', '/mom/', []],
            ['#^internal-meetings/([^/]+)$#', ['PUT', 'DELETE'], 'SELECT createdById AS u, meetingNo AS l FROM `InternalMeeting` WHERE id=?', 'meeting report', '/internal-meetings/', []],
            ['#^petty-cash/([^/]+)$#', ['PUT', 'DELETE'], "SELECT createdById AS u, CONCAT(description, ' (', DATE_FORMAT(entryDate,'%d %b'), ')') AS l FROM `PettyCash` WHERE id=?", 'petty cash entry', '/fuel-expense/#petty-cash', []],
            ['#^sales-report/orders/([^/]+)$#', ['PATCH'],
             'SELECT o.engineerId AS u, c.companyName AS l FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId WHERE o.id=?', 'order value', '/sales-report/', []],
            ['#^sales-report/entries/([^/]+)$#', ['PUT', 'DELETE'],
             "SELECT engineerId AS u, CONCAT(COALESCE(reference,''), ' ', COALESCE(customerName,'')) AS l FROM `SalesEntry` WHERE id=?", 'sales entry', '/sales-report/', []],
        ];
    }

    public static function ensure(): void
    {
        static $done = false;
        if ($done) return;
        $done = true;
        ensure_schema(['ChangeNotice' => ['create' => "CREATE TABLE IF NOT EXISTS `ChangeNotice` (
  `id` VARCHAR(30) NOT NULL, `userId` VARCHAR(30) NOT NULL, `byId` VARCHAR(30) NOT NULL, `title` VARCHAR(255) NOT NULL,
  `body` VARCHAR(500) NULL, `link` VARCHAR(255) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `ChangeNotice_user` (`userId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]], 'Change notices');
    }

    /** Called before routing: remembers whose record a write touches, and saves notices once it succeeds. */
    public static function watch(string $method, array $segs): void
    {
        if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) || !$segs) return;
        $path = implode('/', $segs);
        $rule = null; $m = [];
        foreach (self::rules() as $r) { if (in_array($method, $r[1], true) && preg_match($r[0], $path, $m)) { $rule = $r; break; } }
        if (!$rule) return;
        $h = get_authorization_header();
        if (!$h || !str_starts_with($h, 'Bearer ')) return;
        try { $d = JWT::verify(substr($h, 7), JWT_SECRET); } catch (Throwable $e) { return; }
        $actorId = (string) ($d['id'] ?? '');
        if ($actorId === '') return;
        try {
            $owners = []; $label = '';
            if (str_starts_with($rule[2], 'BODY:')) {
                $owners[] = (string) (request_body()[substr($rule[2], 5)] ?? '');
            } else {
                $s = db()->prepare($rule[2]); $s->execute([$m[1]]);
                $row = $s->fetch();
                if (!$row) return;
                if (!empty($rule[6]) && ($row['s'] ?? '') !== $actorId) return;   // only when the sender changes it
                foreach (['u', 'u2'] as $k) if (!empty($row[$k])) $owners[] = (string) $row[$k];
                if (!empty($row['a'])) foreach ((array) json_decode((string) $row['a'], true) as $x) if (is_string($x) && $x !== '') $owners[] = $x;
                $label = trim((string) ($row['l'] ?? ''));
            }
            $owners = array_values(array_unique(array_filter($owners, fn($u) => $u !== '' && $u !== $actorId)));
            if (!$owners) return;
            $sub = '';
            foreach (array_slice($m, 1) as $x) if ($x !== '' && isset($rule[5][$x])) { $sub = $x; break; }
            $verb = $method === 'DELETE' ? 'deleted' : ($sub !== '' ? $rule[5][$sub] : 'changed');
        } catch (Throwable $e) { return; }
        $what = $rule[3]; $link = $rule[4];
        register_shutdown_function(function () use ($owners, $actorId, $verb, $what, $label, $link) {
            $code = http_response_code();
            if (!is_int($code) || $code < 200 || $code >= 300) return;
            try {
                self::ensure();
                $n = db()->prepare('SELECT name FROM `User` WHERE id=?'); $n->execute([$actorId]);
                $who = (string) ($n->fetchColumn() ?: 'Admin');
                $title = mb_substr('✎ ' . $who . ' ' . $verb . ' your ' . $what, 0, 255);
                $ins = db()->prepare('INSERT INTO `ChangeNotice` (id,userId,byId,title,body,link,createdAt) VALUES (?,?,?,?,?,?,?)');
                foreach ($owners as $u) $ins->execute([gen_id(), $u, $actorId, $title, $label !== '' ? mb_substr($label, 0, 500) : null, $link, now_sql()]);
            } catch (Throwable $e) { error_log('ChangeNotice: ' . $e->getMessage()); }
        });
    }

    /** Notices for one user after $since (for the alert feed). */
    public static function since(string $userId, string $since, int $limit): array
    {
        try {
            self::ensure();
            $s = db()->prepare("SELECT id, title, body, link, createdAt FROM `ChangeNotice` WHERE userId=? AND createdAt>? ORDER BY createdAt DESC LIMIT $limit");
            $s->execute([$userId, $since]);
            return $s->fetchAll();
        } catch (Throwable $e) { return []; }
    }
}
