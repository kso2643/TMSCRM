/* ══════════════════════════════════════════════════════════════════════
   Notifications & branding page (sidebar → Operations).
   Everyone: "My alert sounds" — their own sound per alert type (Page access
   "Notifications & sounds" lets the Super Admin hide it or make it view-only per person).
   Super Admin / Admin also get the company settings and the CRM name / logo below.

   Notifications, page by page: for each kind of alert choose
     - on / off
     - the sound (with a ▶ button to hear it)
     - whether it also shows in the phone's top bar / as a desktop notification
     - the title and text ({title} {body} {name} keep the original wording / CRM name)
   Branding: the CRM name shown in the sidebar, login page and page titles, and the logo.
   Data: GET /api/app-settings, PUT /api/app-settings/notifications | branding,
   POST / DELETE /api/app-settings/logo (AppSettingsController).
   Applied on every page by crm-global.js (alerts) and crm-brand.js (name / logo).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';

  var GROUPS = [
    ['Attendance', [['PUNCH_REMINDER', 'Punch-in reminder'], ['LATE_PUNCH_REQUEST', 'Late punch-in request (to admin)'], ['LATE_PUNCH_DECIDED', 'Late punch-in approved / rejected'],
                    ['BREAK_STARTED', 'Break started'], ['STATIONARY', 'Same place for a long time'], ['LOCATION_OFF', 'Location turned off']]],
    ['Appointments', [['APPOINTMENT_REMINDER', 'Appointment reminder'], ['APPOINTMENT_ASSIGNED', 'Appointment assigned'], ['APPOINTMENT_VISIT', 'Visit logged'], ['APPOINTMENT_CONFIRMED', 'Appointment confirmed']]],
    ['CEO Desk & Tasks', [['MD_DESK_NEW', 'New CEO Desk item'], ['MD_DESK_REPLY', 'CEO Desk reply'], ['MD_DESK_DONE', 'CEO Desk item done'], ['TASK_ASSIGNED', 'Task assigned'], ['TASK_COMPLETED', 'Task completed']]],
    ['Price requests', [['PRICE_REQUEST_NEW', 'New price request'], ['PRICE_REQUEST_REMINDER', 'Price request reminder'], ['PRICE_REQUEST_ANSWERED', 'Price given']]],
    ['Stock', [['STOCK_LOW', 'Low stock'], ['RESTOCK_NEEDED', 'Customer restock due'], ['STOCK_CHECK', 'Weekly stock check']]],
    ['Trials', [['TRIAL_REQUESTED', 'Trial requested'], ['TRIAL_DECIDED', 'Trial approved / rejected'], ['TRIAL_COMPLETED', 'Trial completed'], ['TRIAL_PDF', 'Trial PDF ready']]],
    ['Leave', [['LEAVE_REQUESTED', 'Leave requested'], ['LEAVE_DECIDED', 'Leave approved / rejected']]],
    ['Chat', [['CHAT_MESSAGE', 'New chat message']]],
    ['Accounts', [['INVOICE_OVERDUE', 'Invoice overdue'], ['BILL_DUE', 'Vendor bill due']]],
    ['Petty cash', [['PETTY_CASH_LOW', 'Petty cash running low']]],
    ['Changes by admin', [['CHANGE_NOTICE', 'Your request was changed (leave, order, trial…)']]]
  ];
  var SOUND_LABEL = { 'default': 'Default', chime: 'Chime', urgent: 'Urgent (3 notes)', bell: 'Bell', ding: 'Ding', pop: 'Pop', alarm: 'Alarm', soft: 'Soft', none: 'No sound' };
  var SOUNDS = ['default', 'chime', 'urgent', 'bell', 'ding', 'pop', 'alarm', 'soft', 'none'];

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function user() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch (e) { return null; } }
  function api(method, path, body, isForm) {
    var h = { Authorization: 'Bearer ' + (token() || '') };
    if (body && !isForm) h['Content-Type'] = 'application/json';
    return fetch(API + '/api' + path, { method: method, headers: h, body: body ? (isForm ? body : JSON.stringify(body)) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed'); return j; });
    });
  }
  function el(tag, attrs, kids) { return window.AppShell.el(tag, attrs, kids); }
  function flash(box, msg, bad) {
    box.textContent = msg; box.className = 'text-sm ' + (bad ? 'text-red-600' : 'text-emerald-600');
    clearTimeout(box._t); box._t = setTimeout(function () { box.textContent = ''; }, 5000);
  }
  function play(s) {
    if (s === 'none') return;
    if (window.CRMAlerts && window.CRMAlerts.preview) window.CRMAlerts.preview(s === 'default' ? 'chime' : s);
  }

  var st = { n: {}, b: {}, mine: {} };

  function mountPage(root) {
    var u = user();
    if (!u) return;
    var admin = ['SUPER_ADMIN', 'ADMIN'].indexOf(u.role) !== -1;
    root.appendChild(el('p', { class: 'text-sm text-muted mb-4', text: admin
      ? 'Choose how every alert looks and sounds — on the website and in the Android app — and set the CRM name and logo. Everyone can also pick their own sounds under “My alert sounds”.'
      : 'Pick the sound for each kind of alert. It plays on this website and in the Android app wherever you are signed in.' }));
    var brandBox = admin ? el('div', { class: 'card p-5 mb-5', id: 'ns-brand' }) : null;
    var notifyBox = admin ? el('div', { class: 'card overflow-hidden mb-5', id: 'ns-notify' }) : null;
    var mineBox = el('div', { class: 'card overflow-hidden mb-5', id: 'ns-mine' });
    var phoneBox = nativeApp() ? el('div', { class: 'card p-5 mb-5', id: 'ns-phone' }) : null;
    var themeBox = el('div', { class: 'card p-5 mb-5', id: 'ns-theme' });
    [phoneBox, brandBox, themeBox, notifyBox, mineBox].forEach(function (b) { if (b) root.appendChild(b); });
    if (phoneBox) drawPhone(phoneBox);
    mineBox.appendChild(el('p', { class: 'px-5 py-4 text-sm text-muted', text: 'Loading…' }));
    api('GET', '/app-settings').then(function (j) {
      st.n = j.data.notifications || {}; st.b = j.data.branding || {}; st.mine = j.data.mine || {};
      st.theme = j.data.theme || {}; st.myTheme = j.data.myTheme || {};
      drawTheme(themeBox, admin);
      if (admin) { drawBrand(brandBox); drawNotify(notifyBox); }
      drawMine(mineBox);
    }).catch(function (e) { mineBox.innerHTML = ''; mineBox.appendChild(el('p', { class: 'px-5 py-4 text-sm text-red-600', text: e.message })); });
  }

  // ── Phone alerts (Android app only): is everything set for alerts while the app is closed? ──
  function nativeApp() { try { return !!(window.CRMNative && window.CRMNative.alertStatus); } catch (e) { return false; } }
  function drawPhone(box) {
    var st0 = {};
    try { st0 = JSON.parse(window.CRMNative.alertStatus() || '{}'); } catch (e) {}
    box.innerHTML = '';
    function ago(ms) {
      if (!ms) return 'not yet';
      var s = Math.round((Date.now() - ms) / 1000);
      return s < 90 ? s + ' seconds ago' : s < 5400 ? Math.round(s / 60) + ' minutes ago' : new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    }
    function row(ok, label, fixText, fix) {
      return el('div', { class: 'flex items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-800', 'data-ns-check': label }, [
        el('span', { class: 'text-sm' }, [el('span', { text: ok ? '✅ ' : '⚠️ ' }), label]),
        ok || !fix ? el('span', { class: 'text-xs text-muted', text: ok ? 'OK' : '' }) : el('button', { class: 'btn-primary btn-sm', type: 'button', text: fixText, onclick: fix })
      ]);
    }
    function open(which) { return function () { try { window.CRMNative.openSettings(which); } catch (e) {} setTimeout(function () { drawPhone(box); }, 4000); }; }
    var maker = String(st0.maker || '').toLowerCase();
    var oem = /xiaomi|redmi|poco|vivo|oppo|realme|oneplus|huawei|honor|iqoo|tecno|infinix/.test(maker);
    box.appendChild(el('h2', { class: 'text-base font-semibold mb-1', text: '📱 Phone alerts' }));
    box.appendChild(el('p', { class: 'text-xs text-muted mb-3', text: 'Alerts reach this phone like WhatsApp messages, also when the app is closed. Fix anything marked ⚠️, then press “Send test alert” and lock the phone.' }));
    box.appendChild(row(st0.signedIn, 'Signed in for alerts', '', null));
    box.appendChild(row(st0.notifications, 'Notifications allowed', 'Allow', open('notifications')));
    box.appendChild(row(st0.background, 'Allowed to run in the background (battery)', 'Allow', open('background')));
    box.appendChild(row(st0.exactAlarms !== false, 'Alarms & reminders allowed', 'Allow', open('alarms')));
    box.appendChild(row(st0.lastResult === 'ok', 'Last check ' + ago(st0.lastCheck) + (st0.lastError ? ' — ' + st0.lastError : ''), '', null));
    if (st0.tracking !== undefined) box.appendChild(st0.tracking
      ? row(!!st0.trackingActive, st0.trackingActive ? 'Location tracking on (punched in) — last point ' + ago(st0.lastPing) : 'Location tracking can’t start — allow location for the app (Allow all the time / While using)', 'Allow', open('app'))
      : row(st0.location !== false, st0.location === false ? 'Location not allowed for the app — tracking can’t run when you punch in' : 'Location tracking starts when you punch in', 'Allow', open('app')));
    var msg = el('span', { class: 'text-sm', id: 'ns-test-msg' });
    box.appendChild(el('div', { class: 'flex flex-wrap items-center gap-2 mt-4' }, [
      el('button', { class: 'btn-primary', type: 'button', id: 'ns-test', text: '🔔 Send test alert (in 15 s)', onclick: function () {
        try { window.CRMNative.testAlert(15); msg.textContent = 'Lock the phone now — the test alert arrives in 15 seconds.'; } catch (e) { msg.textContent = e.message; }
      } }),
      el('button', { class: 'btn-secondary', type: 'button', text: 'Refresh', onclick: function () { drawPhone(box); } }),
      msg
    ]));
    if (oem) box.appendChild(el('p', { class: 'rp-warn text-xs mt-3', style: 'background:#fffbeb;color:#92400e;border-radius:.5rem;padding:.55rem .7rem',
      text: 'On ' + (st0.maker || 'this phone') + ' also turn on Autostart: Settings → Apps → APJ CRM → Autostart (and set Battery saver to “No restrictions”). Otherwise the phone may close the app and stop alerts.' }));
    if (oem) box.appendChild(el('button', { class: 'btn-secondary btn-sm mt-2', type: 'button', text: 'Open app settings', onclick: open('app') }));
    box.appendChild(el('p', { class: 'text-xs text-muted mt-3', text: 'App ' + (st0.app || '') + ' · Android ' + (st0.android || '') }));
  }

  // ── my own sounds (everyone) ──────────────────────────────────────────
  function drawMine(box) {
    box.innerHTML = '';
    var msg = el('span', { class: 'text-sm', id: 'ns-mine-msg' });
    var save = el('button', { class: 'btn-primary', type: 'button', id: 'ns-mine-save', text: 'Save my sounds' });
    box.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2' }, [
      el('div', {}, [
        el('h2', { class: 'text-base font-semibold', text: '🎵 My alert sounds' }),
        el('p', { class: 'text-xs text-muted', text: '“Company sound” keeps what the admin chose. Your choice only changes the sound on your own phone / computer.' })
      ]),
      el('div', { class: 'flex items-center gap-2' }, [msg, save])
    ]));
    var body = el('tbody', {});
    GROUPS.forEach(function (g) {
      body.appendChild(el('tr', { class: 'bg-slate-100/70 dark:bg-slate-800' }, [el('td', { class: 'px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300', colspan: '3', text: g[0] })]));
      g[1].forEach(function (t) {
        var c = st.n[t[0]] || {}, off = c.on === false;
        var company = SOUND_LABEL[c.sound || 'default'];
        var sel = el('select', { class: 'input py-1 text-sm', 'data-mine': t[0], 'aria-label': 'My sound for ' + t[1] },
          [el('option', { value: 'default', text: 'Company sound (' + company + ')' })].concat(SOUNDS.filter(function (x) { return x !== 'default'; }).map(function (x) { return el('option', { value: x, text: SOUND_LABEL[x] }); })));
        sel.value = st.mine[t[0]] || 'default';
        if (off) sel.disabled = true;
        body.appendChild(el('tr', { class: 'table-row', 'data-mine-type': t[0], style: off ? 'opacity:.55' : '' }, [
          el('td', { class: 'px-4 py-2 font-medium', text: t[1] }),
          el('td', { class: 'px-3 py-2' }, [el('div', { class: 'flex items-center gap-1' }, [sel,
            el('button', { class: 'btn-secondary btn-sm', type: 'button', 'aria-label': 'Play sound', text: '▶', onclick: function () { play(sel.value === 'default' ? (c.sound || 'default') : sel.value); } })])]),
          el('td', { class: 'px-3 py-2 text-xs text-muted', text: off ? 'Turned off by the admin' : '' })
        ]));
      });
    });
    box.appendChild(el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-sm', id: 'ns-mine-table' }, [
      el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, ['Alert', 'My sound', ''].map(function (h) { return el('th', { class: 'table-head px-3 py-2 text-left', text: h }); }))]),
      body])]));
    save.addEventListener('click', function () {
      var out = {};
      Array.prototype.forEach.call(box.querySelectorAll('select[data-mine]'), function (x) { if (!x.disabled) out[x.getAttribute('data-mine')] = x.value; });
      save.disabled = true;
      api('PUT', '/app-settings/my-notifications', { sounds: out }).then(function (j) {
        st.mine = j.data.mine || {};
        if (window.CRMAlerts && window.CRMAlerts.reloadSettings) window.CRMAlerts.reloadSettings(null, st.mine);
        flash(msg, '✓ Saved');
      }).catch(function (e) { flash(msg, e.message, true); }).then(function () { save.disabled = false; });
    });
  }

  // ── branding ──────────────────────────────────────────────────────────
  function drawBrand(box) {
    box.innerHTML = '';
    var msg = el('span', { class: 'text-sm' });
    var name = el('input', { class: 'input', id: 'ns-name', maxlength: '60', placeholder: 'Industrial CRM', value: st.b.name || '' });
    var short = el('input', { class: 'input', id: 'ns-short', maxlength: '30', placeholder: 'e.g. APJ CRM (phone notifications)', value: st.b.short || '' });
    var logoUrl = st.b.logo ? API + st.b.logo : null;
    var preview = el('div', { class: 'w-16 h-16 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden bg-slate-50 dark:bg-slate-800 shrink-0', id: 'ns-logo-preview' },
      [logoUrl ? el('img', { src: logoUrl, alt: 'Logo', style: 'width:100%;height:100%;object-fit:contain' }) : el('span', { class: 'text-xs text-muted', text: 'No logo' })]);
    var file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'ns-logo-file', class: 'hidden' });
    function done(j, m) { st.b = j.data.branding; if (window.CRMBrand) window.CRMBrand.set(st.b); drawBrand(box); flash(box.querySelector('[data-ns-msg]'), m); }
    file.addEventListener('change', function () {
      if (!file.files[0]) return;
      var fd = new FormData(); fd.append('file', file.files[0]);
      api('POST', '/app-settings/logo', fd, true).then(function (j) { done(j, 'Logo saved — it shows on every page now'); }).catch(function (e) { flash(msg, e.message, true); });
    });
    box.appendChild(el('h2', { class: 'text-base font-semibold mb-1', text: '🏷 CRM name and logo' }));
    box.appendChild(el('p', { class: 'text-xs text-muted mb-4', text: 'Shown in the sidebar, on the login page, in page titles and in phone / desktop notifications. Leave the name empty for “Industrial CRM”.' }));
    box.appendChild(el('div', { class: 'grid gap-4 md:grid-cols-3 items-end' }, [
      el('label', { class: 'block' }, [el('span', { class: 'label', text: 'CRM name' }), name]),
      el('label', { class: 'block' }, [el('span', { class: 'label', text: 'Short name (optional)' }), short]),
      el('button', { class: 'btn-primary', type: 'button', id: 'ns-save-brand', text: 'Save name', onclick: function () {
        api('PUT', '/app-settings/branding', { name: name.value, short: short.value }).then(function (j) { done(j, 'Name saved'); }).catch(function (e) { flash(msg, e.message, true); });
      } })
    ]));
    box.appendChild(el('div', { class: 'flex flex-wrap items-center gap-3 mt-4' }, [
      preview,
      el('button', { class: 'btn-secondary', type: 'button', id: 'ns-logo-pick', text: logoUrl ? 'Change logo' : 'Upload logo', onclick: function () { file.click(); } }),
      logoUrl ? el('button', { class: 'btn-secondary', type: 'button', id: 'ns-logo-remove', text: 'Remove logo', onclick: function () {
        if (!confirm('Remove the logo and go back to the default icon?')) return;
        api('DELETE', '/app-settings/logo').then(function (j) { done(j, 'Logo removed'); }).catch(function (e) { flash(msg, e.message, true); });
      } }) : null,
      el('span', { class: 'text-xs text-muted', text: 'PNG, JPG or WebP, square works best, under 2 MB.' }),
      file
    ]));
    var m2 = el('span', { 'data-ns-msg': '1', class: 'text-sm' });
    box.appendChild(el('div', { class: 'mt-3 flex gap-3' }, [msg, m2]));
    box.appendChild(el('p', { class: 'text-xs text-muted mt-3', text: 'Android app: the name and icon under the app on the phone’s home screen are set when the app is built — send the logo and name to have the app rebuilt with them. Everything inside the app (sidebar, login, notifications) follows this setting straight away.' }));
  }

  // ── 🎨 Theme (v11.46): company theme (Admins) and my own ──────────────
  function drawTheme(box, admin) {
    var T = window.CRMTheme;
    box.innerHTML = '';
    if (!T) { box.appendChild(el('p', { class: 'text-sm text-muted', text: 'Loading the theme editor… refresh the page if this stays.' })); setTimeout(function () { if (window.CRMTheme) drawTheme(box, admin); }, 1500); return; }
    var hasMine = Object.keys(st.myTheme || {}).length > 0;
    var cur = JSON.parse(JSON.stringify(hasMine ? st.myTheme : (st.theme || {})));
    var msg = el('span', { class: 'text-sm', 'data-th-msg': '1' });
    function changed() { T.preview(cur); drawControls(); }
    var controls = el('div', { id: 'ns-theme-controls' });
    function chip(label, on, click, attrs) { var b = el('button', Object.assign({ type: 'button', class: on ? 'btn-primary btn-sm' : 'btn-secondary btn-sm', text: label, onclick: click }, attrs || {})); return b; }
    function row(label, kids) { return el('div', { class: 'mb-4' }, [el('p', { class: 'label mb-1', text: label }), el('div', { class: 'flex flex-wrap gap-2 items-center' }, kids)]); }
    function drawControls() {
      controls.innerHTML = '';
      var pre = T.PRESETS[cur.preset] || T.PRESETS.navy;
      controls.appendChild(row('Colour theme', Object.keys(T.PRESETS).map(function (k) {
        var p = T.PRESETS[k], on = (cur.preset || 'navy') === k && !cur.primary;
        return el('button', { type: 'button', 'data-th-preset': k, title: p.label, onclick: function () { cur.preset = k; delete cur.primary; delete cur.accent; changed(); },
          style: 'display:flex;align-items:center;gap:6px;border:2px solid ' + (on ? p.primary : '#e2e8f0') + ';border-radius:10px;padding:5px 9px;background:#fff;cursor:pointer;font-size:.8rem;font-weight:600;color:#0f172a' },
          [el('span', { style: 'width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,' + p.primary + ' 60%,' + p.accent + ' 60%)' }), p.label]);
      })));
      var pc = el('input', { type: 'color', id: 'ns-th-primary', value: cur.primary || pre.primary, style: 'width:44px;height:34px;border:0;background:none;cursor:pointer' });
      var ac = el('input', { type: 'color', id: 'ns-th-accent', value: cur.accent || pre.accent, style: 'width:44px;height:34px;border:0;background:none;cursor:pointer' });
      pc.addEventListener('input', function () { cur.primary = pc.value; T.preview(cur); });
      pc.addEventListener('change', changed);
      ac.addEventListener('input', function () { cur.accent = ac.value; T.preview(cur); });
      controls.appendChild(row('Or your own colours', [el('label', { class: 'flex items-center gap-1 text-sm' }, [pc, 'Main colour']), el('label', { class: 'flex items-center gap-1 text-sm' }, [ac, 'Accent'])]));
      controls.appendChild(row('Sidebar', [['light', 'Light'], ['brand', 'Main colour'], ['dark', 'Dark']].map(function (o) { return chip(o[1], (cur.sidebar || 'light') === o[0], function () { cur.sidebar = o[0] === 'light' ? undefined : o[0]; changed(); }, { 'data-th-sidebar': o[0] }); })));
      controls.appendChild(row('Page background', [['soft', 'Soft grey'], ['white', 'White'], ['tint', 'Light tint of the main colour']].map(function (o) { return chip(o[1], (cur.background || 'soft') === o[0], function () { cur.background = o[0] === 'soft' ? undefined : o[0]; changed(); }, { 'data-th-bg': o[0] }); })));
      var font = el('select', { class: 'input', id: 'ns-th-font', style: 'max-width:220px' }, T.FONTS.map(function (f) { return el('option', { value: f, text: f + (f === 'Inter' ? ' (default)' : '') }); }));
      font.value = cur.font || 'Inter';
      font.onchange = function () { cur.font = font.value === 'Inter' ? undefined : font.value; changed(); };
      var size = el('select', { class: 'input', id: 'ns-th-size', style: 'max-width:160px' }, [[14, 'Small'], [15, 'Compact'], [16, 'Normal'], [17, 'Large'], [18, 'Extra large']].map(function (o) { return el('option', { value: String(o[0]), text: o[1] }); }));
      size.value = String(cur.size || 16);
      size.onchange = function () { cur.size = +size.value === 16 ? undefined : +size.value; changed(); };
      controls.appendChild(row('Font and text size', [font, size]));
      controls.appendChild(row('Corners', [['sharp', 'Sharp'], ['normal', 'Normal'], ['round', 'Round']].map(function (o) { return chip(o[1], (cur.radius || 'normal') === o[0], function () { cur.radius = o[0] === 'normal' ? undefined : o[0]; changed(); }, { 'data-th-radius': o[0] }); })));
      controls.appendChild(row('Default mode', [['light', '☀ Light'], ['dark', '☾ Dark']].map(function (o) { return chip(o[1], (cur.mode || 'light') === o[0], function () { cur.mode = o[0]; changed(); try { localStorage.setItem('crm_theme', o[0]); } catch (e) {} document.documentElement.classList.toggle('dark', o[0] === 'dark'); }, { 'data-th-mode': o[0] }); })));
    }
    drawControls();
    function clean() { var o = {}; Object.keys(cur).forEach(function (k) { if (cur[k] != null && cur[k] !== '') o[k] = cur[k]; }); return o; }
    var btns = [
      el('button', { class: 'btn-primary', type: 'button', id: 'ns-th-mine', text: 'Use for me', onclick: function () {
        api('PUT', '/app-settings/my-theme', { theme: clean() }).then(function (j) { st.myTheme = j.data.myTheme || {}; T.setMine(st.myTheme); flash(msg, j.message || 'Saved'); }).catch(function (e) { flash(msg, e.message, true); });
      } }),
      hasMine ? el('button', { class: 'btn-secondary', type: 'button', id: 'ns-th-follow', text: 'Follow the company theme', onclick: function () {
        api('PUT', '/app-settings/my-theme', { theme: null }).then(function (j) { st.myTheme = {}; T.setMine({}); drawTheme(box, admin); flash(box.querySelector('[data-th-msg]'), j.message); }).catch(function (e) { flash(msg, e.message, true); });
      } }) : null,
      admin ? el('button', { class: 'btn-secondary', type: 'button', id: 'ns-th-company', text: 'Save as company theme (everyone)', onclick: function () {
        if (!confirm('Use this look for everyone who has not picked their own?')) return;
        api('PUT', '/app-settings/theme', { theme: clean() }).then(function (j) { st.theme = j.data.theme || {}; T.setCompany(st.theme); flash(msg, j.message || 'Saved'); }).catch(function (e) { flash(msg, e.message, true); });
      } }) : null,
      el('button', { class: 'btn-secondary', type: 'button', id: 'ns-th-reset', text: 'Undo changes', onclick: function () { T.apply(); drawTheme(box, admin); } })
    ];
    box.appendChild(el('div', { class: 'flex items-start justify-between gap-3 flex-wrap mb-3' }, [
      el('div', {}, [el('h2', { class: 'section-title mb-0', text: '🎨 Theme' }),
        el('p', { class: 'text-sm text-muted mt-1', text: 'Change the colours, sidebar, background, font, text size and corners — the page changes as you pick, so you can see it before saving. ' +
          (hasMine ? 'You are using your own theme.' : 'You are using the company theme.') + (admin ? ' “Save as company theme” sets it for everyone who has not picked their own.' : '') })])]));
    box.appendChild(controls);
    box.appendChild(el('div', { class: 'flex flex-wrap gap-2 items-center' }, btns.concat([msg])));
  }

  // ── notifications ─────────────────────────────────────────────────────
  function rowFor(type, label) {
    var c = st.n[type] || {};
    var on = el('input', { type: 'checkbox', 'data-f': 'on', 'aria-label': 'On' }); on.checked = c.on !== false;
    var push = el('input', { type: 'checkbox', 'data-f': 'push', 'aria-label': 'Phone / desktop notification' }); push.checked = c.push !== false;
    var snd = el('select', { class: 'input py-1 text-sm', 'data-f': 'sound', 'aria-label': 'Sound' }, SOUNDS.map(function (s) { return el('option', { value: s, text: SOUND_LABEL[s] }); }));
    snd.value = c.sound || 'default';
    var title = el('input', { class: 'input py-1 text-sm', 'data-f': 'title', placeholder: '{title}', maxlength: '120', value: c.title || '' });
    var body = el('input', { class: 'input py-1 text-sm', 'data-f': 'body', placeholder: '{body}', maxlength: '300', value: c.body || '' });
    var tr = el('tr', { class: 'table-row align-top', 'data-ns-type': type }, [
      el('td', { class: 'px-4 py-2' }, [el('div', { class: 'font-medium', text: label }), el('div', { class: 'text-xs text-muted font-mono', text: type })]),
      el('td', { class: 'px-3 py-2 text-center' }, [on]),
      el('td', { class: 'px-3 py-2' }, [el('div', { class: 'flex items-center gap-1' }, [snd,
        el('button', { class: 'btn-secondary btn-sm', type: 'button', title: 'Play', 'aria-label': 'Play sound', 'data-ns-play': '1', text: '▶', onclick: function () { play(snd.value); } })])]),
      el('td', { class: 'px-3 py-2 text-center' }, [push]),
      el('td', { class: 'px-3 py-2', style: 'min-width:180px' }, [title]),
      el('td', { class: 'px-3 py-2', style: 'min-width:220px' }, [body])
    ]);
    function dim() { tr.style.opacity = on.checked ? '' : '0.55'; }
    on.addEventListener('change', dim); dim();
    return tr;
  }
  function collect(box) {
    var out = {};
    Array.prototype.forEach.call(box.querySelectorAll('tr[data-ns-type]'), function (tr) {
      var g = function (f) { return tr.querySelector('[data-f="' + f + '"]'); };
      out[tr.getAttribute('data-ns-type')] = { on: g('on').checked, push: g('push').checked, sound: g('sound').value, title: g('title').value, body: g('body').value };
    });
    return out;
  }
  function drawNotify(box) {
    box.innerHTML = '';
    var msg = el('span', { class: 'text-sm', id: 'ns-msg' });
    var save = el('button', { class: 'btn-primary', type: 'button', id: 'ns-save', text: 'Save notification settings' });
    box.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2' }, [
      el('div', {}, [
        el('h2', { class: 'text-base font-semibold', text: '🔔 Notifications — page by page' }),
        el('p', { class: 'text-xs text-muted', text: 'Title / text: leave empty to keep the normal wording. {title} and {body} put the normal wording in, {name} the CRM name — e.g. “⚠ {title}” or “{body} — please act today”.' })
      ]),
      el('div', { class: 'flex items-center gap-2' }, [msg,
        el('button', { class: 'btn-secondary', type: 'button', id: 'ns-reset', text: 'Reset all', onclick: function () {
          if (!confirm('Put every alert back to its normal sound and wording?')) return;
          st.n = {}; drawNotify(box); flash(box.querySelector('#ns-msg'), 'Reset — press Save to keep it');
        } }), save])
    ]));
    var head = el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, ['Alert', 'On', 'Sound', 'Phone / desktop', 'Title', 'Text'].map(function (h, i) {
      return el('th', { class: 'table-head px-3 py-2 whitespace-nowrap ' + (i === 1 || i === 3 ? 'text-center' : 'text-left'), text: h });
    }))]);
    var body = el('tbody', {});
    GROUPS.forEach(function (g) {
      body.appendChild(el('tr', { class: 'bg-slate-100/70 dark:bg-slate-800', 'data-ns-group': g[0] }, [el('td', { class: 'px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300', colspan: '6', text: g[0] })]));
      g[1].forEach(function (t) { body.appendChild(rowFor(t[0], t[1])); });
    });
    box.appendChild(el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-sm', id: 'ns-table' }, [head, body])]));
    box.appendChild(el('p', { class: 'px-5 py-3 text-xs text-muted', text: 'Sounds play on the website and in the Android app (app version with custom sounds). “Phone / desktop” off = the alert only shows inside the CRM, nothing in the phone’s top bar. Each person can still mute sounds on their own device.' }));
    save.addEventListener('click', function () {
      save.disabled = true;
      api('PUT', '/app-settings/notifications', { types: collect(box) }).then(function (j) {
        st.n = j.data.notifications || {};
        if (window.CRMAlerts && window.CRMAlerts.reloadSettings) window.CRMAlerts.reloadSettings(st.n);
        flash(msg, '✓ Saved — applies on every page within a few minutes');
      }).catch(function (e) { flash(msg, e.message, true); }).then(function () { save.disabled = false; });
    });
  }

  window.NotifySettings = { mountPage: mountPage, GROUPS: GROUPS };
})();
