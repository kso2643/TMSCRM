<?php
/**
 * Minimal XLSX (Office Open XML spreadsheet) writer. No Composer
 * packages — just PHP's built-in ZipArchive extension. Produces a single
 * worksheet workbook with inline strings, which every spreadsheet app
 * (Excel, LibreOffice, Google Sheets) reads natively. This replaces the
 * `xlsx` (SheetJS) npm package used by the Node backend for the stock
 * template download and the CSV/Excel/PDF report exports.
 */
class XlsxWriter
{
    private array $rows = [];
    private string $sheetName;
    /** 0-based column indexes that should render as text even if numeric-looking (e.g. item codes like "007"). */
    private array $forceTextCols = [];

    public function __construct(string $sheetName = 'Sheet1')
    {
        $this->sheetName = $this->sanitizeSheetName($sheetName);
    }

    public function setForceTextColumns(array $colIndexes): void
    {
        $this->forceTextCols = $colIndexes;
    }

    public function addRow(array $cells): void
    {
        $this->rows[] = array_values($cells);
    }

    public function addRows(array $rows): void
    {
        foreach ($rows as $r) $this->addRow($r);
    }

    private function sanitizeSheetName(string $name): string
    {
        $name = preg_replace('/[\\\\\/\?\*\[\]:]/', ' ', $name);
        $name = trim($name);
        if ($name === '') $name = 'Sheet1';
        return mb_substr($name, 0, 31);
    }

    /** 0-based column index → spreadsheet column letters (0 → A, 25 → Z, 26 → AA, ...) */
    private function colLetter(int $index): string
    {
        $letter = '';
        $index++;
        while ($index > 0) {
            $rem = ($index - 1) % 26;
            $letter = chr(65 + $rem) . $letter;
            $index = intdiv($index - 1, 26);
        }
        return $letter;
    }

    private function xmlEscape(string $s): string
    {
        $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $s) ?? $s;
        return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private function isPlainNumber($value): bool
    {
        if (is_int($value) || is_float($value)) return true;
        if (!is_string($value) || $value === '') return false;
        if (!is_numeric($value)) return false;
        // Preserve leading-zero strings ("007") and plus-prefixed phone-like strings as text.
        if (preg_match('/^[+]?0\d/', $value)) return false;
        return true;
    }

    private function buildSheetXml(): string
    {
        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        $xml .= '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
        foreach ($this->rows as $rIdx => $row) {
            $rowNum = $rIdx + 1;
            $xml .= '<row r="' . $rowNum . '">';
            foreach ($row as $cIdx => $value) {
                $ref = $this->colLetter($cIdx) . $rowNum;
                if ($value === null || $value === '') continue;
                $forceText = in_array($cIdx, $this->forceTextCols, true);
                if (!$forceText && $this->isPlainNumber($value)) {
                    $num = is_string($value) ? (float) $value : $value;
                    if (is_float($num) && fmod($num, 1.0) === 0.0 && abs($num) < 1e15) {
                        $numStr = (string) (int) $num;
                    } else {
                        $numStr = rtrim(rtrim(sprintf('%.10F', $num), '0'), '.');
                    }
                    $xml .= '<c r="' . $ref . '"><v>' . $numStr . '</v></c>';
                } else {
                    $xml .= '<c r="' . $ref . '" t="inlineStr"><is><t xml:space="preserve">' . $this->xmlEscape((string) $value) . '</t></is></c>';
                }
            }
            $xml .= '</row>';
        }
        $xml .= '</sheetData></worksheet>';
        return $xml;
    }

    private function contentTypesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            . '</Types>';
    }

    private function relsXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            . '</Relationships>';
    }

    private function workbookXml(): string
    {
        $name = $this->xmlEscape($this->sheetName);
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheets><sheet name="' . $name . '" sheetId="1" r:id="rId1"/></sheets>'
            . '</workbook>';
    }

    private function workbookRelsXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            . '</Relationships>';
    }

    private function stylesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
            . '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
            . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
            . '</styleSheet>';
    }

    /** Returns the raw .xlsx file bytes. */
    public function output(): string
    {
        $tmpFile = tempnam(sys_get_temp_dir(), 'xlsx_');
        $zip = new ZipArchive();
        $zip->open($tmpFile, ZipArchive::OVERWRITE | ZipArchive::CREATE);
        $zip->addFromString('[Content_Types].xml', $this->contentTypesXml());
        $zip->addFromString('_rels/.rels', $this->relsXml());
        $zip->addFromString('xl/workbook.xml', $this->workbookXml());
        $zip->addFromString('xl/_rels/workbook.xml.rels', $this->workbookRelsXml());
        $zip->addFromString('xl/styles.xml', $this->stylesXml());
        $zip->addFromString('xl/worksheets/sheet1.xml', $this->buildSheetXml());
        $zip->close();
        $bytes = file_get_contents($tmpFile);
        unlink($tmpFile);
        return $bytes;
    }
}
