/* ══════════════════════════════════════════════════════════════════════
   Projects · Tooled-up · New machine accessories (one script, three pages)

   Engineer: pick the customer, add the machines (VMC / HMC / CNC / VTL /
   other — type it), tick what is needed from each machine's checklist and
   enter the quantity, add components by hand, then "Send for approval".
   Admin: fills item code, price and discount → Approve (gives the number,
   e.g. ACC-2610-0001) or Reject with a note.
   The number goes into the Quotations page ("Price request / approval no."
   box) and fills every item with its price and discount.
   After approval: Negotiate — an admin's new price applies at once; an
   engineer's goes to the admin for approval. Every change is in History.
   Engineers see their own requests; Admins see everyone's (engineer filter).
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
  function money(v) { return v == null || v === '' ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function qn(v) { return v == null || v === '' ? '' : String(+Number(v).toFixed(2)); }
  function when(s) {
    if (!s) return '';
    var d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function toast(msg, kind) {
    document.querySelectorAll('.tl-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'tl-toast' + (kind === 'err' ? ' err' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, kind === 'err' ? 6500 : 4500);
  }

  var TYPES = {
    PROJECT:     { title: 'Projects', one: 'project', sub: 'Project files (3D STEP, 2D drawings, PDF) and the tools selected for every operation — code, brand, cutting data, holder and specification.', path: '/projects/' },
    TOOLEDUP:    { title: 'Tooled-up', one: 'tooled-up request', sub: 'Everything a machine needs to start cutting — holders, tools, gauges, consumables.', path: '/tooled-up/' },
    ACCESSORIES: { title: 'New machine accessories', one: 'accessories request', sub: 'Accessories checklist for a new machine — tick what the customer needs and the quantity.', path: '/machine-accessories/' }
  };
  var STATUS = { DRAFT: ['Draft', '#64748b'], SUBMITTED: ['Waiting for approval', '#d97706'], APPROVED: ['Approved', '#16a34a'], NEGOTIATION: ['Negotiation', '#7c3aed'], REJECTED: ['Rejected', '#dc2626'] };
  var MACHINES = [['VMC', 'VMC'], ['HMC', 'HMC'], ['CNC', 'CNC lathe'], ['VTL', 'VTL'], ['OTHER', 'Other (type it)']];
  var TOOL_TYPES = ['Face mill cutter', 'Shoulder / side mill cutter', 'High-feed cutter', 'End mill', 'Drill', 'Tap', 'Reamer', 'Boring bar / head', 'Insert', 'Holder', 'Other'];
  var SPEC_PH = { 'End mill': 'Ø10, 4 flutes, LOC 22, OAL 72, AlTiN', 'Drill': 'Ø8.5, 5×D, coolant through, 140°', 'Tap': 'M10×1.5, spiral flute, HSS-E / 6H', 'Reamer': 'Ø12 H7, 6 flutes',
    'Face mill cutter': 'Ø63, 45° entry, insert SEKT1204', 'Shoulder / side mill cutter': 'Ø50, 90°, insert APMT1604', 'High-feed cutter': 'Ø52, insert LOMU', 'Boring bar / head': 'Ø20–28 range, BT40', 'Insert': 'CNMG120408, grade, chip breaker', 'Holder': 'BT40 ER32 70L' };
  function isCutter(t) { return /cutter/i.test(t || ''); }
  var LOGK = { ADMIN: 'Price changed', NEGOTIATED: 'Negotiated', PROPOSED: 'Proposed by engineer', APPROVED: 'Approved', NEGO_OK: 'Negotiation approved', REJECTED: 'Rejected' };

  function css() {
    if (document.getElementById('tl-css')) return;
    var st = document.createElement('style'); st.id = 'tl-css';
    st.textContent = [
      '.tl-wrap{max-width:1350px;margin:0 auto}',
      '.tl-head{display:flex;flex-wrap:wrap;gap:.7rem;align-items:flex-end;justify-content:space-between;margin-bottom:1rem}.tl-head h1{font-size:1.35rem;font-weight:700;margin:0}.tl-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.tl-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .tl-card{background:#1e293b;border-color:#334155}.tl-card h2{font-size:1rem;font-weight:700;margin:0 0 .7rem}',
      '.tl-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.5rem;margin-bottom:.8rem}',
      '.tl-tile{border:1px solid #e2e8f0;border-top:3px solid var(--c);border-radius:.6rem;background:#fff;padding:.5rem .65rem;text-align:left;cursor:pointer;color:inherit}.tl-tile.on{box-shadow:0 0 0 2px var(--c)}.tl-tile b{display:block;font-size:1.3rem}.tl-tile span{font-size:.76rem;color:#475569;font-weight:600}',
      '.dark .tl-tile{background:#0f172a;border-color:#334155}',
      '.tl-bar{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.8rem}.tl-bar input,.tl-bar select{border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.86rem;background:#fff;color:inherit}.tl-bar input{flex:1;min-width:200px}',
      '.tl-btn{display:inline-flex;align-items:center;gap:.3rem;border-radius:.55rem;padding:.5rem .95rem;font-size:.85rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.tl-btn:hover{background:#f1f5f9}.tl-btn.sm{padding:.25rem .6rem;font-size:.76rem}.tl-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.tl-btn.grn{background:#0f766e;border-color:#0f766e;color:#fff}.tl-btn.red{color:#b91c1c;border-color:#fecaca}.tl-btn.vio{background:#7c3aed;border-color:#7c3aed;color:#fff}',
      '.tl-btn:disabled{opacity:.5;cursor:default}.dark .tl-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .tl-btn.pri{background:#2563eb}.dark .tl-btn.grn{background:#0d9488}',
      '.tl-t{width:100%;border-collapse:collapse;font-size:.84rem}.tl-t th{text-align:left;font-size:.7rem;text-transform:uppercase;color:#64748b;padding:.45rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}.tl-t th.n{text-align:right}',
      '.tl-t td{padding:.45rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.tl-t td.n{text-align:right;white-space:nowrap}.dark .tl-t th,.dark .tl-t td{border-color:#334155}.tl-t tr.click{cursor:pointer}.tl-t tr.click:hover td{background:#f8fafc}',
      '.tl-t input{width:100%;border:1px solid #cbd5e1;border-radius:.4rem;padding:.28rem .4rem;font-size:.82rem;background:#fff;color:inherit}.tl-t input.n{text-align:right;min-width:70px}.dark .tl-t input{background:#0f172a;border-color:#334155}',
      '.tl-badge{display:inline-block;padding:.08rem .5rem;border-radius:999px;font-size:.72rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);white-space:nowrap}',
      '.tl-sub{color:#64748b;font-size:.76rem}.tl-empty{padding:2rem 1rem;text-align:center;color:#64748b}',
      '.tl-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem}.tl-g .w{grid-column:1/-1}.tl-g .w2{grid-column:span 2}@media (max-width:760px){.tl-g{grid-template-columns:1fr}.tl-g .w2{grid-column:auto}}',
      '.tl-f label{display:block;font-size:.73rem;font-weight:600;color:#475569;margin-bottom:.2rem}.tl-f input,.tl-f select,.tl-f textarea{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.88rem;background:#fff;color:inherit;font-family:inherit}',
      '.dark .tl-f input,.dark .tl-f select,.dark .tl-f textarea{background:#0f172a;border-color:#334155}.tl-f textarea{min-height:60px}',
      '.tl-qs{position:relative}.tl-sugg{position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #cbd5e1;border-radius:.5rem;box-shadow:0 10px 28px rgba(0,0,0,.18);max-height:240px;overflow:auto}',
      '.tl-sugg button{display:block;width:100%;text-align:left;border:0;background:none;padding:.45rem .6rem;cursor:pointer;font-size:.84rem;color:#0f172a}.tl-sugg button:hover{background:#eff6ff}.tl-sugg small{color:#64748b}.dark .tl-sugg{background:#1e293b}.dark .tl-sugg button{color:#e2e8f0}',
      '.tl-mc{border:1px solid #c7d2fe;border-left:4px solid #1e3a8a;border-radius:.7rem;padding:.8rem;margin-bottom:.8rem;background:#f8faff}.dark .tl-mc{background:#0f172a;border-color:#334155}',
      '.tl-mh{display:grid;grid-template-columns:150px minmax(0,1fr) minmax(0,1.2fr) 90px auto;gap:.5rem;align-items:end;margin-bottom:.6rem}@media (max-width:860px){.tl-mh{grid-template-columns:1fr 1fr}}',
      '.tl-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:.5rem}',
      '.tl-cat{border:1px solid #e2e8f0;border-radius:.55rem;background:#fff}.dark .tl-cat{background:#1e293b;border-color:#334155}.tl-cat summary{cursor:pointer;padding:.45rem .6rem;font-weight:700;font-size:.82rem;display:flex;justify-content:space-between;gap:.5rem}',
      '.tl-cat summary .c{font-weight:600;color:#1e3a8a;font-size:.74rem}.tl-ci{display:grid;grid-template-columns:auto minmax(0,1fr) 70px;gap:.45rem;align-items:center;padding:.22rem .6rem;font-size:.83rem}.tl-ci.on{background:#eff6ff}.dark .tl-ci.on{background:#1e3a8a33}',
      '.tl-ci input[type=number]{width:70px;border:1px solid #cbd5e1;border-radius:.35rem;padding:.15rem .3rem;font-size:.8rem;background:#fff;color:inherit}.tl-ci input[type=number]:disabled{opacity:.35}.tl-ci label{cursor:pointer}',
      '.tl-cust{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) 80px auto;gap:.4rem;margin-top:.35rem}.tl-cust input{border:1px solid #cbd5e1;border-radius:.4rem;padding:.3rem .45rem;font-size:.82rem;background:#fff;color:inherit;width:100%}',
      '.tl-no{display:inline-flex;align-items:center;gap:.5rem;background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;border-radius:.6rem;padding:.4rem .7rem;font-weight:800;font-size:1.05rem;letter-spacing:.02em}',
      '.tl-acts{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end;margin-top:.8rem}',
      '.tl-tot{text-align:right;font-weight:800;font-size:1.05rem;margin-top:.5rem}',
      '.tl-prop{color:#7c3aed;font-weight:700;font-size:.78rem;display:block}.tl-old{text-decoration:line-through;color:#94a3b8}',
      '.tl-log{display:flex;flex-direction:column;gap:.35rem;max-height:320px;overflow:auto}.tl-log div{font-size:.82rem;border-left:3px solid var(--c,#94a3b8);padding:.2rem .5rem;background:#f8fafc;border-radius:0 .4rem .4rem 0}.dark .tl-log>div{background:#0f172a}',
      '.tl-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:6vh 1rem;overflow:auto}',
      '.tl-dlg{background:#fff;border-radius:1rem;max-width:560px;width:100%;padding:1.2rem}.dark .tl-dlg{background:#1e293b}.tl-dlg h3{margin:0 0 .8rem}',
      '.tl-tool{border:1px solid #e2e8f0;border-radius:.6rem;padding:.55rem;margin-top:.45rem;background:#fff}.dark .tl-tool{background:#1e293b;border-color:#334155}',
      '.tl-tg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.4rem;margin-bottom:.35rem}@media (max-width:1100px){.tl-tg{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.tl-tg .tl-f input,.tl-tg .tl-f select{padding:.32rem .45rem;font-size:.82rem}',
      '.tl-files{border:1px dashed #cbd5e1;border-radius:.6rem;padding:.3rem .7rem .6rem;margin:.6rem 0}.tl-file{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.25rem 0;font-size:.85rem}',
      '.tl-file a{color:#1d4ed8;font-weight:600;text-decoration:none}.tl-file a:hover{text-decoration:underline}',
      '.tl-catwrap{display:grid;grid-template-columns:230px minmax(0,1fr);gap:.6rem;align-items:start}@media (max-width:760px){.tl-catwrap{grid-template-columns:1fr}}',
      '.tl-catnav{display:flex;flex-direction:column;gap:.25rem;border:1px solid #e2e8f0;border-radius:.6rem;padding:.35rem;background:#fff}.dark .tl-catnav{background:#1e293b;border-color:#334155}',
      '.tl-catbtn{display:flex;justify-content:space-between;align-items:center;gap:.4rem;border:0;background:none;border-radius:.45rem;padding:.42rem .55rem;font-size:.83rem;font-weight:600;color:#334155;cursor:pointer;text-align:left}',
      '.tl-catbtn:hover{background:#f1f5f9}.tl-catbtn.on{background:#1e3a8a;color:#fff}.dark .tl-catbtn{color:#e2e8f0}.dark .tl-catbtn:hover{background:#0f172a}',
      '.tl-catbtn .n{font-size:.72rem;font-weight:700;color:#64748b;background:#f1f5f9;border-radius:999px;padding:0 .45rem}.tl-catbtn .n.on{background:#dcfce7;color:#166534}.tl-catbtn.on .n{background:#ffffff33;color:#fff}',
      '.tl-catpane{border:1px solid #e2e8f0;border-radius:.6rem;background:#fff;padding:.4rem 0;min-height:200px}.dark .tl-catpane{background:#1e293b;border-color:#334155}',
      '.tl-catpane-h{display:flex;gap:.6rem;align-items:baseline;padding:.2rem .7rem .45rem;border-bottom:1px solid #f1f5f9;margin-bottom:.25rem;flex-wrap:wrap}',
      '.tl-ci2{grid-template-columns:auto minmax(150px,1fr) 64px 120px minmax(150px,1.3fr)}.tl-ci2 input.tl-size,.tl-ci2 input.tl-desc{border:1px solid #cbd5e1;border-radius:.35rem;padding:.15rem .35rem;font-size:.8rem;background:#fff;color:inherit;min-width:0}',
      '.tl-ci3{grid-template-columns:auto minmax(150px,1fr) 64px 120px minmax(150px,1.3fr) auto}.tl-ied{display:flex;gap:.15rem}.tl-ied button{border:0;background:none;cursor:pointer;font-size:.8rem;opacity:.55;padding:.1rem .2rem}.tl-ied button:hover{opacity:1}',
      '.tl-addrow{display:flex;gap:.4rem;padding:.45rem .7rem .2rem;border-top:1px dashed #e2e8f0;margin-top:.3rem}.tl-addrow input{flex:1;border:1px solid #cbd5e1;border-radius:.4rem;padding:.3rem .5rem;font-size:.82rem;background:#fff;color:inherit}.dark .tl-addrow input{background:#0f172a;border-color:#334155}',
      '.tl-catadd{color:#1e3a8a;border:1px dashed #93c5fd!important;margin-top:.2rem;justify-content:center}.dark .tl-catadd{color:#93c5fd}',
      '.tl-ci2 input:disabled{opacity:.35}@media (max-width:900px){.tl-ci2{grid-template-columns:auto 1fr 64px}.tl-ci2 .tl-size,.tl-ci2 .tl-desc{grid-column:2 / span 2}}',
      '.tl-cust2{grid-template-columns:minmax(0,.8fr) minmax(0,1.3fr) 70px minmax(0,.8fr) minmax(0,1.2fr) auto}@media (max-width:900px){.tl-cust2{grid-template-columns:1fr 1fr}}',
      '.tl-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s;max-width:90vw}',
      '.tl-toast.in{opacity:1;transform:translate(-50%,0)}.tl-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var S = { type: 'ACCESSORIES', status: '', user: '', q: '', checklists: null, isAdmin: false, seesAll: false };
  var root, listBox, tilesBox, whoSel, mainBox;

  function checklists() {
    if (S.checklists) return Promise.resolve(S.checklists);
    return api('GET', '/tooling/checklist').then(function (j) { S.checklists = j.data.checklists; return S.checklists; });
  }
  function listFor(mt) { var c = S.checklists && (S.checklists[mt] || S.checklists.VMC); return c ? c.categories : {}; }
  function machineLabel(m) { return (m.machineType === 'OTHER' ? (m.machineOther || 'Other') : m.machineType) + (m.make ? ' · ' + m.make : '') + (m.count > 1 ? ' × ' + m.count : ''); }

  // ── list ────────────────────────────────────────────────────────────
  function showList() {
    if (location.hash) try { history.replaceState(null, '', location.pathname); } catch (e) {}
    listBox.parentNode.style.display = ''; clear(mainBox);
    load();
  }
  function load() {
    clear(listBox).appendChild(el('div', { class: 'tl-empty', text: 'Loading…' }));
    var qs = '?type=' + S.type + (S.status ? '&status=' + S.status : '') + (S.user ? '&user=' + encodeURIComponent(S.user) : '') + (S.q ? '&q=' + encodeURIComponent(S.q) : '');
    api('GET', '/tooling' + qs).then(function (j) {
      var d = j.data; S.isAdmin = d.isAdmin; S.seesAll = d.seesAll;
      if (whoSel.options.length <= 1) d.people.forEach(function (p) { whoSel.appendChild(el('option', { value: p.id, text: p.name })); });
      whoSel.style.display = d.seesAll ? '' : 'none'; whoSel.value = S.user;
      var adm = document.getElementById('tl-checklists'); if (adm) adm.style.display = d.isAdmin ? '' : 'none';
      clear(tilesBox);
      var total = Object.keys(d.counts).reduce(function (a, k) { return a + d.counts[k]; }, 0);
      [['', 'All', '#1e3a8a', total]].concat(Object.keys(STATUS).map(function (k) { return [k, STATUS[k][0], STATUS[k][1], d.counts[k] || 0]; })).forEach(function (x) {
        tilesBox.appendChild(el('button', { type: 'button', class: 'tl-tile' + (S.status === x[0] ? ' on' : ''), style: '--c:' + x[2], 'data-tile': x[0] || 'ALL', onclick: function () { S.status = x[0]; load(); } },
          [el('b', { text: String(x[3]) }), el('span', { text: x[1] })]));
      });
      clear(listBox);
      if (!d.requests.length) { listBox.appendChild(el('div', { class: 'tl-empty', text: 'Nothing here yet — press "+ New ' + TYPES[S.type].one + '".' })); return; }
      var tb = el('tbody', {}, d.requests.map(function (r) {
        var st = STATUS[r.status] || ['?', '#64748b'];
        return el('tr', { class: 'click', 'data-req': r.id, onclick: function () { openReq(r.id); } }, [
          el('td', {}, [r.requestNo ? el('b', { text: r.requestNo }) : el('span', { class: 'tl-sub', text: 'no number yet' })]),
          el('td', {}, [el('span', { class: 'tl-badge', style: '--c:' + st[1], text: st[0] })]),
          el('td', {}, [el('b', { text: r.customerName }), r.title ? el('div', { class: 'tl-sub', text: r.title }) : null]),
          el('td', { text: r.machineSummary || '—' }),
          el('td', { class: 'n', text: String(r.itemCount) }),
          el('td', { class: 'n', text: r.total == null ? '—' : money(r.total) }),
          el('td', { text: r.createdByName || '—' }),
          el('td', { class: 'tl-sub', text: when(r.updatedAt) })
        ]);
      }));
      listBox.appendChild(el('div', { style: 'overflow-x:auto' }, [el('table', { class: 'tl-t', id: 'tl-table' }, [
        el('thead', {}, [el('tr', {}, [['Number', ''], ['Status', ''], ['Customer', ''], ['Machines', ''], ['Items', 'n'], ['Value', 'n'], ['Engineer', ''], ['Updated', '']].map(function (h) { return el('th', { class: h[1], text: h[0] }); }))]), tb])]));
    }).catch(function (e) { clear(listBox).appendChild(el('div', { class: 'tl-empty', text: e.message })); });
  }

  // ── open (view or edit) ─────────────────────────────────────────────
  function openReq(id) {
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    listBox.parentNode.style.display = 'none';
    clear(mainBox).appendChild(el('div', { class: 'tl-card' }, [el('div', { class: 'tl-empty', text: 'Loading…' })]));
    Promise.all([api('GET', '/tooling/' + encodeURIComponent(id)), checklists()]).then(function (r) {
      S.isAdmin = r[0].data.isAdmin;
      var q = r[0].data.request, mine = q.createdById === me().id;
      var canEdit = (['DRAFT', 'REJECTED'].indexOf(q.status) !== -1 && (mine || S.isAdmin)) || (q.status === 'SUBMITTED' && mine);
      if (canEdit && ['DRAFT', 'REJECTED'].indexOf(q.status) !== -1) editor(q); else view(q);
    }).catch(function (e) { clear(mainBox).appendChild(el('div', { class: 'tl-card' }, [el('div', { class: 'tl-empty', text: e.message }), el('button', { class: 'tl-btn', type: 'button', text: '← Back', onclick: showList })])); });
  }
  function newReq() {
    try { history.replaceState(null, '', '#new'); } catch (e) {}
    listBox.parentNode.style.display = 'none';
    clear(mainBox).appendChild(el('div', { class: 'tl-card' }, [el('div', { class: 'tl-empty', text: 'Loading checklists…' })]));
    checklists().then(function () { editor(null); }).catch(function (e) { toast(e.message, 'err'); });
  }

  // ── editor: customer, machines, checklist ticks + qty, own components ──
  function editor(q) {
    var F = {
      id: q ? q.id : null, customerId: q ? q.customerId : null, customerName: q ? q.customerName : '', title: q ? q.title || '' : '', notes: q ? q.notes || '' : '',
      machines: q ? q.machines.map(fromServer) : [blankMachine()]
    };
    function blankMachine() { return { machineType: 'VMC', machineOther: '', make: '', count: 1, ticks: {}, custom: [], tools: [] }; }
    F.pending = [];   // files picked before the first save — uploaded right after it
    function fromServer(m) {
      var list = listFor(m.machineType), known = {}, mm = { machineType: m.machineType, machineOther: m.machineOther || '', make: m.make || '', count: m.count || 1, ticks: {}, custom: [], tools: [] };
      Object.keys(list).forEach(function (c) { list[c].forEach(function (i) { known[c + '||' + i] = 1; }); });
      m.items.forEach(function (it) {
        var k = it.category + '||' + it.item;
        if (it.toolType || it.operation || it.rpm || it.vc || it.feed) { mm.tools.push({ id: it.id, operation: it.operation || '', toolType: it.toolType || '', item: it.item, itemCode: it.itemCode || '', brand: it.brand || '', qty: qn(it.quantity),
          price: it.price != null ? qn(it.price) : '', rpm: it.rpm || '', feed: it.feed || '', vc: it.vc || '', pockets: it.pockets || '', holder: it.holder || '', toolSpec: it.toolSpec || '' }); return; }
        if (!it.custom && known[k]) mm.ticks[k] = { qty: qn(it.quantity), id: it.id, size: it.holder || '', desc: it.toolSpec || '' };
        else mm.custom.push({ category: it.category || '', item: it.item, qty: qn(it.quantity), id: it.id, size: it.holder || '', desc: it.toolSpec || '' });
      });
      return mm;
    }
    clear(mainBox);
    var card = el('div', { class: 'tl-card', id: 'tl-editor' });
    mainBox.appendChild(card);
    function draw() {
      clear(card);
      card.appendChild(el('div', { style: 'display:flex;justify-content:space-between;gap:.5rem;align-items:center;margin-bottom:.7rem;flex-wrap:wrap' }, [
        el('h2', { style: 'margin:0', text: (F.id ? 'Edit ' : 'New ') + TYPES[S.type].one + (q && q.status === 'REJECTED' ? ' (rejected — fix and send again)' : '') }),
        el('button', { class: 'tl-btn sm', type: 'button', text: '← Back to list', onclick: showList })]));
      if (q && q.status === 'REJECTED' && q.adminNote) card.appendChild(el('div', { class: 'tl-card', style: 'background:#fef2f2;border-color:#fecaca;padding:.6rem .8rem', text: 'Admin: ' + q.adminNote }));
      // customer + title + notes
      var cust = el('input', { id: 'tl-customer', placeholder: 'Search customer…', autocomplete: 'off', value: F.customerName });
      var sg = el('div', { class: 'tl-sugg', hidden: true }), t;
      cust.addEventListener('input', function () {
        F.customerName = cust.value.trim(); F.customerId = null; clearTimeout(t);
        var v = cust.value.trim(); if (v.length < 2) { sg.hidden = true; return; }
        t = setTimeout(function () {
          api('GET', '/customers?limit=8&search=' + encodeURIComponent(v)).then(function (j) {
            var list = (j.data && j.data.items) || []; clear(sg); sg.hidden = !list.length;
            list.forEach(function (c) { sg.appendChild(el('button', { type: 'button', onmousedown: function (e) { e.preventDefault(); F.customerId = c.id; F.customerName = c.companyName; cust.value = c.companyName; sg.hidden = true; } },
              [el('b', { text: c.companyName }), ' ', el('small', { text: [c.contactPerson, c.location].filter(Boolean).join(' · ') })])); });
          }).catch(function () {});
        }, 220);
      });
      cust.addEventListener('blur', function () { setTimeout(function () { sg.hidden = true; }, 150); });
      var title = el('input', { id: 'tl-title', value: F.title, placeholder: S.type === 'PROJECT' ? 'e.g. New plant line 2' : 'e.g. 2 new VMCs — Hosur unit' });
      title.oninput = function () { F.title = title.value; };
      var notes = el('textarea', { id: 'tl-notes', placeholder: 'Anything the admin should know — delivery, brands, budget…' }); notes.value = F.notes;
      notes.oninput = function () { F.notes = notes.value; };
      card.appendChild(el('div', { class: 'tl-g' }, [
        el('div', { class: 'tl-f' }, [el('label', { text: 'Customer *' }), el('div', { class: 'tl-qs' }, [cust, sg])]),
        el('div', { class: 'tl-f w2' }, [el('label', { text: 'Title (optional)' }), title]),
        el('div', { class: 'tl-f w' }, [el('label', { text: 'Notes' }), notes])
      ]));
      if (S.type === 'PROJECT') card.appendChild(filesBox(q && F.id ? q : null, true, F, function (nq) { q = nq; draw(); }));
      card.appendChild(el('h2', { style: 'margin:1rem 0 .5rem', text: 'Machines' }));
      F.machines.forEach(function (m, mi) { card.appendChild(machineCard(m, mi)); });
      card.appendChild(el('button', { class: 'tl-btn', type: 'button', id: 'tl-add-machine', text: '+ Add another machine', onclick: function () { F.machines.push(blankMachine()); draw(); } }));
      var acts = el('div', { class: 'tl-acts' });
      if (F.id && (!q || q.createdById === me().id || me().role === 'SUPER_ADMIN')) acts.appendChild(el('button', { class: 'tl-btn red', type: 'button', style: 'margin-right:auto', text: 'Delete', onclick: function () {
        if (!confirm('Delete this ' + TYPES[S.type].one + '?')) return;
        api('DELETE', '/tooling/' + F.id).then(function (j) { toast(j.message); showList(); }).catch(function (e) { toast(e.message, 'err'); });
      } }));
      acts.appendChild(el('button', { class: 'tl-btn', type: 'button', id: 'tl-save', text: 'Save draft', onclick: function (e) { save(e.target, false); } }));
      acts.appendChild(el('button', { class: 'tl-btn pri', type: 'button', id: 'tl-submit', text: 'Send for approval', onclick: function (e) { save(e.target, true); } }));
      card.appendChild(acts);
    }
    function machineCard(m, mi) {
      var box = el('div', { class: 'tl-mc', 'data-machine': String(mi) });
      var type = el('select', { 'data-k': 'machineType' }, MACHINES.map(function (x) { return el('option', { value: x[0], text: x[1] }); }));
      type.value = m.machineType;
      var other = el('input', { 'data-k': 'machineOther', placeholder: 'Type the machine, e.g. Turn-mill', value: m.machineOther });
      other.style.display = m.machineType === 'OTHER' ? '' : 'none';
      other.oninput = function () { m.machineOther = other.value; };
      type.onchange = function () {
        // ticks that are not on the new machine's checklist move to "added by hand" so nothing is lost
        var list = listFor(type.value), known = {};
        Object.keys(list).forEach(function (c) { list[c].forEach(function (i) { known[c + '||' + i] = 1; }); });
        Object.keys(m.ticks).forEach(function (k) { if (!known[k]) { var p = k.split('||'); m.custom.push({ category: p[0], item: p[1], qty: m.ticks[k].qty, id: m.ticks[k].id }); delete m.ticks[k]; } });
        m.machineType = type.value; draw();
      };
      var make = el('input', { 'data-k': 'make', placeholder: 'e.g. BFW / Ace / LMW, model', value: m.make }); make.oninput = function () { m.make = make.value; };
      var cnt = el('input', { 'data-k': 'count', type: 'number', min: '1', step: '1', value: String(m.count) }); cnt.oninput = function () { m.count = Math.max(1, parseInt(cnt.value, 10) || 1); };
      var nTick = Object.keys(m.ticks).length + m.custom.length;
      box.appendChild(el('div', { class: 'tl-mh' }, [
        el('div', { class: 'tl-f' }, [el('label', { text: 'Machine ' + (mi + 1) }), type]),
        el('div', { class: 'tl-f' }, [el('label', { text: m.machineType === 'OTHER' ? 'Machine type *' : ' ' }), other]),
        el('div', { class: 'tl-f' }, [el('label', { text: 'Make / model' }), make]),
        el('div', { class: 'tl-f' }, [el('label', { text: 'No. of machines' }), cnt]),
        el('div', {}, [F.machines.length > 1 ? el('button', { class: 'tl-btn sm red', type: 'button', text: 'Remove machine', onclick: function () { if (!nTick || confirm('Remove machine ' + (mi + 1) + ' and its ' + nTick + ' item(s)?')) { F.machines.splice(mi, 1); draw(); } } }) : null])
      ]));
      // Projects have no checklist: only files (above) and the tool selection below.
      if (S.type !== 'PROJECT') {
      // checklist: pick a category on the left, its items load on the right (tick + quantity)
      var list = listFor(m.machineType), catNames = Object.keys(list);
      if (!m.cat || !list[m.cat]) m.cat = catNames.filter(function (c) { return list[c].some(function (i) { return m.ticks[c + '||' + i]; }); })[0] || catNames[0];
      var nav = el('div', { class: 'tl-catnav', role: 'tablist' });
      var pane = el('div', { class: 'tl-catpane', 'data-cat-pane': m.cat });
      function tickedIn(c) { return list[c].filter(function (x) { return m.ticks[c + '||' + x]; }).length; }
      catNames.forEach(function (c) {
        var n0 = tickedIn(c);
        nav.appendChild(el('button', { type: 'button', role: 'tab', class: 'tl-catbtn' + (c === m.cat ? ' on' : ''), 'data-cat': c, onclick: function () { m.cat = c; draw(); } },
          [el('span', { text: c }), el('span', { class: 'n' + (n0 ? ' on' : ''), 'data-cat-count': c, text: n0 ? n0 + ' ✓' : String(list[c].length) })]));
      });
      var c = m.cat;
      var clM = ['VMC', 'HMC', 'CNC', 'VTL'].indexOf(m.machineType) !== -1 ? m.machineType : 'VMC';
      /* edit the list itself: add (anyone), rename / delete (Admin) — saved for everyone, per machine type */
      function clCall(path, payload, after) {
        payload.machine = clM;
        return api('POST', '/tooling/checklist/' + path, payload).then(function (j) {
          S.checklists[clM].categories = j.data.categories; S.checklists[clM].uploaded = true;
          if (clM === 'VMC' && S.checklists.OTHER) S.checklists.OTHER.categories = j.data.categories;
          if (after) after(j.data.categories);
          toast(j.message); draw();
        }).catch(function (e) { toast(e.message, 'err'); });
      }
      function moveTicks(fn) {   // keep ticks when a category / item is renamed
        F.machines.forEach(function (mm) {
          if ((['VMC', 'HMC', 'CNC', 'VTL'].indexOf(mm.machineType) !== -1 ? mm.machineType : 'VMC') !== clM) return;
          Object.keys(mm.ticks).forEach(function (k) { var nk = fn(k); if (nk && nk !== k) { mm.ticks[nk] = mm.ticks[k]; delete mm.ticks[k]; } });
          if (mm.cat) { var nc = fn(mm.cat + '||'); if (nc) mm.cat = nc.split('||')[0]; }
        });
      }
      nav.appendChild(el('button', { type: 'button', class: 'tl-catbtn tl-catadd', id: 'tl-new-cat-' + mi, text: '＋ New category', onclick: function () {
        var name = (prompt('New category name (e.g. Angle Heads):') || '').trim(); if (!name) return;
        var first = (prompt('First item in "' + name + '":') || '').trim(); if (!first) return;
        clCall('item', { category: name, item: first }, function () { m.cat = name; m.ticks[name + '||' + first] = { qty: '1', size: '', desc: '' }; });
      } }));
      pane.appendChild(el('div', { class: 'tl-catpane-h' }, [el('b', { text: c }), el('span', { class: 'tl-sub', text: list[c].length + ' items — tick what is needed and enter the quantity' }),
        S.isAdmin ? el('span', { style: 'margin-left:auto;display:flex;gap:.3rem' }, [
          el('button', { type: 'button', class: 'tl-btn sm', 'data-cat-rename': c, text: '✎ Rename', onclick: function () {
            var to = (prompt('Rename category "' + c + '" to:', c) || '').trim(); if (!to || to === c) return;
            clCall('rename', { category: c, to: to }, function () { moveTicks(function (k) { var p = k.split('||'); return p[0] === c ? to + '||' + p[1] : null; }); });
          } }),
          el('button', { type: 'button', class: 'tl-btn sm red', 'data-cat-del': c, text: '🗑 Delete', onclick: function () {
            if (!confirm('Delete the category "' + c + '" and its ' + list[c].length + ' item(s) from the ' + clM + ' list?')) return;
            clCall('remove', { category: c }, function () { m.cat = null; });
          } })]) : null]));
      list[c].forEach(function (i) {
        var k = c + '||' + i, t = m.ticks[k];
        var cb = el('input', { type: 'checkbox', 'data-item': i });
        cb.checked = !!t;
        var qty = el('input', { type: 'number', min: '0', step: 'any', value: t ? t.qty : '', placeholder: 'qty', 'data-qty': i, disabled: !t, 'aria-label': 'Quantity, ' + i });
        var size = el('input', { class: 'tl-size', value: t ? t.size || '' : '', placeholder: 'Holder / size', 'data-size': i, disabled: !t, 'aria-label': 'Holder / size, ' + i });
        var desc = el('input', { class: 'tl-desc', value: t ? t.desc || '' : '', placeholder: 'Description (spec, brand, length…)', 'data-desc': i, disabled: !t, 'aria-label': 'Description, ' + i });
        size.oninput = function () { if (m.ticks[k]) m.ticks[k].size = size.value; };
        desc.oninput = function () { if (m.ticks[k]) m.ticks[k].desc = desc.value; };
        var row = el('div', { class: 'tl-ci tl-ci2' + (t ? ' on' : '') + (S.isAdmin ? ' tl-ci3' : '') }, [cb, el('label', { text: i, onclick: function () { cb.click(); } }), qty, size, desc,
          S.isAdmin ? el('span', { class: 'tl-ied' }, [
            el('button', { type: 'button', title: 'Rename item', 'data-item-rename': i, text: '✎', onclick: function () {
              var to = (prompt('Rename "' + i + '" to:', i) || '').trim(); if (!to || to === i) return;
              clCall('rename', { category: c, item: i, to: to }, function () { moveTicks(function (k2) { return k2 === k ? c + '||' + to : null; }); });
            } }),
            el('button', { type: 'button', title: 'Delete item', 'data-item-del': i, text: '🗑', onclick: function () {
              if (!confirm('Delete "' + i + '" from ' + c + '?')) return;
              clCall('remove', { category: c, item: i }, function () { F.machines.forEach(function (mm) { delete mm.ticks[k]; }); });
            } })]) : null]);
        cb.onchange = function () {
          if (cb.checked) { m.ticks[k] = { qty: qty.value || '1', size: size.value, desc: desc.value }; qty.value = m.ticks[k].qty; qty.disabled = size.disabled = desc.disabled = false; row.classList.add('on'); qty.focus(); qty.select(); }
          else { delete m.ticks[k]; qty.disabled = size.disabled = desc.disabled = true; qty.value = ''; row.classList.remove('on'); }
          var n2 = tickedIn(c), badge = nav.querySelector('[data-cat-count="' + c.replace(/"/g, '\\"') + '"]');
          if (badge) { badge.textContent = n2 ? n2 + ' ✓' : String(list[c].length); badge.classList.toggle('on', !!n2); }
        };
        qty.oninput = function () { if (m.ticks[k]) m.ticks[k].qty = qty.value; };
        pane.appendChild(row);
      });
      // add an item to this category (saved in the list for everyone) and tick it
      var newIt = el('input', { placeholder: 'New item in ' + c + '…', 'data-new-item': c, 'aria-label': 'New item in ' + c });
      function addIt() {
        var v = newIt.value.trim(); if (!v) { newIt.focus(); return; }
        clCall('item', { category: c, item: v }, function () { m.ticks[c + '||' + v] = m.ticks[c + '||' + v] || { qty: '1', size: '', desc: '' }; });
      }
      newIt.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
      pane.appendChild(el('div', { class: 'tl-addrow' }, [newIt, el('button', { type: 'button', class: 'tl-btn sm', 'data-add-item': c, text: '＋ Add to ' + c, onclick: addIt })]));
      box.appendChild(el('div', { class: 'tl-catwrap' }, [nav, pane]));
      // own components
      var dl = el('datalist', { id: 'tl-cats-' + mi }, Object.keys(list).concat(['Other']).map(function (c) { return el('option', { value: c }); }));
      var own = el('div', { style: 'margin-top:.6rem' }, [dl, el('div', { style: 'font-weight:700;font-size:.82rem', text: 'Components added by hand' }),
        el('div', { class: 'tl-sub', text: 'Pick or type a category — when you save, the component is added to that category\u2019s list (a new name makes a new category).' })]);
      m.custom.forEach(function (c, ci) {
        var cat = el('input', { list: 'tl-cats-' + mi, placeholder: 'Category', value: c.category, 'data-ck': 'category' }); cat.oninput = function () { c.category = cat.value; };
        var it = el('input', { placeholder: 'Component / item (e.g. BT40 ER32 holder 100 L)', value: c.item, 'data-ck': 'item' }); it.oninput = function () { c.item = it.value; };
        var q2 = el('input', { type: 'number', min: '0', step: 'any', placeholder: 'qty', value: c.qty, 'data-ck': 'qty' }); q2.oninput = function () { c.qty = q2.value; };
        var sz = el('input', { placeholder: 'Holder / size', value: c.size || '', 'data-ck': 'size' }); sz.oninput = function () { c.size = sz.value; };
        var ds = el('input', { placeholder: 'Description', value: c.desc || '', 'data-ck': 'desc' }); ds.oninput = function () { c.desc = ds.value; };
        own.appendChild(el('div', { class: 'tl-cust tl-cust2' }, [cat, it, q2, sz, ds, el('button', { class: 'tl-btn sm red', type: 'button', text: '✕', title: 'Remove', onclick: function () { m.custom.splice(ci, 1); draw(); } })]));
      });
      own.appendChild(el('button', { class: 'tl-btn sm', type: 'button', 'data-add-comp': String(mi), style: 'margin-top:.4rem', text: '+ Add component', onclick: function () { m.custom.push({ category: '', item: '', qty: '1' }); draw(); var r = box.querySelectorAll('[data-ck=item]'); if (r.length) r[r.length - 1].focus(); } }));
      box.appendChild(own);
      }
      if (S.type === 'PROJECT') box.appendChild(toolSection(m, mi));
      return box;
    }
    /* Projects: the tools selected for each operation, with cutting data and specification */
    function toolSection(m, mi) {
      var sec = el('div', { class: 'tl-tools', 'data-tools': String(mi) }, [el('div', { style: 'font-weight:700;font-size:.85rem;margin-top:.8rem', text: '🔧 Tool selection (operation-wise)' })]);
      m.tools.forEach(function (t, ti) {
        function f(key, label, attrs) {
          var i = el('input', Object.assign({ value: t[key] || '', 'data-tk': key }, attrs || {}));
          i.oninput = function () { t[key] = i.value; };
          return el('div', { class: 'tl-f' }, [el('label', { text: label }), i]);
        }
        var type = el('select', { 'data-tk': 'toolType' }, [el('option', { value: '', text: 'Choose…' })].concat(TOOL_TYPES.map(function (x) { return el('option', { value: x, text: x }); })));
        type.value = t.toolType;
        type.onchange = function () { t.toolType = type.value; draw(); };
        var card = el('div', { class: 'tl-tool', 'data-tool': String(ti) }, [
          el('div', { class: 'tl-tg' }, [
            f('operation', 'Operation', { placeholder: 'e.g. Face milling, Ø8.5 drilling, M10 tapping' }),
            el('div', { class: 'tl-f' }, [el('label', { text: 'Tool type' }), type]),
            f('item', 'Tool selected *', { placeholder: 'e.g. Face mill Ø63 45°' }),
            f('itemCode', 'Item code', { placeholder: 'e.g. SE445-63' }),
            f('brand', 'Brand', { placeholder: 'e.g. Taegutec' }),
            f('qty', 'Qty', { type: 'number', min: '0', step: 'any' }),
            f('price', 'Price ₹', { type: 'number', min: '0', step: '0.01' })
          ]),
          el('div', { class: 'tl-tg' }, [
            f('rpm', 'RPM', { inputmode: 'decimal' }), f('feed', 'Feed (mm/rev, fz or Vf)', { placeholder: 'e.g. 0.15 fz' }), f('vc', 'Cutting speed Vc (m/min)', { inputmode: 'decimal' }),
            isCutter(t.toolType) ? f('pockets', 'No. of pockets', { inputmode: 'numeric', placeholder: 'e.g. 5' }) : null,
            f('holder', 'Holder', { placeholder: 'e.g. BT40 FMA 22×60' }),
            el('div', { class: 'tl-f w2' }, [el('label', { text: 'Specification' }), (function () { var i = el('input', { value: t.toolSpec || '', 'data-tk': 'toolSpec', placeholder: SPEC_PH[t.toolType] || 'Diameter, length, flutes, coating, grade…' }); i.oninput = function () { t.toolSpec = i.value; }; return i; })()]),
            el('div', { style: 'align-self:end' }, [el('button', { class: 'tl-btn sm red', type: 'button', text: '✕ Remove', onclick: function () { m.tools.splice(ti, 1); draw(); } })])
          ])
        ]);
        sec.appendChild(card);
      });
      sec.appendChild(el('button', { class: 'tl-btn sm', type: 'button', 'data-add-tool': String(mi), style: 'margin-top:.4rem', text: '+ Add tool', onclick: function () { m.tools.push({ toolType: '', qty: '1' }); draw(); } }));
      return sec;
    }
    function body(submit) {
      return {
        type: S.type, customerId: F.customerId, customerName: F.customerName, title: F.title, notes: F.notes, submit: submit,
        machines: F.machines.map(function (m) {
          var items = [];
          Object.keys(m.ticks).forEach(function (k) { var p = k.split('||'), t = m.ticks[k]; items.push({ category: p[0], item: p[1], quantity: t.qty, id: t.id || '', holder: t.size || '', toolSpec: t.desc || '' }); });
          m.custom.forEach(function (c) { if ((c.item || '').trim()) items.push({ category: (c.category || '').trim(), item: c.item, quantity: c.qty, custom: true, id: c.id || '', holder: c.size || '', toolSpec: c.desc || '' }); });
          (m.tools || []).forEach(function (t) {
            if (!(t.item || '').trim()) return;
            items.push({ category: t.toolType || 'Tool', item: t.item, quantity: t.qty || 1, custom: true, id: t.id || '', operation: t.operation, toolType: t.toolType || 'Other', itemCode: t.itemCode, brand: t.brand,
              price: t.price === '' ? undefined : t.price, rpm: t.rpm, feed: t.feed, vc: t.vc, pockets: isCutter(t.toolType) ? t.pockets : '', holder: t.holder, toolSpec: t.toolSpec });
          });
          return { machineType: m.machineType, machineOther: m.machineOther, make: m.make, count: m.count, items: items };
        })
      };
    }
    function save(btn, submit) {
      if (!F.customerName) { toast('Pick the customer.', 'err'); document.getElementById('tl-customer').focus(); return; }
      btn.disabled = true;
      (F.id ? api('PUT', '/tooling/' + F.id, body(submit)) : api('POST', '/tooling', body(submit))).then(function (j) {
        var rid = j.data.request.id, files = F.pending.splice(0);
        return files.reduce(function (p, x) { return p.then(function (last) { var fd = new FormData(); fd.append('file', x.file); fd.append('kind', x.kind); return api('POST', '/tooling/' + rid + '/files', fd).catch(function (e) { toast(x.file.name + ': ' + e.message, 'err'); return last; }); }); }, Promise.resolve(j))
          .then(function (last) { return files.length ? api('GET', '/tooling/' + rid).then(function (k) { return { message: j.message + (files.length ? ' · ' + files.length + ' file(s) attached' : ''), data: { request: k.data.request } }; }) : j; });
      }).then(function (j) {
        toast(j.message); F.id = j.data.request.id;
        // hand-added components with a category are now in that category's list — reload the lists
        S.checklists = null;
        if (submit) view(j.data.request); else { q = j.data.request; checklists().then(function () { F.machines = q.machines.map(fromServer); draw(); }); try { history.replaceState(null, '', '#' + F.id); } catch (e) {} }
      }).catch(function (e) { toast(e.message, 'err'); btn.disabled = false; });
    }
    draw();
  }

  // ── project files: 3D (STEP / IGES), 2D drawings (DWG / DXF / PDF), PDFs, images, Office, ZIP ──
  var FILE_KIND = { '3D': ['3D model', '#7c3aed'], '2D': ['2D drawing', '#2563eb'], PDF: ['PDF', '#dc2626'], IMAGE: ['Image', '#0891b2'], DOC: ['Document', '#b45309'], ZIP: ['ZIP', '#475569'], OTHER: ['File', '#475569'] };
  function fileSize(n) { n = +n || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function openFile(q, f, download) {
    if (!download && /\.pdf$/i.test(f.fileName) && window.PdfView) { PdfView.show(API + '/api/tooling/' + q.id + '/files/' + f.id, { title: f.fileName, fileName: f.fileName }); return; }
    fetch(API + '/api/tooling/' + q.id + '/files/' + f.id + (download ? '?download=1' : ''), { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Could not open the file'); });
      return r.blob().then(function (b) {
        var u = URL.createObjectURL(b);
        if (!download && /^(application\/pdf|image\/)/.test(b.type)) { window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); return; }
        var a = el('a', { href: u, download: f.fileName }); document.body.appendChild(a); a.click(); a.remove();
      });
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function filesBox(q, canEdit, F, onChange) {
    var box = el('div', { class: 'tl-files', id: 'tl-files' }, [el('div', { style: 'font-weight:700;font-size:.88rem;margin:.6rem 0 .35rem', text: '📎 Project files — 3D (STEP), 2D drawings, PDF' })]);
    var files = (q && q.files) || [];
    files.forEach(function (f) {
      var K = FILE_KIND[f.kind] || FILE_KIND.OTHER;
      box.appendChild(el('div', { class: 'tl-file', 'data-file': f.fileName }, [
        el('span', { class: 'tl-badge', style: '--c:' + K[1], text: K[0] }),
        el('a', { href: '#', text: f.fileName, onclick: function (e) { e.preventDefault(); openFile(q, f, false); } }),
        el('span', { class: 'tl-sub', text: fileSize(f.size) + ' · ' + (f.uploadedByName || '') + ' · ' + when(f.createdAt) }),
        el('button', { class: 'tl-btn sm', type: 'button', text: '⬇', title: 'Download', onclick: function () { openFile(q, f, true); } }),
        canEdit ? el('button', { class: 'tl-btn sm red', type: 'button', text: '✕', title: 'Remove', onclick: function () {
          if (!confirm('Remove ' + f.fileName + '?')) return;
          api('DELETE', '/tooling/' + q.id + '/files/' + f.id).then(function (j) { toast(j.message); onChange(j.data.request); }).catch(function (e) { toast(e.message, 'err'); });
        } }) : null
      ]));
    });
    (F && F.pending || []).forEach(function (x, i) {
      box.appendChild(el('div', { class: 'tl-file' }, [el('span', { class: 'tl-badge', style: '--c:#64748b', text: 'to upload' }), el('span', { text: x.file.name }), el('span', { class: 'tl-sub', text: fileSize(x.file.size) }),
        el('button', { class: 'tl-btn sm red', type: 'button', text: '✕', onclick: function () { F.pending.splice(i, 1); onChange(q); } })]));
    });
    if (!files.length && !(F && F.pending.length)) box.appendChild(el('div', { class: 'tl-sub', text: 'No files yet.' }));
    if (canEdit) {
      var kind = el('select', { id: 'tl-file-kind' }, [['', 'Type: from the file'], ['3D', '3D model (STEP / IGES)'], ['2D', '2D drawing'], ['PDF', 'PDF'], ['DOC', 'Document'], ['OTHER', 'Other']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
      var inp = el('input', { type: 'file', id: 'tl-file-input', multiple: true, accept: '.step,.stp,.igs,.iges,.x_t,.sldprt,.stl,.prt,.dwg,.dxf,.pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.pptx,.zip' });
      inp.onchange = function () {
        var list = Array.prototype.slice.call(inp.files);
        if (!list.length) return;
        if (F && !F.id) { list.forEach(function (fl) { F.pending.push({ file: fl, kind: kind.value }); }); onChange(q); return; }   // uploaded after the first save
        list.reduce(function (p, fl) { return p.then(function (last) { var fd = new FormData(); fd.append('file', fl); fd.append('kind', kind.value); return api('POST', '/tooling/' + q.id + '/files', fd).then(function (j) { return j; }).catch(function (e) { toast(fl.name + ': ' + e.message, 'err'); return last; }); }); }, Promise.resolve(null))
          .then(function (j) { if (j) { toast(list.length + ' file(s) uploaded'); onChange(j.data.request); } });
      };
      box.appendChild(el('div', { style: 'display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.4rem' }, [kind, inp, el('span', { class: 'tl-sub', text: 'STEP, IGES, DWG, DXF, PDF, images, Excel / Word / PPT, ZIP — up to 50 MB each' })]));
    }
    return box;
  }

  // ── view: prices (admin), approval, negotiation, history ─────────────
  function view(q) {
    try { history.replaceState(null, '', '#' + q.id); } catch (e) {}
    clear(mainBox);
    var st = STATUS[q.status] || ['?', '#64748b'], mine = q.createdById === me().id;
    var pricing = S.isAdmin && (q.status === 'SUBMITTED' || q.status === 'NEGOTIATION');
    var nego = false;
    var card = el('div', { class: 'tl-card', id: 'tl-view' });
    mainBox.appendChild(card);
    function draw() {
      clear(card);
      card.appendChild(el('div', { style: 'display:flex;justify-content:space-between;gap:.6rem;align-items:flex-start;flex-wrap:wrap' }, [
        el('div', {}, [
          el('div', { style: 'display:flex;gap:.5rem;align-items:center;flex-wrap:wrap' }, [
            q.requestNo ? el('span', { class: 'tl-no', id: 'tl-number' }, [q.requestNo, el('button', { class: 'tl-btn sm', type: 'button', text: 'Copy', onclick: function () { try { navigator.clipboard.writeText(q.requestNo); toast('Copied ' + q.requestNo); } catch (e) {} } })]) : null,
            el('span', { class: 'tl-badge', style: '--c:' + st[1], text: st[0] })]),
          el('h2', { style: 'margin:.5rem 0 .1rem', text: q.customerName + (q.title ? ' — ' + q.title : '') }),
          el('div', { class: 'tl-sub', text: q.typeLabel + ' · by ' + (q.createdByName || '—') + ' · ' + when(q.submittedAt || q.createdAt) + (q.approvedByName ? ' · approved by ' + q.approvedByName + ' ' + when(q.approvedAt) : '') })
        ]),
        el('button', { class: 'tl-btn sm', type: 'button', text: '← Back to list', onclick: showList })
      ]));
      if (q.notes) card.appendChild(el('div', { style: 'margin:.6rem 0;white-space:pre-wrap;font-size:.88rem', text: q.notes }));
      if (q.type === 'PROJECT' || (q.files && q.files.length)) card.appendChild(filesBox(q, mine || S.isAdmin, null, function (nq) { q = nq; draw(); }));
      if (q.adminNote) card.appendChild(el('div', { style: 'margin:.4rem 0;font-size:.85rem;color:#475569', text: 'Admin note: ' + q.adminNote }));
      if (q.requestNo) card.appendChild(el('div', { class: 'tl-sub', style: 'margin:.4rem 0', html: null }, ['To quote: open ', el('a', { href: '/quotations/', text: 'Quotations' }), ', enter ', el('b', { text: q.requestNo }), ' in the "Price request / approval no." box and press "Load approved prices" — every item comes in with its price and discount.']));
      if (q.status === 'NEGOTIATION') card.appendChild(el('div', { class: 'tl-sub', style: 'color:#7c3aed;font-weight:600;margin:.3rem 0', text: q.proposals + ' new price(s) proposed by the engineer — ' + (S.isAdmin ? 'check them below and approve or turn down.' : 'waiting for the admin.') }));
      var edit = pricing || nego;
      q.machines.forEach(function (m) {
        card.appendChild(el('h2', { style: 'margin:1rem 0 .4rem;font-size:.95rem', text: '🛠 ' + m.label }));
        var rows = m.items.map(function (it) {
          var tdet = [it.operation ? 'Op: ' + it.operation : null, it.brand, it.rpm ? 'RPM ' + it.rpm : null, it.feed ? 'Feed ' + it.feed : null, it.vc ? 'Vc ' + it.vc : null,
            it.pockets ? 'Z ' + it.pockets : null, it.holder ? (q.type === 'PROJECT' ? 'Holder ' : 'Size ') + it.holder : null, it.toolSpec].filter(Boolean).join(' · ');
          var tds = [el('td', { class: 'tl-sub', text: it.category || '' }), el('td', {}, [el('b', { text: it.item }), it.custom && !it.toolType ? el('span', { class: 'tl-sub', text: ' (added)' }) : null, tdet ? el('div', { class: 'tl-sub', 'data-tooldet': '', text: tdet }) : null])];
          var prop = (it.proposedPrice != null || it.proposedDiscount != null) ? el('span', { class: 'tl-prop', text: 'proposed: ' + money(it.proposedPrice) + (it.proposedDiscount != null ? ' −' + qn(it.proposedDiscount) + '%' : '') }) : null;
          if (pricing) {
            tds.push(el('td', {}, [el('input', { class: 'n', 'data-p': 'quantity', 'data-id': it.id, type: 'number', min: '0', step: 'any', value: qn(it.quantity) })]));
            tds.push(el('td', {}, [el('input', { 'data-p': 'itemCode', 'data-id': it.id, placeholder: 'Item code', value: it.itemCode || '' })]));
            tds.push(el('td', {}, [el('input', { 'data-p': 'spec', 'data-id': it.id, placeholder: 'Brand / spec', value: it.spec || '' })]));
            tds.push(el('td', {}, [el('input', { class: 'n', 'data-p': 'price', 'data-id': it.id, type: 'number', min: '0', step: '0.01', value: it.proposedPrice != null ? qn(it.proposedPrice) : qn(it.price) }), prop ? el('span', { class: 'tl-sub', text: 'was ' + money(it.price) }) : null]));
            tds.push(el('td', {}, [el('input', { class: 'n', 'data-p': 'discount', 'data-id': it.id, type: 'number', min: '0', max: '100', step: '0.01', value: it.proposedDiscount != null ? qn(it.proposedDiscount) : qn(it.discount) })]));
          } else {
            tds.push(el('td', { class: 'n', text: qn(it.quantity) + ' ' + (it.unit || '') }));
            tds.push(el('td', { text: it.itemCode || '—' }));
            tds.push(el('td', { class: 'tl-sub', text: it.spec || '' }));
            if (nego) {
              tds.push(el('td', {}, [el('input', { class: 'n', 'data-p': 'price', 'data-id': it.id, type: 'number', min: '0', step: '0.01', value: qn(it.price) })]));
              tds.push(el('td', {}, [el('input', { class: 'n', 'data-p': 'discount', 'data-id': it.id, type: 'number', min: '0', max: '100', step: '0.01', value: qn(it.discount) })]));
            } else {
              tds.push(el('td', { class: 'n' }, [money(it.price), prop]));
              tds.push(el('td', { class: 'n', text: it.discount != null ? qn(it.discount) + ' %' : '—' }));
            }
          }
          tds.push(el('td', { class: 'n', text: money(it.net) }), el('td', { class: 'n' }, [el('b', { text: money(it.amount) })]));
          return el('tr', { 'data-item': it.id }, tds);
        });
        card.appendChild(el('div', { style: 'overflow-x:auto' }, [el('table', { class: 'tl-t' }, [
          el('thead', {}, [el('tr', {}, [['Category', ''], ['Item', ''], ['Qty', 'n'], ['Item code', ''], ['Brand / spec', ''], ['Price ₹', 'n'], ['Disc %', 'n'], ['Net ₹', 'n'], ['Amount ₹', 'n']].map(function (h) { return el('th', { class: h[1], text: h[0] }); }))]),
          el('tbody', {}, rows)])]));
      });
      card.appendChild(el('div', { class: 'tl-tot', id: 'tl-total', text: 'Total ' + money(q.total) + (q.pricedCount < q.itemCount ? '  (' + (q.itemCount - q.pricedCount) + ' item(s) not priced yet)' : '') }));
      var note = (pricing || nego) ? el('textarea', { id: 'tl-note', placeholder: nego ? 'Why the change? e.g. customer asked 8% on holders, competitor quoted ₹2,400' : 'Note to the engineer (needed for Reject)' }) : null;
      if (note) card.appendChild(el('div', { class: 'tl-f', style: 'margin-top:.6rem' }, [el('label', { text: nego ? 'Negotiation note *' : 'Note' }), note]));
      var acts = el('div', { class: 'tl-acts' });
      function collect(keys) {
        var by = {};
        card.querySelectorAll('input[data-p]').forEach(function (i) { var id = i.getAttribute('data-id'); by[id] = by[id] || { id: id }; by[id][i.getAttribute('data-p')] = i.value; });
        return Object.keys(by).map(function (k) { return by[k]; });
      }
      function send(action, btn) {
        btn.disabled = true;
        api('PATCH', '/tooling/' + q.id + '/prices', { items: collect(), action: action, note: note ? note.value.trim() : '' }).then(function (j) {
          toast(j.message); q = j.data.request; st = STATUS[q.status]; pricing = S.isAdmin && (q.status === 'SUBMITTED' || q.status === 'NEGOTIATION'); draw();
        }).catch(function (e) { toast(e.message, 'err'); btn.disabled = false; });
      }
      if (pricing) {
        acts.appendChild(el('button', { class: 'tl-btn red', type: 'button', id: 'tl-reject', style: 'margin-right:auto', text: q.status === 'NEGOTIATION' ? 'Turn down negotiation' : 'Reject', onclick: function (e) { if (!note.value.trim()) { toast('Write the reason in the note first.', 'err'); note.focus(); return; } send('reject', e.target); } }));
        acts.appendChild(el('button', { class: 'tl-btn', type: 'button', id: 'tl-price-save', text: 'Save prices', onclick: function (e) { send('save', e.target); } }));
        acts.appendChild(el('button', { class: 'tl-btn grn', type: 'button', id: 'tl-approve', text: q.status === 'NEGOTIATION' ? 'Approve new prices' : 'Approve & give number', onclick: function (e) { send('approve', e.target); } }));
      } else if (q.status === 'APPROVED' || (q.status === 'NEGOTIATION' && !S.isAdmin)) {
        if (!nego) acts.appendChild(el('button', { class: 'tl-btn vio', type: 'button', id: 'tl-negotiate', text: '🤝 Negotiate prices / discounts', onclick: function () { nego = true; draw(); } }));
        else {
          acts.appendChild(el('button', { class: 'tl-btn', type: 'button', text: 'Cancel', onclick: function () { nego = false; draw(); } }));
          acts.appendChild(el('button', { class: 'tl-btn vio', type: 'button', id: 'tl-nego-save', text: S.isAdmin ? 'Save negotiated prices' : 'Send new prices to admin', onclick: function (e) {
            var b = e.target; b.disabled = true;
            api('POST', '/tooling/' + q.id + '/negotiate', { items: collect(), note: note.value.trim() }).then(function (j) { toast(j.message); q = j.data.request; st = STATUS[q.status]; nego = false; pricing = S.isAdmin && (q.status === 'SUBMITTED' || q.status === 'NEGOTIATION'); draw(); })
              .catch(function (er) { toast(er.message, 'err'); b.disabled = false; });
          } }));
        }
      }
      if (q.status === 'SUBMITTED' && mine && !S.isAdmin) acts.appendChild(el('button', { class: 'tl-btn', type: 'button', text: '✎ Edit (before approval)', onclick: function () { editor(q); } }));
      if (me().role === 'SUPER_ADMIN' || (mine && q.status === 'SUBMITTED')) acts.appendChild(el('button', { class: 'tl-btn red', type: 'button', text: 'Delete', onclick: function () {
        if (!confirm('Delete ' + (q.requestNo || 'this request') + '?')) return;
        api('DELETE', '/tooling/' + q.id).then(function (j) { toast(j.message); showList(); }).catch(function (e) { toast(e.message, 'err'); });
      } }));
      card.appendChild(acts);
      // history
      if (q.log && q.log.length) {
        var lg = el('div', { class: 'tl-log', id: 'tl-log' });
        q.log.forEach(function (l) {
          var c = { APPROVED: '#16a34a', NEGO_OK: '#16a34a', REJECTED: '#dc2626', PROPOSED: '#7c3aed', NEGOTIATED: '#7c3aed', ADMIN: '#2563eb' }[l.kind] || '#94a3b8';
          var price = l.itemId ? [el('b', { text: l.item + ': ' }), l.oldPrice != null ? el('span', { class: 'tl-old', text: money(l.oldPrice) + (l.oldDiscount != null ? ' −' + qn(l.oldDiscount) + '%' : '') }) : null, ' → ',
            el('b', { text: money(l.newPrice) + (l.newDiscount != null ? ' −' + qn(l.newDiscount) + '%' : '') })] : [];
          lg.appendChild(el('div', { style: '--c:' + c }, [el('span', { class: 'tl-sub', text: (LOGK[l.kind] || l.kind) + ' · ' + (l.userName || '') + ' · ' + when(l.createdAt) }), el('br')].concat(price).concat(l.note ? [el('div', { text: l.note })] : [])));
        });
        card.appendChild(el('h2', { style: 'margin:1.1rem 0 .4rem;font-size:.95rem', text: 'Price & negotiation history' }));
        card.appendChild(lg);
      }
    }
    draw();
  }

  // ── admin: checklists (upload Excel per machine type) ────────────────
  function checklistDlg() {
    document.querySelectorAll('.tl-modal').forEach(function (m) { m.remove(); });
    var dlg = el('div', { class: 'tl-dlg' });
    var m = el('div', { class: 'tl-modal' }, [dlg]);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    var mt = el('select', { id: 'tl-cl-machine' }, ['VMC', 'HMC', 'CNC', 'VTL'].map(function (x) { return el('option', { value: x, text: x }); }));
    var file = el('input', { type: 'file', id: 'tl-cl-file', accept: '.xlsx,.csv' });
    var info = el('div', { class: 'tl-sub', style: 'margin:.5rem 0' });
    function upd() { checklists().then(function (c) { var x = c[mt.value]; var n = Object.keys(x.categories).reduce(function (a, k) { return a + x.categories[k].length; }, 0); info.textContent = mt.value + ': ' + n + ' items in ' + Object.keys(x.categories).length + ' categories (' + (x.uploaded ? 'uploaded list' : 'built-in list') + ').'; }); }
    mt.onchange = upd; upd();
    dlg.appendChild(el('h3', { text: 'Machine checklists' }));
    dlg.appendChild(el('p', { class: 'tl-sub', text: 'Upload an Excel with the columns Category and Item (optional Machine) to replace a machine type\'s checklist. The built-in VMC / HMC list comes from the VMC accessories checklist; CNC / VTL have a turning list.' }));
    dlg.appendChild(el('div', { class: 'tl-g' }, [el('div', { class: 'tl-f' }, [el('label', { text: 'Machine type' }), mt]), el('div', { class: 'tl-f w2' }, [el('label', { text: 'Excel / CSV file' }), file])]));
    dlg.appendChild(info);
    function post(reset, btn) {
      var fd = new FormData(); fd.append('machine', mt.value);
      if (reset) fd.append('reset', '1'); else { if (!file.files[0]) { toast('Choose the file.', 'err'); return; } fd.append('file', file.files[0]); }
      btn.disabled = true;
      api('POST', '/tooling/checklist', fd).then(function (j) { toast(j.message); S.checklists = null; upd(); }).catch(function (e) { toast(e.message, 'err'); }).then(function () { btn.disabled = false; });
    }
    dlg.appendChild(el('div', { class: 'tl-acts' }, [
      el('button', { class: 'tl-btn sm', type: 'button', text: 'Download current list', onclick: function () {
        checklists().then(function (c) {
          var rows = [['Category', 'Item']]; var x = c[mt.value].categories;
          Object.keys(x).forEach(function (k) { x[k].forEach(function (i) { rows.push([k, i]); }); });
          var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
          var a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: mt.value + '_checklist.csv' }); document.body.appendChild(a); a.click(); a.remove();
        });
      } }),
      el('button', { class: 'tl-btn sm red', type: 'button', text: 'Back to built-in list', onclick: function (e) { if (confirm('Use the built-in ' + mt.value + ' checklist again?')) post(true, e.target); } }),
      el('button', { class: 'tl-btn', type: 'button', text: 'Close', onclick: function () { m.remove(); } }),
      el('button', { class: 'tl-btn pri', type: 'button', id: 'tl-cl-upload', text: 'Upload', onclick: function (e) { post(false, e.target); } })
    ]));
  }

  function mountPage(content, type) {
    css();
    S.type = TYPES[type] ? type : 'ACCESSORIES';
    var T = TYPES[S.type];
    root = el('div', { class: 'tl-wrap' });
    root.appendChild(el('div', { class: 'tl-head' }, [el('div', {}, [el('h1', { text: T.title }), el('p', { text: T.sub })]),
      el('div', { style: 'display:flex;gap:.5rem' }, [
        el('button', { class: 'tl-btn', type: 'button', id: 'tl-checklists', style: 'display:none', text: '☑ Checklists', onclick: checklistDlg }),
        el('button', { class: 'tl-btn pri', type: 'button', id: 'tl-new', text: '+ New ' + T.one, onclick: newReq })])]));
    tilesBox = el('div', { class: 'tl-tiles', id: 'tl-tiles' });
    whoSel = el('select', { id: 'tl-user', style: 'display:none' }, [el('option', { value: '', text: 'All engineers' })]);
    whoSel.onchange = function () { S.user = whoSel.value; load(); };
    var q = el('input', { type: 'search', id: 'tl-search', placeholder: 'Search customer, number, title…' });
    var t; q.oninput = function () { clearTimeout(t); t = setTimeout(function () { S.q = q.value.trim(); load(); }, 250); };
    listBox = el('div', { id: 'tl-list' });
    root.appendChild(el('div', { class: 'tl-card' }, [tilesBox, el('div', { class: 'tl-bar' }, [whoSel, q]), listBox]));
    mainBox = el('div', { id: 'tl-main' });
    root.appendChild(mainBox);
    content.appendChild(root);
    var h = location.hash.slice(1);
    if (h === 'new') newReq(); else if (h) openReq(decodeURIComponent(h)); else load();
    if (h) load();
  }
  window.ToolingPage = { mountPage: mountPage };
})();
