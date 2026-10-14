/* ══════════════════════════════════════════════════════════════════════
   Catalogues & documents — brand catalogues (PDF), presentations (PPT),
   reports, price lists, datasheets… for several brands.
   Everyone can open / download; Admin / Super Admin upload, edit (title,
   brands, type, notes, replace the file) and delete.
   Same files as the "Catalogue PDFs" tab on the Product catalogue page.
   (Replaces the old Categories page.)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
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
  function toast(msg, kind) {
    document.querySelectorAll('.dc-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'dc-toast' + (kind === 'err' ? ' err' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4500);
  }
  function size(n) { n = +n || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function when(s) { var d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  var ICON = { pdf: ['PDF', '#dc2626'], ppt: ['PPT', '#ea580c'], pptx: ['PPT', '#ea580c'], xls: ['XLS', '#16a34a'], xlsx: ['XLS', '#16a34a'], csv: ['CSV', '#16a34a'], doc: ['DOC', '#2563eb'], docx: ['DOC', '#2563eb'], png: ['IMG', '#0891b2'], jpg: ['IMG', '#0891b2'], jpeg: ['IMG', '#0891b2'], zip: ['ZIP', '#475569'] };
  var TYPES = { CATALOGUE: 'Catalogue', PRESENTATION: 'Presentation (PPT)', REPORT: 'Report', PRICE_LIST: 'Price list', DATASHEET: 'Datasheet', OTHER: 'Other' };
  var ACCEPT = '.pdf,.ppt,.pptx,.xls,.xlsx,.csv,.doc,.docx,.png,.jpg,.jpeg,.zip';
  var canEdit = ['SUPER_ADMIN', 'ADMIN'].indexOf(me().role) !== -1;

  function css() {
    if (document.getElementById('dc-css')) return;
    var st = document.createElement('style'); st.id = 'dc-css';
    st.textContent = [
      '.dc-wrap{max-width:1300px;margin:0 auto}',
      '.dc-head{display:flex;flex-wrap:wrap;gap:.7rem;align-items:flex-end;justify-content:space-between;margin-bottom:1rem}.dc-head h1{font-size:1.35rem;font-weight:700;margin:0}.dc-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.dc-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem}.dark .dc-card{background:#1e293b;border-color:#334155}',
      '.dc-tabs{display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.7rem}.dc-tab{border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:.3rem .8rem;font-size:.8rem;font-weight:600;cursor:pointer;color:#334155}.dc-tab.on{background:#1e3a8a;border-color:#1e3a8a;color:#fff}',
      '.dark .dc-tab{background:#0f172a;border-color:#334155;color:#e2e8f0}',
      '.dc-bar{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.8rem}.dc-bar input,.dc-bar select{border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.86rem;background:#fff;color:inherit}.dc-bar input{flex:1;min-width:200px}',
      '.dc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:.7rem}',
      '.dc-doc{border:1px solid #e2e8f0;border-radius:.75rem;padding:.75rem;display:flex;flex-direction:column;gap:.4rem;background:#fff}.dark .dc-doc{background:#0f172a;border-color:#334155}',
      '.dc-top{display:flex;gap:.6rem;align-items:flex-start}.dc-ic{width:2.6rem;height:2.6rem;border-radius:.55rem;color:#fff;font-weight:800;font-size:.72rem;display:flex;align-items:center;justify-content:center;flex:none;background:var(--c)}',
      '.dc-doc b{font-size:.92rem;line-height:1.3}.dc-sub{font-size:.75rem;color:#64748b}.dc-chips{display:flex;flex-wrap:wrap;gap:.25rem}',
      '.dc-chip{font-size:.7rem;font-weight:600;padding:.05rem .45rem;border-radius:999px;background:#eff6ff;color:#1e3a8a}.dc-type{background:#f1f5f9;color:#334155}.dark .dc-chip{background:#1e3a8a55;color:#dbeafe}',
      '.dc-acts{display:flex;gap:.3rem;flex-wrap:wrap;margin-top:auto}',
      '.dc-btn{display:inline-flex;align-items:center;gap:.3rem;border-radius:.5rem;padding:.4rem .8rem;font-size:.8rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}',
      '.dc-btn.sm{padding:.22rem .55rem;font-size:.74rem}.dc-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.dc-btn.red{color:#b91c1c;border-color:#fecaca}.dark .dc-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}',
      '.dc-empty{padding:2rem 1rem;text-align:center;color:#64748b}',
      '.dc-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:6vh 1rem;overflow:auto}',
      '.dc-dlg{background:#fff;border-radius:1rem;max-width:560px;width:100%;padding:1.2rem}.dark .dc-dlg{background:#1e293b}.dc-dlg h3{margin:0 0 .8rem}',
      '.dc-f{margin-bottom:.55rem}.dc-f label{display:block;font-size:.73rem;font-weight:600;color:#475569;margin-bottom:.2rem}.dc-f input,.dc-f select,.dc-f textarea{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.88rem;background:#fff;color:inherit;font-family:inherit}',
      '.dark .dc-f input,.dark .dc-f select,.dark .dc-f textarea{background:#0f172a;border-color:#334155}.dc-err{color:#b91c1c;font-size:.82rem;min-height:1rem}',
      '.dc-foot{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.6rem}',
      '.dc-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s}',
      '.dc-toast.in{opacity:1;transform:translate(-50%,0)}.dc-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var S = { files: [], type: '', brand: '', q: '', brands: [] };
  var grid, tabs, brandSel;

  function load() {
    clear(grid).appendChild(el('div', { class: 'dc-empty', text: 'Loading…' }));
    return api('GET', '/catalog/files').then(function (j) { S.files = j.data.files || []; draw(); }).catch(function (e) { clear(grid).appendChild(el('div', { class: 'dc-empty', text: e.message })); });
  }
  function open(f, download) {
    fetch(API + '/api/catalog/files/' + f.id + (download ? '?download=1' : ''), { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) throw new Error('Could not open the file');
      return r.blob().then(function (b) {
        var u = URL.createObjectURL(b);
        if (!download && /^(application\/pdf|image\/)/.test(b.type)) { window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); return; }
        var a = el('a', { href: u, download: f.fileName }); document.body.appendChild(a); a.click(); a.remove();
      });
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function draw() {
    var counts = {}; S.files.forEach(function (f) { counts[f.docType] = (counts[f.docType] || 0) + 1; });
    clear(tabs);
    [['', 'All', S.files.length]].concat(Object.keys(TYPES).map(function (k) { return [k, TYPES[k], counts[k] || 0]; })).forEach(function (t) {
      if (t[0] && !t[2]) return;
      tabs.appendChild(el('button', { type: 'button', class: 'dc-tab' + (S.type === t[0] ? ' on' : ''), 'data-dtype': t[0] || 'ALL', text: t[1] + ' (' + t[2] + ')', onclick: function () { S.type = t[0]; draw(); } }));
    });
    var all = {}; S.files.forEach(function (f) { f.brandList.forEach(function (b) { all[b] = 1; }); });
    var cur = brandSel.value; clear(brandSel).appendChild(el('option', { value: '', text: 'All brands' }));
    Object.keys(all).sort().forEach(function (b) { brandSel.appendChild(el('option', { value: b, text: b })); });
    brandSel.value = all[cur] ? cur : ''; S.brand = brandSel.value;
    var q = S.q.toLowerCase();
    var list = S.files.filter(function (f) {
      return (!S.type || f.docType === S.type) && (!S.brand || f.brandList.indexOf(S.brand) !== -1) &&
        (!q || (f.title + ' ' + f.fileName + ' ' + f.brandList.join(' ') + ' ' + (f.notes || '')).toLowerCase().indexOf(q) !== -1);
    });
    clear(grid);
    if (!list.length) { grid.appendChild(el('div', { class: 'dc-empty', text: S.files.length ? 'Nothing matches.' : 'No documents yet' + (canEdit ? ' — press "+ Upload".' : '.') })); return; }
    list.forEach(function (f) {
      var ic = ICON[f.ext] || ['FILE', '#475569'];
      grid.appendChild(el('div', { class: 'dc-doc', 'data-doc': f.title }, [
        el('div', { class: 'dc-top' }, [el('span', { class: 'dc-ic', style: '--c:' + ic[1], text: ic[0] }), el('div', {}, [el('b', { text: f.title }), el('div', { class: 'dc-sub', text: f.fileName + ' · ' + size(f.size) })])]),
        el('div', { class: 'dc-chips' }, [el('span', { class: 'dc-chip dc-type', text: TYPES[f.docType] || f.docType })].concat(f.brandList.map(function (b) { return el('span', { class: 'dc-chip', text: b }); }))),
        f.notes ? el('div', { class: 'dc-sub', style: 'white-space:pre-wrap', text: f.notes }) : null,
        el('div', { class: 'dc-sub', text: 'Added by ' + (f.uploadedBy || '—') + ' · ' + when(f.updatedAt || f.createdAt) }),
        el('div', { class: 'dc-acts' }, [
          el('button', { class: 'dc-btn sm pri', type: 'button', text: 'Open', onclick: function () { open(f, false); } }),
          el('button', { class: 'dc-btn sm', type: 'button', text: '⬇ Download', onclick: function () { open(f, true); } }),
          canEdit ? el('button', { class: 'dc-btn sm', type: 'button', 'data-edit': f.title, text: '✎ Edit', onclick: function () { dialog(f); } }) : null,
          canEdit ? el('button', { class: 'dc-btn sm red', type: 'button', 'data-del': f.title, text: '🗑 Delete', onclick: function () {
            if (!confirm('Delete "' + f.title + '"?')) return;
            api('DELETE', '/catalog/files/' + f.id).then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
          } }) : null
        ])
      ]));
    });
  }
  /** Upload (f = null, several files allowed) or edit (f = the document; a new file replaces it). */
  function dialog(f) {
    document.querySelectorAll('.dc-modal').forEach(function (m) { m.remove(); });
    var dlg = el('div', { class: 'dc-dlg' }), m = el('div', { class: 'dc-modal' }, [dlg]);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    var file = el('input', { type: 'file', id: 'dc-file', accept: ACCEPT, multiple: f ? null : true });
    var title = el('input', { id: 'dc-title', value: f ? f.title : '', placeholder: 'e.g. Taegutec Turning 2026 (blank = file name)' });
    var dl = el('datalist', { id: 'dc-brand-list' }, S.brands.map(function (b) { return el('option', { value: b }); }));
    var brands = el('input', { id: 'dc-brands', list: 'dc-brand-list', value: f ? f.brandList.join(', ') : '', placeholder: 'One or more, comma separated — e.g. Taegutec, YG-1' });
    var type = el('select', { id: 'dc-type' }, Object.keys(TYPES).map(function (k) { return el('option', { value: k, text: TYPES[k] }); }));
    type.value = f ? f.docType : 'CATALOGUE';
    var notes = el('textarea', { id: 'dc-notes', rows: 3, placeholder: 'What is inside, valid till, pages to look at…' }); notes.value = f ? f.notes || '' : '';
    var err = el('div', { class: 'dc-err' });
    file.onchange = function () { if (!f && file.files.length === 1 && !title.value) title.value = file.files[0].name.replace(/\.[^.]+$/, ''); if (!f && file.files.length && /\.pptx?$/i.test(file.files[0].name)) type.value = 'PRESENTATION'; };
    function fld(l, i) { return el('div', { class: 'dc-f' }, [el('label', { text: l }), i]); }
    dlg.appendChild(el('h3', { text: f ? 'Edit · ' + f.title : 'Upload catalogues & documents' }));
    dlg.appendChild(fld(f ? 'Replace the file (optional)' : 'File(s) — PDF, PPT, Excel, Word, images, ZIP · up to 60 MB', file));
    dlg.appendChild(fld('Title' + (f ? '' : ' (for a single file)'), title));
    dlg.appendChild(fld('Brands', el('div', {}, [brands, dl])));
    dlg.appendChild(fld('Type', type));
    dlg.appendChild(fld('Notes', notes));
    dlg.appendChild(err);
    var save = el('button', { class: 'dc-btn pri', type: 'button', id: 'dc-save', text: f ? 'Save changes' : 'Upload' });
    save.onclick = function () {
      var list = Array.prototype.slice.call(file.files);
      if (!f && !list.length) { err.textContent = 'Choose the file(s).'; return; }
      save.disabled = true; err.textContent = '';
      function fd(one, i) {
        var x = new FormData();
        if (one) x.append('file', one);
        x.append('title', list.length > 1 ? '' : title.value.trim()); x.append('brands', brands.value); x.append('docType', type.value); x.append('notes', notes.value);
        return x;
      }
      var p = f ? api('POST', '/catalog/files/' + f.id, (function () { var x = fd(list[0]); if (!title.value.trim()) x.set('title', f.title); return x; })())
        : list.reduce(function (pr, one) { return pr.then(function () { return api('POST', '/catalog/files', fd(one)); }); }, Promise.resolve());
      p.then(function () { toast(f ? 'Saved' : list.length + ' file(s) uploaded'); m.remove(); load(); })
        .catch(function (e) { err.textContent = e.message; save.disabled = false; });
    };
    dlg.appendChild(el('div', { class: 'dc-foot' }, [el('button', { class: 'dc-btn', type: 'button', text: 'Cancel', onclick: function () { m.remove(); } }), save]));
  }

  function mountPage(content) {
    css();
    var wrap = el('div', { class: 'dc-wrap' });
    wrap.appendChild(el('div', { class: 'dc-head' }, [el('div', {}, [el('h1', { text: 'Catalogues & documents' }), el('p', { text: 'Brand catalogues, presentations, reports and price lists for every brand — open, download, and (admins) upload, edit or delete.' })]),
      canEdit ? el('button', { class: 'dc-btn pri', type: 'button', id: 'dc-upload', text: '+ Upload', onclick: function () { dialog(null); } }) : null]));
    tabs = el('div', { class: 'dc-tabs', id: 'dc-tabs' });
    brandSel = el('select', { id: 'dc-brand' }); brandSel.onchange = function () { S.brand = brandSel.value; draw(); };
    var q = el('input', { type: 'search', id: 'dc-search', placeholder: 'Search title, brand, notes…' });
    q.oninput = function () { S.q = q.value.trim(); draw(); };
    grid = el('div', { class: 'dc-grid', id: 'dc-grid' });
    wrap.appendChild(el('div', { class: 'dc-card' }, [tabs, el('div', { class: 'dc-bar' }, [brandSel, q]), grid]));
    content.appendChild(wrap);
    api('GET', '/options?list=brand').then(function (j) { S.brands = (j.data.options || []).map(function (o) { return o.value; }); }).catch(function () {});
    load();
  }
  window.DocumentsPage = { mountPage: mountPage };
})();
