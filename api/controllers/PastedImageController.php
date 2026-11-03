<?php
/**
 * Screenshots pasted (Ctrl+V) into a text box — chat, notes, CEO Desk replies, any page.
 *
 * The page uploads the picture and types its link into the text; every page shows such links
 * as the picture itself (crm-global.js). The link holds a long random key, so it can be shown
 * with a plain <img> (no login header) but can't be guessed.
 *
 *   POST /api/pasted-images            multipart "file" (PNG / JPG / WebP / GIF, ≤ 10 MB) → { url }
 *   GET  /api/pasted-images/<key>.<ext> the picture
 *
 * Files live in uploads/pasted/ (part of the full backup).
 */
class PastedImageController
{
    private const TYPES = [IMAGETYPE_PNG => ['png', 'image/png'], IMAGETYPE_JPEG => ['jpg', 'image/jpeg'], IMAGETYPE_WEBP => ['webp', 'image/webp'], IMAGETYPE_GIF => ['gif', 'image/gif']];

    private static function dir(): string { return UPLOADS_PATH . '/pasted'; }

    // POST /api/pasted-images
    public function upload(): void
    {
        $auth = authenticate();
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('No picture was pasted.', 400);
        if ($f['size'] <= 0 || $f['size'] > 10 * 1024 * 1024) sendError('The picture must be under 10 MB.', 400);
        $info = @getimagesize($f['tmp_name']);
        $t = self::TYPES[$info[2] ?? 0] ?? null;
        if (!$t) sendError('Only pictures (PNG, JPG, WebP, GIF) can be pasted.', 400);
        $dir = self::dir();
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the picture on the server.', 500);
        $key = bin2hex(random_bytes(20));
        $name = $key . '.' . $t[0];
        if (!move_uploaded_file($f['tmp_name'], "$dir/$name") && !rename($f['tmp_name'], "$dir/$name")) sendError('Could not save the picture on the server.', 500);
        log_activity($auth['id'], 'IMAGE_PASTED', 'PastedImage', $key, ['size' => (int) $f['size']]);
        sendSuccess(['url' => '/api/pasted-images/' . $name, 'width' => (int) ($info[0] ?? 0), 'height' => (int) ($info[1] ?? 0)], 'Picture added', 201);
    }

    // GET /api/pasted-images/<key>.<ext>
    public function show(string $name): void
    {
        if (!preg_match('/^([a-f0-9]{40})\.(png|jpg|webp|gif)$/', $name, $m)) sendError('Not found.', 404);
        $file = self::dir() . '/' . $name;
        if (!is_file($file)) sendError('Not found.', 404);
        $types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif'];
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: ' . $types[$m[2]]);
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, max-age=604800, immutable');
        header('Content-Length: ' . filesize($file));
        readfile($file); exit;
    }
}
