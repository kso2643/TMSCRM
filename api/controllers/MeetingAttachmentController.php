<?php
/**
 * Photos, files and voice notes on a meeting / follow-up.
 *
 *   GET    /api/meetings/:id/attachments            list
 *   POST   /api/meetings/:id/attachments            multipart: file, kind (PHOTO|FILE|VOICE, optional), durationSec (voice)
 *   GET    /api/meetings/:id/attachments/:aid       the file itself (inline; ?download=1 to save)
 *   DELETE /api/meetings/:id/attachments/:aid       remove
 *
 * Files are checked against an allow-list (extension AND real content type),
 * stored under random names in uploads/meeting-files/ — a folder the web
 * server never serves directly (see uploads/.htaccess) — and only streamed
 * through this controller to logged-in users.
 *
 * Who can do what: anyone logged in can see a meeting's attachments (meetings
 * are visible to everyone, as on the Meetings page); the meeting's owner, the
 * person it is assigned to and Manager/Admin/Super Admin can add; the
 * uploader, the meeting's owner and Manager/Admin/Super Admin can delete.
 */
class MeetingAttachmentController
{
    private const MAX_BYTES = 15 * 1024 * 1024;   // 15 MB per file
    private const MAX_PER_MEETING = 30;

    /** extension => [kind, allowed real MIME types (finfo)] */
    private const TYPES = [
        'jpg'  => ['PHOTO', ['image/jpeg']],
        'jpeg' => ['PHOTO', ['image/jpeg']],
        'png'  => ['PHOTO', ['image/png']],
        'webp' => ['PHOTO', ['image/webp']],
        'gif'  => ['PHOTO', ['image/gif']],
        'heic' => ['PHOTO', ['image/heic', 'image/heif', 'application/octet-stream']],
        'heif' => ['PHOTO', ['image/heic', 'image/heif', 'application/octet-stream']],
        'pdf'  => ['FILE', ['application/pdf']],
        'doc'  => ['FILE', ['application/msword', 'application/vnd.ms-office', 'application/CDFV2', 'application/x-ole-storage', 'application/octet-stream']],
        'docx' => ['FILE', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream']],
        'xls'  => ['FILE', ['application/vnd.ms-excel', 'application/vnd.ms-office', 'application/CDFV2', 'application/x-ole-storage', 'application/octet-stream']],
        'xlsx' => ['FILE', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream']],
        'ppt'  => ['FILE', ['application/vnd.ms-powerpoint', 'application/vnd.ms-office', 'application/CDFV2', 'application/x-ole-storage', 'application/octet-stream']],
        'pptx' => ['FILE', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream']],
        'csv'  => ['FILE', ['text/csv', 'text/plain', 'application/csv']],
        'txt'  => ['FILE', ['text/plain']],
        'webm' => ['VOICE', ['audio/webm', 'video/webm']],
        'ogg'  => ['VOICE', ['audio/ogg', 'video/ogg', 'application/ogg']],
        'oga'  => ['VOICE', ['audio/ogg', 'application/ogg']],
        'opus' => ['VOICE', ['audio/ogg', 'audio/opus', 'application/ogg']],
        'm4a'  => ['VOICE', ['audio/mp4', 'audio/x-m4a', 'video/mp4', 'audio/m4a']],
        'mp4'  => ['VOICE', ['audio/mp4', 'video/mp4', 'audio/x-m4a']],
        'aac'  => ['VOICE', ['audio/aac', 'audio/x-aac', 'audio/x-hx-aac-adts']],
        'mp3'  => ['VOICE', ['audio/mpeg', 'audio/mp3']],
        'wav'  => ['VOICE', ['audio/wav', 'audio/x-wav', 'audio/vnd.wave']],
        'amr'  => ['VOICE', ['audio/amr', 'audio/AMR']],
    ];
    /** What the browser is told the file is when streaming it back. */
    private const SERVE_MIME = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif',
        'heic' => 'image/heic', 'heif' => 'image/heif', 'pdf' => 'application/pdf',
        'webm' => 'audio/webm', 'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'opus' => 'audio/ogg', 'm4a' => 'audio/mp4', 'mp4' => 'audio/mp4',
        'aac' => 'audio/aac', 'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'amr' => 'audio/amr',
    ];

    public function __construct()
    {
        ensure_schema([
            'MeetingAttachment' => [
                'create' => "CREATE TABLE IF NOT EXISTS `MeetingAttachment` (
                    `id` VARCHAR(30) NOT NULL, `meetingId` VARCHAR(30) NOT NULL,
                    `kind` VARCHAR(10) NOT NULL, `originalName` VARCHAR(255) NOT NULL, `storedName` VARCHAR(80) NOT NULL,
                    `mime` VARCHAR(100) NOT NULL, `sizeBytes` INT NOT NULL, `durationSec` INT NULL,
                    `uploadedById` VARCHAR(30) NOT NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`), KEY `MeetingAttachment_meeting_idx` (`meetingId`, `createdAt`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            ],
        ], 'migration_meeting_attachments.sql');
    }

    public static function storageDir(): string
    {
        $dir = UPLOADS_PATH . '/meeting-files';
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        // Never served directly — files go out only through this controller.
        if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
        if (!is_file($dir . '/index.html')) @file_put_contents($dir . '/index.html', '');
        return $dir;
    }

    private function meeting(string $id): array
    {
        $s = db()->prepare('SELECT id, userId, assignedToId FROM `Meeting` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        $m = $s->fetch();
        if (!$m) sendError('Meeting not found.', 404);
        return $m;
    }

    private function shape(array $r): array
    {
        return [
            'id' => $r['id'], 'kind' => $r['kind'], 'name' => $r['originalName'], 'mime' => $r['mime'],
            'size' => (int) $r['sizeBytes'], 'durationSec' => $r['durationSec'] === null ? null : (int) $r['durationSec'],
            'uploadedBy' => ['id' => $r['uploadedById'], 'name' => $r['uploaderName'] ?? null],
            'createdAt' => $r['createdAt'],
        ];
    }

    /** Attachment counts per meeting id (for list badges). */
    public static function counts(array $meetingIds): array
    {
        if (!$meetingIds) return [];
        try {
            $in = implode(',', array_fill(0, count($meetingIds), '?'));
            $s = db()->prepare("SELECT meetingId, kind, COUNT(*) n FROM `MeetingAttachment` WHERE meetingId IN ($in) GROUP BY meetingId, kind");
            $s->execute(array_values($meetingIds));
            $out = [];
            foreach ($s->fetchAll() as $r) $out[$r['meetingId']][strtolower($r['kind'])] = (int) $r['n'];
            return $out;
        } catch (PDOException $e) {
            return []; // table not created yet
        }
    }

    // GET /api/meetings/:id/attachments
    public function index(string $id): void
    {
        authenticate();
        $this->meeting($id);
        $s = db()->prepare('SELECT a.*, u.name AS uploaderName FROM `MeetingAttachment` a LEFT JOIN `User` u ON u.id=a.uploadedById WHERE a.meetingId=? ORDER BY a.createdAt ASC, a.id ASC');
        $s->execute([$id]);
        sendSuccess(['attachments' => array_map([$this, 'shape'], $s->fetchAll())]);
    }

    // POST /api/meetings/:id/attachments
    public function upload(string $id): void
    {
        $auth = authenticate();
        $m = $this->meeting($id);
        if (!is_admin_tier($auth['role']) && $m['userId'] !== $auth['id'] && $m['assignedToId'] !== $auth['id']) {
            sendError('Only the person who logged this meeting, the person it is assigned to, or an admin can add attachments.', 403);
        }
        $c = db()->prepare('SELECT COUNT(*) FROM `MeetingAttachment` WHERE meetingId=?'); $c->execute([$id]);
        if ((int) $c->fetchColumn() >= self::MAX_PER_MEETING) sendError('This meeting already has ' . self::MAX_PER_MEETING . ' attachments (the maximum).', 400);

        if (empty($_FILES['file']) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
            // Over post_max_size: PHP drops the whole body, so there is no $_FILES at all.
            sendError('The file is too large — the limit is ' . (self::MAX_BYTES / 1048576) . ' MB per file.', 400);
        }
        if (empty($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) sendError('Please choose a file.', 400);
        $f = $_FILES['file'];
        if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $f['size'] > self::MAX_BYTES) {
            sendError('“' . basename((string) $f['name']) . '” is too large — the limit is ' . (self::MAX_BYTES / 1048576) . ' MB per file.', 400);
        }
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) sendError('Upload failed (error ' . $f['error'] . '). Please try again.', 400);
        if ($f['size'] <= 0) sendError('The file is empty.', 400);

        $orig = trim(str_replace(["\0", '/', '\\'], '', basename((string) $f['name']))) ?: 'file';
        $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $real = (string) finfo_file($finfo, $f['tmp_name']);
        finfo_close($finfo);
        // Voice notes from the browser recorder may arrive without a useful name.
        if ($ext === '' || !isset(self::TYPES[$ext])) {
            $byMime = ['audio/webm' => 'webm', 'video/webm' => 'webm', 'audio/ogg' => 'ogg', 'application/ogg' => 'ogg', 'audio/mp4' => 'm4a', 'video/mp4' => 'm4a',
                       'audio/mpeg' => 'mp3', 'audio/wav' => 'wav', 'audio/x-wav' => 'wav', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];
            if ($ext === '' && isset($byMime[$real])) { $ext = $byMime[$real]; $orig .= '.' . $ext; }
        }
        if (!isset(self::TYPES[$ext])) {
            sendError('“' . $orig . '” is not an allowed file type. Allowed: photos (JPG, PNG, WEBP, HEIC), PDF, Word, Excel, PowerPoint, CSV, text, and voice notes (WEBM, OGG, M4A, MP3, WAV).', 400);
        }
        [$kind, $mimes] = self::TYPES[$ext];
        if (!in_array($real, $mimes, true)) sendError('“' . $orig . '” does not look like a real .' . $ext . ' file (detected ' . $real . ').', 400);
        $asked = strtoupper((string) ($_POST['kind'] ?? ''));
        if ($asked === 'VOICE' && $kind === 'VOICE') $kind = 'VOICE';
        elseif ($asked === 'FILE') $kind = 'FILE';          // e.g. a photo attached as a document
        $dur = isset($_POST['durationSec']) && is_numeric($_POST['durationSec']) ? max(0, min(36000, (int) round((float) $_POST['durationSec']))) : null;

        $stored = gen_id() . bin2hex(random_bytes(6)) . '.' . $ext;
        if (!move_uploaded_file($f['tmp_name'], self::storageDir() . '/' . $stored)) sendError('Could not save the file on the server.', 500);
        $aid = gen_id();
        db()->prepare('INSERT INTO `MeetingAttachment` (id, meetingId, kind, originalName, storedName, mime, sizeBytes, durationSec, uploadedById, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([$aid, $id, $kind, mb_substr($orig, 0, 255), $stored, $real, (int) $f['size'], $kind === 'VOICE' ? $dur : null, $auth['id'], now_sql()]);
        db()->prepare('UPDATE `Meeting` SET updatedAt=? WHERE id=?')->execute([now_sql(), $id]);
        log_activity($auth['id'], 'MEETING_ATTACHMENT_ADDED', 'Meeting', $id, ['kind' => $kind, 'name' => $orig]);
        $s = db()->prepare('SELECT a.*, u.name AS uploaderName FROM `MeetingAttachment` a LEFT JOIN `User` u ON u.id=a.uploadedById WHERE a.id=?');
        $s->execute([$aid]);
        sendSuccess(['attachment' => $this->shape($s->fetch())], 'Attachment added', 201);
    }

    private function find(string $id, string $aid): array
    {
        $s = db()->prepare('SELECT * FROM `MeetingAttachment` WHERE id=? AND meetingId=? LIMIT 1');
        $s->execute([$aid, $id]);
        $a = $s->fetch();
        if (!$a) sendError('Attachment not found.', 404);
        return $a;
    }

    // GET /api/meetings/:id/attachments/:aid
    public function file(string $id, string $aid): void
    {
        authenticate();
        $a = $this->find($id, $aid);
        $path = self::storageDir() . '/' . basename($a['storedName']);
        if (!is_file($path)) sendError('The file is missing on the server.', 404);
        $ext = strtolower(pathinfo($a['storedName'], PATHINFO_EXTENSION));
        $mime = self::SERVE_MIME[$ext] ?? 'application/octet-stream';
        $inline = !qp('download') && isset(self::SERVE_MIME[$ext]);
        $name = str_replace(['"', "\r", "\n"], '', $a['originalName']);
        $size = filesize($path);
        header('Content-Type: ' . $mime);
        header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
        header('Cache-Control: private, max-age=86400');
        header('Accept-Ranges: bytes');
        header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . $name . '"; filename*=UTF-8\'\'' . rawurlencode($a['originalName']));
        // Range support so voice notes can be scrubbed on phones.
        $start = 0; $end = $size - 1;
        if (!empty($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $mm)) {
            if ($mm[1] !== '') $start = (int) $mm[1];
            if ($mm[2] !== '') $end = min((int) $mm[2], $size - 1);
            if ($mm[1] === '' && $mm[2] !== '') { $start = max(0, $size - (int) $mm[2]); $end = $size - 1; }
            if ($start > $end || $start >= $size) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
            http_response_code(206);
            header("Content-Range: bytes $start-$end/$size");
        }
        header('Content-Length: ' . ($end - $start + 1));
        $fh = fopen($path, 'rb');
        fseek($fh, $start);
        $left = $end - $start + 1;
        while ($left > 0 && !feof($fh)) { $chunk = fread($fh, min(65536, $left)); echo $chunk; $left -= strlen($chunk); }
        fclose($fh);
        exit;
    }

    // DELETE /api/meetings/:id/attachments/:aid
    public function delete(string $id, string $aid): void
    {
        $auth = authenticate();
        $m = $this->meeting($id);
        $a = $this->find($id, $aid);
        if (!is_admin_tier($auth['role']) && $a['uploadedById'] !== $auth['id'] && $m['userId'] !== $auth['id']) {
            sendError('Only the person who added it, the meeting owner, or an admin can remove this attachment.', 403);
        }
        db()->prepare('DELETE FROM `MeetingAttachment` WHERE id=?')->execute([$aid]);
        $path = self::storageDir() . '/' . basename($a['storedName']);
        if (is_file($path)) @unlink($path);
        log_activity($auth['id'], 'MEETING_ATTACHMENT_REMOVED', 'Meeting', $id, ['kind' => $a['kind'], 'name' => $a['originalName']]);
        sendSuccess([], 'Attachment removed');
    }
}
