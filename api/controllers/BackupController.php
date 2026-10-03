<?php
/**
 * Full data backup — Super Admin only.
 *
 * GET  /api/backup/export   → downloads every table in the database as one
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

    // GET /api/backup/export
    public function export(): void
    {
        $auth = authenticate(); require_super_admin($auth);
        @set_time_limit(300);
        $tables = $this->tables();
        log_activity($auth['id'], 'BACKUP_EXPORTED', 'Backup', null, ['tables' => count($tables)]);

        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="crm-backup-' . date('Y-m-d-His') . '.json"');
        header('X-Content-Type-Options: nosniff');
        $j = fn($v) => json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);

        echo '{"format":' . $j(self::FORMAT) . ',"version":1,"createdAt":' . $j(date('c')) . ',"database":' . $j(DB_NAME) . ',"tables":{';
        foreach ($tables as $ti => $t) {
            $cols = $this->columns($t);
            echo ($ti ? ',' : '') . $j($t) . ':{"columns":' . $j($cols) . ',"rows":[';
            // Unbuffered read so big tables stream instead of loading into memory.
            $pdo = db();
            $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
            $s = $pdo->query("SELECT * FROM `$t`");
            $first = true;
            while ($row = $s->fetch(PDO::FETCH_NUM)) {
                echo ($first ? '' : ',') . $j($row);
                $first = false;
            }
            $s->closeCursor();
            $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
            echo ']}';
            @flush();
        }
        echo '}}';
        exit;
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
        $raw = file_get_contents($_FILES['file']['tmp_name']);
        $data = json_decode((string) $raw, true);
        if (!is_array($data) || ($data['format'] ?? '') !== self::FORMAT || !is_array($data['tables'] ?? null)) {
            sendError('This is not a CRM backup file (made with "Export full backup").', 400);
        }

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

        log_activity($auth['id'], 'BACKUP_IMPORTED', 'Backup', null, ['tables' => count($report), 'from' => $data['createdAt'] ?? null]);
        sendSuccess([
            'tables' => $report, 'skippedTables' => $skippedTables,
            'totalRows' => array_sum(array_column($report, 'rows')), 'backupDate' => $data['createdAt'] ?? null,
        ], 'Backup imported');
    }
}
