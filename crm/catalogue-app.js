/* ══════════════════════════════════════════════════════════════════════
   Product catalogue — products by type with the details each type needs:
     Inserts   grade, corner radius, chip breaker, materials (ISO P M K N S H)
     Cutters   diameter, no. of pockets, insert that fits it
     End mills diameter, flutes, lengths, coating
     Drills    diameter, length (xD), coolant through
     Taps      thread size, pitch, tap type
     General   everything else
   Every product has a serial no.; several brands; add by hand or upload the
   type's Excel; brand catalogue PDFs on the last tab. Everyone can browse,
   Admin / Super Admin add, edit and upload. (Same products as the Products
   page, quotations and orders.)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function api(method, path, body) {
    var opt = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body instanceof FormData) opt.body = body;
    else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(API + '/api' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed (' + r.status + ')');
        return j;
      });
    });
  }
  function getFile(path, open, name) {
    if (open && window.PdfView && (!name || /\.pdf$/i.test(name))) { PdfView.show(API + '/api' + path, { title: name || 'Catalogue', fileName: name }); return Promise.resolve(); }
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Download failed'); });
      var cd = r.headers.get('Content-Disposition') || '', m = /filename="?([^";]+)"?/.exec(cd);
      return r.blob().then(function (b) {
        var u = URL.createObjectURL(b);
        if (open) { window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); return; }
        var a = document.createElement('a'); a.href = u; a.download = name || (m ? m[1] : 'download'); document.body.appendChild(a); a.click(); a.remove();
      });
    }).catch(function (e) { toast(e.message, 'err'); });
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
  function num(v) { return v == null || v === '' ? '' : String(+Number(v).toFixed(3)); }
  function money(v) { return v ? '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'; }
  function toast(msg, kind) {
    document.querySelectorAll('.pc-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'pc-toast' + (kind === 'err' ? ' err' : ''), text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }

  var TABS = [['', 'All'], ['INSERT', 'Inserts'], ['CUTTER', 'Cutters'], ['ENDMILL', 'End mills'], ['DRILL', 'Drills'], ['TAP', 'Taps'], ['GENERAL', 'General'], ['FILES', 'Catalogue PDFs']];
  var ISO_C = { P: '#2563eb', M: '#ca8a04', K: '#dc2626', N: '#16a34a', S: '#ea580c', H: '#64748b' };
  var ISO_T = { P: 'Steel', M: 'Stainless', K: 'Cast iron', N: 'Non-ferrous / Al', S: 'Super alloys / Ti', H: 'Hardened' };
  var st = { tab: '', brand: '', q: '', iso: '', data: null };
  var root, tabsBox, body;

  function injectCss() {
    if (document.getElementById('pc-css')) return;
    var s = document.createElement('style'); s.id = 'pc-css';
    s.textContent = [
      '.pc-wrap{max-width:1400px;margin:0 auto}.pc-head{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:.6rem;margin-bottom:.8rem}',
      '.pc-head h1{font-size:1.35rem;font-weight:700;margin:0}.pc-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.pc-tabs{display:flex;gap:.2rem;border-bottom:1px solid #e2e8f0;margin-bottom:.8rem;overflow-x:auto}.dark .pc-tabs{border-color:#334155}',
      '.pc-tab{padding:.55rem .9rem;font-size:.88rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.pc-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .pc-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}.pc-tab small{margin-left:.3rem;color:#94a3b8;font-weight:600}',
      '.pc-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .pc-card{background:#1e293b;border-color:#334155}',
      '.pc-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.7rem}.pc-bar .sp{flex:1}',
      '.pc-bar input,.pc-bar select{border:1px solid #cbd5e1;border-radius:.5rem;padding:.42rem .6rem;font-size:.85rem;background:#fff;color:inherit}.pc-bar input[type=search]{min-width:220px;flex:1}',
      '.dark .pc-bar input,.dark .pc-bar select{background:#0f172a;border-color:#334155}',
      '.pc-btn{display:inline-flex;align-items:center;gap:.35rem;border-radius:.55rem;padding:.45rem .85rem;font-size:.84rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.pc-btn:hover{background:#f1f5f9}.pc-btn.sm{padding:.22rem .55rem;font-size:.76rem}.pc-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.pc-btn.red{color:#b91c1c;border-color:#fecaca}',
      '.dark .pc-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .pc-btn.pri{background:#2563eb}',
      '.pc-tw{overflow-x:auto}.pc-table{width:100%;border-collapse:collapse;font-size:.83rem}',
      '.pc-table th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.45rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.pc-table td{padding:.45rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.dark .pc-table th,.dark .pc-table td{border-color:#334155}',
      '.pc-table .n{text-align:right;white-space:nowrap}.pc-table .sub{color:#64748b;font-size:.74rem}.pc-sl{font-weight:700;color:#64748b;font-variant-numeric:tabular-nums}',
      '.pc-iso{display:inline-flex;align-items:center;justify-content:center;width:1.25rem;height:1.25rem;border-radius:.25rem;font-size:.68rem;font-weight:800;color:#fff;background:var(--c);margin-right:2px}',
      '.pc-type{display:inline-block;padding:.05rem .45rem;border-radius:.35rem;font-size:.7rem;font-weight:700;background:#eef2ff;color:#3730a3}',
      '.pc-brand{display:inline-block;padding:.05rem .45rem;border-radius:.35rem;font-size:.72rem;font-weight:600;background:#f1f5f9;color:#334155}.dark .pc-brand{background:#0f172a;color:#cbd5e1}',
      '.pc-empty{padding:1.5rem;text-align:center;color:#64748b;font-size:.88rem}',
      '.pc-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:4vh 1rem;overflow:auto}',
      '.pc-dlg{background:#fff;border-radius:1rem;max-width:820px;width:100%;padding:1.15rem;box-shadow:0 20px 50px rgba(0,0,0,.3)}.dark .pc-dlg{background:#1e293b}.pc-dlg h3{margin:0 0 .8rem;font-size:1.1rem}',
      '.pc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.6rem}.pc-f.w{grid-column:1/-1}',
      '.pc-f label{display:block;font-size:.73rem;font-weight:600;color:#475569;margin-bottom:.2rem}.dark .pc-f label{color:#94a3b8}',
      '.pc-f input,.pc-f select,.pc-f textarea{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.86rem;background:#fff;color:inherit;font-family:inherit}',
      '.dark .pc-f input,.dark .pc-f select,.dark .pc-f textarea{background:#0f172a;border-color:#334155}',
      '.pc-isopick{display:flex;gap:.3rem;flex-wrap:wrap}.pc-isopick label{display:inline-flex;align-items:center;gap:.25rem;border:1px solid #cbd5e1;border-radius:.45rem;padding:.25rem .45rem;font-size:.78rem;cursor:pointer}',
      '.pc-isopick input{width:auto}.pc-types{display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.7rem}.pc-types button{border:1px solid #cbd5e1;border-radius:.5rem;padding:.4rem .7rem;font-weight:600;font-size:.82rem;background:#fff;cursor:pointer;color:inherit}',
      '.pc-types button.on{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.dark .pc-types button{background:#0f172a;border-color:#334155}',
      '.pc-acts{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.9rem}',
      '.pc-files{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.7rem}.pc-file{border:1px solid #e2e8f0;border-radius:.7rem;padding:.75rem;display:flex;flex-direction:column;gap:.35rem}.dark .pc-file{border-color:#334155}',
      '.pc-file b{font-size:.9rem}.pc-file .sub{font-size:.75rem;color:#64748b}',
      '.pc-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s;max-width:90vw}',
      '.pc-toast.in{opacity:1;transform:translate(-50%,0)}.pc-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function isoChips(v) { return el('span', {}, String(v || '').split(',').filter(Boolean).map(function (x) { return el('span', { class: 'pc-iso', style: '--c:' + (ISO_C[x] || '#64748b'), title: x + ' — ' + (ISO_T[x] || ''), text: x }); })); }

  // Columns shown for each type (beyond Sl no, code, brand, name).
  function typeCols(type) {
    var F = (st.data && st.data.fields) || {};
    if (!type) return [['type', 'Type'], ['specification', 'Specification']];
    return Object.keys(F[type] || {}).map(function (k) { return [k, F[type][k][0], F[type][k][1]]; });
  }
  function cell(it, c) {
    var k = c[0], kind = c[2], v = it[k];
    if (k === 'type') return el('span', { class: 'pc-type', text: (st.data.types[it.type] || it.type) });
    if (kind === 'iso') return isoChips(v);
    if (kind === 'bool') return v == null ? '—' : (v ? 'Yes' : 'No');
    if (kind === 'num') return v == null ? '—' : num(v);
    if (k === 'fitsInsert' && v) return el('b', { text: v });
    return v || '—';
  }

  function route() {
    var h = location.hash.replace(/^#\/?/, '').toUpperCase();
    st.tab = TABS.some(function (t) { return t[0] === h; }) ? h : '';
    drawTabs();
    clear(body);
    if (st.tab === 'FILES') files(); else list();
  }
  function drawTabs() {
    clear(tabsBox);
    var c = (st.data && st.data.counts) || {};
    TABS.forEach(function (t) {
      var n = t[0] === '' ? Object.keys(c).reduce(function (a, k) { return a + c[k]; }, 0) : c[t[0]];
      tabsBox.appendChild(el('button', { class: 'pc-tab' + (st.tab === t[0] ? ' on' : ''), type: 'button', 'data-tab': t[0] || 'ALL', onclick: function () { location.hash = '#/' + t[0].toLowerCase(); } },
        [t[1], n != null && t[0] !== 'FILES' ? el('small', { text: String(n) }) : null]));
    });
  }

  function list() {
    var canEdit = st.data ? st.data.canEdit : false;
    var q = el('input', { type: 'search', id: 'pc-q', placeholder: 'Search code, specification, grade, brand, serial no…', value: st.q });
    var brand = el('select', { id: 'pc-brand' }, [el('option', { value: '', text: 'All brands' })]);
    var iso = el('select', { id: 'pc-iso', title: 'Material group' }, [el('option', { value: '', text: 'Any material' })].concat(Object.keys(ISO_T).map(function (k) { return el('option', { value: k, text: k + ' — ' + ISO_T[k] }); })));
    iso.value = st.iso;
    var bar = el('div', { class: 'pc-bar' }, [q, brand, (!st.tab || ['INSERT', 'ENDMILL', 'DRILL', 'TAP'].indexOf(st.tab) !== -1) ? iso : null, el('span', { class: 'sp' })]);
    if (canEdit && st.tab && st.tab !== 'FILES') {
      var file = el('input', { type: 'file', accept: '.xlsx,.csv', style: 'display:none', id: 'pc-import-file' });
      file.onchange = function () {
        if (!file.files[0]) return;
        var fd = new FormData(); fd.append('file', file.files[0]); fd.append('type', st.tab);
        api('POST', '/catalog/import?type=' + st.tab, fd).then(function (j) { toast(j.message + (j.data.errors && j.data.errors.length ? ' — ' + j.data.errors[0] : '')); load(); }).catch(function (e) { toast(e.message, 'err'); });
        file.value = '';
      };
      bar.appendChild(el('button', { class: 'pc-btn', type: 'button', text: '⤓ ' + st.data.types[st.tab] + ' template', onclick: function () { getFile('/catalog/template?type=' + st.tab); } }));
      bar.appendChild(el('button', { class: 'pc-btn', type: 'button', id: 'pc-import', text: '⤒ Upload Excel', onclick: function () { file.click(); } }));
      bar.appendChild(file);
    }
    if (canEdit) bar.appendChild(el('button', { class: 'pc-btn pri', type: 'button', id: 'pc-add', text: '+ Add ' + (st.tab && st.data ? st.data.types[st.tab].toLowerCase() : 'product'), onclick: function () { editor(null); } }));
    var box = el('div', {});
    body.appendChild(el('div', { class: 'pc-card' }, [bar, box]));
    var t;
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { st.q = q.value.trim(); load(); }, 250); };
    brand.onchange = function () { st.brand = brand.value; load(); };
    iso.onchange = function () { st.iso = iso.value; load(); };
    function load() {
      clear(box).appendChild(el('div', { class: 'pc-empty', text: 'Loading…' }));
      api('GET', '/catalog?type=' + st.tab + (st.brand ? '&brand=' + encodeURIComponent(st.brand) : '') + (st.q ? '&q=' + encodeURIComponent(st.q) : '') + (st.iso ? '&iso=' + st.iso : '')).then(function (j) {
        st.data = j.data; drawTabs();
        if (brand.options.length <= 1) j.data.brands.forEach(function (b) { brand.appendChild(el('option', { value: b, text: b })); });
        brand.value = st.brand;
        draw(j.data.items);
      }).catch(function (e) { clear(box).appendChild(el('div', { class: 'pc-empty', text: e.message })); });
    }
    function draw(items) {
      clear(box);
      if (!items.length) { box.appendChild(el('div', { class: 'pc-empty', text: 'No products here yet.' + (canEdit ? ' Use “+ Add” or upload the Excel template.' : '') })); return; }
      var cols = typeCols(st.tab);
      var head = ['Sl no', 'Product code', 'Brand', 'Name / specification'].concat(cols.map(function (c) { return c[1]; })).concat(st.tab === 'INSERT' ? ['Fits cutters'] : []).concat(['Price', '']);
      var tb = el('tbody', {}, items.map(function (it) {
        return el('tr', { 'data-id': it.id }, [
          el('td', { class: 'pc-sl', text: it.serialNo != null ? String(it.serialNo) : '—' }),
          el('td', {}, [el('b', { text: it.itemCode })]),
          el('td', {}, [it.brand ? el('span', { class: 'pc-brand', text: it.brand }) : '—']),
          el('td', {}, [it.productName, it.specification && it.specification !== it.productName ? el('div', { class: 'sub', text: it.specification }) : null])
        ].concat(cols.map(function (c) { return el('td', { class: c[2] === 'num' ? 'n' : '' }, [cell(it, c)]); }))
         .concat(st.tab === 'INSERT' ? [el('td', { class: 'sub', text: (it.fitsCutters || []).join(', ') || '—' })] : [])
         .concat([el('td', { class: 'n', text: money(it.standardPrice) }),
          el('td', { style: 'white-space:nowrap' }, canEdit ? [
            el('button', { class: 'pc-btn sm', type: 'button', text: 'Edit', onclick: function () { editor(it); } }), ' ',
            el('button', { class: 'pc-btn sm red', type: 'button', text: '✕', title: 'Remove', onclick: function () {
              if (!confirm('Remove ' + it.itemCode + ' from the catalogue?')) return;
              api('DELETE', '/catalog/' + encodeURIComponent(it.id)).then(function () { toast('Removed'); load(); }).catch(function (e) { toast(e.message, 'err'); });
            } })] : [])]));
      }));
      box.appendChild(el('div', { class: 'pc-tw' }, [el('table', { class: 'pc-table', id: 'pc-table' }, [el('thead', {}, [el('tr', {}, head.map(function (h, i) { return el('th', { text: h }); }))]), tb])]));
      box.appendChild(el('div', { class: 'sub', style: 'margin-top:.5rem;font-size:.75rem;color:#64748b', text: items.length + ' product' + (items.length === 1 ? '' : 's') }));
    }
    window.__pcReload = load;
    load();
  }

  function editor(it) {
    var D = st.data, type = it ? it.type : (st.tab && st.tab !== 'FILES' ? st.tab : 'INSERT');
    var dlg = el('div', { class: 'pc-dlg', id: 'pc-dlg' }), modal = el('div', { class: 'pc-modal' }, [dlg]);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    var vals = it ? JSON.parse(JSON.stringify(it)) : { unit: 'Nos' };
    function draw() {
      clear(dlg);
      dlg.appendChild(el('h3', { text: (it ? 'Edit ' : 'Add ') + D.types[type].toLowerCase() + (it && it.serialNo ? ' · Sl no ' + it.serialNo : '') }));
      if (!it) dlg.appendChild(el('div', { class: 'pc-types' }, Object.keys(D.types).map(function (k) {
        return el('button', { type: 'button', class: k === type ? 'on' : '', 'data-type': k, text: D.types[k], onclick: function () { collect(); type = k; draw(); } });
      })));
      var g = el('div', { class: 'pc-grid' });
      function f(key, label, input, wide) { input.setAttribute('data-k', key); input.id = 'pc-f-' + key; g.appendChild(el('div', { class: 'pc-f' + (wide ? ' w' : '') }, [el('label', { text: label }), input])); return input; }
      f('itemCode', 'Product code *', el('input', { value: vals.itemCode || '', disabled: !!it }));
      var br = f('brand', 'Brand', el('input', { value: vals.brand || '', list: 'pc-brands', placeholder: 'e.g. YG-1, Taegutec, Kennametal' }));
      g.appendChild(el('datalist', { id: 'pc-brands' }, D.brands.map(function (b) { return el('option', { value: b }); })));
      f('specification', 'Specification / designation', el('input', { value: vals.specification || '', placeholder: type === 'INSERT' ? 'e.g. CNMG 120408-MF' : '' }));
      Object.keys(D.fields[type] || {}).forEach(function (k) {
        var lab = D.fields[type][k][0], kind = D.fields[type][k][1];
        if (kind === 'iso') {
          var pick = el('div', { class: 'pc-isopick', 'data-k': k, id: 'pc-f-' + k });
          var have = String(vals[k] || '').split(',');
          D.iso.forEach(function (x) { pick.appendChild(el('label', { title: ISO_T[x] }, [el('input', { type: 'checkbox', value: x, checked: have.indexOf(x) !== -1 }), el('span', { class: 'pc-iso', style: '--c:' + ISO_C[x], text: x }), ISO_T[x]])); });
          g.appendChild(el('div', { class: 'pc-f w' }, [el('label', { text: lab }), pick]));
        } else if (kind === 'bool') {
          var s = el('select', {}, [['', '—'], ['1', 'Yes'], ['0', 'No']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
          s.value = vals[k] == null ? '' : (vals[k] ? '1' : '0'); f(k, lab, s);
        } else {
          var inp = f(k, lab, el('input', { value: vals[k] == null ? '' : (kind === 'num' ? num(vals[k]) : vals[k]), type: kind === 'num' ? 'number' : 'text', step: 'any', min: '0',
            list: k === 'fitsInsert' ? 'pc-inserts' : null, placeholder: k === 'fitsInsert' ? 'Insert code(s), e.g. SNMX1206, APMT1135' : '' }));
          if (k === 'fitsInsert') {
            var dl = el('datalist', { id: 'pc-inserts' }); g.appendChild(dl);
            api('GET', '/catalog?type=INSERT').then(function (j) { j.data.items.forEach(function (x) { dl.appendChild(el('option', { value: x.itemCode, text: x.productName })); }); }).catch(function () {});
          }
        }
      });
      f('productName', 'Product name (optional — made from the details)', el('input', { value: it ? vals.productName || '' : '' }), true);
      f('standardPrice', 'Price (₹)', el('input', { type: 'number', step: 'any', min: '0', value: vals.standardPrice || '' }));
      f('unit', 'Unit', el('input', { value: vals.unit || 'Nos' }));
      f('hsnCode', 'HSN code', el('input', { value: vals.hsnCode || '' }));
      f('description', 'Description / notes', el('textarea', { rows: 2 }, [vals.description || '']), true);
      dlg.appendChild(g);
      var save = el('button', { class: 'pc-btn pri', type: 'button', id: 'pc-save', text: 'Save' });
      save.onclick = function () {
        collect(); vals.type = type; save.disabled = true;
        (it ? api('PUT', '/catalog/' + encodeURIComponent(it.id), vals) : api('POST', '/catalog', vals)).then(function (j) {
          toast(j.message + (j.data.item && j.data.item.serialNo ? ' · Sl no ' + j.data.item.serialNo : '')); modal.remove(); if (window.__pcReload) window.__pcReload();
        }).catch(function (e) { toast(e.message, 'err'); save.disabled = false; });
      };
      dlg.appendChild(el('div', { class: 'pc-acts' }, [el('button', { class: 'pc-btn', type: 'button', text: 'Cancel', onclick: function () { modal.remove(); } }), save]));
    }
    function collect() {
      dlg.querySelectorAll('[data-k]').forEach(function (n) {
        var k = n.getAttribute('data-k');
        if (n.classList.contains('pc-isopick')) vals[k] = Array.prototype.filter.call(n.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; }).join(',');
        else vals[k] = n.value;
      });
    }
    draw();
    document.body.appendChild(modal);
  }

  function files() {
    var box = el('div', {});
    var canEdit = st.data ? st.data.canEdit : false;
    var bar = el('div', { class: 'pc-bar' });
    if (canEdit) {
      var brand = el('input', { id: 'pc-cat-brand', placeholder: 'Brand', list: 'pc-cat-brands' });
      var type = el('select', { id: 'pc-cat-type' }, [el('option', { value: '', text: 'All types' })].concat(Object.keys((st.data && st.data.types) || {}).map(function (k) { return el('option', { value: k, text: st.data.types[k] }); })));
      var title = el('input', { id: 'pc-cat-title', placeholder: 'Title (optional) e.g. YG-1 Inserts 2026' });
      var file = el('input', { type: 'file', accept: 'application/pdf', id: 'pc-cat-file', style: 'display:none' });
      file.onchange = function () {
        if (!file.files[0]) return;
        var fd = new FormData(); fd.append('file', file.files[0]); fd.append('brand', brand.value.trim()); fd.append('type', type.value); fd.append('title', title.value.trim());
        api('POST', '/catalog/files', fd).then(function (j) { toast(j.message); title.value = ''; load(); }).catch(function (e) { toast(e.message, 'err'); });
        file.value = '';
      };
      bar.appendChild(el('datalist', { id: 'pc-cat-brands' }, ((st.data && st.data.brands) || []).map(function (b) { return el('option', { value: b }); })));
      [brand, type, title, file].forEach(function (n) { bar.appendChild(n); });
      bar.appendChild(el('button', { class: 'pc-btn pri', type: 'button', id: 'pc-cat-upload', text: '⤒ Upload catalogue PDF', onclick: function () { file.click(); } }));
    }
    body.appendChild(el('div', { class: 'pc-card' }, [el('h2', { style: 'font-size:1rem;font-weight:700;margin:0 0 .7rem', text: 'Brand catalogues' }), bar, box]));
    function load() {
      clear(box).appendChild(el('div', { class: 'pc-empty', text: 'Loading…' }));
      api('GET', '/catalog/files').then(function (j) {
        clear(box);
        if (!j.data.files.length) { box.appendChild(el('div', { class: 'pc-empty', text: 'No catalogues yet.' })); return; }
        box.appendChild(el('div', { class: 'pc-files', id: 'pc-files' }, j.data.files.map(function (f) {
          return el('div', { class: 'pc-file' }, [
            el('div', {}, [el('span', { style: 'font-size:1.4rem' }, ['📘']), ' ', f.brand ? el('span', { class: 'pc-brand', text: f.brand }) : null, f.catType ? el('span', { class: 'pc-type', style: 'margin-left:.3rem', text: st.data.types[f.catType] || f.catType }) : null]),
            el('b', { text: f.title }),
            el('span', { class: 'sub', text: f.fileName + ' · ' + Math.max(1, Math.round(f.size / 1024)) + ' KB' + (f.uploadedBy ? ' · ' + f.uploadedBy : '') }),
            el('div', { style: 'display:flex;gap:.35rem;margin-top:auto' }, [
              el('button', { class: 'pc-btn sm pri', type: 'button', text: 'Open', onclick: function () { getFile('/catalog/files/' + f.id, true, f.fileName); } }),
              el('button', { class: 'pc-btn sm', type: 'button', text: 'Download', onclick: function () { getFile('/catalog/files/' + f.id + '?download=1', false, f.fileName); } }),
              canEdit ? el('button', { class: 'pc-btn sm red', type: 'button', text: '✕', title: 'Remove', onclick: function () {
                if (!confirm('Remove “' + f.title + '”?')) return;
                api('DELETE', '/catalog/files/' + f.id).then(function () { toast('Removed'); load(); }).catch(function (e) { toast(e.message, 'err'); });
              } }) : null
            ])
          ]);
        })));
      }).catch(function (e) { clear(box).appendChild(el('div', { class: 'pc-empty', text: e.message })); });
    }
    load();
  }

  function mountPage(content) {
    injectCss();
    root = el('div', { class: 'pc-wrap' });
    root.appendChild(el('div', { class: 'pc-head' }, [el('div', {}, [el('h1', { text: 'Product catalogue' }),
      el('p', { text: 'Inserts, cutters, end mills, drills, taps and general items — by brand, with a serial no. for every product, and the brand catalogues as PDF.' })])]));
    tabsBox = el('div', { class: 'pc-tabs' }); body = el('div', {});
    root.appendChild(tabsBox); root.appendChild(body);
    content.appendChild(root);
    window.addEventListener('hashchange', route);
    // load the meta (types, fields, brands) once, then show the tab
    api('GET', '/catalog?type=NONE').then(function (j) { st.data = j.data; route(); }).catch(function (e) { body.appendChild(el('div', { class: 'pc-empty', text: e.message })); });
  }

  window.CataloguePage = { mountPage: mountPage };
})();
