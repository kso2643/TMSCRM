/* ══════════════════════════════════════════════════════════════════════
   quote-extras.js — quotation page helpers (v11.47). Loaded on /quotations/ only.

   1. Signatory = the person signed in. A new quotation gets your name (and your
      designation from your profile) in "Authorised by". A saved quotation keeps
      the name it was made with.
   2. ✎ Revise — on every saved quotation: makes a revised copy numbered …-R1, -R2…
      and opens it for editing. The original stays as it was (marked "Revised →").
   3. 📋 Paste message → items — paste a WhatsApp / e-mail message or rows copied
      from Excel (item code, description, qty, price, discount, delivery in any
      order). The items are read out, shown in a table to check and correct, then
      added to the quotation in one go.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__quoteExtras || !/^\/quotations\/?/.test(location.pathname)) return;
  window.__quoteExtras = true;
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token') || ''; } catch (e) { return ''; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  function api(method, path, body) {
    var h = { Authorization: 'Bearer ' + token() };
    if (body) h['Content-Type'] = 'application/json';
    return fetch(API + '/api' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed (' + r.status + ')'); return j; });
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function toast(msg, bad) {
    var t = document.getElementById('qx-toast');
    if (!t) { t = el('div', { id: 'qx-toast', role: 'status' }); document.body.appendChild(t); }
    t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.opacity = '1';
    clearTimeout(t._t); t._t = setTimeout(function () { t.style.opacity = '0'; }, 3800);
  }
  function css() {
    if (document.getElementById('qx-css')) return;
    var st = document.createElement('style'); st.id = 'qx-css';
    st.textContent = [
      '#qx-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483600;background:#0f172a;color:#fff;padding:.6rem 1rem;border-radius:.6rem;font:500 .85rem system-ui,sans-serif;transition:opacity .3s;opacity:0;pointer-events:none;max-width:90vw}',
      '#qx-toast.bad{background:#7f1d1d}',
      '.qx-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto}',
      '.qx-md{background:#fff;color:#0f172a;border-radius:16px;width:min(980px,100%);box-shadow:0 30px 80px -20px rgba(0,0,0,.45);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.qx-hd{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e2e8f0}.qx-hd h3{margin:0;font-size:1.05rem}',
      '.qx-bd{padding:14px 18px;display:grid;gap:10px}.qx-ft{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 18px;border-top:1px solid #e2e8f0}',
      '.qx-md textarea{width:100%;min-height:150px;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:13px/1.45 ui-monospace,Consolas,monospace;resize:vertical;box-sizing:border-box}',
      '.qx-md .qx-b{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:9px;padding:7px 13px;font-weight:600;cursor:pointer;font-size:.85rem}',
      '.qx-md .qx-b.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.qx-md .qx-b[disabled]{opacity:.5;cursor:default}',
      '.qx-hint{font-size:.78rem;color:#64748b}.qx-tbl{width:100%;border-collapse:collapse;font-size:.82rem}',
      '.qx-tbl th{text-align:left;font-size:.7rem;text-transform:uppercase;color:#64748b;padding:5px 4px;border-bottom:1px solid #e2e8f0}.qx-tbl td{padding:3px 4px;border-bottom:1px solid #f1f5f9}',
      '.qx-tbl input{width:100%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:6px;padding:5px 6px;font:inherit}.qx-tbl input.n{text-align:right}',
      '.qx-tbl tr.warn input[data-f="unitPrice"]{border-color:#f59e0b;background:#fffbeb}',
      '.qx-scroll{overflow-x:auto;max-height:46vh;overflow-y:auto}',
      '.qx-paste-btn{white-space:nowrap}',
      '.qx-rev{display:inline-block;font-size:.66rem;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:middle;background:#ede9fe;color:#6d28d9}',
      '.qx-by{font-size:.8rem;color:#64748b;margin-top:2px}',
      '#app-apj .qx-by{color:#9fb3c8}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── 1. signatory = the signed-in person ─────────────────────────────
  var prof = null;
  function fillSign() {
    var u = me(); if (!u.name) return;
    ['tms', 'apj'].forEach(function (co) {
      var root = document.getElementById('app-' + co); if (!root) return;
      var n = root.querySelector('#sign-name'), d = root.querySelector('#sign-designation');
      if (n && !n.value.trim() && !n.dataset.qxDone) { n.value = u.name; n.dataset.qxDone = '1'; }
      if (d && prof && prof.designation && !d.dataset.qxDone && ['', 'Director', 'Sales & Application Engineer'].indexOf(d.value.trim()) >= 0) { d.value = prof.designation; d.dataset.qxDone = '1'; }
    });
  }
  function loadProfile() {
    if (!token()) return;
    api('GET', '/auth/me').then(function (j) { prof = (j.data && j.data.user) || null; fillSign(); }).catch(function () {});
  }

  // ── 2. revise ───────────────────────────────────────────────────────
  window.reviseQuotation = function (id, company) {
    var co = String(company || 'TMS').toUpperCase() === 'APJ' ? 'apj' : 'tms';
    if (!confirm('Make a revised quotation?\n\nA new copy is made with the next revision number (…-R1, -R2…) and opened for you to change. The original stays as it is.')) return;
    api('POST', '/quotations/' + encodeURIComponent(id) + '/revise').then(function (j) {
      var q = j.data && j.data.quotation;
      if (!q) throw new Error('No quotation came back');
      toast('Revised quotation ' + q.quotationNumber + ' made — change it and Save');
      var open = window[co + '_editQuotation'];
      if (typeof open === 'function') return open(q.id);
    }).catch(function (e) { toast(e.message, true); });
  };
  // the saved-quotation cards: "Revise" button, who made it, revision state
  function decorateCards() {
    var list = document.querySelectorAll('#completed-list');
    Array.prototype.forEach.call(list, function (box) {
      var data = box.__qxData || {};
      Array.prototype.forEach.call(box.querySelectorAll('button[onclick*="_editQuotation("]'), function (b) {
        var m = /_editQuotation\('([^']+)'\)/.exec(b.getAttribute('onclick') || ''); if (!m) return;
        var id = m[1], wrap = b.parentElement;
        if (!wrap || wrap.querySelector('[data-qx-revise]')) return;
        var co = /apj_/.test(b.getAttribute('onclick')) ? 'APJ' : 'TMS';
        var rb = el('button', { type: 'button', class: b.className.replace(/btn-primary/, '').trim() || 'btn', 'data-qx-revise': id, title: 'Make a revised copy (…-R1, -R2) — the original stays as it is', text: '✎ Revise',
          style: 'background:#7c3aed;color:#fff;border-color:#7c3aed', onclick: function () { window.reviseQuotation(id, co); } });
        wrap.insertBefore(rb, b.nextSibling);
        var q = data[id], card = wrap.closest('.quot-card') || wrap.parentElement;
        if (q && card && !card.querySelector('.qx-by')) {
          var head = card.querySelector('h3');
          if (head && q.revision > 0) head.appendChild(el('span', { class: 'qx-rev', text: 'Revision ' + q.revision }));
          if (head && q.supersededById) head.appendChild(el('span', { class: 'qx-rev', style: 'background:#fef3c7;color:#92400e', text: 'Revised → newer copy' }));
          var who = q.signName || (q.user && q.user.name);
          if (who && head) head.insertAdjacentElement('afterend', el('div', { class: 'qx-by', 'data-qx-by': id, text: '👤 ' + who + (q.user && q.user.name && q.user.name !== who ? ' · made by ' + q.user.name : '') }));
        }
      });
    });
  }
  // remember the list rows the page loads (so cards can show the person and revision)
  (function hookList() {
    var of = window.fetch;
    window.fetch = function (u, o) {
      var p = of.apply(this, arguments);
      try {
        var url = typeof u === 'string' ? u : (u && u.url) || '';
        if (/\/api\/quotations\?/.test(url) && (!o || !o.method || o.method === 'GET')) {
          p.then(function (r) { return r.clone().json(); }).then(function (j) {
            var rows = (j && j.data && (j.data.items || j.data)) || [];
            if (!Array.isArray(rows)) return;
            Array.prototype.forEach.call(document.querySelectorAll('#completed-list'), function (box) {
              box.__qxData = box.__qxData || {};
              rows.forEach(function (q) { box.__qxData[q.id] = q; });
            });
            setTimeout(decorateCards, 0); setTimeout(decorateCards, 300);
          }).catch(function () {});
        }
      } catch (e) {}
      return p;
    };
  })();

  // ── 3. paste a message → items ──────────────────────────────────────
  var NUM = '(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  function n(v) { var x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(x) ? null : x; }
  function isCode(t) { return /^[A-Z0-9][A-Z0-9\-\/\.]{3,}$/i.test(t) && /[A-Z]/i.test(t) && /\d/.test(t) && !/^\d+(\.\d+)?(nos|pcs|pc|days?|mm|cm|m|in|inch|d|xd|flutes?|fl)$/i.test(t); }
  var SKIP = /^(dear|hi|hello|good\s*(morning|afternoon|evening)|thanks?|thank you|regards|warm regards|best regards|sir|madam|please|kindly|note|from|to|sub(ject)?|customer)\b/i;
  /** One message line → { productCode, spec, moq, unitPrice, discount, delivery } (fields it found), or null. */
  function parseLine(line) {
    var s = ' ' + line.replace(/\u20b9/g, ' Rs ').replace(/[*_~]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    var out = {}, m;
    function cut(re) { s = s.replace(re, ' '); }
    // delivery / lead time
    if ((m = /\b(?:delivery|del\.?|lead\s*time|l\/t|lt)\s*[:=\-]?\s*([a-z0-9 ]{1,24}?(?:days?|weeks?|wks?|months?|stock)\b)/i.exec(s))) { out.delivery = m[1].trim(); cut(m[0]); }
    else if ((m = /\b(ex[\s\-]?stock|\d+\s*(?:-\s*\d+\s*)?(?:days?|weeks?|wks?))\b/i.exec(s))) { out.delivery = m[1].trim(); cut(m[0]); }
    // discount
    if ((m = new RegExp('\\b(?:disc(?:ount)?\\.?|less)\\s*[:=\\-@]?\\s*' + NUM + '\\s*%?', 'i').exec(s)) || (m = new RegExp(NUM + '\\s*%\\s*(?:disc(?:ount)?|off|less)?', 'i').exec(s))) { out.discount = n(m[1]); cut(m[0]); }
    // quantity
    if ((m = new RegExp('\\b(?:qty|quantity|moq|nos?\\.?)\\s*[:=\\-]?\\s*' + NUM, 'i').exec(s)) || (m = new RegExp('\\b' + NUM + '\\s*(?:nos?\\b\\.?|pcs\\b|pc\\b|pieces\\b|units?\\b|sets?\\b|ea\\b|numbers\\b)', 'i').exec(s))) { out.moq = n(m[1]); cut(m[0]); }
    // price
    if ((m = new RegExp('(?:\\b(?:rs|inr|price|rate|cost|unit\\s*price|net)\\b\\.?|@)\\s*[:=\\-]?\\s*(?:rs\\.?\\s*)?' + NUM + '\\s*(?:/-|rs\\b)?', 'i').exec(s)) || (m = new RegExp(NUM + '\\s*(?:/-|rs\\b|inr\\b)', 'i').exec(s))) { out.unitPrice = n(m[1]); cut(m[0]); }
    s = s.replace(/^\s*(?:\d{1,3}[.)]|[-•●▪»>]|\(\d{1,3}\))\s*/, ' ').replace(/[|;]+/g, ' ').replace(/\s*[-–—:,]+\s*$/g, '').replace(/^\s*[-–—:,]+\s*/, '').replace(/\s+/g, ' ').trim();
    var toks = s.split(' ').filter(function (t) { return /[A-Za-z0-9]/.test(t); }), code = '';
    for (var i = 0; i < toks.length; i++) { var t = toks[i].replace(/[,:]+$/, ''); if (isCode(t)) { code = t.toUpperCase(); toks.splice(i, 1); break; } }
    var spec = toks.join(' ').replace(/[\s\-–—,:;.]+$/, '').replace(/^[\s\-–—,:;]+/, '').trim();
    if (code) out.productCode = code;
    if (spec) out.spec = spec;
    return out;
  }
  /** Rows copied from Excel / a table (tab or 2+ space separated) — uses a header row when there is one. */
  function parseTable(lines) {
    var rows = lines.map(function (l) { return l.split(/\t| {3,}/).map(function (c) { return c.trim(); }); }).filter(function (r) { return r.filter(Boolean).length >= 2; });
    if (rows.length < 1) return null;
    var head = rows[0].map(function (c) { return c.toLowerCase(); }), map = {};
    head.forEach(function (h, i) {
      if (/code|part|cat(alog)?\.?\s*no|item\s*no/.test(h)) map.productCode = i;
      else if (/desc|product|item|spec|name/.test(h)) map.spec = map.spec == null ? i : map.spec;
      else if (/qty|quantity|moq|nos/.test(h)) map.moq = i;
      else if (/disc/.test(h)) map.discount = i;
      else if (/price|rate|cost|amount|rs/.test(h)) map.unitPrice = map.unitPrice == null ? i : map.unitPrice;
      else if (/deliv|lead/.test(h)) map.delivery = i;
    });
    var hasHead = Object.keys(map).length >= 2;
    var body = hasHead ? rows.slice(1) : rows;
    return body.map(function (r) {
      if (hasHead) {
        var o = {};
        Object.keys(map).forEach(function (k) { var v = r[map[k]]; if (v == null || v === '') return; o[k] = /moq|unitPrice|discount/.test(k) ? n(String(v).replace(/[^\d.,]/g, '')) : v; });
        if (o.productCode) o.productCode = String(o.productCode).toUpperCase();
        return o;
      }
      // no header: code = first code-like cell, numbers from the right = price, then qty
      var o2 = {}, nums = [];
      r.forEach(function (c, i) {
        if (!o2.productCode && isCode(c.split(' ')[0]) && c.split(' ').length <= 2) { o2.productCode = c.toUpperCase(); return; }
        if (/^(rs\.?|₹)?\s*[\d,]+(\.\d+)?\s*(%|nos|pcs)?$/i.test(c)) { nums.push(c); return; }
        if (/days?|weeks?|stock/i.test(c)) { o2.delivery = c; return; }
        o2.spec = o2.spec ? o2.spec + ' ' + c : c;
      });
      var pct = nums.filter(function (x) { return /%/.test(x); })[0];
      if (pct) { o2.discount = n(pct.replace(/[^\d.]/g, '')); nums = nums.filter(function (x) { return x !== pct; }); }
      if (nums.length) o2.unitPrice = n(nums.pop().replace(/[^\d.,]/g, ''));
      if (nums.length) o2.moq = n(nums.pop().replace(/[^\d.,]/g, ''));
      return o2;
    });
  }
  /** The whole message → item list. */
  function parseMessage(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return l.trim(); });
    var tabbed = lines.filter(function (l) { return /\t/.test(l); }).length;
    if (tabbed >= Math.max(1, lines.length / 2)) return (parseTable(lines) || []).filter(function (o) { return o.productCode || o.spec; });
    var out = [];
    lines.forEach(function (l) {
      var t = l.trim();
      if (SKIP.test(t) && !/\d{2,}/.test(t)) return;
      var o = parseLine(t);
      var hasNumbers = o.moq != null || o.unitPrice != null || o.discount != null || o.delivery != null;
      var prev = out[out.length - 1];
      // "Qty 10, Rs 450" on the line under the item → belongs to that item
      if (!o.productCode && (!o.spec || o.spec.length < 3) && hasNumbers && prev) {
        ['moq', 'unitPrice', 'discount', 'delivery'].forEach(function (k) { if (o[k] != null && prev[k] == null) prev[k] = o[k]; });
        return;
      }
      if (!o.productCode && !hasNumbers) {
        if (SKIP.test(t) || t.length < 4 || /[?]$/.test(t)) return;
        if (!/\d/.test(t)) return;   // plain sentence, not an item
      }
      if (o.productCode || o.spec) out.push(o);
    });
    return out;
  }
  window.QuoteExtras = { parseMessage: parseMessage };

  function pasteDialog(company) {
    css();
    var co = String(company).toUpperCase() === 'APJ' ? 'apj' : 'tms';
    var setItems = window[co + '_setItemsFromPR'];
    if (typeof setItems !== 'function') { toast('Reload the page and try again.', true); return; }
    var rows = [];
    var ta = el('textarea', { id: 'qx-text', placeholder: 'Paste the message here, e.g.\n\nDear sir, please find our price\n1. CNMG120408-PM 4325 — 10 nos — Rs 450 — 10% disc — 1 week\n2. Drill 10mm Zecha, qty 5, rate 2,850/-, ex-stock\n\n…or rows copied from Excel (code, description, qty, price).' });
    var tbody = el('tbody'), info = el('div', { class: 'qx-hint', id: 'qx-info' });
    var add = el('button', { class: 'qx-b pri', type: 'button', id: 'qx-add', disabled: true, text: 'Add items' });
    var replace = el('input', { type: 'checkbox', id: 'qx-replace' });
    var hasItems = Array.prototype.some.call(document.querySelectorAll('#app-' + co + ' #items-container .item-row input'), function (i) { return i.value.trim(); });
    function draw() {
      tbody.innerHTML = '';
      rows.forEach(function (r, i) {
        var tr = el('tr', { class: r.unitPrice == null ? 'warn' : '', 'data-qx-row': i });
        [['productCode', 'Item code', ''], ['spec', 'Description', ''], ['moq', 'Qty', 'n'], ['unitPrice', 'Price ₹', 'n'], ['discount', 'Disc %', 'n'], ['delivery', 'Delivery', '']].forEach(function (f) {
          var inp = el('input', { class: f[2], 'data-f': f[0], placeholder: f[1], value: r[f[0]] == null ? '' : r[f[0]], 'aria-label': f[1] + ' row ' + (i + 1) });
          inp.addEventListener('input', function () { r[f[0]] = f[2] ? n(inp.value) : inp.value; tr.className = r.unitPrice == null ? 'warn' : ''; });
          tr.appendChild(el('td', { style: f[0] === 'spec' ? 'min-width:14rem' : f[2] ? 'width:6rem' : 'min-width:8rem' }, [inp]));
        });
        tr.appendChild(el('td', {}, [el('button', { class: 'qx-b', type: 'button', title: 'Remove', text: '✕', onclick: function () { rows.splice(i, 1); draw(); } })]));
        tbody.appendChild(tr);
      });
      var noPrice = rows.filter(function (r) { return r.unitPrice == null; }).length;
      info.textContent = rows.length ? rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' found — check them and correct anything wrong.' + (noPrice ? ' ' + noPrice + ' without a price (yellow).' : '') : (ta.value.trim() ? 'No items found — make sure each item is on its own line.' : '');
      add.disabled = !rows.length; add.textContent = rows.length ? 'Add ' + rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' to the quotation' : 'Add items';
    }
    var t; ta.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { rows = parseMessage(ta.value); draw(); }, 200); });
    var ov = el('div', { class: 'qx-ov', id: 'qx-paste' });
    function close() { ov.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    add.addEventListener('click', function () {
      var list = rows.filter(function (r) { return r.productCode || r.spec; }).map(function (r) {
        return { productCode: r.productCode || '', spec: r.spec || r.productCode || '', moq: r.moq != null ? String(r.moq) : '', unitPrice: r.unitPrice != null ? String(r.unitPrice) : '',
                 discount: r.discount != null ? String(r.discount) : '0', delivery: r.delivery || '' };
      });
      setItems(list, replace.checked);
      close();
      toast(list.length + ' item' + (list.length === 1 ? '' : 's') + ' added from the message');
    });
    ov.appendChild(el('div', { class: 'qx-md', role: 'dialog', 'aria-label': 'Paste message' }, [
      el('div', { class: 'qx-hd' }, [el('h3', { text: '📋 Paste a price message → quotation items' }), el('button', { class: 'qx-b', type: 'button', text: '✕', 'aria-label': 'Close', onclick: close })]),
      el('div', { class: 'qx-bd' }, [
        el('div', { class: 'qx-hint', text: 'Copy the message (WhatsApp, e-mail, or rows from Excel) and paste it below. Each item on its own line: item code, description, qty (10 nos / qty 10), price (Rs 450 / ₹450 / 450/-), discount (10%) and delivery (2 weeks / ex-stock), in any order.' }),
        ta, info,
        el('div', { class: 'qx-scroll' }, [el('table', { class: 'qx-tbl' }, [el('thead', {}, [el('tr', {}, ['Item code', 'Description', 'Qty', 'Price ₹', 'Disc %', 'Delivery', ''].map(function (h) { return el('th', { text: h }); }))]), tbody])])
      ]),
      el('div', { class: 'qx-ft' }, [
        hasItems ? el('label', { class: 'qx-hint', style: 'display:flex;gap:6px;align-items:center;margin-right:auto' }, [replace, 'Replace the items already in the quotation']) : null,
        el('button', { class: 'qx-b', type: 'button', text: 'Cancel', onclick: close }), add])
    ]));
    document.body.appendChild(ov);
    ta.focus();
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (x) { if (x && x.trim() && !ta.value) { ta.value = x; rows = parseMessage(x); draw(); } }).catch(function () {});
    }
  }
  window.quotePasteMessage = pasteDialog;
  function addPasteButtons() {
    ['tms', 'apj'].forEach(function (co) {
      var root = document.getElementById('app-' + co); if (!root) return;
      var pr = root.querySelector('#pr-no'); if (!pr || root.querySelector('[data-qx-paste]')) return;
      var btn = pr.parentElement.querySelector('button');
      var b = el('button', { type: 'button', class: (btn ? btn.className : 'btn') + ' qx-paste-btn', 'data-qx-paste': co, title: 'Paste a WhatsApp / e-mail price message and turn it into items', text: '📋 Paste message',
        onclick: function () { pasteDialog(co); } });
      pr.parentElement.appendChild(b);
    });
  }

  function start() { css(); fillSign(); addPasteButtons(); decorateCards(); loadProfile(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  setTimeout(start, 800);
  var pend = false;
  new MutationObserver(function () {
    if (pend) return; pend = true;
    setTimeout(function () { pend = false; addPasteButtons(); decorateCards(); }, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
