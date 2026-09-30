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

    wrap.appendChild(tabs);
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
      if (showAll) load();
    }

    function setMsg(msg) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: msg }));
    }

    function load() {
      setMsg('Loading…');
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
          var heads = ['Employee', 'Department', 'Check-in', 'Check-out', 'Hours', 'Status'];
          var tbody = el('tbody');

          day.records.forEach(function (r) {
            var hrs = r.workingHours != null && r.workingHours !== ''
              ? Number(r.workingHours).toFixed(1) + 'h' : '—';
            tbody.appendChild(el('tr', { class: 'table-row' }, [
              el('td', { class: 'px-4 py-2.5 font-medium whitespace-nowrap',
                         text: (r.user && r.user.name) || '—' }),
              el('td', { class: 'px-4 py-2.5 text-muted', text: (r.user && r.user.department) || '—' }),
              el('td', { class: 'px-4 py-2.5', text: r.checkInFormatted || fmtTime(r.checkIn) }),
              el('td', { class: 'px-4 py-2.5', text: r.checkOutFormatted || fmtTime(r.checkOut) }),
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
