<?php
/**
 * Quick search (Ctrl / ⌘ + K, or "Quick search…" in the top bar) — one box
 * that searches the whole CRM.
 *
 *   GET /api/search?q=term   → { groups: [{ key, label, items: [{ title, sub, link }] }] }
 *
 * Each group follows the same visibility as its page: engineers see their own
 * quotations / orders / price requests / trials / appointments / MOMs, admins
 * see everything; vendors and purchase orders are for admins; petty cash only
 * for people with petty cash access; and any page the Super Admin set to
 * "hidden" for the user (Users → Page access) is left out.
 * Each source is skipped if its table doesn't exist yet.
 */
class SearchController
{
    private const PER = 6;

    private static function rows(string $sql, array $p): array
    {
        try { $s = db()->prepare($sql); $s->execute($p); return $s->fetchAll(); }
        catch (Throwable $e) { return []; }
    }
    private static function d(?string $v): string { return $v ? date('j M Y', strtotime($v)) : ''; }
    private static function inr($v): string { return $v === null || $v === '' ? '' : '₹' . number_format((float) $v); }

    public function search(): void
    {
        $auth = authenticate();
        $q = trim(mb_substr((string) qp('q', ''), 0, 80));
        if (mb_strlen($q) < 2) sendSuccess(['groups' => [], 'q' => $q]);
        $me = $auth['id']; $admin = is_admin_tier($auth['role']); $super = $auth['role'] === 'SUPER_ADMIN';
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
        $n = self::PER;
        $hidden = [];
        try {
            PageAccess::ensure();
            $s = db()->prepare('SELECT pageAccess FROM `User` WHERE id=?'); $s->execute([$me]);
            foreach (PageAccess::effective($s->fetchColumn() ?: null, $auth['role']) as $k => $v) if ($v === 'hidden') $hidden[$k] = true;
        } catch (Throwable $e) {}
        $groups = [];
        $add = function (string $key, string $label, array $items) use (&$groups, $hidden) {
            if (!$items || isset($hidden[$key])) return;
            $groups[] = ['key' => $key, 'label' => $label, 'items' => $items];
        };
        $enc = 'rawurlencode';

        // Customers
        $add('customers', 'Customers', array_map(fn($r) => [
            'title' => $r['companyName'], 'sub' => implode(' · ', array_filter([$r['contactPerson'], $r['contactNumber'], $r['location']])),
            'link' => '/customers/detail/?id=' . $enc($r['id'])],
            self::rows("SELECT id, companyName, contactPerson, contactNumber, location FROM `Customer`
                        WHERE (companyName LIKE ? OR contactPerson LIKE ? OR contactNumber LIKE ? OR email LIKE ? OR location LIKE ?) AND isActive=1
                        ORDER BY (companyName LIKE ?) DESC, companyName LIMIT $n", [$like, $like, $like, $like, $like, $q . '%'])));

        // Products
        $add('products', 'Products', array_map(fn($r) => [
            'title' => ($r['itemCode'] ? $r['itemCode'] . ' — ' : '') . $r['productName'], 'sub' => implode(' · ', array_filter([$r['brand'], $r['category'], self::inr($r['standardPrice'])])),
            'link' => '/products/?q=' . $enc($r['itemCode'] ?: $r['productName'])],
            self::rows("SELECT itemCode, productName, brand, category, standardPrice FROM `Product`
                        WHERE (itemCode LIKE ? OR productName LIKE ? OR description LIKE ? OR brand LIKE ?) AND isActive=1
                        ORDER BY (itemCode LIKE ?) DESC, itemCode LIMIT $n", [$like, $like, $like, $like, $q . '%'])));

        // Quotations
        $add('quotations', 'Quotations', array_map(fn($r) => [
            'title' => $r['quotationNumber'] . ' · ' . ($r['companyName'] ?: $r['toName'] ?: ''), 'sub' => implode(' · ', array_filter([$r['company'], self::d($r['quotationDate'] ?: $r['createdAt']), self::inr($r['totalAmount']), $r['status']])),
            'link' => '/quotations/?q=' . $enc($r['quotationNumber'])],
            self::rows("SELECT q.quotationNumber, q.company, q.toName, q.quotationDate, q.createdAt, q.totalAmount, q.status, c.companyName
                        FROM `Quotation` q LEFT JOIN `Customer` c ON c.id=q.customerId
                        WHERE (q.quotationNumber LIKE ? OR c.companyName LIKE ? OR q.toName LIKE ? OR q.subject LIKE ? OR q.priceRequestNo LIKE ?)" . ($admin ? '' : ' AND q.userId=?') . "
                        ORDER BY q.createdAt DESC LIMIT $n", array_merge([$like, $like, $like, $like, $like], $admin ? [] : [$me]))));

        // Orders
        $add('orders', 'Orders', array_map(fn($r) => [
            'title' => ($r['companyName'] ?: 'Order') . ($r['poNumber'] ? ' · PO ' . $r['poNumber'] : ''), 'sub' => implode(' · ', array_filter([self::d($r['orderDate']), self::inr($r['orderValue']), str_replace('_', ' ', strtolower((string) $r['deliveryStatus'])), $r['engName']])),
            'link' => '/orders/?q=' . $enc($r['poNumber'] ?: ($r['companyName'] ?: ''))],
            self::rows("SELECT o.poNumber, o.orderDate, o.orderValue, o.deliveryStatus, c.companyName, u.name AS engName
                        FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId LEFT JOIN `User` u ON u.id=o.engineerId
                        WHERE (o.poNumber LIKE ? OR c.companyName LIKE ? OR o.verbalDetails LIKE ? OR o.notes LIKE ?
                               OR o.id IN (SELECT orderId FROM `CustomerOrderItem` WHERE itemCode LIKE ? OR productName LIKE ?))" . ($admin ? '' : ' AND o.engineerId=?') . "
                        ORDER BY o.orderDate DESC LIMIT $n", array_merge([$like, $like, $like, $like, $like, $like], $admin ? [] : [$me]))));

        // Price requests
        $add('price-requests', 'Price requests', array_map(fn($r) => [
            'title' => $r['requestNo'] . ' · ' . ($r['companyName'] ?: ''), 'sub' => implode(' · ', array_filter([self::d($r['createdAt']), $r['items'] . ' item' . ($r['items'] == 1 ? '' : 's'), $r['byName']])),
            'link' => '/price-requests/?q=' . $enc($r['requestNo'])],
            self::rows("SELECT b.requestNo, b.createdAt, c.companyName, u.name AS byName, (SELECT COUNT(*) FROM `PriceRequest` p WHERE p.batchId=b.id) AS items
                        FROM `PriceRequestBatch` b LEFT JOIN `Customer` c ON c.id=b.customerId LEFT JOIN `User` u ON u.id=b.requestedById
                        WHERE (b.requestNo LIKE ? OR c.companyName LIKE ? OR b.id IN (SELECT batchId FROM `PriceRequest` WHERE itemCode LIKE ? OR productName LIKE ?))" . ($admin ? '' : ' AND b.requestedById=?') . "
                        ORDER BY b.createdAt DESC LIMIT $n", array_merge([$like, $like, $like, $like], $admin ? [] : [$me]))));

        // Trials
        $add('trials', 'Trials', array_map(fn($r) => [
            'title' => $r['trialNo'] . ' · ' . ($r['customerName'] ?: ''), 'sub' => implode(' · ', array_filter([$r['component'], str_replace('_', ' ', strtolower((string) $r['status'])), self::d($r['createdAt'])])),
            'link' => '/trials/#/t/' . $enc($r['id'])],
            self::rows("SELECT id, trialNo, customerName, component, status, createdAt FROM `Trial`
                        WHERE (trialNo LIKE ? OR customerName LIKE ? OR component LIKE ? OR quotationNo LIKE ?)" . ($admin ? '' : ' AND requestedById=?') . "
                        ORDER BY createdAt DESC LIMIT $n", array_merge([$like, $like, $like, $like], $admin ? [] : [$me]))));

        // Appointments
        $add('appointments', 'Appointments', array_map(fn($r) => [
            'title' => ($r['companyName'] ?: '') . ' · ' . $r['title'], 'sub' => implode(' · ', array_filter([self::d($r['appointmentDate']) . ($r['appointmentTime'] ? ' ' . $r['appointmentTime'] : ''), $r['engName'], strtolower((string) $r['status'])])),
            'link' => '/appointments/?date=' . $r['appointmentDate']],
            self::rows("SELECT a.title, a.appointmentDate, a.appointmentTime, a.status, c.companyName, u.name AS engName
                        FROM `Appointment` a LEFT JOIN `Customer` c ON c.id=a.customerId LEFT JOIN `User` u ON u.id=COALESCE(a.assignedToId, a.userId)
                        WHERE (a.title LIKE ? OR c.companyName LIKE ? OR a.notes LIKE ?)" . ($admin ? '' : ' AND (a.userId=? OR a.assignedToId=?)') . "
                        ORDER BY a.appointmentDate DESC LIMIT $n", array_merge([$like, $like, $like], $admin ? [] : [$me, $me]))));

        // CEO Desk
        $add('md-desk', 'CEO Desk', array_map(fn($r) => [
            'title' => ($r['deskNo'] ? $r['deskNo'] . ' · ' : '') . $r['title'], 'sub' => implode(' · ', array_filter([$r['customerName'], strtolower((string) $r['status']), self::d($r['createdAt'])])),
            'link' => '/md-desk/?q=' . $enc($r['deskNo'] ?: $r['title'])],
            self::rows("SELECT deskNo, title, customerName, status, createdAt FROM `MdDeskItem`
                        WHERE (deskNo LIKE ? OR title LIKE ? OR customerName LIKE ? OR quotationNo LIKE ? OR itemCode LIKE ?)" . ($super ? '' : ' AND (fromId=? OR toId=? OR assignees LIKE ? OR reportTo=?)') . "
                        ORDER BY createdAt DESC LIMIT $n", array_merge([$like, $like, $like, $like, $like], $super ? [] : [$me, $me, '%' . $me . '%', $me]))));

        // MOM + internal meetings
        $add('mom', 'MOM', array_map(fn($r) => [
            'title' => $r['momNo'] . ' · ' . $r['customerName'], 'sub' => implode(' · ', array_filter([self::d($r['meetingDate']), $r['subject']])),
            'link' => '/mom/?q=' . $enc($r['momNo'])],
            self::rows("SELECT momNo, customerName, meetingDate, subject FROM `Mom` WHERE (momNo LIKE ? OR customerName LIKE ? OR subject LIKE ? OR points LIKE ?)" . ($admin ? '' : ' AND createdById=?') . "
                        ORDER BY meetingDate DESC LIMIT $n", array_merge([$like, $like, $like, $like], $admin ? [] : [$me]))));
        $add('internal-meetings', 'Internal meetings', array_map(fn($r) => [
            'title' => $r['meetingNo'] . ' · ' . $r['title'], 'sub' => self::d($r['meetingDate']), 'link' => '/internal-meetings/?q=' . $enc($r['meetingNo'])],
            self::rows("SELECT meetingNo, title, meetingDate FROM `InternalMeeting` WHERE (meetingNo LIKE ? OR title LIKE ? OR points LIKE ? OR actions LIKE ?)"
                       . ($admin ? '' : ' AND (createdById=? OR attendeeIds LIKE ? OR actions LIKE ?)') . " ORDER BY meetingDate DESC LIMIT $n",
                       array_merge([$like, $like, $like, $like], $admin ? [] : [$me, '%"' . $me . '"%', '%"' . $me . '"%']))));

        if ($admin) {
            $add('vendors', 'Vendors', array_map(fn($r) => [
                'title' => $r['name'], 'sub' => implode(' · ', array_filter([$r['brands'], $r['city'], $r['phone']])), 'link' => '/vendors/?q=' . $enc($r['name'])],
                self::rows("SELECT name, brands, city, phone FROM `Vendor` WHERE (name LIKE ? OR brands LIKE ? OR contactPerson LIKE ? OR phone LIKE ? OR gstin LIKE ?) ORDER BY name LIMIT $n",
                           [$like, $like, $like, $like, $like])));
            $add('vendors', 'Purchase orders', array_map(fn($r) => [
                'title' => $r['poNumber'] . ' · ' . $r['vendorName'], 'sub' => implode(' · ', array_filter([$r['company'], self::d($r['poDate']), self::inr($r['totalAmount'])])),
                'link' => '/vendors/?q=' . $enc($r['poNumber'])],
                self::rows("SELECT poNumber, vendorName, company, poDate, totalAmount FROM `PurchaseOrder` WHERE (poNumber LIKE ? OR vendorName LIKE ? OR subject LIKE ? OR quoteRef LIKE ?)
                            ORDER BY poDate DESC LIMIT $n", [$like, $like, $like, $like])));
            $add('users', 'People', array_map(fn($r) => [
                'title' => $r['name'], 'sub' => implode(' · ', array_filter([$r['role'], $r['email'], $r['phone']])), 'link' => '/admin/users/?q=' . $enc($r['name'])],
                self::rows("SELECT name, role, email, phone FROM `User` WHERE (name LIKE ? OR email LIKE ? OR phone LIKE ? OR employeeCode LIKE ?) ORDER BY name LIMIT $n",
                           [$like, $like, $like, $like])));
        }

        // Petty cash (only with access)
        try {
            if (PageAccess::levelFor($auth, 'petty-cash') !== 'hidden') {
                $add('petty-cash', 'Petty cash', array_map(fn($r) => [
                    'title' => $r['description'], 'sub' => implode(' · ', array_filter([self::d($r['entryDate']), ($r['type'] === 'IN' ? 'received ' : 'spent ') . self::inr($r['amount']), $r['paidTo']])),
                    'link' => '/fuel-expense/?q=' . $enc($r['description']) . '#petty-cash'],
                    self::rows("SELECT description, entryDate, type, amount, paidTo FROM `PettyCash` WHERE (description LIKE ? OR paidTo LIKE ? OR billNo LIKE ? OR category LIKE ?)
                                ORDER BY entryDate DESC LIMIT $n", [$like, $like, $like, $like])));
            }
        } catch (Throwable $e) {}

        sendSuccess(['groups' => $groups, 'q' => $q]);
    }
}
