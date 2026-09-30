<?php
/**
 * Shared single-employee formatted PDF — letterhead, "Label: Value" detail
 * blocks, a simple table, a highlighted summary box, remarks, and a
 * signature/seal area. Used for:
 *   - Module 3's "Employee Advance PDF" (SalaryAdvanceController::exportPdf)
 *   - Module 8's Employee Ledger export (EmployeeLedgerController::exportPdf)
 *
 * These are one-employee formatted documents, not multi-row tabular
 * reports, so they don't go through ExportController's generic exporter —
 * this builds the richer single-record layout the spec describes.
 *
 * No logo image is wired up — there's no logo file anywhere in this
 * project. If you have one, add near the top of the constructor:
 *   $this->pdf->addImage('/path/to/logo.png', $m, 10, 40, 40);
 * and shift the company name/address text right to make room for it.
 */
class EmployeeDocumentPdf
{
    private SimplePdf $pdf;
    private float $margin = 40;
    private float $y;
    private float $pageW;
    private float $pageH;

    public function __construct(private string $title)
    {
        $this->pageW = SimplePdf::A4_WIDTH;
        $this->pageH = SimplePdf::A4_HEIGHT;
        $this->pdf = new SimplePdf();
        $this->pdf->addPage($this->pageW, $this->pageH);
        $this->drawLetterhead();
    }

    private function drawLetterhead(): void
    {
        $m = $this->margin;
        $this->pdf->setFont('Helvetica-Bold', 14); $this->pdf->setFillColor('#1E3A5F');
        $this->pdf->text(COMPANY_NAME, $m, 30);
        $this->pdf->setFont('Helvetica', 9); $this->pdf->setFillColor('#6B7280');
        $this->pdf->text(COMPANY_ADDRESS, $m, 48);
        $this->pdf->line($m, 62, $this->pageW - $m, 62, '#E5E7EB', 1);

        $this->pdf->setFont('Helvetica-Bold', 16); $this->pdf->setFillColor('#111827');
        $this->pdf->text($this->title, $m, 84);
        $this->pdf->setFont('Helvetica', 8); $this->pdf->setFillColor('#9CA3AF');
        $this->pdf->text('Generated ' . date('d/m/Y H:i'), $this->pageW - $m, 84, ['align' => 'right']);

        $this->y = 108;
    }

    private function ensureSpace(float $needed): void
    {
        if ($this->y + $needed > $this->pageH - 90) {
            $this->pdf->addPage($this->pageW, $this->pageH);
            $this->y = $this->margin;
        }
    }

    /** A "Label: Value" two-column details block — Employee Details / Advance Details / etc. */
    public function detailsBlock(string $heading, array $pairs): void
    {
        $this->ensureSpace(24 + (int) ceil(count($pairs) / 2) * 16);
        $m = $this->margin;
        $this->pdf->setFont('Helvetica-Bold', 11); $this->pdf->setFillColor('#1E3A5F');
        $this->pdf->text($heading, $m, $this->y);
        $this->y += 18;

        $colW = ($this->pageW - 2 * $m) / 2;
        $i = 0;
        foreach ($pairs as $label => $value) {
            $col = $i % 2; $row = intdiv($i, 2);
            $x = $m + $col * $colW;
            $rowY = $this->y + $row * 16;
            $this->pdf->setFont('Helvetica', 9); $this->pdf->setFillColor('#6B7280');
            $this->pdf->text($label . ':', $x, $rowY, ['width' => 90]);
            $this->pdf->setFillColor('#111827');
            $this->pdf->text((string) ($value ?? '—'), $x + 92, $rowY, ['width' => $colW - 96]);
            $i++;
        }
        $this->y += (int) ceil(count($pairs) / 2) * 16 + 14;
    }

    /** A simple table — used for recovery/payroll history rows. $columns is a flat label list. */
    public function table(array $columns, array $rows): void
    {
        $m = $this->margin; $contentW = $this->pageW - 2 * $m;
        $colW = $contentW / count($columns); $rowH = 16;

        $this->ensureSpace($rowH * 2);
        $this->pdf->rect($m, $this->y, $contentW, $rowH, '#1E3A5F');
        $this->pdf->setFont('Helvetica-Bold', 8); $this->pdf->setFillColor('#FFFFFF');
        foreach ($columns as $i => $label) {
            $this->pdf->text($label, $m + $i * $colW + 4, $this->y + 4, ['width' => $colW - 8]);
        }
        $this->y += $rowH;

        foreach ($rows as $idx => $row) {
            $this->ensureSpace($rowH);
            if ($idx % 2 === 0) $this->pdf->rect($m, $this->y - 1, $contentW, $rowH, '#F8FAFC');
            $this->pdf->setFont('Helvetica', 8); $this->pdf->setFillColor('#374151');
            foreach ($row as $i => $val) {
                $this->pdf->text((string) $val, $m + $i * $colW + 4, $this->y + 2, ['width' => $colW - 8]);
            }
            $this->y += $rowH;
        }
        $this->y += 10;
    }

    /** A highlighted callout box — Remaining Balance / Expected Closing Date, etc. */
    public function summaryBox(array $pairs): void
    {
        $m = $this->margin; $contentW = $this->pageW - 2 * $m;
        $h = 16 + count($pairs) * 16;
        $this->ensureSpace($h + 10);

        $this->pdf->setFillColor('#EEF2FF');
        $this->pdf->roundedRect($m, $this->y, $contentW, $h, 4, 4, 'F');

        $localY = $this->y + 16;
        foreach ($pairs as $label => $value) {
            $this->pdf->setFont('Helvetica', 9); $this->pdf->setFillColor('#374151');
            $this->pdf->text($label, $m + 12, $localY);
            $this->pdf->setFont('Helvetica-Bold', 11); $this->pdf->setFillColor('#1E3A5F');
            $this->pdf->text((string) $value, $this->pageW - $m - 12, $localY, ['align' => 'right']);
            $localY += 16;
        }
        $this->y += $h + 14;
    }

    public function remarks(?string $text): void
    {
        if (!$text) return;
        $this->ensureSpace(40);
        $m = $this->margin;
        $this->pdf->setFont('Helvetica-Bold', 10); $this->pdf->setFillColor('#1E3A5F');
        $this->pdf->text('Remarks', $m, $this->y);
        $this->y += 14;
        $this->pdf->setFont('Helvetica', 9); $this->pdf->setFillColor('#374151');
        foreach ($this->pdf->splitTextToSize($text, $this->pageW - 2 * $m) as $line) {
            $this->ensureSpace(13);
            $this->pdf->text($line, $m, $this->y);
            $this->y += 13;
        }
        $this->y += 8;
    }

    /** Company Seal Space + Signature Space — two boxed areas near the bottom of the current page. */
    public function signatureAndSeal(): void
    {
        $m = $this->margin;
        $w = (($this->pageW - 2 * $m) - 20) / 2;
        $lineY = $this->pageH - 80;

        if ($this->y > $lineY - 20) {
            $this->pdf->addPage($this->pageW, $this->pageH);
            $this->y = $this->margin;
        }

        $this->pdf->line($m, $lineY, $m + $w, $lineY, '#9CA3AF');
        $this->pdf->setFont('Helvetica', 8); $this->pdf->setFillColor('#6B7280');
        $this->pdf->text('Company Seal', $m, $lineY + 8);

        $x2 = $m + $w + 20;
        $this->pdf->line($x2, $lineY, $x2 + $w, $lineY, '#9CA3AF');
        $this->pdf->text('Authorized Signature', $x2, $lineY + 8);
    }

    /** Finalizes footer + page numbers on every page (two-pass, now that the page count is known) and returns the PDF bytes. */
    public function output(): string
    {
        $total = $this->pdf->pageCount();
        for ($i = 0; $i < $total; $i++) {
            $this->pdf->setActivePage($i);
            $this->pdf->setFont('Helvetica', 7.5); $this->pdf->setFillColor('#9CA3AF');
            $this->pdf->text(COMPANY_NAME . ' — Confidential', $this->margin, $this->pageH - 20);
            $this->pdf->text('Page ' . ($i + 1) . ' of ' . $total, $this->pageW - $this->margin, $this->pageH - 20, ['align' => 'right']);
        }
        return $this->pdf->output();
    }
}
