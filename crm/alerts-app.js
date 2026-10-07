/* ══════════════════════════════════════════════════════════════════════
   Alerts & reminders — one page for everything that needs attention.

   Sources:
     Follow-ups     GET /api/meetings/alerts (+ today's follow-ups); mark read
     Appointments   GET /api/appointments/reminders; mark read
     Tasks, Trials, Leave, Price requests, Breaks & location
                    GET /api/alerts-feed/history?days=N (AlertFeedController)

   Feed items count as "new" until you've seen them — the same seen-list
   crm-global.js uses for the sound alerts, so an alert you dismissed as a
   toast isn't new here either. "Mark all as read" clears them.

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var SEEN_KEY = 'crm_alert_seen';

  var GROUPS = [
    ['all', 'All'],
    ['followups', 'Follow-ups'],
    ['appointments', 'Appointments'],
    ['tasks', 'Tasks'],
    ['trials', 'Trials'],
    ['leave', 'Leave'],
    ['prices', 'Price requests'],
    ['stock', 'Stock'],
    ['chat', 'Chat'],
    ['breaks', 'Attendance, breaks & location']
  ];
  var TYPE_GROUP = {
    TASK_ASSIGNED: 'tasks', TASK_COMPLETED: 'tasks',
    TRIAL_REQUESTED: 'trials', TRIAL_DECIDED: 'trials', TRIAL_COMPLETED: 'trials', TRIAL_PDF: 'trials',
    LEAVE_REQUESTED: 'leave', LEAVE_DECIDED: 'leave',
    PRICE_REQUEST_NEW: 'prices', PRICE_REQUEST_ANSWERED: 'prices', PRICE_REQUEST_REMINDER: 'prices',
    STOCK_LOW: 'stock', STOCK_CHECK: 'stock', RESTOCK_NEEDED: 'stock', CHAT_MESSAGE: 'chat',
    LATE_PUNCH_REQUEST: 'breaks', LATE_PUNCH_DECIDED: 'breaks', PUNCH_REMINDER: 'breaks',
    BREAK_STARTED: 'breaks', STATIONARY: 'breaks', LOCATION_OFF: 'breaks'
  };
  var GROUP_STYLE = {
    followups: ['#0891b2', '↻'], appointments: ['#4f46e5', '📅'], tasks: ['#2563eb', '📋'], trials: ['#7c3aed', '🧪'],
    leave: ['#db2777', '🌴'], prices: ['#d97706', '₹'], stock: ['#ea580c', '📦'], chat: ['#0284c7', '💬'], breaks: ['#0d9488', '☕']
  };

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function role() { try { return (JSON.parse(localStorage.getItem('crm_user') || 'null') || {}).role || ''; } catch (e) { return ''; } }
  function api(method, path) {
    return fetch(API + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + (token() || ''), 'Content-Type': 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401) { location.href = '/login/'; }
          if (!r.ok) throw new Error((j && j.message) || 'Request failed');
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
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function when(at) {
    var d = new Date(String(at || '').replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400 && d.getDate() === new Date().getDate()) return 'today ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function dayLabel(at) {
    var d = new Date(String(at || '').replace(' ', 'T'));
    if (isNaN(d.getTime())) return 'Earlier';
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var x = new Date(d); x.setHours(0, 0, 0, 0);
    var diff = Math.round((t - x) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  }
  function seenList() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; } }
  function markSeen(ids) {
    var s = seenList();
    ids.forEach(function (id) { if (s.indexOf(id) === -1) s.push(id); });
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-600))); } catch (e) {}
  }

  function injectCss() {
    if (document.getElementById('alerts-extra-css')) return;
    var st = document.createElement('style');
    st.id = 'alerts-extra-css';
    st.textContent = [
      '.al-tabs{display:flex;gap:.35rem;flex-wrap:wrap}',
      '.al-tab{display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .8rem;border-radius:9999px;border:1px solid #e2e8f0;background:#fff;font-size:.82rem;font-weight:500;color:#475569;cursor:pointer}',
      '.dark .al-tab{background:#0f172a;border-color:#334155;color:#cbd5e1}',
      '.al-tab-on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}.dark .al-tab-on{background:#1e3a5f;color:#fff}',
      '.al-n{min-width:1.2rem;height:1.2rem;padding:0 .35rem;border-radius:9999px;background:#ef4444;color:#fff;font-size:.68rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center}',
      '.al-n0{background:#e2e8f0;color:#475569}.al-tab-on .al-n0{background:rgba(255,255,255,.25);color:#fff}',
      '.al-day{font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin:1.1rem 0 .4rem}',
      '.al-item{display:flex;gap:.8rem;align-items:flex-start;padding:.8rem 1rem;border-top:1px solid #f1f5f9;background:#fff}',
      '.dark .al-item{background:#0f172a;border-color:#1e293b}',
      '.al-item:first-child{border-top:0}',
      '.al-new{background:#f8fbff}.dark .al-new{background:#0b1a33}',
      '.al-ic{width:2.1rem;height:2.1rem;border-radius:.6rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;',
      '  background:color-mix(in srgb,var(--c) 13%,#fff);color:var(--c)}',
      '.al-dot{width:.5rem;height:.5rem;border-radius:9999px;background:#2563eb;display:inline-block;margin-left:.35rem;vertical-align:middle}',
      '.al-title{font-size:.9rem;font-weight:600;color:#0f172a}.dark .al-title{color:#f1f5f9}',
      '.al-body{font-size:.84rem;color:#475569;margin-top:.1rem}.dark .al-body{color:#cbd5e1}',
      '.al-meta{font-size:.75rem;color:#94a3b8;margin-top:.25rem;display:flex;gap:.8rem;flex-wrap:wrap;align-items:center}',
      '.al-link{font-size:.78rem;font-weight:600;color:#1e3a5f;background:none;border:0;padding:0;cursor:pointer;text-decoration:none}.dark .al-link{color:#93c5fd}',
      '.al-link:hover{text-decoration:underline}',
      '.al-empty{padding:2.5rem 1rem;text-align:center;color:#64748b}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function mount(root) {
    injectCss();
    var group = (location.hash || '').replace('#', '') || 'all';
    var days = 14;
    var items = [], loaded = false, err = '';

    var head = el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' });
    var tabs = el('div', { class: 'al-tabs' });
    var body = el('div');
    root.appendChild(el('div', { class: 'space-y-4' }, [head, tabs, body]));

    function load() {
      var jobs = [
        api('GET', '/meetings/alerts').then(function (r) {
          return ((r.data && r.data.alerts) || []).map(function (a) {
            var c = (a.meeting && a.meeting.customer && a.meeting.customer.companyName) || 'a customer';
            var overdue = /OVERDUE/i.test(a.alertType || '');
            return {
              id: 'fu-' + a.id, rawId: a.id, kind: 'followup', group: 'followups', isNew: !a.isRead, at: a.createdAt,
              title: overdue ? 'Follow-up overdue' : 'Follow-up reminder',
              body: 'Follow up with ' + c + (a.meeting && a.meeting.nextFollowUp ? ' — due ' + when(a.meeting.nextFollowUp) : ''),
              link: a.meeting && a.meeting.id ? '/meetings/?id=' + encodeURIComponent(a.meeting.id) : '/meetings/'
            };
          });
        }).catch(function () { return []; }),
        api('GET', '/meetings/today-followups').then(function (r) {
          return ((r.data && r.data.meetings) || []).map(function (m) {
            return {
              id: 'fu-today-' + m.id, kind: 'today', group: 'followups', isNew: false, at: m.nextFollowUp,
              title: 'Follow-up due today', body: ((m.customer && m.customer.companyName) || 'Customer') + (m.user && m.user.name ? ' · ' + m.user.name : ''),
              link: '/meetings/?id=' + encodeURIComponent(m.id)
            };
          });
        }).catch(function () { return []; }),
        api('GET', '/appointments/reminders').then(function (r) {
          return ((r.data && r.data.alerts) || []).map(function (a) {
            var assigned = a.alertType === 'TASK_ASSIGNED';
            return {
              id: 'ap-' + a.id, rawId: a.id, kind: 'appointment', group: 'appointments', isNew: !Number(a.isRead), at: a.createdAt,
              title: assigned ? 'Appointment assigned to you' : 'Appointment tomorrow',
              body: (a.title || 'Visit') + (a.companyName ? ' · ' + a.companyName : '') + ' — ' + a.appointmentDate + (a.appointmentTime ? ' ' + a.appointmentTime : ''),
              link: '/appointments/?date=' + encodeURIComponent(a.appointmentDate)
            };
          });
        }).catch(function () { return []; }),
        api('GET', '/alerts-feed/history?days=' + days).then(function (r) {
          var seen = seenList();
          return ((r.data && r.data.events) || []).map(function (e) {
            return { id: e.id, kind: 'feed', group: TYPE_GROUP[e.type] || 'tasks', isNew: seen.indexOf(e.id) === -1, at: e.at, title: e.title, body: e.body, link: e.link };
          });
        })
      ];
      Promise.all(jobs).then(function (parts) {
        items = [].concat.apply([], parts).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
        loaded = true; err = '';
        render();
      }).catch(function (e) { err = e.message; loaded = true; render(); });
    }

    function readOne(it) {
      it.isNew = false;
      if (it.kind === 'followup') api('PATCH', '/meetings/alerts/' + encodeURIComponent(it.rawId) + '/read').catch(function () {});
      else if (it.kind === 'appointment') api('PATCH', '/appointments/alerts/' + encodeURIComponent(it.rawId) + '/read').catch(function () {});
      else if (it.kind === 'feed') markSeen([it.id]);
    }
    function readAll(list) { list.filter(function (x) { return x.isNew; }).forEach(readOne); render(); }

    function render() {
      head.innerHTML = '';
      var shown = items.filter(function (x) { return group === 'all' || x.group === group; });
      var newCount = shown.filter(function (x) { return x.isNew; }).length;
      var daysSel = el('select', { class: 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm', 'aria-label': 'Period' },
        [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [60, 'Last 60 days']].map(function (o) { return el('option', { value: String(o[0]), text: o[1] }); }));
      daysSel.value = String(days);
      daysSel.addEventListener('change', function () { days = Number(daysSel.value); load(); });
      head.appendChild(el('div', {}, [
        el('h1', { class: 'page-title', text: 'Alerts & reminders' }),
        el('p', { class: 'text-sm text-muted mt-1', text: 'Follow-ups, appointments, tasks, trials, leave and price requests in one place. New alerts also play a sound on every page.' })
      ]));
      head.appendChild(el('div', { class: 'flex items-center gap-2' }, [
        daysSel,
        el('button', { class: 'btn-secondary', text: 'Mark all as read' + (newCount ? ' (' + newCount + ')' : ''), onclick: function () { readAll(shown); } })
      ]));

      tabs.innerHTML = '';
      GROUPS.forEach(function (g) {
        if (g[0] === 'breaks' && role() !== 'SUPER_ADMIN') return;
        var list = items.filter(function (x) { return g[0] === 'all' || x.group === g[0]; });
        var n = list.filter(function (x) { return x.isNew; }).length;
        tabs.appendChild(el('button', {
          class: 'al-tab' + (group === g[0] ? ' al-tab-on' : ''),
          onclick: function () { group = g[0]; history.replaceState(null, '', g[0] === 'all' ? location.pathname : '#' + g[0]); render(); }
        }, [g[1], el('span', { class: 'al-n' + (n ? '' : ' al-n0'), text: String(n || list.length) })]));
      });

      body.innerHTML = '';
      if (!loaded) { body.appendChild(el('div', { class: 'card al-empty', text: 'Loading…' })); return; }
      if (err) body.appendChild(el('div', { class: 'card p-4 text-sm text-red-600', text: err }));
      if (!shown.length) {
        body.appendChild(el('div', { class: 'card al-empty' }, [
          el('p', { class: 'text-lg font-semibold text-slate-900', text: 'All caught up!' }),
          el('p', { class: 'text-sm mt-1', text: 'Nothing here for the selected period.' })
        ]));
        return;
      }
      var lastDay = null, card = null;
      shown.forEach(function (it) {
        var d = dayLabel(it.at);
        if (d !== lastDay) {
          body.appendChild(el('p', { class: 'al-day', text: d }));
          card = el('div', { class: 'card overflow-hidden' });
          body.appendChild(card);
          lastDay = d;
        }
        var st = GROUP_STYLE[it.group] || ['#1e3a5f', '🔔'];
        var row = el('div', { class: 'al-item' + (it.isNew ? ' al-new' : '') }, [
          el('div', { class: 'al-ic', style: '--c:' + st[0], text: st[1] }),
          el('div', { class: 'flex-1 min-w-0' }, [
            el('p', { class: 'al-title' }, [it.title, it.isNew ? el('span', { class: 'al-dot', title: 'New' }) : null]),
            el('p', { class: 'al-body', text: it.body }),
            el('div', { class: 'al-meta' }, [
              el('span', { text: when(it.at) }),
              it.link ? el('a', { class: 'al-link', href: it.link, text: 'Open →', onclick: function () { readOne(it); } }) : null,
              it.isNew && it.kind !== 'today' ? el('button', { class: 'al-link', text: 'Mark as read', onclick: function () { readOne(it); render(); } }) : null
            ])
          ])
        ]);
        card.appendChild(row);
      });
    }

    window.addEventListener('crm-alert', function () { load(); });
    render();
    load();
  }

  window.AlertsPage = { mountPage: mount };
})();
