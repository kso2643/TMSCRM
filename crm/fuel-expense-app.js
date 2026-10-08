/* ══════════════════════════════════════════════════════════════════════
   Fuel expense — drop-in runtime for the compiled CRM build.

   Two jobs:
     1. Watches for a successful punch in / punch out (by wrapping
        XMLHttpRequest, which is what axios uses in the browser) and pops
        the meter-reading dialog. Works on whichever page the punch
        happened, without touching the React bundle.
     2. Renders the /fuel-expense/ page.

   Plain ES5-ish JS, no build step. Styled with the classes already in
   the app's compiled stylesheet, so it matches the rest of the CRM.

   NOTE: this file is part of the hand-patched build. If you ever run
   `npm run build` from source again it will not be regenerated — keep it
   alongside the source-level version.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var TOKEN_KEY = 'crm_token';
  var USER_KEY = 'crm_user';
  // Matches require_admin() in the API (ADMIN tier or higher) — the
  // actual enforced boundary behind this tab's endpoint. MANAGER is
  // intentionally excluded: is_admin_tier() elsewhere in the API is
  // broader, but this specific endpoint is require_admin()-gated.
  var ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

  // ── tiny helpers ────────────────────────────────────────────────────
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (token() || '')
      },
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

  function num(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  function fmt(v) {
    var n = Number(v);
    if (v == null || isNaN(n)) return '—';
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function fmtDate(d) {
    if (!d) return '—';
    var s = /[Zz]|[+-]\d\d:?\d\d$/.test(d) ? d : String(d).replace(' ', 'T');
    var dt = new Date(s);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN',
      { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  var INPUT = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white ' +
              'dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 ' +
              'placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-primary';

  function field(label, input, opts) {
    opts = opts || {};
    return el('label', { class: 'block' }, [
      el('span', { class: 'text-xs text-muted' }, [
        label,
        opts.required ? el('span', { class: 'text-red-500', text: ' *' }) : null
      ]),
      el('div', { class: 'mt-1' }, [input]),
      opts.hint ? el('span', { class: 'text-[11px] text-slate-400 mt-0.5 block', text: opts.hint }) : null
    ]);
  }

  function input(attrs) {
    var a = attrs || {};
    a.class = INPUT;
    return el('input', a);
  }

  // ── the meter-reading dialog ────────────────────────────────────────
  // mode: 'open'  → starting reading (after punch in)
  //       'close' → closing reading  (after punch out)
  var dialogOpen = false;

  function openMeterDialog(mode, onDone) {
    if (dialogOpen) return;
    dialogOpen = true;

    var overlay = el('div', {
      class: 'fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4',
      // inline too: the hand-coded pages don't ship every utility class the React build had
      style: 'position:fixed;inset:0;z-index:2147483300;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:16px'
    });
    var card = el('div', {
      class: 'card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-xl max-h-[92vh] overflow-y-auto',
      style: 'width:100%;max-width:28rem;max-height:92vh;overflow-y:auto;padding:1.25rem;border-radius:.9rem',
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

    function header(title, subtitle) {
      return el('div', { class: 'flex items-start gap-3 mb-4' }, [
        el('div', {
          class: 'w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-700/50 flex items-center ' +
                 'justify-center shrink-0 text-primary dark:text-primary-200 text-base',
          text: mode === 'open' ? '⏱' : '⛽'
        }),
        el('div', { class: 'flex-1 min-w-0' }, [
          el('h2', { class: 'section-title mb-0', text: title }),
          subtitle ? el('p', { class: 'text-xs text-muted mt-0.5', text: subtitle }) : null
        ]),
        el('button', {
          class: 'p-1 rounded text-slate-400 hover:text-slate-600 shrink-0',
          'aria-label': 'Close', text: '✕', onclick: close
        })
      ]);
    }

    var errP = el('p', { class: 'text-xs text-red-600 dark:text-red-400 hidden' });
    function fail(msg) { errP.textContent = msg; errP.classList.remove('hidden'); }

    if (mode === 'open') buildOpen(); else buildClose();

    function buildOpen() {
      var meter = input({ type: 'number', inputmode: 'decimal', placeholder: 'e.g. 46167' });
      var vType = input({ placeholder: 'Gear bike' });
      var vDet = input({ placeholder: 'Shine SP125 TN23CH6439' });
      var vMil = input({ type: 'number', inputmode: 'decimal', placeholder: '55' });
      var vFuel = input({ type: 'number', inputmode: 'decimal', placeholder: '103' });

      var vehicleBox = el('div', { class: 'grid grid-cols-2 gap-3 hidden' }, [
        field('Vehicle type', vType), field('Vehicle / reg. no.', vDet),
        field('Mileage (km/l)', vMil), field('Fuel price (₹/l)', vFuel)
      ]);
      var savedLine = el('div', { class: 'hidden' });
      var showVehicle = false;
      function setShowVehicle(v) {
        showVehicle = v;
        vehicleBox.classList.toggle('hidden', !v);
        savedLine.classList.toggle('hidden', v);
      }

      api('GET', '/vehicle-profile').then(function (res) {
        var p = (res.data && res.data.profile) || {};
        vType.value = p.vehicleType || '';
        vDet.value = p.vehicleDetails || '';
        vMil.value = p.vehicleMileage != null ? p.vehicleMileage : '';
        vFuel.value = p.vehicleFuelPrice != null ? p.vehicleFuelPrice : '';
        if (p.vehicleType || p.vehicleDetails) {
          var bits = [p.vehicleType, p.vehicleDetails].filter(Boolean).join(' · ');
          if (p.vehicleMileage) bits += ' · ' + p.vehicleMileage + ' km/l';
          if (p.vehicleFuelPrice) bits += ' · ₹' + p.vehicleFuelPrice + '/l';
          savedLine.className = 'flex items-center justify-between text-xs px-3 py-2.5 rounded-lg ' +
            'bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700';
          savedLine.innerHTML = '';
          savedLine.appendChild(el('span', { class: 'text-slate-600 dark:text-slate-300', text: bits }));
          savedLine.appendChild(el('button', {
            class: 'text-primary dark:text-primary-300 font-medium shrink-0 ml-3',
            text: 'Change', onclick: function () { setShowVehicle(true); }
          }));
          setShowVehicle(false);
        } else {
          setShowVehicle(true);
        }
      }).catch(function () { setShowVehicle(true); });

      var saveBtn = el('button', { class: 'btn-primary', text: 'Start fuel log' });
      saveBtn.addEventListener('click', function () {
        errP.classList.add('hidden');
        if (!meter.value) return fail('Please enter the starting meter reading.');
        saveBtn.disabled = true;
        var body = { openingMeter: num(meter.value) };
        if (showVehicle) {
          if (vType.value) body.vehicleType = vType.value;
          if (vDet.value) body.vehicleDetails = vDet.value;
          if (vMil.value) body.mileage = num(vMil.value);
          if (vFuel.value) body.fuelPrice = num(vFuel.value);
        }
        api('POST', '/fuel-expense/start', body).then(function (res) {
          var w = res.data && res.data.warning;
          if (w) { showWarning(w, meter.value); saveBtn.disabled = false; return; }
          close(); if (onDone) onDone();
        }).catch(function (e) { saveBtn.disabled = false; fail(e.message); });
      });

      card.appendChild(header('Starting meter reading',
        "You've punched in. Enter your odometer reading to start today's fuel log."));
      card.appendChild(el('div', { class: 'space-y-4' }, [
        field('Odometer reading (km)', meter, { required: true }),
        savedLine, vehicleBox, errP
      ]));
      card.appendChild(footer(saveBtn));
      setTimeout(function () { meter.focus(); }, 30);
    }

    // The odometer-continuity check: the entry IS saved, this is a
    // "does that look right?" step rather than a blocker.
    function showWarning(msg, savedVal) {
      card.innerHTML = '';
      card.appendChild(header('Check this reading'));
      card.appendChild(el('div', {
        class: 'flex gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border ' +
               'border-amber-200 dark:border-amber-800'
      }, [
        el('span', { class: 'text-amber-600 dark:text-amber-400 shrink-0', text: '⚠' }),
        el('p', { class: 'text-sm text-amber-800 dark:text-amber-200', text: msg })
      ]));
      card.appendChild(el('p', {
        class: 'text-xs text-muted mt-3',
        text: 'Saved as ' + fmt(savedVal) + ' km. You can correct it now or leave it as is.'
      }));
      var again = el('button', {
        class: 'btn-secondary', text: 'Re-enter',
        onclick: function () { card.innerHTML = ''; buildOpen(); }
      });
      var ok = el('button', {
        class: 'btn-primary', text: 'Looks right',
        onclick: function () { close(); if (onDone) onDone(); }
      });
      card.appendChild(footer(ok, again));
    }

    function buildClose() {
      var meter = input({ type: 'number', inputmode: 'decimal', placeholder: 'e.g. 46220' });
      var personal = input({ type: 'number', inputmode: 'decimal', value: '0' });
      var miscAmt = input({ type: 'number', inputmode: 'decimal', placeholder: '0' });
      var miscDesc = input({ placeholder: 'Parking, toll, courier…' });
      var customers = input({ placeholder: 'Comma separated' });
      var startedLine = el('div', { class: 'text-xs text-muted px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 hidden' });
      var preview = el('div', { class: 'rounded-lg border border-slate-200 dark:border-slate-700 text-sm hidden' });
      var miscDescWrap = field('What was the misc. expense for?', miscDesc);
      miscDescWrap.classList.add('hidden');
      var rec = null;

      api('GET', '/fuel-expense/today').then(function (res) {
        rec = res.data && res.data.record;
        if (rec) {
          startedLine.textContent = 'Started at ' + fmt(rec.openingMeter) + ' km' +
            (rec.vehicleDetails ? ' · ' + rec.vehicleDetails : '');
          startedLine.classList.remove('hidden');
        }
        recalc();
      }).catch(function () {});

      function recalc() {
        miscDescWrap.classList.toggle('hidden', !(num(miscAmt.value) > 0));
        if (!rec || !meter.value) { preview.classList.add('hidden'); return; }
        var official = num(meter.value) - num(rec.openingMeter) - num(personal.value);
        preview.classList.remove('hidden');
        preview.innerHTML = '';
        if (official < 0) {
          preview.appendChild(el('p', {
            class: 'text-xs text-red-600 dark:text-red-400 px-3 py-2',
            text: 'Official km works out negative — check the closing reading and personal km.'
          }));
          return;
        }
        var m = num(rec.mileageUsed), p = num(rec.fuelPriceUsed);
        var fuel = m > 0 && p > 0 ? (official / m) * p : 0;
        var misc = num(miscAmt.value);
        [['Official distance', official.toFixed(1) + ' km', false],
         ['Fuel cost', '₹' + fuel.toFixed(2), false],
         misc > 0 ? ['Misc.', '₹' + misc.toFixed(2), false] : null,
         ['Total claim', '₹' + (fuel + misc).toFixed(2), true]
        ].filter(Boolean).forEach(function (r, i) {
          preview.appendChild(el('div', {
            class: 'flex items-center justify-between px-3 py-2' +
                   (i ? ' border-t border-slate-100 dark:border-slate-700' : '')
          }, [
            el('span', { class: 'text-muted text-xs', text: r[0] }),
            el('span', {
              class: r[2] ? 'font-bold text-slate-900 dark:text-slate-100'
                          : 'text-slate-700 dark:text-slate-200', text: r[1]
            })
          ]));
        });
      }
      [meter, personal, miscAmt].forEach(function (i) { i.addEventListener('input', recalc); });

      var saveBtn = el('button', { class: 'btn-primary', text: 'Save & finish' });
      saveBtn.addEventListener('click', function () {
        errP.classList.add('hidden');
        if (!meter.value) return fail('Please enter the closing meter reading.');
        saveBtn.disabled = true;
        api('POST', '/fuel-expense/close', {
          closingMeter: num(meter.value),
          personalKm: num(personal.value),
          customersVisited: customers.value || undefined,
          miscDesc: miscDesc.value || undefined,
          miscAmount: num(miscAmt.value)
        }).then(function () { close(); if (onDone) onDone(); })
          .catch(function (e) { saveBtn.disabled = false; fail(e.message); });
      });

      card.appendChild(header('Closing meter reading',
        "You've punched out. Enter your closing reading to finish today's fuel log."));
      card.appendChild(el('div', { class: 'space-y-4' }, [
        startedLine,
        field('Odometer reading (km)', meter, { required: true }),
        el('div', { class: 'grid grid-cols-2 gap-3' }, [
          field('Personal km', personal, { hint: 'Deducted from official km' }),
          field('Misc. amount (₹)', miscAmt)
        ]),
        miscDescWrap,
        field('Customers visited', customers),
        preview, errP
      ]));
      card.appendChild(footer(saveBtn));
      setTimeout(function () { meter.focus(); }, 30);
    }

    function footer(primary, secondary) {
      return el('div', { class: 'flex gap-2 justify-end mt-5' }, [
        secondary || el('button', { class: 'btn-secondary', text: 'Later', onclick: close }),
        primary
      ]);
    }

    document.body.appendChild(overlay);
  }

  // ── punch in / punch out detection ──────────────────────────────────
  // axios uses XMLHttpRequest in the browser, so wrapping open/send here
  // catches the punch without touching the React bundle at all.
  function installPunchHook() {
    if (window.__fuelExpenseHookInstalled) return;
    window.__fuelExpenseHookInstalled = true;

    var XHR = window.XMLHttpRequest;
    if (!XHR) return;
    var open = XHR.prototype.open;
    var send = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__feMethod = String(method || '').toUpperCase();
      this.__feUrl = String(url || '');
      return open.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      var xhr = this;
      if (xhr.__feMethod === 'POST' && /\/api\/attendance\/check(in|out)\b/.test(xhr.__feUrl)) {
        var dir = /checkin/.test(xhr.__feUrl) ? 'open' : 'close';
        xhr.addEventListener('load', function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            // Let the app finish its own state update first.
            setTimeout(function () { openMeterDialog(dir); }, 450);
          }
        });
      }
      return send.apply(this, arguments);
    };
  }

  // ── the /fuel-expense/ page ─────────────────────────────────────────
  function mountPage(root) {
    var now = new Date();
    var month = now.getMonth() + 1, year = now.getFullYear();
    var tab = 'mine';

    function render() {
      root.innerHTML = '';
      root.appendChild(el('div', { class: 'space-y-5' }, [
        headerRow(), bannerSlot, statsSlot, vehicleLine, tabsSlot, bodySlot
      ]));
    }

    var bannerSlot = el('div', { class: 'space-y-3' });
    var statsSlot = el('div', { class: 'grid grid-cols-2 lg:grid-cols-4 gap-3' });
    var vehicleLine = el('p', { class: 'text-xs text-muted hidden' });
    var tabsSlot = el('div', { class: 'flex gap-1 border-b border-slate-200 dark:border-slate-700 hidden' });
    var bodySlot = el('div');

    function headerRow() {
      var mSel = el('select', { class: selectCls() });
      MONTHS.forEach(function (m, i) {
        mSel.appendChild(el('option', { value: String(i + 1), text: m, selected: i + 1 === month ? '' : null }));
      });
      mSel.value = String(month);
      mSel.addEventListener('change', function () { month = Number(mSel.value); loadAll(); });

      var ySel = el('select', { class: selectCls() });
      for (var y = now.getFullYear(); y > now.getFullYear() - 4; y--) {
        ySel.appendChild(el('option', { value: String(y), text: String(y) }));
      }
      ySel.value = String(year);
      ySel.addEventListener('change', function () { year = Number(ySel.value); loadAll(); });

      var right = el('div', { class: 'flex gap-2' }, [mSel, ySel]);
      if (isAdmin()) {
        right.appendChild(el('a', {
          class: 'btn-secondary',
          href: API + '/api/fuel-expense/export?format=excel',
          text: 'Export'
        }));
      }
      return el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('h1', { class: 'page-title', text: 'Fuel expense' }), right
      ]);
    }

    function selectCls() {
      return 'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
             'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary';
    }

    function stat(label, value, strong) {
      return el('div', { class: 'card p-4' }, [
        el('p', { class: 'text-xs text-muted', text: label }),
        el('p', {
          class: 'mt-1 ' + (strong ? 'text-xl font-bold' : 'text-lg font-semibold') +
                 ' text-slate-900 dark:text-slate-100', text: value
        })
      ]);
    }

    function banner(title, body, action, onAction) {
      return el('div', {
        class: 'card p-4 flex items-start gap-3 border-amber-200 dark:border-amber-800 ' +
               'bg-amber-50 dark:bg-amber-900/20'
      }, [
        el('span', { class: 'text-amber-600 dark:text-amber-400 shrink-0', text: '⛽' }),
        el('div', { class: 'flex-1 min-w-0' }, [
          el('p', { class: 'text-sm font-semibold text-amber-900 dark:text-amber-100', text: title }),
          el('p', { class: 'text-xs text-amber-800 dark:text-amber-200 mt-0.5', text: body })
        ]),
        el('button', { class: 'btn-primary shrink-0', text: action, onclick: onAction })
      ]);
    }

    function loadToday() {
      bannerSlot.innerHTML = '';
      api('GET', '/fuel-expense/today').then(function (res) {
        var d = res.data || {};
        if (d.needsOpening) {
          bannerSlot.appendChild(banner(
            'Starting meter reading not recorded',
            "You punched in today but haven't logged your odometer reading yet.",
            'Enter reading', function () { openMeterDialog('open', loadAll); }));
        }
        if (d.needsClosing) {
          bannerSlot.appendChild(banner(
            'Closing meter reading not recorded',
            'You punched out today. Log your closing reading to finish the entry.',
            'Close the day', function () { openMeterDialog('close', loadAll); }));
        }
      }).catch(function () {});
    }

    function loadProfile() {
      api('GET', '/vehicle-profile').then(function (res) {
        var p = (res.data && res.data.profile) || {};
        if (!p.vehicleType && !p.vehicleDetails) return;
        var bits = [p.vehicleType, p.vehicleDetails].filter(Boolean).join(' · ');
        if (p.vehicleMileage) bits += ' · ' + p.vehicleMileage + ' km/l';
        if (p.vehicleFuelPrice) bits += ' · ₹' + p.vehicleFuelPrice + '/l';
        vehicleLine.textContent = bits;
        vehicleLine.classList.remove('hidden');
      }).catch(function () {});
    }

    function setLoading() {
      bodySlot.innerHTML = '';
      bodySlot.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' }));
    }

    function loadMine() {
      setLoading();
      api('GET', '/fuel-expense?month=' + month + '&year=' + year).then(function (res) {
        var d = res.data || {};
        var s = d.summary || {};
        statsSlot.innerHTML = '';
        [['Official distance', fmt(s.officialKm) + ' km', false],
         ['Fuel cost', '₹' + fmt(s.fuelCost), false],
         ['Misc.', '₹' + fmt(s.miscAmount), false],
         ['Total claim', '₹' + fmt(s.totalAmount), true]
        ].forEach(function (r) { statsSlot.appendChild(stat(r[0], r[1], r[2])); });

        var heads = ['Date','Opening','Closing','Personal','Official','Fuel ₹','Misc ₹','Total ₹','Customers',''];
        var thead = el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [
          el('tr', {}, heads.map(function (h) {
            return el('th', { class: 'table-head text-left px-4 py-3 whitespace-nowrap', text: h });
          }))
        ]);
        var tbody = el('tbody');
        var items = d.items || [];
        if (!items.length) {
          tbody.appendChild(el('tr', {}, [el('td', {
            colspan: String(heads.length),
            class: 'px-4 py-10 text-center text-muted',
            text: 'No entries for ' + MONTHS[month - 1] + ' ' + year
          })]));
        } else {
          items.forEach(function (r) {
            var closingCell = r.closingMeter != null
              ? el('td', { class: 'px-4 py-3', text: fmt(r.closingMeter) })
              : el('td', { class: 'px-4 py-3' }, [el('span', { class: 'badge badge-yellow', text: 'Open' })]);
            tbody.appendChild(el('tr', { class: 'table-row' }, [
              el('td', { class: 'px-4 py-3 font-medium whitespace-nowrap', text: fmtDate(r.date) }),
              el('td', { class: 'px-4 py-3', text: fmt(r.openingMeter) }),
              closingCell,
              el('td', { class: 'px-4 py-3', text: fmt(r.personalKm) }),
              el('td', { class: 'px-4 py-3', text: r.officialKm != null ? fmt(r.officialKm) : '—' }),
              el('td', { class: 'px-4 py-3', text: r.fuelCost != null ? fmt(r.fuelCost) : '—' }),
              el('td', { class: 'px-4 py-3', text: fmt(r.miscAmount) }),
              el('td', { class: 'px-4 py-3 font-semibold', text: r.totalAmount != null ? fmt(r.totalAmount) : '—' }),
              el('td', { class: 'px-4 py-3 max-w-[180px] truncate text-muted', text: r.customersVisited || '—' }),
              el('td', { class: 'px-4 py-3' }, [
                el('button', {
                  class: 'p-1 rounded text-slate-400 hover:text-slate-600', title: 'Edit', text: '✎',
                  onclick: function () { openEdit(r, loadAll); }
                })
              ])
            ]));
          });
        }

        bodySlot.innerHTML = '';
        bodySlot.appendChild(el('div', { class: 'card overflow-hidden' }, [
          el('div', { class: 'px-5 py-3.5 border-b border-slate-200 dark:border-slate-700' }, [
            el('span', {
              class: 'text-sm font-semibold text-slate-900 dark:text-slate-100',
              text: MONTHS[month - 1] + ' ' + year
            })
          ]),
          el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-sm' }, [thead, tbody])])
        ]));
      }).catch(function (e) {
        bodySlot.innerHTML = '';
        bodySlot.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: e.message }));
      });
    }

    function loadAllUsers() {
      setLoading();
      api('GET', '/fuel-expense/all?month=' + month + '&year=' + year).then(function (res) {
        var days = (res.data && res.data.days) || [];
        bodySlot.innerHTML = '';
        if (!days.length) {
          bodySlot.appendChild(el('div', {
            class: 'card p-10 text-center text-muted',
            text: 'No entries for ' + MONTHS[month - 1] + ' ' + year
          }));
          return;
        }
        var wrap = el('div', { class: 'space-y-4' });
        days.forEach(function (day) {
          var total = day.records.reduce(function (s, r) { return s + num(r.totalAmount); }, 0);
          var heads = ['Employee','Vehicle','Opening','Closing','Official','Fuel ₹','Misc ₹','Total ₹'];
          var tbody = el('tbody');
          day.records.forEach(function (r) {
            var closingCell = r.closingMeter != null
              ? el('td', { class: 'px-4 py-2.5', text: fmt(r.closingMeter) })
              : el('td', { class: 'px-4 py-2.5' }, [el('span', { class: 'badge badge-yellow', text: 'Open' })]);
            tbody.appendChild(el('tr', { class: 'table-row' }, [
              el('td', { class: 'px-4 py-2.5 font-medium', text: (r.user && r.user.name) || '—' }),
              el('td', { class: 'px-4 py-2.5 text-muted', text: r.vehicleDetails || r.vehicleType || '—' }),
              el('td', { class: 'px-4 py-2.5', text: fmt(r.openingMeter) }),
              closingCell,
              el('td', { class: 'px-4 py-2.5', text: r.officialKm != null ? fmt(r.officialKm) : '—' }),
              el('td', { class: 'px-4 py-2.5', text: r.fuelCost != null ? fmt(r.fuelCost) : '—' }),
              el('td', { class: 'px-4 py-2.5', text: fmt(r.miscAmount) }),
              el('td', { class: 'px-4 py-2.5 font-semibold', text: r.totalAmount != null ? fmt(r.totalAmount) : '—' })
            ]));
          });
          wrap.appendChild(el('div', { class: 'card overflow-hidden' }, [
            el('div', { class: 'px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between' }, [
              el('span', { class: 'text-sm font-semibold text-slate-900 dark:text-slate-100', text: fmtDate(day.date) }),
              el('span', { class: 'text-xs text-muted', text: '₹' + fmt(total) + ' total' })
            ]),
            el('div', { class: 'overflow-x-auto' }, [
              el('table', { class: 'w-full text-sm' }, [
                el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [
                  el('tr', {}, heads.map(function (h) {
                    return el('th', { class: 'table-head text-left px-4 py-2.5 whitespace-nowrap', text: h });
                  }))
                ]), tbody
              ])
            ])
          ]));
        });
        bodySlot.appendChild(wrap);
      }).catch(function (e) {
        bodySlot.innerHTML = '';
        bodySlot.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: e.message }));
      });
    }

    function buildTabs() {
      if (!isAdmin()) return;
      tabsSlot.classList.remove('hidden');
      tabsSlot.innerHTML = '';
      [['mine', 'My log'], ['all', 'All employees']].forEach(function (t) {
        tabsSlot.appendChild(el('button', {
          class: 'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
                 (tab === t[0] ? 'border-primary text-primary dark:text-primary-300'
                               : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'),
          text: t[1],
          onclick: function () { tab = t[0]; buildTabs(); loadBody(); }
        }));
      });
    }

    function loadBody() { tab === 'all' ? loadAllUsers() : loadMine(); }
    function loadAll() { loadToday(); loadBody(); }

    render();
    buildTabs();
    loadProfile();
    loadAll();
  }

  // ── edit an existing entry ──────────────────────────────────────────
  function openEdit(record, onDone) {
    var overlay = el('div', {
      class: 'fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4'
    });
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    var closing = input({ type: 'number', value: record.closingMeter != null ? record.closingMeter : '' });
    var personal = input({ type: 'number', value: record.personalKm != null ? record.personalKm : 0 });
    var miscAmt = input({ type: 'number', value: record.miscAmount != null ? record.miscAmount : 0 });
    var miscDesc = input({ value: record.miscDesc || '' });
    var customers = input({ value: record.customersVisited || '' });
    var errP = el('p', { class: 'text-xs text-red-600 dark:text-red-400 hidden' });

    var save = el('button', { class: 'btn-primary', text: 'Save' });
    save.addEventListener('click', function () {
      save.disabled = true;
      errP.classList.add('hidden');
      var body = {
        personalKm: num(personal.value),
        miscAmount: num(miscAmt.value),
        miscDesc: miscDesc.value || undefined,
        customersVisited: customers.value || undefined
      };
      if (closing.value !== '') body.closingMeter = num(closing.value);
      api('PATCH', '/fuel-expense/' + record.id, body)
        .then(function () { close(); if (onDone) onDone(); })
        .catch(function (e) {
          save.disabled = false;
          errP.textContent = e.message;
          errP.classList.remove('hidden');
        });
    });

    overlay.appendChild(el('div', {
      class: 'card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-xl', role: 'dialog', 'aria-modal': 'true'
    }, [
      el('h2', { class: 'section-title', text: 'Edit entry — ' + fmtDate(record.date) }),
      el('p', {
        class: 'text-xs text-muted mt-0.5 mb-4',
        text: 'Opened at ' + fmt(record.openingMeter) + ' km. Official km and fuel cost recalculate on save.'
      }),
      el('div', { class: 'space-y-3' }, [
        field('Closing meter (km)', closing),
        el('div', { class: 'grid grid-cols-2 gap-3' }, [
          field('Personal km', personal), field('Misc. amount (₹)', miscAmt)
        ]),
        field('Misc. description', miscDesc),
        field('Customers visited', customers),
        errP
      ]),
      el('div', { class: 'flex gap-2 justify-end mt-5' }, [
        el('button', { class: 'btn-secondary', text: 'Cancel', onclick: close }), save
      ])
    ]));
    document.body.appendChild(overlay);
  }

  // ── boot ────────────────────────────────────────────────────────────
  installPunchHook();

  window.FuelExpense = {
    mountPage: mountPage,
    openMeterDialog: openMeterDialog
  };
})();
