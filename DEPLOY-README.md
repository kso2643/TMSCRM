# Update — 3 Oct (h): photos, files & voice notes on meetings

**Upload:** `api/` (new: `controllers/MeetingAttachmentController.php`, `uploads/.htaccess`, `uploads/meeting-files/`) and `crm/` (`meetings/index.html`, `crm-global.js`, `appointments-reminder-app.js`, `cpr-app.js`), then press **Ctrl+Shift+R** once. The new table is created automatically (`api/database/migration_meeting_attachments.sql` if you prefer to run it).

## Log meeting: Photo · File · Voice note
- **Log a meeting / Log a follow-up** has a new section, *Photos, files & voice notes*:
  - **📷 Photo:** on a phone it offers the camera or the gallery; several photos at once.
  - **📎 File:** PDF, Word, Excel, PowerPoint, CSV, text or images.
  - **🎙 Voice note:** records from the microphone with a timer, **Stop** and **Cancel**, up to 5 minutes per note. The phone asks for microphone permission the first time.
  
  You can review and remove items before saving, then **Save meeting** uploads them ("Uploading 2 of 3…").
- **Opening a saved meeting** shows its attachments: photo thumbnails (click for full size), files with download, and voice notes with a player. You can add more or remove them there too.
- **Meeting cards** show 📷 / 📎 / 🎙 counts.
- **Limits:** 15 MB per file, 30 attachments per meeting.
- **Who can do what:**
  - View: everyone who can see the meeting.
  - Add: the person who logged it, the person it's assigned to, and Manager / Admin / Super Admin.
  - Remove: whoever added the file, the meeting owner, and Manager / Admin / Super Admin.

## Security fixes (important)
- **Any file could be uploaded before.** The old meeting-upload endpoint accepted *any* file type, including `.php`, into the public `uploads/` folder under its own name, so an uploaded script could have been run on the server. It is replaced:
  - files are checked by extension **and** real content;
  - they're stored under random names in `uploads/meeting-files/`, which the web server never serves directly;
  - they're only sent to logged-in users through the API.
- **Scripts can't run in uploads:** `api/uploads/.htaccess` now blocks script files anywhere in the uploads folder.
- **Direct file links tightened:** links like `/uploads/...` only serve real files inside the uploads folder, never scripts or the private attachments folder.

## Alerts don't cover forms or buttons
- **Appointment reminders** now appear in the same bottom-right alert stack as the other alerts. Before, they sat at the top right, covering page buttons like "+ Add opportunity" and the top of form drawers.
- **While a form drawer is open** (Meetings, CPR), the alert stack moves above its Save/Cancel bar and shows only the newest alert. The others come back when the drawer closes.

## Verification
- **Browser:** 17 checks:
  - photo, file and a real recorded voice note (fake microphone);
  - pending remove, save with 3 attachments, card counts;
  - photo and voice loading in the saved meeting, file download;
  - live add and delete, mobile layout.
- **API:** 16 checks:
  - other users can view but not add or delete;
  - login required for files;
  - range requests for audio;
  - the private folder, `../.env` and `.php` files can't be reached through `/uploads/`;
  - disguised and oversized files rejected.
- **Alerts:** 12 checks for reminder placement.
- **All earlier suites pass.**

---

# Update — 3 Oct (g): CPR register + Saturday review + weekly/monthly reports; quotation fixes

**Upload:** `api/` and `crm/` (new: `crm/cpr/`, `crm/cpr-app.js`, `crm/vendor/pdfjs/`, `api/controllers/CprController.php`, `api/includes/StyledXlsxWriter.php`), then press **Ctrl+Shift+R** once. The new tables are created automatically on first use (`api/database/migration_cpr.sql` if you prefer to run it yourself).

## 1. CPR & weekly review (new page, Sales → "CPR & weekly review", `/cpr/`)
The **Master CPR** Excel as forms. Sales engineers see and update their own opportunities; Manager / Admin / Super Admin see everyone's.

- **Register:** every opportunity with the sheet's columns:
  - Region & City, SE, Channel/Direct, Distributor, Customer;
  - Material group / sub-group, captured date, Component, Opportunity, EDP;
  - Product group, Focus product group, C/P/R, Annual potential, Objective, Competition, Person responsible, Time line;
  - Expected sale, Order value till date, Status, and a Red/Yellow/Green colour.
  
  It has totals (in Rs lakhs), status counts, search, filters (engineer, status, colour, C/P/R, product group) and sorting. The **+ Add opportunity** form uses the same dropdown lists as the sheet's *List Master*.
- **Saturday review:** opens on this week's Saturday, with one card per opportunity:
  - the last review's remark;
  - this week's status, R/Y/G, expected sale, order value, time line and remark.
  
  Save once for all changed cards. A progress bar shows how many open opportunities have been reviewed. Admins see the cards grouped by engineer. Saving again on the same date updates that review; it doesn't duplicate it.
- **Weekly and monthly reports (separate downloads):** Excel files in the **Master CPR layout**:
  - the same columns A–W, plus Status R/Y/G;
  - "Total in Lakhs" subtotals in row 1, frozen headings and filters;
  - a **"Remarks as on dd.mm.yyyy"** column for each review: the weekly file has this week's and the previous review's remarks, the monthly file has every Saturday in the month.
  
  Extra sheets: **Summary** (key figures, and totals by status, engineer, product group and C/P/R), **This week review** (each entry, with status before → after), **New opportunities**, and **List Master**. Admins can download for one engineer or for everyone.
- **Import your CPR Excel** (Manager and above, on the reports tab):
  - Columns are matched by heading, and "Remarks as on …" columns become dated reviews.
  - Re-importing the same sheet updates the existing entries; it doesn't duplicate them.
  - Tested with *Master - CPR 010221 - Uthay.xlsx*: 1,333 opportunities and 72 remarks, with totals identical to the sheet (potential 2,358.46 L, expected 662.55 L, orders 35.22 L).
  - The SE "Uthay" is linked automatically to a CRM user named Uthay, if one exists. Until then, the name from the sheet is shown.

## 2. Quotations
- **Fixed: items shuffled when you open an old quotation.** All items of a quotation were saved with the same timestamp, and the list was sorted by that timestamp only, so the order came back random (reproduced: 15 items came back out of order). Items now keep a saved position, so they always come back in the order you entered them, both on reopening and after editing.
  - Quotations saved *before* this update are re-sorted by their internal IDs, which almost always follow the original order.
- **Fixed: item notes were lost on save.** They are now stored and reloaded.
- **APJ: "Upload PDF"** (top bar, next to *Saved*):
  - Opens a quotation PDF in the editor.
  - PDFs downloaded from the APJ page now carry the full quotation inside them, so they reload **exactly**: customer, all items in order, notes and terms.
  - Older PDFs without that data are read from their printed text and table, including multi-page PDFs and wrapped specifications. Check the details, then Save.
  - If the quotation still exists in the CRM, Save updates it; otherwise Save creates a new one.
  - The PDF reader (pdf.js) is bundled in `crm/vendor/pdfjs/`.

## 3. Excel imports use less memory
Excel files that keep formatted-but-empty rows down to row 1,048,576 (your CPR file does) were padded with a million empty rows when read. Empty rows are now skipped. This applies to every Excel import (products, customers, stock, CPR).

## Verification
- **CPR API:** 27 checks: visibility, permissions, SE forced to self, list normalisation, validation, review save/update, older reviews not overwriting newer ones, reports, template, delete.
- **CPR browser:** 27 checks: register, filters, form, add for another SE, sales-engineer view, Saturday review save/update, both report downloads with the right file contents, admin grouping, mobile layout, link from React pages.
- **Quotation:** order and notes kept on save and edit (fails on the old code); APJ PDF round-trip exact; old-PDF text read for 8 items, 30 items (3 pages) and wrapped specs.
- **Files open in LibreOffice Calc.** All earlier browser suites pass (43 + 31 + 45 + 29 + 10 + 15), and the backup round-trip passes with the new tables.

---

# Update — 3 Oct (f): "+ Log meeting" on Meetings & follow-ups

**Upload:** `crm/meetings/index.html` and `crm/appointments-reminder-app.js` (or the whole `crm/` folder), then press Ctrl+Shift+R once. No API changes.

- **New "+ Log meeting" button** at the top right of Meetings & follow-ups. It opens a form with:
  - **Customer** (required): type part of the company, contact or phone and pick from the list. If the customer doesn't exist, a link takes you to Customers to add them first.
  - **Meeting date** (required) and time, **type** (Visit, Call, Online, …) and **status**.
  - **Assign to** (Admin, Super Admin and Manager only).
  - **Discussion summary**, customer requirements and notes.
  - **Next follow-up** date, time and priority. The usual follow-up reminder alerts are scheduled automatically.
- **From the Follow-ups tab** the button opens "Log a follow-up", with tomorrow 10:00 filled in. There, the follow-up date is required.
- **Direct link:** `/meetings/#new` opens the form straight away, for example from a dashboard shortcut.
- **Fixed:** on the hand-coded pages (Meetings, Quotations, Payroll and others) the appointment reminder popup showed as plain unstyled text at the bottom of the page. It now has its own styles and appears just below the page header, so it no longer covers header buttons.

---

# Fix — 3 Oct (e): Live tracking page blank

**Problem:** the Live tracking page opened blank. Its script file was in a folder named `admin/live-tracking/`, and ad blockers (uBlock, AdBlock, Brave shields) block any script whose address contains the word "tracking". With the script blocked, the page showed nothing.

**Fix:**
- The page's script now loads from `_next/static/chunks/app/(dashboard)/admin/live-map/`. The page address `/admin/live-tracking/` stays the same.
- The new Location history page and the Daily tracking report now call API addresses without "tracking": `/api/route-log/...` and `/api/reports/daily-movement`. The old addresses still work.

**Upload:** `crm/` (including the new `_next/static/chunks/app/(dashboard)/admin/live-map/` folder) and `api/index.php`, then press Ctrl+Shift+R once.

**Verified:** in a browser that blocks every script and API address containing "tracking", Live tracking shows the map and the checked-in employees, Location history loads, and the Daily tracking report downloads.

---

# Update — 3 Oct (d): calendar, alerts page, reports & backup, product import, location history, breaks, meetings

**Upload:** `api/` and `crm/` (now including the new `crm/vendor/leaflet/` folder), then press **Ctrl+Shift+R** once. Nothing to run in the database; new tables are created automatically.

## 1. Appointments: real monthly calendar
The month view now displays as a proper 7-column calendar. Before, the grid styles were missing from the compiled stylesheet, so it showed as one long list.
- **Layout:** a full 6-week view with the neighbouring months' days greyed out; weekends shaded, and today highlighted.
- **Visits:** each visit is a chip with time, customer and engineer, coloured per engineer, with a colour legend. A day count shows on busy days, and "+N more" opens that day.
- **Summary:** a "N visits this month · N completed" line.
- **Robustness:** the Appointments API now creates its own tables if they're missing, like the other modules.

## 2. Alerts & reminders page (hand-coded) with tasks, trials and leave
`/alerts/` is now one page for everything:
- **Tabs:** All · Follow-ups · Appointments · Tasks · Trials · Leave · Price requests · Breaks & location (Super Admin).
- **Behaviour:** grouped by day, with "new" dots, Mark as read / Mark all as read, a 7–60 day period, and an "Open →" link on every item.
- **Leave alerts (new):** Super Admin / Admin get a sound alert for every new leave request; the employee gets one when their leave is approved or rejected.
- **Links:** the sidebar "Alerts & reminders" link and the top-bar bell (previously a dead button) now open this page.

## 3. Reports: every page downloadable, plus full backup
`/admin/reports/` is now a hand-coded page with **16 reports**, each downloadable as CSV, Excel or PDF for any date range (presets: Today, This month, Last month, This year, All time):
- **CRM & sales:** Customers, Follow-ups, Quotations, Products, **Orders**, **Trials**, **Price requests**.
- **Operations:** Attendance, **Daily tracking** (punch times, location points, km, breaks), **Breaks**, Fuel expense, Leave, **Appointments**, **Tasks**.
- **Team & audit:** Team, Activity log.

**Fixed:** the existing **Leave report always failed** with an SQL error, because `Leave` is a reserved word in MySQL and MariaDB.

**Full data backup (Super Admin):**
- **Export full backup:** downloads every table as one JSON file. It's streamed, so large databases are fine.
- **Import backup:** merges a backup file back in. Records are added, or updated if the same ID exists. **Nothing is ever deleted.** It runs as one transaction, so if anything fails, nothing changes.
- **Not included:** uploaded files (`api/uploads/`); back those up from the hosting file manager.

## 4. Products: Excel template + import
On the Products page (Admin / Super Admin), two buttons appear next to **Add product**:
- **⤓ Excel template:** downloads a ready-to-fill template.
- **⤒ Import from Excel:** upload the filled `.xlsx` or `.csv`.
  - Existing item codes are updated and new ones are added.
  - Blank cells keep the current value.
  - Columns are matched by heading, so their order doesn't matter.
  - Wrong rows are listed with the reason (e.g. "Row 3: price 'abc' is not a number").

## 5. Location history, mandatory location, tea / lunch breaks
- **Location history (new page, Admin → Location history):** for Super Admin, Admin and Manager.
  - Pick any person and any previous day; a day strip shows which days have data, with days punched in without location in red.
  - The map shows the route, punch-in and punch-out points, stops of 10+ minutes, and tea / lunch break locations, with a slider to replay the day.
  - Alongside: distance, points, time on duty, break time, and a timeline.
  - The map library (Leaflet) is bundled in `crm/vendor/leaflet/`, so no outside CDN is needed.
- **Location is mandatory for punch in / punch out:**
  - The API refuses a punch without a location.
  - The page now waits up to 15 seconds for GPS (before, it gave up after 5 seconds and punched in without location).
  - If location is off or blocked, the employee sees how to turn it on.
- **Tracking from every page:** while punched in, a location point is recorded every 2 minutes from any CRM page. Before, this only happened while the Attendance page was open.
- **30 minutes in one place:** after 30 minutes within about 150 m, the employee hears a chime and gets **"Are you on a break?"** with three choices:
  - ☕ Tea break, or 🍽 Lunch break;
  - "No — I'm working here", which asks again after another hour.
  
  If they don't answer within 10 minutes, Super Admin is told.
- **Break button:** in the corner, "☕ Take a break" (tea or lunch) any time, and while on a break, a running timer with **End break**. Punching out ends any open break.
- **Location turned off while punched in:** a red banner tells the employee, and Super Admin is alerted (at most once per 30 minutes).
- **Super Admin alerts:** break started (and whether it came from the 30-minute prompt), stationary with "working here" or no answer, and location off. These appear as sound alerts and on the Alerts page.
- **Fixed:** Super Admin could not view an engineer's location trail (the check allowed only the "ADMIN" role).

## 6. Meetings & follow-ups: one page, same sidebar as everywhere
- **One version of the page:** clicking Meetings (or Reports or Alerts) in the sidebar now opens the same hand-coded page that a refresh shows. Before, the link opened the old built-in React page.
- **Back-links fixed:** the Check-in page's "back to meetings" links were fixed too.
- **Safety net:** any click inside the React app on a link to a hand-coded page now does a full page load.
- **Sidebar on hand-coded pages:** Meetings, Quotations and Payroll now show the CRM sidebar docked on the left on desktop, exactly like every other page. On phones they keep the Menu button.

## Notes
- **Breaks need the CRM open:** break detection and 2-minute tracking run in the browser, so they only work while the CRM is open on the employee's phone or laptop (it can be in the background). A browser can't track a closed app; that would need a native mobile app.
- **Fresh file names:** the React sidebar file is renamed again (`layout-3b9d61f0a47e2c85.js`), and so is the Check-in page file, so browsers can't keep serving old copies.
- **Download file names:** the API now exposes `Content-Disposition`, so downloads keep their proper file names across domains.

## Verification
- **API:** 220 checks. That includes 75 new ones for leave alerts, alert history, location-required punches, breaks, stationary and location-off logging, location history, all 7 new reports in all 3 formats, the 9 existing exports, backup export/import round-trip, and product import.
- **Browser:** 148 checks. The 45 new ones cover:
  - the calendar grid;
  - the Alerts page;
  - report downloads and backup import;
  - product import on the React page;
  - punch-in with location denied (help shown, nothing recorded) and allowed;
  - the 30-minute break prompt, tea break, End break and a manual lunch break;
  - Location history with the Super Admin break alert;
  - Meetings opening the hand-coded page, docked on desktop and with a drawer on mobile.

---

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
