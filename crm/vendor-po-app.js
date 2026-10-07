/* ══════════════════════════════════════════════════════════════════════
   Purchase orders to vendors (Vendors page → "Purchase orders").

   Laid out like the quotation page: TMS or APJ letterhead, the vendor's
   details from the vendor master (name, address, GSTIN, brands), PO info,
   items (rate, discount, net, amount, delivery), GST, terms, signatory.
   Save, edit, delete, download the PDF — and upload a downloaded PO PDF to
   open it again for editing.

   Letterhead (company name, address, phone, e-mail, GST) for TMS and APJ is
   shown locked; it changes only when you press "Edit" and save.
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
  function f2(n) { return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(v) { var x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(x) ? null : x; }
  function money(v) { return v == null || v === '' ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function today() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function toast(msg, kind) {
    document.querySelectorAll('.vd-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'vd-toast ' + (kind || 'ok'), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }
  function pdfFetch(id, open) {
    return fetch(API + '/api/purchase-orders/' + encodeURIComponent(id) + '/pdf', { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Could not make the PDF'); });
      var cd = r.headers.get('Content-Disposition') || '', m = /filename="?([^";]+)"?/.exec(cd);
      return r.blob().then(function (b) {
        var u = URL.createObjectURL(b);
        if (open) { window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 120000); return; }
        var a = document.createElement('a'); a.href = u; a.download = m ? m[1] : 'purchase-order.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      });
    });
  }

  function css() {
    if (document.getElementById('po-css')) return;
    var st = document.createElement('style'); st.id = 'po-css';
    st.textContent = [
      '.po-ed{max-width:1150px;margin:0 auto}',
      '.po-sheet{background:#fff;border:1px solid #cbd5e1;border-radius:.9rem;padding:1.1rem 1.2rem;box-shadow:0 8px 24px rgba(15,23,42,.06)}.dark .po-sheet{background:#1e293b;border-color:#334155}',
      '.po-head{display:flex;gap:1rem;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #1a4fa0;padding-bottom:.7rem;margin-bottom:.8rem;flex-wrap:wrap}',
      '.po-logo{height:58px;width:auto;max-width:150px;object-fit:contain}.po-logo.apj{height:84px;margin:-10px 0 -8px -6px}',
      '.po-lh{text-align:right;font-size:.78rem;color:#334155;line-height:1.45;min-width:260px;flex:1}.dark .po-lh{color:#cbd5e1}',
      '.po-lh b{display:block;font-size:1.05rem;color:#1a4fa0}.po-lh .lk{margin-top:.25rem;font-size:.72rem;color:#64748b}',
      '.po-lhf{display:grid;grid-template-columns:1fr 1fr;gap:.45rem;min-width:320px;flex:1}.po-lhf .w{grid-column:1/-1}',
      '.po-title{text-align:center;font-weight:800;color:#1a4fa0;letter-spacing:.04em;margin:.2rem 0 .8rem;font-size:1.05rem}',
      '.po-co{display:inline-flex;border:1px solid #cbd5e1;border-radius:.6rem;overflow:hidden}.po-co button{border:0;background:#fff;padding:.45rem 1rem;font-weight:700;cursor:pointer;color:#475569}',
      '.po-co button.on{background:#1a4fa0;color:#fff}.dark .po-co button{background:#0f172a;color:#cbd5e1}.dark .po-co button.on{background:#2563eb;color:#fff}',
      '.po-two{display:grid;grid-template-columns:1.3fr 1fr;gap:.8rem}@media (max-width:820px){.po-two{grid-template-columns:1fr}}',
      '.po-box{border:1px solid #d1d5db;border-radius:.6rem;padding:.7rem}.dark .po-box{border-color:#334155}',
      '.po-box h4{margin:0 0 .45rem;font-size:.7rem;letter-spacing:.06em;color:#1a4fa0;font-weight:800}',
      '.po-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.5rem}',
      '.po-f label{display:block;font-size:.7rem;font-weight:600;color:#64748b;margin-bottom:.15rem}',
      '.po-f input,.po-f select,.po-f textarea,.po-t input{width:100%;border:1px solid #cbd5e1;border-radius:.45rem;padding:.38rem .5rem;font-size:.84rem;background:#fff;color:inherit}',
      '.dark .po-f input,.dark .po-f select,.dark .po-f textarea,.dark .po-t input{background:#0f172a;border-color:#334155}',
      '.po-f input[readonly]{background:#f1f5f9;font-weight:700;color:#1a4fa0}.po-f textarea{min-height:58px;resize:vertical}.po-f.w{grid-column:1/-1}',
      '.po-sub{display:flex;align-items:center;gap:.5rem;background:#eff6ff;border-left:4px solid #1a4fa0;padding:.45rem .6rem;margin:.8rem 0;border-radius:.3rem}.dark .po-sub{background:#1e3a8a33}',
      '.po-sub b{color:#1a4fa0;font-size:.85rem}.po-sub input{flex:1;border:0;background:transparent;font-weight:700;color:#1a4fa0;font-size:.88rem;outline:none}',
      '.po-t{width:100%;border-collapse:collapse;font-size:.82rem}.po-tw{overflow-x:auto}',
      '.po-t th{background:#1a4fa0;color:#fff;font-size:.72rem;padding:.45rem .35rem;text-align:center;white-space:nowrap}',
      '.po-t td{border-bottom:1px solid #ececec;padding:.3rem;vertical-align:top}.po-t td.n{text-align:right;white-space:nowrap;font-weight:600}.po-t tr:nth-child(even) td{background:#f9fafb}.dark .po-t tr:nth-child(even) td{background:#0f172a55}',
      '.po-t input{padding:.3rem .4rem;font-size:.8rem}.po-t .c{min-width:120px}.po-t .d{min-width:200px}.po-t .s{width:70px}.po-t .m{width:88px}',
      '.po-tot{display:flex;justify-content:flex-end;margin-top:.5rem}.po-tot table{font-size:.88rem;min-width:300px}.po-tot td{padding:.3rem .6rem;text-align:right}.po-tot tr.g td{background:#eff6ff;font-weight:800;color:#166534;font-size:1rem}.dark .po-tot tr.g td{background:#1e3a8a33}',
      '.po-acts{display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap;margin-top:1rem;position:sticky;bottom:0;background:linear-gradient(180deg,transparent,#f8fafc 35%);padding:.6rem 0}.dark .po-acts{background:linear-gradient(180deg,transparent,#0f172a 35%)}',
      '.po-badge{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.72rem;font-weight:700;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}',
      '.po-sugg{position:absolute;z-index:2147483500;background:#fff;border:1px solid #cbd5e1;border-radius:.5rem;box-shadow:0 10px 28px rgba(0,0,0,.18);max-height:260px;overflow:auto;min-width:360px;font-size:.8rem}',
      '.po-sugg button{display:block;width:100%;text-align:left;border:0;background:none;padding:.4rem .6rem;cursor:pointer;color:#0f172a}.po-sugg button:hover{background:#eff6ff}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var STATUS = { DRAFT: ['Draft', '#64748b'], SENT: ['Sent to vendor', '#2563eb'], RECEIVED: ['Material received', '#16a34a'], CANCELLED: ['Cancelled', '#dc2626'] };
  function badge(s) { var x = STATUS[s] || [s, '#64748b']; return el('span', { class: 'po-badge', style: '--c:' + x[1], text: x[0] }); }
  var PROFILES = null;
  function profiles(force) {
    if (PROFILES && !force) return Promise.resolve(PROFILES);
    return api('GET', '/company-profiles').then(function (j) { PROFILES = j.data.profiles; return PROFILES; });
  }

  // ── list ─────────────────────────────────────────────────────────────
  /** Renders the PO list into box. opts: { vendorId, compact, onOpen(id|null, prefill) } */
  function renderList(box, opts) {
    css(); opts = opts || {};
    clear(box);
    var q = el('input', { id: 'po-q', placeholder: 'PO no / vendor / item code', style: 'min-width:220px' });
    var co = el('select', { id: 'po-co-f' }, [el('option', { value: '', text: 'TMS + APJ' }), el('option', { value: 'TMS', text: 'TMS' }), el('option', { value: 'APJ', text: 'APJ' })]);
    var stSel = el('select', { id: 'po-st-f' }, [el('option', { value: '', text: 'Any status' })].concat(Object.keys(STATUS).map(function (k) { return el('option', { value: k, text: STATUS[k][0] }); })));
    var file = el('input', { type: 'file', accept: '.pdf,application/pdf', id: 'po-upload', style: 'display:none' });
    var up = el('button', { class: 'vd-btn sm', type: 'button', id: 'po-upload-btn', text: '⤒ Upload PO PDF to edit', onclick: function () { file.click(); } });
    file.addEventListener('change', function () {
      if (!file.files[0]) return;
      var fd = new FormData(); fd.append('file', file.files[0]);
      up.disabled = true; up.textContent = 'Reading…';
      api('POST', '/purchase-orders/read-pdf', fd).then(function (j) {
        toast(j.message);
        if (j.data.existing) opts.onOpen(j.data.order.id);
        else opts.onOpen(null, j.data.order);
      }).catch(function (e) { toast(e.message, 'err'); })
        .then(function () { up.disabled = false; up.textContent = '⤒ Upload PO PDF to edit'; file.value = ''; });
    });
    var list = el('div', { id: 'po-list' });
    if (!opts.compact) {
      box.appendChild(el('h2', {}, [el('span', { text: 'Purchase orders' }), el('span', {}, [up, ' ',
        el('button', { class: 'vd-btn sm pri', type: 'button', id: 'po-new', text: '+ New purchase order', onclick: function () { opts.onOpen(null, opts.vendorId ? { vendorId: opts.vendorId } : null); } })])]));
      box.appendChild(el('div', { class: 'vd-bar' }, [q, co, stSel, file]));
    } else box.appendChild(file);
    box.appendChild(list);
    var t;
    function load() {
      var p = '?q=' + encodeURIComponent(q.value.trim()) + (co.value ? '&company=' + co.value : '') + (stSel.value ? '&status=' + stSel.value : '') + (opts.vendorId ? '&vendorId=' + encodeURIComponent(opts.vendorId) : '');
      api('GET', '/purchase-orders' + p).then(function (j) {
        clear(list);
        var rows = j.data.orders || [];
        if (!rows.length) { list.appendChild(el('div', { class: 'vd-empty', text: 'No purchase orders yet.' })); return; }
        var tb = el('tbody');
        rows.forEach(function (o) {
          tb.appendChild(el('tr', { 'data-po': o.poNumber }, [
            el('td', {}, [el('b', { text: o.poNumber }), el('div', { class: 'sub', text: dmy(o.poDate) })]),
            el('td', {}, [o.vendorName, el('div', { class: 'sub', text: o.subject || '' })]),
            el('td', { class: 'n', text: o.lineCount + ' items' }), el('td', { class: 'n' }, [el('b', { text: money(o.totalAmount) })]),
            el('td', {}, [badge(o.status)]),
            el('td', { class: 'n' }, [
              el('button', { class: 'vd-btn sm', type: 'button', 'data-po-edit': o.poNumber, text: 'Edit', onclick: function () { opts.onOpen(o.id); } }), ' ',
              el('button', { class: 'vd-btn sm', type: 'button', 'data-po-pdf': o.poNumber, text: '⬇ PDF', onclick: function () { pdfFetch(o.id).catch(function (e) { toast(e.message, 'err'); }); } }), ' ',
              el('button', { class: 'vd-btn sm red', type: 'button', 'data-po-del': o.poNumber, text: '✕', title: 'Delete', onclick: function () {
                if (!confirm('Delete purchase order ' + o.poNumber + '?')) return;
                api('DELETE', '/purchase-orders/' + encodeURIComponent(o.id)).then(function (r) { toast(r.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
              } })
            ])
          ]));
        });
        list.appendChild(el('div', { class: 'vd-tw' }, [el('table', { class: 'vd-table' }, [el('thead', {}, [el('tr', {},
          [['PO', ''], ['Vendor', ''], ['Lines', 'n'], ['Total', 'n'], ['Status', ''], ['', 'n']].map(function (h) { return el('th', { class: h[1], text: h[0] }); }))]), tb])]));
      }).catch(function (e) { clear(list).appendChild(el('div', { class: 'vd-empty', text: e.message })); });
    }
    q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 250); });
    co.addEventListener('change', load); stSel.addEventListener('change', load);
    load();
    return { reload: load, upload: function () { file.click(); } };
  }

  // ── editor ───────────────────────────────────────────────────────────
  /** Opens the PO editor in box. id = existing PO, or null with prefill (vendorId / data read from a PDF). */
  function openEditor(box, id, prefill, done) {
    css();
    clear(box).appendChild(el('div', { class: 'vd-empty', text: 'Loading…' }));
    Promise.all([
      id ? api('GET', '/purchase-orders/' + encodeURIComponent(id)).then(function (j) { return j.data.order; }) : Promise.resolve(null),
      api('GET', '/vendors').then(function (j) { return j.data.vendors; }),
      profiles()
    ]).then(function (r) { build(box, r[0], r[1], r[2], prefill || {}, done); }).catch(function (e) { clear(box).appendChild(el('div', { class: 'vd-empty', text: e.message })); });
  }

  function build(box, po, vendors, profs, pre, done) {
    var P = po || {};
    var src = po || pre;            // values to show
    var F = {
      id: P.id || null, company: (src.company || 'TMS'), poNumber: P.poNumber || '',
      vendorId: src.vendorId || '', vendorName: src.vendorName || '', vendorAddress: src.vendorAddress || '', vendorGstin: src.vendorGstin || '',
      vendorPhone: src.vendorPhone || '', vendorEmail: src.vendorEmail || '', kindAttn: src.kindAttn || '', brand: src.brand || '',
      poDate: (src.poDate || today()).slice(0, 10), quoteRef: src.quoteRef || '', quoteDate: (src.quoteDate || '').slice(0, 10), requiredBy: (src.requiredBy || '').slice(0, 10),
      subject: src.subject || '', deliveryAddress: src.deliveryAddress || '', paymentTerms: src.paymentTerms || '30 days from the date of invoice',
      deliveryTerms: src.deliveryTerms || '', freight: src.freight || '', taxes: src.taxes || '', gstPercent: src.gstPercent == null ? '18' : String(src.gstPercent),
      notes: src.notes || '', signName: src.signName || me().name || '', signDesignation: src.signDesignation || 'Authorised Signatory', status: src.status || 'DRAFT',
      items: (src.items && src.items.length ? src.items : [{}, {}, {}]).map(function (i) {
        return { itemCode: i.itemCode || '', description: i.description || '', brand: i.brand || '', quantity: i.quantity == null ? '' : i.quantity, unit: i.unit || 'Nos',
                 unitPrice: i.unitPrice == null ? '' : i.unitPrice, discount: i.discount == null ? '' : i.discount, delivery: i.delivery || '' };
      })
    };
    if (!po && pre.vendorId && !pre.vendorName) fillVendor(pre.vendorId);
    clear(box);
    var wrap = el('div', { class: 'po-ed', id: 'po-editor' });
    box.appendChild(wrap);

    function vendorById(vid) { return vendors.filter(function (v) { return v.id === vid; })[0] || null; }
    function fillVendor(vid) {
      var v = vendorById(vid); if (!v) return;
      F.vendorId = v.id; F.vendorName = v.name; F.vendorAddress = [v.address, v.city && (v.address || '').indexOf(v.city) === -1 ? v.city : ''].filter(Boolean).join('\n');
      F.vendorGstin = v.gstin || ''; F.vendorPhone = v.phone || ''; F.vendorEmail = v.email || ''; F.kindAttn = v.contactPerson || '';
      if (!F.brand && v.brandList && v.brandList.length === 1) F.brand = v.brandList[0];
    }

    function field(label, key, opts) {
      opts = opts || {};
      var i = opts.type === 'textarea' ? el('textarea', { 'data-po': key, placeholder: opts.ph || '' }) : el('input', { 'data-po': key, type: opts.type || 'text', placeholder: opts.ph || '', list: opts.list || null });
      i.value = F[key] == null ? '' : F[key];
      if (opts.readonly) i.readOnly = true;
      i.addEventListener('input', function () { F[key] = i.value; if (opts.onInput) opts.onInput(); });
      return el('div', { class: 'po-f' + (opts.w ? ' w' : '') }, [el('label', { text: label }), i]);
    }

    function render() {
      clear(wrap);
      var prof = profs[F.company];
      // letterhead
      var lh = el('div', { class: 'po-lh', id: 'po-letterhead' });
      function lhView() {
        clear(lh);
        lh.appendChild(el('b', { text: prof.name }));
        (prof.address || '').split('\n').forEach(function (l) { if (l.trim()) lh.appendChild(el('div', { text: l })); });
        lh.appendChild(el('div', { text: [prof.phone, prof.email && 'E-Mail: ' + prof.email, prof.gstin && 'GST: ' + prof.gstin].filter(Boolean).join('  |  ') }));
        lh.appendChild(el('div', { class: 'lk' }, ['🔒 Letterhead is fixed', prof.saved ? '' : ' (default)', ' · ',
          el('button', { class: 'vd-btn sm', type: 'button', id: 'po-lh-edit', text: '✎ Edit ' + F.company + ' details', onclick: lhEdit })]));
      }
      function lhEdit() {
        clear(lh);
        var f = { name: el('input', { id: 'po-lh-name', value: prof.name || '' }), address: el('textarea', { id: 'po-lh-address' }), phone: el('input', { id: 'po-lh-phone', value: prof.phone || '' }),
                  email: el('input', { id: 'po-lh-email', value: prof.email || '' }), gstin: el('input', { id: 'po-lh-gstin', value: prof.gstin || '' }) };
        f.address.value = prof.address || '';
        var save = el('button', { class: 'vd-btn sm pri', type: 'button', id: 'po-lh-save', text: 'Save ' + F.company + ' details' });
        save.onclick = function () {
          var b = {}; Object.keys(f).forEach(function (k) { b[k] = f[k].value; });
          save.disabled = true;
          api('PUT', '/company-profiles/' + F.company, b).then(function (j) { toast(j.message); profs[F.company] = prof = j.data.profile; lhView(); })
            .catch(function (e) { toast(e.message, 'err'); save.disabled = false; });
        };
        lh.appendChild(el('div', { class: 'po-lhf po-f', style: 'text-align:left' }, [
          el('div', { class: 'w' }, [el('label', { text: 'Company name' }), f.name]), el('div', { class: 'w' }, [el('label', { text: 'Address (one line per row)' }), f.address]),
          el('div', {}, [el('label', { text: 'Phone / mobile' }), f.phone]), el('div', {}, [el('label', { text: 'E-mail' }), f.email]), el('div', {}, [el('label', { text: 'GST no.' }), f.gstin]),
          el('div', { style: 'display:flex;gap:.4rem;align-items:end;justify-content:flex-end' }, [el('button', { class: 'vd-btn sm', type: 'button', text: 'Cancel', onclick: lhView }), save])
        ]));
        f.address.focus();
      }
      lhView();
      var coSel = el('div', { class: 'po-co', role: 'radiogroup', 'aria-label': 'Company' }, ['TMS', 'APJ'].map(function (c) {
        return el('button', { type: 'button', class: F.company === c ? 'on' : '', 'data-co': c, text: c, onclick: function () {
          if (F.company === c) return;
          F.company = c;
          if (!F.id) api('GET', '/purchase-orders/next-no?company=' + c).then(function (j) { F.poNumber = j.data.poNumber; render(); }).catch(render); else render();
        } });
      }));
      var sheet = el('div', { class: 'po-sheet' });
      sheet.appendChild(el('div', { class: 'po-head' }, [
        el('div', {}, [el('img', { class: 'po-logo' + (F.company === 'APJ' ? ' apj' : ''), src: '/brand/' + (F.company === 'APJ' ? 'apj' : 'tms') + '-logo.png', alt: F.company + ' logo' }), el('div', { style: 'margin-top:.5rem' }, [coSel])]),
        lh
      ]));
      sheet.appendChild(el('div', { class: 'po-title', text: 'PURCHASE ORDER' }));
      // vendor + info
      var vSel = el('select', { 'data-po': 'vendorId', id: 'po-vendor' }, [el('option', { value: '', text: '— choose the vendor —' })].concat(vendors.map(function (v) { return el('option', { value: v.id, text: v.name, selected: v.id === F.vendorId }); })));
      vSel.addEventListener('change', function () { fillVendor(vSel.value); render(); });
      var v = vendorById(F.vendorId);
      var brandList = el('datalist', { id: 'po-brands' }, ((v && v.brandList) || []).map(function (b) { return el('option', { value: b }); }));
      sheet.appendChild(el('div', { class: 'po-two' }, [
        el('div', { class: 'po-box' }, [el('h4', { text: 'TO (VENDOR)' }), el('div', { class: 'po-g' }, [
          el('div', { class: 'po-f w' }, [el('label', { text: 'Vendor (from the vendor master)' }), vSel]),
          field('Address', 'vendorAddress', { type: 'textarea', w: true, ph: 'Filled from the vendor master — edit if needed' }),
          field('GSTIN', 'vendorGstin'), field('Phone', 'vendorPhone'), field('E-mail', 'vendorEmail'), field('Kind attn', 'kindAttn'),
          field('Brand', 'brand', { list: 'po-brands', ph: (v && v.brandList || []).join(', ') }), brandList
        ])]),
        el('div', { class: 'po-box' }, [el('h4', { text: 'PURCHASE ORDER INFO' }), el('div', { class: 'po-g' }, [
          field('PO no. (automatic)', 'poNumber', { readonly: true }), field('PO date', 'poDate', { type: 'date' }),
          field('Your quote ref.', 'quoteRef', { ph: 'Vendor quotation no.' }), field('Quote date', 'quoteDate', { type: 'date' }),
          field('Required by', 'requiredBy', { type: 'date' }),
          el('div', { class: 'po-f' }, [el('label', { text: 'Status' }), (function () {
            var s = el('select', { 'data-po': 'status' }, Object.keys(STATUS).map(function (k) { return el('option', { value: k, text: STATUS[k][0], selected: F.status === k }); }));
            s.onchange = function () { F.status = s.value; }; return s; })()])
        ])])
      ]));
      var subj = el('input', { 'data-po': 'subject', placeholder: 'e.g. Supply of milling inserts', value: F.subject });
      subj.addEventListener('input', function () { F.subject = subj.value; });
      sheet.appendChild(el('div', { class: 'po-sub' }, [el('b', { text: 'Sub:' }), subj]));
      // items
      var tb = el('tbody', { id: 'po-lines' });
      var totBox = el('div', { class: 'po-tot' });
      function calcRow(it) {
        var p = num(it.unitPrice), d = num(it.discount) || 0, q = num(it.quantity);
        var net = p == null ? null : Math.round(p * (1 - d / 100) * 100) / 100;
        return { net: net, amt: net == null || q == null ? null : Math.round(net * q * 100) / 100 };
      }
      function totals() {
        var sub = 0, qty = 0;
        F.items.forEach(function (it) { var c = calcRow(it); sub += c.amt || 0; qty += num(it.quantity) || 0; });
        var g = num(F.gstPercent) || 0, tax = Math.round(sub * g) / 100;
        clear(totBox).appendChild(el('table', {}, [el('tbody', {}, [
          el('tr', {}, [el('td', { text: 'Total qty' }), el('td', { text: String(Math.round(qty * 100) / 100) })]),
          el('tr', {}, [el('td', { text: 'Sub total' }), el('td', { id: 'po-subtotal', text: money(sub) })]),
          el('tr', {}, [el('td', {}, ['GST ', (function () { var i = el('input', { 'data-po': 'gstPercent', type: 'number', min: '0', max: '40', step: 'any', value: F.gstPercent, style: 'width:4.5rem;border:1px solid #cbd5e1;border-radius:.35rem;padding:.15rem .3rem' });
            i.addEventListener('input', function () { F.gstPercent = i.value; totals(); setTimeout(function () { var x = totBox.querySelector('[data-po=gstPercent]'); if (x) { x.focus(); x.setSelectionRange && x.setSelectionRange(99, 99); } }, 0); }); return i; })(), ' %']), el('td', { text: money(tax) })]),
          el('tr', { class: 'g' }, [el('td', { text: 'Grand total' }), el('td', { id: 'po-grand', text: money(sub + tax) })])
        ])]));
      }
      function line(it, idx) {
        var c = calcRow(it);
        var netTd = el('td', { class: 'n', text: c.net == null ? '—' : f2(c.net) }), amtTd = el('td', { class: 'n', text: c.amt == null ? '—' : f2(c.amt) });
        function inp(key, cls, type) {
          var i = el('input', { class: cls || '', 'data-k': key, type: type || 'text', value: it[key] == null ? '' : it[key], step: type === 'number' ? 'any' : null, min: type === 'number' ? '0' : null });
          i.addEventListener('input', function () { it[key] = i.value; var x = calcRow(it); netTd.textContent = x.net == null ? '—' : f2(x.net); amtTd.textContent = x.amt == null ? '—' : f2(x.amt); totals(); });
          return i;
        }
        var code = inp('itemCode', 'c');
        suggest(code, it, function () { render(); });
        return el('tr', { 'data-line': idx }, [
          el('td', { class: 'n', text: String(idx + 1) }), el('td', {}, [code]), el('td', {}, [inp('description', 'd')]), el('td', {}, [inp('brand', 'm')]),
          el('td', {}, [inp('quantity', 's', 'number')]), el('td', {}, [inp('unit', 's')]), el('td', {}, [inp('unitPrice', 'm', 'number')]), el('td', {}, [inp('discount', 's', 'number')]),
          netTd, amtTd, el('td', {}, [inp('delivery', 'm')]),
          el('td', {}, [el('button', { class: 'vd-btn sm red', type: 'button', title: 'Remove line', text: '✕', onclick: function () { F.items.splice(idx, 1); if (!F.items.length) F.items.push({ unit: 'Nos' }); render(); } })])
        ]);
      }
      F.items.forEach(function (it, i) { tb.appendChild(line(it, i)); });
      sheet.appendChild(el('div', { class: 'po-tw' }, [el('table', { class: 'po-t' }, [el('thead', {}, [el('tr', {},
        ['#', 'Item code', 'Description', 'Brand', 'Qty', 'Unit', 'Rate ₹', 'Disc %', 'Net ₹', 'Amount ₹', 'Delivery', ''].map(function (h) { return el('th', { text: h }); }))]), tb])]));
      sheet.appendChild(el('div', { style: 'margin-top:.4rem' }, [el('button', { class: 'vd-btn sm', type: 'button', id: 'po-add-line', text: '+ Add line', onclick: function () { F.items.push({ unit: 'Nos' }); render(); var r = wrap.querySelectorAll('#po-lines tr'); if (r.length) r[r.length - 1].querySelector('input').focus(); } })]));
      sheet.appendChild(totBox); totals();
      // terms + sign
      sheet.appendChild(el('div', { class: 'po-two', style: 'margin-top:.8rem' }, [
        el('div', { class: 'po-box' }, [el('h4', { text: 'TERMS & CONDITIONS' }), el('div', { class: 'po-g' }, [
          field('Payment', 'paymentTerms'), field('Delivery', 'deliveryTerms', { ph: 'e.g. Door delivery within 7 days' }),
          field('Freight', 'freight', { ph: 'e.g. Vendor scope' }), field('Taxes', 'taxes', { ph: 'default: GST % extra' }),
          field('Deliver to', 'deliveryAddress', { type: 'textarea', w: true, ph: 'Leave blank to use our address' }), field('Note', 'notes', { type: 'textarea', w: true })
        ])]),
        el('div', { class: 'po-box' }, [el('h4', { text: 'FOR ' + String(prof.name || '').toUpperCase() }), el('div', { class: 'po-g' }, [
          field('Signed by', 'signName'), field('Designation', 'signDesignation')
        ])])
      ]));
      wrap.appendChild(sheet);
      // actions
      var acts = el('div', { class: 'po-acts' });
      if (F.id) acts.appendChild(el('button', { class: 'vd-btn red', type: 'button', id: 'po-delete', style: 'margin-right:auto', text: 'Delete PO', onclick: function () {
        if (!confirm('Delete purchase order ' + F.poNumber + '?')) return;
        api('DELETE', '/purchase-orders/' + encodeURIComponent(F.id)).then(function (j) { toast(j.message); done(); }).catch(function (e) { toast(e.message, 'err'); });
      } }));
      acts.appendChild(el('button', { class: 'vd-btn', type: 'button', text: 'Close', onclick: function () { done(); } }));
      acts.appendChild(el('button', { class: 'vd-btn', type: 'button', id: 'po-save', text: F.id ? 'Save changes' : 'Save PO', onclick: function (e) { save(e.target, false); } }));
      acts.appendChild(el('button', { class: 'vd-btn pri', type: 'button', id: 'po-save-pdf', text: 'Save & download PDF', onclick: function (e) { save(e.target, true); } }));
      wrap.appendChild(acts);
    }

    function save(btn, pdf) {
      var body = {}; Object.keys(F).forEach(function (k) { if (k !== 'items' && k !== 'id') body[k] = F[k]; });
      if (!body.deliveryAddress) body.deliveryAddress = profs[F.company].name + '\n' + (profs[F.company].address || '');
      body.items = F.items.map(function (i) { return i; });
      btn.disabled = true;
      (F.id ? api('PUT', '/purchase-orders/' + encodeURIComponent(F.id), body) : api('POST', '/purchase-orders', body)).then(function (j) {
        toast(j.message);
        var o = j.data.order; F.id = o.id; F.poNumber = o.poNumber;
        if (pdf) return pdfFetch(o.id).then(function () { render(); });
        render();
      }).catch(function (e) { toast(e.message, 'err'); }).then(function () { btn.disabled = false; });
    }

    /** Item code box: suggestions from the vendor's price list, then the product list. */
    function suggest(input, it, after) {
      var box = null, t = null;
      function close() { if (box) box.remove(); box = null; }
      input.addEventListener('input', function () {
        clearTimeout(t);
        var q = input.value.trim();
        if (q.length < 2) { close(); return; }
        t = setTimeout(function () {
          Promise.all([
            F.vendorId ? api('GET', '/vendors/' + encodeURIComponent(F.vendorId) + '/items?limit=8&q=' + encodeURIComponent(q)).then(function (j) { return j.data.items || []; }).catch(function () { return []; }) : Promise.resolve([]),
            api('GET', '/products/search?limit=8&q=' + encodeURIComponent(q)).then(function (j) { return j.data.results || []; }).catch(function () { return []; })
          ]).then(function (r) {
            if (document.activeElement !== input) return;
            var seen = {}, list = [];
            r[0].forEach(function (x) { seen[x.itemCode] = 1; list.push({ code: x.itemCode, desc: [x.productName, x.specification, x.grade && 'Grade ' + x.grade].filter(Boolean).join(' · '), brand: x.brand, price: x.price, disc: x.discount, src: 'vendor' }); });
            r[1].forEach(function (x) { if (!seen[x.itemCode]) list.push({ code: x.itemCode, desc: [x.specification || x.productName, x.grade && 'Grade ' + x.grade].filter(Boolean).join(' · '), brand: x.brand, price: null, disc: null, src: 'product' }); });
            close();
            if (!list.length) return;
            box = el('div', { class: 'po-sugg' });
            list.slice(0, 12).forEach(function (x) {
              box.appendChild(el('button', { type: 'button', onmousedown: function (e) {
                e.preventDefault();
                it.itemCode = x.code; if (!it.description) it.description = x.desc; if (!it.brand && x.brand) it.brand = x.brand;
                if (x.price != null && (it.unitPrice === '' || it.unitPrice == null)) it.unitPrice = x.price;
                if (x.disc != null && (it.discount === '' || it.discount == null)) it.discount = x.disc;
                close(); after();
              } }, [el('b', { text: x.code }), ' ', x.brand ? el('span', { class: 'vd-chip', text: x.brand }) : '', x.price != null ? el('span', { class: 'vd-chip s', text: '₹' + x.price + (x.disc ? ' −' + x.disc + '%' : '') }) : '',
                el('div', { style: 'color:#64748b;font-size:.74rem', text: (x.src === 'vendor' ? 'Vendor list · ' : '') + (x.desc || '') })]));
            });
            var rc = input.getBoundingClientRect();
            box.style.left = (window.scrollX + rc.left) + 'px'; box.style.top = (window.scrollY + rc.bottom + 3) + 'px';
            document.body.appendChild(box);
          });
        }, 220);
      });
      input.addEventListener('blur', function () { setTimeout(close, 150); });
    }

    if (!F.id && !F.poNumber) {
      api('GET', '/purchase-orders/next-no?company=' + F.company).then(function (j) { F.poNumber = j.data.poNumber; render(); }).catch(render);
    } else render();
  }

  window.VendorPO = { renderList: renderList, openEditor: openEditor, pdf: pdfFetch };
})();
