/* ══════════════════════════════════════════════════════════════════════
   Sales report — by engineer. How many orders each engineer got and their
   value (from the Orders page), how much was made (delivered / billed), and
   manual entries for orders / billing that are not in the Orders page.
   Admins / managers see everyone; engineers see their own figures.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function api(method, path, body) {
    var opt = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(API + '/api' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed (' + r.status + ')');
        return j;
      });
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function money(v) { return v == null || v === '' ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  function num(v) { return Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function iso(d) { var x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }
  function toast(msg, kind) {
    document.querySelectorAll('.sr-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'sr-toast' + (kind === 'err' ? ' err' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }
  var DS = { PENDING: ['Pending', '#d97706'], DELIVERED: ['Delivered', '#16a34a'], PARTIALLY_DELIVERED: ['Part delivered', '#2563eb'], NOT_DELIVERED: ['Not delivered', '#dc2626'] };

  function css() {
    if (document.getElementById('sr-css')) return;
    var st = document.createElement('style'); st.id = 'sr-css';
    st.textContent = [
      '.sr-wrap{max-width:1400px;margin:0 auto}',
      '.sr-head{display:flex;flex-wrap:wrap;gap:.7rem;align-items:flex-end;justify-content:space-between;margin-bottom:1rem}.sr-head h1{font-size:1.35rem;font-weight:700;margin:0}.sr-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.sr-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .sr-card{background:#1e293b;border-color:#334155}',
      '.sr-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end}.sr-bar label{display:flex;flex-direction:column;font-size:.7rem;font-weight:600;color:#64748b;gap:.15rem}',
      '.sr-bar select,.sr-bar input,.sr-f input,.sr-f select,.sr-f textarea{border:1px solid #cbd5e1;border-radius:.5rem;padding:.42rem .6rem;font-size:.86rem;background:#fff;color:inherit;font-family:inherit}',
      '.dark .sr-bar select,.dark .sr-bar input,.dark .sr-f input,.dark .sr-f select,.dark .sr-f textarea{background:#0f172a;border-color:#334155}',
      '.sr-btn{display:inline-flex;align-items:center;gap:.3rem;border-radius:.55rem;padding:.45rem .9rem;font-size:.84rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.sr-btn.sm{padding:.2rem .55rem;font-size:.75rem}.sr-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.sr-btn.red{color:#b91c1c;border-color:#fecaca}.dark .sr-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .sr-btn.pri{background:#2563eb}',
      '.sr-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.7rem;margin-bottom:1rem}',
      '.sr-tile{background:#fff;border:1px solid #e2e8f0;border-top:3px solid var(--c);border-radius:.8rem;padding:.75rem .9rem}.dark .sr-tile{background:#1e293b;border-color:#334155;border-top-color:var(--c)}',
      '.sr-tile span{font-size:.74rem;color:#64748b;font-weight:600}.sr-tile b{display:block;font-size:1.35rem;margin-top:.1rem}.sr-tile small{font-size:.72rem;color:#64748b}',
      '.sr-table{width:100%;border-collapse:collapse;font-size:.84rem}.sr-table th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.5rem;border-bottom:1px solid #e2e8f0;white-space:nowrap;background:#f8fafc;position:sticky;top:0}',
      '.dark .sr-table th{background:#0f172a;border-color:#334155}.sr-table td{padding:.5rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.dark .sr-table td{border-color:#334155}',
      '.sr-table .n{text-align:right;white-space:nowrap}.sr-table tfoot td{font-weight:700;border-top:2px solid #e2e8f0;background:#f8fafc}.dark .sr-table tfoot td{background:#0f172a}',
      '.sr-table tbody tr.click{cursor:pointer}.sr-table tbody tr.click:hover{background:#f8fafc}.dark .sr-table tbody tr.click:hover{background:#0f172a}',
      '.sr-barc{height:.45rem;border-radius:999px;background:#e2e8f0;overflow:hidden;min-width:80px;margin-top:.25rem}.sr-barc i{display:block;height:100%;background:linear-gradient(90deg,#2563eb,#16a34a)}',
      '.sr-sub{font-size:.74rem;color:#64748b}.sr-badge{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.72rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent)}',
      '.sr-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;margin-bottom:.7rem}.dark .sr-tabs{border-color:#334155}',
      '.sr-tab{padding:.5rem .9rem;font-size:.88rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer}.sr-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .sr-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.sr-val{width:120px;text-align:right;border:1px solid #cbd5e1;border-radius:.4rem;padding:.25rem .4rem;font-size:.82rem;background:#fff;color:inherit}.dark .sr-val{background:#0f172a;border-color:#334155}.sr-val.saved{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}',
      '.sr-empty{padding:1.5rem;text-align:center;color:#64748b}.sr-scroll{overflow:auto;max-height:65vh}',
      '.sr-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:6vh 1rem;overflow:auto}',
      '.sr-dlg{background:#fff;border-radius:1rem;max-width:560px;width:100%;padding:1.2rem}.dark .sr-dlg{background:#1e293b}.sr-dlg h3{margin:0 0 .8rem}',
      '.sr-grid{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.sr-f{display:flex;flex-direction:column;gap:.2rem}.sr-f.w{grid-column:1/-1}.sr-f label{font-size:.73rem;font-weight:600;color:#475569}',
      '.sr-err{color:#b91c1c;font-size:.82rem;min-height:1rem;margin-top:.4rem}.sr-foot{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.6rem}',
      '.sr-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s}',
      '.sr-toast.in{opacity:1;transform:translate(-50%,0)}.sr-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function presetRange(p) {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth();
    if (p === 'month') return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    if (p === 'last') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (p === 'quarter') { var q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))]; }
    if (p === 'fy') { var fy = m >= 3 ? y : y - 1; return [iso(new Date(fy, 3, 1)), iso(new Date(fy + 1, 2, 31))]; }
    if (p === 'week') { var s = new Date(y, m, d.getDate() - ((d.getDay() + 6) % 7)); return [iso(s), iso(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6))]; }
    return null;
  }

  var S = { preset: 'month', from: '', to: '', eng: '', tab: 'orders', data: null };
  var tilesBox, sumBox, listBox, tabsBox, engSel, fromI, toI;

  function load() {
    clear(sumBox).appendChild(el('div', { class: 'sr-empty', text: 'Loading…' }));
    var qs = '?from=' + S.from + '&to=' + S.to + (S.eng ? '&engineerId=' + encodeURIComponent(S.eng) : '');
    return api('GET', '/sales-report' + qs).then(function (j) {
      S.data = j.data;
      if (S.data.seesAll && engSel.options.length <= 1) S.data.engineers.forEach(function (u) { engSel.appendChild(el('option', { value: u.id, text: u.name })); });
      engSel.parentNode.style.display = S.data.seesAll ? '' : 'none'; engSel.value = S.eng;
      draw();
    }).catch(function (e) { clear(sumBox).appendChild(el('div', { class: 'sr-empty', text: e.message })); });
  }

  function totals(rows) {
    var t = { orders: 0, orderValue: 0, qty: 0, suppliedQty: 0, delivered: 0, deliveredValue: 0, manualCount: 0, manualOrderValue: 0, manualBilled: 0, totalGot: 0, totalMade: 0, totalOrders: 0, unpricedOrders: 0 };
    rows.forEach(function (r) { Object.keys(t).forEach(function (k) { t[k] += +r[k] || 0; }); });
    return t;
  }

  function draw() {
    var d = S.data, rows = d.summary, t = totals(rows);
    clear(tilesBox);
    [['Orders got', String(t.totalOrders), t.manualCount ? t.orders + ' from Orders · ' + t.manualCount + ' invoices / manual' : 'from the Orders page', '#1e3a8a'],
     ['Order value got', money(t.totalGot), t.unpricedOrders ? t.unpricedOrders + ' order(s) without a value' : 'orders + manual', '#2563eb'],
     ['Made (delivered + invoiced)', money(t.totalMade), t.totalGot ? Math.round(t.totalMade / t.totalGot * 100) + '% of value got' : '', '#16a34a'],
     ['Quantity ordered / supplied', num(t.qty + 0) + ' / ' + num(t.suppliedQty), t.delivered + ' order(s) fully delivered', '#7c3aed']
    ].forEach(function (x) { tilesBox.appendChild(el('div', { class: 'sr-tile', style: '--c:' + x[3] }, [el('span', { text: x[0] }), el('b', { text: x[1] }), el('small', { text: x[2] })])); });

    clear(sumBox);
    sumBox.appendChild(el('h2', { style: 'font-size:1rem;font-weight:700;margin:0 0 .6rem', text: 'By engineer · ' + dmy(d.from) + ' – ' + dmy(d.to) }));
    if (!rows.length) { sumBox.appendChild(el('div', { class: 'sr-empty', text: 'No engineers.' })); }
    else {
      var max = Math.max.apply(null, rows.map(function (r) { return r.totalGot; }).concat([1]));
      var H = ['Engineer', 'Orders', 'Order value', 'Qty ordered', 'Delivered', 'Delivered value', 'Invoices (manual)', 'Manual order value', 'Invoiced sales', 'Total got', 'Total made', 'Made %'];
      sumBox.appendChild(el('div', { class: 'sr-scroll' }, [el('table', { class: 'sr-table', id: 'sr-summary' }, [
        el('thead', {}, [el('tr', {}, H.map(function (h, i) { return el('th', { class: i ? 'n' : '', text: h }); }))]),
        el('tbody', {}, rows.map(function (r) {
          var pct = r.totalGot ? Math.round(r.totalMade / r.totalGot * 100) : 0;
          return el('tr', { class: d.seesAll ? 'click' : '', 'data-eng': r.engineerId, title: d.seesAll ? 'Show only ' + r.name : null, onclick: d.seesAll ? function () { S.eng = S.eng === r.engineerId ? '' : r.engineerId; load(); } : null }, [
            el('td', {}, [el('b', { text: r.name }), el('div', { class: 'sr-barc' }, [el('i', { style: 'width:' + Math.round(r.totalGot / max * 100) + '%' })])]),
            el('td', { class: 'n', text: String(r.orders) }),
            el('td', { class: 'n' }, [money(r.orderValue), r.unpricedOrders ? el('div', { class: 'sr-sub', text: r.unpricedOrders + ' without value' }) : null]),
            el('td', { class: 'n', text: num(r.qty) }),
            el('td', { class: 'n', text: String(r.delivered) }),
            el('td', { class: 'n', text: money(r.deliveredValue) }),
            el('td', { class: 'n', text: String(r.manualCount) }),
            el('td', { class: 'n', text: money(r.manualOrderValue) }),
            el('td', { class: 'n', text: money(r.manualBilled) }),
            el('td', { class: 'n' }, [el('b', { text: money(r.totalGot) })]),
            el('td', { class: 'n' }, [el('b', { style: 'color:#15803d', text: money(r.totalMade) })]),
            el('td', { class: 'n', text: r.totalGot ? pct + '%' : '—' })
          ]);
        })),
        rows.length > 1 ? el('tfoot', {}, [el('tr', {}, [el('td', { text: 'Total' }), el('td', { class: 'n', text: String(t.orders) }), el('td', { class: 'n', text: money(t.orderValue) }), el('td', { class: 'n', text: num(t.qty) }),
          el('td', { class: 'n', text: String(t.delivered) }), el('td', { class: 'n', text: money(t.deliveredValue) }), el('td', { class: 'n', text: String(t.manualCount) }), el('td', { class: 'n', text: money(t.manualOrderValue) }),
          el('td', { class: 'n', text: money(t.manualBilled) }), el('td', { class: 'n', text: money(t.totalGot) }), el('td', { class: 'n', text: money(t.totalMade) }), el('td', { class: 'n', text: t.totalGot ? Math.round(t.totalMade / t.totalGot * 100) + '%' : '—' })])]) : null
      ])]));
    }
    drawList();
  }

  function drawTabs() {
    clear(tabsBox);
    [['orders', 'Orders (' + S.data.orders.length + ')'], ['entries', 'Tax invoices / manual entries (' + S.data.entries.length + ')']].forEach(function (x) {
      tabsBox.appendChild(el('button', { type: 'button', class: 'sr-tab' + (S.tab === x[0] ? ' on' : ''), 'data-tab': x[0], text: x[1], onclick: function () { S.tab = x[0]; drawList(); } }));
    });
  }

  function drawList() {
    drawTabs();
    clear(listBox);
    var d = S.data;
    if (S.tab === 'orders') {
      if (!d.orders.length) { listBox.appendChild(el('div', { class: 'sr-empty', text: 'No orders in this period.' })); return; }
      listBox.appendChild(el('p', { class: 'sr-sub', style: 'margin:0 0 .5rem', text: 'Type the order value (₹, before tax) for orders that do not have one — it saves when you leave the box.' }));
      listBox.appendChild(el('div', { class: 'sr-scroll' }, [el('table', { class: 'sr-table', id: 'sr-orders' }, [
        el('thead', {}, [el('tr', {}, ['Date', 'Customer', 'Engineer', 'Type', 'Items', 'Qty ordered', 'Qty supplied', 'Status', 'Order value'].map(function (h, i) { return el('th', { class: i >= 4 && i !== 7 ? 'n' : '', text: h }); }))]),
        el('tbody', {}, d.orders.map(function (o) {
          var st = DS[o.deliveryStatus] || [o.deliveryStatus, '#64748b'];
          var canSet = d.seesAll || o.engineerId === d.me;
          var val = canSet ? el('input', { class: 'sr-val', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', 'data-ov': o.id, value: o.orderValue == null ? '' : String(o.orderValue), placeholder: '₹ value' }) : null;
          if (val) val.addEventListener('change', function () {
            api('PATCH', '/sales-report/orders/' + encodeURIComponent(o.id), { orderValue: val.value }).then(function (j) {
              o.orderValue = j.data.orderValue; val.classList.add('saved'); setTimeout(function () { val.classList.remove('saved'); }, 1500);
              var keep = S.tab; load().then(function () { S.tab = keep; });
            }).catch(function (e) { toast(e.message, 'err'); });
          });
          return el('tr', {}, [el('td', { text: dmy(o.orderDate) }), el('td', {}, [el('b', { text: o.customerName || '—' })]), el('td', { text: o.engineerName || '—' }),
            el('td', { text: o.orderType === 'PO' ? 'PO' : 'Verbal' }), el('td', { class: 'n', text: String(o.itemCount) }), el('td', { class: 'n', text: num(o.qty) }), el('td', { class: 'n', text: num(o.suppliedQty) }),
            el('td', {}, [el('span', { class: 'sr-badge', style: '--c:' + st[1], text: st[0] })]),
            el('td', { class: 'n' }, [val || money(o.orderValue)])]);
        }))
      ])]));
    } else {
      if (!d.entries.length) { listBox.appendChild(el('div', { class: 'sr-empty', text: 'No tax invoices / entries in this period — press "+ Sales entry" or "Import invoices".' })); return; }
      listBox.appendChild(el('div', { class: 'sr-scroll' }, [el('table', { class: 'sr-table', id: 'sr-entries' }, [
        el('thead', {}, [el('tr', {}, ['Tax invoice date', 'Engineer', 'Customer', 'Tax invoice no.', 'Qty', 'Order value', 'Sales value', 'Note', ''].map(function (h, i) { return el('th', { class: i >= 4 && i <= 6 ? 'n' : '', text: h }); }))]),
        el('tbody', {}, d.entries.map(function (e) {
          return el('tr', { 'data-entry': e.id }, [el('td', { text: dmy(e.entryDate) }), el('td', { text: e.engineerName || '—' }), el('td', {}, [el('b', { text: e.customerName || '—' })]), el('td', { text: e.reference || '—' }),
            el('td', { class: 'n', text: e.quantity == null ? '—' : num(e.quantity) }), el('td', { class: 'n', text: money(e.orderValue) }), el('td', { class: 'n', text: money(e.billedValue) }),
            el('td', { class: 'sr-sub', style: 'max-width:240px;white-space:pre-wrap', text: (e.note || '') + (e.createdByName ? (e.note ? '\n' : '') + 'by ' + e.createdByName : '') }),
            el('td', { style: 'white-space:nowrap' }, [el('button', { type: 'button', class: 'sr-btn sm', text: '✎ Edit', 'data-edit-entry': e.id, onclick: function () { entryDialog(e); } }), ' ',
              el('button', { type: 'button', class: 'sr-btn sm red', text: '🗑', title: 'Delete', onclick: function () {
                if (!confirm('Delete this entry?')) return;
                api('DELETE', '/sales-report/entries/' + encodeURIComponent(e.id)).then(function (j) { toast(j.message); load(); }).catch(function (x) { toast(x.message, 'err'); });
              } })])]);
        }))
      ])]));
    }
  }

  function entryDialog(e) {
    document.querySelectorAll('.sr-modal').forEach(function (m) { m.remove(); });
    var dlg = el('div', { class: 'sr-dlg' }), m = el('div', { class: 'sr-modal' }, [dlg]);
    m.addEventListener('click', function (x) { if (x.target === m) m.remove(); });
    document.body.appendChild(m);
    var d = S.data;
    // engineer who made the sale (Admins pick anyone; engineers enter their own)
    var eng = el('select', { id: 'sr-e-eng', disabled: d.seesAll ? null : true }, (d.seesAll ? d.engineers : [{ id: d.me, name: (S.myName || 'Me') }]).map(function (u) { return el('option', { value: u.id, text: u.name + (u.role ? ' · ' + String(u.role).replace(/_/g, ' ').toLowerCase() : '') }); }));
    eng.value = e ? e.engineerId : (S.eng || d.me);
    if (!eng.value && eng.options.length) eng.selectedIndex = 0;
    var date = el('input', { id: 'sr-e-date', type: 'date', value: e ? String(e.entryDate).slice(0, 10) : iso(new Date()) });
    var cust = el('input', { id: 'sr-e-cust', value: e ? e.customerName || '' : '', placeholder: 'Customer name' });
    var ref = el('input', { id: 'sr-e-ref', value: e ? e.reference || '' : '', placeholder: 'e.g. APJ/26-27/0142' });
    var ov = el('input', { id: 'sr-e-ov', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: e && e.orderValue != null ? String(e.orderValue) : '', placeholder: 'Order got (₹)' });
    var bv = el('input', { id: 'sr-e-bv', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: e && e.billedValue != null ? String(e.billedValue) : '', placeholder: 'Invoice value before tax (₹)' });
    var qty = el('input', { id: 'sr-e-qty', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: e && e.quantity != null ? String(e.quantity) : '', placeholder: 'Nos (optional)' });
    var note = el('textarea', { id: 'sr-e-note', rows: 2, placeholder: 'Optional' }); note.value = e ? e.note || '' : '';
    var err = el('div', { class: 'sr-err' });
    function f(l, i, w) { return el('div', { class: 'sr-f' + (w ? ' w' : '') }, [el('label', { text: l }), i]); }
    dlg.appendChild(el('h3', { text: e ? 'Edit sales entry' : 'Sales entry (tax invoice)' }));
    dlg.appendChild(el('div', { class: 'sr-grid' }, [f('Engineer who made the sale', eng, true), f('Tax invoice date', date), f('Tax invoice no.', ref), f('Customer', cust, true),
      f('Sales value (₹, before tax)', bv), f('Order value got (₹, optional)', ov), f('Quantity (optional)', qty), f('Note', note, true)]));
    dlg.appendChild(err);
    var save = el('button', { type: 'button', class: 'sr-btn pri', id: 'sr-e-save', text: e ? 'Save' : 'Add entry' });
    save.onclick = function () {
      save.disabled = true; err.textContent = '';
      var body = { engineerId: eng.value, entryDate: date.value, customerName: cust.value, reference: ref.value, orderValue: ov.value, billedValue: bv.value, quantity: qty.value, note: note.value };
      (e ? api('PUT', '/sales-report/entries/' + encodeURIComponent(e.id), body) : api('POST', '/sales-report/entries', body)).then(function (j) {
        toast(j.message); m.remove(); S.tab = 'entries'; load();
      }).catch(function (x) { err.textContent = x.message; save.disabled = false; });
    };
    dlg.appendChild(el('div', { class: 'sr-foot' }, [el('button', { type: 'button', class: 'sr-btn', text: 'Cancel', onclick: function () { m.remove(); } }), save]));
  }

  function csv() {
    var d = S.data; if (!d) return;
    function q(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [['Sales report by engineer', d.from + ' to ' + d.to].map(q).join(','), '',
      ['Engineer', 'Orders', 'Order value', 'Qty ordered', 'Qty supplied', 'Delivered orders', 'Delivered value', 'Invoices (manual)', 'Manual order value', 'Invoiced sales', 'Total got', 'Total made'].join(',')];
    d.summary.forEach(function (r) { lines.push([r.name, r.orders, r.orderValue, r.qty, r.suppliedQty, r.delivered, r.deliveredValue, r.manualCount, r.manualOrderValue, r.manualBilled, r.totalGot, r.totalMade].map(q).join(',')); });
    lines.push('', 'Orders', ['Date', 'Customer', 'Engineer', 'Type', 'Items', 'Qty ordered', 'Qty supplied', 'Status', 'Order value'].join(','));
    d.orders.forEach(function (o) { lines.push([o.orderDate, o.customerName, o.engineerName, o.orderType, o.itemCount, o.qty, o.suppliedQty, (DS[o.deliveryStatus] || [o.deliveryStatus])[0], o.orderValue].map(q).join(',')); });
    lines.push('', 'Tax invoices / manual entries', ['Tax invoice date', 'Engineer', 'Customer', 'Tax invoice no', 'Qty', 'Order value', 'Sales value', 'Note'].join(','));
    d.entries.forEach(function (e) { lines.push([e.entryDate, e.engineerName, e.customerName, e.reference, e.quantity, e.orderValue, e.billedValue, e.note].map(q).join(',')); });
    var b = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), u = URL.createObjectURL(b);
    var a = el('a', { href: u, download: 'Sales-report_' + d.from + '_' + d.to + '.csv' }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
  }

  /** Template for importing tax invoices: one row per invoice. */
  function template() {
    var d = S.data, names = d && d.seesAll ? d.engineers.map(function (u) { return u.name; }) : [S.myName || 'Your name'];
    var rows = [['Engineer', 'Tax invoice date', 'Tax invoice no', 'Customer', 'Sales value', 'Order value', 'Qty', 'Note'],
      [names[0] || 'Engineer name', iso(new Date()).split('-').reverse().join('-'), 'APJ/26-27/0001', 'Customer name', '125000', '', '10', '']];
    var b = new Blob(['\ufeff' + rows.map(function (r) { return r.map(function (v) { return /[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n') +
      '\r\n\r\n# Engineer names: ' + names.join(' / ')], { type: 'text/csv' });
    var u = URL.createObjectURL(b), a = el('a', { href: u, download: 'Sales-invoices-template.csv' }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
  }
  var impFile;
  function importFile(f) {
    var fd = new FormData(); fd.append('file', f);
    fetch(API + '/api/sales-report/import', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') }, body: fd }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) throw new Error(j.message || 'Import failed'); return j; });
    }).then(function (j) {
      toast(j.message + (j.data.errors.length ? ' — ' + j.data.errors.slice(0, 3).join('; ') : ''), j.data.saved ? '' : 'err');
      S.tab = 'entries'; load();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function mountPage(content) {
    css();
    try { S.myName = (JSON.parse(localStorage.getItem('crm_user') || '{}') || {}).name; } catch (e) {}
    impFile = el('input', { type: 'file', id: 'sr-import-file', accept: '.xlsx,.csv', style: 'display:none' });
    impFile.onchange = function () { if (impFile.files[0]) importFile(impFile.files[0]); impFile.value = ''; };
    document.body.appendChild(impFile);
    var r = presetRange(S.preset); S.from = r[0]; S.to = r[1];
    var wrap = el('div', { class: 'sr-wrap' });
    wrap.appendChild(el('div', { class: 'sr-head' }, [el('div', {}, [el('h1', { text: 'Sales report' }),
      el('p', { text: 'Orders got and sales made by each engineer — from the Orders page plus tax invoices (typed in or imported from Excel).' })]),
      el('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap' }, [
        el('button', { type: 'button', class: 'sr-btn', id: 'sr-csv', text: '⬇ Excel (CSV)', onclick: csv }),
        el('button', { type: 'button', class: 'sr-btn', id: 'sr-tpl', text: '⬇ Invoice template', onclick: template }),
        el('button', { type: 'button', class: 'sr-btn', id: 'sr-import', text: '⤒ Import invoices', onclick: function () { impFile.click(); } }),
        el('button', { type: 'button', class: 'sr-btn pri', id: 'sr-add', text: '+ Sales entry', onclick: function () { entryDialog(null); } })])]));
    var preset = el('select', { id: 'sr-preset' }, [['week', 'This week'], ['month', 'This month'], ['last', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['custom', 'Custom dates']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    preset.value = S.preset;
    fromI = el('input', { type: 'date', id: 'sr-from', value: S.from }); toI = el('input', { type: 'date', id: 'sr-to', value: S.to });
    preset.onchange = function () { S.preset = preset.value; var x = presetRange(S.preset); if (x) { S.from = fromI.value = x[0]; S.to = toI.value = x[1]; load(); } };
    function dates() { if (fromI.value && toI.value) { S.from = fromI.value; S.to = toI.value; preset.value = S.preset = 'custom'; load(); } }
    fromI.onchange = dates; toI.onchange = dates;
    engSel = el('select', { id: 'sr-eng' }, [el('option', { value: '', text: 'All engineers' })]);
    engSel.onchange = function () { S.eng = engSel.value; load(); };
    wrap.appendChild(el('div', { class: 'sr-card' }, [el('div', { class: 'sr-bar' }, [el('label', {}, ['Period', preset]), el('label', {}, ['From', fromI]), el('label', {}, ['To', toI]), el('label', {}, ['Engineer', engSel])])]));
    tilesBox = el('div', { class: 'sr-tiles', id: 'sr-tiles' });
    sumBox = el('div', { class: 'sr-card', id: 'sr-sum' });
    tabsBox = el('div', { class: 'sr-tabs' });
    listBox = el('div', { id: 'sr-list' });
    wrap.appendChild(tilesBox); wrap.appendChild(sumBox); wrap.appendChild(el('div', { class: 'sr-card' }, [tabsBox, listBox]));
    content.appendChild(wrap);
    load();
  }
  window.SalesReportPage = { mountPage: mountPage };
})();
