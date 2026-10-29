/* ══════════════════════════════════════════════════════════════════════
   Site-wide runtime, loaded on every CRM page (React pages and the
   standalone ones alike, next to appointments-reminder-app.js).

   1. Live alerts with sound. Polls GET /api/alerts-feed every 30 s while
      a CRM tab is open and, for anything new that concerns you, plays a
      chime and shows a toast (and a desktop notification if you allowed
      them and the tab is in the background):
        - a task was assigned to you
        - a task you assigned was completed (Super Admin: any task)
        - new price request / your price request was answered
        - new trial request / your trial was approved or rejected /
          a trial was completed
      Pages can react too: a `crm-alert` event is dispatched on window
      with the new events (the Tasks and Trials pages refresh on it).
      Browsers only allow sound after you've clicked somewhere on the page
      once — until then the toast says so.

   2. CRM menu on every page. Pages that keep their own layout and have no
      CRM sidebar (Meetings, Quotations, Payroll…) get a floating "Menu"
      button that slides out the same sidebar (AppShell.drawer()).

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__crmGlobal) return;
  window.__crmGlobal = true;

  var API = 'https://api.apjtech.in';
  var POLL_MS = 30000;
  var path = location.pathname;
  // CRM name + logo (Admin → Notifications & branding) — on every page, the login page too.
  (function loadBrand() {
    if (window.__crmBrand || /^\/trial-sheet(\/|$)/.test(path)) return;
    var me = document.currentScript || document.querySelector('script[src*="crm-global.js"]');
    var v = me && /[?&]v=([^&]+)/.exec(me.getAttribute('src') || '');
    var sc = document.createElement('script');
    sc.src = '/crm-brand.js' + (v ? '?v=' + v[1] : '');
    (document.head || document.documentElement).appendChild(sc);
  })();
  // Android app: signed out → stop the background alerts on the phone.
  try { if (window.CRMNative && window.CRMNative.clearSession && !localStorage.getItem('crm_token')) window.CRMNative.clearSession(); } catch (e) {}
  if (/^\/(login|trial-sheet)(\/|$)/.test(path) || /^\/404/.test(path)) return;

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function user() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch (e) { return null; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  if (!token()) return;

  // ── 2. menu drawer on pages without a sidebar ───────────────────────
  function hasSidebar() {
    return !!document.getElementById('app-shell-aside') || !!document.querySelector('aside .sidebar-link');
  }
  function loadShell(cb) {
    if (window.AppShell) return cb();
    var sc = document.createElement('script');
    sc.src = '/app-shell.js';
    sc.onload = cb;
    document.head.appendChild(sc);
  }
  // React pages always draw their own sidebar — just a moment after loading,
  // so "no sidebar yet" must not be mistaken for "no sidebar".
  function isReactPage() {
    return !!(window.__next_f || document.querySelector('script[src*="/_next/static/chunks/main-app"]'));
  }
  // If the add-on menu (or the padding it docks with) ever ends up on a page
  // that has its own sidebar, take it away again.
  function dropExtraMenu() {
    if (!document.querySelector('aside .sidebar-link') && !document.getElementById('app-shell-aside')) return;
    var d = document.getElementById('crm-nav-drawer');
    if (d) d.remove();
    var html = document.documentElement;
    if (html.classList.contains('crm-docked') || html.classList.contains('crm-docked-early')) {
      html.classList.remove('crm-docked', 'crm-docked-early');
      html.style.paddingLeft = '';
    }
  }
  function ensureMenu() {
    if (isReactPage()) { dropExtraMenu(); return; }
    if (hasSidebar() || document.getElementById('crm-nav-drawer')) return;
    loadShell(function () { if (window.AppShell && AppShell.drawer && !hasSidebar() && !isReactPage()) AppShell.drawer(); });
  }

  // ── 5. React pages → hand-coded pages always open as a full page ──────
  // Pages like Meetings or Alerts exist both as an old page inside the React
  // app and as the newer hand-coded page. A React link would open the old one
  // (and a refresh the new one), so on React pages any click on such a link is
  // turned into a normal page load.
  var HARD_PAGES = /^\/(meetings|alerts|admin\/reports|admin\/users|admin\/location-history|orders|trials|tasks|appointments|fuel-expense|hr|payroll(\/[a-z-]+)?|quotations|cpr|price-requests|leaves|stock|chat|vendors|attendance|md-desk|accounts|catalogue|projects|tooled-up|machine-accessories|documents|sales-report|internal-meetings|mom|admin\/categories|admin\/notifications)\/?$/;
  function hardLinks() {
    if (!window.__next_f) return; // only the compiled React pages need this
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      var u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (x) { return; }
      if (u.origin !== location.origin || !HARD_PAGES.test(u.pathname)) return;
      e.preventDefault(); e.stopPropagation();
      location.assign(u.pathname.replace(/\/?$/, '/') + u.search + u.hash);
    }, true);
  }

  // ── 3. Products page: Excel template + import ───────────────────────
  // The Products page is part of the compiled React app, so the two buttons
  // are placed next to its "Add product" button (and put back if React
  // re-renders the header). Import is Admin / Super Admin, like the API.
  function isManager() { return ['SUPER_ADMIN', 'ADMIN'].indexOf((user() || {}).role) !== -1; }
  function productButtons() {
    if (!/^\/products\/?$/.test(location.pathname) || !isManager()) return;
    function place() {
      if (document.getElementById('crm-prod-import')) return;
      var add = Array.prototype.filter.call(document.querySelectorAll('button'), function (b) { return /add product/i.test(b.textContent || ''); })[0];
      if (!add || !add.parentNode) return;
      var wrap = document.createElement('span');
      wrap.id = 'crm-prod-import';
      wrap.style.cssText = 'display:inline-flex;gap:8px;margin-right:8px;vertical-align:middle';
      var tpl = document.createElement('button');
      tpl.type = 'button'; tpl.className = 'btn-secondary'; tpl.textContent = '⤓ Excel template';
      tpl.addEventListener('click', function () { downloadTemplate(tpl); });
      var imp = document.createElement('button');
      imp.type = 'button'; imp.className = 'btn-secondary'; imp.textContent = '⤒ Import from Excel';
      imp.addEventListener('click', openImport);
      wrap.appendChild(tpl); wrap.appendChild(imp);
      add.parentNode.insertBefore(wrap, add);
    }
    place();
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
  }
  /* A download must really be the file: Excel / zip start with "PK", PDF with "%PDF".
     If something was printed in front of it, cut it off; if the server sent an
     error page instead, show that message rather than saving a broken file. */
  function checkFile(b, name) {
    var sig = /\.(xlsx|zip)$/i.test(name || '') ? [80, 75, 3, 4] : /\.pdf$/i.test(name || '') ? [37, 80, 68, 70] : null;
    if (!sig || !b || !b.arrayBuffer) return Promise.resolve(b);
    return b.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), lim = Math.min(u.length - 4, 1 << 20);
      for (var i = 0; i <= lim; i++) {
        if (u[i] === sig[0] && u[i + 1] === sig[1] && u[i + 2] === sig[2] && u[i + 3] === sig[3]) return i === 0 ? b : new Blob([u.subarray(i)], { type: b.type });
      }
      var t = new TextDecoder().decode(u.subarray(0, 4000)), m = '';
      try { m = JSON.parse(t).message || ''; } catch (e) { m = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
      throw new Error('The server sent an error instead of the file' + (m ? ': ' + m : '.'));
    });
  }
  function downloadTemplate(btn) {
    var t = btn.textContent; btn.textContent = 'Downloading…';
    fetch(API + '/api/products/template', { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(function (b) { return checkFile(b, 'x.xlsx'); })
      .then(function (b) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'product-upload-template.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
      }).catch(function (e) { alert(e.message); }).then(function () { btn.textContent = t; });
  }
  function openImport() {
    var host = document.createElement('div');
    var sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = '<style>' +
      ':host{all:initial}.bk{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:2147483100;display:flex;align-items:center;justify-content:center;padding:16px;' +
      'font:14px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a}' +
      '.m{background:#fff;border-radius:14px;width:min(520px,100%);max-height:90vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(15,23,42,.35)}' +
      'h2{font-size:18px;margin:0 0 4px}p{margin:0}.mut{color:#64748b;font-size:13px}' +
      '.st{display:flex;gap:12px;margin-top:16px}.n{width:26px;height:26px;border-radius:999px;background:#1e3a5f;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px}' +
      'button{font:inherit;cursor:pointer;border-radius:8px;padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#1e3a5f;font-weight:600}' +
      'button.pri{background:#1e3a5f;color:#fff;border-color:#1e3a5f}button[disabled]{opacity:.6;cursor:wait}' +
      '.ft{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.ok{color:#15803d;font-weight:600}.er{color:#dc2626}' +
      'ul{margin:8px 0 0;padding-left:18px;font-size:13px;color:#92400e;max-height:160px;overflow:auto}' +
      '.fn{font-size:13px;color:#334155;margin-top:6px;word-break:break-all}</style>' +
      '<div class="bk"><div class="m" role="dialog" aria-modal="true" aria-label="Import products from Excel">' +
      '<h2>Import products from Excel</h2><p class="mut">Add new products and update existing ones in one go.</p>' +
      '<div class="st"><div class="n">1</div><div><p><b>Download the template</b> and fill one product per row.</p>' +
      '<p class="mut">Item code and product name are required. An existing item code is updated; a new one is added. Blank cells keep the current value.</p>' +
      '<p style="margin-top:8px"><button type="button" id="tpl">⤓ Download template</button></p></div></div>' +
      '<div class="st"><div class="n">2</div><div><p><b>Upload the filled file</b> (.xlsx or .csv).</p>' +
      '<p style="margin-top:8px"><button type="button" id="pick">Choose file…</button><input type="file" id="f" accept=".xlsx,.csv" hidden></p><p class="fn" id="fn"></p></div></div>' +
      '<div id="res" style="margin-top:14px"></div>' +
      '<div class="ft"><button type="button" id="close">Close</button><button type="button" class="pri" id="go" disabled>Import</button></div></div></div>';
    document.body.appendChild(host);
    var $ = function (id) { return sh.getElementById(id); };
    var file = null, changed = false;
    function close() { host.remove(); if (changed) location.reload(); }
    $('close').addEventListener('click', close);
    sh.querySelector('.bk').addEventListener('click', function (e) { if (e.target.classList.contains('bk')) close(); });
    $('tpl').addEventListener('click', function () { downloadTemplate($('tpl')); });
    $('pick').addEventListener('click', function () { $('f').click(); });
    $('f').addEventListener('change', function () {
      file = $('f').files[0] || null;
      $('fn').textContent = file ? file.name + ' (' + Math.ceil(file.size / 1024) + ' KB)' : '';
      if (file) $('go').removeAttribute('disabled'); else $('go').setAttribute('disabled', '');
    });
    $('go').addEventListener('click', function () {
      if (!file) return;
      var fd = new FormData(); fd.append('file', file);
      $('go').setAttribute('disabled', ''); $('go').textContent = 'Importing…';
      fetch(API + '/api/products/import', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var res = $('res'); res.innerHTML = '';
          var p1 = document.createElement('p');
          if (!j.success) { p1.className = 'er'; p1.textContent = j.message; res.appendChild(p1); return; }
          changed = j.data.created + j.data.updated > 0;
          p1.className = 'ok';
          p1.textContent = '✓ ' + j.data.created + ' new product' + (j.data.created === 1 ? '' : 's') + ' added, ' + j.data.updated + ' updated' + (j.data.skipped ? ', ' + j.data.skipped + ' skipped' : '') + '.';
          res.appendChild(p1);
          if (j.data.errors && j.data.errors.length) {
            var ul = document.createElement('ul');
            j.data.errors.forEach(function (x) { var li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
            res.appendChild(ul);
          }
          if (changed) { var p2 = document.createElement('p'); p2.className = 'mut'; p2.style.marginTop = '8px'; p2.textContent = 'The product list refreshes when you close this window.'; res.appendChild(p2); }
        }).catch(function (e) { $('res').textContent = e.message; })
        .then(function () { $('go').textContent = 'Import'; $('go').removeAttribute('disabled'); });
    });
  }

  // ── 4. Tracking: mandatory location, pings, stationary → break prompt ─
  var STAT_KEY = 'crm_stationary_' + ((user() || {}).id || 'me');
  var STAT_MOVE_M = 150;            // moving more than this resets the "same place" timer
  var STAT_MIN = 30;                // minutes in one place before asking about a break
  var PING_MS = 120000;             // location point every 2 minutes while punched in
  var trk = { punchedIn: false, active: null, watchId: null, last: null, lastPingAt: 0, locOff: false, promptEl: null };

  function metersBetween(a, b) {
    var R = 6371000, p = Math.PI / 180;
    var x = Math.sin((b.lat - a.lat) * p / 2), y = Math.sin((b.lng - a.lng) * p / 2);
    var h = x * x + Math.cos(a.lat * p) * Math.cos(b.lat * p) * y * y;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function statGet() { try { return JSON.parse(lsGet(STAT_KEY) || 'null'); } catch (e) { return null; } }
  function statSet(v) { lsSet(STAT_KEY, JSON.stringify(v)); }
  function post(path, body) {
    return fetch(API + '/api' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.message || 'Request failed'); return j; }); });
  }
  function getPos(timeout) {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) return rej({ code: 2, message: 'This device has no GPS / location support.' });
      navigator.geolocation.getCurrentPosition(function (p) { res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
        rej, { enableHighAccuracy: true, timeout: timeout || 15000, maximumAge: 30000 });
    });
  }

  // Punch in / out: the attendance page only waits 5 s for GPS and would send
  // an empty location, which the API now refuses. Intercept the request, get
  // the location properly (15 s, high accuracy) and add it — or explain how to
  // turn location on.
  function installPunchLocationHook() {
    var XHR = window.XMLHttpRequest;
    if (!XHR || XHR.prototype.__crmLocHook) return;
    XHR.prototype.__crmLocHook = true;
    var open = XHR.prototype.open, send = XHR.prototype.send;
    XHR.prototype.open = function (m, u) { this.__crmM = String(m || '').toUpperCase(); this.__crmU = String(u || ''); return open.apply(this, arguments); };
    XHR.prototype.send = function (body) {
      var xhr = this, args = arguments;
      if (xhr.__crmM === 'POST' && /\/api\/attendance\/check(in|out)\b/.test(xhr.__crmU)) {
        var data = {};
        try { data = JSON.parse(body || '{}') || {}; } catch (e) {}
        xhr.addEventListener('load', function () { setTimeout(refreshTracking, 600); });
        if (typeof data.lat !== 'number' || typeof data.lng !== 'number') {
          getPos(15000).then(function (p) {
            data.lat = p.lat; data.lng = p.lng;
            send.call(xhr, JSON.stringify(data));
          }, function (err) {
            locationHelp(/checkin/.test(xhr.__crmU) ? 'in' : 'out', err);
            send.apply(xhr, args); // the API answers "Location is required…"
          });
          return;
        }
      }
      return send.apply(xhr, args);
    };
  }

  // A small overlay host for tracking UI (help dialog, break prompt, break pill, banner).
  var tHost, tRoot;
  function tUi() {
    if (tRoot) { if (!tHost.isConnected) document.body.appendChild(tHost); return tRoot; }
    tHost = document.createElement('div'); tHost.id = 'crm-tracking';
    tRoot = tHost.attachShadow({ mode: 'open' });
    var st = document.createElement('style');
    st.textContent =
      ':host{all:initial}*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}' +
      '.bk{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.m{background:#fff;color:#0f172a;border-radius:16px;width:min(440px,100%);padding:22px;box-shadow:0 24px 60px rgba(15,23,42,.35);font-size:14px;line-height:1.45}' +
      '.m h2{margin:0 0 6px;font-size:18px}.m p{margin:0 0 8px;color:#475569}.m ol{margin:6px 0 0;padding-left:20px;color:#334155}' +
      '.big{font-size:34px;line-height:1;margin-bottom:10px}' +
      '.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}' +
      '.b{font:600 14px/1 inherit;cursor:pointer;border-radius:10px;padding:11px 14px;border:1px solid #cbd5e1;background:#fff;color:#1e3a5f;flex:1;min-width:120px}' +
      '.b:hover{background:#f1f5f9}.b.p{background:#1e3a5f;border-color:#1e3a5f;color:#fff}.b.p:hover{background:#274b78}' +
      '.pill{position:fixed;left:16px;bottom:16px;z-index:2147482500;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 14px;border-radius:999px;' +
      'background:#fff;color:#0f172a;border:1px solid #e2e8f0;box-shadow:0 8px 24px rgba(15,23,42,.18);font-size:13px;font-weight:600}' +
      '.pill.on{background:#fffbeb;border-color:#fcd34d}.pill button{font:600 12px/1 inherit;border:0;border-radius:999px;padding:7px 11px;cursor:pointer;background:#1e3a5f;color:#fff}' +
      '.pill .t{font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}' +
      '.menu{display:flex;gap:6px}.menu button{background:#f1f5f9;color:#1e3a5f}' +
      '.ban{position:fixed;top:0;left:0;right:0;z-index:2147482600;background:#dc2626;color:#fff;font-size:13px;font-weight:600;padding:9px 16px;text-align:center}' +
      '.ban button{margin-left:10px;font:600 12px/1 inherit;border:0;border-radius:6px;padding:6px 10px;background:#fff;color:#b91c1c;cursor:pointer}';
    tRoot.appendChild(st);
    document.body.appendChild(tHost);
    return tRoot;
  }
  function mkEl(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function locationHelp(dir, err) {
    var r = tUi();
    var old = r.querySelector('.help'); if (old) old.remove();
    var bk = mkEl('div', 'bk help');
    var m = mkEl('div', 'm');
    m.setAttribute('role', 'alertdialog');
    m.appendChild(mkEl('div', 'big', '📍'));
    m.appendChild(mkEl('h2', '', 'Turn on location to punch ' + dir));
    m.appendChild(mkEl('p', '', err && err.code === 1
      ? 'This site is not allowed to use your location. Location is required for attendance and live tracking.'
      : 'Your location could not be found. Make sure location (GPS) is switched on, then try again.'));
    var ol = mkEl('ol');
    ['Switch on Location / GPS on your phone or laptop.',
     'Tap the lock 🔒 icon next to the address bar → Site settings → Location → Allow.',
     'Come back to this page and press Punch ' + dir + ' again.'].forEach(function (t) { ol.appendChild(mkEl('li', '', t)); });
    m.appendChild(ol);
    var row = mkEl('div', 'row');
    var retry = mkEl('button', 'b p', 'I turned it on — check again');
    retry.addEventListener('click', function () {
      retry.textContent = 'Checking…';
      getPos(15000).then(function () { retry.textContent = '✓ Location is on — press Punch ' + dir + ' now'; setTimeout(function () { bk.remove(); }, 1500); },
        function () { retry.textContent = 'Still off — try the steps above'; });
    });
    var close = mkEl('button', 'b', 'Close');
    close.addEventListener('click', function () { bk.remove(); });
    row.appendChild(retry); row.appendChild(close); m.appendChild(row);
    bk.appendChild(m); r.appendChild(bk);
  }

  function refreshTracking() {
    if (!token()) return;
    fetch(API + '/api/breaks/today', { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.data) return;
        var was = trk.punchedIn;
        trk.punchedIn = j.data.punchedIn;
        trk.active = j.data.active;
        if (trk.active) trk.active.fetchedAt = Date.now();
        if (trk.punchedIn && !was) startWatch();
        if (!trk.punchedIn) { stopWatch(); statSet(null); }
        renderPill();
      }).catch(function () {});
  }

  function startWatch() {
    if (trk.watchId !== null || !navigator.geolocation) { if (!navigator.geolocation) setLocOff(true); return; }
    trk.watchId = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 60000, timeout: 60000 });
  }
  function stopWatch() {
    if (trk.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(trk.watchId);
    trk.watchId = null; setLocOff(false);
  }
  function onFix(p) {
    var fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, t: Date.now() };
    trk.last = fix;
    setLocOff(false);
    // Location point every 2 minutes (the attendance page sends its own).
    if (Date.now() - trk.lastPingAt > PING_MS && !/^\/attendance/.test(location.pathname)) {
      trk.lastPingAt = Date.now();
      post('/attendance/ping', { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }).catch(function () {});
    }
    // Same place?
    if (fix.accuracy > 300) return; // too vague to judge movement
    var a = statGet();
    if (!a || metersBetween(a, fix) > STAT_MOVE_M) statSet({ lat: fix.lat, lng: fix.lng, t: Date.now(), askAfter: Date.now() + STAT_MIN * 60000 });
    checkStationary();
  }
  function onFixError(err) {
    if (err && (err.code === 1 || err.code === 2)) setLocOff(true);
  }
  function setLocOff(off) {
    if (off === trk.locOff) return;
    trk.locOff = off;
    var r = tUi(), old = r.querySelector('.ban');
    if (old) old.remove();
    if (!off || !trk.punchedIn) return;
    var ban = mkEl('div', 'ban', '📍 Your location is off — live tracking is paused. Turn on Location / GPS and allow this site to use it.');
    var b = mkEl('button', '', 'Retry');
    b.addEventListener('click', function () { stopWatch(); startWatch(); });
    ban.appendChild(b);
    r.appendChild(ban);
    post('/breaks/stationary', { eventType: 'LOCATION_OFF' }).catch(function () {});
  }

  function checkStationary() {
    var a = statGet();
    if (!trk.punchedIn || trk.active || !a || Date.now() < a.askAfter || trk.promptEl) return;
    showBreakPrompt(a);
  }
  function showBreakPrompt(a) {
    var mins = Math.round((Date.now() - a.t) / 60000);
    var r = tUi();
    var bk = mkEl('div', 'bk');
    var m = mkEl('div', 'm');
    m.setAttribute('role', 'alertdialog');
    m.appendChild(mkEl('div', 'big', '☕'));
    m.appendChild(mkEl('h2', '', 'Are you on a break?'));
    m.appendChild(mkEl('p', '', 'You have been at the same place for ' + mins + ' minutes. If you are taking a break, choose which one — your manager sees break times.'));
    var row = mkEl('div', 'row');
    function done() { bk.remove(); trk.promptEl = null; clearTimeout(noAnswer); }
    [['TEA', '☕ Tea break', 'b p'], ['LUNCH', '🍽 Lunch break', 'b p']].forEach(function (o) {
      var b = mkEl('button', o[2], o[1]);
      b.addEventListener('click', function () {
        b.textContent = 'Starting…';
        post('/breaks/start', { type: o[0], trigger: 'AUTO', lat: a.lat, lng: a.lng }).then(function () { done(); refreshTracking(); })
          .catch(function (e) { b.textContent = e.message; });
      });
      row.appendChild(b);
    });
    var w = mkEl('button', 'b', 'No — I’m working here');
    w.addEventListener('click', function () {
      post('/breaks/stationary', { eventType: 'STATIONARY_WORKING', minutes: mins, sinceAt: new Date(a.t).toISOString(), lat: a.lat, lng: a.lng }).catch(function () {});
      a.askAfter = Date.now() + 60 * 60000; statSet(a); // ask again after another hour here
      done();
    });
    row.appendChild(w);
    m.appendChild(row);
    bk.appendChild(m); r.appendChild(bk);
    trk.promptEl = bk;
    chime(typeSound('STATIONARY'));
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        new Notification('Are you on a break?', { body: 'Same place for ' + mins + ' min — tap to choose tea or lunch break.', tag: 'crm-break', icon: '/icons/icon-192x192.png' });
      }
    } catch (e) {}
    // No answer within 10 minutes → let Super Admin know (prompt stays open).
    var noAnswer = setTimeout(function () {
      if (!trk.promptEl) return;
      post('/breaks/stationary', { eventType: 'STATIONARY_NO_RESPONSE', minutes: mins + 10, sinceAt: new Date(a.t).toISOString(), lat: a.lat, lng: a.lng }).catch(function () {});
      a.askAfter = Date.now() + 60 * 60000; statSet(a);
    }, 10 * 60000);
  }

  // Break pill: "Take a break" while working, live timer + "End break" while on one.
  var pillTimer = null;
  function renderPill() {
    var r = tUi(), old = r.querySelector('.pill');
    if (old) old.remove();
    clearInterval(pillTimer);
    if (!trk.punchedIn) return;
    var pill = mkEl('div', 'pill' + (trk.active ? ' on' : ''));
    var sidebarShown = window.innerWidth >= 768 && (document.documentElement.classList.contains('crm-docked') ||
      document.getElementById('app-shell-aside') || document.querySelector('aside .sidebar-link'));
    if (sidebarShown) pill.style.left = '272px';                 // just right of the sidebar
    else if (document.getElementById('crm-nav-drawer')) pill.style.bottom = '70px'; // above the Menu button
    pill.setAttribute('data-base', pill.style.bottom || '16px');
    if (trk.active) {
      var a = trk.active;
      var label = mkEl('span', '', (a.type === 'LUNCH' ? '🍽 Lunch break ' : '☕ Tea break '));
      var t = mkEl('span', 't');
      var base = a.seconds, t0 = a.fetchedAt || Date.now();
      function tick() { var sec = base + Math.floor((Date.now() - t0) / 1000); t.textContent = Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
      tick(); pillTimer = setInterval(tick, 1000);
      var end = mkEl('button', '', 'End break');
      end.addEventListener('click', function () {
        end.textContent = '…';
        post('/breaks/end').then(function () { statSet(null); refreshTracking(); }).catch(function (e) { end.textContent = e.message; });
      });
      label.appendChild(t); pill.appendChild(label); pill.appendChild(end);
    } else {
      var take = mkEl('button', '', '☕ Take a break');
      take.addEventListener('click', function () {
        pill.innerHTML = '';
        var menu = mkEl('span', 'menu');
        [['TEA', '☕ Tea'], ['LUNCH', '🍽 Lunch']].forEach(function (o) {
          var b = mkEl('button', '', o[1]);
          b.addEventListener('click', function () {
            var p = trk.last || {};
            post('/breaks/start', { type: o[0], trigger: 'MANUAL', lat: p.lat, lng: p.lng }).then(refreshTracking).catch(function (e) { b.textContent = e.message; });
          });
          menu.appendChild(b);
        });
        var x = mkEl('button', '', '✕'); x.style.background = 'transparent'; x.style.color = '#64748b';
        x.addEventListener('click', renderPill);
        menu.appendChild(x);
        pill.appendChild(menu);
      });
      pill.appendChild(take);
    }
    r.appendChild(pill);
  }

  function startTracking() {
    installPunchLocationHook();
    refreshTracking();
    setInterval(refreshTracking, 60000);
    setInterval(checkStationary, 30000);
    // For testing / other scripts.
    window.CRMTracking = { refresh: refreshTracking, check: checkStationary, state: trk, help: locationHelp, fix: function (lat, lng, acc) { onFix({ coords: { latitude: lat, longitude: lng, accuracy: acc || 10 } }); } };
  }

  // ── 1. alerts ────────────────────────────────────────────────────────
  var u = user() || {};
  var SINCE_KEY = 'crm_alert_since_' + (u.id || 'me');
  var SEEN_KEY = 'crm_alert_seen';
  var SOUND_KEY = 'crm_alert_sound'; // 'off' to mute
  var LOCK_KEY = 'crm_alert_poll_lock';
  var TAB_ID = Math.random().toString(36).slice(2);

  var TYPE_STYLE = {
    APPOINTMENT_REMINDER:   { color: '#d97706', icon: '⏰' },
    PUNCH_REMINDER:         { color: '#dc2626', icon: '🕘' },
    LATE_PUNCH_REQUEST:     { color: '#d97706', icon: '🕘' },
    LATE_PUNCH_DECIDED:     { color: '#0f766e', icon: '🕘' },
    APPOINTMENT_ASSIGNED:   { color: '#4f46e5', icon: '📅' },
    TASK_ASSIGNED:          { color: '#2563eb', icon: '📋' },
    TASK_COMPLETED:         { color: '#16a34a', icon: '✅' },
    PRICE_REQUEST_NEW:      { color: '#d97706', icon: '₹' },
    PRICE_REQUEST_REMINDER: { color: '#dc2626', icon: '⏰' },
    STOCK_LOW:              { color: '#ea580c', icon: '📦' },
    RESTOCK_NEEDED:         { color: '#b45309', icon: '🔁' },
    STOCK_CHECK:            { color: '#0d9488', icon: '🗂' },
    PRICE_REQUEST_ANSWERED: { color: '#16a34a', icon: '₹' },
    TRIAL_REQUESTED:        { color: '#7c3aed', icon: '🧪' },
    TRIAL_DECIDED:          { color: '#7c3aed', icon: '🧪' },
    TRIAL_COMPLETED:        { color: '#16a34a', icon: '🧪' },
    TRIAL_PDF:              { color: '#7c3aed', icon: '📄' },
    CHAT_MESSAGE:           { color: '#0284c7', icon: '💬' },
    LEAVE_REQUESTED:        { color: '#db2777', icon: '🌴' },
    LEAVE_DECIDED:          { color: '#db2777', icon: '🌴' },
    BREAK_STARTED:          { color: '#a16207', icon: '☕' },
    STATIONARY:             { color: '#d97706', icon: '⏸' },
    LOCATION_OFF:           { color: '#dc2626', icon: '📵' },
    CHANGE_NOTICE:          { color: '#7c3aed', icon: '✎' },
    PETTY_CASH_LOW:         { color: '#dc2626', icon: '💵' }
  };

  // ── Notification settings (Admin → Notifications & branding) ─────────
  // Per alert type: off, its own sound, no phone / desktop notification, or the
  // title / text rewritten ({title} {body} {name} are filled in). Kept on this
  // device and refreshed every few minutes, so a change applies on every page.
  var NSET_KEY = 'crm_notify_settings';
  var NMINE_KEY = 'crm_notify_mine_' + ((user() || {}).id || 'me');
  var nset = {}, nmine = {};   // company settings, and this person's own sounds (override the company sound)
  try { nset = JSON.parse(lsGet(NSET_KEY) || '{}') || {}; } catch (e) {}
  try { nmine = JSON.parse(lsGet(NMINE_KEY) || '{}') || {}; } catch (e) {}
  function loadNotifySettings() {
    if (!token()) return;
    fetch(API + '/api/app-settings', { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.data || !j.data.notifications) return;
        nset = j.data.notifications || {}; lsSet(NSET_KEY, JSON.stringify(nset));
        nmine = j.data.mine || {}; lsSet(NMINE_KEY, JSON.stringify(nmine));
        nativeSession();
      })
      .catch(function () {});
  }
  // Android app: the phone keeps showing alerts (WhatsApp-style) when the app is closed —
  // it needs the login and the notification settings (AlertService in the app).
  function nativeSession() {
    try {
      var N = window.CRMNative;
      if (!N || !N.setSession || !token()) return;
      N.setSession(token(), String((user() || {}).id || ''), brandName(), JSON.stringify({ n: nset, m: nmine }));
    } catch (e) {}
  }
  function brandName() { try { return (window.CRMBrand && window.CRMBrand.get().name) || 'APJ CRM'; } catch (e) { return 'APJ CRM'; } }
  function fillTpl(tpl, ev) {
    return String(tpl).replace(/\{title\}/g, ev.title || '').replace(/\{body\}/g, ev.body || '').replace(/\{name\}/g, brandName());
  }
  // The alert as the settings say it should look — or null when that type is turned off.
  function applyRule(ev) {
    var r = ev && nset[ev.type], mine = ev && nmine[ev.type];
    if (!r && !mine) return ev;
    r = r || {};
    if (r.on === false) return null;
    var out = {};
    for (var k in ev) if (Object.prototype.hasOwnProperty.call(ev, k)) out[k] = ev[k];
    if (r.title) out.title = fillTpl(r.title, ev);
    if (r.body) out.body = fillTpl(r.body, ev);
    if (r.sound) out.sound = r.sound;
    if (mine && mine !== 'default') out.sound = mine;   // the person's own choice wins
    if (r.push === false) out.noPush = true;
    return out;
  }
  function typeSound(type) { var r = nset[type]; return r && r.on === false ? 'none' : nmine[type] || (r && r.sound) || 'chime'; }
  var SOUND_RANK = ['alarm', 'urgent', 'bell', 'ding', 'chime', 'pop', 'soft'];
  function soundOf(ev) { return ev.sound || (isUrgent(ev) ? 'urgent' : 'chime'); }
  // Several alerts at once play one sound: the strongest of them.
  function soundFor(evs) {
    var best = null;
    evs.forEach(function (ev) {
      var s = soundOf(ev);
      if (s === 'none') return;
      if (best === null || SOUND_RANK.indexOf(s) < SOUND_RANK.indexOf(best)) best = s;
    });
    return best || 'none';
  }

  // Sound: every alert chimes (WebAudio, no audio file needed). Urgent ones
  // (urgent tasks / price requests, punch-in, location off, out of stock…)
  // play a louder three-note chime. Browsers only allow sound after the first
  // click / tap on the page: a chime that arrives before that is kept and
  // played at that first touch, so no alert is silent.
  var audioCtx = null, audioUnlocked = false, pendingChime = null, lastChimeAt = 0;
  var URGENT_TYPES = { PUNCH_REMINDER: 1, LOCATION_OFF: 1, LATE_PUNCH_REQUEST: 1, RESTOCK_NEEDED: 0 };
  function isUrgent(ev) {
    if (!ev) return false;
    if (URGENT_TYPES[ev.type]) return true;
    return /urgent|out of stock|overdue/i.test((ev.title || '') + ' ' + (ev.body || ''));
  }
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      audioUnlocked = true;
      refreshSoundHint();
      if (pendingChime) { var lv = pendingChime; pendingChime = null; setTimeout(function () { chime(lv); }, 60); }
    } catch (e) {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, unlockAudio, { passive: true }); });
  // Sites the browser already lets play sound (used before) start unlocked.
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'running') audioUnlocked = true;
  } catch (e) {}
  // In the Android app the phone plays its own notification sound (web audio is often blocked there).
  function nativeApp() { try { return !!(window.CRMNative && window.CRMNative.playSound); } catch (e) { return false; } }
  // The alert sounds: [frequency, start s, volume, fade s] per note, and the wave shape.
  // The Android app plays the same sounds (apps/android res/raw/snd_*.wav).
  var SOUNDS = {
    chime:  { wave: 'sine',     notes: [[880, 0, 0.25, 0.45], [1318.5, 0.16, 0.25, 0.45]] },
    urgent: { wave: 'triangle', notes: [[988, 0, 0.32, 0.45], [1319, 0.18, 0.32, 0.45], [1568, 0.36, 0.34, 0.45], [1319, 0.7, 0.3, 0.45], [1568, 0.88, 0.32, 0.45]] },
    bell:   { wave: 'sine',     notes: [[1046.5, 0, 0.3, 1.4], [2093, 0, 0.08, 0.8], [523.25, 0, 0.1, 1.4]] },
    ding:   { wave: 'sine',     notes: [[1568, 0, 0.3, 0.8]] },
    pop:    { wave: 'sine',     notes: [[520, 0, 0.35, 0.12], [780, 0.09, 0.25, 0.14]] },
    alarm:  { wave: 'square',   notes: [[880, 0, 0.12, 0.2], [660, 0.22, 0.12, 0.2], [880, 0.44, 0.12, 0.2], [660, 0.66, 0.12, 0.2], [880, 0.88, 0.12, 0.2], [660, 1.1, 0.12, 0.2]] },
    soft:   { wave: 'sine',     notes: [[523.25, 0, 0.12, 0.6], [659.25, 0.22, 0.12, 0.6]] }
  };
  var STRONG = { urgent: 1, alarm: 1 };
  function normSound(s) { return s === 'normal' || s === 'default' || !s ? 'chime' : s; }
  function chime(level, force) {
    if (!force && lsGet(SOUND_KEY) === 'off') return;
    level = normSound(level);
    if (level === 'none') return;
    if (!SOUNDS[level]) level = 'chime';
    if (nativeApp()) {
      try { if (window.CRMNative.playSoundType) window.CRMNative.playSoundType(level); else window.CRMNative.playSound(STRONG[level] ? 'urgent' : 'normal'); } catch (e) {}
      return;
    }
    if (!audioCtx || !audioUnlocked || audioCtx.state !== 'running') {
      if (audioCtx && audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
      if (!audioCtx || audioCtx.state !== 'running') { if (!pendingChime || SOUND_RANK.indexOf(level) < SOUND_RANK.indexOf(pendingChime)) pendingChime = level; return; }
    }
    var now = Date.now();
    if (!force && now - lastChimeAt < 1500) return; // two alerts at once = one sound
    lastChimeAt = now;
    try {
      var t0 = audioCtx.currentTime, snd = SOUNDS[level];
      snd.notes.forEach(function (n) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = snd.wave; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(n[2], t0 + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + n[3]);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + n[3] + 0.05);
      });
      try { if (navigator.vibrate) navigator.vibrate(STRONG[level] ? [180, 80, 180] : 120); } catch (e) {}
    } catch (e) {}
  }

  // Toasts live in a Shadow DOM so page CSS can't touch them.
  var host, box, hintEl, hidden = 0;
  // Sit above a page's sticky bottom button bar (e.g. the Trials save/submit
  // bar) — checked continuously since pages render that bar after alerts arrive.
  setInterval(function () {
    // The break pill (and alerts) also step up over a page's sticky bottom bar
    // (Price requests "Raise request", CPR "Save review", Trials).
    var bar = null;
    document.querySelectorAll('.pr-foot, .cp-save, .trl-bar').forEach(function (b) {
      var r = b.getBoundingClientRect();
      if (r.height && r.bottom > window.innerHeight - 40 && r.top < window.innerHeight) bar = r;
    });
    var pl = tRoot && tRoot.querySelector('.pill');
    if (pl) {
      var base = parseInt(pl.getAttribute('data-base') || '16', 10);
      pl.style.bottom = (bar ? Math.max(base, Math.ceil(window.innerHeight - bar.top) + 10) : base) + 'px';
    }
    if (!box) return;
    // ...and above the Save/Cancel footer of an open form drawer (Meetings, CPR).
    var foot = document.querySelector('.drawer-backdrop:not(.is-hidden) .drawer-footer, .cp-back .cp-df');
    box.style.bottom = foot ? (Math.ceil(foot.getBoundingClientRect().height) + 16) + 'px'
      : bar ? (Math.ceil(window.innerHeight - bar.top) + 12) + 'px' : '16px';
    // While a form drawer is open only the newest alert shows, so the stack
    // doesn't cover the form; the rest come back when the drawer closes.
    box.classList.toggle('compact', !!foot);
  }, 700);
  function ensureBox() {
    if (box) { if (!host.isConnected) document.body.appendChild(host); return; }
    host = document.createElement('div');
    host.id = 'crm-alerts';
    var sh = host.attachShadow({ mode: 'open' });
    var st = document.createElement('style');
    st.textContent =
      ':host{all:initial}' +
      '.box{position:fixed;bottom:16px;right:16px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;width:min(360px,calc(100vw - 32px));' +
      'max-height:calc(100vh - 32px);overflow-y:auto;' +
      'font:14px/1.4 Inter,system-ui,-apple-system,Segoe UI,sans-serif;pointer-events:none}.box>*{pointer-events:auto}' +
      '.t{background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-left:4px solid var(--c);border-radius:12px;padding:12px 12px 10px 14px;' +
      'box-shadow:0 12px 32px rgba(15,23,42,.18);animation:in .25s ease-out}' +
      '@keyframes in{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}' +
      '.t.out{transition:opacity .2s ease,transform .2s ease;opacity:0;transform:translateX(24px)}' +
      '@media (prefers-reduced-motion:reduce){.t{animation:none}.t.out{transition:none}}' +
      '.h{display:flex;align-items:flex-start;gap:10px}.ic{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;' +
      'background:color-mix(in srgb,var(--c) 14%,#fff);color:var(--c);font-weight:700;flex-shrink:0}' +
      '.tt{font-weight:600;font-size:14px}.bd{color:#475569;font-size:13px;margin-top:2px;word-break:break-word}' +
      '.x{margin-left:auto;border:0;background:none;color:#94a3b8;font-size:16px;cursor:pointer;line-height:1;padding:2px 4px}.x:hover{color:#0f172a}' +
      '.ft{display:flex;gap:12px;align-items:center;margin-top:8px;padding-left:38px}' +
      '.a{font-size:12.5px;font-weight:600;color:#1e3a5f;text-decoration:none;cursor:pointer;background:none;border:0;padding:0}' +
      '.a:hover{text-decoration:underline}.muted{font-size:12px;color:#94a3b8}' +
      '.bar{display:flex;justify-content:space-between;gap:8px;align-items:center;background:#0f172a;color:#e2e8f0;border-radius:10px;padding:8px 12px;font-size:12.5px}' +
      '.bar .a{color:#93c5fd}' +
      '.box.compact .bar,.box.compact .more,.box.compact .t~.t{display:none!important}' +
      '.dark .t{background:#0f172a;color:#f1f5f9;border-color:#334155}.dark .bd{color:#cbd5e1}.dark .a{color:#93c5fd}';
    box = document.createElement('div');
    box.className = 'box' + (document.documentElement.classList.contains('dark') ? ' dark' : '');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Notifications');
    box.setAttribute('aria-live', 'polite');
    sh.appendChild(st); sh.appendChild(box);
    document.body.appendChild(host);
  }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function refreshSoundHint() {
    if (!box) return;
    box.querySelectorAll('.more').forEach(function (m) { m.remove(); });
    if (!box.querySelector('.t')) hidden = 0;
    if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
    hintEl = null;
    var toasts = box.querySelectorAll('.t').length;
    if (!toasts) return;
    if (hidden) {
      var more = mk('a', 'a', '+' + hidden + ' more alert' + (hidden === 1 ? '' : 's') + ' — see all');
      more.href = '/alerts/';
      more.style.cssText = 'display:block;text-align:right;font-size:12px';
      box.appendChild(more);
      more.className = 'a more';
    }
    var muted = lsGet(SOUND_KEY) === 'off';
    var needClick = !audioUnlocked && !muted && !nativeApp();
    var canAsk = !nativeApp() && 'Notification' in window && Notification.permission === 'default';
    hintEl = mk('div', 'bar');
    hintEl.appendChild(mk('span', '', muted ? '🔇 Sound is off' : needClick ? '🔈 Click anywhere on the page to turn on alert sounds' : '🔔 Alert sounds on'));
    var acts = mk('span');
    var snd = mk('button', 'a', muted ? 'Turn sound on' : 'Mute');
    snd.addEventListener('click', function () { lsSet(SOUND_KEY, muted ? 'on' : 'off'); unlockAudio(); refreshSoundHint(); });
    acts.appendChild(snd);
    if (canAsk) {
      var dn = mk('button', 'a', 'Desktop alerts');
      dn.style.marginLeft = '10px';
      dn.addEventListener('click', function () { Notification.requestPermission().then(refreshSoundHint); });
      acts.appendChild(dn);
    }
    if (toasts > 1) {
      var all = mk('button', 'a', 'Dismiss all');
      all.style.marginLeft = '10px';
      all.addEventListener('click', function () { box.querySelectorAll('.t').forEach(function (t) { t.remove(); }); hidden = 0; refreshSoundHint(); });
      acts.appendChild(all);
    }
    hintEl.appendChild(acts);
    box.insertBefore(hintEl, box.firstChild);
  }

  function toast(ev) {
    ensureBox();
    var sty = TYPE_STYLE[ev.type] || { color: '#1e3a5f', icon: '🔔' };
    var t = mk('div', 't');
    t.style.setProperty('--c', sty.color);
    t.setAttribute('data-id', ev.id);
    var h = mk('div', 'h');
    h.appendChild(mk('div', 'ic', sty.icon));
    var txt = mk('div');
    txt.appendChild(mk('div', 'tt', ev.title));
    txt.appendChild(mk('div', 'bd', ev.body));
    h.appendChild(txt);
    var x = mk('button', 'x', '✕');
    x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', function () { leave(t); if (ev.onClose) ev.onClose(); });
    h.appendChild(x);
    t.appendChild(h);
    var ft = mk('div', 'ft');
    if (ev.link) {
      var a = mk('a', 'a', 'Open →');
      a.href = ev.link;
      a.addEventListener('click', function () { t.remove(); if (ev.onOpen) ev.onOpen(); });
      ft.appendChild(a);
    }
    ft.appendChild(mk('span', 'muted', fmtWhen(ev.at)));
    t.appendChild(ft);
    var first = box.querySelector('.t');
    box.insertBefore(t, first || null);
    // New tasks stay until dismissed; everything else tidies itself away.
    if (ev.type !== 'TASK_ASSIGNED' && !ev.sticky) {
      setTimeout(function () { if (t.parentNode && !t.matches(':hover')) leave(t); }, 20000);
    }
    // At most 3 on screen, so alerts never bury the page; the rest are summarised.
    // Sticky reminders (e.g. punch in) are never pushed out.
    if (ev.sticky) t.setAttribute('data-sticky', '1');
    var list = box.querySelectorAll('.t:not([data-sticky])'), room = 3 - box.querySelectorAll('.t[data-sticky]').length;
    for (var i = Math.max(0, room); i < list.length; i++) { hidden++; list[i].remove(); }
  }
  // Fade / slide a toast away, then tidy the stack.
  function leave(t) {
    if (!t.parentNode || t.classList.contains('out')) return;
    t.classList.add('out');
    setTimeout(function () { t.remove(); refreshSoundHint(); }, 200);
  }
  function fmtWhen(at) {
    var d = new Date(String(at || '').replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function desktop(ev) {
    if (ev.noPush) return;   // this alert type is set to "no phone / desktop notification"
    // Android app: a real phone notification (top bar, with its sound) when the app is in the background
    if (nativeApp() && window.CRMNative.showNotification) {
      try {
        var snd = soundOf(ev);
        if (window.CRMNative.showNotification2) window.CRMNative.showNotification2(String(ev.title || brandName()), String(ev.body || ''), String(ev.link || ''), snd === 'chime' && !ev.sound ? 'default' : snd);
        else window.CRMNative.showNotification(String(ev.title || brandName()), String(ev.body || ''), String(ev.link || ''));
      } catch (e) {}
      return;
    }
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
      var lg = window.CRMBrand && window.CRMBrand.get().logo;
      var n = new Notification(ev.title, { body: ev.body, tag: ev.id, icon: lg ? API + lg : '/icons/icon-192x192.png', silent: soundOf(ev) === 'none' });
      n.onclick = function () { window.focus(); if (ev.link) location.href = ev.link; n.close(); };
    } catch (e) {}
  }

  function seenList() { try { return JSON.parse(lsGet(SEEN_KEY) || '[]'); } catch (e) { return []; } }

  // Only one open tab polls at a time (the lock is refreshed every poll);
  // the seen-list stops a second tab repeating an alert if two ever overlap.
  function holdLock() {
    var raw = lsGet(LOCK_KEY), now = Date.now();
    var lock = null;
    try { lock = JSON.parse(raw || 'null'); } catch (e) {}
    if (lock && lock.tab !== TAB_ID && now - lock.at < POLL_MS * 1.6) return false;
    lsSet(LOCK_KEY, JSON.stringify({ tab: TAB_ID, at: now }));
    return true;
  }

  var polling = false;
  function poll(force) {
    if (polling || !token()) return;
    if (force) lsSet(LOCK_KEY, JSON.stringify({ tab: TAB_ID, at: Date.now() })); // the tab you're looking at takes over
    else if (!holdLock()) return;
    polling = true;
    var since = lsGet(SINCE_KEY);
    fetch(API + '/api/alerts-feed' + (since ? '?since=' + encodeURIComponent(since) : ''), {
      headers: { Authorization: 'Bearer ' + token() }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      polling = false;
      if (!j || !j.data) return;
      lsSet(SINCE_KEY, j.data.now);
      var seen = seenList();
      var fresh = (j.data.events || []).filter(function (ev) { return seen.indexOf(ev.id) === -1; });
      if (!fresh.length) return;
      lsSet(SEEN_KEY, JSON.stringify(seen.concat(fresh.map(function (ev) { return ev.id; })).slice(-300)));
      fresh = fresh.map(applyRule).filter(Boolean);   // types turned off are dropped, templates applied
      if (!fresh.length) return;
      fresh.slice().reverse().forEach(function (ev) { toast(ev); desktop(ev); });
      refreshSoundHint();
      chime(soundFor(fresh));
      try { window.dispatchEvent(new CustomEvent('crm-alert', { detail: { events: fresh } })); } catch (e) {}
    }).catch(function () { polling = false; });
  }

  // React pages may rebuild <body> right after loading (hydration), which
  // drops anything added to it. Put our overlays back if that happens.
  function keepOverlays() {
    var put = function (n) { if (n && !n.isConnected && document.body) document.body.appendChild(n); };
    var fix = function () { put(tHost); put(host); };
    new MutationObserver(fix).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(fix, 1000);
  }

  // ── 6. Punch-in reminder: 9:25 – 9:40 AM (India time), Mon – Sat ───
  // Every few minutes in that window, until the attendance API says you have
  // punched in today. Once punched in the reminder stops (and is removed).
  var PUNCH_FLAG = 'crm_punched_in';
  function istNow() { var d = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000); return d; }
  function punchReminder() {
    if (!token()) return;
    var d = istNow(), mins = d.getHours() * 60 + d.getMinutes(), day = d.toDateString();
    var clearIt = function () { if (box) box.querySelectorAll('.t[data-id^="punch-remind-"]').forEach(function (n) { n.remove(); }); };
    if (lsGet(PUNCH_FLAG) === day) { clearIt(); return; }
    if (d.getDay() === 0 || mins < 9 * 60 + 25 || mins > 9 * 60 + 40) return;
    fetch(API + '/api/attendance/today', { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.data && j.data.record) { lsSet(PUNCH_FLAG, day); clearIt(); return; }
        if (/^\/attendance\/?$/.test(location.pathname)) return; // the page itself shows it
        var slot = Math.floor(mins / 5) * 5, left = 9 * 60 + 45 - mins;
        clearIt();
        window.CRMAlerts.show({ id: 'punch-remind-' + day.replace(/\W/g, '') + '-' + slot, type: 'PUNCH_REMINDER', sticky: true,
          title: 'Punch in now', link: '/attendance/', at: new Date().toISOString(),
          body: mins < 9 * 60 + 30 ? 'You have not punched in yet. On time until 9:30 AM.' : 'Grace time — ' + left + ' min left before punch-in locks at 9:45 AM.' });
      }).catch(function () {});
  }

  // ── 7. CEO Desk (was MD desk): unread items addressed to me stay on screen on every page ─
  // until opened or acknowledged (GET /md-desk/unread, POST /md-desk/:id/ack).
  var mdHost = null, mdBusy = false;
  function mdPoll() {
    if (mdBusy || /^\/md-desk\/?$/.test(location.pathname)) { if (mdHost) mdHost.remove(); return; }
    mdBusy = true;
    fetch(API + '/api/md-desk/unread', { headers: { Authorization: 'Bearer ' + (token() || '') } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { mdShow((j && j.data && j.data.items) || []); })
      .catch(function () {}).then(function () { mdBusy = false; });
  }
  function mdShow(items) {
    if (!items.length) { if (mdHost) { mdHost.remove(); mdHost = null; } return; }
    if (!mdHost) {
      mdHost = document.createElement('div'); mdHost.id = 'crm-md-pop';
      mdHost.attachShadow({ mode: 'open' });
    }
    if (!mdHost.isConnected) document.body.appendChild(mdHost);
    var sh = mdHost.shadowRoot, ICON = { MESSAGE: '💬', TASK: '📌', PRICE: '₹', QUOTATION: '📄' }, LABEL = { MESSAGE: 'Message', TASK: 'Important task', PRICE: 'Price given', QUOTATION: 'New quotation' };
    sh.innerHTML = '';
    var st = document.createElement('style');
    st.textContent = ':host{all:initial}.w{position:fixed;top:72px;right:16px;z-index:2147483100;width:min(380px,calc(100vw - 32px));font:14px/1.4 Inter,system-ui,-apple-system,Segoe UI,sans-serif;' +
      'background:#fff;color:#0f172a;border:1px solid #c7d2fe;border-top:4px solid #1e3a8a;border-radius:12px;box-shadow:0 16px 40px rgba(15,23,42,.25);animation:in .25s ease-out}' +
      '@keyframes in{from{transform:translateY(-10px);opacity:0}to{transform:none;opacity:1}}' +
      '.h{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;font-weight:700;font-size:13px;color:#1e3a8a;border-bottom:1px solid #e2e8f0}' +
      '.i{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid #f1f5f9}.i:last-child{border-bottom:0}.ic{flex:none;width:30px;height:30px;border-radius:8px;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-weight:700;color:#1e3a8a}' +
      '.t{font-weight:600}.s{font-size:12px;color:#64748b}.u{color:#dc2626;font-weight:700}.b{display:flex;gap:6px;margin-top:6px}' +
      'button{font:600 12px/1 inherit;font-family:inherit;border-radius:7px;padding:6px 10px;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#0f172a}button.p{background:#1e3a8a;border-color:#1e3a8a;color:#fff}';
    var w = document.createElement('div'); w.className = 'w'; w.setAttribute('role', 'alert');
    var h = document.createElement('div'); h.className = 'h';
    h.appendChild(document.createTextNode('📣 From the CEO Desk' + (items.length > 1 ? ' (' + items.length + ')' : '')));
    w.appendChild(h);
    items.slice(0, 3).forEach(function (it) {
      var row = document.createElement('div'); row.className = 'i';
      var ic = document.createElement('div'); ic.className = 'ic'; ic.textContent = ICON[it.type] || '💬';
      var col = document.createElement('div'); col.style.flex = '1'; col.style.minWidth = '0';
      var t = document.createElement('div'); t.className = 't'; t.textContent = it.title;
      var sub = document.createElement('div'); sub.className = 's';
      if (it.priority === 'URGENT') { var u = document.createElement('span'); u.className = 'u'; u.textContent = 'URGENT · '; sub.appendChild(u); }
      sub.appendChild(document.createTextNode((LABEL[it.type] || 'Message') + ' from ' + (it.fromName || 'MD') + (it.dueDate ? ' · due ' + new Date(it.dueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')));
      var b = document.createElement('div'); b.className = 'b';
      var open = document.createElement('button'); open.className = 'p'; open.textContent = 'Open';
      open.onclick = function () { location.assign('/md-desk/#' + encodeURIComponent(it.id)); };
      var ok = document.createElement('button'); ok.textContent = 'OK, noted';
      ok.onclick = function () {
        row.remove();
        fetch(API + '/api/md-desk/' + encodeURIComponent(it.id) + '/ack', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') } }).then(mdPoll, mdPoll);
      };
      b.appendChild(open); b.appendChild(ok);
      col.appendChild(t); col.appendChild(sub); col.appendChild(b);
      row.appendChild(ic); row.appendChild(col); w.appendChild(row);
    });
    sh.appendChild(st); sh.appendChild(w);
  }

  function start() {
    keepOverlays();
    setTimeout(mdPoll, 2500);
    setInterval(function () { if (document.visibilityState === 'visible') mdPoll(); }, 60000);
    window.addEventListener('crm-alert', function (e) { var ev = (e && e.detail) || []; if ([].concat(ev.events || ev).some(function (x) { return x && /^MD_DESK/.test(x.type); })) mdPoll(); });
    setTimeout(punchReminder, 4000);
    setInterval(punchReminder, 60000);
    hardLinks();
    ensureMenu();
    productButtons();
    startTracking();
    setTimeout(ensureMenu, 1500); // React pages render their sidebar a moment after load
    setTimeout(dropExtraMenu, 3000);
    nativeSession();
    loadNotifySettings();
    setInterval(loadNotifySettings, 5 * 60000);
    poll(true);
    setInterval(function () { poll(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(true); });
  }
  // ── Sidebar sections (CRM, Sales, Reports, Operations, Admin) fold away ──
  // Click a section heading to minimise / open it; the choice is remembered on
  // this device. The page you are on stays visible even inside a folded section.
  // Works on both sidebars (React pages and the hand-built pages use the same markup).
  var SB_KEY = 'crm_sidebar_folded';
  function sbFolded() { try { return JSON.parse(localStorage.getItem(SB_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function sbApply() {
    var f = sbFolded();
    Array.prototype.forEach.call(document.querySelectorAll('p.sidebar-section'), function (h) {
      var name = (h.textContent || '').trim(), g = h.parentNode;
      if (!g || !name) return;
      if (!h.hasAttribute('data-sb')) {
        h.setAttribute('data-sb', name); h.setAttribute('role', 'button'); h.setAttribute('tabindex', '0');
        h.title = 'Click to minimise / open ' + name;
      }
      g.classList.toggle('sb-folded', !!f[name]);
      h.setAttribute('aria-expanded', f[name] ? 'false' : 'true');
    });
  }
  function sbToggle(h) {
    var f = sbFolded(), name = h.getAttribute('data-sb');
    if (f[name]) delete f[name]; else f[name] = true;
    try { localStorage.setItem(SB_KEY, JSON.stringify(f)); } catch (e) {}
    sbApply();
  }
  function sidebarFold() {
    if (!document.getElementById('sb-fold-css')) {
      var st = document.createElement('style'); st.id = 'sb-fold-css';
      st.textContent = 'p.sidebar-section[data-sb]{cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between}' +
        'p.sidebar-section[data-sb]::after{content:"\\25BE";font-size:.8em;opacity:.6;transition:transform .15s}' +
        '.sb-folded>p.sidebar-section[data-sb]::after{transform:rotate(-90deg)}' +
        '.sb-folded>:not(.sidebar-section):not(.sidebar-link-active){display:none!important}';
      document.head.appendChild(st);
    }
    document.addEventListener('click', function (e) { var h = e.target && e.target.closest && e.target.closest('p.sidebar-section[data-sb]'); if (h) { e.preventDefault(); sbToggle(h); } }, true);
    document.addEventListener('keydown', function (e) { var h = e.target && e.target.closest && e.target.closest('p.sidebar-section[data-sb]'); if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sbToggle(h); } }, true);
    sbApply();
    // React re-renders its sidebar after load and on navigation — fold again when it does
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(sbApply, 60); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sidebarFold); else sidebarFold();


  // ── Page access (set by the Super Admin on the Users page) ────────────
  // hidden → link removed from the menu and the page blocked; view → read only
  // (add / edit / delete buttons hidden); edit → delete buttons hidden.
  // The API refuses the same writes, so this is only about not showing them.
  var PA_KEY = 'crm_page_access';
  var PA_VIEW_TXT = /^\s*(?:[+＋✎🗑⤒📎💰🔔]|(?:new|add|edit|delete|remove|save|upload|import|send|submit|mark|approve|reject|create|duplicate|convert|assign|book|restore|deactivate|reset|enter|set|change|record|log|start|stop|copy to|move)\b)/iu;
  var PA_VIEW_TTL = /\b(add|new|edit|delete|remove|upload|save|rename|assign)\b/i;
  var PA_DEL_TXT = /^\s*(?:🗑|(?:delete|remove|deactivate)\b)/iu;
  var PA_DEL_TTL = /\b(delete|remove)\b/i;
  var PA_SAFE = /\b(close|dismiss|cancel|search|filter|back|view|open|download|print|export|refresh|show|hide|expand|collapse)\b/i;
  var paState = null;
  function paPageFor(path, pages) {
    var best = null, len = 0;
    (pages || []).forEach(function (pg) { pg.paths.forEach(function (p) { if ((path === p || path.indexOf(p + '/') === 0) && p.length > len) { best = pg; len = p.length; } }); });
    return best;
  }
  function paApply() {
    if (!paState) return;
    var acc = paState.access || {}, pages = paState.pages || [];
    var css = '';
    pages.forEach(function (pg) {
      if (acc[pg.key] !== 'hidden') return;
      pg.paths.forEach(function (p) { css += 'a[href="' + p + '"],a[href="' + p + '/"],a[href^="' + p + '/?"],a[href^="' + p + '/#"]{display:none!important}'; });
    });
    var st = document.getElementById('pa-css');
    if (!st) { st = document.createElement('style'); st.id = 'pa-css'; document.head.appendChild(st); }
    if (st.textContent !== css) st.textContent = css;
    var pg = paPageFor(location.pathname.replace(/\/+$/, '') || '/', pages), lvl = pg ? acc[pg.key] || 'full' : 'full';
    document.documentElement.setAttribute('data-page-access', lvl);
    var block = document.getElementById('pa-block'), banner = document.getElementById('pa-banner');
    if (lvl === 'hidden') {
      if (!block) {
        block = document.createElement('div'); block.id = 'pa-block';
        block.style.cssText = 'position:fixed;inset:0;z-index:2147483300;background:rgba(248,250,252,.97);display:flex;align-items:center;justify-content:center;font:15px/1.5 Inter,system-ui,sans-serif;color:#0f172a;text-align:center;padding:1rem';
        block.innerHTML = '<div><div style="font-size:2.4rem">🔒</div><b style="font-size:1.1rem"></b><p style="color:#64748b;margin:.4rem 0 1rem">You do not have access to this page. Ask the Super Admin if you need it.</p><a href="/dashboard/" style="display:inline-block;background:#1e3a8a;color:#fff;border-radius:.5rem;padding:.5rem 1rem;text-decoration:none;font-weight:600">Go to the dashboard</a></div>';
        block.querySelector('b').textContent = pg.label;
        document.body.appendChild(block);
      }
    } else if (block) block.remove();
    if (lvl === 'view' || lvl === 'edit') {
      if (!banner) {
        banner = document.createElement('div'); banner.id = 'pa-banner';
        banner.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147482000;background:' + (lvl === 'view' ? '#fef3c7;color:#92400e;border:1px solid #fcd34d' : '#dbeafe;color:#1e3a8a;border:1px solid #93c5fd') + ';border-radius:999px;padding:.3rem .9rem;font:600 12.5px Inter,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.08);pointer-events:none';
        banner.textContent = lvl === 'view' ? '👁 View only — you can look but not add, edit or delete' : '✎ You can add and edit here, but not delete';
        document.body.appendChild(banner);
      }
      paHideButtons(lvl);
    } else if (banner) banner.remove();
  }
  function paHideButtons(lvl) {
    var nodes = document.querySelectorAll('button, a.btn-primary, a.btn-secondary, [role="button"], label.btn-primary, label.btn-secondary');
    for (var i = 0; i < nodes.length; i++) {
      var b = nodes[i];
      if (b.hasAttribute('data-pa-off') || b.closest('.sidebar-link, aside, nav, #pa-banner, #pa-block, .sidebar-section')) continue;
      var txt = (b.textContent || '').trim(), ttl = (b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '');
      if (PA_SAFE.test(ttl) || /^(close|cancel|✕ close)$/i.test(txt)) continue;
      var hit = lvl === 'view' ? (PA_VIEW_TXT.test(txt) || PA_VIEW_TTL.test(ttl) || ((txt === '✕' || txt === '×') && PA_DEL_TTL.test(ttl)))
                               : (PA_DEL_TXT.test(txt) || PA_DEL_TTL.test(ttl));
      if (hit && !PA_SAFE.test(txt.replace(/^[^a-z]+/i, '').split(/\s/)[0] || '')) { b.setAttribute('data-pa-off', ''); b.style.setProperty('display', 'none', 'important'); }
    }
  }
  function pageAccess() {
    if (!token()) return;
    try { paState = JSON.parse(localStorage.getItem(PA_KEY) || 'null'); } catch (e) { paState = null; }
    paApply();
    fetch(API + '/api/page-access/me', { headers: { Authorization: 'Bearer ' + token() } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.data) return;
      paState = { access: j.data.access || {}, pages: j.data.pages || [] };
      try { localStorage.setItem(PA_KEY, JSON.stringify(paState)); } catch (e) {}
      paApply();
    }).catch(function () {});
    var t = null, last = location.pathname;
    new MutationObserver(function () {
      if (t) return;
      t = setTimeout(function () { t = null; if (location.pathname !== last) { last = location.pathname; var b = document.getElementById('pa-banner'); if (b) b.remove(); } paApply(); }, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pageAccess); else pageAccess();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // For other scripts / testing: CRMAlerts.check() polls right away.
  // CRMAlerts.show(ev) puts another script's alert in the same stack, e.g. the
  // appointment reminders ({ id, type, title, body, link, at, sticky, onOpen, onClose }).
  window.CRMAlerts = {
    check: function () { poll(true); },
    chime: chime,
    show: function (ev) {
      if (!ev || !document.body) return false;
      ensureBox();
      if (ev.id && box.querySelector('.t[data-id="' + String(ev.id).replace(/"/g, '') + '"]')) return true;
      ev = applyRule(ev);
      if (!ev) return true;   // turned off in the notification settings
      toast(ev); desktop(ev); refreshSoundHint();
      if (!ev.silent) chime(soundOf(ev));
      return true;
    },
    // For the Notifications & branding page: play a sound now / pick up saved settings.
    preview: function (sound) { unlockAudio(); chime(sound, true); },
    sounds: function () { return Object.keys(SOUNDS); },
    settings: function () { return nset; },
    typeSound: typeSound,
    mine: function () { return nmine; },
    reloadSettings: function (n, mine) {
      if (n) { nset = n; lsSet(NSET_KEY, JSON.stringify(n)); }
      if (mine) { nmine = mine; lsSet(NMINE_KEY, JSON.stringify(mine)); }
      if (n || mine) nativeSession();
      if (!n && !mine) loadNotifySettings();
    }
  };

  // ── Location gate for sales engineers ──────────────────────────────
  // SALES / SALES_ENGINEER users must keep location on to use the CRM: a live
  // fix is kept on every page and sent with each API call (X-CRM-Geo:
  // lat,lng,accuracy,ageSec); the API refuses saves without it (LocationGuard),
  // and while location is off the page is covered by a "Turn on location" lock.
  var geo = { fix: null, off: false, started: false, lock: null, firstAt: 0 };
  function geoRole() { try { var u = JSON.parse(localStorage.getItem('crm_user') || 'null'); return u && (u.role === 'SALES' || u.role === 'SALES_ENGINEER'); } catch (e) { return false; } }
  function geoHeader() {
    if (!geo.fix) return null;
    return geo.fix.lat.toFixed(6) + ',' + geo.fix.lng.toFixed(6) + ',' + Math.round(geo.fix.acc || 0) + ',' + Math.max(0, Math.round((Date.now() - geo.fix.t) / 1000));
  }
  var API_HOST = 'api.' + 'apjtech.in';   // also matches when another script talks to the API by its full address
  function isApi(url) {
    var u = typeof url === 'string' ? url : (url && url.url ? String(url.url) : '');
    return u.indexOf(API) === 0 || u.indexOf('//' + API_HOST + '/') > 0;
  }
  (function patchRequests() {
    if (window.__crmGeoPatched) return; window.__crmGeoPatched = true;
    var of = window.fetch;
    if (of) window.fetch = function (input, init) {
      var h = geoRole() && isApi(input) ? geoHeader() : null;
      if (h) {
        init = Object.assign({}, init || {});
        var hd = new Headers(init.headers || (input && input.headers) || {});
        hd.set('X-CRM-Geo', h); init.headers = hd;
      }
      return of.call(this, input, init).then(function (r) { if (r && r.status === 423 && geoRole()) geoCheck(true); return r; });
    };
    var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, url) { this.__crmApi = isApi(String(url)); return oo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      if (this.__crmApi && geoRole()) { var h = geoHeader(); if (h) try { this.setRequestHeader('X-CRM-Geo', h); } catch (e) {} }
      return os.apply(this, arguments);
    };
  })();
  function geoOk(p) {
    geo.fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
    geoSetOff(false);
  }
  function geoErr(err) {
    if (err && (err.code === 1 || err.code === 2)) geoSetOff(true);
    else if (!geo.fix && Date.now() - geo.firstAt > 45000) geoSetOff(true);   // still no fix after 45 s
  }
  function geoCheck(force) {
    if (!navigator.geolocation) { geoSetOff(true); return; }
    navigator.geolocation.getCurrentPosition(geoOk, geoErr, { enableHighAccuracy: !!force, maximumAge: force ? 0 : 60000, timeout: 30000 });
  }
  function geoStart() {
    if (geo.started || !token() || !geoRole() || /^\/login/.test(location.pathname)) return;
    geo.started = true; geo.firstAt = Date.now();
    if (!navigator.geolocation) { geoSetOff(true); return; }
    navigator.geolocation.watchPosition(geoOk, geoErr, { enableHighAccuracy: false, maximumAge: 120000, timeout: 45000 });
    geoCheck(false);
    setInterval(function () { if (document.visibilityState === 'visible') geoCheck(false); }, 120000);   // keep the fix fresh while standing still
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') geoCheck(false); });
    // permission already refused → lock at once; changed in settings → check again
    try { navigator.permissions.query({ name: 'geolocation' }).then(function (st) { if (st.state === 'denied') geoSetOff(true); st.onchange = function () { if (st.state === 'denied') geoSetOff(true); else geoCheck(true); }; }); } catch (e) {}
    // the location prompt was ignored / GPS gives nothing: lock after 45 s without any fix
    setTimeout(function () { if (!geo.fix) geoSetOff(true); }, 45000);
  }
  function geoSetOff(off) {
    geo.off = off;
    if (!off) { if (geo.lock) { geo.lock.remove(); geo.lock = null; } return; }
    if (geo.lock || !document.body) return;
    var host = document.createElement('div'); host.id = 'crm-geo-lock';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483640';
    var r = host.attachShadow({ mode: 'open' });
    r.innerHTML = '<style>:host{all:initial}.w{position:fixed;inset:0;background:rgba(15,23,42,.92);display:flex;align-items:center;justify-content:center;padding:1rem;font:15px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a}' +
      '.m{background:#fff;border-radius:16px;max-width:430px;width:100%;padding:1.4rem 1.3rem;text-align:center;box-shadow:0 30px 70px rgba(0,0,0,.4)}.big{font-size:2.6rem}h2{margin:.3rem 0 .4rem;font-size:1.2rem}' +
      'p{margin:0 0 .8rem;color:#475569;font-size:.9rem}ol{text-align:left;margin:0 0 1rem;padding-left:1.2rem;color:#334155;font-size:.88rem}li{margin:.25rem 0}' +
      'button{border:0;border-radius:10px;padding:.65rem 1rem;font:600 .92rem Inter,system-ui,sans-serif;cursor:pointer;background:#1e3a8a;color:#fff;width:100%}a{display:inline-block;margin-top:.7rem;color:#64748b;font-size:.82rem}</style>' +
      '<div class="w" role="alertdialog" aria-modal="true" aria-labelledby="t"><div class="m"><div class="big">📍</div><h2 id="t">Turn on your location</h2>' +
      '<p>Sales engineers can use the CRM only with location on. Nothing can be saved until it is back on.</p>' +
      '<ol><li>Switch on <b>Location / GPS</b> on your phone or laptop.</li><li>Allow location for the CRM: in the app, phone Settings → Apps → APJ CRM → Permissions → Location → Allow; in a browser, tap the 🔒 next to the address → Location → Allow.</li><li>Press <b>Check again</b>.</li></ol>' +
      '<button id="c">Check again</button><br><a href="/login/" id="o">Sign out</a></div></div>';
    r.getElementById('c').addEventListener('click', function () { var b = this; b.textContent = 'Checking…'; geoCheck(true); setTimeout(function () { b.textContent = geo.off ? 'Still off — follow the steps above' : 'Check again'; }, 4000); });
    r.getElementById('o').addEventListener('click', function () { try { localStorage.removeItem('crm_token'); } catch (e) {} });
    document.body.appendChild(host); geo.lock = host;
  }
  window.CRMGeo = { check: function () { geoCheck(true); }, state: function () { return { off: geo.off, fix: geo.fix }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', geoStart); else geoStart();

  // ── Quick search (Ctrl / ⌘ + K, or "Quick search…" in the top bar) ───
  // One box for the whole CRM: pages from the menu, plus customers, products,
  // quotations, orders, price requests, trials, appointments, CEO Desk, MOM,
  // meetings, vendors / POs, people and petty cash from GET /api/search (which
  // applies each page's visibility). Results open the page; links with ?q=
  // fill that page's own search box (qsPrefill below).
  var qs = null;
  function qsPages() {
    var seen = {}, out = [];
    var links = document.querySelectorAll('aside a[href^="/"], nav a[href^="/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i], href = a.getAttribute('href'), label = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label || seen[href] || /login/.test(href)) continue;
      if (getComputedStyle(a).display === 'none') continue;   // hidden by page access
      seen[href] = 1; out.push({ title: label, sub: 'Page', link: href });
    }
    return out;
  }
  function qsOpen() {
    if (!token()) return;
    if (!qs) qsBuild();
    qs.host.style.display = 'block';
    qs.input.value = ''; qsRender([], ''); qs.input.focus();
  }
  function qsClose() { if (qs) { qs.host.style.display = 'none'; clearTimeout(qs.t); } }
  function qsBuild() {
    var host = document.createElement('div'); host.id = 'crm-qs';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483450;display:none';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' +
      ':host{all:initial}.ov{position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;justify-content:center;align-items:flex-start;padding:10vh 1rem 1rem;font:14px/1.4 Inter,system-ui,-apple-system,Segoe UI,sans-serif}' +
      '.bx{width:min(640px,100%);background:#fff;color:#0f172a;border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.35);overflow:hidden;display:flex;flex-direction:column;max-height:78vh}' +
      '.in{display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;border-bottom:1px solid #e2e8f0}.in span{color:#94a3b8;font-size:1.1rem}' +
      'input{flex:1;border:0;outline:0;font:inherit;font-size:1.02rem;background:transparent;color:inherit;min-width:0}kbd{font:600 11px Inter,system-ui;color:#64748b;background:#f1f5f9;border-radius:5px;padding:.1rem .35rem}' +
      '.rs{overflow:auto;padding:.35rem 0}.g{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;padding:.55rem 1rem .25rem}' +
      '.it{display:block;padding:.45rem 1rem;cursor:pointer;text-decoration:none;color:inherit;border-left:3px solid transparent}.it b{display:block;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.it small{display:block;color:#64748b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.it.on{background:#eff6ff;border-left-color:#1e3a8a}' +
      '.em{padding:1.2rem 1rem;color:#64748b;text-align:center}.ft{display:flex;gap:1rem;padding:.45rem 1rem;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px}' +
      '.dark .bx{background:#0f172a;color:#f1f5f9}.dark .in,.dark .ft{border-color:#334155}.dark .it.on{background:#1e293b;border-left-color:#93c5fd}.dark kbd{background:#1e293b;color:#cbd5e1}' +
      '</style><div class="ov"><div class="bx" role="dialog" aria-label="Quick search"><div class="in"><span>⌕</span><input id="q" placeholder="Search customers, orders, quotations, products, pages…" autocomplete="off" aria-label="Quick search"><kbd>Esc</kbd></div>' +
      '<div class="rs" id="rs"></div><div class="ft"><span>↑ ↓ to move</span><span>Enter to open</span><span>Ctrl K anywhere</span></div></div></div>';
    document.body.appendChild(host);
    qs = { host: host, root: root, input: root.getElementById('q'), list: root.getElementById('rs'), items: [], sel: 0, t: null, seq: 0 };
    root.querySelector('.ov').addEventListener('mousedown', function (e) { if (e.target.classList.contains('ov')) qsClose(); });
    qs.input.addEventListener('input', function () {
      var v = qs.input.value.trim();
      clearTimeout(qs.t);
      qsRender([], v, v.length >= 2);
      if (v.length < 2) return;
      var seq = ++qs.seq;
      qs.t = setTimeout(function () {
        fetch(API + '/api/search?q=' + encodeURIComponent(v), { headers: { Authorization: 'Bearer ' + token() } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (seq === qs.seq) qsRender((j && j.data && j.data.groups) || [], v); })
          .catch(function () { if (seq === qs.seq) qsRender([], v); });
      }, 220);
    });
    qs.input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); qsClose(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); qsMove(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter') { e.preventDefault(); var it = qs.items[qs.sel]; if (it) qsGo(it.link); }
    });
  }
  function qsGo(link) { qsClose(); location.href = link; }
  function qsMove(d) {
    if (!qs.items.length) return;
    qs.sel = (qs.sel + d + qs.items.length) % qs.items.length;
    var nodes = qs.list.querySelectorAll('.it');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('on', i === qs.sel);
    if (nodes[qs.sel]) nodes[qs.sel].scrollIntoView({ block: 'nearest' });
  }
  function qsRender(groups, v, loading) {
    var lv = v.toLowerCase();
    var pages = qsPages().filter(function (p) { return !lv || p.title.toLowerCase().indexOf(lv) >= 0; }).slice(0, lv ? 6 : 8);
    var all = (pages.length ? [{ label: lv ? 'Pages' : 'Go to', items: pages }] : []).concat(groups);
    qs.root.querySelector('.bx').parentNode.classList.toggle('dark', document.documentElement.classList.contains('dark'));
    qs.items = []; qs.sel = 0;
    var html = '';
    all.forEach(function (g) {
      html += '<div class="g">' + esc(g.label) + '</div>';
      g.items.forEach(function (it) {
        html += '<a class="it' + (qs.items.length ? '' : ' on') + '" data-i="' + qs.items.length + '" href="' + esc(it.link) + '"><b>' + esc(it.title) + '</b>' + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</a>';
        qs.items.push(it);
      });
    });
    if (!qs.items.length) html = '<div class="em">' + (loading ? 'Searching…' : v.length >= 2 ? 'Nothing found for “' + esc(v) + '”' : 'Type at least 2 letters') + '</div>';
    else if (loading) html += '<div class="em">Searching…</div>';
    qs.list.innerHTML = html;
    var nodes = qs.list.querySelectorAll('.it');
    for (var i = 0; i < nodes.length; i++) nodes[i].addEventListener('click', function (e) { e.preventDefault(); qsGo(qs.items[+this.getAttribute('data-i')].link); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (qs && qs.host.style.display === 'block') qsClose(); else qsOpen(); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button, [data-quick-search]');
    if (!b) return;
    if (b.hasAttribute('data-quick-search') || /Quick search/i.test(b.textContent || '')) { e.preventDefault(); qsOpen(); }
  }, true);
  window.CRMQuickSearch = { open: qsOpen, close: qsClose };
  // The React top bar hides its "Quick search…" button on phones: add an icon button there.
  function qsMobileBtn() {
    var bs = document.querySelectorAll('header button');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (b.hasAttribute('data-quick-search') || !/Quick search/.test(b.textContent || '') || b.previousElementSibling && b.previousElementSibling.hasAttribute('data-qs-mobile')) continue;
      var m = document.createElement('button');
      m.setAttribute('data-quick-search', '1'); m.setAttribute('data-qs-mobile', '1'); m.setAttribute('aria-label', 'Quick search');
      m.className = 'md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800';
      m.textContent = '⌕'; m.style.fontSize = '1.15rem';
      b.parentNode.insertBefore(m, b);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', qsMobileBtn); else qsMobileBtn();
  setTimeout(qsMobileBtn, 1500); setTimeout(qsMobileBtn, 4000);

  // ?q=… from a quick-search result: type it into the page's own search box.
  (function qsPrefill() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('q'); } catch (e) {}
    if (!q) return;
    var tries = 0;
    (function look() {
      var cands = document.querySelectorAll('input[type="search"], input[placeholder^="Search" i], input[placeholder^="search" i]');
      for (var i = 0; i < cands.length; i++) {
        var inp = cands[i];
        if (!inp.offsetParent || inp.disabled || inp.readOnly) continue;
        var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(inp, q);
        ['input', 'keyup', 'change'].forEach(function (t) { inp.dispatchEvent(new Event(t, { bubbles: true })); });
        return;
      }
      if (++tries < 40) setTimeout(look, 300);
    })();
  })();
})();
