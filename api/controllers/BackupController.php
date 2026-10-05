<?php
/**
 * Full data backup — Super Admin only.
 *
 * GET  /api/backup/export   → a .zip with data.json + uploads/ (?format=json: data only). data.json holds every table in the database as one
 *                              JSON file: {format, version, createdAt, database,
 *                              tables: {Table: {columns:[...], rows:[[...], ...]}}}
 *                              Streamed row by row, so large databases don't
 *                              run the server out of memory.
 * POST /api/backup/import   → multipart field "file" (a backup made above).
 *                              MERGE only: rows are inserted, and rows whose id
 *                              already exists are updated to the backup's values.
 *                              Nothing that isn't in the backup is ever deleted.
 *                              Tables / columns the current database doesn't have
 *                              are skipped and reported. Runs in one transaction —
 *                              any error rolls the whole import back.
 * GET  /api/backup/summary  → table names and row counts (shown before you export).
 *
 * Uploaded files (PO documents, photos under api/uploads/) are NOT in the
 * JSON — copy that folder separately from the hosting file manager.
 */
class BackupController
{
    private const FORMAT = 'tmscrm-backup';

    private function tables(): array
    {
        $s = db()->query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
        return array_map(fn($r) => array_values($r)[0], $s->fetchAll());
    }

    private function columns(string $table): array
    {
        $s = db()->prepare("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION");
        $s->execute([$table]);
        return array_map(fn($r) => array_values($r)[0], $s->fetchAll());
    }

    // GET /api/backup/summary
    public function summary(): void
    {
        $auth = authenticate(); require_super_admin($auth);
        $out = [];
        foreach ($this->tables() as $t) {
            $n = (int) db()->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
            $out[] = ['table' => $t, 'rows' => $n];
        }
        sendSuccess(['tables' => $out, 'totalRows' => array_sum(array_column($out, 'rows'))]);
    }

    /** Streams the whole database as backup JSON (with each table's CREATE statement) into $fh. */
    private function writeJson($fh): int
    {
        $tables = $this->tables();
        $j = fn($v) => json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        fwrite($fh, '{"format":' . $j(self::FORMAT) . ',"version":2,"createdAt":' . $j(date('c')) . ',"database":' . $j(DB_NAME) . ',"tables":{');
        foreach ($tables as $ti => $t) {
            $cols = $this->columns($t);
            $create = '';
            try { $create = (string) (db()->query("SHOW CREATE TABLE `$t`")->fetch(PDO::FETCH_NUM)[1] ?? ''); } catch (Throwable $e) {}
            fwrite($fh, ($ti ? ',' : '') . $j($t) . ':{"columns":' . $j($cols) . ',"create":' . $j($create) . ',"rows":[');
            // Unbuffered read so big tables stream instead of loading into memory.
            $pdo = db();
            $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
            $st = $pdo->query("SELECT * FROM `$t`");
            $first = true;
            while ($row = $st->fetch(PDO::FETCH_NUM)) { fwrite($fh, ($first ? '' : ',') . $j($row)); $first = false; }
            $st->closeCursor();
            $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
            fwrite($fh, ']}');
        }
        fwrite($fh, '}}');
        return count($tables);
    }

    /** Every file under api/uploads as [absolutePath => relativePath]. */
    private function uploadFiles(): array
    {
        $out = [];
        if (!is_dir(UPLOADS_PATH)) return $out;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(UPLOADS_PATH, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if (!$f->isFile()) continue;
            $rel = ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen(UPLOADS_PATH))), '/');
            if ($rel === '' || str_starts_with(basename($rel), '.')) continue;
            $out[$f->getPathname()] = $rel;
        }
        return $out;
    }

    // GET /api/backup/export            → company data .zip: data.json (every table) + uploads/ (photos, PO files, attachments)
    // GET /api/backup/export?format=json → data only, as before
    public function export(): void
    {
        $auth = authenticate(); require_super_admin($auth);
        @set_time_limit(600);
        $stamp = date('Y-m-d-His');
        if (qp('format') === 'json' || !class_exists('ZipArchive')) {
            header('Content-Type: application/json; charset=utf-8');
            header('Content-Disposition: attachment; filename="crm-backup-' . $stamp . '.json"');
            header('X-Content-Type-Options: nosniff');
            $out = fopen('php://output', 'w');
            $n = $this->writeJson($out);
            log_activity($auth['id'], 'BACKUP_EXPORTED', 'Backup', null, ['tables' => $n, 'format' => 'json']);
            exit;
        }
        $tmpJson = tempnam(sys_get_temp_dir(), 'crmjson');
        $tmpZip = tempnam(sys_get_temp_dir(), 'crmzip');
        $fh = fopen($tmpJson, 'w');
        $n = $this->writeJson($fh);
        fclose($fh);
        $zip = new ZipArchive();
        if ($zip->open($tmpZip, ZipArchive::OVERWRITE) !== true) { @unlink($tmpJson); sendError('Could not create the backup file on the server.', 500); }
        $zip->addFile($tmpJson, 'data.json');
        $files = $this->uploadFiles();
        foreach ($files as $abs => $rel) $zip->addFile($abs, 'uploads/' . $rel);
        $zip->addFromString('README.txt', "CRM company data — " . date('d-m-Y H:i') . "\n\ndata.json : every table in the database ($n tables)\nuploads/  : uploaded files (" . count($files) . " files: meeting photos, voice notes, PO documents, attachments)\n\nTo restore: Reports page > Company data > Import, and choose this .zip file.\n");
        $zip->close();
        @unlink($tmpJson);
        log_activity($auth['id'], 'BACKUP_EXPORTED', 'Backup', null, ['tables' => $n, 'files' => count($files), 'format' => 'zip']);
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="crm-company-data-' . $stamp . '.zip"');
        header('Content-Length: ' . filesize($tmpZip));
        readfile($tmpZip);
        @unlink($tmpZip);
        exit;
    }

    /** Creates tables / columns from the backup that this database doesn't have yet (DDL — run before the data transaction). */
    private function prepareSchema(array $tables, array &$created, array &$addedCols): void
    {
        $existing = array_flip($this->tables());
        db()->exec('SET FOREIGN_KEY_CHECKS=0');
        try {
            foreach ($tables as $table => $t) {
                if (!is_string($table) || !preg_match('/^[A-Za-z0-9_]+$/', $table)) continue;
                $create = is_string($t['create'] ?? null) ? $t['create'] : '';
                if (!preg_match('/^CREATE TABLE `' . preg_quote($table, '/') . '`/i', $create)) continue;
                if (!isset($existing[$table])) {
                    $sql = preg_replace('/^CREATE TABLE/i', 'CREATE TABLE IF NOT EXISTS', $create);
                    try { db()->exec($sql); }
                    catch (Throwable $e) { // retry without foreign keys (e.g. collation differences)
                        $sql = preg_replace('/,\s*CONSTRAINT `[^`]+` FOREIGN KEY[^\n]*/i', '', $sql);
                        db()->exec($sql);
                    }
                    $created[] = $table;
                    continue;
                }
                $have = array_flip($this->columns($table));
                foreach (preg_split('/\n/', $create) as $line) {
                    if (!preg_match('/^\s*`([A-Za-z0-9_]+)`\s+(.+?),?\s*$/', $line, $m) || isset($have[$m[1]])) continue;
                    $def = preg_replace('/\s+AUTO_INCREMENT\b/i', '', $m[2]);
                    try { db()->exec("ALTER TABLE `$table` ADD COLUMN `{$m[1]}` $def"); $addedCols[] = "$table.{$m[1]}"; }
                    catch (Throwable $e) { error_log("Backup add column $table.{$m[1]}: " . $e->getMessage()); }
                }
            }
        } finally { db()->exec('SET FOREIGN_KEY_CHECKS=1'); }
    }

    /** Copies uploads/* from the backup zip into api/uploads (never outside it). */
    private function restoreUploads(ZipArchive $zip): int
    {
        $n = 0;
        $root = rtrim(UPLOADS_PATH, '/');
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string) $zip->getNameIndex($i);
            if (!str_starts_with($name, 'uploads/') || str_ends_with($name, '/')) continue;
            $rel = substr($name, 8);
            if ($rel === '' || str_contains($rel, '..') || str_contains($rel, "\0") || preg_match('/\.(php\d?|phtml|phar|htaccess)$/i', $rel)) continue;
            $dest = $root . '/' . $rel;
            if (!is_dir(dirname($dest)) && !@mkdir(dirname($dest), 0755, true)) continue;
            $in = $zip->getStream($name);
            if (!$in) continue;
            $out = @fopen($dest, 'w');
            if ($out) { stream_copy_to_stream($in, $out); fclose($out); $n++; }
            fclose($in);
        }
        return $n;
    }

    // POST /api/backup/import  (multipart "file")
    public function import(): void
    {
        $auth = authenticate(); require_super_admin($auth);
        @set_time_limit(600);
        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            $code = $_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE;
            sendError($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE
                ? 'The backup file is larger than the server upload limit (upload_max_filesize).'
                : 'Please choose a backup file (.json) to import.', 400);
        }
        $tmp = $_FILES['file']['tmp_name'];
        $zip = null; $restoredFiles = 0;
        if (class_exists('ZipArchive') && ($zz = new ZipArchive())->open($tmp) === true) {
            $zip = $zz;
            $raw = $zip->getFromName('data.json');
            if ($raw === false) { $zip->close(); sendError('This zip has no data.json — choose a file made with "Export company data".', 400); }
        } else {
            $raw = file_get_contents($tmp);
        }
        $data = json_decode((string) $raw, true);
        unset($raw);
        if (!is_array($data) || ($data['format'] ?? '') !== self::FORMAT || !is_array($data['tables'] ?? null)) {
            sendError('This is not a CRM backup file (made with "Export company data").', 400);
        }

        // New tables / columns first (MySQL can't create tables inside the data transaction).
        $createdTables = []; $addedColumns = [];
        try { $this->prepareSchema($data['tables'], $createdTables, $addedColumns); }
        catch (Throwable $e) { sendError('Could not prepare the database for the import: ' . $e->getMessage(), 400); }

        $existing = array_flip($this->tables());
        $report = []; $skippedTables = [];
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
            foreach ($data['tables'] as $table => $t) {
                if (!is_string($table) || !preg_match('/^[A-Za-z0-9_]+$/', $table) || !isset($existing[$table])) {
                    $skippedTables[] = (string) $table;
                    continue;
                }
                $cols = $t['columns'] ?? []; $rows = $t['rows'] ?? [];
                if (!is_array($cols) || !is_array($rows)) { $skippedTables[] = $table; continue; }
                $current = array_flip($this->columns($table));
                $keep = []; // positions of backup columns that still exist here
                foreach ($cols as $i => $c) if (is_string($c) && isset($current[$c])) $keep[$i] = $c;
                if (!$keep) { $skippedTables[] = $table; continue; }
                $names = array_values($keep);
                $colSql = implode(',', array_map(fn($c) => "`$c`", $names));
                $ph = implode(',', array_fill(0, count($names), '?'));
                $upd = implode(',', array_map(fn($c) => "`$c`=VALUES(`$c`)", $names));
                $ins = $pdo->prepare("INSERT INTO `$table` ($colSql) VALUES ($ph) ON DUPLICATE KEY UPDATE $upd");
                $n = 0;
                foreach ($rows as $row) {
                    if (!is_array($row)) continue;
                    $vals = [];
                    foreach ($keep as $i => $_) $vals[] = $row[$i] ?? null;
                    $ins->execute($vals);
                    $n++;
                }
                $report[] = ['table' => $table, 'rows' => $n, 'skippedColumns' => array_values(array_diff($cols, $names))];
            }
            $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
            error_log('Backup import failed: ' . $e->getMessage());
            sendError('Import failed and nothing was changed: ' . $e->getMessage(), 400);
        }

        if ($zip) { $restoredFiles = $this->restoreUploads($zip); $zip->close(); }
        log_activity($auth['id'], 'BACKUP_IMPORTED', 'Backup', null, ['tables' => count($report), 'from' => $data['createdAt'] ?? null]);
        sendSuccess([
            'tables' => $report, 'skippedTables' => $skippedTables,
            'totalRows' => array_sum(array_column($report, 'rows')), 'backupDate' => $data['createdAt'] ?? null,
            'createdTables' => $createdTables, 'addedColumns' => $addedColumns, 'restoredFiles' => $restoredFiles,
        ], 'Company data imported');
    }
}
