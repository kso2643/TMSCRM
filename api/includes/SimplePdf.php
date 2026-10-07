<?php
/**
 * Minimal PDF generator — no Composer packages, just raw PDF object/stream
 * assembly. Replaces the `pdfkit` npm package for the two PDF features:
 * the quotation letterhead (quotations.controller.js generatePDF) and the
 * generic tabular report export (export.controller.js streamPDF).
 *
 * Coordinates are top-left origin, y increasing downward — exactly like
 * PDFKit's abstraction — so x/y numbers ported from the original JS code
 * can be used unchanged. Uses only the standard (non-embedded) Helvetica /
 * Helvetica-Bold fonts with their real Adobe AFM character widths, so
 * word-wrap and right-alignment line up correctly without a bundled font.
 */
class SimplePdf
{
    /** Adobe AFM widths (1/1000 em) for Helvetica, codes 32-126 (WinAnsi-compatible ASCII range). */
    private const W_REGULAR = [
        32=>278,33=>278,34=>355,35=>556,36=>556,37=>889,38=>667,39=>191,40=>333,41=>333,
        42=>389,43=>584,44=>278,45=>333,46=>278,47=>278,48=>556,49=>556,50=>556,51=>556,
        52=>556,53=>556,54=>556,55=>556,56=>556,57=>556,58=>278,59=>278,60=>584,61=>584,
        62=>584,63=>556,64=>1015,65=>667,66=>667,67=>722,68=>722,69=>667,70=>611,71=>778,
        72=>722,73=>278,74=>500,75=>667,76=>556,77=>833,78=>722,79=>778,80=>667,81=>778,
        82=>722,83=>667,84=>611,85=>722,86=>667,87=>944,88=>667,89=>667,90=>611,91=>278,
        92=>278,93=>278,94=>469,95=>556,96=>333,97=>556,98=>556,99=>500,100=>556,101=>556,
        102=>278,103=>556,104=>556,105=>222,106=>222,107=>500,108=>222,109=>833,110=>556,
        111=>556,112=>556,113=>556,114=>333,115=>500,116=>278,117=>556,118=>500,119=>722,
        120=>500,121=>500,122=>500,123=>334,124=>260,125=>334,126=>584,
    ];

    /** Adobe AFM widths for Helvetica-Bold. */
    private const W_BOLD = [
        32=>278,33=>333,34=>474,35=>556,36=>556,37=>889,38=>722,39=>238,40=>333,41=>333,
        42=>389,43=>584,44=>278,45=>333,46=>278,47=>278,48=>556,49=>556,50=>556,51=>556,
        52=>556,53=>556,54=>556,55=>556,56=>556,57=>556,58=>333,59=>333,60=>584,61=>584,
        62=>584,63=>611,64=>975,65=>722,66=>722,67=>722,68=>722,69=>667,70=>611,71=>778,
        72=>722,73=>278,74=>556,75=>722,76=>611,77=>833,78=>722,79=>778,80=>667,81=>778,
        82=>722,83=>667,84=>611,85=>722,86=>667,87=>944,88=>667,89=>667,90=>611,91=>333,
        92=>278,93=>333,94=>584,95=>556,96=>333,97=>556,98=>611,99=>556,100=>611,101=>556,
        102=>333,103=>611,104=>611,105=>278,106=>278,107=>556,108=>278,109=>889,110=>611,
        111=>611,112=>611,113=>611,114=>389,115=>556,116=>333,117=>611,118=>556,119=>778,
        120=>556,121=>556,122=>500,123=>389,124=>280,125=>389,126=>584,
    ];

    public const A4_WIDTH = 595.28;
    public const A4_HEIGHT = 841.89;

    private array $pages = [];
    private int $activeIdx = -1;
    private float $pageWidth = self::A4_WIDTH;
    private float $pageHeight = self::A4_HEIGHT;

    private float $fillR = 0, $fillG = 0, $fillB = 0;
    private float $drawR = 0, $drawG = 0, $drawB = 0;
    private float $lineWidth = 1;
    private string $fontName = 'Helvetica';
    private float $fontSize = 12;

    /** @var array<int,array{w:int,h:int,rgb:string,alpha:?string}> Embedded raster images, keyed by insertion index. */
    private array $images = [];

    public function addPage(float $width = self::A4_WIDTH, float $height = self::A4_HEIGHT): void
    {
        $this->pages[] = ['w' => $width, 'h' => $height, 'stream' => '', 'xobjects' => []];
        $this->activeIdx = count($this->pages) - 1;
        $this->pageWidth = $width;
        $this->pageHeight = $height;
    }

    public function pageCount(): int
    {
        return count($this->pages);
    }

    /** Switches the "active" page (0-indexed) so subsequent draw calls append to it — lets chrome
     *  like page numbers be painted on every page only once the final page count is known,
     *  mirroring jsPDF's setPage(). Existing content on that page is preserved; new drawing
     *  paints on top of it, same as any other append. */
    public function setActivePage(int $index): void
    {
        if ($index < 0 || $index >= count($this->pages)) return;
        $this->activeIdx = $index;
        $this->pageWidth = $this->pages[$index]['w'];
        $this->pageHeight = $this->pages[$index]['h'];
    }

    public function setFont(string $name, float $size): void
    {
        $this->fontName = in_array($name, ['Helvetica-Bold', 'Helvetica-Oblique'], true) ? $name : 'Helvetica';
        $this->fontSize = $size;
    }

    public function setFillColor(string $hex): void
    {
        [$this->fillR, $this->fillG, $this->fillB] = $this->hexToRgb($hex);
    }

    /** Stroke color used by roundedRect()'s 'D'/'FD' styles (rect()/line() still take their color directly). */
    public function setDrawColor(string $hex): void
    {
        [$this->drawR, $this->drawG, $this->drawB] = $this->hexToRgb($hex);
    }

    /** Stroke width used by roundedRect()'s 'D'/'FD' styles. */
    public function setLineWidth(float $w): void
    {
        $this->lineWidth = $w;
    }

    private function hexToRgb(string $hex): array
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) === 3) $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        if (strlen($hex) !== 6) $hex = '000000';
        return [hexdec(substr($hex, 0, 2)) / 255, hexdec(substr($hex, 2, 2)) / 255, hexdec(substr($hex, 4, 2)) / 255];
    }

    /** Best-effort UTF-8 → WinAnsi (CP1252) byte conversion, so AFM widths/glyphs line up. */
    private function toWinAnsi(string $utf8): string
    {
        $out = @iconv('UTF-8', 'CP1252//TRANSLIT//IGNORE', $utf8);
        if ($out === false) $out = preg_replace('/[^\x20-\x7E]/', '?', $utf8) ?? '';
        return $out;
    }

    public function textWidth(string $str, ?string $font = null, ?float $size = null): float
    {
        $font ??= $this->fontName;
        $size ??= $this->fontSize;
        $table = $font === 'Helvetica-Bold' ? self::W_BOLD : self::W_REGULAR;
        $bytes = $this->toWinAnsi($str);
        $w = 0;
        $len = strlen($bytes);
        for ($i = 0; $i < $len; $i++) {
            $w += $table[ord($bytes[$i])] ?? 556;
        }
        return $w * $size / 1000.0;
    }

    private function wrapText(string $str, float $maxWidth): array
    {
        $words = preg_split('/\s+/', trim($str));
        if ($words === [''] || $words === false) return [''];
        $lines = [];
        $current = '';
        foreach ($words as $word) {
            $test = $current === '' ? $word : "$current $word";
            if ($current === '' || $this->textWidth($test) <= $maxWidth) {
                $current = $test;
            } else {
                $lines[] = $current;
                $current = $word;
            }
        }
        if ($current !== '') $lines[] = $current;
        return $lines ?: [''];
    }

    private function escapeText(string $winAnsi): string
    {
        $s = str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $winAnsi);
        return preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $s) ?? $s;
    }

    private function append(string $chunk): void
    {
        if ($this->activeIdx < 0) $this->addPage();
        $this->pages[$this->activeIdx]['stream'] .= $chunk;
    }

    /**
     * Draws text at top-left coordinate (x,y). Options: width (enables
     * word-wrap + alignment), align ('left'|'right'|'center'), lineGap.
     * Returns the rendered width of the (single, unwrapped) string —
     * handy for manually chaining "continued" text segments.
     */
    public function text(string $str, float $x, float $y, array $opts = []): float
    {
        $width = $opts['width'] ?? null;
        $align = $opts['align'] ?? 'left';
        $lineGap = $opts['lineGap'] ?? 2;
        // 'top' (default, unchanged): y is the top of the text block, as before.
        // 'middle': y is the vertical center of a single line — shift up before laying out,
        // matching jsPDF's {baseline:'middle'} option used throughout the APJ letterhead port.
        $baseline = $opts['baseline'] ?? 'top';
        if ($baseline === 'middle') {
            $y -= $this->fontSize * 0.46;
        }

        $ascent = $this->fontSize * 0.75;
        $lineHeight = $this->fontSize + $lineGap;

        $lines = $width !== null ? $this->wrapText($str, $width) : [$str];
        $firstLineWidth = 0;

        foreach ($lines as $i => $line) {
            $lineTopY = $y + $i * $lineHeight;
            $lineW = $this->textWidth($line);
            if ($i === 0) $firstLineWidth = $lineW;
            $drawX = $x;
            if ($width !== null) {
                if ($align === 'right') $drawX = $x + $width - $lineW;
                elseif ($align === 'center') $drawX = $x + ($width - $lineW) / 2;
            } else {
                // No box width given — treat x as the anchor point itself (jsPDF's convention
                // for {align:'center'|'right'} without a wrapping width), rather than a no-op.
                if ($align === 'right') $drawX = $x - $lineW;
                elseif ($align === 'center') $drawX = $x - $lineW / 2;
            }
            $pdfY = $this->pageHeight - ($lineTopY + $ascent);
            $fontKey = $this->fontName === 'Helvetica-Bold' ? 'F2' : ($this->fontName === 'Helvetica-Oblique' ? 'F3' : 'F1');
            $escaped = $this->escapeText($this->toWinAnsi($line));
            $this->append(sprintf(
                "q\n%.3F %.3F %.3F rg\nBT\n/%s %.2F Tf\n%.3F %.3F Td\n(%s) Tj\nET\nQ\n",
                $this->fillR, $this->fillG, $this->fillB, $fontKey, $this->fontSize, $drawX, $pdfY, $escaped
            ));
        }
        return $firstLineWidth;
    }

    /** Public wrapper around the word-wrap helper — mirrors jsPDF's splitTextToSize(), used by
     *  the APJ letterhead port to size table cells exactly like the original. */
    public function splitTextToSize(string $str, float $maxWidth): array
    {
        return $this->wrapText($str, $maxWidth);
    }

    /**
     * Renders several text fragments back-to-back on one line, each with
     * its own font/size/color — replicates PDFKit's `.text(a,{continued:true}).font(...).text(b)` chaining used for "Kind Attn: NAME" / "Sub: SUBJECT".
     * @param array<int,array{text:string,font?:string,size?:float,color?:string}> $segments
     */
    public function textSegments(float $x, float $y, array $segments): void
    {
        $curX = $x;
        foreach ($segments as $seg) {
            $this->setFont($seg['font'] ?? $this->fontName, $seg['size'] ?? $this->fontSize);
            $this->setFillColor($seg['color'] ?? '#000000');
            $w = $this->text($seg['text'], $curX, $y);
            $curX += $w;
        }
    }

    public function rect(float $x, float $y, float $w, float $h, string $hexColor): void
    {
        [$r, $g, $b] = $this->hexToRgb($hexColor);
        $pdfY = $this->pageHeight - $y - $h;
        $this->append(sprintf("q\n%.3F %.3F %.3F rg\n%.2F %.2F %.2F %.2F re\nf\nQ\n", $r, $g, $b, $x, $pdfY, $w, $h));
    }

    /** @param float[] $dash Dash pattern in on/off point lengths (e.g. [1,1.2]); empty = solid. */
    public function line(float $x1, float $y1, float $x2, float $y2, string $hexColor, float $width = 1, array $dash = []): void
    {
        [$r, $g, $b] = $this->hexToRgb($hexColor);
        $dashOp = empty($dash)
            ? "[] 0 d\n"
            : '[' . implode(' ', array_map(fn($d) => sprintf('%.2F', $d), $dash)) . "] 0 d\n";
        $this->append(sprintf(
            "q\n%s%.2F w\n%.3F %.3F %.3F RG\n%.2F %.2F m\n%.2F %.2F l\nS\nQ\n",
            $dashOp, $width, $r, $g, $b, $x1, $this->pageHeight - $y1, $x2, $this->pageHeight - $y2
        ));
    }

    /**
     * Rounded rectangle, corner-approximated with cubic Béziers (the same κ≈0.5523
     * constant every 2D graphics stack uses for circular corners), so it renders
     * visually identically to jsPDF's roundedRect(). $style: 'F' fill (current fill
     * color), 'D' stroke (current draw color/width), 'FD' both in one pass.
     */
    public function roundedRect(float $x, float $y, float $w, float $h, float $rx, float $ry, string $style = 'F'): void
    {
        $rx = max(0, min($rx, $w / 2));
        $ry = max(0, min($ry, $h / 2));
        $k = 0.5522847498;

        $path = '';
        $toY = fn(float $py): float => $this->pageHeight - $py;
        $m = function (float $px, float $py) use (&$path, $toY) { $path .= sprintf("%.3F %.3F m\n", $px, $toY($py)); };
        $l = function (float $px, float $py) use (&$path, $toY) { $path .= sprintf("%.3F %.3F l\n", $px, $toY($py)); };
        $c = function (float $x1, float $y1, float $x2, float $y2, float $x3, float $y3) use (&$path, $toY) {
            $path .= sprintf("%.3F %.3F %.3F %.3F %.3F %.3F c\n", $x1, $toY($y1), $x2, $toY($y2), $x3, $toY($y3));
        };

        $m($x + $rx, $y);
        $l($x + $w - $rx, $y);
        $c($x + $w - $rx + $rx * $k, $y, $x + $w, $y + $ry - $ry * $k, $x + $w, $y + $ry);
        $l($x + $w, $y + $h - $ry);
        $c($x + $w, $y + $h - $ry + $ry * $k, $x + $w - $rx + $rx * $k, $y + $h, $x + $w - $rx, $y + $h);
        $l($x + $rx, $y + $h);
        $c($x + $rx - $rx * $k, $y + $h, $x, $y + $h - $ry + $ry * $k, $x, $y + $h - $ry);
        $l($x, $y + $ry);
        $c($x, $y + $ry - $ry * $k, $x + $rx - $rx * $k, $y, $x + $rx, $y);
        $path .= "h\n";

        $paintOp = $style === 'FD' ? 'B' : ($style === 'D' ? 'S' : 'f');
        $colorOps = '';
        if ($style === 'F' || $style === 'FD') {
            $colorOps .= sprintf("%.3F %.3F %.3F rg\n", $this->fillR, $this->fillG, $this->fillB);
        }
        if ($style === 'D' || $style === 'FD') {
            $colorOps .= sprintf("%.3F %.3F %.3F RG\n%.2F w\n", $this->drawR, $this->drawG, $this->drawB, $this->lineWidth);
        }

        $this->append("q\n" . $colorOps . $path . $paintOp . "\nQ\n");
    }

    /**
     * Embeds a PNG (with alpha channel preserved via a soft mask) at the given position/size —
     * used for the company logo in the APJ letterhead. Requires the GD extension; returns false
     * (drawing nothing) if GD isn't available or the file can't be read, so callers can fall
     * back to a text treatment, same as the original app does when the logo fails to load.
     */
    public function addImage(string $pngPath, float $x, float $y, float $w, float $h): bool
    {
        if ($this->activeIdx < 0) $this->addPage();
        if (!is_readable($pngPath) || !function_exists('imagecreatefrompng')) return false;

        $img = @imagecreatefrompng($pngPath);
        if (!$img) return false;

        if (!imageistruecolor($img)) imagepalettetotruecolor($img);
        imagealphablending($img, false);
        imagesavealpha($img, true);

        $iw = imagesx($img);
        $ih = imagesy($img);
        $rgbRows = [];
        $alphaRows = [];
        $hasAlpha = false;

        for ($yy = 0; $yy < $ih; $yy++) {
            $rowRgb = [];
            $rowAlpha = [];
            for ($xx = 0; $xx < $iw; $xx++) {
                $px = imagecolorat($img, $xx, $yy);
                $a = ($px >> 24) & 0x7F;      // GD alpha: 0 = opaque .. 127 = fully transparent
                $rowRgb[] = ($px >> 16) & 0xFF;
                $rowRgb[] = ($px >> 8) & 0xFF;
                $rowRgb[] = $px & 0xFF;
                $alphaByte = 255 - (int) round($a * 255 / 127); // PDF SMask: 0 = transparent .. 255 = opaque
                if ($alphaByte < 255) $hasAlpha = true;
                $rowAlpha[] = $alphaByte;
            }
            $rgbRows[] = pack('C*', ...$rowRgb);
            $alphaRows[] = pack('C*', ...$rowAlpha);
        }
        imagedestroy($img);

        $idx = count($this->images);
        $this->images[$idx] = [
            'w' => $iw,
            'h' => $ih,
            'rgb' => implode('', $rgbRows),
            'alpha' => $hasAlpha ? implode('', $alphaRows) : null,
        ];

        $name = 'Im' . $idx;
        $this->pages[$this->activeIdx]['xobjects'][$name] = $idx;

        $pdfY = $this->pageHeight - $y - $h;
        $this->append(sprintf("q\n%.3F 0 0 %.3F %.3F %.3F cm\n/%s Do\nQ\n", $w, $h, $x, $pdfY, $name));
        return true;
    }

    public function currentPageHeight(): float { return $this->pageHeight; }
    public function currentPageWidth(): float { return $this->pageWidth; }

    /** Builds a raw Image XObject dictionary+stream (FlateDecode-compressed when zlib is available,
     *  raw bytes otherwise — either is valid PDF, compression just keeps the file smaller). */
    private function buildImageObject(int $w, int $h, string $colorSpace, string $data, ?int $smaskObjNum = null): string
    {
        $compressed = function_exists('gzcompress') ? gzcompress($data, 9) : false;
        $useCompression = $compressed !== false;
        $streamData = $useCompression ? $compressed : $data;
        $filterEntry = $useCompression ? ' /Filter /FlateDecode' : '';
        $smaskEntry = $smaskObjNum !== null ? " /SMask $smaskObjNum 0 R" : '';
        return sprintf(
            "<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /%s /BitsPerComponent 8%s%s /Length %d >>\nstream\n%s\nendstream",
            $w, $h, $colorSpace, $filterEntry, $smaskEntry, strlen($streamData), $streamData
        );
    }

    /** Data stored inside the PDF (read back with SimplePdf::readEmbedded()). */
    public ?string $embeddedData = null;

    /** The data stored by $embeddedData, from raw PDF bytes; null when there is none. */
    public static function readEmbedded(string $bytes): ?string
    {
        if (!preg_match('#/Type /TMSCRMData /Length \d+ >>\s*stream\s*([A-Za-z0-9+/=]+)\s*endstream#', $bytes, $m)) return null;
        $d = base64_decode($m[1], true);
        return $d === false ? null : $d;
    }

    /** Assembles the final PDF byte string from the accumulated pages. */
    public function output(): string
    {
        if (empty($this->pages)) $this->addPage();

        $objects = []; // 1-indexed: objects[n] = object body (without "n 0 obj"/"endobj")
        $objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

        $fontHelvObjNum = 3;
        $fontBoldObjNum = 4;
        $fontObliqueObjNum = 5;
        $objects[$fontHelvObjNum]     = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
        $objects[$fontBoldObjNum]     = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
        $objects[$fontObliqueObjNum]  = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>";

        $nextObjNum = 6;

        // Embedded images (+ optional soft masks for alpha) get object numbers first, so each
        // page's /Resources dict below can reference the right one by number.
        $imageObjNums = [];
        foreach ($this->images as $idx => $img) {
            $smaskObjNum = null;
            if ($img['alpha'] !== null) {
                $smaskObjNum = $nextObjNum++;
                $objects[$smaskObjNum] = $this->buildImageObject($img['w'], $img['h'], 'DeviceGray', $img['alpha']);
            }
            $imgObjNum = $nextObjNum++;
            $objects[$imgObjNum] = $this->buildImageObject($img['w'], $img['h'], 'DeviceRGB', $img['rgb'], $smaskObjNum);
            $imageObjNums[$idx] = $imgObjNum;
        }

        // Optional data payload (e.g. the purchase order JSON) so an uploaded PDF can be
        // opened again for editing. An unreferenced object — viewers ignore it.
        if ($this->embeddedData !== null) {
            $payload = base64_encode($this->embeddedData);
            $objects[$nextObjNum++] = "<< /Type /TMSCRMData /Length " . strlen($payload) . " >>\nstream\n" . $payload . "\nendstream";
        }

        $pageObjNums = [];
        foreach ($this->pages as $page) {
            $contentObjNum = $nextObjNum++;
            $pageObjNum = $nextObjNum++;
            $stream = $page['stream'];
            $objects[$contentObjNum] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "endstream";

            $xobjEntry = '';
            if (!empty($page['xobjects'])) {
                $parts = [];
                foreach ($page['xobjects'] as $name => $imgIdx) {
                    $parts[] = "/$name " . $imageObjNums[$imgIdx] . " 0 R";
                }
                $xobjEntry = ' /XObject << ' . implode(' ', $parts) . ' >>';
            }

            $objects[$pageObjNum] = sprintf(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2F %.2F] /Resources << /Font << /F1 %d 0 R /F2 %d 0 R /F3 %d 0 R >>%s >> /Contents %d 0 R >>",
                $page['w'], $page['h'], $fontHelvObjNum, $fontBoldObjNum, $fontObliqueObjNum, $xobjEntry, $contentObjNum
            );
            $pageObjNums[] = $pageObjNum;
        }

        $kids = implode(' ', array_map(fn($n) => "$n 0 R", $pageObjNums));
        $objects[2] = sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", $kids, count($pageObjNums));

        ksort($objects);
        $maxObjNum = max(array_keys($objects));

        $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [0 => 0];
        for ($n = 1; $n <= $maxObjNum; $n++) {
            if (!isset($objects[$n])) continue;
            $offsets[$n] = strlen($out);
            $out .= "$n 0 obj\n" . $objects[$n] . "\nendobj\n";
        }

        $xrefStart = strlen($out);
        $out .= "xref\n0 " . ($maxObjNum + 1) . "\n";
        $out .= "0000000000 65535 f \n";
        for ($n = 1; $n <= $maxObjNum; $n++) {
            if (!isset($offsets[$n])) {
                $out .= "0000000000 00000 f \n";
                continue;
            }
            $out .= sprintf("%010d 00000 n \n", $offsets[$n]);
        }
        $out .= "trailer\n<< /Size " . ($maxObjNum + 1) . " /Root 1 0 R >>\nstartxref\n$xrefStart\n%%EOF";

        return $out;
    }
}
