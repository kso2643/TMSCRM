<?php
/**
 * Minimal XLSX reader. Handles both shared-strings (what real Excel /
 * Google Sheets always produce) and inline-strings (what our own
 * XlsxWriter produces) so admin-uploaded stock spreadsheets — whatever
 * tool created them — parse correctly. No Composer packages required.
 */
class XlsxReader
{
    private array $sharedStrings = [];

    /** @return array<int, array<int, string>> rows of cell-string values, 0-indexed, sparse columns filled with '' */
    public static function readFirstSheetRows(string $filePath): array
    {
        return (new self())->parse($filePath);
    }

    private function parse(string $filePath): array
    {
        $zip = new ZipArchive();
        if ($zip->open($filePath) !== true) {
            throw new \RuntimeException('Could not open the file as a valid .xlsx archive. Please save it as .xlsx or .csv and try again.');
        }

        $sharedXml = $zip->getFromName('xl/sharedStrings.xml');
        if ($sharedXml !== false) {
            $this->sharedStrings = $this->parseSharedStrings($sharedXml);
        }

        $sheetPath = $this->resolveFirstSheetPath($zip);
        $sheetXml = $zip->getFromName($sheetPath);
        if ($sheetXml === false) {
            $sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
        }
        $zip->close();

        if ($sheetXml === false) {
            throw new \RuntimeException('Could not find a worksheet inside the uploaded file.');
        }

        return $this->parseSheetRows($sheetXml);
    }

    private function resolveFirstSheetPath(ZipArchive $zip): string
    {
        $wbXml = $zip->getFromName('xl/workbook.xml');
        $relsXml = $zip->getFromName('xl/_rels/workbook.xml.rels');
        if ($wbXml === false || $relsXml === false) return 'xl/worksheets/sheet1.xml';

        $wb = @simplexml_load_string($wbXml);
        $rels = @simplexml_load_string($relsXml);
        if (!$wb || !$rels || !isset($wb->sheets->sheet[0])) return 'xl/worksheets/sheet1.xml';

        $relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        $attrs = $wb->sheets->sheet[0]->attributes($relNs);
        $rId = isset($attrs['id']) ? (string) $attrs['id'] : null;
        if (!$rId) return 'xl/worksheets/sheet1.xml';

        foreach ($rels->Relationship as $rel) {
            if ((string) $rel['Id'] === $rId) {
                $target = ltrim((string) $rel['Target'], '/');
                return str_starts_with($target, 'xl/') ? $target : 'xl/' . $target;
            }
        }
        return 'xl/worksheets/sheet1.xml';
    }

    private function parseSharedStrings(string $xml): array
    {
        $sx = @simplexml_load_string($xml);
        if (!$sx) return [];
        $out = [];
        foreach ($sx->si as $si) {
            if (isset($si->t)) {
                $out[] = (string) $si->t;
            } else {
                $buf = '';
                foreach ($si->r as $r) $buf .= (string) $r->t;
                $out[] = $buf;
            }
        }
        return $out;
    }

    private function colToIndex(string $colLetters): int
    {
        $col = 0;
        foreach (str_split(strtoupper($colLetters)) as $ch) {
            $col = $col * 26 + (ord($ch) - 64);
        }
        return $col - 1;
    }

    private function parseSheetRows(string $xml): array
    {
        $sx = @simplexml_load_string($xml);
        if (!$sx) throw new \RuntimeException('The worksheet inside the uploaded file could not be parsed.');
        if (!isset($sx->sheetData->row)) return [];

        $rows = [];
        foreach ($sx->sheetData->row as $row) {
            $rowIndex = isset($row['r']) ? ((int) $row['r'] - 1) : count($rows);
            $cells = [];
            $maxCol = -1;
            foreach ($row->c as $c) {
                $ref = (string) $c['r'];
                preg_match('/^([A-Za-z]+)/', $ref, $m);
                $colIdx = isset($m[1]) ? $this->colToIndex($m[1]) : (count($cells));
                $type = (string) $c['t'];

                if ($type === 's') {
                    $idx = (int) $c->v;
                    $value = $this->sharedStrings[$idx] ?? '';
                } elseif ($type === 'inlineStr') {
                    $value = isset($c->is->t) ? (string) $c->is->t : '';
                } elseif ($type === 'str') {
                    $value = (string) $c->v;
                } elseif ($type === 'b') {
                    $value = ((string) $c->v === '1') ? '1' : '0';
                } else {
                    $value = isset($c->v) ? (string) $c->v : '';
                }

                $cells[$colIdx] = $value;
                if ($colIdx > $maxCol) $maxCol = $colIdx;
            }

            // Skip rows with no values: Excel often keeps formatted-but-empty
            // rows down to row 1,048,576, and padding up to them would build a
            // million empty arrays (out of memory on shared hosting).
            if (!array_filter($cells, fn($v) => trim((string) $v) !== '')) continue;
            $dense = [];
            for ($i = 0; $i <= $maxCol; $i++) $dense[] = $cells[$i] ?? '';
            $rows[$rowIndex] = $dense;
        }

        if (empty($rows)) return [];
        $maxRow = max(array_keys($rows));
        $out = [];
        for ($i = 0; $i <= $maxRow; $i++) $out[] = $rows[$i] ?? [];
        return $out;
    }
}
