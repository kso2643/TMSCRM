<?php
/**
 * Faithful PHP port of `apj_downloadPDF()` from the standalone
 * quotation-creator-tms-apj-main/index.html tool — its jsPDF-based APJ
 * letterhead — so QuotationController::generatePdf() produces the exact
 * same visual document for APJ quotations, using SimplePdf (our
 * dependency-free PDF writer) in place of jsPDF.
 *
 * UNITS: the original works in millimetres (`new jsPDF('p','mm','a4')`);
 * SimplePdf works in PDF points. Every x/y/width/height/line-width number
 * below is kept in the SAME millimetre figures as the JS source (so this
 * file can be diffed against it almost line-for-line) and is only run
 * through mm() at the point it's handed to SimplePdf. Font sizes need no
 * conversion — jsPDF's setFontSize()/getTextWidth() are already in points
 * regardless of document unit, same convention SimplePdf already uses.
 *
 * Source reference: quotation-creator-tms-apj-main/index.html, function
 * apj_downloadPDF() (search that file for the exact original).
 */
class ApjQuotationPdf
{
    /** 1mm in PDF points (72pt / 25.4mm). */
    private const MM = 2.8346456693;

    // ---- brand palette — same RGB triples as the JS NAVY/TEAL/etc. constants ----
    private const NAVY          = '#0A1628'; // [10,22,40]
    private const TEAL          = '#00C9A7'; // [0,201,167]
    private const WHITE         = '#FFFFFF';
    private const DARK          = '#111827'; // [17,24,39]
    private const GREY          = '#64748B'; // [100,116,139]
    private const LIGHT_BG      = '#F0F9F6'; // [240,249,246] alt row tint
    private const BORDER        = '#E2E8F0'; // [226,232,240]
    private const CARD_BG       = '#F8FCFB'; // [248,252,251] header/TO/META/terms box fill
    private const NOTE_BG       = '#E8F8F4'; // [232,248,244] subject bar / S.No cell / thank-you note
    private const NOTE_TEXT     = '#1E503C'; // [30,80,60]
    private const FOOTER_CENTER = '#A0C8BE'; // [160,200,190]
    private const SIGN_NAME_CLR = '#A0D2C3'; // [160,210,195]

    private const A4_W = 210.0;
    private const A4_H = 297.0;
    private const ML = 10.0;
    private const MR = 10.0;
    private const MT = 10.0;
    private const MB = 10.0;

    private SimplePdf $pdf;
    private float $curY = 0;
    private float $cw = 0;      // content width = A4_W - ML - MR
    private float $bottom = 0;  // lowest y main content may reach before the footer reservation

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

    /** getTextWidth() equivalent, returned in the same "mm" space as everything else here. */
    private function textWidthMm(string $s): float
    {
        return $this->pdf->textWidth($s) / self::MM;
    }

    /** splitTextToSize() equivalent — $maxWidthMm is in mm, matching the JS call sites. */
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
     *  `'Rs. ' + Number(n).toLocaleString('en-IN',{minimumFractionDigits:2})`. */
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

    public function render(): SimplePdf
    {
        $this->pdf = new SimplePdf();
        $this->cw = self::A4_W - self::ML - self::MR;
        $this->bottom = self::A4_H - self::MB - 14; // reserve 14mm for the page footer
        $this->pdf->addPage($this->mm(self::A4_W), $this->mm(self::A4_H));
        $this->curY = self::MT + 4; // start below the top accent bar

        // ── collect fields (mirrors the JS's const customer/addr/qno/... block) ──
        $customer = $this->orDash($this->q['toName'] ?? '', (string)($this->q['companyName'] ?? ''));
        $addr = array_values(array_filter([
            trim((string)($this->q['toAddr1'] ?? '')),
            trim((string)($this->q['toAddr2'] ?? '')),
            trim((string)($this->q['toState'] ?? '')),
        ], fn($v) => $v !== ''));
        $qno    = $this->orDash($this->q['quotationNumber'] ?? '');
        $qdate  = $this->fmtDate($this->q['quotationDate'] ?? null);
        $qdate1 = $this->fmtDate($this->q['enquiryDate'] ?? null);
        $attn   = $this->orDash($this->q['kindAttn'] ?? '');
        $desig  = $this->orDash($this->q['toDesignation'] ?? '');
        $enqRef = $this->orDash($this->q['enquiryRef'] ?? '');
        $subject = (string)($this->q['subject'] ?? '');
        $tax      = $this->orDash($this->q['salesTax'] ?? '');
        $payment  = $this->orDash($this->q['paymentTerms'] ?? '');
        $validity = $this->orDash($this->q['validity'] ?? '');
        $delivery = $this->orDash($this->q['deliveryCharges'] ?? '');
        $signCo    = (string)($this->q['signCompany'] ?? '');
        $signName  = (string)($this->q['signName'] ?? '');
        $signDesig = (string)($this->q['signDesignation'] ?? '');

        $grandTotalNum = (float)($this->q['totalAmount'] ?? 0);
        $grandTotal = $grandTotalNum ? $this->fmtMoney($grandTotalNum) : '-';

        // ================= PAGE 1 =================
        // ── HEADER: logo left + company info right ──
        $this->pdf->setFillColor(self::CARD_BG);
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm(26), $this->mm(2), $this->mm(2), 'F');

        $logoW = 28.0; $logoH = 28.0;
        $logoPath = __DIR__ . '/../assets/apj-logo.png';
        $embedded = $this->pdf->addImage($logoPath, $this->mm(self::ML + 3), $this->mm($this->curY + 3), $this->mm($logoW), $this->mm($logoH));
        if (!$embedded) {
            $this->pdf->setFont('Helvetica-Bold', 14);
            $this->pdf->setFillColor(self::TEAL);
            $this->pdf->text('APJ', $this->mm(self::ML + 4), $this->mm($this->curY + 14));
        }

        $hY = $this->curY + 4;
        $this->pdf->setFont('Helvetica-Bold', 9.5);
        $this->pdf->setFillColor(self::NAVY);
        $this->pdf->text('APJ Technologies Private Limited', $this->mm(self::A4_W - self::MR), $this->mm($hY), ['align' => 'right', 'baseline' => 'top']);
        $hY += 5.5;

        $this->pdf->setFont('Helvetica', 7);
        $this->pdf->setFillColor(self::GREY);
        $coInfo = [
            "No. 26/2, Kongu Maa Nagar, Villankurichi Road, Coimbatore \u{2013} 641 035",
            'Mobile: 6379510936  |  E-Mail: operations@apjtech.in  |  GST: 33ABECA9840L1Z',
        ];
        foreach ($coInfo as $l) {
            $this->pdf->text($l, $this->mm(self::A4_W - self::MR), $this->mm($hY), ['align' => 'right', 'baseline' => 'top']);
            $hY += 4;
        }

        // "QUOTATION" badge
        $badgeW = 30.0; $badgeX = self::A4_W - self::MR - $badgeW;
        $hY += 1;
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->roundedRect($this->mm($badgeX), $this->mm($hY), $this->mm($badgeW), $this->mm(6), $this->mm(1), $this->mm(1), 'F');
        $this->pdf->setFont('Helvetica-Bold', 7);
        $this->pdf->setFillColor(self::WHITE);
        $this->pdf->text('QUOTATION', $this->mm($badgeX + $badgeW / 2), $this->mm($hY + 3.5), ['align' => 'center', 'baseline' => 'middle']);

        $this->curY += 30;

        // teal + navy divider
        $this->pdf->setDrawColor(self::TEAL);
        $this->pdf->line($this->mm(self::ML), $this->mm($this->curY), $this->mm(self::A4_W - self::MR), $this->mm($this->curY), self::TEAL, $this->mm(0.8));
        $this->pdf->setDrawColor(self::NAVY);
        $this->pdf->line($this->mm(self::ML), $this->mm($this->curY + 1), $this->mm(self::A4_W - self::MR), $this->mm($this->curY + 1), self::NAVY, $this->mm(0.3));
        $this->curY += 5;

        // ── TO BOX + META BOX ──
        $boxH = 38.0;
        $toW = $this->cw * 0.52;
        $metaW = $this->cw - $toW - 4;
        $metaX = self::ML + $toW + 4;

        // To box
        $this->pdf->setFillColor(self::CARD_BG);
        $this->pdf->setDrawColor(self::BORDER);
        $this->pdf->setLineWidth($this->mm(0.25));
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm($toW), $this->mm($boxH), $this->mm(2), $this->mm(2), 'FD');

        // teal left accent stripe
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm(2.5), $this->mm($boxH), $this->mm(1), $this->mm(1), 'F');

        $this->pdf->setFont('Helvetica-Bold', 6);
        $this->pdf->setFillColor(self::TEAL);
        $toLabel = 'TO';
        $this->pdf->text($toLabel, $this->mm(self::ML + 5), $this->mm($this->curY + 4.5), ['baseline' => 'middle']);

        $toLabelW = $this->textWidthMm($toLabel);
        $this->pdf->setDrawColor(self::TEAL);
        $this->pdf->line($this->mm(self::ML + 5), $this->mm($this->curY + 5.5), $this->mm(self::ML + 5 + $toLabelW), $this->mm($this->curY + 5.5), self::TEAL, $this->mm(0.3));

        $this->pdf->setFont('Helvetica-Bold', 9);
        $this->pdf->setFillColor(self::NAVY);
        $custLines = $this->splitToSize($customer, $toW - 10);
        foreach ($custLines as $ci => $cl) {
            $this->pdf->text($cl, $this->mm(self::ML + 5), $this->mm($this->curY + 10 + $ci * 5), ['baseline' => 'top']);
        }
        $custBlockH = count($custLines) * 5;

        $this->pdf->setFont('Helvetica', 7.5);
        $this->pdf->setFillColor(self::GREY);
        $addrY = $this->curY + 10 + $custBlockH + 1;
        // Module 11 — same bug as the customer-name block above, just missed
        // here: each line drew with no width constraint, so a long address
        // line ran past the card's edge instead of wrapping. Fixed the same
        // way the customer name a few lines up already does it —
        // splitToSize() first, draw each resulting line, advance Y per line
        // (not per source line) so a wrapped line can't overlap the next.
        foreach ($addr as $l) {
            foreach ($this->splitToSize($l, $toW - 10) as $wrapped) {
                $this->pdf->text($wrapped, $this->mm(self::ML + 5), $this->mm($addrY), ['baseline' => 'top']);
                $addrY += 4;
            }
        }

        // Meta box
        $this->pdf->setFillColor(self::CARD_BG);
        $this->pdf->setDrawColor(self::BORDER);
        $this->pdf->setLineWidth($this->mm(0.25));
        $this->pdf->roundedRect($this->mm($metaX), $this->mm($this->curY), $this->mm($metaW), $this->mm($boxH), $this->mm(2), $this->mm(2), 'FD');

        $this->pdf->setFont('Helvetica-Bold', 6);
        $this->pdf->setFillColor(self::TEAL);
        $qiLabel = 'QUOTATION INFO';
        $this->pdf->text($qiLabel, $this->mm($metaX + 3), $this->mm($this->curY + 4.5), ['baseline' => 'middle']);
        $qiLabelW = $this->textWidthMm($qiLabel);
        $this->pdf->setDrawColor(self::TEAL);
        $this->pdf->line($this->mm($metaX + 3), $this->mm($this->curY + 5.5), $this->mm($metaX + 3 + $qiLabelW), $this->mm($this->curY + 5.5), self::TEAL, $this->mm(0.3));

        $metaRows = [
            ['Quotation No.', $qno],
            ['Date', $qdate],
            ['Enq. Date', $qdate1],
            ['Kind Attn', $attn],
            ['Designation', $desig],
            ['Enq. Ref.', $enqRef],
        ];
        $mY = $this->curY + 9;
        $keyX = $metaX + 3;
        $valX = $metaX + $metaW - 3;
        foreach ($metaRows as [$k, $val]) {
            $this->pdf->setFont('Helvetica', 7);
            $this->pdf->setFillColor(self::GREY);
            $this->pdf->text($k, $this->mm($keyX), $this->mm($mY), ['baseline' => 'top']);
            $this->pdf->setFont('Helvetica-Bold', 7);
            $this->pdf->setFillColor(self::DARK);
            $this->pdf->text($val, $this->mm($valX), $this->mm($mY), ['align' => 'right', 'baseline' => 'top']);
            $mY += 4.3;
        }

        $this->curY += $boxH + 5;

        // ── SUBJECT BAR ──
        $this->pdf->setFillColor(self::NOTE_BG);
        $this->pdf->setDrawColor(self::TEAL);
        $this->pdf->setLineWidth($this->mm(0.2));
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm(8), $this->mm(1.5), $this->mm(1.5), 'FD');
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm(3), $this->mm(8), $this->mm(1), $this->mm(1), 'F');
        $this->pdf->setFont('Helvetica-Bold', 8);
        $this->pdf->setFillColor(self::NAVY);
        $subjectLines = $this->splitToSize('Sub: ' . $subject, $this->cw - 12);
        $this->pdf->text($subjectLines[0] ?? '', $this->mm(self::ML + 6), $this->mm($this->curY + 4.5), ['baseline' => 'middle']);
        $this->curY += 11;

        // ================= TABLE =================
        $col = [8, 55, 37, 11, 20, 8, 18, 20, 13];
        $colX = [self::ML];
        for ($i = 1; $i < count($col); $i++) { $colX[] = $colX[$i - 1] + $col[$i - 1]; }
        $headH = 9.0; $rowH = 8.0;

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
                'moq' => $quantity ? $this->trimNumber($quantity) : '-',
                'listPrice' => $unitPrice ? $this->fmtMoney($unitPrice) : '-',
                'disc' => $discount ? $this->trimNumber($discount) . '%' : '-',
                'netPrice' => $netPrice ? $this->fmtMoney($netPrice) : '-',
                'totalRate' => $totalPrice ? $this->fmtMoney($totalPrice) : '-',
                'deliv' => $this->orDash($item['delivery'] ?? ''),
            ];
        }
        foreach ($pdfRows as $idx => $r) {
            $this->drawRow($r, $idx, $col, $colX, $headH, $rowH);
        }

        // ── GRAND TOTAL ROW ──
        $this->ensureSpace(10, $col, $colX, $headH);
        $this->pdf->setFillColor(self::NAVY);
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm(10), $this->mm(1.5), $this->mm(1.5), 'F');
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm(3), $this->mm(10), $this->mm(1), $this->mm(1), 'F');
        $this->pdf->setFont('Helvetica-Bold', 8);
        $this->pdf->setFillColor(self::WHITE);
        $this->pdf->text('GRAND TOTAL', $this->mm(self::ML + 7), $this->mm($this->curY + 5), ['baseline' => 'middle']);

        $totalMoq = 0.0;
        foreach ($this->items as $item) { $totalMoq += (float)($item['quantity'] ?? 0); }
        $this->pdf->setFont('Helvetica-Bold', 7.5);
        $this->pdf->setFillColor(self::WHITE);
        $this->pdf->text('TOTAL MOQ: ' . ($totalMoq ? $this->trimNumber($totalMoq) : '0'), $this->mm(self::ML + 75), $this->mm($this->curY + 5), ['baseline' => 'middle']);

        $gtBoxX = self::A4_W - self::MR - 50;
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->roundedRect($this->mm($gtBoxX), $this->mm($this->curY + 1.5), $this->mm(48), $this->mm(7), $this->mm(1), $this->mm(1), 'F');
        $this->pdf->setFont('Helvetica-Bold', 9);
        $this->pdf->setFillColor(self::NAVY);
        $this->pdf->text($grandTotal, $this->mm(self::A4_W - self::MR - 4), $this->mm($this->curY + 5), ['align' => 'right', 'baseline' => 'middle']);
        $this->curY += 13;

        // ================= FOOTER SECTION (Terms + Signature) =================
        $termsH = 32.0; $signW = 60.0; $termsW = $this->cw - $signW - 4; $noteH = 8.0;
        $footerAnchor = $this->bottom - $termsH - $noteH - 5;
        if ($this->curY > $footerAnchor) $this->newPage();
        $this->curY += 5;

        // Thank-you note
        $this->pdf->setFillColor(self::NOTE_BG);
        $this->pdf->setDrawColor(self::TEAL);
        $this->pdf->setLineWidth($this->mm(0.15));
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm($noteH), $this->mm(1.5), $this->mm(1.5), 'FD');
        $this->pdf->setFont('Helvetica-Oblique', 7.5);
        $this->pdf->setFillColor(self::NOTE_TEXT);
        $this->pdf->text(
            'Thank you for your enquiry. We look forward to doing business with you.',
            $this->mm(self::A4_W / 2), $this->mm($this->curY + $noteH / 2), ['align' => 'center', 'baseline' => 'middle']
        );
        $this->curY += $noteH + 4;

        // Terms box
        $this->pdf->setFillColor(self::CARD_BG);
        $this->pdf->setDrawColor(self::BORDER);
        $this->pdf->setLineWidth($this->mm(0.25));
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm($termsW), $this->mm($termsH), $this->mm(2), $this->mm(2), 'FD');
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm(2.5), $this->mm($termsH), $this->mm(1), $this->mm(1), 'F');

        $this->pdf->setFont('Helvetica-Bold', 7.5);
        $this->pdf->setFillColor(self::NAVY);
        $this->pdf->text('Terms of Supply', $this->mm(self::ML + 5), $this->mm($this->curY + 5.5), ['baseline' => 'top']);
        $termsLabelW = $this->textWidthMm('Terms of Supply');
        $this->pdf->setDrawColor(self::TEAL);
        $this->pdf->line($this->mm(self::ML + 5), $this->mm($this->curY + 8), $this->mm(self::ML + 5 + $termsLabelW), $this->mm($this->curY + 8), self::TEAL, $this->mm(0.3));

        $termRows = [['Sales Tax', $tax], ['Payment', $payment], ['Validity', $validity], ['Delivery Charges', $delivery]];
        $tY = $this->curY + 11;
        foreach ($termRows as [$k, $val]) {
            $this->pdf->setFont('Helvetica', 7);
            $this->pdf->setFillColor(self::GREY);
            $this->pdf->text($k . ':', $this->mm(self::ML + 5), $this->mm($tY), ['baseline' => 'top']);
            $this->pdf->setFont('Helvetica-Bold', 7);
            $this->pdf->setFillColor(self::DARK);
            $this->pdf->text($val, $this->mm(self::ML + 5 + 44), $this->mm($tY), ['baseline' => 'top']);
            $tY += 5;
        }

        // Signature box
        $sigX = self::ML + $termsW + 4;
        $this->pdf->setFillColor(self::NAVY);
        $this->pdf->roundedRect($this->mm($sigX), $this->mm($this->curY), $this->mm($signW), $this->mm($termsH), $this->mm(2), $this->mm(2), 'F');
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->roundedRect($this->mm($sigX), $this->mm($this->curY), $this->mm($signW), $this->mm(3), $this->mm(1), $this->mm(1), 'F');
        $this->pdf->rect($this->mm($sigX), $this->mm($this->curY + 1.5), $this->mm($signW), $this->mm(1.5), self::TEAL); // flatten bottom half

        $this->pdf->setFont('Helvetica-Bold', 7);
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->text('Authorised Signatory', $this->mm($sigX + $signW / 2), $this->mm($this->curY + 7), ['align' => 'center', 'baseline' => 'top']);

        $sigLineY = $this->curY + $termsH - 13;
        $this->pdf->setDrawColor(self::TEAL);
        $this->pdf->line($this->mm($sigX + 6), $this->mm($sigLineY), $this->mm($sigX + $signW - 6), $this->mm($sigLineY), self::TEAL, $this->mm(0.3), [$this->mm(1), $this->mm(1.2)]);

        $this->pdf->setFont('Helvetica-Bold', 7.5);
        $this->pdf->setFillColor(self::WHITE);
        $this->pdf->text('For ' . $signCo, $this->mm($sigX + $signW / 2), $this->mm($sigLineY + 3), ['align' => 'center', 'baseline' => 'top']);
        $this->pdf->setFont('Helvetica', 7);
        $this->pdf->setFillColor(self::SIGN_NAME_CLR);
        $this->pdf->text($signName, $this->mm($sigX + $signW / 2), $this->mm($sigLineY + 6.5), ['align' => 'center', 'baseline' => 'top']);
        $this->pdf->setFillColor(self::WHITE);
        $this->pdf->text($signDesig, $this->mm($sigX + $signW / 2), $this->mm($sigLineY + 10), ['align' => 'center', 'baseline' => 'top']);

        // ── apply page chrome to every page, now that the final count is known ──
        $totalPages = $this->pdf->pageCount();
        for ($p = 0; $p < $totalPages; $p++) {
            $this->pdf->setActivePage($p);
            $this->drawPageChrome($p + 1, $totalPages);
        }

        return $this->pdf;
    }

    private function newPage(): void
    {
        $this->pdf->addPage($this->mm(self::A4_W), $this->mm(self::A4_H));
        $this->curY = self::MT + 4;
    }

    private function ensureSpace(float $need, array $col, array $colX, float $headH): void
    {
        if ($this->curY + $need > $this->bottom) $this->newPage();
    }

    private function drawPageChrome(int $pageNum, int $totalPages): void
    {
        // top accent bar
        $this->pdf->rect(0, 0, $this->mm(self::A4_W), $this->mm(3), self::NAVY);
        $this->pdf->rect(0, 0, $this->mm(40), $this->mm(3), self::TEAL);

        // bottom page-footer bar
        $fy = self::A4_H - 10;
        $this->pdf->rect(0, $this->mm($fy), $this->mm(self::A4_W), $this->mm(10), self::NAVY);

        $this->pdf->setFont('Helvetica-Bold', 6.5);
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->text('APJ Technologies Private Limited', $this->mm(self::ML), $this->mm($fy + 4), ['baseline' => 'middle']);

        $this->pdf->setFont('Helvetica', 6);
        $this->pdf->setFillColor(self::FOOTER_CENTER);
        $this->pdf->text('Confidential - For Recipient Use Only', $this->mm(self::A4_W / 2), $this->mm($fy + 4), ['align' => 'center', 'baseline' => 'middle']);

        $this->pdf->setFont('Helvetica-Bold', 6.5);
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->text("Page $pageNum of $totalPages", $this->mm(self::A4_W - self::MR), $this->mm($fy + 4), ['align' => 'right', 'baseline' => 'middle']);

        $this->pdf->line($this->mm(self::ML), $this->mm($fy - 0.5), $this->mm(self::A4_W - self::MR), $this->mm($fy - 0.5), self::TEAL, $this->mm(0.3));
    }

    private function drawTableHeader(array $col, array $colX, float $headH): void
    {
        $this->pdf->setFillColor(self::NAVY);
        $this->pdf->roundedRect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm($headH), $this->mm(1.5), $this->mm(1.5), 'F');
        // flat bottom so rows connect cleanly
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->curY + $headH / 2), $this->mm($this->cw), $this->mm($headH / 2), self::NAVY);

        $hdrs = ['#', 'Product Code', 'Item Specification', 'MOQ', 'List Price', 'Disc %', 'Net Price', 'Total Rate', 'Delivery'];
        $this->pdf->setFont('Helvetica-Bold', 6.5);
        $this->pdf->setFillColor(self::WHITE);
        foreach ($hdrs as $i => $h) {
            $this->pdf->text($h, $this->mm($colX[$i] + $col[$i] / 2), $this->mm($this->curY + $headH / 2), ['align' => 'center', 'baseline' => 'middle']);
            if ($i > 0) {
                // Original is 15%-opacity white over the navy header. SimplePdf has no true alpha
                // compositing, so this is the analytically-blended solid equivalent
                // (navy*0.85 + white*0.15 ≈ #2F3948) rather than pure white, which would look
                // far too bright/prominent against the navy background.
                $this->pdf->line(
                    $this->mm($colX[$i]), $this->mm($this->curY + 1.5),
                    $this->mm($colX[$i]), $this->mm($this->curY + $headH - 1.5),
                    '#2F3948', $this->mm(0.1)
                );
            }
        }
        $this->curY += $headH;
    }

    private function drawRow(array $r, int $idx, array $col, array $colX, float $headH, float $rowH): void
    {
        $specLines = $this->splitToSize($r['spec'], $col[2] - 3);
        $codeLines = $this->splitToSize($r['code'], $col[1] - 3);
        $lineCount = max(count($specLines), count($codeLines), 1);
        $rh = max($rowH, $lineCount * 3.8 + 3);

        if ($this->curY + $rh > $this->bottom) {
            $this->newPage();
            $this->drawTableHeader($col, $colX, $headH);
        }

        if ($idx % 2 === 1) {
            $this->pdf->rect($this->mm(self::ML), $this->mm($this->curY), $this->mm($this->cw), $this->mm($rh), self::LIGHT_BG);
        }

        // row border — four plain lines (equivalent to the JS's un-styled pdf.rect(), which
        // strokes rather than fills since no fill color was set for this call)
        $rowTop = $this->curY; $rowBottom = $this->curY + $rh;
        $rowRight = self::ML + $this->cw;
        $this->pdf->line($this->mm(self::ML), $this->mm($rowTop), $this->mm($rowRight), $this->mm($rowTop), self::BORDER, $this->mm(0.2));
        $this->pdf->line($this->mm(self::ML), $this->mm($rowBottom), $this->mm($rowRight), $this->mm($rowBottom), self::BORDER, $this->mm(0.2));
        $this->pdf->line($this->mm(self::ML), $this->mm($rowTop), $this->mm(self::ML), $this->mm($rowBottom), self::BORDER, $this->mm(0.2));
        $this->pdf->line($this->mm($rowRight), $this->mm($rowTop), $this->mm($rowRight), $this->mm($rowBottom), self::BORDER, $this->mm(0.2));

        foreach ($colX as $i => $x) {
            if ($i > 0) {
                $this->pdf->line($this->mm($x), $this->mm($this->curY), $this->mm($x), $this->mm($this->curY + $rh), self::BORDER, $this->mm(0.15));
            }
        }

        $textY = $this->curY + $rh / 2;

        // S.No — teal bold, on its own tinted cell
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->curY), $this->mm($col[0]), $this->mm($rh), self::NOTE_BG);
        $this->pdf->setFont('Helvetica-Bold', 7.5);
        $this->pdf->setFillColor(self::TEAL);
        $this->pdf->text($r['sno'], $this->mm($colX[0] + $col[0] / 2), $this->mm($textY), ['align' => 'center', 'baseline' => 'middle']);

        // code
        $this->pdf->setFont('Helvetica', 7);
        $this->pdf->setFillColor(self::DARK);
        if (count($codeLines) > 1) {
            $sy = $this->curY + ($rh - (count($codeLines) - 1) * 3.8) / 2;
            foreach ($codeLines as $li => $l) {
                $this->pdf->text($l, $this->mm($colX[1] + 1.5), $this->mm($sy + $li * 3.8), ['baseline' => 'middle']);
            }
        } else {
            $this->pdf->text($r['code'], $this->mm($colX[1] + 1.5), $this->mm($textY), ['baseline' => 'middle']);
        }

        // spec
        if (count($specLines) > 1) {
            $sy = $this->curY + ($rh - (count($specLines) - 1) * 3.8) / 2;
            foreach ($specLines as $li => $l) {
                $this->pdf->text($l, $this->mm($colX[2] + 1.5), $this->mm($sy + $li * 3.8), ['baseline' => 'middle']);
            }
        } else {
            $this->pdf->text($r['spec'], $this->mm($colX[2] + 1.5), $this->mm($textY), ['baseline' => 'middle']);
        }

        // numeric cols — right-aligned
        foreach ([[3, $r['moq']], [4, $r['listPrice']], [5, $r['disc']], [6, $r['netPrice']], [7, $r['totalRate']]] as [$ci, $val]) {
            $this->pdf->setFont('Helvetica', 6.5);
            $this->pdf->setFillColor(self::DARK);
            $this->pdf->text((string)$val, $this->mm($colX[$ci] + $col[$ci] - 1.5), $this->mm($textY), ['align' => 'right', 'baseline' => 'middle']);
        }

        // delivery — center aligned, small font, wraps if needed
        $this->pdf->setFont('Helvetica', 6);
        $this->pdf->setFillColor(self::DARK);
        $delivLines = $this->splitToSize((string)$r['deliv'], $col[8] - 1);
        if (count($delivLines) > 1) {
            $dsy = $this->curY + ($rh - (count($delivLines) - 1) * 3.5) / 2;
            foreach ($delivLines as $li => $l) {
                $this->pdf->text($l, $this->mm($colX[8] + $col[8] / 2), $this->mm($dsy + $li * 3.5), ['align' => 'center', 'baseline' => 'middle']);
            }
        } else {
            $this->pdf->text((string)$r['deliv'], $this->mm($colX[8] + $col[8] / 2), $this->mm($textY), ['align' => 'center', 'baseline' => 'middle']);
        }

        $this->curY += $rh;
    }
}
