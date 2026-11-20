/* ══════════════════════════════════════════════════════════════════════
   bulk-import.js — Excel template + upload on the pages (v11.57).
   Loaded by crm-global.js on: Vendors, Customers, HR, Tasks, Appointments,
   Petty cash, Accounts. Adds "⬇ Template" and "⬆ Upload Excel" next to the
   page title. The upload is checked first (new / update / problems per row);
   nothing is saved until "Save" is pressed.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__bulkImport) return;
  window.__bulkImport = true;
  var API = 'https://api.apjtech.in';
  // page → [upload key, where the buttons go (function returning [element, 'after' | 'append'])]
  function h1(text) { return function () { var h = Array.prototype.filter.call(document.querySelectorAll('h1'), function (x) { return x.offsetParent !== null && !x.closest('.bi-modal') && (!text || x.textContent.trim() === text); })[0]; return h ? [h, 'after'] : null; }; }
  var PAGES = {
    '/vendors/': [['vendors', h1()]], '/customers/': [['customers', h1()]], '/hr/': [['hr', h1()]], '/appointments/': [['appointments', h1()]], '/accounts/': [['accounts', h1()]],
    '/tasks/': [['tasks', h1('Tasks')]], '/md-desk/': [['tasks', h1('Tasks')]],
    '/fuel-expense/': [['petty-cash', function () { var x = document.getElementById('pc-excel'); return x && x.offsetParent !== null ? [x.parentNode, 'append'] : null; }]]
  };
  var path = location.pathname.replace(/\/?$/, '/');
  if (!PAGES[path]) return;
  var KEY = null;
  function token() { try { return localStorage.getItem('crm_token') || ''; } catch (e) { return ''; } }
  if (!token()) return;
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function toast(msg, bad) {
    var t = document.getElementById('bi-toast') || document.body.appendChild(el('div', { id: 'bi-toast' }));
    t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.opacity = '1';
    clearTimeout(t._t); t._t = setTimeout(function () { t.style.opacity = '0'; }, 4500);
  }
  (function css() {
    var st = document.createElement('style');
    st.textContent = [
      '.bi-bar{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 4px 10px;vertical-align:middle}',
      '.bi-bar button{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;padding:5px 11px;font:600 12.5px system-ui,sans-serif;cursor:pointer;white-space:nowrap}',
      '.bi-bar button:hover{background:#f1f5f9}.dark .bi-bar button{background:#1e293b;color:#e2e8f0;border-color:#334155}',
      '#bi-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f766e;color:#fff;padding:10px 18px;border-radius:10px;font:600 14px system-ui;z-index:2147483600;opacity:0;transition:opacity .3s;max-width:90vw}#bi-toast.bad{background:#b91c1c}',
      '.bi-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:20px 10px}',
      '.bi-dlg{background:#fff;color:#0f172a;border-radius:14px;width:100%;max-width:860px;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.3);font:14px system-ui,sans-serif}',
      '.bi-dlg h3{margin:0 0 4px;font-size:18px}.bi-sub{color:#64748b;font-size:12.5px;margin-bottom:10px}',
      '.bi-counts{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.bi-counts span{border-radius:999px;padding:3px 10px;font:600 12.5px system-ui}',
      '.bi-tbl{width:100%;border-collapse:collapse;font-size:13px}.bi-tbl td,.bi-tbl th{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left;vertical-align:top}',
      '.bi-tbl th{font-size:11.5px;color:#64748b;text-transform:uppercase}.bi-wrap{max-height:50vh;overflow:auto;border:1px solid #e2e8f0;border-radius:10px}',
      '.bi-btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}',
      '.bi-btn{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;padding:8px 14px;font:600 13.5px system-ui;cursor:pointer}',
      '.bi-btn.pri{background:#1e3a5f;border-color:#1e3a5f;color:#fff}.bi-btn:disabled{opacity:.5;cursor:not-allowed}'
    ].join('\n');
    document.head.appendChild(st);
  })();
  var A = { new: ['New', '#047857', '#d1fae5'], update: ['Update', '#1d4ed8', '#dbeafe'], same: ['No change', '#475569', '#e2e8f0'], error: ['Problem', '#b91c1c', '#fee2e2'] };
  function chip(a, n) { var x = A[a]; return el('span', { style: 'color:' + x[1] + ';background:' + x[2], text: (n != null ? n + ' ' : '') + x[0].toLowerCase() }); }

  function template() {
    fetch(API + '/api/bulk/' + KEY + '/template', { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || 'Could not get the template'); }); return r.blob(); })
      .then(function (b) { var u = URL.createObjectURL(b), a = el('a', { href: u, download: KEY + '-template.xlsx' }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 20000); toast('Template downloaded — fill the first sheet and upload it'); })
      .catch(function (e) { toast(e.message, true); });
  }
  function upload() {
    var inp = el('input', { type: 'file', accept: '.xlsx,.csv', style: 'display:none' });
    document.body.appendChild(inp);
    inp.addEventListener('change', function () { var f = inp.files[0]; inp.remove(); if (f) check(f); });
    inp.click();
  }
  function send(file, save) {
    var fd = new FormData(); fd.append('file', file);
    return fetch(API + '/api/bulk/' + KEY + '/import' + (save ? '?save=1' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: fd })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) { var e = new Error(j.message || 'Upload failed'); e.data = j; throw e; } return j; }); });
  }
  function check(file) {
    var modal = el('div', { class: 'bi-modal' }), dlg = el('div', { class: 'bi-dlg', id: 'bi-dlg' }, [el('div', { text: 'Checking ' + file.name + '…' })]);
    modal.appendChild(dlg); document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    send(file, false).then(function (j) { draw(j.data); }).catch(function (e) { draw(e.data && e.data.errors && e.data.errors.rows ? e.data.errors : null, e.message); });
    function draw(d, msg) {
      dlg.innerHTML = '';
      dlg.appendChild(el('h3', { text: '⬆ Upload — ' + (d && d.title ? d.title : file.name) }));
      dlg.appendChild(el('div', { class: 'bi-sub', text: file.name + ' · checked, nothing saved yet' }));
      if (!d) {
        dlg.appendChild(el('div', { style: 'background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px', text: msg }));
        dlg.appendChild(el('div', { class: 'bi-btns' }, [el('button', { class: 'bi-btn', type: 'button', text: '⬇ Template', onclick: template }), el('button', { class: 'bi-btn', type: 'button', text: 'Close', onclick: function () { modal.remove(); } })]));
        return;
      }
      var c = d.counts;
      dlg.appendChild(el('div', { class: 'bi-counts', id: 'bi-counts' }, [chip('new', c.new), chip('update', c.update), c.same ? chip('same', c.same) : null, c.error ? chip('error', c.error) : null]));
      var tb = el('tbody');
      d.rows.forEach(function (r) {
        var x = A[r.action];
        tb.appendChild(el('tr', { 'data-bi-row': r.row, 'data-bi-action': r.action }, [
          el('td', { text: String(r.row) }), el('td', { text: r.label || '' }),
          el('td', {}, [el('span', { style: 'color:' + x[1] + ';font-weight:600', text: x[0] })]),
          el('td', { style: r.action === 'error' ? 'color:#b91c1c' : 'color:#475569', text: r.errors ? r.errors.join(' · ') : r.changes ? 'changes: ' + r.changes.join(', ') : '' })
        ]));
      });
      if (!d.rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: '4', text: 'No rows found under the heading row.' })]));
      dlg.appendChild(el('div', { class: 'bi-wrap' }, [el('table', { class: 'bi-tbl' }, [el('thead', {}, [el('tr', {}, ['Row', 'Name', 'Result', 'Details'].map(function (h) { return el('th', { text: h }); }))]), tb])]));
      if (msg) dlg.appendChild(el('div', { style: 'color:#b91c1c;margin-top:8px', text: msg }));
      var n = c.new + c.update;
      var save = el('button', { class: 'bi-btn pri', type: 'button', id: 'bi-save', disabled: c.error || !n ? true : null,
        text: c.error ? 'Fix the ' + c.error + ' row(s) with problems, then upload again' : n ? 'Save ' + n + ' row' + (n > 1 ? 's' : '') : 'Nothing to save',
        onclick: function () {
          save.disabled = true; save.textContent = 'Saving…';
          send(file, true).then(function (j) { toast(j.message || 'Saved'); modal.remove(); setTimeout(function () { location.reload(); }, 900); })
            .catch(function (e) { save.disabled = false; save.textContent = 'Save'; toast(e.message, true); });
        } });
      dlg.appendChild(el('div', { class: 'bi-btns' }, [el('button', { class: 'bi-btn', type: 'button', text: 'Cancel', onclick: function () { modal.remove(); } }),
        el('button', { class: 'bi-btn', type: 'button', text: '⬆ Choose another file', onclick: function () { modal.remove(); upload(); } }), save]));
    }
  }

  // ── buttons next to the page title / list buttons (put back if the page redraws) ──
  var allowed = null;
  function place() {
    if (!allowed) return;
    PAGES[path].forEach(function (pg) {
      var key = pg[0];
      if (!allowed[key] || document.getElementById('bi-bar-' + key)) return;
      var at = pg[1]();
      if (!at) return;
      var bar = el('span', { id: 'bi-bar-' + key, class: 'bi-bar' }, [
        el('button', { type: 'button', 'data-bi-template': key, title: 'Excel with the columns of ' + allowed[key] + ' — one row per line', text: '⬇ Template', onclick: function () { KEY = key; template(); } }),
        el('button', { type: 'button', 'data-bi-upload': key, title: 'Upload the filled template — checked first, then saved', text: '⬆ Upload Excel', onclick: function () { KEY = key; upload(); } })
      ]);
      if (at[1] === 'append') at[0].appendChild(bar); else at[0].insertAdjacentElement('afterend', bar);
    });
  }
  fetch(API + '/api/bulk', { headers: { Authorization: 'Bearer ' + token() } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.data) return;
    allowed = j.data.pages;
    if (!PAGES[path].some(function (pg) { return allowed[pg[0]]; })) return;
    place();
    new MutationObserver(function () { clearTimeout(place._t); place._t = setTimeout(place, 150); }).observe(document.body, { childList: true, subtree: true });
  }).catch(function () {});
})();
