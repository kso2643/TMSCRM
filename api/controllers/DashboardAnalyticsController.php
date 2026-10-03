<?php
class DashboardController
{
    private const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // GET /api/dashboard/admin
    public function admin(): void
    {
        $auth = authenticate(); require_admin($auth);
        $now = now_sql();
        $som = start_of_month();
        $sod = start_of_day(); $eod = start_of_day_plus(1);

        $db = db();

        $totalCustomers = (int)$db->query('SELECT COUNT(*) FROM `Customer` WHERE isActive=1')->fetchColumn();
        $newCustomers   = (int)$db->prepare('SELECT COUNT(*) FROM `Customer` WHERE isActive=1 AND createdAt>=?')->execute([$som]) ? 0:0;
        $s = $db->prepare('SELECT COUNT(*) FROM `Customer` WHERE isActive=1 AND createdAt>=?'); $s->execute([$som]); $newCustomers=(int)$s->fetchColumn();

        $s=$db->prepare('SELECT COUNT(*) FROM `Meeting` WHERE nextFollowUp>=? AND nextFollowUp<?'); $s->execute([$sod,$eod]); $followUpsToday=(int)$s->fetchColumn();

        $s=$db->prepare('SELECT m.*,c.companyName,c.contactPerson,c.contactNumber FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId WHERE m.nextFollowUp<? AND m.status NOT IN (\'CLOSED\',\'LOST\') ORDER BY m.nextFollowUp ASC LIMIT 10'); $s->execute([$sod]); $overdueList=self::withCustomer($s->fetchAll());
        $s=$db->prepare("SELECT COUNT(*) FROM `Meeting` WHERE nextFollowUp<? AND status NOT IN ('CLOSED','LOST')"); $s->execute([$sod]); $overdueTotal=(int)$s->fetchColumn();

        $s=$db->query("SELECT COUNT(*) FROM `Meeting` WHERE status='TRIAL_PLANNED'");     $trialsPlanned  =(int)$s->fetchColumn();
        $s=$db->query("SELECT COUNT(*) FROM `Meeting` WHERE status='TRIAL_COMPLETED'");   $trialsCompleted=(int)$s->fetchColumn();
        $s=$db->query("SELECT COUNT(*) FROM `Quotation`");                                $quotationsSent =(int)$s->fetchColumn();
        $s=$db->query("SELECT COUNT(*) FROM `Leave` WHERE status='PENDING'");             $pendingLeaves  =(int)$s->fetchColumn();
        $s=$db->query("SELECT COUNT(*) FROM `Quotation` WHERE approvalStatus='PENDING'"); $pendingQ       =(int)$s->fetchColumn();

        $s=$db->prepare("SELECT COUNT(*) FROM `Attendance` WHERE date>=? AND date<? AND checkIn IS NOT NULL"); $s->execute([$sod,$eod]); $presentToday=(int)$s->fetchColumn();

        $s=$db->query('SELECT al.*,u.name AS u_name,u.role AS u_role FROM `ActivityLog` al LEFT JOIN `User` u ON u.id=al.userId ORDER BY al.createdAt DESC LIMIT 10');
        $recentActivity = array_map(function($r){ $r['user']=['name'=>$r['u_name'],'role'=>$r['u_role']]; unset($r['u_name'],$r['u_role']); return $r; }, $s->fetchAll());

        $monthlyActivity = $this->buildMonthly(6, null);

        sendSuccess([
            'totalCustomers'    => $totalCustomers,
            'newCustomers'      => $newCustomers,
            'followUpsToday'    => $followUpsToday,
            'overdueFollowUps'  => $overdueTotal,
            'trialsPlanned'     => $trialsPlanned,
            'trialsCompleted'   => $trialsCompleted,
            'quotationsSent'    => $quotationsSent,
            'pendingApprovals'  => $pendingLeaves + $pendingQ,
            'presentToday'      => $presentToday,
            'leaveRequests'     => $pendingLeaves,
            'overdueList'       => $overdueList,
            'recentActivity'    => $recentActivity,
            'monthlyActivity'   => $monthlyActivity,
        ], 'Admin dashboard data fetched');
    }

    // GET /api/dashboard/user
    public function user(): void
    {
        $auth = authenticate();
        $uid = $auth['id'];
        $sod = start_of_day(); $eod = start_of_day_plus(1); $som = start_of_month();
        $db = db();

        $s=$db->prepare("SELECT COUNT(*) FROM `Meeting` WHERE userId=? AND nextFollowUp>=? AND nextFollowUp<?"); $s->execute([$uid,$sod,$eod]); $myFollowUpsToday=(int)$s->fetchColumn();

        $s=$db->prepare("SELECT m.*,c.companyName,c.contactPerson,c.contactNumber FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId WHERE m.userId=? AND m.nextFollowUp<? AND m.status NOT IN ('CLOSED','LOST') ORDER BY m.nextFollowUp ASC LIMIT 10"); $s->execute([$uid,$sod]); $overdueList=self::withCustomer($s->fetchAll());
        $s=$db->prepare("SELECT COUNT(*) FROM `Meeting` WHERE userId=? AND nextFollowUp<? AND status NOT IN ('CLOSED','LOST')"); $s->execute([$uid,$sod]); $overdueTotal=(int)$s->fetchColumn();

        $s=$db->prepare("SELECT COUNT(*) FROM `Customer` WHERE createdById=? AND isActive=1"); $s->execute([$uid]); $myCustomers=(int)$s->fetchColumn();
        $s=$db->prepare("SELECT COUNT(*) FROM `Meeting` WHERE userId=? AND meetingDate>=?");   $s->execute([$uid,$som]); $meetingsThisMonth=(int)$s->fetchColumn();
        $s=$db->prepare("SELECT COUNT(*) FROM `Quotation` WHERE userId=?");                    $s->execute([$uid]); $myQuotations=(int)$s->fetchColumn();

        $s=$db->prepare("SELECT checkIn FROM `Attendance` WHERE userId=? AND date>=? AND date<? LIMIT 1"); $s->execute([$uid,$sod,$eod]); $att=$s->fetch();
        $checkedIn = $att && !empty($att['checkIn']);

        $monthlyActivity = $this->buildMonthly(6, $uid);

        sendSuccess([
            'myFollowUpsToday' => $myFollowUpsToday,
            'myOverdue'        => $overdueTotal,
            'myQuotations'     => $myQuotations,
            'myCustomers'      => $myCustomers,
            'checkedIn'        => $checkedIn,
            'meetingsThisMonth'=> $meetingsThisMonth,
            'overdueList'      => $overdueList,
            'monthlyActivity'  => $monthlyActivity,
        ], 'User dashboard data fetched');
    }

    /** The dashboard reads row.customer.companyName / .contactPerson — nest them (flat fields kept too). */
    private static function withCustomer(array $rows): array
    {
        return array_map(function ($r) {
            $r['customer'] = $r['customerId'] ? [
                'id' => $r['customerId'], 'companyName' => $r['companyName'] ?? null,
                'contactPerson' => $r['contactPerson'] ?? null, 'contactNumber' => $r['contactNumber'] ?? null,
            ] : null;
            return $r;
        }, $rows);
    }

    private function buildMonthly(int $months, ?string $userId): array
    {
        $result = [];
        for ($i = $months - 1; $i >= 0; $i--) {
            $d   = new DateTime("first day of -$i month midnight");
            $end = (clone $d)->modify('+1 month');
            $from = $d->format('Y-m-d H:i:s'); $to = $end->format('Y-m-d H:i:s');
            $uCond = $userId ? ' AND userId=?' : '';
            $uP = $userId ? [$userId] : [];
            $sm = db()->prepare("SELECT COUNT(*) FROM `Meeting` WHERE meetingDate>=? AND meetingDate<? $uCond");
            $sm->execute(array_merge([$from,$to],$uP)); $mc=(int)$sm->fetchColumn();
            $sq = db()->prepare("SELECT COUNT(*) FROM `Quotation` WHERE createdAt>=? AND createdAt<? $uCond");
            $sq->execute(array_merge([$from,$to],$uP)); $qc=(int)$sq->fetchColumn();
            $result[] = ['month' => self::MONTHS[(int)$d->format('n')-1], 'meetings' => $mc, 'quotations' => $qc];
        }
        return $result;
    }

    // GET /api/dashboard/payroll — cards + trends for the Payroll dashboard page.
    // Kept in PayrollController alongside the rest of the payroll/advance/recovery
    // logic it depends on; this is just the routing seam.
    public function payroll(): void
    {
        (new PayrollController())->dashboardStats();
    }
}

class AnalyticsController
{
    private const ADMIN_ROLES = ['ADMIN','SUPER_ADMIN','MANAGER'];

    // GET /api/analytics/overview
    public function overview(): void
    {
        $auth = authenticate();
        $isAdmin = in_array($auth['role'], self::ADMIN_ROLES);
        $uf = $isAdmin ? '' : ' AND userId=?';
        $up = $isAdmin ? [] : [$auth['id']];
        $db = db();
        $now = now_sql(); $som = start_of_month(); $sod = start_of_day(); $eod = start_of_day_plus(1);

        $s=$db->query('SELECT COUNT(*) FROM `Customer` WHERE isActive=1');                                     $totalC=(int)$s->fetchColumn();
        $s=$db->prepare('SELECT COUNT(*) FROM `Customer` WHERE isActive=1 AND createdAt>=?');$s->execute([$som]);$newCM=(int)$s->fetchColumn();
        $s=$db->query("SELECT COUNT(*) FROM `Customer` WHERE isActive=1 AND status='ACTIVE'");                $activeC=(int)$s->fetchColumn();

        $q=fn($sql,$p=[])=>self::countQ($sql,array_merge($up,$p),$uf);
        $totalM = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE 1=1 $uf",$up);
        $todayM = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE meetingDate>=? AND meetingDate<? $uf",array_merge([$sod,$eod],$up));
        $overdue= $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE nextFollowUp<? AND status NOT IN ('CLOSED','LOST') $uf",array_merge([$now],$up));
        $trialP = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='TRIAL_PLANNED' $uf",$up);
        $trialC = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='TRIAL_COMPLETED' $uf",$up);
        $quotS  = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='QUOTATION_SUBMITTED' $uf",$up);
        $po     = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='PURCHASE_ORDER' $uf",$up);
        $visits = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE checkedInAt IS NOT NULL $uf",$up);
        $s=$db->prepare("SELECT AVG(visitDurationMinutes) FROM `Meeting` WHERE visitDurationMinutes IS NOT NULL $uf");
        $s->execute($up); $avgDur=(int)round((float)$s->fetchColumn());

        sendSuccess([
            'customers' => ['total'=>$totalC,'newThisMonth'=>$newCM,'active'=>$activeC],
            'meetings'  => ['total'=>$totalM,'today'=>$todayM,'overdueFollowUps'=>$overdue,'trialsPlanned'=>$trialP,'trialsCompleted'=>$trialC,'quotationsSent'=>$quotS,'poReceived'=>$po],
            'visits'    => ['total'=>$visits,'avgDurationMinutes'=>$avgDur],
        ]);
    }

    // GET /api/analytics/monthly
    public function monthly(): void
    {
        $auth = authenticate();
        $isAdmin = in_array($auth['role'], self::ADMIN_ROLES);
        $uf = $isAdmin ? '' : ' AND userId=?';
        $up = $isAdmin ? [] : [$auth['id']];
        $months = min((int)(qp('months') ?: 6), 12);
        $data = [];
        for ($i = $months-1; $i >= 0; $i--) {
            $d   = new DateTime("first day of -$i month midnight");
            $end = (clone $d)->modify('+1 month');
            $from = $d->format('Y-m-d H:i:s'); $to = $end->format('Y-m-d H:i:s');
            $m = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE meetingDate>=? AND meetingDate<? $uf",array_merge([$from,$to],$up));
            $q = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='QUOTATION_SUBMITTED' AND updatedAt>=? AND updatedAt<? $uf",array_merge([$from,$to],$up));
            $v = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE checkedInAt>=? AND checkedInAt<? $uf",array_merge([$from,$to],$up));
            $o = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='PURCHASE_ORDER' AND updatedAt>=? AND updatedAt<? $uf",array_merge([$from,$to],$up));
            $data[] = ['month'=>$d->format('M'),'year'=>(int)$d->format('Y'),'meetings'=>$m,'quotations'=>$q,'visits'=>$v,'orders'=>$o];
        }
        sendSuccess(['data'=>$data]);
    }

    // GET /api/analytics/employee  (manager+ only)
    public function employee(): void
    {
        $auth = authenticate(); require_manager($auth);
        $now = now_sql(); $som = start_of_month();
        $s = db()->query("SELECT id,name,department FROM `User` WHERE isActive=1 AND role IN ('SALES','SALES_ENGINEER','MANAGER')");
        $users = $s->fetchAll();
        $stats = [];
        foreach ($users as $u) {
            $uid = $u['id'];
            $tv = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE userId=? AND checkedInAt IS NOT NULL",[$uid]);
            $mv = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE userId=? AND checkedInAt>=?",[$uid,$som]);
            $s2=db()->prepare("SELECT AVG(visitDurationMinutes) FROM `Meeting` WHERE userId=? AND visitDurationMinutes IS NOT NULL");$s2->execute([$uid]);$avg=(int)round((float)$s2->fetchColumn());
            $of = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE userId=? AND nextFollowUp<? AND status NOT IN ('CLOSED','LOST')",[$uid,$now]);
            $wd = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE userId=? AND status='PURCHASE_ORDER'",[$uid]);
            $stats[] = ['user'=>$u,'totalVisits'=>$tv,'monthVisits'=>$mv,'avgDurationMinutes'=>$avg,'overdueFollowUps'=>$of,'wonDeals'=>$wd];
        }
        usort($stats, fn($a,$b)=>$b['monthVisits']<=>$a['monthVisits']);
        sendSuccess(['employees'=>$stats]);
    }

    // GET /api/analytics/customer-segmentation
    public function customerSegmentation(): void
    {
        authenticate();
        $byStatus = db()->query("SELECT status,COUNT(*) AS cnt FROM `Customer` WHERE isActive=1 GROUP BY status")->fetchAll();
        $byCategory = db()->query("SELECT category,COUNT(*) AS cnt FROM `Customer` WHERE isActive=1 AND category IS NOT NULL AND category!='' GROUP BY category")->fetchAll();
        $s = db()->query("SELECT c.id,c.companyName,c.contactPerson,c.status,c.category,(SELECT COUNT(*) FROM `Meeting` m WHERE m.customerId=c.id) AS meetings_count FROM `Customer` c WHERE c.isActive=1 ORDER BY meetings_count DESC LIMIT 10");
        $top = array_map(function($r){ $r['_count']=['meetings'=>(int)$r['meetings_count']];unset($r['meetings_count']);return $r; },$s->fetchAll());
        sendSuccess([
            'byStatus'    => array_map(fn($r)=>['status'=>$r['status'],'count'=>(int)$r['cnt']],$byStatus),
            'byCategory'  => array_map(fn($r)=>['category'=>$r['category'],'count'=>(int)$r['cnt']],$byCategory),
            'topCustomers'=> $top,
        ]);
    }

    // GET /api/analytics/win-loss
    public function winLoss(): void
    {
        $auth = authenticate();
        $isAdmin = in_array($auth['role'], self::ADMIN_ROLES);
        $uf = $isAdmin ? '' : ' AND userId=?';
        $up = $isAdmin ? [] : [$auth['id']];
        $data = [];
        for ($i = 5; $i >= 0; $i--) {
            $d   = new DateTime("first day of -$i month midnight");
            $end = (clone $d)->modify('+1 month');
            $from = $d->format('Y-m-d H:i:s'); $to = $end->format('Y-m-d H:i:s');
            $w = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='PURCHASE_ORDER' AND updatedAt>=? AND updatedAt<? $uf",array_merge([$from,$to],$up));
            $l = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='LOST' AND updatedAt>=? AND updatedAt<? $uf",array_merge([$from,$to],$up));
            $c = $this->cnt("SELECT COUNT(*) FROM `Meeting` WHERE status='CLOSED' AND updatedAt>=? AND updatedAt<? $uf",array_merge([$from,$to],$up));
            $rate = ($w+$l) > 0 ? (int)round($w/($w+$l)*100) : 0;
            $data[] = ['month'=>$d->format('M'),'won'=>$w,'lost'=>$l,'closed'=>$c,'winRate'=>$rate];
        }
        sendSuccess(['data'=>$data]);
    }

    private function cnt(string $sql, array $p=[]): int
    {
        $s = db()->prepare($sql); $s->execute($p); return (int)$s->fetchColumn();
    }
}
