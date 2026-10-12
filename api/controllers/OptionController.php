<?php
/**
 * Shared dropdown choices that users add themselves. When someone picks
 * "＋ Add new…" in a dropdown and types a new choice, it is saved here and
 * shows up in that dropdown for every user from then on.
 *
 *   GET  /api/options?list=meeting_status      → [{ value, label, createdBy }]
 *   POST /api/options                           { list, label } → the new choice
 *
 * Lists in use: meeting_status, meeting_type, meeting_priority.
 * Values are the label in UPPER_SNAKE_CASE ("Machine demo" → MACHINE_DEMO),
 * like the built-in ones, so the existing pages show them the same way.
 */
class OptionController
{
    public const LISTS = ['meeting_status', 'meeting_type', 'meeting_priority'];
    /** Longest value each list's column can hold (Meeting.status / meetingType are VARCHAR(40), followUpPriority VARCHAR(20)). */
    private const MAX = ['meeting_status' => 40, 'meeting_type' => 40, 'meeting_priority' => 20];

    public static function schema(): array
    {
        return ['DropdownOption' => ['create' => "CREATE TABLE IF NOT EXISTS `DropdownOption` (
  `id` VARCHAR(30) NOT NULL, `listKey` VARCHAR(40) NOT NULL, `value` VARCHAR(60) NOT NULL, `label` VARCHAR(80) NOT NULL,
  `createdById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `DropdownOption_list_value` (`listKey`, `value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]];
    }

    /** Values users added to $list (for validation and for the meta endpoints). */
    public static function values(string $list): array
    {
        try {
            ensure_schema(self::schema(), 'Dropdown options');
            $s = db()->prepare('SELECT value FROM `DropdownOption` WHERE listKey=? ORDER BY createdAt');
            $s->execute([$list]);
            return $s->fetchAll(PDO::FETCH_COLUMN);
        } catch (Throwable $e) { return []; }
    }

    public static function valueOf(string $label): string
    {
        $v = strtoupper(trim(preg_replace('/[^A-Za-z0-9]+/', '_', $label), '_'));
        return mb_substr($v, 0, 60);
    }

    public function index(): void
    {
        authenticate();
        ensure_schema(self::schema(), 'Dropdown options');
        $list = (string) qp('list', '');
        if (!in_array($list, self::LISTS, true)) sendError('Unknown list.', 400);
        $s = db()->prepare('SELECT o.value, o.label, o.createdAt, u.name AS createdBy FROM `DropdownOption` o LEFT JOIN `User` u ON u.id=o.createdById WHERE o.listKey=? ORDER BY o.createdAt');
        $s->execute([$list]);
        sendSuccess(['options' => $s->fetchAll()]);
    }

    public function create(): void
    {
        $auth = authenticate();
        ensure_schema(self::schema(), 'Dropdown options');
        $b = request_body();
        $list = (string) ($b['list'] ?? '');
        if (!in_array($list, self::LISTS, true)) sendError('Unknown list.', 400);
        $label = trim(preg_replace('/\s+/', ' ', (string) ($b['label'] ?? '')));
        if (mb_strlen($label) < 2) sendError('Type the new choice (at least 2 letters).', 400);
        $max = self::MAX[$list];
        if (mb_strlen($label) > $max) sendError("Keep the choice to $max letters or fewer.", 400);
        $value = mb_substr(self::valueOf($label), 0, $max);
        if ($value === '') sendError('Use letters or numbers for the new choice.', 400);
        $s = db()->prepare('SELECT value, label FROM `DropdownOption` WHERE listKey=? AND value=?'); $s->execute([$list, $value]);
        if ($ex = $s->fetch()) sendSuccess(['option' => $ex], 'Already in the list');
        db()->prepare('INSERT INTO `DropdownOption` (id,listKey,value,label,createdById,createdAt) VALUES (?,?,?,?,?,?)')
            ->execute([gen_id(), $list, $value, mb_substr($label, 0, 80), $auth['id'], now_sql()]);
        log_activity($auth['id'], 'DROPDOWN_OPTION_ADDED', 'DropdownOption', null, ['list' => $list, 'label' => $label]);
        sendSuccess(['option' => ['value' => $value, 'label' => $label]], 'Added for everyone', 201);
    }
}
