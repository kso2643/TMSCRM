# Update — 3 Oct (c): sound alerts, completed task details, same menu and icons on every page

**Upload:** `api/` and `crm/`, then press **Ctrl+Shift+R** once. Nothing to run in the database.

### 1. Alerts with sound, on every page
A new site-wide script, `crm/crm-global.js`, is added to every page. While the CRM is open it checks for news every 30 seconds. When something arrives it plays a short **chime** and shows an alert in the **bottom-right** corner. The alert has an **Open →** link, and you can get a desktop notification if you allow them.

Who is alerted:

| Who | Gets alerted when |
|---|---|
| The person a task is assigned to | a task is **assigned** to them (with priority) |
| The admin who assigned it (Super Admin: every task) | a task is **completed**: who did it, how long it took, and the completion note |
| Super Admin / Admin | a new **price request** or **trial request** arrives, or a trial is **completed** |
| Engineers | their price request is **approved or rejected**, or their trial is **approved or rejected** |

Behaviour:
- **Sound:** browsers only allow sound after you click somewhere on the page once. Until then the alert says "Click anywhere on the page to turn on alert sounds".
- **Controls:** each alert bar has **Mute**, **Desktop alerts** and **Dismiss all** buttons.
- **Staying on screen:** "New task" alerts stay until you close them; the others close themselves after 20 seconds. At most 3 show at once ("+N more alerts — see all").
- **No repeats:** an alert is never shown twice. If several CRM tabs are open, only one tab checks for alerts.
- **When you were away:** alerts from the last 12 hours show the first time you open the CRM.
- **Auto-refresh:** the Tasks and Trials pages refresh themselves when a relevant alert arrives.

The server feed is `GET /api/alerts-feed` (`api/controllers/AlertFeedController.php`). It reads the existing tables; no new table is needed.

### 2. Completed task details (Tasks → **Completed** tab)
- **Filters:** Today, Last 7 days, This month, All time, or a custom date range. There's also a person filter (admins) and a search over task, customer and note.
- **Totals:** tasks completed, total time spent, average time per task, and on time vs late (against the due date). Admins also get a per-person breakdown.
- **Table:** completed time, task and customer, who did it, who assigned it, priority, time taken, due date with an on time or late badge, and the note.
- **Details:** click a row for the full timeline (assigned → started, with time waited in queue → completed), the time spent working (timer time, pauses excluded), the description and the full completion note.
- **Download CSV** of what's shown.
- The "Task completed" alert opens this tab (`/tasks/#completed`).

### 3. Tasks and Trials missing from the sidebar on older pages
There were two causes, both fixed:
- **Old cached copy of the React sidebar.** The React pages (Dashboard, Customers, Products…) were still running a cached copy of their sidebar file. That file kept the same name between builds, so browsers and Hostinger's cache never fetched the update. The patched sidebar is now saved under a new file name, `layout-c7e41a9d2b6f0358.js`, and all 39 page files point to it. The old file is kept too, so nothing breaks.
- **Some pages had no CRM sidebar at all.** Meetings, Quotations and all the Payroll pages use their own layouts. They now get a **Menu** button in the bottom-left that slides out the same CRM sidebar, with the same items and role rules. It's drawn in an isolated layer, so it can't disturb those pages' own styling.

### 4. Professional icons
Every sidebar item now has its own icon from the same lucide set the app already uses, identical in both sidebars. Before, Orders, Trials, Quotations and Payroll all shared one document icon, and Fuel expense shared Attendance's clock. New icons:

| Item | New icon |
|---|---|
| Orders | clipboard list |
| Trials | lab flask |
| Tasks | checklist |
| Fuel expense | fuel pump |
| Meetings & follow-ups | handshake |
| Payroll | wallet |
| HR | contact card |
| Activity logs | activity line |

### Verification
- **API:** 76 + 15 + 33 earlier checks, plus 21 new ones for the alert feed and completed history. They cover who gets which alert, no self-alerts, the completed list's date, person and search filters, the on-time / late counts, and per-person totals.
- **Browser:** 43 + 29 earlier checks, plus 28 new ones:
  - Tasks and Trials appear on a React page
  - identical icons in both sidebars
  - the Menu drawer on Meetings, Payroll and Quotations
  - an assigned task showing an alert *and* playing the chime, with no duplicates and the newest on top
  - the Completed tab, its row details and the CSV download

---

# Fix — 3 Oct (b): "This Page Does Not Exist" inside the Trials form

The form inside the Trials page was a single root-level file (`crm/trial-sheet.html`), and it wasn't found on the server, so Hostinger's 404 page appeared inside the form box. The form now lives in its own folder, **`crm/trial-sheet/index.html`** (opened at `/trial-sheet/`), the same layout as every other page that already works (`orders/`, `tasks/`).

If the form ever can't load, the Trials page now says exactly which file is missing, instead of showing a 404 inside the box.

**Make sure these are on the server after uploading `crm/`:**
- `crm/trial-sheet/index.html` (about 2 MB)
- `crm/trials/index.html`
- `crm/trials-app.js`
- `api/controllers/TrialController.php`, plus the updated `api/index.php`

The old `crm/trial-sheet.html` is no longer used and can be deleted.

---

# Update — 3 Oct: new Trials page (Sales → Trials, `/trials/`)

**Upload:** `api/` and `crm/` as usual, then press **Ctrl+Shift+R**. Nothing to run in the database; the API creates the `Trial` table on first use, matching your collation. `api/database/migration_trials.sql` is there if you'd rather run it by hand.

Your HTML tool ("Existing situation data analysis with cost savings") is used **as-is** for both forms. It is added as `crm/trial-sheet/index.html` (opened at `/trial-sheet/`) and opens inside the Trials page. Only a small bridge script is appended at the end of the file, so each trial's sheets are saved to the CRM database instead of the browser. Opened directly, the file still works exactly as before.

### How a trial works
1. **Raise a trial request:** the engineer clicks **+ New trial request** and fills the **Existing situation data analysis**. This is the same form as your HTML tool, including the cutting-data library, the Sheet preview and the PDF/Excel downloads.
   - Customer name and component name are required.
   - They can optionally link a CRM customer, which fills the customer name in the sheet.
   - The trial gets a number like `TR-2026-001`, which is also used as the sheet's report number.
2. **Approval and recommendation (Super Admin / Admin):**
   - Add one or more recommendations. Each has a category dropdown (**Cutter / Insert / Key / Drill / Tap**) and a **spec**, plus an optional quantity and notes.
   - If the category is **Insert**, a **Grade** field appears and **both spec and grade are required**.
   - Or **reject** with a reason. The engineer can then correct the existing data and resubmit it.
   - After approval the existing data is locked for engineers (admins can still correct it). Admins can also edit the recommendation later.
3. **Cost savings report (after the trial):** this opens once the trial is approved. It's the **Trial comparison / cost savings** form from your tool.
   - It's pre-filled from the existing data: customer, engineer, workpiece, material, production and machine.
   - The first tool column is the **existing tool** and the **recommended tools** are added as the next columns.
   - **Save draft** at any time. **Submit report & complete trial** marks the trial Completed.
   - The best tool and the saving per year (and %) are worked out by the tool's own cost calculation and shown in the trials list.

### Who sees what
- Engineers see their own trials. Super Admin, Admin and Manager see all trials.
- Only Super Admin and Admin can approve or reject.
- An engineer can delete their own request while it is pending or rejected.

### Verification
- **API:** 33 new checks on a `utf8mb4_general_ci` database:
  - required fields and trial numbering
  - who can see, approve and edit
  - the Insert-needs-grade rule and category validation
  - the existing data locking after approval
  - draft vs complete for the savings report, and reject → resubmit
- **Browser:** 28 new checks driving the real embedded sheet in Chromium:
  - raising a trial, including the CRM customer filling the sheet
  - the approval form (grade appears only for Insert)
  - the savings report pre-filled with existing and recommended tools
  - draft saving, completing, and the read-only view after approval
  - the HTML file still working on its own
- **Earlier suites:** 76 + 15 API checks and 43 browser checks, all still passing.

---

# Update — 2 Oct: Team live board + clearer price requests

**Upload:** `api/` and `crm/` (same as before; `api/.env` isn't included, so yours stays as it is), then press **Ctrl+Shift+R** on the Tasks page. Nothing to run in the database.

### Team live (Tasks → Team live) — Super Admin, Admin, Manager
- One card per person, people who are working right now first. Each card shows:
  - their state: **Working now / Paused / Not started / No tasks**
  - the task they're on and its **live timer**
  - **time today**, **tasks done today** and **tasks in queue**
- Tiles at the top filter the board: Everyone / Working now / Paused / Have tasks, not started.
- **Click a person** to see all their tasks, with start and finish times, completion notes and the time spent on each.
- Timers tick every second, and the board refreshes itself every 20 seconds.
- This is now the first tab admins see.
- "Time today" adds up the time on tasks finished today plus the current task's timer. A task started yesterday and finished today counts in full.

### Price requests — clearer
- A one-line "how it works" at the top, written separately for engineers and for admins.
- Tiles for **Waiting for decision / Approved / Rejected / All**, which also work as filters. Admins can also filter by engineer.
- Each request shows **List price → Price asked for → Approved price** side by side, each with **% below or above list price** and the **total for the quantity**.
- Each request also shows the engineer's reason, then a clear result:
  - "✓ Approved at ₹87", or "✕ Rejected" with the reason
  - who decided it, and when
- **Your decision** box for admins: as you type the price, it shows the discount and the total live.
- After approving or rejecting, a confirmation appears saying the engineer can see the answer.
- The engineer's form is numbered 1–5 and only the product is required. It shows the discount live as they type, and a confirmation after sending.

### Fixes in this round
- **Per-item procurement buttons on Orders:** your newer `orders-app.js` calls `/orders/:id/items/:itemId/procurement` and `/eta`, but `index.php` had no routes for them, so those buttons failed with a 404. The routes are now added.
- **Tasks link in the sidebar:** your latest upload had an older `app-shell.js` and sidebar file without the "Tasks" link. It's restored, and the service-worker revision has been bumped so browsers pick it up.

### Verification
- **API:** the 76 earlier checks plus 15 new ones, run on a `utf8mb4_general_ci` database like yours. The new ones cover:
  - who can see the board (engineers are blocked)
  - running / paused / waiting states and their order
  - today's totals and the price-request counts
  - the engineer filter
  - the per-item routes
- **Browser:** 43 checks in headless Chromium, including the Team live timers ticking, the filters, the per-person detail, and the live discount hints. They also cover the whole Orders flow on your newer `orders-app.js`.

---

# Orders fix + Tasks page + new Orders columns: patched build

Two folders, both drop-in replacements, same as before:

- `api/` → upload to **api.apjtech.in**
- `crm/` → upload to **crm.apjtech.in**

`api/.env` is **not** included, so your server's existing `.env` (database password, JWT secret) is left as it is.

---

## 1. Fixing the 500 error on the Orders page

**Cause:** `GET /api/orders` returned 500 because the `CustomerOrder` table didn't exist on the live database: `migration_orders.sql` hadn't been run, or it failed partway. I got exactly the same error locally:
`Table 'CustomerOrder' doesn't exist` → `{"success":false,"message":"Internal server error"}`.

**Fix:** the API now repairs this itself. When the Orders, Tasks or Price-request endpoints are used, the API checks the database and creates any missing table or column (`api/includes/SchemaGuard.php`). It only ever adds tables and columns and never drops or changes existing data. If the database user isn't allowed to create tables, the page shows a readable message naming the SQL file to run, not a bare "Internal server error".

If you'd rather run the SQL yourself, the files are safe to run more than once:

```bash
mysql -u <user> -p <database> < api/database/migration_orders_all.sql
mysql -u <user> -p <database> < api/database/migration_tasks_price_requests.sql
```

### Update: the 500 was still there after the first patch — cause found and fixed

Your live database's existing tables (`User`, `Customer`) use the **`utf8mb4_general_ci`** collation, while the orders migration hard-coded **`utf8mb4_unicode_ci`**. That mismatch:
1. made the original `migration_orders.sql` fail with *"Foreign key constraint is incorrectly formed"*, which is why the table was missing, and
2. once the table did get created, made every orders query fail with *"Illegal mix of collations"*, which still showed as "Internal server error".

`SchemaGuard.php` now creates the tables in the same collation as your `User` table. It also **automatically converts** the orders tables that the previous patch had already created with the wrong collation. **Just upload the new `api/` folder; there's nothing to run.**

Super Admin / Admin now also see the real cause of any future server error, shown next to "Internal server error". Other users still see only the generic message.

## 2. New: Tasks page (sidebar → Operations → Tasks, `/tasks/`)

**Task queue with timer**
- **Super Admin / Admin** assign tasks with **+ Assign task**. Each task has a title, the person, a priority, an optional due date, an optional customer and a description. A new task goes to the end of that person's queue.
- The assignee opens **My tasks**, which shows **Up next** → **▶ Start task & timer**. A live timer (hh:mm:ss) runs while they work, and they can **Pause / Resume** it.
- **Complete…** takes an optional note. **Complete & start next** finishes the task and starts the next one in the queue straight away.
- Tasks are done strictly in queue order, and each person can have only one task in progress at a time.
- The server keeps the time, so the timer is still correct after a page reload or on another phone.
- **All tasks** tab (Super Admin, Admin, Manager): everyone's queues, grouped by person, with live timers. Admins can reorder a queue (↑ ↓), edit and delete tasks. A task that hasn't been started yet can also be reassigned.

**Price requests** (tab on the same page)
- Any engineer can **+ Raise price request**. They pick a product from the catalogue (the list price fills in automatically) or type the item name. They can also add a customer, quantity, the price they want to offer and a note.
- **Super Admin / Admin** approve it with a final price (pre-filled with the price the engineer asked for) or reject it with a reason. The engineer sees the result on the same tab.
- A red counter on the tab shows how many requests are still pending.

## 3. Orders page: new columns and expandable rows

The list now has these columns: **Customer · Sales engineer · Type · Order date · Expected date · Price / proforma · Procurement · Delivery · Materials**

- **Price / proforma**: a dropdown, *Not confirmed / Confirmed*.
- **Delivery**: a dropdown, *Pending / Delivered / Partially delivered / Not delivered*.
- **Expected date**: admins set it straight in the table. It turns red when it has passed and the order still isn't delivered.
- **Materials**: shows how many items have been supplied, e.g. "2 / 3 supplied".
- **Click the sales engineer's name** (or anywhere on the row) to expand the order and see its materials. Tick the items that were supplied:
  - all ticked → **✓ Mark order complete**
  - some ticked → **Save as partially complete**, and a **reason is required**
  - none ticked → **Mark not delivered**, and a **reason is required**
- Picking *Partially delivered* or *Not delivered* in the dropdown opens this checklist for you to fill in.
- New filter for price / proforma, a **Clear filters** button, and summary counts for partially complete orders and confirmed proformas.
- The order's own engineer or admin-tier users can change these fields. Everyone else sees them read-only.

---

## Files changed

| File | |
|---|---|
| `api/includes/SchemaGuard.php` | **new**: auto-creates missing tables/columns (fixes the 500) |
| `api/controllers/TaskController.php` | **new**: task queue + timer |
| `api/controllers/PriceRequestController.php` | **new**: price requests |
| `api/controllers/OrderController.php` | + proforma, partial delivery, per-item supply, schema check |
| `api/index.php`, `api/includes/Auth.php` | admins see the real error on a 500; + `/api/tasks/*`, `/api/price-requests/*`, `PATCH /api/orders/:id/proforma`, `PATCH /api/orders/:id/supply` |
| `api/database/migration_orders_all.sql` | **new**: optional manual migration |
| `api/database/migration_tasks_price_requests.sql` | **new**: optional manual migration |
| `crm/orders-app.js` | new Orders list, expandable rows, materials checklist |
| `crm/tasks-app.js`, `crm/tasks/index.html` | **new**: Tasks page |
| `crm/app-shell.js`, `crm/_next/…/layout-5e2d23428c8316d2.js` | "Tasks" added to the sidebar |
| `crm/sw.js` | cache revision bumped so browsers load the new sidebar |

After uploading, **hard-refresh the browser (Ctrl+Shift+R)** once. The app caches its JavaScript, so without this you may still see the old page.

## Verification

- **API:** 76 checks against PHP 8.4 + MariaDB, starting from a database with **no** orders tables (your exact 500):
  - the schema repairs itself
  - proforma and supply rules work, including reason enforcement and who is allowed to change what
  - the task queue works: queue order, one task at a time, pause freezes the timer, complete & start next, reorder and reassign
  - price requests: raise, approve and reject rules
- **Browser:** 32 checks in headless Chromium against that API:
  - Orders: dropdowns, expanding rows and ticking materials, partial delivery with a reason, a read-only view for other engineers
  - Tasks: assigning tasks, the timer ticking and pausing, complete & start next
  - Price requests: raising one and approving it
  - the mobile layout
