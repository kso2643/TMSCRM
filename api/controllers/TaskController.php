<?php
/**
 * Admin-assigned tasks, worked through as a per-person queue with a timer.
 *
 * A Super Admin / Admin assigns a task to someone. Each assignee has one
 * queue, ordered by queuePosition. They work it top-down:
 *
 *   QUEUED ──start──▶ IN_PROGRESS ──pause──▶ PAUSED ──resume──▶ IN_PROGRESS
 *                          │                                        │
 *                          └───────────────complete─────────────────┘──▶ COMPLETED
 *
 * Only the task at the head of the queue can be started, and only while the
 * person has nothing else in progress/paused — so completing one task is
 * what unlocks the next. `complete` can optionally start the next queued
 * task straight away (startNext=true).
 *
 * The timer is server-side: workedSeconds holds time from finished
 * segments, lastResumedAt marks when the running segment began. The
 * client just ticks elapsedSeconds forward between fetches.
 *
 * Visibility: assign/edit/delete/reorder need ADMIN or higher. Admin-tier
 * (incl. Manager) can see everyone's tasks; everyone else sees their own.
 * The assignee (or an admin) runs the timer.
 */
class TaskController
{
    private const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
    private const OPEN_STATUSES = ['QUEUED', 'IN_PROGRESS', 'PAUSED'];

    public function __construct()
    {
        ensure_schema(self::schema(), 'migration_tasks_price_requests.sql');
    }

    /** Kept in sync with database/migration_tasks_price_requests.sql. */
    public static function schema(): array
    {
        $cols = "
  `id`             VARCHAR(30)   NOT NULL,
  `title`          VARCHAR(255)  NOT NULL,
  `description`    TEXT              NULL,
  `assignedToId`   VARCHAR(30)   NOT NULL,
  `assignedById`   VARCHAR(30)   NOT NULL,
  `customerId`     VARCHAR(30)       NULL,
  `priority`       VARCHAR(10)   NOT NULL DEFAULT 'NORMAL',
  `status`         VARCHAR(20)   NOT NULL DEFAULT 'QUEUED',
  `queuePosition`  INT           NOT NULL DEFAULT 0,
  `dueDate`        DATE              NULL,
  `startedAt`      DATETIME          NULL,
  `lastResumedAt`  DATETIME          NULL,
  `workedSeconds`  INT           NOT NULL DEFAULT 0,
  `completedAt`    DATETIME          NULL,
  `completionNote` TEXT              NULL,
  `createdAt`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `AdminTask_assignedToId_status_idx` (`assignedToId`, `status`),
  KEY `AdminTask_queuePosition_idx` (`queuePosition`)";
        $fks = ",
  CONSTRAINT `AdminTask_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AdminTask_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE";
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        return [
            'AdminTask' => [
                'create'   => "CREATE TABLE IF NOT EXISTS `AdminTask` ($cols$fks\n$tail",
                'fallback' => "CREATE TABLE IF NOT EXISTS `AdminTask` ($cols\n$tail",
            ],
        ];
    }

    private function fetchRow(string $id): ?array
    {
        $s = db()->prepare(
            'SELECT t.*, a.name AS assignedToName, a.role AS assignedToRole, b.name AS assignedByName,
                    c.companyName AS customerName
             FROM `AdminTask` t
             LEFT JOIN `User` a ON a.id = t.assignedToId
             LEFT JOIN `User` b ON b.id = t.assignedById
             LEFT JOIN `Customer` c ON c.id = t.customerId
             WHERE t.id=? LIMIT 1'
        );
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function secondsSince(?string $sqlDateTime): int
    {
        if (!$sqlDateTime) return 0;
        try {
            return max(0, (new DateTime('now'))->getTimestamp() - (new DateTime($sqlDateTime))->getTimestamp());
        } catch (Exception $e) {
            return 0;
        }
    }

    private function shape(array $r): array
    {
        $elapsed = (int) $r['workedSeconds'];
        if ($r['status'] === 'IN_PROGRESS') $elapsed += self::secondsSince($r['lastResumedAt']);
        return [
            'id'             => $r['id'],
            'title'          => $r['title'],
            'description'    => $r['description'],
            'assignedTo'     => ['id' => $r['assignedToId'], 'name' => $r['assignedToName'], 'role' => $r['assignedToRole']],
            'assignedBy'     => ['id' => $r['assignedById'], 'name' => $r['assignedByName']],
            'customer'       => $r['customerId'] ? ['id' => $r['customerId'], 'companyName' => $r['customerName']] : null,
            'priority'       => $r['priority'],
            'status'         => $r['status'],
            'queuePosition'  => (int) $r['queuePosition'],
            'dueDate'        => $r['dueDate'],
            'startedAt'      => $r['startedAt'],
            'completedAt'    => $r['completedAt'],
            'completionNote' => $r['completionNote'],
            'elapsedSeconds' => $elapsed,
            'running'        => $r['status'] === 'IN_PROGRESS',
            'createdAt'      => $r['createdAt'],
            'updatedAt'      => $r['updatedAt'],
        ];
    }

    private function canRun(array $auth, array $row): bool
    {
        return $row['assignedToId'] === $auth['id'] || (ROLE_LEVELS[$auth['role']] ?? 0) >= ROLE_LEVELS['ADMIN'];
    }

    private function nextQueuePosition(string $userId): int
    {
        $s = db()->prepare("SELECT COALESCE(MAX(queuePosition),0) FROM `AdminTask` WHERE assignedToId=? AND status IN ('QUEUED','IN_PROGRESS','PAUSED')");
        $s->execute([$userId]);
        return (int) $s->fetchColumn() + 1;
    }

    /** The QUEUED task at the head of $userId's queue, or null. */
    private function headOfQueue(string $userId): ?array
    {
        $s = db()->prepare("SELECT id FROM `AdminTask` WHERE assignedToId=? AND status='QUEUED' ORDER BY queuePosition ASC, createdAt ASC LIMIT 1");
        $s->execute([$userId]);
        $id = $s->fetchColumn();
        return $id ? $this->fetchRow($id) : null;
    }

    /** $userId's task that is IN_PROGRESS or PAUSED (at most one), or null. */
    private function activeTask(string $userId, ?string $exceptId = null): ?array
    {
        $s = db()->prepare("SELECT id FROM `AdminTask` WHERE assignedToId=? AND status IN ('IN_PROGRESS','PAUSED') AND id<>? LIMIT 1");
        $s->execute([$userId, $exceptId ?? '']);
        $id = $s->fetchColumn();
        return $id ? $this->fetchRow($id) : null;
    }

    private function validatedAssignee(string $userId): void
    {
        $s = db()->prepare('SELECT id FROM `User` WHERE id=? AND isActive=1 LIMIT 1');
        $s->execute([$userId]);
        if (!$s->fetch()) sendError('Selected person not found or inactive.', 404);
    }

    private function validatedCustomer($customerId): ?string
    {
        $customerId = trim((string) ($customerId ?? ''));
        if ($customerId === '') return null;
        $s = db()->prepare('SELECT id FROM `Customer` WHERE id=? LIMIT 1');
        $s->execute([$customerId]);
        if (!$s->fetch()) sendError('Customer not found.', 404);
        return $customerId;
    }

    private function send(string $id, string $message = 'Success', int $code = 200, array $extra = []): void
    {
        $row = $this->fetchRow($id);
        if (!$row) sendError('Task not found.', 404);
        sendSuccess(array_merge(['task' => $this->shape($row)], $extra), $message, $code);
    }

    // GET /api/tasks/meta
    public function meta(): void
    {
        authenticate();
        sendSuccess(['priorities' => self::PRIORITIES, 'statuses' => ['QUEUED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED']]);
    }

    // GET /api/tasks/assignees — who a task can be assigned to (admin only)
    public function assignees(): void
    {
        $auth = authenticate();
        require_admin($auth);
        $s = db()->query("SELECT id, name, role, department FROM `User` WHERE isActive=1 ORDER BY name ASC");
        sendSuccess(['users' => $s->fetchAll()]);
    }

    // GET /api/tasks/overview — admin-tier. One row per active person: what
    // they're working on right now (with its live timer), whether it's
    // running or paused, how many tasks wait in their queue, and today's
    // totals. People with no tasks at all are included so idle staff show up.
    public function overview(): void
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Access denied.', 403);

        $users = db()->query("SELECT id, name, role, department FROM `User` WHERE isActive=1 ORDER BY name ASC")->fetchAll();

        // Current (in-progress or paused) task per person.
        $active = [];
        $s = db()->query(
            "SELECT t.*, a.name AS assignedToName, a.role AS assignedToRole, b.name AS assignedByName, c.companyName AS customerName
             FROM `AdminTask` t
             LEFT JOIN `User` a ON a.id = t.assignedToId
             LEFT JOIN `User` b ON b.id = t.assignedById
             LEFT JOIN `Customer` c ON c.id = t.customerId
             WHERE t.status IN ('IN_PROGRESS','PAUSED')"
        );
        foreach ($s->fetchAll() as $r) $active[$r['assignedToId']] = $this->shape($r);

        $queued = [];
        foreach (db()->query("SELECT assignedToId, COUNT(*) AS n FROM `AdminTask` WHERE status='QUEUED' GROUP BY assignedToId")->fetchAll() as $r) {
            $queued[$r['assignedToId']] = (int) $r['n'];
        }

        // Completed today, and the time recorded on them.
        $today = (new DateTime('now'))->format('Y-m-d');
        $done = [];
        $d = db()->prepare(
            "SELECT assignedToId, COUNT(*) AS n, COALESCE(SUM(workedSeconds),0) AS secs FROM `AdminTask`
             WHERE status='COMPLETED' AND completedAt >= ? AND completedAt < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY assignedToId"
        );
        $d->execute([$today, $today]);
        foreach ($d->fetchAll() as $r) $done[$r['assignedToId']] = ['n' => (int) $r['n'], 'secs' => (int) $r['secs']];

        $people = [];
        foreach ($users as $u) {
            $cur = $active[$u['id']] ?? null;
            $people[] = [
                'user'               => $u,
                'current'            => $cur,
                'state'              => $cur ? ($cur['running'] ? 'RUNNING' : 'PAUSED') : (($queued[$u['id']] ?? 0) ? 'WAITING' : 'IDLE'),
                'queuedCount'        => $queued[$u['id']] ?? 0,
                'completedToday'     => $done[$u['id']]['n'] ?? 0,
                // Time on tasks finished today plus the current task's timer so far.
                'secondsToday'       => ($done[$u['id']]['secs'] ?? 0) + ($cur ? $cur['elapsedSeconds'] : 0),
            ];
        }
        // Running first, then paused, waiting, idle; alphabetical within each.
        $rank = ['RUNNING' => 0, 'PAUSED' => 1, 'WAITING' => 2, 'IDLE' => 3];
        usort($people, fn($a, $b) => [$rank[$a['state']], $a['user']['name']] <=> [$rank[$b['state']], $b['user']['name']]);

        sendSuccess(['people' => $people]);
    }

    // GET /api/tasks?assignedToId=&status=open|completed|<STATUS>&mine=1
    public function index(): void
    {
        $auth = authenticate();
        $where = []; $params = [];

        $seeAll = is_admin_tier($auth['role']) && !qp('mine');
        if (!$seeAll) { $where[] = 't.assignedToId=?'; $params[] = $auth['id']; }
        elseif (qp('assignedToId')) { $where[] = 't.assignedToId=?'; $params[] = qp('assignedToId'); }

        $status = strtoupper((string) qp('status', 'OPEN'));
        if ($status === 'OPEN') {
            $where[] = "t.status IN ('QUEUED','IN_PROGRESS','PAUSED')";
        } elseif ($status !== 'ALL') {
            $where[] = 't.status=?'; $params[] = $status;
        }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $limit = max(1, min(500, (int) qp('limit', 200)));

        $s = db()->prepare(
            "SELECT t.*, a.name AS assignedToName, a.role AS assignedToRole, b.name AS assignedByName, c.companyName AS customerName
             FROM `AdminTask` t
             LEFT JOIN `User` a ON a.id = t.assignedToId
             LEFT JOIN `User` b ON b.id = t.assignedById
             LEFT JOIN `Customer` c ON c.id = t.customerId
             $w
             ORDER BY a.name ASC,
                      FIELD(t.status,'IN_PROGRESS','PAUSED','QUEUED','COMPLETED'),
                      CASE WHEN t.status='COMPLETED' THEN NULL ELSE t.queuePosition END ASC,
                      t.completedAt DESC, t.createdAt ASC
             LIMIT $limit"
        );
        $s->execute($params);
        sendSuccess(['tasks' => array_map(fn($r) => $this->shape($r), $s->fetchAll())]);
    }

    // POST /api/tasks  (admin) — appended to the end of the assignee's queue
    public function create(): void
    {
        $auth = authenticate();
        require_admin($auth);
        $b = request_body();

        $title = trim((string) ($b['title'] ?? ''));
        if ($title === '') sendError('Please give the task a title.', 400);
        $assignedToId = trim((string) ($b['assignedToId'] ?? ''));
        if ($assignedToId === '') sendError('Please choose who this task is for.', 400);
        $this->validatedAssignee($assignedToId);
        $priority = strtoupper(trim((string) ($b['priority'] ?? 'NORMAL')));
        if (!in_array($priority, self::PRIORITIES, true)) sendError('priority must be one of: ' . implode(', ', self::PRIORITIES), 400);

        $id = gen_id();
        db()->prepare(
            'INSERT INTO `AdminTask` (id,title,description,assignedToId,assignedById,customerId,priority,status,queuePosition,dueDate,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,\'QUEUED\',?,?,?,?)'
        )->execute([
            $id, $title, bp_trim($b, 'description'), $assignedToId, $auth['id'], $this->validatedCustomer($b['customerId'] ?? null),
            $priority, $this->nextQueuePosition($assignedToId), to_date_only($b['dueDate'] ?? null), now_sql(), now_sql(),
        ]);

        log_activity($auth['id'], 'TASK_ASSIGNED', 'AdminTask', $id, ['title' => $title, 'assignedToId' => $assignedToId]);
        $this->send($id, 'Task assigned', 201);
    }

    // PUT /api/tasks/:id  (admin) — edit details; reassigning moves it to the end of the new person's queue
    public function update(string $id): void
    {
        $auth = authenticate();
        require_admin($auth);
        $row = $this->fetchRow($id);
        if (!$row) sendError('Task not found.', 404);
        $b = request_body();

        $title = bp_has($b, 'title') ? trim((string) $b['title']) : $row['title'];
        if ($title === '') sendError('Please give the task a title.', 400);
        $priority = bp_has($b, 'priority') ? strtoupper(trim((string) $b['priority'])) : $row['priority'];
        if (!in_array($priority, self::PRIORITIES, true)) sendError('priority must be one of: ' . implode(', ', self::PRIORITIES), 400);
        $description = bp_has($b, 'description') ? bp_trim($b, 'description') : $row['description'];
        $dueDate = bp_has($b, 'dueDate') ? to_date_only($b['dueDate']) : $row['dueDate'];
        $customerId = bp_has($b, 'customerId') ? $this->validatedCustomer($b['customerId']) : $row['customerId'];

        $assignedToId = $row['assignedToId']; $queuePosition = (int) $row['queuePosition'];
        if (bp_has($b, 'assignedToId') && trim((string) $b['assignedToId']) !== $row['assignedToId']) {
            if ($row['status'] !== 'QUEUED') sendError('Only a task that has not been started can be reassigned.', 400);
            $assignedToId = trim((string) $b['assignedToId']);
            $this->validatedAssignee($assignedToId);
            $queuePosition = $this->nextQueuePosition($assignedToId);
        }

        db()->prepare(
            'UPDATE `AdminTask` SET title=?,description=?,assignedToId=?,customerId=?,priority=?,queuePosition=?,dueDate=?,updatedAt=? WHERE id=?'
        )->execute([$title, $description, $assignedToId, $customerId, $priority, $queuePosition, $dueDate, now_sql(), $id]);

        log_activity($auth['id'], 'TASK_UPDATED', 'AdminTask', $id, []);
        $this->send($id, 'Task updated');
    }

    // DELETE /api/tasks/:id  (admin)
    public function delete(string $id): void
    {
        $auth = authenticate();
        require_admin($auth);
        $row = $this->fetchRow($id);
        if (!$row) sendError('Task not found.', 404);
        db()->prepare('DELETE FROM `AdminTask` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'TASK_DELETED', 'AdminTask', $id, ['title' => $row['title']]);
        sendSuccess([], 'Task deleted');
    }

    // PATCH /api/tasks/:id/move  (admin) — body { direction: up|down }, swaps with the neighbouring queued task
    public function move(string $id): void
    {
        $auth = authenticate();
        require_admin($auth);
        $row = $this->fetchRow($id);
        if (!$row) sendError('Task not found.', 404);
        if ($row['status'] !== 'QUEUED') sendError('Only queued tasks can be reordered.', 400);

        $dir = strtolower((string) (request_body()['direction'] ?? ''));
        if (!in_array($dir, ['up', 'down'], true)) sendError('direction must be up or down.', 400);

        // Normalise positions first so ties (legacy/duplicate positions) can't make a swap a no-op.
        $s = db()->prepare("SELECT id FROM `AdminTask` WHERE assignedToId=? AND status='QUEUED' ORDER BY queuePosition ASC, createdAt ASC");
        $s->execute([$row['assignedToId']]);
        $ids = $s->fetchAll(PDO::FETCH_COLUMN);
        $i = array_search($id, $ids, true);
        $j = $dir === 'up' ? $i - 1 : $i + 1;
        if ($j >= 0 && $j < count($ids)) {
            [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        }
        // Queued tasks sit after any active one, which keeps position 0.
        $upd = db()->prepare('UPDATE `AdminTask` SET queuePosition=? WHERE id=?');
        foreach ($ids as $pos => $taskId) $upd->execute([$pos + 1, $taskId]);

        $this->send($id, 'Queue updated');
    }

    // PATCH /api/tasks/:id/start — only the head of the queue, and only with nothing else active
    public function start(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Task not found.', 404);
        if (!$this->canRun($auth, $row)) sendError('Only the assigned person can start this task.', 403);
        $this->startRow($row);
        log_activity($auth['id'], 'TASK_STARTED', 'AdminTask', $id, []);
        $this->send($id, 'Task started');
    }

    /** Shared by start() and complete(startNext). Halts with an error if $row can't be started. */
    private function startRow(array $row): void
    {
        if ($row['status'] !== 'QUEUED') sendError('This task has already been started.', 400);
        $active = $this->activeTask($row['assignedToId']);
        if ($active) sendError('Finish "' . $active['title'] . '" first — only one task can be in progress at a time.', 400);
        $head = $this->headOfQueue($row['assignedToId']);
        if ($head && $head['id'] !== $row['id']) sendError('Tasks are worked in queue order — "' . $head['title'] . '" is next.', 400);

        $now = now_sql();
        db()->prepare("UPDATE `AdminTask` SET status='IN_PROGRESS',startedAt=?,lastResumedAt=?,queuePosition=0,updatedAt=? WHERE id=?")
            ->execute([$now, $now, $now, $row['id']]);
    }

    // PATCH /api/tasks/:id/pause
    public function pause(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Task not found.', 404);
        if (!$this->canRun($auth, $row)) sendError('Only the assigned person can pause this task.', 403);
        if ($row['status'] !== 'IN_PROGRESS') sendError('Only a running task can be paused.', 400);

        $worked = (int) $row['workedSeconds'] + self::secondsSince($row['lastResumedAt']);
        db()->prepare("UPDATE `AdminTask` SET status='PAUSED',workedSeconds=?,lastResumedAt=NULL,updatedAt=? WHERE id=?")
            ->execute([$worked, now_sql(), $id]);
        log_activity($auth['id'], 'TASK_PAUSED', 'AdminTask', $id, []);
        $this->send($id, 'Task paused');
    }

    // PATCH /api/tasks/:id/resume
    public function resume(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Task not found.', 404);
        if (!$this->canRun($auth, $row)) sendError('Only the assigned person can resume this task.', 403);
        if ($row['status'] !== 'PAUSED') sendError('Only a paused task can be resumed.', 400);

        $now = now_sql();
        db()->prepare("UPDATE `AdminTask` SET status='IN_PROGRESS',lastResumedAt=?,updatedAt=? WHERE id=?")->execute([$now, $now, $id]);
        log_activity($auth['id'], 'TASK_RESUMED', 'AdminTask', $id, []);
        $this->send($id, 'Task resumed');
    }

    // PATCH /api/tasks/:id/complete — body { note?, startNext? }
    public function complete(string $id): void
    {
        $auth = authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Task not found.', 404);
        if (!$this->canRun($auth, $row)) sendError('Only the assigned person can complete this task.', 403);
        if (!in_array($row['status'], ['IN_PROGRESS', 'PAUSED'], true)) sendError('Start the task before completing it.', 400);

        $b = request_body();
        $worked = (int) $row['workedSeconds'] + ($row['status'] === 'IN_PROGRESS' ? self::secondsSince($row['lastResumedAt']) : 0);
        $now = now_sql();
        db()->prepare(
            "UPDATE `AdminTask` SET status='COMPLETED',workedSeconds=?,lastResumedAt=NULL,completedAt=?,completionNote=?,updatedAt=? WHERE id=?"
        )->execute([$worked, $now, bp_trim($b, 'note'), $now, $id]);
        log_activity($auth['id'], 'TASK_COMPLETED', 'AdminTask', $id, ['workedSeconds' => $worked]);

        $next = $this->headOfQueue($row['assignedToId']);
        if ($next && bool_val($b['startNext'] ?? false)) {
            $this->startRow($next);
            log_activity($auth['id'], 'TASK_STARTED', 'AdminTask', $next['id'], []);
            $next = $this->fetchRow($next['id']);
        }
        $this->send($id, 'Task completed', 200, ['nextTask' => $next ? $this->shape($next) : null]);
    }
}
