# Industrial CRM — PHP/MySQL Backend

Drop-in API replacement for the original Node.js/Prisma/PostgreSQL backend.
The React frontend is **unchanged** — all API routes, request shapes, and
response shapes are identical to the Express version.

---

## What changed / what didn't

| Layer | Original | This version |
|---|---|---|
| Language | Node.js 18 | PHP 8.1+ |
| Framework | Express | Plain PHP router (`index.php`) |
| Database | PostgreSQL via Prisma | MySQL 8 via PDO |
| ORM | Prisma Client | Raw PDO prepared statements |
| JWT | `jsonwebtoken` npm | `includes/JWT.php` (pure PHP HS256) |
| Password | `bcryptjs` npm | `password_hash()` / `password_verify()` |
| PDF | `pdfkit` npm | `includes/SimplePdf.php` (pure PHP) |
| XLSX write | SheetJS (`xlsx` npm) | `includes/XlsxWriter.php` (ZipArchive) |
| XLSX read | SheetJS | `includes/XlsxReader.php` (ZipArchive) |
| File uploads | `multer` npm | PHP built-in `$_FILES` |
| CORS | `cors` npm | `sendCorsHeaders()` in `index.php` |
| ENV | `dotenv` npm | `load_env()` in `config/config.php` |
| **Frontend** | React (Next.js) | **Unchanged** |

---

## Requirements

- PHP 8.1 or higher
- Extensions: `pdo_mysql`, `zip`, `mbstring`, `json` (all bundled with standard PHP builds)
- MySQL 8.0+ (or MariaDB 10.6+)
- Apache with `mod_rewrite` **or** PHP built-in server for development

---

## Quick start

### 1. Create the database

```sql
CREATE DATABASE industrial_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'crmuser'@'localhost' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON industrial_crm.* TO 'crmuser'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Run the schema

```bash
mysql -u crmuser -p industrial_crm < database/schema.sql
```

> Already have this database running in production? **Don't** re-run `schema.sql` — it
> `DROP TABLE`s everything first. Use the incremental migration files instead (e.g.
> `database/migration_quotation_company.sql`, `database/migration_payroll_hr.sql`) —
> see [Quotation company / brand (APJ vs TMS)](#quotation-company--brand-apj-vs-tms) below.

### 3. Configure environment

```bash
cp .env.example .env
nano .env   # fill in DB_*, JWT_SECRET, FRONTEND_URL
```

### 4. Seed demo data (optional)

```bash
php scripts/seed.php
```

Login credentials seeded:
- `superadmin@tms.com` / `Admin@123`
- `admin@tms.com` / `Admin@123`
- `manager@tms.com` / `Manager@123`
- `raj@tms.com` / `Sales@123`

### 5. Start the server

**Development (built-in PHP server):**
```bash
php -S localhost:5000 index.php
```

**Production (Apache):**
- Point the VirtualHost DocumentRoot to this folder
- Enable `mod_rewrite` and set `AllowOverride All`
- The `.htaccess` handles all rewrites automatically

**Nginx:**
```nginx
location / {
    try_files $uri $uri/ /index.php$is_args$args;
}
location ~ \.php$ {
    fastcgi_pass unix:/run/php/php8.1-fpm.sock;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    include fastcgi_params;
}
location /uploads/ {
    alias /path/to/backend-php/uploads/;
    access_log off;
}
```

### 6. Point the frontend at the new backend

In your React `.env.local` / `.env.production`:
```
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

---

## Directory structure

```
backend-php/
├── index.php               ← Main entry point / router (replaces Express app)
├── .htaccess               ← Apache mod_rewrite rules
├── .env.example            ← Copy to .env and fill in
├── config/
│   ├── config.php          ← Loads .env, defines constants
│   └── database.php        ← PDO singleton (db() helper)
├── includes/
│   ├── Auth.php            ← authenticate(), require_admin(), require_role()
│   ├── JWT.php             ← Pure-PHP HS256 JWT (no Composer)
│   ├── Helpers.php         ← gen_id(), request_body(), paginate(), etc.
│   ├── Response.php        ← sendSuccess(), sendError(), sendPaginated()
│   ├── ActivityLogger.php  ← log_activity()
│   ├── SimplePdf.php       ← PDF generation (replaces pdfkit)
│   ├── XlsxWriter.php      ← XLSX generation (replaces SheetJS)
│   └── XlsxReader.php      ← XLSX parsing for stock import
├── controllers/
│   ├── AuthController.php
│   ├── UserController.php
│   ├── CustomerController.php
│   ├── MeetingController.php
│   ├── ProductController.php
│   ├── StockController.php
│   ├── AttendanceController.php
│   ├── QuotationController.php      ← includes PDF letterhead generation
│   ├── DashboardAnalyticsController.php
│   ├── MiscControllers.php          ← Category, Leave, Activity
│   └── ExportController.php         ← CSV/XLSX/PDF exports for all entities
├── database/
│   └── schema.sql          ← Full MySQL DDL (converted from Prisma schema)
├── scripts/
│   └── seed.php            ← Demo data seeder
└── uploads/
    └── meetings/           ← Meeting attachment uploads (writable by web server)
```

---

## Migrating from the Node backend

1. **Same JWT secret** — set `JWT_SECRET` to the same value as the Node backend so existing logged-in users don't get logged out during the cutover.
2. **Data migration** — export from PostgreSQL and import to MySQL. The schema is a 1:1 translation; all column names, types, and constraints are preserved. The only structural difference: string IDs (cuid-style) are used throughout (no auto-increment integers).
3. **No Composer needed** — all dependencies are bundled as single PHP files in `includes/`. Just drop the folder on any PHP 8.1+ server and run.

---

## Quotation company / brand (APJ vs TMS)

Quotations now carry a `company` field (`"TMS"` or `"APJ"`) that picks which brand's
letterhead is used — matching the two themes in the standalone `quotation-creator-tms-apj-main`
tool (Tulips Machining Solutions vs. APJ Technologies Private Limited).

**For existing deployments**, run the migration once — it only adds a column and
backfills every existing row to `'TMS'` (the only brand that existed before this),
so nothing already stored is changed or renumbered:

```bash
mysql -u crmuser -p industrial_crm < database/migration_quotation_company.sql
```

**API contract** (this is what a frontend "APJ or TMS?" selector needs to talk to):

| Endpoint | Behaviour |
|---|---|
| `POST /api/quotations` | `company` is **required** in the body — `"APJ"` or `"TMS"` (case-insensitive). Missing/invalid → `400`. Drives the quotation number prefix, e.g. `APJ/2026/0001`. `quotationNumber` is **optional** — send a value to set it manually (trimmed, must not already exist → `400` if it does); omit it or send blank to keep the auto-numbering below. |
| `PUT /api/quotations/:id` | `company` is **optional** — omit it to leave the brand as-is; send it to correct a mis-picked brand. The quotation number itself is never rewritten by `PUT`, including the new manual-entry field — it's only settable at creation time. |
| `GET /api/quotations?company=APJ` | New optional filter, works alongside the existing `status`/`customerId`/`search` filters. |
| `GET /api/quotations`, `GET /api/quotations/:id` | Every quotation object now includes `"company"`. |
| `GET /api/quotations/:id/pdf` | Renders that quotation's own brand automatically — no extra parameter needed, it just reads the stored `company`. APJ gets its own pixel-faithful template (see below); TMS uses the generic layout. |

**Numbering**: each brand gets its own independent sequence that resets every year
(`TMS/2026/0001`, `TMS/2026/0002`, … alongside its own `APJ/2026/0001`, `APJ/2026/0002`, …),
based on the highest number actually issued for that brand+year rather than a raw row
count, so it stays collision-free even across deletes or a brand correction via `PUT`.
A manually-supplied `quotationNumber` on create() bypasses this scheme entirely (any string
is accepted, as long as it's not already taken) without disturbing the counter for future
auto-generated numbers.

**Changing the letterhead text/colours**: everything brand-specific (legal name, tagline,
accent colour used for the header/table/total-bar) lives in one place —
`QuotationController::BRANDS` near the top of `controllers/QuotationController.php`.
Edit the strings there; no other code needs to change. This only affects the generic (TMS)
layout — see the next section for APJ's own template.

---

## APJ PDF letterhead (`includes/ApjQuotationPdf.php`)

`GET /api/quotations/:id/pdf` for an `"APJ"` quotation is rendered by `ApjQuotationPdf`, a
line-for-line PHP port of `apj_downloadPDF()` from the standalone `quotation-creator-tms-apj-main`
tool — logo, rounded navy/teal cards, the "QUOTATION" badge, table styling, Grand Total +
Total MOQ bar, thank-you note, terms box, and signature block, plus the repeating page
header/footer with page numbers. TMS quotations still use the older generic layout above —
its own quotation-creator theme (blue, bordered-frame) is different enough to be its own
follow-up rather than folded into this port.

A few things worth knowing if you're touching either file:

- **Units**: the original tool works in millimetres (`new jsPDF('p','mm','a4')`); `SimplePdf`
  (our dependency-free PDF writer, no change to its own unit convention) works in PDF points.
  `ApjQuotationPdf` keeps every coordinate in the same millimetre numbers as the JS source and
  only converts via its `mm()` helper at the point each value is handed to `SimplePdf` — so the
  two files can still be diffed against each other line-for-line. Font sizes need no
  conversion (jsPDF's `setFontSize()`/`getTextWidth()` are already points-based regardless of
  document unit).
- **New `SimplePdf` capabilities added for this**: `addImage()` (GD-based PNG embedding with
  an alpha soft mask, used for the logo — falls back to a plain "APJ" text treatment if GD
  isn't available or the file can't be read, same as the original app's own fallback),
  `roundedRect()` (true Bézier-curved corners), dashed lines (`line()`'s new optional `$dash`
  param), anchor-based text centering/right-alignment without an explicit box width, a
  `middle` text baseline option, and a third standard font (`Helvetica-Oblique`, for the
  italic thank-you note). All of it is additive — `ExportController`'s existing PDF export
  is unaffected.
- **Money formatting** now matches the original tool's Indian (lakh/crore) digit grouping —
  `Rs. 12,34,567.50`, not the Western `Rs. 1,234,567.50` the old generic layout used.
- **Logo asset**: `assets/apj-logo.png`. Swap this file to change the logo; no code change
  needed as long as the replacement is also a (roughly square) PNG.

---

## API routes reference

All routes are identical to the original Express API. Below is the complete list
showing which PHP controller/method handles each one.

### Auth
| Method | Path | Handler |
|---|---|---|
| POST | /api/auth/login | AuthController::login |
| GET | /api/auth/me | AuthController::me |
| PUT | /api/auth/change-password | AuthController::changePassword |
| PUT | /api/auth/profile | AuthController::updateProfile |
| POST | /api/auth/logout | AuthController::logout |

### Users (admin+)
| Method | Path | Handler |
|---|---|---|
| GET | /api/users | UserController::index |
| GET | /api/users/export | UserController::export |
| POST | /api/users | UserController::create |
| GET | /api/users/:id | UserController::show |
| PUT | /api/users/:id | UserController::update |
| DELETE | /api/users/:id | UserController::delete |
| PATCH | /api/users/:id/reset-password | UserController::resetPassword |
| PATCH | /api/users/:id/toggle-lock | UserController::toggleLock |
| PATCH | /api/users/:id/reactivate | UserController::reactivate |

### Customers
| Method | Path | Handler |
|---|---|---|
| GET | /api/customers | CustomerController::index |
| GET | /api/customers/meta/filters | CustomerController::filterMeta |
| GET | /api/customers/with-location | CustomerController::withLocation |
| GET | /api/customers/export | ExportController::exportCustomers |
| POST | /api/customers | CustomerController::create |
| GET | /api/customers/:id | CustomerController::show |
| PUT | /api/customers/:id | CustomerController::update |
| DELETE | /api/customers/:id | CustomerController::delete |

### Meetings
| Method | Path | Handler |
|---|---|---|
| GET | /api/meetings | MeetingController::index |
| GET | /api/meetings/today-followups | MeetingController::todayFollowups |
| GET | /api/meetings/alerts | MeetingController::alerts |
| GET | /api/meetings/export | ExportController::exportMeetings |
| GET | /api/meetings/customer/:id/visits | MeetingController::customerVisits |
| POST | /api/meetings | MeetingController::create |
| GET | /api/meetings/:id | MeetingController::show |
| PUT | /api/meetings/:id | MeetingController::update |
| POST | /api/meetings/:id/checkin | MeetingController::checkIn |
| PATCH | /api/meetings/:id/timer | MeetingController::timer |
| POST | /api/meetings/:id/attachments | MeetingController::uploadAttachment |
| PATCH | /api/meetings/alerts/:id/read | MeetingController::markAlertRead |

### Products & Stock
| Method | Path | Handler |
|---|---|---|
| GET | /api/products | ProductController::index |
| GET | /api/products/search | ProductController::search |
| GET | /api/products/export | ExportController::exportProducts |
| GET | /api/products/code/:code | ProductController::byCode |
| POST | /api/products | ProductController::create |
| GET | /api/products/:id | ProductController::show |
| PUT | /api/products/:id | ProductController::update |
| GET | /api/products/stock | StockController::index |
| GET | /api/products/stock/alerts | StockController::alerts |
| GET | /api/products/stock/stats | StockController::stats |
| GET | /api/products/stock/template | StockController::template |
| POST | /api/products/stock/import | StockController::import |
| POST | /api/products/stock | StockController::create |
| PUT | /api/products/stock/:id | StockController::update |
| DELETE | /api/products/stock/:id | StockController::delete |

### Attendance
| Method | Path | Handler |
|---|---|---|
| GET | /api/attendance | AttendanceController::index |
| POST | /api/attendance/checkin | AttendanceController::checkIn |
| POST | /api/attendance/checkout | AttendanceController::checkOut |
| POST | /api/attendance/ping | AttendanceController::ping |
| GET | /api/attendance/today | AttendanceController::today |
| GET | /api/attendance/live | AttendanceController::live |
| GET | /api/attendance/export | ExportController::exportAttendance |
| GET | /api/attendance/:id/locations | AttendanceController::locations |
| PATCH | /api/attendance/:id/approve | AttendanceController::approve |

### Quotations
| Method | Path | Handler |
|---|---|---|
| GET | /api/quotations | QuotationController::index |
| GET | /api/quotations/stats | QuotationController::stats |
| GET | /api/quotations/export | ExportController::exportQuotations |
| POST | /api/quotations | QuotationController::create |
| GET | /api/quotations/:id | QuotationController::show |
| PUT | /api/quotations/:id | QuotationController::update |
| DELETE | /api/quotations/:id | QuotationController::delete |
| GET | /api/quotations/:id/pdf | QuotationController::generatePdf |
| PATCH | /api/quotations/:id/approve | QuotationController::approve |

> Every route above is now brand-aware (`company`: `APJ`/`TMS`) — see
> [Quotation company / brand (APJ vs TMS)](#quotation-company--brand-apj-vs-tms).

### Others
| Method | Path | Handler |
|---|---|---|
| GET | /api/leaves | LeaveController::index |
| POST | /api/leaves | LeaveController::create |
| PATCH | /api/leaves/:id/approve | LeaveController::approve |
| GET | /api/leaves/export | ExportController::exportLeaves |
| GET | /api/dashboard/admin | DashboardController::admin |
| GET | /api/dashboard/user | DashboardController::user |
| GET | /api/activity | ActivityController::index |
| GET | /api/activity/export | ExportController::exportActivity |
| GET | /api/categories | CategoryController::index |
| POST | /api/categories | CategoryController::create |
| PUT | /api/categories/:id | CategoryController::update |
| DELETE | /api/categories/:id | CategoryController::delete |
| GET | /api/analytics/overview | AnalyticsController::overview |
| GET | /api/analytics/monthly | AnalyticsController::monthly |
| GET | /api/analytics/employee | AnalyticsController::employee |
| GET | /api/analytics/segmentation | AnalyticsController::customerSegmentation |
| GET | /api/analytics/win-loss | AnalyticsController::winLoss |
| GET | /health | (inline) health check |
