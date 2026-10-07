<?php
/**
 * Chat — admins message any user; users see those messages and reply.
 *
 * Manager / Admin / Super Admin can start a conversation with any active user
 * (pick the user from the dropdown). Everyone else can write to the admin team
 * members only (normally as a reply). New messages raise a CHAT_MESSAGE alert.
 *
 *   GET  /api/chat/users              people I can chat with + unread count + last message
 *   GET  /api/chat/thread/:userId     messages between me and that user (marks theirs read)
 *   POST /api/chat/send               { toId, body }
 *   GET  /api/chat/unread             { unread }
 */
class ChatController
{
    public function __construct()
    {
        ensure_schema(['ChatMessage' => ['create' => "CREATE TABLE IF NOT EXISTS `ChatMessage` (
  `id`        VARCHAR(30) NOT NULL,
  `fromId`    VARCHAR(30) NOT NULL,
  `toId`      VARCHAR(30) NOT NULL,
  `body`      TEXT        NOT NULL,
  `createdAt` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `readAt`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `ChatMessage_to_idx` (`toId`, `readAt`),
  KEY `ChatMessage_pair_idx` (`fromId`, `toId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]], 'Chat messages');
    }

    private static function canStart(array $auth): bool { return is_admin_tier($auth['role']); }

    /** May $auth chat with $other (a User row)? */
    private function allowed(array $auth, array $other): bool
    {
        if ($other['id'] === $auth['id']) return false;
        if (self::canStart($auth)) return true;
        if (is_admin_tier($other['role'])) return true;
        // a non-admin may also answer anyone who already wrote to them
        $s = db()->prepare('SELECT 1 FROM `ChatMessage` WHERE fromId=? AND toId=? LIMIT 1');
        $s->execute([$other['id'], $auth['id']]);
        return (bool) $s->fetchColumn();
    }

    private function user(string $id): ?array
    {
        $s = db()->prepare('SELECT id, name, role, department FROM `User` WHERE id=? AND isActive=1');
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    // GET /api/chat/users
    public function users(): void
    {
        $auth = authenticate();
        $me = $auth['id'];
        $all = db()->query("SELECT id, name, role, department FROM `User` WHERE isActive=1 ORDER BY name")->fetchAll();
        $talked = [];
        $s = db()->prepare("SELECT IF(fromId=?, toId, fromId) AS other, MAX(createdAt) AS lastAt,
                                   SUM(toId=? AND readAt IS NULL) AS unread
                            FROM `ChatMessage` WHERE fromId=? OR toId=? GROUP BY other");
        $s->execute([$me, $me, $me, $me]);
        foreach ($s->fetchAll() as $r) $talked[$r['other']] = $r;
        $last = db()->prepare('SELECT body, fromId FROM `ChatMessage` WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?) ORDER BY createdAt DESC LIMIT 1');
        $out = [];
        foreach ($all as $u) {
            if ($u['id'] === $me) continue;
            $t = $talked[$u['id']] ?? null;
            if (!self::canStart($auth) && !is_admin_tier($u['role']) && !$t) continue;
            $row = ['id' => $u['id'], 'name' => $u['name'], 'role' => $u['role'], 'department' => $u['department'],
                    'unread' => (int) ($t['unread'] ?? 0), 'lastAt' => $t['lastAt'] ?? null, 'last' => null];
            if ($t) { $last->execute([$me, $u['id'], $u['id'], $me]); $l = $last->fetch(); if ($l) $row['last'] = ['body' => mb_substr($l['body'], 0, 90), 'mine' => $l['fromId'] === $me]; }
            $out[] = $row;
        }
        usort($out, fn($a, $b) => [$b['lastAt'] ?? '', $a['name']] <=> [$a['lastAt'] ?? '', $b['name']]);
        sendSuccess(['users' => $out, 'canStart' => self::canStart($auth), 'unread' => array_sum(array_column($out, 'unread'))]);
    }

    // GET /api/chat/thread/:userId?after=
    public function thread(string $userId): void
    {
        $auth = authenticate();
        $other = $this->user($userId);
        if (!$other || !$this->allowed($auth, $other)) sendError('You can’t chat with this user.', 403);
        $after = to_dt(qp('after'));
        $sql = 'SELECT id, fromId, toId, body, createdAt, readAt FROM `ChatMessage`
                WHERE ((fromId=? AND toId=?) OR (fromId=? AND toId=?))' . ($after ? ' AND createdAt>?' : '') . ' ORDER BY createdAt ASC, id ASC';
        $p = [$auth['id'], $userId, $userId, $auth['id']];
        if ($after) $p[] = $after;
        if (!$after) $sql .= ''; // whole history
        $s = db()->prepare($sql); $s->execute($p);
        $msgs = $s->fetchAll();
        if (count($msgs) > 500) $msgs = array_slice($msgs, -500);
        db()->prepare('UPDATE `ChatMessage` SET readAt=? WHERE fromId=? AND toId=? AND readAt IS NULL')->execute([now_sql(), $userId, $auth['id']]);
        sendSuccess(['user' => $other, 'messages' => array_map(fn($m) => $m + ['mine' => $m['fromId'] === $auth['id']], $msgs), 'now' => now_sql()]);
    }

    // POST /api/chat/send { toId, body }
    public function send(): void
    {
        $auth = authenticate();
        $b = request_body();
        $to = $this->user((string) ($b['toId'] ?? ''));
        if (!$to) sendError('Choose who to send the message to.', 400);
        if (!$this->allowed($auth, $to)) sendError('You can only message the admin team.', 403);
        $body = trim((string) ($b['body'] ?? ''));
        if ($body === '') sendError('Type a message.', 400);
        $id = gen_id();
        db()->prepare('INSERT INTO `ChatMessage` (id,fromId,toId,body,createdAt) VALUES (?,?,?,?,?)')
            ->execute([$id, $auth['id'], $to['id'], mb_substr($body, 0, 4000), now_sql()]);
        sendSuccess(['message' => ['id' => $id, 'fromId' => $auth['id'], 'toId' => $to['id'], 'body' => mb_substr($body, 0, 4000), 'createdAt' => now_sql(), 'readAt' => null, 'mine' => true]], 'Sent', 201);
    }

    // GET /api/chat/unread
    public function unread(): void
    {
        $auth = authenticate();
        $s = db()->prepare('SELECT COUNT(*) FROM `ChatMessage` WHERE toId=? AND readAt IS NULL');
        $s->execute([$auth['id']]);
        sendSuccess(['unread' => (int) $s->fetchColumn()]);
    }
}
