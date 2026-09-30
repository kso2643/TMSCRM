<?php
/**
 * Faithful PHP port of `tms_downloadPDF()` from the standalone
 * quotation-creator-tms-apj-main/index.html tool — its jsPDF-based TMS
 * letterhead — so QuotationController::generatePdf() produces the exact
 * same visual document for TMS quotations, using SimplePdf (our
 * dependency-free PDF writer) in place of jsPDF. Mirrors the structure
 * and conventions of ApjQuotationPdf.php (its APJ counterpart).
 *
 * UNITS: the original works in millimetres (`new jsPDF('p','mm','a4')`);
 * SimplePdf works in PDF points. Every x/y/width/height/line-width number
 * below is kept in the SAME millimetre figures as the JS source (so this
 * file can be diffed against it almost line-for-line) and is only run
 * through mm() at the point it's handed to SimplePdf. Font sizes need no
 * conversion — jsPDF's setFontSize() is already in points regardless of
 * document unit, same convention SimplePdf already uses.
 *
 * Source reference: quotation-creator-tms-apj-main/index.html, function
 * tms_downloadPDF() (search that file for the exact original).
 */
class TMSQuotationPdf
{
    /** 1mm in PDF points (72pt / 25.4mm). */
    private const MM = 2.8346456693;

    // ---- brand palette — same RGB triples as the JS BLUE/LBLUE/etc. constants ----
    private const BLUE     = '#1A4FA0'; // [26,79,160]
    private const LBLUE    = '#B4C8EB'; // [180,200,235]
    private const DARK     = '#111827'; // [17,24,39]
    private const GREY     = '#6B7280'; // [107,114,128]
    private const GREEN    = '#166534'; // [22,101,52]
    private const BGBLUE   = '#EFF6FF'; // [239,246,255]
    private const WHITE    = '#FFFFFF';
    private const ROW_ALT  = '#F9FAFB'; // [249,250,251] alternating row tint
    private const CELL_BRD = '#ECECEC'; // [236,236,236] table cell borders
    private const BOX_BRD  = '#D1D5DB'; // [209,213,219] TO/META box borders
    private const TERMS_BG = '#FAFAFA'; // [250,250,250]
    private const TERMS_BRD= '#E5E7EB'; // [229,231,235]
    private const SIGN_CLR = '#374151'; // [55,65,81] address/sign-name text
    private const TOTAL_BRD= '#DCDCDC'; // [220,220,220] total-row border
    /** Header column dividers are 30%-opacity white over the BLUE fill in the JS.
     *  SimplePdf has no true alpha compositing, so this is the analytically-blended
     *  solid equivalent (blue*0.7 + white*0.3 ≈ #5F84BD) — same technique used for
     *  the header dividers in ApjQuotationPdf. */
    private const HEAD_DIV = '#5F84BD';

    private const A4_W = 210.0;
    private const A4_H = 297.0;
    private const ML = 10.0;
    private const MR = 10.0;
    private const MT = 12.0;
    private const MB = 12.0;

    private SimplePdf $pdf;
    private float $curY = 0;
    private float $cw = 0;      // content width = A4_W - ML - MR
    private float $bottom = 0;  // A4_H - MB

    /** @var array<string,mixed> Quotation row (+ joined customer/user columns), as from the DB. */
    private array $q;
    /** @var array<int,array<string,mixed>> QuotationItem rows. */
    private array $items;

    public function __construct(array $quotation, array $items)
    {
        $this->q = $quotation;
        $this->items = $items;
    }

    private function mm(float $v): float
    {
        return $v * self::MM;
    }

    private function textWidthMm(string $s): float
    {
        return $this->pdf->textWidth($s) / self::MM;
    }

    private function splitToSize(string $s, float $maxWidthMm): array
    {
        return $this->pdf->splitTextToSize($s, $this->mm($maxWidthMm));
    }

    private function fmtDate(?string $raw): string
    {
        if (!$raw) return '—';
        try {
            return (new DateTime($raw))->format('d M Y');
        } catch (Exception $e) {
            return '—';
        }
    }

    /** 'Rs. ' + Indian (lakh/crore) digit grouping, 2 decimals — matches the JS's
     *  `'₹\u202f' + Number(n).toLocaleString('en-IN',{minimumFractionDigits:2})`,
     *  after the rupee sign is swapped for "Rs." by the original's pdfText() sanitiser. */
    private function fmtMoney(float $n): string
    {
        return 'Rs. ' . $this->indianNumber($n, 2);
    }

    private function indianNumber(float $n, int $decimals = 2): string
    {
        $isNeg = $n < 0;
        $n = abs($n);
        $fixed = number_format($n, $decimals, '.', '');
        [$intPart, $decPart] = array_pad(explode('.', $fixed), 2, '');
        $decPart = $decimals > 0 ? '.' . $decPart : '';
        $len = strlen($intPart);
        if ($len <= 3) {
            $grouped = $intPart;
        } else {
            $lastThree = substr($intPart, -3);
            $rest = substr($intPart, 0, $len - 3);
            $restLen = strlen($rest);
            $groups = [];
            $i = 0;
            if ($restLen % 2 === 1) { $groups[] = substr($rest, 0, 1); $i = 1; }
            for (; $i < $restLen; $i += 2) { $groups[] = substr($rest, $i, 2); }
            $grouped = implode(',', $groups) . ',' . $lastThree;
        }
        return ($isNeg ? '-' : '') . $grouped . $decPart;
    }

    /** Plain-number display used for MOQ/discount — trims a DECIMAL(x,2) column's
     *  forced ".00" down to how a whole-number-typing user would have seen it
     *  (5.00 → "5", 12.50 → "12.5"), matching the JS's raw (un-.toFixed'd) values. */
    private function trimNumber(float $n): string
    {
        if (abs($n - round($n)) < 0.0005) return (string)(int)round($n);
        $s = number_format($n, 4, '.', '');
        $s = rtrim($s, '0');
        return rtrim($s, '.');
    }

    private function orDash(?string $s, string $dash = '-'): string
    {
        $s = trim((string)$s);
        return $s !== '' ? $s : $dash;
    }

    /** Zero-radius roundedRect is a plain stroked rectangle — used throughout for the
     *  page border / TO box / META box / cell borders, matching the JS's un-filled
     *  `pdf.rect(x,y,w,h)` calls (default jsPDF style 'S' = stroke only). */
    private function strokeRect(float $x, float $y, float $w, float $h, string $color, float $widthMm): void
    {
        $this->pdf->setDrawColor($color);
        $this->pdf->setLineWidth($this->mm($widthMm));
        $this->pdf->roundedRect($this->mm($x), $this->mm($y), $this->mm($w), $this->mm($h), 0, 0, 'D');
    }

    public function render(): SimplePdf
    {
        $this->pdf = new SimplePdf();
        $this->cw = self::A4_W - self::ML - self::MR;   // 190
        $this->bottom = self::A4_H - self::MB;           // 285
        $this->pdf->addPage($this->mm(self::A4_W), $this->mm(self::A4_H));
        $this->curY = self::MT;
        $this->drawBorder();

        // ── collect fields (mirrors the JS's const toName/addr/metaNo/... block) ──
        $toName  = $this->orDash($this->q['toName'] ?? '', (string)($this->q['companyName'] ?? ''));
        $toAddr1 = trim((string)($this->q['toAddr1'] ?? ''));
        $toAddr2 = trim((string)($this->q['toAddr2'] ?? ''));
        $toState = trim((string)($this->q['toState'] ?? ''));
        $metaNo    = $this->orDash($this->q['quotationNumber'] ?? '');
        $metaDate  = $this->fmtDate($this->q['quotationDate'] ?? null);
        $metaDate1 = $this->fmtDate($this->q['enquiryDate'] ?? null);
        $metaAttn  = $this->orDash($this->q['kindAttn'] ?? '');
        $metaDesig = $this->orDash($this->q['toDesignation'] ?? '');
        $metaEnq   = $this->orDash($this->q['enquiryRef'] ?? '');
        $subject   = (string)($this->q['subject'] ?? '');
        $tax      = $this->orDash($this->q['salesTax'] ?? '');
        $payment  = $this->orDash($this->q['paymentTerms'] ?? '');
        $validity = $this->orDash($this->q['validity'] ?? '');
        $delivery = $this->orDash($this->q['deliveryCharges'] ?? '');
        $signCo    = (string)($this->q['signCompany'] ?? '');
        $signName  = (string)($this->q['signName'] ?? '');
        $signDesig = (string)($this->q['signDesignation'] ?? '');

        $grandTotalNum = (float)($this->q['totalAmount'] ?? 0);
        $grandTotal = $grandTotalNum ? $this->fmtMoney($grandTotalNum) : '-';
        $totalMoq = 0.0;
        foreach ($this->items as $item) { $totalMoq += (float)($item['quantity'] ?? 0); }

        // ════════════════════════════════════════════════════
        // HEADER — logo left + company info right
        // ════════════════════════════════════════════════════
        $logoPath = __DIR__ . '/../assets/tms-logo.png';
        $logoH = 18.0;
        $logoW = 291.0 * $logoH / 164.0; // native 291×164 px, scaled to 18mm height ≈ 31.94mm
        $embedded = $this->pdf->addImage($logoPath, $this->mm(self::ML), $this->mm($this->curY), $this->mm($logoW), $this->mm($logoH));
        if (!$embedded) {
            $this->pdf->setFont('Helvetica-Bold', 14);
            $this->pdf->setFillColor(self::BLUE);
            $this->pdf->text('TMS', $this->mm(self::ML), $this->mm($this->curY + 12), ['baseline' => 'top']);
        }

        $this->pdf->setFont('Helvetica-Bold', 13);
        $this->pdf->setFillColor(self::BLUE);
        $this->pdf->text('TULIPS MACHINING SOLUTIONS', $this->mm(self::A4_W - self::MR), $this->mm($this->curY + 4), ['align' => 'right', 'baseline' => 'top']);

        $this->pdf->setFont('Helvetica', 7.5);
        $this->pdf->setFillColor(self::DARK);
        $coLines = [
            'SF No 244, Palkarathottam, Opp. Sri Vignesh Nagar,',
            'Jeeva Nagar, Cheran Managar, Villankurichi, Coimbatore - 641 035',
            'Phone: +91-0422 316 1934  |  Mobile: 6379510936 / 7845843225',
            'E-Mail: uthaya@tulipsmachining.com  |  GST No: 33BRHPA9794E1ZO',
        ];
        $hY = $this->curY + 9;
        foreach ($coLines as $line) {
            $this->pdf->text($line, $this->mm(self::A4_W - self::MR), $this->mm($hY), ['align' => 'right', 'baseline' => 'top']);
            $hY += 4;
        }
        $this->curY = $hY + 2;

        // Blue separator line
        $this->pdf->line($this->mm(self::ML), $this->mm($this->curY), $this->mm(self::A4_W - self::MR), $this->mm($this->curY), self::BLUE, $this->mm(0.8));
        $this->curY += 5;

        // ════════════════════════════════════════════════════
        // TO BOX + META BOX (side by side)
        // ════════════════════════════════════════════════════
        $toBoxW = $this->cw * 0.56;
        $metaBoxW = $this->cw * 0.40;
        $metaBoxX = self::ML + $this->cw - $metaBoxW;
        $boxTop = $this->curY;

        $this->strokeRect(self::ML, $boxTop, $toBoxW, 36, self::BOX_BRD, 0.3);

        $this->pdf->setFont('Helvetica-Bold', 6.5);
        $this->pdf->setFillColor(self::BLUE);
        $this->pdf->text('TO', $this->mm(self::ML + 3), $this->mm($boxTop + 5), ['baseline' => 'top']);

        $this->pdf->setFont('Helvetica-Bold', 9.5);
        $this->pdf->setFillColor(self::DARK);
        $this->pdf->text($toName, $this->mm(self::ML + 3), $this->mm($boxTop + 10), ['baseline' => 'top']);

        $this->pdf->setFont('Helvetica', 8);
        $this->pdf->setFillColor(self::SIGN_CLR);
        $aY = $boxTop + 15;
        // Module 11 — same bug as the other two quotation PDF paths (the
        // legacy fallback in QuotationController.php and the APJ
        // letterhead): no width meant a long address ran straight past the
        // box's right edge instead of wrapping. Fixed the same way, bounded
        // to this box's actual width ($toBoxW) so it wraps inside the
        // border instead of crossing it.
        foreach (array_filter([$toAddr1, $toAddr2, $toState]) as $line) {
            foreach ($this->splitToSize($line, $toBoxW - 6) as $wrapped) {
                $this->pdf->text($wrapped, $this->mm(self::ML + 3), $this->mm($aY), ['baseline' => 'top']);
                $aY += 4;
            }
        }

        $this->strokeRect($metaBoxX, $boxTop, $metaBoxW, 36, self::BOX_BRD, 0.3);

        $this->pdf->setFont('Helvetica-Bold', 6.5);
        $this->pdf->setFillColor(self::BLUE);
        $this->pdf->text('QUOTATION INFO', $this->mm($metaBoxX + 3), $this->mm($boxTop + 5), ['baseline' => 'top']);

        $metaRows = [
            ['Quotation No.', $metaNo],
            ['Date', $metaDate],
            ['Enq. Date', $metaDate1],
            ['Kind Attn', $metaAttn],
            ['Designation', $metaDesig],
            ['Enq. Ref.', $metaEnq],
        ];
        $mY = $boxTop + 10;
        foreach ($metaRows as [$k, $val]) {
            $this->pdf->setFont('Helvetica', 7.5);
            $this->pdf->setFillColor(self::GREY);
            $this->pdf->text($k, $this->mm($metaBoxX + 3), $this->mm($mY), ['baseline' => 'top']);
            $this->pdf->setFont('Helvetica-Bold', 7.5);
            $this->pdf->setFillColor(self::DARK);
            $this->pdf->text((string)$val, $this->mm($metaBoxX + $metaBoxW - 3), $this->mm($mY), ['align' => 'right', 'baseline' => 'top']);
            $mY += 4.5;
        }

        $this->curY = $boxTop + 38;

        // ════════════════════════════════════════════════════
        // SUBJECT BAR
        // ════════════════════════════════════════════════════
        $this->ensureSpace(10);
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm(8), self::BGBLUE);
        $this->pdf->line($this->mm(self::ML), $this->mm($this->curY), $this->mm(self::ML), $this->mm($this->curY + 8), self::BLUE, $this->mm(0.8));
        $this->pdf->setFont('Helvetica-Bold', 8.5);
        $this->pdf->setFillColor(self::BLUE);
        $this->pdf->text('Sub: ' . $subject, $this->mm(self::ML + 4), $this->mm($this->curY + 5.5), ['baseline' => 'top']);
        $this->curY += 11;

        // ════════════════════════════════════════════════════
        // TABLE — S.No | Product Code | Specification | MOQ | List Price |
        //         Disc% | Net Price | Total Rate | Delivery
        // ════════════════════════════════════════════════════
        $col = [7, 26, 46, 14, 19, 13, 19, 21, 25]; // sums to 190 = CW
        $colX = [self::ML];
        for ($i = 1; $i < count($col); $i++) { $colX[] = $colX[$i - 1] + $col[$i - 1]; }
        $headH = 8.0; $rowH = 5.5;

        $this->drawTableHeader($col, $colX, $headH);

        $pdfRows = [];
        foreach ($this->items as $idx => $item) {
            $unitPrice = (float)($item['unitPrice'] ?? 0);
            $netPrice = (float)($item['netPrice'] ?? 0);
            $totalPrice = (float)($item['totalPrice'] ?? 0);
            $discount = (float)($item['discount'] ?? 0);
            $quantity = (float)($item['quantity'] ?? 0);
            $spec = trim((string)($item['description'] ?? ''));
            if ($spec === '') $spec = trim((string)($item['productName'] ?? ''));
            $pdfRows[] = [
                'sno' => (string)($idx + 1),
                'code' => $this->orDash($item['itemCode'] ?? ''),
                'spec' => $this->orDash($spec),
                'moq' => $quantity ? $this->trimNumber($quantity) : '—',
                'listPrice' => $unitPrice ? $this->fmtMoney($unitPrice) : '—',
                'disc' => $discount ? $this->trimNumber($discount) . '%' : '—',
                'netPrice' => $netPrice ? $this->fmtMoney($netPrice) : '—',
                'totalRate' => $totalPrice ? $this->fmtMoney($totalPrice) : '—',
                'deliv' => $this->orDash($item['delivery'] ?? ''),
            ];
        }
        foreach ($pdfRows as $idx => $r) {
            $this->drawRow($r, $idx, $col, $colX, $headH, $rowH);
        }

        // ── Total row: "Total MOQ" + value, "Grand Total" + value ──
        $this->ensureSpace(8);
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm(8), self::BGBLUE);
        $this->strokeRect(self::ML, $this->curY, $this->cw, 8, self::TOTAL_BRD, 0.2);

        $this->pdf->setFont('Helvetica-Bold', 9);
        $this->pdf->setFillColor(self::BLUE);
        $this->pdf->text('Total MOQ', $this->mm($colX[3] - 2), $this->mm($this->curY + 4.5), ['align' => 'right', 'baseline' => 'middle']);
        $this->pdf->setFillColor(self::GREEN);
        $this->pdf->text($totalMoq ? $this->trimNumber($totalMoq) : '0', $this->mm($colX[4] - 3), $this->mm($this->curY + 4.5), ['align' => 'right', 'baseline' => 'middle']);
        $this->pdf->setFillColor(self::BLUE);
        $this->pdf->text('Grand Total', $this->mm($colX[7] - 2), $this->mm($this->curY + 4.5), ['align' => 'right', 'baseline' => 'middle']);
        $gtRight = $colX[8] + $col[8] - 1.5;
        $this->pdf->setFillColor(self::GREEN);
        $this->pdf->text($grandTotal, $this->mm($gtRight), $this->mm($this->curY + 4.5), ['align' => 'right', 'baseline' => 'middle']);
        $this->curY += 10;

        // ════════════════════════════════════════════════════
        // TERMS OF SUPPLY + SIGNATORY
        // ════════════════════════════════════════════════════
        $this->ensureSpace(30);
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm(28), self::TERMS_BG);
        $this->strokeRect(self::ML, $this->curY, $this->cw, 28, self::TERMS_BRD, 0.3);

        $this->pdf->setFont('Helvetica-Bold', 8);
        $this->pdf->setFillColor(self::DARK);
        $this->pdf->text('Terms of Supply', $this->mm(self::ML + 3), $this->mm($this->curY + 5), ['baseline' => 'top']);

        $termRows = [
            ['Sales Tax', $tax], ['Payment', $payment], ['Validity', $validity], ['Delivery Charges', $delivery],
        ];
        $tY = $this->curY + 10;
        foreach ($termRows as [$k, $val]) {
            $this->pdf->setFont('Helvetica', 7.5);
            $this->pdf->setFillColor(self::GREY);
            $this->pdf->text($k, $this->mm(self::ML + 3), $this->mm($tY), ['baseline' => 'top']);
            $this->pdf->setFont('Helvetica-Bold', 7.5);
            $this->pdf->setFillColor(self::DARK);
            $this->pdf->text(': ' . $val, $this->mm(self::ML + 35), $this->mm($tY), ['baseline' => 'top']);
            $tY += 4.5;
        }

        // Signatory block, right side — anchored off the terms box's starting curY
        $this->pdf->setFont('Helvetica-Bold', 8);
        $this->pdf->setFillColor(self::DARK);
        $this->pdf->text('For ' . $signCo, $this->mm(self::A4_W - self::MR - 3), $this->mm($this->curY + 10), ['align' => 'right', 'baseline' => 'top']);
        $this->pdf->setFont('Helvetica', 7.5);
        $this->pdf->setFillColor(self::SIGN_CLR);
        $this->pdf->text($signName, $this->mm(self::A4_W - self::MR - 3), $this->mm($this->curY + 16), ['align' => 'right', 'baseline' => 'top']);
        $this->pdf->text($signDesig, $this->mm(self::A4_W - self::MR - 3), $this->mm($this->curY + 21), ['align' => 'right', 'baseline' => 'top']);

        $this->curY += 31;

        // ════════════════════════════════════════════════════
        // FOOTER — "AUTHORISED DISTRIBUTOR" + distributor-brand strip image
        // ════════════════════════════════════════════════════
        $this->ensureSpace(20);
        $this->pdf->line($this->mm(self::ML), $this->mm($this->curY), $this->mm(self::A4_W - self::MR), $this->mm($this->curY), self::TERMS_BRD, $this->mm(0.3));
        $this->curY += 4;

        $this->pdf->setFont('Helvetica-Bold', 7);
        $this->pdf->setFillColor(self::DARK);
        $this->pdf->text('AUTHORISED DISTRIBUTOR', $this->mm(self::A4_W / 2), $this->mm($this->curY), ['align' => 'center', 'baseline' => 'top']);
        $this->curY += 4;

        $distPath = __DIR__ . '/../assets/tms-distributors.png';
        $fW = 60.0;
        $fH = 316.0 * $fW / 633.0; // native 633×316 px, scaled to 60mm width ≈ 29.95mm
        $this->ensureSpace($fH + 4);
        $this->pdf->addImage($distPath, $this->mm((self::A4_W - $fW) / 2), $this->mm($this->curY), $this->mm($fW), $this->mm($fH));
        $this->curY += $fH + 4;

        return $this->pdf;
    }

    private function newPage(): void
    {
        $this->pdf->addPage($this->mm(self::A4_W), $this->mm(self::A4_H));
        $this->curY = self::MT;
        $this->drawBorder();
    }

    private function ensureSpace(float $need): void
    {
        if ($this->curY + $need > $this->bottom) $this->newPage();
    }

    /** Double rectangle border drawn on every page — the TMS letterhead's page frame. */
    private function drawBorder(): void
    {
        $this->strokeRect(4, 4, 202, 289, self::BLUE, 0.5);
        $this->strokeRect(5.2, 5.2, 199.6, 286.6, self::LBLUE, 0.2);
    }

    private function drawTableHeader(array $col, array $colX, float $headH): void
    {
        $this->ensureSpace($headH + 5.5);
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm($headH), self::BLUE);

        $heads = ['S.No', 'Product Code', 'Specification', 'MOQ', 'List Price', 'Disc %', 'Net Price', 'Total Rate', 'Delivery'];
        $align = ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'];
        $this->pdf->setFont('Helvetica-Bold', 6.5);
        $this->pdf->setFillColor(self::WHITE);
        foreach ($heads as $i => $h) {
            $cx = $align[$i] === 'center' ? $colX[$i] + $col[$i] / 2
                : ($align[$i] === 'right' ? $colX[$i] + $col[$i] - 1.5 : $colX[$i] + 1.5);
            $this->pdf->text($h, $this->mm($cx), $this->mm($this->curY + $headH / 2 + 2), ['align' => $align[$i], 'baseline' => 'middle']);
            if ($i > 0) {
                $this->pdf->line($this->mm($colX[$i]), $this->mm($this->curY), $this->mm($colX[$i]), $this->mm($this->curY + $headH), self::HEAD_DIV, $this->mm(0.1));
            }
        }
        $this->curY += $headH;
    }

    private function drawRow(array $r, int $idx, array $col, array $colX, float $headH, float $rowH): void
    {
        $specLines = $this->splitToSize($r['spec'], $col[2] - 2.5);
        $codeLines = $this->splitToSize($r['code'], $col[1] - 2.5);
        $lineCount = max(count($specLines), count($codeLines), 1);
        $rh = max($rowH, $lineCount * 3.6 + 2.5);

        if ($this->curY + $rh > $this->bottom) {
            $this->newPage();
            $this->drawTableHeader($col, $colX, $headH);
        }

        if ($idx % 2 === 1) {
            $this->pdf->rect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm($rh), self::ROW_ALT);
        }

        // cell borders — outer rect + internal vertical dividers, all in CELL_BRD
        $this->strokeRect(self::ML, $this->curY, $this->cw, $rh, self::CELL_BRD, 0.2);
        foreach ($colX as $i => $x) {
            if ($i > 0) {
                $this->pdf->line($this->mm($x), $this->mm($this->curY), $this->mm($x), $this->mm($this->curY + $rh), self::CELL_BRD, $this->mm(0.2));
            }
        }

        $textY = $this->curY + $rh / 2;

        $this->pdf->setFont('Helvetica-Bold', 7.5);
        $this->pdf->setFillColor(self::BLUE);
        $this->pdf->text($r['sno'], $this->mm($colX[0] + $col[0] / 2), $this->mm($textY), ['align' => 'center', 'baseline' => 'middle']);

        $this->pdf->setFont('Helvetica', 7);
        $this->pdf->setFillColor(self::DARK);
        if (count($codeLines) > 1) {
            $sy = $this->curY + ($rh - (count($codeLines) - 1) * 3.6) / 2;
            foreach ($codeLines as $li => $l) {
                $this->pdf->text($l, $this->mm($colX[1] + 1.5), $this->mm($sy + $li * 3.6), ['baseline' => 'middle']);
            }
        } else {
            $this->pdf->text($r['code'], $this->mm($colX[1] + 1.5), $this->mm($textY), ['baseline' => 'middle']);
        }

        if (count($specLines) > 1) {
            $sy = $this->curY + ($rh - (count($specLines) - 1) * 3.6) / 2;
            foreach ($specLines as $li => $l) {
                $this->pdf->text($l, $this->mm($colX[2] + 1.5), $this->mm($sy + $li * 3.6), ['baseline' => 'middle']);
            }
        } else {
            $this->pdf->text($r['spec'], $this->mm($colX[2] + 1.5), $this->mm($textY), ['baseline' => 'middle']);
        }

        // right-aligned numeric/text cells — same Helvetica-normal-7-DARK style as code/spec
        foreach ([[3, $r['moq']], [4, $r['listPrice']], [5, $r['disc']], [6, $r['netPrice']], [7, $r['totalRate']], [8, $r['deliv']]] as [$ci, $val]) {
            $this->pdf->text((string)$val, $this->mm($colX[$ci] + $col[$ci] - 1.5), $this->mm($textY), ['align' => 'right', 'baseline' => 'middle']);
        }

        $this->curY += $rh;
    }
}
