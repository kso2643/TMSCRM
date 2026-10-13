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
    PROJECT:     { title: 'Projects', one: 'project', sub: 'Complete tooling packages for a customer project — machine by machine.', path: '/projects/' },
    TOOLEDUP:    { title: 'Tooled-up', one: 'tooled-up request', sub: 'Everything a machine needs to start cutting — holders, tools, gauges, consumables.', path: '/tooled-up/' },
    ACCESSORIES: { title: 'New machine accessories', one: 'accessories request', sub: 'Accessories checklist for a new machine — tick what the customer needs and the quantity.', path: '/machine-accessories/' }
  };
  var STATUS = { DRAFT: ['Draft', '#64748b'], SUBMITTED: ['Waiting for approval', '#d97706'], APPROVED: ['Approved', '#16a34a'], NEGOTIATION: ['Negotiation', '#7c3aed'], REJECTED: ['Rejected', '#dc2626'] };
  var MACHINES = [['VMC', 'VMC'], ['HMC', 'HMC'], ['CNC', 'CNC lathe'], ['VTL', 'VTL'], ['OTHER', 'Other (type it)']];
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
    function blankMachine() { return { machineType: 'VMC', machineOther: '', make: '', count: 1, ticks: {}, custom: [] }; }
    function fromServer(m) {
      var list = listFor(m.machineType), known = {}, mm = { machineType: m.machineType, machineOther: m.machineOther || '', make: m.make || '', count: m.count || 1, ticks: {}, custom: [] };
      Object.keys(list).forEach(function (c) { list[c].forEach(function (i) { known[c + '||' + i] = 1; }); });
      m.items.forEach(function (it) {
        var k = it.category + '||' + it.item;
        if (!it.custom && known[k]) mm.ticks[k] = { qty: qn(it.quantity), id: it.id };
        else mm.custom.push({ category: it.category || '', item: it.item, qty: qn(it.quantity), id: it.id });
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
      // checklist by category
      var list = listFor(m.machineType), cats = el('div', { class: 'tl-cats' });
      Object.keys(list).forEach(function (c) {
        var on = list[c].filter(function (i) { return m.ticks[c + '||' + i]; }).length;
        var cnt2 = el('span', { class: 'c', text: on ? on + ' ticked' : list[c].length + ' items' });
        var det = el('details', { class: 'tl-cat', open: on ? true : null }, [el('summary', {}, [c, cnt2])]);
        list[c].forEach(function (i) {
          var k = c + '||' + i, t = m.ticks[k];
          var cb = el('input', { type: 'checkbox', 'data-item': i });
          cb.checked = !!t;
          var qty = el('input', { type: 'number', min: '0', step: 'any', value: t ? t.qty : '', placeholder: 'qty', 'data-qty': i, disabled: !t, 'aria-label': 'Quantity, ' + i });
          var row = el('div', { class: 'tl-ci' + (t ? ' on' : '') }, [cb, el('label', { text: i, onclick: function () { cb.click(); } }), qty]);
          cb.onchange = function () {
            if (cb.checked) { m.ticks[k] = { qty: qty.value || '1' }; qty.value = m.ticks[k].qty; qty.disabled = false; row.classList.add('on'); qty.focus(); qty.select(); }
            else { delete m.ticks[k]; qty.disabled = true; qty.value = ''; row.classList.remove('on'); }
            var n2 = list[c].filter(function (x) { return m.ticks[c + '||' + x]; }).length; cnt2.textContent = n2 ? n2 + ' ticked' : list[c].length + ' items';
          };
          qty.oninput = function () { if (m.ticks[k]) m.ticks[k].qty = qty.value; };
          det.appendChild(row);
        });
        cats.appendChild(det);
      });
      box.appendChild(cats);
      // own components
      var dl = el('datalist', { id: 'tl-cats-' + mi }, Object.keys(list).concat(['Other']).map(function (c) { return el('option', { value: c }); }));
      var own = el('div', { style: 'margin-top:.6rem' }, [dl, el('div', { style: 'font-weight:700;font-size:.82rem', text: 'Components added by hand' })]);
      m.custom.forEach(function (c, ci) {
        var cat = el('input', { list: 'tl-cats-' + mi, placeholder: 'Category', value: c.category, 'data-ck': 'category' }); cat.oninput = function () { c.category = cat.value; };
        var it = el('input', { placeholder: 'Component / item (e.g. BT40 ER32 holder 100 L)', value: c.item, 'data-ck': 'item' }); it.oninput = function () { c.item = it.value; };
        var q2 = el('input', { type: 'number', min: '0', step: 'any', placeholder: 'qty', value: c.qty, 'data-ck': 'qty' }); q2.oninput = function () { c.qty = q2.value; };
        own.appendChild(el('div', { class: 'tl-cust' }, [cat, it, q2, el('button', { class: 'tl-btn sm red', type: 'button', text: '✕', title: 'Remove', onclick: function () { m.custom.splice(ci, 1); draw(); } })]));
      });
      own.appendChild(el('button', { class: 'tl-btn sm', type: 'button', 'data-add-comp': String(mi), style: 'margin-top:.4rem', text: '+ Add component', onclick: function () { m.custom.push({ category: '', item: '', qty: '1' }); draw(); var r = box.querySelectorAll('[data-ck=item]'); if (r.length) r[r.length - 1].focus(); } }));
      box.appendChild(own);
      return box;
    }
    function body(submit) {
      return {
        type: S.type, customerId: F.customerId, customerName: F.customerName, title: F.title, notes: F.notes, submit: submit,
        machines: F.machines.map(function (m) {
          var items = [];
          Object.keys(m.ticks).forEach(function (k) { var p = k.split('||'); items.push({ category: p[0], item: p[1], quantity: m.ticks[k].qty, id: m.ticks[k].id || '' }); });
          m.custom.forEach(function (c) { if ((c.item || '').trim()) items.push({ category: c.category || 'Other', item: c.item, quantity: c.qty, custom: true, id: c.id || '' }); });
          return { machineType: m.machineType, machineOther: m.machineOther, make: m.make, count: m.count, items: items };
        })
      };
    }
    function save(btn, submit) {
      if (!F.customerName) { toast('Pick the customer.', 'err'); document.getElementById('tl-customer').focus(); return; }
      btn.disabled = true;
      (F.id ? api('PUT', '/tooling/' + F.id, body(submit)) : api('POST', '/tooling', body(submit))).then(function (j) {
        toast(j.message); F.id = j.data.request.id;
        if (submit) view(j.data.request); else { q = j.data.request; F.machines = q.machines.map(fromServer); draw(); try { history.replaceState(null, '', '#' + F.id); } catch (e) {} }
      }).catch(function (e) { toast(e.message, 'err'); btn.disabled = false; });
    }
    draw();
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
      if (q.adminNote) card.appendChild(el('div', { style: 'margin:.4rem 0;font-size:.85rem;color:#475569', text: 'Admin note: ' + q.adminNote }));
      if (q.requestNo) card.appendChild(el('div', { class: 'tl-sub', style: 'margin:.4rem 0', html: null }, ['To quote: open ', el('a', { href: '/quotations/', text: 'Quotations' }), ', enter ', el('b', { text: q.requestNo }), ' in the "Price request / approval no." box and press "Load approved prices" — every item comes in with its price and discount.']));
      if (q.status === 'NEGOTIATION') card.appendChild(el('div', { class: 'tl-sub', style: 'color:#7c3aed;font-weight:600;margin:.3rem 0', text: q.proposals + ' new price(s) proposed by the engineer — ' + (S.isAdmin ? 'check them below and approve or turn down.' : 'waiting for the admin.') }));
      var edit = pricing || nego;
      q.machines.forEach(function (m) {
        card.appendChild(el('h2', { style: 'margin:1rem 0 .4rem;font-size:.95rem', text: '🛠 ' + m.label }));
        var rows = m.items.map(function (it) {
          var tds = [el('td', { class: 'tl-sub', text: it.category || '' }), el('td', {}, [el('b', { text: it.item }), it.custom ? el('span', { class: 'tl-sub', text: ' (added)' }) : null])];
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
