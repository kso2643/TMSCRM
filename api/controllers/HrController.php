<?php
/**
 * HR — "Add new employee" (v11.52).
 *
 *   GET  /api/hr/next-code?prefix=TMS   → { code: "TMS-024" }  (next free employee code)
 *   POST /api/hr/employees              → multipart: every detail + the 7 documents → creates the login
 *   GET  /api/hr/employees/:id/docs     → which documents are on file / missing
 *   POST /api/hr/employees/:id/docs     → upload / replace one document (documentType + file)
 *   GET  /api/hr/docs/:docId            → view / download (admin, or the employee themself)
 *
 * The employee can sign in with their e-mail OR their employee code (TMS-024).
 * Documents are kept in uploads/hr-docs, which the web server never serves directly.
 */
class HrController
{
    public const DOC_TYPES = [
        'AADHAAR'       => 'Aadhaar card',
        'PAN'           => 'PAN card',
        'BANK_PASSBOOK' => 'Bank passbook (front page)',
        'PHOTO'         => 'Passport size photo',
        'SSLC'          => '10th mark sheet',
        'HSC'           => '12th mark sheet',
        'DEGREE'        => 'Degree certificate',
    ];
    private const EXT = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'pdf' => 'application/pdf'];
    private const MAX_BYTES = 8 * 1024 * 1024;
    /** Details the form insists on (besides name / e-mail / role). */
    private const REQUIRED = [
        'phone' => 'Mobile number', 'designation' => 'Designation', 'department' => 'Department', 'dateOfJoining' => 'Date of joining',
        'dateOfBirth' => 'Date of birth', 'gender' => 'Gender', 'fatherName' => "Father's name",
        'permanentAddress' => 'Permanent address', 'permanentCity' => 'City', 'permanentState' => 'State', 'permanentPincode' => 'Pincode',
        'emergencyContactName' => 'Emergency contact name', 'emergencyContactPhone' => 'Emergency contact phone',
        'aadharNumber' => 'Aadhaar number', 'panNumber' => 'PAN number',
        'bankName' => 'Bank name', 'bankAccountNumber' => 'Account number', 'bankIFSC' => 'IFSC',
    ];

    public function __construct()
    {
        ensure_schema(['EmployeeFile' => ['create' => "CREATE TABLE IF NOT EXISTS `EmployeeFile` (
  `id` VARCHAR(30) NOT NULL, `userId` VARCHAR(30) NOT NULL, `docType` VARCHAR(20) NOT NULL,
  `fileName` VARCHAR(255) NOT NULL, `storedName` VARCHAR(80) NOT NULL, `mime` VARCHAR(60) NOT NULL, `size` INT NOT NULL DEFAULT 0,
  `uploadedById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `EmployeeFile_user_type` (`userId`,`docType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]], 'HR documents');
    }

    private static function dir(): string
    {
        $d = UPLOADS_PATH . '/hr-docs';
        if (!is_dir($d)) @mkdir($d, 0755, true);
        if (!is_file("$d/.htaccess")) @file_put_contents("$d/.htaccess", "# Private: served only through /api/hr/docs/:id\nRequire all denied\nDeny from all\n");
        return $d;
    }

    private static function prefix(): string
    {
        $p = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) (qp('prefix') ?: ($_POST['prefix'] ?? 'TMS'))));
        return $p !== '' ? substr($p, 0, 6) : 'TMS';
    }

    /** Next free code for a prefix: the highest number in use + 1, three digits (TMS-024). */
    public static function nextCode(string $prefix): string
    {
        $s = db()->prepare("SELECT employeeCode FROM `User` WHERE employeeCode LIKE ?");
        $s->execute([$prefix . '%']);
        $max = 0;
        foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $c) {
            if (preg_match('/^' . preg_quote($prefix, '/') . '[-\s]?0*(\d+)$/i', trim((string) $c), $m)) $max = max($max, (int) $m[1]);
        }
        return sprintf('%s-%03d', $prefix, $max + 1);
    }

    public function code(): void
    {
        $auth = authenticate(); require_admin($auth);
        sendSuccess(['code' => self::nextCode(self::prefix()), 'docTypes' => self::DOC_TYPES]);
    }

    /** Checks one uploaded file → [ext, mime]. */
    private static function checkFile(array $f, string $label): array
    {
        if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) sendError("Upload of \"$label\" failed — try again.", 400);
        if ($f['size'] <= 0 || $f['size'] > self::MAX_BYTES) sendError("\"$label\" must be smaller than 8 MB.", 400);
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        if (!isset(self::EXT[$ext])) sendError("\"$label\": upload a JPG, PNG or PDF file.", 400);
        $fi = finfo_open(FILEINFO_MIME_TYPE); $real = finfo_file($fi, $f['tmp_name']); finfo_close($fi);
        if ($real !== self::EXT[$ext]) sendError("\"$label\" is not a real " . strtoupper($ext) . ' file.', 400);
        return [$ext, $real];
    }

    private static function store(string $userId, string $type, array $f, string $byId): void
    {
        [$ext, $mime] = self::checkFile($f, self::DOC_TYPES[$type]);
        $dir = self::dir();
        $id = gen_id(); $stored = $id . '.' . $ext;
        if (!(@move_uploaded_file($f['tmp_name'], "$dir/$stored") || @rename($f['tmp_name'], "$dir/$stored"))) sendError('Could not save the file on the server.', 500);
        $old = db()->prepare('SELECT storedName FROM `EmployeeFile` WHERE userId=? AND docType=?'); $old->execute([$userId, $type]);
        if ($o = $old->fetchColumn()) @unlink("$dir/" . basename($o));
        $name = mb_substr(preg_replace('/[^\w.\- ()]+/u', '_', (string) $f['name']), 0, 255);
        db()->prepare('INSERT INTO `EmployeeFile` (id,userId,docType,fileName,storedName,mime,size,uploadedById,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE fileName=VALUES(fileName), storedName=VALUES(storedName), mime=VALUES(mime), size=VALUES(size), uploadedById=VALUES(uploadedById), updatedAt=VALUES(updatedAt)')
            ->execute([$id, $userId, $type, $name, $stored, $mime, (int) $f['size'], $byId, now_sql(), now_sql()]);
    }

    private static function genPassword(): string
    {
        $a = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; $b = 'abcdefghijkmnpqrstuvwxyz'; $d = '23456789';
        $p = $a[random_int(0, 23)] . $b[random_int(0, 23)] . $b[random_int(0, 23)] . $b[random_int(0, 23)] . '@';
        for ($i = 0; $i < 4; $i++) $p .= $d[random_int(0, 7)];
        return $p;
    }

    // POST /api/hr/employees — everything in one go; nothing is created unless all details + documents are there
    public function onboard(): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = $_POST;
        $miss = [];
        foreach (['name' => 'Full name', 'email' => 'E-mail (login)'] + self::REQUIRED as $k => $label) if (trim((string) ($b[$k] ?? '')) === '') $miss[] = $label;
        foreach (self::DOC_TYPES as $t => $label) if (empty($_FILES['doc_' . $t]) || ($_FILES['doc_' . $t]['error'] ?? 4) === UPLOAD_ERR_NO_FILE) $miss[] = $label . ' (file)';
        if ($miss) sendError('Please fill / attach: ' . implode(', ', $miss), 400, ['missing' => $miss]);
        if (!preg_match('/^\d{12}$/', preg_replace('/\s+/', '', (string) $b['aadharNumber']))) sendError('Aadhaar number must be 12 digits.', 400);
        if (!preg_match('/^[A-Z]{5}\d{4}[A-Z]$/', strtoupper(trim((string) $b['panNumber'])))) sendError('PAN must look like ABCDE1234F.', 400);
        if (!preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', strtoupper(trim((string) $b['bankIFSC'])))) sendError('IFSC must look like SBIN0001234.', 400);
        foreach (self::DOC_TYPES as $t => $label) self::checkFile($_FILES['doc_' . $t], $label);

        // the code: the one shown on the form if still free, else the next free one
        $prefix = self::prefix();
        $code = strtoupper(trim((string) ($b['employeeCode'] ?? '')));
        if ($code !== '') {
            $s = db()->prepare('SELECT id FROM `User` WHERE employeeCode=? LIMIT 1'); $s->execute([$code]);
            if ($s->fetch()) $code = '';
        }
        if ($code === '') $code = self::nextCode($prefix);
        $pass = (string) ($b['password'] ?? '');
        $generated = $pass === '';
        if ($generated) $pass = self::genPassword();

        $body = $b;
        $body['employeeCode'] = $code;
        $body['password'] = $pass;
        $body['aadharNumber'] = preg_replace('/\s+/', '', (string) $b['aadharNumber']);
        $body['panNumber'] = strtoupper(trim((string) $b['panNumber']));
        $body['bankIFSC'] = strtoupper(trim((string) $b['bankIFSC']));
        $body['role'] = $b['role'] ?? 'SALES';
        $uc = new UserController();
        $id = $uc->createUser($auth, $body);
        foreach (self::DOC_TYPES as $t => $label) self::store($id, $t, $_FILES['doc_' . $t], $auth['id']);
        log_activity($auth['id'], 'EMPLOYEE_ONBOARDED', 'User', $id, ['employeeCode' => $code]);
        sendSuccess([
            'user' => $uc->safeUser($id),
            'login' => ['userId' => $code, 'email' => strtolower(trim((string) $b['email'])), 'password' => $pass, 'generated' => $generated],
            'documents' => self::docsFor($id),
        ], "Employee $code created", 201);
    }

    private static function docsFor(string $userId): array
    {
        $s = db()->prepare('SELECT id,docType,fileName,mime,size,updatedAt FROM `EmployeeFile` WHERE userId=?'); $s->execute([$userId]);
        $have = [];
        foreach ($s->fetchAll() as $r) $have[$r['docType']] = $r;
        $out = [];
        foreach (self::DOC_TYPES as $t => $label) {
            $r = $have[$t] ?? null;
            $out[] = ['type' => $t, 'label' => $label, 'id' => $r['id'] ?? null, 'fileName' => $r['fileName'] ?? null,
                      'mime' => $r['mime'] ?? null, 'size' => isset($r['size']) ? (int) $r['size'] : null, 'updatedAt' => $r['updatedAt'] ?? null];
        }
        return $out;
    }

    /** Missing-document count for every user (for the HR list). */
    public function missing(): void
    {
        $auth = authenticate(); require_admin($auth);
        $rows = db()->query('SELECT userId, COUNT(DISTINCT docType) n FROM `EmployeeFile` GROUP BY userId')->fetchAll();
        $m = [];
        foreach ($rows as $r) $m[$r['userId']] = count(self::DOC_TYPES) - (int) $r['n'];
        sendSuccess(['have' => $m, 'total' => count(self::DOC_TYPES)]);
    }

    private static function canSee(array $auth, string $userId): bool
    {
        return $auth['id'] === $userId || in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true);
    }

    public function docs(string $userId): void
    {
        $auth = authenticate();
        if (!self::canSee($auth, $userId)) sendError('Access denied.', 403);
        sendSuccess(['documents' => self::docsFor($userId)]);
    }

    public function upload(string $userId): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->prepare('SELECT id FROM `User` WHERE id=?'); $s->execute([$userId]);
        if (!$s->fetch()) sendError('Employee not found.', 404);
        $t = strtoupper(trim((string) ($_POST['documentType'] ?? '')));
        if (!isset(self::DOC_TYPES[$t])) sendError('Pick the document type.', 400);
        if (empty($_FILES['file'])) sendError('Choose a file.', 400);
        self::store($userId, $t, $_FILES['file'], $auth['id']);
        sendSuccess(['documents' => self::docsFor($userId)], self::DOC_TYPES[$t] . ' saved');
    }

    public function file(string $docId): void
    {
        $auth = authenticate();
        $s = db()->prepare('SELECT * FROM `EmployeeFile` WHERE id=?'); $s->execute([$docId]);
        $f = $s->fetch();
        if (!$f || !self::canSee($auth, $f['userId'])) sendError('Document not found.', 404);
        $path = self::dir() . '/' . basename($f['storedName']);
        if (!is_file($path)) sendError('The file is missing on the server (was the uploads folder replaced?).', 404);
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: ' . $f['mime']);
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: private, no-store');
        header('Content-Disposition: ' . (qp('download') ? 'attachment' : 'inline') . '; filename="' . str_replace('"', '', $f['fileName']) . '"');
        readfile($path); exit;
    }
}
