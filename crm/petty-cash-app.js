/* ══════════════════════════════════════════════════════════════════════
   Petty cash — a tab on the Fuel expense page.

   Cash received (from the bank / MD) and cash spent (what for, paid to,
   category, bill no.) with bill photos / PDFs, and the opening, received,
   spent and closing balance for the period. Only people given access on the
   Users page → Page access → "Petty cash" see the tab (Super Admin, Admin and
   Accounts by default); "view only" hides the add / edit / delete buttons.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function api(method, path, body, isForm) {
    var opt = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body && isForm) opt.body = body;
    else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(API + '/api' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
        if (!r.ok || j.success === false) { var e = new Error((j && j.message) || 'Request failed (' + r.status + ')'); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function blob(path) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Download failed'); });
      return r.blob();
    });
  }
  function save(b, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
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
  function money(v) { return v == null || v === '' ? '' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function iso(d) { var x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }
  function toast(msg, kind) {
    document.querySelectorAll('.pc-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'pc-toast' + (kind === 'err' ? ' err' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }
  var MODES = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK: 'Bank' };

  function css() {
    if (document.getElementById('pc-css')) return;
    var st = document.createElement('style'); st.id = 'pc-css';
    st.textContent = [
      '.pc-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;margin:0 auto 1rem;max-width:1400px}.dark .pc-tabs{border-color:#334155}',
      '.pc-tab{padding:.55rem 1rem;font-size:.9rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer}.pc-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .pc-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.pc-wrap{max-width:1400px;margin:0 auto}',
      '.pc-head{display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-end;justify-content:space-between;margin-bottom:.9rem}.pc-head h1{font-size:1.3rem;font-weight:700;margin:0}.pc-head p{margin:.15rem 0 0;color:#64748b;font-size:.84rem}',
      '.pc-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.8rem}',
      '.pc-in{border:1px solid #cbd5e1;border-radius:.5rem;padding:.42rem .6rem;font-size:.86rem;background:#fff;color:inherit;font-family:inherit;min-width:0;box-sizing:border-box}.dark .pc-in{background:#0f172a;border-color:#334155}',
      '.pc-btn{display:inline-flex;align-items:center;gap:.3rem;border-radius:.55rem;padding:.45rem .9rem;font-size:.84rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.pc-btn.sm{padding:.2rem .5rem;font-size:.76rem}.pc-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.pc-btn.grn{background:#15803d;border-color:#15803d;color:#fff}.pc-btn.red{color:#b91c1c;border-color:#fecaca}',
      '.dark .pc-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .pc-btn.pri{background:#2563eb;color:#fff}.dark .pc-btn.grn{background:#16a34a;color:#fff}',
      '.pc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.7rem;margin-bottom:.9rem}',
      '.pc-tile{background:#fff;border:1px solid #e2e8f0;border-top:3px solid var(--c);border-radius:.8rem;padding:.7rem .9rem}.dark .pc-tile{background:#1e293b;border-color:#334155;border-top-color:var(--c)}',
      '.pc-tile span{font-size:.74rem;color:#64748b;font-weight:600}.pc-tile b{display:block;font-size:1.3rem;margin-top:.1rem}',
      '.pc-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;overflow:auto}.dark .pc-card{background:#1e293b;border-color:#334155}',
      '.pc-table{width:100%;border-collapse:collapse;font-size:.84rem}.pc-table th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.5rem;border-bottom:1px solid #e2e8f0;background:#f8fafc;white-space:nowrap}',
      '.dark .pc-table th{background:#0f172a;border-color:#334155}.pc-table td{padding:.5rem;border-bottom:1px solid #f1f5f9;vertical-align:top}.dark .pc-table td{border-color:#334155}',
      '.pc-table .n{text-align:right;white-space:nowrap}.pc-in-amt{color:#15803d;font-weight:700}.pc-out-amt{color:#b91c1c;font-weight:700}',
      '.pc-sub{font-size:.74rem;color:#64748b}.pc-open td{background:#f8fafc;font-weight:600}.dark .pc-open td{background:#0f172a}',
      '.pc-chip{display:inline-flex;align-items:center;gap:.2rem;margin:.1rem .25rem .1rem 0;padding:.1rem .45rem;border-radius:999px;background:#eff6ff;color:#1e40af;font-size:.72rem;cursor:pointer;border:none}.dark .pc-chip{background:#1e3a8a;color:#dbeafe}',
      '.pc-chip i{font-style:normal;color:#b91c1c;margin-left:.15rem}.pc-nobill{color:#b45309;font-size:.72rem;font-weight:600}',
      '.pc-warn{background:#fffbeb;border:1px solid #fcd34d;color:#92400e;border-radius:.6rem;padding:.45rem .7rem;font-size:.82rem;margin-bottom:.8rem}.dark .pc-warn{background:#422006;color:#fde68a;border-color:#a16207}',
      '.pc-empty{padding:2rem;text-align:center;color:#64748b}',
      '.pc-low{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;justify-content:space-between;background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;border-radius:.7rem;padding:.6rem .9rem;font-size:.88rem;font-weight:600;margin-bottom:.8rem}',
      '.dark .pc-low{background:#450a0a;color:#fecaca;border-color:#b91c1c}.pc-tile small{display:block;font-size:.72rem;color:#64748b;margin-top:.15rem}',
      '.pc-meter{height:.4rem;border-radius:999px;background:#e2e8f0;overflow:hidden;margin-top:.35rem}.pc-meter i{display:block;height:100%;background:var(--m)}.dark .pc-meter{background:#334155}',
      '.pc-hint{font-size:.78rem;color:#475569;background:#f8fafc;border-radius:.5rem;padding:.4rem .6rem;margin-bottom:.6rem}.dark .pc-hint{background:#0f172a;color:#cbd5e1}',
      '.pc-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:5vh 1rem;overflow:auto}',
      '.pc-dlg{background:#fff;border-radius:1rem;max-width:560px;width:100%;padding:1.2rem;box-sizing:border-box}.dark .pc-dlg{background:#1e293b}.pc-dlg h2{margin:0 0 .8rem;font-size:1.1rem}',
      '.pc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem}.pc-f{display:flex;flex-direction:column;gap:.2rem;min-width:0}.pc-f.w{grid-column:1/-1}.pc-f label{font-size:.73rem;font-weight:600;color:#475569}.dark .pc-f label{color:#cbd5e1}',
      '.pc-seg{display:flex;border:1px solid #cbd5e1;border-radius:.55rem;overflow:hidden;margin-bottom:.7rem}.pc-seg button{flex:1;border:none;background:#fff;padding:.5rem;font-weight:700;cursor:pointer;color:#334155}.pc-seg button.on.out{background:#b91c1c;color:#fff}.pc-seg button.on.in{background:#15803d;color:#fff}',
      '.dark .pc-seg{border-color:#334155}.dark .pc-seg button{background:#0f172a;color:#cbd5e1}',
      '.pc-err{color:#b91c1c;font-size:.82rem;min-height:1rem;margin-top:.5rem}.pc-foot{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.6rem}',
      '.pc-img{position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:2147483500;display:flex;align-items:center;justify-content:center;padding:1rem}.pc-img img{max-width:100%;max-height:90vh;background:#fff;border-radius:.4rem}',
      '.pc-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s}',
      '.pc-toast.in{opacity:1;transform:translate(-50%,0)}.pc-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function openBill(entry, b, download) {
    var path = '/petty-cash/' + entry.id + '/bills/' + b.id;
    if (!download && /\.pdf$/i.test(b.fileName) && window.PdfView) { PdfView.show(API + '/api' + path, { title: b.fileName, fileName: b.fileName }); return; }
    blob(path + (download ? '?download=1' : '')).then(function (bl) {
      if (download || !/^image\//.test(bl.type)) { save(bl, b.fileName); return; }
      var u = URL.createObjectURL(bl);
      var ov = el('div', { class: 'pc-img', onclick: function () { ov.remove(); URL.revokeObjectURL(u); } }, [el('img', { src: u, alt: b.fileName })]);
      document.body.appendChild(ov);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function uploadBills(entry, files) {
    var list = Array.prototype.slice.call(files || []);
    return list.reduce(function (p, f) {
      return p.then(function () { var fd = new FormData(); fd.append('file', f); return api('POST', '/petty-cash/' + entry.id + '/bills', fd, true); });
    }, Promise.resolve());
  }

  function mountPetty(root) {
    css();
    var now = new Date();
    var st = { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)), type: '', search: '', level: 'view', categories: [] };
    var tiles = el('div', { class: 'pc-tiles' }), warn = el('div'), card = el('div', { class: 'pc-card' });
    var from = el('input', { type: 'date', class: 'pc-in', value: st.from, 'aria-label': 'From', id: 'pc-from' });
    var to = el('input', { type: 'date', class: 'pc-in', value: st.to, 'aria-label': 'To', id: 'pc-to' });
    from.addEventListener('change', function () { st.from = from.value; load(); }); to.addEventListener('change', function () { st.to = to.value; load(); });
    var type = el('select', { class: 'pc-in', id: 'pc-type' }, [el('option', { value: '', text: 'Received + spent' }), el('option', { value: 'IN', text: 'Received only' }), el('option', { value: 'OUT', text: 'Spent only' })]);
    type.addEventListener('change', function () { st.type = type.value; load(); });
    var search = el('input', { type: 'search', class: 'pc-in', placeholder: 'Search description, paid to, bill no…', style: 'flex:1 1 220px' });
    var tmr; search.addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(function () { st.search = search.value.trim(); load(); }, 300); });
    var addIn = el('button', { class: 'pc-btn grn', id: 'pc-add-in', text: '+ Cash received', onclick: function () { editor(null, 'IN'); } });
    var addOut = el('button', { class: 'pc-btn pri', id: 'pc-add-out', text: '+ Expense', onclick: function () { editor(null, 'OUT'); } });
    var xl = el('button', { class: 'pc-btn', id: 'pc-excel', text: '⬇ Excel', onclick: function () {
      blob('/petty-cash/export?from=' + st.from + '&to=' + st.to).then(function (b) { save(b, 'petty-cash-' + st.from + '-to-' + st.to + '.xlsx'); }).catch(function (e) { toast(e.message, 'err'); });
    } });
    var setBtn = el('button', { class: 'pc-btn', id: 'pc-settings', text: '⚙ Limit & alert', style: 'display:none', onclick: function () { settings(); } });
    var actions = el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' }, [setBtn, xl, addIn, addOut]);
    root.appendChild(el('div', { class: 'pc-wrap' }, [
      el('div', { class: 'pc-head' }, [el('div', {}, [el('h1', { text: 'Petty cash' }), el('p', { text: 'Cash received and spent, with the bills, and the balance in hand.' })]), actions]),
      el('div', { class: 'pc-bar' }, [from, el('span', { class: 'pc-sub', text: 'to' }), to, type, search]),
      tiles, warn, card
    ]));

    function canAdd() { return st.level === 'full' || st.level === 'edit'; }
    function load() {
      var q = 'from=' + st.from + '&to=' + st.to + (st.type ? '&type=' + st.type : '') + (st.search ? '&search=' + encodeURIComponent(st.search) : '');
      api('GET', '/petty-cash?' + q).then(function (j) {
        var d = j.data; st.level = d.level; st.categories = d.categories || []; st.limits = d.limits || {};
        setBtn.style.display = st.limits.canSet ? '' : 'none';
        addIn.style.display = addOut.style.display = canAdd() ? '' : 'none';
        render(d);
      }).catch(function (e) { clear(card).appendChild(el('div', { class: 'pc-empty', text: e.message })); });
    }
    function render(d) {
      var s = d.summary;
      clear(tiles);
      [['Opening balance', s.opening, '#64748b'], ['Received', s['in'], '#15803d'], ['Spent', s.out, '#b91c1c'], ['Balance in hand', s.closing, '#1e3a8a']].forEach(function (t, i) {
        tiles.appendChild(el('div', { class: 'pc-tile', style: '--c:' + t[2], 'data-pc-tile': String(i) }, [el('span', { text: t[0] }), el('b', { text: money(t[1]) || '₹0' })]));
      });
      var L = st.limits || {};
      if (L.limit != null) {
        var pct = Math.max(0, Math.min(100, Math.round(100 * L.balanceNow / L.limit)));
        var t3 = tiles.querySelector('[data-pc-tile="3"]');
        t3.appendChild(el('small', { 'data-pc-limit': '', text: 'in hand now ' + money(L.balanceNow) + ' of ' + money(L.limit) + ' limit' }));
        t3.appendChild(el('div', { class: 'pc-meter', style: '--m:' + (L.low ? '#dc2626' : pct < 40 ? '#d97706' : '#16a34a') }, [el('i', { style: 'width:' + pct + '%' })]));
      }
      clear(warn);
      if (L.low) warn.appendChild(el('div', { class: 'pc-low', id: 'pc-low', role: 'alert' }, [
        el('span', { text: '⚠ Petty cash is low — ' + money(L.balanceNow) + ' in hand (alert at ' + money(L.lowAlert) + ').' + (L.topUp ? ' Top up ' + money(L.topUp) + ' to reach the limit.' : '') }),
        canAdd() ? el('button', { class: 'pc-btn sm grn', id: 'pc-topup', text: '+ Record top-up', onclick: function () { editor(null, 'IN', L.topUp); } }) : null
      ]));
      if (s.outWithoutBill) warn.appendChild(el('div', { class: 'pc-warn', id: 'pc-nobill', text: '⚠ ' + s.outWithoutBill + ' expense' + (s.outWithoutBill > 1 ? 's have' : ' has') + ' no bill attached.' }));
      clear(card);
      var filtered = !!(st.type || st.search);
      var rows = d.entries.map(function (x) {
        var input = el('input', { type: 'file', accept: 'image/*,.pdf', multiple: true, style: 'display:none', 'data-pc-file': x.id });
        input.addEventListener('change', function () {
          if (!input.files.length) return;
          uploadBills(x, input.files).then(function () { toast('Bill attached'); load(); }).catch(function (e) { toast(e.message, 'err'); load(); });
        });
        var bills = el('div', {}, x.bills.map(function (b) {
          return el('span', { class: 'pc-chip', 'data-pc-bill': b.id, title: b.fileName, onclick: function (e) { if (e.target.tagName !== 'I') openBill(x, b, false); } }, [
            '📎 ' + (b.fileName.length > 18 ? b.fileName.slice(0, 16) + '…' : b.fileName),
            canAdd() ? el('i', { title: 'Remove bill', text: '✕', onclick: function () {
              if (!confirm('Remove this bill?')) return;
              api('DELETE', '/petty-cash/' + x.id + '/bills/' + b.id).then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
            } }) : null
          ]);
        }).concat(!x.bills.length && x.type === 'OUT' ? [el('span', { class: 'pc-nobill', text: 'No bill' })] : []));
        return el('tr', { 'data-pc': x.id }, [
          el('td', { style: 'white-space:nowrap', text: dmy(x.entryDate) }),
          el('td', {}, [el('div', { style: 'font-weight:600', text: x.description }),
            el('div', { class: 'pc-sub', text: [x.type === 'OUT' ? x.category : 'Cash received', x.paidTo ? (x.type === 'OUT' ? 'to ' : 'from ') + x.paidTo : '', x.billNo ? 'bill ' + x.billNo : '', MODES[x.mode] || x.mode, 'by ' + x.createdBy.name].filter(Boolean).join(' · ') })]),
          el('td', { class: 'n pc-in-amt', text: x.type === 'IN' ? money(x.amount) : '' }),
          el('td', { class: 'n pc-out-amt', text: x.type === 'OUT' ? money(x.amount) : '' }),
          filtered ? null : el('td', { class: 'n', text: money(x.balance) }),
          el('td', {}, [bills]),
          el('td', { style: 'white-space:nowrap;text-align:right' }, [input,
            canAdd() ? el('button', { class: 'pc-btn sm', 'data-pc-attach': x.id, text: '📎 Add bill', onclick: function () { input.click(); } }) : null, ' ',
            canAdd() ? el('button', { class: 'pc-btn sm', 'data-pc-edit': x.id, text: '✎ Edit', onclick: function () { editor(x, x.type); } }) : null, ' ',
            st.level === 'full' ? el('button', { class: 'pc-btn sm red', 'data-pc-del': x.id, text: 'Delete', onclick: function () {
              if (!confirm('Delete this entry and its bills?')) return;
              api('DELETE', '/petty-cash/' + x.id).then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
            } }) : null
          ])
        ]);
      });
      var head = ['Date', 'Description', 'Received', 'Spent'].concat(filtered ? [] : ['Balance']).concat(['Bills', '']);
      card.appendChild(el('table', { class: 'pc-table' }, [
        el('thead', {}, [el('tr', {}, head.map(function (h, i) { return el('th', { class: i >= 2 && i <= (filtered ? 3 : 4) ? 'n' : null, text: h }); }))]),
        el('tbody', {}, [filtered ? null : el('tr', { class: 'pc-open' }, [el('td', { text: dmy(d.from) }), el('td', { text: 'Opening balance' }), el('td'), el('td'), el('td', { class: 'n', text: money(s.opening) || '₹0' }), el('td'), el('td')])]
          .concat(rows.length ? rows : [el('tr', {}, [el('td', { colspan: String(head.length), class: 'pc-empty', text: 'No entries in this period.' })])]))
      ]));
    }

    function settings() {
      var L = st.limits || {};
      var ov = el('div', { class: 'pc-modal' });
      function close() { ov.remove(); }
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
      var lim = el('input', { type: 'number', class: 'pc-in', id: 'pc-s-limit', min: '0', step: '1', placeholder: 'e.g. 20000', value: L.limit != null ? String(L.limit) : '' });
      var low = el('input', { type: 'number', class: 'pc-in', id: 'pc-s-low', min: '0', step: '1', placeholder: 'e.g. 3000', value: L.lowAlert != null ? String(L.lowAlert) : '' });
      var err = el('div', { class: 'pc-err' });
      var save = el('button', { class: 'pc-btn pri', id: 'pc-s-save', text: 'Save' });
      save.addEventListener('click', function () {
        err.textContent = ''; save.disabled = true;
        api('PUT', '/petty-cash/settings', { limit: lim.value, lowAlert: low.value }).then(function (j) { toast(j.message); close(); load(); })
          .catch(function (e) { err.textContent = e.message; save.disabled = false; });
      });
      ov.appendChild(el('div', { class: 'pc-dlg', role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', { text: 'Petty cash limit & low-balance alert' }),
        el('div', { class: 'pc-hint', text: 'Cash in hand now: ' + (money(L.balanceNow) || '₹0') + '. Cash received cannot take the balance above the limit; when expenses bring it down to the alert amount, everyone with petty cash access gets an alert.' }),
        el('div', { class: 'pc-grid' }, [
          el('div', { class: 'pc-f' }, [el('label', { text: 'Petty cash limit (₹)' }), lim]),
          el('div', { class: 'pc-f' }, [el('label', { text: 'Alert when balance is at or below (₹)' }), low])
        ]),
        el('p', { class: 'pc-sub', text: 'Leave a box empty to turn it off.' }),
        err,
        el('div', { class: 'pc-foot' }, [el('button', { class: 'pc-btn', type: 'button', text: 'Cancel', onclick: close }), save])
      ]));
      document.body.appendChild(ov);
    }

    function editor(x, kind, preset) {
      var ov = el('div', { class: 'pc-modal' });
      function close() { ov.remove(); }
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
      var cur = kind;
      var seg = el('div', { class: 'pc-seg', role: 'group' });
      var catF, paidLab;
      function setKind(k) {
        cur = k;
        seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-k') === k); });
        if (catF) catF.style.display = k === 'OUT' ? '' : 'none';
        if (paidLab) paidLab.textContent = k === 'OUT' ? 'Paid to' : 'Received from';
        drawHint();
        desc.placeholder = k === 'OUT' ? 'What was it for? e.g. Courier to Hosur customer' : 'e.g. Cash withdrawn from bank / given by MD';
      }
      [['IN', 'Cash received', 'in'], ['OUT', 'Expense (cash spent)', 'out']].forEach(function (k) {
        seg.appendChild(el('button', { type: 'button', 'data-k': k[0], class: k[2], text: k[1], onclick: function () { setKind(k[0]); } }));
      });
      var date = el('input', { type: 'date', class: 'pc-in', id: 'pc-e-date', value: x ? x.entryDate : iso(new Date()), max: iso(new Date()) });
      var amt = el('input', { type: 'number', class: 'pc-in', id: 'pc-e-amount', min: '0', step: '0.01', inputmode: 'decimal', placeholder: '0', value: x ? String(x.amount) : (preset ? String(preset) : '') });
      var L = st.limits || {};
      var hint = el('div', { class: 'pc-hint', id: 'pc-e-hint' });
      function drawHint() {
        var hand = (L.balanceNow || 0) - (x ? (x.type === 'IN' ? x.amount : -x.amount) : 0);
        hint.textContent = 'Cash in hand: ' + (money(hand) || '₹0') + (L.limit != null ? ' · limit ' + money(L.limit) + (cur === 'IN' ? ' · you can receive up to ' + money(Math.max(0, L.limit - hand)) : '') : '');
      }
      var cat = el('select', { class: 'pc-in', id: 'pc-e-cat' }, st.categories.map(function (c) { return el('option', { value: c, text: c }); }));
      cat.value = x && x.category ? x.category : 'Other';
      if (x && x.category && st.categories.indexOf(x.category) < 0) { cat.appendChild(el('option', { value: x.category, text: x.category })); cat.value = x.category; }
      var desc = el('input', { class: 'pc-in', id: 'pc-e-desc', value: x ? x.description : '' });
      var paid = el('input', { class: 'pc-in', id: 'pc-e-paid', value: x ? (x.paidTo || '') : '' });
      var billNo = el('input', { class: 'pc-in', id: 'pc-e-billno', placeholder: 'optional', value: x ? (x.billNo || '') : '' });
      var mode = el('select', { class: 'pc-in', id: 'pc-e-mode' }, Object.keys(MODES).map(function (m) { return el('option', { value: m, text: MODES[m] }); }));
      mode.value = x ? x.mode : 'CASH';
      var files = el('input', { type: 'file', accept: 'image/*,.pdf', multiple: true, id: 'pc-e-files', class: 'pc-in' });
      var err = el('div', { class: 'pc-err' });
      catF = el('div', { class: 'pc-f' }, [el('label', { text: 'Category' }), cat]);
      paidLab = el('label', { text: 'Paid to' });
      var saveBtn = el('button', { class: 'pc-btn pri', id: 'pc-e-save', text: 'Save' });
      saveBtn.addEventListener('click', function () {
        err.textContent = ''; saveBtn.disabled = true;
        var body = { type: cur, entryDate: date.value, amount: amt.value, category: cur === 'OUT' ? cat.value : '', description: desc.value.trim(), paidTo: paid.value.trim(), billNo: billNo.value.trim(), mode: mode.value };
        (x ? api('PUT', '/petty-cash/' + x.id, body) : api('POST', '/petty-cash', body)).then(function (j) {
          var e = j.data.entry;
          return uploadBills(e, files.files).then(function () { toast(files.files.length ? (x ? 'Entry updated' : 'Saved') + ' with ' + files.files.length + ' bill' + (files.files.length > 1 ? 's' : '') : j.message); });
        }).then(function () { close(); load(); })
          .catch(function (e) { err.textContent = e.message; saveBtn.disabled = false; });
      });
      ov.appendChild(el('div', { class: 'pc-dlg', role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', { text: x ? 'Edit petty cash entry' : 'New petty cash entry' }),
        seg, hint,
        el('div', { class: 'pc-grid' }, [
          el('div', { class: 'pc-f' }, [el('label', { text: 'Date *' }), date]),
          el('div', { class: 'pc-f' }, [el('label', { text: 'Amount (₹) *' }), amt]),
          el('div', { class: 'pc-f w' }, [el('label', { text: 'Description *' }), desc]),
          catF,
          el('div', { class: 'pc-f' }, [paidLab, paid]),
          el('div', { class: 'pc-f' }, [el('label', { text: 'Bill no.' }), billNo]),
          el('div', { class: 'pc-f' }, [el('label', { text: 'Paid by' }), mode]),
          el('div', { class: 'pc-f w' }, [el('label', { text: 'Bills (photos / PDF)' + (x && x.bills.length ? ' — ' + x.bills.length + ' already attached' : '') }), files])
        ]),
        err,
        el('div', { class: 'pc-foot' }, [el('button', { class: 'pc-btn', type: 'button', text: 'Cancel', onclick: close }), saveBtn])
      ]));
      setKind(cur);
      document.body.appendChild(ov);
      setTimeout(function () { amt.focus(); }, 30);
    }
    load();
  }

  /** Fuel expense page: "Fuel expense | Petty cash" tabs; the petty cash tab shows only for people with access. */
  function mountTabs(content, mountFuel) {
    css();
    var fuel = el('div'), petty = el('div', { style: 'display:none' }), bar = el('div', { class: 'pc-tabs', style: 'display:none', role: 'tablist' });
    content.appendChild(bar); content.appendChild(fuel); content.appendChild(petty);
    mountFuel(fuel);
    var mounted = false;
    function show(which) {
      fuel.style.display = which === 'fuel' ? '' : 'none';
      petty.style.display = which === 'petty' ? '' : 'none';
      bar.querySelectorAll('.pc-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === which); });
      if (which === 'petty' && !mounted) { mounted = true; mountPetty(petty); }
      try { history.replaceState(null, '', which === 'petty' ? '#petty-cash' : location.pathname + location.search); } catch (e) {}
    }
    [['fuel', '⛽ Fuel expense'], ['petty', '💵 Petty cash']].forEach(function (t) {
      bar.appendChild(el('button', { class: 'pc-tab', role: 'tab', 'data-tab': t[0], id: 'pc-tab-' + t[0], text: t[1], onclick: function () { show(t[0]); } }));
    });
    // probe: only people with petty cash access get the tab
    api('GET', '/petty-cash?from=' + iso(new Date()) + '&to=' + iso(new Date())).then(function () {
      bar.style.display = '';
      show(location.hash === '#petty-cash' ? 'petty' : 'fuel');
    }).catch(function () {});
  }

  window.PettyCash = { mountPage: mountPetty, mountTabs: mountTabs };
})();
