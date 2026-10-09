<?php
/**
 * Mirrors backend/src/controllers/export.controller.js — supports the
 * same three formats (csv, xlsx, pdf) and identical column definitions
 * for all eight entity exports.
 */
class ExportController
{
    /** Extra Excel sheets a report adds before sendExport(): [['name'=>, 'header'=>[..], 'rows'=>[[..]], 'widths'=>[..]?], …] */
    protected array $extraSheets = [];

    /** "2025-07-01" stamp for filenames, matching JS filenameStamp(). */
    protected function stamp(): string { return date('Y-m-d'); }

    /** Parses ?from and ?to query params, returns [whereSql, params] fragments ready to append. */
    protected function dateRange(string $col): array
    {
        $from = qp('from'); $to = qp('to');
        $clauses = []; $params = [];
        if ($from) { $clauses[] = "$col >= ?"; $params[] = (new DateTime($from))->format('Y-m-d 00:00:00'); }
        if ($to)   {
            $end = new DateTime($to); $end->modify('+1 day');
            $clauses[] = "$col < ?"; $params[] = $end->format('Y-m-d 00:00:00');
        }
        return [$clauses, $params];
    }

    // ── Shared renderers ─────────────────────────────────────────────

    protected function toCSV(array $rows, array $columns): string
    {
        $esc = fn($v) => preg_match('/[",\r\n]/', (string)$v)
            ? '"' . str_replace('"', '""', (string)$v) . '"'
            : (string)$v;

        $header = implode(',', array_map(fn($c) => $esc($c['label']), $columns));
        $lines  = array_map(fn($r) => implode(',', array_map(fn($c) => $esc(($c['value'])($r)), $columns)), $rows);
        return implode("\r\n", array_merge([$header], $lines));
    }

    /**
     * Detailed Excel: the full register (styled header, real numbers, wrap,
     * frozen header, filter), a Summary sheet (counts by status / person /
     * type… and totals of the number columns) and any extra sheets the
     * report added (line items, week-wise, per person…).
     */
    protected function toXlsx(array $rows, array $columns, string $sheetName): string
    {
        $wb = new StyledXlsxWriter();
        $labels = array_column($columns, 'label');
        $numCol = fn($l) => (bool) preg_match('/(qty|quantity|amount|price|hours|km|kilomet|savings|count|items|pings|days|minutes|total|rate|discount|stock|%)/i', $l)
                            && !preg_match('/(status|date|note|by|name|code|no\.?$|items$)/i', $l);
        $vals = [];
        foreach ($rows as $r) $vals[] = array_map(fn($c) => ($c['value'])($r), $columns);

        $sh = $wb->addSheet($sheetName);
        $widths = [];
        foreach ($labels as $i => $l) {
            $mx = mb_strlen($l);
            foreach (array_slice($vals, 0, 400) as $v) $mx = max($mx, min(60, mb_strlen((string) ($v[$i] ?? ''))));
            $widths[] = max(9, min(48, $mx + 2));
        }
        $wb->setWidths($sh, $widths);
        $period = (qp('from') || qp('to')) ? 'Period: ' . (qp('from') ? date('d-m-Y', strtotime(qp('from'))) : 'start') . ' to ' . (qp('to') ? date('d-m-Y', strtotime(qp('to'))) : 'today') : 'Period: all time';
        $wb->addRow($sh, [$sheetName], 'title');
        $wb->addRow($sh, [$period . ' · ' . count($rows) . ' records · generated ' . date('d-m-Y h:i A')], 'subtitle');
        $wb->addRow($sh, $labels, 'header', 30);
        $isNum = array_map($numCol, $labels);
        foreach ($vals as $v) {
            $cells = [];
            foreach ($v as $i => $x) {
                $plain = is_string($x) ? str_replace(',', '', trim($x)) : $x;
                if ($isNum[$i] && $plain !== '' && $plain !== null && is_numeric($plain)) $cells[] = ['v' => (float) $plain, 's' => 'num'];
                else $cells[] = ['v' => (string) ($x ?? ''), 's' => mb_strlen((string) $x) > 50 ? 'wrap' : 'default'];
            }
            $wb->addRow($sh, $cells);
        }
        if ($rows) {
            $tot = ['Total'];
            $any = false;
            foreach ($labels as $i => $l) {
                if ($i === 0) continue;
                if ($isNum[$i]) { $any = true; $c = StyledXlsxWriter::col($i); $tot[] = ['f' => "SUBTOTAL(9,{$c}4:{$c}" . (count($rows) + 3) . ')', 's' => 'total']; }
                else $tot[] = ['v' => '', 's' => 'totallbl'];
            }
            if ($any) $wb->addRow($sh, $tot, 'totallbl');
        }
        $wb->freeze($sh, 3);
        $wb->autoFilter($sh, 'A3:' . StyledXlsxWriter::col(count($labels) - 1) . '3');

        // Summary — counts for the grouping columns, totals for the number columns
        $groupCol = fn($l) => (bool) preg_match('/(status|type|engineer|employee|assigned to|requested by|sales rep|by$|customer|company|category|brand|priority|delivery|procurement|department|role|approval|leave|reason type|result|place|location|supplier|vendor)/i', $l)
                              && !preg_match('/(date|note|time|at$|reason$|address|phone|email)/i', $l);
        $sm = $wb->addSheet('Summary');
        $wb->setWidths($sm, [34, 12, 10]);
        $wb->addRow($sm, [$sheetName . ' — summary'], 'title');
        $wb->addRow($sm, [$period . ' · ' . count($rows) . ' records'], 'subtitle');
        foreach ($labels as $i => $l) {
            if (!$groupCol($l)) continue;
            $cnt = [];
            foreach ($vals as $v) { $k = trim((string) ($v[$i] ?? '')); $k = $k === '' ? '(blank)' : $k; $cnt[$k] = ($cnt[$k] ?? 0) + 1; }
            if (count($cnt) < 1 || count($cnt) > 80) continue;
            arsort($cnt);
            $wb->addRow($sm, ['']);
            $wb->addRow($sm, ['By ' . strtolower($l), 'Count', '%'], 'header');
            foreach ($cnt as $k => $n) $wb->addRow($sm, [$k, $n, round($n * 100 / max(1, count($rows)), 1)]);
        }
        $numTotals = [];
        foreach ($labels as $i => $l) if ($isNum[$i]) {
            $sum = 0; $n = 0;
            foreach ($vals as $v) { $x = str_replace(',', '', (string) ($v[$i] ?? '')); if ($x !== '' && is_numeric($x)) { $sum += (float) $x; $n++; } }
            if ($n) $numTotals[] = [$l, $sum, $n ? $sum / $n : 0];
        }
        if ($numTotals) {
            $wb->addRow($sm, ['']);
            $wb->addRow($sm, ['Totals', 'Sum', 'Average'], 'header');
            foreach ($numTotals as [$l, $sum, $avg]) $wb->addRow($sm, [$l, ['v' => round($sum, 2), 's' => 'num'], ['v' => round($avg, 2), 's' => 'num']]);
        }

        foreach ($this->extraSheets as $x) {
            $es = $wb->addSheet($x['name']);
            $wb->setWidths($es, $x['widths'] ?? array_fill(0, count($x['header']), 16));
            if (!empty($x['title'])) $wb->addRow($es, [$x['title']], 'title');
            $wb->addRow($es, $x['header'], 'header', 28);
            foreach ($x['rows'] as $r) $wb->addRow($es, $r);
            $hr = empty($x['title']) ? 1 : 2;
            $wb->freeze($es, $hr);
            $wb->autoFilter($es, 'A' . $hr . ':' . StyledXlsxWriter::col(count($x['header']) - 1) . $hr);
        }
        return $wb->output();
    }

    protected function toPdf(array $rows, array $columns, string $title, string $filenameBase): void
    {
        $landscape = count($columns) > 5;
        if ($landscape) {
            $pageW = SimplePdf::A4_HEIGHT; $pageH = SimplePdf::A4_WIDTH; // swap for landscape
        } else {
            $pageW = SimplePdf::A4_WIDTH;  $pageH = SimplePdf::A4_HEIGHT;
        }
        $margin = 36;
        $contentW = $pageW - 2 * $margin;
        $colW = $contentW / count($columns);
        $rowH = 18;

        $pdf = new SimplePdf();
        $pdf->addPage($pageW, $pageH);

        $pdf->setFont('Helvetica-Bold', 15); $pdf->setFillColor('#1E3A5F');
        $pdf->text($title, $margin, 36);
        $pdf->setFont('Helvetica', 8); $pdf->setFillColor('#9CA3AF');
        $pdf->text('Generated ' . date('d/m/Y H:i') . ' · ' . count($rows) . ' records', $margin, 56);

        $y = 80;
        $maxY = $pageH - $margin - $rowH;

        $drawHeader = function() use ($pdf, $margin, $pageW, $rowH, $colW, $columns, &$y) {
            $pdf->rect($margin, $y, $pageW - 2*$margin, $rowH, '#1E3A5F');
            $pdf->setFont('Helvetica-Bold', 7.5); $pdf->setFillColor('#FFFFFF');
            foreach ($columns as $i => $c) {
                $pdf->text($c['label'], $margin + $i * $colW + 4, $y + 5, ['width' => $colW - 8]);
            }
            $y += $rowH;
        };
        $drawHeader();

        $pdf->setFont('Helvetica', 7.5); $pdf->setFillColor('#374151');
        foreach ($rows as $idx => $r) {
            if ($y > $maxY) {
                $pdf->addPage($pageW, $pageH);
                $y = 36;
                $drawHeader();
                $pdf->setFont('Helvetica', 7.5); $pdf->setFillColor('#374151');
            }
            if ($idx % 2 === 0) $pdf->rect($margin, $y - 2, $pageW - 2*$margin, $rowH, '#F8FAFC');
            $pdf->setFillColor('#374151');
            foreach ($columns as $i => $c) {
                $val = substr((string)(($c['value'])($r) ?? ''), 0, 40);
                $pdf->text($val, $margin + $i * $colW + 4, $y + 2, ['width' => $colW - 8]);
            }
            $y += $rowH;
        }

        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . $filenameBase . '.pdf"');
        echo $pdf->output();
        exit;
    }

    protected function sendExport(array $rows, array $columns, string $filenameBase, string $title): void
    {
        $fmt = strtolower(qp('format', 'csv'));
        if ($fmt === 'excel' || $fmt === 'xlsx') {
            header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            header('Content-Disposition: attachment; filename="' . $filenameBase . '.xlsx"');
            echo $this->toXlsx($rows, $columns, $title);
            exit;
        }
        if ($fmt === 'pdf') {
            $this->toPdf($rows, $columns, $title, $filenameBase);
            return; // toPdf exits itself
        }
        // default: csv
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="' . $filenameBase . '.csv"');
        echo $this->toCSV($rows, $columns);
        exit;
    }

    // ── Customers ────────────────────────────────────────────────────
    public function exportCustomers(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$clauses, $params] = $this->dateRange('c.createdAt');
        $w = $clauses ? 'AND ' . implode(' AND ', $clauses) : '';
        $s = db()->prepare(
            "SELECT c.*, u.name AS cb_name FROM Customer c LEFT JOIN User u ON u.id=c.createdById
             WHERE c.isActive=1 $w ORDER BY c.createdAt DESC"
        );
        $s->execute($params);
        $rows = $s->fetchAll();
        $fmt = fn($d) => $d ? (new DateTime($d))->format('d/m/Y') : '';
        $this->sendExport($rows, [
            ['label'=>'Company Name',  'value'=>fn($r)=>$r['companyName']],
            ['label'=>'Contact Person','value'=>fn($r)=>$r['contactPerson']],
            ['label'=>'Designation',   'value'=>fn($r)=>$r['designation']??''],
            ['label'=>'Phone',         'value'=>fn($r)=>$r['contactNumber']],
            ['label'=>'Email',         'value'=>fn($r)=>$r['email']??''],
            ['label'=>'Location',      'value'=>fn($r)=>$r['location']??''],
            ['label'=>'Category',      'value'=>fn($r)=>$r['category']??''],
            ['label'=>'Industry',      'value'=>fn($r)=>$r['industryType']??''],
            ['label'=>'Created By',    'value'=>fn($r)=>$r['cb_name']??''],
            ['label'=>'Created Date',  'value'=>fn($r)=>$fmt($r['createdAt'])],
        ], 'customers-' . $this->stamp(), 'Customer Report');
    }

    // ── Meetings ─────────────────────────────────────────────────────
    public function exportMeetings(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$clauses, $params] = $this->dateRange('m.meetingDate');
        $w = $clauses ? 'WHERE ' . implode(' AND ', $clauses) : '';
        $s = db()->prepare(
            "SELECT m.*, c.companyName, u.name AS u_name FROM Meeting m
             LEFT JOIN Customer c ON c.id=m.customerId
             LEFT JOIN User u ON u.id=m.userId
             $w ORDER BY m.meetingDate DESC"
        );
        $s->execute($params);
        $rows = $s->fetchAll();
        $fmt = fn($d) => $d ? (new DateTime($d))->format('d/m/Y') : '';
        $this->sendExport($rows, [
            ['label'=>'Customer',    'value'=>fn($r)=>$r['companyName']??''],
            ['label'=>'Sales Rep',   'value'=>fn($r)=>$r['u_name']??''],
            ['label'=>'Meeting Date','value'=>fn($r)=>$fmt($r['meetingDate'])],
            ['label'=>'Type',        'value'=>fn($r)=>$r['meetingType']],
            ['label'=>'Status',      'value'=>fn($r)=>$r['status']],
            ['label'=>'Notes',       'value'=>fn($r)=>$r['notes']??''],
            ['label'=>'Next Follow-Up','value'=>fn($r)=>$fmt($r['nextFollowUp'])],
            ['label'=>'Trial Status','value'=>fn($r)=>$r['trialStatus']??''],
        ], 'followups-' . $this->stamp(), 'Follow-Up Report');
    }

    // ── Quotations ────────────────────────────────────────────────────
    public function exportQuotations(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$clauses, $params] = $this->dateRange('q.createdAt');
        $w = $clauses ? 'WHERE ' . implode(' AND ', $clauses) : '';
        $s = db()->prepare(
            "SELECT q.*, c.companyName, u.name AS u_name,
                    (SELECT COUNT(*) FROM QuotationItem qi WHERE qi.quotationId=q.id) AS items_count
             FROM Quotation q
             LEFT JOIN Customer c ON c.id=q.customerId
             LEFT JOIN User u ON u.id=q.userId
             $w ORDER BY q.createdAt DESC"
        );
        $s->execute($params);
        $rows = $s->fetchAll();
        $fmt = fn($d) => $d ? (new DateTime($d))->format('d/m/Y') : '';
        if (in_array(strtolower(qp('format', 'csv')), ['excel', 'xlsx'], true)) {
            $ids = array_column($rows, 'id') ?: [''];
            $in = implode(',', array_fill(0, count($ids), '?'));
            $it = db()->prepare("SELECT qi.*, q.quotationNumber, q.createdAt AS qDate, c.companyName FROM QuotationItem qi JOIN Quotation q ON q.id=qi.quotationId
                                 LEFT JOIN Customer c ON c.id=q.customerId WHERE qi.quotationId IN ($in) ORDER BY q.createdAt DESC, qi.sortOrder, qi.createdAt");
            $it->execute($ids);
            $this->extraSheets[] = ['name' => 'Quotation items', 'title' => 'Every quoted item',
                'header' => ['Quotation No', 'Date', 'Customer', 'Item code', 'Product', 'Description', 'Category', 'Qty', 'Unit', 'Unit price', 'Discount %', 'Net price', 'Total', 'Delivery', 'HSN'],
                'widths' => [20, 11, 26, 18, 28, 34, 12, 8, 7, 11, 10, 11, 12, 14, 10],
                'rows' => array_map(fn($r) => [$r['quotationNumber'], $fmt($r['qDate']), $r['companyName'] ?? '', $r['itemCode'] ?? '', $r['productName'] ?? '', $r['description'] ?? '',
                    $r['category'] ?? '', (float) $r['quantity'], $r['unit'] ?? '', ['v' => (float) $r['unitPrice'], 's' => 'num'], (float) ($r['discount'] ?? 0),
                    ['v' => (float) ($r['netPrice'] ?? 0), 's' => 'num'], ['v' => (float) ($r['totalPrice'] ?? 0), 's' => 'num'], $r['delivery'] ?? '', $r['hsnCode'] ?? ''], $it->fetchAll())];
        }
        $this->sendExport($rows, [
            ['label'=>'Quotation No', 'value'=>fn($r)=>$r['quotationNumber']],
            ['label'=>'Company',      'value'=>fn($r)=>$r['company']??'TMS'],
            ['label'=>'Customer',     'value'=>fn($r)=>$r['companyName']??''],
            ['label'=>'Sales Rep',    'value'=>fn($r)=>$r['u_name']??''],
            ['label'=>'Items',        'value'=>fn($r)=>$r['items_count']],
            ['label'=>'Total Amount', 'value'=>fn($r)=>number_format((float)$r['totalAmount'],2,'.','')],
            ['label'=>'Status',       'value'=>fn($r)=>$r['status']],
            ['label'=>'Approval',     'value'=>fn($r)=>$r['approvalStatus']],
            ['label'=>'Date',         'value'=>fn($r)=>$fmt($r['createdAt'])],
        ], 'quotations-' . $this->stamp(), 'Quotation Report');
    }

    // ── Products ──────────────────────────────────────────────────────
    public function exportProducts(): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->query(
            'SELECT p.*, c.name AS cat_name FROM `Product` p LEFT JOIN `Category` c ON c.id=p.categoryId
             WHERE p.isActive=1 ORDER BY p.itemCode ASC'
        );
        $rows = $s->fetchAll();
        $stock = class_exists('OrderController') ? OrderController::stockFor(array_column($rows, 'itemCode')) : [];
        $this->sendExport($rows, [
            ['label'=>'Item Code',      'value'=>fn($r)=>$r['itemCode']],
            ['label'=>'Product Name',   'value'=>fn($r)=>$r['productName']],
            ['label'=>'Category',       'value'=>fn($r)=>$r['cat_name']??$r['category']??''],
            ['label'=>'Unit',           'value'=>fn($r)=>$r['unit']??''],
            ['label'=>'Standard Price', 'value'=>fn($r)=>number_format((float)$r['standardPrice'],2,'.','')],
            ['label'=>'HSN Code',       'value'=>fn($r)=>$r['hsnCode']??''],
            ['label'=>'Drawing No',     'value'=>fn($r)=>$r['drawingNumber']??''],
            ['label'=>'Brand',          'value'=>fn($r)=>$r['brand']??''],
            ['label'=>'Grade',          'value'=>fn($r)=>$r['grade']??''],
            ['label'=>'Specification',  'value'=>fn($r)=>$r['specification']??''],
            ['label'=>'Stock total qty','value'=>fn($r)=>isset($stock[strtoupper($r['itemCode'])]) ? qtyfmt($stock[strtoupper($r['itemCode'])]['total']) : ''],
            ['label'=>'Stock in hand qty','value'=>fn($r)=>isset($stock[strtoupper($r['itemCode'])]) ? qtyfmt($stock[strtoupper($r['itemCode'])]['hand']) : ''],
        ], 'products-' . $this->stamp(), 'Product Report');
    }

    // ── Attendance ────────────────────────────────────────────────────
    public function exportAttendance(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$clauses, $params] = $this->dateRange('a.date');
        $w = $clauses ? 'WHERE ' . implode(' AND ', $clauses) : '';
        $s = db()->prepare(
            "SELECT a.*, u.name AS u_name, u.department,
                    (SELECT COUNT(*) FROM LocationPing lp WHERE lp.attendanceId=a.id) AS pings_count
             FROM Attendance a LEFT JOIN User u ON u.id=a.userId
             $w ORDER BY a.date DESC"
        );
        $s->execute($params);
        $rows = $s->fetchAll();
        $fmtT = fn($d) => fmt_ampm($d);
        $fmtD = fn($d) => $d ? (new DateTime($d))->format('d/m/Y') : '';
        if (in_array(strtolower(qp('format', 'csv')), ['excel', 'xlsx'], true)) {
            $per = [];
            foreach ($rows as $r) {
                $k = $r['u_name'] ?? '—';
                $per[$k] = $per[$k] ?? [$k, $r['department'] ?? '', 0, 0, 0, 0, 0.0];
                $per[$k][2]++;
                if (!empty($r['lateMinutes'])) { $per[$k][3]++; $per[$k][4] += (int) $r['lateMinutes']; }
                if (!empty($r['lateRequestId'])) $per[$k][5]++;
                $per[$k][6] += (float) ($r['workingHours'] ?? 0);
            }
            ksort($per);
            $this->extraSheets[] = ['name' => 'Per employee', 'title' => 'Attendance per employee',
                'header' => ['Employee', 'Department', 'Days present', 'Late days', 'Late minutes', 'After 9:45 (approved)', 'Hours worked', 'Avg hours / day'],
                'widths' => [24, 16, 12, 10, 12, 18, 12, 14],
                'rows' => array_map(fn($x) => [$x[0], $x[1], $x[2], $x[3], $x[4], $x[5], round($x[6], 2), $x[2] ? round($x[6] / $x[2], 2) : 0], array_values($per))];
            try {
                [$c2, $p2] = $this->dateRange('r.date');
                $rq = db()->prepare('SELECT r.*, u.name, d.name AS dName FROM `PunchRequest` r LEFT JOIN `User` u ON u.id=r.userId LEFT JOIN `User` d ON d.id=r.decidedById'
                                    . ($c2 ? ' WHERE ' . implode(' AND ', $c2) : '') . ' ORDER BY r.date DESC');
                $rq->execute($p2);
                $this->extraSheets[] = ['name' => 'Late punch requests', 'header' => ['Date', 'Employee', 'Reason', 'Sent at', 'Status', 'Decided by', 'Note'], 'widths' => [11, 22, 40, 16, 11, 18, 30],
                    'rows' => array_map(fn($r) => [$fmtD($r['date']), $r['name'], $r['reason'], $fmtT($r['createdAt']), $r['status'], $r['dName'] ?? '', $r['adminNote'] ?? ''], $rq->fetchAll())];
            } catch (Throwable $e) { /* table not created yet */ }
        }
        $this->sendExport($rows, [
            ['label'=>'Employee',       'value'=>fn($r)=>$r['u_name']??''],
            ['label'=>'Department',     'value'=>fn($r)=>$r['department']??''],
            ['label'=>'Date',           'value'=>fn($r)=>$fmtD($r['date'])],
            ['label'=>'Check In',       'value'=>fn($r)=>$fmtT($r['checkIn'])],
            ['label'=>'Check Out',      'value'=>fn($r)=>$fmtT($r['checkOut'])],
            ['label'=>'Working Hours',  'value'=>fn($r)=>$r['workingHours']??''],
            ['label'=>'Status',         'value'=>fn($r)=>$r['status']],
            ['label'=>'Late (minutes)', 'value'=>fn($r)=>$r['lateMinutes']??''],
            ['label'=>'Punch-in type',  'value'=>fn($r)=>!empty($r['lateRequestId']) ? 'After 9:45 (approved)' : (!empty($r['lateMinutes']) ? 'Grace time (late)' : 'On time')],
            ['label'=>'Punch-in photo', 'value'=>fn($r)=>!empty($r['checkInPhoto']) ? 'Yes' : 'No'],
            ['label'=>'Punch-out photo','value'=>fn($r)=>!empty($r['checkOutPhoto']) ? 'Yes' : 'No'],
            ['label'=>'Punch-in location', 'value'=>fn($r)=>$r['checkInLat'] !== null && $r['checkInLng'] !== null ? round((float)$r['checkInLat'], 6) . ', ' . round((float)$r['checkInLng'], 6) : ''],
            ['label'=>'Punch-out location','value'=>fn($r)=>$r['checkOutLat'] !== null && $r['checkOutLng'] !== null ? round((float)$r['checkOutLat'], 6) . ', ' . round((float)$r['checkOutLng'], 6) : ''],
            ['label'=>'GPS Pings Logged','value'=>fn($r)=>$r['pings_count']??0],
        ], 'attendance-' . $this->stamp(), 'Attendance & Location Report');
    }

    // ── Fuel Expense ──────────────────────────────────────────────────
    public function exportFuelExpense(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$clauses, $params] = $this->dateRange('f.date');
        $w = $clauses ? 'WHERE ' . implode(' AND ', $clauses) : '';
        $s = db()->prepare(
            "SELECT f.*, u.name AS u_name, u.department
             FROM FuelExpense f LEFT JOIN User u ON u.id=f.userId
             $w ORDER BY f.date DESC"
        );
        $s->execute($params);
        $rows = $s->fetchAll();
        $fmtD = fn($d) => $d ? (new DateTime($d))->format('d/m/Y') : '';
        $fmtN = fn($v) => $v === null ? '' : number_format((float)$v, 2, '.', '');
        $this->sendExport($rows, [
            ['label'=>'Employee',        'value'=>fn($r)=>$r['u_name']??''],
            ['label'=>'Department',      'value'=>fn($r)=>$r['department']??''],
            ['label'=>'Date',            'value'=>fn($r)=>$fmtD($r['date'])],
            ['label'=>'Vehicle',         'value'=>fn($r)=>trim(($r['vehicleType']??'').' '.($r['vehicleDetails']??''))],
            ['label'=>'Opening (km)',    'value'=>fn($r)=>$fmtN($r['openingMeter'])],
            ['label'=>'Closing (km)',    'value'=>fn($r)=>$fmtN($r['closingMeter'])],
            ['label'=>'Personal (km)',   'value'=>fn($r)=>$fmtN($r['personalKm'])],
            ['label'=>'Official (km)',   'value'=>fn($r)=>$fmtN($r['officialKm'])],
            ['label'=>'Fuel Cost',       'value'=>fn($r)=>$fmtN($r['fuelCost'])],
            ['label'=>'Misc. Expense',   'value'=>fn($r)=>$r['miscDesc']??''],
            ['label'=>'Misc. Amount',    'value'=>fn($r)=>$fmtN($r['miscAmount'])],
            ['label'=>'Total Amount',    'value'=>fn($r)=>$fmtN($r['totalAmount'])],
            ['label'=>'Status',          'value'=>fn($r)=>$r['status']],
        ], 'fuel-expense-' . $this->stamp(), 'Fuel Expense Report');
    }

    // ── Leaves ────────────────────────────────────────────────────────
    public function exportLeaves(): void
    {
        $auth = authenticate(); require_admin($auth);
        try { new LeaveController(); } catch (Throwable $e) {}
        [$clauses, $params] = $this->dateRange('l.fromDate');
        $w = $clauses ? 'WHERE ' . implode(' AND ', $clauses) : '';
        $s = db()->prepare(
            "SELECT l.*, u.name AS u_name, u.department FROM `Leave` l
             LEFT JOIN `User` u ON u.id=l.userId
             $w ORDER BY l.fromDate DESC"
        );
        $s->execute($params);
        $rows = $s->fetchAll();
        $fmt = fn($d) => $d ? (new DateTime($d))->format('d/m/Y') : '';
        $this->sendExport($rows, [
            ['label'=>'Employee',   'value'=>fn($r)=>$r['u_name']??''],
            ['label'=>'Department', 'value'=>fn($r)=>$r['department']??''],
            ['label'=>'Type',       'value'=>fn($r)=>LeaveController::LABELS[$r['leaveType']] ?? $r['leaveType']],
            ['label'=>'From',       'value'=>fn($r)=>$fmt($r['fromDate'])],
            ['label'=>'To',         'value'=>fn($r)=>$fmt($r['toDate'])],
            ['label'=>'Time',       'value'=>fn($r)=>!empty($r['fromTime']) ? $r['fromTime'] . '–' . $r['toTime'] : ''],
            ['label'=>'Hours',      'value'=>fn($r)=>$r['hours'] ?? ''],
            ['label'=>'Days',       'value'=>fn($r)=>$r['totalDays']],
            ['label'=>'Status',     'value'=>fn($r)=>$r['status']],
            ['label'=>'Reason',     'value'=>fn($r)=>$r['reason']??''],
        ], 'leaves-' . $this->stamp(), 'Leave Report');
    }

    // ── Users ─────────────────────────────────────────────────────────
    public function exportUsers(): void
    {
        $auth = authenticate(); require_admin($auth);
        $rows = db()->query('SELECT * FROM `User` ORDER BY name ASC')->fetchAll();
        $fmt = fn($d) => $d ? (new DateTime($d))->format('d/m/Y') : '';
        $this->sendExport($rows, [
            ['label'=>'Name',       'value'=>fn($r)=>$r['name']],
            ['label'=>'Email',      'value'=>fn($r)=>$r['email']],
            ['label'=>'Role',       'value'=>fn($r)=>$r['role']],
            ['label'=>'Department', 'value'=>fn($r)=>$r['department']??''],
            ['label'=>'Phone',      'value'=>fn($r)=>$r['phone']??''],
            ['label'=>'Status',     'value'=>fn($r)=>$r['isActive']?'Active':'Inactive'],
            ['label'=>'Joined',     'value'=>fn($r)=>$fmt($r['createdAt'])],
        ], 'team-' . $this->stamp(), 'Team Report');
    }

    // ── Activity log ──────────────────────────────────────────────────
    public function exportActivity(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$clauses, $params] = $this->dateRange('al.createdAt');
        $w = $clauses ? 'WHERE ' . implode(' AND ', $clauses) : '';
        $s = db()->prepare(
            "SELECT al.*, u.name AS u_name, u.role AS u_role FROM ActivityLog al
             LEFT JOIN User u ON u.id=al.userId
             $w ORDER BY al.createdAt DESC LIMIT 5000"
        );
        $s->execute($params);
        $rows = $s->fetchAll();
        $fmt = fn($d) => $d ? (new DateTime($d))->format('d/m/Y H:i') : '';
        $this->sendExport($rows, [
            ['label'=>'User',       'value'=>fn($r)=>$r['u_name']??''],
            ['label'=>'Role',       'value'=>fn($r)=>$r['u_role']??''],
            ['label'=>'Action',     'value'=>fn($r)=>$r['action']],
            ['label'=>'Entity Type','value'=>fn($r)=>$r['entityType']??''],
            ['label'=>'Date/Time',  'value'=>fn($r)=>$fmt($r['createdAt'])],
        ], 'activity-log-' . $this->stamp(), 'Activity Log Report');
    }
}
