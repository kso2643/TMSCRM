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
  function ensureMenu() {
    if (hasSidebar() || document.getElementById('crm-nav-drawer')) return;
    loadShell(function () { if (window.AppShell && AppShell.drawer && !hasSidebar()) AppShell.drawer(); });
  }

  // ── 1. alerts ────────────────────────────────────────────────────────
  var u = user() || {};
  var SINCE_KEY = 'crm_alert_since_' + (u.id || 'me');
  var SEEN_KEY = 'crm_alert_seen';
  var SOUND_KEY = 'crm_alert_sound'; // 'off' to mute
  var LOCK_KEY = 'crm_alert_poll_lock';
  var TAB_ID = Math.random().toString(36).slice(2);

  var TYPE_STYLE = {
    TASK_ASSIGNED:          { color: '#2563eb', icon: '📋' },
    TASK_COMPLETED:         { color: '#16a34a', icon: '✅' },
    PRICE_REQUEST_NEW:      { color: '#d97706', icon: '₹' },
    PRICE_REQUEST_ANSWERED: { color: '#16a34a', icon: '₹' },
    TRIAL_REQUESTED:        { color: '#7c3aed', icon: '🧪' },
    TRIAL_DECIDED:          { color: '#7c3aed', icon: '🧪' },
    TRIAL_COMPLETED:        { color: '#16a34a', icon: '🧪' }
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
    if (box) box.style.bottom = document.querySelector('.trl-bar') ? '96px' : '16px';
  }, 700);
  function ensureBox() {
    if (box) return;
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
      '.h{display:flex;align-items:flex-start;gap:10px}.ic{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;' +
      'background:color-mix(in srgb,var(--c) 14%,#fff);color:var(--c);font-weight:700;flex-shrink:0}' +
      '.tt{font-weight:600;font-size:14px}.bd{color:#475569;font-size:13px;margin-top:2px;word-break:break-word}' +
      '.x{margin-left:auto;border:0;background:none;color:#94a3b8;font-size:16px;cursor:pointer;line-height:1;padding:2px 4px}.x:hover{color:#0f172a}' +
      '.ft{display:flex;gap:12px;align-items:center;margin-top:8px;padding-left:38px}' +
      '.a{font-size:12.5px;font-weight:600;color:#1e3a5f;text-decoration:none;cursor:pointer;background:none;border:0;padding:0}' +
      '.a:hover{text-decoration:underline}.muted{font-size:12px;color:#94a3b8}' +
      '.bar{display:flex;justify-content:space-between;gap:8px;align-items:center;background:#0f172a;color:#e2e8f0;border-radius:10px;padding:8px 12px;font-size:12.5px}' +
      '.bar .a{color:#93c5fd}' +
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
    x.addEventListener('click', function () { t.remove(); refreshSoundHint(); });
    h.appendChild(x);
    t.appendChild(h);
    var ft = mk('div', 'ft');
    if (ev.link) {
      var a = mk('a', 'a', 'Open →');
      a.href = ev.link;
      a.addEventListener('click', function () { t.remove(); });
      ft.appendChild(a);
    }
    ft.appendChild(mk('span', 'muted', fmtWhen(ev.at)));
    t.appendChild(ft);
    var first = box.querySelector('.t');
    box.insertBefore(t, first || null);
    // New tasks stay until dismissed; everything else tidies itself away.
    if (ev.type !== 'TASK_ASSIGNED') {
      setTimeout(function () { if (t.parentNode && !t.matches(':hover')) { t.remove(); refreshSoundHint(); } }, 20000);
    }
    // At most 3 on screen, so alerts never bury the page; the rest are summarised.
    var list = box.querySelectorAll('.t');
    for (var i = 3; i < list.length; i++) { hidden++; list[i].remove(); }
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

  function start() {
    ensureMenu();
    setTimeout(ensureMenu, 1500); // React pages render their sidebar a moment after load
    poll(true);
    setInterval(function () { poll(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(true); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // For other scripts / testing: CRMAlerts.check() polls right away.
  window.CRMAlerts = { check: function () { poll(true); }, chime: chime };
})();
