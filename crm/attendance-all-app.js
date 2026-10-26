/* ══════════════════════════════════════════════════════════════════════
   Attendance → "All employees" tab, for the compiled CRM build.

   Adds a tab bar above the "Attendance history" card on /attendance/ and
   swaps that card for a date-grouped, every-employee view. Admin roles
   only (SUPER_ADMIN / ADMIN / MANAGER) — everyone else sees the page
   exactly as before.

   Backed by GET /api/attendance/all, which already existed.

   The attendance page is React-rendered and minified, so this attaches at
   the DOM level rather than patching the bundle: it waits for the history
   card to appear, injects alongside it, and re-injects if React remounts
   the page during a client-side navigation.

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  // Matches require_admin() in the API (ADMIN tier or higher) — the
  // actual enforced boundary behind this tab's endpoint. MANAGER is
  // intentionally excluded: is_admin_tier() elsewhere in the API is
  // broader, but this specific endpoint is require_admin()-gated.
  var ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];
  var MARK = 'data-attendance-all';

  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

  var STATUS_CLASS = {
    PRESENT: 'badge-green', ABSENT: 'badge-red',
    HALF_DAY: 'badge-yellow', PENDING: 'badge-gray'
  };

  function isAdmin() {
    try {
      var u = JSON.parse(localStorage.getItem('crm_user') || 'null');
      return !!u && ADMIN_ROLES.indexOf(u.role) !== -1;
    } catch (e) { return false; }
  }

  function api(path) {
    var t = '';
    try { t = localStorage.getItem('crm_token') || ''; } catch (e) {}
    return fetch(API + '/api' + path, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.message) || 'Request failed');
        return j;
      });
    });
  }

  function apiSend(method, path, body) {
    var t = '';
    try { t = localStorage.getItem('crm_token') || ''; } catch (e) {}
    return fetch(API + '/api' + path, {
      method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed');
        return j;
      });
    });
  }
  function todayIso() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function toast(msg, err) {
    document.querySelectorAll('.am-toast').forEach(function (x) { x.remove(); });
    var t = el('div', { class: 'am-toast', text: msg });
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483600;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;max-width:90vw;background:' + (err ? '#b91c1c' : '#0f766e');
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 4500);
  }
  var DAY_STATE = {
    PRESENT: ['Present', 'badge-green'], NOT_MARKED: ['Not punched in', 'badge-gray'], ABSENT: ['Absent', 'badge-red'],
    ON_LEAVE: ['On leave', 'badge-yellow'], HALF_DAY: ['Half day', 'badge-yellow'], LEAVE_PENDING: ['Leave pending', 'badge-gray']
  };
  var KINDS = [['ABSENT', 'Absent (loss of pay)'], ['CASUAL', 'Casual leave'], ['SICK', 'Sick leave'], ['PERSONAL', 'Personal leave'], ['HALF_DAY', 'Half day']];

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
    var s = /[Zz]|[+-]\d\d:?\d\d$/.test(d) ? d : String(d).replace(' ', 'T');
    var dt = new Date(s);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN',
      { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // The API hands back checkInFormatted / checkOutFormatted already; this
  // is only the fallback. No "Z" is appended — the backend returns IST,
  // matching the fix already in the attendance bundle.
  function fmtTime(t) {
    if (!t) return '—';
    var s = /[Zz]|[+-]\d\d:?\d\d$/.test(t) ? t : String(t).replace(' ', 'T');
    var dt = new Date(s);
    if (isNaN(dt.getTime())) return t;
    return dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  // Punch location → Google Maps link (coordinates in the tooltip).
  function mapCell(lat, lng) {
    if (lat == null || lng == null) return el('span', { class: 'text-muted', text: '—' });
    var q = Number(lat).toFixed(6) + ',' + Number(lng).toFixed(6);
    return el('a', { href: 'https://www.google.com/maps?q=' + q, target: '_blank', rel: 'noopener', title: q,
      class: 'text-primary font-medium hover:underline whitespace-nowrap', text: '📍 Map' });
  }

  // Punch photos need the auth header, so they are fetched as blobs.
  var photoCache = {};
  function showPhoto(id, kind, who) {
    var key = id + ':' + kind, t = '';
    try { t = localStorage.getItem('crm_token') || ''; } catch (e) {}
    var p = photoCache[key] || (photoCache[key] = fetch(API + '/api/attendance/' + encodeURIComponent(id) + '/photo' + (kind === 'out' ? '?kind=out' : ''),
      { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { if (!r.ok) throw new Error('No photo'); return r.blob(); })
      .then(function (b) { return URL.createObjectURL(b); }));
    p.then(function (u) {
      var m = el('div', { style: 'position:fixed;inset:0;background:rgba(15,23,42,.75);z-index:2147483500;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem;gap:.5rem;cursor:zoom-out' }, [
        el('img', { src: u, alt: 'Punch-' + kind + ' photo', style: 'max-width:100%;max-height:85vh;border-radius:.6rem' }),
        el('div', { style: 'color:#fff;font-size:.9rem', text: who + ' · punch ' + kind })
      ]);
      m.addEventListener('click', function () { m.remove(); });
      document.body.appendChild(m);
    }).catch(function () { delete photoCache[key]; alert('Photo not available'); });
  }
  function photoBtns(r) {
    var who = (r.user && r.user.name) || '';
    var b = function (kind) {
      return el('button', { type: 'button', class: 'btn-secondary', style: 'padding:.15rem .55rem;font-size:.75rem',
        text: kind === 'in' ? 'In' : 'Out', onclick: function () { showPhoto(r.attendanceId, kind, who); } });
    };
    var kids = [r.checkInPhoto ? b('in') : null, r.checkOutPhoto ? b('out') : null];
    if (!kids[0] && !kids[1]) return el('span', { class: 'text-muted', text: '—' });
    return el('div', { class: 'flex gap-1' }, kids);
  }

  var selectCls =
    'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
    'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary';

  // ── locate the React-rendered history card ──────────────────────────
  function findHistoryCard() {
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var s = cards[i].querySelector('span.text-sm.font-semibold');
      if (s && s.textContent.trim() === 'Attendance history') return cards[i];
    }
    return null;
  }

  // ── build and mount ─────────────────────────────────────────────────
  function mount(historyCard) {
    var now = new Date();
    var month = now.getMonth() + 1, year = now.getFullYear();
    var status = '';
    var dept = '';
    var tab = 'mine';
    var allDepartments = [];

    var wrap = el('div', {});
    wrap.setAttribute(MARK, '1');

    var tabs = el('div', { class: 'flex gap-1 border-b border-slate-200 dark:border-slate-700 mb-4' });
    var filters = el('div', { class: 'flex flex-wrap gap-2 mb-4 hidden' });
    var body = el('div', { class: 'hidden' });
    var dayBox = el('div', { class: 'card mb-4 hidden', id: 'att-day' });
    var sumBox = el('div', { class: 'card mb-4 hidden overflow-hidden', id: 'att-sum' });
    var dayDate = todayIso();

    wrap.appendChild(tabs);
    wrap.appendChild(sumBox);
    wrap.appendChild(dayBox);
    wrap.appendChild(filters);
    wrap.appendChild(body);

    historyCard.parentNode.insertBefore(wrap, historyCard);

    function renderTabs() {
      tabs.innerHTML = '';
      [['mine', 'My attendance'], ['all', 'All employees']].forEach(function (t) {
        tabs.appendChild(el('button', {
          class: 'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
            (tab === t[0]
              ? 'border-primary text-primary dark:text-primary-300'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'),
          text: t[1],
          onclick: function () { if (tab !== t[0]) { tab = t[0]; apply(); } }
        }));
      });
    }

    function renderFilters() {
      filters.innerHTML = '';

      var mSel = el('select', { class: selectCls });
      MONTHS.forEach(function (m, i) { mSel.appendChild(el('option', { value: String(i + 1), text: m })); });
      mSel.value = String(month);
      mSel.addEventListener('change', function () { month = Number(mSel.value); load(); });

      var ySel = el('select', { class: selectCls });
      for (var y = now.getFullYear(); y > now.getFullYear() - 4; y--) {
        ySel.appendChild(el('option', { value: String(y), text: String(y) }));
      }
      ySel.value = String(year);
      ySel.addEventListener('change', function () { year = Number(ySel.value); load(); });

      var sSel = el('select', { class: selectCls });
      [['', 'All statuses'], ['PRESENT', 'Present'], ['ABSENT', 'Absent'],
       ['HALF_DAY', 'Half day'], ['PENDING', 'Pending']].forEach(function (o) {
        sSel.appendChild(el('option', { value: o[0], text: o[1] }));
      });
      sSel.value = status;
      sSel.addEventListener('change', function () { status = sSel.value; load(); });

      var dSel = el('select', { class: selectCls });
      dSel.appendChild(el('option', { value: '', text: 'All departments' }));
      allDepartments.forEach(function (d) { dSel.appendChild(el('option', { value: d, text: d })); });
      dSel.value = dept;
      dSel.addEventListener('change', function () { dept = dSel.value; load(); });

      filters.appendChild(mSel);
      filters.appendChild(ySel);
      filters.appendChild(sSel);
      if (allDepartments.length) filters.appendChild(dSel);

      // The export endpoint filters by date range only — status and
      // department below narrow the on-screen view, not the file.
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var lastDay = new Date(year, month, 0).getDate();
      var q = '?format=excel' +
              '&from=' + year + '-' + pad(month) + '-01' +
              '&to=' + year + '-' + pad(month) + '-' + pad(lastDay);
      filters.appendChild(el('a', {
        class: 'btn-secondary ml-auto',
        href: API + '/api/attendance/export' + q,
        title: 'Exports the selected month (status/department filters not applied)',
        text: 'Export'
      }));
    }

    function apply() {
      renderTabs();
      var showAll = tab === 'all';
      historyCard.style.display = showAll ? 'none' : '';
      filters.classList.toggle('hidden', !showAll);
      body.classList.toggle('hidden', !showAll);
      dayBox.classList.toggle('hidden', !showAll);
      sumBox.classList.toggle('hidden', !showAll);
      if (showAll) { load(); loadDay(); }
    }

    /* Engineer-wise totals for the month: present, half days, absent, leave, not marked, hours. */
    function loadSummary() {
      sumBox.innerHTML = '';
      sumBox.appendChild(el('div', { class: 'px-5 py-3 text-sm text-muted', text: 'Loading engineer-wise totals…' }));
      api('/attendance/summary?month=' + month + '&year=' + year).then(function (res) {
        var d = res.data, t = d.totals;
        sumBox.innerHTML = '';
        var num = function (v) { return v ? String(Math.round(v * 10) / 10) : '—'; };
        var cols = [['Employee', null], ['Present', 'present'], ['Half days', 'halfDays'], ['Absent', 'absent'], ['On leave', 'leave'], ['Not marked', 'notMarked'], ['Total hours', 'hours'], ['Avg / day', 'avgHours']];
        var cell = function (k, x, bold) {
          var v = k === 'hours' || k === 'avgHours' ? (x[k] ? (Math.round(x[k] * 10) / 10) + 'h' : '—') : num(x[k]);
          var col = k === 'absent' && x[k] ? 'color:#b91c1c;' : k === 'notMarked' && x[k] ? 'color:#b45309;' : k === 'present' ? 'color:#15803d;' : '';
          return el('td', { class: 'px-4 py-2 text-right whitespace-nowrap' + (bold ? ' font-bold' : ''), style: col, text: v });
        };
        var tb = el('tbody', {}, d.employees.map(function (x) {
          return el('tr', { class: 'table-row', 'data-att-emp': x.id }, [el('td', { class: 'px-4 py-2 font-medium whitespace-nowrap' }, [x.name, el('span', { class: 'text-xs text-muted ml-2', text: String(x.role || '').replace(/_/g, ' ').toLowerCase() })])]
            .concat(cols.slice(1).map(function (c) { return cell(c[1], x); })));
        }).concat([el('tr', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('td', { class: 'px-4 py-2 font-bold', text: 'All employees' })]
          .concat(cols.slice(1).map(function (c) { return c[1] === 'avgHours' ? el('td', { class: 'px-4 py-2' }) : cell(c[1], t, true); })))]));
        sumBox.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2' }, [
          el('span', { class: 'text-sm font-semibold text-slate-900 dark:text-slate-100', text: '👥 Engineer-wise total — ' + MONTHS[month - 1] + ' ' + year }),
          el('span', { class: 'text-xs text-muted', text: d.workingDays + ' working days so far (Mon–Sat) · not marked = no punch-in, leave or absent' })
        ]));
        sumBox.appendChild(el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-sm', id: 'att-sum-table' }, [
          el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, cols.map(function (c, i) { return el('th', { class: 'table-head px-4 py-2 whitespace-nowrap ' + (i ? 'text-right' : 'text-left'), text: c[0] }); }))]), tb])]));
      }).catch(function (e) { sumBox.innerHTML = ''; sumBox.appendChild(el('div', { class: 'px-5 py-3 text-sm text-muted', text: e.message })); });
    }

    /* Mark attendance for a day: everyone with today's state; Admin / Super Admin mark
       absent or leave (saved as an approved leave, so leave page + payslip count it). */
    function loadDay() {
      dayBox.innerHTML = '';
      var dIn = el('input', { type: 'date', class: selectCls, id: 'att-day-date', value: dayDate });
      dIn.addEventListener('change', function () { if (dIn.value) { dayDate = dIn.value; loadDay(); } });
      var head = el('div', { class: 'px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap gap-3 items-center' }, [
        el('span', { class: 'text-sm font-semibold text-slate-900 dark:text-slate-100', text: 'Mark attendance — absent / leave' }), dIn,
        el('span', { class: 'text-xs text-muted', id: 'att-day-counts', text: 'Loading…' })]);
      var list = el('div', { class: 'overflow-x-auto' });
      dayBox.appendChild(head); dayBox.appendChild(list);
      api('/attendance/day?date=' + dayDate).then(function (res) {
        var d = res.data, c = d.counts || {};
        document.getElementById('att-day-counts').textContent = [(c.PRESENT || 0) + ' present', (c.ABSENT || 0) + ' absent', ((c.ON_LEAVE || 0) + (c.HALF_DAY || 0)) + ' on leave', (c.NOT_MARKED || 0) + ' not punched in'].join(' · ');
        var tb = el('tbody');
        d.rows.forEach(function (r) {
          var base = r.state.split('+')[0], st = DAY_STATE[base] || [base, 'badge-gray'];
          var info = r.leave ? r.leave.label + (r.leave.days > 1 ? ' · ' + r.leave.days + ' days (' + fmtDate(r.leave.from) + ' – ' + fmtDate(r.leave.to) + ')' : '') + (r.leave.lop ? ' · loss of pay' : '') + (r.leave.by ? ' · by ' + r.leave.by : '')
            : r.attendance ? 'In ' + (r.attendance.checkIn || '—') + (r.attendance.checkOut ? ' · Out ' + r.attendance.checkOut : '') : '';
          var acts = el('div', { class: 'flex gap-1 justify-end' });
          if (!r.leave && base !== 'PRESENT') {
            acts.appendChild(el('button', { class: 'btn-secondary text-xs', style: 'color:#b91c1c', 'data-absent': r.user.id, text: 'Mark absent', onclick: function () { markDialog(r, 'ABSENT'); } }));
            acts.appendChild(el('button', { class: 'btn-secondary text-xs', 'data-leave': r.user.id, text: 'Leave…', onclick: function () { markDialog(r, 'CASUAL'); } }));
          } else if (!r.leave && base === 'PRESENT') {
            acts.appendChild(el('button', { class: 'btn-secondary text-xs', 'data-leave': r.user.id, text: 'Half day…', onclick: function () { markDialog(r, 'HALF_DAY'); } }));
          }
          if (r.leave && r.leave.marked) acts.appendChild(el('button', { class: 'btn-secondary text-xs', 'data-undo': r.user.id, text: 'Undo', onclick: function () {
            if (!confirm('Remove "' + r.leave.label + '" for ' + r.user.name + '?')) return;
            apiSend('DELETE', '/attendance/mark/' + encodeURIComponent(r.leave.id)).then(function () { toast('Removed'); loadDay(); load(); }).catch(function (e) { toast(e.message, true); });
          } }));
          if (r.leave && !r.leave.marked && r.leave.status === 'PENDING') acts.appendChild(el('a', { class: 'btn-secondary text-xs', href: '/leaves/', text: 'Open leave' }));
          tb.appendChild(el('tr', { class: 'table-row', 'data-row': r.user.id }, [
            el('td', { class: 'px-4 py-2 font-medium whitespace-nowrap', text: r.user.name }),
            el('td', { class: 'px-4 py-2 text-muted whitespace-nowrap', text: String(r.user.role || '').replace(/_/g, ' ').toLowerCase() + (r.user.department ? ' · ' + r.user.department : '') }),
            el('td', { class: 'px-4 py-2' }, [el('span', { class: 'badge ' + st[1], text: st[0] + (/PUNCHED/.test(r.state) ? ' (punched in)' : '') })]),
            el('td', { class: 'px-4 py-2 text-xs text-muted', text: info }),
            el('td', { class: 'px-4 py-2' }, [acts])]));
        });
        list.appendChild(el('table', { class: 'w-full text-sm' }, [el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, ['Employee', 'Role', 'Status', 'Details', ''].map(function (h) { return el('th', { class: 'table-head text-left px-4 py-2 whitespace-nowrap', text: h }); }))]), tb]));
      }).catch(function (e) { document.getElementById('att-day-counts').textContent = e.message; });
    }

    function markDialog(r, kind) {
      document.querySelectorAll('.am-modal').forEach(function (m) { m.remove(); });
      var card = el('div', { class: 'card p-5', style: 'max-width:440px;width:100%' });
      var m = el('div', { class: 'am-modal' }, [card]);
      m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:10vh 1rem';
      m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
      var k = el('select', { class: selectCls + ' w-full', id: 'am-kind' }, KINDS.map(function (x) { return el('option', { value: x[0], text: x[1] }); }));
      k.value = kind;
      var dt = el('input', { type: 'date', class: selectCls + ' w-full', id: 'am-date', value: dayDate });
      var days = el('input', { type: 'number', min: '1', max: '60', step: '1', class: selectCls + ' w-full', id: 'am-days', value: '1' });
      var lop = el('input', { type: 'checkbox', id: 'am-lop' });
      var reason = el('input', { class: selectCls + ' w-full', id: 'am-reason', placeholder: kind === 'ABSENT' ? 'e.g. Did not come, not informed' : 'e.g. Fever, informed by phone' });
      var daysRow = el('label', { class: 'block text-xs text-muted mb-2' }, ['Number of days', days]);
      var lopRow = el('label', { class: 'flex items-center gap-2 text-xs text-muted mb-2' }, [lop, 'Loss of pay']);
      function sync() { daysRow.style.display = k.value === 'HALF_DAY' ? 'none' : ''; lopRow.style.display = k.value === 'ABSENT' ? 'none' : ''; }
      k.addEventListener('change', sync); sync();
      var err = el('div', { class: 'text-xs', style: 'color:#b91c1c;min-height:1rem' });
      var save = el('button', { class: 'btn-primary', id: 'am-save', text: 'Save' });
      save.onclick = function () {
        save.disabled = true; err.textContent = '';
        apiSend('POST', '/attendance/mark', { userId: r.user.id, date: dt.value, kind: k.value, days: days.value, lop: lop.checked, reason: reason.value.trim() })
          .then(function (j) { m.remove(); toast(j.message); loadDay(); load(); })
          .catch(function (e) { err.textContent = e.message; save.disabled = false; });
      };
      card.appendChild(el('h3', { class: 'text-base font-semibold mb-3', text: r.user.name }));
      [el('label', { class: 'block text-xs text-muted mb-2' }, ['Mark as', k]), el('label', { class: 'block text-xs text-muted mb-2' }, ['From date', dt]), daysRow, lopRow,
       el('label', { class: 'block text-xs text-muted mb-2' }, ['Reason (optional)', reason]), err,
       el('div', { class: 'flex gap-2 justify-end mt-3' }, [el('button', { class: 'btn-secondary', text: 'Cancel', onclick: function () { m.remove(); } }), save])].forEach(function (x) { card.appendChild(x); });
      document.body.appendChild(m);
    }

    function setMsg(msg) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: msg }));
    }

    function load() {
      setMsg('Loading…');
      loadSummary();
      var q = '?month=' + month + '&year=' + year +
              (status ? '&status=' + encodeURIComponent(status) : '') +
              (dept ? '&department=' + encodeURIComponent(dept) : '');

      api('/attendance/all' + q).then(function (res) {
        var days = (res.data && res.data.days) || [];

        // Department list comes from the data itself — no extra endpoint.
        if (!dept) {
          var seen = {};
          days.forEach(function (d) {
            d.records.forEach(function (r) {
              var x = r.user && r.user.department;
              if (x) seen[x] = 1;
            });
          });
          var found = Object.keys(seen).sort();
          if (found.join('|') !== allDepartments.join('|')) {
            allDepartments = found;
            renderFilters();
          }
        }

        if (!days.length) {
          setMsg('No attendance records for ' + MONTHS[month - 1] + ' ' + year);
          return;
        }

        body.innerHTML = '';
        var out = el('div', { class: 'space-y-4' });

        days.forEach(function (day) {
          var present = day.records.filter(function (r) { return r.status === 'PRESENT'; }).length;
          var heads = ['Employee', 'Department', 'Check-in', 'In location', 'Check-out', 'Out location', 'Photos', 'Hours', 'Status'];
          var tbody = el('tbody');

          day.records.forEach(function (r) {
            var hrs = r.workingHours != null && r.workingHours !== ''
              ? Number(r.workingHours).toFixed(1) + 'h' : '—';
            tbody.appendChild(el('tr', { class: 'table-row' }, [
              el('td', { class: 'px-4 py-2.5 font-medium whitespace-nowrap',
                         text: (r.user && r.user.name) || '—' }),
              el('td', { class: 'px-4 py-2.5 text-muted', text: (r.user && r.user.department) || '—' }),
              el('td', { class: 'px-4 py-2.5', text: r.checkInFormatted || fmtTime(r.checkIn) }),
              el('td', { class: 'px-4 py-2.5' }, [mapCell(r.checkInLat, r.checkInLng)]),
              el('td', { class: 'px-4 py-2.5', text: r.checkOutFormatted || fmtTime(r.checkOut) }),
              el('td', { class: 'px-4 py-2.5' }, [r.checkOut ? mapCell(r.checkOutLat, r.checkOutLng) : el('span', { class: 'text-muted', text: '—' })]),
              el('td', { class: 'px-4 py-2.5' }, [photoBtns(r)]),
              el('td', { class: 'px-4 py-2.5', text: hrs }),
              el('td', { class: 'px-4 py-2.5' }, [
                el('span', {
                  class: 'badge ' + (STATUS_CLASS[r.status] || 'badge-gray'),
                  text: r.status || '—'
                })
              ])
            ]));
          });

          out.appendChild(el('div', { class: 'card overflow-hidden' }, [
            el('div', {
              class: 'px-5 py-3 border-b border-slate-200 dark:border-slate-700 ' +
                     'flex items-center justify-between'
            }, [
              el('span', {
                class: 'text-sm font-semibold text-slate-900 dark:text-slate-100',
                text: fmtDate(day.date)
              }),
              el('span', {
                class: 'text-xs text-muted',
                text: present + ' of ' + day.records.length + ' present'
              })
            ]),
            el('div', { class: 'overflow-x-auto' }, [
              el('table', { class: 'w-full text-sm' }, [
                el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [
                  el('tr', {}, heads.map(function (h) {
                    return el('th', {
                      class: 'table-head text-left px-4 py-2.5 whitespace-nowrap', text: h
                    });
                  }))
                ]),
                tbody
              ])
            ])
          ]));
        });

        body.appendChild(out);
      }).catch(function (e) {
        setMsg(e.message || 'Could not load attendance.');
      });
    }

    renderFilters();
    apply();
  }

  // ── keep it attached across client-side navigation ──────────────────
  function tryMount() {
    if (!/^\/attendance\/?$/.test(location.pathname)) return;
    if (!isAdmin()) return;
    if (document.querySelector('[' + MARK + ']')) return;   // already there
    var card = findHistoryCard();
    if (card) mount(card);
  }

  function boot() {
    tryMount();

    // React renders after hydration, and remounts this page on SPA
    // navigation — so watch instead of firing once.
    var pending = null;
    var obs = new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; tryMount(); }, 120);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Also re-check on history changes, for the case where the DOM
    // settles before the observer is wired up.
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      if (typeof orig !== 'function') return;
      history[m] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(tryMount, 150);
        return r;
      };
    });
    window.addEventListener('popstate', function () { setTimeout(tryMount, 150); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.AttendanceAll = { tryMount: tryMount };
})();
