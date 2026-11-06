/* ══════════════════════════════════════════════════════════════════════
   Orders — verbal commitments and purchase orders, with delivery
   tracking, for the compiled build.

   Every authenticated user sees the full list (same visibility model as
   Meetings/Appointments). Creating one self-assigns the engineer unless
   you're admin-tier and pick someone else. Editing/deleting needs to be
   the creator or admin-tier — matches OrderController.php exactly.

   List page: price/proforma and delivery are inline dropdowns; clicking a
   row opens the order in a pop-up with the materials on the order, where
   the supplied ones are ticked off, and an ✎ Edit order button. All ticked = order
   complete; some = partially complete; none = not delivered — anything
   short of complete needs a reason (enforced by PATCH /orders/:id/supply).

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var ORDER_TYPES = [['VERBAL', 'Verbal'], ['PO', 'Purchase order']];
  var DELIVERY_STATUSES = [['PENDING', 'Pending'], ['DELIVERED', 'Delivered'],
                           ['PARTIALLY_DELIVERED', 'Partially delivered'], ['NOT_DELIVERED', 'Not delivered']];
  var STATUS_BADGE = { PENDING: 'badge-yellow', DELIVERED: 'badge-green', PARTIALLY_DELIVERED: 'badge-amber', NOT_DELIVERED: 'badge-red' };
  var PROFORMA_STATUSES = [['NOT_CONFIRMED', 'Not confirmed'], ['CONFIRMED', 'Confirmed']];
  var PROFORMA_BADGE = { NOT_CONFIRMED: 'badge-gray', CONFIRMED: 'badge-green' };
  var TYPE_BADGE = { VERBAL: 'badge-gray', PO: 'badge-blue' };
  var PROCUREMENT_STATUSES = [['NOT_ORDERED', 'Not ordered'], ['ORDERED', 'Ordered']];
  var PROCUREMENT_BADGE = { NOT_ORDERED: 'badge-gray', ORDERED: 'badge-blue' };

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function currentUser() {
    try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch (e) { return null; }
  }
  /* Shared brand list (products, vendors and brands added by hand — /options?list=brand); "＋ Other…" adds one for everyone. */
  var BRANDS = [];
  function loadBrands() {
    return fetch(API + '/api/options?list=brand', { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) { return r.json(); })
      .then(function (j) { BRANDS = ((j.data && j.data.options) || []).map(function (o) { return o.value; }); }).catch(function () {});
  }
  function brandSelect(value, onPick) {
    var s = el('select', { class: INPUT, 'data-order-brand': '', title: 'Brand', style: 'max-width:140px' }, [el('option', { value: '', text: 'Brand…' })]);
    var list = BRANDS.slice(); if (value && list.indexOf(value) === -1) list.unshift(value);
    list.forEach(function (b) { s.appendChild(el('option', { value: b, text: b })); });
    s.appendChild(el('option', { value: '__other', text: '＋ Other (type new)…' }));
    s.value = value || '';
    var prev = s.value;
    s.addEventListener('change', function () {
      if (s.value !== '__other') { prev = s.value; onPick(s.value); return; }
      var b = (prompt('New brand name (it will be added to the list for everyone):') || '').trim();
      if (!b) { s.value = prev; return; }
      fetch(API + '/api/options', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ list: 'brand', label: b }) })
        .then(function (r) { return r.json(); }).then(function (j) {
          if (!j.success) throw new Error(j.message || 'Could not add the brand');
          var v = j.data.option.value; if (BRANDS.indexOf(v) === -1) BRANDS.push(v);
          var o = el('option', { value: v, text: v }); s.insertBefore(o, s.lastChild); s.value = v; prev = v; onPick(v);
        }).catch(function (e) { alert(e.message); s.value = prev; });
    });
    return s;
  }
  function isSuperAdminUser() { var u = currentUser(); return !!u && u.role === 'SUPER_ADMIN'; }
  function isAdmin() {
    var u = currentUser();
    return !!u && ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(u.role) !== -1; // matches is_admin_tier()
  }
  /** Mirrors OrderController::canEdit() — admin-tier, or the engineer the order belongs to. */
  function canEditOrder(o) {
    var u = currentUser();
    return isAdmin() || !!(o && o.engineer && u && o.engineer.id === u.id);
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // A few styles the compiled Tailwind CSS doesn't include (it only has the
  // classes the original React build used), scoped under an ox- prefix.
  function injectCss() {
    if (document.getElementById('orders-extra-css')) return;
    var st = document.createElement('style');
    st.id = 'orders-extra-css';
    st.textContent = [
      '.ox-no{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.8rem;font-weight:600;color:#1e3a8a;user-select:all}',
      '.dark .ox-no{color:#93c5fd}',
      '.ox-copy{margin-left:.3rem;border:1px solid #cbd5e1;background:#eff6ff;color:#1e3a8a;border-radius:6px;padding:0 .35rem;font-size:.75rem;line-height:1.4rem;cursor:pointer}',
      '.ox-copy:hover{background:#dbeafe}.dark .ox-copy{background:#1e293b;border-color:#334155;color:#93c5fd}',
      '.ox-nowrap{white-space:nowrap}',
      /* locked header row + customer column: the list scrolls under them both ways */
      '.ox-scroll{max-height:calc(100vh - 230px);overflow:auto}',
      '.ox-lock thead th{position:sticky;top:0;z-index:3;background:#f8fafc;box-shadow:inset 0 -1px 0 #e2e8f0}.dark .ox-lock thead th{background:#1e293b}',
      '.ox-lock thead th:nth-child(-n+2),.ox-lock tr.table-row>td:nth-child(-n+2){position:sticky;background:#fff;z-index:2}.ox-lock thead th:nth-child(-n+2){z-index:4;background:#f8fafc}',
      '.dark .ox-lock tr.table-row>td:nth-child(-n+2){background:#0f172a}.dark .ox-lock thead th:nth-child(-n+2){background:#1e293b}',
      '.ox-lock thead th:nth-child(1),.ox-lock tr.table-row>td:nth-child(1){left:0;min-width:34px;width:34px}',
      '.ox-lock thead th:nth-child(2),.ox-lock tr.table-row>td:nth-child(2){left:34px;box-shadow:inset -1px 0 0 #e2e8f0}',
      '.ox-lock tr.table-row:hover>td:nth-child(-n+2){background:#f8fafc}.dark .ox-lock tr.table-row:hover>td:nth-child(-n+2){background:#1e293b}',
      '.ox-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;align-items:end}',
      '@media(min-width:768px){.ox-filters{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '@media(min-width:1280px){.ox-filters{grid-template-columns:repeat(8,minmax(0,1fr))}}',
      '.ox-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}',
      '@media(min-width:768px){.ox-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '@media(min-width:1280px){.ox-stats{grid-template-columns:repeat(6,minmax(0,1fr))}}',
      '.ox-sel{width:auto;min-width:8.5rem;padding:.3rem 1.6rem .3rem .5rem;font-size:.78rem;font-weight:500;border-radius:.5rem;',
      '  border:1px solid #e2e8f0;background-color:#fff;color:#0f172a;cursor:pointer}',
      '.ox-sel:focus{outline:none;box-shadow:0 0 0 1px #1e3a5f}',
      '.dark .ox-sel{background-color:#0f172a;border-color:#334155;color:#f1f5f9}',
      '.ox-good{border-color:#86efac;background-color:#f0fdf4;color:#166534}',
      '.ox-warn{border-color:#fcd34d;background-color:#fffbeb;color:#92400e}',
      '.ox-bad{border-color:#fca5a5;background-color:#fef2f2;color:#991b1b}',
      '.ox-idle{border-color:#e2e8f0;background-color:#f8fafc;color:#475569}',
      '.dark .ox-good{background-color:rgba(22,101,52,.25);border-color:#166534;color:#bbf7d0}',
      '.dark .ox-warn{background-color:rgba(146,64,14,.25);border-color:#92400e;color:#fde68a}',
      '.dark .ox-bad{background-color:rgba(153,27,27,.25);border-color:#991b1b;color:#fecaca}',
      '.dark .ox-idle{background-color:#1e293b;border-color:#334155;color:#cbd5e1}',
      '.ox-caret{display:inline-block;width:1rem;transition:transform .15s;color:#94a3b8}',
      '.ox-open .ox-caret{transform:rotate(90deg)}',
      '.ox-open>td{background:#f8fafc}.dark .ox-open>td{background:rgba(30,41,59,.5)}',
      '.ox-expand>td{background:#f8fafc;border-bottom:1px solid #e2e8f0}',
      '.dark .ox-expand>td{background:rgba(30,41,59,.5);border-color:#334155}',
      '.ox-eng{color:#1e3a5f;font-weight:500;text-decoration:underline dotted;text-underline-offset:3px}',
      '.dark .ox-eng{color:#93c5fd}',
      '.ox-check{width:1.05rem;height:1.05rem;accent-color:#1e3a5f;cursor:pointer;flex-shrink:0}',
      '.ox-check:disabled{cursor:default}',
      '.ox-item{display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;border-top:1px solid #f1f5f9}',
      '.dark .ox-item{border-color:#1e293b}',
      '.ox-item-part{background:#fffbeb}.dark .ox-item-part{background:rgba(245,158,11,.08)}',
      '.ox-supbox{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;justify-content:flex-end}',
      '.ox-supq{width:5.2rem;border:1px solid #cbd5e1;border-radius:.4rem;padding:.25rem .4rem;font-size:.85rem;text-align:right;background:#fff;color:inherit}.dark .ox-supq{background:#0f172a;border-color:#334155}',
      '.ox-pend{font-size:.72rem;font-weight:600;color:#b45309;background:#fef3c7;border-radius:999px;padding:0 .45rem}',
      '.ox-stock{display:inline-block;margin-top:.15rem;font-size:.72rem;font-weight:600;border-radius:.35rem;padding:0 .4rem}',
      '.ox-stock-ok{background:#f0fdf4;color:#166534}.ox-stock-low{background:#fffbeb;color:#92400e}.ox-stock-none{background:#fef2f2;color:#991b1b}',
      '.ox-line-stock{display:block;font-size:.72rem;margin-top:.2rem}',
      '.ox-po-prev{border:1px solid #e2e8f0;border-radius:.6rem;overflow:hidden;background:#f8fafc}.ox-po-prev iframe{width:100%;height:520px;border:0;display:block}.ox-po-prev img{max-width:100%;display:block;margin:0 auto}',
      '.dark .ox-po-prev{border-color:#334155;background:#0f172a}',
      '.ox-rtab{padding:.45rem .9rem;font-size:.85rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.ox-rtab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .ox-rtab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.ox-reg-t td{border-top:1px solid #f1f5f9;vertical-align:top}.dark .ox-reg-t td{border-color:#1e293b}',
      '.ox-reg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.6rem;align-items:start}',
      '.ox-chip{border:1px solid #cbd5e1;border-radius:999px;padding:.15rem .6rem;font-size:.75rem;font-weight:600;cursor:pointer;background:#fff}.ox-chip:hover{filter:brightness(.96)}',
      '.ox-item:first-child{border-top:0}',
      '.ox-item-on{background:rgba(34,197,94,.08)}',
      '.ox-overdue{color:#dc2626;font-weight:600}',
      '.ox-dialog{max-width:64rem}',
      '.ox-ic{display:inline-flex;vertical-align:-3px}.ox-ic svg{display:block}',
      '.ox-items{border-top:1px solid #e2e8f0;padding-top:.9rem}.dark .ox-items{border-color:#1e293b}',
      '.ox-items-h{display:flex;justify-content:space-between;align-items:flex-end;gap:.6rem;flex-wrap:wrap;margin-bottom:.6rem}',
      '.ox-items-t{font-size:1rem;font-weight:700;color:#0f172a;margin-right:.5rem}.dark .ox-items-t{color:#f1f5f9}.ox-items-s{font-size:.75rem;color:#64748b}',
      '.ox-items-acts{display:flex;gap:.45rem;flex-wrap:wrap}',
      '.ox-ibtn{display:inline-flex;align-items:center;gap:.4rem;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:.6rem;padding:.5rem .85rem;font-size:.84rem;font-weight:600;cursor:pointer}',
      '.ox-ibtn:hover{background:#f8fafc;border-color:#94a3b8}.ox-ibtn.sm{padding:.4rem .65rem;font-size:.78rem}.dark .ox-ibtn{background:#1e293b;border-color:#334155;color:#e2e8f0}',
      '.ox-card{position:relative;border:1px solid #e2e8f0;border-radius:.8rem;padding:1.05rem .9rem .8rem;margin:.9rem 0 .4rem;background:#fff}.dark .ox-card{background:#0f172a;border-color:#334155}',
      '.ox-card-h{position:absolute;top:-.7rem;left:.75rem;right:.6rem;display:flex;align-items:center;gap:.4rem}',
      '.ox-badge{background:#1e3a8a;color:#fff;border-radius:999px;padding:.12rem .6rem;font-size:.72rem;font-weight:700}',
      '.ox-tag{background:#f1f5f9;color:#475569;border-radius:999px;padding:.08rem .5rem;font-size:.68rem;font-weight:600}.dark .ox-tag{background:#1e293b;color:#cbd5e1}',
      '.ox-x{margin-left:auto;border:1px solid #e2e8f0;background:#fff;color:#94a3b8;border-radius:.5rem;padding:.2rem .35rem;cursor:pointer}.ox-x:hover{color:#dc2626;border-color:#fecaca}.dark .ox-x{background:#0f172a;border-color:#334155}',
      '.ox-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.6rem .75rem}.ox-grid .w2{grid-column:span 2}',
      '@media(max-width:760px){.ox-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ox-grid .w2{grid-column:span 2}}',
      '.ox-f{display:block}.ox-f>span{display:block;font-size:.74rem;font-weight:600;color:#475569;margin-bottom:.25rem}.ox-f i{color:#dc2626;font-style:normal}.dark .ox-f>span{color:#94a3b8}',
      '.ox-amt{padding:.55rem .1rem;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}.dark .ox-amt{color:#f1f5f9}',
      '.ox-rel{position:relative}.ox-sugg-box{position:absolute;z-index:30;left:0;right:0;top:calc(100% + 4px);background:#fff;border:1px solid #cbd5e1;border-radius:.6rem;box-shadow:0 12px 30px -10px rgba(15,23,42,.3);max-height:300px;overflow:auto;padding:.25rem}',
      '.dark .ox-sugg-box{background:#0f172a;border-color:#334155}.ox-sugg{display:block;width:100%;text-align:left;padding:.45rem .6rem;border-radius:.45rem;background:none;border:0;cursor:pointer}.ox-sugg:hover{background:#f1f5f9}.dark .ox-sugg:hover{background:#1e293b}',
      '.ox-sugg-l{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap;font-size:.84rem}.ox-sugg-d{font-size:.74rem;color:#64748b;margin-top:.1rem}',
      '.ox-chip{font-size:.66rem;font-weight:700;border-radius:999px;padding:.05rem .45rem;background:#e0e7ff;color:#3730a3}.ox-chip.g{background:#f1f5f9;color:#475569}.ox-chip.ok{background:#dcfce7;color:#166534}.ox-chip.no{background:#fee2e2;color:#991b1b}',
      '.ox-items-tot{display:flex;justify-content:space-between;padding:.55rem .2rem 0;font-size:.85rem;color:#475569}',
      '.ox-line-stock{margin-top:.45rem}',
      '.ox-expand-grid{display:grid;gap:1rem}',
      '@media(min-width:1024px){.ox-expand-grid{grid-template-columns:3fr 2fr}}',
      '.ox-muted-link{font-size:.75rem;font-weight:500;color:#1e3a5f;cursor:pointer;background:none;border:0;padding:0}',
      '.dark .ox-muted-link{color:#93c5fd}',
      '.ox-btn-disabled{opacity:.5;cursor:not-allowed}',
      '.ox-pl{padding-left:1rem}',
      '.ox-expand-inner{position:sticky;left:1rem;text-align:left}',
      // Tailwind utilities this file already used that the compiled CSS lacks:
      '.mr-auto{margin-right:auto}.mt-5{margin-top:1.25rem}',
      '.hover\\:text-red-500:hover{color:#ef4444}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /** Tone class for an inline status dropdown, so it reads like a badge at a glance. */
  function deliveryTone(s) { return { DELIVERED: 'ox-good', PARTIALLY_DELIVERED: 'ox-warn', NOT_DELIVERED: 'ox-bad' }[s] || 'ox-idle'; }
  function proformaTone(s) { return s === 'CONFIRMED' ? 'ox-good' : 'ox-idle'; }

  /** Re-derives the list-only summary fields from a full order returned by a PATCH/GET. */
  function toListRow(o) {
    var items = o.items || [];
    o.productSummary = items.map(function (i) { return i.productName; }).join(', ');
    o.itemCount = items.length;
    o.suppliedCount = items.filter(function (i) { return i.supplied; }).length;
    return o;
  }

  function api(method, path, body) {
    var opts = {
      method: method,
      headers: { Authorization: 'Bearer ' + (token() || '') }
    };
    if (body instanceof FormData) {
      opts.body = body; // browser sets the multipart Content-Type + boundary itself
    } else if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + '/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(((j && j.message) || 'Request failed') + (j && j.error ? ' — ' + j.error : '')); // .error only reaches admins
        return j;
      });
    });
  }

  // Line icons (stroke SVG) for a cleaner look than emoji
  var ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>', file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12l5 5L20 7"/>'
  };
  function ic(name) {
    var s = document.createElement('span'); s.className = 'ox-ic'; s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return s;
  }
  function downloadFile(path, fallback) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) throw new Error('Download failed');
      var m = /filename="?([^";]+)"?/.exec(r.headers.get('Content-Disposition') || '');
      return r.blob().then(function (b) { var u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = m ? m[1] : fallback; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); });
    }).catch(function (e) { alert(e.message); });
  }
  function fmtQty(v) { v = Number(v) || 0; return (Math.round(v * 100) / 100).toLocaleString('en-IN'); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function fmtDate(d) {
    if (!d) return '—';
    var s = /[Zz]|[+-]\d\d:?\d\d$/.test(d) ? d : String(d).replace(' ', 'T');
    var dt = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function labelOf(pairs, v) { var m = pairs.filter(function (p) { return p[0] === v; })[0]; return m ? m[1] : v; }

  var INPUT = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
              'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 ' +
              'focus:outline-none focus:ring-1 focus:ring-primary';
  var selectCls = INPUT;

  // ── list page ────────────────────────────────────────────────────────
  function mount(root) {
    injectCss();
    var all = [];
    var from = '', to = '', engineerId = '', deliveryStatus = '', orderType = '', procurementStatus = '', proformaStatus = '', brandF = '', firmF = '', searchQ = (function () { try { return new URLSearchParams(location.search).get('q') || ''; } catch (e) { return ''; } })();
    var engineers = [];
    var expanded = {};    // orderId -> true while its row is open
    var presets = {};     // orderId -> delivery status picked from the dropdown that needs the materials panel
    var fullOrders = {};  // orderId -> full order (with items), fetched on expand
    var flash = '';

    var stats = el('div', { class: 'ox-stats' });
    var filters = el('div', { class: 'ox-filters' });
    var flashBox = el('div');
    var regBox = el('div');
    // Plain wrapper — loading/error/table each render their own card inside it.
    var body = el('div', {}, [el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' })]);

    root.appendChild(el('div', { class: 'space-y-5' }, [
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('h1', { class: 'page-title', text: 'Orders' }),
        el('div', { class: 'flex gap-2 flex-wrap' }, [
          el('button', { class: 'btn-secondary', id: 'ox-reg-btn', onclick: function () { toggleReg(); } }, [ic('repeat'), ' Stock reminders & regular items']),
          el('button', { class: 'btn-primary', onclick: function () { openOrderDialog(null, load); } }, [ic('plus'), ' New order'])
        ])
      ]),
      regBox, stats, filters, flashBox, body
    ]));
    function toggleReg(force) {
      var open = force !== undefined ? force : !regBox.firstChild;
      regBox.innerHTML = '';
      if (open) regBox.appendChild(regularPanel({ tab: 'restock', onClose: function () { toggleReg(false); if (location.hash === '#restock') history.replaceState(null, '', location.pathname); } }));
    }
    if (location.hash === '#restock') setTimeout(function () { toggleReg(true); }, 0);
    window.addEventListener('hashchange', function () { if (location.hash === '#restock') toggleReg(true); });

    function showFlash(msg) {
      flash = msg || '';
      flashBox.innerHTML = '';
      if (flash) {
        flashBox.appendChild(el('div', {
          class: 'text-sm px-3 py-2 rounded-lg bg-red-50 text-red-600 flex items-center justify-between gap-3'
        }, [el('span', { text: flash }), el('button', { class: 'ox-muted-link', text: 'Dismiss', onclick: function () { showFlash(''); } })]));
      }
    }

    function query() {
      var q = [];
      if (from) q.push('from=' + from);
      if (to) q.push('to=' + to);
      if (engineerId) q.push('engineerId=' + encodeURIComponent(engineerId));
      if (deliveryStatus) q.push('deliveryStatus=' + deliveryStatus);
      if (orderType) q.push('orderType=' + orderType);
      if (procurementStatus) q.push('procurementStatus=' + procurementStatus);
      if (proformaStatus) q.push('proformaStatus=' + proformaStatus);
      if (brandF) q.push('brand=' + encodeURIComponent(brandF));
      if (firmF) q.push('firm=' + firmF);
      if (searchQ) q.push('search=' + encodeURIComponent(searchQ));
      q.push('limit=100');
      return q.join('&');
    }

    function load() {
      body.innerHTML = ''; body.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' }));
      api('GET', '/orders?' + query()).then(function (res) {
        all = (res.data && res.data.items) || [];
        fullOrders = {};
        renderStats();
        renderTable();
      }).catch(function (e) {
        body.innerHTML = '';
        body.appendChild(el('div', { class: 'card p-10 text-center text-muted' }, [
          el('p', { class: 'font-medium text-red-600', text: 'Could not load orders' }),
          el('p', { class: 'text-sm mt-1', text: e.message }),
          el('button', { class: 'btn-secondary btn-sm mt-4', text: 'Try again', onclick: load })
        ]));
      });
    }

    /** Swaps an updated order into the list and redraws. */
    function applyUpdate(order) {
      toListRow(order);
      fullOrders[order.id] = order;
      all = all.map(function (o) { return o.id === order.id ? order : o; });
      renderStats();
      renderTable();
    }

    function patchOrder(id, path, payload) {
      showFlash('');
      return api('PATCH', '/orders/' + id + '/' + path, payload).then(function (res) {
        applyUpdate(res.data.order);
        return res.data.order;
      }).catch(function (e) { showFlash(e.message); renderTable(); throw e; });
    }

    function renderStats() {
      stats.innerHTML = '';
      function count(fn) { return String(all.filter(fn).length); }
      [['Total orders', String(all.length)],
       ['Pending', count(function (o) { return o.deliveryStatus === 'PENDING'; })],
       ['Partially complete', count(function (o) { return o.deliveryStatus === 'PARTIALLY_DELIVERED'; })],
       ['Delivered', count(function (o) { return o.deliveryStatus === 'DELIVERED'; })],
       ['Not delivered', count(function (o) { return o.deliveryStatus === 'NOT_DELIVERED'; })],
       ['Proforma confirmed', count(function (o) { return o.proformaStatus === 'CONFIRMED'; })]
      ].forEach(function (s) {
        stats.appendChild(el('div', { class: 'card p-4' }, [
          el('p', { class: 'text-xs text-muted', text: s[0] }),
          el('p', { class: 'mt-1 text-xl font-bold text-slate-900 dark:text-slate-100', text: s[1] })
        ]));
      });
    }

    function renderFilters() {
      filters.innerHTML = '';
      function labelled(label, control) {
        return el('label', { class: 'block' }, [el('span', { class: 'text-xs text-muted', text: label }), el('div', { class: 'mt-1' }, [control])]);
      }
      function sel(first, pairs, value, onPick) {
        var s2 = el('select', { class: selectCls }, [el('option', { value: '', text: first })]
          .concat(pairs.map(function (p) { return el('option', { value: p[0], text: p[1] }); })));
        s2.value = value;
        s2.addEventListener('change', function () { onPick(s2.value); load(); });
        return s2;
      }
      var fromI = el('input', { type: 'date', class: INPUT });
      fromI.value = from;
      fromI.addEventListener('change', function () { from = fromI.value; load(); });
      var toI = el('input', { type: 'date', class: INPUT });
      toI.value = to;
      toI.addEventListener('change', function () { to = toI.value; load(); });

      var srch = el('input', { type: 'search', class: INPUT, id: 'ox-search', placeholder: 'ORD-2611-0005, customer, PO no.', value: searchQ });
      var st;
      srch.addEventListener('input', function () { clearTimeout(st); st = setTimeout(function () { searchQ = srch.value.trim(); load(); }, 300); });
      [labelled('Search', srch), labelled('From', fromI), labelled('To', toI),
       labelled('Sales engineer', sel('All engineers', engineers.map(function (e2) { return [e2.id, e2.name]; }), engineerId, function (v) { engineerId = v; })),
       labelled('Delivery', sel('All delivery statuses', DELIVERY_STATUSES, deliveryStatus, function (v) { deliveryStatus = v; })),
       labelled('Price / proforma', sel('All', PROFORMA_STATUSES, proformaStatus, function (v) { proformaStatus = v; })),
       labelled('Procurement', sel('All procurement statuses', PROCUREMENT_STATUSES, procurementStatus, function (v) { procurementStatus = v; })),
       labelled('Type', sel('All types', ORDER_TYPES, orderType, function (v) { orderType = v; })),
       labelled('TMS / APJ', sel('Both companies', [['TMS', 'TMS'], ['APJ', 'APJ']], firmF, function (v) { firmF = v; })),
       labelled('Brand', sel('All brands', BRANDS.map(function (b) { return [b, b]; }), brandF, function (v) { brandF = v; })),
       el('div', { class: 'flex items-end' }, [el('button', {
         class: 'btn-secondary w-full', text: 'Clear filters',
         onclick: function () { from = to = engineerId = deliveryStatus = orderType = procurementStatus = proformaStatus = brandF = firmF = searchQ = ''; renderFilters(); load(); }
       })])
      ].forEach(function (n) { filters.appendChild(n); });
    }

    function stop(e) { e.stopPropagation(); }
    // ⧉ copy the order number
    function copyNoBtn(no) {
      var b = el('button', { type: 'button', class: 'ox-copy', title: 'Copy ' + no, 'aria-label': 'Copy ' + no, 'data-copy-no': no }, [ic('copy')]);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var done = function () { b.innerHTML = ''; b.appendChild(ic('check')); setTimeout(function () { b.innerHTML = ''; b.appendChild(ic('copy')); }, 1500); };
        var fb = function () { var t = document.createElement('textarea'); t.value = no; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (x) { prompt('Copy this number:', no); } t.remove(); };
        try { if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(no).then(done, fb); else fb(); } catch (x) { fb(); }
      });
      return b;
    }

    function proformaCell(o) {
      if (!canEditOrder(o)) {
        return el('span', { class: 'badge ' + PROFORMA_BADGE[o.proformaStatus], text: labelOf(PROFORMA_STATUSES, o.proformaStatus) });
      }
      var s2 = el('select', { class: 'ox-sel ' + proformaTone(o.proformaStatus), 'aria-label': 'Price / proforma confirmed', onclick: stop },
        PROFORMA_STATUSES.map(function (p) { return el('option', { value: p[0], text: p[1] }); }));
      s2.value = o.proformaStatus || 'NOT_CONFIRMED';
      s2.addEventListener('change', function () { patchOrder(o.id, 'proforma', { proformaStatus: s2.value }).catch(function () {}); });
      return s2;
    }

    // Admins mark the whole order ordered with the supplier here (every line follows);
    // marking single lines in the pop-up rolls up to "Ordered" once all lines are ordered.
    function procurementCell(o) {
      if (!isAdmin()) {
        return el('span', { class: 'badge ' + PROCUREMENT_BADGE[o.procurementStatus], text: labelOf(PROCUREMENT_STATUSES, o.procurementStatus) });
      }
      var s2 = el('select', { class: 'ox-sel ' + (o.procurementStatus === 'ORDERED' ? 'ox-good' : 'ox-idle'), 'aria-label': 'Procurement status', 'data-order-proc': o.id, onclick: stop },
        PROCUREMENT_STATUSES.map(function (p) { return el('option', { value: p[0], text: p[1] }); }));
      s2.value = o.procurementStatus || 'NOT_ORDERED';
      s2.addEventListener('change', function () { patchOrder(o.id, 'procurement', { procurementStatus: s2.value }).catch(function () {}); });
      return s2;
    }

    function deliveryCell(o) {
      if (!canEditOrder(o)) {
        return el('span', { class: 'badge ' + STATUS_BADGE[o.deliveryStatus], text: labelOf(DELIVERY_STATUSES, o.deliveryStatus) });
      }
      var s2 = el('select', { class: 'ox-sel ' + deliveryTone(o.deliveryStatus), 'aria-label': 'Delivery status', onclick: stop },
        DELIVERY_STATUSES.map(function (p) { return el('option', { value: p[0], text: p[1] }); }));
      s2.value = o.deliveryStatus;
      s2.addEventListener('change', function () {
        var v = s2.value;
        if (v === 'DELIVERED' || v === 'PENDING') {
          patchOrder(o.id, 'delivery', { deliveryStatus: v }).catch(function () {});
        } else {
          // Partial / not delivered need the materials + a reason — open the row for that.
          presets[o.id] = v;
          openView(o);
        }
      });
      return s2;
    }

    function etaCell(o) {
      var overdue = o.expectedDeliveryDate && o.deliveryStatus !== 'DELIVERED' && String(o.expectedDeliveryDate).slice(0, 10) < todayIso();
      if (isAdmin()) {
        var d = el('input', { type: 'date', class: 'ox-sel ' + (overdue ? 'ox-bad' : 'ox-idle'), 'aria-label': 'Expected date', onclick: stop,
                              title: overdue ? 'Overdue' : '' });
        d.value = o.expectedDeliveryDate ? String(o.expectedDeliveryDate).slice(0, 10) : '';
        d.addEventListener('change', function () { patchOrder(o.id, 'eta', { expectedDeliveryDate: d.value || null }).catch(function () {}); });
        return d;
      }
      if (!o.expectedDeliveryDate) return el('span', { class: 'text-muted', text: '—' });
      return el('span', { class: overdue ? 'ox-overdue' : '', text: fmtDate(o.expectedDeliveryDate) + (overdue ? ' · overdue' : '') });
    }

    function renderTable() {
      var heads = ['', 'Order no.', 'Customer', 'TMS / APJ', 'Sales engineer', 'Type', 'Brand', 'Order date', 'Expected date', 'Price / proforma', 'Procurement', 'Delivery', 'Invoice', 'Materials', 'PDF'];
      var tbody = el('tbody');
      if (!all.length) {
        tbody.appendChild(el('tr', {}, [el('td', {
          colspan: String(heads.length), class: 'px-4 py-10 text-center text-muted', text: 'No orders found.'
        })]));
      } else {
        all.forEach(function (o) {
          var open = !!expanded[o.id];
          var procCell = el('td', { class: 'px-3 py-3 ox-nowrap' }, [procurementCell(o)]);
          var supplied = o.itemCount ? (o.suppliedCount || 0) + ' / ' + o.itemCount + ' supplied' : '—';
          var tr = el('tr', { class: 'table-row cursor-pointer' + (open ? ' ox-open' : ''), 'aria-expanded': open ? 'true' : 'false' }, [
            el('td', { class: 'ox-pl py-3' }, [el('span', { class: 'ox-caret', text: '▸' })]),
            el('td', { class: 'px-3 py-3 ox-nowrap', 'data-order-no': o.orderNo || '' }, o.orderNo ? [el('span', { class: 'ox-no', text: o.orderNo }), copyNoBtn(o.orderNo)] : [el('span', { class: 'text-muted', text: '—' })]),
            el('td', { class: 'px-3 py-3 font-medium ox-nowrap', text: (o.customer && o.customer.companyName) || '—' }),
            el('td', { class: 'px-3 py-3', 'data-order-firm-cell': o.id }, [o.firm ? el('span', { class: 'badge ' + (o.firm === 'APJ' ? 'badge-green' : 'badge-blue'), text: o.firm }) : el('span', { class: 'text-muted', text: '—' })]),
            el('td', { class: 'px-3 py-3 ox-nowrap' }, [el('span', { class: 'ox-eng', title: 'Show materials', text: (o.engineer && o.engineer.name) || '—' })]),
            el('td', { class: 'px-3 py-3' }, [el('span', { class: 'badge ' + TYPE_BADGE[o.orderType], text: labelOf(ORDER_TYPES, o.orderType) })]),
            el('td', { class: 'px-3 py-3', 'data-order-brands': '' }, (o.brands && o.brands.length ? o.brands : (fullOrders[o.id] && fullOrders[o.id].items ? fullOrders[o.id].items.map(function (i) { return i.brand; }).filter(function (b, k, a) { return b && a.indexOf(b) === k; }) : []))
              .map(function (b) { return el('span', { class: 'badge badge-blue', style: 'margin:0 .2rem .2rem 0', text: b }); }).concat(o.brands && o.brands.length ? [] : [el('span', { class: 'text-muted', text: '—' })])),
            el('td', { class: 'px-3 py-3 ox-nowrap', text: fmtDate(o.orderDate) }),
            el('td', { class: 'px-3 py-3 ox-nowrap' }, [etaCell(o)]),
            el('td', { class: 'px-3 py-3' }, [proformaCell(o)]),
            procCell,
            el('td', { class: 'px-3 py-3' }, [deliveryCell(o)]),
            el('td', { class: 'px-3 py-3 ox-nowrap', 'data-order-inv': o.id }, (o.invoiceNos || []).length ? o.invoiceNos.map(function (n) { return el('div', { class: 'text-xs font-semibold', text: '🧾 ' + n }); }) : [el('span', { class: 'text-muted', text: '—' })]),
            el('td', { class: 'px-3 py-3 ox-nowrap text-muted', title: o.productSummary || '', text: supplied }),
            el('td', { class: 'px-3 py-3 ox-nowrap' }, [pdfButton(o), isSuperAdminUser() ? el('button', { class: 'btn-secondary btn-sm', type: 'button', 'data-order-del': o.id, title: 'Delete this order (Super Admin)', style: 'margin-left:.35rem;color:#b91c1c', text: '🗑', onclick: function (e) {
              e.stopPropagation();
              if (!confirm('Delete the order for ' + ((o.customer && o.customer.companyName) || 'this customer') + '? This cannot be undone.')) return;
              api('DELETE', '/orders/' + o.id).then(function () { load(); }).catch(function (er) { alert(er.message); });
            } }) : null])
          ]);
          tr.addEventListener('click', function () { openView(o); });
          tbody.appendChild(tr);
          if (open) tbody.appendChild(expandedRow(o, heads.length));
        });
      }
      var scroller = el('div', { class: 'overflow-x-auto ox-scroll' }, [
        el('table', { class: 'w-full text-sm ox-lock' }, [
          el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [
            el('tr', {}, heads.map(function (h) { return el('th', { class: 'table-head text-left px-3 py-3 ox-nowrap', text: h }); }))
          ]),
          tbody
        ])
      ]);
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'card overflow-hidden' }, [scroller]));
      fitExpanded(scroller);
    }

    // The table can be wider than the screen (it scrolls sideways); keep an
    // expanded row's panel pinned to the visible width so nothing in it is
    // cut off or needs scrolling to reach.
    function fitExpanded(scroller) {
      var w = scroller.clientWidth;
      var panels = scroller.querySelectorAll('.ox-expand-inner');
      for (var i = 0; i < panels.length; i++) panels[i].style.width = Math.max(260, w - 32) + 'px';
    }
    window.addEventListener('resize', function () {
      var sc = body.querySelector('.ox-scroll');
      if (sc) fitExpanded(sc);
    });

    /** The order in a pop-up: materials supplied + order facts, with ✎ Edit order (opens the edit form). */
    function openView(o) {
      document.querySelectorAll('.ox-view').forEach(function (m) { m.remove(); });
      var overlay = el('div', { class: 'ox-view fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4', 'data-order-view': o.id });
      var card = el('div', { class: 'card w-full p-5 rounded-b-none sm:rounded-xl max-h-[92vh] overflow-y-auto', style: 'max-width:1100px', role: 'dialog', 'aria-modal': 'true' });
      overlay.appendChild(card);
      function close() { delete presets[o.id]; overlay.remove(); }
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && overlay.parentNode) { close(); document.removeEventListener('keydown', esc); } });
      document.body.appendChild(overlay);
      function draw(order) {
        card.innerHTML = '';
        var me = currentUser() || {};
        var canEdit = isAdmin() || (order.engineer && order.engineer.id === me.id);
        card.appendChild(el('div', { class: 'flex items-start justify-between gap-3 mb-4 flex-wrap' }, [
          el('div', {}, [
            el('h2', { class: 'section-title mb-0', text: (order.customer && order.customer.companyName) || 'Order' }),
            order.orderNo ? el('div', { class: 'flex items-center gap-1 mt-0.5', 'data-view-order-no': order.orderNo }, [el('span', { class: 'ox-no', style: 'font-size:.9rem', text: order.orderNo }), copyNoBtn(order.orderNo)]) : null,
            el('p', { class: 'text-xs text-muted mt-0.5', text: fmtDate(order.orderDate) + ' · ' + ((order.engineer && order.engineer.name) || '') + (order.poNumber ? ' · PO ' + order.poNumber : '') }),
            el('div', { class: 'flex items-center gap-2 flex-wrap mt-2' }, [
              order.firm ? el('span', { class: 'badge ' + (order.firm === 'APJ' ? 'badge-green' : 'badge-blue'), 'data-view-firm': order.firm, text: order.firm }) : el('span', { class: 'badge badge-red', text: 'TMS / APJ not set' }),
              el('span', { class: 'badge ' + TYPE_BADGE[order.orderType], text: labelOf(ORDER_TYPES, order.orderType) }),
              el('span', { class: 'badge ' + PROCUREMENT_BADGE[order.procurementStatus], text: labelOf(PROCUREMENT_STATUSES, order.procurementStatus) }),
              el('span', { class: 'badge ' + STATUS_BADGE[order.deliveryStatus], text: labelOf(DELIVERY_STATUSES, order.deliveryStatus) }),
              el('span', { class: 'badge ' + PROFORMA_BADGE[order.proformaStatus], text: 'Proforma: ' + labelOf(PROFORMA_STATUSES, order.proformaStatus) })
            ])
          ]),
          el('div', { class: 'flex items-center gap-2' }, [
            canEdit ? el('button', { class: 'btn-primary btn-sm', type: 'button', id: 'ox-view-edit', onclick: function () { close(); openOrderDialog(order.id, load, { edit: true }); } }, [ic('edit'), ' Edit order']) : null,
            el('button', { class: 'p-1 rounded text-slate-400 hover:text-slate-600', 'aria-label': 'Close', onclick: close }, [ic('x')])
          ])
        ]));
        card.appendChild(orderDetailPanel(order, {
          preset: presets[order.id],
          onSaved: function (updated) { delete presets[order.id]; applyUpdate(updated); draw(updated); },
          onCancelPreset: function () { delete presets[order.id]; draw(order); },
          onOpen: function () { close(); openOrderDialog(order.id, load); },
          onInvoices: function (invs) {
            order.invoices = invs; fullOrders[order.id] = order;
            all = all.map(function (x) { if (x.id === order.id) x.invoiceNos = invs.map(function (i) { return i.invoiceNo; }); return x; });
            renderTable();
          }
        }));
      }
      if (fullOrders[o.id]) draw(fullOrders[o.id]);
      else card.appendChild(el('p', { class: 'p-6 text-center text-muted', text: 'Loading…' }));
      api('GET', '/orders/' + o.id).then(function (res) { fullOrders[o.id] = res.data.order; if (overlay.parentNode) draw(res.data.order); })
        .catch(function (e) { if (!fullOrders[o.id]) { card.innerHTML = ''; card.appendChild(el('p', { class: 'p-6 text-center text-red-600', text: e.message })); } });
    }

    function expandedRow(o, span) {
      var inner = el('div', { class: 'ox-expand-inner' });
      var cell = el('td', { colspan: String(span), class: 'py-4' }, [inner]);
      var tr = el('tr', { class: 'ox-expand' }, [cell]);
      function fill(order) {
        inner.innerHTML = '';
        inner.appendChild(orderDetailPanel(order, {
          preset: presets[order.id],
          onSaved: function (updated) { delete presets[order.id]; applyUpdate(updated); },
          onCancelPreset: function () { delete presets[order.id]; renderTable(); },
          onOpen: function () { openOrderDialog(order.id, load); }
        }));
      }
      if (fullOrders[o.id]) {
        fill(fullOrders[o.id]);
      } else {
        inner.appendChild(el('p', { class: 'text-sm text-muted', text: 'Loading materials…' }));
        api('GET', '/orders/' + o.id).then(function (res) {
          fullOrders[o.id] = res.data.order;
          fill(res.data.order);
        }).catch(function (e) {
          inner.innerHTML = '';
          inner.appendChild(el('p', { class: 'text-sm text-red-600', text: e.message }));
        });
      }
      return tr;
    }

    api('GET', '/orders/engineers').then(function (res) {
      engineers = (res.data && res.data.engineers) || [];
      renderFilters();
    }).catch(function () {});

    renderFilters();
    loadBrands().then(renderFilters);
    load();
  }

  // ── PO document: open / download with the login (a plain link has no token) ──
  function fetchDoc(o) {
    return fetch(API + o.poDocument.url, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Could not open the document'); });
      return r.blob();
    });
  }
  function openDoc(o, download) {
    return fetchDoc(o).then(function (b) {
      var u = URL.createObjectURL(b);
      if (download) {
        var a = document.createElement('a'); a.href = u; a.download = o.poDocument.originalName || 'purchase-order';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      } else { window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 120000); }
    }).catch(function (e) { alert(e.message); });
  }
  function docButtons(o) {
    function b(text, dl, attr) {
      var x = el('button', { class: 'btn-secondary btn-sm', type: 'button', text: text });
      x.setAttribute(attr, o.id);
      x.addEventListener('click', function (e) { e.stopPropagation(); openDoc(o, dl); });
      return x;
    }
    return el('div', { class: 'flex items-center gap-2 flex-wrap' }, [
      el('span', { class: 'text-sm font-medium', text: '📄 ' + o.poDocument.originalName }),
      b('View', false, 'data-po-view'), b('⬇ Download', true, 'data-po-dl')
    ]);
  }
  /** Inline preview of the uploaded PO (PDF or image) inside the order. */
  function docPreview(o) {
    var box = el('div', { class: 'ox-po-prev', 'data-po-preview': o.id }, [el('p', { class: 'text-xs text-muted p-3', text: 'Loading the purchase order…' })]);
    var mime = (o.poDocument.mime || '').toLowerCase();
    if (!/pdf|image/.test(mime)) { box.innerHTML = ''; return null; }
    fetchDoc(o).then(function (b) {
      var u = URL.createObjectURL(b);
      box.innerHTML = '';
      box.appendChild(/image/.test(mime) ? el('img', { src: u, alt: 'Purchase order' }) : el('iframe', { src: u, title: 'Purchase order' }));
    }).catch(function (e) { box.innerHTML = ''; box.appendChild(el('p', { class: 'text-xs text-red-600 p-3', text: e.message })); });
    return box;
  }

  // ── Regular items & restock reminders ──────────────────────────────
  var REG_STATUS = { OUT: ['Out of stock', 'ox-stock-none'], NOT_STOCKED: ['Not in stock list', 'ox-stock-none'], LOW: ['Restock', 'ox-stock-low'], OK: ['Enough stock', 'ox-stock-ok'] };
  function regBadge(it) {
    var s = REG_STATUS[it.status] || [it.status, ''];
    return el('span', { class: 'ox-stock ' + s[1], text: s[0] + (it.shortBy ? ' · short ' + fmtQty(it.shortBy) : '') });
  }
  function dueText(it) {
    if (!it.nextExpected) return it.everyDays ? 'every ' + it.everyDays + ' days' : '—';
    var d = it.dueInDays;
    return fmtDate(it.nextExpected) + (d < 0 ? ' (overdue ' + (-d) + ' d)' : d === 0 ? ' (today)' : ' (in ' + d + ' d)');
  }
  function stockText(st) { return st ? 'hand ' + fmtQty(st.hand) + ' · free ' + fmtQty(st.free) + ' of ' + fmtQty(st.total) : '—'; }
  function table(heads, rows) {
    return el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-sm ox-reg-t' }, [
      el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { class: 'table-head text-left px-3 py-2 ox-nowrap', text: h }); }))]),
      el('tbody', {}, rows)
    ])]);
  }
  function td(x, cls) { return el('td', { class: 'px-3 py-2 ' + (cls || '') }, typeof x === 'string' || typeof x === 'number' ? [String(x)] : [x]); }

  function regularPanel(opts) {
    var tab = opts.tab || 'restock';
    var card = el('div', { class: 'card p-4 space-y-3', id: 'ox-reg' });
    var tabs = el('div', { class: 'flex gap-1 border-b border-slate-200 dark:border-slate-700' });
    var body = el('div', {});
    var TABS = [['restock', 'Restock reminders'], ['low', 'Low stock'], ['regular', 'Customer regular items']];
    function paintTabs() {
      tabs.innerHTML = '';
      TABS.forEach(function (t) {
        tabs.appendChild(el('button', { class: 'ox-rtab' + (tab === t[0] ? ' on' : ''), type: 'button', 'data-rtab': t[0], text: t[1], onclick: function () { tab = t[0]; paintTabs(); paint(); } }));
      });
    }
    function loading() { body.innerHTML = ''; body.appendChild(el('p', { class: 'text-sm text-muted', text: 'Loading…' })); }
    function fail(e) { body.innerHTML = ''; body.appendChild(el('p', { class: 'text-sm text-red-600', text: e.message })); }
    function paint() {
      if (tab === 'restock') return paintRestock();
      if (tab === 'low') return paintLow();
      paintRegular();
    }
    function paintRestock() {
      loading();
      api('GET', '/regular-items/restock?days=30').then(function (res) {
        var d = res.data; body.innerHTML = '';
        body.appendChild(el('p', { class: 'text-xs text-muted mb-2', text: 'Regular items of each company (added by hand, or ordered 2+ times in the last 12 months) whose free stock is below what that company usually takes, due in the next 30 days.' }));
        if (!d.items.length) { body.appendChild(el('p', { class: 'text-sm text-emerald-700 py-3', text: '✓ Nothing to restock — every regular item has enough stock.' })); return; }
        body.appendChild(el('p', { class: 'text-sm font-semibold mt-1 mb-1', text: 'To order (all companies together)' }));
        body.appendChild(table(['Item', 'Needed', 'Free stock', 'To order', 'For'], d.byItem.map(function (x) {
          return el('tr', { 'data-restock-item': x.itemCode }, [td(el('span', {}, [el('b', { text: x.itemCode }), el('span', { class: 'block text-xs text-muted', text: [x.productName, x.brand].filter(Boolean).join(' · ') })])),
            td(fmtQty(x.need)), td(x.stock ? fmtQty(Math.max(0, x.stock.free)) : '0'), td(el('b', { class: 'text-amber-700', text: fmtQty(x.toOrder) })), td(x.customers.join(', '), 'text-xs')]);
        })));
        body.appendChild(el('p', { class: 'text-sm font-semibold mt-4 mb-1', text: 'By company' }));
        body.appendChild(table(['Company', 'Item', 'Usual qty', 'Keep', 'Stock', 'Status', 'Last ordered', 'Next expected'], d.items.map(function (it) {
          return el('tr', { 'data-restock': it.customerName + '|' + it.itemCode }, [td(it.customerName, 'font-medium ox-nowrap'),
            td(el('span', {}, [el('b', { text: it.itemCode }), el('span', { class: 'block text-xs text-muted', text: it.productName || '' })])),
            td(it.usualQty == null ? '—' : fmtQty(it.usualQty)), td(it.keepQty == null ? '—' : fmtQty(it.keepQty)), td(stockText(it.stock), 'text-xs ox-nowrap'),
            td(regBadge(it)), td(it.lastOrdered ? fmtDate(it.lastOrdered) : '—', 'ox-nowrap'), td(dueText(it), 'ox-nowrap')]);
        })));
      }).catch(fail);
    }
    function paintLow() {
      loading();
      api('GET', '/products/stock/alerts').then(function (res) {
        var d = res.data; body.innerHTML = '';
        var rows = [];
        function add(list, label, cls) {
          (list || []).forEach(function (r) {
            rows.push(el('tr', { 'data-low': r.itemCode }, [td(el('span', {}, [el('b', { text: r.itemCode }), el('span', { class: 'block text-xs text-muted', text: [r.itemName, r.brand].filter(Boolean).join(' · ') })])),
              td(fmtQty(r.availableStock)), td(fmtQty(r.minimumStock)), td(fmtQty(r.reserved || 0)), td(el('span', { class: 'ox-stock ' + cls, text: label }))]));
          });
        }
        add(d.outOfStock, 'Out of stock', 'ox-stock-none');
        add(d.shortForOrders.filter(function (r) { return Number(r.availableStock) > 0; }), 'Short for open orders', 'ox-stock-low');
        add(d.lowStock, 'Low (at or below minimum)', 'ox-stock-low');
        if (!rows.length) { body.appendChild(el('p', { class: 'text-sm text-emerald-700 py-3', text: '✓ No item is low or out of stock.' })); return; }
        body.appendChild(el('p', { class: 'text-xs text-muted mb-2', text: d.summary.outOfStock + ' out of stock · ' + d.summary.lowStock + ' low · ' + d.summary.shortForOrders + ' short for open orders. Set the minimum stock of an item on the Stock page.' }));
        body.appendChild(table(['Item', 'In stock', 'Minimum', 'On open orders', ''], rows));
      }).catch(fail);
    }
    var regCustomer = opts.customer || null;
    function paintRegular() {
      body.innerHTML = '';
      var pick = el('input', { class: INPUT, id: 'ox-reg-cust', placeholder: 'Search the company…', style: 'max-width:360px' });
      var list = el('div', { class: 'mt-1 space-y-1', style: 'max-width:360px' });
      var t;
      pick.addEventListener('input', function () {
        clearTimeout(t);
        var q = pick.value.trim();
        if (!q) { list.innerHTML = ''; return; }
        t = setTimeout(function () {
          api('GET', '/customers?search=' + encodeURIComponent(q) + '&limit=8').then(function (res) {
            list.innerHTML = '';
            ((res.data && res.data.items) || []).forEach(function (c) {
              list.appendChild(el('button', { class: 'block w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800', 'data-reg-cust': c.id, text: c.companyName,
                onclick: function () { regCustomer = { id: c.id, companyName: c.companyName }; paintRegular(); } }));
            });
          }).catch(function () {});
        }, 250);
      });
      body.appendChild(el('div', { class: 'flex items-start gap-3 flex-wrap' }, [
        el('div', {}, [el('span', { class: 'text-xs text-muted block', text: 'Company' }), pick, list]),
        regCustomer ? el('div', { class: 'text-sm pt-5' }, [el('b', { text: regCustomer.companyName })]) : null
      ]));
      if (!regCustomer) { body.appendChild(el('p', { class: 'text-sm text-muted mt-3', text: 'Pick a company to see its regular items, stock for them, and add items by hand.' })); return; }
      var box = el('div', { class: 'mt-3', id: 'ox-reg-list' }, [el('p', { class: 'text-sm text-muted', text: 'Loading…' })]);
      body.appendChild(box);
      body.appendChild(regularAddForm(regCustomer, paintRegular));
      api('GET', '/regular-items?customerId=' + encodeURIComponent(regCustomer.id)).then(function (res) {
        var items = res.data.items; box.innerHTML = '';
        if (!items.length) { box.appendChild(el('p', { class: 'text-sm text-muted', text: 'No regular items yet — they appear once an item is ordered 2+ times, or add one below.' })); return; }
        box.appendChild(el('p', { class: 'text-xs text-muted mb-1', text: items.length + ' regular items · ' + res.data.summary.restock + ' need restocking' }));
        box.appendChild(table(['Item', 'From', 'Orders', 'Usual qty', 'Keep in stock', 'Stock', 'Status', 'Last ordered', 'Next expected', ''], items.map(function (it) {
          var rm = el('button', { class: 'ox-muted-link text-red-600', type: 'button', 'data-reg-remove': it.itemCode, text: 'Remove' });
          rm.addEventListener('click', function () {
            if (!confirm('Remove ' + it.itemCode + ' from ' + regCustomer.companyName + '’s regular items?')) return;
            (it.id ? api('DELETE', '/regular-items/' + encodeURIComponent(it.id)) : api('POST', '/regular-items/hide', { customerId: regCustomer.id, itemCode: it.itemCode }))
              .then(paintRegular).catch(function (e) { alert(e.message); });
          });
          var ed = el('button', { class: 'ox-muted-link', type: 'button', text: 'Edit', onclick: function () { fillForm(it); } });
          return el('tr', { 'data-reg': it.itemCode }, [td(el('span', {}, [el('b', { text: it.itemCode }), el('span', { class: 'block text-xs text-muted', text: [it.productName, it.brand].filter(Boolean).join(' · ') })])),
            td({ MANUAL: 'Added by hand', ORDERS: 'Order history', BOTH: 'Both' }[it.source], 'text-xs'), td(String(it.orders)),
            td(it.usualQty == null ? '—' : fmtQty(it.usualQty)), td(it.keepQty == null ? '—' : fmtQty(it.keepQty)), td(stockText(it.stock), 'text-xs ox-nowrap'),
            td(regBadge(it)), td(it.lastOrdered ? fmtDate(it.lastOrdered) : '—', 'ox-nowrap'), td(dueText(it), 'ox-nowrap'),
            td(el('span', { class: 'flex gap-3' }, [ed, rm]))]);
        })));
      }).catch(function (e) { box.innerHTML = ''; box.appendChild(el('p', { class: 'text-sm text-red-600', text: e.message })); });
    }
    var fillForm = function () {};
    function regularAddForm(cust, done) {
      var f = {
        itemCode: el('input', { class: INPUT, id: 'ox-reg-code', placeholder: 'Item code (type to search)' }),
        productName: el('input', { class: INPUT, id: 'ox-reg-name', placeholder: 'Product name' }),
        brand: el('input', { class: INPUT, id: 'ox-reg-brand', placeholder: 'Brand' }),
        usualQty: el('input', { class: INPUT, id: 'ox-reg-usual', type: 'number', min: '0', step: 'any', placeholder: 'e.g. 40' }),
        everyDays: el('input', { class: INPUT, id: 'ox-reg-every', type: 'number', min: '0', step: '1', placeholder: 'e.g. 30' }),
        keepQty: el('input', { class: INPUT, id: 'ox-reg-keep', type: 'number', min: '0', step: 'any', placeholder: 'default = usual qty' }),
        notes: el('input', { class: INPUT, id: 'ox-reg-notes', placeholder: 'Notes (optional)' })
      };
      fillForm = function (it) {
        f.itemCode.value = it.itemCode; f.productName.value = it.productName || ''; f.brand.value = it.brand || '';
        f.usualQty.value = it.usualQty == null ? '' : it.usualQty; f.everyDays.value = it.everyDays == null ? '' : it.everyDays;
        f.keepQty.value = it.keepQty == null ? '' : it.keepQty; f.notes.value = it.notes || '';
        f.usualQty.focus();
      };
      var sugg = el('div', { class: 'mt-1 space-y-1' }), t;
      f.itemCode.addEventListener('input', function () {
        clearTimeout(t);
        var q = f.itemCode.value.trim();
        if (q.length < 2) { sugg.innerHTML = ''; return; }
        t = setTimeout(function () {
          api('GET', '/products/search?limit=6&q=' + encodeURIComponent(q)).then(function (res) {
            sugg.innerHTML = '';
            ((res.data && res.data.results) || []).forEach(function (p) {
              sugg.appendChild(el('button', { type: 'button', class: 'block w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800',
                text: p.itemCode + ' — ' + (p.specification || p.productName) + (p.brand ? ' · ' + p.brand : ''),
                onclick: function () { f.itemCode.value = p.itemCode; f.productName.value = p.productName || ''; f.brand.value = p.brand || ''; sugg.innerHTML = ''; f.usualQty.focus(); } }));
            });
          }).catch(function () {});
        }, 250);
      });
      var err = el('p', { class: 'text-xs text-red-600' });
      var save = el('button', { class: 'btn-primary btn-sm', type: 'button', id: 'ox-reg-save', text: 'Save regular item' });
      save.addEventListener('click', function () {
        var b = { customerId: cust.id }; Object.keys(f).forEach(function (k) { b[k] = f[k].value; });
        err.textContent = ''; save.disabled = true;
        api('POST', '/regular-items', b).then(function () { done(); }).catch(function (e) { err.textContent = e.message; save.disabled = false; });
      });
      function lab(text, input) { return el('label', { class: 'block' }, [el('span', { class: 'text-xs text-muted block mb-1', text: text }), input]); }
      return el('div', { class: 'mt-4 p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600' }, [
        el('p', { class: 'text-sm font-semibold mb-2', text: 'Add a regular item by hand for ' + cust.companyName }),
        el('div', { class: 'ox-reg-grid' }, [el('div', {}, [lab('Item code', f.itemCode), sugg]), lab('Product', f.productName), lab('Brand', f.brand),
          lab('Usual qty per order', f.usualQty), lab('Orders every (days)', f.everyDays), lab('Keep in stock for them', f.keepQty), lab('Notes', f.notes)]),
        err, el('div', { class: 'flex justify-end mt-2' }, [save])
      ]);
    }
    paintTabs(); paint();
    card.appendChild(el('div', { class: 'flex items-center justify-between gap-2' }, [
      el('span', { class: 'text-sm font-semibold' }, [ic('repeat'), ' Stock reminders & regular items']),
      el('button', { class: 'ox-muted-link', type: 'button', text: 'Close', onclick: function () { if (opts.onClose) opts.onClose(); } })
    ]));
    card.appendChild(tabs); card.appendChild(body);
    return card;
  }

  var REG_CACHE = {};
  /** In the order form: the picked company's regular items, one click adds a line. */
  function regularChips(customerId, onAdd) {
    var wrap = el('div', { class: 'ox-reg-chips', 'data-reg-chips': customerId }, []);
    var c = REG_CACHE[customerId];
    if (!c || Date.now() - c.at > 60000) c = REG_CACHE[customerId] = { at: Date.now(), p: api('GET', '/regular-items?customerId=' + encodeURIComponent(customerId)) };
    c.p.then(function (res) {
      var items = res.data.items || [];
      if (!items.length) return;
      wrap.appendChild(el('span', { class: 'text-xs text-muted block mb-1', text: 'Regular items of this company — click to add' }));
      var row = el('div', { class: 'flex gap-1.5 flex-wrap' });
      items.slice(0, 20).forEach(function (it) {
        var s = REG_STATUS[it.status] || ['', ''];
        row.appendChild(el('button', { type: 'button', class: 'ox-chip ' + s[1], 'data-reg-chip': it.itemCode, title: it.productName + ' · ' + s[0] + ' · ' + stockText(it.stock),
          text: it.itemCode + (it.usualQty ? ' ×' + fmtQty(it.usualQty) : ''), onclick: function () { onAdd(it); } }));
      });
      wrap.appendChild(row);
    }).catch(function () {});
    return wrap;
  }

  /** Invoices supplied against the order: number, date, amount and the invoice PDF / photo. */
  function invoicesPanel(o, onChange) {
    var me = currentUser() || {};
    var can = isAdmin() || me.role === 'ACCOUNTS' || (o.engineer && o.engineer.id === me.id);
    var box = el('div', { class: 'space-y-2', 'data-invoices': o.id });
    function money(v) { return v == null ? '' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
    function fileUrl(i) { return API + '/api/orders/' + o.id + '/invoices/' + i.id; }
    function open(i, dl) {
      if (!dl && /\.pdf$/i.test(i.fileName || '') && window.PdfView) { PdfView.show(fileUrl(i), { title: 'Invoice ' + i.invoiceNo, fileName: i.fileName }); return; }
      fetch(fileUrl(i) + (dl ? '?download=1' : ''), { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
        if (!r.ok) throw new Error('Could not open the invoice'); return r.blob();
      }).then(function (b) {
        var u = URL.createObjectURL(b);
        if (dl) { var a = document.createElement('a'); a.href = u; a.download = i.fileName || ('invoice-' + i.invoiceNo); document.body.appendChild(a); a.click(); a.remove(); }
        else window.open(u, '_blank');
        setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
      }).catch(function (e) { alert(e.message); });
    }
    function draw(list) {
      box.innerHTML = '';
      box.appendChild(el('span', { class: 'text-xs text-muted block', text: 'Invoices supplied' }));
      if (!list.length) box.appendChild(el('p', { class: 'text-xs text-muted', text: 'No invoice added yet.' }));
      list.forEach(function (i) {
        box.appendChild(el('div', { class: 'flex items-center gap-2 flex-wrap text-sm', 'data-invoice': i.invoiceNo }, [
          el('span', { class: 'font-semibold', text: '🧾 ' + i.invoiceNo }),
          el('span', { class: 'text-xs text-muted', text: [i.invoiceDate ? fmtDate(i.invoiceDate) : '', money(i.amount), i.note || ''].filter(Boolean).join(' · ') }),
          i.hasFile ? el('button', { class: 'btn-secondary btn-sm', type: 'button', 'data-inv-view': i.id, text: 'View', onclick: function (e) { e.stopPropagation(); open(i, false); } }) : el('span', { class: 'text-xs text-muted', text: 'no file' }),
          i.hasFile ? el('button', { class: 'btn-secondary btn-sm', type: 'button', title: 'Download invoice', text: '⬇', onclick: function (e) { e.stopPropagation(); open(i, true); } }) : null,
          can ? el('button', { class: 'text-xs', type: 'button', style: 'color:#b91c1c', title: 'Remove invoice', text: '✕', onclick: function (e) {
            e.stopPropagation();
            if (!confirm('Remove invoice ' + i.invoiceNo + '?')) return;
            api('DELETE', '/orders/' + o.id + '/invoices/' + i.id).then(function (j) { draw(j.data.invoices); if (onChange) onChange(j.data.invoices); }).catch(function (er) { alert(er.message); });
          } }) : null
        ]));
      });
      if (!can) return;
      var no = el('input', { class: 'ox-sel', id: 'ox-inv-no', placeholder: 'Invoice no.', style: 'width:9rem' });
      var dt = el('input', { class: 'ox-sel', id: 'ox-inv-date', type: 'date', value: todayIso() });
      var amt = el('input', { class: 'ox-sel', id: 'ox-inv-amt', type: 'number', min: '0', step: '0.01', placeholder: 'Amount ₹', style: 'width:8rem' });
      var file = el('input', { type: 'file', id: 'ox-inv-file', accept: '.pdf,image/*', class: 'text-xs' });
      var err = el('p', { class: 'text-xs', style: 'color:#b91c1c' });
      var add = el('button', { class: 'btn-primary btn-sm', type: 'button', id: 'ox-inv-add', text: '+ Add invoice' });
      add.addEventListener('click', function (e) {
        e.stopPropagation(); err.textContent = '';
        if (!no.value.trim()) { err.textContent = 'Enter the invoice number.'; return; }
        var fd = new FormData();
        fd.append('invoiceNo', no.value.trim()); fd.append('invoiceDate', dt.value); fd.append('amount', amt.value);
        if (file.files[0]) fd.append('file', file.files[0]);
        add.disabled = true;
        api('POST', '/orders/' + o.id + '/invoices', fd).then(function (j) { draw(j.data.invoices); if (onChange) onChange(j.data.invoices); })
          .catch(function (er) { err.textContent = er.message; add.disabled = false; });
      });
      box.appendChild(el('div', { class: 'flex items-center gap-2 flex-wrap pt-1', onclick: function (e) { e.stopPropagation(); } }, [no, dt, amt, file, add]));
      box.appendChild(err);
    }
    draw(o.invoices || []);
    return box;
  }

  /** The expanded-row content: materials checklist on the left, order facts on the right. */
  function orderDetailPanel(o, opts) {
    var facts = el('div', { class: 'space-y-3 text-sm' });
    facts.appendChild(el('div', {}, [
      el('span', { class: 'text-xs text-muted block', text: 'Order placed by' }),
      el('span', { class: 'font-medium', text: ((o.engineer && o.engineer.name) || '—') + ' · ' + fmtDate(o.orderDate) })
    ]));
    if (o.customer && (o.customer.contactPerson || o.customer.contactNumber)) {
      facts.appendChild(el('div', {}, [
        el('span', { class: 'text-xs text-muted block', text: 'Customer contact' }),
        el('span', { text: [o.customer.contactPerson, o.customer.contactNumber].filter(Boolean).join(' · ') })
      ]));
    }
    if (o.orderType === 'PO' && o.poDocument) {
      facts.appendChild(docButtons(o));
    } else if (o.orderType === 'VERBAL' && o.verbalDetails) {
      facts.appendChild(el('div', {}, [
        el('span', { class: 'text-xs text-muted block', text: 'Verbally agreed' }),
        el('span', { class: 'whitespace-pre-wrap', text: o.verbalDetails })
      ]));
    }
    if (o.notes) facts.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted block', text: 'Notes' }), el('span', { class: 'whitespace-pre-wrap', text: o.notes })]));
    if (o.poNumber) facts.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted block', text: 'Customer PO no.' }), el('span', { class: 'font-semibold', text: o.poNumber })]));
    if (o.orderValue != null) facts.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted block', text: 'Order value' }), el('span', { class: 'font-semibold', text: '₹' + Number(o.orderValue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })]));
    if (o.deliveredDate && o.deliveryStatus !== 'PENDING') {
      facts.appendChild(el('p', { class: 'text-xs text-muted', text: 'Last supplied ' + fmtDate(o.deliveredDate) }));
    }
    facts.appendChild(el('div', { class: 'flex gap-2 flex-wrap' }, [el('button', { class: 'btn-secondary btn-sm', text: 'Open full order', onclick: opts.onOpen }), pdfButton(o)]));
    facts.appendChild(invoicesPanel(o, opts.onInvoices));

    return el('div', { class: 'ox-expand-grid' }, [
      supplyPanel(o, { preset: opts.preset, onSaved: opts.onSaved, onCancelPreset: opts.onCancelPreset }),
      facts
    ]);
  }

  /**
   * Materials supplied, by quantity. Each line takes the quantity supplied so
   * far (the tick fills the whole quantity); one button saves it:
   * everything supplied = complete, something = partially complete,
   * nothing = not delivered. Anything short of complete requires a reason.
   * Supplied quantities come out of stock (hand stock first). Each line shows
   * the stock in hand / total for its item code. Read-only for people who
   * can't edit the order.
   */
  function supplyPanel(o, opts) {
    opts = opts || {};
    var editable = canEditOrder(o);
    var items = o.items || [];
    var qty = {};
    items.forEach(function (i) {
      var done = i.suppliedQty != null ? Number(i.suppliedQty) : (i.supplied ? Number(i.quantity) : 0);
      qty[i.id] = opts.preset === 'NOT_DELIVERED' ? 0 : done;
    });
    var reason = o.deliveryStatus === 'PARTIALLY_DELIVERED' || o.deliveryStatus === 'NOT_DELIVERED' ? (o.notDeliveredReason || '') : '';
    var err = '';
    var saving = false;
    // a fresh (pending) order asks nothing until something is ticked or "Not delivered…" is pressed
    var askNotDelivered = opts.preset === 'NOT_DELIVERED' || o.deliveryStatus === 'NOT_DELIVERED';
    var wrap = el('div', { class: 'space-y-3' });

    function full(i) { return (qty[i.id] || 0) >= Number(i.quantity); }
    function nFull() { return items.filter(full).length; }
    function anySupplied() { return items.some(function (i) { return (qty[i.id] || 0) > 0; }); }

    function stockLine(i) {
      var s = i.stock;
      if (!i.itemCode || i.itemCode === 'MANUAL') return null;
      if (!s) return el('span', { class: 'ox-stock ox-stock-none', text: 'Not in stock list' });
      var pending = Math.max(0, Number(i.quantity) - (qty[i.id] || 0));
      var cls = s.total <= 0 ? 'ox-stock-none' : (s.hand >= pending ? 'ox-stock-ok' : 'ox-stock-low');
      return el('span', { class: 'ox-stock ' + cls, title: (s.places || []).map(function (p) { return p.place + ': ' + fmtQty(p.qty); }).join('\n'),
        text: 'Stock: in hand ' + fmtQty(s.hand) + ' · total ' + fmtQty(s.total) + (s.onOrder ? ' · on open orders ' + fmtQty(s.onOrder) : '') });
    }

    function render() {
      wrap.innerHTML = '';
      var n = nFull(), total = items.length;
      wrap.appendChild(el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('div', {}, [
          el('span', { class: 'text-sm font-semibold text-slate-900 dark:text-slate-100', text: 'Materials supplied' }),
          el('span', { class: 'text-xs text-muted ml-2', text: n + ' of ' + total + ' fully supplied' + (anySupplied() && n < total ? ' · partly supplied' : '') })
        ]),
        editable && total ? el('div', { class: 'flex gap-3' }, [
          el('button', { class: 'ox-muted-link', text: 'All supplied', onclick: function (e) { e.stopPropagation(); items.forEach(function (i) { qty[i.id] = Number(i.quantity); }); render(); } }),
          el('button', { class: 'ox-muted-link', text: 'Clear', onclick: function (e) { e.stopPropagation(); items.forEach(function (i) { qty[i.id] = 0; }); render(); } })
        ]) : null
      ]));

      if (opts.preset) {
        wrap.appendChild(el('div', { class: 'text-xs px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800' }, [
          opts.preset === 'NOT_DELIVERED'
            ? 'Marking as not delivered — give the reason below and save.'
            : 'Enter the quantity supplied on each line, give the reason for the rest, and save.'
        ]));
      }

      var list = el('div', { class: 'rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900' });
      if (!total) list.appendChild(el('p', { class: 'px-3 py-2 text-sm text-muted', text: 'No products on this order.' }));
      items.forEach(function (i) {
        var q = Number(i.quantity), done = qty[i.id] || 0, pending = Math.max(0, q - done);
        var cb = el('input', { type: 'checkbox', class: 'ox-check', 'aria-label': 'All supplied: ' + i.productName });
        cb.checked = full(i);
        cb.indeterminate = done > 0 && done < q;
        cb.disabled = !editable;
        cb.addEventListener('change', function () { qty[i.id] = cb.checked ? q : 0; render(); });

        var qi = el('input', { type: 'number', min: '0', max: String(q), step: 'any', class: 'ox-supq', 'data-supply-qty': i.itemCode || i.id, 'aria-label': 'Quantity supplied: ' + i.productName });
        qi.value = done ? String(done) : '';
        qi.placeholder = '0';
        qi.disabled = !editable;
        qi.addEventListener('click', function (e) { e.stopPropagation(); });
        qi.addEventListener('change', function () {
          var v = parseFloat(qi.value); if (isNaN(v) || v < 0) v = 0; if (v > q) v = q;
          qty[i.id] = Math.round(v * 100) / 100; render();
        });

        var metaBits = [i.category, i.brand, i.unitPrice != null ? '@ ₹' + Number(i.unitPrice).toLocaleString('en-IN') : ''].filter(Boolean).join(' · ');
        var procLabel = labelOf(PROCUREMENT_STATUSES, i.procurementStatus);
        var procLine = procLabel + (i.expectedDeliveryDate ? ' · arriving ' + fmtDate(i.expectedDeliveryDate) : '');

        var row = el('div', { class: 'ox-item' + (full(i) ? ' ox-item-on' : done > 0 ? ' ox-item-part' : ''), 'data-line': i.itemCode || '' }, [
          cb,
          el('span', { class: 'flex-1 min-w-0' }, [
            el('span', { class: 'block text-sm text-slate-900 dark:text-slate-100', text: i.productName + (i.itemCode && i.itemCode !== 'MANUAL' ? ' (' + i.itemCode + ')' : '') }),
            metaBits ? el('span', { class: 'block text-xs text-muted', text: metaBits }) : null,
            done > 0 && i.suppliedAt ? el('span', { class: 'block text-xs text-muted', text: 'Supplied ' + fmtDate(i.suppliedAt) }) : null,
            el('span', { class: 'block text-xs text-muted', text: procLine }),
            stockLine(i)
          ]),
          el('span', { class: 'ox-supbox' }, [
            el('span', { class: 'text-xs text-muted', text: 'Supplied' }), qi,
            el('span', { class: 'text-sm text-muted ox-nowrap', text: 'of ' + fmtQty(q) + (i.unit ? ' ' + i.unit : '') }),
            pending > 0 && done > 0 ? el('span', { class: 'ox-pend', text: fmtQty(pending) + ' pending' }) : null
          ])
        ]);
        row.addEventListener('click', function (e) { e.stopPropagation(); });
        list.appendChild(row);

        // Per-item procurement — admin-tier only, right under that item.
        // Separate from the quantity above: this is about whether WE have
        // ordered this specific line from OUR supplier, not whether it's
        // been handed to the customer.
        if (isAdmin()) {
          var etaI = el('input', { type: 'date', class: INPUT, style: 'max-width:140px', 'aria-label': 'Expected arrival: ' + i.productName });
          etaI.value = i.expectedDeliveryDate ? String(i.expectedDeliveryDate).slice(0, 10) : '';
          etaI.addEventListener('click', function (e) { e.stopPropagation(); });
          var itemRow = el('div', { class: 'flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex-wrap' }, [
            el('div', { class: 'flex gap-1' }, PROCUREMENT_STATUSES.map(function (s) {
              return el('button', {
                class: (i.procurementStatus === s[0] ? 'btn-primary' : 'btn-secondary') + ' btn-sm', text: s[1],
                onclick: function (e) { e.stopPropagation(); patchItem(o.id, i.id, 'procurement', { procurementStatus: s[0] }); }
              });
            })),
            etaI,
            el('button', {
              class: 'btn-secondary btn-sm', text: 'Set',
              onclick: function (e) { e.stopPropagation(); patchItem(o.id, i.id, 'eta', { expectedDeliveryDate: etaI.value || null }); }
            })
          ]);
          itemRow.addEventListener('click', function (e) { e.stopPropagation(); });
          list.appendChild(itemRow);
        }
      });
      wrap.appendChild(list);

      if (!editable) {
        if (reason) wrap.appendChild(el('p', { class: 'text-sm text-amber-800', text: 'Reason: ' + reason }));
        return;
      }

      var complete = total > 0 && n === total, some = anySupplied();
      var pendingQuiet = !complete && !some && !askNotDelivered;
      if (!complete && total && !pendingQuiet) {
        var ta = el('textarea', { class: INPUT, rows: '2', placeholder: some ? 'Why is the order only partially complete?' : 'Why wasn’t it delivered?' });
        ta.value = reason;
        ta.addEventListener('input', function () { reason = ta.value; });
        ta.addEventListener('click', function (e) { e.stopPropagation(); });
        wrap.appendChild(el('div', {}, [
          el('span', { class: 'text-xs font-medium text-amber-800', text: some ? 'Reason for partial completion (required)' : 'Reason for non-delivery (required)' }),
          el('div', { class: 'mt-1' }, [ta])
        ]));
      }
      if (err) wrap.appendChild(el('p', { class: 'text-xs text-red-600', text: err }));

      var label = complete ? '✓ Mark order complete' : (some ? 'Save as partially complete' : 'Mark not delivered');
      var btns = el('div', { class: 'flex gap-2 justify-end flex-wrap' });
      if (opts.preset && opts.onCancelPreset) {
        btns.appendChild(el('button', { class: 'btn-secondary btn-sm', text: 'Cancel', onclick: function (e) { e.stopPropagation(); opts.onCancelPreset(); } }));
      }
      if (total && pendingQuiet) {
        btns.appendChild(el('span', { class: 'text-xs text-muted mr-auto', style: 'align-self:center', text: 'Tick the items as they are supplied.' }));
        btns.appendChild(el('button', { class: 'btn-secondary btn-sm', 'data-supply-notdel': '1', text: 'Not delivered…', onclick: function (e) { e.stopPropagation(); askNotDelivered = true; render(); } }));
      } else if (total) {
        btns.appendChild(el('button', {
          class: 'btn-primary btn-sm' + (saving ? ' ox-btn-disabled' : ''), 'data-supply-save': '1', text: saving ? 'Saving…' : label,
          onclick: function (e) { e.stopPropagation(); save(); }
        }));
      }
      wrap.appendChild(btns);
    }

    function save() {
      if (saving) return;
      err = '';
      var complete = items.length && nFull() === items.length;
      if (!complete && !reason.trim()) {
        err = anySupplied() ? 'Please give a reason why the order is only partially complete.' : 'Please give a reason for the non-delivery.';
        return render();
      }
      var quantities = {};
      items.forEach(function (i) { quantities[i.id] = qty[i.id] || 0; });
      saving = true; render();
      api('PATCH', '/orders/' + o.id + '/supply', { quantities: quantities, reason: reason.trim() }).then(function (res) {
        saving = false;
        if (opts.onSaved) opts.onSaved(res.data.order);
      }).catch(function (e2) { saving = false; err = e2.message; render(); });
    }

    // Per-item procurement/eta — admin-tier only, used inside render()'s
    // item loop above. Same api()/opts.onSaved pattern as save() below.
    function patchItem(orderId, itemId, path, payload) {
      api('PATCH', '/orders/' + orderId + '/items/' + itemId + '/' + path, payload).then(function (res) {
        if (opts.onSaved) opts.onSaved(res.data.order);
      }).catch(function (e) {
        err = e.message;
        render();
      });
    }

    render();
    return wrap;
  }

  /** Downloads (or opens) the order as a PDF. */
  function orderPdf(o, open) {
    var t = token();
    return fetch(API + '/api/orders/' + encodeURIComponent(o.id) + '/pdf' + (open ? '?inline=1' : ''), { headers: { Authorization: 'Bearer ' + (t || '') } })
      .then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Could not make the PDF'); });
        var cd = r.headers.get('Content-Disposition') || '', m = /filename="?([^";]+)"?/.exec(cd);
        return r.blob().then(function (b) {
          var u8 = new Uint8Array(b.size ? 4 : 0);
          return b.slice(0, 4).arrayBuffer().then(function (h) {
            u8 = new Uint8Array(h);
            if (!(u8[0] === 37 && u8[1] === 80 && u8[2] === 68 && u8[3] === 70)) throw new Error('The server sent an error instead of the PDF.');
            var u = URL.createObjectURL(b);
            if (open) { window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); return; }
            var a = document.createElement('a'); a.href = u; a.download = m ? m[1] : 'order.pdf';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
          });
        });
      });
  }
  function pdfButton(o, cls) {
    var b = el('button', { class: cls || 'btn-secondary btn-sm', type: 'button', 'data-order-pdf': o.id, title: 'Download this order as PDF' }, [ic('download'), ' PDF']);
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      b.disabled = true;
      orderPdf(o).catch(function (er) { alert(er.message); }).then(function () { b.disabled = false; });
    });
    return b;
  }

  // ── create / detail-edit dialog ─────────────────────────────────────
  // orderId === null -> create mode. Otherwise loads and shows/edits it.
  function openOrderDialog(orderId, onChange, opts) {
    injectCss();
    var overlay = el('div', { class: 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4' });
    var card = el('div', {
      class: 'card w-full ox-dialog p-5 rounded-b-none sm:rounded-xl max-h-[92vh] overflow-y-auto',
      role: 'dialog', 'aria-modal': 'true'
    });
    overlay.appendChild(card);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    card.appendChild(el('div', { class: 'p-6 text-center text-muted', text: 'Loading…' }));
    document.body.appendChild(overlay);

    if (orderId) {
      api('GET', '/orders/' + orderId).then(function (res) {
        buildForm(res.data.order, !!(opts && opts.edit));
      }).catch(function (e) {
        card.innerHTML = '';
        card.appendChild(el('div', { class: 'p-2 text-center text-muted', text: e.message }));
      });
    } else {
      buildForm(null, true);
    }

    function buildForm(order, editing) {
      var isCreate = !order;
      var canEdit = isCreate || isAdmin() || (order.engineer && currentUser() && order.engineer.id === currentUser().id);
      editing = editing && canEdit;

      var state = {
        customerId: order ? order.customer.id : '', customerLabel: order ? order.customer.companyName : '',
        orderType: order ? order.orderType : 'VERBAL',
        firm: order ? order.firm || '' : '',
        verbalDetails: order ? order.verbalDetails || '' : '',
        orderDate: order ? order.orderDate.slice(0, 10) : todayIso(),
        notes: order ? order.notes || '' : '',
        orderValue: order && order.orderValue != null ? order.orderValue : '',
        poNumber: order ? order.poNumber || '' : '',
        poInfo: null, poReading: false, valueTyped: !!(order && order.orderValue != null),
        engineerId: order ? order.engineer.id : (currentUser() && currentUser().id),
        items: order && order.items ? order.items.map(function (i) {
          return { productId: i.productId, itemCode: i.itemCode, productName: i.productName, unit: i.unit, category: i.category, brand: i.brand, quantity: i.quantity, unitPrice: i.unitPrice, stock: i.stock === undefined ? undefined : i.stock };
        }) : [],
        file: null
      };
      var errMsg = '';
      var dialogEngineers = null;
      var showManualEntry = false;

      function render() {
        card.innerHTML = '';
        card.appendChild(header());
        var body2 = el('div', { class: 'space-y-4' });

        if (!isCreate && !editing) {
          body2.appendChild(readOnlyView(order));
        } else {
          body2.appendChild(editableForm());
        }
        if (errMsg) body2.appendChild(el('p', { class: 'text-xs text-red-600 dark:text-red-400', text: errMsg }));
        card.appendChild(body2);
        card.appendChild(footer());
      }

      function header() {
        var title = isCreate ? 'New order' : (order.customer.companyName || 'Order');
        return el('div', { class: 'flex items-start justify-between mb-4' }, [
          el('div', {}, [
            el('h2', { class: 'section-title mb-0', text: title }),
            !isCreate ? el('p', { class: 'text-xs text-muted mt-0.5', text: fmtDate(order.orderDate) + ' · ' + (order.engineer.name || '') }) : null
          ]),
          el('div', { class: 'flex items-center gap-2' }, [
            !isCreate ? pdfButton(order) : null,
            el('button', { class: 'p-1 rounded text-slate-400 hover:text-slate-600', 'aria-label': 'Close', onclick: close }, [ic('x')])
          ])
        ]);
      }

      function readOnlyView(o) {
        var wrap = el('div', { class: 'space-y-4' });
        wrap.appendChild(el('div', { class: 'flex items-center gap-2 flex-wrap' }, [
          el('span', { class: 'badge ' + TYPE_BADGE[o.orderType], text: labelOf(ORDER_TYPES, o.orderType) }),
          el('span', { class: 'badge ' + PROCUREMENT_BADGE[o.procurementStatus], text: labelOf(PROCUREMENT_STATUSES, o.procurementStatus) }),
          el('span', { class: 'badge ' + STATUS_BADGE[o.deliveryStatus], text: labelOf(DELIVERY_STATUSES, o.deliveryStatus) }),
          el('span', { class: 'badge ' + PROFORMA_BADGE[o.proformaStatus], text: 'Proforma: ' + labelOf(PROFORMA_STATUSES, o.proformaStatus) })
        ]));

        // Price / proforma confirmed? — anyone who can edit the order.
        if (canEdit) {
          wrap.appendChild(el('div', { class: 'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700' }, [
            el('span', { class: 'text-xs text-muted', text: 'Price / proforma confirmed?' }),
            el('div', { class: 'flex gap-2' }, PROFORMA_STATUSES.map(function (s) {
              return el('button', {
                class: (o.proformaStatus === s[0] ? 'btn-primary' : 'btn-secondary') + ' btn-sm', text: s[1],
                onclick: function () { patch(o.id, 'proforma', { proformaStatus: s[0] }); }
              });
            }))
          ]));
        }

        // Procurement (has the company ordered this from its own supplier?)
        // and expected arrival — everyone sees both, so engineers can tell
        // the customer; only admin-tier gets the controls to set them.
        if (isAdmin()) {
          var procRow = el('div', { class: 'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700' }, [
            el('span', { class: 'text-xs text-muted', text: 'Ordered from our supplier?' }),
            el('div', { class: 'flex gap-2' }, PROCUREMENT_STATUSES.map(function (s) {
              return el('button', {
                class: o.procurementStatus === s[0] ? 'btn-primary' : 'btn-secondary', text: s[1],
                onclick: function () { setProcurement(o.id, s[0]); }
              });
            }))
          ]);
          wrap.appendChild(procRow);
        }

        var etaText = o.expectedDeliveryDate ? fmtDate(o.expectedDeliveryDate) : (o.procurementStatus === 'ORDERED' ? 'Not set yet' : '—');
        var etaRow = el('div', { class: 'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700' }, [
          el('div', {}, [
            el('span', { class: 'text-xs text-muted block', text: 'Expected arrival' }),
            el('span', { class: 'text-sm font-medium text-slate-900 dark:text-slate-100', text: etaText })
          ])
        ]);
        if (isAdmin()) {
          var etaInput = el('input', { type: 'date', class: INPUT, style: 'max-width:150px', 'aria-label': 'Expected arrival date' });
          etaInput.value = o.expectedDeliveryDate ? String(o.expectedDeliveryDate).slice(0, 10) : '';
          etaRow.appendChild(el('div', { class: 'flex items-center gap-2' }, [
            etaInput,
            el('button', { class: 'btn-secondary', text: 'Set', onclick: function () { setEta(o.id, etaInput.value || null); } })
          ]));
        }
        wrap.appendChild(etaRow);

        if (o.orderType === 'PO' && o.poDocument) {
          wrap.appendChild(el('div', { class: 'space-y-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700' }, [docButtons(o), docPreview(o)]));
        } else if (o.orderType === 'VERBAL') {
          wrap.appendChild(el('div', { class: 'text-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50' }, [o.verbalDetails || '—']));
        }

        if (o.notes) wrap.appendChild(el('p', { class: 'text-sm text-muted whitespace-pre-wrap', text: o.notes }));

        // Materials checklist — tick what was supplied; complete / partial / not delivered
        // is derived from the ticks, with a required reason for anything short of complete.
        wrap.appendChild(supplyPanel(o, {
          onSaved: function (updated) { order = updated; errMsg = ''; render(); if (onChange) onChange(); }
        }));

        if (o.deliveredDate && (o.deliveryStatus === 'DELIVERED' || o.deliveryStatus === 'PARTIALLY_DELIVERED')) {
          wrap.appendChild(el('p', { class: 'text-xs text-muted', text: 'Last supplied ' + fmtDate(o.deliveredDate) }));
        }
        if (canEdit && o.deliveryStatus !== 'PENDING') {
          wrap.appendChild(el('div', { class: 'flex justify-end' }, [el('button', {
            class: 'btn-ghost btn-sm', text: 'Reset to pending',
            onclick: function () { setDelivery(o.id, 'PENDING'); }
          })]));
        }
        return wrap;
      }

      function setDelivery(id, status, reason) {
        var payload = { deliveryStatus: status };
        if (reason) payload.notDeliveredReason = reason;
        api('PATCH', '/orders/' + id + '/delivery', payload).then(function (res) {
          order = res.data.order;
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function setEta(id, date) {
        api('PATCH', '/orders/' + id + '/eta', { expectedDeliveryDate: date }).then(function (res) {
          order = res.data.order;
          errMsg = '';
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function setProcurement(id, status) {
        api('PATCH', '/orders/' + id + '/procurement', { procurementStatus: status }).then(function (res) {
          order = res.data.order;
          errMsg = '';
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function patch(id, path, payload) {
        api('PATCH', '/orders/' + id + '/' + path, payload).then(function (res) {
          order = res.data.order;
          errMsg = '';
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      // ── editable form (create, or edit-mode on an existing order) ────
      var custResults = [];
      function editableForm() {
        var wrap = el('div', { class: 'space-y-4' });

        // Customer picker
        if (state.customerId) {
          wrap.appendChild(el('div', { class: 'flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50' }, [
            el('span', { text: state.customerLabel }),
            el('button', { class: 'text-primary dark:text-primary-300 text-xs font-medium', text: 'Change', onclick: function () { state.customerId = ''; render(); } })
          ]));
          wrap.appendChild(regularChips(state.customerId, function (it) {
            var have = state.items.filter(function (x) { return String(x.itemCode).toUpperCase() === it.itemCode; })[0];
            if (have) { have.quantity = (Number(have.quantity) || 0) + (Number(it.usualQty) || 1); }
            else state.items.push({ productId: null, itemCode: it.itemCode, productName: it.productName || it.itemCode, unit: null, category: null, brand: it.brand || null,
                                    quantity: Number(it.usualQty) || 1, stock: it.stock === undefined ? undefined : it.stock });
            render();
          }));
        } else {
          var custInput = el('input', { class: INPUT, placeholder: 'Search by company or contact name…' });
          var custList = el('div', { class: 'mt-1 space-y-1' });
          var t;
          custInput.addEventListener('input', function () {
            clearTimeout(t);
            var q = custInput.value.trim();
            if (!q) { custList.innerHTML = ''; return; }
            t = setTimeout(function () {
              api('GET', '/customers?search=' + encodeURIComponent(q) + '&limit=8').then(function (res) {
                custResults = (res.data && res.data.items) || [];
                custList.innerHTML = '';
                custResults.forEach(function (c) {
                  custList.appendChild(el('button', {
                    class: 'block w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800',
                    text: c.companyName + (c.contactPerson ? ' — ' + c.contactPerson : ''),
                    onclick: function () { state.customerId = c.id; state.customerLabel = c.companyName; render(); }
                  }));
                });
              }).catch(function () {});
            }, 300);
          });
          wrap.appendChild(el('div', {}, [
            el('span', { class: 'text-xs text-muted', text: 'Customer' }),
            el('div', { class: 'mt-1' }, [custInput, custList])
          ]));
        }

        // Order type
        var typeRow = el('div', { class: 'flex gap-2' });
        ORDER_TYPES.forEach(function (t) {
          typeRow.appendChild(el('button', {
            class: (state.orderType === t[0] ? 'btn-primary' : 'btn-secondary'), text: t[1],
            onclick: function () { state.orderType = t[0]; render(); }
          }));
        });
        wrap.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Type' }), el('div', { class: 'mt-1' }, [typeRow])]));

        // Our company: TMS / APJ (required)
        var firmRow = el('div', { class: 'flex gap-2', role: 'radiogroup', 'aria-label': 'Our company' });
        ['TMS', 'APJ'].forEach(function (f) {
          firmRow.appendChild(el('button', { type: 'button', 'data-order-firm': f, class: (state.firm === f ? 'btn-primary' : 'btn-secondary'), text: f,
            onclick: function () { state.firm = f; render(); } }));
        });
        wrap.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted' }, ['Our company — TMS or APJ ', el('span', { style: 'color:#dc2626', text: '*' })]), el('div', { class: 'mt-1' }, [firmRow])]));
        // the order number follows the company: TMS-ORD-… / APJ-ORD-…
        var noLine = el('div', { class: 'text-xs text-muted', id: 'ox-next-no', style: 'margin-top:-.25rem' });
        if (!isCreate && order.orderNo) {
          noLine.appendChild(el('span', {}, ['Order no.: ', el('b', { text: order.orderNo }),
            state.firm && order.orderNo.indexOf(state.firm + '-') !== 0 ? ' → a new ' + state.firm + '-ORD-… number when you save' : '']));
        } else if (isCreate) {
          var key = (state.firm || '') + '|' + (state.engineerId || '');
          if (state._noKey !== key) {
            state._noKey = key; state._no = '';
            api('GET', '/orders/next-number?firm=' + (state.firm || '') + '&engineerId=' + encodeURIComponent(state.engineerId || '')).then(function (r) {
              if (state._noKey !== key) return; state._no = r.data.orderNo;
              var n = document.getElementById('ox-next-no'); if (n && state.firm) { n.innerHTML = ''; n.appendChild(el('span', {}, ['Order no.: ', el('b', { 'data-next-order-no': state._no, text: state._no }), ' (given when you save)'])); }
            }).catch(function () {});
          }
          if (!state.firm) noLine.appendChild(el('span', { 'data-no-firm': '1', text: 'Choose TMS or APJ — the order number starts with it (TMS-ORD-… / APJ-ORD-…).' }));
          else if (state._no) noLine.appendChild(el('span', {}, ['Order no.: ', el('b', { 'data-next-order-no': state._no, text: state._no }), ' (given when you save)']));
        }
        wrap.appendChild(noLine);

        if (state.orderType === 'PO') {
          var fileLabel = state.file ? state.file.name : (order && order.poDocument ? order.poDocument.originalName + ' (current)' : 'No file chosen');
          var fileInput = el('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'hidden' });
          fileInput.addEventListener('change', function () { state.file = fileInput.files[0] || null; render(); if (state.file) readPO(state.file); });
          var poNoI = el('input', { class: INPUT, id: 'ox-po-number', placeholder: 'Customer PO number', value: state.poNumber || '' });
          poNoI.addEventListener('input', function () { state.poNumber = poNoI.value; });
          wrap.appendChild(el('div', {}, [
            el('span', { class: 'text-xs text-muted', text: 'Purchase order document — a PDF PO is read automatically (items, quantities, prices, total, customer)' }),
            el('div', { class: 'mt-1 flex items-center gap-2' }, [
              el('button', { class: 'btn-secondary', id: 'ox-po-choose', text: 'Choose file', onclick: function () { fileInput.click(); } }),
              el('span', { class: 'text-xs text-muted truncate', text: fileLabel }),
              state.file && /\.pdf$/i.test(state.file.name) && !state.poReading ? el('button', { class: 'text-xs text-primary font-medium', text: '↻ Read again', onclick: function () { readPO(state.file); } }) : null,
              fileInput
            ]),
            el('div', { class: 'mt-2' }, [poNoI]),
            poBanner()
          ]));
        } else {
          var ta2 = el('textarea', { class: INPUT, rows: '2', placeholder: 'What was agreed on the call / in person?' });
          ta2.value = state.verbalDetails;
          ta2.addEventListener('input', function () { state.verbalDetails = ta2.value; });
          wrap.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Verbal details' }), el('div', { class: 'mt-1' }, [ta2])]));
        }

        // Order date + engineer (admin only)
        var row = el('div', { class: 'grid grid-cols-2 gap-3' });
        var dateI = el('input', { type: 'date', class: INPUT });
        dateI.value = state.orderDate;
        dateI.addEventListener('input', function () { state.orderDate = dateI.value; });
        row.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Order date' }), el('div', { class: 'mt-1' }, [dateI])]));
        if (isAdmin()) {
          var engSel = el('select', { class: selectCls });
          function fillEngSel(list) {
            engSel.innerHTML = '';
            list.forEach(function (e2) {
              engSel.appendChild(el('option', { value: e2.id, text: e2.name, selected: e2.id === state.engineerId ? '' : null }));
            });
            engSel.value = state.engineerId;
          }
          if (dialogEngineers) {
            fillEngSel(dialogEngineers);
          } else {
            api('GET', '/orders/engineers').then(function (res) {
              dialogEngineers = (res.data && res.data.engineers) || [];
              fillEngSel(dialogEngineers);
            }).catch(function () {});
          }
          engSel.addEventListener('change', function () { state.engineerId = engSel.value; });
          row.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Engineer' }), el('div', { class: 'mt-1' }, [engSel])]));
        }
        wrap.appendChild(row);

        // Items
        wrap.appendChild(itemsEditor());

        // Notes
        var notesI = el('textarea', { class: INPUT, rows: '2', placeholder: 'Optional' });
        notesI.value = state.notes;
        notesI.addEventListener('input', function () { state.notes = notesI.value; });
        wrap.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Notes' }), el('div', { class: 'mt-1' }, [notesI])]));

        // Order value (optional) — counts in the Sales report by engineer
        var valI = el('input', { class: INPUT, id: 'ox-order-value', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'Optional — e.g. 125000' });
        valI.value = state.orderValue == null ? '' : state.orderValue;
        valI.addEventListener('input', function () { state.orderValue = valI.value; state.valueTyped = valI.value !== ''; });
        wrap.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Order value (₹, before tax)' }), el('div', { class: 'mt-1' }, [valI])]));

        return wrap;
      }

      /* Read a PDF purchase order: items, quantities, prices, PO no., total and the customer. */
      function readPO(file) {
        if (!window.POExtract || !/\.pdf$/i.test(file.name || '')) { state.poInfo = { notPdf: true }; render(); return; }
        state.poReading = true; state.poInfo = null; render();
        POExtract.fromFile(file).then(function (r) {
          if (!r.ok) { state.poReading = false; state.poInfo = { scanned: r.scanned, none: !r.scanned, total: r.total }; render(); return; }
          var codes = r.items.map(function (x) { return x.itemCode; }).filter(Boolean);
          return api('POST', '/orders/po-match', { text: r.text.slice(0, 150000), codes: codes }).catch(function () { return { data: { customer: null, products: {} } }; }).then(function (m) {
            var prods = (m.data && m.data.products) || {}, cust = m.data && m.data.customer;
            var lines = r.items.map(function (x) {
              var p = x.itemCode ? prods[String(x.itemCode).toUpperCase()] : null;
              return p ? { productId: p.id, itemCode: p.itemCode, productName: p.productName, unit: p.unit || x.unit || null, category: p.category || null, brand: p.brand || null, quantity: x.quantity, unitPrice: x.unitPrice, fromPO: true }
                       : { productId: null, itemCode: x.itemCode || 'MANUAL', productName: x.description || x.itemCode, unit: x.unit || null, category: null, brand: null, quantity: x.quantity, unitPrice: x.unitPrice, fromPO: true };
            });
            if (state.items.length && !confirm('Replace the ' + state.items.length + ' item(s) already on this order with the ' + lines.length + ' item(s) read from the PO?')) lines = state.items.concat(lines);
            state.items = lines;
            if (r.poNumber && !state.poNumber) state.poNumber = r.poNumber;
            var custSet = false;
            if (cust && !state.customerId) { state.customerId = cust.id; state.customerLabel = cust.companyName; custSet = true; }
            var value = r.itemsTotal || r.total;
            if (value && !state.valueTyped) state.orderValue = value;
            state.poInfo = { count: lines.length, matched: lines.filter(function (l) { return l.productId; }).length, total: r.total, itemsTotal: r.itemsTotal, poNumber: r.poNumber, poDate: r.poDate, customer: cust ? cust.companyName : null, custSet: custSet };
            state.poReading = false; render();
          });
        }).catch(function (e) { state.poReading = false; state.poInfo = { error: e.message }; render(); });
      }
      function poBanner() {
        var i = state.poInfo, box = function (cls, kids) { return el('div', { class: 'mt-2 text-xs rounded-lg px-3 py-2 ' + cls, id: 'ox-po-info' }, kids); };
        if (state.poReading) return box('bg-slate-50 dark:bg-slate-800 text-muted', ['Reading the purchase order…']);
        if (!i) return null;
        if (i.notPdf) return box('bg-slate-50 dark:bg-slate-800 text-muted', ['Photos / scans are attached as they are — add the items below.']);
        if (i.scanned) return box('bg-amber-50 text-amber-800', ['This PDF is a scanned picture (no text inside), so it cannot be read — add the items below.']);
        if (i.none || i.error) return box('bg-amber-50 text-amber-800', [i.error ? 'Could not read the PO: ' + i.error : 'No item table was found in this PO — add the items below.']);
        var bits = ['✓ Read ' + i.count + ' item' + (i.count === 1 ? '' : 's') + ' from the PO'];
        if (i.poNumber) bits.push('PO no. ' + i.poNumber + (i.poDate ? ' · ' + i.poDate : ''));
        if (i.itemsTotal) bits.push('items ₹' + Number(i.itemsTotal).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
        if (i.total && Math.abs(i.total - i.itemsTotal) > 1) bits.push('PO total ₹' + Number(i.total).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' (incl. tax / charges)');
        bits.push(i.customer ? 'customer: ' + i.customer + (i.custSet ? ' (filled in)' : '') : 'customer not found in the PO — pick it above');
        bits.push(i.matched + ' of ' + i.count + ' found in Products; the rest are added as new products');
        return box('bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200', [bits.join(' · '), el('div', { class: 'mt-1 font-semibold', text: 'Check every line below — you can change the code, description, quantity and price.' })]);
      }

      // ── Items: cards like the price-request page (search a product or type it in; Excel upload) ──
      function blankItem() { return { productId: null, itemCode: '', productName: '', unit: 'PCS', category: null, brand: null, quantity: '', unitPrice: null, _new: true }; }
      function itemsEditor() {
        var wrap = el('div', { class: 'ox-items', id: 'ox-items' });
        var fileIn = el('input', { type: 'file', accept: '.xlsx,.csv', style: 'display:none', id: 'ox-items-file' });
        fileIn.addEventListener('change', function () {
          var f = fileIn.files[0]; if (!f) return;
          var fd = new FormData(); fd.append('file', f);
          api('POST', '/orders/items-parse', fd).then(function (r) {
            var lines = (r.data.items || []).map(function (x) { return { productId: x.productId, itemCode: x.itemCode, productName: x.productName, unit: x.unit, category: x.category, brand: x.brand, quantity: x.quantity == null ? '' : x.quantity, unitPrice: x.unitPrice }; });
            var real = state.items.filter(function (x) { return x.productName || (x.itemCode && x.itemCode !== 'MANUAL'); });
            state.items = real.length && !confirm('Replace the ' + real.length + ' item(s) already on this order with the ' + lines.length + ' from the file?\n(Cancel adds them below.)') ? real.concat(lines) : lines;
            errMsg = (r.data.problems || []).length ? 'Check: ' + r.data.problems.slice(0, 4).join(' · ') : '';
            render();
          }).catch(function (e) { errMsg = e.message; render(); });
        });
        wrap.appendChild(el('div', { class: 'ox-items-h' }, [
          el('div', {}, [el('span', { class: 'ox-items-t', text: 'Items' }), el('span', { class: 'ox-items-s', text: 'search a product or type it in · quantity required · price optional' })]),
          el('div', { class: 'ox-items-acts' }, [
            el('button', { type: 'button', class: 'ox-ibtn', id: 'ox-add-item', onclick: function () { state.items.push(blankItem()); render(); var c = document.querySelectorAll('[data-item-card] [data-f="productName"]'); if (c.length) c[c.length - 1].focus(); } }, [ic('plus'), 'Add item']),
            el('button', { type: 'button', class: 'ox-ibtn', id: 'ox-items-upload', onclick: function () { fileIn.click(); } }, [ic('upload'), 'Upload items from Excel']),
            el('button', { type: 'button', class: 'ox-ibtn sm', id: 'ox-items-template', onclick: function () { downloadFile('/orders/items-template', 'order-items-template.xlsx'); } }, [ic('download'), 'Template']),
            fileIn])
        ]));
        if (!state.items.length) state.items.push(blankItem());
        state.items.forEach(function (it, idx) { wrap.appendChild(itemCard(it, idx)); });
        wrap.appendChild(el('div', { class: 'ox-items-tot', id: 'ox-items-total' }, [el('span', { text: '' }), el('b', { id: 'ox-items-total-v' })]));
        setTimeout(paintTotal, 0);
        // stock for lines that don't have it yet (manual codes, older orders)
        var need = state.items.filter(function (x) { return x.itemCode && x.itemCode !== 'MANUAL' && x.stock === undefined; });
        if (need.length) {
          need.forEach(function (x) { x.stock = null; x._stockPending = true; });
          api('GET', '/orders/stock-check?codes=' + encodeURIComponent(need.map(function (x) { return x.itemCode; }).join(','))).then(function (res) {
            var map = (res.data && res.data.stock) || {};
            need.forEach(function (x) { x.stock = map[String(x.itemCode).toUpperCase()] || null; x._stockPending = false; });
            render();
          }).catch(function () { need.forEach(function (x) { x._stockPending = false; }); });
        }
        return wrap;
      }
      function paintTotal() {
        var tot = state.items.reduce(function (a, x) { return a + (Number(x.unitPrice) || 0) * (Number(x.quantity) || 0); }, 0);
        var v = document.getElementById('ox-items-total-v'), row = document.getElementById('ox-items-total');
        if (!v || !row) return;
        row.style.display = tot ? '' : 'none';
        v.textContent = 'Items total ₹' + tot.toLocaleString('en-IN', { maximumFractionDigits: 2 });
      }
      function itemCard(it, idx) {
        function f(label, req, node, cls) { return el('label', { class: 'ox-f' + (cls ? ' ' + cls : '') }, [el('span', {}, [label, req ? el('i', { text: ' *' }) : null]), node]); }
        function autoValue() {
          if (state.valueTyped) return;
          var priced = state.items.filter(function (x) { return x.unitPrice != null && x.unitPrice !== ''; });
          if (!priced.length) return;
          state.orderValue = Math.round(state.items.reduce(function (a, x) { return a + (Number(x.unitPrice) || 0) * (Number(x.quantity) || 0); }, 0) * 100) / 100;
          var ov = document.getElementById('ox-order-value'); if (ov) ov.value = state.orderValue;
        }
        // product: type a name / code → suggestions from Products; or keep what you typed (a new product)
        var nameI = el('input', { class: INPUT, 'data-f': 'productName', placeholder: 'Product name or item code', autocomplete: 'off', value: it.productName || '' });
        var sugg = el('div', { class: 'ox-sugg-box', hidden: true });
        var t;
        nameI.addEventListener('input', function () {
          it.productName = nameI.value; if (it.productId) { it.productId = null; it.stock = undefined; }
          clearTimeout(t);
          var q = nameI.value.trim();
          if (q.length < 2) { sugg.hidden = true; return; }
          t = setTimeout(function () {
            api('GET', '/products/search?q=' + encodeURIComponent(q)).then(function (res) {
              var results = ((res.data && res.data.results) || []).slice(0, 8);
              sugg.innerHTML = ''; sugg.hidden = !results.length;
              results.forEach(function (p) {
                var stk = p.stock;
                sugg.appendChild(el('button', { type: 'button', class: 'ox-sugg', 'data-sugg': p.itemCode, onmousedown: function (e) { e.preventDefault(); },
                  onclick: function () {
                    it.productId = p.id; it.itemCode = p.itemCode; it.productName = p.productName; it.unit = p.unit || it.unit; it.category = p.category || null; it.brand = p.brand || null; it.stock = stk || null;
                    if (!it.quantity) it.quantity = 1;
                    if ((it.unitPrice == null || it.unitPrice === '') && p.price) it.unitPrice = Number(p.price);
                    sugg.hidden = true; render(); autoValue();
                  } }, [
                  el('div', { class: 'ox-sugg-l' }, [el('b', { text: p.itemCode }), p.brand ? el('span', { class: 'ox-chip', text: p.brand }) : null, p.grade ? el('span', { class: 'ox-chip g', text: 'Grade ' + p.grade }) : null,
                    el('span', { class: 'ox-chip ' + (stk && stk.total > 0 ? 'ok' : 'no'), text: stk ? 'Stock ' + fmtQty(stk.total) : 'Not in stock list' })]),
                  el('div', { class: 'ox-sugg-d', text: [p.specification, p.productName].filter(Boolean).join(' · ') })]));
              });
            }).catch(function () {});
          }, 250);
        });
        nameI.addEventListener('blur', function () { setTimeout(function () { sugg.hidden = true; }, 150); });
        var codeI = el('input', { class: INPUT, 'data-f': 'itemCode', placeholder: 'Item code', value: it.itemCode && it.itemCode !== 'MANUAL' ? it.itemCode : '' });
        codeI.addEventListener('change', function () { var v = codeI.value.trim().toUpperCase(); if (v !== (it.itemCode === 'MANUAL' ? '' : it.itemCode)) { it.itemCode = v || 'MANUAL'; it.productId = null; it.stock = undefined; render(); } });
        var catI = el('input', { class: INPUT, 'data-f': 'category', placeholder: 'e.g. Inserts', value: it.category || '' });
        catI.addEventListener('input', function () { it.category = catI.value.trim() || null; });
        var brand = brandSelect(it.brand, function (v) { it.brand = v || null; });
        var qty = el('input', { type: 'number', min: '0.01', step: 'any', class: INPUT, 'data-f': 'quantity', placeholder: '0', value: it.quantity === '' || it.quantity == null ? '' : it.quantity });
        var unitI = el('input', { class: INPUT, 'data-f': 'unit', placeholder: 'PCS', value: it.unit || '' });
        unitI.addEventListener('input', function () { it.unit = unitI.value.trim() || null; });
        var price = el('input', { type: 'number', min: '0', step: '0.01', class: INPUT, 'data-f': 'unitPrice', 'data-line-price': String(idx), placeholder: '0.00', value: it.unitPrice == null ? '' : it.unitPrice });
        var amt = el('div', { class: 'ox-amt', 'data-line-amount': String(idx) });
        var stockEl = el('div', { class: 'ox-line-stock', 'data-line-stock': it.itemCode || '' });
        function paint() {
          var a = (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0);
          amt.textContent = it.unitPrice != null && it.unitPrice !== '' && it.quantity ? '₹' + a.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
          stockEl.innerHTML = '';
          if (!it.itemCode || it.itemCode === 'MANUAL') { if (it.productName && !it.productId) stockEl.appendChild(el('span', { class: 'ox-stock ox-stock-none', text: 'New product — not in Products yet' })); return; }
          if (it._stockPending || it.stock === undefined) { stockEl.appendChild(el('span', { class: 'text-muted', text: 'Checking stock…' })); return; }
          var st = it.stock, q = Number(it.quantity) || 0;
          if (!st) { stockEl.appendChild(el('span', { class: 'ox-stock ox-stock-none', text: 'Not in stock list — needs to be procured' })); return; }
          var cls = st.total <= 0 ? 'ox-stock-none' : (st.hand >= q ? 'ox-stock-ok' : 'ox-stock-low');
          stockEl.appendChild(el('span', { class: 'ox-stock ' + cls, text: 'In hand ' + fmtQty(st.hand) + ' · total ' + fmtQty(st.total) + (st.onOrder ? ' · on open orders ' + fmtQty(st.onOrder) : '') +
            (q > st.hand ? (q > st.total ? ' — short by ' + fmtQty(q - st.total) : ' — ' + fmtQty(q - st.hand) + ' from other places') : ' — enough in hand') }));
        }
        paint();
        var basePaint = paint; paint = function () { basePaint(); paintTotal(); };
        qty.addEventListener('input', function () { it.quantity = qty.value === '' ? '' : Number(qty.value); paint(); autoValue(); });
        price.addEventListener('input', function () { it.unitPrice = price.value === '' ? null : Number(price.value); paint(); autoValue(); });
        var tags = [it.productId ? null : (it.productName ? 'new product' : null), it.fromPO ? 'from PO' : null].filter(Boolean).join(' · ');
        return el('div', { class: 'ox-card', 'data-item-card': String(idx), 'data-edit-line': String(idx) }, [
          el('div', { class: 'ox-card-h' }, [el('span', { class: 'ox-badge', text: 'Item ' + (idx + 1) }), tags ? el('span', { class: 'ox-tag', text: tags }) : null,
            el('button', { type: 'button', class: 'ox-x', 'aria-label': 'Remove item ' + (idx + 1), title: 'Remove item', onclick: function () { state.items.splice(idx, 1); render(); } }, [ic('trash')])]),
          el('div', { class: 'ox-grid' }, [
            f('Product', true, el('div', { class: 'ox-rel' }, [nameI, sugg]), 'w2'),
            f('Item code', false, codeI), f('Category', false, catI), f('Brand', false, brand), f('Quantity', true, qty),
            f('Unit', false, unitI), f('Price ₹/unit', false, price), f('Amount', false, amt)
          ]),
          stockEl
        ]);
      }
      /** Items to save: blank cards dropped; every other card needs a product and a quantity. */
      function readyItems() {
        var out = [], bad = '';
        state.items.forEach(function (i, k) {
          var hasAny = (i.productName || '').trim() || (i.itemCode && i.itemCode !== 'MANUAL') || i.quantity;
          if (!hasAny) return;
          if (!(i.productName || '').trim() && !(i.itemCode && i.itemCode !== 'MANUAL')) { bad = bad || 'Item ' + (k + 1) + ': enter the product.'; return; }
          if (!(Number(i.quantity) > 0)) { bad = bad || 'Item ' + (k + 1) + ' (' + (i.productName || i.itemCode) + '): enter the quantity.'; return; }
          out.push({ productId: i.productId, quantity: Number(i.quantity), productName: (i.productName || '').trim() || i.itemCode, itemCode: i.itemCode || 'MANUAL', unit: i.unit, category: i.category, brand: i.brand, unitPrice: i.unitPrice == null ? '' : i.unitPrice });
        });
        return { items: out, error: bad };
      }

      function footer() {
        var kids = [];
        if (isCreate) {
          kids.push(el('button', { class: 'btn-secondary', text: 'Cancel', onclick: close }));
          kids.push(el('button', { class: 'btn-primary', text: 'Create order', onclick: submitCreate }));
        } else if (editing) {
          kids.push(el('button', { class: 'btn-secondary', text: 'Cancel', onclick: function () { editing = false; render(); } }));
          kids.push(el('button', { class: 'btn-primary', text: 'Save', onclick: submitEdit }));
        } else {
          if (isSuperAdminUser()) kids.push(el('button', { class: 'text-red-500 text-sm font-medium mr-auto', text: 'Delete', onclick: confirmDelete }));
          if (canEdit) kids.push(el('button', { class: 'btn-secondary', text: 'Edit', onclick: function () { editing = true; render(); } }));
          kids.push(el('button', { class: 'btn-primary', text: 'Close', onclick: close }));
        }
        return el('div', { class: 'flex gap-2 justify-end mt-5' }, kids);
      }

      function confirmDelete() {
        if (!confirm('Delete this order? This cannot be undone.')) return;
        api('DELETE', '/orders/' + order.id).then(function () {
          close();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function submitCreate() {
        errMsg = '';
        if (!state.customerId) { errMsg = 'Please choose a customer.'; return render(); }
        if (!state.firm) { errMsg = 'Choose TMS or APJ (our company).'; return render(); }
        var ready = readyItems();
        if (ready.error) { errMsg = ready.error; return render(); }
        if (!ready.items.length) { errMsg = 'Add at least one item.'; return render(); }
        if (state.orderType === 'PO' && !state.file) { errMsg = 'Please attach the purchase order document.'; return render(); }
        if (state.orderType === 'VERBAL' && !state.verbalDetails.trim()) { errMsg = 'Please note what was agreed.'; return render(); }

        var fd = new FormData();
        fd.append('customerId', state.customerId);
        fd.append('orderType', state.orderType);
        fd.append('firm', state.firm);
        fd.append('orderDate', state.orderDate);
        fd.append('notes', state.notes || '');
        fd.append('orderValue', state.orderValue == null ? '' : String(state.orderValue));
        fd.append('items', JSON.stringify(ready.items));
        fd.append('poNumber', state.orderType === 'PO' ? (state.poNumber || '') : '');
        if (state.orderType === 'VERBAL') fd.append('verbalDetails', state.verbalDetails);
        if (state.orderType === 'PO' && state.file) fd.append('file', state.file);
        if (isAdmin() && state.engineerId) fd.append('engineerId', state.engineerId);

        api('POST', '/orders', fd).then(function () {
          close();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function submitEdit() {
        errMsg = '';
        var ready = readyItems();
        if (ready.error) { errMsg = ready.error; return render(); }
        if (!ready.items.length) { errMsg = 'Add at least one item.'; return render(); }
        if (!state.firm) { errMsg = 'Choose TMS or APJ (our company).'; return render(); }

        var goingToPO = state.orderType === 'PO' && order.orderType !== 'PO';
        if (goingToPO && !state.file) {
          errMsg = 'Attach a document to switch this order to Purchase order.';
          return render();
        }
        if (state.orderType === 'VERBAL' && !state.verbalDetails.trim()) {
          errMsg = 'Please note what was agreed.'; return render();
        }

        var body2 = {
          customerId: state.customerId,
          orderType: goingToPO ? order.orderType : state.orderType, // don't flip to PO here — the upload call below does that
          orderDate: state.orderDate,
          firm: state.firm,
          notes: state.notes,
          orderValue: state.orderValue == null ? '' : String(state.orderValue),
          items: ready.items,
          poNumber: state.orderType === 'PO' ? (state.poNumber || '') : '',
        };
        if (state.orderType === 'VERBAL') body2.verbalDetails = state.verbalDetails;

        api('PUT', '/orders/' + order.id, body2).then(function (res) {
          if (goingToPO && state.file) {
            var fd = new FormData();
            fd.append('file', state.file);
            return api('POST', '/orders/' + order.id + '/document', fd);
          }
          if (state.orderType === 'PO' && state.file) {
            // replacing an existing PO's document
            var fd2 = new FormData();
            fd2.append('file', state.file);
            return api('POST', '/orders/' + order.id + '/document', fd2);
          }
          return res;
        }).then(function (res) {
          order = res.data.order;
          editing = false;
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      render();
    }
  }

  window.Orders = { mountPage: mount, openOrderDialog: openOrderDialog };
})();
