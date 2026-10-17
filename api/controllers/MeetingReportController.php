<?php
/**
 * Internal meeting reports and MOM (minutes of meeting) documents.
 *
 * Internal meetings (team meetings inside the company):
 *   date, topic, attendees, what was discussed (points) and the next actions,
 *   each with an owner and a due date that the owner ticks off when done.
 *   Admins see every report; others see the ones they wrote, attended or own an action in.
 *
 *   GET    /api/internal-meetings?from=&to=&search=&mine=1
 *   GET    /api/internal-meetings/people          active users (attendees / action owners)
 *   POST   /api/internal-meetings
 *   PUT    /api/internal-meetings/:id
 *   PATCH  /api/internal-meetings/:id/actions/:n  { done }
 *   DELETE /api/internal-meetings/:id
 *
 * MOM (customer meetings) on the TMS or APJ letterhead, as a PDF:
 *   company, customer, date, time, venue, subject, attendees on both sides,
 *   discussion points, action points (responsibility, target date), next meeting.
 *   The letterhead (name, address, phone, e-mail, GST) is the company profile
 *   shared with the purchase orders — PUT /api/company-profiles/:code changes it.
 *
 *   GET    /api/mom?search=&company=
 *   GET    /api/mom/:id
 *   GET    /api/mom/:id/pdf[?inline=1]
 *   POST   /api/mom
 *   PUT    /api/mom/:id
 *   DELETE /api/mom/:id
 */
class MeetingReportController
{
    public function __construct()
    {
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        ensure_schema([
            'InternalMeeting' => ['create' => "CREATE TABLE IF NOT EXISTS `InternalMeeting` (
  `id` VARCHAR(30) NOT NULL, `meetingNo` VARCHAR(30) NOT NULL, `meetingDate` DATE NOT NULL, `meetingTime` VARCHAR(10) NULL,
  `title` VARCHAR(255) NOT NULL, `attendeeIds` TEXT NULL, `otherAttendees` VARCHAR(500) NULL,
  `points` MEDIUMTEXT NULL, `actions` MEDIUMTEXT NULL, `notes` TEXT NULL,
  `createdById` VARCHAR(30) NOT NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NULL,
  PRIMARY KEY (`id`), KEY `InternalMeeting_date` (`meetingDate`)
$tail"],
            'Mom' => ['create' => "CREATE TABLE IF NOT EXISTS `Mom` (
  `id` VARCHAR(30) NOT NULL, `momNo` VARCHAR(40) NOT NULL, `company` VARCHAR(5) NOT NULL DEFAULT 'TMS',
  `customerId` VARCHAR(30) NULL, `customerName` VARCHAR(255) NOT NULL, `customerAddress` TEXT NULL,
  `meetingDate` DATE NOT NULL, `meetingTime` VARCHAR(20) NULL, `venue` VARCHAR(255) NULL, `subject` VARCHAR(255) NULL,
  `clientAttendees` TEXT NULL, `ourAttendees` TEXT NULL, `points` MEDIUMTEXT NULL, `actions` MEDIUMTEXT NULL,
  `nextMeetingDate` DATE NULL, `remarks` TEXT NULL,
  `createdById` VARCHAR(30) NOT NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NULL,
  PRIMARY KEY (`id`), KEY `Mom_date` (`meetingDate`)
$tail"],
        ], 'Internal meetings / MOM');
    }

    private const MAX_ROWS = 60;

    private static function userNames(): array
    {
        static $m = null;
        if ($m === null) { $m = []; foreach (db()->query('SELECT id, name FROM `User`')->fetchAll() as $r) $m[$r['id']] = $r['name']; }
        return $m;
    }
    private static function txt($v, int $max): string { return mb_substr(trim((string) ($v ?? '')), 0, $max); }
    private static function jsonArr($s): array { $a = json_decode((string) $s, true); return is_array($a) ? $a : []; }
    private static function nextNo(string $table, string $col, string $prefix): string
    {
        $s = db()->prepare("SELECT $col FROM `$table` WHERE $col LIKE ? ORDER BY $col DESC LIMIT 1");
        $s->execute([$prefix . '%']);
        $last = (string) $s->fetchColumn();
        $n = $last !== '' ? (int) substr($last, strlen($prefix)) + 1 : 1;
        return $prefix . str_pad((string) $n, 3, '0', STR_PAD_LEFT);
    }
    private static function date($v, string $what, bool $required = true): ?string
    {
        $d = to_date_only((string) ($v ?? ''));
        if (!$d && $required) sendError("Enter the $what.", 400);
        return $d ?: null;
    }

    // ═════════════════════════ internal meetings ═════════════════════════

    private function shapeIm(array $r): array
    {
        $names = self::userNames();
        $att = self::jsonArr($r['attendeeIds']);
        $actions = array_map(fn($a) => [
            'text' => (string) ($a['text'] ?? ''), 'ownerId' => $a['ownerId'] ?? null,
            'ownerName' => isset($a['ownerId']) ? ($names[$a['ownerId']] ?? null) : null, 'ownerText' => $a['ownerText'] ?? null,
            'dueDate' => $a['dueDate'] ?? null, 'done' => !empty($a['done']), 'doneAt' => $a['doneAt'] ?? null,
        ], self::jsonArr($r['actions']));
        return [
            'id' => $r['id'], 'meetingNo' => $r['meetingNo'], 'meetingDate' => $r['meetingDate'], 'meetingTime' => $r['meetingTime'],
            'title' => $r['title'], 'attendees' => array_map(fn($id) => ['id' => $id, 'name' => $names[$id] ?? '—'], $att),
            'otherAttendees' => $r['otherAttendees'], 'points' => array_values(array_map('strval', self::jsonArr($r['points']))),
            'actions' => $actions, 'openActions' => count(array_filter($actions, fn($a) => !$a['done'])),
            'notes' => $r['notes'], 'createdBy' => ['id' => $r['createdById'], 'name' => $names[$r['createdById']] ?? '—'],
            'createdAt' => $r['createdAt'], 'updatedAt' => $r['updatedAt'],
        ];
    }

    private static function involved(array $auth, array $r): bool
    {
        if (is_admin_tier($auth['role']) || $r['createdById'] === $auth['id']) return true;
        if (in_array($auth['id'], self::jsonArr($r['attendeeIds']), true)) return true;
        foreach (self::jsonArr($r['actions']) as $a) if (($a['ownerId'] ?? null) === $auth['id']) return true;
        return false;
    }

    private function imRow(string $id): array
    {
        $s = db()->prepare('SELECT * FROM `InternalMeeting` WHERE id=?'); $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) sendError('Meeting report not found.', 404);
        return $r;
    }

    public function people(): void
    {
        authenticate();
        try { $rows = db()->query('SELECT id, name, role FROM `User` WHERE isActive=1 AND deletedAt IS NULL ORDER BY name')->fetchAll(); }
        catch (Throwable $e) { $rows = db()->query('SELECT id, name, role FROM `User` WHERE isActive=1 ORDER BY name')->fetchAll(); }
        sendSuccess(['people' => $rows]);
    }

    public function imIndex(): void
    {
        $auth = authenticate();
        $where = []; $p = [];
        if ($f = to_date_only(qp('from', ''))) { $where[] = 'meetingDate >= ?'; $p[] = $f; }
        if ($t = to_date_only(qp('to', ''))) { $where[] = 'meetingDate <= ?'; $p[] = $t; }
        if (($q = trim((string) qp('search', ''))) !== '') { $where[] = '(title LIKE ? OR meetingNo LIKE ? OR points LIKE ? OR actions LIKE ? OR notes LIKE ?)'; array_push($p, "%$q%", "%$q%", "%$q%", "%$q%", "%$q%"); }
        $s = db()->prepare('SELECT * FROM `InternalMeeting`' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY meetingDate DESC, createdAt DESC LIMIT 500');
        $s->execute($p);
        $mine = qp('mine', '') === '1';
        $out = [];
        foreach ($s->fetchAll() as $r) {
            if (!self::involved($auth, $r)) continue;
            $x = $this->shapeIm($r);
            if ($mine && !array_filter($x['actions'], fn($a) => $a['ownerId'] === $auth['id'] && !$a['done'])) continue;
            $out[] = $x;
        }
        $myOpen = 0;
        foreach ($out as $x) foreach ($x['actions'] as $a) if ($a['ownerId'] === $auth['id'] && !$a['done']) $myOpen++;
        sendSuccess(['meetings' => $out, 'myOpenActions' => $myOpen]);
    }

    /** Validated fields from the body for create / update. */
    private function imFields(array $b, array $oldActions = []): array
    {
        $title = self::txt($b['title'] ?? '', 255);
        if ($title === '') sendError('Enter the meeting topic.', 400);
        $date = self::date($b['meetingDate'] ?? '', 'meeting date');
        $names = self::userNames();
        $att = array_values(array_unique(array_filter(array_map('strval', (array) ($b['attendeeIds'] ?? [])), fn($id) => isset($names[$id]))));
        $points = array_values(array_filter(array_map(fn($x) => self::txt($x, 4000), (array) ($b['points'] ?? [])), fn($x) => $x !== ''));
        if (!$points) sendError('Write at least one point that was discussed.', 400);
        if (count($points) > self::MAX_ROWS) sendError('Too many points.', 400);
        $actions = [];
        foreach ((array) ($b['actions'] ?? []) as $i => $a) {
            $text = self::txt($a['text'] ?? '', 2000);
            if ($text === '') continue;
            $owner = isset($a['ownerId']) && isset($names[$a['ownerId']]) ? (string) $a['ownerId'] : null;
            $prev = $oldActions[$i] ?? null;
            $done = !empty($a['done']);
            $actions[] = ['text' => $text, 'ownerId' => $owner, 'ownerText' => $owner ? null : (self::txt($a['ownerText'] ?? '', 120) ?: null),
                          'dueDate' => to_date_only((string) ($a['dueDate'] ?? '')) ?: null, 'done' => $done,
                          'doneAt' => $done ? (($prev && !empty($prev['done']) ? ($prev['doneAt'] ?? null) : null) ?: now_sql()) : null];
        }
        if (count($actions) > self::MAX_ROWS) sendError('Too many actions.', 400);
        $time = self::txt($b['meetingTime'] ?? '', 10);
        return [$date, $time ?: null, $title, json_encode($att), self::txt($b['otherAttendees'] ?? '', 500) ?: null,
                json_encode($points, JSON_UNESCAPED_UNICODE), json_encode($actions, JSON_UNESCAPED_UNICODE), self::txt($b['notes'] ?? '', 4000) ?: null];
    }

    public function imCreate(): void
    {
        $auth = authenticate();
        $f = $this->imFields(request_body());
        $id = gen_id();
        $no = self::nextNo('InternalMeeting', 'meetingNo', 'IM-' . date('ym', strtotime($f[0])) . '-');
        db()->prepare('INSERT INTO `InternalMeeting` (id,meetingNo,meetingDate,meetingTime,title,attendeeIds,otherAttendees,points,actions,notes,createdById,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute(array_merge([$id, $no], $f, [$auth['id'], now_sql(), now_sql()]));
        log_activity($auth['id'], 'INTERNAL_MEETING_CREATED', 'InternalMeeting', $id, ['title' => $f[2]]);
        sendSuccess(['meeting' => $this->shapeIm($this->imRow($id))], 'Meeting report ' . $no . ' saved', 201);
    }

    public function imUpdate(string $id): void
    {
        $auth = authenticate();
        $r = $this->imRow($id);
        if ($r['createdById'] !== $auth['id'] && !is_admin_tier($auth['role'])) sendError('Only the person who wrote this report (or an admin) can change it.', 403);
        $f = $this->imFields(request_body(), self::jsonArr($r['actions']));
        db()->prepare('UPDATE `InternalMeeting` SET meetingDate=?,meetingTime=?,title=?,attendeeIds=?,otherAttendees=?,points=?,actions=?,notes=?,updatedAt=? WHERE id=?')
            ->execute(array_merge($f, [now_sql(), $id]));
        sendSuccess(['meeting' => $this->shapeIm($this->imRow($id))], 'Meeting report updated');
    }

    public function imAction(string $id, string $n): void
    {
        $auth = authenticate();
        $r = $this->imRow($id);
        $acts = self::jsonArr($r['actions']);
        $i = (int) $n;
        if (!ctype_digit($n) || !isset($acts[$i])) sendError('Action not found.', 404);
        $own = ($acts[$i]['ownerId'] ?? null) === $auth['id'];
        if (!$own && $r['createdById'] !== $auth['id'] && !is_admin_tier($auth['role'])) sendError('Only the action owner, the writer or an admin can update it.', 403);
        $done = !empty(request_body()['done']);
        $acts[$i]['done'] = $done; $acts[$i]['doneAt'] = $done ? now_sql() : null;
        db()->prepare('UPDATE `InternalMeeting` SET actions=?, updatedAt=? WHERE id=?')->execute([json_encode($acts, JSON_UNESCAPED_UNICODE), now_sql(), $id]);
        sendSuccess(['meeting' => $this->shapeIm($this->imRow($id))], $done ? 'Action marked done' : 'Action re-opened');
    }

    public function imDelete(string $id): void
    {
        $auth = authenticate();
        $r = $this->imRow($id);
        if ($r['createdById'] !== $auth['id'] && !is_admin_tier($auth['role'])) sendError('Only the person who wrote this report (or an admin) can delete it.', 403);
        db()->prepare('DELETE FROM `InternalMeeting` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'INTERNAL_MEETING_DELETED', 'InternalMeeting', $id, ['no' => $r['meetingNo']]);
        sendSuccess(null, 'Meeting report deleted');
    }

    // ═════════════════════════ MOM ═════════════════════════

    private function shapeMom(array $r): array
    {
        $names = self::userNames();
        return [
            'id' => $r['id'], 'momNo' => $r['momNo'], 'company' => $r['company'], 'customerId' => $r['customerId'],
            'customerName' => $r['customerName'], 'customerAddress' => $r['customerAddress'],
            'meetingDate' => $r['meetingDate'], 'meetingTime' => $r['meetingTime'], 'venue' => $r['venue'], 'subject' => $r['subject'],
            'clientAttendees' => array_values(self::jsonArr($r['clientAttendees'])), 'ourAttendees' => array_values(self::jsonArr($r['ourAttendees'])),
            'points' => array_values(self::jsonArr($r['points'])), 'actions' => array_values(self::jsonArr($r['actions'])),
            'nextMeetingDate' => $r['nextMeetingDate'], 'remarks' => $r['remarks'],
            'createdBy' => ['id' => $r['createdById'], 'name' => $names[$r['createdById']] ?? '—'],
            'createdAt' => $r['createdAt'], 'updatedAt' => $r['updatedAt'],
        ];
    }

    private function momRow(string $id, array $auth): array
    {
        $s = db()->prepare('SELECT * FROM `Mom` WHERE id=?'); $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) sendError('MOM not found.', 404);
        if ($r['createdById'] !== $auth['id'] && !is_admin_tier($auth['role'])) sendError('This MOM belongs to someone else.', 403);
        return $r;
    }

    public function momIndex(): void
    {
        $auth = authenticate();
        $where = []; $p = [];
        if (!is_admin_tier($auth['role'])) { $where[] = 'createdById = ?'; $p[] = $auth['id']; }
        if (in_array($co = strtoupper((string) qp('company', '')), ['TMS', 'APJ'], true)) { $where[] = 'company = ?'; $p[] = $co; }
        if (($q = trim((string) qp('search', ''))) !== '') { $where[] = '(momNo LIKE ? OR customerName LIKE ? OR subject LIKE ? OR points LIKE ?)'; array_push($p, "%$q%", "%$q%", "%$q%", "%$q%"); }
        $s = db()->prepare('SELECT * FROM `Mom`' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY meetingDate DESC, createdAt DESC LIMIT 500');
        $s->execute($p);
        sendSuccess(['moms' => array_map(fn($r) => $this->shapeMom($r), $s->fetchAll())]);
    }

    public function momShow(string $id): void
    {
        $auth = authenticate();
        sendSuccess(['mom' => $this->shapeMom($this->momRow($id, $auth))]);
    }

    private function momFields(array $b): array
    {
        $co = strtoupper((string) ($b['company'] ?? 'TMS'));
        if (!in_array($co, ['TMS', 'APJ'], true)) sendError('Choose TMS or APJ.', 400);
        $cust = self::txt($b['customerName'] ?? '', 255);
        if ($cust === '') sendError('Enter the customer / company name.', 400);
        $date = self::date($b['meetingDate'] ?? '', 'meeting date');
        $people = function ($list) {
            $out = [];
            foreach ((array) $list as $x) {
                $name = self::txt(is_array($x) ? ($x['name'] ?? '') : $x, 120);
                if ($name === '') continue;
                $out[] = ['name' => $name, 'designation' => is_array($x) ? (self::txt($x['designation'] ?? '', 120) ?: null) : null];
            }
            return array_slice($out, 0, 30);
        };
        $points = [];
        foreach ((array) ($b['points'] ?? []) as $x) {
            $topic = self::txt(is_array($x) ? ($x['topic'] ?? '') : '', 500);
            $disc = self::txt(is_array($x) ? ($x['discussion'] ?? '') : $x, 4000);
            if ($topic === '' && $disc === '') continue;
            $points[] = ['topic' => $topic, 'discussion' => $disc];
        }
        if (!$points) sendError('Add at least one discussion point.', 400);
        $actions = [];
        foreach ((array) ($b['actions'] ?? []) as $x) {
            $a = self::txt($x['action'] ?? '', 2000);
            if ($a === '') continue;
            $actions[] = ['action' => $a, 'responsibility' => self::txt($x['responsibility'] ?? '', 160), 'target' => to_date_only((string) ($x['target'] ?? '')) ?: self::txt($x['target'] ?? '', 40)];
        }
        if (count($points) > self::MAX_ROWS || count($actions) > self::MAX_ROWS) sendError('Too many rows.', 400);
        $custId = self::txt($b['customerId'] ?? '', 30) ?: null;
        return ['company' => $co, 'customerId' => $custId, 'customerName' => $cust, 'customerAddress' => self::txt($b['customerAddress'] ?? '', 1000) ?: null,
                'meetingDate' => $date, 'meetingTime' => self::txt($b['meetingTime'] ?? '', 20) ?: null, 'venue' => self::txt($b['venue'] ?? '', 255) ?: null,
                'subject' => self::txt($b['subject'] ?? '', 255) ?: null,
                'clientAttendees' => json_encode($people($b['clientAttendees'] ?? []), JSON_UNESCAPED_UNICODE),
                'ourAttendees' => json_encode($people($b['ourAttendees'] ?? []), JSON_UNESCAPED_UNICODE),
                'points' => json_encode($points, JSON_UNESCAPED_UNICODE), 'actions' => json_encode($actions, JSON_UNESCAPED_UNICODE),
                'nextMeetingDate' => to_date_only((string) ($b['nextMeetingDate'] ?? '')) ?: null, 'remarks' => self::txt($b['remarks'] ?? '', 4000) ?: null];
    }

    public function momCreate(): void
    {
        $auth = authenticate();
        $f = $this->momFields(request_body());
        $id = gen_id();
        $no = self::nextNo('Mom', 'momNo', $f['company'] . '/MOM/' . date('ym', strtotime($f['meetingDate'])) . '/');
        $cols = array_keys($f);
        db()->prepare('INSERT INTO `Mom` (id,momNo,' . implode(',', $cols) . ',createdById,createdAt,updatedAt) VALUES (?,?' . str_repeat(',?', count($cols)) . ',?,?,?)')
            ->execute(array_merge([$id, $no], array_values($f), [$auth['id'], now_sql(), now_sql()]));
        log_activity($auth['id'], 'MOM_CREATED', 'Mom', $id, ['no' => $no, 'customer' => $f['customerName']]);
        sendSuccess(['mom' => $this->shapeMom($this->momRow($id, $auth))], 'MOM ' . $no . ' saved', 201);
    }

    public function momUpdate(string $id): void
    {
        $auth = authenticate();
        $r = $this->momRow($id, $auth);
        $f = $this->momFields(request_body());
        $sets = implode(',', array_map(fn($c) => "$c=?", array_keys($f)));
        db()->prepare("UPDATE `Mom` SET $sets, updatedAt=? WHERE id=?")->execute(array_merge(array_values($f), [now_sql(), $id]));
        // the number follows the company: switching TMS ↔ APJ gives the MOM a number in that series
        if ($f['company'] !== $r['company']) {
            $no = self::nextNo('Mom', 'momNo', $f['company'] . '/MOM/' . date('ym', strtotime($f['meetingDate'])) . '/');
            db()->prepare('UPDATE `Mom` SET momNo=? WHERE id=?')->execute([$no, $id]);
        }
        sendSuccess(['mom' => $this->shapeMom($this->momRow($id, $auth))], 'MOM updated');
    }

    public function momDelete(string $id): void
    {
        $auth = authenticate();
        $r = $this->momRow($id, $auth);
        db()->prepare('DELETE FROM `Mom` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'MOM_DELETED', 'Mom', $id, ['no' => $r['momNo']]);
        sendSuccess(null, 'MOM deleted');
    }

    public function momPdf(string $id): void
    {
        $auth = authenticate();
        $m = $this->shapeMom($this->momRow($id, $auth));
        $pdf = (new MomPdf($m, PurchaseOrderController::profile($m['company'])))->render();
        $fn = preg_replace('/[^A-Za-z0-9]+/', '-', $m['momNo']) . '-' . preg_replace('/[^A-Za-z0-9]+/', '-', $m['customerName']) . '.pdf';
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/pdf');
        header('Content-Disposition: ' . (qp('inline') === '1' ? 'inline' : 'attachment') . '; filename="' . $fn . '"');
        echo $pdf->output(); exit;
    }
}

/** MOM PDF on the TMS / APJ letterhead (same header as the purchase order and quotation). */
class MomPdf
{
    private const MM = 2.8346456693;
    private const BLUE = '#1A4FA0'; private const DARK = '#111827'; private const GREY = '#6B7280';
    private const BGBLUE = '#EFF6FF'; private const BOX = '#D1D5DB'; private const CELL = '#E5E7EB'; private const ALT = '#F9FAFB';
    private const A4_W = 210.0; private const A4_H = 297.0; private const ML = 10.0; private const MR = 10.0; private const MT = 12.0; private const MB = 16.0;
    private SimplePdf $pdf; private float $y = 0; private float $cw = 190;
    public function __construct(private array $m, private array $co) {}
    private function mm(float $v): float { return $v * self::MM; }
    private function t(string $s, float $x, float $y, array $o = []): void { $this->pdf->text($s, $this->mm($x), $this->mm($y), $o + ['baseline' => 'top']); }
    private function font(string $f, float $s, string $c): void { $this->pdf->setFont($f, $s); $this->pdf->setFillColor($c); }
    private function box(float $x, float $y, float $w, float $h, string $c, float $lw = 0.3): void
    {
        foreach ([[$x, $y, $x + $w, $y], [$x, $y + $h, $x + $w, $y + $h], [$x, $y, $x, $y + $h], [$x + $w, $y, $x + $w, $y + $h]] as $l)
            $this->pdf->line($this->mm($l[0]), $this->mm($l[1]), $this->mm($l[2]), $this->mm($l[3]), $c, $this->mm($lw));
    }
    private function wrap(string $s, float $wmm): array
    {
        if (trim($s) === '') return [];
        $out = [];
        foreach (preg_split('/\r?\n/', $s) as $line) foreach ($this->pdf->splitTextToSize($line === '' ? ' ' : $line, $this->mm($wmm)) as $w) $out[] = $w;
        return $out;
    }
    private function d(?string $d): string { return $d && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) ? date('d-m-Y', strtotime($d)) : ($d ?: '—'); }
    private function newPage(): void { $this->pdf->addPage($this->mm(self::A4_W), $this->mm(self::A4_H)); $this->box(5, 5, 200, 287, self::BLUE, 0.4); $this->y = self::MT; }
    private function need(float $h, ?callable $after = null): void { if ($this->y + $h > self::A4_H - self::MB) { $this->newPage(); if ($after) $after(); } }
    private function section(string $title): void
    {
        $this->need(16);
        $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm(7), self::BGBLUE);
        $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm(self::ML), $this->mm($this->y + 7), self::BLUE, $this->mm(0.8));
        $this->font('Helvetica-Bold', 8.5, self::BLUE); $this->t($title, self::ML + 4, $this->y + 2.2);
        $this->y += 9;
    }

    /** A table with wrapped cells; $cols = [[header, width, align]] widths summing to 190. */
    private function table(array $cols, array $rows): void
    {
        $x = [self::ML]; foreach ($cols as $i => $c) if ($i) $x[] = $x[$i - 1] + $cols[$i - 1][1];
        $head = function () use ($cols, $x) {
            $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm(7), self::BLUE);
            $this->font('Helvetica-Bold', 7.5, '#FFFFFF');
            foreach ($cols as $i => $c) $this->t($c[0], $x[$i] + ($c[2] === 'center' ? $c[1] / 2 : 1.8), $this->y + 2.2, ['align' => $c[2] === 'center' ? 'center' : 'left']);
            $this->y += 7;
        };
        $this->need(14); $head();
        foreach ($rows as $n => $row) {
            $this->font('Helvetica', 8, self::DARK);
            $cells = []; $lines = 1;
            foreach ($cols as $i => $c) { $cells[$i] = $this->wrap((string) $row[$i], $c[1] - 3.6) ?: ['']; $lines = max($lines, count($cells[$i])); }
            $rh = 3.8 * $lines + 3;
            $this->need($rh, $head);
            if ($n % 2) $this->pdf->rect($this->mm(self::ML), $this->mm($this->y), $this->mm($this->cw), $this->mm($rh), self::ALT);
            foreach ($cols as $i => $c) {
                $this->font($i === 1 && count($cols) === 3 ? 'Helvetica-Bold' : 'Helvetica', 8, self::DARK);
                foreach ($cells[$i] as $k => $l) $this->t($l, $x[$i] + ($c[2] === 'center' ? $c[1] / 2 : 1.8), $this->y + 1.6 + 3.8 * $k, ['align' => $c[2] === 'center' ? 'center' : 'left']);
                if ($i) $this->pdf->line($this->mm($x[$i]), $this->mm($this->y), $this->mm($x[$i]), $this->mm($this->y + $rh), self::CELL, $this->mm(0.2));
            }
            $this->y += $rh;
            $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm(self::ML + $this->cw), $this->mm($this->y), self::CELL, $this->mm(0.2));
        }
        $this->y += 4;
    }

    public function render(): SimplePdf
    {
        $m = $this->m; $c = $this->co; $isApj = $m['company'] === 'APJ';
        $this->pdf = new SimplePdf();
        $this->newPage();
        // ── letterhead ──
        if ($isApj) { $lw = 24; $lh = 24; $logo = __DIR__ . '/../assets/apj-logo.png'; }
        else { $lh = 18; $lw = 291 * 18 / 164; $logo = __DIR__ . '/../assets/tms-logo.png'; }
        if (!$this->pdf->addImage($logo, $this->mm(self::ML), $this->mm($this->y), $this->mm($lw), $this->mm($lh))) { $this->font('Helvetica-Bold', 16, self::BLUE); $this->t($m['company'], self::ML, $this->y + 6); }
        $R = self::A4_W - self::MR;
        $this->font('Helvetica-Bold', 13, self::BLUE); $this->t((string) $c['name'], $R, $this->y + 1, ['align' => 'right']);
        $this->font('Helvetica', 7.5, self::DARK);
        $hy = $this->y + 7;
        $lines = array_filter(array_map('trim', explode("\n", (string) $c['address'])));
        $tail = array_filter([$c['phone'] ? (stripos($c['phone'], 'phone') === false && stripos($c['phone'], 'mobile') === false ? 'Phone: ' : '') . $c['phone'] : '', $c['email'] ? 'E-Mail: ' . $c['email'] : '', $c['gstin'] ? 'GST No: ' . $c['gstin'] : '']);
        foreach (array_merge($lines, [implode('  |  ', $tail)]) as $l) { foreach ($this->wrap($l, 150) as $w) { $this->t($w, $R, $hy, ['align' => 'right']); $hy += 3.8; } }
        $this->y = max($hy, $this->y + $lh) + 2;
        $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm($R), $this->mm($this->y), self::BLUE, $this->mm(0.8));
        $this->y += 3;
        $this->font('Helvetica-Bold', 12, self::BLUE); $this->t('MINUTES OF MEETING', self::A4_W / 2, $this->y, ['align' => 'center']);
        $this->y += 8;
        // ── customer box + meeting info box ──
        $lw2 = $this->cw * 0.56; $rw = $this->cw * 0.40; $rx = self::ML + $this->cw - $rw; $top = $this->y;
        $addr = $this->wrap((string) ($m['customerAddress'] ?? ''), $lw2 - 6);
        $meta = [['MOM No.', $m['momNo']], ['Date', $this->d($m['meetingDate'])], ['Time', $m['meetingTime'] ?: '—'], ['Venue', $m['venue'] ?: '—'], ['Prepared by', $m['createdBy']['name']]];
        $h = max(32, 14 + 4 * count($addr) + 2, 8 + 4.6 * count($meta) + 2);
        $this->box(self::ML, $top, $lw2, $h, self::BOX);
        $this->font('Helvetica-Bold', 6.5, self::BLUE); $this->t('CUSTOMER', self::ML + 3, $top + 3);
        $this->font('Helvetica-Bold', 9.5, self::DARK);
        $cy = $top + 8;
        foreach ($this->wrap((string) $m['customerName'], $lw2 - 6) as $l) { $this->t($l, self::ML + 3, $cy); $cy += 4.5; }
        $this->font('Helvetica', 8, '#374151');
        foreach ($addr as $l) { $this->t($l, self::ML + 3, $cy); $cy += 4; }
        $this->box($rx, $top, $rw, $h, self::BOX);
        $this->font('Helvetica-Bold', 6.5, self::BLUE); $this->t('MEETING', $rx + 3, $top + 3);
        $my = $top + 8;
        foreach ($meta as [$k, $v]) {
            $this->font('Helvetica', 7.5, self::GREY); $this->t($k, $rx + 3, $my);
            $this->font('Helvetica-Bold', 7.5, self::DARK);
            $vv = $this->wrap((string) $v, $rw - 30); $this->t($vv[0] ?? '—', $rx + $rw - 3, $my, ['align' => 'right']);
            $my += 4.6;
        }
        $this->y = max($top + $h, $cy) + 3;
        if ($m['subject']) {
            $this->font('Helvetica-Bold', 8.5, self::DARK);
            foreach ($this->wrap('Subject: ' . $m['subject'], $this->cw) as $l) { $this->t($l, self::ML, $this->y); $this->y += 4.4; }
            $this->y += 2;
        }
        // ── attendees ──
        $this->section('ATTENDEES');
        $ppl = fn($list) => array_map(fn($p) => $p['name'] . (!empty($p['designation']) ? ' — ' . $p['designation'] : ''), $list);
        $a = $ppl($m['clientAttendees']); $b = $ppl($m['ourAttendees']);
        $n = max(count($a), count($b), 1);
        $rows = [];
        for ($i = 0; $i < $n; $i++) $rows[] = [$a[$i] ?? '', $b[$i] ?? ''];
        $this->table([[$m['customerName'], 95, 'left'], [$c['name'], 95, 'left']], $rows);
        // ── discussion ──
        $this->section('POINTS DISCUSSED');
        $rows = [];
        foreach ($m['points'] as $i => $p) $rows[] = [(string) ($i + 1), $p['topic'] ?: '—', $p['discussion'] ?: '—'];
        $this->table([['S.No', 12, 'center'], ['Topic', 55, 'left'], ['Discussion / Decision', 123, 'left']], $rows);
        // ── action points ──
        if ($m['actions']) {
            $this->section('ACTION POINTS');
            $rows = [];
            foreach ($m['actions'] as $i => $p) $rows[] = [(string) ($i + 1), $p['action'], $p['responsibility'] ?: '—', $this->d($p['target'] ?: null)];
            $this->table([['S.No', 12, 'center'], ['Action', 110, 'left'], ['Responsibility', 40, 'left'], ['Target date', 28, 'center']], $rows);
        }
        if ($m['nextMeetingDate'] || $m['remarks']) {
            $this->need(14);
            $this->font('Helvetica-Bold', 8.5, self::DARK);
            if ($m['nextMeetingDate']) { $this->t('Next meeting: ' . $this->d($m['nextMeetingDate']), self::ML, $this->y); $this->y += 5.5; }
            if ($m['remarks']) {
                $this->t('Remarks:', self::ML, $this->y); $this->y += 4.5;
                $this->font('Helvetica', 8, '#374151');
                foreach ($this->wrap($m['remarks'], $this->cw) as $l) { $this->need(5); $this->t($l, self::ML, $this->y); $this->y += 4; }
            }
            $this->y += 3;
        }
        // ── signatures ──
        $this->need(26);
        $this->y += 12;
        $this->pdf->line($this->mm(self::ML), $this->mm($this->y), $this->mm(self::ML + 62), $this->mm($this->y), self::GREY, $this->mm(0.3));
        $this->pdf->line($this->mm($R - 62), $this->mm($this->y), $this->mm($R), $this->mm($this->y), self::GREY, $this->mm(0.3));
        $this->font('Helvetica-Bold', 8, self::DARK);
        $this->t('For ' . $m['customerName'], self::ML, $this->y + 2);
        $this->t('For ' . $c['name'], $R, $this->y + 2, ['align' => 'right']);
        // footer
        for ($i = 0; $i < $this->pdf->pageCount(); $i++) {
            $this->pdf->setActivePage($i);
            $this->font('Helvetica', 6.8, self::GREY);
            $this->t($m['momNo'] . '  ·  page ' . ($i + 1) . ' of ' . $this->pdf->pageCount(), self::A4_W / 2, self::A4_H - 10, ['align' => 'center']);
        }
        return $this->pdf;
    }
}
