<?php
/**
 * Multi-sheet XLSX writer with basic styling — header fills, bold, wrap,
 * borders, number/date formats, Red/Yellow/Green status fills, column
 * widths, frozen header rows, auto-filter and formulas. Built on PHP's
 * ZipArchive only (same approach as XlsxWriter, which stays as-is for the
 * simple one-sheet exports).
 *
 *   $w = new StyledXlsxWriter();
 *   $s = $w->addSheet('Master CPR');
 *   $w->setWidths($s, [6, 18, 12]);
 *   $w->addRow($s, ['Sl.No.', 'Region'], 'header');
 *   $w->addRow($s, [1, ['v' => '2026-10-03', 's' => 'date'], ['f' => 'SUM(A2:A9)', 's' => 'num']]);
 *   $w->freeze($s, 2);  $w->autoFilter($s, 'A2:Y2');
 *   $bytes = $w->output();
 *
 * A cell is a scalar (style comes from the row style) or an array with
 * any of: v (value), s (style name), f (formula without "="), t = 'date'
 * (v is 'YYYY-MM-DD'; written as a real Excel date).
 */
class StyledXlsxWriter
{
    private array $sheets = [];

    /** style name => [fontId, fillId, borderId, numFmtId, wrap, align] */
    private const STYLES = [
        'default'  => [0, 0, 1, 0, false, null],
        'plain'    => [0, 0, 0, 0, false, null],
        'title'    => [2, 0, 0, 0, false, null],
        'subtitle' => [3, 0, 0, 0, false, null],
        'header'   => [1, 2, 1, 0, true, 'center'],
        'bold'     => [4, 0, 1, 0, false, null],
        'wrap'     => [0, 0, 1, 0, true, null],
        'num'      => [0, 0, 1, 164, false, null],
        'int'      => [0, 0, 1, 1, false, null],
        'date'     => [0, 0, 1, 165, false, 'center'],
        'center'   => [0, 0, 1, 0, false, 'center'],
        'red'      => [5, 3, 1, 0, false, 'center'],
        'yellow'   => [6, 4, 1, 0, false, 'center'],
        'green'    => [7, 5, 1, 0, false, 'center'],
        'total'    => [4, 6, 1, 164, false, null],
        'totallbl' => [4, 6, 1, 0, false, null],
        'section'  => [1, 7, 1, 0, false, null],
        'muted'    => [8, 0, 1, 0, true, null],
    ];

    public function addSheet(string $name): int
    {
        $name = mb_substr(trim(preg_replace('/[\\\\\/\?\*\[\]:]/', ' ', $name)) ?: 'Sheet', 0, 31);
        $base = $name; $n = 2;
        while (in_array($name, array_column($this->sheets, 'name'), true)) $name = mb_substr($base, 0, 28) . ' ' . $n++;
        $this->sheets[] = ['name' => $name, 'rows' => [], 'widths' => [], 'freeze' => 0, 'filter' => null, 'heights' => []];
        return count($this->sheets) - 1;
    }

    public function setWidths(int $sheet, array $widths): void { $this->sheets[$sheet]['widths'] = $widths; }
    public function freeze(int $sheet, int $rows): void { $this->sheets[$sheet]['freeze'] = $rows; }
    public function autoFilter(int $sheet, string $range): void { $this->sheets[$sheet]['filter'] = $range; }
    public function rowCount(int $sheet): int { return count($this->sheets[$sheet]['rows']); }

    public function addRow(int $sheet, array $cells, string $rowStyle = 'default', ?float $height = null): int
    {
        $this->sheets[$sheet]['rows'][] = ['cells' => array_values($cells), 'style' => $rowStyle];
        $r = count($this->sheets[$sheet]['rows']);
        if ($height) $this->sheets[$sheet]['heights'][$r] = $height;
        return $r; // 1-based row number
    }

    public static function col(int $index): string
    {
        $s = ''; $index++;
        while ($index > 0) { $m = ($index - 1) % 26; $s = chr(65 + $m) . $s; $index = intdiv($index - 1, 26); }
        return $s;
    }

    private static function esc(string $s): string
    {
        $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $s) ?? $s;
        return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private static function excelDate(string $ymd): ?float
    {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $ymd, $m)) return null;
        $ts = gmmktime(0, 0, 0, (int) $m[2], (int) $m[3], (int) $m[1]);
        return round($ts / 86400 + 25569);
    }

    private function styleIndex(string $name): int
    {
        $i = array_search($name, array_keys(self::STYLES), true);
        return $i === false ? 0 : $i;
    }

    private function sheetXml(array $sh): string
    {
        $x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
        if ($sh['freeze'] > 0) {
            $top = 'A' . ($sh['freeze'] + 1);
            $x .= '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' . $sh['freeze'] . '" topLeftCell="' . $top . '" activePane="bottomLeft" state="frozen"/>'
                . '<selection pane="bottomLeft" activeCell="' . $top . '" sqref="' . $top . '"/></sheetView></sheetViews>';
        }
        $x .= '<sheetFormatPr defaultRowHeight="15"/>';
        if ($sh['widths']) {
            $x .= '<cols>';
            foreach ($sh['widths'] as $i => $w) $x .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . '" width="' . $w . '" customWidth="1"/>';
            $x .= '</cols>';
        }
        $x .= '<sheetData>';
        foreach ($sh['rows'] as $ri => $row) {
            $rn = $ri + 1;
            $x .= '<row r="' . $rn . '"' . (isset($sh['heights'][$rn]) ? ' ht="' . $sh['heights'][$rn] . '" customHeight="1"' : '') . '>';
            foreach ($row['cells'] as $ci => $cell) {
                $ref = self::col($ci) . $rn;
                $c = is_array($cell) ? $cell : ['v' => $cell];
                $st = $this->styleIndex($c['s'] ?? $row['style']);
                $v = $c['v'] ?? null;
                if (isset($c['f'])) {
                    $x .= '<c r="' . $ref . '" s="' . $st . '"><f>' . self::esc($c['f']) . '</f></c>';
                } elseif (($c['t'] ?? '') === 'date' && $v) {
                    $d = self::excelDate((string) $v);
                    $x .= $d === null
                        ? '<c r="' . $ref . '" s="' . $st . '" t="inlineStr"><is><t>' . self::esc((string) $v) . '</t></is></c>'
                        : '<c r="' . $ref . '" s="' . $st . '"><v>' . $d . '</v></c>';
                } elseif ($v === null || $v === '') {
                    $x .= '<c r="' . $ref . '" s="' . $st . '"/>';
                } elseif (is_int($v) || is_float($v) || (is_string($v) && ($c['num'] ?? false) && is_numeric($v))) {
                    $x .= '<c r="' . $ref . '" s="' . $st . '"><v>' . (0 + $v) . '</v></c>';
                } else {
                    $x .= '<c r="' . $ref . '" s="' . $st . '" t="inlineStr"><is><t xml:space="preserve">' . self::esc((string) $v) . '</t></is></c>';
                }
            }
            $x .= '</row>';
        }
        $x .= '</sheetData>';
        if ($sh['filter']) $x .= '<autoFilter ref="' . $sh['filter'] . '"/>';
        $x .= '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
            . '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>';
        return $x . '</worksheet>';
    }

    private function stylesXml(): string
    {
        $fonts = [
            '<font><sz val="10"/><name val="Calibri"/></font>',                                         // 0 normal
            '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',              // 1 header white
            '<font><b/><sz val="14"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>',              // 2 title
            '<font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>',                  // 3 subtitle
            '<font><b/><sz val="10"/><name val="Calibri"/></font>',                                     // 4 bold
            '<font><b/><sz val="10"/><color rgb="FF991B1B"/><name val="Calibri"/></font>',              // 5 red
            '<font><b/><sz val="10"/><color rgb="FF92400E"/><name val="Calibri"/></font>',              // 6 amber
            '<font><b/><sz val="10"/><color rgb="FF166534"/><name val="Calibri"/></font>',              // 7 green
            '<font><i/><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/></font>',               // 8 muted
        ];
        $fill = fn($rgb) => '<fill><patternFill patternType="solid"><fgColor rgb="FF' . $rgb . '"/><bgColor indexed="64"/></patternFill></fill>';
        $fills = [
            '<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
            $fill('1E3A5F'), $fill('FEE2E2'), $fill('FEF3C7'), $fill('DCFCE7'), $fill('E2E8F0'), $fill('0F766E'),
        ];
        $borders = [
            '<border><left/><right/><top/><bottom/><diagonal/></border>',
            '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right>'
            . '<top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>',
        ];
        $xfs = '';
        foreach (self::STYLES as [$font, $fillId, $border, $numFmt, $wrap, $align]) {
            $al = '<alignment vertical="top"' . ($wrap ? ' wrapText="1"' : '') . ($align ? ' horizontal="' . $align . '"' : '') . '/>';
            $xfs .= '<xf numFmtId="' . $numFmt . '" fontId="' . $font . '" fillId="' . $fillId . '" borderId="' . $border . '" xfId="0"'
                  . ($numFmt ? ' applyNumberFormat="1"' : '') . ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' . $al . '</xf>';
        }
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="dd-mmm-yyyy"/></numFmts>'
            . '<fonts count="' . count($fonts) . '">' . implode('', $fonts) . '</fonts>'
            . '<fills count="' . count($fills) . '">' . implode('', $fills) . '</fills>'
            . '<borders count="' . count($borders) . '">' . implode('', $borders) . '</borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="' . count(self::STYLES) . '">' . $xfs . '</cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            . '</styleSheet>';
    }

    public function output(): string
    {
        if (!$this->sheets) $this->addSheet('Sheet1');
        $n = count($this->sheets);
        $ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
        $sheetsXml = ''; $rels = ''; $defined = '';
        for ($i = 0; $i < $n; $i++) {
            $ct .= '<Override PartName="/xl/worksheets/sheet' . ($i + 1) . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
            $sheetsXml .= '<sheet name="' . self::esc($this->sheets[$i]['name']) . '" sheetId="' . ($i + 1) . '" r:id="rId' . ($i + 1) . '"/>';
            $rels .= '<Relationship Id="rId' . ($i + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . ($i + 1) . '.xml"/>';
            if ($this->sheets[$i]['filter']) {
                [$a, $b] = explode(':', $this->sheets[$i]['filter']);
                $abs = fn($r) => preg_replace('/^([A-Z]+)(\d+)$/', '\$$1\$$2', $r);
                $defined .= '<definedName name="_xlnm._FilterDatabase" localSheetId="' . $i . '" hidden="1">\'' . str_replace("'", "''", $this->sheets[$i]['name']) . '\'!' . $abs($a) . ':' . $abs($b) . '</definedName>';
            }
        }
        $ct .= '</Types>';
        $tmp = tempnam(sys_get_temp_dir(), 'sxlsx_');
        $zip = new ZipArchive();
        $zip->open($tmp, ZipArchive::OVERWRITE | ZipArchive::CREATE);
        $zip->addFromString('[Content_Types].xml', $ct);
        $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
        $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' . $sheetsXml . '</sheets>' . ($defined ? '<definedNames>' . $defined . '</definedNames>' : '') . '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>');
        $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '<Relationship Id="rId' . ($n + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
        $zip->addFromString('xl/styles.xml', $this->stylesXml());
        foreach ($this->sheets as $i => $sh) $zip->addFromString('xl/worksheets/sheet' . ($i + 1) . '.xml', $this->sheetXml($sh));
        $zip->close();
        $bytes = file_get_contents($tmp);
        unlink($tmp);
        return $bytes;
    }
}
