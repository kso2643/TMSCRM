/* ══════════════════════════════════════════════════════════════════════
   MD desk — direct line between the Super Admin (MD) and the Admins.

   Send a direct message, an important task (priority + due date), a price
   given to a customer, or a new quotation given — to one Admin / Super
   Admin or to all of them. Each item has a reply thread and is marked
   done when handled. New items, replies and "done" also arrive as alerts.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  function api(method, path, body) {
    var opt = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
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
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function when(s) {
    var d = new Date(String(s || '').replace(' ', 'T')); if (isNaN(d)) return '';
    var t = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    return (diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })) + ' · ' + t;
  }
  function today() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function toast(msg, kind) {
    document.querySelectorAll('.md-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'md-toast' + (kind === 'err' ? ' err' : ''), text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }

  var TYPES = {
    MESSAGE:   { icon: '💬', label: 'Message',          c: '#2563eb' },
    TASK:      { icon: '📌', label: 'Important task',   c: '#b45309' },
    PRICE:     { icon: '₹',  label: 'Price given',      c: '#0f766e' },
    QUOTATION: { icon: '📄', label: 'New quotation',    c: '#7c3aed' }
  };
  var PRIO = { URGENT: ['Urgent', '#dc2626'], HIGH: ['High', '#d97706'], NORMAL: ['Normal', '#64748b'] };
  var STATUS = { OPEN: ['New', '#2563eb'], SEEN: ['Seen', '#64748b'], DONE: ['Done', '#16a34a'] };

  function injectCss() {
    if (document.getElementById('md-css')) return;
    var st = document.createElement('style'); st.id = 'md-css';
    st.textContent = [
      '.md-wrap{max-width:1300px;margin:0 auto}',
      '.md-head h1{font-size:1.35rem;font-weight:700;margin:0}.md-head p{margin:.15rem 0 1rem;color:#64748b;font-size:.85rem}',
      '.md-cols{display:grid;grid-template-columns:400px minmax(0,1fr);gap:1rem;align-items:start}@media (max-width:980px){.md-cols{grid-template-columns:1fr}}',
      '.md-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .md-card{background:#1e293b;border-color:#334155}',
      '.md-card h2{font-size:1rem;font-weight:700;margin:0 0 .7rem}',
      '.md-types{display:grid;grid-template-columns:repeat(2,1fr);gap:.4rem;margin-bottom:.7rem}',
      '.md-type{display:flex;align-items:center;gap:.45rem;padding:.55rem .6rem;border:1px solid #e2e8f0;border-radius:.6rem;background:#fff;cursor:pointer;font-size:.84rem;font-weight:600;color:#334155;text-align:left}',
      '.md-type .i{width:1.6rem;height:1.6rem;border-radius:.45rem;display:flex;align-items:center;justify-content:center;font-size:.9rem;color:#fff;background:var(--c);flex:none}',
      '.md-type.on{border-color:var(--c);box-shadow:0 0 0 2px color-mix(in srgb,var(--c) 25%,transparent);background:color-mix(in srgb,var(--c) 6%,#fff)}',
      '.dark .md-type{background:#0f172a;border-color:#334155;color:#e2e8f0}',
      '.md-grid{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.md-f.w{grid-column:1/-1}',
      '.md-f label{display:block;font-size:.73rem;font-weight:600;color:#475569;margin-bottom:.2rem}.dark .md-f label{color:#94a3b8}',
      '.md-f input,.md-f select,.md-f textarea,.md-bar select,.md-bar input{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.86rem;background:#fff;color:inherit;font-family:inherit}',
      '.dark .md-f input,.dark .md-f select,.dark .md-f textarea,.dark .md-bar select,.dark .md-bar input{background:#0f172a;border-color:#334155}',
      '.md-f textarea{min-height:70px;resize:vertical}',
      '.md-btn{display:inline-flex;align-items:center;gap:.35rem;border-radius:.55rem;padding:.5rem .95rem;font-size:.85rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.md-btn:hover{background:#f1f5f9}.md-btn:disabled{opacity:.55;cursor:default}.md-btn.sm{padding:.25rem .6rem;font-size:.76rem}',
      '.md-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.md-btn.pri:hover{background:#1e40af}.md-btn.grn{background:#0f766e;border-color:#0f766e;color:#fff}',
      '.md-btn.red{color:#b91c1c;border-color:#fecaca}.dark .md-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .md-btn.pri{background:#2563eb}.dark .md-btn.grn{background:#0d9488}',
      '.md-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;margin-bottom:.7rem;overflow-x:auto}.dark .md-tabs{border-color:#334155}',
      '.md-tab{padding:.5rem .9rem;font-size:.88rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.md-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .md-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.md-tab .n{display:inline-block;min-width:1.2rem;padding:0 .35rem;margin-left:.3rem;border-radius:999px;background:#dc2626;color:#fff;font-size:.7rem;line-height:1.2rem;text-align:center}',
      '.md-bar{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.7rem}.md-bar select,.md-bar input{width:auto;min-width:130px}.md-bar input{flex:1}',
      '.md-list{display:flex;flex-direction:column;gap:.5rem}',
      '.md-item{display:grid;grid-template-columns:2.2rem minmax(0,1fr) auto;gap:.7rem;align-items:start;padding:.75rem;border:1px solid #e2e8f0;border-left:4px solid var(--c);border-radius:.7rem;background:#fff;cursor:pointer;text-align:left;width:100%;color:inherit}',
      '.md-item:hover{background:#f8fafc}.md-item.unread{background:#eff6ff}.md-item.done{opacity:.7}.dark .md-item{background:#0f172a;border-color:#334155;border-left-color:var(--c)}.dark .md-item.unread{background:#1e3a8a33}',
      '.md-item .i{width:2.2rem;height:2.2rem;border-radius:.6rem;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--c);font-weight:700}',
      '.md-item b{display:block;font-size:.92rem;line-height:1.3}.md-item .s{font-size:.78rem;color:#64748b;margin-top:.15rem}.md-item .x{font-size:.82rem;color:#334155;margin-top:.3rem}.dark .md-item .x{color:#cbd5e1}',
      '.md-item .r{display:flex;flex-direction:column;align-items:flex-end;gap:.25rem;font-size:.74rem;color:#64748b;white-space:nowrap}',
      '.md-badge{display:inline-block;padding:.08rem .5rem;border-radius:999px;font-size:.72rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);white-space:nowrap}',
      '.md-empty{padding:2rem 1rem;text-align:center;color:#64748b;font-size:.9rem}',
      '.md-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:5vh 1rem;overflow:auto}',
      '.md-dlg{background:#fff;border-radius:1rem;max-width:720px;width:100%;padding:1.2rem;box-shadow:0 20px 50px rgba(0,0,0,.3)}.dark .md-dlg{background:#1e293b}',
      '.md-dlg h3{margin:0;font-size:1.15rem}.md-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.5rem;margin:.8rem 0;padding:.7rem;border-radius:.6rem;background:#f8fafc}.dark .md-facts{background:#0f172a}',
      '.md-facts div{font-size:.84rem}.md-facts span{display:block;font-size:.7rem;color:#64748b;text-transform:uppercase;letter-spacing:.03em}',
      '.md-body{white-space:pre-wrap;font-size:.9rem;margin:.6rem 0}',
      '.md-thread{display:flex;flex-direction:column;gap:.45rem;margin:.8rem 0;max-height:40vh;overflow:auto}',
      '.md-msg{max-width:85%;padding:.5rem .7rem;border-radius:.7rem;background:#f1f5f9;font-size:.86rem}.md-msg.me{align-self:flex-end;background:#dbeafe}.dark .md-msg{background:#0f172a}.dark .md-msg.me{background:#1e3a8a}',
      '.md-msg .w{font-size:.7rem;color:#64748b;margin-bottom:.15rem}.md-msg .t{white-space:pre-wrap}',
      '.md-acts{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end;margin-top:.7rem}',
      '.md-qs{position:relative}.md-sugg{position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #cbd5e1;border-radius:.5rem;box-shadow:0 10px 28px rgba(0,0,0,.18);max-height:240px;overflow:auto}',
      '.md-sugg button{display:block;width:100%;text-align:left;border:0;background:none;padding:.45rem .6rem;cursor:pointer;font-size:.82rem;color:#0f172a}.md-sugg button:hover{background:#eff6ff}.md-sugg small{color:#64748b}',
      '.dark .md-sugg{background:#1e293b;border-color:#334155}.dark .md-sugg button{color:#e2e8f0}',
      '.md-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s;max-width:90vw}',
      '.md-toast.in{opacity:1;transform:translate(-50%,0)}.md-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var state = { items: [], users: [], tab: 'inbox', type: '', status: 'OPEN', q: '', compose: 'MESSAGE', role: me().role, me: me().id };
  var root, listBox, tabsBox, formBox, timer;

  // ── compose ─────────────────────────────────────────────────────────
  function field(label, input, wide) { return el('div', { class: 'md-f' + (wide ? ' w' : '') }, [el('label', { text: label }), input]); }
  function renderForm() {
    clear(formBox);
    var t = state.compose;
    formBox.appendChild(el('h2', { text: state.canGroups ? 'Send to staff' : 'Send to MD / admin' }));
    formBox.appendChild(el('div', { class: 'md-types' }, Object.keys(TYPES).map(function (k) {
      return el('button', { type: 'button', class: 'md-type' + (k === t ? ' on' : ''), style: '--c:' + TYPES[k].c, 'data-type': k, onclick: function () { state.compose = k; renderForm(); } },
        [el('span', { class: 'i', text: TYPES[k].icon }), TYPES[k].label]);
    })));
    // Everyone in the company, grouped by role (Admins also get "All admins" / "Everyone").
    var to = el('select', { id: 'md-to' });
    if (state.canGroups) {
      to.appendChild(el('optgroup', { label: 'Groups' }, [el('option', { value: '__ADMINS', text: 'All admins' }), el('option', { value: '__EVERYONE', text: 'Everyone (all users)' })]));
    } else to.appendChild(el('option', { value: '', text: 'Choose…' }));
    var ROLE_GROUP = { SUPER_ADMIN: 'MD / Super Admin', ADMIN: 'Admins', MANAGER: 'Managers', ACCOUNTS: 'Accounts', SALES_ENGINEER: 'Sales engineers', SALES: 'Sales' };
    Object.keys(ROLE_GROUP).forEach(function (r) {
      var us = state.users.filter(function (u) { return u.role === r; });
      if (us.length) to.appendChild(el('optgroup', { label: ROLE_GROUP[r] }, us.map(function (u) { return el('option', { value: u.id, text: u.name + (u.department ? ' · ' + u.department : '') }); })));
    });
    if (state.toPick) { to.value = state.toPick; state.toPick = null; }
    var prio = el('select', { id: 'md-prio' }, ['NORMAL', 'HIGH', 'URGENT'].map(function (p) { return el('option', { value: p, text: PRIO[p][0] }); }));
    var g = el('div', { class: 'md-grid' }, [field('To', to), field('Priority', prio)]);
    var inp = {};
    function add(key, label, attrs, wide) {
      attrs = attrs || {}; attrs.id = 'md-' + key;
      inp[key] = attrs.tag === 'textarea' ? el('textarea', attrs) : el('input', attrs);
      g.appendChild(field(label, inp[key], wide));
      return inp[key];
    }
    if (t === 'MESSAGE') {
      add('title', 'Subject (optional)', { placeholder: 'e.g. Sakthi Auto payment follow-up' }, true);
      add('details', 'Message', { tag: 'textarea', placeholder: 'Write your message…', rows: 4 }, true);
    } else if (t === 'TASK') {
      add('title', 'Task', { placeholder: 'e.g. Collect C-form from Sakthi Auto' }, true);
      add('dueDate', 'Due date', { type: 'date', min: today() });
      add('details', 'Details', { tag: 'textarea', placeholder: 'What exactly needs to be done', rows: 3 }, true);
    } else if (t === 'PRICE') {
      add('customerName', 'Customer', { placeholder: 'Customer name' }, true);
      add('itemCode', 'Item code', { placeholder: 'e.g. CNMG120408' });
      add('productName', 'Product / description', { placeholder: 'e.g. Turning insert' });
      add('price', 'Price given (₹)', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal' });
      add('discount', 'Discount %', { type: 'number', step: '0.01', min: '0', max: '100', inputmode: 'decimal' });
      add('details', 'Notes', { tag: 'textarea', placeholder: 'Validity, quantity, conditions…', rows: 2 }, true);
    } else {
      var pick = el('input', { id: 'md-qpick', placeholder: 'Search a quotation no. or customer…', autocomplete: 'off' });
      var sugg = el('div', { class: 'md-sugg', hidden: true });
      var qs = el('div', { class: 'md-qs' }, [pick, sugg]);
      g.appendChild(field('Pick from Quotations (optional)', qs, true));
      add('quotationNo', 'Quotation no.', { placeholder: 'e.g. TMS/Q/26/101' });
      add('amount', 'Quotation value (₹)', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal' });
      add('customerName', 'Customer', { placeholder: 'Customer name' }, true);
      add('details', 'Notes', { tag: 'textarea', placeholder: 'Items, delivery, terms, follow-up…', rows: 2 }, true);
      var qid = null, tmr;
      pick.addEventListener('input', function () {
        clearTimeout(tmr);
        tmr = setTimeout(function () {
          api('GET', '/md-desk/quotations?q=' + encodeURIComponent(pick.value.trim())).then(function (j) {
            var list = j.data.quotations || [];
            clear(sugg); sugg.hidden = !list.length;
            list.forEach(function (q) {
              sugg.appendChild(el('button', { type: 'button', onclick: function () {
                qid = q.id; inp.quotationNo.value = q.quotationNumber || ''; inp.customerName.value = q.customerName || '';
                inp.amount.value = q.totalAmount != null ? Number(q.totalAmount).toFixed(2) : ''; pick.value = q.quotationNumber; sugg.hidden = true;
              } }, [el('b', { text: q.quotationNumber + ' ' }), (q.customerName || '') + ' ', el('small', { text: money(q.totalAmount) + ' · ' + dmy(q.date) + (q.byName ? ' · ' + q.byName : '') })]));
            });
          }).catch(function () {});
        }, 250);
      });
      pick.addEventListener('focus', function () { pick.dispatchEvent(new Event('input')); });
      document.addEventListener('click', function (e) { if (!qs.contains(e.target)) sugg.hidden = true; });
      inp._qid = function () { return qid; };
    }
    formBox.appendChild(g);
    var send = el('button', { class: 'md-btn pri', type: 'button', id: 'md-send', text: 'Send ' + TYPES[t].label.toLowerCase() });
    send.onclick = function () {
      var body = { type: t, toId: to.value.charAt(0) === '_' ? '' : to.value, toGroup: to.value === '__EVERYONE' ? 'EVERYONE' : 'ADMINS', priority: prio.value };
      if (!to.value) { toast('Pick who to send it to.', 'err'); return; }
      Object.keys(inp).forEach(function (k) { if (k[0] !== '_') body[k] = inp[k].value.trim(); });
      if (inp._qid) body.quotationId = inp._qid();
      send.disabled = true;
      api('POST', '/md-desk', body).then(function (j) {
        toast(j.message || 'Sent'); state.compose = t; renderForm();
        state.tab = 'sent'; state.status = ''; load();
      }).catch(function (e) { toast(e.message, 'err'); send.disabled = false; });
    };
    formBox.appendChild(el('div', { class: 'md-acts' }, [send]));
  }

  function toLabel(i) { return i.toName || (i.toGroup === 'EVERYONE' ? 'everyone' : 'all admins'); }

  // ── list ────────────────────────────────────────────────────────────
  function visibleItems() {
    var q = state.q.toLowerCase();
    return state.items.filter(function (i) {
      if (state.tab === 'inbox' && !i.toMe) return false;
      if (state.tab === 'sent' && !i.mine) return false;
      if (state.type && i.type !== state.type) return false;
      if (state.status === 'OPEN' && i.status === 'DONE') return false;
      if (state.status === 'DONE' && i.status !== 'DONE') return false;
      if (q && [i.title, i.details, i.customerName, i.itemCode, i.productName, i.quotationNo, i.fromName, i.toName].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function renderTabs() {
    clear(tabsBox);
    var unread = state.items.filter(function (i) { return i.unread; }).length;
    var tabs = [['inbox', 'Inbox'], ['sent', 'Sent']];
    if (state.role === 'SUPER_ADMIN') tabs.push(['all', 'All']);
    tabs.forEach(function (t) {
      tabsBox.appendChild(el('button', { type: 'button', class: 'md-tab' + (state.tab === t[0] ? ' on' : ''), 'data-tab': t[0], onclick: function () { state.tab = t[0]; renderList(); } },
        [t[1], t[0] === 'inbox' && unread ? el('span', { class: 'n', text: String(unread) }) : null]));
    });
  }
  function itemLine(i) {
    var T = TYPES[i.type] || TYPES.MESSAGE;
    if (i.type === 'PRICE') return [i.customerName, i.itemCode || i.productName, money(i.price) + (i.discount != null ? ' · ' + Number(i.discount) + '% disc.' : '')].filter(Boolean).join(' · ');
    if (i.type === 'QUOTATION') return [i.quotationNo, i.customerName, i.amount != null ? money(i.amount) : ''].filter(Boolean).join(' · ');
    return (i.details || '').slice(0, 140) || T.label;
  }
  function renderList() {
    renderTabs();
    clear(listBox);
    var list = visibleItems();
    if (!list.length) {
      listBox.appendChild(el('div', { class: 'md-empty', text: state.tab === 'inbox' ? 'Nothing here. Items sent to you will show up here.' : state.tab === 'sent' ? 'You haven’t sent anything yet.' : 'No items.' }));
      return;
    }
    list.forEach(function (i) {
      var T = TYPES[i.type] || TYPES.MESSAGE, P = PRIO[i.priority] || PRIO.NORMAL, S = STATUS[i.status] || STATUS.OPEN;
      var right = el('div', { class: 'r' }, [
        when(i.createdAt),
        el('span', { class: 'md-badge', style: '--c:' + S[1], text: S[0] }),
        i.priority !== 'NORMAL' ? el('span', { class: 'md-badge', style: '--c:' + P[1], text: P[0] }) : null,
        i.type === 'TASK' && i.dueDate ? el('span', { class: 'md-badge', style: '--c:' + (i.overdue ? '#dc2626' : '#475569'), text: (i.overdue ? 'Overdue · ' : 'Due ') + dmy(i.dueDate) }) : null,
        +i.replyCount ? el('span', { text: '💬 ' + i.replyCount }) : null
      ]);
      listBox.appendChild(el('button', { type: 'button', class: 'md-item' + (i.unread ? ' unread' : '') + (i.status === 'DONE' ? ' done' : ''), style: '--c:' + T.c, 'data-item': i.id, onclick: function () { open(i.id); } }, [
        el('span', { class: 'i', text: T.icon }),
        el('div', {}, [
          el('b', { text: i.title }),
          el('div', { class: 's', text: T.label + ' · ' + (i.mine ? 'to ' + toLabel(i) : 'from ' + (i.fromName || '—') + (i.toId ? '' : ' · to ' + toLabel(i))) }),
          el('div', { class: 'x', text: itemLine(i) })
        ]),
        right
      ]));
    });
  }

  // ── detail ──────────────────────────────────────────────────────────
  function open(id) {
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    document.querySelectorAll('.md-modal').forEach(function (m) { m.remove(); });
    var dlg = el('div', { class: 'md-dlg', id: 'md-dlg' }, [el('div', { class: 'md-empty', text: 'Loading…' })]);
    var modal = el('div', { class: 'md-modal' }, [dlg]);
    function close() { modal.remove(); history.replaceState(null, '', location.pathname); load(); }
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.body.appendChild(modal);
    function draw(j) {
      var i = j.data.item, replies = j.data.replies || [];
      var T = TYPES[i.type] || TYPES.MESSAGE, P = PRIO[i.priority] || PRIO.NORMAL, S = STATUS[i.status] || STATUS.OPEN;
      clear(dlg);
      dlg.appendChild(el('div', { style: 'display:flex;gap:.7rem;align-items:flex-start' }, [
        el('span', { style: 'width:2.4rem;height:2.4rem;border-radius:.6rem;display:flex;align-items:center;justify-content:center;color:#fff;background:' + T.c + ';font-weight:700;flex:none', text: T.icon }),
        el('div', { style: 'flex:1;min-width:0' }, [
          el('h3', { text: i.title }),
          el('div', { style: 'font-size:.8rem;color:#64748b;margin-top:.2rem', text: T.label + ' · from ' + (i.fromName || '—') + ' to ' + toLabel(i) + ' · ' + when(i.createdAt) }),
          el('div', { style: 'display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.35rem' }, [
            el('span', { class: 'md-badge', style: '--c:' + S[1], text: S[0] + (i.status === 'DONE' && i.doneByName ? ' by ' + i.doneByName : '') }),
            el('span', { class: 'md-badge', style: '--c:' + P[1], text: P[0] + ' priority' })
          ])
        ]),
        el('button', { class: 'md-btn sm', type: 'button', text: '✕', 'aria-label': 'Close', onclick: close })
      ]));
      var facts = [];
      if (i.type === 'TASK') facts.push(['Due date', i.dueDate ? dmy(i.dueDate) + (i.overdue ? ' (overdue)' : '') : '—']);
      if (i.type === 'PRICE') facts.push(['Customer', i.customerName], ['Item code', i.itemCode || '—'], ['Product', i.productName || '—'], ['Price given', money(i.price)], ['Discount', i.discount != null ? Number(i.discount) + ' %' : '—']);
      if (i.type === 'QUOTATION') facts.push(['Quotation no.', i.quotationNo], ['Customer', i.customerName], ['Value', i.amount != null ? money(i.amount) : '—']);
      if (facts.length) dlg.appendChild(el('div', { class: 'md-facts' }, facts.map(function (f) { return el('div', {}, [el('span', { text: f[0] }), f[1] || '—']); })));
      if (i.details) dlg.appendChild(el('div', { class: 'md-body', text: i.details }));
      var th = el('div', { class: 'md-thread', id: 'md-thread' });
      replies.forEach(function (r) {
        th.appendChild(el('div', { class: 'md-msg' + (r.userId === state.me ? ' me' : '') }, [el('div', { class: 'w', text: (r.userName || '—') + ' · ' + when(r.createdAt) }), el('div', { class: 't', text: r.body })]));
      });
      if (replies.length) dlg.appendChild(el('div', { style: 'font-size:.75rem;font-weight:700;color:#64748b;text-transform:uppercase;margin-top:.6rem', text: 'Replies' }));
      dlg.appendChild(th);
      var ta = el('textarea', { id: 'md-reply', rows: 2, placeholder: 'Write a reply…', style: 'width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font:inherit;font-size:.88rem;background:transparent;color:inherit' });
      var send = el('button', { class: 'md-btn pri', type: 'button', id: 'md-reply-send', text: 'Reply' });
      send.onclick = function () {
        if (!ta.value.trim()) { ta.focus(); return; }
        send.disabled = true;
        api('POST', '/md-desk/' + encodeURIComponent(i.id) + '/reply', { body: ta.value.trim() }).then(draw).catch(function (e) { toast(e.message, 'err'); send.disabled = false; });
      };
      dlg.appendChild(ta);
      var acts = el('div', { class: 'md-acts' });
      if (i.fromId === state.me || state.role === 'SUPER_ADMIN') {
        acts.appendChild(el('button', { class: 'md-btn red', type: 'button', text: 'Delete', onclick: function () {
          if (!confirm('Delete “' + i.title + '”?')) return;
          api('DELETE', '/md-desk/' + encodeURIComponent(i.id)).then(function () { toast('Deleted'); close(); }).catch(function (e) { toast(e.message, 'err'); });
        } }));
      }
      acts.appendChild(el('button', { class: 'md-btn' + (i.status === 'DONE' ? '' : ' grn'), type: 'button', id: 'md-done', text: i.status === 'DONE' ? 'Reopen' : '✓ Mark done', onclick: function () {
        api('PATCH', '/md-desk/' + encodeURIComponent(i.id), { status: i.status === 'DONE' ? 'OPEN' : 'DONE' }).then(function (k) { toast(k.message); return api('GET', '/md-desk/' + encodeURIComponent(i.id)); }).then(draw).catch(function (e) { toast(e.message, 'err'); });
      } }));
      acts.appendChild(send);
      dlg.appendChild(acts);
      th.scrollTop = th.scrollHeight;
    }
    api('GET', '/md-desk/' + encodeURIComponent(id)).then(draw).catch(function (e) { clear(dlg).appendChild(el('div', { class: 'md-empty', text: e.message })); });
  }

  function load() {
    return api('GET', '/md-desk').then(function (j) {
      state.items = j.data.items || []; state.me = j.data.me; state.role = j.data.role;
      renderList();
    }).catch(function (e) { clear(listBox).appendChild(el('div', { class: 'md-empty', text: e.message })); });
  }

  function mountPage(content) {
    injectCss();
    root = el('div', { class: 'md-wrap' });
    root.appendChild(el('div', { class: 'md-head' }, [el('h1', { text: 'MD desk' }),
      el('p', { text: 'Direct line from the MD — messages, important tasks, prices given and new quotations given, to anyone in the company. Replies come back here.' })]));
    formBox = el('div', { class: 'md-card', id: 'md-compose' });
    tabsBox = el('div', { class: 'md-tabs' });
    listBox = el('div', { class: 'md-list', id: 'md-list' });
    var typeSel = el('select', { id: 'md-ftype' }, [el('option', { value: '', text: 'All types' })].concat(Object.keys(TYPES).map(function (k) { return el('option', { value: k, text: TYPES[k].label }); })));
    typeSel.onchange = function () { state.type = typeSel.value; renderList(); };
    var stSel = el('select', { id: 'md-fstatus' }, [['OPEN', 'Open'], ['DONE', 'Done'], ['', 'All']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    stSel.onchange = function () { state.status = stSel.value; renderList(); };
    var search = el('input', { type: 'search', placeholder: 'Search…', id: 'md-search' });
    search.oninput = function () { state.q = search.value.trim(); renderList(); };
    var right = el('div', { class: 'md-card' }, [tabsBox, el('div', { class: 'md-bar' }, [typeSel, stSel, search]), listBox]);
    root.appendChild(el('div', { class: 'md-cols' }, [formBox, right]));
    content.appendChild(root);
    var origRender = renderList;
    renderList = function () { stSel.value = state.status; origRender(); };
    api('GET', '/md-desk/recipients').then(function (j) { state.users = j.data.users || []; state.canGroups = !!j.data.canSendToGroups; renderForm(); }).catch(function () { renderForm(); });
    load().then(function () { var h = location.hash.slice(1); if (h) open(decodeURIComponent(h)); });
    timer = setInterval(function () { if (document.visibilityState === 'visible' && !document.querySelector('.md-modal')) load(); }, 30000);
  }

  window.MdDeskPage = { mountPage: mountPage };
})();
