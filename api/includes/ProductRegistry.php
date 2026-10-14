<?php
/**
 * One place that makes sure a product typed in anywhere (order line, quotation
 * line, vendor PO line, stock entry, Products page) exists in BOTH the
 * Products list and the Stock list, so a new item never has to be added twice.
 *
 *   product_register(code, name, [brand, unit, category, price, spec])  → productId
 *
 * - The item code is the key (case-insensitive). An existing product is reused
 *   (empty brand / unit / category are filled in, nothing is overwritten).
 * - No code (or "MANUAL") → matched by name, else a code MAN-0001, MAN-0002… is given.
 * - A Stock row (0 Nos, linked to the product) is created when the code is not in stock yet.
 * Failures never block the order / quotation being saved.
 */
function product_register(?string $code, string $name, array $x = []): array
{
    $name = trim($name);
    $code = strtoupper(trim((string) $code));
    if ($code === 'MANUAL') $code = '';
    if ($name === '' && $code === '') return ['id' => null, 'itemCode' => ''];
    if ($name === '') $name = $code;
    try {
        $pdo = db();
        $p = null;
        if ($code !== '') { $s = $pdo->prepare('SELECT id, itemCode, brand, unit, category FROM `Product` WHERE itemCode=? LIMIT 1'); $s->execute([$code]); $p = $s->fetch() ?: null; }
        else { $s = $pdo->prepare('SELECT id, itemCode, brand, unit, category FROM `Product` WHERE productName=? LIMIT 1'); $s->execute([$name]); $p = $s->fetch() ?: null; }
        $brand = mb_substr(trim((string) ($x['brand'] ?? '')), 0, 100) ?: null;
        $unit = mb_substr(trim((string) ($x['unit'] ?? '')), 0, 20) ?: null;
        $cat = mb_substr(trim((string) ($x['category'] ?? '')), 0, 100) ?: null;
        $now = now_sql();
        if ($p) {
            $sets = []; $vals = [];
            if (!$p['brand'] && $brand) { $sets[] = 'brand=?'; $vals[] = $brand; }
            if (!$p['unit'] && $unit) { $sets[] = 'unit=?'; $vals[] = $unit; }
            if (!$p['category'] && $cat) { $sets[] = 'category=?'; $vals[] = $cat; }
            if ($sets) { $vals[] = $p['id']; $pdo->prepare('UPDATE `Product` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($vals); }
            $pid = $p['id']; $code = $p['itemCode'];
        } else {
            if ($code === '') {
                $last = $pdo->query("SELECT itemCode FROM `Product` WHERE itemCode LIKE 'MAN-%' ORDER BY itemCode DESC LIMIT 1")->fetchColumn();
                $code = 'MAN-' . str_pad((string) (($last ? (int) substr($last, 4) : 0) + 1), 4, '0', STR_PAD_LEFT);
            }
            $pid = gen_id();
            $price = is_numeric($x['price'] ?? null) ? (float) $x['price'] : 0;
            $pdo->prepare('INSERT INTO `Product` (id,itemCode,productName,description,unit,standardPrice,category,brand,specification,isCustom,isActive,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,1,1,?,?)')
                ->execute([$pid, mb_substr($code, 0, 100), mb_substr($name, 0, 255), (string) ($x['description'] ?? ''), $unit, $price, $cat, $brand,
                           mb_substr(trim((string) ($x['spec'] ?? '')), 0, 255) ?: null, $now, $now]);
        }
        $s = $pdo->prepare('SELECT id, productId FROM `Stock` WHERE itemCode=? LIMIT 1'); $s->execute([$code]);
        $st = $s->fetch();
        if (!$st) {
            $pdo->prepare('INSERT INTO `Stock` (id,itemCode,itemName,itemType,productId,brand,availableStock,reservedStock,minimumStock,netPrice,isActive,lastUpdated,updatedAt) VALUES (?,?,?,?,?,?,0,0,0,?,1,?,?)')
                ->execute([gen_id(), mb_substr($code, 0, 100), mb_substr($name, 0, 255), 'Regular', $pid, $brand, is_numeric($x['price'] ?? null) ? (float) $x['price'] : 0, $now, $now]);
        } elseif (!$st['productId']) {
            $pdo->prepare('UPDATE `Stock` SET productId=? WHERE id=?')->execute([$pid, $st['id']]);
        }
        return ['id' => $pid, 'itemCode' => $code];
    } catch (Throwable $e) {
        error_log('product_register: ' . $e->getMessage());
        return ['id' => null, 'itemCode' => $code];
    }
}
