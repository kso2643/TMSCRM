/* ══════════════════════════════════════════════════════════════════════
   Appointment reminders — drop-in runtime for the compiled CRM build.

   Site-wide (loaded on every page, same idea as fuel-expense-app.js's
   punch hook): polls GET /api/appointments/reminders every few minutes
   while the CRM is open in a browser tab, and for any newly-seen alert
   shows a dismissible toast + plays a short chime. The toast goes into
   the shared bottom-right alert stack (crm-global.js → CRMAlerts.show),
   so it never covers page buttons; its own box is only a fallback.
   Covers both alert
   types AppointmentController can generate:
     - TASK_ASSIGNED            someone assigned you an appointment
     - REMINDER_EVENING_BEFORE  a heads-up for tomorrow's (or today's,
       if unseen) appointment — see AppointmentController::
       generateReminders() for exactly when this becomes due.

   This is in-app only: it fires while a tab with the CRM open is
   running. There is no push notification service, SMS, or email wired
   up here — same trade-off already documented for this codebase's other
   in-app alerts (FollowUpAlert, Notification — see
   NotificationController.php's header comment). If nobody has the CRM
   open at the moment a reminder becomes due, it is simply waiting,
   unread, the next time anyone opens it — nothing is lost, just delayed.

   NOTE: this file is part of the hand-patched build. If you ever run
   `npm run build` from source again it will not be regenerated — keep it
   alongside the source-level version.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var TOKEN_KEY = 'crm_token';
  var POLL_MS = 3 * 60 * 1000; // 3 minutes — frequent enough to feel timely, light enough to leave running all day
  var NOTIF_ASKED_KEY = 'crm_appt_notif_asked';

  function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }

  function api(method, path) {
    return fetch(API + '/api' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token() || '') }
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

  // ── sound: short two-tone chime via Web Audio API — no asset file,
  //    no network request, works even if the CRM is offline-cached ──
  function playChime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      [880, 1174.66].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        var start = ctx.currentTime + i * 0.16;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.34);
      });
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 1200);
    } catch (e) { /* Web Audio unavailable — the toast still shows, just silently */ }
  }

  // Best-effort OS-level notification too, so it can surface even if the
  // CRM tab isn't the focused one. Ask permission once, quietly — never
  // more than once, so we don't nag if they dismiss the browser prompt.
  function ensureNotificationPermission() {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default' && !localStorage.getItem(NOTIF_ASKED_KEY)) {
        localStorage.setItem(NOTIF_ASKED_KEY, '1');
        Notification.requestPermission();
      }
    } catch (e) {}
  }

  function showBrowserNotification(title, body) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: body, icon: '/icons/icon-192x192.png' });
      }
    } catch (e) {}
  }

  // ── toast stack (appended to <body>, outside the SPA's root, so it
  //    survives client-side navigation between pages) ──────────────
  var stack = null;
  // Own styles (ar- prefix): hand-coded pages (Meetings, Quotations, …) don't
  // load the compiled Tailwind CSS, so utility classes would render unstyled.
  function ensureCss() {
    if (document.getElementById('appt-reminder-css')) return;
    var st = document.createElement('style');
    st.id = 'appt-reminder-css';
    st.textContent =
      '#appt-reminder-stack{position:fixed;z-index:9998;top:76px;right:12px;left:12px;display:flex;flex-direction:column;gap:8px;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}' +
      '@media (min-width:640px){#appt-reminder-stack{left:auto;width:384px}}' +
      // Out of the way while a form drawer / dialog is open (it would cover its top fields).
      'body:has(.drawer-backdrop:not(.is-hidden)) #appt-reminder-stack,body:has(.cp-back) #appt-reminder-stack,body:has([role=dialog][aria-modal=true]) #appt-reminder-stack{display:none}' +
      '.ar-card{display:flex;gap:12px;align-items:flex-start;padding:14px;background:#fff;border:1px solid #e2e8f0;border-left:4px solid #1e3a8a;border-radius:12px;box-shadow:0 10px 25px -5px rgba(15,23,42,.18)}' +
      '.ar-card.ar-amber{border-left-color:#f59e0b}' +
      '.ar-ico{font-size:20px;line-height:1;flex-shrink:0}' +
      '.ar-body{flex:1;min-width:0}' +
      '.ar-t{margin:0;font-size:14px;font-weight:600;color:#0f172a}' +
      '.ar-s{margin:2px 0 0;font-size:12px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ar-w{margin:2px 0 0;font-size:11px;color:#94a3b8}' +
      '.ar-a{display:inline-block;margin-top:6px;font-size:12px;font-weight:600;color:#1e40af;text-decoration:none}' +
      '.ar-a:hover{text-decoration:underline}' +
      '.ar-x{flex-shrink:0;margin-left:8px;background:none;border:none;color:#94a3b8;font-size:14px;cursor:pointer;padding:2px}' +
      '.ar-x:hover{color:#475569}' +
      'html.dark .ar-card{background:#0f172a;border-color:#1e293b}html.dark .ar-t{color:#f1f5f9}html.dark .ar-a{color:#93c5fd}';
    (document.head || document.documentElement).appendChild(st);
  }

  function ensureStack() {
    if (stack && document.body.contains(stack)) return stack;
    ensureCss();
    stack = el('div', { id: 'appt-reminder-stack' });
    document.body.appendChild(stack);
    return stack;
  }

  function markRead(id) {
    api('PATCH', '/appointments/alerts/' + id + '/read').catch(function () {});
  }

  function fmtWhen(dateStr, timeStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var tmrw = new Date(today); tmrw.setDate(tmrw.getDate() + 1);
    var label = d.getTime() === today.getTime() ? 'Today'
      : d.getTime() === tmrw.getTime() ? 'Tomorrow'
      : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    return timeStr ? label + ' \u00b7 ' + timeStr : label;
  }

  function renderAlert(a) {
    var isReminder = a.alertType === 'REMINDER_EVENING_BEFORE';
    var card = el('div', { class: 'ar-card' + (isReminder ? ' ar-amber' : '') });
    card.appendChild(el('div', { class: 'ar-ico', text: isReminder ? '\u23f0' : '\ud83d\udccc' }));
    var viewBtn = el('a', {
      class: 'ar-a',
      href: '/appointments/?date=' + encodeURIComponent(a.appointmentDate),
      text: 'View appointment \u2192',
      onclick: function () { markRead(a.id); }
    });
    card.appendChild(el('div', { class: 'ar-body' }, [
      el('p', {
        class: 'ar-t',
        text: isReminder ? 'Appointment reminder' : 'New appointment assigned to you'
      }),
      el('p', {
        class: 'ar-s',
        text: a.title + (a.companyName ? ' \u00b7 ' + a.companyName : '')
      }),
      el('p', { class: 'ar-w', text: fmtWhen(a.appointmentDate, a.appointmentTime) }),
      viewBtn
    ]));
    card.appendChild(el('button', {
      class: 'ar-x',
      'aria-label': 'Dismiss', text: '\u2715',
      onclick: function () { markRead(a.id); if (card.parentNode) card.parentNode.removeChild(card); }
    }));
    return card;
  }

  var shownIds = {};

  function poll() {
    if (!token()) return;
    api('GET', '/appointments/reminders').then(function (res) {
      var alerts = (res.data && res.data.alerts) || [];
      var playedSound = false;
      alerts.forEach(function (a) {
        if (shownIds[a.id]) return;
        shownIds[a.id] = true;
        var isReminder = a.alertType === 'REMINDER_EVENING_BEFORE';
        var title = isReminder ? 'Appointment reminder' : 'New appointment assigned to you';
        var body = a.title + (a.companyName ? ' \u00b7 ' + a.companyName : '') + ' \u00b7 ' + fmtWhen(a.appointmentDate, a.appointmentTime);
        // Same bottom-right stack as every other alert (crm-global.js), so it
        // never covers a page's header buttons or form fields.
        var shared = window.CRMAlerts && window.CRMAlerts.show && window.CRMAlerts.show({
          id: 'appt-' + a.id, type: isReminder ? 'APPOINTMENT_REMINDER' : 'APPOINTMENT_ASSIGNED',
          title: title, body: body, link: '/appointments/?date=' + encodeURIComponent(a.appointmentDate),
          at: new Date().toISOString(), sticky: true,
          onOpen: function () { markRead(a.id); }, onClose: function () { markRead(a.id); }
        });
        if (!shared) {
          ensureStack().appendChild(renderAlert(a));
          showBrowserNotification(title, a.title + (a.companyName ? ' \u00b7 ' + a.companyName : ''));
        }
        playedSound = true;
      });
      if (playedSound) { if (window.CRMAlerts && window.CRMAlerts.chime) window.CRMAlerts.chime(); else playChime(); }
    }).catch(function () { /* quiet — this is a background ticker */ });
  }

  function boot() {
    if (!token()) return; // login/404 pages, or logged-out sessions — nothing to do
    ensureNotificationPermission();
    // crm-global.js (the shared alert stack) loads right after this script.
    var tries = 0;
    (function first() {
      if ((window.CRMAlerts && window.CRMAlerts.show) || tries++ > 20) { poll(); setInterval(poll, POLL_MS); }
      else setTimeout(first, 150);
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
