/* ══════════════════════════════════════════════════════════════════════
   Reports & exports — a download for every page, plus full data backup.

   Every card downloads one report as CSV, Excel or PDF for the chosen date
   range (blank = all time). Original reports use the existing
   /api/<module>/export endpoints; the newer modules (Orders, Tasks, Price
   requests, Trials, Appointments, Breaks, Daily tracking) use
   /api/reports/<name> (ReportsController.php).

   Super Admin also gets "Full data backup": export the whole database as one
   JSON file, and import such a file back (merge — never deletes anything).
   See BackupController.php.

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var SECTIONS = [
    ['CRM & sales', [
      ['Customer report', 'All customers with contact details and category', '/customers/export', 'Building2', '#2563eb', 'customers'],
      ['Follow-up report', 'Meeting history and follow-up status pipeline', '/meetings/export', 'Handshake', '#4f46e5', 'follow-ups'],
      ['Quotation report', 'All quotations with items and approval status', '/quotations/export', 'FileText', '#d97706', 'quotations'],
      ['Product report', 'Product master list with prices and HSN codes', '/products/export', 'Package', '#0d9488', 'products'],
      ['Orders report', 'Orders with items supplied, proforma, procurement and delivery status', '/reports/orders', 'ClipboardList', '#0891b2', 'orders'],
      ['Trials report', 'Trial requests, recommendations, best tool and savings per year', '/reports/trials', 'FlaskConical', '#7c3aed', 'trials'],
      ['Price requests report', 'Price asked vs list vs approved, who decided and when', '/reports/price-requests', 'Wallet', '#b45309', 'price-requests']
    ]],
    ['Operations', [
      ['Attendance report', 'Employee attendance and working hours summary', '/attendance/export', 'Clock', '#16a34a', 'attendance'],
      ['Daily tracking report', 'Punch in/out, location points and distance travelled per person per day', '/reports/daily-movement', 'Route', '#0f766e', 'tracking'],
      ['Breaks report', 'Tea and lunch breaks with start, end and duration', '/reports/breaks', 'Coffee', '#a16207', 'breaks'],
      ['Fuel expense report', 'Meter readings, kilometres and fuel claims', '/fuel-expense/export', 'Fuel', '#ea580c', 'fuel'],
      ['Leave report', 'Leave requests history and approval status', '/leaves/export', 'CalendarOff', '#db2777', 'leave'],
      ['Appointments report', 'Scheduled customer visits by engineer and status', '/reports/appointments', 'CalendarCheck', '#4338ca', 'appointments'],
      ['Tasks report', 'Assigned tasks with time worked, due dates and completion notes', '/reports/tasks', 'ListChecks', '#1d4ed8', 'tasks']
    ]],
    ['Team & audit', [
      ['Team report', 'All team members with roles and status', '/users/export', 'Users', '#9333ea', 'team'],
      ['Activity log report', 'Full audit trail of all user actions', '/activity/export', 'Activity', '#475569', 'activity-log']
    ]]
  ];

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function role() { try { return (JSON.parse(localStorage.getItem('crm_user') || 'null') || {}).role || ''; } catch (e) { return ''; } }
  function el(tag, attrs, kids) { return window.AppShell.el(tag, attrs, kids); }
  function icon(name, cls) { return window.AppShell.icon(name, cls || 'w-5 h-5'); }

  /** Fetches a file with the auth header and saves it. Resolves the saved file name. */
  function download(path, fallbackName) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(r.status === 403 ? 'You don’t have permission for this report.' : ((j && j.message) || 'Download failed'));
        });
      }
      var cd = r.headers.get('Content-Disposition') || '';
      var m = /filename="?([^";]+)"?/.exec(cd);
      var name = m ? m[1] : fallbackName;
      return r.blob().then(function (b) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        return name;
      });
    });
  }

  function injectCss() {
    if (document.getElementById('reports-extra-css')) return;
    var st = document.createElement('style');
    st.id = 'reports-extra-css';
    st.textContent = [
      '.rp-grid{display:grid;grid-template-columns:1fr;gap:.9rem}',
      '@media(min-width:640px){.rp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media(min-width:1100px){.rp-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '.rp-card{display:flex;flex-direction:column;gap:.6rem;padding:1rem}',
      '.rp-ic{width:2.4rem;height:2.4rem;border-radius:.6rem;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--c) 12%,#fff);color:var(--c)}',
      '.dark .rp-ic{background:color-mix(in srgb,var(--c) 22%,#0f172a)}',
      '.rp-t{font-weight:600;font-size:.95rem;color:#0f172a}.dark .rp-t{color:#f1f5f9}',
      '.rp-d{font-size:.8rem;color:#64748b;flex:1}',
      '.rp-btn{display:flex;align-items:center;justify-content:center;gap:.4rem;width:100%;padding:.5rem;border-radius:.5rem;border:0;cursor:pointer;',
      '  background:#f1f5f9;color:#1e3a5f;font-size:.82rem;font-weight:600}.rp-btn:hover{background:#e2e8f0}',
      '.dark .rp-btn{background:#1e293b;color:#e2e8f0}',
      '.rp-btn[disabled]{opacity:.6;cursor:wait}',
      '.rp-msg{font-size:.75rem}.rp-ok{color:#15803d}.rp-err{color:#dc2626}',
      '.rp-sec{font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin:1.2rem 0 .6rem}',
      '.rp-filters{display:grid;gap:.75rem;grid-template-columns:repeat(2,minmax(0,1fr));align-items:end}',
      '@media(min-width:900px){.rp-filters{grid-template-columns:200px 200px 180px 1fr}}',
      '.rp-in{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.5rem .7rem;font-size:.875rem;background:#fff;color:#0f172a}',
      '.dark .rp-in{background:#0f172a;border-color:#334155;color:#f1f5f9}',
      '.rp-lab{display:block;font-size:.78rem;font-weight:500;color:#475569;margin-bottom:.3rem}',
      '.rp-chip{padding:.3rem .7rem;border-radius:9999px;border:1px solid #e2e8f0;background:#fff;font-size:.75rem;cursor:pointer;color:#475569}',
      '.rp-backup{border:1px solid #c7d2fe;background:linear-gradient(180deg,#eef2ff,#fff)}',
      '.dark .rp-backup{background:#0f172a;border-color:#3730a3}',
      '.rp-tbl{width:100%;font-size:.78rem}.rp-tbl td{padding:.25rem .5rem;border-top:1px solid #e2e8f0}',
      '.rp-warn{font-size:.78rem;background:#fffbeb;color:#92400e;border-radius:.5rem;padding:.55rem .7rem}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function mount(root) {
    injectCss();
    var from = el('input', { type: 'date', class: 'rp-in', 'aria-label': 'From date' });
    var to = el('input', { type: 'date', class: 'rp-in', 'aria-label': 'To date' });
    var fmt = el('select', { class: 'rp-in', 'aria-label': 'Format' }, [['csv', 'CSV'], ['excel', 'Excel (.xlsx)'], ['pdf', 'PDF']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    function preset(label, f) {
      return el('button', { class: 'rp-chip', type: 'button', text: label, onclick: function () { var r = f(new Date()); from.value = r[0]; to.value = r[1]; } });
    }

    root.appendChild(el('div', { class: 'space-y-4' }, [
      el('div', {}, [
        el('h1', { class: 'page-title', text: 'Reports & exports' }),
        el('p', { class: 'text-sm text-muted mt-1', text: 'Download any page’s data as CSV, Excel or PDF. Leave the dates blank for all-time data.' })
      ]),
      el('div', { class: 'card p-4 space-y-3' }, [
        el('div', { class: 'rp-filters' }, [
          el('label', {}, [el('span', { class: 'rp-lab', text: 'From date' }), from]),
          el('label', {}, [el('span', { class: 'rp-lab', text: 'To date' }), to]),
          el('label', {}, [el('span', { class: 'rp-lab', text: 'Format' }), fmt]),
          el('div', { class: 'flex gap-2 flex-wrap' }, [
            preset('Today', function (d) { return [iso(d), iso(d)]; }),
            preset('This month', function (d) { return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)]; }),
            preset('Last month', function (d) { return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; }),
            preset('This year', function (d) { return [iso(new Date(d.getFullYear(), 0, 1)), iso(d)]; }),
            el('button', { class: 'rp-chip', type: 'button', text: 'All time', onclick: function () { from.value = ''; to.value = ''; } })
          ])
        ])
      ])
    ]));

    SECTIONS.forEach(function (sec) {
      root.appendChild(el('p', { class: 'rp-sec', text: sec[0] }));
      var grid = el('div', { class: 'rp-grid' });
      sec[1].forEach(function (r) {
        var msg = el('p', { class: 'rp-msg' });
        var btn = el('button', { class: 'rp-btn', type: 'button' }, [icon('Download', 'w-4 h-4'), 'Download']);
        btn.addEventListener('click', function () {
          var q = ['format=' + fmt.value];
          if (from.value) q.push('from=' + from.value);
          if (to.value) q.push('to=' + to.value);
          btn.setAttribute('disabled', ''); msg.className = 'rp-msg'; msg.textContent = 'Preparing…';
          download(r[2] + '?' + q.join('&'), r[5] + '-' + iso(new Date()) + '.' + (fmt.value === 'excel' ? 'xlsx' : fmt.value)).then(function (name) {
            msg.className = 'rp-msg rp-ok'; msg.textContent = 'Downloaded ' + name;
          }).catch(function (e) {
            msg.className = 'rp-msg rp-err'; msg.textContent = e.message;
          }).then(function () { btn.removeAttribute('disabled'); });
        });
        grid.appendChild(el('div', { class: 'card rp-card', 'data-report': r[5] }, [
          el('div', { class: 'rp-ic', style: '--c:' + r[4] }, [icon(r[3])]),
          el('p', { class: 'rp-t', text: r[0] }),
          el('p', { class: 'rp-d', text: r[1] }),
          btn, msg
        ]));
      });
      root.appendChild(grid);
    });

    if (role() === 'SUPER_ADMIN') root.appendChild(backupSection());
  }

  // ── Full data backup (Super Admin) ───────────────────────────────────
  function backupSection() {
    var box = el('div', { class: 'card rp-backup p-5 space-y-3 mt-6' });
    var info = el('p', { class: 'text-sm text-muted', text: 'Loading database summary…' });
    var msg = el('div');
    var file = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });

    fetch(API + '/api/backup/summary', { headers: { Authorization: 'Bearer ' + (token() || '') } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.success) throw new Error(j.message);
        info.textContent = j.data.tables.length + ' tables · ' + j.data.totalRows.toLocaleString('en-IN') + ' records in the database';
      }).catch(function (e) { info.textContent = e.message; });

    var exp = el('button', { class: 'btn-primary', type: 'button' }, [icon('Download', 'w-4 h-4'), ' Export full backup']);
    exp.addEventListener('click', function () {
      exp.setAttribute('disabled', ''); msg.innerHTML = '';
      msg.appendChild(el('p', { class: 'rp-msg', text: 'Preparing backup… this can take a minute for a large database.' }));
      download('/backup/export', 'crm-backup-' + iso(new Date()) + '.json').then(function (name) {
        msg.innerHTML = ''; msg.appendChild(el('p', { class: 'rp-msg rp-ok', text: 'Backup saved as ' + name + '. Keep it somewhere safe — it contains all CRM data.' }));
      }).catch(function (e) { msg.innerHTML = ''; msg.appendChild(el('p', { class: 'rp-msg rp-err', text: e.message })); })
        .then(function () { exp.removeAttribute('disabled'); });
    });

    var imp = el('button', { class: 'btn-secondary', type: 'button', onclick: function () { file.click(); } }, [icon('Upload', 'w-4 h-4'), ' Import backup…']);
    file.addEventListener('change', function () {
      var f = file.files[0];
      file.value = '';
      if (!f) return;
      if (!confirm('Import "' + f.name + '"?\n\nRecords in the backup are added, and records with the same ID are updated to the backup’s values. Nothing that isn’t in the backup is deleted.\n\nTip: export a fresh backup first so you can go back.')) return;
      var fd = new FormData(); fd.append('file', f);
      imp.setAttribute('disabled', ''); msg.innerHTML = '';
      msg.appendChild(el('p', { class: 'rp-msg', text: 'Importing ' + f.name + '…' }));
      fetch(API + '/api/backup/import', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') }, body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          msg.innerHTML = '';
          if (!j.success) throw new Error(j.message);
          var d = j.data;
          msg.appendChild(el('p', { class: 'rp-msg rp-ok', text: 'Imported ' + d.totalRows.toLocaleString('en-IN') + ' records from the backup of ' + (d.backupDate ? new Date(d.backupDate).toLocaleString('en-IN') : 'unknown date') + '.' }));
          if (d.skippedTables && d.skippedTables.length) msg.appendChild(el('p', { class: 'rp-msg', text: 'Skipped (not in this database): ' + d.skippedTables.join(', ') }));
          msg.appendChild(el('table', { class: 'rp-tbl mt-2' }, [el('tbody', {}, d.tables.map(function (t) {
            return el('tr', {}, [el('td', { text: t.table }), el('td', { text: t.rows + ' records' })]);
          }))]));
        }).catch(function (e) { msg.innerHTML = ''; msg.appendChild(el('p', { class: 'rp-msg rp-err', text: e.message })); })
        .then(function () { imp.removeAttribute('disabled'); });
    });

    box.appendChild(el('div', { class: 'flex items-start gap-3' }, [
      el('div', { class: 'rp-ic', style: '--c:#4338ca' }, [icon('Database')]),
      el('div', { class: 'flex-1' }, [
        el('p', { class: 'rp-t', text: 'Full data backup' }),
        el('p', { class: 'rp-d', text: 'Every table — customers, meetings, quotations, orders, tasks, trials, attendance, payroll and the rest — in one file. Super Admin only.' }),
        info
      ])
    ]));
    box.appendChild(el('div', { class: 'flex gap-2 flex-wrap' }, [exp, imp, file]));
    box.appendChild(el('p', { class: 'rp-warn', text: 'The backup includes login data (password hashes). Uploaded files such as PO documents and photos are not inside the file — back up the api/uploads folder from your hosting file manager as well.' }));
    box.appendChild(msg);
    return box;
  }

  window.ReportsPage = { mountPage: mount };
})();
