/* ══════════════════════════════════════════════════════════════════════
   Location history — replay any person's day on a map.

   Super Admin / Admin / Manager pick a person and a date (a strip shows
   which days that month have tracking data) and see:
     - the route travelled (every location point), punch in / punch out
     - pins in order: start → stops of 30+ minutes and customers reached (📍 with the name) → end, joined, with the km
       of each leg and the day's total (standing still adds no km), tea / lunch breaks, stationary and
       location-off alerts
     - distance, points, hours, break time, and a slider to replay the day.
   Data: GET /api/route-log/users | days | history (LocationHistoryController).
   Map: Leaflet 1.9.4 (bundled in /vendor/leaflet) + OpenStreetMap tiles.

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var LEAFLET_CSS = '/vendor/leaflet/leaflet.css'; // bundled (no CDN needed)
  var LEAFLET_JS = '/vendor/leaflet/leaflet.js';

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function api(path) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error((j && j.message) || 'Request failed'); return j; });
    });
  }
  function el(tag, attrs, kids) { return window.AppShell.el(tag, attrs, kids); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function tm(s) { if (!s) return '—'; var d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? s : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function dur(sec) { sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? h + 'h ' + m + 'm' : m + ' min'; }

  var leafletReady = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletReady) return leafletReady;
    leafletReady = new Promise(function (res, rej) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET_CSS; document.head.appendChild(css);
      var sc = document.createElement('script'); sc.src = LEAFLET_JS;
      sc.onload = function () { res(window.L); };
      sc.onerror = function () { rej(new Error('The map library could not be loaded — make sure crm/vendor/leaflet/ was uploaded.')); };
      document.head.appendChild(sc);
    });
    return leafletReady;
  }

  function injectCss() {
    if (document.getElementById('lh-css')) return;
    var st = document.createElement('style');
    st.id = 'lh-css';
    st.textContent = [
      '.lh-bar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:end}',
      '.lh-in{border:1px solid #cbd5e1;border-radius:.5rem;padding:.5rem .7rem;font-size:.875rem;background:#fff;color:#0f172a}',
      '.dark .lh-in{background:#0f172a;border-color:#334155;color:#f1f5f9}',
      '.lh-lab{display:block;font-size:.75rem;font-weight:500;color:#64748b;margin-bottom:.25rem}',
      '.lh-days{display:flex;gap:.3rem;flex-wrap:wrap}',
      '.lh-day{min-width:2rem;padding:.25rem .4rem;border-radius:.4rem;border:1px solid #e2e8f0;background:#fff;font-size:.75rem;cursor:pointer;color:#94a3b8}',
      '.lh-day.has{color:#0f172a;border-color:#93c5fd;background:#eff6ff;font-weight:600}',
      '.lh-day.nogps{border-color:#fca5a5;background:#fef2f2}',
      '.lh-day.on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}',
      '.lh-grid{display:grid;gap:1rem;grid-template-columns:1fr}',
      '@media(min-width:1100px){.lh-grid{grid-template-columns:minmax(0,1fr) 360px}}',
      '#lh-map{height:560px;border-radius:.75rem;border:1px solid #e2e8f0;z-index:0}',
      '.lh-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}',
      '.lh-stat{background:#f8fafc;border-radius:.5rem;padding:.55rem .7rem}.dark .lh-stat{background:#1e293b}',
      '.lh-stat p{margin:0}.lh-stat .k{font-size:.72rem;color:#64748b}.lh-stat .v{font-size:1.05rem;font-weight:700;color:#0f172a}.dark .lh-stat .v{color:#f1f5f9}',
      '.lh-tl{max-height:330px;overflow:auto}',
      '.lh-ev{display:flex;gap:.6rem;padding:.5rem .2rem;border-top:1px solid #f1f5f9;cursor:pointer;font-size:.84rem}.lh-ev:first-child{border-top:0}',
      '.lh-ev:hover{background:#f8fafc}.dark .lh-ev{border-color:#1e293b}.dark .lh-ev:hover{background:#1e293b}',
      '.lh-ev .t{width:4.6rem;flex-shrink:0;color:#64748b;font-variant-numeric:tabular-nums}',
      '.lh-ev .i{width:1.5rem;text-align:center;flex-shrink:0}',
      '.lh-play{display:flex;gap:.6rem;align-items:center;margin-top:.6rem}.lh-play input{flex:1}',
      '.lh-empty{display:flex;align-items:center;justify-content:center;height:560px;border:1px dashed #cbd5e1;border-radius:.75rem;color:#64748b;text-align:center;padding:1rem}',
      '.lh-stop{width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#d97706;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font:700 12px/1 system-ui,sans-serif}',
      '.lh-stop span{transform:rotate(45deg)}',
      '.lh-ev-stop{font-weight:600;color:#92400e}.dark .lh-ev-stop{color:#fcd34d}',
            '.lh-pin{width:16px;height:16px;border-radius:9999px;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}',
      '.lh-emoji{font-size:20px;line-height:20px;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}',
      '.lh-mk{display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)}',
      '.lh-mk .b{width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}',
      '.lh-mk .b span{transform:rotate(45deg);color:#fff;font:700 12px/1 system-ui,sans-serif}',
      '.lh-mk .lb{margin-top:3px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:6px;padding:1px 6px;font:600 11px/1.4 system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2);max-width:180px;overflow:hidden;text-overflow:ellipsis}',
      '.lh-pins{display:grid;gap:0}.lh-p{display:grid;grid-template-columns:2rem 1fr auto;gap:.5rem;align-items:start;padding:.45rem .2rem;cursor:pointer;border-radius:.4rem}.lh-p:hover{background:#f8fafc}.dark .lh-p:hover{background:#1e293b}',
      '.lh-p .no{width:1.7rem;height:1.7rem;border-radius:999px;color:#fff;display:flex;align-items:center;justify-content:center;font:700 .72rem/1 system-ui,sans-serif}',
      '.lh-p .t{font-size:.84rem;font-weight:600;color:#0f172a}.dark .lh-p .t{color:#f1f5f9}.lh-p .s{font-size:.74rem;color:#64748b}',
      '.lh-leg{font-size:.72rem;color:#2563eb;padding:0 0 0 2.6rem;margin:-.1rem 0}',
      '.lh-p .km{font-size:.78rem;font-weight:700;color:#2563eb;white-space:nowrap}',
      '.lh-tot{display:flex;justify-content:space-between;border-top:2px solid #e2e8f0;margin-top:.4rem;padding-top:.5rem;font-weight:700}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── Kilometres travelled: everyone, over a period ─────────────────────
  function kmCard(open) {
    var box = el('div', { class: 'card overflow-hidden', id: 'lh-km' });
    var now = new Date();
    var from = el('input', { type: 'date', class: 'lh-in', id: 'lh-km-from', 'aria-label': 'From', value: iso(new Date(now.getFullYear(), now.getMonth(), 1)) });
    var to = el('input', { type: 'date', class: 'lh-in', id: 'lh-km-to', 'aria-label': 'To', value: iso(now) });
    var body = el('div', {});
    var openRow = null;
    function load() {
      body.innerHTML = ''; body.appendChild(el('p', { class: 'px-5 py-3 text-sm text-muted', text: 'Loading…' }));
      api('/route-log/summary?from=' + from.value + '&to=' + to.value).then(function (j) {
        var d = j.data; body.innerHTML = '';
        if (!d.people.length) { body.appendChild(el('p', { class: 'px-5 py-3 text-sm text-muted', text: 'No one punched in during these dates.' })); return; }
        var tb = el('tbody');
        d.people.forEach(function (p) {
          var tr = el('tr', { class: 'table-row cursor-pointer', 'data-km-user': p.id, title: 'Show each day' }, [
            el('td', { class: 'px-4 py-2 font-medium', text: p.name }),
            el('td', { class: 'px-4 py-2 text-right font-semibold' }, [p.km.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km',
              p.manualKm ? el('div', { class: 'text-xs text-muted', 'data-manual-km': p.id, title: 'Km typed at punch out for the time the phone / GPS was off', text: '+ ' + p.manualKm.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km typed (GPS off)' }) : null]),
            el('td', { class: 'px-4 py-2 text-right', text: p.odometerKm != null ? p.odometerKm.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km' : '—' }),
            el('td', { class: 'px-4 py-2 text-right', text: String(p.days) }),
            el('td', { class: 'px-4 py-2 text-right', text: p.days ? (p.km / p.days).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km' : '—' }),
            el('td', { class: 'px-4 py-2 text-right', style: p.locationOff ? 'color:#b91c1c;font-weight:600' : '', text: p.locationOff ? '📵 ' + p.locationOff : '—' })
          ]);
          var det = el('tr', { style: 'display:none', 'data-km-days': p.id }, [el('td', { colspan: '6', class: 'px-4 pb-3' }, [el('div', { class: 'lh-days' }, p.perDay.map(function (x) {
            return el('button', { type: 'button', class: 'lh-day has', title: x.points + ' points', onclick: function () { open(p.id, x.date); window.scrollTo({ top: box.getBoundingClientRect().bottom + window.scrollY, behavior: 'smooth' }); },
              text: new Date(x.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' · ' + x.km + ' km' });
          }))])]);
          tr.addEventListener('click', function () { var on = det.style.display === 'none'; if (openRow && openRow !== det) openRow.style.display = 'none'; det.style.display = on ? '' : 'none'; openRow = on ? det : null; });
          tb.appendChild(tr); tb.appendChild(det);
        });
        tb.appendChild(el('tr', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [
          el('td', { class: 'px-4 py-2 font-bold', text: 'Everyone' }),
          el('td', { class: 'px-4 py-2 text-right font-bold', text: d.totals.km.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km' }),
          el('td', { class: 'px-4 py-2 text-right font-bold', text: d.totals.odometerKm ? d.totals.odometerKm.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km' : '—' }),
          el('td', { class: 'px-4 py-2 text-right font-bold', text: String(d.totals.days) }), el('td', {}), el('td', {})]));
        body.appendChild(el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-sm', id: 'lh-km-table' }, [
          el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, ['Engineer', 'GPS route', 'Odometer (entered)', 'Days', 'Per day', 'Location off'].map(function (h, i) {
            return el('th', { class: 'table-head px-4 py-2 ' + (i ? 'text-right' : 'text-left'), text: h }); }))]), tb])]));
        body.appendChild(el('p', { class: 'px-5 py-2 text-xs text-muted', text: 'GPS route = the road distance from the tracked points (vague points and GPS glitches are left out). Odometer = the readings entered at punch in / out. Click a name to see each day; click a day to replay it on the map.' }));
      }).catch(function (e) { body.innerHTML = ''; body.appendChild(el('p', { class: 'px-5 py-3 text-sm', style: 'color:#b91c1c', text: e.message })); });
    }
    from.addEventListener('change', load); to.addEventListener('change', load);
    box.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-end justify-between gap-3' }, [
      el('span', { class: 'text-base font-semibold', text: '🚗 Kilometres travelled' }),
      el('div', { class: 'flex flex-wrap gap-2 items-end' }, [el('label', {}, [el('span', { class: 'lh-lab', text: 'From' }), from]), el('label', {}, [el('span', { class: 'lh-lab', text: 'To' }), to])])
    ]));
    box.appendChild(body);
    load();
    return box;
  }

  function mount(root) {
    injectCss();
    var params = new URLSearchParams(location.search);
    var state = { userId: params.get('user') || params.get('userId') || '', date: params.get('date') || iso(new Date()), users: [], data: null };
    var map = null, layers = null, playMarker = null;

    var userSel = el('select', { class: 'lh-in', 'aria-label': 'Person', style: 'min-width:220px' }, [el('option', { value: '', text: 'Loading people…' })]);
    var dateIn = el('input', { type: 'date', class: 'lh-in', 'aria-label': 'Date' });
    dateIn.value = state.date;
    var days = el('div', { class: 'lh-days' });
    var mapBox = el('div');
    var side = el('div', { class: 'space-y-3' });

    root.appendChild(el('div', { class: 'space-y-4' }, [
      el('div', {}, [
        el('h1', { class: 'page-title', text: 'Location history' }),
        el('p', { class: 'text-sm text-muted mt-1', text: 'Replay where an engineer or any user travelled on a previous day — route, stops, breaks and alerts. Location is recorded while someone is punched in: every 30 seconds while moving, every 2 minutes when standing still (the Android app keeps recording when the app is closed).' })
      ]),
      kmCard(function (uid, d) { state.userId = uid; userSel.value = uid; setDate(d); syncUrl(); loadDays(); }),
      el('div', { class: 'card p-4 space-y-3' }, [
        el('div', { class: 'lh-bar' }, [
          el('label', {}, [el('span', { class: 'lh-lab', text: 'Person' }), userSel]),
          el('label', {}, [el('span', { class: 'lh-lab', text: 'Date' }), dateIn]),
          el('div', { class: 'flex gap-2' }, [
            el('button', { class: 'btn-secondary', type: 'button', text: '‹ Previous day', onclick: function () { shift(-1); } }),
            el('button', { class: 'btn-secondary', type: 'button', text: 'Next day ›', onclick: function () { shift(1); } }),
            el('button', { class: 'btn-secondary', type: 'button', text: 'Today', onclick: function () { setDate(iso(new Date())); } })
          ])
        ]),
        el('div', {}, [el('span', { class: 'lh-lab', text: 'Days with tracking this month (red = punched in without location)' }), days])
      ]),
      el('div', { class: 'lh-grid' }, [mapBox, side])
    ]));

    userSel.addEventListener('change', function () { state.userId = userSel.value; syncUrl(); loadDays(); loadHistory(); });
    dateIn.addEventListener('change', function () { if (dateIn.value) setDate(dateIn.value); });

    function syncUrl() {
      var q = new URLSearchParams(); if (state.userId) q.set('user', state.userId); q.set('date', state.date);
      history.replaceState(null, '', location.pathname + '?' + q.toString());
    }
    function setDate(d) {
      var monthChanged = d.slice(0, 7) !== state.date.slice(0, 7);
      state.date = d; dateIn.value = d; syncUrl();
      if (monthChanged) loadDays(); else markDay();
      loadHistory();
    }
    function shift(n) { var d = new Date(state.date + 'T00:00:00'); d.setDate(d.getDate() + n); setDate(iso(d)); }

    api('/route-log/users').then(function (r) {
      state.users = r.data.users || [];
      userSel.innerHTML = '';
      userSel.appendChild(el('option', { value: '', text: 'Choose a person…' }));
      state.users.forEach(function (u) { userSel.appendChild(el('option', { value: u.id, text: u.name + ' · ' + String(u.role || '').replace('_', ' ').toLowerCase() })); });
      if (state.userId) userSel.value = state.userId;
      loadDays(); loadHistory();
    }).catch(function (e) { mapBox.innerHTML = ''; mapBox.appendChild(el('div', { class: 'lh-empty', text: e.message })); });

    var dayData = [];
    function loadDays() {
      days.innerHTML = '';
      if (!state.userId) return;
      api('/route-log/days?userId=' + encodeURIComponent(state.userId) + '&month=' + state.date.slice(0, 7)).then(function (r) {
        dayData = r.data.days || [];
        var y = Number(state.date.slice(0, 4)), m = Number(state.date.slice(5, 7));
        var n = new Date(y, m, 0).getDate();
        for (var d = 1; d <= n; d++) {
          (function (d) {
            var ds = state.date.slice(0, 8) + ('0' + d).slice(-2);
            var info = dayData.filter(function (x) { return x.date === ds; })[0];
            var b = el('button', {
              type: 'button', 'data-date': ds, text: String(d),
              class: 'lh-day' + (info ? ' has' : '') + (info && !info.locationAtPunchIn ? ' nogps' : ''),
              title: info ? ('Punch in ' + tm(info.checkIn) + (info.checkOut ? ' · out ' + tm(info.checkOut) : '') + ' · ' + info.points + ' location points') : 'No punch-in',
              onclick: function () { setDate(ds); }
            });
            days.appendChild(b);
          })(d);
        }
        markDay();
      }).catch(function () {});
    }
    function markDay() { Array.prototype.forEach.call(days.children, function (b) { b.classList.toggle('on', b.getAttribute('data-date') === state.date); }); }

    function loadHistory() {
      side.innerHTML = '';
      if (!state.userId) {
        mapBox.innerHTML = ''; map = null;
        mapBox.appendChild(el('div', { class: 'lh-empty', text: 'Choose a person to see where they travelled.' }));
        return;
      }
      mapBox.innerHTML = ''; map = null;
      mapBox.appendChild(el('div', { class: 'lh-empty', text: 'Loading…' }));
      Promise.all([api('/route-log/history?userId=' + encodeURIComponent(state.userId) + '&date=' + state.date), loadLeaflet().catch(function (e) { return e; })])
        .then(function (res) {
          state.data = res[0].data;
          render(res[1] instanceof Error ? res[1] : null);
        }).catch(function (e) { mapBox.innerHTML = ''; mapBox.appendChild(el('div', { class: 'lh-empty', text: e.message })); });
    }

    function render(mapErr) {
      var d = state.data, a = d.attendance, st = d.stats;
      // ── side panel ──
      side.innerHTML = '';
      var hrs = a && a.checkIn ? ((new Date(String(a.checkOut || '').replace(' ', 'T')).getTime() || Date.now()) - new Date(String(a.checkIn).replace(' ', 'T')).getTime()) / 1000 : 0;
      side.appendChild(el('div', { class: 'card p-4 space-y-3' }, [
        el('div', {}, [
          el('p', { class: 'font-semibold text-slate-900', text: d.user.name }),
          el('p', { class: 'text-xs text-muted', text: new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) })
        ]),
        el('div', { class: 'lh-stats' }, [
          stat('Punch in', a ? tm(a.checkIn) : 'No punch-in'),
          stat('Punch out', a ? (a.checkOut ? tm(a.checkOut) : (a.checkIn ? 'Still working' : '—')) : '—'),
          stat('Time on duty', a && a.checkIn ? dur(hrs) : '—'),
          stat('Travelled (overall)', st.distanceKm + ' km' + (st.manualKm ? ' + ' + st.manualKm + ' typed' : '')),
          stat('Customers reached', String(st.customersReached || 0)),
          stat('Stops (' + (st.stopMinutes || 30) + '+ min)', st.stops ? st.stops + ' · ' + dur((st.stoppedMinutes || 0) * 60) : 'None'),
          stat('Location points', String(st.points)),
          stat('Break time', st.breakSeconds ? dur(st.breakSeconds) : 'None')
        ]),
        a && a.checkInLat === null ? el('p', { class: 'text-xs', style: 'color:#b91c1c', text: '⚠ Punched in without location.' }) : null
      ]));

      // pin to pin: start → stops / customers → end, with the km of each leg
      var pins = d.pins || [];
      if (pins.length) {
        var pl = el('div', { class: 'lh-pins', id: 'lh-pins' });
        pins.forEach(function (p, i) {
          pl.appendChild(el('div', { class: 'lh-p', 'data-pin': p.n, onclick: function () { if (map) map.setView([p.lat, p.lng], 16); } }, [
            el('span', { class: 'no', style: 'background:' + PCOL[p.kind], text: pinLabel(p) }),
            el('div', {}, [el('div', { class: 't', text: pinTitle(p) }),
              el('div', { class: 's', text: tm(p.from) + (p.minutes ? ' – ' + tm(p.to) + ' · ' + dur(p.minutes * 60) : '') + (p.how === 'check-in' ? ' · visit check-in' : p.how === 'location' ? ' · at the customer\'s location' : '') })]),
            el('span', { class: 'km', text: i ? '+' + p.kmFromPrev.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km' : '' })
          ]));
        });
        pl.appendChild(el('div', { class: 'lh-tot', id: 'lh-pin-total' }, [el('span', { text: 'Total · ' + (st.customersReached || 0) + ' customer' + (st.customersReached === 1 ? '' : 's') + ' reached' }), el('span', { text: (st.pinKm != null ? st.pinKm : st.distanceKm).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km' })]));
        side.appendChild(el('div', { class: 'card p-4' }, [el('p', { class: 'font-semibold mb-2', text: 'Route by pins' }), pl]));
      }

      // timeline
      var evs = [];
      if (a && a.checkIn) evs.push({ at: a.checkIn, i: '🟢', text: 'Punched in', lat: a.checkInLat, lng: a.checkInLng });
      pins.forEach(function (p) {
        if (p.kind !== 'STOP' && p.kind !== 'VISIT') return;
        evs.push({ at: p.from, i: p.kind === 'VISIT' ? '📍' : '⏸', text: pinTitle(p) + ' — ' + dur(p.minutes * 60) + ' (' + tm(p.from) + ' – ' + tm(p.to) + ')', lat: p.lat, lng: p.lng, stop: p.n });
        evs.push({ at: p.to, i: '▶', text: 'Moving again', lat: p.lat, lng: p.lng });
      });
      (d.breaks || []).forEach(function (b) { evs.push({ at: b.startedAt, i: b.type === 'LUNCH' ? '🍽' : '☕', text: (b.type === 'LUNCH' ? 'Lunch' : 'Tea') + ' break · ' + (b.endedAt ? dur(b.seconds) + ' (to ' + tm(b.endedAt) + ')' : 'not ended') + (b.trigger === 'AUTO' ? ' · after 30-min prompt' : ''), lat: b.lat, lng: b.lng }); });
      (d.events || []).forEach(function (e) {
        evs.push({ at: e.detectedAt, i: e.type === 'LOCATION_OFF' ? '📵' : '⚠', lat: e.lat, lng: e.lng,
          text: e.type === 'LOCATION_OFF' ? 'Location turned off' : 'Same place ' + (e.minutes || 30) + '+ min — ' + (e.type === 'STATIONARY_WORKING' ? 'said "working here"' : 'no answer to break prompt') });
      });
      if (a && a.checkOut) evs.push({ at: a.checkOut, i: '🔴', text: 'Punched out', lat: a.checkOutLat, lng: a.checkOutLng });
      evs.sort(function (x, y) { return String(x.at).localeCompare(String(y.at)); });
      var tl = el('div', { class: 'lh-tl' });
      if (!evs.length) tl.appendChild(el('p', { class: 'text-sm text-muted', text: 'Nothing recorded on this day.' }));
      evs.forEach(function (e) {
        tl.appendChild(el('div', { class: 'lh-ev' + (e.stop ? ' lh-ev-stop' : ''), onclick: function () { if (map && e.lat != null) map.setView([e.lat, e.lng], 16); } }, [
          el('span', { class: 't', text: tm(e.at) }), el('span', { class: 'i', text: e.i }), el('span', { text: e.text })
        ]));
      });
      side.appendChild(el('div', { class: 'card p-4' }, [el('p', { class: 'font-semibold mb-2', text: 'Timeline' }), tl]));

      // ── map ──
      mapBox.innerHTML = '';
      if (mapErr) { mapBox.appendChild(el('div', { class: 'lh-empty', text: mapErr.message })); return; }
      var pts = d.points || [];
      var hasAny = pts.length || (a && a.checkInLat != null);
      if (!hasAny) {
        mapBox.appendChild(el('div', { class: 'lh-empty', text: a ? 'No location was recorded on this day.' : 'No punch-in on this day.' }));
        return;
      }
      var div = el('div', { id: 'lh-map' });
      var slider = el('input', { type: 'range', min: '0', max: String(Math.max(0, pts.length - 1)), value: String(Math.max(0, pts.length - 1)), 'aria-label': 'Replay the day' });
      var when = el('span', { class: 'text-sm font-medium', style: 'min-width:6rem', text: pts.length ? tm(pts[pts.length - 1].capturedAt) : '' });
      mapBox.appendChild(el('div', { class: 'card p-3' }, [div, pts.length > 1 ? el('div', { class: 'lh-play' }, [el('span', { class: 'text-xs text-muted', text: 'Replay' }), slider, when]) : null]));

      var L = window.L;
      map = L.map(div, { scrollWheelZoom: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      layers = L.layerGroup().addTo(map);
      var bounds = [];
      function pin(color) { return L.divIcon({ className: '', html: '<div class="lh-pin" style="background:' + color + '"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }); }
      function emoji(ch) { return L.divIcon({ className: '', html: '<div class="lh-emoji">' + ch + '</div>', iconSize: [22, 22], iconAnchor: [11, 11] }); }
      // the route: the cleaned path the km are measured on (vague tower fixes, jitter and glitches left out)
      var path = (d.path || []).map(function (p) { return [p.lat, p.lng]; });
      if (path.length > 1) L.polyline(path, { color: '#2563eb', weight: 5, opacity: .85, lineJoin: 'round' }).addTo(layers);
      bounds = bounds.concat(path);
      var rawLayer = L.layerGroup();
      pts.forEach(function (p) { rawLayer.addLayer(L.circleMarker([p.lat, p.lng], { radius: 2.5, color: p.accuracy != null && p.accuracy > 150 ? '#f97316' : '#64748b', weight: 1, fillOpacity: .8 }).bindTooltip(tm(p.capturedAt) + (p.accuracy != null ? ' · ±' + Math.round(p.accuracy) + ' m' : ''))); });
      // pins joined in order, start → … → end (dashed), each a marker
      var pinsLL = pins.map(function (p) { return [p.lat, p.lng]; });
      if (pinsLL.length > 1) L.polyline(pinsLL, { color: '#7c3aed', weight: 2, opacity: .7, dashArray: '6 6' }).addTo(layers);
      pins.forEach(function (p) {
        var lab = p.kind === 'VISIT' ? p.customer : p.kind === 'START' ? 'Start ' + tm(p.from) : p.kind === 'END' ? 'End ' + tm(p.from) : p.kind === 'NOW' ? 'Last seen ' + tm(p.from) : '';
        var html = '<div class="lh-mk" data-pin-mk="' + p.n + '" data-kind="' + p.kind + '"><div class="b" style="background:' + PCOL[p.kind] + '"><span>' + pinLabel(p) + '</span></div>' + (lab ? '<div class="lb">' + escH(lab) + '</div>' : '') + '</div>';
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: html, iconSize: [30, 30], iconAnchor: [15, 34] }), zIndexOffset: p.kind === 'VISIT' ? 800 : 600 })
          .bindPopup('<b>' + escH(pinTitle(p)) + '</b><br>' + tm(p.from) + (p.minutes ? ' – ' + tm(p.to) + ' · ' + dur(p.minutes * 60) : '') + (p.n > 1 ? '<br>+' + p.kmFromPrev + ' km from the pin before' : '')).addTo(layers);
        if (p.kind === 'STOP' || p.kind === 'VISIT') L.circle([p.lat, p.lng], { radius: 60, color: PCOL[p.kind], fillColor: PCOL[p.kind], fillOpacity: .15, weight: 1.2 }).addTo(layers);
        bounds.push([p.lat, p.lng]);
      });
      var rawCtl = L.control({ position: 'topright' });
      rawCtl.onAdd = function () {
        var d2 = L.DomUtil.create('label', '');
        d2.style.cssText = 'background:#fff;padding:4px 8px;border-radius:6px;font:12px system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;gap:5px;align-items:center;cursor:pointer;color:#0f172a';
        d2.innerHTML = '<input type="checkbox" id="lh-raw"> Every GPS point';
        L.DomEvent.disableClickPropagation(d2);
        d2.querySelector('input').addEventListener('change', function (e) { if (e.target.checked) rawLayer.addTo(map); else map.removeLayer(rawLayer); });
        return d2;
      };
      rawCtl.addTo(map);
      (d.breaks || []).forEach(function (b) {
        if (b.lat == null) return;
        L.marker([b.lat, b.lng], { icon: emoji(b.type === 'LUNCH' ? '🍽' : '☕') }).bindPopup((b.type === 'LUNCH' ? 'Lunch' : 'Tea') + ' break ' + tm(b.startedAt) + (b.endedAt ? ' – ' + tm(b.endedAt) : '')).addTo(layers);
      });
      // where the location was turned off
      (d.events || []).forEach(function (e) {
        if (e.type !== 'LOCATION_OFF' || e.lat == null) return;
        L.marker([e.lat, e.lng], { icon: emoji('📵') }).bindPopup('Location turned off ' + tm(e.detectedAt)).addTo(layers);
        bounds.push([e.lat, e.lng]);
      });
      if (bounds.length === 1) map.setView(bounds[0], 15); else map.fitBounds(bounds, { padding: [30, 30] });
      if (pts.length > 1) {
        playMarker = L.marker([pts[pts.length - 1].lat, pts[pts.length - 1].lng], { icon: pin('#1e3a5f'), zIndexOffset: 1000 }).addTo(map);
        slider.addEventListener('input', function () {
          var p = pts[Number(slider.value)];
          playMarker.setLatLng([p.lat, p.lng]);
          when.textContent = tm(p.capturedAt);
        });
      }
      setTimeout(function () { map.invalidateSize(); }, 50);
    }

    function stat(k, v) { return el('div', { class: 'lh-stat' }, [el('p', { class: 'k', text: k }), el('p', { class: 'v', text: v })]); }
  }

  var PCOL = { START: '#16a34a', STOP: '#d97706', VISIT: '#7c3aed', END: '#dc2626', NOW: '#1e3a5f' };
  function pinLabel(p) { return p.kind === 'START' ? '▶' : p.kind === 'END' ? '■' : p.kind === 'NOW' ? '●' : p.kind === 'VISIT' ? '📍' : String(p.stopNo || p.n); }
  function pinTitle(p) { return p.kind === 'START' ? 'Start — punched in' : p.kind === 'END' ? 'End — punched out' : p.kind === 'NOW' ? 'Last seen (still working)' : p.kind === 'VISIT' ? p.customer : 'Stop ' + (p.stopNo || p.n) + ' — stayed ' + dur(p.minutes * 60); }
  function escH(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  window.LocationHistory = { mountPage: mount };
})();
