/* ══════════════════════════════════════════════════════════════════════
   Vendors & stock inward (Manager / Admin / Super Admin).

   Vendors tab   — add / edit / delete vendors (each can have several
                   brands). Per vendor: product list with the vendor's price,
                   discount, net price and stock (add by hand or upload their
                   Excel price list / stock list), catalogues and files, and
                   the inwards received from them. Uploaded products also go
                   to the Products page.
   Inward tab    — goods received from a supplier: invoice, lines, and the
                   place the stock goes to (hand / local city / state). Saving
                   adds the quantities to stock; deleting takes them back out.
   Compare tab   — one item code across all vendors, cheapest first.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  var isAdmin = ['SUPER_ADMIN', 'ADMIN'].indexOf(me().role) !== -1;
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
  function checkFile(b, name) {
    var sig = /\.(xlsx|zip)$/i.test(name || '') ? [80, 75, 3, 4] : /\.pdf$/i.test(name || '') ? [37, 80, 68, 70] : null;
    if (!sig || !b || !b.arrayBuffer) return Promise.resolve(b);
    return b.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), lim = Math.min(u.length - 4, 1 << 20);
      for (var i = 0; i <= lim; i++) {
        if (u[i] === sig[0] && u[i + 1] === sig[1] && u[i + 2] === sig[2] && u[i + 3] === sig[3]) return i === 0 ? b : new Blob([u.subarray(i)], { type: b.type });
      }
      var t = new TextDecoder().decode(u.subarray(0, 4000)), m = '';
      try { m = JSON.parse(t).message || ''; } catch (e) { m = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
      throw new Error('The server sent an error instead of the file' + (m ? ': ' + m : '.'));
    });
  }
  function download(path, name, open) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Download failed'); });
      var cd = r.headers.get('Content-Disposition') || '', m = /filename="?([^";]+)"?/.exec(cd);
      name = name || (m ? m[1] : 'download');
      return r.blob().then(function (b) { return checkFile(b, name); }).then(function (b) {
        var u = URL.createObjectURL(b);
        if (open) { window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); return; }
        var a = document.createElement('a'); a.href = u; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
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
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function num(v, d) { if (v == null || v === '') return '—'; return Number(v).toLocaleString('en-IN', { maximumFractionDigits: d == null ? 2 : d }); }
  function money(v) { return v == null || v === '' ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function today() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function kb(n) { n = +n || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function toast(msg, kind) {
    document.querySelectorAll('.vd-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'vd-toast ' + (kind || 'ok'), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }
  function field(label, input, cls) { return el('div', { class: 'vd-f' + (cls ? ' ' + cls : '') }, [el('label', { text: label }), input]); }
  function inp(id, ph, val, type) { return el('input', { id: id, placeholder: ph || '', value: val == null ? '' : val, type: type || 'text' }); }

  function injectCss() {
    if (document.getElementById('vd-css')) return;
    var st = document.createElement('style'); st.id = 'vd-css';
    st.textContent = [
      '.vd-wrap{max-width:1300px;margin:0 auto}',
      '.vd-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem;margin-bottom:.75rem}',
      '.vd-head h1{font-size:1.35rem;font-weight:700;margin:0}.vd-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.vd-btn{display:inline-flex;align-items:center;gap:.35rem;border-radius:.55rem;padding:.45rem .85rem;font-size:.84rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.vd-btn:hover{background:#f1f5f9}.vd-btn:disabled{opacity:.55;cursor:default}.vd-btn.sm{padding:.25rem .55rem;font-size:.76rem}',
      '.vd-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.vd-btn.pri:hover{background:#1e40af}.vd-btn.grn{background:#0f766e;border-color:#0f766e;color:#fff}',
      '.vd-btn.red{color:#b91c1c;border-color:#fecaca}.vd-btn.red:hover{background:#fef2f2}',
      '.dark .vd-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .vd-btn.pri{background:#2563eb}.dark .vd-btn.grn{background:#0d9488}',
      '.vd-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;margin-bottom:1rem;overflow-x:auto}.dark .vd-tabs{border-color:#334155}',
      '.vd-tab{padding:.55rem 1rem;font-size:.9rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.vd-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .vd-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.vd-cols{display:grid;grid-template-columns:300px minmax(0,1fr);gap:1rem;align-items:start}@media (max-width:900px){.vd-cols{grid-template-columns:1fr}}',
      '.vd-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .vd-card{background:#1e293b;border-color:#334155}',
      '.vd-card h2{font-size:1rem;font-weight:700;margin:0 0 .6rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap}',
      '.vd-list{display:flex;flex-direction:column;gap:.35rem;max-height:70vh;overflow:auto}',
      '.vd-li{display:block;width:100%;text-align:left;border:1px solid #e2e8f0;border-radius:.6rem;background:#fff;padding:.55rem .7rem;cursor:pointer;color:inherit}',
      '.vd-li:hover{background:#f8fafc}.vd-li.on{border-color:#1e3a8a;background:#eff6ff}.dark .vd-li{background:#0f172a;border-color:#334155}.dark .vd-li.on{background:#1e3a8a33}',
      '.vd-li b{display:block;font-size:.9rem}.vd-li span{font-size:.75rem;color:#64748b}',
      '.vd-chip{display:inline-block;padding:.05rem .45rem;border-radius:.4rem;font-size:.72rem;font-weight:600;background:#eef2ff;color:#3730a3;margin:.1rem .2rem .1rem 0}',
      '.vd-chip.k{background:#ecfeff;color:#0e7490}.vd-chip.s{background:#f0fdf4;color:#166534}.vd-chip.z{background:#fef2f2;color:#991b1b}',
      '.vd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.6rem;align-items:end}',
      '.vd-f label{display:block;font-size:.73rem;font-weight:600;color:#475569;margin-bottom:.2rem}.dark .vd-f label{color:#94a3b8}',
      '.vd-f input,.vd-f select,.vd-f textarea,.vd-bar input:not([type=checkbox]),.vd-bar select{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.42rem .6rem;font-size:.86rem;background:#fff;color:inherit}',
      '.dark .vd-f input,.dark .vd-f select,.dark .vd-f textarea,.dark .vd-bar input,.dark .vd-bar select{background:#0f172a;border-color:#334155}',
      '.vd-f.wide{grid-column:1/-1}.vd-f textarea{min-height:56px}',
      '.vd-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.6rem}.vd-bar input:not([type=checkbox]),.vd-bar select{width:auto;min-width:140px}.vd-bar input.full{width:100%}',
      '.vd-table{width:100%;border-collapse:collapse;font-size:.83rem}.vd-tw{overflow-x:auto}',
      '.vd-table th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.45rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.vd-table td{padding:.45rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.dark .vd-table th,.dark .vd-table td{border-color:#334155}',
      '.vd-table td.n,.vd-table th.n{text-align:right;white-space:nowrap}.vd-table .sub{color:#64748b;font-size:.74rem}',
      '.vd-table input{width:100%;min-width:70px;border:1px solid #cbd5e1;border-radius:.4rem;padding:.3rem .45rem;font-size:.82rem;background:#fff;color:inherit}.dark .vd-table input{background:#0f172a;border-color:#334155}',
      '.vd-empty{padding:1.5rem;text-align:center;color:#64748b;font-size:.88rem}',
      '.vd-meta{display:flex;flex-wrap:wrap;gap:1rem;font-size:.84rem;color:#475569;margin:.25rem 0 .5rem}.dark .vd-meta{color:#94a3b8}',
      '.vd-drop{border:2px dashed #cbd5e1;border-radius:.7rem;padding:.75rem;display:flex;flex-wrap:wrap;gap:.6rem;align-items:end}',
      '.vd-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:4vh 1rem;overflow:auto}',
      '.vd-dlg{background:#fff;border-radius:1rem;max-width:1000px;width:100%;padding:1.1rem;box-shadow:0 20px 50px rgba(0,0,0,.3)}.dark .vd-dlg{background:#1e293b}',
      '.vd-dlg h3{margin:0 0 .8rem;font-size:1.1rem}.vd-acts{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.9rem}',
      '.vd-sugg{position:absolute;z-index:2147483500;background:#fff;border:1px solid #cbd5e1;border-radius:.5rem;box-shadow:0 10px 28px rgba(0,0,0,.18);max-height:260px;overflow:auto;min-width:340px;font-size:.82rem}',
      '.vd-sugg button{display:block;width:100%;text-align:left;border:0;background:none;padding:.4rem .6rem;cursor:pointer;color:#0f172a}.vd-sugg button:hover{background:#eff6ff}',
      '.vd-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s;max-width:90vw}',
      '.vd-toast.in{opacity:1;transform:translate(-50%,0)}.vd-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var S = { tab: 'vendors', vendors: [], current: null, meta: null, q: '' };
  var root, body;

  function route() {
    var h = location.hash.replace(/^#\/?/, '').split('/');
    if (h[0] === 'inward') S.tab = 'inward';
    else if (h[0] === 'compare') S.tab = 'compare';
    else if (h[0] === 'po') { S.tab = 'po'; S.po = h[1] ? decodeURIComponent(h[1]) : null; S.poVendor = h[2] ? decodeURIComponent(h[2]) : null; }
    else { S.tab = 'vendors'; S.current = h[0] === 'v' && h[1] ? decodeURIComponent(h[1]) : S.current; }
    render();
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function render() {
    root.querySelectorAll('.vd-tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === S.tab); });
    clear(body);
    if (S.tab === 'inward') return renderInwards();
    if (S.tab === 'compare') return renderCompare();
    if (S.tab === 'po') return renderPOs();
    renderVendors();
  }

  // ── purchase orders (vendor-po-app.js) ───────────────────────────────
  // #/po → list · #/po/new[/vendorId] → new PO · #/po/<id> → edit
  var poPrefill = null;
  function renderPOs() {
    if (!window.VendorPO) { body.appendChild(el('div', { class: 'vd-card' }, [el('div', { class: 'vd-empty', text: 'Purchase orders script not loaded (vendor-po-app.js).' })])); return; }
    var card = el('div', { class: S.po ? '' : 'vd-card', id: 'vd-po' });
    body.appendChild(card);
    if (S.po) {
      var pre = poPrefill; poPrefill = null;
      if (S.po === 'new') window.VendorPO.openEditor(card, null, pre || (S.poVendor ? { vendorId: S.poVendor } : null), function () { go('#/po'); });
      else window.VendorPO.openEditor(card, S.po, null, function () { go('#/po'); });
      return;
    }
    window.VendorPO.renderList(card, { onOpen: openPO });
  }
  function openPO(id, prefill) {
    if (id) return go('#/po/' + encodeURIComponent(id));
    poPrefill = prefill && !prefill.vendorId ? prefill : (prefill && prefill.vendorName ? prefill : null);
    go('#/po/new' + (prefill && prefill.vendorId && !prefill.vendorName ? '/' + encodeURIComponent(prefill.vendorId) : ''));
  }

  // ── vendors ──────────────────────────────────────────────────────────
  function loadVendors() {
    return api('GET', '/vendors').then(function (j) {
      S.vendors = j.data.vendors || [];
      if (S.paintList && document.getElementById('vd-list')) S.paintList();
      return S.vendors;
    });
  }
  function renderVendors() {
    var listCard = el('div', { class: 'vd-card' });
    var detail = el('div', { id: 'vd-detail' });
    body.appendChild(el('div', { class: 'vd-cols' }, [listCard, detail]));
    var search = el('input', { id: 'vd-search', class: 'full', placeholder: 'Search vendor / brand / city', value: S.q });
    var list = el('div', { class: 'vd-list', id: 'vd-list' });
    listCard.appendChild(el('h2', {}, [el('span', { text: 'Vendors' }), el('button', { class: 'vd-btn sm pri', type: 'button', id: 'vd-add', text: '+ Add vendor', onclick: function () { vendorDialog(null); } })]));
    listCard.appendChild(el('div', { class: 'vd-bar' }, [search]));
    listCard.appendChild(list);
    function paint() {
      clear(list);
      var q = S.q.toLowerCase();
      var vs = S.vendors.filter(function (v) { return !q || (v.name + ' ' + (v.brands || '') + ' ' + (v.city || '') + ' ' + (v.contactPerson || '')).toLowerCase().indexOf(q) !== -1; });
      if (!vs.length) { list.appendChild(el('div', { class: 'vd-empty', text: S.vendors.length ? 'No vendor matches.' : 'No vendors yet — add your first vendor.' })); return; }
      vs.forEach(function (v) {
        list.appendChild(el('button', { class: 'vd-li' + (v.id === S.current ? ' on' : ''), type: 'button', 'data-vendor': v.id, onclick: function () { go('#/v/' + encodeURIComponent(v.id)); } }, [
          el('b', { text: v.name }),
          el('div', {}, (v.brandList || []).map(function (b) { return el('span', { class: 'vd-chip', text: b }); })),
          el('span', { text: v.itemCount + ' products · ' + v.fileCount + ' files' + (v.city ? ' · ' + v.city : '') })
        ]));
      });
    }
    S.paintList = paint;
    search.addEventListener('input', function () { S.q = search.value; paint(); });
    loadVendors().then(function () {
      if (!S.current && S.vendors.length) S.current = S.vendors[0].id;
      if (S.current && !S.vendors.some(function (v) { return v.id === S.current; })) S.current = S.vendors.length ? S.vendors[0].id : null;
      paint();
      if (S.current) renderDetail(detail, S.current);
      else detail.appendChild(el('div', { class: 'vd-card' }, [el('div', { class: 'vd-empty', text: 'Add a vendor to keep their price list, stock list and catalogues here.' })]));
    }).catch(function (e) { list.appendChild(el('div', { class: 'vd-empty', text: e.message })); });
  }

  function vendorDialog(v) {
    var f = {
      name: inp('vd-f-name', 'e.g. Sri Balaji Tools', v && v.name),
      brands: inp('vd-f-brands', 'Taegutec, YG-1, Iscar (comma separated)', v && v.brands),
      contactPerson: inp('vd-f-contact', '', v && v.contactPerson),
      phone: inp('vd-f-phone', '', v && v.phone),
      email: inp('vd-f-email', '', v && v.email),
      gstin: inp('vd-f-gstin', '', v && v.gstin),
      city: inp('vd-f-city', '', v && v.city),
      address: el('textarea', { id: 'vd-f-address', value: (v && v.address) || '' }),
      notes: el('textarea', { id: 'vd-f-notes', value: (v && v.notes) || '' })
    };
    var dlg = modal(v ? 'Edit vendor' : 'Add vendor', el('div', { class: 'vd-grid' }, [
      field('Vendor name *', f.name), field('Brands they supply (master)', f.brands, 'wide'), field('Contact person', f.contactPerson), field('Phone', f.phone),
      field('Email', f.email), field('GSTIN', f.gstin), field('City', f.city), field('Address (printed on purchase orders)', f.address, 'wide'), field('Notes', f.notes, 'wide')
    ]), v ? 'Save' : 'Add vendor', function (btn) {
      var b = {}; Object.keys(f).forEach(function (k) { b[k] = f[k].value; });
      btn.disabled = true;
      (v ? api('PUT', '/vendors/' + encodeURIComponent(v.id), b) : api('POST', '/vendors', b)).then(function (j) {
        toast(j.message); dlg.remove(); S.current = j.data.vendor.id; go('#/v/' + encodeURIComponent(j.data.vendor.id)); render();
      }).catch(function (e) { toast(e.message, 'err'); btn.disabled = false; });
    });
    f.name.focus();
  }

  function modal(title, content, okText, onOk) {
    var ok = el('button', { class: 'vd-btn pri', type: 'button', id: 'vd-dlg-ok', text: okText });
    var m = el('div', { class: 'vd-modal' }, [el('div', { class: 'vd-dlg', role: 'dialog' }, [el('h3', { text: title }), content,
      el('div', { class: 'vd-acts' }, [el('button', { class: 'vd-btn', type: 'button', text: 'Cancel', onclick: function () { m.remove(); } }), ok])])]);
    ok.addEventListener('click', function () { onOk(ok); });
    m.addEventListener('mousedown', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
  }

  function renderDetail(box, id) {
    clear(box).appendChild(el('div', { class: 'vd-card' }, [el('div', { class: 'vd-empty', text: 'Loading…' })]));
    api('GET', '/vendors/' + encodeURIComponent(id)).then(function (j) {
      var v = j.data.vendor; clear(box);
      // header
      var head = el('div', { class: 'vd-card', id: 'vd-head' }, [
        el('h2', {}, [el('span', { text: v.name }), el('span', {}, [
          el('button', { class: 'vd-btn sm', type: 'button', text: 'Edit', onclick: function () { vendorDialog(v); } }), ' ',
          el('button', { class: 'vd-btn sm pri', type: 'button', id: 'vd-raise-po', text: '📄 Raise PO', onclick: function () { go('#/po/new/' + encodeURIComponent(v.id)); } }), ' ',
          el('button', { class: 'vd-btn sm grn', type: 'button', text: '+ Inward from this vendor', onclick: function () { inwardDialog(v.id); } }), ' ',
          el('button', { class: 'vd-btn sm red', type: 'button', id: 'vd-del', text: 'Delete', onclick: function () {
            if (!confirm('Delete vendor "' + v.name + '" with its ' + j.data.itemCount + ' products and ' + j.data.files.length + ' files? Inward history is kept.')) return;
            api('DELETE', '/vendors/' + encodeURIComponent(v.id)).then(function (r) { toast(r.message); S.current = null; go('#/'); render(); }).catch(function (e) { toast(e.message, 'err'); });
          } })
        ])]),
        el('div', {}, (v.brandList || []).map(function (b) { return el('span', { class: 'vd-chip', text: b }); })),
        v.address ? el('div', { class: 'vd-meta', style: 'white-space:pre-line;margin-bottom:0', text: '🏢 ' + v.address }) : el('div', { class: 'vd-meta', style: 'color:#b45309', text: '🏢 No address yet — Edit to add it (it goes on the purchase orders)' }),
        el('div', { class: 'vd-meta' }, [v.contactPerson && '👤 ' + v.contactPerson, v.phone && '📞 ' + v.phone, v.email && '✉ ' + v.email, v.gstin && 'GSTIN ' + v.gstin, v.city && '📍 ' + v.city,
          j.data.itemCount + ' products · total vendor stock ' + num(j.data.stockQty)].filter(Boolean).map(function (t) { return el('span', { text: t }); })),
        v.notes ? el('div', { class: 'sub', style: 'font-size:.8rem;color:#64748b', text: v.notes }) : null
      ]);
      box.appendChild(head);
      box.appendChild(itemsCard(v));
      box.appendChild(filesCard(v, j.data.files));
      if (window.VendorPO) {
        var poc = el('div', { class: 'vd-card', id: 'vd-vendor-pos' }, [el('h2', {}, [el('span', { text: 'Purchase orders to ' + v.name }),
          el('button', { class: 'vd-btn sm pri', type: 'button', text: '+ Raise PO', onclick: function () { go('#/po/new/' + encodeURIComponent(v.id)); } })])]);
        var pol = el('div', {}); poc.appendChild(pol);
        window.VendorPO.renderList(pol, { vendorId: v.id, compact: true, onOpen: openPO });
        box.appendChild(poc);
      }
      box.appendChild(vendorInwardsCard(v));
    }).catch(function (e) { clear(box).appendChild(el('div', { class: 'vd-card' }, [el('div', { class: 'vd-empty', text: e.message })])); });
  }

  function itemsCard(v) {
    var card = el('div', { class: 'vd-card', id: 'vd-items' });
    var q = el('input', { id: 'vd-item-q', placeholder: 'Search code / name / spec / grade' });
    var brandSel = el('select', { id: 'vd-item-brand' }, [el('option', { value: '', text: 'All brands' })]);
    var stockOnly = el('input', { type: 'checkbox', id: 'vd-item-stock' });
    var tableBox = el('div', {});
    // upload
    var file = el('input', { type: 'file', id: 'vd-up-file', accept: '.xlsx,.xls,.csv' });
    var kind = el('select', { id: 'vd-up-kind' }, [el('option', { value: 'PRICE_LIST', text: 'Price list' }), el('option', { value: 'STOCK_LIST', text: 'Stock list' })]);
    var upBrand = el('select', { id: 'vd-up-brand' }, [el('option', { value: '', text: 'Brand: from the file / sheet name' })].concat((v.brandList || []).map(function (b) { return el('option', { value: b, text: b }); })));
    var sync = el('input', { type: 'checkbox', id: 'vd-up-sync', checked: true });
    var upBtn = el('button', { class: 'vd-btn pri', type: 'button', id: 'vd-up-go', text: 'Upload' });
    upBtn.onclick = function () {
      if (!file.files[0]) { toast('Choose the Excel file first.', 'err'); return; }
      var fd = new FormData(); fd.append('file', file.files[0]); fd.append('kind', kind.value); fd.append('brand', upBrand.value); fd.append('syncProducts', sync.checked ? '1' : '0');
      upBtn.disabled = true; upBtn.textContent = 'Uploading…';
      api('POST', '/vendors/' + encodeURIComponent(v.id) + '/import', fd).then(function (j) {
        toast('Uploaded — ' + j.message); file.value = ''; renderDetail(document.getElementById('vd-detail'), v.id); loadVendors();
      }).catch(function (e) { toast(e.message, 'err'); }).then(function () { upBtn.disabled = false; upBtn.textContent = 'Upload'; });
    };
    card.appendChild(el('h2', {}, [el('span', { text: 'Products, prices & stock' }), el('span', {}, [
      el('button', { class: 'vd-btn sm', type: 'button', id: 'vd-item-add', text: '+ Add product', onclick: function () { itemDialog(v, null, load); } }), ' ',
      el('button', { class: 'vd-btn sm', type: 'button', text: '⬇ Template', onclick: function () { download('/vendors/template', 'vendor-price-list-template.xlsx').catch(function (e) { toast(e.message, 'err'); }); } }), ' ',
      el('button', { class: 'vd-btn sm', type: 'button', id: 'vd-export', text: '⬇ Excel', onclick: function () { download('/vendors/' + encodeURIComponent(v.id) + '/export').catch(function (e) { toast(e.message, 'err'); }); } }), ' ',
      el('button', { class: 'vd-btn sm red', type: 'button', text: 'Clear list', onclick: function () {
        if (!confirm('Remove all products from ' + v.name + '’s list? (Products page and stock are not touched.)')) return;
        api('DELETE', '/vendors/' + encodeURIComponent(v.id) + '/items').then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
      } })
    ])]));
    card.appendChild(el('div', { class: 'vd-drop' }, [
      field('Upload vendor Excel (all sheets)', file), field('It is a', kind), field('Brand', upBrand),
      el('label', { style: 'display:flex;gap:.35rem;align-items:center;font-size:.8rem' }, [sync, 'Also add new codes to Products']), upBtn
    ]));
    card.appendChild(el('div', { class: 'vd-bar', style: 'margin-top:.7rem' }, [q, brandSel, el('label', { style: 'display:flex;gap:.35rem;align-items:center;font-size:.82rem' }, [stockOnly, 'In stock only'])]));
    card.appendChild(tableBox);
    var t = null;
    function load() {
      var p = '?limit=500&q=' + encodeURIComponent(q.value.trim()) + '&brand=' + encodeURIComponent(brandSel.value) + (stockOnly.checked ? '&inStock=1' : '');
      api('GET', '/vendors/' + encodeURIComponent(v.id) + '/items' + p).then(function (j) {
        var cur = brandSel.value;
        clear(brandSel).appendChild(el('option', { value: '', text: 'All brands' }));
        (j.data.brands || []).forEach(function (b) { brandSel.appendChild(el('option', { value: b, text: b, selected: b === cur })); });
        clear(tableBox);
        var items = j.data.items || [];
        if (!items.length) { tableBox.appendChild(el('div', { class: 'vd-empty', text: 'No products — upload the vendor’s price list / stock list or add one by hand.' })); return; }
        var tb = el('tbody');
        items.forEach(function (r) {
          tb.appendChild(el('tr', { 'data-item': r.itemCode }, [
            el('td', {}, [el('b', { text: r.itemCode }), el('div', { class: 'sub', text: [r.productName, r.specification].filter(Boolean).join(' · ') })]),
            el('td', {}, [r.brand ? el('span', { class: 'vd-chip', text: r.brand }) : '', r.grade ? el('span', { class: 'vd-chip k', text: r.grade }) : '']),
            el('td', { class: 'n', text: money(r.price) }), el('td', { class: 'n', text: r.discount == null ? '—' : num(r.discount) + '%' }),
            el('td', { class: 'n' }, [el('b', { text: money(r.netPrice) })]),
            el('td', { class: 'n' }, [r.stockQty == null ? '—' : el('span', { class: 'vd-chip ' + (r.stockQty > 0 ? 's' : 'z'), text: num(r.stockQty) })]),
            el('td', { class: 'sub', text: [r.moq && 'MOQ ' + r.moq, r.leadTime].filter(Boolean).join(' · ') }),
            el('td', { class: 'sub', text: dmy(r.updatedAt) }),
            el('td', { class: 'n' }, [
              el('button', { class: 'vd-btn sm', type: 'button', text: 'Edit', onclick: function () { itemDialog(v, r, load); } }), ' ',
              el('button', { class: 'vd-btn sm red', type: 'button', 'data-del-item': r.id, text: '✕', title: 'Remove from this vendor', onclick: function () {
                if (!confirm('Remove ' + r.itemCode + ' from ' + v.name + '?')) return;
                api('DELETE', '/vendors/' + encodeURIComponent(v.id) + '/items/' + encodeURIComponent(r.id)).then(function () { toast('Removed'); load(); loadVendors(); }).catch(function (e) { toast(e.message, 'err'); });
              } })
            ])
          ]));
        });
        tableBox.appendChild(el('div', { class: 'sub', style: 'font-size:.78rem;color:#64748b;margin-bottom:.3rem', text: 'Showing ' + items.length + ' of ' + j.data.total }));
        tableBox.appendChild(el('div', { class: 'vd-tw' }, [el('table', { class: 'vd-table' }, [el('thead', {}, [el('tr', {},
          [['Item', ''], ['Brand / grade', ''], ['Price', 'n'], ['Disc', 'n'], ['Net price', 'n'], ['Stock', 'n'], ['MOQ / lead', ''], ['Updated', ''], ['', 'n']].map(function (h) { return el('th', { class: h[1], text: h[0] }); }))]), tb])]));
      }).catch(function (e) { clear(tableBox).appendChild(el('div', { class: 'vd-empty', text: e.message })); });
    }
    q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 250); });
    brandSel.addEventListener('change', load); stockOnly.addEventListener('change', load);
    load();
    return card;
  }

  function itemDialog(v, r, done) {
    r = r || {};
    var f = {
      itemCode: inp('vd-i-code', 'e.g. SNMX1206ANN-MM', r.itemCode), productName: inp('vd-i-name', '', r.productName),
      brand: inp('vd-i-brand', (v.brandList || [])[0] || '', r.brand || ((v.brandList || []).length === 1 ? v.brandList[0] : '')),
      grade: inp('vd-i-grade', '', r.grade), specification: inp('vd-i-spec', '', r.specification), category: inp('vd-i-cat', 'Insert / EndMill / Tap…', r.category),
      unit: inp('vd-i-unit', 'Nos', r.unit), price: inp('vd-i-price', '', r.price, 'number'), discount: inp('vd-i-disc', '', r.discount, 'number'),
      netPrice: inp('vd-i-net', 'auto from price − discount', r.netPrice, 'number'), stockQty: inp('vd-i-stock', '', r.stockQty, 'number'),
      moq: inp('vd-i-moq', '', r.moq), leadTime: inp('vd-i-lead', '', r.leadTime)
    };
    if (r.itemCode) f.itemCode.readOnly = true;
    var dl = el('datalist', { id: 'vd-brands-dl' }, (v.brandList || []).map(function (b) { return el('option', { value: b }); }));
    f.brand.setAttribute('list', 'vd-brands-dl');
    var dlg = modal(r.itemCode ? 'Edit ' + r.itemCode : 'Add product to ' + v.name, el('div', { class: 'vd-grid' }, [dl,
      field('Item code *', f.itemCode), field('Product name', f.productName), field('Brand', f.brand), field('Grade', f.grade), field('Specification', f.specification),
      field('Category', f.category), field('Unit', f.unit), field('Price (₹)', f.price), field('Discount %', f.discount), field('Net price (₹)', f.netPrice),
      field('Vendor stock', f.stockQty), field('MOQ', f.moq), field('Lead time', f.leadTime)
    ]), 'Save', function (btn) {
      var b = {}; Object.keys(f).forEach(function (k) { b[k] = f[k].value; });
      if (!b.netPrice && b.price) b.netPrice = '';
      btn.disabled = true;
      api('POST', '/vendors/' + encodeURIComponent(v.id) + '/items', b).then(function (j) { toast(j.message); dlg.remove(); done(); loadVendors(); })
        .catch(function (e) { toast(e.message, 'err'); btn.disabled = false; });
    });
  }

  function filesCard(v, files) {
    var card = el('div', { class: 'vd-card', id: 'vd-files' });
    var file = el('input', { type: 'file', id: 'vd-file', accept: '.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.doc,.docx' });
    var kind = el('select', { id: 'vd-file-kind' }, [['CATALOGUE', 'Catalogue'], ['PRICE_LIST', 'Price list'], ['STOCK_LIST', 'Stock list'], ['OTHER', 'Other']].map(function (k) { return el('option', { value: k[0], text: k[1] }); }));
    var brand = el('select', { id: 'vd-file-brand' }, [el('option', { value: '', text: 'Brand (optional)' })].concat((v.brandList || []).map(function (b) { return el('option', { value: b, text: b }); })));
    var go = el('button', { class: 'vd-btn pri', type: 'button', id: 'vd-file-go', text: 'Upload file' });
    go.onclick = function () {
      if (!file.files[0]) { toast('Choose a file first.', 'err'); return; }
      var fd = new FormData(); fd.append('file', file.files[0]); fd.append('kind', kind.value); fd.append('brand', brand.value);
      go.disabled = true;
      api('POST', '/vendors/' + encodeURIComponent(v.id) + '/files', fd).then(function (j) { toast(j.message); renderDetail(document.getElementById('vd-detail'), v.id); loadVendors(); })
        .catch(function (e) { toast(e.message, 'err'); go.disabled = false; });
    };
    card.appendChild(el('h2', { text: 'Catalogues & files' }));
    card.appendChild(el('div', { class: 'vd-drop' }, [field('File (PDF, Excel, image)', file), field('Type', kind), field('Brand', brand), go]));
    if (!files.length) { card.appendChild(el('div', { class: 'vd-empty', text: 'No catalogues yet.' })); return card; }
    var tb = el('tbody');
    files.forEach(function (f) {
      var base = '/vendors/' + encodeURIComponent(v.id) + '/files/' + encodeURIComponent(f.id);
      var canView = /\.(pdf|png|jpe?g|webp)$/i.test(f.fileName);
      tb.appendChild(el('tr', { 'data-file': f.id }, [
        el('td', {}, [el('b', { text: f.fileName }), el('div', { class: 'sub', text: kb(f.size) + ' · ' + dmy(f.createdAt) + (f.uploadedByName ? ' · ' + f.uploadedByName : '') })]),
        el('td', {}, [el('span', { class: 'vd-chip k', text: f.kindLabel }), f.brand ? el('span', { class: 'vd-chip', text: f.brand }) : '']),
        el('td', { class: 'n' }, [
          canView ? el('button', { class: 'vd-btn sm', type: 'button', text: 'Open', onclick: function () { download(base + '?inline=1', f.fileName, true).catch(function (e) { toast(e.message, 'err'); }); } }) : '', ' ',
          el('button', { class: 'vd-btn sm', type: 'button', text: '⬇', title: 'Download', onclick: function () { download(base, f.fileName).catch(function (e) { toast(e.message, 'err'); }); } }), ' ',
          el('button', { class: 'vd-btn sm red', type: 'button', text: '✕', title: 'Delete', onclick: function () {
            if (!confirm('Delete ' + f.fileName + '?')) return;
            api('DELETE', base).then(function () { toast('File deleted'); renderDetail(document.getElementById('vd-detail'), v.id); loadVendors(); }).catch(function (e) { toast(e.message, 'err'); });
          } })
        ])
      ]));
    });
    card.appendChild(el('div', { class: 'vd-tw' }, [el('table', { class: 'vd-table' }, [tb])]));
    return card;
  }

  function vendorInwardsCard(v) {
    var card = el('div', { class: 'vd-card' }, [el('h2', { text: 'Inward from ' + v.name })]);
    var box = el('div', {}); card.appendChild(box);
    api('GET', '/inwards?vendorId=' + encodeURIComponent(v.id)).then(function (j) { inwardTable(box, j.data.inwards.slice(0, 20), function () { renderDetail(document.getElementById('vd-detail'), v.id); }); })
      .catch(function (e) { box.appendChild(el('div', { class: 'vd-empty', text: e.message })); });
    return card;
  }

  // ── inward ───────────────────────────────────────────────────────────
  function loadMeta() {
    if (S.meta) return Promise.resolve(S.meta);
    return api('GET', '/products/stock/meta').then(function (j) { S.meta = j.data; return S.meta; }).catch(function () { S.meta = { localCities: [], states: [] }; return S.meta; });
  }
  function renderInwards() {
    var card = el('div', { class: 'vd-card' });
    body.appendChild(card);
    var vendorSel = el('select', { id: 'vd-in-vendor' }, [el('option', { value: '', text: 'All vendors' })]);
    var from = el('input', { type: 'date', id: 'vd-in-from' }), to = el('input', { type: 'date', id: 'vd-in-to', value: today() });
    var d = new Date(); d.setDate(1); from.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    var q = el('input', { id: 'vd-in-q', placeholder: 'Inward no / supplier / invoice / item code' });
    var box = el('div', {});
    card.appendChild(el('h2', {}, [el('span', { text: 'Stock inward from suppliers' }), el('span', {}, [
      el('button', { class: 'vd-btn sm', type: 'button', id: 'vd-in-export', text: '⬇ Excel register', onclick: function () {
        download('/inwards/export?from=' + from.value + '&to=' + to.value + (vendorSel.value ? '&vendorId=' + encodeURIComponent(vendorSel.value) : '')).catch(function (e) { toast(e.message, 'err'); });
      } }), ' ',
      el('button', { class: 'vd-btn sm grn', type: 'button', id: 'vd-in-new', text: '+ New inward', onclick: function () { inwardDialog(vendorSel.value || null, load); } })
    ])]));
    card.appendChild(el('div', { class: 'vd-bar' }, [vendorSel, field('From', from), field('To', to), q]));
    card.appendChild(box);
    var t;
    function load() {
      var p = '?from=' + from.value + '&to=' + to.value + (vendorSel.value ? '&vendorId=' + encodeURIComponent(vendorSel.value) : '') + '&q=' + encodeURIComponent(q.value.trim());
      api('GET', '/inwards' + p).then(function (j) { inwardTable(box, j.data.inwards, load); }).catch(function (e) { clear(box).appendChild(el('div', { class: 'vd-empty', text: e.message })); });
    }
    loadVendors().then(function (vs) { vs.forEach(function (v) { vendorSel.appendChild(el('option', { value: v.id, text: v.name })); }); });
    [vendorSel, from, to].forEach(function (x) { x.addEventListener('change', load); });
    q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 250); });
    load();
  }

  function inwardTable(box, list, reload) {
    clear(box);
    if (!list.length) { box.appendChild(el('div', { class: 'vd-empty', text: 'No inward entries.' })); return; }
    var tb = el('tbody');
    list.forEach(function (w) {
      tb.appendChild(el('tr', { 'data-inward': w.inwardNo }, [
        el('td', {}, [el('b', { text: w.inwardNo }), el('div', { class: 'sub', text: dmy(w.receivedDate) })]),
        el('td', {}, [w.supplierName, el('div', { class: 'sub', text: w.invoiceNo ? 'Inv ' + w.invoiceNo + (w.invoiceDate ? ' · ' + dmy(w.invoiceDate) : '') : '' })]),
        el('td', { text: w.location }),
        el('td', { class: 'n', text: w.lineCount + ' items' }), el('td', { class: 'n' }, [el('b', { text: num(w.totalQty) })]), el('td', { class: 'n', text: w.totalAmount ? money(w.totalAmount) : '—' }),
        el('td', { class: 'sub', text: w.createdByName || '' }),
        el('td', { class: 'n' }, [
          el('button', { class: 'vd-btn sm', type: 'button', text: 'View', onclick: function () { showInward(w.id, reload); } }), ' ',
          isAdmin ? el('button', { class: 'vd-btn sm red', type: 'button', 'data-del-inward': w.inwardNo, text: '✕', title: 'Delete (takes the stock back out)', onclick: function () {
            if (!confirm('Delete ' + w.inwardNo + '? ' + num(w.totalQty) + ' will be taken back out of stock.')) return;
            api('DELETE', '/inwards/' + encodeURIComponent(w.id)).then(function (j) { toast(j.message); reload(); }).catch(function (e) { toast(e.message, 'err'); });
          } }) : ''
        ])
      ]));
    });
    box.appendChild(el('div', { class: 'vd-tw' }, [el('table', { class: 'vd-table' }, [el('thead', {}, [el('tr', {},
      [['Inward', ''], ['Supplier / invoice', ''], ['Added to', ''], ['Lines', 'n'], ['Qty', 'n'], ['Amount', 'n'], ['By', ''], ['', 'n']].map(function (h) { return el('th', { class: h[1], text: h[0] }); }))]), tb])]));
  }

  function showInward(id, reload) {
    api('GET', '/inwards/' + encodeURIComponent(id)).then(function (j) {
      var w = j.data.inward, tb = el('tbody');
      w.items.forEach(function (r) {
        tb.appendChild(el('tr', {}, [el('td', {}, [el('b', { text: r.itemCode }), el('div', { class: 'sub', text: r.productName || '' })]), el('td', { text: r.brand || '' }),
          el('td', { class: 'n', text: num(r.quantity) }), el('td', { class: 'n', text: money(r.rate) }), el('td', { class: 'n', text: money(r.amount) })]));
      });
      var m = modal(w.inwardNo + ' — ' + w.supplierName, el('div', {}, [
        el('div', { class: 'vd-meta' }, ['Received ' + dmy(w.receivedDate), w.invoiceNo && 'Invoice ' + w.invoiceNo + (w.invoiceDate ? ' (' + dmy(w.invoiceDate) + ')' : ''), 'Added to ' + w.location,
          w.createdByName && 'By ' + w.createdByName].filter(Boolean).map(function (t) { return el('span', { text: t }); })),
        w.notes ? el('p', { class: 'sub', text: w.notes }) : null,
        el('div', { class: 'vd-tw' }, [el('table', { class: 'vd-table' }, [el('thead', {}, [el('tr', {}, [['Item', ''], ['Brand', ''], ['Qty', 'n'], ['Rate', 'n'], ['Amount', 'n']].map(function (h) { return el('th', { class: h[1], text: h[0] }); }))]), tb])])
      ]), 'Close', function () { m.remove(); });
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /** Item code box with suggestions from Products + this vendor's list. */
  function codeSuggest(input, vendorIdFn, onPick) {
    var box = null, t = null;
    function close() { if (box) box.remove(); box = null; }
    input.addEventListener('input', function () {
      clearTimeout(t);
      var q = input.value.trim();
      if (q.length < 2) { close(); return; }
      t = setTimeout(function () {
        var vid = vendorIdFn();
        Promise.all([
          api('GET', '/products/search?limit=8&q=' + encodeURIComponent(q)).then(function (j) { return j.data.results || []; }).catch(function () { return []; }),
          vid ? api('GET', '/vendors/' + encodeURIComponent(vid) + '/items?limit=8&q=' + encodeURIComponent(q)).then(function (j) { return j.data.items || []; }).catch(function () { return []; }) : Promise.resolve([])
        ]).then(function (res) {
          if (document.activeElement !== input) return;
          var seen = {}, list = [];
          res[1].forEach(function (r) { seen[r.itemCode] = 1; list.push({ itemCode: r.itemCode, productName: r.productName || r.specification, brand: r.brand, rate: r.netPrice, tag: 'vendor' }); });
          res[0].forEach(function (r) { if (!seen[r.itemCode]) list.push({ itemCode: r.itemCode, productName: r.productName, brand: r.brand, rate: null, tag: 'product' }); });
          close();
          if (!list.length) return;
          box = el('div', { class: 'vd-sugg' });
          list.slice(0, 12).forEach(function (r) {
            box.appendChild(el('button', { type: 'button', onmousedown: function (e) { e.preventDefault(); onPick(r); close(); } }, [
              el('b', { text: r.itemCode }), ' ', r.brand ? el('span', { class: 'vd-chip', text: r.brand }) : '', r.rate != null ? el('span', { class: 'vd-chip s', text: '₹' + num(r.rate) }) : '',
              el('div', { class: 'sub', style: 'color:#64748b;font-size:.75rem', text: r.productName || '' })]));
          });
          var rc = input.getBoundingClientRect();
          box.style.left = (window.scrollX + rc.left) + 'px'; box.style.top = (window.scrollY + rc.bottom + 3) + 'px';
          document.body.appendChild(box);
        });
      }, 220);
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
  }

  function inwardDialog(vendorId, done) {
    loadMeta().then(function (meta) { return loadVendors().then(function (vs) { return [meta, vs]; }); }).then(function (mv) {
      var meta = mv[0], vs = mv[1];
      var vendor = el('select', { id: 'vd-iw-vendor' }, [el('option', { value: '', text: '— other supplier (type the name) —' })].concat(vs.map(function (v) { return el('option', { value: v.id, text: v.name, selected: v.id === vendorId }); })));
      var supplier = inp('vd-iw-supplier', 'Supplier name');
      var invNo = inp('vd-iw-inv', 'Supplier invoice / DC no.'), invDate = inp('vd-iw-invdate', '', '', 'date'), recv = inp('vd-iw-recv', '', today(), 'date');
      var locType = el('select', { id: 'vd-iw-loc' }, [['HAND', 'Hand stock (us)'], ['LOCAL', 'Local stock'], ['STATE', 'Other state stock']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
      var place = el('select', { id: 'vd-iw-place' });
      var notes = el('textarea', { id: 'vd-iw-notes', placeholder: 'Notes (optional)' });
      function places() {
        clear(place);
        var list = locType.value === 'LOCAL' ? (meta.localCities || []) : locType.value === 'STATE' ? (meta.states || []) : [];
        place.disabled = !list.length;
        if (!list.length) place.appendChild(el('option', { value: '', text: '—' }));
        list.forEach(function (c) { place.appendChild(el('option', { value: c, text: c })); });
      }
      locType.addEventListener('change', places); places();
      function supplierVis() { supplier.parentNode.style.display = vendor.value ? 'none' : ''; }
      var lines = el('tbody', { id: 'vd-iw-lines' });
      var total = el('div', { id: 'vd-iw-total', style: 'text-align:right;font-weight:700;margin-top:.4rem' });
      function recalc() {
        var q = 0, a = 0;
        lines.querySelectorAll('tr').forEach(function (tr) {
          var qty = parseFloat(tr.querySelector('[data-k=quantity]').value) || 0, rate = parseFloat(tr.querySelector('[data-k=rate]').value) || 0;
          tr.querySelector('[data-amt]').textContent = qty && rate ? money(qty * rate) : '—';
          q += qty; a += qty * rate;
        });
        total.textContent = 'Total quantity ' + num(q) + (a ? ' · amount ' + money(a) : '');
      }
      function addLine(pre) {
        pre = pre || {};
        var code = el('input', { 'data-k': 'itemCode', placeholder: 'Item code', value: pre.itemCode || '' });
        var name = el('input', { 'data-k': 'productName', placeholder: 'Name (for new items)', value: pre.productName || '' });
        var brand = el('input', { 'data-k': 'brand', placeholder: 'Brand', value: pre.brand || '' });
        var qty = el('input', { 'data-k': 'quantity', type: 'number', min: '0', step: 'any', placeholder: 'Qty' });
        var rate = el('input', { 'data-k': 'rate', type: 'number', min: '0', step: 'any', placeholder: 'Rate', value: pre.rate == null ? '' : pre.rate });
        var tr = el('tr', {}, [el('td', {}, [code]), el('td', {}, [name]), el('td', {}, [brand]), el('td', {}, [qty]), el('td', {}, [rate]), el('td', { class: 'n', 'data-amt': '1', text: '—' }),
          el('td', {}, [el('button', { class: 'vd-btn sm red', type: 'button', text: '✕', onclick: function () { tr.remove(); recalc(); } })])]);
        codeSuggest(code, function () { return vendor.value; }, function (r) { code.value = r.itemCode; if (!name.value) name.value = r.productName || ''; if (!brand.value) brand.value = r.brand || ''; if (r.rate != null && !rate.value) rate.value = r.rate; recalc(); qty.focus(); });
        [qty, rate].forEach(function (x) { x.addEventListener('input', recalc); });
        lines.appendChild(tr);
        return code;
      }
      addLine(); addLine(); addLine();
      var dlg = modal('New stock inward', el('div', {}, [
        el('div', { class: 'vd-grid' }, [field('Vendor', vendor), field('Supplier name', supplier), field('Invoice / DC no.', invNo), field('Invoice date', invDate),
          field('Received on', recv), field('Add the stock to', locType), field('City / state', place), field('Notes', notes, 'wide')]),
        el('div', { class: 'vd-tw', style: 'margin-top:.8rem' }, [el('table', { class: 'vd-table' }, [el('thead', {}, [el('tr', {},
          ['Item code', 'Product', 'Brand', 'Qty received', 'Rate (₹)', 'Amount', ''].map(function (h) { return el('th', { text: h }); }))]), lines])]),
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:.5rem' }, [
          el('button', { class: 'vd-btn sm', type: 'button', id: 'vd-iw-addline', text: '+ Add line', onclick: function () { addLine().focus(); } }), total])
      ]), 'Save inward & add to stock', function (btn) {
        var items = [];
        lines.querySelectorAll('tr').forEach(function (tr) {
          var it = {}; tr.querySelectorAll('[data-k]').forEach(function (i) { it[i.getAttribute('data-k')] = i.value.trim(); });
          if (it.itemCode || it.quantity) items.push(it);
        });
        btn.disabled = true;
        api('POST', '/inwards', { vendorId: vendor.value || null, supplierName: supplier.value, invoiceNo: invNo.value, invoiceDate: invDate.value, receivedDate: recv.value,
          locType: locType.value, state: place.value, notes: notes.value, items: items })
          .then(function (j) { toast(j.message); dlg.remove(); if (done) done(); else if (S.tab === 'vendors' && S.current) renderDetail(document.getElementById('vd-detail'), S.current); })
          .catch(function (e) { toast(e.message, 'err'); btn.disabled = false; });
      });
      vendor.addEventListener('change', supplierVis); supplierVis(); recalc();
    });
  }

  // ── compare ──────────────────────────────────────────────────────────
  function renderCompare() {
    var card = el('div', { class: 'vd-card' });
    var q = el('input', { id: 'vd-cmp-q', placeholder: 'Type an item code, e.g. SNMX1206', style: 'min-width:320px' });
    var box = el('div', {});
    card.appendChild(el('h2', { text: 'Compare vendor prices & stock' }));
    card.appendChild(el('div', { class: 'vd-bar' }, [q]));
    card.appendChild(box);
    body.appendChild(card);
    var t;
    q.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (q.value.trim().length < 2) { clear(box); return; }
        api('GET', '/vendors/compare?q=' + encodeURIComponent(q.value.trim())).then(function (j) {
          clear(box);
          var items = j.data.items || [];
          if (!items.length) { box.appendChild(el('div', { class: 'vd-empty', text: 'No vendor has this item.' })); return; }
          var best = {};
          items.forEach(function (r) { if (r.netPrice != null && (best[r.itemCode] == null || r.netPrice < best[r.itemCode])) best[r.itemCode] = r.netPrice; });
          var tb = el('tbody');
          items.forEach(function (r) {
            tb.appendChild(el('tr', { 'data-cmp': r.itemCode + '|' + r.vendorName }, [
              el('td', {}, [el('b', { text: r.itemCode }), el('div', { class: 'sub', text: [r.productName, r.grade].filter(Boolean).join(' · ') })]),
              el('td', {}, [el('a', { href: '#/v/' + encodeURIComponent(r.vendorId), text: r.vendorName }), el('div', { class: 'sub', text: r.vendorPhone || '' })]),
              el('td', { text: r.brand || '' }), el('td', { class: 'n', text: money(r.price) }), el('td', { class: 'n', text: r.discount == null ? '—' : num(r.discount) + '%' }),
              el('td', { class: 'n' }, [el('b', { text: money(r.netPrice) }), r.netPrice != null && r.netPrice === best[r.itemCode] ? el('span', { class: 'vd-chip s', text: 'Best' }) : '']),
              el('td', { class: 'n', text: r.stockQty == null ? '—' : num(r.stockQty) }), el('td', { class: 'sub', text: r.leadTime || '' })
            ]));
          });
          box.appendChild(el('div', { class: 'vd-tw' }, [el('table', { class: 'vd-table' }, [el('thead', {}, [el('tr', {},
            [['Item', ''], ['Vendor', ''], ['Brand', ''], ['Price', 'n'], ['Disc', 'n'], ['Net', 'n'], ['Stock', 'n'], ['Lead time', '']].map(function (h) { return el('th', { class: h[1], text: h[0] }); }))]), tb])]));
        }).catch(function (e) { clear(box).appendChild(el('div', { class: 'vd-empty', text: e.message })); });
      }, 250);
    });
    setTimeout(function () { q.focus(); }, 50);
  }

  function mountPage(content) {
    injectCss();
    if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(me().role) === -1) {
      content.appendChild(el('div', { class: 'vd-card', style: 'max-width:600px;margin:2rem auto' }, [el('div', { class: 'vd-empty', text: 'Vendors are for Manager / Admin / Super Admin.' })]));
      return;
    }
    root = el('div', { class: 'vd-wrap' });
    root.appendChild(el('div', { class: 'vd-head' }, [el('div', {}, [el('h1', { text: 'Vendors' }),
      el('p', { text: 'Vendor-wise price lists, stock lists and catalogues · stock inward from suppliers' })])]));
    root.appendChild(el('div', { class: 'vd-tabs' }, [['vendors', 'Vendors', '#/'], ['po', 'Purchase orders', '#/po'], ['inward', 'Stock inward', '#/inward'], ['compare', 'Compare prices', '#/compare']].map(function (t) {
      return el('button', { class: 'vd-tab', type: 'button', 'data-tab': t[0], text: t[1], onclick: function () { go(t[2]); } });
    })));
    body = el('div', {});
    root.appendChild(body);
    content.appendChild(root);
    window.addEventListener('hashchange', route);
    route();
  }

  window.VendorsPage = { mountPage: mountPage };
})();
