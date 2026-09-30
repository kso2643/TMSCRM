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
 */

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
        foreach ($tables as $name => $def) {
            if (!isset($existing[$name])) {
                try {
                    db()->exec($def['create']);
                } catch (PDOException $e) {
                    if (empty($def['fallback'])) throw $e;
                    error_log("SchemaGuard: FK create of $name failed ({$e->getMessage()}), retrying without FKs");
                    db()->exec($def['fallback']);
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
