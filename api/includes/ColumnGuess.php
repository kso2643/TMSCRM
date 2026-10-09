<?php
/**
 * Works out which column of an uploaded sheet is which, for files in any
 * layout (supplier price lists, stock statements, Tally exports, our own
 * templates). Only the product code and a description / name are needed;
 * every other recognised column is used, and the rest can be kept as
 * "extra" details.
 *
 *   ColumnGuess::find($rows, $aliases, $fuzzy, 'itemCode', 15)
 *     → ['row' => header row index, 'map' => [field => column index], 'extra' => [column index => header]]
 *
 * Matching runs in two passes over the header row: exact alias names first
 * (so a template column always wins), then keyword rules for whatever is
 * still unmatched ("Product Code No.", "Description of Goods",
 * "Closing Qty (Nos)", "Rate / Unit"…). The header row is the row in the
 * first $scan rows that has the key column and the most matches — so a
 * title or company name above the table is fine.
 */
class ColumnGuess
{
    public static function norm($h): string
    {
        $h = strtolower(trim((string) $h));
        $h = str_replace(['*', '.', ':', '#', '_', '/', '\\', '(', ')', '[', ']', '-', '₹'], ' ', $h);
        return trim(preg_replace('/\s+/', ' ', $h));
    }

    /**
     * $fuzzy: field => [mustContainAny[], mustNotContain[]] — tried in the given order.
     */
    public static function mapRow(array $row, array $aliases, array $fuzzy): array
    {
        $map = []; $used = [];
        $heads = [];
        foreach ($row as $ci => $h) { $n = self::norm($h); if ($n !== '') $heads[$ci] = $n; }
        // pass 1: exact names
        foreach ($heads as $ci => $h) {
            foreach ($aliases as $f => $names) {
                if (isset($map[$f])) continue;
                $names = array_map([self::class, 'norm'], $names);
                if (in_array($h, $names, true) || in_array(str_replace(' ', '', $h), array_map(fn($x) => str_replace(' ', '', $x), $names), true)) { $map[$f] = $ci; $used[$ci] = true; break; }
            }
        }
        // pass 2: keywords, for fields still missing
        foreach ($fuzzy as $f => $rule) {
            if (isset($map[$f])) continue;
            [$any, $not] = $rule + [1 => []];
            foreach ($heads as $ci => $h) {
                if (isset($used[$ci])) continue;
                // a keyword must start a word ("qty" in "closing qty nos"); an exclusion must be a whole word
                $hit = false;
                foreach ($any as $k) if (preg_match('/(^|\s)' . preg_quote($k, '/') . '/u', $h)) { $hit = true; break; }
                if (!$hit) continue;
                foreach ($not as $k) if (preg_match('/(^|\s)' . preg_quote($k, '/') . '(\s|$)/u', $h)) { $hit = false; break; }
                if ($hit) { $map[$f] = $ci; $used[$ci] = true; break; }
            }
        }
        $extra = [];
        foreach ($heads as $ci => $h) if (!isset($used[$ci])) $extra[$ci] = trim((string) $row[$ci]);
        return ['map' => $map, 'extra' => $extra];
    }

    public static function find(array $rows, array $aliases, array $fuzzy, string $key, int $scan = 15): ?array
    {
        $best = null;
        foreach (array_slice($rows, 0, $scan, true) as $ri => $row) {
            if (!is_array($row)) continue;
            $m = self::mapRow($row, $aliases, $fuzzy);
            if (!isset($m['map'][$key])) continue;
            $score = count($m['map']);
            if (!$best || $score > $best['score']) $best = ['row' => $ri, 'map' => $m['map'], 'extra' => $m['extra'], 'score' => $score];
        }
        return $best;
    }

    /** Keyword rules shared by the stock and product uploads. */
    public static function productRules(): array
    {
        return [
            'itemCode'  => [['code', 'part no', 'part number', 'partno', 'sku', 'edp', 'article', 'catalogue no', 'catalog no', 'cat no', 'ordering', 'item no', 'material no', 'ref no'],
                            ['hsn', 'sac', 'category', 'customer', 'vendor', 'supplier', 'party', 'pin', 'zip', 'bar', 'group', 'brand', 'state', 'city']],
            'qty'       => [['qty', 'quantity', 'stock', 'balance', 'available', 'on hand', 'soh', 'closing', 'nos', 'pcs'], ['min', 'reorder', 'value', 'price', 'rate', 'amount', 'location', 'type']],
            'price'     => [['price', 'rate', 'nlp', 'cost', 'mrp', 'lp'], ['total', 'amount', 'value', 'gst', 'tax', 'disc']],
            'brand'     => [['brand', 'make', 'manufacturer', 'mfr', 'mfg'], []],
            'name'      => [['description', 'desc', 'name', 'particular', 'particulars', 'specification', 'spec', 'designation', 'product', 'item', 'material', 'goods'], ['code', 'no', 'group', 'type', 'brand', 'hsn']],
            'unit'      => [['unit', 'uom', 'u o m'], ['price', 'rate']],
            'group'     => [['group', 'category', 'family', 'class'], []],
            'hsn'       => [['hsn', 'sac'], []],
            'grade'     => [['grade'], []],
        ];
    }

    /** "Header: value · Header: value" from the extra columns of one row (empty cells skipped). */
    public static function extraText(array $row, array $extra, int $max = 1000): ?string
    {
        $parts = [];
        foreach ($extra as $ci => $head) {
            if (in_array(self::norm($head), ['sl no', 's no', 'sno', 'sr no', 'srno', 'serial no', 'sl', 'sr', 'no', 'sl no s'], true)) continue;
            $v = trim((string) ($row[$ci] ?? ''));
            if ($v === '' || $head === '') continue;
            $parts[] = $head . ': ' . $v;
        }
        return $parts ? mb_substr(implode(' · ', $parts), 0, $max) : null;
    }
}
