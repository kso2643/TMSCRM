<?php
/**
 * Self-healing schema for the hand-added modules (Orders, Tasks, Price
 * requests). Each module's migration .sql still exists and is still the
 * documented way to set up the database — this is the safety net for when
 * one of them hasn't been run (or only half-ran) on the live server, which
 * otherwise surfaces as a bare "Internal server error" 500 on the first
 * query that touches the missing table/column.
 *
 * ensure_schema() runs one information_schema query per request, and only
 * issues DDL for whatever is actually missing. Everything it does is
 * additive (CREATE TABLE IF NOT EXISTS / ADD COLUMN) — it never drops or
 * alters existing data.
 *
 * If the DB user lacks CREATE/ALTER privileges, the request fails with a
 * readable message naming the migration to run, instead of a generic 500.
 *
 * Collation: the migrations hard-code utf8mb4_unicode_ci, but a live DB's
 * existing tables may use another collation (e.g. utf8mb4_general_ci).
 * That mismatch makes foreign keys to User/Customer fail to create
 * (errno 150) and makes every JOIN on them fail with "Illegal mix of
 * collations". So new tables are created in the same charset/collation as
 * `User`.`id`, and managed tables already created with a different one are
 * converted to it.
 */

/** [charset, collation] of `User`.`id` — the convention every managed table must match — or null. */
function schema_reference_collation(): ?array
{
    static $ref = false;
    if ($ref !== false) return $ref;
    $s = db()->query(
        "SELECT CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'id' LIMIT 1"
    );
    $r = $s->fetch();
    $r = $r ? array_change_key_case($r, CASE_UPPER) : null;
    $ref = ($r && $r['CHARACTER_SET_NAME'] && $r['COLLATION_NAME'])
        ? [$r['CHARACTER_SET_NAME'], $r['COLLATION_NAME']] : null;
    return $ref;
}

/** Rewrites the table options of a CREATE TABLE statement to the reference charset/collation. */
function schema_with_collation(string $sql, ?array $ref): string
{
    if (!$ref) return $sql;
    return preg_replace(
        '/DEFAULT CHARSET=\w+ COLLATE=\w+/',
        'DEFAULT CHARSET=' . $ref[0] . ' COLLATE=' . $ref[1],
        $sql
    );
}

/**
 * @param array $tables  tableName => [
 *     'create'   => full CREATE TABLE statement (with foreign keys),
 *     'fallback' => same statement without foreign keys (optional) — used if
 *                   the FK version is rejected, e.g. because the live DB's
 *                   parent tables use a different collation,
 *     'columns'  => [columnName => 'column definition'] added via ALTER TABLE
 *                   when the table exists but a column is missing,
 * ]
 * @param string $migrationHint file name shown in the error if repair fails
 */
function ensure_schema(array $tables, string $migrationHint): void
{
    static $done = [];
    $key = implode(',', array_keys($tables));
    if (isset($done[$key])) return;

    $names = array_keys($tables);
    $in = implode(',', array_fill(0, count($names), '?'));
    $s = db()->prepare(
        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ($in)"
    );
    $s->execute($names);
    $existing = [];
    foreach ($s->fetchAll() as $r) {
        // information_schema column names differ in case across MySQL/MariaDB versions
        $r = array_change_key_case($r, CASE_UPPER);
        $existing[$r['TABLE_NAME']][$r['COLUMN_NAME']] = true;
    }

    try {
        $ref = schema_reference_collation();

        // Convert managed tables that were created with a different collation
        // than the rest of the DB (see header comment). FK checks are paused so
        // the parent/child pair can be converted one after the other.
        if ($ref) {
            $t = db()->prepare(
                "SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ($in)"
            );
            $t->execute($names);
            $wrong = [];
            foreach ($t->fetchAll() as $r) {
                $r = array_change_key_case($r, CASE_UPPER);
                if ($r['TABLE_COLLATION'] !== $ref[1]) $wrong[] = $r['TABLE_NAME'];
            }
            if ($wrong) {
                db()->exec('SET FOREIGN_KEY_CHECKS=0');
                try {
                    foreach ($wrong as $name) {
                        error_log("SchemaGuard: converting $name to {$ref[1]}");
                        db()->exec("ALTER TABLE `$name` CONVERT TO CHARACTER SET {$ref[0]} COLLATE {$ref[1]}");
                    }
                } finally {
                    db()->exec('SET FOREIGN_KEY_CHECKS=1');
                }
            }
        }

        foreach ($tables as $name => $def) {
            if (!isset($existing[$name])) {
                try {
                    db()->exec(schema_with_collation($def['create'], $ref));
                } catch (PDOException $e) {
                    if (empty($def['fallback'])) throw $e;
                    error_log("SchemaGuard: FK create of $name failed ({$e->getMessage()}), retrying without FKs");
                    db()->exec(schema_with_collation($def['fallback'], $ref));
                }
                continue;
            }
            foreach (($def['columns'] ?? []) as $col => $colDef) {
                if (!isset($existing[$name][$col])) {
                    db()->exec("ALTER TABLE `$name` ADD COLUMN `$col` $colDef");
                }
            }
        }
    } catch (PDOException $e) {
        error_log('SchemaGuard: ' . $e->getMessage());
        sendError(
            "The database is missing tables/columns this page needs and they could not be created automatically "
            . "({$e->getMessage()}). Please run api/database/$migrationHint on the database.",
            500
        );
    }

    $done[$key] = true;
}
