/* ══════════════════════════════════════════════════════════════════════
   Location history — replay any person's day on a map.

   Super Admin / Admin / Manager pick a person and a date (a strip shows
   which days that month have tracking data) and see:
     - the route travelled (every location point), punch in / punch out
     - stops of 10+ minutes in one place, tea / lunch breaks, stationary and
       location-off alerts
     - distance, points, hours, break time, and a slider to replay the day.
   Data: GET /api/tracking/users | days | history (LocationHistoryController).
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
      '.lh-pin{width:16px;height:16px;border-radius:9999px;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}',
      '.lh-emoji{font-size:20px;line-height:20px;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function mount(root) {
    injectCss();
    var params = new URLSearchParams(location.search);
    var state = { userId: params.get('user') || '', date: params.get('date') || iso(new Date()), users: [], data: null };
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
        el('p', { class: 'text-sm text-muted mt-1', text: 'Replay where an engineer or any user travelled on a previous day — route, stops, breaks and alerts. Location is recorded every 2 minutes while someone is punched in.' })
      ]),
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

    api('/tracking/users').then(function (r) {
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
      api('/tracking/days?userId=' + encodeURIComponent(state.userId) + '&month=' + state.date.slice(0, 7)).then(function (r) {
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
      Promise.all([api('/tracking/history?userId=' + encodeURIComponent(state.userId) + '&date=' + state.date), loadLeaflet().catch(function (e) { return e; })])
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
          stat('Distance', st.distanceKm + ' km'),
          stat('Location points', String(st.points)),
          stat('Break time', st.breakSeconds ? dur(st.breakSeconds) : 'None')
        ]),
        a && a.checkInLat === null ? el('p', { class: 'text-xs', style: 'color:#b91c1c', text: '⚠ Punched in without location.' }) : null
      ]));

      // timeline
      var evs = [];
      if (a && a.checkIn) evs.push({ at: a.checkIn, i: '🟢', text: 'Punched in', lat: a.checkInLat, lng: a.checkInLng });
      (d.stops || []).forEach(function (s) { evs.push({ at: s.from, i: '⏸', text: 'Stopped ' + s.minutes + ' min (until ' + tm(s.to) + ')', lat: s.lat, lng: s.lng }); });
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
        tl.appendChild(el('div', { class: 'lh-ev', onclick: function () { if (map && e.lat != null) map.setView([e.lat, e.lng], 16); } }, [
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
      if (pts.length) {
        var line = pts.map(function (p) { return [p.lat, p.lng]; });
        L.polyline(line, { color: '#2563eb', weight: 4, opacity: .8 }).addTo(layers);
        pts.forEach(function (p) { L.circleMarker([p.lat, p.lng], { radius: 2.5, color: '#1d4ed8', weight: 1, fillOpacity: .9 }).bindTooltip(tm(p.capturedAt)).addTo(layers); });
        bounds = bounds.concat(line);
      }
      if (a && a.checkInLat != null) { L.marker([a.checkInLat, a.checkInLng], { icon: pin('#16a34a') }).bindPopup('Punched in ' + tm(a.checkIn)).addTo(layers); bounds.push([a.checkInLat, a.checkInLng]); }
      if (a && a.checkOutLat != null) { L.marker([a.checkOutLat, a.checkOutLng], { icon: pin('#dc2626') }).bindPopup('Punched out ' + tm(a.checkOut)).addTo(layers); bounds.push([a.checkOutLat, a.checkOutLng]); }
      (d.stops || []).forEach(function (s) {
        L.circle([s.lat, s.lng], { radius: 60, color: '#d97706', fillColor: '#fbbf24', fillOpacity: .35, weight: 2 })
          .bindPopup('Stopped ' + s.minutes + ' min<br>' + tm(s.from) + ' – ' + tm(s.to)).addTo(layers);
      });
      (d.breaks || []).forEach(function (b) {
        if (b.lat == null) return;
        L.marker([b.lat, b.lng], { icon: emoji(b.type === 'LUNCH' ? '🍽' : '☕') }).bindPopup((b.type === 'LUNCH' ? 'Lunch' : 'Tea') + ' break ' + tm(b.startedAt) + (b.endedAt ? ' – ' + tm(b.endedAt) : '')).addTo(layers);
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

  window.LocationHistory = { mountPage: mount };
})();
