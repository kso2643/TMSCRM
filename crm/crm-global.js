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
  var HARD_PAGES = /^\/(meetings|alerts|admin\/reports|admin\/location-history|orders|trials|tasks|appointments|fuel-expense|hr|payroll(\/[a-z-]+)?|quotations|cpr|price-requests|leaves|stock|chat|vendors|attendance)\/?$/;
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
    chime();
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
    window.CRMTracking = { refresh: refreshTracking, check: checkStationary, state: trk, fix: function (lat, lng, acc) { onFix({ coords: { latitude: lat, longitude: lng, accuracy: acc || 10 } }); } };
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
    LOCATION_OFF:           { color: '#dc2626', icon: '📵' }
  };

  // Sound: a short two-note chime from WebAudio (no audio file needed).
  var audioCtx = null, audioUnlocked = false;
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      audioUnlocked = true;
      refreshSoundHint();
    } catch (e) {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, unlockAudio, { passive: true }); });
  function chime() {
    if (lsGet(SOUND_KEY) === 'off' || !audioCtx || !audioUnlocked) return;
    try {
      var t0 = audioCtx.currentTime;
      [[880, 0], [1318.5, 0.16]].forEach(function (n) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.45);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.5);
      });
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
    var needClick = !audioUnlocked && !muted;
    var canAsk = 'Notification' in window && Notification.permission === 'default';
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
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
      var n = new Notification(ev.title, { body: ev.body, tag: ev.id, icon: '/icons/icon-192x192.png' });
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
      fresh.slice().reverse().forEach(function (ev) { toast(ev); desktop(ev); });
      refreshSoundHint();
      chime();
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

  function start() {
    keepOverlays();
    setTimeout(punchReminder, 4000);
    setInterval(punchReminder, 60000);
    hardLinks();
    ensureMenu();
    productButtons();
    startTracking();
    setTimeout(ensureMenu, 1500); // React pages render their sidebar a moment after load
    setTimeout(dropExtraMenu, 3000);
    poll(true);
    setInterval(function () { poll(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(true); });
  }
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
      toast(ev); desktop(ev); refreshSoundHint();
      return true;
    }
  };
})();
