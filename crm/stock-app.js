/* ══════════════════════════════════════════════════════════════════════
   Stock — where every item is held, brand-wise.

   Columns: Hand stock (with us) · Local stock · one column per state that
   holds stock · Total · On order (open orders not yet supplied) · Free.
   Upload    Excel / CSV from the template; you pick the brand and the place
             (Hand stock / Local stock / Other state stock + which state).
             The uploaded quantity replaces the old one at that place only.
   Orders    marking an order line supplied takes it out of stock (Hand
             first, then Local, then state stock); undoing puts it back.
   Reminders items at / below their minimum or out of stock are flagged
             here and sent to admins as alerts (Alerts & reminders).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  var LOC_LABEL = { HAND: 'Hand stock', LOCAL: 'Local stock', STATE: 'Other state stock' };
  var REASON = { IMPORT: 'Upload', ADJUST: 'Adjusted', OPENING: 'Opening', ORDER_SUPPLIED: 'Order supplied', ORDER_RESTORED: 'Order undone' };

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  var canEdit = ['SUPER_ADMIN', 'ADMIN'].indexOf(me().role) !== -1;
  function api(method, path, body, isForm) {
    var h = { Authorization: 'Bearer ' + (token() || '') };
    if (!isForm) h['Content-Type'] = 'application/json';
    return fetch(API + '/api' + path, { method: method, headers: h, body: isForm ? body : (body ? JSON.stringify(body) : undefined) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed (' + r.status + ')');
        return j;
      });
    });
  }
  function download(path, name) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) throw new Error('Download failed');
      return r.blob().then(function (b) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      });
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
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
  function qty(v) { v = Number(v) || 0; return (Math.round(v * 100) / 100).toLocaleString('en-IN'); }
  function money(v) { return '₹' + (Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  function when(s) { var d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function toast(msg, kind) {
    document.querySelectorAll('.st-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'st-toast ' + (kind || 'ok'), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.classList.remove('in'); }, 4200);
    setTimeout(function () { t.remove(); }, 4600);
  }

  function injectCss() {
    if (document.getElementById('st-css')) return;
    var st = document.createElement('style');
    st.id = 'st-css';
    st.textContent = [
      '.st-wrap{max-width:1500px;margin:0 auto}',
      '.st-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem;margin-bottom:1rem}',
      '.st-head h1{font-size:1.35rem;font-weight:700;margin:0}.st-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.st-actions{display:flex;gap:.5rem;flex-wrap:wrap}',
      '.st-btn{display:inline-flex;align-items:center;gap:.4rem;border-radius:.55rem;padding:.5rem .9rem;font-size:.85rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.st-btn:hover{background:#f1f5f9}.st-btn:disabled{opacity:.55;cursor:default}.st-btn.sm{padding:.25rem .55rem;font-size:.75rem}',
      '.st-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.st-btn.pri:hover{background:#1e40af}',
      '.dark .st-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .st-btn.pri{background:#2563eb;border-color:#2563eb}',
      '.st-remind{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .9rem;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:.75rem;padding:.65rem .9rem;margin-bottom:1rem;font-size:.86rem}',
      '.dark .st-remind{background:#431407;border-color:#7c2d12;color:#fed7aa}',
      '.st-remind b{font-weight:700}.st-remind button{background:none;border:0;color:inherit;text-decoration:underline;font-weight:600;cursor:pointer;font-size:.84rem}',
      '.st-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.65rem;margin-bottom:1rem}',
      '.st-tile{background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;padding:.65rem .8rem}.dark .st-tile{background:#1e293b;border-color:#334155}',
      '.st-tile b{display:block;font-size:1.2rem}.st-tile span{font-size:.74rem;color:#64748b}',
      '.st-tile.warn b{color:#c2410c}.st-tile.bad b{color:#b91c1c}',
      '.st-filters{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.75rem}',
      '.st-filters input,.st-filters select,.st-f input,.st-f select,.st-f textarea{border:1px solid #cbd5e1;border-radius:.5rem;padding:.42rem .6rem;font-size:.85rem;background:#fff;color:inherit}',
      '.dark .st-filters input,.dark .st-filters select,.dark .st-f input,.dark .st-f select,.dark .st-f textarea{background:#0f172a;border-color:#334155}',
      '.st-filters input[type=search]{min-width:220px;flex:1 1 220px}',
      '.st-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;overflow:hidden}.dark .st-card{background:#1e293b;border-color:#334155}',
      '.st-tw{overflow-x:auto}',
      '.st-table{width:100%;border-collapse:collapse;font-size:.84rem}',
      '.st-table th{text-align:right;font-size:.68rem;text-transform:uppercase;letter-spacing:.02em;color:#64748b;padding:.5rem .45rem;border-bottom:1px solid #e2e8f0;white-space:nowrap;background:#f8fafc;position:sticky;top:0}',
      '.dark .st-table th{background:#0f172a;border-color:#334155}',
      '.st-table th.l,.st-table td.l{text-align:left}',
      '.st-btn.ico{width:1.9rem;justify-content:center;padding:.2rem 0!important;font-size:.85rem}',
      '.st-table td{padding:.5rem .45rem;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:top;white-space:nowrap}.dark .st-table td{border-color:#1e293b}',
      '.st-table td.l{white-space:normal;min-width:90px}.st-table .sub{color:#64748b;font-size:.74rem}',
      '.st-table th.grp{text-align:center;border-bottom:0;padding-bottom:0}',
      '.st-table th.loc{color:#0e7490}.st-table td.loc{background:#f0fdfa55}.dark .st-table td.loc{background:#134e4a22}',
      '.st-table td.zero{color:#cbd5e1}.st-table td.neg{color:#b91c1c;font-weight:700}',
      '.st-table td.tot{font-weight:700}.st-table tr:hover td{background:#f8fafc}.dark .st-table tr:hover td{background:#0f172a}',
      '.st-badge{display:inline-block;padding:.08rem .5rem;border-radius:999px;font-size:.72rem;font-weight:700}',
      '.st-badge.OK{background:#dcfce7;color:#166534}.st-badge.LOW{background:#ffedd5;color:#9a3412}.st-badge.OUT{background:#fee2e2;color:#991b1b}',
      '.st-brand{display:inline-block;padding:.05rem .45rem;border-radius:.35rem;background:#eef2ff;color:#3730a3;font-size:.74rem;font-weight:600}',
      '.st-brand.none{background:#f1f5f9;color:#94a3b8}',
      '.st-rowacts{display:flex;gap:.25rem;justify-content:flex-end}.st-rowacts .st-btn.sm{padding:.2rem .45rem}',
      // keep the item column in view while the place columns scroll sideways
      '.st-table th.item,.st-table td.item{position:sticky;left:0;z-index:2;background:#fff;box-shadow:1px 0 0 #e2e8f0;min-width:170px;max-width:240px}',
      '.st-table th.item{z-index:3;background:#f8fafc}.dark .st-table td.item{background:#1e293b;box-shadow:1px 0 0 #334155}.dark .st-table th.item{background:#0f172a}',
      '.st-table tr:hover td.item{background:#f8fafc}.dark .st-table tr:hover td.item{background:#0f172a}',
      '.st-empty{padding:2.5rem;text-align:center;color:#64748b}',
      '.st-back{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}',
      '.st-dlg{background:#fff;border-radius:.9rem;width:100%;max-width:560px;max-height:92vh;overflow:auto;padding:1.1rem;box-shadow:0 25px 50px rgba(0,0,0,.25)}.dark .st-dlg{background:#1e293b}',
      '.st-dlg.wide{max-width:820px}.st-dlg h2{font-size:1.05rem;font-weight:700;margin:0 0 .25rem}.st-dlg .hint{font-size:.8rem;color:#64748b;margin:0 0 .8rem}',
      '.st-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.7rem}',
      '.st-f label{display:block;font-size:.74rem;font-weight:600;color:#475569;margin-bottom:.25rem}.dark .st-f label{color:#94a3b8}',
      '.st-f label i{color:#dc2626;font-style:normal}.st-f input,.st-f select,.st-f textarea{width:100%}.st-f.wide{grid-column:1/-1}',
      '.st-dlg-foot{display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem}',
      '.st-err{background:#fef2f2;color:#991b1b;border-radius:.5rem;padding:.5rem .7rem;font-size:.82rem;margin-top:.6rem}',
      '.st-ok{background:#f0fdf4;color:#166534;border-radius:.5rem;padding:.5rem .7rem;font-size:.82rem;margin-top:.6rem}',
      '.st-mv td,.st-mv th{text-align:left!important}.st-mv td.q{font-weight:700}.st-mv td.q.minus{color:#b91c1c}.st-mv td.q.plus{color:#15803d}',
      '.st-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;box-shadow:0 10px 25px rgba(0,0,0,.2);transition:opacity .25s,transform .25s;max-width:calc(100vw - 32px)}',
      '.st-toast.in{opacity:1;transform:translate(-50%,0)}.st-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var ROOT, meta = null, items = [], alerts = null, stats = null;
  var f = { search: '', brand: '', loc: '', status: '', inStock: false };

  function field(label, input, req, wide) {
    return el('div', { class: 'st-f' + (wide ? ' wide' : '') }, [el('label', {}, [label, req ? el('i', { text: ' *' }) : null]), input]);
  }
  function dialog(title, hint, body, foot, wide) {
    var back = el('div', { class: 'st-back', 'data-st-dialog': '' });
    var box = el('div', { class: 'st-dlg' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { text: title }), hint ? el('p', { class: 'hint', text: hint }) : null, body, foot ? el('div', { class: 'st-dlg-foot' }, foot) : null]);
    back.appendChild(box);
    function close() { back.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    return { close: close, box: box };
  }
  /** Location picker: place (Hand / Local / Other state) + state when needed. */
  function locPicker(initType, initState) {
    var type = el('select', { 'data-loc-type': '' }, Object.keys(LOC_LABEL).map(function (k) { return el('option', { value: k, text: LOC_LABEL[k] }); }));
    type.value = initType || 'HAND';
    var state = el('select', { 'data-loc-state': '' }, [el('option', { value: '', text: 'Choose state…' })].concat(((meta && meta.states) || []).map(function (s) { return el('option', { value: s, text: s }); })));
    if (initState) state.value = initState;
    var stateF = field('State', state, true);
    function sync() { stateF.style.display = type.value === 'STATE' ? '' : 'none'; }
    type.addEventListener('change', sync); sync();
    return { nodes: [field('Where is this stock?', type, true), stateF], get: function () { return { locType: type.value, state: type.value === 'STATE' ? state.value : '' }; } };
  }

  // ── upload ───────────────────────────────────────────────────────────
  function uploadDialog() {
    var brands = (meta && meta.suggestedBrands) || [];
    var brand = el('input', { list: 'st-brands', id: 'st-up-brand', placeholder: 'e.g. YG-1, Sandvik, local brand…' });
    var dl = el('datalist', { id: 'st-brands' }, brands.map(function (b) { return el('option', { value: b }); }));
    var loc = locPicker('HAND');
    var file = el('input', { type: 'file', id: 'st-up-file', accept: '.xlsx,.csv' });
    var msg = el('div');
    var go = el('button', { class: 'st-btn pri', id: 'st-up-go', text: 'Upload' });
    var d = dialog('Upload stock', 'Pick the brand and where this stock is. The quantity (InStock column) replaces the old quantity at that place only — other places are not changed.',
      el('div', {}, [
        el('div', { class: 'st-grid' }, [field('Brand (for rows with no Brand column)', el('div', {}, [brand, dl]))].concat(loc.nodes).concat([field('Excel / CSV file', file, true, true)])),
        el('p', { class: 'hint', style: 'margin-top:.6rem' }, ['Use the ', el('a', { href: '#', style: 'text-decoration:underline', text: 'stock template', onclick: function (e) { e.preventDefault(); download('/products/stock/template', 'stock-upload-template.xlsx').catch(function (er) { toast(er.message, 'err'); }); } }), ' — one file per place (e.g. once for Hand stock, once for Karnataka).']),
        msg
      ]),
      [el('button', { class: 'st-btn', text: 'Close', onclick: function () { d.close(); } }), go]);
    go.onclick = function () {
      clear(msg);
      var l = loc.get();
      if (l.locType === 'STATE' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Choose which state the stock is in.' }));
      if (!file.files[0]) return msg.appendChild(el('div', { class: 'st-err', text: 'Choose the Excel or CSV file.' }));
      var fd = new FormData(); fd.append('file', file.files[0]); fd.append('locType', l.locType); fd.append('state', l.state); fd.append('brand', brand.value.trim());
      go.disabled = true; go.textContent = 'Uploading…';
      api('POST', '/products/stock/import', fd, true).then(function (j) {
        msg.appendChild(el('div', { class: 'st-ok', text: j.message }));
        (j.data.errors || []).slice(0, 8).forEach(function (er) { msg.appendChild(el('div', { class: 'st-err', text: 'Row ' + er.row + ': ' + er.error })); });
        file.value = '';
        loadAll();
      }).catch(function (e) { msg.appendChild(el('div', { class: 'st-err', text: e.message })); })
        .then(function () { go.disabled = false; go.textContent = 'Upload'; });
    };
  }

  // ── adjust one item at one place ─────────────────────────────────────
  function adjustDialog(it) {
    var loc = locPicker('HAND');
    var mode = el('select', { id: 'st-adj-mode' }, [el('option', { value: 'set', text: 'Set the quantity to' }), el('option', { value: 'add', text: 'Add (use minus to remove)' })]);
    var q = el('input', { type: 'number', step: 'any', id: 'st-adj-qty' });
    var note = el('input', { id: 'st-adj-note', placeholder: 'e.g. stock count, transfer from Karnataka' });
    var msg = el('div');
    var now = el('p', { class: 'hint', style: 'margin:.6rem 0 0' });
    function showNow() {
      var l = loc.get();
      var cur = l.locType === 'HAND' ? it.handStock : l.locType === 'LOCAL' ? it.localStock : (it.stateStock[l.state] || 0);
      now.textContent = 'Now at ' + (l.locType === 'STATE' ? (l.state || 'the state') : LOC_LABEL[l.locType]) + ': ' + qty(cur);
    }
    var save = el('button', { class: 'st-btn pri', id: 'st-adj-save', text: 'Save' });
    var d = dialog('Adjust stock — ' + it.itemCode, it.itemName + (it.brand ? ' · ' + it.brand : ''),
      el('div', {}, [el('div', { class: 'st-grid' }, loc.nodes.concat([field('Change', mode, true), field('Quantity', q, true), field('Note', note, false, true)])), now, msg]),
      [el('button', { class: 'st-btn', text: 'Cancel', onclick: function () { d.close(); } }), save]);
    d.box.querySelectorAll('select').forEach(function (s) { s.addEventListener('change', showNow); });
    showNow();
    save.onclick = function () {
      clear(msg);
      var l = loc.get();
      if (l.locType === 'STATE' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Choose the state.' }));
      if (q.value === '') return msg.appendChild(el('div', { class: 'st-err', text: 'Enter the quantity.' }));
      save.disabled = true;
      api('POST', '/products/stock/' + it.id + '/adjust', { locType: l.locType, state: l.state, quantity: Number(q.value), mode: mode.value, note: note.value.trim() })
        .then(function (j) { d.close(); toast(j.message); loadAll(); })
        .catch(function (e) { save.disabled = false; msg.appendChild(el('div', { class: 'st-err', text: e.message })); });
    };
  }

  // ── add / edit item ──────────────────────────────────────────────────
  function itemDialog(it) {
    var v = it || {};
    function inp(k, attrs) { var i = el('input', Object.assign({ 'data-k': k }, attrs || {})); i.value = v[k] != null ? v[k] : ''; return i; }
    var brand = inp('brand', { list: 'st-brands2' });
    var dl = el('datalist', { id: 'st-brands2' }, ((meta && meta.suggestedBrands) || []).map(function (b) { return el('option', { value: b }); }));
    var fields = [
      field('Item code', inp('itemCode', it ? { disabled: true } : {}), true), field('Item name', inp('itemName'), true),
      field('Brand', el('div', {}, [brand, dl])), field('Item group', inp('itemGroup')), field('Category code', inp('categoryCode')),
      field('Minimum stock (reminder level)', inp('minimumStock', { type: 'number', step: 'any', min: '0' })),
      field('Net price (₹)', inp('netPrice', { type: 'number', step: 'any', min: '0' })), field('Xceed-LP (₹)', inp('xceedLp', { type: 'number', step: 'any', min: '0' })),
      field('EDD', inp('edd')), field('RAD', inp('rad'))
    ];
    var loc = null, open = null;
    if (!it) {
      open = el('input', { type: 'number', step: 'any', 'data-k': 'availableStock', placeholder: '0' });
      loc = locPicker('HAND');
      fields = fields.concat([field('Opening quantity', open)]).concat(loc.nodes);
    }
    var msg = el('div');
    var save = el('button', { class: 'st-btn pri', id: 'st-item-save', text: it ? 'Save changes' : 'Add item' });
    var d = dialog(it ? 'Edit ' + it.itemCode : 'Add stock item', it ? 'Quantities change with Adjust or Upload.' : null,
      el('div', {}, [el('div', { class: 'st-grid' }, fields), msg]),
      [el('button', { class: 'st-btn', text: 'Cancel', onclick: function () { d.close(); } }), save]);
    save.onclick = function () {
      clear(msg);
      var body = {};
      d.box.querySelectorAll('[data-k]').forEach(function (i) { body[i.getAttribute('data-k')] = i.value.trim(); });
      if (!it && (!body.itemCode || !body.itemName)) return msg.appendChild(el('div', { class: 'st-err', text: 'Item code and item name are required.' }));
      if (loc) { var l = loc.get(); body.locType = l.locType; body.state = l.state; if (body.availableStock && l.locType === 'STATE' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Choose the state for the opening quantity.' })); }
      if (it) delete body.itemCode;
      save.disabled = true;
      (it ? api('PUT', '/products/stock/' + it.id, body) : api('POST', '/products/stock', body))
        .then(function (j) { d.close(); toast(j.message); loadAll(); })
        .catch(function (e) { save.disabled = false; msg.appendChild(el('div', { class: 'st-err', text: e.message })); });
    };
  }

  function historyDialog(it) {
    var body = el('div', {}, [el('p', { class: 'hint', text: 'Loading…' })]);
    var d = dialog('Stock history — ' + it.itemCode, it.itemName, body, [el('button', { class: 'st-btn', text: 'Close', onclick: function () { d.close(); } })], true);
    api('GET', '/products/stock/' + it.id + '/movements').then(function (j) {
      clear(body);
      var mv = j.data.movements || [];
      if (!mv.length) return body.appendChild(el('p', { class: 'hint', text: 'No changes recorded yet.' }));
      body.appendChild(el('div', { class: 'st-tw' }, [el('table', { class: 'st-table st-mv', id: 'st-mv' }, [
        el('thead', {}, [el('tr', {}, ['When', 'Place', 'Change', 'Balance there', 'Why', 'By'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, mv.map(function (m) {
          return el('tr', {}, [el('td', { text: when(m.createdAt) }), el('td', { text: m.location }),
            el('td', { class: 'q ' + (m.qty < 0 ? 'minus' : 'plus'), text: (m.qty > 0 ? '+' : '') + qty(m.qty) }),
            el('td', { text: m.balance == null ? '' : qty(m.balance) }),
            el('td', { class: 'l', text: (REASON[m.reason] || m.reason) + (m.note ? ' — ' + m.note : '') }), el('td', { text: m.userName || '' })]);
        }))
      ])]));
    }).catch(function (e) { clear(body).appendChild(el('div', { class: 'st-err', text: e.message })); });
  }

  // ── page ─────────────────────────────────────────────────────────────
  function stateCols() {
    // a column for every state that holds stock (from meta), plus any on the rows shown
    var seen = {};
    ((meta && meta.stateStock) || []).forEach(function (s) { seen[s.state] = true; });
    items.forEach(function (it) { Object.keys(it.stateStock || {}).forEach(function (s) { seen[s] = true; }); });
    return Object.keys(seen).sort();
  }

  function remindBar() {
    if (!alerts) return null;
    var s = alerts.summary || {};
    if (!s.lowStock && !s.outOfStock && !s.shortForOrders) return null;
    function link(txt, st) { return el('button', { onclick: function () { f.status = st; render(); loadItems(); }, text: txt }); }
    return el('div', { class: 'st-remind', id: 'st-remind' }, [
      el('b', { text: '⏰ Stock reminder' }),
      s.lowStock ? el('span', {}, [s.lowStock + ' low ', link('show', 'low')]) : null,
      s.outOfStock ? el('span', {}, [s.outOfStock + ' out of stock ', link('show', 'out')]) : null,
      s.shortForOrders ? el('span', { text: s.shortForOrders + ' short for open orders: ' + alerts.shortForOrders.slice(0, 4).map(function (x) { return x.itemCode + ' (need ' + qty(x.reserved) + ', have ' + qty(x.availableStock) + ')'; }).join(', ') }) : null
    ]);
  }

  function tiles() {
    var t = (meta && meta.totals) || {};
    var s = stats || {};
    return el('div', { class: 'st-tiles' }, [
      el('div', { class: 'st-tile' }, [el('b', { text: String(s.total || 0) }), el('span', { text: 'Items' })]),
      el('div', { class: 'st-tile' }, [el('b', { text: qty(t.HAND) }), el('span', { text: 'Hand stock (qty)' })]),
      el('div', { class: 'st-tile' }, [el('b', { text: qty(t.LOCAL) }), el('span', { text: 'Local stock (qty)' })]),
      el('div', { class: 'st-tile' }, [el('b', { text: qty(t.STATE) }), el('span', { text: 'Other state stock (qty, ' + ((meta && meta.stateStock) || []).length + ' states)' })]),
      el('div', { class: 'st-tile warn' }, [el('b', { text: String(s.lowStock || 0) }), el('span', { text: 'Low stock' })]),
      el('div', { class: 'st-tile bad' }, [el('b', { text: String(s.outOfStock || 0) }), el('span', { text: 'Out of stock' })]),
      el('div', { class: 'st-tile' }, [el('b', { text: money(s.stockValue) }), el('span', { text: 'Stock value (net)' })])
    ]);
  }

  function filters() {
    var search = el('input', { type: 'search', id: 'st-search', placeholder: 'Search code, name, group, brand…', value: f.search });
    var t; search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { f.search = search.value.trim(); loadItems(); }, 300); });
    var brand = el('select', { id: 'st-fbrand' }, [el('option', { value: '', text: 'All brands' })].concat(((meta && meta.brands) || []).map(function (b) { return el('option', { value: b, text: b }); })).concat([el('option', { value: '__none', text: 'No brand' })]));
    brand.value = f.brand; brand.onchange = function () { f.brand = brand.value; loadItems(); };
    var loc = el('select', { id: 'st-floc' }, [el('option', { value: '', text: 'All places' }), el('option', { value: 'HAND', text: 'Hand stock' }), el('option', { value: 'LOCAL', text: 'Local stock' }), el('option', { value: 'STATE', text: 'Any other state' })]
      .concat(((meta && meta.stateStock) || []).map(function (s) { return el('option', { value: 'STATE:' + s.state, text: s.state + ' (state)' }); })));
    loc.value = f.loc; loc.onchange = function () { f.loc = loc.value; loadItems(); };
    var status = el('select', { id: 'st-fstatus' }, [['', 'Any status'], ['low', 'Low stock'], ['out', 'Out of stock']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    status.value = f.status; status.onchange = function () { f.status = status.value; loadItems(); };
    var chk = el('input', { type: 'checkbox', id: 'st-instock' }); chk.checked = f.inStock; chk.onchange = function () { f.inStock = chk.checked; loadItems(); };
    return el('div', { class: 'st-filters' }, [search, brand, loc, status, el('label', { style: 'display:flex;gap:.35rem;align-items:center;font-size:.85rem' }, [chk, 'In stock only'])]);
  }

  function table() {
    if (!items.length) return el('div', { class: 'st-empty', text: f.search || f.brand || f.loc || f.status ? 'No items match these filters.' : 'No stock yet — upload the stock template to start.' });
    var states = stateCols();
    function num(v, cls) { v = Number(v) || 0; return el('td', { class: (cls || '') + (v < 0 ? ' neg' : v === 0 ? ' zero' : ''), text: qty(v) }); }
    var head1 = el('tr', {}, [el('th', { class: 'l item', rowspan: '2', text: 'Item' }), el('th', { class: 'l', rowspan: '2', text: 'Brand' }),
      el('th', { class: 'grp loc', colspan: String(2 + states.length), text: 'Where the stock is' }),
      el('th', { rowspan: '2', text: 'Total' }), el('th', { rowspan: '2', text: 'On order' }), el('th', { rowspan: '2', text: 'Free' }),
      el('th', { rowspan: '2', text: 'Min' }), el('th', { rowspan: '2', text: 'Status' }), el('th', { rowspan: '2', text: 'Net price' }),
      canEdit ? el('th', { rowspan: '2', text: '' }) : el('th', { rowspan: '2', text: '' })]);
    var head2 = el('tr', {}, [el('th', { class: 'loc', text: 'Hand' }), el('th', { class: 'loc', text: 'Local' })].concat(states.map(function (s) { return el('th', { class: 'loc', text: s, title: s + ' state stock' }); })));
    var rows = items.map(function (it) {
      var acts = el('div', { class: 'st-rowacts' }, [
        canEdit ? el('button', { class: 'st-btn sm ico', 'data-adjust': it.itemCode, title: 'Adjust quantity', 'aria-label': 'Adjust ' + it.itemCode, text: '±', onclick: function () { adjustDialog(it); } }) : null,
        el('button', { class: 'st-btn sm ico', 'data-history': it.itemCode, title: 'Stock history', 'aria-label': 'History of ' + it.itemCode, text: '🕘', onclick: function () { historyDialog(it); } }),
        canEdit ? el('button', { class: 'st-btn sm ico', title: 'Edit item', 'aria-label': 'Edit ' + it.itemCode, text: '✎', onclick: function () { itemDialog(it); } }) : null
      ]);
      return el('tr', { 'data-code': it.itemCode }, [
        el('td', { class: 'l item' }, [el('div', { style: 'font-weight:600', text: it.itemCode }), el('div', { class: 'sub', text: it.itemName + (it.itemGroup ? ' · ' + it.itemGroup : '') })]),
        el('td', { class: 'l' }, [el('span', { class: 'st-brand' + (it.brand ? '' : ' none'), text: it.brand || '—' })]),
        num(it.handStock, 'loc'), num(it.localStock, 'loc')
      ].concat(states.map(function (s) { return num(it.stateStock[s], 'loc'); })).concat([
        num(it.availableStock, 'tot'),
        el('td', { class: it.reservedStock ? '' : 'zero', text: it.reservedStock ? qty(it.reservedStock) : '—' }),
        num(it.freeStock),
        el('td', { class: it.minimumStock ? '' : 'zero', text: it.minimumStock ? qty(it.minimumStock) : '—' }),
        el('td', {}, [el('span', { class: 'st-badge ' + it.stockStatus, text: it.stockStatus === 'OUT' ? 'Out' : it.stockStatus === 'LOW' ? 'Low' : 'OK' })]),
        el('td', { text: it.netPrice ? money(it.netPrice) : '—' }),
        el('td', {}, [acts])
      ]));
    });
    return el('div', { class: 'st-tw' }, [el('table', { class: 'st-table', id: 'st-table' }, [el('thead', {}, [head1, head2]), el('tbody', {}, rows)])]);
  }

  function render() {
    clear(ROOT).appendChild(el('div', { class: 'st-wrap' }, [
      el('div', { class: 'st-head' }, [
        el('div', {}, [el('h1', { text: 'Stock' }), el('p', { text: 'Brand-wise stock by place — hand, local and other states. Supplied orders are taken out automatically.' })]),
        el('div', { class: 'st-actions' }, [
          el('button', { class: 'st-btn', id: 'st-template', text: '⬇ Template', onclick: function () { download('/products/stock/template', 'stock-upload-template.xlsx').catch(function (e) { toast(e.message, 'err'); }); } }),
          canEdit ? el('button', { class: 'st-btn', id: 'st-add', text: '+ Add item', onclick: function () { itemDialog(null); } }) : null,
          canEdit ? el('button', { class: 'st-btn pri', id: 'st-upload', text: '⬆ Upload stock', onclick: uploadDialog }) : null
        ])
      ]),
      remindBar(), tiles(), filters(),
      el('div', { class: 'st-card', id: 'st-list' }, [table()])
    ]));
  }

  function itemsQuery() {
    return '?limit=500' + (f.search ? '&search=' + encodeURIComponent(f.search) : '') + (f.brand ? '&brand=' + encodeURIComponent(f.brand) : '') +
      (f.loc ? '&loc=' + encodeURIComponent(f.loc) : '') + (f.status ? '&status=' + f.status : '') + (f.inStock ? '&inStockOnly=true' : '');
  }
  function loadItems() {
    return api('GET', '/products/stock' + itemsQuery()).then(function (j) {
      var d = j.data; items = Array.isArray(d) ? d : (d && (d.items || d.data)) || [];
      var list = document.getElementById('st-list');
      if (list) clear(list).appendChild(table()); else render();
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function loadAll() {
    return Promise.all([api('GET', '/products/stock/meta'), api('GET', '/products/stock/stats'), api('GET', '/products/stock/alerts').catch(function () { return { data: null }; }),
      api('GET', '/products/stock' + itemsQuery())]).then(function (r) {
      meta = r[0].data; stats = r[1].data; alerts = r[2].data;
      var d = r[3].data; items = Array.isArray(d) ? d : (d && (d.items || d.data)) || [];
      var keep = document.activeElement && document.activeElement.id === 'st-search';
      render();
      if (keep) { var s = document.getElementById('st-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }).catch(function (e) { clear(ROOT).appendChild(el('div', { class: 'st-empty', text: e.message })); });
  }

  function mountPage(content) {
    injectCss();
    ROOT = content;
    var qs = new URLSearchParams(location.search);
    if (/^(low|out)$/.test(qs.get('status') || '')) f.status = qs.get('status');
    ROOT.appendChild(el('div', { class: 'st-empty', text: 'Loading stock…' }));
    loadAll();
  }
  window.StockPage = { mountPage: mountPage };
})();
