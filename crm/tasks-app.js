/* ══════════════════════════════════════════════════════════════════════
   Tasks — admin-assigned work queue with a timer.

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
     (Price requests have their own page: /price-requests/.)

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
  /** Sees everyone's tasks — matches is_admin_tier(). */
  function isAdminTier() { return ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(role()) !== -1; }
  /** Assigns tasks — matches require_admin(). */
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
      '.tx-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem}',
      '@media(min-width:768px){.tx-tiles{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}}',
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
      '.tx-person-RUNNING{border-left-color:#22c55e}.tx-person-PAUSED{border-left-color:#f59e0b}.tx-person-GENERAL{border-left-color:#0ea5e9}',
      '.tx-state-GENERAL{background:#e0f2fe;color:#075985}.tx-gen-box{background:#f0f9ff}.dark .tx-gen-box{background:#0c4a6e33}',
      '.tx-general{border-top:3px solid #0ea5e9}.tx-general-log{max-height:180px;overflow:auto;border-top:1px solid #e2e8f0;padding-top:.25rem}.dark .tx-general-log{border-color:#334155}',
      '.grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}',
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
      '.tx-help{font-size:.75rem;color:#64748b}',
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
    // Admins see their own queue and what they've handed out as separate tabs.
    var tabs = [['mine', canManage() ? 'Own tasks' : 'My tasks']];
    if (canManage()) tabs.push(['assigned', 'Assigned by me']);
    if (isAdminTier()) { tabs.push(['team', 'Team live']); tabs.push(['all', 'All tasks']); }
    tabs.push(['completed', 'Completed']);

    var tab = null;
    try { tab = localStorage.getItem('crm_tasks_tab'); } catch (e) {}
    // Links from alerts: /tasks/#completed …
    var hashTab = location.hash.replace(/^#\/?/, '');
    // Price requests moved to their own page — keep old links working.
    if (hashTab === 'prices') { location.replace('/price-requests/'); return; }
    if (tabs.some(function (t) { return t[0] === hashTab; })) tab = hashTab;
    if (!tabs.some(function (t) { return t[0] === tab; })) tab = isAdminTier() ? 'team' : 'mine';

    var tabBar = el('div', { class: 'tx-tabs', role: 'tablist' });
    var panel = el('div', { class: 'mt-5' });
    var reload = function () {};

    root.appendChild(el('div', { class: 'space-y-4' }, [
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('h1', { class: 'page-title', text: 'Tasks' }),
        canManage() ? el('button', { class: 'btn-primary', text: '+ Assign task', onclick: function () { openTaskDialog(null, function () { reload(); }); } }) : null
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
        }, [t[1]]));
      });
    }
    function switchTab(t) {
      tab = t;
      try { localStorage.setItem('crm_tasks_tab', t); } catch (e) {}
      renderTabs();
      panel.innerHTML = '';
      reload = t === 'mine' ? myTasksTab(panel)
             : t === 'completed' ? completedTab(panel)
             : t === 'team' ? teamTab(panel)
             : t === 'assigned' ? assignedTab(panel)
             : allTasksTab(panel);
    }

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
      if (tab === 'team' || ticks % 3 === 0) reload();
    }, 20000);

    // A sound alert arrived (crm-global.js) — refresh what's on screen.
    window.addEventListener('crm-alert', function (e) {
      var types = ((e.detail && e.detail.events) || []).map(function (x) { return x.type; });
      if (!types.some(function (ty) { return /^TASK_/.test(ty); })) return; // only task alerts change this page
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (document.querySelector('[data-tx-dialog]')) return;
      reload();
    });
    window.addEventListener('hashchange', function () {
      var h = location.hash.replace(/^#\/?/, '');
      if (h === 'prices') { location.replace('/price-requests/'); return; }
      if (h !== tab && tabs.some(function (t) { return t[0] === h; })) switchTab(h);
    });

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
    // Kept across re-renders so its note / state survive. Starting it pauses a running task, so reload the queue too.
    var general = generalTimerCard(function () { load(true); });

    function load(skipGeneral) {
      if (!open.length && !done.length) loading(p);
      if (skipGeneral !== true) general.reload(); // a task start / resume stops the general timer
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
      right.appendChild(general.node);
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

  // ── General timer ────────────────────────────────────────────────────
  // For work that isn't a queued task (travel, calls, office work…).
  // Server-side like the task timer; admins see it on Team live.
  function generalTimerCard(onChange) {
    var node = el('div', { class: 'card p-4 space-y-3 tx-general', id: 'tx-general' });
    var data = null, busy = false, err = '', noteVal = '', showLog = false;
    function load() {
      api('GET', '/tasks/general').then(function (r) { data = r.data; render(); }).catch(function (e) { err = e.message; render(); });
    }
    function act(path, body) {
      if (busy) return;
      busy = true; err = ''; render();
      api('POST', '/tasks/general/' + path, body || {}).then(function (r) { busy = false; data = r.data; noteVal = ''; render(); if (onChange) onChange(); })
        .catch(function (e) { busy = false; err = e.message; render(); });
    }
    function render() {
      node.innerHTML = '';
      var run = data && data.running;
      node.appendChild(el('div', { class: 'flex items-center justify-between gap-2' }, [
        el('span', { class: 'flex items-center gap-2 text-sm font-semibold' }, [run ? el('span', { class: 'tx-dot tx-dot-run' }) : null, 'General timer']),
        el('span', { class: 'text-xs text-muted', text: 'work not on a task · pauses your task timer' })
      ]));
      if (!data) { node.appendChild(el('p', { class: 'text-sm text-muted', text: err || 'Loading…' })); return; }
      node.appendChild(el('div', { class: 'flex items-end justify-between gap-3 flex-wrap' }, [
        el('div', {}, [
          timerEl({ elapsedSeconds: run ? run.elapsedSeconds : 0, running: !!run }, 'tx-timer-mid'),
          el('p', { class: 'text-xs text-muted mt-0.5', text: run ? (run.note ? '“' + run.note + '” · ' : '') + 'since ' + fmtDateTime(run.startedAt) : 'Not running' })
        ]),
        el('div', { class: 'text-right' }, [
          el('p', { class: 'text-xs text-muted', text: 'Today' }),
          timerEl({ elapsedSeconds: data.secondsToday, running: !!run }, 'text-sm font-semibold'),
          el('p', { class: 'text-xs text-muted mt-1', text: 'This week ' + fmtDurationShort(data.secondsWeek) })
        ])
      ]));
      if (err) node.appendChild(el('p', { class: 'text-xs text-red-600', text: err }));
      var dis = busy ? ' tx-disabled' : '';
      if (run) {
        node.appendChild(el('button', { class: 'btn-secondary w-full' + dis, id: 'tx-general-stop', text: '■ Stop general timer', onclick: function () { act('stop'); } }));
      } else {
        var inp = el('input', { class: INPUT, id: 'tx-general-note', placeholder: 'What are you working on? (optional)', maxlength: '255' });
        inp.value = noteVal;
        inp.addEventListener('input', function () { noteVal = inp.value; });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') act('start', { note: noteVal }); });
        node.appendChild(inp);
        node.appendChild(el('button', { class: 'btn-primary w-full' + dis, id: 'tx-general-start', text: '▶ Start general timer', onclick: function () { act('start', { note: noteVal }); } }));
      }
      var sessions = (data.sessions || []).filter(function (x) { return x.endedAt; });
      if (sessions.length) {
        node.appendChild(el('button', { class: 'tx-link text-xs', text: (showLog ? 'Hide' : 'Show') + ' recent sessions (' + sessions.length + ')', onclick: function () { showLog = !showLog; render(); } }));
        if (showLog) node.appendChild(el('div', { class: 'tx-general-log' }, sessions.map(function (x) {
          return el('div', { class: 'flex justify-between gap-2 text-xs py-1' }, [
            el('span', { class: 'truncate', text: fmtDateTime(x.startedAt) + (x.note ? ' · ' + x.note : '') }),
            el('span', { class: 'tx-timer tx-nowrap font-semibold', text: fmtDurationShort(x.seconds) })
          ]);
        })));
      }
    }
    render();
    load();
    return { node: node, reload: load };
  }

  // ── Assigned by me (Super Admin / Admin) ─────────────────────────────
  function assignedTab(p) {
    var tasks = [], showDone = false, who = '';
    function load() {
      if (!tasks.length) loading(p);
      api('GET', '/tasks?assignedByMe=1&status=' + (showDone ? 'ALL' : 'OPEN') + '&limit=300').then(function (r) { tasks = r.data.tasks || []; render(); })
        .catch(function (e) { errorBox(p, e.message, load); });
    }
    function render() {
      p.innerHTML = '';
      var people = {};
      tasks.forEach(function (t) { people[t.assignedTo.id] = t.assignedTo.name; });
      var sel = el('select', { class: INPUT + ' tx-assigned-who', style: 'max-width:240px' }, [el('option', { value: '', text: 'Everyone' })].concat(
        Object.keys(people).sort(function (a, b) { return people[a] < people[b] ? -1 : 1; }).map(function (id) { return el('option', { value: id, text: people[id] }); })));
      sel.value = who; sel.addEventListener('change', function () { who = sel.value; render(); });
      var chk = el('input', { type: 'checkbox', id: 'tx-assigned-done' }); chk.checked = showDone;
      chk.addEventListener('change', function () { showDone = chk.checked; tasks = []; load(); });
      var shown = tasks.filter(function (t) { return !who || t.assignedTo.id === who; });
      var counts = { open: 0, running: 0, done: 0 };
      shown.forEach(function (t) { if (t.status === 'COMPLETED') counts.done++; else counts.open++; if (t.status === 'IN_PROGRESS') counts.running++; });
      p.appendChild(el('div', { class: 'flex items-center gap-3 flex-wrap mb-3' }, [
        sel, el('label', { class: 'flex items-center gap-2 text-sm' }, [chk, 'Include completed']),
        el('span', { class: 'text-xs text-muted ml-auto', text: counts.open + ' open · ' + counts.running + ' being worked on' + (showDone ? ' · ' + counts.done + ' completed' : '') })
      ]));
      if (!shown.length) { p.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: 'You haven’t assigned any ' + (showDone ? '' : 'open ') + 'tasks.' })); return; }
      var box = el('div', { class: 'card overflow-hidden', id: 'tx-assigned-list' });
      shown.forEach(function (t) {
        box.appendChild(el('div', { class: 'tx-row flex-wrap' }, [
          el('span', { class: 'badge ' + STATUS_BADGE[t.status], text: STATUS_LABEL[t.status] || t.status }),
          el('div', { class: 'flex-1 min-w-0' }, [
            el('p', { class: 'text-sm font-medium truncate', text: t.title }),
            el('p', { class: 'text-xs text-muted truncate', text: 'For ' + (t.assignedTo.name || '—') + (t.customer ? ' · ' + t.customer.companyName : '') +
              (t.startedAt ? ' · started ' + fmtDateTime(t.startedAt) : '') + (t.completedAt ? ' · finished ' + fmtDateTime(t.completedAt) : '') })
          ]),
          dueEl(t),
          el('span', { class: 'badge ' + PRIORITY_BADGE[t.priority], text: labelOf(PRIORITIES, t.priority) }),
          t.status === 'QUEUED' ? el('span', { class: 'text-xs text-muted tx-nowrap', text: '—' }) : timerEl(t, 'text-sm font-semibold tx-nowrap'),
          t.status !== 'COMPLETED' ? el('button', { class: 'tx-link text-xs', text: 'Edit', onclick: function () { openTaskDialog(t, load); } }) : null
        ]));
      });
      p.appendChild(box);
    }
    load();
    return load;
  }

  // ── Team live (admin-tier) ───────────────────────────────────────────
  var STATE_LABEL = { RUNNING: 'Working now', GENERAL: 'General timer', PAUSED: 'Paused', WAITING: 'Not started', IDLE: 'No tasks' };
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
      [['ALL', 'Everyone', people.length], ['RUNNING', 'Working now', count('RUNNING')], ['GENERAL', 'On general timer', count('GENERAL')], ['PAUSED', 'Paused', count('PAUSED')],
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
          x.state === 'RUNNING' || x.state === 'GENERAL' ? el('span', { class: 'tx-dot tx-dot-run' }) : x.state === 'PAUSED' ? el('span', { class: 'tx-dot tx-dot-pause' }) : null,
          STATE_LABEL[x.state]
        ])
      ]));

      if (x.general) {
        card.appendChild(el('div', { class: 'tx-muted-box tx-gen-box' }, [
          el('p', { class: 'text-xs text-muted', text: 'General timer' + (x.general.note ? ' — “' + x.general.note + '”' : '') }),
          el('div', { class: 'flex items-end justify-between gap-2 mt-1' }, [
            timerEl({ elapsedSeconds: x.general.elapsedSeconds, running: true }, 'tx-timer-mid'),
            el('span', { class: 'text-xs text-muted', text: 'since ' + fmtDateTime(x.general.startedAt) })
          ])
        ]));
      }
      if (c) {
        card.appendChild(el('div', { class: 'tx-muted-box' }, [
          el('p', { class: 'text-xs text-muted', text: c.running ? 'Current task' : 'Paused task' }),
          el('p', { class: 'text-sm font-medium truncate', text: c.title }),
          el('div', { class: 'flex items-end justify-between gap-2 mt-1' }, [
            timerEl(c, 'tx-timer-mid'),
            el('span', { class: 'text-xs text-muted', text: 'since ' + fmtDateTime(c.startedAt) })
          ])
        ]));
      } else if (!x.general) {
        card.appendChild(el('div', { class: 'tx-muted-box text-sm text-muted', text: x.queuedCount ? 'Has tasks waiting but hasn’t started one.' : 'Nothing assigned right now.' }));
      }

      var todayTimer = timerEl({ elapsedSeconds: x.secondsToday, running: !!(c && c.running) }, 'text-sm font-semibold');
      var genTimer = timerEl({ elapsedSeconds: x.generalSecondsToday || 0, running: !!x.general }, 'text-sm font-semibold');
      card.appendChild(el('div', { class: 'grid grid-cols-4 gap-2 text-center' }, [
        miniStat('Task time today', todayTimer),
        miniStat('General today', genTimer),
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

  // ── Completed tasks — full details ───────────────────────────────────
  function completedTab(p) {
    var range = 'week', from = '', to = '', who = '', search = '', openId = null;
    var data = null, users = [];
    if (canManage()) api('GET', '/tasks/assignees').then(function (r) { users = r.data.users || []; if (data) render(); }).catch(function () {});

    function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function rangeDates() {
      var now = new Date(), f = new Date(now);
      if (range === 'today') return [iso(now), iso(now)];
      if (range === 'week') { f.setDate(f.getDate() - 6); return [iso(f), iso(now)]; }
      if (range === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
      if (range === 'all') return ['', ''];
      return [from, to];
    }
    function load() {
      if (!data) loading(p);
      var d = rangeDates(), q = [];
      if (d[0]) q.push('from=' + d[0]);
      if (d[1]) q.push('to=' + d[1]);
      if (who) q.push('assignedToId=' + encodeURIComponent(who));
      if (search) q.push('search=' + encodeURIComponent(search));
      api('GET', '/tasks/completed' + (q.length ? '?' + q.join('&') : '')).then(function (r) { data = r.data; render(); })
        .catch(function (e) { errorBox(p, e.message, load); });
    }

    function csv() {
      var rows = [['Completed at', 'Task', 'Customer', 'Assigned to', 'Assigned by', 'Priority', 'Assigned at', 'Started at', 'Time taken (hh:mm:ss)', 'Due date', 'On time', 'Completion note', 'Description']];
      data.tasks.forEach(function (t) {
        rows.push([t.completedAt, t.title, t.customer ? t.customer.companyName : '', t.assignedTo.name, t.assignedBy.name, t.priority,
          t.createdAt, t.startedAt || '', fmtDuration(t.elapsedSeconds), t.dueDate || '', t.onTime === null ? '' : (t.onTime ? 'Yes' : 'Late'),
          t.completionNote || '', t.description || '']);
      });
      var text = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
      var a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })), download: 'completed-tasks-' + iso(new Date()) + '.csv' });
      document.body.appendChild(a); a.click(); a.remove();
    }

    function render() {
      p.innerHTML = '';
      var S = data.summary;
      // Filters
      var bar = el('div', { class: 'flex items-center gap-2 flex-wrap mb-4' });
      [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Custom']].forEach(function (r) {
        bar.appendChild(el('button', { class: 'tx-pill' + (range === r[0] ? ' tx-pill-on' : ''), text: r[1], onclick: function () { range = r[0]; if (r[0] !== 'custom') load(); else render(); } }));
      });
      if (range === 'custom') {
        var fI = el('input', { type: 'date', class: INPUT, style: 'width:auto' }); fI.value = from;
        var tI = el('input', { type: 'date', class: INPUT, style: 'width:auto' }); tI.value = to;
        fI.addEventListener('change', function () { from = fI.value; load(); });
        tI.addEventListener('change', function () { to = tI.value; load(); });
        bar.appendChild(fI); bar.appendChild(el('span', { class: 'text-xs text-muted', text: 'to' })); bar.appendChild(tI);
      }
      if (isAdminTier()) {
        var people = users.length ? users : (S.byPerson || []);
        var sel = el('select', { class: INPUT, style: 'width:auto;max-width:220px', 'aria-label': 'Person' },
          [el('option', { value: '', text: 'Everyone' })].concat(people.map(function (x) { return el('option', { value: x.id, text: x.name }); })));
        sel.value = who;
        sel.addEventListener('change', function () { who = sel.value; load(); });
        bar.appendChild(sel);
      }
      var sI = el('input', { type: 'search', class: INPUT, placeholder: 'Search task, customer or note…', style: 'width:auto;min-width:220px' });
      sI.value = search;
      var st;
      sI.addEventListener('input', function () { clearTimeout(st); st = setTimeout(function () { search = sI.value.trim(); load(); }, 350); });
      bar.appendChild(sI);
      if (data.tasks.length) bar.appendChild(el('button', { class: 'btn-secondary btn-sm', text: 'Download CSV', onclick: csv }));
      p.appendChild(bar);

      // Summary
      var tiles = el('div', { class: 'tx-tiles mb-4' });
      [['Tasks completed', String(S.count)], ['Total time spent', fmtDuration(S.seconds)], ['Average per task', fmtDuration(S.avgSeconds)],
       ['On time / late', S.onTime + ' / ' + S.late]].forEach(function (x) {
        tiles.appendChild(el('div', { class: 'tx-tile', style: 'cursor:default' }, [el('p', { class: 'text-xs text-muted', text: x[0] }), el('p', { class: 'tx-tile-n tx-timer', text: x[1] })]));
      });
      p.appendChild(tiles);
      if (isAdminTier() && !who && S.byPerson && S.byPerson.length > 1) {
        var chips = el('div', { class: 'flex gap-2 flex-wrap mb-4' });
        S.byPerson.forEach(function (x) {
          chips.appendChild(el('button', { class: 'tx-pill', onclick: function () { who = x.id; load(); } },
            [x.name + ' · ' + x.count + (x.count === 1 ? ' task · ' : ' tasks · ') + fmtDurationShort(x.seconds)]));
        });
        p.appendChild(chips);
      }

      if (!data.tasks.length) { p.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: 'No completed tasks in this period.' })); return; }

      var heads = ['Completed', 'Task', 'Done by', 'Assigned by', 'Priority', 'Time taken', 'Due', 'Note'];
      var tbody = el('tbody');
      data.tasks.forEach(function (t) {
        var open = openId === t.id;
        var due = t.dueDate ? el('span', { class: 'badge ' + (t.onTime ? 'badge-green' : 'badge-red'), text: (t.onTime ? 'On time · ' : 'Late · ') + fmtDate(t.dueDate) }) : el('span', { class: 'text-muted', text: '—' });
        var tr = el('tr', { class: 'table-row cursor-pointer', 'aria-expanded': open ? 'true' : 'false', tabindex: '0' }, [
          el('td', { class: 'px-3 py-3 tx-nowrap', text: fmtDateTime(t.completedAt) }),
          el('td', { class: 'px-3 py-3' }, [el('p', { class: 'font-medium', text: t.title }), t.customer ? el('p', { class: 'text-xs text-muted', text: t.customer.companyName }) : null]),
          el('td', { class: 'px-3 py-3 tx-nowrap', text: t.assignedTo.name || '—' }),
          el('td', { class: 'px-3 py-3 tx-nowrap text-muted', text: t.assignedBy.name || '—' }),
          el('td', { class: 'px-3 py-3' }, [el('span', { class: 'badge ' + PRIORITY_BADGE[t.priority], text: labelOf(PRIORITIES, t.priority) })]),
          el('td', { class: 'px-3 py-3 tx-nowrap font-semibold tx-timer', text: fmtDuration(t.elapsedSeconds) }),
          el('td', { class: 'px-3 py-3 tx-nowrap' }, [due]),
          el('td', { class: 'px-3 py-3 text-muted', style: 'max-width:260px', text: t.completionNote ? (t.completionNote.length > 60 ? t.completionNote.slice(0, 60) + '…' : t.completionNote) : '—' })
        ]);
        function toggle() { openId = open ? null : t.id; render(); }
        tr.addEventListener('click', toggle);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') toggle(); });
        tbody.appendChild(tr);
        if (open) tbody.appendChild(el('tr', {}, [el('td', { colspan: String(heads.length), class: 'px-4 py-4 bg-slate-50' }, [detail(t)])]));
      });
      p.appendChild(el('div', { class: 'card overflow-hidden' }, [el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-sm' }, [
        el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, heads.map(function (h) { return el('th', { class: 'table-head text-left px-3 py-3 tx-nowrap', text: h }); }))]),
        tbody
      ])])]));
    }

    function detail(t) {
      function step(label, when, extra) {
        return el('div', { class: 'tx-muted-box' }, [el('p', { class: 'text-xs text-muted', text: label }), el('p', { class: 'text-sm font-semibold', text: when ? fmtDateTime(when) : '—' }), extra ? el('p', { class: 'text-xs text-muted', text: extra }) : null]);
      }
      return el('div', { class: 'space-y-3' }, [
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-4 gap-2' }, [
          step('Assigned', t.createdAt, 'by ' + (t.assignedBy.name || '—')),
          step('Started', t.startedAt, t.waitSeconds !== null ? 'waited ' + fmtDurationShort(t.waitSeconds) + ' in queue' : null),
          step('Completed', t.completedAt, t.onTime === null ? null : t.onTime ? 'before the due date' : 'after the due date (' + fmtDate(t.dueDate) + ')'),
          el('div', { class: 'tx-muted-box' }, [el('p', { class: 'text-xs text-muted', text: 'Time spent working' }), el('p', { class: 'text-lg font-bold tx-timer', text: fmtDuration(t.elapsedSeconds) }), el('p', { class: 'text-xs text-muted', text: 'timer time, pauses excluded' })])
        ]),
        t.description ? el('div', {}, [el('p', { class: 'text-xs text-muted', text: 'Task description' }), el('p', { class: 'text-sm whitespace-pre-wrap', text: t.description })]) : null,
        el('div', {}, [el('p', { class: 'text-xs text-muted', text: 'Completion note' }), el('p', { class: 'text-sm whitespace-pre-wrap', text: t.completionNote || 'No note was added.' })]),
        t.customer ? el('p', { class: 'text-sm', text: 'Customer: ' + t.customer.companyName }) : null
      ]);
    }

    load();
    return load;
  }

  window.Tasks = { mountPage: mount };
})();
