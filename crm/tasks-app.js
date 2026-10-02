/* ══════════════════════════════════════════════════════════════════════
   Tasks — admin-assigned work queue with a timer, plus price requests.

   Tabs:
     My tasks        — the signed-in person's queue. The current task shows
                       a live timer (Start / Pause / Resume / Complete).
                       Tasks are worked in order: completing one unlocks
                       the next ("Complete & start next" does both).
     Team live       — admin-tier (incl. Manager): one card per person with
                       what they're working on right now and its live timer,
                       running / paused / waiting / idle, and today's totals.
                       Click a person for their task list with time per task.
     All tasks       — admin-tier (incl. Manager) sees everyone's queues.
                       Super Admin / Admin also assign, edit, reorder and
                       delete — matches TaskController.php.
     Price requests  — engineers raise a request for a price on a product;
                       Super Admin / Admin approve (with the price) or reject
                       (with a reason) — matches PriceRequestController.php.

   The timer is server-side (TaskController keeps workedSeconds and the
   start of the running segment); this page only ticks the display forward
   between fetches, so reloading or switching devices never loses time.

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var PRIORITIES = [['LOW', 'Low'], ['NORMAL', 'Normal'], ['HIGH', 'High'], ['URGENT', 'Urgent']];
  var PRIORITY_BADGE = { LOW: 'badge-gray', NORMAL: 'badge-blue', HIGH: 'badge-amber', URGENT: 'badge-red' };
  var STATUS_LABEL = { QUEUED: 'Queued', IN_PROGRESS: 'In progress', PAUSED: 'Paused', COMPLETED: 'Completed' };
  var STATUS_BADGE = { QUEUED: 'badge-gray', IN_PROGRESS: 'badge-green', PAUSED: 'badge-yellow', COMPLETED: 'badge-purple' };
  var PR_STATUS = [['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All']];
  var PR_BADGE = { PENDING: 'badge-yellow', APPROVED: 'badge-green', REJECTED: 'badge-red' };

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function currentUser() {
    try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch (e) { return null; }
  }
  function role() { var u = currentUser(); return (u && u.role) || ''; }
  /** Sees everyone's tasks / price requests — matches is_admin_tier(). */
  function isAdminTier() { return ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(role()) !== -1; }
  /** Assigns tasks and answers price requests — matches require_admin(). */
  function canManage() { return ['SUPER_ADMIN', 'ADMIN'].indexOf(role()) !== -1; }

  function api(method, path, body) {
    var opts = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + '/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { try { localStorage.removeItem('crm_token'); } catch (x) {} location.href = '/login/'; }
        if (!r.ok) throw new Error(((j && j.message) || 'Request failed') + (j && j.error ? ' — ' + j.error : '')); // .error only reaches admins
        return j;
      });
    });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function fmtDate(d) {
    if (!d) return '—';
    var s = String(d).replace(' ', 'T');
    var dt = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(d) {
    if (!d) return '—';
    var dt = new Date(String(d).replace(' ', 'T'));
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtDurationShort(sec) {
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (h) return h + 'h ' + m + 'm';
    return m ? m + 'm' : Math.floor(sec) + 's';
  }
  function money(v) {
    if (v === null || v === undefined || v === '') return '—';
    return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function labelOf(pairs, v) { var m = pairs.filter(function (p) { return p[0] === v; })[0]; return m ? m[1] : v; }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  var INPUT = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
              'px-3 py-2 text-sm text-slate-900 dark:text-slate-100';

  // Styles the compiled Tailwind CSS doesn't include, scoped under tx-.
  function injectCss() {
    if (document.getElementById('tasks-extra-css')) return;
    var st = document.createElement('style');
    st.id = 'tasks-extra-css';
    st.textContent = [
      '.tx-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;overflow-x:auto}',
      '.dark .tx-tabs{border-color:#334155}',
      '.tx-tab{padding:.6rem .9rem;font-size:.875rem;font-weight:500;color:#64748b;border:0;background:none;',
      '  border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;cursor:pointer;display:inline-flex;gap:.4rem;align-items:center}',
      '.tx-tab:hover{color:#1e3a5f}',
      '.tx-tab-on{color:#1e3a5f;border-bottom-color:#1e3a5f}',
      '.dark .tx-tab-on,.dark .tx-tab:hover{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.tx-count{min-width:1.25rem;height:1.25rem;padding:0 .35rem;border-radius:9999px;background:#ef4444;color:#fff;',
      '  font-size:.7rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center}',
      '.tx-timer{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;letter-spacing:.02em}',
      '.tx-timer-big{font-size:2.6rem;line-height:1.1;font-weight:700;color:#0f172a}',
      '.dark .tx-timer-big{color:#f1f5f9}',
      '.tx-dot{width:.6rem;height:.6rem;border-radius:9999px;display:inline-block;background:#94a3b8}',
      '.tx-dot-run{background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:txPulse 1.6s infinite}',
      '.tx-dot-pause{background:#f59e0b}',
      '@keyframes txPulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}',
      '.tx-current{border:2px solid #1e3a5f}',
      '.dark .tx-current{border-color:#60a5fa}',
      '.tx-grid{display:grid;gap:1rem}',
      '@media(min-width:1024px){.tx-grid{grid-template-columns:3fr 2fr}}',
      '.tx-form{display:grid;gap:.75rem;grid-template-columns:1fr}',
      '@media(min-width:768px){.tx-form{grid-template-columns:repeat(2,minmax(0,1fr))}.tx-span2{grid-column:span 2/span 2}}',
      '.tx-row{display:flex;align-items:center;gap:.75rem;padding:.65rem 1rem;border-top:1px solid #f1f5f9}',
      '.dark .tx-row{border-color:#1e293b}',
      '.tx-row:first-child{border-top:0}',
      '.tx-pos{width:1.6rem;height:1.6rem;border-radius:9999px;background:#f1f5f9;color:#475569;font-size:.75rem;font-weight:600;',
      '  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.dark .tx-pos{background:#1e293b;color:#cbd5e1}',
      '.tx-icon-btn{border:1px solid #e2e8f0;background:#fff;border-radius:.4rem;width:1.8rem;height:1.8rem;font-size:.8rem;color:#475569;cursor:pointer}',
      '.dark .tx-icon-btn{background:#0f172a;border-color:#334155;color:#cbd5e1}',
      '.tx-icon-btn:disabled{opacity:.35;cursor:default}',
      '.tx-link{font-size:.75rem;font-weight:500;color:#1e3a5f;background:none;border:0;padding:0;cursor:pointer}',
      '.dark .tx-link{color:#93c5fd}',
      '.tx-danger{color:#dc2626}',
      '.tx-nowrap{white-space:nowrap}',
      '.tx-pill{padding:.3rem .75rem;border-radius:9999px;font-size:.78rem;font-weight:500;border:1px solid #e2e8f0;background:#fff;color:#475569;cursor:pointer}',
      '.dark .tx-pill{background:#0f172a;border-color:#334155;color:#cbd5e1}',
      '.tx-pill-on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}',
      '.dark .tx-pill-on{background:#1e3a5f;color:#fff}',
      '.tx-dialog{max-width:36rem}',
      '.tx-disabled{opacity:.5;cursor:not-allowed}',
      '.tx-overdue{color:#dc2626;font-weight:600}',
      '.mt-5{margin-top:1.25rem}',
      // Team live
      '.tx-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}',
      '@media(min-width:768px){.tx-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '.tx-tile{text-align:left;cursor:pointer;border:1px solid #e2e8f0;background:#fff;border-radius:.75rem;padding:.75rem 1rem}',
      '.dark .tx-tile{background:#0f172a;border-color:#334155}',
      '.tx-tile-on{border-color:#1e3a5f;box-shadow:0 0 0 1px #1e3a5f}',
      '.dark .tx-tile-on{border-color:#60a5fa;box-shadow:0 0 0 1px #60a5fa}',
      '.tx-tile-n{font-size:1.5rem;font-weight:700;line-height:1.2;color:#0f172a}',
      '.dark .tx-tile-n{color:#f1f5f9}',
      '.tx-people{display:grid;grid-template-columns:1fr;gap:.75rem}',
      '@media(min-width:768px){.tx-people{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media(min-width:1280px){.tx-people{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '.tx-person{cursor:pointer;border-left:4px solid #cbd5e1;padding:1rem;display:flex;flex-direction:column;gap:.6rem}',
      '.tx-person-RUNNING{border-left-color:#22c55e}.tx-person-PAUSED{border-left-color:#f59e0b}',
      '.tx-person-WAITING{border-left-color:#3b82f6}.tx-person-IDLE{border-left-color:#cbd5e1}',
      '.tx-person-open{box-shadow:0 0 0 2px #1e3a5f}',
      '.dark .tx-person-open{box-shadow:0 0 0 2px #60a5fa}',
      '.tx-avatar{width:2.25rem;height:2.25rem;border-radius:9999px;background:#e0e7ff;color:#1e3a5f;font-weight:700;',
      '  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.dark .tx-avatar{background:#1e3a5f;color:#dbeafe}',
      '.tx-state{display:inline-flex;align-items:center;gap:.35rem;font-size:.72rem;font-weight:600;padding:.15rem .55rem;border-radius:9999px}',
      '.tx-state-RUNNING{background:#dcfce7;color:#166534}.tx-state-PAUSED{background:#fef3c7;color:#92400e}',
      '.tx-state-WAITING{background:#dbeafe;color:#1e40af}.tx-state-IDLE{background:#f1f5f9;color:#475569}',
      '.tx-timer-mid{font-size:1.6rem;font-weight:700;line-height:1.1;color:#0f172a}',
      '.dark .tx-timer-mid{color:#f1f5f9}',
      '.tx-muted-box{background:#f8fafc;border-radius:.5rem;padding:.6rem .75rem}',
      '.dark .tx-muted-box{background:rgba(30,41,59,.6)}',
      // Price requests
      '.tx-pr{border-left:4px solid #cbd5e1}',
      '.tx-pr-PENDING{border-left-color:#f59e0b}.tx-pr-APPROVED{border-left-color:#22c55e}.tx-pr-REJECTED{border-left-color:#ef4444}',
      '.tx-cmp{display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:.5rem}',
      '@media(min-width:640px){.tx-cmp{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '.tx-cmp-cell{border:1px solid #e2e8f0;border-radius:.5rem;padding:.55rem .75rem}',
      '.dark .tx-cmp-cell{border-color:#334155}',
      '.tx-cmp-final{border-color:#86efac;background:#f0fdf4}',
      '.dark .tx-cmp-final{border-color:#166534;background:rgba(22,101,52,.2)}',
      '.tx-big{font-size:1.15rem;font-weight:700;color:#0f172a}',
      '.dark .tx-big{color:#f1f5f9}',
      '.tx-down{color:#b45309;font-size:.72rem;font-weight:600}.tx-up{color:#15803d;font-size:.72rem;font-weight:600}',
      '.tx-banner{border-radius:.5rem;padding:.6rem .75rem;font-size:.875rem}',
      '.tx-banner-PENDING{background:#fffbeb;color:#92400e}.tx-banner-APPROVED{background:#f0fdf4;color:#166534}.tx-banner-REJECTED{background:#fef2f2;color:#991b1b}',
      '.dark .tx-banner-PENDING{background:rgba(146,64,14,.2);color:#fde68a}.dark .tx-banner-APPROVED{background:rgba(22,101,52,.25);color:#bbf7d0}',
      '.dark .tx-banner-REJECTED{background:rgba(153,27,27,.25);color:#fecaca}',
      '.tx-decide{border:1px dashed #1e3a5f;border-radius:.5rem;padding:.75rem}',
      '.dark .tx-decide{border-color:#60a5fa}',
      '.tx-help{font-size:.75rem;color:#64748b}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── live timers ──────────────────────────────────────────────────────
  // Any element made by timerEl() re-renders itself every second from
  // (elapsed at fetch time) + (time since fetch) while its task is running.
  function timerEl(task, cls) {
    var n = el('span', { class: 'tx-timer ' + (cls || ''), text: fmtDuration(task.elapsedSeconds) });
    n.setAttribute('data-tx-base', String(task.elapsedSeconds));
    n.setAttribute('data-tx-t0', String(Date.now()));
    n.setAttribute('data-tx-run', task.running ? '1' : '0');
    return n;
  }
  function tickTimers() {
    var nodes = document.querySelectorAll('[data-tx-run="1"]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var sec = Number(n.getAttribute('data-tx-base')) + (Date.now() - Number(n.getAttribute('data-tx-t0'))) / 1000;
      n.textContent = fmtDuration(sec);
    }
  }

  // ── page ─────────────────────────────────────────────────────────────
  function mount(root) {
    injectCss();
    var tabs = [['mine', 'My tasks']];
    if (isAdminTier()) { tabs.push(['team', 'Team live']); tabs.push(['all', 'All tasks']); }
    tabs.push(['prices', 'Price requests']);

    var tab = null;
    try { tab = localStorage.getItem('crm_tasks_tab'); } catch (e) {}
    if (!tabs.some(function (t) { return t[0] === tab; })) tab = isAdminTier() ? 'team' : 'mine';

    var pendingPrices = 0;
    var tabBar = el('div', { class: 'tx-tabs', role: 'tablist' });
    var panel = el('div', { class: 'mt-5' });
    var reload = function () {};

    root.appendChild(el('div', { class: 'space-y-4' }, [
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('h1', { class: 'page-title', text: 'Tasks' }),
        canManage() ? el('button', { class: 'btn-primary', text: '+ Assign task', onclick: function () { openTaskDialog(null, function () { reload(); }); } })
                    : el('button', { class: 'btn-primary', text: '+ Price request', onclick: function () { switchTab('prices'); } })
      ]),
      tabBar,
      panel
    ]));

    function renderTabs() {
      tabBar.innerHTML = '';
      tabs.forEach(function (t) {
        tabBar.appendChild(el('button', {
          class: 'tx-tab' + (t[0] === tab ? ' tx-tab-on' : ''), role: 'tab', 'aria-selected': t[0] === tab ? 'true' : 'false',
          onclick: function () { switchTab(t[0]); }
        }, [t[1], t[0] === 'prices' && pendingPrices ? el('span', { class: 'tx-count', text: String(pendingPrices) }) : null]));
      });
    }
    function switchTab(t) {
      tab = t;
      try { localStorage.setItem('crm_tasks_tab', t); } catch (e) {}
      renderTabs();
      panel.innerHTML = '';
      reload = t === 'mine' ? myTasksTab(panel)
             : t === 'team' ? teamTab(panel)
             : t === 'all' ? allTasksTab(panel)
             : priceRequestsTab(panel, function (n) { pendingPrices = n; renderTabs(); });
    }

    // Pending price-request count for the tab badge.
    api('GET', '/price-requests?status=PENDING').then(function (res) {
      pendingPrices = (res.data && res.data.pendingCount) || 0;
      renderTabs();
    }).catch(function () {});

    setInterval(tickTimers, 1000);
    // Pick up newly assigned tasks without a manual refresh — but never
    // while someone is typing into a form on the page.
    // Team live refreshes every 20s (it's a monitoring view); the others every 60s.
    var ticks = 0;
    setInterval(function () {
      ticks++;
      if (document.visibilityState !== 'visible') return;
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (document.querySelector('[data-tx-dialog]')) return;
      if (tab === 'team' || (tab !== 'prices' && ticks % 3 === 0)) reload();
    }, 20000);

    switchTab(tab);
  }

  function loading(p) { p.innerHTML = ''; p.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' })); }
  function errorBox(p, msg, retry) {
    p.innerHTML = '';
    p.appendChild(el('div', { class: 'card p-10 text-center text-muted' }, [
      el('p', { class: 'font-medium text-red-600', text: 'Something went wrong' }),
      el('p', { class: 'text-sm mt-1', text: msg }),
      el('button', { class: 'btn-secondary btn-sm mt-4', text: 'Try again', onclick: retry })
    ]));
  }
  function taskMeta(t, withAssignee) {
    var bits = [];
    if (withAssignee) bits.push('For ' + (t.assignedTo.name || '—'));
    bits.push('by ' + (t.assignedBy.name || '—'));
    if (t.customer) bits.push(t.customer.companyName);
    return bits.join(' · ');
  }
  function dueEl(t) {
    if (!t.dueDate) return null;
    var overdue = t.status !== 'COMPLETED' && String(t.dueDate).slice(0, 10) < todayIso();
    return el('span', { class: 'text-xs ' + (overdue ? 'tx-overdue' : 'text-muted'), text: 'Due ' + fmtDate(t.dueDate) + (overdue ? ' · overdue' : '') });
  }

  // ── My tasks ─────────────────────────────────────────────────────────
  function myTasksTab(p) {
    var open = [], done = [], err = '', busy = false, completing = false, note = '';

    function load() {
      if (!open.length && !done.length) loading(p);
      Promise.all([api('GET', '/tasks?mine=1'), api('GET', '/tasks?mine=1&status=COMPLETED&limit=10')]).then(function (r) {
        open = r[0].data.tasks || [];
        done = r[1].data.tasks || [];
        render();
      }).catch(function (e) { errorBox(p, e.message, load); });
    }

    function act(task, action, body) {
      if (busy) return;
      busy = true; err = ''; render();
      api('PATCH', '/tasks/' + task.id + '/' + action, body || {}).then(function () {
        busy = false; completing = false; note = '';
        load();
      }).catch(function (e) { busy = false; err = e.message; render(); });
    }

    function render() {
      p.innerHTML = '';
      var current = open.filter(function (t) { return t.status === 'IN_PROGRESS' || t.status === 'PAUSED'; })[0] || null;
      var queue = open.filter(function (t) { return t.status === 'QUEUED'; });
      var left = el('div', { class: 'space-y-4' });
      var right = el('div', { class: 'space-y-4' });

      // Current task / next up
      if (current) {
        left.appendChild(currentCard(current, queue.length));
      } else if (queue.length) {
        var head = queue[0];
        left.appendChild(el('div', { class: 'card p-5 space-y-3 tx-current' }, [
          el('p', { class: 'text-xs font-semibold uppercase text-muted', text: 'Up next' }),
          el('div', { class: 'flex items-center gap-2 flex-wrap' }, [
            el('h2', { class: 'text-lg font-semibold text-slate-900 dark:text-slate-100', text: head.title }),
            el('span', { class: 'badge ' + PRIORITY_BADGE[head.priority], text: labelOf(PRIORITIES, head.priority) })
          ]),
          el('p', { class: 'text-xs text-muted', text: taskMeta(head, false) }),
          dueEl(head),
          head.description ? el('p', { class: 'text-sm whitespace-pre-wrap', text: head.description }) : null,
          err ? el('p', { class: 'text-xs text-red-600', text: err }) : null,
          el('button', { class: 'btn-primary' + (busy ? ' tx-disabled' : ''), text: '▶ Start task & timer', onclick: function () { act(head, 'start'); } })
        ]));
      } else {
        left.appendChild(el('div', { class: 'card p-10 text-center' }, [
          el('p', { class: 'text-lg font-semibold text-slate-900 dark:text-slate-100', text: 'You’re all caught up' }),
          el('p', { class: 'text-sm text-muted mt-1', text: 'New tasks assigned to you will appear here.' })
        ]));
      }

      // Queue
      var rest = current ? queue : queue.slice(1);
      var qCard = el('div', { class: 'card overflow-hidden' }, [
        el('div', { class: 'px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between' }, [
          el('span', { class: 'text-sm font-semibold', text: 'Queue' }),
          el('span', { class: 'text-xs text-muted', text: rest.length + ' waiting' })
        ])
      ]);
      if (!rest.length) qCard.appendChild(el('p', { class: 'px-4 py-6 text-sm text-muted text-center', text: 'Nothing else in your queue.' }));
      rest.forEach(function (t, i) {
        qCard.appendChild(el('div', { class: 'tx-row' }, [
          el('span', { class: 'tx-pos', text: String(i + (current ? 1 : 2)) }),
          el('div', { class: 'flex-1 min-w-0' }, [
            el('p', { class: 'text-sm font-medium truncate', text: t.title }),
            el('p', { class: 'text-xs text-muted truncate', text: taskMeta(t, false) })
          ]),
          dueEl(t),
          el('span', { class: 'badge ' + PRIORITY_BADGE[t.priority], text: labelOf(PRIORITIES, t.priority) })
        ]));
      });
      left.appendChild(qCard);

      // Recently completed
      var dCard = el('div', { class: 'card overflow-hidden' }, [
        el('div', { class: 'px-4 py-3 border-b border-slate-200 dark:border-slate-700' }, [el('span', { class: 'text-sm font-semibold', text: 'Recently completed' })])
      ]);
      if (!done.length) dCard.appendChild(el('p', { class: 'px-4 py-6 text-sm text-muted text-center', text: 'No completed tasks yet.' }));
      done.forEach(function (t) {
        dCard.appendChild(el('div', { class: 'tx-row' }, [
          el('span', { text: '✓', class: 'text-green-700' }),
          el('div', { class: 'flex-1 min-w-0' }, [
            el('p', { class: 'text-sm font-medium truncate', text: t.title }),
            el('p', { class: 'text-xs text-muted', text: fmtDateTime(t.completedAt) + (t.completionNote ? ' · ' + t.completionNote : '') })
          ]),
          el('span', { class: 'tx-timer text-xs text-muted tx-nowrap', text: fmtDurationShort(t.elapsedSeconds) })
        ]));
      });
      right.appendChild(dCard);

      p.appendChild(el('div', { class: 'tx-grid' }, [left, right]));
    }

    function currentCard(t, queued) {
      var running = t.status === 'IN_PROGRESS';
      var card = el('div', { class: 'card p-5 space-y-4 tx-current' }, [
        el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
          el('span', { class: 'flex items-center gap-2 text-xs font-semibold uppercase text-muted' }, [
            el('span', { class: 'tx-dot ' + (running ? 'tx-dot-run' : 'tx-dot-pause') }),
            running ? 'Working on now' : 'Paused'
          ]),
          el('span', { class: 'badge ' + PRIORITY_BADGE[t.priority], text: labelOf(PRIORITIES, t.priority) })
        ]),
        el('div', {}, [
          el('h2', { class: 'text-lg font-semibold text-slate-900 dark:text-slate-100', text: t.title }),
          el('p', { class: 'text-xs text-muted mt-0.5', text: taskMeta(t, false) + ' · started ' + fmtDateTime(t.startedAt) }),
          dueEl(t)
        ]),
        t.description ? el('p', { class: 'text-sm whitespace-pre-wrap', text: t.description }) : null,
        el('div', {}, [timerEl(t, 'tx-timer-big'), el('p', { class: 'text-xs text-muted mt-1', text: 'Time spent (hh:mm:ss)' })])
      ]);

      if (err) card.appendChild(el('p', { class: 'text-xs text-red-600', text: err }));
      var dis = busy ? ' tx-disabled' : '';

      if (completing) {
        var ta = el('textarea', { class: INPUT, rows: '2', placeholder: 'Completion note (optional)' });
        ta.value = note;
        ta.addEventListener('input', function () { note = ta.value; });
        card.appendChild(el('div', { class: 'space-y-2' }, [
          ta,
          el('div', { class: 'flex gap-2 flex-wrap justify-end' }, [
            el('button', { class: 'btn-secondary', text: 'Cancel', onclick: function () { completing = false; render(); } }),
            el('button', { class: 'btn-primary' + dis, text: '✓ Complete', onclick: function () { act(t, 'complete', { note: note }); } }),
            queued ? el('button', { class: 'btn-primary' + dis, text: '✓ Complete & start next', onclick: function () { act(t, 'complete', { note: note, startNext: true }); } }) : null
          ])
        ]));
      } else {
        card.appendChild(el('div', { class: 'flex gap-2 flex-wrap' }, [
          running
            ? el('button', { class: 'btn-secondary' + dis, text: '❚❚ Pause', onclick: function () { act(t, 'pause'); } })
            : el('button', { class: 'btn-secondary' + dis, text: '▶ Resume', onclick: function () { act(t, 'resume'); } }),
          el('button', { class: 'btn-primary' + dis, text: '✓ Complete…', onclick: function () { completing = true; render(); } })
        ]));
      }
      return card;
    }

    load();
    return load;
  }

  // ── Team live (admin-tier) ───────────────────────────────────────────
  var STATE_LABEL = { RUNNING: 'Working now', PAUSED: 'Paused', WAITING: 'Not started', IDLE: 'No tasks' };
  function teamTab(p) {
    var people = [], filter = 'ALL', openId = null, detail = {}, loaded = false;

    function load() {
      if (!loaded) loading(p);
      api('GET', '/tasks/overview').then(function (r) {
        people = r.data.people || [];
        loaded = true;
        if (openId) loadDetail(openId, true); else render();
      }).catch(function (e) { errorBox(p, e.message, load); });
    }
    function loadDetail(id, thenRender) {
      api('GET', '/tasks?assignedToId=' + encodeURIComponent(id) + '&status=ALL&limit=40').then(function (r) {
        detail[id] = r.data.tasks || [];
        render();
      }).catch(function () { detail[id] = []; render(); });
      if (!thenRender) render();
    }

    function count(state) { return people.filter(function (x) { return x.state === state; }).length; }

    function render() {
      p.innerHTML = '';
      var tiles = el('div', { class: 'tx-tiles mb-4' });
      [['ALL', 'Everyone', people.length], ['RUNNING', 'Working now', count('RUNNING')], ['PAUSED', 'Paused', count('PAUSED')],
       ['WAITING', 'Have tasks, not started', count('WAITING')]].forEach(function (t) {
        tiles.appendChild(el('button', {
          class: 'tx-tile' + (filter === t[0] ? ' tx-tile-on' : ''),
          onclick: function () { filter = t[0]; render(); }
        }, [el('p', { class: 'text-xs text-muted', text: t[1] }), el('p', { class: 'tx-tile-n', text: String(t[2]) })]));
      });
      p.appendChild(tiles);
      p.appendChild(el('p', { class: 'tx-help mb-3', text: 'Live view — timers tick every second and the board refreshes every 20 seconds. Click a person to see their tasks and the time spent on each.' }));

      var shown = people.filter(function (x) { return filter === 'ALL' || x.state === filter; });
      if (!shown.length) {
        p.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: 'Nobody in this group right now.' }));
        return;
      }
      var grid = el('div', { class: 'tx-people' });
      shown.forEach(function (x) { grid.appendChild(personCard(x)); });
      p.appendChild(grid);

      if (openId) {
        var who = people.filter(function (x) { return x.user.id === openId; })[0];
        if (who) p.appendChild(personDetail(who));
      }
    }

    function personCard(x) {
      var u = x.user, c = x.current;
      var card = el('div', {
        class: 'card tx-person tx-person-' + x.state + (openId === u.id ? ' tx-person-open' : ''), role: 'button', tabindex: '0',
        'aria-label': u.name + ': ' + STATE_LABEL[x.state]
      });
      function toggle() {
        openId = openId === u.id ? null : u.id;
        if (openId) loadDetail(openId); else render();
        if (openId) setTimeout(function () { var d = document.getElementById('tx-person-detail'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 300);
      }
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

      card.appendChild(el('div', { class: 'flex items-center gap-3' }, [
        el('span', { class: 'tx-avatar', text: (u.name || '?').charAt(0).toUpperCase() }),
        el('div', { class: 'flex-1 min-w-0' }, [
          el('p', { class: 'text-sm font-semibold truncate text-slate-900 dark:text-slate-100', text: u.name }),
          el('p', { class: 'text-xs text-muted truncate', text: (u.role || '').replace('_', ' ').toLowerCase() + (u.department ? ' · ' + u.department : '') })
        ]),
        el('span', { class: 'tx-state tx-state-' + x.state }, [
          x.state === 'RUNNING' ? el('span', { class: 'tx-dot tx-dot-run' }) : x.state === 'PAUSED' ? el('span', { class: 'tx-dot tx-dot-pause' }) : null,
          STATE_LABEL[x.state]
        ])
      ]));

      if (c) {
        card.appendChild(el('div', { class: 'tx-muted-box' }, [
          el('p', { class: 'text-xs text-muted', text: x.state === 'RUNNING' ? 'Current task' : 'Paused task' }),
          el('p', { class: 'text-sm font-medium truncate', text: c.title }),
          el('div', { class: 'flex items-end justify-between gap-2 mt-1' }, [
            timerEl(c, 'tx-timer-mid'),
            el('span', { class: 'text-xs text-muted', text: 'since ' + fmtDateTime(c.startedAt) })
          ])
        ]));
      } else {
        card.appendChild(el('div', { class: 'tx-muted-box text-sm text-muted', text: x.queuedCount ? 'Has tasks waiting but hasn’t started one.' : 'Nothing assigned right now.' }));
      }

      var todayTimer = timerEl({ elapsedSeconds: x.secondsToday, running: x.state === 'RUNNING' }, 'text-sm font-semibold');
      card.appendChild(el('div', { class: 'grid grid-cols-3 gap-2 text-center' }, [
        miniStat('Time today', todayTimer),
        miniStat('Done today', el('span', { class: 'text-sm font-semibold', text: String(x.completedToday) })),
        miniStat('In queue', el('span', { class: 'text-sm font-semibold', text: String(x.queuedCount) }))
      ]));
      return card;
    }
    function miniStat(label, valueEl) {
      return el('div', {}, [el('p', { class: 'text-xs text-muted', text: label }), valueEl]);
    }

    function personDetail(x) {
      var list = detail[x.user.id];
      var box = el('div', { class: 'card mt-4 overflow-hidden', id: 'tx-person-detail' }, [
        el('div', { class: 'px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3' }, [
          el('span', { class: 'text-sm font-semibold', text: x.user.name + ' — tasks & time' }),
          el('button', { class: 'tx-link', text: 'Close', onclick: function () { openId = null; render(); } })
        ])
      ]);
      if (!list) { box.appendChild(el('p', { class: 'px-4 py-6 text-sm text-muted text-center', text: 'Loading…' })); return box; }
      if (!list.length) { box.appendChild(el('p', { class: 'px-4 py-6 text-sm text-muted text-center', text: 'No tasks assigned to ' + x.user.name + ' yet.' })); return box; }
      var total = 0;
      list.forEach(function (t) {
        if (t.status === 'COMPLETED') total += t.elapsedSeconds;
        box.appendChild(el('div', { class: 'tx-row flex-wrap' }, [
          el('span', { class: 'badge ' + STATUS_BADGE[t.status], text: STATUS_LABEL[t.status] || t.status }),
          el('div', { class: 'flex-1 min-w-0' }, [
            el('p', { class: 'text-sm font-medium truncate', text: t.title }),
            el('p', { class: 'text-xs text-muted truncate', text:
              (t.startedAt ? 'Started ' + fmtDateTime(t.startedAt) : 'Not started') + (t.completedAt ? ' · finished ' + fmtDateTime(t.completedAt) : '') +
              (t.completionNote ? ' · “' + t.completionNote + '”' : '') })
          ]),
          el('span', { class: 'badge ' + PRIORITY_BADGE[t.priority], text: labelOf(PRIORITIES, t.priority) }),
          t.status === 'QUEUED' ? el('span', { class: 'text-xs text-muted tx-nowrap', text: '—' }) : timerEl(t, 'text-sm font-semibold tx-nowrap')
        ]));
      });
      box.appendChild(el('div', { class: 'px-4 py-3 border-t border-slate-200 dark:border-slate-700 text-sm flex justify-between' }, [
        el('span', { class: 'text-muted', text: 'Total time on completed tasks shown' }),
        el('span', { class: 'font-semibold tx-timer', text: fmtDuration(total) })
      ]));
      return box;
    }

    load();
    return load;
  }

  // ── All tasks (admin-tier) ───────────────────────────────────────────
  function allTasksTab(p) {
    var tasks = [], users = [], who = '', showDone = false, err = '';

    if (canManage()) {
      api('GET', '/tasks/assignees').then(function (r) { users = r.data.users || []; render(); }).catch(function () {});
    }

    function load() {
      if (!tasks.length) loading(p);
      var q = '/tasks?status=' + (showDone ? 'ALL' : 'OPEN') + (who ? '&assignedToId=' + encodeURIComponent(who) : '');
      api('GET', q).then(function (r) { tasks = r.data.tasks || []; err = ''; render(); })
        .catch(function (e) { errorBox(p, e.message, load); });
    }

    function run(method, path, body) {
      err = '';
      api(method, path, body).then(load).catch(function (e) { err = e.message; render(); });
    }

    function render() {
      p.innerHTML = '';
      // Filter bar — person list comes from the tasks themselves for managers (who can't list assignees).
      var people = users.length ? users : tasks.reduce(function (acc, t) {
        if (!acc.some(function (u) { return u.id === t.assignedTo.id; })) acc.push({ id: t.assignedTo.id, name: t.assignedTo.name });
        return acc;
      }, []);
      var sel = el('select', { class: INPUT, style: 'max-width:240px' }, [el('option', { value: '', text: 'Everyone' })]
        .concat(people.map(function (u) { return el('option', { value: u.id, text: u.name }); })));
      sel.value = who;
      sel.addEventListener('change', function () { who = sel.value; load(); });
      var cb = el('input', { type: 'checkbox' });
      cb.checked = showDone;
      cb.addEventListener('change', function () { showDone = cb.checked; load(); });

      var running = tasks.filter(function (t) { return t.status === 'IN_PROGRESS'; }).length;
      var queued = tasks.filter(function (t) { return t.status === 'QUEUED'; }).length;
      p.appendChild(el('div', { class: 'flex items-center gap-3 flex-wrap mb-4' }, [
        sel,
        el('label', { class: 'flex items-center gap-2 text-sm text-muted' }, [cb, 'Show completed']),
        el('span', { class: 'text-xs text-muted', text: running + ' in progress · ' + queued + ' queued' })
      ]));
      if (err) p.appendChild(el('p', { class: 'text-sm text-red-600 mb-3', text: err }));

      if (!tasks.length) {
        p.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: canManage() ? 'No tasks yet — use “+ Assign task” to add one.' : 'No tasks.' }));
        return;
      }

      // Group by assignee, keeping the server's queue ordering inside each group.
      var groups = [];
      tasks.forEach(function (t) {
        var g = groups.filter(function (x) { return x.id === t.assignedTo.id; })[0];
        if (!g) { g = { id: t.assignedTo.id, name: t.assignedTo.name, items: [] }; groups.push(g); }
        g.items.push(t);
      });

      var wrap = el('div', { class: 'space-y-4' });
      groups.forEach(function (g) {
        var q = g.items.filter(function (t) { return t.status === 'QUEUED'; });
        var card = el('div', { class: 'card overflow-hidden' }, [
          el('div', { class: 'px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3' }, [
            el('span', { class: 'text-sm font-semibold', text: g.name || '—' }),
            el('span', { class: 'text-xs text-muted', text: q.length + ' in queue' })
          ])
        ]);
        g.items.forEach(function (t) {
          var qi = q.indexOf(t);
          var actions = el('div', { class: 'flex items-center gap-1' });
          if (canManage()) {
            if (t.status === 'QUEUED') {
              var up = el('button', { class: 'tx-icon-btn', title: 'Move up', 'aria-label': 'Move up', text: '↑', onclick: function () { run('PATCH', '/tasks/' + t.id + '/move', { direction: 'up' }); } });
              var down = el('button', { class: 'tx-icon-btn', title: 'Move down', 'aria-label': 'Move down', text: '↓', onclick: function () { run('PATCH', '/tasks/' + t.id + '/move', { direction: 'down' }); } });
              if (qi === 0) up.disabled = true;
              if (qi === q.length - 1) down.disabled = true;
              actions.appendChild(up); actions.appendChild(down);
            }
            actions.appendChild(el('button', { class: 'tx-link ml-2', text: 'Edit', onclick: function () { openTaskDialog(t, load); } }));
            actions.appendChild(el('button', {
              class: 'tx-link tx-danger ml-2', text: 'Delete',
              onclick: function () { if (confirm('Delete “' + t.title + '”?')) run('DELETE', '/tasks/' + t.id); }
            }));
          }
          card.appendChild(el('div', { class: 'tx-row flex-wrap' }, [
            el('span', { class: 'badge ' + STATUS_BADGE[t.status], text: STATUS_LABEL[t.status] || t.status }),
            el('div', { class: 'flex-1 min-w-0' }, [
              el('p', { class: 'text-sm font-medium truncate', text: t.title }),
              el('p', { class: 'text-xs text-muted truncate', text: taskMeta(t, false) + (t.completedAt ? ' · done ' + fmtDateTime(t.completedAt) : '') })
            ]),
            dueEl(t),
            el('span', { class: 'badge ' + PRIORITY_BADGE[t.priority], text: labelOf(PRIORITIES, t.priority) }),
            t.status !== 'QUEUED' ? timerEl(t, 'text-sm tx-nowrap') : null,
            actions
          ]));
        });
        wrap.appendChild(card);
      });
      p.appendChild(wrap);
    }

    load();
    return load;
  }

  // ── assign / edit dialog (Super Admin, Admin) ────────────────────────
  function openTaskDialog(task, onSaved) {
    var overlay = el('div', { class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4', 'data-tx-dialog': '1' });
    var card = el('div', { class: 'card w-full tx-dialog p-5 max-h-[92vh] overflow-y-auto', role: 'dialog', 'aria-modal': 'true' });
    overlay.appendChild(card);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);

    var st = {
      title: task ? task.title : '', description: task ? task.description || '' : '',
      assignedToId: task ? task.assignedTo.id : '', priority: task ? task.priority : 'NORMAL',
      dueDate: task && task.dueDate ? String(task.dueDate).slice(0, 10) : '',
      customerId: task && task.customer ? task.customer.id : '', customerLabel: task && task.customer ? task.customer.companyName : ''
    };
    var users = [], err = '', saving = false;

    api('GET', '/tasks/assignees').then(function (r) { users = r.data.users || []; render(); }).catch(function (e) { err = e.message; render(); });

    function render() {
      card.innerHTML = '';
      card.appendChild(el('div', { class: 'flex items-start justify-between mb-4' }, [
        el('h2', { class: 'section-title mb-0', text: task ? 'Edit task' : 'Assign a task' }),
        el('button', { class: 'p-1 rounded text-slate-400', 'aria-label': 'Close', text: '✕', onclick: close })
      ]));
      var form = el('div', { class: 'tx-form' });
      function field(label, control, span) {
        return el('div', { class: 'block' + (span ? ' tx-span2' : '') }, [el('span', { class: 'text-xs text-muted', text: label }), el('div', { class: 'mt-1' }, [control])]);
      }
      var title = el('input', { class: INPUT, placeholder: 'What needs doing?' });
      title.value = st.title; title.addEventListener('input', function () { st.title = title.value; });
      form.appendChild(field('Task', title, true));

      var who = el('select', { class: INPUT }, [el('option', { value: '', text: users.length ? 'Choose a person…' : 'Loading…' })]
        .concat(users.map(function (u) { return el('option', { value: u.id, text: u.name + (u.role ? ' (' + u.role.replace('_', ' ').toLowerCase() + ')' : '') }); })));
      who.value = st.assignedToId;
      who.disabled = !!(task && task.status !== 'QUEUED');
      who.addEventListener('change', function () { st.assignedToId = who.value; });
      form.appendChild(field('Assign to', who));

      var pri = el('select', { class: INPUT }, PRIORITIES.map(function (x) { return el('option', { value: x[0], text: x[1] }); }));
      pri.value = st.priority; pri.addEventListener('change', function () { st.priority = pri.value; });
      form.appendChild(field('Priority', pri));

      var due = el('input', { type: 'date', class: INPUT });
      due.value = st.dueDate; due.addEventListener('change', function () { st.dueDate = due.value; });
      form.appendChild(field('Due date (optional)', due));

      form.appendChild(field('Customer (optional)', customerPicker(st, render)));

      var desc = el('textarea', { class: INPUT, rows: '3', placeholder: 'Details, instructions…' });
      desc.value = st.description; desc.addEventListener('input', function () { st.description = desc.value; });
      form.appendChild(field('Description (optional)', desc, true));
      card.appendChild(form);

      if (task && task.status !== 'QUEUED') card.appendChild(el('p', { class: 'text-xs text-muted mt-2', text: 'This task has been started, so it can no longer be reassigned.' }));
      else if (!task) card.appendChild(el('p', { class: 'text-xs text-muted mt-2', text: 'It goes to the end of that person’s queue.' }));
      if (err) card.appendChild(el('p', { class: 'text-xs text-red-600 mt-2', text: err }));

      card.appendChild(el('div', { class: 'flex gap-2 justify-end mt-5' }, [
        el('button', { class: 'btn-secondary', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn-primary' + (saving ? ' tx-disabled' : ''), text: saving ? 'Saving…' : (task ? 'Save' : 'Assign task'), onclick: save })
      ]));
      title.focus();
    }

    function save() {
      if (saving) return;
      err = '';
      if (!st.title.trim()) { err = 'Please give the task a title.'; return render(); }
      if (!st.assignedToId) { err = 'Please choose who this task is for.'; return render(); }
      saving = true; render();
      var body = { title: st.title.trim(), description: st.description, assignedToId: st.assignedToId, priority: st.priority,
                   dueDate: st.dueDate || null, customerId: st.customerId || '' };
      api(task ? 'PUT' : 'POST', task ? '/tasks/' + task.id : '/tasks', body).then(function () {
        close();
        if (onSaved) onSaved();
      }).catch(function (e) { saving = false; err = e.message; render(); });
    }

    render();
  }

  /** Small search-as-you-type customer picker writing into st.customerId / st.customerLabel. */
  function customerPicker(st, rerender) {
    if (st.customerId) {
      return el('div', { class: 'flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50' }, [
        el('span', { class: 'truncate', text: st.customerLabel }),
        el('button', { class: 'tx-link', text: 'Change', onclick: function (e) { e.preventDefault(); st.customerId = ''; st.customerLabel = ''; rerender(); } })
      ]);
    }
    var input = el('input', { class: INPUT, placeholder: 'Search company…' });
    var list = el('div', { class: 'mt-1 space-y-1' });
    var t;
    input.addEventListener('input', function () {
      clearTimeout(t);
      var q = input.value.trim();
      if (!q) { list.innerHTML = ''; return; }
      t = setTimeout(function () {
        api('GET', '/customers?search=' + encodeURIComponent(q) + '&limit=6').then(function (res) {
          list.innerHTML = '';
          ((res.data && res.data.items) || []).forEach(function (c) {
            list.appendChild(el('button', {
              class: 'block w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-slate-50',
              text: c.companyName,
              onclick: function (e) { e.preventDefault(); st.customerId = c.id; st.customerLabel = c.companyName; rerender(); }
            }));
          });
        }).catch(function () {});
      }, 300);
    });
    return el('div', {}, [input, list]);
  }

  // ── Price requests ───────────────────────────────────────────────────
  var PR_HEADLINE = { PENDING: 'Waiting for admin approval', APPROVED: 'Approved', REJECTED: 'Rejected' };

  /** "15% below list" / "5% above list" / "same as list" — or null when there's nothing to compare. */
  function vsList(price, list) {
    if (price === null || price === undefined || price === '' || !list) return null;
    var pct = (Number(price) - Number(list)) / Number(list) * 100;
    if (Math.abs(pct) < 0.05) return { text: 'same as list price', cls: 'text-xs text-muted' };
    return pct < 0
      ? { text: (Math.round(-pct * 10) / 10) + '% below list price', cls: 'tx-down' }
      : { text: (Math.round(pct * 10) / 10) + '% above list price', cls: 'tx-up' };
  }
  function lineValue(price, qty) {
    if (price === null || price === undefined || price === '' || !qty) return null;
    return 'Total for ' + qty + ': ' + money(Number(price) * Number(qty));
  }

  function priceRequestsTab(p, onPendingCount) {
    var status = isAdminTier() ? 'PENDING' : 'ALL';
    var who = '';
    var list = [], counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 }, requesters = [], err = '', showForm = !isAdminTier(), loaded = false;
    var blankForm = function () { return { productId: '', productLabel: '', productName: '', listPrice: null, customerId: '', customerLabel: '', quantity: '', requestedPrice: '', notes: '' }; };
    var form = blankForm();
    var drafts = {}; // requestId -> { price, note } while an admin types a response
    var flash = '';

    function load() {
      if (!loaded) loading(p);
      api('GET', '/price-requests?status=' + status + (who ? '&requestedById=' + encodeURIComponent(who) : '')).then(function (r) {
        list = r.data.requests || [];
        counts = r.data.counts || counts;
        requesters = r.data.requesters || [];
        loaded = true;
        onPendingCount(r.data.pendingCount || 0);
        render();
      }).catch(function (e) { errorBox(p, e.message, load); });
    }

    function render() {
      p.innerHTML = '';

      // How it works — one line, so nobody has to guess who does what.
      p.appendChild(el('p', { class: 'tx-help mb-3', text: canManage()
        ? 'Engineers ask for a price here. Check the list price and the price they asked for, then approve with the final price or reject with a reason — they see your answer straight away.'
        : 'Need a special price for a customer? Raise a request below. An admin approves it with the final price (or rejects it with a reason) and you’ll see the answer here.' }));

      // Status tiles — they double as the filter.
      var tiles = el('div', { class: 'tx-tiles mb-4' });
      [['PENDING', isAdminTier() ? 'Waiting for your decision' : 'Waiting for admin', counts.PENDING],
       ['APPROVED', 'Approved', counts.APPROVED], ['REJECTED', 'Rejected', counts.REJECTED],
       ['ALL', 'All requests', counts.PENDING + counts.APPROVED + counts.REJECTED]].forEach(function (t) {
        tiles.appendChild(el('button', { class: 'tx-tile' + (status === t[0] ? ' tx-tile-on' : ''), onclick: function () { status = t[0]; load(); } }, [
          el('p', { class: 'text-xs text-muted', text: t[1] }), el('p', { class: 'tx-tile-n', text: String(t[2]) })
        ]));
      });
      p.appendChild(tiles);

      var bar = el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-4' });
      var left = el('div', { class: 'flex items-center gap-2 flex-wrap' });
      if (isAdminTier() && requesters.length) {
        var sel = el('select', { class: INPUT, style: 'width:auto;max-width:240px', 'aria-label': 'Requested by' },
          [el('option', { value: '', text: 'All engineers' })].concat(requesters.map(function (u) { return el('option', { value: u.id, text: u.name }); })));
        sel.value = who;
        sel.addEventListener('change', function () { who = sel.value; load(); });
        left.appendChild(sel);
      }
      left.appendChild(el('span', { class: 'text-sm text-muted', text: list.length + ' shown' }));
      bar.appendChild(left);
      bar.appendChild(el('button', { class: showForm ? 'btn-secondary' : 'btn-primary', text: showForm ? 'Hide form' : '+ Raise price request', onclick: function () { showForm = !showForm; render(); } }));
      p.appendChild(bar);

      if (flash) p.appendChild(el('div', { class: 'tx-banner tx-banner-APPROVED mb-3', text: flash }));
      if (showForm) p.appendChild(requestForm());
      if (err) p.appendChild(el('p', { class: 'text-sm text-red-600 mb-3', text: err }));

      if (!list.length) {
        p.appendChild(el('div', { class: 'card p-10 text-center text-muted', text:
          status === 'PENDING' ? (isAdminTier() ? 'Nothing waiting for a decision.' : 'You have no requests waiting.') : 'No price requests here yet.' }));
        return;
      }
      var wrap = el('div', { class: 'space-y-3' });
      list.forEach(function (r) { wrap.appendChild(requestCard(r)); });
      p.appendChild(wrap);
    }

    function priceCell(label, price, r, final) {
      var cmp = vsList(price, r.listPrice);
      var total = lineValue(price, r.quantity);
      return el('div', { class: 'tx-cmp-cell' + (final ? ' tx-cmp-final' : '') }, [
        el('p', { class: 'text-xs text-muted', text: label }),
        el('p', { class: 'tx-big', text: money(price) }),
        cmp && label !== 'List price' ? el('p', { class: cmp.cls, text: cmp.text }) : null,
        total ? el('p', { class: 'text-xs text-muted', text: total }) : null
      ]);
    }

    function requestCard(r) {
      var mine = currentUser() && r.requestedBy.id === currentUser().id;
      var card = el('div', { class: 'card p-4 space-y-3 tx-pr tx-pr-' + r.status });

      // 1. What and for whom
      card.appendChild(el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' }, [
        el('div', { class: 'min-w-0' }, [
          el('p', { class: 'text-base font-semibold text-slate-900 dark:text-slate-100', text: r.productName + (r.itemCode && r.itemCode !== 'MANUAL' ? ' (' + r.itemCode + ')' : '') }),
          el('p', { class: 'text-sm text-muted', text: [
            r.customer ? 'For ' + r.customer.companyName : 'No customer given',
            r.quantity !== null ? 'Qty ' + r.quantity : null
          ].filter(Boolean).join(' · ') }),
          el('p', { class: 'text-xs text-muted', text: 'Raised by ' + (mine ? 'you' : (r.requestedBy.name || '—')) + ' · ' + fmtDateTime(r.createdAt) })
        ]),
        el('span', { class: 'badge ' + PR_BADGE[r.status], text: PR_HEADLINE[r.status] })
      ]));

      // 2. The prices side by side
      card.appendChild(el('div', { class: 'tx-cmp' }, [
        priceCell('List price', r.listPrice, r, false),
        priceCell(mine ? 'Price you asked for' : 'Price the engineer asked for', r.requestedPrice, r, false),
        r.status === 'APPROVED'
          ? priceCell('Approved price', r.approvedPrice, r, true)
          : el('div', { class: 'tx-cmp-cell' }, [
              el('p', { class: 'text-xs text-muted', text: 'Approved price' }),
              el('p', { class: 'tx-big text-muted', text: r.status === 'REJECTED' ? 'Not approved' : 'Awaiting decision' })
            ])
      ]));

      if (r.notes) {
        card.appendChild(el('div', { class: 'tx-muted-box' }, [
          el('p', { class: 'text-xs text-muted', text: 'Why the engineer is asking' }),
          el('p', { class: 'text-sm whitespace-pre-wrap', text: r.notes })
        ]));
      }

      // 3. The outcome
      if (r.status !== 'PENDING') {
        var by = ((r.respondedBy && r.respondedBy.name) || '—') + ' · ' + fmtDateTime(r.respondedAt);
        card.appendChild(el('div', { class: 'tx-banner tx-banner-' + r.status }, [
          el('p', { class: 'font-semibold', text: r.status === 'APPROVED' ? '✓ Approved at ' + money(r.approvedPrice) : '✕ Rejected' }),
          r.responseNote ? el('p', { text: (r.status === 'REJECTED' ? 'Reason: ' : 'Note: ') + r.responseNote }) : null,
          el('p', { class: 'text-xs', text: 'By ' + by })
        ]));
      } else if (!canManage()) {
        card.appendChild(el('div', { class: 'tx-banner tx-banner-PENDING', text: '⏳ Waiting for an admin to approve or reject this request.' }));
      }

      // 4. Actions
      if (r.status === 'PENDING' && canManage()) card.appendChild(decisionBox(r));
      else if (r.status === 'PENDING' && mine) {
        card.appendChild(el('div', { class: 'flex justify-end' }, [el('button', {
          class: 'tx-link tx-danger', text: 'Withdraw request',
          onclick: function () {
            if (!confirm('Withdraw this price request?')) return;
            api('DELETE', '/price-requests/' + r.id).then(load).catch(function (e) { err = e.message; render(); });
          }
        })]));
      }
      return card;
    }

    function decisionBox(r) {
      var d = drafts[r.id] || (drafts[r.id] = { price: r.requestedPrice !== null ? String(r.requestedPrice) : (r.listPrice !== null ? String(r.listPrice) : ''), note: '' });
      var hint = el('p', { class: 'text-xs text-muted mt-1' });
      function updateHint() {
        var cmp = vsList(d.price, r.listPrice), tot = lineValue(d.price, r.quantity);
        hint.textContent = [cmp ? cmp.text : null, tot].filter(Boolean).join(' · ');
        hint.className = (cmp ? cmp.cls : 'text-xs text-muted') + ' mt-1 block';
      }
      var price = el('input', { type: 'number', min: '0', step: 'any', class: INPUT, placeholder: 'Final price per unit (₹)', 'aria-label': 'Approved price' });
      price.value = d.price;
      price.addEventListener('input', function () { d.price = price.value; updateHint(); });
      updateHint();
      var note = el('input', { class: INPUT, placeholder: 'Message to the engineer — required if you reject', 'aria-label': 'Note to engineer' });
      note.value = d.note; note.addEventListener('input', function () { d.note = note.value; });

      return el('div', { class: 'tx-decide space-y-2' }, [
        el('p', { class: 'text-sm font-semibold', text: 'Your decision' }),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-2' }, [
          el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Approved price (per unit)' }), el('div', { class: 'mt-1' }, [price]), hint]),
          el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Note' }), el('div', { class: 'mt-1' }, [note])])
        ]),
        el('div', { class: 'flex gap-2 justify-end' }, [
          el('button', { class: 'btn-secondary btn-sm', text: '✕ Reject', onclick: function () { respond(r, 'REJECTED'); } }),
          el('button', { class: 'btn-primary btn-sm', text: '✓ Approve at this price', onclick: function () { respond(r, 'APPROVED'); } })
        ])
      ]);
    }

    function respond(r, st) {
      var d = drafts[r.id] || {};
      err = ''; flash = '';
      if (st === 'APPROVED' && (d.price === '' || isNaN(Number(d.price)))) { err = 'Enter the approved price for “' + r.productName + '”.'; return render(); }
      if (st === 'REJECTED' && !(d.note || '').trim()) { err = 'Write the reason in the note to reject “' + r.productName + '”.'; return render(); }
      api('PATCH', '/price-requests/' + r.id + '/respond', { status: st, approvedPrice: st === 'APPROVED' ? Number(d.price) : null, responseNote: d.note || '' })
        .then(function () {
          delete drafts[r.id];
          flash = (st === 'APPROVED' ? 'Approved “' + r.productName + '” at ' + money(Number(d.price)) : 'Rejected “' + r.productName + '”') + ' — ' + (r.requestedBy.name || 'the engineer') + ' can see it now.';
          load();
        })
        .catch(function (e) { err = e.message; render(); });
    }

    function requestForm() {
      var box = el('div', { class: 'card p-4 mb-4 space-y-3' });
      box.appendChild(el('div', {}, [
        el('p', { class: 'text-sm font-semibold', text: 'Ask admin for a price' }),
        el('p', { class: 'tx-help', text: 'Only the product is required — the more you fill in, the faster admin can decide.' })
      ]));
      var grid = el('div', { class: 'tx-form' });
      function field(label, control, span, help) {
        return el('div', { class: 'block' + (span ? ' tx-span2' : '') }, [
          el('span', { class: 'text-xs font-medium text-muted', text: label }),
          el('div', { class: 'mt-1' }, [control]),
          help ? el('p', { class: 'tx-help mt-1', text: help }) : null
        ]);
      }

      // 1. Product: pick from catalog, or type a free-text item.
      var prodCtl;
      if (form.productId) {
        prodCtl = el('div', { class: 'flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50' }, [
          el('span', { class: 'truncate', text: form.productLabel + (form.listPrice !== null ? ' · list price ' + money(form.listPrice) : '') }),
          el('button', { class: 'tx-link', text: 'Change', onclick: function (e) { e.preventDefault(); form.productId = ''; form.productLabel = ''; form.listPrice = null; render(); } })
        ]);
      } else {
        var pin = el('input', { class: INPUT, placeholder: 'Search products, or type the item name…' });
        pin.value = form.productName;
        var res = el('div', { class: 'mt-1 space-y-1' });
        var t;
        pin.addEventListener('input', function () {
          form.productName = pin.value;
          clearTimeout(t);
          var q = pin.value.trim();
          if (!q) { res.innerHTML = ''; return; }
          t = setTimeout(function () {
            api('GET', '/products/search?q=' + encodeURIComponent(q)).then(function (r2) {
              res.innerHTML = '';
              ((r2.data && r2.data.results) || []).slice(0, 8).forEach(function (pr) {
                res.appendChild(el('button', {
                  class: 'block w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-slate-50',
                  text: pr.productName + ' (' + pr.itemCode + ')' + (pr.standardPrice ? ' · ' + money(pr.standardPrice) : ''),
                  onclick: function (e) {
                    e.preventDefault();
                    form.productId = pr.id; form.productLabel = pr.productName + ' (' + pr.itemCode + ')';
                    form.listPrice = pr.standardPrice !== undefined && pr.standardPrice !== null ? Number(pr.standardPrice) : null;
                    render();
                  }
                }));
              });
            }).catch(function () {});
          }, 300);
        });
        prodCtl = el('div', {}, [pin, res]);
      }
      grid.appendChild(field('1. Product *', prodCtl, true, form.productId ? null : 'Pick from the list to show the list price automatically, or just type the item name.'));
      grid.appendChild(field('2. Customer', customerPicker(form, render)));

      var qty = el('input', { type: 'number', min: '0', step: 'any', class: INPUT, placeholder: 'e.g. 10' });
      qty.value = form.quantity;
      grid.appendChild(field('3. Quantity', qty));

      var rp = el('input', { type: 'number', min: '0', step: 'any', class: INPUT, placeholder: 'Price per unit you want to offer (₹)' });
      rp.value = form.requestedPrice;
      var rpHint = el('p', { class: 'text-xs mt-1' });
      function updateRpHint() {
        var cmp = vsList(form.requestedPrice, form.listPrice), tot = lineValue(form.requestedPrice, form.quantity);
        rpHint.textContent = [cmp ? cmp.text : null, tot].filter(Boolean).join(' · ');
        rpHint.className = (cmp ? cmp.cls : 'text-xs text-muted') + ' mt-1 block';
      }
      rp.addEventListener('input', function () { form.requestedPrice = rp.value; updateRpHint(); });
      qty.addEventListener('input', function () { form.quantity = qty.value; updateRpHint(); });
      updateRpHint();
      grid.appendChild(el('div', { class: 'block' }, [
        el('span', { class: 'text-xs font-medium text-muted', text: '4. Price you want to offer' }), el('div', { class: 'mt-1' }, [rp]), rpHint
      ]));

      var notes = el('textarea', { class: INPUT, rows: '2', placeholder: 'e.g. competitor quoted ₹84, order of 200 units, repeat customer…' });
      notes.value = form.notes; notes.addEventListener('input', function () { form.notes = notes.value; });
      grid.appendChild(field('5. Why do you need this price?', notes, true));
      box.appendChild(grid);

      box.appendChild(el('div', { class: 'flex justify-end' }, [el('button', { class: 'btn-primary', text: 'Send to admin', onclick: submit })]));
      return box;
    }

    function submit() {
      err = ''; flash = '';
      if (!form.productId && !form.productName.trim()) { err = 'Choose a product or type the item name.'; return render(); }
      var body = {
        productId: form.productId || '', productName: form.productId ? '' : form.productName.trim(),
        customerId: form.customerId || '', quantity: form.quantity, requestedPrice: form.requestedPrice, notes: form.notes
      };
      api('POST', '/price-requests', body).then(function () {
        flash = 'Request sent — an admin will approve or reject it. You’ll see the answer under “Waiting for admin”.';
        form = blankForm();
        showForm = false;
        status = isAdminTier() ? 'PENDING' : 'ALL';
        load();
      }).catch(function (e) { err = e.message; render(); });
    }

    load();
    return load;
  }

  window.Tasks = { mountPage: mount };
})();
