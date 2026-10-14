/* ══════════════════════════════════════════════════════════════════════
   Catalogues & documents — brand catalogues (PDF), presentations (PPT),
   reports, price lists, datasheets… for several brands.
   Everyone can open / download; Admin / Super Admin upload, edit (title,
   brands, type, notes, replace the file) and delete.
   Same files as the "Catalogue PDFs" tab on the Product catalogue page.
   (Replaces the old Categories page.)

   Brand folders: every brand shows as a folder with a thumbnail (first page
   of its catalogue, made in the browser once and saved on the server); open
   a folder to see all the files for that brand. A catalogue can also be a
   shared link (brand website / Drive). "Copy link" gives a direct link to a
   brand folder (/documents/#brand=…) to share.
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
  var ICON = { link: ['LINK', '#7c3aed'], pdf: ['PDF', '#dc2626'], ppt: ['PPT', '#ea580c'], pptx: ['PPT', '#ea580c'], xls: ['XLS', '#16a34a'], xlsx: ['XLS', '#16a34a'], csv: ['CSV', '#16a34a'], doc: ['DOC', '#2563eb'], docx: ['DOC', '#2563eb'], png: ['IMG', '#0891b2'], jpg: ['IMG', '#0891b2'], jpeg: ['IMG', '#0891b2'], zip: ['ZIP', '#475569'] };
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
      '.dc-toast.in{opacity:1;transform:translate(-50%,0)}.dc-toast.err{background:#b91c1c}',
      '.dc-views{display:inline-flex;border:1px solid #cbd5e1;border-radius:.55rem;overflow:hidden}.dc-views button{border:0;background:#fff;padding:.4rem .8rem;font-size:.8rem;font-weight:600;cursor:pointer;color:#334155}.dc-views button.on{background:#1e3a8a;color:#fff}',
      '.dark .dc-views button{background:#0f172a;color:#e2e8f0}.dark .dc-views button.on{background:#2563eb}',
      '.dc-folders{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.8rem}',
      '.dc-folder{position:relative;border:1px solid #e2e8f0;border-radius:.8rem;background:#fff;cursor:pointer;text-align:left;padding:0;overflow:hidden;color:inherit;display:flex;flex-direction:column;transition:transform .15s,box-shadow .15s}',
      '.dc-folder:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(15,23,42,.12)}.dark .dc-folder{background:#0f172a;border-color:#334155}',
      '.dc-folder .tab{position:absolute;top:0;left:12px;width:56px;height:8px;border-radius:0 0 .4rem .4rem;background:#f59e0b}',
      '.dc-th{height:130px;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;overflow:hidden}.dc-th img{width:100%;height:100%;object-fit:cover;object-position:top}',
      '.dc-th .ini{font-size:2rem;font-weight:800;color:#92400e;letter-spacing:.02em}.dc-th.file{background:#f1f5f9}.dark .dc-th.file{background:#1e293b}',
      '.dc-fname{padding:.55rem .7rem .65rem}.dc-fname b{display:block;font-size:.92rem}.dc-fname span{font-size:.74rem;color:#64748b}',
      '.dc-crumb{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.8rem}.dc-crumb h2{margin:0;font-size:1.1rem}',
      '.dc-doc .dc-th{height:150px;margin:-.75rem -.75rem .2rem;border-radius:.75rem .75rem 0 0;cursor:pointer}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var S = { files: [], type: '', brand: '', q: '', brands: [], view: 'folders', folder: null };
  var grid, tabs, brandSel, viewBtns;
  var NO_BRAND = 'General (no brand)';

  // ── thumbnails: saved preview from the server, or made once in the browser ──
  var thumbCache = {}, thumbQueue = [], thumbBusy = false;
  function initials(b) { return String(b || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?'; }
  function loadLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (res, rej) {
      var sc = document.createElement('script'); sc.src = '/vendor/pdfjs/pdf.min.js';
      sc.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; } catch (e) {} res(window.pdfjsLib); };
      sc.onerror = rej; document.head.appendChild(sc);
    });
  }
  /** First page of a PDF / an image (Blob) → small JPEG Blob. */
  function makeThumb(blob, isPdf) {
    var W = 360;
    function out(c) { return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/jpeg', 0.82); }); }
    if (isPdf) return blob.arrayBuffer().then(function (buf) {
      return loadLib().then(function (pdfjs) { return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise; });
    }).then(function (doc) { return doc.getPage(1); }).then(function (pg) {
      var v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: W / v1.width });
      var c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      var cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      return pg.render({ canvasContext: cx, viewport: vp }).promise.then(function () { return out(c); });
    });
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { var k = Math.min(1, W / img.width), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); out(c).then(res); };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('bad image')); };
      img.src = u;
    });
  }
  function saveThumb(id, blob) { var x = new FormData(); x.append('thumb', blob, 'thumb.jpg'); return api('POST', '/catalog/files/' + id + '/thumb', x); }
  function canThumb(f) { return f.ext === 'pdf' || f.ext === 'png' || f.ext === 'jpg' || f.ext === 'jpeg'; }
  function authBlob(url) { return fetch(url, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); }); }
  /** Promise<object URL|null> of the file's preview picture. */
  function thumbUrl(f) {
    if (thumbCache[f.id] !== undefined) return Promise.resolve(thumbCache[f.id]);
    if (f.hasThumb) return authBlob(API + '/api/catalog/files/' + f.id + '/thumb').then(function (b) { return (thumbCache[f.id] = URL.createObjectURL(b)); }).catch(function () { return (thumbCache[f.id] = null); });
    if (!canThumb(f) || (f.size > 40 * 1048576)) return Promise.resolve(thumbCache[f.id] = null);
    // no preview yet: make one (one at a time) from the file and save it for everyone
    return new Promise(function (res) { thumbQueue.push([f, res]); pump(); });
  }
  function pump() {
    if (thumbBusy || !thumbQueue.length) return;
    thumbBusy = true;
    var job = thumbQueue.shift(), f = job[0];
    authBlob(API + '/api/catalog/files/' + f.id).then(function (b) { return makeThumb(b, f.ext === 'pdf'); }).then(function (tb) {
      thumbCache[f.id] = URL.createObjectURL(tb); f.hasThumb = true;
      saveThumb(f.id, tb).catch(function () {});
      job[1](thumbCache[f.id]);
    }).catch(function () { thumbCache[f.id] = null; job[1](null); }).then(function () { thumbBusy = false; pump(); });
  }
  function thumbBox(f, fallback, cls) {
    var box = el('div', { class: 'dc-th' + (cls ? ' ' + cls : '') }, [fallback]);
    if (f) thumbUrl(f).then(function (u) { if (u) { clear(box).appendChild(el('img', { src: u, alt: '', loading: 'lazy' })); } });
    return box;
  }
  function folderLink(b) { return location.origin + '/documents/#brand=' + encodeURIComponent(b); }
  function copy(text) {
    function ok() { toast('Link copied — paste it to share'); }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(ok, function () { prompt('Copy this link:', text); });
    prompt('Copy this link:', text);
  }

  function load() {
    clear(grid).appendChild(el('div', { class: 'dc-empty', text: 'Loading…' }));
    return api('GET', '/catalog/files').then(function (j) { S.files = j.data.files || []; draw(); }).catch(function (e) { clear(grid).appendChild(el('div', { class: 'dc-empty', text: e.message })); });
  }
  function open(f, download) {
    if (f.ext === 'link') { window.open(f.linkUrl, '_blank', 'noopener'); return; }
    if (!download && f.ext === 'pdf' && window.PdfView) { PdfView.show(API + '/api/catalog/files/' + f.id, { title: f.title, fileName: f.fileName }); return; }
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
    Array.prototype.forEach.call(viewBtns.children, function (b) { b.classList.toggle('on', b.getAttribute('data-view') === S.view); });
    brandSel.style.display = S.view === 'folders' ? 'none' : '';
    var folder = S.view === 'folders' ? S.folder : null;
    var list = S.files.filter(function (f) {
      return (!S.type || f.docType === S.type) && (S.view === 'folders' || !S.brand || f.brandList.indexOf(S.brand) !== -1) &&
        (!folder || (folder === NO_BRAND ? !f.brandList.length : f.brandList.indexOf(folder) !== -1)) &&
        (!q || (f.title + ' ' + f.fileName + ' ' + f.brandList.join(' ') + ' ' + (f.notes || '')).toLowerCase().indexOf(q) !== -1);
    });
    clear(grid);
    if (S.view === 'folders' && !folder) return drawFolders(list);
    if (folder) {
      grid.appendChild(el('div', { class: 'dc-crumb', style: 'grid-column:1/-1' }, [
        el('button', { class: 'dc-btn sm', type: 'button', id: 'dc-back', text: '← All brands', onclick: function () { S.folder = null; setHash(); draw(); } }),
        el('h2', { text: '📁 ' + folder }), el('span', { class: 'dc-sub', text: list.length + ' file' + (list.length === 1 ? '' : 's') }),
        folder !== NO_BRAND ? el('button', { class: 'dc-btn sm', type: 'button', id: 'dc-copy-folder', text: '🔗 Copy link', onclick: function () { copy(folderLink(folder)); } }) : null,
        canEdit ? el('button', { class: 'dc-btn sm pri', type: 'button', text: '+ Add to ' + folder, onclick: function () { dialog(null, folder === NO_BRAND ? '' : folder); } }) : null]));
    }
    if (!list.length) { grid.appendChild(el('div', { class: 'dc-empty', text: S.files.length ? 'Nothing matches.' : 'No documents yet' + (canEdit ? ' — press "+ Upload".' : '.') })); return; }
    list.forEach(function (f) {
      var ic = ICON[f.ext] || ['FILE', '#475569'];
      grid.appendChild(el('div', { class: 'dc-doc', 'data-doc': f.title }, [
        canThumb(f) || f.hasThumb ? (function () { var t = thumbBox(f, el('span', { class: 'dc-ic', style: '--c:' + ic[1], text: ic[0] }), 'file'); t.onclick = function () { open(f, false); }; t.title = 'Open'; return t; })() : null,
        el('div', { class: 'dc-top' }, [el('span', { class: 'dc-ic', style: '--c:' + ic[1], text: ic[0] }), el('div', { style: 'min-width:0' }, [el('b', { text: f.title }), el('div', { class: 'dc-sub', style: 'overflow:hidden;text-overflow:ellipsis', text: f.ext === 'link' ? '🔗 ' + f.linkUrl : f.fileName + ' · ' + size(f.size) })])]),
        el('div', { class: 'dc-chips' }, [el('span', { class: 'dc-chip dc-type', text: TYPES[f.docType] || f.docType })].concat(f.brandList.map(function (b) { return el('span', { class: 'dc-chip', text: b }); }))),
        f.notes ? el('div', { class: 'dc-sub', style: 'white-space:pre-wrap', text: f.notes }) : null,
        el('div', { class: 'dc-sub', text: 'Added by ' + (f.uploadedBy || '—') + ' · ' + when(f.updatedAt || f.createdAt) }),
        el('div', { class: 'dc-acts' }, [
          el('button', { class: 'dc-btn sm pri', type: 'button', text: f.ext === 'link' ? '↗ Open link' : 'Open', onclick: function () { open(f, false); } }),
          f.ext === 'link' ? el('button', { class: 'dc-btn sm', type: 'button', text: '🔗 Copy link', onclick: function () { copy(f.linkUrl); } })
            : el('button', { class: 'dc-btn sm', type: 'button', text: '⬇ Download', onclick: function () { open(f, true); } }),
          canEdit ? el('button', { class: 'dc-btn sm', type: 'button', 'data-edit': f.title, text: '✎ Edit', onclick: function () { dialog(f); } }) : null,
          canEdit ? el('button', { class: 'dc-btn sm red', type: 'button', 'data-del': f.title, text: '🗑 Delete', onclick: function () {
            if (!confirm('Delete "' + f.title + '"?')) return;
            api('DELETE', '/catalog/files/' + f.id).then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
          } }) : null
        ])
      ]));
    });
  }
  function setHash() { try { history.replaceState(null, '', S.folder && S.folder !== NO_BRAND ? '#brand=' + encodeURIComponent(S.folder) : location.pathname); } catch (e) {} }
  /** Brand folders: thumbnail (first catalogue page), brand name, how many files. */
  function drawFolders(list) {
    var by = {};
    list.forEach(function (f) { (f.brandList.length ? f.brandList : [NO_BRAND]).forEach(function (b) { (by[b] = by[b] || []).push(f); }); });
    var names = Object.keys(by).sort(function (a, b) { return a === NO_BRAND ? 1 : b === NO_BRAND ? -1 : a.localeCompare(b); });
    if (!names.length) { grid.appendChild(el('div', { class: 'dc-empty', text: S.files.length ? 'Nothing matches.' : 'No catalogues yet' + (canEdit ? ' — press "+ Upload" or "+ Add link".' : '.') })); return; }
    var wrapF = el('div', { class: 'dc-folders', id: 'dc-folders', style: 'grid-column:1/-1' });
    names.forEach(function (b) {
      var fs = by[b];
      var cover = fs.filter(function (f) { return f.hasThumb; }).sort(function (x, y) { return (y.docType === 'CATALOGUE') - (x.docType === 'CATALOGUE'); })[0]
        || fs.filter(function (f) { return canThumb(f); }).sort(function (x, y) { return (y.docType === 'CATALOGUE') - (x.docType === 'CATALOGUE'); })[0];
      var links = fs.filter(function (f) { return f.ext === 'link'; }).length;
      wrapF.appendChild(el('button', { type: 'button', class: 'dc-folder', 'data-folder': b, title: 'Open ' + b, onclick: function () { S.folder = b; setHash(); draw(); } }, [
        el('span', { class: 'tab' }),
        thumbBox(cover, el('span', { class: 'ini', text: b === NO_BRAND ? '📁' : initials(b) })),
        el('div', { class: 'dc-fname' }, [el('b', { text: '📁 ' + b }), el('span', { text: fs.length + ' file' + (fs.length === 1 ? '' : 's') + (links ? ' · ' + links + ' link' + (links === 1 ? '' : 's') : '') })])
      ]));
    });
    grid.appendChild(wrapF);
  }
  /** Upload (f = null, several files allowed) or edit (f = the document; a new file replaces it). */
  function dialog(f, presetBrand, asLink) {
    document.querySelectorAll('.dc-modal').forEach(function (m) { m.remove(); });
    var dlg = el('div', { class: 'dc-dlg' }), m = el('div', { class: 'dc-modal' }, [dlg]);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    var file = el('input', { type: 'file', id: 'dc-file', accept: ACCEPT, multiple: f ? null : true });
    var title = el('input', { id: 'dc-title', value: f ? f.title : '', placeholder: 'e.g. Taegutec Turning 2026 (blank = file name)' });
    var dl = el('datalist', { id: 'dc-brand-list' }, S.brands.map(function (b) { return el('option', { value: b }); }));
    var isLink = f ? f.ext === 'link' : !!asLink;
    var link = el('input', { id: 'dc-link', type: 'url', value: f && f.linkUrl ? f.linkUrl : '', placeholder: 'https://… (brand catalogue page, Google Drive / Dropbox link…)' });
    var brands = el('input', { id: 'dc-brands', list: 'dc-brand-list', value: f ? f.brandList.join(', ') : (presetBrand || ''), placeholder: 'One or more, comma separated — e.g. Taegutec, YG-1' });
    var type = el('select', { id: 'dc-type' }, Object.keys(TYPES).map(function (k) { return el('option', { value: k, text: TYPES[k] }); }));
    type.value = f ? f.docType : 'CATALOGUE';
    var notes = el('textarea', { id: 'dc-notes', rows: 3, placeholder: 'What is inside, valid till, pages to look at…' }); notes.value = f ? f.notes || '' : '';
    var err = el('div', { class: 'dc-err' });
    file.onchange = function () { if (!f && file.files.length === 1 && !title.value) title.value = file.files[0].name.replace(/\.[^.]+$/, ''); if (!f && file.files.length && /\.pptx?$/i.test(file.files[0].name)) type.value = 'PRESENTATION'; };
    function fld(l, i) { return el('div', { class: 'dc-f' }, [el('label', { text: l }), i]); }
    dlg.appendChild(el('h3', { text: f ? 'Edit · ' + f.title : isLink ? 'Add a catalogue link' : 'Upload catalogues & documents' }));
    if (isLink) dlg.appendChild(fld('Catalogue link', link));
    else dlg.appendChild(fld(f ? 'Replace the file (optional)' : 'File(s) — PDF, PPT, Excel, Word, images, ZIP · up to 60 MB', file));
    dlg.appendChild(fld('Title' + (f || isLink ? '' : ' (for a single file)'), title));
    dlg.appendChild(fld('Brands', el('div', {}, [brands, dl])));
    dlg.appendChild(fld('Type', type));
    dlg.appendChild(fld('Notes', notes));
    dlg.appendChild(err);
    var save = el('button', { class: 'dc-btn pri', type: 'button', id: 'dc-save', text: f ? 'Save changes' : 'Upload' });
    save.onclick = function () {
      var list = Array.prototype.slice.call(file.files);
      if (isLink && !link.value.trim()) { err.textContent = 'Paste the catalogue link.'; return; }
      if (isLink && !brands.value.trim()) { err.textContent = 'Enter the brand — the link shows in that brand\u2019s folder.'; return; }
      if (!isLink && !f && !list.length) { err.textContent = 'Choose the file(s).'; return; }
      save.disabled = true; err.textContent = '';
      function fd(one, i) {
        var x = new FormData();
        if (one) x.append('file', one);
        x.append('title', list.length > 1 ? '' : title.value.trim()); x.append('brands', brands.value); x.append('docType', type.value); x.append('notes', notes.value);
        if (isLink) x.append('linkUrl', link.value.trim());
        return x;
      }
      // a preview for each new PDF / image, made from the local file (fast) and saved with it
      function withThumb(one, j) {
        var id = j && j.data && j.data.id;
        if (!id || !one || !/\.(pdf|png|jpe?g)$/i.test(one.name) || one.size > 40 * 1048576) return j;
        return makeThumb(one, /\.pdf$/i.test(one.name)).then(function (tb) { delete thumbCache[id]; return saveThumb(id, tb); }).catch(function () {}).then(function () { return j; });
      }
      var p = f ? api('POST', '/catalog/files/' + f.id, (function () { var x = fd(list[0]); if (!title.value.trim()) x.set('title', f.title); return x; })()).then(function (j) { if (list[0]) { delete thumbCache[f.id]; return withThumb(list[0], { data: { id: f.id } }); } return j; })
        : isLink ? api('POST', '/catalog/files', fd(null))
        : list.reduce(function (pr, one) { return pr.then(function () { return api('POST', '/catalog/files', fd(one)).then(function (j) { return withThumb(one, j); }); }); }, Promise.resolve());
      p.then(function () { toast(f ? 'Saved' : isLink ? 'Catalogue link added' : list.length + ' file(s) uploaded'); m.remove(); load(); })
        .catch(function (e) { err.textContent = e.message; save.disabled = false; });
    };
    dlg.appendChild(el('div', { class: 'dc-foot' }, [el('button', { class: 'dc-btn', type: 'button', text: 'Cancel', onclick: function () { m.remove(); } }), save]));
  }

  function mountPage(content) {
    css();
    var wrap = el('div', { class: 'dc-wrap' });
    wrap.appendChild(el('div', { class: 'dc-head' }, [el('div', {}, [el('h1', { text: 'Catalogues & documents' }), el('p', { text: 'Brand catalogues, presentations, reports and price lists for every brand — open, download, and (admins) upload, edit or delete.' })]),
      canEdit ? el('div', { style: 'display:flex;gap:.4rem' }, [
        el('button', { class: 'dc-btn', type: 'button', id: 'dc-add-link', text: '🔗 + Add link', onclick: function () { dialog(null, S.folder && S.folder !== NO_BRAND ? S.folder : '', true); } }),
        el('button', { class: 'dc-btn pri', type: 'button', id: 'dc-upload', text: '+ Upload', onclick: function () { dialog(null, S.folder && S.folder !== NO_BRAND ? S.folder : ''); } })]) : null]));
    tabs = el('div', { class: 'dc-tabs', id: 'dc-tabs' });
    brandSel = el('select', { id: 'dc-brand' }); brandSel.onchange = function () { S.brand = brandSel.value; draw(); };
    var q = el('input', { type: 'search', id: 'dc-search', placeholder: 'Search title, brand, notes…' });
    q.oninput = function () { S.q = q.value.trim(); draw(); };
    grid = el('div', { class: 'dc-grid', id: 'dc-grid' });
    viewBtns = el('div', { class: 'dc-views', id: 'dc-views' }, [['folders', '📁 Brand folders'], ['all', '☰ All files']].map(function (v) {
      return el('button', { type: 'button', 'data-view': v[0], text: v[1], onclick: function () { S.view = v[0]; if (v[0] === 'all') S.folder = null; setHash(); draw(); } });
    }));
    var hb = /^#brand=(.+)$/.exec(location.hash);
    if (hb) { try { S.folder = decodeURIComponent(hb[1]); } catch (e) {} }
    wrap.appendChild(el('div', { class: 'dc-card' }, [tabs, el('div', { class: 'dc-bar' }, [viewBtns, brandSel, q]), grid]));
    content.appendChild(wrap);
    api('GET', '/options?list=brand').then(function (j) { S.brands = (j.data.options || []).map(function (o) { return o.value; }); }).catch(function () {});
    load();
  }
  window.DocumentsPage = { mountPage: mountPage };
})();
