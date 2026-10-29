/* ══════════════════════════════════════════════════════════════════════
   Admin → Notifications & branding (Super Admin / Admin).

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

  var st = { n: {}, b: {} };

  function mountPage(root) {
    var u = user();
    if (!u || ['SUPER_ADMIN', 'ADMIN'].indexOf(u.role) === -1) {
      root.appendChild(el('div', { class: 'card p-6 text-sm text-muted', text: 'Only the Super Admin or an Admin can open this page.' }));
      return;
    }
    root.appendChild(el('p', { class: 'text-sm text-muted mb-4', text: 'Choose how every alert looks and sounds — on the website and in the Android app — and set the CRM name and logo.' }));
    var brandBox = el('div', { class: 'card p-5 mb-5', id: 'ns-brand' });
    var notifyBox = el('div', { class: 'card overflow-hidden mb-5', id: 'ns-notify' });
    root.appendChild(brandBox); root.appendChild(notifyBox);
    brandBox.appendChild(el('p', { class: 'text-sm text-muted', text: 'Loading…' }));
    api('GET', '/app-settings').then(function (j) {
      st.n = j.data.notifications || {}; st.b = j.data.branding || {};
      drawBrand(brandBox); drawNotify(notifyBox);
    }).catch(function (e) { brandBox.innerHTML = ''; brandBox.appendChild(el('p', { class: 'text-sm text-red-600', text: e.message })); });
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
