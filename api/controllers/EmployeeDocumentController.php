<?php
/**
 * Module 1 — Employee document uploads (Address Proof, Bank Passbook,
 * Aadhaar Card, PAN Card, Passport Photo).
 *
 * Security notes (see also config.php's EMPLOYEE_DOCS_PATH comment):
 *  - Files are stored outside the web-servable tree. The only way to
 *    read one back is download(), which requires auth.
 *  - The file extension AND the file's actual bytes (via finfo, not the
 *    client-supplied Content-Type) are both checked against an allow-list
 *    before anything is written to disk.
 *  - The on-disk filename is a random id, never derived from the
 *    original filename or any other user input.
 *  - One row per (employee, document type) — uploading again for a type
 *    that already exists replaces it (delete old file + row, insert
 *    new), which is what the spec's "Delete & Replace" asks for. Use
 *    delete() for pure removal with no replacement.
 */
class EmployeeDocumentController
{
    private const DOCUMENT_TYPES = ['ADDRESS_PROOF', 'BANK_PASSBOOK', 'AADHAAR_CARD', 'PAN_CARD', 'PHOTO'];

    /** extension => expected real MIME type, as reported by finfo against the file's actual bytes. */
    private const ALLOWED_EXTENSIONS = [
        'jpg'  => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png'  => 'image/png',
        'pdf'  => 'application/pdf',
    ];

    private const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — adjust if your scans need more.

    private function ensureStorageDir(): void
    {
        if (!is_dir(EMPLOYEE_DOCS_PATH)) {
            mkdir(EMPLOYEE_DOCS_PATH, 0755, true);
        }
    }

    /** Loads the target employee and enforces admin-tier-or-self, same rule used elsewhere in the app. */
    private function loadEmployeeOrDeny(array $auth, string $userId): array
    {
        if (!can_access_user($auth, $userId)) {
            sendError('Access denied.', 403);
        }
        $s = db()->prepare('SELECT id FROM `User` WHERE id=? LIMIT 1');
        $s->execute([$userId]);
        $u = $s->fetch();
        if (!$u) sendError('Employee not found.', 404);
        return $u;
    }

    private function rowForClient(array $doc): array
    {
        return [
            'id'               => $doc['id'],
            'documentType'     => $doc['documentType'],
            'originalFilename' => $doc['originalFilename'],
            'mimeType'         => $doc['mimeType'],
            'fileSize'         => (int) $doc['fileSize'],
            'createdAt'        => $doc['createdAt'],
            'updatedAt'        => $doc['updatedAt'],
        ];
        // Deliberately omits storedFilename — the client never needs the
        // on-disk name, only the id (used for download/delete).
    }

    // GET /api/users/:id/documents
    public function list(string $userId): void
    {
        $auth = authenticate();
        $this->loadEmployeeOrDeny($auth, $userId);

        $s = db()->prepare(
            'SELECT id,documentType,originalFilename,mimeType,fileSize,createdAt,updatedAt
             FROM `EmployeeDocument` WHERE userId=? ORDER BY documentType ASC'
        );
        $s->execute([$userId]);
        $docs = array_map([$this, 'rowForClient'], $s->fetchAll());
        sendSuccess(['documents' => $docs]);
    }

    // POST /api/users/:id/documents  (multipart/form-data: file, documentType)
    public function upload(string $userId): void
    {
        $auth = authenticate();
        $this->loadEmployeeOrDeny($auth, $userId);

        $documentType = strtoupper(trim($_POST['documentType'] ?? ''));
        if (!in_array($documentType, self::DOCUMENT_TYPES, true)) {
            sendError('documentType must be one of: ' . implode(', ', self::DOCUMENT_TYPES), 400);
        }

        if (empty($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) {
            sendError('No file uploaded.', 400);
        }
        $file = $_FILES['file'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            sendError('Upload failed (error code ' . $file['error'] . ').', 400);
        }
        if (!is_uploaded_file($file['tmp_name'])) {
            sendError('Invalid upload.', 400);
        }
        if ($file['size'] <= 0 || $file['size'] > self::MAX_FILE_SIZE_BYTES) {
            $mb = self::MAX_FILE_SIZE_BYTES / (1024 * 1024);
            sendError("File must be between 1 byte and {$mb}MB.", 400);
        }

        // Extension allow-list first (cheap check)...
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!array_key_exists($ext, self::ALLOWED_EXTENSIONS)) {
            sendError('Only JPG, JPEG, PNG, and PDF files are allowed.', 400);
        }

        // ...then verify the file's ACTUAL content matches — never trust
        // $_FILES['file']['type'], it's client-supplied and trivially spoofed.
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $realMime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);
        if ($realMime !== self::ALLOWED_EXTENSIONS[$ext]) {
            sendError('File content does not match a JPG, PNG, or PDF file.', 400);
        }

        $this->ensureStorageDir();
        $storedFilename = gen_id() . '.' . $ext;
        $dest = EMPLOYEE_DOCS_PATH . '/' . $storedFilename;
        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            sendError('Could not save the uploaded file.', 500);
        }

        // Upsert — replace any existing document of this type for this employee.
        $existingStmt = db()->prepare('SELECT id,storedFilename FROM `EmployeeDocument` WHERE userId=? AND documentType=? LIMIT 1');
        $existingStmt->execute([$userId, $documentType]);
        $existing = $existingStmt->fetch();

        $now = now_sql();
        if ($existing) {
            $oldPath = EMPLOYEE_DOCS_PATH . '/' . $existing['storedFilename'];
            if (is_file($oldPath)) @unlink($oldPath);

            db()->prepare(
                'UPDATE `EmployeeDocument`
                 SET originalFilename=?, storedFilename=?, mimeType=?, fileSize=?, uploadedById=?, updatedAt=?
                 WHERE id=?'
            )->execute([
                basename($file['name']), $storedFilename, $realMime, (int) $file['size'], $auth['id'], $now,
                $existing['id'],
            ]);
            $docId = $existing['id'];
            log_activity($auth['id'], 'EMPLOYEE_DOCUMENT_REPLACED', 'EmployeeDocument', $docId, ['userId' => $userId, 'documentType' => $documentType]);
        } else {
            $docId = gen_id();
            db()->prepare(
                'INSERT INTO `EmployeeDocument`
                 (id,userId,documentType,originalFilename,storedFilename,mimeType,fileSize,uploadedById,createdAt,updatedAt)
                 VALUES (?,?,?,?,?,?,?,?,?,?)'
            )->execute([
                $docId, $userId, $documentType, basename($file['name']), $storedFilename, $realMime, (int) $file['size'], $auth['id'], $now, $now,
            ]);
            log_activity($auth['id'], 'EMPLOYEE_DOCUMENT_UPLOADED', 'EmployeeDocument', $docId, ['userId' => $userId, 'documentType' => $documentType]);
        }

        $s = db()->prepare('SELECT * FROM `EmployeeDocument` WHERE id=? LIMIT 1');
        $s->execute([$docId]);
        sendSuccess(['document' => $this->rowForClient($s->fetch())], 'Document uploaded', $existing ? 200 : 201);
    }

    // GET /api/documents/:id?download=1
    public function download(string $docId): void
    {
        $auth = authenticate();
        $s = db()->prepare('SELECT * FROM `EmployeeDocument` WHERE id=? LIMIT 1');
        $s->execute([$docId]);
        $doc = $s->fetch();
        if (!$doc) sendError('Document not found.', 404);

        if (!can_access_user($auth, $doc['userId'])) {
            sendError('Access denied.', 403);
        }

        $path = EMPLOYEE_DOCS_PATH . '/' . $doc['storedFilename'];
        if (!is_file($path)) sendError('File missing on server.', 404);

        // Strip anything that could break out of the header value (CR/LF, quotes).
        $safeName = str_replace(['"', "\r", "\n"], '', $doc['originalFilename']);
        $disposition = qp('download') ? 'attachment' : 'inline';

        header('Content-Type: ' . $doc['mimeType']);
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . filesize($path));
        header("Content-Disposition: $disposition; filename=\"$safeName\"");
        readfile($path);
        exit;
    }

    // DELETE /api/documents/:id
    public function delete(string $docId): void
    {
        $auth = authenticate();
        $s = db()->prepare('SELECT * FROM `EmployeeDocument` WHERE id=? LIMIT 1');
        $s->execute([$docId]);
        $doc = $s->fetch();
        if (!$doc) sendError('Document not found.', 404);

        if (!can_access_user($auth, $doc['userId'])) {
            sendError('Access denied.', 403);
        }

        $path = EMPLOYEE_DOCS_PATH . '/' . $doc['storedFilename'];
        if (is_file($path)) @unlink($path);
        db()->prepare('DELETE FROM `EmployeeDocument` WHERE id=?')->execute([$docId]);

        log_activity($auth['id'], 'EMPLOYEE_DOCUMENT_DELETED', 'EmployeeDocument', $docId, ['userId' => $doc['userId'], 'documentType' => $doc['documentType']]);
        sendSuccess([], 'Document deleted');
    }
}
