<?php
/**
 * Tool trials — request → approval with recommendation → savings report.
 *
 *   PENDING_APPROVAL ──approve──▶ APPROVED ──savings submitted──▶ COMPLETED
 *          │
 *          └──reject──▶ REJECTED   (requester can edit the data and resubmit)
 *
 * 1. An engineer raises a trial request and must fill the "Existing situation
 *    data analysis" (the EDA sheet, stored as its JSON in existingData).
 * 2. A Super Admin / Admin approves it with one or more recommendation lines:
 *    category CUTTER | INSERT | KEY | DRILL | TAP, plus a spec — and for an
 *    INSERT both spec and grade are required — or rejects it with a reason.
 * 3. After the trial, the engineer fills the "Trial comparison / cost
 *    savings report" (the TCR sheet, stored as JSON in savingsData).
 *    Submitting it completes the trial; a short summary (best tool, saving
 *    per year, %) is kept on the row for the list view.
 *
 * Both sheets are the customer-facing HTML tool (crm/trial-sheet/index.html),
 * embedded by crm/trials-app.js — this API only stores their JSON.
 *
 * Visibility: everyone sees their own trials; admin-tier (incl. Manager)
 * sees all. Approve/reject needs ADMIN or higher.
 */
class TrialController
{
    private const CATEGORIES = ['CUTTER', 'INSERT', 'KEY', 'DRILL', 'TAP'];
    private const STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED'];
    private const MAX_JSON_BYTES = 12 * 1024 * 1024; // sheets carry up to 4 resized photos

    public function __construct()
    {
        ensure_schema(self::schema(), 'migration_trials.sql');
    }

    private static function company($v, string $fallback = 'TMS'): string
    {
        $v = strtoupper(trim((string) $v));
        return in_array($v, ['TMS', 'APJ'], true) ? $v : $fallback;
    }

    /** Kept in sync with database/migration_trials.sql. */
    public static function schema(): array
    {
        $cols = "
  `id`               VARCHAR(30)   NOT NULL,
  `trialNo`          VARCHAR(30)   NOT NULL,
  `customerId`       VARCHAR(30)       NULL,
  `customerName`     VARCHAR(255)      NULL,
  `component`        VARCHAR(255)      NULL,
  `requestedById`    VARCHAR(30)   NOT NULL,
  `status`           VARCHAR(20)   NOT NULL DEFAULT 'PENDING_APPROVAL',
  `existingData`     LONGTEXT          NULL,
  `recommendations`  TEXT              NULL,
  `approvalNote`     TEXT              NULL,
  `decidedById`      VARCHAR(30)       NULL,
  `decidedAt`        DATETIME          NULL,
  `savingsData`      LONGTEXT          NULL,
  `savingsPerYear`   DECIMAL(16,2)     NULL,
  `savingsPct`       DECIMAL(7,2)      NULL,
  `bestTool`         VARCHAR(255)      NULL,
  `completedAt`      DATETIME          NULL,
  `createdAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Trial_trialNo_key` (`trialNo`),
  KEY `Trial_requestedById_idx` (`requestedById`),
  KEY `Trial_status_idx` (`status`)";
        $fks = ",
  CONSTRAINT `Trial_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE";
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        return [
            'Trial' => [
                'create'   => "CREATE TABLE IF NOT EXISTS `Trial` ($cols$fks\n$tail",
                'fallback' => "CREATE TABLE IF NOT EXISTS `Trial` ($cols\n$tail",
                // Which company runs the trial — decides the logo on the sheets (TMS / APJ).
                'columns'  => ['company' => "VARCHAR(10) NOT NULL DEFAULT 'TMS'"],
            ],
        ];
    }

    private const SELECT = 'SELECT t.*, u.name AS requestedByName, u.role AS requestedByRole, d.name AS decidedByName,
                                   c.companyName AS linkedCompanyName
                            FROM `Trial` t
                            LEFT JOIN `User` u ON u.id = t.requestedById
                            LEFT JOIN `User` d ON d.id = t.decidedById
                            LEFT JOIN `Customer` c ON c.id = t.customerId';

    private function fetchRow(string $id): ?array
    {
        $s = db()->prepare(self::SELECT . ' WHERE t.id=? LIMIT 1');
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function isManager(array $auth): bool
    {
        return (ROLE_LEVELS[$auth['role']] ?? 0) >= ROLE_LEVELS['ADMIN'];
    }

    private function canSee(array $auth, array $row): bool
    {
        return is_admin_tier($auth['role']) || $row['requestedById'] === $auth['id'];
    }

    private function canEdit(array $auth, array $row): bool
    {
        return self::isManager($auth) || $row['requestedById'] === $auth['id'];
    }

    private function shape(array $r, bool $full): array
    {
        $out = [
            'id'             => $r['id'],
            'trialNo'        => $r['trialNo'],
            'customer'       => ['id' => $r['customerId'], 'name' => $r['linkedCompanyName'] ?: $r['customerName']],
            'component'      => $r['component'],
            'company'        => $r['company'] ?? 'TMS',
            'requestedBy'    => ['id' => $r['requestedById'], 'name' => $r['requestedByName'], 'role' => $r['requestedByRole']],
            'status'         => $r['status'],
            'recommendations'=> $r['recommendations'] ? (json_decode($r['recommendations'], true) ?: []) : [],
            'approvalNote'   => $r['approvalNote'],
            'decidedBy'      => $r['decidedById'] ? ['id' => $r['decidedById'], 'name' => $r['decidedByName']] : null,
            'decidedAt'      => $r['decidedAt'],
            'hasSavings'     => $r['savingsData'] !== null && $r['savingsData'] !== '',
            'savingsPerYear' => $r['savingsPerYear'] !== null ? (float) $r['savingsPerYear'] : null,
            'savingsPct'     => $r['savingsPct'] !== null ? (float) $r['savingsPct'] : null,
            'bestTool'       => $r['bestTool'],
            'completedAt'    => $r['completedAt'],
            'createdAt'      => $r['createdAt'],
            'updatedAt'      => $r['updatedAt'],
        ];
        if ($full) {
            $out['existingData'] = $r['existingData'] ? json_decode($r['existingData'], true) : null;
            $out['savingsData'] = $r['savingsData'] ? json_decode($r['savingsData'], true) : null;
        }
        return $out;
    }

    /** Validates a sheet's JSON (array from a JSON body) and returns it re-encoded. */
    private static function sheetJson($sheet, string $kind, string $label): string
    {
        if (!is_array($sheet) || ($sheet['kind'] ?? '') !== $kind) sendError("Please fill in the $label sheet.", 400);
        $json = json_encode($sheet, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) sendError("The $label sheet could not be read.", 400);
        if (strlen($json) > self::MAX_JSON_BYTES) sendError("The $label sheet is too large — try fewer or smaller photos.", 400);
        return $json;
    }

    /** Pulls the customer/component headline out of the EDA sheet for the list. */
    private static function headline(array $eda): array
    {
        $cust = trim((string) ($eda['customer'] ?? ''));
        $comp = trim((string) ($eda['component'] ?? ''));
        return [$cust !== '' ? mb_substr($cust, 0, 255) : null, $comp !== '' ? mb_substr($comp, 0, 255) : null];
    }

    private function validatedCustomer($id): ?string
    {
        $id = trim((string) ($id ?? ''));
        if ($id === '') return null;
        $s = db()->prepare('SELECT id FROM `Customer` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        if (!$s->fetch()) sendError('Customer not found.', 404);
        return $id;
    }

    private function nextTrialNo(): string
    {
        $prefix = 'TR-' . (new DateTime('now'))->format('Y') . '-';
        $s = db()->prepare('SELECT trialNo FROM `Trial` WHERE trialNo LIKE ? ORDER BY trialNo DESC LIMIT 1');
        $s->execute([$prefix . '%']);
        $last = $s->fetchColumn();
        $n = $last ? ((int) substr($last, strlen($prefix))) + 1 : 1;
        return $prefix . str_pad((string) $n, 3, '0', STR_PAD_LEFT);
    }

    private function send(string $id, string $message = 'Success', int $code = 200): void
    {
        sendSuccess(['trial' => $this->shape($this->fetchRow($id), true)], $message, $code);
    }

    // GET /api/trials/meta
    public function meta(): void
    {
        authenticate();
        sendSuccess(['categories' => self::CATEGORIES, 'statuses' => self::STATUSES]);
    }

    // GET /api/trials?status=&mine=1&search=
    public function index(): void
    {
        $auth = authenticate();
        $scope = []; $sp = [];
        if (!is_admin_tier($auth['role']) || qp('mine')) { $scope[] = 't.requestedById=?'; $sp[] = $auth['id']; }
        if (qp('search')) {
            $like = '%' . qp('search') . '%';
            $scope[] = '(t.trialNo LIKE ? OR t.customerName LIKE ? OR c.companyName LIKE ? OR t.component LIKE ?)';
            array_push($sp, $like, $like, $like, $like);
        }
        $where = $scope; $params = $sp;
        $status = strtoupper((string) qp('status', 'ALL'));
        if ($status !== 'ALL') {
            if (!in_array($status, self::STATUSES, true)) sendError('Unknown status filter.', 400);
            $where[] = 't.status=?'; $params[] = $status;
        }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $s = db()->prepare(self::SELECT . " $w ORDER BY FIELD(t.status,'PENDING_APPROVAL','APPROVED','REJECTED','COMPLETED'), t.createdAt DESC LIMIT 300");
        $s->execute($params);
        $rows = $s->fetchAll();

        $sw = $scope ? 'WHERE ' . implode(' AND ', $scope) : '';
        $c = db()->prepare("SELECT t.status, COUNT(*) AS n FROM `Trial` t LEFT JOIN `Customer` c ON c.id = t.customerId $sw GROUP BY t.status");
        $c->execute($sp);
        $counts = array_fill_keys(self::STATUSES, 0);
        foreach ($c->fetchAll() as $r) {
            $r = array_change_key_case($r, CASE_LOWER);
            if (isset($counts[$r['status']])) $counts[$r['status']] = (int) $r['n'];
        }
        sendSuccess(['trials' => array_map(fn($r) => $this->shape($r, false), $rows), 'counts' => $counts]);
    }

    // GET /api/trials/:id
    public function show(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row || !$this->canSee($auth, $row)) sendError('Trial not found.', 404);
        $this->send($id);
    }

    // POST /api/trials — body { customerId?, existingData: <EDA sheet JSON> }
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();
        $eda = $b['existingData'] ?? null;
        $json = self::sheetJson($eda, 'eda', 'existing situation data analysis');
        [$custName, $component] = self::headline($eda);
        if (!$custName && empty($b['customerId'])) sendError('Please enter the customer name in the existing data sheet.', 400);
        if (!$component) sendError('Please enter the component name in the existing data sheet.', 400);
        $customerId = $this->validatedCustomer($b['customerId'] ?? null);

        $id = gen_id();
        // The trial number doubles as the sheet's report number.
        for ($attempt = 0; $attempt < 3; $attempt++) {
            $trialNo = $this->nextTrialNo();
            $eda['reportNo'] = $trialNo;
            $json = self::sheetJson($eda, 'eda', 'existing situation data analysis');
            try {
                db()->prepare(
                    'INSERT INTO `Trial` (id,trialNo,customerId,customerName,component,company,requestedById,status,existingData,createdAt,updatedAt)
                     VALUES (?,?,?,?,?,?,?,\'PENDING_APPROVAL\',?,?,?)'
                )->execute([$id, $trialNo, $customerId, $custName, $component, self::company($b['company'] ?? ''), $auth['id'], $json, now_sql(), now_sql()]);
                break;
            } catch (PDOException $e) {
                if ($attempt === 2 || $e->getCode() !== '23000') throw $e; // retry only a trialNo collision
            }
        }

        log_activity($auth['id'], 'TRIAL_REQUESTED', 'Trial', $id, ['trialNo' => $trialNo, 'customer' => $custName]);
        $this->send($id, 'Trial request raised', 201);
    }

    // PATCH /api/trials/:id/company — body { company: TMS|APJ }; the logo on both sheets follows it.
    public function setCompany(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row || !$this->canSee($auth, $row)) sendError('Trial not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to edit this trial.', 403);
        $b = request_body();
        $co = strtoupper(trim((string) ($b['company'] ?? '')));
        if (!in_array($co, ['TMS', 'APJ'], true)) sendError('Company must be TMS or APJ.', 400);
        db()->prepare('UPDATE `Trial` SET company=?,updatedAt=? WHERE id=?')->execute([$co, now_sql(), $id]);
        $this->send($id, 'Company set to ' . $co);
    }

    // PUT /api/trials/:id/existing — body { existingData, customerId? }
    // Editable while waiting for approval or after a rejection (editing a
    // rejected request resubmits it). Admins may also correct it later.
    public function updateExisting(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row || !$this->canSee($auth, $row)) sendError('Trial not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to edit this trial.', 403);
        if (!self::isManager($auth) && !in_array($row['status'], ['PENDING_APPROVAL', 'REJECTED'], true)) {
            sendError('The existing data is locked once the trial is approved.', 400);
        }
        $b = request_body();
        $eda = $b['existingData'] ?? null;
        if (is_array($eda)) $eda['reportNo'] = $row['trialNo'];
        $json = self::sheetJson($eda, 'eda', 'existing situation data analysis');
        [$custName, $component] = self::headline($eda);
        if (!$component) sendError('Please enter the component name in the existing data sheet.', 400);
        $customerId = array_key_exists('customerId', $b) ? $this->validatedCustomer($b['customerId']) : $row['customerId'];

        $resubmit = $row['status'] === 'REJECTED';
        db()->prepare(
            'UPDATE `Trial` SET existingData=?,customerId=?,customerName=?,component=?,company=?,status=?,updatedAt=? WHERE id=?'
        )->execute([$json, $customerId, $custName, $component, self::company($b['company'] ?? '', $row['company'] ?? 'TMS'), $resubmit ? 'PENDING_APPROVAL' : $row['status'], now_sql(), $id]);

        log_activity($auth['id'], $resubmit ? 'TRIAL_RESUBMITTED' : 'TRIAL_EXISTING_UPDATED', 'Trial', $id, []);
        $this->send($id, $resubmit ? 'Trial request resubmitted' : 'Existing data saved');
    }

    /** Validates the recommendation lines; INSERT needs spec + grade, the rest need a spec. */
    private static function recommendations($raw): array
    {
        if (!is_array($raw) || !$raw) sendError('Add at least one recommendation.', 400);
        $out = [];
        foreach (array_values($raw) as $i => $line) {
            $n = $i + 1;
            $cat = strtoupper(trim((string) ($line['category'] ?? '')));
            if (!in_array($cat, self::CATEGORIES, true)) sendError("Recommendation $n: choose a category.", 400);
            $spec = trim((string) ($line['spec'] ?? ''));
            $grade = trim((string) ($line['grade'] ?? ''));
            $qty = trim((string) ($line['quantity'] ?? ''));
            if ($spec === '') sendError("Recommendation $n: enter the " . ($cat === 'INSERT' ? 'insert spec' : 'spec / description') . '.', 400);
            if ($cat === 'INSERT' && $grade === '') sendError("Recommendation $n: enter the insert grade.", 400);
            if ($qty !== '' && (!is_numeric($qty) || (float) $qty <= 0)) sendError("Recommendation $n: quantity must be a positive number.", 400);
            $out[] = [
                'category' => $cat,
                'spec'     => mb_substr($spec, 0, 255),
                'grade'    => $grade !== '' ? mb_substr($grade, 0, 100) : null,
                'quantity' => $qty !== '' ? (float) $qty : null,
                'notes'    => ($nt = trim((string) ($line['notes'] ?? ''))) !== '' ? mb_substr($nt, 0, 500) : null,
            ];
        }
        return $out;
    }

    // PATCH /api/trials/:id/approve (admin) — body { recommendations: [...], note? }
    public function approve(string $id): void
    {
        $auth = authenticate();
        require_admin($auth);
        $row = $this->fetchRow($id);
        if (!$row) sendError('Trial not found.', 404);
        if (!in_array($row['status'], ['PENDING_APPROVAL', 'APPROVED'], true)) sendError('Only a pending trial can be approved.', 400);
        $b = request_body();
        $recs = self::recommendations($b['recommendations'] ?? null);

        db()->prepare(
            "UPDATE `Trial` SET status='APPROVED',recommendations=?,approvalNote=?,decidedById=?,decidedAt=?,updatedAt=? WHERE id=?"
        )->execute([json_encode($recs, JSON_UNESCAPED_UNICODE), bp_trim($b, 'note'), $auth['id'], now_sql(), now_sql(), $id]);

        log_activity($auth['id'], 'TRIAL_APPROVED', 'Trial', $id, ['recommendations' => count($recs)]);
        $this->send($id, 'Trial approved');
    }

    // PATCH /api/trials/:id/reject (admin) — body { note }
    public function reject(string $id): void
    {
        $auth = authenticate();
        require_admin($auth);
        $row = $this->fetchRow($id);
        if (!$row) sendError('Trial not found.', 404);
        if ($row['status'] !== 'PENDING_APPROVAL') sendError('Only a pending trial can be rejected.', 400);
        $note = bp_trim(request_body(), 'note');
        if (!$note) sendError('Please give a reason for rejecting the trial.', 400);

        db()->prepare(
            "UPDATE `Trial` SET status='REJECTED',approvalNote=?,decidedById=?,decidedAt=?,updatedAt=? WHERE id=?"
        )->execute([$note, $auth['id'], now_sql(), now_sql(), $id]);

        log_activity($auth['id'], 'TRIAL_REJECTED', 'Trial', $id, []);
        $this->send($id, 'Trial rejected');
    }

    // PUT /api/trials/:id/savings — body { savingsData, summary?: {bestTool, savingsPerYear, savingsPct}, complete?: bool }
    public function updateSavings(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row || !$this->canSee($auth, $row)) sendError('Trial not found.', 404);
        if (!$this->canEdit($auth, $row)) sendError('Not authorized to edit this trial.', 403);
        if (!in_array($row['status'], ['APPROVED', 'COMPLETED'], true)) sendError('The savings report opens once the trial is approved.', 400);

        $b = request_body();
        $cmp = $b['savingsData'] ?? null;
        if (is_array($cmp) && empty($cmp['reportNo'])) $cmp['reportNo'] = $row['trialNo'] . '-SR';
        $json = self::sheetJson($cmp, 'cmp', 'cost savings report');
        $sum = is_array($b['summary'] ?? null) ? $b['summary'] : [];
        $num = fn($v) => (is_numeric($v) && is_finite((float) $v)) ? round((float) $v, 2) : null;
        $complete = bool_val($b['complete'] ?? false) || $row['status'] === 'COMPLETED';

        db()->prepare(
            'UPDATE `Trial` SET savingsData=?,bestTool=?,savingsPerYear=?,savingsPct=?,status=?,completedAt=?,updatedAt=? WHERE id=?'
        )->execute([
            $json,
            isset($sum['bestTool']) && trim((string) $sum['bestTool']) !== '' ? mb_substr(trim((string) $sum['bestTool']), 0, 255) : null,
            $num($sum['savingsPerYear'] ?? null), $num($sum['savingsPct'] ?? null),
            $complete ? 'COMPLETED' : 'APPROVED',
            $complete ? ($row['completedAt'] ?: now_sql()) : null,
            now_sql(), $id,
        ]);

        log_activity($auth['id'], $complete && $row['status'] !== 'COMPLETED' ? 'TRIAL_COMPLETED' : 'TRIAL_SAVINGS_UPDATED', 'Trial', $id, []);
        $this->send($id, $complete ? 'Savings report submitted — trial completed' : 'Savings report saved');
    }

    // DELETE /api/trials/:id — requester while pending/rejected, or admin
    public function delete(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row || !$this->canSee($auth, $row)) sendError('Trial not found.', 404);
        if (!self::isManager($auth) && !($row['requestedById'] === $auth['id'] && in_array($row['status'], ['PENDING_APPROVAL', 'REJECTED'], true))) {
            sendError('Only a pending or rejected request you raised can be deleted.', 403);
        }
        db()->prepare('DELETE FROM `Trial` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'TRIAL_DELETED', 'Trial', $id, ['trialNo' => $row['trialNo']]);
        sendSuccess([], 'Trial deleted');
    }
}
