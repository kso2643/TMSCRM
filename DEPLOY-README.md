# Fuel expense, Attendance, HR, Appointments, and Orders — patched build

Two folders, both drop-in replacements for your live server:

- `api/` → upload to **api.apjtech.in**
- `crm/` → upload to **crm.apjtech.in**

No rebuild needed anywhere. `crm/` is your compiled Next.js export with everything patched directly into it.

---

## Fixing the 500 error you saw

Your screenshot's `GET /api/orders?limit=100` returning `500` with a generic "Internal server error" almost certainly means **`migration_orders.sql` hasn't been run on your live database yet**. I reproduced your exact symptom locally — deploy everything except that one migration, and you get precisely that: a 500 on `/api/orders`, while `/api/orders/engineers` (which only touches your existing `User` table) works fine. The server-side log for that reproduction read `Table 'industrial_crm.CustomerOrder' doesn't exist`.

**Fix:** run this if you haven't already —

```bash
mysql -u <user> -p <database> < api/database/migration_orders.sql
```

That should clear it immediately. If the page still errors after that, the real cause is always in your PHP error log even though the browser only ever sees the generic message — that's deliberate (so internals aren't leaked to the client), but it's where to look next. On Hostinger that's under hPanel → Advanced → PHP Configuration, or ask their support where error logging is exposed for your plan.

---

## What's in this delivery

1. **Fuel expense** — meter-reading prompt at punch in/out, logged on its own page.
2. **Attendance → All employees** — an admin tab on the existing Attendance page.
3. **HR** — an employee directory + personnel profile page.
4. **Appointments** — an engineer-scheduling calendar.
5. **Orders** — verbal & purchase order tracking with delivery status.
6. **Procurement status + expected arrival** *(new this round)* — see below.

## Step 1 — database

Run whichever of these you haven't already, **in this order**:

```bash
mysql -u <user> -p <database> < api/database/migration_fuel_expense.sql
mysql -u <user> -p <database> < api/database/migration_appointments.sql
mysql -u <user> -p <database> < api/database/migration_orders.sql
mysql -u <user> -p <database> < api/database/migration_orders_procurement.sql
```

The last one is new this round and needs `migration_orders.sql` to already have run — it adds two columns to the table that one creates. All four are additive only.

## Step 2 — upload

Upload `crm/` and `api/`. That's it.

---

## Procurement status + expected arrival — new this round

Reading your message, this seemed like two related but distinct things from what Orders already tracked:

- **Delivery status** (already built): has the item been handed to the customer? Pending / Delivered / Not delivered.
- **Procurement status** (new): has the company itself placed the order with *its* supplier yet? Not ordered / Ordered.
- **Expected arrival** (new): once ordered, when it's expected — an actual date, not just a status.

Both new fields are **admin-set, everyone-visible** — an engineer sees them on the order but can't change them, matching "given by admin, shown to engineers." Reverting procurement status back to Not ordered also clears the expected-arrival date, since an ETA for an order that was never placed doesn't mean anything.

- **List page**: a combined "Procurement" column — the badge, with "Arriving `<date>`" underneath once one's set — plus a new procurement filter alongside the date/engineer/delivery-status/order-type ones you already had.
- **Order detail**: admin gets two small inline controls (a Not ordered/Ordered toggle, and a date field with a Set button) right in the same view as the delivery-status actions, not tucked behind a separate edit mode. Everyone else sees the same information as plain text.

If I've read your message wrong and this isn't quite what you meant, tell me what's off and I'll adjust it rather than starting over — the plumbing (migration, endpoints, permissions) is all in place either way.

---

## Everything else, unchanged in behavior

**Orders** — verbal/PO tracking, multi-product per order, delivery lifecycle, admin-on-behalf-of-engineer creation, all filters. `/orders/`, under Sales in the sidebar.

**Appointments** — engineer-scheduling calendar, month/day views, evening-before reminders. Visible to everyone.

**HR** — admin-only employee directory + profile drawer. Sensitive fields masked behind a Show/Hide toggle.

**Attendance → All employees** and **Fuel expense** — as before, with the Manager-role-gating fix from a couple of rounds back still in place.

---

## New/changed files this round

| File | |
|---|---|
| `api/database/migration_orders_procurement.sql` | **new** — the two columns above |
| `api/controllers/OrderController.php` | + `updateEta()`, + `updateProcurement()` |
| `api/index.php` | + two routes (`PATCH .../eta`, `PATCH .../procurement`) |
| `orders-app.js` | + the procurement/ETA UI described above |

Everything else — every other feature and page — is exactly what you already have.

---

## Verification

**Backend** — 141 assertions against PHP 8.3 + MariaDB over real HTTP: the full cross-module regression pass, the complete Appointments suite, and the complete Orders suite including 20 new assertions for this round — both new endpoints' admin-only gating (a non-admin, even the order's own creator, is blocked from setting either field), invalid-status rejection, the ETA being set and cleared, the procurement filter, and reverting to Not-ordered correctly clearing the ETA as a side effect.

**Frontend** — 337 assertions across six suites in a real DOM (jsdom): the five from before, still 100% passing, confirming this round didn't disturb anything, plus 15 new assertions on the Orders suite — the combined procurement/ETA column rendering, the new filter refetching correctly, the admin toggle and date-setter firing the right `PATCH` calls with the right bodies, and confirming a non-admin sees both fields as read-only with no controls at all.
