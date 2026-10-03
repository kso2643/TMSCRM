/* ══════════════════════════════════════════════════════════════════════
   Appointments — drop-in runtime for the compiled CRM build.

   Renders the /appointments/ page: a monthly calendar and a day view of
   scheduled customer visits, with an engineer assigned to each one
   (defaulting to self-assign) and a searchable customer picker.

   Plain ES5-ish JS, no build step. Styled with the classes already in
   the app's compiled stylesheet, so it matches the rest of the CRM —
   same approach as fuel-expense-app.js.

   NOTE: this file is part of the hand-patched build. If you ever run
   `npm run build` from source again it will not be regenerated — keep it
   alongside the source-level version.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var TOKEN_KEY = 'crm_token';
  var USER_KEY = 'crm_user';
  var ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED'];
  var STATUS_DOT = {
    SCHEDULED: 'bg-primary', COMPLETED: 'bg-emerald-500',
    CANCELLED: 'bg-slate-400', RESCHEDULED: 'bg-amber-500'
  };
  var STATUS_BADGE = {
    SCHEDULED: 'bg-primary-50 text-primary dark:bg-primary-700/40 dark:text-primary-200',
    COMPLETED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    CANCELLED: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    RESCHEDULED: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
  };

  // ── tiny helpers (same conventions as fuel-expense-app.js) ──────────
  function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function currentUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  }
  function isAdmin() {
    var u = currentUser();
    return !!u && ADMIN_ROLES.indexOf(u.role) !== -1;
  }

  function api(method, path, body) {
    return fetch(API + '/api' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token() || '') },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.message) || 'Request failed');
        return j;
      });
    });
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  var INPUT = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white ' +
    'dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 ' +
    'placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-primary';

  function selectCls() {
    return 'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
      'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary';
  }

  function field(label, inputEl, opts) {
    opts = opts || {};
    return el('label', { class: 'block' }, [
      el('span', { class: 'text-xs text-muted' }, [
        label,
        opts.required ? el('span', { class: 'text-red-500', text: ' *' }) : null
      ]),
      el('div', { class: 'mt-1' }, [inputEl]),
      opts.hint ? el('span', { class: 'text-[11px] text-slate-400 mt-0.5 block', text: opts.hint }) : null
    ]);
  }

  function input(attrs) {
    var a = attrs || {};
    a.class = INPUT;
    return el('input', a);
  }

  function toDateStr(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function parseDateStr(s) {
    var parts = String(s).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function fmtTime12(t) {
    if (!t) return '';
    var bits = String(t).split(':');
    var h = Number(bits[0]), m = bits[1] || '00';
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + m + ' ' + ap;
  }

  // ══════════════════════════════════════════════════════════════════
  // Customer picker — searchable dropdown over GET /api/customers
  // ══════════════════════════════════════════════════════════════════
  function customerPicker(initial) {
    var wrap = el('div', { class: 'relative' });
    var selected = initial || null; // {id, companyName, contactPerson, contactNumber}
    var box = el('div', { class: 'relative' });
    var searchInput = input({ placeholder: 'Search by company, contact person or phone\u2026' });
    var results = el('div', {
      class: 'absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-200 ' +
        'dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg hidden'
    });
    var chip = el('div', { class: 'hidden' });
    var debounceTimer = null;

    function renderChip() {
      chip.innerHTML = '';
      if (!selected) { chip.classList.add('hidden'); box.classList.remove('hidden'); return; }
      chip.classList.remove('hidden');
      box.classList.add('hidden');
      chip.appendChild(el('div', {
        class: 'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 ' +
          'dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'
      }, [
        el('div', { class: 'min-w-0' }, [
          el('p', { class: 'text-sm font-medium text-slate-900 dark:text-slate-100 truncate', text: selected.companyName }),
          el('p', {
            class: 'text-xs text-muted truncate',
            text: [selected.contactPerson, selected.contactNumber].filter(Boolean).join(' \u00b7 ')
          })
        ]),
        el('button', {
          type: 'button', class: 'text-xs text-primary dark:text-primary-300 font-medium shrink-0',
          text: 'Change', onclick: function () { selected = null; renderChip(); searchInput.value = ''; searchInput.focus(); }
        })
      ]));
    }

    function hideResults() { results.classList.add('hidden'); results.innerHTML = ''; }

    function doSearch(q) {
      if (!q || q.length < 2) { hideResults(); return; }
      api('GET', '/customers?search=' + encodeURIComponent(q) + '&limit=8').then(function (res) {
        var items = (res.data && res.data.items) || [];
        results.innerHTML = '';
        if (!items.length) {
          results.appendChild(el('p', { class: 'text-xs text-muted px-3 py-3', text: 'No customers match \u201c' + q + '\u201d.' }));
        } else {
          items.forEach(function (c) {
            results.appendChild(el('button', {
              type: 'button',
              class: 'w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 border-b ' +
                'border-slate-100 dark:border-slate-800 last:border-0',
              onclick: function () {
                selected = c;
                renderChip();
                hideResults();
              }
            }, [
              el('p', { class: 'font-medium text-slate-900 dark:text-slate-100 truncate', text: c.companyName }),
              el('p', {
                class: 'text-xs text-muted truncate',
                text: [c.contactPerson, c.contactNumber].filter(Boolean).join(' \u00b7 ')
              })
            ]));
          });
        }
        results.classList.remove('hidden');
      }).catch(function () { hideResults(); });
    }

    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      var q = searchInput.value.trim();
      debounceTimer = setTimeout(function () { doSearch(q); }, 300);
    });
    searchInput.addEventListener('focus', function () {
      if (searchInput.value.trim().length >= 2) doSearch(searchInput.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) hideResults();
    });

    box.appendChild(searchInput);
    box.appendChild(results);
    wrap.appendChild(box);
    wrap.appendChild(chip);
    renderChip();

    return {
      el: wrap,
      getValue: function () { return selected; },
      setValue: function (c) { selected = c; renderChip(); }
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // Create / edit dialog
  // ══════════════════════════════════════════════════════════════════
  var dialogOpen = false;

  function openApptDialog(existing, prefillDate, onSaved) {
    if (dialogOpen) return;
    dialogOpen = true;
    var me = currentUser();

    var overlay = el('div', {
      class: 'fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4'
    });
    var card = el('div', {
      class: 'card w-full sm:max-w-lg p-5 rounded-b-none sm:rounded-xl max-h-[92vh] overflow-y-auto',
      role: 'dialog', 'aria-modal': 'true'
    });
    overlay.appendChild(card);

    function close() {
      dialogOpen = false;
      document.removeEventListener('keydown', esc);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });

    card.appendChild(el('div', { class: 'flex items-start gap-3 mb-4' }, [
      el('div', { class: 'flex-1 min-w-0' }, [
        el('h2', { class: 'section-title mb-0', text: existing ? 'Edit appointment' : 'New appointment' }),
        el('p', { class: 'text-xs text-muted mt-0.5', text: existing ? existing.customer.companyName : 'Book a customer visit and assign an engineer.' })
      ]),
      el('button', {
        class: 'p-1 rounded text-slate-400 hover:text-slate-600 shrink-0',
        'aria-label': 'Close', text: '\u2715', onclick: close
      })
    ]));

    var errP = el('p', { class: 'text-xs text-red-600 dark:text-red-400 hidden' });
    function fail(msg) { errP.textContent = msg; errP.classList.remove('hidden'); }

    // Customer picker
    var picker = customerPicker(existing ? existing.customer : null);

    // Engineer select — defaults to "myself" (self-assign) unless editing
    var engSelect = el('select', { class: selectCls() + ' w-full' });
    engSelect.appendChild(el('option', { value: '', text: 'Loading engineers\u2026' }));
    api('GET', '/appointments/engineers').then(function (res) {
      var list = (res.data && res.data.engineers) || [];
      engSelect.innerHTML = '';
      list.forEach(function (u) {
        engSelect.appendChild(el('option', {
          value: u.id,
          text: u.name + (u.id === (me && me.id) ? ' (me)' : '') + ' \u2014 ' + u.role.replace('_', ' ')
        }));
      });
      var wanted = existing ? existing.assignedTo && existing.assignedTo.id : (me && me.id);
      if (wanted) engSelect.value = wanted;
    }).catch(function () {
      engSelect.innerHTML = '';
      engSelect.appendChild(el('option', { value: (me && me.id) || '', text: (me && me.name) || 'Me' }));
    });
    var assignMeBtn = el('button', {
      type: 'button', class: 'text-xs text-primary dark:text-primary-300 font-medium mt-1',
      text: 'Assign to me',
      onclick: function () { if (me) engSelect.value = me.id; }
    });

    var titleInput = input({ placeholder: 'e.g. AMC service, installation, breakdown call\u2026', value: existing ? existing.title : '' });
    var dateInput = input({ type: 'date', value: existing ? existing.appointmentDate : toDateStr(prefillDate || new Date()) });
    var timeInput = input({ type: 'time', value: existing && existing.appointmentTime ? existing.appointmentTime : '' });
    var notesInput = el('textarea', { class: INPUT, rows: '3', placeholder: 'Anything the engineer should know before the visit\u2026', text: existing ? (existing.notes || '') : '' });

    var statusRow = null;
    var statusSelect = null;
    if (existing) {
      statusSelect = el('select', { class: selectCls() + ' w-full' });
      STATUSES.forEach(function (s) {
        statusSelect.appendChild(el('option', { value: s, text: s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ') }));
      });
      statusSelect.value = existing.status;
      statusRow = field('Status', statusSelect);
    }

    var saveBtn = el('button', { class: 'btn-primary', text: existing ? 'Save changes' : 'Create appointment' });
    saveBtn.addEventListener('click', function () {
      errP.classList.add('hidden');
      var customer = picker.getValue();
      if (!customer) return fail('Please choose a customer.');
      if (!titleInput.value.trim()) return fail('Please enter a title for the visit.');
      if (!dateInput.value) return fail('Please choose a date.');

      var body = {
        customerId: customer.id,
        assignedToId: engSelect.value || undefined,
        title: titleInput.value.trim(),
        appointmentDate: dateInput.value,
        appointmentTime: timeInput.value || null,
        notes: notesInput.value.trim() || null
      };
      if (statusSelect) body.status = statusSelect.value;

      saveBtn.disabled = true;
      var req = existing ? api('PUT', '/appointments/' + existing.id, body) : api('POST', '/appointments', body);
      req.then(function () {
        close();
        if (onSaved) onSaved();
      }).catch(function (e) { saveBtn.disabled = false; fail(e.message); });
    });

    var deleteBtn = null;
    if (existing && (isAdmin() || (me && existing.user && existing.user.id === me.id))) {
      deleteBtn = el('button', {
        class: 'text-red-600 dark:text-red-400 text-sm font-medium hover:underline',
        text: 'Delete', type: 'button',
        onclick: function () {
          if (!window.confirm('Delete this appointment? This can\u2019t be undone.')) return;
          api('DELETE', '/appointments/' + existing.id).then(function () {
            close();
            if (onSaved) onSaved();
          }).catch(function (e) { fail(e.message); });
        }
      });
    }

    card.appendChild(el('div', { class: 'space-y-4' }, [
      field('Customer', picker.el, { required: true }),
      field('Assign engineer', el('div', {}, [engSelect, assignMeBtn]), { required: true }),
      field('Title', titleInput, { required: true }),
      el('div', { class: 'grid grid-cols-2 gap-3' }, [
        field('Date', dateInput, { required: true }),
        field('Time (optional)', timeInput)
      ]),
      statusRow,
      field('Notes', notesInput),
      errP
    ]));
    card.appendChild(el('div', { class: 'flex gap-2 justify-between items-center mt-5' }, [
      deleteBtn || el('span'),
      el('div', { class: 'flex gap-2' }, [
        el('button', { class: 'btn-secondary', text: 'Cancel', onclick: close }),
        saveBtn
      ])
    ]));
    document.body.appendChild(overlay);
    setTimeout(function () { picker.el.querySelector('input').focus(); }, 30);
  }

  // ══════════════════════════════════════════════════════════════════
  // Page
  // ══════════════════════════════════════════════════════════════════
  function mountPage(root) {
    var params = new URLSearchParams(location.search);
    var qDate = params.get('date');

    var state = {
      view: qDate ? 'day' : 'month',
      refDate: qDate ? parseDateStr(qDate) : new Date(),
      mineOnly: false,
      appointments: []
    };

    var bodySlot = el('div', { class: 'mt-4' });
    var headerHost = el('div');
    injectCalendarCss();

    function render() {
      root.innerHTML = '';
      headerHost.innerHTML = '';
      headerHost.appendChild(buildHeader());
      root.appendChild(el('div', { class: 'space-y-4' }, [headerHost, bodySlot]));
      loadAndRenderBody();
    }

    function renderHeaderOnly() { headerHost.innerHTML = ''; headerHost.appendChild(buildHeader()); }

    function monthRange(d) {
      var from = new Date(d.getFullYear(), d.getMonth(), 1);
      var to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { from: toDateStr(from), to: toDateStr(to) };
    }

    function loadAndRenderBody() {
      var range = state.view === 'month' ? monthRange(state.refDate) : { from: toDateStr(state.refDate), to: toDateStr(state.refDate) };
      var qs = '?from=' + range.from + '&to=' + range.to + (state.mineOnly ? '&mine=1' : '');
      bodySlot.innerHTML = '';
      bodySlot.appendChild(el('p', { class: 'text-xs text-muted', text: 'Loading\u2026' }));
      api('GET', '/appointments' + qs).then(function (res) {
        state.appointments = (res.data && res.data.appointments) || [];
        bodySlot.innerHTML = '';
        bodySlot.appendChild(state.view === 'month' ? renderMonthGrid() : renderDayList());
      }).catch(function (e) {
        bodySlot.innerHTML = '';
        bodySlot.appendChild(el('p', { class: 'text-xs text-red-600 dark:text-red-400', text: e.message }));
      });
    }

    function goToday() { state.refDate = new Date(); loadAndRenderBody(); renderHeaderOnly(); }
    function step(delta) {
      if (state.view === 'month') {
        state.refDate = new Date(state.refDate.getFullYear(), state.refDate.getMonth() + delta, 1);
      } else {
        state.refDate = new Date(state.refDate.getFullYear(), state.refDate.getMonth(), state.refDate.getDate() + delta);
      }
      loadAndRenderBody(); renderHeaderOnly();
    }
    function switchView(v, day) {
      state.view = v;
      if (day) state.refDate = day;
      render();
    }

    function buildHeader() {
      var label = state.view === 'month'
        ? MONTHS[state.refDate.getMonth()] + ' ' + state.refDate.getFullYear()
        : state.refDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      var viewTabs = el('div', { class: 'inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5' }, [
        el('button', {
          class: 'px-3 py-1.5 text-xs font-medium rounded-md ' +
            (state.view === 'month' ? 'bg-primary text-white' : 'text-slate-600 dark:text-slate-300'),
          text: 'Month', onclick: function () { switchView('month'); }
        }),
        el('button', {
          class: 'px-3 py-1.5 text-xs font-medium rounded-md ' +
            (state.view === 'day' ? 'bg-primary text-white' : 'text-slate-600 dark:text-slate-300'),
          text: 'Day', onclick: function () { switchView('day', state.refDate); }
        })
      ]);

      var mineToggle = el('label', { class: 'flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none' }, [
        el('input', {
          type: 'checkbox', checked: state.mineOnly ? '' : null,
          onchange: function (e) { state.mineOnly = e.target.checked; loadAndRenderBody(); }
        }),
        'My appointments only'
      ]);

      var nav = el('div', { class: 'flex items-center gap-1' }, [
        el('button', { class: 'btn-secondary px-2.5 py-1.5', text: '\u2039', onclick: function () { step(-1); } }),
        el('button', { class: 'btn-secondary px-2.5 py-1.5 text-xs', text: 'Today', onclick: goToday }),
        el('button', { class: 'btn-secondary px-2.5 py-1.5', text: '\u203a', onclick: function () { step(1); } })
      ]);

      var newBtn = el('button', {
        class: 'btn-primary', text: '+ New appointment',
        onclick: function () {
          var prefill = state.view === 'day' ? state.refDate : new Date();
          openApptDialog(null, prefill, loadAndRenderBody);
        }
      });

      return el('div', { class: 'space-y-3' }, [
        el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
          el('h1', { class: 'page-title', text: 'Appointments' }),
          newBtn
        ]),
        el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
          el('div', { class: 'flex items-center gap-3 flex-wrap' }, [viewTabs, nav, el('span', { class: 'text-sm font-medium text-slate-700 dark:text-slate-200', text: label })]),
          mineToggle
        ])
      ]);
    }

    function apptsByDay() {
      var map = {};
      state.appointments.forEach(function (a) {
        (map[a.appointmentDate] = map[a.appointmentDate] || []).push(a);
      });
      return map;
    }

    // Engineer -> stable colour, so each person's visits are easy to pick out.
    var PALETTE = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#0d9488'];
    function colorFor(id) {
      var h = 0; String(id || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
      return PALETTE[h % PALETTE.length];
    }

    function renderMonthGrid() {
      injectCalendarCss();
      var byDay = apptsByDay();
      var year = state.refDate.getFullYear(), month = state.refDate.getMonth();
      var first = new Date(year, month, 1);
      var gridStart = new Date(year, month, 1 - first.getDay()); // Sunday on/before the 1st
      var today = new Date();

      // Summary + engineer legend for the month
      var people = {}, total = 0, done = 0;
      state.appointments.forEach(function (a) {
        total++; if (a.status === 'COMPLETED') done++;
        var who = a.assignedTo || a.user || {};
        if (who.id) people[who.id] = who.name;
      });
      var legend = el('div', { class: 'ap-legend' }, [
        el('span', { class: 'ap-sum', text: total + (total === 1 ? ' visit' : ' visits') + ' this month · ' + done + ' completed' })
      ].concat(Object.keys(people).map(function (id) {
        return el('span', { class: 'ap-leg' }, [el('i', { style: 'background:' + colorFor(id) }), people[id]]);
      })));

      var grid = el('div', { class: 'ap-grid', role: 'grid', 'aria-label': MONTHS[month] + ' ' + year });
      WEEKDAYS.forEach(function (w, i) {
        grid.appendChild(el('div', { class: 'ap-wd' + (i === 0 || i === 6 ? ' ap-we' : ''), role: 'columnheader', text: w }));
      });
      for (var i = 0; i < 42; i++) {
        (function (dateObj) {
          var inMonth = dateObj.getMonth() === month;
          var dateStr = toDateStr(dateObj);
          var dayAppts = (byDay[dateStr] || []).slice().sort(function (a, b) { return (a.appointmentTime || '99') < (b.appointmentTime || '99') ? -1 : 1; });
          var wd = dateObj.getDay();
          var cell = el('div', {
            class: 'ap-cell' + (inMonth ? '' : ' ap-out') + (wd === 0 || wd === 6 ? ' ap-we' : '') + (isSameDate(dateObj, today) ? ' ap-today' : ''),
            role: 'gridcell', tabindex: '0', title: 'Open ' + dateObj.toDateString(),
            onclick: function () { switchView('day', dateObj); },
            onkeydown: function (e) { if (e.key === 'Enter') switchView('day', dateObj); }
          });
          cell.appendChild(el('div', { class: 'ap-num' }, [
            el('span', { text: String(dateObj.getDate()) }),
            dayAppts.length ? el('em', { text: String(dayAppts.length) }) : null
          ]));
          dayAppts.slice(0, 3).forEach(function (a) {
            var who = a.assignedTo || a.user || {};
            var cust = (a.customer && (a.customer.companyName || a.customer.name)) || '';
            cell.appendChild(el('button', {
              type: 'button',
              class: 'ap-ev ap-st-' + (a.status || 'SCHEDULED'),
              style: '--c:' + colorFor(who.id),
              title: [a.appointmentTime ? fmtTime12(a.appointmentTime) : 'Any time', a.title, cust, who.name, a.status].filter(Boolean).join(' · '),
              onclick: function (e) { e.stopPropagation(); openApptDialog(a, null, loadAndRenderBody); }
            }, [
              el('b', { text: a.appointmentTime ? fmtTime12(a.appointmentTime) : '•' }),
              el('span', { text: (cust || a.title) + (who.name ? ' · ' + who.name.split(' ')[0] : '') })
            ]));
          });
          if (dayAppts.length > 3) cell.appendChild(el('span', { class: 'ap-more', text: '+' + (dayAppts.length - 3) + ' more' }));
          grid.appendChild(cell);
        })(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
      }
      return el('div', { class: 'space-y-3' }, [legend, el('div', { class: 'ap-scroll' }, [grid])]);
    }

    function injectCalendarCss() {
      if (document.getElementById('ap-calendar-css')) return;
      var st = document.createElement('style');
      st.id = 'ap-calendar-css';
      st.textContent = [
        '.ap-scroll{overflow-x:auto}',
        '.ap-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-width:700px;border:1px solid #e2e8f0;border-radius:.75rem;overflow:hidden;background:#e2e8f0;gap:1px}',
        '.dark .ap-grid{border-color:#334155;background:#334155}',
        '.ap-wd{background:#f8fafc;padding:.55rem;text-align:center;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b}',
        '.dark .ap-wd{background:#0f172a;color:#94a3b8}',
        '.ap-cell{background:#fff;min-height:118px;padding:.4rem .45rem;display:flex;flex-direction:column;gap:3px;cursor:pointer;transition:background .12s}',
        '.ap-cell:hover{background:#f1f5f9}.ap-cell:focus{outline:2px solid #1e3a5f;outline-offset:-2px}',
        '.dark .ap-cell{background:#020617}.dark .ap-cell:hover{background:#0f172a}',
        '.ap-we{background:#fafafa}.dark .ap-we{background:#0b1222}',
        '.ap-wd.ap-we{background:#f1f5f9}',
        '.ap-out{opacity:.45}',
        '.ap-num{display:flex;align-items:center;justify-content:space-between;font-size:.8rem;font-weight:600;color:#334155}',
        '.dark .ap-num{color:#cbd5e1}',
        '.ap-num span{width:1.6rem;height:1.6rem;display:inline-flex;align-items:center;justify-content:center;border-radius:9999px}',
        '.ap-num em{font-style:normal;font-size:.66rem;font-weight:700;color:#64748b;background:#f1f5f9;border-radius:9999px;padding:0 .4rem}',
        '.ap-today{box-shadow:inset 0 0 0 2px #1e3a5f}.ap-today .ap-num span{background:#1e3a5f;color:#fff}',
        '.dark .ap-today{box-shadow:inset 0 0 0 2px #60a5fa}',
        '.ap-ev{display:flex;gap:.3rem;align-items:center;text-align:left;width:100%;border:0;cursor:pointer;font-size:.7rem;line-height:1.25;',
        '  padding:.18rem .35rem;border-radius:.35rem;border-left:3px solid var(--c);background:color-mix(in srgb,var(--c) 12%,#fff);color:#0f172a;overflow:hidden}',
        '.dark .ap-ev{background:color-mix(in srgb,var(--c) 25%,#020617);color:#f1f5f9}',
        '.ap-ev b{font-weight:700;white-space:nowrap}.ap-ev span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ap-ev:hover{filter:brightness(.96)}',
        '.ap-st-COMPLETED{opacity:.7}.ap-st-COMPLETED span{text-decoration:line-through}',
        '.ap-st-CANCELLED{opacity:.45}.ap-st-CANCELLED span{text-decoration:line-through}',
        '.ap-more{font-size:.68rem;font-weight:600;color:#1e3a5f;padding-left:.35rem}.dark .ap-more{color:#93c5fd}',
        '.ap-legend{display:flex;flex-wrap:wrap;gap:.4rem .9rem;align-items:center;font-size:.78rem;color:#475569}',
        '.dark .ap-legend{color:#cbd5e1}',
        '.ap-sum{font-weight:600;color:#0f172a;margin-right:.4rem}.dark .ap-sum{color:#f1f5f9}',
        '.ap-leg{display:inline-flex;align-items:center;gap:.35rem}.ap-leg i{width:.65rem;height:.65rem;border-radius:.2rem;display:inline-block}',
        // utilities this file uses that the compiled CSS lacks
        '.p-0\\.5{padding:.125rem}.p-3\\.5{padding:.875rem}.pt-0\\.5{padding-top:.125rem}.px-2\\.5{padding-left:.625rem;padding-right:.625rem}',
        '.mt-1\\.5{margin-top:.375rem}.mt-5{margin-top:1.25rem}.rounded-md{border-radius:.375rem}.self-stretch{align-self:stretch}.w-1\\.5{width:.375rem}',
        '.leading-tight{line-height:1.25}.max-h-56{max-height:14rem}.text-\\[11px\\]{font-size:11px}.last\\:border-0:last-child{border-width:0}',
        '.z-\\[9999\\]{z-index:9999}.dark .dark\\:text-slate-200{color:#e2e8f0}.dark .dark\\:border-slate-800{border-color:#1e293b}',
        '@media(min-width:640px){.sm\\:max-w-lg{max-width:32rem}}'
      ].join('\n');
      document.head.appendChild(st);
    }

    function renderDayList() {
      var sorted = state.appointments.slice().sort(function (a, b) {
        if (!a.appointmentTime) return 1;
        if (!b.appointmentTime) return -1;
        return a.appointmentTime < b.appointmentTime ? -1 : 1;
      });
      if (!sorted.length) {
        return el('div', { class: 'card p-6 text-center' }, [
          el('p', { class: 'text-sm text-muted', text: 'No appointments on this day.' })
        ]);
      }
      return el('div', { class: 'space-y-2' }, sorted.map(function (a) {
        var me = currentUser();
        var canEdit = isAdmin() || (me && (a.user.id === me.id || (a.assignedTo && a.assignedTo.id === me.id)));
        return el('div', { class: 'card p-3.5 flex items-start gap-3' }, [
          el('div', { class: 'w-16 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400 pt-0.5', text: a.appointmentTime ? fmtTime12(a.appointmentTime) : 'Any time' }),
          el('div', { class: 'w-1.5 self-stretch rounded-full ' + (STATUS_DOT[a.status] || STATUS_DOT.SCHEDULED) }),
          el('div', { class: 'flex-1 min-w-0' }, [
            el('div', { class: 'flex items-center gap-2 flex-wrap' }, [
              el('p', { class: 'text-sm font-semibold text-slate-900 dark:text-slate-100', text: a.title }),
              el('span', { class: 'text-[10px] px-1.5 py-0.5 rounded-full font-medium ' + (STATUS_BADGE[a.status] || STATUS_BADGE.SCHEDULED), text: a.status })
            ]),
            el('p', { class: 'text-xs text-muted mt-0.5', text: a.customer.companyName + (a.customer.contactPerson ? ' \u00b7 ' + a.customer.contactPerson : '') }),
            el('p', { class: 'text-xs text-slate-400 mt-0.5', text: 'Engineer: ' + (a.assignedTo ? a.assignedTo.name : '\u2014') }),
            a.notes ? el('p', { class: 'text-xs text-slate-500 dark:text-slate-400 mt-1.5 italic', text: a.notes }) : null
          ]),
          canEdit ? el('button', {
            class: 'text-xs text-primary dark:text-primary-300 font-medium shrink-0',
            text: 'Edit', onclick: function () { openApptDialog(a, null, loadAndRenderBody); }
          }) : null
        ]);
      }));
    }

    render();
  }

  window.Appointments = { mountPage: mountPage };
})();
