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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            // attachments (v11.45): any file — photo, audio / voice note, video, PDF, Excel…
            'columns' => ['fileName' => 'VARCHAR(255) NULL', 'storedName' => 'VARCHAR(80) NULL', 'fileMime' => 'VARCHAR(120) NULL',
                          'fileSize' => 'INT NULL', 'fileKind' => 'VARCHAR(10) NULL']]], 'Chat messages');
    }

    /** Shown inline only for these; everything else is sent as a plain download. */
    private const INLINE = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp',
        'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'aac' => 'audio/aac', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'weba' => 'audio/webm', 'opus' => 'audio/ogg',
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime', '3gp' => 'video/3gpp', 'pdf' => 'application/pdf',
    ];
    private static function kindOf(string $ext, string $mime): string
    {
        if (preg_match('/^image\//', $mime) && isset(self::INLINE[$ext])) return 'IMAGE';
        if (preg_match('/^audio\//', $mime) || in_array($ext, ['mp3', 'm4a', 'aac', 'wav', 'oga', 'weba', 'opus'], true)) return 'AUDIO';
        if (preg_match('/^video\//', $mime) || in_array($ext, ['mp4', 'mov', '3gp'], true)) return 'VIDEO';
        return 'FILE';
    }

    // POST /api/chat/send-file (multipart: toId, file, body?) — any file up to 25 MB
    public function sendFile(): void
    {
        $auth = authenticate();
        $to = $this->user((string) ($_POST['toId'] ?? ''));
        if (!$to) sendError('Choose who to send the file to.', 400);
        if (!$this->allowed($auth, $to)) sendError('You can only message the admin team.', 403);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('No file received (check the size — up to 25 MB).', 400);
        if ($f['size'] > 25 * 1024 * 1024) sendError('The file is larger than 25 MB.', 400);
        $name = preg_replace('/[^\w.\- ()\[\]]+/u', '_', (string) $f['name']) ?: 'file';
        $ext = strtolower(preg_replace('/[^a-z0-9]/i', '', pathinfo($name, PATHINFO_EXTENSION))) ?: 'bin';
        $mime = (string) ($f['type'] ?? '');
        if (function_exists('finfo_open')) { $fi = finfo_open(FILEINFO_MIME_TYPE); $det = $fi ? finfo_file($fi, $f['tmp_name']) : false; if ($det) $mime = $det; }
        $dir = UPLOADS_PATH . '/chat';
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the file on the server.', 500);
        $id = gen_id(); $stored = $id . '.' . substr($ext, 0, 8);
        if (!move_uploaded_file($f['tmp_name'], "$dir/$stored") && !rename($f['tmp_name'], "$dir/$stored")) sendError('Could not save the file on the server.', 500);
        $kind = self::kindOf($ext, $mime);
        $body = mb_substr(trim((string) ($_POST['body'] ?? '')), 0, 4000);
        $now = now_sql();
        db()->prepare('INSERT INTO `ChatMessage` (id,fromId,toId,body,createdAt,fileName,storedName,fileMime,fileSize,fileKind) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $auth['id'], $to['id'], $body, $now, mb_substr($name, 0, 255), $stored, mb_substr($mime, 0, 120), (int) $f['size'], $kind]);
        sendSuccess(['message' => ['id' => $id, 'fromId' => $auth['id'], 'toId' => $to['id'], 'body' => $body, 'createdAt' => $now, 'readAt' => null, 'mine' => true,
            'fileName' => mb_substr($name, 0, 255), 'fileMime' => $mime, 'fileSize' => (int) $f['size'], 'fileKind' => $kind]], 'Sent', 201);
    }

    // GET /api/chat/file/:id[?download=1] — sender or recipient only
    public function file(string $id): void
    {
        $auth = authenticate();
        $s = db()->prepare('SELECT * FROM `ChatMessage` WHERE id=? LIMIT 1'); $s->execute([$id]);
        $m = $s->fetch();
        if (!$m || !$m['storedName'] || ($m['fromId'] !== $auth['id'] && $m['toId'] !== $auth['id'])) sendError('File not found.', 404);
        $path = UPLOADS_PATH . '/chat/' . basename($m['storedName']);
        if (!is_file($path)) sendError('The file is missing on the server.', 404);
        $ext = strtolower(pathinfo($m['storedName'], PATHINFO_EXTENSION));
        $inline = isset(self::INLINE[$ext]) && !qp('download');
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: ' . ($inline ? self::INLINE[$ext] : 'application/octet-stream'));
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . str_replace('"', '', $m['fileName']) . '"; filename*=UTF-8\'\'' . rawurlencode($m['fileName']));
        header('Cache-Control: private, max-age=86400');
        readfile($path);
        exit;
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
        $last = db()->prepare('SELECT IF(storedName IS NOT NULL AND body=\'\', CONCAT(\'📎 \', fileName), body) AS body, fromId FROM `ChatMessage` WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?) ORDER BY createdAt DESC LIMIT 1');
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
        $sql = 'SELECT id, fromId, toId, body, createdAt, readAt, fileName, fileMime, fileSize, fileKind FROM `ChatMessage`
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
