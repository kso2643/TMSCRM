/* ══════════════════════════════════════════════════════════════════════
   Get the price from suppliers — one panel used on the Price requests page and the CEO Desk.

   1. Ask suppliers
      - "Same suppliers for all items": pick one or more suppliers → one message each, with all items.
      - "Suppliers item by item": e.g. the drills to the Zecha dealer, the end mills to another brand's
        dealer; several suppliers can be picked for one item to compare. One message per supplier with
        only that supplier's items (tool-wise), each with its own editable text and note.
   2. Supplier prices, grouped by item: type each supplier's price / discount / lead time; the best
      net price is marked; the Super Admin / Admin presses "Choose" on the supplier to buy from
      (the others are told, and it shows here for everyone).
   API: /api/price-requests/batch/:bid/supplier, /api/price-requests/supplier/:qid(/choose) (SupplierQuoteController).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  function api(method, path, body) {
    var h = { Authorization: 'Bearer ' + (token() || '') };
    if (body) h['Content-Type'] = 'application/json';
    return fetch(API + '/api' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed'); return j; });
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k === 'value') n.value = v; else if (k === 'checked') n.checked = !!v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function money(v) { return v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function num(v) { v = String(v == null ? '' : v).replace(/[,₹%\s]/g, ''); return v === '' || isNaN(v) ? null : Number(v); }
  function when(s) { if (!s) return ''; var d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? s : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function itemLabel(it) { return (it.itemCode ? it.itemCode + ' — ' : '') + (it.productName || '') + (it.brand ? ' (' + it.brand + ')' : ''); }
  function toast(msg, bad) {
    var t = document.getElementById('sp-toast');
    if (!t) { t = el('div', { id: 'sp-toast' }); document.body.appendChild(t); }
    t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.opacity = '1';
    clearTimeout(t._t); t._t = setTimeout(function () { t.style.opacity = '0'; }, 3500);
  }

  function css() {
    if (document.getElementById('sp-css')) return;
    var st = document.createElement('style'); st.id = 'sp-css';
    st.textContent = [
      '.sp{display:grid;gap:.9rem;font-size:.86rem}',
      '.sp h4{margin:0;font-size:.95rem;font-weight:700}',
      '.sp-meta{font-size:.75rem;color:#64748b}',
      '.sp-in{border:1px solid #cbd5e1;border-radius:.5rem;padding:.4rem .55rem;font:inherit;font-size:.85rem;background:#fff;color:#0f172a;min-width:0}',
      '.dark .sp-in{background:#0f172a;border-color:#334155;color:#f1f5f9}',
      'textarea.sp-in{width:100%;resize:vertical}',
      '.sp-btn{display:inline-flex;align-items:center;gap:.3rem;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:.5rem;padding:.38rem .7rem;font-size:.8rem;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}',
      '.sp-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.sp-btn.grn{background:#0f766e;border-color:#0f766e;color:#fff}.sp-btn.red{color:#b91c1c}',
      '.sp-btn[disabled]{opacity:.5;cursor:default}.dark .sp-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}',
      '.sp-box{border:1px solid #e2e8f0;border-radius:.7rem;padding:.75rem;background:#fff}.dark .sp-box{background:#0f172a;border-color:#334155}',
      '.sp-mode{display:flex;gap:.4rem;flex-wrap:wrap}.sp-mode label{display:flex;gap:.35rem;align-items:center;border:1px solid #cbd5e1;border-radius:9999px;padding:.3rem .75rem;cursor:pointer}',
      '.sp-mode label.on{border-color:#1e3a8a;background:#eef2ff;color:#1e3a8a;font-weight:600}.dark .sp-mode label.on{background:#1e293b;color:#c7d2fe}',
      '.sp-pick{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}',
      '.sp-chip{display:inline-flex;gap:.25rem;align-items:center;background:#eef2ff;color:#1e3a8a;border-radius:9999px;padding:.15rem .55rem;font-size:.78rem;font-weight:600}',
      '.sp-chip button{border:0;background:none;color:inherit;cursor:pointer;padding:0 .1rem;font-size:.9rem}',
      '.sp-tbl{width:100%;border-collapse:collapse}.sp-tbl th{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left;padding:.4rem .45rem;border-bottom:1px solid #e2e8f0}',
      '.sp-tbl td{padding:.4rem .45rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.sp-tbl tr.sp-item td{background:#f8fafc;font-weight:600;border-top:1px solid #e2e8f0}',
      '.dark .sp-tbl tr.sp-item td{background:#1e293b}.sp-tbl tr.sp-chosen td{background:#ecfdf5}.dark .sp-tbl tr.sp-chosen td{background:#064e3b55}',
      '.sp-scroll{overflow-x:auto}.sp-r{text-align:right}',
      '.sp-badge{display:inline-block;border-radius:9999px;padding:.08rem .5rem;font-size:.7rem;font-weight:700;color:var(--c);background:color-mix(in srgb,var(--c) 14%,#fff)}',
      '.sp-msgs{display:grid;gap:.6rem}@media(min-width:1100px){.sp-msgs{grid-template-columns:1fr 1fr}}',
      '.sp-best{color:#15803d;font-weight:700}',
      '#sp-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483600;background:#0f172a;color:#fff;padding:.6rem 1rem;border-radius:.6rem;font:500 .85rem system-ui,sans-serif;transition:opacity .3s;opacity:0;pointer-events:none}',
      '#sp-toast.bad{background:#7f1d1d}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /** A small "pick suppliers" control: a list + "Other…" name, shown as removable chips. */
  function picker(vendors, chosen, onChange, label) {
    var box = el('div', { class: 'sp-pick', 'data-sp-picker': '1' });
    var sel = el('select', { class: 'sp-in', 'aria-label': label || 'Add supplier', 'data-sp-add': '1' });
    function opts() {
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '', text: chosen.length ? '+ Add another supplier…' : 'Choose supplier…' }));
      vendors.forEach(function (v) { if (!chosen.some(function (c) { return c.vendorId === v.id; })) sel.appendChild(el('option', { value: v.id, text: v.name + (v.brands ? ' · ' + v.brands : '') })); });
      sel.appendChild(el('option', { value: '__other', text: 'Other (type the name)…' }));
    }
    var other = el('input', { class: 'sp-in', placeholder: 'Supplier name, then Enter', style: 'display:none;width:12rem', 'data-sp-other': '1' });
    function draw() {
      Array.prototype.slice.call(box.querySelectorAll('.sp-chip')).forEach(function (c) { c.remove(); });
      chosen.forEach(function (c, i) {
        box.insertBefore(el('span', { class: 'sp-chip', 'data-sp-chip': c.vendorName }, [c.vendorName,
          el('button', { type: 'button', 'aria-label': 'Remove ' + c.vendorName, text: '×', onclick: function () { chosen.splice(i, 1); draw(); onChange(); } })]), sel);
      });
      opts();
    }
    sel.addEventListener('change', function () {
      if (sel.value === '__other') { other.style.display = ''; other.focus(); return; }
      var v = vendors.filter(function (x) { return x.id === sel.value; })[0];
      if (v) { chosen.push({ vendorId: v.id, vendorName: v.name }); draw(); onChange(); }
    });
    function addOther() {
      var n = other.value.trim(); if (!n) return;
      if (!chosen.some(function (c) { return c.vendorName.toLowerCase() === n.toLowerCase(); })) chosen.push({ vendorId: null, vendorName: n });
      other.value = ''; other.style.display = 'none'; draw(); onChange();
    }
    other.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addOther(); } });
    other.addEventListener('blur', addOther);
    box.appendChild(sel); box.appendChild(other);
    draw();
    return box;
  }

  /** One supplier's ready message: editable text + note, Copy / WhatsApp / E-mail send exactly that. */
  function messageCard(r, requestNo) {
    var ta = el('textarea', { class: 'sp-in', rows: 9, 'data-sp-msg': r.vendor.name, 'aria-label': 'Message to ' + r.vendor.name }, [r.message]);
    var note = el('textarea', { class: 'sp-in', rows: 2, 'data-sp-note': r.vendor.name, placeholder: 'Note for ' + r.vendor.name + ' (optional) — e.g. urgent, need test certificate…' });
    var phone = String(r.vendor.phone || '').replace(/\D/g, ''); if (phone.length === 10) phone = '91' + phone;
    function text() {
      var t = ta.value.replace(/\s+$/, ''), n = note.value.trim();
      if (!n) return t;
      var m = /\n\s*Thank you\.?\s*$/i.exec(t);
      return m ? t.slice(0, m.index) + '\n\nNote: ' + n + t.slice(m.index) : t + '\n\nNote: ' + n;
    }
    var wa = el('a', { class: 'sp-btn grn', target: '_blank', rel: 'noopener', 'data-sp-wa': r.vendor.name, text: 'WhatsApp' + (phone ? '' : ' (choose contact)') });
    var mail = el('a', { class: 'sp-btn', 'data-sp-mail': r.vendor.name, text: '✉ E-mail' });
    function links() {
      var t = text();
      wa.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(t);
      mail.href = 'mailto:' + (r.vendor.email || '') + '?subject=' + encodeURIComponent('Price request' + (requestNo ? ' ' + requestNo : '') + (r.customer ? ' — ' + r.customer : '')) + '&body=' + encodeURIComponent(t);
    }
    ta.addEventListener('input', links); note.addEventListener('input', links); links();
    return el('div', { class: 'sp-box', 'data-sp-card': r.vendor.name }, [
      el('div', { style: 'display:flex;justify-content:space-between;gap:.5rem;align-items:baseline;margin-bottom:.35rem' }, [
        el('h4', { text: '✉ ' + r.vendor.name }), el('span', { class: 'sp-meta', text: r.count + ' item' + (r.count === 1 ? '' : 's') + ' · you can edit the text' })]),
      ta, el('div', { class: 'sp-meta', style: 'margin:.35rem 0 .2rem', text: 'Note' }), note,
      el('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.45rem' }, [
        el('button', { class: 'sp-btn', type: 'button', 'data-sp-copy': r.vendor.name, text: '⧉ Copy', onclick: function () { var t = text(); try { navigator.clipboard.writeText(t); } catch (e) { ta.select(); document.execCommand('copy'); } toast('Message for ' + r.vendor.name + ' copied'); } }),
        wa, mail])
    ]);
  }

  /**
   * render(host, batchId, opts) — opts: { requestNo, onQuotes(quotes, items), extraActions(q) → node, onChange() }
   * Returns { reload }.
   */
  function render(host, bid, opts) {
    css(); opts = opts || {};
    var role = me().role, canDecide = role === 'SUPER_ADMIN' || role === 'ADMIN';
    var d = null, mode = 'whole', whole = [], perItem = {}, picked = {};
    host.innerHTML = '';
    var root = el('div', { class: 'sp', 'data-sp': bid });
    host.appendChild(root);
    root.appendChild(el('p', { class: 'sp-meta', text: 'Loading…' }));
    function load() {
      return api('GET', '/price-requests/batch/' + encodeURIComponent(bid) + '/supplier').then(function (j) { d = j.data; draw(); })
        .catch(function (e) { root.innerHTML = ''; root.appendChild(el('p', { class: 'sp-meta', style: 'color:#b91c1c', text: e.message })); });
    }
    function draw() {
      root.innerHTML = '';
      d.items.forEach(function (it) { if (!(it.id in picked)) picked[it.id] = true; if (!perItem[it.id]) perItem[it.id] = []; });
      var requestNo = opts.requestNo || (d.items[0] && d.items[0].requestNo) || '';
      // ── 1. ask suppliers
      var ask = el('div', { class: 'sp-box', 'data-sp-ask': '1' });
      ask.appendChild(el('h4', { text: 'Ask suppliers for prices' }));
      var modes = el('div', { class: 'sp-mode', style: 'margin:.5rem 0' });
      [['whole', 'Same supplier(s) for all items'], ['item', 'Choose supplier item by item (different brands / tools)']].forEach(function (m) {
        var r = el('input', { type: 'radio', name: 'sp-mode-' + bid, value: m[0], checked: mode === m[0], 'data-sp-mode': m[0] });
        r.addEventListener('change', function () { mode = m[0]; draw(); });
        modes.appendChild(el('label', { class: mode === m[0] ? 'on' : '' }, [r, m[1]]));
      });
      ask.appendChild(modes);
      var body = el('div', {});
      if (mode === 'whole') {
        body.appendChild(el('div', { class: 'sp-meta', style: 'margin-bottom:.25rem', text: 'Suppliers — each gets one message with the ticked items' }));
        body.appendChild(picker(d.vendors, whole, function () {}, 'Supplier for all items'));
        body.appendChild(el('div', { style: 'display:flex;flex-wrap:wrap;gap:.3rem .9rem;margin-top:.5rem' }, d.items.map(function (it) {
          var cb = el('input', { type: 'checkbox', checked: picked[it.id], 'data-sp-item': it.id });
          cb.addEventListener('change', function () { picked[it.id] = cb.checked; });
          return el('label', { style: 'display:flex;gap:.3rem;align-items:center' }, [cb, (it.itemCode || it.productName) + (it.quantity != null ? ' × ' + Number(it.quantity) : '')]);
        })));
      } else {
        body.appendChild(el('div', { class: 'sp-meta', style: 'margin-bottom:.25rem', text: 'Pick the supplier(s) for each item — you can pick more than one to compare. Each supplier gets one message with only its items.' }));
        var tb = el('tbody');
        d.items.forEach(function (it) {
          tb.appendChild(el('tr', { 'data-sp-row': it.id }, [
            el('td', {}, [el('b', { text: it.itemCode || it.productName }), el('div', { class: 'sp-meta', text: (it.itemCode ? it.productName + ' · ' : '') + (it.brand || '') + (it.quantity != null ? ' · Qty ' + Number(it.quantity) : '') })]),
            el('td', { style: 'min-width:16rem' }, [picker(d.vendors, perItem[it.id], function () {}, 'Supplier for ' + (it.itemCode || it.productName))])
          ]));
        });
        body.appendChild(el('div', { class: 'sp-scroll' }, [el('table', { class: 'sp-tbl' }, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Item' }), el('th', { text: 'Supplier(s)' })])]), tb])]));
      }
      ask.appendChild(body);
      var msgs = el('div', { class: 'sp-msgs', style: 'margin-top:.6rem', 'data-sp-msgs': '1' });
      var go = el('button', { class: 'sp-btn pri', type: 'button', 'data-sp-go': '1', style: 'margin-top:.6rem', text: 'Create supplier requests' });
      go.addEventListener('click', function () {
        // supplier → items
        var groups = {};
        function add(v, itemId) { var k = (v.vendorId || '') + '|' + v.vendorName.toLowerCase(); (groups[k] = groups[k] || { v: v, ids: [] }).ids.push(itemId); }
        if (mode === 'whole') {
          var ids = d.items.filter(function (it) { return picked[it.id]; }).map(function (it) { return it.id; });
          if (!whole.length) { toast('Choose at least one supplier.', true); return; }
          if (!ids.length) { toast('Tick the items to ask about.', true); return; }
          whole.forEach(function (v) { ids.forEach(function (i) { add(v, i); }); });
        } else {
          d.items.forEach(function (it) { perItem[it.id].forEach(function (v) { add(v, it.id); }); });
          if (!Object.keys(groups).length) { toast('Pick a supplier for at least one item.', true); return; }
        }
        go.disabled = true; msgs.innerHTML = '';
        var list = Object.keys(groups).map(function (k) { return groups[k]; });
        (function next(i) {
          if (i >= list.length) { go.disabled = false; toast(list.length + ' supplier request' + (list.length === 1 ? '' : 's') + ' ready — send each message'); return; }
          var g = list[i];
          api('POST', '/price-requests/batch/' + encodeURIComponent(bid) + '/supplier', g.v.vendorId ? { vendorId: g.v.vendorId, itemIds: g.ids } : { vendorName: g.v.vendorName, itemIds: g.ids })
            .then(function (j) {
              d.quotes = j.data.quotes; drawQuotes();
              msgs.appendChild(messageCard({ vendor: j.data.vendor, message: j.data.message, customer: j.data.customer, count: g.ids.length }, requestNo));
            }).catch(function (e) { toast(g.v.vendorName + ': ' + e.message, true); })
            .then(function () { next(i + 1); });
        })(0);
      });
      ask.appendChild(go); ask.appendChild(msgs);
      root.appendChild(ask);
      // vendor price lists
      var hits = d.items.filter(function (it) { return d.priceList[String(it.itemCode || '').toUpperCase()]; });
      if (hits.length) root.appendChild(el('div', { class: 'sp-box' }, [el('h4', { text: 'On vendor price lists' })].concat(hits.map(function (it) {
        return el('div', { class: 'sp-meta', style: 'margin-top:.25rem' }, [el('b', { text: it.itemCode + ': ' }), d.priceList[String(it.itemCode).toUpperCase()].slice(0, 4).map(function (p) {
          return p.vendorName + ' ' + money(p.netPrice != null ? p.netPrice : p.price) + (p.leadTime ? ' (' + p.leadTime + ')' : '') + (p.stockQty != null ? ' · stock ' + Number(p.stockQty) : '');
        }).join(' · ')]);
      }))));
      // ── 2. prices, grouped by item
      qBox = el('div', { class: 'sp-box', 'data-sp-quotes': '1' });
      root.appendChild(qBox);
      drawQuotes();
    }
    var qBox = null;
    function drawQuotes() {
      if (!qBox) return;
      qBox.innerHTML = '';
      qBox.appendChild(el('h4', { text: 'Supplier prices — ' + (canDecide ? 'press “Choose” on the supplier to buy from' : 'the supplier chosen to buy from is marked ✔') }));
      if (opts.onQuotes) try { opts.onQuotes(d.quotes, d.items); } catch (e) {}
      if (!d.quotes.length) { qBox.appendChild(el('p', { class: 'sp-meta', style: 'margin-top:.4rem', text: 'No supplier asked yet.' })); return; }
      var tb = el('tbody');
      d.items.forEach(function (it) {
        var qs = d.quotes.filter(function (q) { return q.requestId === it.id; });
        if (!qs.length) return;
        var best = null; qs.forEach(function (q) { if (q.netPrice != null && (best == null || q.netPrice < best)) best = q.netPrice; });
        var chosen = qs.filter(function (q) { return q.chosen; })[0];
        tb.appendChild(el('tr', { class: 'sp-item', 'data-sp-qitem': it.id }, [el('td', { colspan: '9' }, [
          itemLabel(it) + (it.quantity != null ? ' · Qty ' + Number(it.quantity) : ''),
          chosen ? el('span', { class: 'sp-badge', style: '--c:#15803d;margin-left:.5rem', text: '✔ Buy from ' + chosen.vendorName + (chosen.chosenByName ? ' — chosen by ' + chosen.chosenByName : '') }) : el('span', { class: 'sp-meta', style: 'margin-left:.5rem;font-weight:400', text: qs.length + ' supplier' + (qs.length === 1 ? '' : 's') + ' asked' })
        ])]));
        qs.forEach(function (q) {
          var pr = el('input', { class: 'sp-in', type: 'number', step: 'any', min: '0', placeholder: 'Price ₹', value: q.price != null ? q.price : '', style: 'width:7rem', 'data-q-price': q.id });
          var di = el('input', { class: 'sp-in', type: 'number', step: 'any', min: '0', max: '100', placeholder: 'Disc %', value: q.discount != null ? q.discount : '', style: 'width:5rem' });
          var lt = el('input', { class: 'sp-in', placeholder: 'Lead time', value: q.leadTime || '', style: 'width:6.5rem' });
          var no = el('input', { class: 'sp-in', placeholder: 'Note', value: q.note || '', style: 'width:9rem' });
          var net = el('span', { class: q.netPrice != null && q.netPrice === best && qs.length > 1 ? 'sp-best' : '', text: q.netPrice != null ? money(q.netPrice) + (q.netPrice === best && qs.length > 1 ? ' ★' : '') : '—' });
          function calc() { var p = num(pr.value), x = num(di.value) || 0; net.textContent = p != null ? money(Math.round(p * (100 - x)) / 100) : '—'; }
          pr.addEventListener('input', calc); di.addEventListener('input', calc);
          var st = q.status === 'RECEIVED' ? ['Received', '#16a34a'] : q.status === 'NO_QUOTE' ? ['No quote', '#64748b'] : ['Asked', '#d97706'];
          var decide = canDecide ? el('button', { class: 'sp-btn ' + (q.chosen ? 'grn' : ''), type: 'button', 'data-q-choose': q.id, title: q.chosen ? 'Clear the choice' : 'Buy this item from ' + q.vendorName, text: q.chosen ? '✔ Chosen' : 'Choose',
            onclick: function () {
              var body = { chosen: !q.chosen };
              if (!q.chosen) { var n = prompt('Buy ' + (it.itemCode || it.productName) + ' from ' + q.vendorName + '?\nNote for the admins (optional):', ''); if (n === null) return; body.note = n; }
              api('PATCH', '/price-requests/supplier/' + encodeURIComponent(q.id) + '/choose', body)
                .then(function (j) { toast(j.message); d.quotes = j.data.quotes; drawQuotes(); if (opts.onChange) opts.onChange(); }).catch(function (e) { toast(e.message, true); });
            } }) : (q.chosen ? el('span', { class: 'sp-badge', style: '--c:#15803d', text: '✔ Chosen' }) : null);
          tb.appendChild(el('tr', { class: q.chosen ? 'sp-chosen' : '', 'data-quote': q.id }, [
            el('td', { style: 'min-width:10rem' }, [el('b', { text: q.vendorName }), el('div', { class: 'sp-meta', text: 'asked ' + when(q.askedAt) + (q.chosen && q.chosenNote ? ' · “' + q.chosenNote + '”' : '') })]),
            el('td', {}, [el('span', { class: 'sp-badge', style: '--c:' + st[1], text: st[0] })]),
            el('td', {}, [pr]), el('td', {}, [di]), el('td', { class: 'sp-r', style: 'white-space:nowrap' }, [net]), el('td', {}, [lt]), el('td', {}, [no]),
            el('td', { style: 'white-space:nowrap' }, [
              el('button', { class: 'sp-btn grn', type: 'button', 'data-q-save': q.id, text: 'Save', onclick: function () {
                api('PUT', '/price-requests/supplier/' + encodeURIComponent(q.id), { price: pr.value, discount: di.value, leadTime: lt.value, note: no.value })
                  .then(function (j) { toast(j.message); d.quotes = j.data.quotes; drawQuotes(); }).catch(function (e) { toast(e.message, true); });
              } }), ' ',
              el('button', { class: 'sp-btn', type: 'button', title: 'Supplier did not quote', text: '✕ No quote', onclick: function () {
                api('PUT', '/price-requests/supplier/' + encodeURIComponent(q.id), { status: 'NO_QUOTE', note: no.value }).then(function (j) { d.quotes = j.data.quotes; drawQuotes(); }).catch(function (e) { toast(e.message, true); });
              } }), ' ',
              opts.extraActions ? opts.extraActions(q) : null, ' ',
              el('button', { class: 'sp-btn red', type: 'button', title: 'Remove', text: '🗑', onclick: function () {
                if (!confirm('Remove ' + q.vendorName + ' for this item?')) return;
                api('DELETE', '/price-requests/supplier/' + encodeURIComponent(q.id)).then(function (j) { d.quotes = j.data.quotes; drawQuotes(); }).catch(function (e) { toast(e.message, true); });
              } })
            ]),
            el('td', {}, [decide])
          ]));
        });
      });
      qBox.appendChild(el('div', { class: 'sp-scroll', style: 'margin-top:.5rem' }, [el('table', { class: 'sp-tbl' }, [
        el('thead', {}, [el('tr', {}, ['Supplier', 'Status', 'Price', 'Disc %', 'Net', 'Lead time', 'Note', '', 'Buy from'].map(function (h, i) { return el('th', { class: i === 4 ? 'sp-r' : null, text: h }); }))]), tb])]));
    }
    load();
    return { reload: load };
  }

  window.SupplierPanel = { render: render };
})();
