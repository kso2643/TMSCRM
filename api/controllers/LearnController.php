<?php
/**
 * Engineer notes (v11.46) — learning progress, daily quizzes, technical news and raw-material prices.
 *
 *   GET  /api/learn/me                    my topics read, quiz history, streak, today's plan
 *   POST /api/learn/read     {topicId}    mark a topic as read today
 *   POST /api/learn/plan     {topics[]}   today's topics to learn
 *   POST /api/learn/quiz     {topics[], total, correct, answers[]}  save a quiz result
 *   GET  /api/learn/team                  (Super Admin / Admin / Manager) everyone's learning and scores
 *   GET  /api/learn/market                prices (latest + 30-day history) and news; refreshes once a day after midnight
 *   PUT  /api/learn/prices   {prices:[{item, price, date?}]}   (Super Admin / Admin) enter today's prices
 *   GET  /api/learn/cron?key=…            the hosting panel calls this at 00:00 — refreshes news and the USD/INR rate
 *
 * News comes from public Google News RSS searches. Carbide / tungsten / metal prices have no free
 * public feed, so they are entered by an admin (the board shows the date of each price); the USD → INR
 * rate is fetched automatically from a free exchange-rate service.
 */
class LearnController
{
    public const ITEMS = [
        ['key' => 'wc-in',  'label' => 'Tungsten carbide powder — India', 'unit' => '₹/kg'],
        ['key' => 'wc-us',  'label' => 'Tungsten carbide powder — USA', 'unit' => '$/kg'],
        ['key' => 'apt',    'label' => 'Tungsten APT (Europe / China)', 'unit' => '$/mtu'],
        ['key' => 'cobalt', 'label' => 'Cobalt', 'unit' => '$/kg'],
        ['key' => 'nickel', 'label' => 'Nickel (LME)', 'unit' => '$/t'],
        ['key' => 'alu',    'label' => 'Aluminium (LME)', 'unit' => '$/t'],
        ['key' => 'copper', 'label' => 'Copper (LME)', 'unit' => '$/t'],
        ['key' => 'steel-in', 'label' => 'Steel HR coil — India', 'unit' => '₹/t'],
        ['key' => 'usdinr', 'label' => 'US dollar → rupee', 'unit' => '₹', 'auto' => true],
    ];
    private const FEEDS = [
        'cutting tools India' => 'https://news.google.com/rss/search?q=%22cutting+tools%22+India&hl=en-IN&gl=IN&ceid=IN:en',
        'carbide & tungsten'  => 'https://news.google.com/rss/search?q=tungsten+carbide+price&hl=en-IN&gl=IN&ceid=IN:en',
        'machine tools'       => 'https://news.google.com/rss/search?q=%22machine+tools%22+OR+CNC+manufacturing+India&hl=en-IN&gl=IN&ceid=IN:en',
    ];

    public function __construct()
    {
        $t = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        ensure_schema([
            'LearnRead' => ['create' => "CREATE TABLE IF NOT EXISTS `LearnRead` (`id` VARCHAR(30) NOT NULL, `userId` VARCHAR(30) NOT NULL, `topicId` VARCHAR(30) NOT NULL,
                `day` DATE NOT NULL, `createdAt` DATETIME NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `LearnRead_u` (`userId`,`topicId`,`day`), KEY `LearnRead_user` (`userId`,`day`)$t"],
            'QuizAttempt' => ['create' => "CREATE TABLE IF NOT EXISTS `QuizAttempt` (`id` VARCHAR(30) NOT NULL, `userId` VARCHAR(30) NOT NULL, `topics` TEXT NULL,
                `total` INT NOT NULL DEFAULT 0, `correct` INT NOT NULL DEFAULT 0, `answers` MEDIUMTEXT NULL, `createdAt` DATETIME NOT NULL,
                PRIMARY KEY (`id`), KEY `QuizAttempt_user` (`userId`,`createdAt`)$t"],
            'MarketPrice' => ['create' => "CREATE TABLE IF NOT EXISTS `MarketPrice` (`id` VARCHAR(30) NOT NULL, `item` VARCHAR(20) NOT NULL, `price` DECIMAL(16,4) NOT NULL,
                `priceDate` DATE NOT NULL, `source` VARCHAR(60) NULL, `updatedById` VARCHAR(30) NULL, `createdAt` DATETIME NOT NULL,
                PRIMARY KEY (`id`), UNIQUE KEY `MarketPrice_item_day` (`item`,`priceDate`)$t"],
            'TechNews' => ['create' => "CREATE TABLE IF NOT EXISTS `TechNews` (`id` VARCHAR(30) NOT NULL, `title` VARCHAR(400) NOT NULL, `link` VARCHAR(800) NOT NULL,
                `source` VARCHAR(120) NULL, `topic` VARCHAR(60) NULL, `publishedAt` DATETIME NULL, `fetchedAt` DATETIME NOT NULL,
                PRIMARY KEY (`id`), UNIQUE KEY `TechNews_link` (`link`(255))$t"],
            'LearnPlan' => ['create' => "CREATE TABLE IF NOT EXISTS `LearnPlan` (`userId` VARCHAR(30) NOT NULL, `day` DATE NOT NULL, `topics` TEXT NULL, `updatedAt` DATETIME NOT NULL,
                PRIMARY KEY (`userId`,`day`)$t"],
        ], 'Engineer notes');
    }

    private static function admin(array $a): bool { return is_admin_tier($a['role']); }
    private static function today(): string { return date('Y-m-d'); }

    // GET /api/learn/me
    public function me(): void
    {
        $auth = authenticate();
        $r = db()->prepare('SELECT topicId, MAX(day) AS lastDay, COUNT(*) AS times FROM `LearnRead` WHERE userId=? GROUP BY topicId'); $r->execute([$auth['id']]);
        $read = []; foreach ($r->fetchAll() as $x) $read[$x['topicId']] = ['lastDay' => $x['lastDay'], 'times' => (int) $x['times']];
        $q = db()->prepare('SELECT id, topics, total, correct, createdAt FROM `QuizAttempt` WHERE userId=? ORDER BY createdAt DESC LIMIT 30'); $q->execute([$auth['id']]);
        $quiz = array_map(fn($x) => ['id' => $x['id'], 'topics' => json_decode((string) $x['topics'], true) ?: [], 'total' => (int) $x['total'], 'correct' => (int) $x['correct'], 'at' => $x['createdAt']], $q->fetchAll());
        $p = db()->prepare('SELECT topics FROM `LearnPlan` WHERE userId=? AND day=?'); $p->execute([$auth['id'], self::today()]);
        $plan = json_decode((string) $p->fetchColumn(), true) ?: [];
        sendSuccess(['read' => (object) $read, 'quizzes' => $quiz, 'plan' => $plan, 'streak' => self::streak($auth['id']), 'today' => self::today()]);
    }

    /** Days in a row (ending today or yesterday) with something read or a quiz taken. */
    private static function streak(string $uid): int
    {
        $s = db()->prepare('SELECT DISTINCT d FROM (SELECT day AS d FROM `LearnRead` WHERE userId=? UNION SELECT DATE(createdAt) AS d FROM `QuizAttempt` WHERE userId=?) x ORDER BY d DESC LIMIT 400');
        $s->execute([$uid, $uid]);
        $days = array_flip($s->fetchAll(PDO::FETCH_COLUMN));
        $d = self::today(); if (!isset($days[$d])) $d = date('Y-m-d', strtotime('-1 day'));
        $n = 0; while (isset($days[$d])) { $n++; $d = date('Y-m-d', strtotime($d . ' -1 day')); }
        return $n;
    }

    private static function topicId($v): string
    {
        $v = (string) $v;
        if (!preg_match('/^[a-z0-9-]{2,30}$/', $v)) sendError('Unknown topic.', 400);
        return $v;
    }

    // POST /api/learn/read {topicId}
    public function read(): void
    {
        $auth = authenticate();
        $t = self::topicId(request_body()['topicId'] ?? '');
        db()->prepare('INSERT IGNORE INTO `LearnRead` (id,userId,topicId,day,createdAt) VALUES (?,?,?,?,?)')->execute([gen_id(), $auth['id'], $t, self::today(), now_sql()]);
        sendSuccess(['streak' => self::streak($auth['id'])], 'Marked as read');
    }

    // POST /api/learn/plan {topics[]}
    public function plan(): void
    {
        $auth = authenticate();
        $ts = array_values(array_unique(array_map([self::class, 'topicId'], array_slice((array) (request_body()['topics'] ?? []), 0, 12))));
        db()->prepare('INSERT INTO `LearnPlan` (userId,day,topics,updatedAt) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE topics=VALUES(topics), updatedAt=VALUES(updatedAt)')
            ->execute([$auth['id'], self::today(), json_encode($ts), now_sql()]);
        sendSuccess(['plan' => $ts], $ts ? "Today's topics saved" : 'Plan cleared');
    }

    // POST /api/learn/quiz {topics[], total, correct, answers[]}
    public function quiz(): void
    {
        $auth = authenticate();
        $b = request_body();
        $topics = array_values(array_unique(array_map([self::class, 'topicId'], array_slice((array) ($b['topics'] ?? []), 0, 12))));
        $total = (int) ($b['total'] ?? 0); $correct = (int) ($b['correct'] ?? 0);
        if ($total < 1 || $total > 50 || $correct < 0 || $correct > $total) sendError('Quiz result is not valid.', 400);
        $answers = array_slice((array) ($b['answers'] ?? []), 0, 50);
        $id = gen_id();
        db()->prepare('INSERT INTO `QuizAttempt` (id,userId,topics,total,correct,answers,createdAt) VALUES (?,?,?,?,?,?,?)')
            ->execute([$id, $auth['id'], json_encode($topics), $total, $correct, json_encode($answers, JSON_UNESCAPED_UNICODE), now_sql()]);
        log_activity($auth['id'], 'QUIZ_TAKEN', 'QuizAttempt', $id, ['score' => "$correct/$total", 'topics' => $topics]);
        sendSuccess(['id' => $id, 'streak' => self::streak($auth['id'])], "Score saved: $correct / $total", 201);
    }

    // GET /api/learn/team
    public function team(): void
    {
        $auth = authenticate();
        if (!self::admin($auth)) sendError('Only Super Admin, Admin or Manager can see team learning.', 403);
        $since = date('Y-m-d', strtotime('-30 days'));
        $users = db()->query("SELECT id, name, role FROM `User` WHERE isActive=1 AND role NOT IN ('SUPER_ADMIN') ORDER BY name")->fetchAll();
        $rd = db()->prepare('SELECT COUNT(DISTINCT topicId) AS topics, COUNT(*) AS readCount, MAX(day) AS lastDay FROM `LearnRead` WHERE userId=?');
        $qz = db()->prepare('SELECT COUNT(*) AS n, COALESCE(SUM(correct),0) AS c, COALESCE(SUM(total),0) AS t, MAX(createdAt) AS last,
                 SUM(createdAt>=?) AS n30, COALESCE(SUM(IF(createdAt>=?, correct, 0)),0) AS c30, COALESCE(SUM(IF(createdAt>=?, total, 0)),0) AS t30 FROM `QuizAttempt` WHERE userId=?');
        $out = [];
        foreach ($users as $u) {
            $rd->execute([$u['id']]); $r = $rd->fetch();
            $qz->execute([$since, $since, $since, $u['id']]); $q = $qz->fetch();
            $out[] = ['user' => $u, 'topicsRead' => (int) $r['topics'], 'lastRead' => $r['lastDay'], 'quizzes' => (int) $q['n'], 'avg' => $q['t'] ? round($q['c'] / $q['t'] * 100) : null,
                      'quizzes30' => (int) $q['n30'], 'avg30' => $q['t30'] ? round($q['c30'] / $q['t30'] * 100) : null, 'lastQuiz' => $q['last'], 'streak' => self::streak($u['id'])];
        }
        usort($out, fn($a, $b) => [$b['quizzes30'], $b['avg30'] ?? -1] <=> [$a['quizzes30'], $a['avg30'] ?? -1]);
        sendSuccess(['team' => $out]);
    }

    // ── market prices + news ──
    private static function lastRefresh(): ?string
    {
        try { $s = db()->prepare("SELECT v FROM `AppSetting` WHERE k='learnRefresh'"); $s->execute(); return $s->fetchColumn() ?: null; } catch (Throwable $e) { return null; }
    }
    private static function http(string $url, int $timeout = 8): ?string
    {
        if (!function_exists('curl_init')) { $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'user_agent' => 'Mozilla/5.0 CRM']]); $r = @file_get_contents($url, false, $ctx); return $r === false ? null : $r; }
        $c = curl_init($url);
        curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; CRM news)']);
        $r = curl_exec($c); $code = curl_getinfo($c, CURLINFO_HTTP_CODE); curl_close($c);
        return ($r !== false && $code < 400) ? $r : null;
    }
    /** News sources: the admin's own list (Engineer notes → News sources) or the built-in Google News searches. */
    public static function feeds(): array
    {
        try {
            $s = db()->prepare("SELECT v FROM `AppSetting` WHERE k='learnFeeds'"); $s->execute();
            $f = json_decode((string) $s->fetchColumn(), true);
            if (is_array($f) && $f) return $f;
        } catch (Throwable $e) {}
        return self::FEEDS;
    }
    // PUT /api/learn/feeds {feeds:[{topic, url}]} (Super Admin / Admin) — empty list = built-in sources
    public function saveFeeds(): void
    {
        $auth = authenticate();
        if (!in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('Only the Super Admin or an Admin can change news sources.', 403);
        new AppSettingsController();
        $out = [];
        foreach (array_slice((array) (request_body()['feeds'] ?? []), 0, 10) as $f) {
            $t = mb_substr(trim((string) ($f['topic'] ?? '')), 0, 40); $u = trim((string) ($f['url'] ?? ''));
            if ($t === '' || $u === '') continue;
            if (!preg_match('~^https?://[^\s]+$~', $u)) sendError('News source address must start with http:// or https://', 400);
            $out[$t] = $u;
        }
        db()->prepare("INSERT INTO `AppSetting` (k,v,updatedById,updatedAt) VALUES ('learnFeeds',?,?,?) ON DUPLICATE KEY UPDATE v=VALUES(v), updatedById=VALUES(updatedById), updatedAt=VALUES(updatedAt)")
            ->execute([$out ? json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : '', $auth['id'], now_sql()]);
        sendSuccess(['feeds' => self::feeds()], $out ? 'News sources saved' : 'Back to the built-in news sources');
    }

    /** Fetch news (RSS) and the USD → INR rate. Returns counts; never throws. */
    public static function refresh(): array
    {
        new AppSettingsController();   // AppSetting table
        $added = 0; $errors = [];
        $ins = db()->prepare('INSERT IGNORE INTO `TechNews` (id,title,link,source,topic,publishedAt,fetchedAt) VALUES (?,?,?,?,?,?,?)');
        foreach (self::feeds() as $topic => $url) {
            $xml = self::http($url);
            if (!$xml) { $errors[] = $topic; continue; }
            $prev = libxml_use_internal_errors(true);
            $doc = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOCDATA | LIBXML_NONET);
            libxml_use_internal_errors($prev);
            if (!$doc || !isset($doc->channel->item)) { $errors[] = $topic; continue; }
            $i = 0;
            foreach ($doc->channel->item as $it) {
                if ($i++ >= 12) break;
                $title = trim(html_entity_decode((string) $it->title, ENT_QUOTES)); $link = trim((string) $it->link);
                if ($title === '' || !preg_match('~^https?://~', $link)) continue;
                $src = trim((string) ($it->source ?? '')) ?: (preg_match('/ - ([^-]+)$/', $title, $m) ? trim($m[1]) : null);
                $pub = strtotime((string) $it->pubDate) ?: time();
                $ins->execute([gen_id(), mb_substr($title, 0, 400), mb_substr($link, 0, 800), $src ? mb_substr($src, 0, 120) : null, $topic, date('Y-m-d H:i:s', $pub), now_sql()]);
                $added += $ins->rowCount();
            }
        }
        // USD → INR (free, no key)
        $fx = self::http('https://open.er-api.com/v6/latest/USD');
        $j = $fx ? json_decode($fx, true) : null;
        if (!empty($j['rates']['INR'])) {
            db()->prepare('INSERT INTO `MarketPrice` (id,item,price,priceDate,source,createdAt) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE price=VALUES(price), source=VALUES(source)')
                ->execute([gen_id(), 'usdinr', round((float) $j['rates']['INR'], 4), date('Y-m-d'), 'open.er-api.com', now_sql()]);
        } else $errors[] = 'usdinr';
        db()->exec("DELETE FROM `TechNews` WHERE fetchedAt < DATE_SUB(NOW(), INTERVAL 60 DAY)");
        db()->prepare('INSERT INTO `AppSetting` (k,v,updatedAt) VALUES (\'learnRefresh\',?,?) ON DUPLICATE KEY UPDATE v=VALUES(v), updatedAt=VALUES(updatedAt)')->execute([now_sql(), now_sql()]);
        return ['added' => $added, 'failed' => $errors];
    }

    // GET /api/learn/market
    public function market(): void
    {
        $auth = authenticate();
        $refreshed = null;
        $s = db()->prepare('SELECT item, price, priceDate, source FROM `MarketPrice` WHERE priceDate >= ? ORDER BY priceDate'); $s->execute([date('Y-m-d', strtotime('-45 days'))]);
        $hist = []; foreach ($s->fetchAll() as $r) $hist[$r['item']][] = ['date' => $r['priceDate'], 'price' => (float) $r['price'], 'source' => $r['source']];
        $items = array_map(function ($it) use ($hist) {
            $h = $hist[$it['key']] ?? []; $n = count($h);
            $it['latest'] = $n ? $h[$n - 1] : null; $it['previous'] = $n > 1 ? $h[$n - 2] : null; $it['history'] = array_slice($h, -30);
            return $it;
        }, self::ITEMS);
        $news = db()->query('SELECT title, link, source, topic, publishedAt FROM `TechNews` ORDER BY publishedAt DESC LIMIT 30')->fetchAll();
        sendSuccess(['items' => $items, 'news' => $news, 'lastRefresh' => self::lastRefresh(), 'refreshed' => $refreshed, 'canEdit' => ($ce = in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)), 'feeds' => $ce ? self::feeds() : null]);
    }

    // POST /api/learn/refresh-due — the page calls this in the background: the first visit after midnight
    // fetches the day's news and exchange rate (so nobody waits for it when the page opens)
    public function refreshDue(): void
    {
        authenticate();
        new AppSettingsController();
        $last = self::lastRefresh();
        if ($last && $last >= date('Y-m-d 00:00:00')) sendSuccess(['refreshed' => false, 'lastRefresh' => $last]);
        $r = self::refresh();
        sendSuccess(['refreshed' => true] + $r + ['lastRefresh' => self::lastRefresh()]);
    }

    // PUT /api/learn/prices {prices:[{item, price, date?}]}
    public function savePrices(): void
    {
        $auth = authenticate();
        if (!in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('Only the Super Admin or an Admin can enter prices.', 403);
        $keys = array_column(self::ITEMS, 'key');
        $up = db()->prepare('INSERT INTO `MarketPrice` (id,item,price,priceDate,source,updatedById,createdAt) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE price=VALUES(price), source=VALUES(source), updatedById=VALUES(updatedById)');
        $n = 0;
        foreach ((array) (request_body()['prices'] ?? []) as $p) {
            $k = (string) ($p['item'] ?? ''); $v = str_replace(',', '', (string) ($p['price'] ?? ''));
            if (!in_array($k, $keys, true) || $v === '') continue;
            if (!is_numeric($v) || (float) $v <= 0) sendError('Price for ' . $k . ' must be a positive number.', 400);
            $d = to_date_only($p['date'] ?? null) ?? date('Y-m-d');
            $up->execute([gen_id(), $k, round((float) $v, 4), $d, mb_substr(trim((string) ($p['source'] ?? '')), 0, 60) ?: 'entered', $auth['id'], now_sql()]);
            $n++;
        }
        if (!$n) sendError('Enter at least one price.', 400);
        log_activity($auth['id'], 'MARKET_PRICES_SAVED', 'MarketPrice', 'prices', ['count' => $n]);
        sendSuccess(['saved' => $n], "Saved $n price" . ($n === 1 ? '' : 's'));
    }

    // GET /api/learn/cron?key=… (hosting panel cron at 00:00) — or an admin from the page
    public function cron(): void
    {
        new AppSettingsController();
        $s = db()->prepare("SELECT v FROM `AppSetting` WHERE k='learnCronKey'"); $s->execute(); $key = (string) $s->fetchColumn();
        $given = (string) qp('key', '');
        $ok = $key !== '' && hash_equals($key, $given);
        if (!$ok) { $auth = authenticate(); if (!in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('Not allowed.', 403); }
        sendSuccess(self::refresh(), 'Refreshed');
    }

    // GET /api/learn/cron-key (Super Admin / Admin) — the URL to put in the hosting panel's cron
    public function cronKey(): void
    {
        $auth = authenticate();
        if (!in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('Not allowed.', 403);
        new AppSettingsController();
        $s = db()->prepare("SELECT v FROM `AppSetting` WHERE k='learnCronKey'"); $s->execute(); $key = (string) $s->fetchColumn();
        if ($key === '') { $key = bin2hex(random_bytes(16)); db()->prepare("INSERT INTO `AppSetting` (k,v,updatedById,updatedAt) VALUES ('learnCronKey',?,?,?)")->execute([$key, $auth['id'], now_sql()]); }
        sendSuccess(['key' => $key]);
    }
}
