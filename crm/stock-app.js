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
  /** Place picker: Hand stock / Local stock + city / Other state + state. withAuto adds "Use sheet names". */
  function locPicker(initType, initState, withAuto) {
    var opts = (withAuto ? [el('option', { value: 'AUTO', text: 'Use sheet names (one sheet per place)' })] : [])
      .concat(Object.keys(LOC_LABEL).map(function (k) { return el('option', { value: k, text: LOC_LABEL[k] }); }));
    var type = el('select', { 'data-loc-type': '' }, opts);
    type.value = initType || (withAuto ? 'AUTO' : 'HAND');
    var state = el('select', { 'data-loc-state': '' }, [el('option', { value: '', text: 'Choose state…' })].concat(((meta && meta.states) || []).map(function (s) { return el('option', { value: s, text: s }); })));
    var cities = (meta && meta.localCities) || ['Mumbai', 'Hyderabad', 'Bangalore'];
    var city = el('select', { 'data-loc-city': '' }, cities.map(function (c) { return el('option', { value: c, text: c }); }).concat([el('option', { value: '__other', text: 'Other city…' })]));
    var cityOther = el('input', { 'data-loc-city-other': '', placeholder: 'City / branch name', style: 'margin-top:.35rem' });
    if (initType === 'STATE' && initState) state.value = initState;
    if (initType === 'LOCAL' && initState) { if (cities.indexOf(initState) === -1) { city.value = '__other'; cityOther.value = initState; } else city.value = initState; }
    var stateF = field('State', state, true), cityF = field('City', el('div', {}, [city, cityOther]), true);
    function sync() {
      stateF.style.display = type.value === 'STATE' ? '' : 'none';
      cityF.style.display = type.value === 'LOCAL' ? '' : 'none';
      cityOther.style.display = city.value === '__other' ? '' : 'none';
    }
    type.addEventListener('change', sync); city.addEventListener('change', sync); sync();
    return { nodes: [field('Where is this stock?', type, true), stateF, cityF], get: function () {
      var t = type.value;
      return { locType: t, state: t === 'STATE' ? state.value : t === 'LOCAL' ? (city.value === '__other' ? cityOther.value.trim() : city.value) : '' };
    } };
  }
  function placeLabel(l) { return l.locType === 'STATE' ? (l.state || 'the state') : l.locType === 'LOCAL' ? 'Local – ' + (l.state || '?') : LOC_LABEL[l.locType]; }
  function qtyAt(it, l) {
    if (l.locType === 'HAND') return it.handStock;
    if (l.locType === 'LOCAL') return (it.localByCity || {})[l.state] || 0;
    return (it.stateStock || {})[l.state] || 0;
  }

  // ── upload ───────────────────────────────────────────────────────────
  function uploadDialog() {
    var brands = (meta && meta.suggestedBrands) || [];
    var brand = el('input', { list: 'st-brands', id: 'st-up-brand', placeholder: 'e.g. YG-1, Sandvik, local brand…' });
    var dl = el('datalist', { id: 'st-brands' }, brands.map(function (b) { return el('option', { value: b }); }));
    var loc = locPicker('AUTO', '', true);
    var file = el('input', { type: 'file', id: 'st-up-file', accept: '.xlsx,.csv' });
    var msg = el('div');
    var go = el('button', { class: 'st-btn pri', id: 'st-up-go', text: 'Upload' });
    var d = dialog('Upload stock', 'Multi-page Excel: every sheet is read and the sheet name says where its stock is (Hand stock, Local - Mumbai, Karnataka…). Or pick one place for the whole file. The quantity replaces the old quantity at that place only.',
      el('div', {}, [
        el('div', { class: 'st-grid' }, [field('Brand (for rows with no Brand column)', el('div', {}, [brand, dl]))].concat(loc.nodes).concat([field('Excel / CSV file', file, true, true)])),
        el('p', { class: 'hint', style: 'margin-top:.6rem' }, ['Use the ', el('a', { href: '#', style: 'text-decoration:underline', text: 'stock template', onclick: function (e) { e.preventDefault(); download('/products/stock/template', 'stock-upload-template.xlsx').catch(function (er) { toast(er.message, 'err'); }); } }), ' — one sheet per place: Hand stock, Local - Mumbai, Local - Hyderabad, Local - Bangalore, a state… Add or rename sheets as you need.']),
        msg
      ]),
      [el('button', { class: 'st-btn', text: 'Close', onclick: function () { d.close(); } }), go]);
    go.onclick = function () {
      clear(msg);
      var l = loc.get();
      if (l.locType === 'STATE' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Choose which state the stock is in.' }));
      if (l.locType === 'LOCAL' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Enter the city for the local stock.' }));
      if (!file.files[0]) return msg.appendChild(el('div', { class: 'st-err', text: 'Choose the Excel or CSV file.' }));
      var fd = new FormData(); fd.append('file', file.files[0]); fd.append('locType', l.locType); fd.append('state', l.state); fd.append('brand', brand.value.trim());
      go.disabled = true; go.textContent = 'Uploading…';
      api('POST', '/products/stock/import', fd, true).then(function (j) {
        msg.appendChild(el('div', { class: 'st-ok', text: j.message }));
        var sh = j.data.sheets || [];
        if (sh.length) msg.appendChild(el('table', { class: 'st-table st-mv st-sheets', style: 'margin-top:.6rem' }, [
          el('thead', {}, [el('tr', {}, ['Sheet', 'Result'].map(function (h) { return el('th', { text: h }); }))]),
          el('tbody', {}, sh.map(function (x) {
            return el('tr', {}, [el('td', { text: x.sheet }), el('td', { class: 'l', style: x.status === 'skipped' ? 'color:#b45309' : '',
              text: x.status === 'skipped' ? 'Skipped — ' + x.reason : x.rows + ' row' + (x.rows === 1 ? '' : 's') + ' → ' + x.place })]);
          }))]));
        (j.data.errors || []).slice(0, 8).forEach(function (er) { msg.appendChild(el('div', { class: 'st-err', text: (er.sheet ? er.sheet + ', ' : '') + 'row ' + er.row + ': ' + er.error })); });
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
      now.textContent = 'Now at ' + placeLabel(l) + ': ' + qty(qtyAt(it, l));
    }
    var save = el('button', { class: 'st-btn pri', id: 'st-adj-save', text: 'Save' });
    var d = dialog('Adjust stock — ' + it.itemCode, it.itemName + (it.brand ? ' · ' + it.brand : ''),
      el('div', {}, [el('div', { class: 'st-grid' }, loc.nodes.concat([field('Change', mode, true), field('Quantity', q, true), field('Note', note, false, true)])), now, msg]),
      [el('button', { class: 'st-btn', text: 'Cancel', onclick: function () { d.close(); } }), save]);
    d.box.querySelectorAll('select,input').forEach(function (s) { s.addEventListener('change', showNow); });
    showNow();
    save.onclick = function () {
      clear(msg);
      var l = loc.get();
      if (l.locType === 'STATE' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Choose the state.' }));
      if (l.locType === 'LOCAL' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Enter the city.' }));
      if (q.value === '') return msg.appendChild(el('div', { class: 'st-err', text: 'Enter the quantity.' }));
      save.disabled = true;
      api('POST', '/products/stock/' + it.id + '/adjust', { locType: l.locType, state: l.state, quantity: Number(q.value), mode: mode.value, note: note.value.trim() })
        .then(function (j) { d.close(); toast(j.message); loadAll(); })
        .catch(function (e) { save.disabled = false; msg.appendChild(el('div', { class: 'st-err', text: e.message })); });
    };
  }

  // ── add stock by hand (existing item or a new one) ──────────────────
  function addStockDialog() {
    var code = el('input', { id: 'st-add-code', list: 'st-codes', placeholder: 'Type or pick the item code', autocomplete: 'off' });
    var codes = el('datalist', { id: 'st-codes' });
    var found = el('p', { class: 'hint', id: 'st-add-found', style: 'margin:.25rem 0 0' });
    var name = el('input', { id: 'st-add-name', placeholder: 'Item name' });
    var brand = el('input', { id: 'st-add-brand', list: 'st-brands3', placeholder: 'Brand' });
    var bl = el('datalist', { id: 'st-brands3' }, ((meta && meta.suggestedBrands) || []).map(function (b) { return el('option', { value: b }); }));
    var group = el('input', { id: 'st-add-group', placeholder: 'e.g. Insert, Drill' });
    var min = el('input', { id: 'st-add-min', type: 'number', step: 'any', min: '0', placeholder: '0' });
    var price = el('input', { id: 'st-add-price', type: 'number', step: 'any', min: '0', placeholder: '0' });
    var newBox = el('div', { class: 'st-grid', style: 'display:none;margin-top:.7rem' }, [field('Item name', name, true), field('Brand', el('div', {}, [brand, bl])),
      field('Item group', group), field('Minimum stock', min), field('Net price (₹)', price)]);
    var loc = locPicker('HAND');
    var mode = el('select', { id: 'st-add-mode' }, [el('option', { value: 'add', text: 'Add to what is there' }), el('option', { value: 'set', text: 'Set the quantity to' })]);
    var q = el('input', { type: 'number', step: 'any', id: 'st-add-qty' });
    var note = el('input', { id: 'st-add-note', placeholder: 'e.g. received from supplier, stock count' });
    var msg = el('div'), match = null, t = null;
    function lookup() {
      var v = code.value.trim().toUpperCase();
      match = null;
      if (!v) { found.textContent = ''; newBox.style.display = 'none'; return; }
      api('GET', '/products/stock?limit=20&search=' + encodeURIComponent(v)).then(function (j) {
        var list = Array.isArray(j.data) ? j.data : (j.data.items || []);
        clear(codes); list.forEach(function (x) { codes.appendChild(el('option', { value: x.itemCode, text: x.itemName })); });
        match = list.filter(function (x) { return x.itemCode === v; })[0] || null;
        if (match) {
          var l = loc.get();
          found.textContent = '✓ ' + match.itemName + (match.brand ? ' · ' + match.brand : '') + ' — total ' + qty(match.availableStock) + ', now at ' + placeLabel(l) + ': ' + qty(qtyAt(match, l));
          newBox.style.display = 'none';
        } else { found.textContent = 'New item code — fill in the item details below.'; newBox.style.display = ''; }
      }).catch(function () {});
    }
    code.addEventListener('input', function () { clearTimeout(t); t = setTimeout(lookup, 300); });
    code.addEventListener('change', lookup);
    var save = el('button', { class: 'st-btn pri', id: 'st-add-save', text: 'Save stock' });
    var d = dialog('Add stock', 'Add stock for one item at one place — an existing item, or a new item code.',
      el('div', {}, [field('Item code', el('div', {}, [code, codes, found]), true, true), newBox,
        el('div', { class: 'st-grid', style: 'margin-top:.7rem' }, loc.nodes.concat([field('Change', mode, true), field('Quantity', q, true), field('Note', note, false, true)])), msg]),
      [el('button', { class: 'st-btn', text: 'Cancel', onclick: function () { d.close(); } }), save]);
    d.box.querySelectorAll('[data-loc-type],[data-loc-state],[data-loc-city],[data-loc-city-other]').forEach(function (x) { x.addEventListener('change', function () { if (match) lookup(); }); });
    setTimeout(function () { code.focus(); }, 30);
    save.onclick = function () {
      clear(msg);
      var l = loc.get();
      if (!code.value.trim()) return msg.appendChild(el('div', { class: 'st-err', text: 'Enter the item code.' }));
      if (!match && !name.value.trim()) return msg.appendChild(el('div', { class: 'st-err', text: 'New item code — enter the item name too.' }));
      if (l.locType === 'STATE' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Choose the state.' }));
      if (l.locType === 'LOCAL' && !l.state) return msg.appendChild(el('div', { class: 'st-err', text: 'Enter the city.' }));
      if (q.value === '') return msg.appendChild(el('div', { class: 'st-err', text: 'Enter the quantity.' }));
      save.disabled = true;
      api('POST', '/products/stock/entry', { itemCode: code.value.trim(), itemName: name.value.trim(), brand: match ? '' : brand.value.trim(), itemGroup: group.value.trim(),
        minimumStock: min.value, netPrice: price.value, locType: l.locType, state: l.state, quantity: Number(q.value), mode: mode.value, note: note.value.trim() })
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

  function localCols() {
    // a column for every city that holds local stock ('' = local stock with no city)
    var seen = {};
    ((meta && meta.localStock) || []).forEach(function (s) { seen[s.city] = true; });
    items.forEach(function (it) { Object.keys(it.localByCity || {}).forEach(function (c) { seen[c] = true; }); });
    var list = Object.keys(seen).sort(function (a, b) { return a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1; });
    return list.length ? list : [''];
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
      el('div', { class: 'st-tile' }, [el('b', { text: qty(t.LOCAL) }), el('span', { text: 'Local stock (qty, ' + ((meta && meta.localStock) || []).filter(function (x) { return x.city; }).length + ' cities)' })]),
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
    var held = {}; ((meta && meta.localStock) || []).forEach(function (x) { held[x.city] = x.quantity; });
    var loc = el('select', { id: 'st-floc' }, [el('option', { value: '', text: 'All places' }), el('option', { value: 'HAND', text: 'Hand stock' }),
      el('optgroup', { label: 'Local stock' }, [el('option', { value: 'LOCAL', text: 'Local stock — all cities' })].concat(((meta && meta.localCities) || []).map(function (c) {
        return el('option', { value: 'LOCAL:' + c, text: 'Local – ' + c + (held[c] ? ' (' + qty(held[c]) + ')' : '') }); }))),
      el('optgroup', { label: 'Other state stock' }, [el('option', { value: 'STATE', text: 'Any other state' })].concat(((meta && meta.stateStock) || []).map(function (s) { return el('option', { value: 'STATE:' + s.state, text: s.state + ' (' + qty(s.quantity) + ')' }); })))]);
    loc.value = f.loc; loc.onchange = function () { f.loc = loc.value; loadItems(); };
    var status = el('select', { id: 'st-fstatus' }, [['', 'Any status'], ['low', 'Low stock'], ['out', 'Out of stock']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    status.value = f.status; status.onchange = function () { f.status = status.value; loadItems(); };
    var chk = el('input', { type: 'checkbox', id: 'st-instock' }); chk.checked = f.inStock; chk.onchange = function () { f.inStock = chk.checked; loadItems(); };
    return el('div', { class: 'st-filters' }, [search, brand, loc, status, el('label', { style: 'display:flex;gap:.35rem;align-items:center;font-size:.85rem' }, [chk, 'In stock only'])]);
  }

  function table() {
    if (!items.length) return el('div', { class: 'st-empty', text: f.search || f.brand || f.loc || f.status ? 'No items match these filters.' : 'No stock yet — upload the stock template to start.' });
    var states = stateCols(), locals = localCols();
    function num(v, cls) { v = Number(v) || 0; return el('td', { class: (cls || '') + (v < 0 ? ' neg' : v === 0 ? ' zero' : ''), text: qty(v) }); }
    var head1 = el('tr', {}, [el('th', { class: 'l item', rowspan: '2', text: 'Item' }), el('th', { class: 'l', rowspan: '2', text: 'Brand' }),
      el('th', { class: 'grp loc', rowspan: '2', text: 'Hand' }),
      el('th', { class: 'grp loc', colspan: String(locals.length), text: 'Local stock' }),
      states.length ? el('th', { class: 'grp loc', colspan: String(states.length), text: 'Other states' }) : null,
      el('th', { rowspan: '2', text: 'Total' }), el('th', { rowspan: '2', text: 'On order' }), el('th', { rowspan: '2', text: 'Free' }),
      el('th', { rowspan: '2', text: 'Min' }), el('th', { rowspan: '2', text: 'Status' }), el('th', { rowspan: '2', text: 'Net price' }),
      canEdit ? el('th', { rowspan: '2', text: '' }) : el('th', { rowspan: '2', text: '' })]);
    var head2 = el('tr', {}, locals.map(function (c) { return el('th', { class: 'loc', text: c || 'Local', title: 'Local stock' + (c ? ' – ' + c : '') }); }).concat(states.map(function (s) { return el('th', { class: 'loc', text: s, title: s + ' state stock' }); })));
    var rows = items.map(function (it) {
      var acts = el('div', { class: 'st-rowacts' }, [
        canEdit ? el('button', { class: 'st-btn sm ico', 'data-adjust': it.itemCode, title: 'Adjust quantity', 'aria-label': 'Adjust ' + it.itemCode, text: '±', onclick: function () { adjustDialog(it); } }) : null,
        el('button', { class: 'st-btn sm ico', 'data-history': it.itemCode, title: 'Stock history', 'aria-label': 'History of ' + it.itemCode, text: '🕘', onclick: function () { historyDialog(it); } }),
        canEdit ? el('button', { class: 'st-btn sm ico', title: 'Edit item', 'aria-label': 'Edit ' + it.itemCode, text: '✎', onclick: function () { itemDialog(it); } }) : null
      ]);
      return el('tr', { 'data-code': it.itemCode }, [
        el('td', { class: 'l item' }, [el('div', { style: 'font-weight:600', text: it.itemCode }), el('div', { class: 'sub', text: it.itemName + (it.itemGroup ? ' · ' + it.itemGroup : '') })]),
        el('td', { class: 'l' }, [el('span', { class: 'st-brand' + (it.brand ? '' : ' none'), text: it.brand || '—' })]),
        num(it.handStock, 'loc')
      ].concat(locals.map(function (c) { return num((it.localByCity || {})[c], 'loc'); })).concat(states.map(function (s) { return num((it.stateStock || {})[s], 'loc'); })).concat([
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
          canEdit ? el('button', { class: 'st-btn', id: 'st-add-stock', text: '+ Add stock', onclick: addStockDialog }) : null,
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
