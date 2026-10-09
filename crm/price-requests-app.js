/* ══════════════════════════════════════════════════════════════════════
   Price requests — its own page (was a tab on Tasks).

   New request   pick the company, add one or many items (product, category,
                 brand, Regular / One time, quantity, unit, target price,
                 discount %, note) — typed in, or uploaded from the Excel
                 template — then Raise request.
   Requests      every request with its items and answers. Admin / Super
                 Admin answer per item (approved price + discount, or reject
                 with a reason) and save them together.

   Data: /api/price-requests/* (api/controllers/PriceRequestController.php).

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var ROOT = null;
  var CATS = [];
  var TYPES = { REGULAR: 'Regular', ONE_TIME: 'One time' };
  var PRIO = { URGENT: ['Urgent', '#dc2626'], HIGH: ['High', '#ea580c'], NORMAL: ['Normal', '#2563eb'], LOW: ['Low', '#64748b'] };
  var PRIO_KEYS = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
  function prioBadge(p) { var x = PRIO[p]; return x ? el('span', { class: 'pr-badge', 'data-prio': p, style: '--c:' + x[1], text: (p === 'URGENT' ? '● ' : '') + x[0] }) : el('span', { class: 'pr-meta', text: '—' }); }

  /* ── helpers ─────────────────────────────────────────────────────── */
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  function api(method, path, body) {
    return fetch(API + '/api' + path, {
      method: method, headers: { Authorization: 'Bearer ' + (token() || ''), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed (' + r.status + ')');
        return j;
      });
    });
  }
  /* A download must really be the file: Excel / zip start with "PK", PDF with "%PDF".
     If something was printed in front of it, cut it off; if the server sent an
     error page instead, show that message rather than saving a broken file. */
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
  function download(path, name) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) throw new Error('Download failed');
      return r.blob().then(function (b) { return checkFile(b, name); }).then(function (b) {
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
  function dmyDate(s) { var d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function money(v) { return v == null || v === '' || isNaN(Number(v)) ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function num(v) { var x = String(v == null ? '' : v).replace(/[,₹\s%]|rs\.?/gi, ''); return x === '' || isNaN(Number(x)) ? null : Number(x); }
  function when(s) {
    var d = new Date(String(s || '').replace(' ', 'T'));
    return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function toast(msg, kind) {
    document.querySelectorAll('.pr-toast').forEach(function (o) { o.remove(); }); // one message at a time
    var t = el('div', { class: 'pr-toast ' + (kind || 'ok'), role: 'status', text: msg });
    var foot = document.querySelector('.pr-foot');
    if (foot) t.style.bottom = (Math.ceil(window.innerHeight - foot.getBoundingClientRect().top) + 12) + 'px'; // above the sticky bar
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.classList.remove('in'); }, 3400);
    setTimeout(function () { t.remove(); }, 3800);
  }
  var canRespond = false, isAdminTier = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(me().role) !== -1;
  var STATUS = {
    PENDING: ['Pending', '#d97706'], APPROVED: ['Approved', '#16a34a'], REJECTED: ['Rejected', '#dc2626'],
    PARTIAL: ['Partly answered', '#2563eb'], DONE: ['Answered', '#0f766e']
  };
  function badge(s) { var x = STATUS[s] || [s, '#64748b']; return el('span', { class: 'pr-badge', style: '--c:' + x[1], text: x[0] }); }

  /* ── styles ──────────────────────────────────────────────────────── */
  function injectCss() {
    if (document.getElementById('pr-css')) return;
    var st = document.createElement('style');
    st.id = 'pr-css';
    st.textContent = [
      '.pr-sup{margin-top:.8rem;border:1px solid #e2e8f0;border-radius:.7rem;padding:.5rem .8rem;background:#f8fafc}.dark .pr-sup{background:#0f172a;border-color:#334155}',
      '.pr-sup summary{cursor:pointer;font-weight:700;font-size:.9rem;padding:.2rem 0}',
      '.pr-sup-body{display:flex;flex-direction:column;gap:.6rem;margin-top:.5rem}.pr-sup-ask{display:flex;flex-direction:column;gap:.4rem}',
      '.pr-sup-items{display:flex;flex-wrap:wrap;gap:.3rem .9rem;font-size:.82rem}.pr-sup-items label{display:inline-flex;align-items:center;gap:.25rem;cursor:pointer}',
      '.pr-sup-msg textarea{font-family:inherit;font-size:.82rem;width:100%}.pr-sup-pl{display:flex;flex-direction:column;gap:.2rem}',
      '.pr-sup-hint{color:#0f766e;font-weight:600}',
      '.pr-wrap{max-width:1300px;margin:0 auto}',
      '.pr-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem;margin-bottom:1rem}',
      '.pr-head h1{font-size:1.35rem;font-weight:700;margin:0}.pr-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.pr-btn{display:inline-flex;align-items:center;gap:.4rem;border-radius:.55rem;padding:.5rem .9rem;font-size:.85rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap;transition:background-color .15s,border-color .15s,color .15s,transform .1s}',
      '.pr-btn:hover{background:#f1f5f9}.pr-btn:active{transform:scale(.98)}.pr-btn:disabled{opacity:.55;cursor:default;transform:none}',
      '.pr-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.pr-btn.pri:hover{background:#1e40af}',
      '.pr-btn.grn{background:#0f766e;border-color:#0f766e;color:#fff}.pr-btn.grn:hover{background:#115e59}',
      '.pr-btn.red{color:#b91c1c;border-color:#fecaca}.pr-btn.red:hover{background:#fef2f2}',
      '.pr-btn.sm{padding:.3rem .6rem;font-size:.78rem}',
      '.dark .pr-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .pr-btn:hover{background:#273449}',
      '.dark .pr-btn.pri{background:#2563eb;border-color:#2563eb}.dark .pr-btn.grn{background:#0d9488;border-color:#0d9488}',
      '.pr-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;margin-bottom:1rem;overflow-x:auto}.dark .pr-tabs{border-color:#334155}',
      '.pr-tab{padding:.6rem 1rem;font-size:.88rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;transition:color .15s,border-color .2s}',
      '.pr-tab:hover{color:#334155}.pr-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .pr-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.pr-tab .n{display:inline-block;margin-left:.35rem;background:#fef3c7;color:#92400e;border-radius:999px;padding:0 .45rem;font-size:.72rem}',
      '.pr-card{background:#fff;border:1px solid #e2e8f0;border-radius:.8rem;padding:1rem;margin-bottom:.9rem}.dark .pr-card{background:#0f172a;border-color:#1e293b}',
      '.pr-card h2{font-size:.95rem;margin:0 0 .7rem;display:flex;align-items:center;gap:.5rem}',
      '.pr-card h2 small{font-weight:500;color:#64748b;font-size:.78rem}',
      'select.pr-prio{font-weight:600}select.pr-prio[data-p=URGENT]{color:#dc2626;border-color:#fca5a5;background:#fef2f2}select.pr-prio[data-p=HIGH]{color:#c2410c;border-color:#fdba74;background:#fff7ed}select.pr-prio[data-p=LOW]{color:#64748b}',
      '.pr-in{border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.85rem;background:#fff;color:#0f172a;min-width:0;width:100%;transition:border-color .15s,box-shadow .15s}',
      '.pr-in:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}',
      '.pr-in.bad{border-color:#dc2626;background:#fef2f2}',
      '.dark .pr-in{background:#1e293b;border-color:#334155;color:#e2e8f0}',
      '.pr-f label{display:block;font-size:.72rem;font-weight:600;color:#475569;margin-bottom:.2rem}.dark .pr-f label{color:#94a3b8}',
      '.pr-f label .req{color:#dc2626}',
      '.pr-row2{display:grid;grid-template-columns:1fr;gap:.7rem}@media(min-width:760px){.pr-row2{grid-template-columns:2fr 3fr}}',
      '.pr-pick{position:relative}',
      '.pr-sugg{position:absolute;left:0;right:0;top:100%;margin-top:2px;background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;box-shadow:0 12px 28px rgba(15,23,42,.14);max-height:260px;overflow-y:auto;z-index:30;animation:prpop .14s ease-out}',
      '.dark .pr-sugg{background:#1e293b;border-color:#334155}',
      '.pr-sugg button{display:block;width:100%;text-align:left;background:none;border:none;padding:.5rem .65rem;font-size:.84rem;cursor:pointer;color:inherit}',
      '.pr-sugg button:hover,.pr-sugg button:focus{background:#f1f5f9;outline:none}.dark .pr-sugg button:hover{background:#273449}',
      '.pr-sugg .s{display:block;font-size:.74rem;color:#64748b}',
      '.pr-chosen{display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.45rem .6rem;border:1px solid #2563eb;border-radius:.5rem;background:#eff6ff;font-size:.88rem}',
      '.dark .pr-chosen{background:#172554}',
      '.pr-chosen button{background:none;border:none;color:#2563eb;font-weight:700;font-size:.78rem;cursor:pointer}',
      '.pr-tools{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.7rem}',
      '.pr-items{display:flex;flex-direction:column;gap:.6rem}',
      '.pr-item{border:1px solid #e2e8f0;border-radius:.7rem;padding:.75rem;position:relative;background:#fff;animation:prin .2s ease-out}',
      '.dark .pr-item{background:#0f172a;border-color:#1e293b}',
      '.pr-item.has-err{border-color:#fca5a5;box-shadow:0 0 0 3px rgba(220,38,38,.08)}',
      '.pr-item .no{position:absolute;top:-.55rem;left:.7rem;background:#1e3a8a;color:#fff;border-radius:999px;font-size:.7rem;font-weight:700;padding:.05rem .5rem}',
      '.pr-item .rm{position:absolute;top:.45rem;right:.45rem;width:28px;height:28px;border-radius:.45rem;border:1px solid #e2e8f0;background:#fff;color:#94a3b8;cursor:pointer;transition:color .15s,border-color .15s}',
      '.pr-item .rm:hover{color:#dc2626;border-color:#fca5a5}.dark .pr-item .rm{background:#1e293b;border-color:#334155}',
      '.pr-igrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem .7rem;margin-top:.35rem}',
      '@media(min-width:900px){.pr-igrid{grid-template-columns:repeat(6,minmax(0,1fr))}.pr-igrid .p{grid-column:span 2}.pr-igrid .pr-f:nth-child(4){grid-column:span 2}}',
      '.pr-igrid{align-items:start}.pr-igrid .pr-f label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pr-igrid .wide{grid-column:1/-1}@media(min-width:900px){.pr-igrid .p{grid-column:span 1}}',
      '.pr-seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:.5rem;overflow:hidden;width:100%}.dark .pr-seg{border-color:#334155}',
      '.pr-seg button{flex:1;border:none;background:#fff;padding:.42rem .3rem;font-size:.8rem;cursor:pointer;color:#334155;transition:background-color .15s,color .15s}',
      '.dark .pr-seg button{background:#1e293b;color:#cbd5e1}',
      '.pr-seg button+button{border-left:1px solid #cbd5e1}.pr-seg button.on{background:#1e3a8a;color:#fff;font-weight:600}',
      '.pr-seg.bad{border-color:#dc2626}',
      '.pr-meta{font-size:.74rem;color:#64748b;margin-top:.35rem}',
      '.pr-err{font-size:.74rem;color:#b91c1c;margin-top:.35rem}',
      '.pr-problems{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:.6rem;padding:.6rem .8rem;font-size:.8rem;margin-bottom:.7rem}',
      '.dark .pr-problems{background:#422006;border-color:#713f12;color:#fde68a}',
      '.pr-problems ul{margin:.3rem 0 0 1rem;padding:0}',
      '.pr-foot{position:sticky;bottom:8px;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;background:#0f172a;color:#fff;border-radius:.8rem;padding:.7rem .9rem;margin-top:.4rem;box-shadow:0 -6px 20px rgba(0,0,0,.12)}',
      '.pr-foot span{font-size:.85rem}',
      '.pr-empty{padding:2rem 1rem;text-align:center;color:#64748b;font-size:.88rem}',
      /* requests */
      '.pr-filters{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.8rem;align-items:center}',
      '.pr-chip{border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:.3rem .8rem;font-size:.8rem;cursor:pointer;transition:background-color .15s,border-color .15s}',
      '.pr-chip.on{border-color:#1e3a8a;background:#eff6ff;font-weight:600;color:#1e3a8a}.dark .pr-chip{background:#0f172a;border-color:#334155}.dark .pr-chip.on{background:#172554;color:#bfdbfe}',
      '.pr-req{border:1px solid #e2e8f0;border-radius:.8rem;background:#fff;margin-bottom:.6rem;overflow:hidden;transition:box-shadow .2s,border-color .2s}',
      '.pr-req:hover{border-color:#cbd5e1}.pr-req.open{box-shadow:0 8px 24px rgba(15,23,42,.08)}',
      '.dark .pr-req{background:#0f172a;border-color:#1e293b}',
      '.pr-rh{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem;padding:.8rem .9rem;cursor:pointer;align-items:center;width:100%;background:none;border:none;text-align:left;color:inherit;font:inherit}',
      '.pr-rh .t{font-weight:600}.pr-rh .s{font-size:.78rem;color:#64748b}',
      '.pr-rh .chev{transition:transform .25s ease;color:#94a3b8}.pr-req.open .pr-rh .chev{transform:rotate(90deg)}',
      '.pr-rb{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s ease}',
      '.pr-req.open .pr-rb{grid-template-rows:1fr}',
      '.pr-rb>div{overflow:hidden}',
      '.pr-rbi{padding:0 .9rem .9rem}',
      '.pr-badge{display:inline-block;border-radius:999px;padding:.12rem .55rem;font-size:.72rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,#fff);white-space:nowrap}',
      '.dark .pr-badge{background:color-mix(in srgb,var(--c) 22%,#0f172a)}',
      '.pr-tbl{width:100%;border-collapse:collapse;font-size:.8rem}',
      '.pr-tbl th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.45rem .5rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.pr-tbl td{padding:.5rem;border-bottom:1px solid #f1f5f9;vertical-align:top}.dark .pr-tbl td,.dark .pr-tbl th{border-color:#1e293b}',
      '.pr-tbl .r{text-align:right;white-space:nowrap}',
      '.pr-scroll{overflow-x:auto}',
      '.pr-ans{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem;min-width:220px}',
      '.pr-ans .full{grid-column:1/-1}',
      '.pr-ans .pr-seg button{padding:.32rem .3rem;font-size:.76rem}',
      '.pr-ans .pr-seg button.on[data-v=APPROVED]{background:#16a34a}.pr-ans .pr-seg button.on[data-v=REJECTED]{background:#dc2626}',
      '.pr-ractions{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end;margin-top:.7rem;align-items:center}',
      '.pr-hist{margin-top:.35rem}.pr-hist summary{cursor:pointer;font-size:.74rem;color:#2563eb;font-weight:600}.pr-hist div{margin:.2rem 0 0 .6rem}',
      '.pr-note{background:#f8fafc;border-radius:.5rem;padding:.5rem .7rem;font-size:.8rem;color:#475569;margin-bottom:.6rem}.dark .pr-note{background:#111827;color:#94a3b8}',
      '.pr-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;box-shadow:0 10px 25px rgba(0,0,0,.2);transition:opacity .25s ease,transform .25s ease;max-width:calc(100vw - 32px)}',
      '.pr-toast.in{opacity:1;transform:translate(-50%,0)}.pr-toast.err{background:#b91c1c}',
      '@keyframes prin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '@keyframes prpop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.pr-item,.pr-sugg{animation:none}.pr-rb,.pr-rh .chev,.pr-toast{transition:none}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ── page ────────────────────────────────────────────────────────── */
  var state = { tab: 'requests', filter: 'OPEN', search: '', who: '', open: {}, form: null, drafts: {}, editing: {}, supOpen: {} };

  function mountPage(content) {
    injectCss();
    ROOT = el('div', { class: 'pr-wrap' });
    content.appendChild(ROOT);
    var h = (location.hash || '').replace('#', '');
    if (h === 'new') state.tab = 'new';
    else if (h && h !== 'requests') { state.open[h] = true; state.filter = 'ALL'; }
    api('GET', '/categories').then(function (r) { CATS = ((r.data && r.data.categories) || []).map(function (c) { return c.name; }); }).catch(function () {});
    render();
    window.addEventListener('beforeunload', function (e) {
      if (state.form && state.form.items.some(function (i) { return i.productName || i.brand; })) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function render() {
    clear(ROOT);
    ROOT.appendChild(el('div', { class: 'pr-head' }, [
      el('div', {}, [
        el('h1', { text: 'Price requests' }),
        el('p', { text: isAdminTier ? 'Engineers ask for prices here — answer each item with the approved price and discount.' : 'Ask for a price for one or many items for a company. You’ll get an alert when it’s answered.' })
      ]),
      el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' }, [
        el('button', { class: 'pr-btn', type: 'button', text: '⤓ Excel template', onclick: function () { download('/price-requests/template', 'price-request-template.xlsx').catch(function (e) { toast(e.message, 'err'); }); } }),
        state.tab !== 'new' ? el('button', { class: 'pr-btn pri', type: 'button', id: 'pr-new', text: '＋ New price request', onclick: function () { go('new'); } }) : null
      ])
    ]));
    var tabs = el('div', { class: 'pr-tabs', role: 'tablist' });
    [['new', 'New request'], ['requests', isAdminTier ? 'All requests' : 'My requests']].forEach(function (t) {
      tabs.appendChild(el('button', { class: 'pr-tab' + (state.tab === t[0] ? ' on' : ''), role: 'tab', type: 'button', 'data-tab': t[0], onclick: function () { go(t[0]); } },
        [t[1], t[0] === 'requests' && state.openCount ? el('span', { class: 'n', text: String(state.openCount) }) : null]));
    });
    ROOT.appendChild(tabs);
    var body = el('div', { class: 'pr-body' });
    ROOT.appendChild(body);
    if (state.tab === 'new') renderNew(body); else renderRequests(body);
  }
  function go(tab) { state.tab = tab; history.replaceState(null, '', '#' + tab); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  /* ── New request ─────────────────────────────────────────────────── */
  function blankItem() { return { productId: '', itemCode: '', productName: '', category: '', brand: '', supplyType: '', quantity: '', unit: '', requestedPrice: '', priority: 'NORMAL', notes: '', listPrice: null, problems: [] }; }

  function renderNew(body) {
    if (!state.form) state.form = { customer: null, notes: '', items: [blankItem()], source: 'FORM', problems: [] };
    var F = state.form;

    // Company
    var compHost = el('div', { class: 'pr-pick' });
    function drawCompany() {
      clear(compHost);
      if (F.customer) {
        compHost.appendChild(el('div', { class: 'pr-chosen' }, [
          el('span', {}, [el('b', { text: F.customer.companyName }), F.customer.contactPerson ? el('span', { class: 'pr-meta', text: ' · ' + F.customer.contactPerson }) : null]),
          el('button', { type: 'button', text: 'Change', onclick: function () { F.customer = null; drawCompany(); var i = compHost.querySelector('input'); if (i) i.focus(); } })
        ]));
        return;
      }
      var inp = el('input', { class: 'pr-in', id: 'pr-company', placeholder: 'Type company name, contact or phone…', autocomplete: 'off', 'aria-label': 'Company' });
      var sugg = null, t, seq = 0;
      function close() { if (sugg) { sugg.remove(); sugg = null; } }
      function search() {
        var q = inp.value.trim(), my = ++seq;
        api('GET', '/customers?limit=12' + (q ? '&search=' + encodeURIComponent(q) : '')).then(function (r) {
          if (my !== seq) return;
          close();
          var items = (r.data && r.data.items) || [];
          sugg = el('div', { class: 'pr-sugg', role: 'listbox' });
          if (!items.length) sugg.appendChild(el('div', { class: 'pr-empty', style: 'padding:.7rem', text: 'No company found. Add it on the Customers page first.' }));
          items.forEach(function (c) {
            sugg.appendChild(el('button', { type: 'button', role: 'option', onmousedown: function (e) { e.preventDefault(); F.customer = c; close(); drawCompany(); } },
              [el('b', { text: c.companyName }), el('span', { class: 's', text: [c.contactPerson, c.contactNumber, c.location].filter(Boolean).join(' · ') })]));
          });
          compHost.appendChild(sugg);
        }).catch(function () {});
      }
      inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(search, 220); });
      inp.addEventListener('focus', search);
      inp.addEventListener('blur', function () { setTimeout(close, 150); });
      compHost.appendChild(inp);
    }
    drawCompany();
    var notes = el('textarea', { class: 'pr-in', id: 'pr-notes', rows: '2', placeholder: 'Optional — anything about the whole request (delivery, competitor, deadline…)', value: F.notes });
    notes.addEventListener('input', function () { F.notes = notes.value; });
    body.appendChild(el('div', { class: 'pr-card' }, [
      el('h2', {}, ['1. Company']),
      el('div', { class: 'pr-row2' }, [
        el('div', { class: 'pr-f' }, [el('label', { for: 'pr-company' }, ['Company ', el('span', { class: 'req', text: '*' })]), compHost]),
        el('div', { class: 'pr-f' }, [el('label', { for: 'pr-notes', text: 'Note for the whole request' }), notes])
      ])
    ]));

    // Items
    var list = el('div', { class: 'pr-items', id: 'pr-items' });
    var probBox = el('div');
    var fileIn = el('input', { type: 'file', id: 'pr-excel', accept: '.xlsx,.csv', style: 'display:none' });
    fileIn.addEventListener('change', function () { if (fileIn.files[0]) uploadExcel(fileIn.files[0]); fileIn.value = ''; });
    var card = el('div', { class: 'pr-card' }, [
      el('h2', {}, ['2. Items ', el('small', { text: 'all fields marked * are required — set the priority; the admin gives price, discount and lead time' })]),
      el('div', { class: 'pr-tools' }, [
        el('button', { class: 'pr-btn', type: 'button', id: 'pr-add-item', text: '＋ Add item', onclick: function () { F.items.push(blankItem()); drawItems(true); } }),
        el('button', { class: 'pr-btn', type: 'button', id: 'pr-upload', text: '⤒ Upload items from Excel', onclick: function () { fileIn.click(); } }),
        el('button', { class: 'pr-btn sm', type: 'button', text: '⤓ Template', onclick: function () { download('/price-requests/template', 'price-request-template.xlsx').catch(function (e) { toast(e.message, 'err'); }); } }),
        fileIn
      ]),
      probBox, list
    ]);
    body.appendChild(card);
    var foot = el('div', { class: 'pr-foot' });
    body.appendChild(foot);

    function drawFoot() {
      clear(foot);
      var n = F.items.filter(function (i) { return i.productName.trim(); }).length;
      var val = F.items.reduce(function (s, i) { var p = num(i.requestedPrice), q = num(i.quantity); return s + (p && q ? p * q : 0); }, 0);
      foot.appendChild(el('span', { text: n + ' item' + (n === 1 ? '' : 's') + (val ? ' · target value ' + money(val) : '') + (F.customer ? ' · ' + F.customer.companyName : ' · no company selected') }));
      var btn = el('button', { class: 'pr-btn grn', type: 'button', id: 'pr-raise', text: 'Raise request' });
      btn.addEventListener('click', function () { raise(btn); });
      foot.appendChild(btn);
    }

    function drawProblems() {
      clear(probBox);
      if (!F.problems.length) return;
      probBox.appendChild(el('div', { class: 'pr-problems' }, [
        el('b', { text: 'Please fix these in the items below (or in the file and upload again):' }),
        el('ul', {}, F.problems.slice(0, 12).map(function (p) { return el('li', { text: p }); }).concat(F.problems.length > 12 ? [el('li', { text: '…and ' + (F.problems.length - 12) + ' more' })] : []))
      ]));
    }

    function itemCard(it, idx) {
      var c = el('div', { class: 'pr-item' + (it.problems && it.problems.length ? ' has-err' : ''), 'data-idx': String(idx) });
      c.appendChild(el('span', { class: 'no', text: 'Item ' + (idx + 1) }));
      if (F.items.length > 1) c.appendChild(el('button', { class: 'rm', type: 'button', title: 'Remove item', 'aria-label': 'Remove item ' + (idx + 1), text: '✕', onclick: function () {
        c.style.transition = 'opacity .15s, transform .15s'; c.style.opacity = '0'; c.style.transform = 'scale(.98)';
        setTimeout(function () { F.items.splice(idx, 1); drawItems(); }, 150);
      } }));
      function field(key, label, opts) {
        opts = opts || {};
        var i = el('input', { class: 'pr-in', 'data-k': key, type: opts.type || 'text', placeholder: opts.ph || '', value: it[key] == null ? '' : String(it[key]), list: opts.list || null,
          inputmode: opts.type === 'number' ? 'decimal' : null, step: opts.type === 'number' ? 'any' : null, min: opts.type === 'number' ? '0' : null, 'aria-label': label + ' (item ' + (idx + 1) + ')' });
        i.addEventListener('input', function () { it[key] = i.value; i.classList.remove('bad'); if (opts.onInput) opts.onInput(i); drawFoot(); });
        return el('div', { class: 'pr-f' + (opts.cls ? ' ' + opts.cls : '') }, [el('label', {}, [label, opts.req ? el('span', { class: 'req', text: ' *' }) : null]), i]);
      }
      // Product with suggestions from the product list (free text allowed)
      var pWrap = el('div', { class: 'pr-f pr-pick p' });
      var pIn = el('input', { class: 'pr-in', 'data-k': 'productName', placeholder: 'Product name or item code', value: it.productName, autocomplete: 'off', 'aria-label': 'Product (item ' + (idx + 1) + ')' });
      var meta = el('div', { class: 'pr-meta' });
      function drawMeta() { meta.textContent = [it.itemCode ? 'Code ' + it.itemCode : '', it.listPrice != null ? 'List ' + money(it.listPrice) : ''].filter(Boolean).join(' · '); }
      drawMeta();
      var ps = null, pt, pseq = 0;
      pIn.addEventListener('input', function () {
        it.productName = pIn.value; it.productId = ''; it.itemCode = ''; it.listPrice = null; drawMeta(); pIn.classList.remove('bad'); drawFoot();
        clearTimeout(pt);
        var q = pIn.value.trim();
        if (q.length < 2) { if (ps) { ps.remove(); ps = null; } return; }
        pt = setTimeout(function () {
          var my = ++pseq;
          api('GET', '/products/search?q=' + encodeURIComponent(q)).then(function (r) {
            if (my !== pseq) return;
            if (ps) ps.remove();
            var res = (r.data && r.data.results) || [];
            if (!res.length) { ps = null; return; }
            ps = el('div', { class: 'pr-sugg' });
            res.slice(0, 8).forEach(function (p) {
              ps.appendChild(el('button', { type: 'button', onmousedown: function (e) {
                e.preventDefault();
                it.productId = p.id; it.itemCode = p.itemCode; it.productName = p.productName; it.listPrice = p.standardPrice != null ? Number(p.standardPrice) : null;
                if (!it.unit && p.unit) it.unit = p.unit;
                if (!it.category && p.categoryRef && p.categoryRef.name) it.category = p.categoryRef.name;
                ps.remove(); ps = null; drawItems();
              } }, [el('b', { text: p.productName }), el('span', { class: 's', text: [p.itemCode, p.standardPrice ? 'List ' + money(p.standardPrice) : ''].filter(Boolean).join(' · ') })]));
            });
            pWrap.appendChild(ps);
          }).catch(function () {});
        }, 220);
      });
      pIn.addEventListener('blur', function () { setTimeout(function () { if (ps) { ps.remove(); ps = null; } }, 150); });
      pWrap.appendChild(el('label', {}, ['Product ', el('span', { class: 'req', text: '*' })]));
      pWrap.appendChild(pIn); pWrap.appendChild(meta);
      // Regular / One time
      var seg = el('div', { class: 'pr-seg', role: 'radiogroup', 'aria-label': 'Regular or one time (item ' + (idx + 1) + ')', 'data-k': 'supplyType' });
      Object.keys(TYPES).forEach(function (k) {
        seg.appendChild(el('button', { type: 'button', 'data-v': k, class: it.supplyType === k ? 'on' : '', role: 'radio', 'aria-checked': it.supplyType === k ? 'true' : 'false', text: TYPES[k],
          onclick: function () {
            it.supplyType = k; seg.classList.remove('bad');
            Array.prototype.forEach.call(seg.children, function (b) { var on = b.getAttribute('data-v') === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
          } }));
      });
      // Priority instead of discount / lead time / delivery (the admin gives those when answering)
      var prSel = el('select', { class: 'pr-in pr-prio', 'data-k': 'priority', 'aria-label': 'Priority (item ' + (idx + 1) + ')' },
        PRIO_KEYS.map(function (k) { return el('option', { value: k, text: PRIO[k][0], selected: (it.priority || 'NORMAL') === k }); }));
      prSel.setAttribute('data-p', it.priority || 'NORMAL');
      prSel.addEventListener('change', function () { it.priority = prSel.value; prSel.setAttribute('data-p', prSel.value); });
      var priority = el('div', { class: 'pr-f' }, [el('label', {}, ['Priority ', el('span', { class: 'req', text: '*' })]), prSel]);
      c.appendChild(el('div', { class: 'pr-igrid' }, [
        pWrap,
        field('category', 'Category', { req: true, ph: 'e.g. Inserts', list: 'pr-cats' }),
        field('brand', 'Brand', { req: true, ph: 'e.g. YG-1' }),
        el('div', { class: 'pr-f' }, [el('label', {}, ['Regular / One time ', el('span', { class: 'req', text: '*' })]), seg]),
        field('quantity', 'Quantity', { req: true, type: 'number', ph: '0' }),
        field('unit', 'Unit', { ph: 'PCS' }),
        field('requestedPrice', 'Target ₹/unit', { req: true, type: 'number', ph: '0.00' }),
        priority,
        field('notes', 'Note', { cls: 'wide', ph: 'Competitor price, application, drawing reference…' })
      ]));
      if (it.problems && it.problems.length) c.appendChild(el('div', { class: 'pr-err', text: it.problems.join(' · ') }));
      return c;
    }

    function drawItems(focusLast) {
      clear(list);
      if (!document.getElementById('pr-cats')) {
        var dl = el('datalist', { id: 'pr-cats' });
        CATS.forEach(function (c) { dl.appendChild(el('option', { value: c })); });
        document.body.appendChild(dl);
      }
      F.items.forEach(function (it, i) { list.appendChild(itemCard(it, i)); });
      drawFoot();
      if (focusLast) { var last = list.lastElementChild; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); var i = last.querySelector('input'); if (i) setTimeout(function () { i.focus({ preventScroll: true }); }, 250); } }
    }

    function uploadExcel(file) {
      var fd = new FormData(); fd.append('file', file);
      var btn = document.getElementById('pr-upload');
      btn.disabled = true; btn.textContent = 'Reading ' + file.name + '…';
      fetch(API + '/api/price-requests/parse', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') }, body: fd })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.success === false) throw new Error(j.message || 'Could not read the file'); return j; }); })
        .then(function (j) {
          var rows = j.data.items.map(function (x) {
            return { productId: x.productId || '', itemCode: x.itemCode || '', productName: x.productName || '', category: x.category || '', brand: x.brand || '',
              supplyType: x.supplyType === 'REGULAR' || x.supplyType === 'ONE_TIME' ? x.supplyType : '', quantity: x.quantity == null ? '' : x.quantity,
              unit: x.unit || '', requestedPrice: x.requestedPrice == null ? '' : x.requestedPrice, priority: x.priority || 'NORMAL',
              notes: x.notes || '', listPrice: x.listPrice, problems: (x.problems || []).map(function (p) { return p.replace(/^Row \d+: /, ''); }) };
          });
          var empty = F.items.every(function (i) { return !i.productName.trim() && !i.brand.trim(); });
          if (!empty && !confirm('Replace the ' + F.items.length + ' item(s) already entered with the ' + rows.length + ' from the file? (Cancel adds them below.)')) F.items = F.items.concat(rows);
          else F.items = rows;
          F.problems = j.data.problems || [];
          F.source = 'EXCEL';
          drawProblems(); drawItems();
          toast(j.message + (F.problems.length ? ' — ' + F.problems.length + ' to fix' : ''), F.problems.length ? 'err' : 'ok');
        })
        .catch(function (e) { toast(e.message, 'err'); })
        .then(function () { btn.disabled = false; btn.textContent = '⤒ Upload items from Excel'; });
    }

    function validate() {
      var errs = [];
      list.querySelectorAll('.bad').forEach(function (x) { x.classList.remove('bad'); });
      F.items.forEach(function (it, i) {
        var card = list.children[i]; if (!card) return;
        var bad = function (k) { var e = card.querySelector('[data-k="' + k + '"]'); if (e) e.classList.add('bad'); };
        var miss = [];
        if (!it.productName.trim()) { bad('productName'); miss.push('product'); }
        if (!it.category.trim()) { bad('category'); miss.push('category'); }
        if (!it.brand.trim()) { bad('brand'); miss.push('brand'); }
        if (!it.supplyType) { bad('supplyType'); miss.push('Regular / One time'); }
        if (!(num(it.quantity) > 0)) { bad('quantity'); miss.push('quantity'); }
        if (!(num(it.requestedPrice) > 0)) { bad('requestedPrice'); miss.push('target price'); }
        if (!PRIO[it.priority]) { bad('priority'); miss.push('priority'); }
        if (miss.length) errs.push('Item ' + (i + 1) + ': ' + miss.join(', '));
      });
      if (!F.customer) errs.unshift('Select the company');
      return errs;
    }

    function raise(btn) {
      var errs = validate();
      if (errs.length) {
        F.problems = errs; drawProblems();
        probBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(errs.length === 1 ? errs[0] : 'Please fill the highlighted fields (' + errs.length + ')', 'err');
        return;
      }
      btn.disabled = true; btn.textContent = 'Sending…';
      api('POST', '/price-requests/batch', {
        customerId: F.customer.id, notes: F.notes, source: F.source,
        items: F.items.map(function (i) {
          return { productId: i.productId, itemCode: i.itemCode, productName: i.productName, category: i.category, brand: i.brand, supplyType: i.supplyType,
            quantity: i.quantity, unit: i.unit, requestedPrice: i.requestedPrice, priority: i.priority || 'NORMAL', notes: i.notes };
        })
      }).then(function (r) {
        toast(r.message);
        state.form = null;
        state.open = {}; state.open[r.data.batch.id] = true; state.filter = 'OPEN';
        go('requests');
      }).catch(function (e) {
        F.problems = String(e.message).split(' · '); drawProblems();
        toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Raise request';
      });
    }

    drawProblems();
    drawItems();
  }

  /* ── Requests list ───────────────────────────────────────────────── */
  function renderRequests(body) {
    var bar = el('div', { class: 'pr-filters' });
    var listHost = el('div', { id: 'pr-list' }, [el('div', { class: 'pr-empty', text: 'Loading…' })]);
    body.appendChild(bar); body.appendChild(listHost);
    function load() {
      var q = '/price-requests/batches?status=' + state.filter + (state.search ? '&search=' + encodeURIComponent(state.search) : '') + (state.who ? '&requestedById=' + state.who : '');
      listHost.style.opacity = '.6';
      api('GET', q).then(function (r) {
        listHost.style.opacity = '';
        canRespond = r.data.canRespond;
        var newCount = r.data.counts.OPEN;
        if (newCount !== state.openCount) { state.openCount = newCount; var tab = ROOT.querySelector('.pr-tab[data-tab="requests"]'); if (tab) { var n = tab.querySelector('.n'); if (newCount) { if (!n) { n = el('span', { class: 'n' }); tab.appendChild(n); } n.textContent = String(newCount); } else if (n) n.remove(); } }
        drawBar(r.data);
        drawList(r.data.batches);
      }).catch(function (e) { listHost.style.opacity = ''; clear(listHost).appendChild(el('div', { class: 'pr-empty', text: e.message })); });
    }
    function drawBar(d) {
      clear(bar);
      [['OPEN', 'Waiting', d.counts.OPEN], ['DONE', 'Answered', d.counts.DONE], ['ALL', 'All', d.counts.OPEN + d.counts.DONE]].forEach(function (f) {
        bar.appendChild(el('button', { class: 'pr-chip' + (state.filter === f[0] ? ' on' : ''), type: 'button', 'data-f': f[0], text: f[1] + ' (' + f[2] + ')', onclick: function () { state.filter = f[0]; load(); } }));
      });
      var s = el('input', { class: 'pr-in', type: 'search', placeholder: 'Search company, product, brand, PR no…', value: state.search, style: 'flex:1 1 220px;width:auto' });
      var t; s.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.search = s.value.trim(); load(); }, 300); });
      bar.appendChild(s);
      if (d.requesters && d.requesters.length) {
        var w = el('select', { class: 'pr-in', style: 'width:auto', 'aria-label': 'Requested by', onchange: function () { state.who = w.value; load(); } }, [el('option', { value: '', text: 'Everyone' })]);
        d.requesters.forEach(function (u) { w.appendChild(el('option', { value: u.id, text: u.name })); });
        w.value = state.who;
        bar.appendChild(w);
      }
    }
    function drawList(batches) {
      clear(listHost);
      if (!batches.length) {
        listHost.appendChild(el('div', { class: 'pr-card pr-empty' }, [
          el('p', { text: state.filter === 'OPEN' ? (isAdminTier ? 'Nothing waiting for an answer.' : 'You have no requests waiting.') : 'No price requests here yet.' }),
          el('button', { class: 'pr-btn pri', type: 'button', text: '＋ New price request', onclick: function () { go('new'); } })
        ]));
        return;
      }
      batches.forEach(function (b) { listHost.appendChild(requestCard(b, load)); });
    }
    state.reload = load;
    load();
  }

  function requestCard(b, reload) {
    var open = !!state.open[b.id];
    var card = el('div', { class: 'pr-req' + (open ? ' open' : ''), 'data-id': b.id });
    var head = el('button', { class: 'pr-rh', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: function () {
      open = !open; state.open[b.id] = open;
      card.classList.toggle('open', open); head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && !inner.firstChild) fillBody();
    } }, [
      el('div', {}, [
        el('div', { class: 't' }, [(b.requestNo || 'Request') + ' · ' + (b.customer ? b.customer.companyName : 'No company')]),
        el('div', { class: 's', text: b.items.length + ' item' + (b.items.length === 1 ? '' : 's') + (isAdminTier ? ' · by ' + (b.requestedBy.name || '—') : '') + ' · ' + when(b.createdAt) + (b.value ? ' · target ' + money(b.value) : '') })
      ]),
      el('div', { style: 'display:flex;align-items:center;gap:.6rem' }, [
        b.counts.PENDING && b.counts.PENDING < b.items.length ? el('span', { class: 'pr-meta', text: b.counts.PENDING + ' pending' }) : null,
        (function () { var top = PRIO_KEYS.filter(function (k) { return b.items.some(function (x) { return x.priority === k; }); })[0]; return top && top !== 'NORMAL' && top !== 'LOW' ? prioBadge(top) : null; })(),
        badge(b.status), el('span', { class: 'chev', 'aria-hidden': 'true', text: '▸' })
      ])
    ]);
    var inner = el('div', { class: 'pr-rbi' });
    card.appendChild(head);
    card.appendChild(el('div', { class: 'pr-rb' }, [el('div', {}, [inner])]));
    if (open) fillBody();
    return card;

    // Engineer: ask for a revised price on an answered item (price negotiation).
    function reviseBox(it) {
      var wrap = el('div', { style: 'margin-top:.4rem' });
      var btn = el('button', { class: 'pr-btn sm', type: 'button', 'data-revise': it.id, text: '↺ Ask revised price' });
      btn.addEventListener('click', function () {
        clear(wrap);
        var p = el('input', { class: 'pr-in', type: 'number', step: 'any', min: '0', placeholder: 'Revised price ₹', 'aria-label': 'Revised price', value: it.approvedPrice != null ? it.approvedPrice : it.requestedPrice });
        var n = el('input', { class: 'pr-in full', placeholder: 'Why? e.g. customer counter-offer ₹230, competitor price', 'aria-label': 'Reason for revised price' });
        var send = el('button', { class: 'pr-btn grn sm full', type: 'button', text: 'Send revised request' });
        var cancel = el('button', { class: 'pr-btn sm full', type: 'button', text: 'Cancel', onclick: function () { clear(wrap); wrap.appendChild(btn); } });
        send.addEventListener('click', function () {
          send.disabled = true;
          api('PATCH', '/price-requests/' + encodeURIComponent(it.id) + '/revise', { requestedPrice: p.value, note: n.value })
            .then(function (r) { toast(r.message); reload(); })
            .catch(function (e) { toast(e.message, 'err'); send.disabled = false; });
        });
        wrap.appendChild(el('div', { class: 'pr-ans' }, [p, n, send, cancel]));
        p.focus();
      });
      wrap.appendChild(btn);
      return wrap;
    }
    function historyBox(h) {
      var det = el('details', { class: 'pr-hist' }, [el('summary', { text: 'Negotiation history (' + h.length + ')' })]);
      h.forEach(function (x) {
        if (x.type === 'CODE_FIX') { det.appendChild(el('div', { class: 'pr-meta' }, [el('b', { text: 'Code corrected ' + (x.from || '') + ' → ' + x.to }), ' — ' + (x.by || '') + ', ' + when(x.at)])); return; }
        var what = x.type === 'ANSWER' ? (x.status === 'REJECTED' ? 'Rejected' : 'Approved ' + money(x.price) + (x.discount != null ? ' · ' + x.discount + '%' : ''))
          : (x.type === 'REVISION' ? 'Asked revised ' : 'Asked ') + money(x.price) + (x.discount != null ? ' · ' + x.discount + '%' : '');
        det.appendChild(el('div', { class: 'pr-meta' }, [el('b', { text: what }), (x.leadTime ? ' · ' + x.leadTime : '') + ' — ' + (x.by || '') + ', ' + when(x.at) + (x.note ? ' · “' + x.note + '”' : '')]));
      });
      return det;
    }

    function fillBody() {
      clear(inner);
      if (b.notes) inner.appendChild(el('div', { class: 'pr-note', text: '📝 ' + b.notes }));
      var drafts = state.drafts[b.id] || (state.drafts[b.id] = {});
      var editing = state.editing || (state.editing = {});
      var answering = canRespond && (b.counts.PENDING > 0 || b.items.some(function (x) { return editing[x.id]; }));
      var tbl = el('table', { class: 'pr-tbl' });
      tbl.appendChild(el('thead', {}, [el('tr', {}, ['#', 'Product', 'Category · Brand', 'Type', 'Qty', 'List', 'Asked', 'Priority', 'Answer'].map(function (h, i) {
        return el('th', { class: i >= 4 && i <= 6 ? 'r' : null, text: h });
      }))]));
      var tb = el('tbody');
      b.items.forEach(function (it, i) {
        var ansCell = el('td');
        if (it.status !== 'PENDING' && !(canRespond && editing[it.id])) {
          ansCell.appendChild(badge(it.status));
          if (it.status === 'APPROVED') ansCell.appendChild(el('div', { style: 'margin-top:.25rem;font-weight:600', text: money(it.approvedPrice) + (it.approvedDiscount != null ? ' · ' + it.approvedDiscount + '% disc' : '') }));
          if (it.status === 'APPROVED' && it.approvedLeadTime) ansCell.appendChild(el('div', { class: 'pr-meta', text: 'Lead time ' + it.approvedLeadTime }));
          if (it.responseNote) ansCell.appendChild(el('div', { class: 'pr-meta', text: it.responseNote }));
          if (it.respondedBy) ansCell.appendChild(el('div', { class: 'pr-meta', text: 'by ' + it.respondedBy.name }));
          if (b.requestedBy.id === me().id && !b.legacy) ansCell.appendChild(reviseBox(it));
          if (canRespond) ansCell.appendChild(el('button', { class: 'pr-btn sm', type: 'button', style: 'margin-top:.35rem', 'data-edit-answer': it.id, text: '✎ Edit answer', onclick: function () { editing[it.id] = true; fillBody(); } }));
        } else if (answering) {
          var d = drafts[it.id] || (drafts[it.id] = it.status !== 'PENDING'
            ? { status: it.status, approvedPrice: it.approvedPrice != null ? it.approvedPrice : '', approvedDiscount: it.approvedDiscount != null ? it.approvedDiscount : '', approvedLeadTime: it.approvedLeadTime || '', responseNote: it.responseNote || '' }
            : { status: '', approvedPrice: it.requestedPrice != null ? it.requestedPrice : (it.listPrice != null ? it.listPrice : ''), approvedDiscount: it.discount != null ? it.discount : '', approvedLeadTime: it.leadTime || '', responseNote: '' });
          var seg = el('div', { class: 'pr-seg full' });
          var price = el('input', { class: 'pr-in', type: 'number', step: 'any', min: '0', placeholder: 'Price ₹', 'aria-label': 'Approved price for ' + it.productName, value: d.approvedPrice });
          var disc = el('input', { class: 'pr-in', type: 'number', step: 'any', min: '0', max: '100', placeholder: 'Disc %', 'aria-label': 'Approved discount for ' + it.productName, value: d.approvedDiscount });
          var note = el('input', { class: 'pr-in full', placeholder: 'Note (required to reject)', 'aria-label': 'Note for ' + it.productName, value: d.responseNote });
          var lead = el('input', { class: 'pr-in full', placeholder: 'Lead time (e.g. 3 weeks)', 'aria-label': 'Lead time for ' + it.productName, value: d.approvedLeadTime });
          lead.addEventListener('input', function () { d.approvedLeadTime = lead.value; });
          price.addEventListener('input', function () { d.approvedPrice = price.value; });
          disc.addEventListener('input', function () { d.approvedDiscount = disc.value; });
          note.addEventListener('input', function () { d.responseNote = note.value; });
          [['APPROVED', 'Approve'], ['REJECTED', 'Reject']].forEach(function (o) {
            seg.appendChild(el('button', { type: 'button', 'data-v': o[0], class: d.status === o[0] ? 'on' : '', text: o[1], onclick: function () {
              d.status = d.status === o[0] ? '' : o[0];
              Array.prototype.forEach.call(seg.children, function (x) { x.classList.toggle('on', x.getAttribute('data-v') === d.status); });
              drawActions();
            } }));
          });
          // wrong product code? correct it here (product list suggestions)
          var code = el('input', { class: 'pr-in full', placeholder: 'Correct product code (only if wrong)', 'aria-label': 'Correct product code for ' + it.productName, value: d.correctedCode || '', list: 'pr-codes-' + it.id, autocomplete: 'off', 'data-fix-code': it.id });
          var codesDl = el('datalist', { id: 'pr-codes-' + it.id });
          var codeInfo = el('div', { class: 'pr-meta' });
          var ct;
          code.addEventListener('input', function () {
            d.correctedCode = code.value.trim();
            clearTimeout(ct);
            if (code.value.trim().length < 2) { codeInfo.textContent = ''; return; }
            ct = setTimeout(function () {
              api('GET', '/products/search?limit=10&q=' + encodeURIComponent(code.value.trim())).then(function (j) {
                var r = j.data.results || []; clear(codesDl);
                r.forEach(function (p) { codesDl.appendChild(el('option', { value: p.itemCode, text: [p.specification || p.productName, p.grade].filter(Boolean).join(' · ') })); });
                var hit = r.filter(function (p) { return p.itemCode.toUpperCase() === code.value.trim().toUpperCase(); })[0];
                codeInfo.textContent = hit ? '✓ ' + [hit.productName, hit.grade ? 'Grade ' + hit.grade : '', hit.brand].filter(Boolean).join(' · ') : 'Not in the product list — it will be saved as typed.';
              }).catch(function () {});
            }, 250);
          });
          ansCell.appendChild(el('div', { class: 'pr-ans' }, [seg, price, disc, lead, code, codesDl, codeInfo, note,
            editing[it.id] ? el('button', { class: 'pr-btn sm full', type: 'button', text: 'Cancel edit', onclick: function () { delete editing[it.id]; delete drafts[it.id]; fillBody(); } }) : null]));
          ansCell.appendChild(el('div', { class: 'pr-meta pr-sup-hint', 'data-sup-hint': it.id }));
        } else ansCell.appendChild(badge('PENDING'));
        tb.appendChild(el('tr', {}, [
          el('td', { class: 'pr-meta', text: String(i + 1) }),
          el('td', {}, [el('div', { style: 'font-weight:600', text: it.productName }), it.itemCode ? el('div', { class: 'pr-meta', text: it.itemCode }) : null,
            it.originalItemCode && it.originalItemCode !== it.itemCode ? el('div', { class: 'pr-meta', style: 'color:#b45309', text: 'was ' + it.originalItemCode + ' (corrected by admin)' }) : null, it.notes ? el('div', { class: 'pr-meta', text: '“' + it.notes + '”' }) : null,
            it.revisionCount ? el('span', { class: 'pr-badge', style: '--c:#7c3aed;margin-top:.25rem', text: 'Revised ×' + it.revisionCount }) : null,
            it.history && it.history.length ? historyBox(it.history) : null]),
          el('td', {}, [it.category || '—', el('div', { class: 'pr-meta', text: it.brand || '' })]),
          el('td', { text: TYPES[it.supplyType] || '—' }),
          el('td', { class: 'r', text: (it.quantity != null ? Number(it.quantity).toLocaleString('en-IN') : '—') + (it.unit ? ' ' + it.unit : '') }),
          el('td', { class: 'r', text: money(it.listPrice) }),
          el('td', { class: 'r', text: money(it.requestedPrice) }),
          el('td', {}, [prioBadge(it.priority),
            it.discount != null || it.leadTime ? el('div', { class: 'pr-meta', text: [it.discount != null ? 'asked ' + it.discount + '%' : '', it.leadTime || '', it.expectedDelivery ? 'by ' + dmyDate(it.expectedDelivery) : ''].filter(Boolean).join(' · ') }) : null]),
          ansCell
        ]));
      });
      tbl.appendChild(tb);
      inner.appendChild(el('div', { class: 'pr-scroll' }, [tbl]));
      if (canRespond && !b.legacy) inner.appendChild(supplierPanel(b, drafts, fillBody));
      var acts = el('div', { class: 'pr-ractions' });
      inner.appendChild(acts);
      function drawActions() {
        clear(acts);
        var mine = b.requestedBy.id === me().id;
        if ((mine && b.counts.PENDING === b.items.length) || canRespond) {
          acts.appendChild(el('button', { class: 'pr-btn red sm', type: 'button', text: mine && !canRespond ? 'Withdraw request' : 'Delete request', style: 'margin-right:auto', onclick: function () {
            if (!confirm('Remove ' + (b.requestNo || 'this request') + ' and all its items?')) return;
            api('DELETE', '/price-requests/batch/' + encodeURIComponent(b.id)).then(function () { toast('Request removed'); reload(); }).catch(function (e) { toast(e.message, 'err'); });
          } }));
        }
        if (mine && b.counts.PENDING && !b.legacy) {
          var last = b.lastRemindedAt ? new Date(String(b.lastRemindedAt).replace(' ', 'T')) : null;
          var wait = last ? Math.ceil((last.getTime() + 2 * 3600 * 1000 - Date.now()) / 60000) : 0;
          acts.appendChild(el('span', { class: 'pr-meta', text: last ? 'Reminded ' + when(b.lastRemindedAt) + (b.remindCount > 1 ? ' (' + b.remindCount + '×)' : '') : 'Waiting for the admin' }));
          acts.appendChild(el('button', { class: 'pr-btn sm', type: 'button', 'data-remind': b.id, disabled: wait > 0,
            title: wait > 0 ? 'You can remind again in ' + wait + ' min' : 'Send the admins a reminder',
            text: wait > 0 ? '⏰ Remind again in ' + (wait >= 60 ? Math.floor(wait / 60) + 'h ' + (wait % 60) + 'm' : wait + ' min') : '⏰ Remind admin',
            onclick: function () {
              api('POST', '/price-requests/batch/' + encodeURIComponent(b.id) + '/remind').then(function (r) { toast(r.message); reload(); }).catch(function (e) { toast(e.message, 'err'); });
            } }));
        }
        if (!answering) return;
        var chosen = Object.keys(drafts).filter(function (k) { return drafts[k].status; }).length;
        acts.appendChild(el('button', { class: 'pr-btn sm', type: 'button', text: 'Approve all at asked / list price', onclick: function () {
          b.items.forEach(function (it) { if (it.status === 'PENDING' && drafts[it.id]) drafts[it.id].status = 'APPROVED'; });
          fillBody();
        } }));
        var save = el('button', { class: 'pr-btn grn', type: 'button', text: chosen ? 'Save ' + chosen + ' answer' + (chosen === 1 ? '' : 's') : 'Choose Approve or Reject', disabled: !chosen });
        save.addEventListener('click', function () {
          var items = Object.keys(drafts).filter(function (k) { return drafts[k].status; }).map(function (k) {
            var d = drafts[k]; return { id: k, status: d.status, approvedPrice: d.approvedPrice, approvedDiscount: d.approvedDiscount, approvedLeadTime: d.approvedLeadTime, responseNote: d.responseNote, correctedCode: d.correctedCode || '' };
          });
          save.disabled = true; save.textContent = 'Saving…';
          api('PATCH', '/price-requests/batch/' + encodeURIComponent(b.id) + '/respond', { items: items }).then(function (r) {
            toast(r.message); delete state.drafts[b.id]; b.items.forEach(function (x) { delete editing[x.id]; }); reload();
          }).catch(function (e) { toast(e.message, 'err'); save.disabled = false; drawActions(); });
        });
        acts.appendChild(save);
      }
      drawActions();
    }
  }

  // ── Admin: get the price from a supplier ────────────────────────────
  // Pick a vendor and the items → a ready message (copy / WhatsApp / e-mail).
  // Type the vendor's price, discount and lead time when they reply (editable);
  // prices already on a vendor's price list show up straight away.
  function supplierPanel(b, drafts, redraw) {
    var det = el('details', { class: 'pr-sup', 'data-supplier': b.id, open: !!state.supOpen[b.id] }, [el('summary', { text: '🏭 Get price from supplier' })]);
    var box = el('div', { class: 'pr-sup-body' });
    det.appendChild(box);
    det.addEventListener('toggle', function () { state.supOpen[b.id] = det.open; if (det.open && !box.firstChild) load(); });
    if (det.open) load();
    function load() {
      clear(box).appendChild(el('div', { class: 'pr-meta', text: 'Loading…' }));
      api('GET', '/price-requests/batch/' + encodeURIComponent(b.id) + '/supplier').then(function (j) { draw(j.data); })
        .catch(function (e) { clear(box).appendChild(el('div', { class: 'pr-meta', text: e.message })); });
    }
    function draw(d) {
      clear(box);
      var byItem = {}; d.items.forEach(function (it) { byItem[it.id] = it; });
      // ask a supplier
      var vSel = el('select', { class: 'pr-in', 'aria-label': 'Supplier', 'data-sup-vendor': '1' }, [el('option', { value: '', text: 'Choose supplier…' })]
        .concat(d.vendors.map(function (v) { return el('option', { value: v.id, text: v.name + (v.brands ? ' · ' + v.brands : '') }); }))
        .concat([el('option', { value: '__other', text: 'Other (type the name)…' })]));
      var other = el('input', { class: 'pr-in', placeholder: 'Supplier name', style: 'display:none', 'data-sup-other': '1' });
      vSel.onchange = function () { other.style.display = vSel.value === '__other' ? '' : 'none'; };
      var checks = el('div', { class: 'pr-sup-items' }, d.items.map(function (it) {
        var cb = el('input', { type: 'checkbox', value: it.id, checked: it.status === 'PENDING' || d.items.every(function (x) { return x.status !== 'PENDING'; }) });
        return el('label', {}, [cb, ' ' + (it.itemCode || it.productName) + (it.quantity != null ? ' × ' + Number(it.quantity) : '')]);
      }));
      var msgBox = el('div', {});
      var ask = el('button', { class: 'pr-btn pri sm', type: 'button', 'data-sup-ask': '1', text: 'Create supplier request', onclick: function () {
        var ids = Array.prototype.filter.call(checks.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
        var body = vSel.value === '__other' ? { vendorName: other.value.trim(), itemIds: ids } : { vendorId: vSel.value, itemIds: ids };
        ask.disabled = true;
        api('POST', '/price-requests/batch/' + encodeURIComponent(b.id) + '/supplier', body).then(function (j) {
          toast(j.message); d.quotes = j.data.quotes; drawQuotes(); showMessage(j.data);
        }).catch(function (e) { toast(e.message, 'err'); }).then(function () { ask.disabled = false; });
      } });
      function showMessage(r) {
        var ta = el('textarea', { class: 'pr-in full', rows: 8, readonly: true, 'data-sup-msg': '1' }, [r.message]);
        var phone = String((r.vendor && r.vendor.phone) || '').replace(/\D/g, ''); if (phone.length === 10) phone = '91' + phone;
        clear(msgBox).appendChild(el('div', { class: 'pr-sup-msg' }, [ta, el('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.35rem' }, [
          el('button', { class: 'pr-btn sm', type: 'button', text: '⧉ Copy', onclick: function () { ta.select(); try { navigator.clipboard.writeText(r.message); } catch (e) { document.execCommand('copy'); } toast('Message copied'); } }),
          el('a', { class: 'pr-btn sm grn', target: '_blank', rel: 'noopener', href: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(r.message), text: 'WhatsApp' + (phone ? '' : ' (choose contact)') }),
          el('a', { class: 'pr-btn sm', href: 'mailto:' + ((r.vendor && r.vendor.email) || '') + '?subject=' + encodeURIComponent('Price request' + (b.requestNo ? ' ' + b.requestNo : '')) + '&body=' + encodeURIComponent(r.message), text: '✉ E-mail' })
        ])]));
      }
      box.appendChild(el('div', { class: 'pr-sup-ask' }, [el('b', { text: 'Ask a supplier' }), el('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' }, [vSel, other, ask]), checks, msgBox]));
      // vendor price list
      var plHits = d.items.filter(function (it) { return d.priceList[String(it.itemCode || '').toUpperCase()]; });
      if (plHits.length) box.appendChild(el('div', { class: 'pr-sup-pl' }, [el('b', { text: 'On vendor price lists' })].concat(plHits.map(function (it) {
        return el('div', { class: 'pr-meta' }, [el('b', { text: it.itemCode + ': ' }), d.priceList[String(it.itemCode).toUpperCase()].slice(0, 4).map(function (p) {
          return p.vendorName + ' ' + money(p.netPrice != null ? p.netPrice : p.price) + (p.discount != null && p.netPrice == null ? ' −' + Number(p.discount) + '%' : '') + (p.leadTime ? ' (' + p.leadTime + ')' : '') + (p.stockQty != null ? ' · stock ' + Number(p.stockQty) : '');
        }).join(' · ')]);
      }))));
      var qBox = el('div', {});
      box.appendChild(qBox);
      function drawQuotes() {
        clear(qBox);
        // best supplier price per item → hint under the answer boxes
        var best = {};
        d.quotes.forEach(function (q) { if (q.netPrice != null && (!best[q.requestId] || q.netPrice < best[q.requestId].netPrice)) best[q.requestId] = q; });
        document.querySelectorAll('[data-sup-hint]').forEach(function (h) {
          var q = best[h.getAttribute('data-sup-hint')]; h.textContent = q ? 'Supplier best: ' + money(q.netPrice) + ' net · ' + q.vendorName + (q.leadTime ? ' · ' + q.leadTime : '') : '';
        });
        if (!d.quotes.length) { qBox.appendChild(el('div', { class: 'pr-meta', style: 'margin-top:.5rem', text: 'No supplier asked yet.' })); return; }
        var tb = el('tbody');
        d.quotes.forEach(function (q) {
          var it = byItem[q.requestId] || {};
          var pr = el('input', { class: 'pr-in', type: 'number', step: 'any', min: '0', placeholder: 'Price ₹', value: q.price != null ? q.price : '', 'data-q-price': q.id });
          var di = el('input', { class: 'pr-in', type: 'number', step: 'any', min: '0', max: '100', placeholder: 'Disc %', value: q.discount != null ? q.discount : '', style: 'width:5.5rem' });
          var lt = el('input', { class: 'pr-in', placeholder: 'Lead time', value: q.leadTime || '', style: 'width:7rem' });
          var no = el('input', { class: 'pr-in', placeholder: 'Note', value: q.note || '' });
          var net = el('span', { class: 'pr-meta', text: q.netPrice != null ? money(q.netPrice) : '—' });
          function calc() { var p = num(pr.value), x = num(di.value) || 0; net.textContent = p != null ? money(Math.round(p * (100 - x)) / 100) : '—'; }
          pr.addEventListener('input', calc); di.addEventListener('input', calc);
          var st = q.status === 'RECEIVED' ? ['Received', '#16a34a'] : q.status === 'NO_QUOTE' ? ['No quote', '#64748b'] : ['Asked', '#d97706'];
          tb.appendChild(el('tr', { 'data-quote': q.id }, [
            el('td', {}, [el('b', { text: q.vendorName }), el('div', { class: 'pr-meta', text: 'asked ' + when(q.askedAt) })]),
            el('td', {}, [it.itemCode || it.productName || '—', it.quantity != null ? el('div', { class: 'pr-meta', text: 'Qty ' + Number(it.quantity) }) : null]),
            el('td', {}, [el('span', { class: 'pr-badge', style: '--c:' + st[1], text: st[0] })]),
            el('td', {}, [pr]), el('td', {}, [di]), el('td', { class: 'r' }, [net]), el('td', {}, [lt]), el('td', {}, [no]),
            el('td', { style: 'white-space:nowrap' }, [
              el('button', { class: 'pr-btn grn sm', type: 'button', 'data-q-save': q.id, text: 'Save', onclick: function () {
                api('PUT', '/price-requests/supplier/' + encodeURIComponent(q.id), { price: pr.value, discount: di.value, leadTime: lt.value, note: no.value })
                  .then(function (j) { toast(j.message); d.quotes = j.data.quotes; drawQuotes(); }).catch(function (e) { toast(e.message, 'err'); });
              } }), ' ',
              el('button', { class: 'pr-btn sm', type: 'button', title: 'Supplier did not quote', text: '✕ No quote', onclick: function () {
                api('PUT', '/price-requests/supplier/' + encodeURIComponent(q.id), { status: 'NO_QUOTE', note: no.value }).then(function (j) { d.quotes = j.data.quotes; drawQuotes(); }).catch(function (e) { toast(e.message, 'err'); });
              } }), ' ',
              q.leadTime && drafts[q.requestId] ? el('button', { class: 'pr-btn sm', type: 'button', title: 'Use this lead time in the answer', text: 'Use lead time', onclick: function () {
                drafts[q.requestId].approvedLeadTime = q.leadTime; redraw();
              } }) : null, ' ',
              el('button', { class: 'pr-btn red sm', type: 'button', title: 'Remove', text: '🗑', onclick: function () {
                if (!confirm('Remove ' + q.vendorName + ' for this item?')) return;
                api('DELETE', '/price-requests/supplier/' + encodeURIComponent(q.id)).then(function (j) { d.quotes = j.data.quotes; drawQuotes(); }).catch(function (e) { toast(e.message, 'err'); });
              } })
            ])
          ]));
        });
        qBox.appendChild(el('div', { class: 'pr-scroll', style: 'margin-top:.6rem' }, [el('table', { class: 'pr-tbl', 'data-sup-quotes': '1' }, [
          el('thead', {}, [el('tr', {}, ['Supplier', 'Item', 'Status', 'Price', 'Disc %', 'Net', 'Lead time', 'Note', ''].map(function (h, i) { return el('th', { class: i === 5 ? 'r' : null, text: h }); }))]), tb])]));
      }
      drawQuotes();
    }
    return det;
  }

  window.PriceRequestsPage = { mountPage: mountPage };
})();
