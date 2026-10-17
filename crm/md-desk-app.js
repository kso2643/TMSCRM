/* ══════════════════════════════════════════════════════════════════════
   CEO Desk (formerly "MD desk") — direct line between the Super Admin (CEO) and the staff.

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
  function upload(path, file) {
    var fd = new FormData(); fd.append('file', file);
    return fetch(API + '/api' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') }, body: fd }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Upload failed (' + r.status + ')'); return j; });
    });
  }
  function fileUrl(itemId, f, dl) { return API + '/api/md-desk/' + encodeURIComponent(itemId) + '/files/' + encodeURIComponent(f.id) + (dl ? '?download=1' : ''); }
  function blobOf(url) {
    return fetch(url, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) { if (!r.ok) throw new Error('Could not load the file (' + r.status + ')'); return r.blob(); });
  }
  function saveBlob(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
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
    PRICE:     { icon: '₹',  label: 'Get price',        c: '#0f766e' },
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
      '.md-cols{display:grid;grid-template-columns:460px minmax(0,1fr);gap:1rem;align-items:start}@media (max-width:980px){.md-cols{grid-template-columns:1fr}}',
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
      '.md-qtiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:.5rem;margin-bottom:.8rem}',
      '.md-qtile{border:1px solid #e2e8f0;border-top:3px solid var(--c);border-radius:.6rem;background:#fff;padding:.5rem .6rem;text-align:left;cursor:pointer;color:inherit}.md-qtile.on{box-shadow:0 0 0 2px var(--c)}',
      '.md-qtile b{display:block;font-size:1.25rem}.md-qtile span{font-size:.76rem;color:#475569;font-weight:600}.md-qtile small{display:block;font-size:.7rem;color:#64748b}',
      '.dark .md-qtile{background:#0f172a;border-color:#334155}',
      '.md-qtable{width:100%;border-collapse:collapse;font-size:.83rem}.md-qtable th{text-align:left;font-size:.7rem;text-transform:uppercase;color:#64748b;padding:.45rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.md-qtable th.md-n{text-align:right}.md-qtable td{padding:.45rem;border-bottom:1px solid #f1f5f9;vertical-align:top}.dark .md-qtable th,.dark .md-qtable td{border-color:#334155}.md-n{text-align:right;white-space:nowrap}.md-sub{color:#64748b;font-size:.75rem}',
      '.md-q-sel{border:1px solid #cbd5e1;border-radius:.4rem;padding:.15rem .3rem;font-size:.76rem;background:#fff;color:inherit}.dark .md-q-sel{background:#0f172a;border-color:#334155}',
      '.md-chips{display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.35rem;min-height:1.6rem;align-items:center}',
      '.md-chip{display:inline-flex;align-items:center;gap:.25rem;background:#dbeafe;color:#1e3a8a;border-radius:999px;padding:.12rem .25rem .12rem .6rem;font-size:.78rem;font-weight:600}.md-chip button{border:0;background:none;cursor:pointer;color:inherit;font-size:1rem;line-height:1;padding:0 .25rem}',
      '.dark .md-chip{background:#1e3a8a;color:#dbeafe}',
      '.md-plist{max-height:210px;overflow:auto;border:1px solid #e2e8f0;border-radius:.5rem;margin-top:.35rem;padding:.25rem .45rem}.dark .md-plist{border-color:#334155}',
      '.md-pgh{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b;font-weight:700;margin:.35rem 0 .1rem;display:flex;gap:.4rem;align-items:center}',
      '.md-f .md-pitem{display:flex;gap:.5rem;align-items:center;font-size:.84rem;font-weight:500;color:inherit;margin:0;padding:.2rem 0;cursor:pointer}.md-pitem input{width:auto!important}.md-pitem small{color:#64748b}',
      '.md-link{border:0;background:none;color:#2563eb;cursor:pointer;font-size:.7rem;text-transform:none;letter-spacing:0;padding:0}',
      '.md-cquotes{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.35rem;align-items:center}',
      '.md-lines{display:flex;flex-direction:column;gap:.4rem;margin-bottom:.4rem}.md-line{border:1px solid #e2e8f0;border-radius:.55rem;padding:.4rem;background:#f8fafc}.dark .md-line{background:#0f172a;border-color:#334155}',
      '.md-l1{display:flex;gap:.35rem;align-items:center}.md-l1>input{flex:1}.md-ln{font-size:.72rem;color:#64748b;font-weight:700;width:1.1rem;text-align:center}',
      '.md-l2{display:grid;grid-template-columns:repeat(4,1fr);gap:.35rem;margin-top:.35rem}.md-l2 label{font-size:.68rem;color:#64748b;font-weight:600;display:flex;flex-direction:column;gap:.1rem}',
      '.md-f .md-line input{padding:.32rem .45rem;font-size:.82rem}.md-net{font-size:.85rem;font-weight:700;color:#0f172a;padding:.32rem 0}.dark .md-net{color:#e2e8f0}',
      '.md-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s;max-width:90vw}',
      '.md-toast.in{opacity:1;transform:translate(-50%,0)}.md-toast.err{background:#b91c1c}',
      '.md-files{display:flex;flex-wrap:wrap;gap:.6rem;margin:.5rem 0}',
      '.md-file{width:132px;border:1px solid #e2e8f0;border-radius:.6rem;background:#fff;overflow:hidden;font-size:.74rem;display:flex;flex-direction:column}.dark .md-file{background:#0f172a;border-color:#334155}',
      '.md-thumb{position:relative;height:92px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-size:2rem;cursor:pointer;border:0;padding:0;width:100%;color:inherit}.dark .md-thumb{background:#1e293b}',
      '.md-thumb img{width:100%;height:100%;object-fit:cover}.md-thumb .eye{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45);color:#fff;font-size:1.5rem;opacity:0;transition:opacity .15s}',
      '.md-thumb:hover .eye,.md-thumb:focus .eye{opacity:1}',
      '.md-file .nm{padding:.3rem .4rem 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}.md-file .ac{display:flex;gap:.2rem;padding:.3rem .4rem .4rem}.md-file .ac button{flex:1;padding:.2rem;font-size:.72rem;justify-content:center}',
      '.md-lb{position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:2147483550;display:flex;flex-direction:column}.md-lb .bar{display:flex;gap:.5rem;align-items:center;padding:.6rem .9rem;color:#fff;font-weight:600}.md-lb .bar b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.md-lb .pic{flex:1;display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto}.md-lb img{max-width:100%;max-height:100%;box-shadow:0 10px 30px rgba(0,0,0,.5);background:#fff}',
      '.md-pend{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.35rem}.md-pend span{display:inline-flex;align-items:center;gap:.3rem;background:#f1f5f9;border-radius:.4rem;padding:.15rem .4rem;font-size:.76rem}.md-pend img{width:28px;height:28px;object-fit:cover;border-radius:.25rem}.dark .md-pend span{background:#0f172a}',
      '.md-gp{width:100%;border-collapse:collapse;font-size:.82rem}.md-gp th{font-size:.68rem;text-transform:uppercase;color:#64748b;text-align:left;padding:.3rem}.md-gp td{padding:.25rem}.md-gp input{width:100%;border:1px solid #cbd5e1;border-radius:.4rem;padding:.3rem .4rem;font-size:.8rem;background:#fff;color:inherit}.dark .md-gp input{background:#0f172a;border-color:#334155}',
      '.md-ppl{display:flex;flex-wrap:wrap;gap:.3rem;margin:.25rem 0}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var state = { items: [], users: [], tab: 'inbox', type: '', status: 'OPEN', q: '', compose: 'MESSAGE', role: me().role, me: me().id };
  var root, listBox, tabsBox, formBox, timer;

  // ── compose ─────────────────────────────────────────────────────────
  function field(label, input, wide) { return el('div', { class: 'md-f' + (wide ? ' w' : '') }, [el('label', { text: label }), input]); }
  /* Who to send to: tick several people (ONE shared task they all see), or — for
     Admins / CEO — a whole group. Picked people show as chips. */
  function recipientPicker() {
    var sel = state.toSel;
    var ROLE_GROUP = { SUPER_ADMIN: 'CEO / Super Admin', ADMIN: 'Admins', MANAGER: 'Managers', ACCOUNTS: 'Accounts', SALES_ENGINEER: 'Sales engineers', SALES: 'Sales' };
    var chips = el('div', { class: 'md-chips', id: 'md-to-chips' });
    var search = el('input', { type: 'search', id: 'md-to-search', placeholder: 'Search people…', autocomplete: 'off' });
    var list = el('div', { class: 'md-plist', id: 'md-to-list' });
    var byId = {}; state.users.forEach(function (u) { byId[u.id] = u; });
    var GROUPS = { __ADMINS: 'All admins', __EVERYONE: 'Everyone (all users)' };
    function drawChips() {
      clear(chips);
      var ks = Object.keys(sel);
      if (!ks.length) chips.appendChild(el('span', { class: 'md-sub', text: 'Nobody picked yet — tick one or more people below.' }));
      ks.forEach(function (k) {
        chips.appendChild(el('span', { class: 'md-chip' }, [GROUPS[k] || (byId[k] ? byId[k].name : k),
          el('button', { type: 'button', 'aria-label': 'Remove', text: '×', onclick: function () { delete sel[k]; draw(); } })]));
      });
    }
    function box(k, label, sub) {
      var cb = el('input', { type: 'checkbox', 'data-to': k });
      cb.checked = !!sel[k];
      cb.onchange = function () {
        if (cb.checked) {
          if (GROUPS[k]) Object.keys(sel).forEach(function (x) { delete sel[x]; });   // a group replaces individual picks
          else { delete sel.__ADMINS; delete sel.__EVERYONE; }
          sel[k] = true;
        } else delete sel[k];
        draw();
      };
      return el('label', { class: 'md-pitem' }, [cb, el('span', {}, [label, sub ? el('small', { text: ' ' + sub }) : null])]);
    }
    function draw() {
      drawChips(); clear(list);
      var q = search.value.trim().toLowerCase();
      if (state.canGroups && !q) list.appendChild(el('div', { class: 'md-pgrp' }, [el('div', { class: 'md-pgh', text: 'Groups' }), box('__ADMINS', 'All admins'), box('__EVERYONE', 'Everyone (all users)')]));
      Object.keys(ROLE_GROUP).forEach(function (r) {
        var us = state.users.filter(function (u) { return u.role === r && (!q || (u.name + ' ' + (u.department || '')).toLowerCase().indexOf(q) !== -1); });
        if (!us.length) return;
        var grp = el('div', { class: 'md-pgrp' }, [el('div', { class: 'md-pgh' }, [ROLE_GROUP[r] + ' ',
          us.length > 1 ? el('button', { type: 'button', class: 'md-link', text: 'pick all', onclick: function () { delete sel.__ADMINS; delete sel.__EVERYONE; us.forEach(function (u) { sel[u.id] = true; }); draw(); } }) : null])]);
        us.forEach(function (u) { grp.appendChild(box(u.id, u.name, u.department || '')); });
        list.appendChild(grp);
      });
    }
    search.oninput = draw;
    draw();
    return el('div', { class: 'md-f w' }, [el('label', { text: 'Assign to (pick one or more — one shared task)' }), chips, search, list]);
  }

  /* Report to: tick any users who should be kept informed (they see the item,
     its replies and when it is done). All users are listed. */
  function reportToPicker() {
    var sel = state.rptSel;
    var chips = el('div', { class: 'md-chips', id: 'md-rpt-chips' });
    var search = el('input', { type: 'search', id: 'md-rpt-search', placeholder: 'Search users…', autocomplete: 'off' });
    var list = el('div', { class: 'md-plist', id: 'md-rpt-list', style: 'max-height:160px' });
    var byId = {}; (state.allUsers || []).forEach(function (u) { byId[u.id] = u; });
    function draw() {
      clear(chips);
      var ks = Object.keys(sel);
      if (!ks.length) chips.appendChild(el('span', { class: 'md-sub', text: 'Optional — tick who this should be reported to.' }));
      ks.forEach(function (k) { chips.appendChild(el('span', { class: 'md-chip', style: 'background:#ede9fe;color:#5b21b6' }, ['📋 ' + (byId[k] ? byId[k].name : k), el('button', { type: 'button', text: '×', 'aria-label': 'Remove', onclick: function () { delete sel[k]; draw(); } })])); });
      clear(list);
      var q = search.value.trim().toLowerCase();
      (state.allUsers || []).filter(function (u) { return !q || u.name.toLowerCase().indexOf(q) !== -1; }).forEach(function (u) {
        var cb = el('input', { type: 'checkbox', 'data-rpt': u.id }); cb.checked = !!sel[u.id];
        cb.onchange = function () { if (cb.checked) sel[u.id] = true; else delete sel[u.id]; draw(); };
        list.appendChild(el('label', { class: 'md-pitem' }, [cb, el('span', {}, [u.name, el('small', { text: ' ' + String(u.role || '').replace('_', ' ').toLowerCase() })])]));
      });
    }
    search.oninput = draw; draw();
    return el('div', { class: 'md-f w' }, [el('label', {}, [el('input', { type: 'checkbox', id: 'md-rpt-on', checked: Object.keys(sel).length ? true : null, style: 'width:auto;margin-right:.35rem;vertical-align:-2px', onchange: function (e) { box.style.display = e.target.checked ? '' : 'none'; if (!e.target.checked) { Object.keys(sel).forEach(function (k) { delete sel[k]; }); draw(); } } }), 'Report to']),
      (function () { box = el('div', { id: 'md-rpt-box', style: Object.keys(sel).length ? '' : 'display:none' }, [chips, search, list]); return box; })()]);
    var box;
  }

  /* Attach files while composing — uploaded right after the item is sent. */
  function attachPicker() {
    var inpF = el('input', { type: 'file', id: 'md-files', multiple: true, accept: 'image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx', style: 'width:100%' });
    var pend = el('div', { class: 'md-pend', id: 'md-pend' });
    function draw() {
      clear(pend);
      state.pendFiles.forEach(function (f, k) {
        var img = /^image\//.test(f.type) ? el('img', { src: URL.createObjectURL(f), alt: '' }) : el('b', { text: /\.pdf$/i.test(f.name) ? '📕' : /\.(xlsx?|csv)$/i.test(f.name) ? '📗' : '📄' });
        pend.appendChild(el('span', {}, [img, f.name, el('button', { type: 'button', class: 'md-link', text: '✕', onclick: function () { state.pendFiles.splice(k, 1); draw(); } })]));
      });
    }
    inpF.onchange = function () { Array.prototype.forEach.call(inpF.files, function (f) { state.pendFiles.push(f); }); inpF.value = ''; draw(); };
    draw();
    return el('div', { class: 'md-f w' }, [el('label', { text: 'Attach screenshot / image / PDF / Excel (optional)' }), inpF, pend]);
  }

  /* Customer box: type to search the customer list; picking one also lists that
     customer's quotations (click one to copy its items, prices and discounts). */
  function customerPicker(ctx, onQuote) {
    var inp = el('input', { id: 'md-customerName', placeholder: 'Search customer…', autocomplete: 'off', value: ctx.customerName || '' });
    var sugg = el('div', { class: 'md-sugg', hidden: true });
    var quotes = el('div', { class: 'md-cquotes', id: 'md-cust-quotes' });
    var t;
    inp.addEventListener('input', function () {
      ctx.customerName = inp.value.trim(); ctx.customerId = null; clear(quotes);
      clearTimeout(t);
      var q = inp.value.trim();
      if (q.length < 2) { sugg.hidden = true; return; }
      t = setTimeout(function () {
        api('GET', '/customers?limit=8&search=' + encodeURIComponent(q)).then(function (j) {
          var list = (j.data && j.data.items) || [];
          clear(sugg); sugg.hidden = !list.length;
          list.forEach(function (c) {
            sugg.appendChild(el('button', { type: 'button', onclick: function () { pickCustomer(c.id, c.companyName); } },
              [el('b', { text: c.companyName }), ' ', el('small', { text: [c.contactPerson, c.location].filter(Boolean).join(' · ') })]));
          });
        }).catch(function () {});
      }, 250);
    });
    function pickCustomer(id, name) {
      ctx.customerId = id; ctx.customerName = name; inp.value = name; sugg.hidden = true;
      clear(quotes).appendChild(el('span', { class: 'md-sub', text: 'Loading quotations…' }));
      api('GET', '/md-desk/quotations?customerId=' + encodeURIComponent(id)).then(function (j) {
        var list = j.data.quotations || [];
        clear(quotes);
        if (!list.length) { quotes.appendChild(el('span', { class: 'md-sub', text: 'No quotations for this customer yet — add the items below.' })); return; }
        quotes.appendChild(el('span', { class: 'md-sub', text: 'Quotations for ' + name + ' — click one to copy its items:' }));
        list.forEach(function (q) {
          quotes.appendChild(el('button', { type: 'button', class: 'md-btn sm', 'data-cq': q.id, onclick: function () { onQuote(q); } },
            [q.quotationNumber + ' · ' + money(q.totalAmount) + ' · ' + dmy(q.date)]));
        });
      }).catch(function () { clear(quotes); });
    }
    document.addEventListener('click', function (e) { if (!inp.parentNode || !inp.parentNode.contains(e.target)) sugg.hidden = true; });
    return el('div', { class: 'md-f w' }, [el('label', { text: 'Customer' }), el('div', { class: 'md-qs' }, [inp, sugg]), quotes]);
  }

  /* Item lines: item code (suggests from products), product, qty, price, discount → net. */
  function linesEditor(ctx) {
    var wrap = el('div', { class: 'md-f w' });
    function blank() { return { itemCode: '', productName: '', quantity: '', price: '', discount: '', supplier: '' }; }
    if (!ctx.lines || !ctx.lines.length) ctx.lines = [blank()];
    function net(l) { var p = parseFloat(l.price), d = parseFloat(l.discount) || 0; return isNaN(p) ? null : Math.round(p * (1 - d / 100) * 100) / 100; }
    function draw() {
      clear(wrap);
      wrap.appendChild(el('label', { text: ctx.getPrice ? 'Items to get the price for — price, discount and supplier can be left blank for the assignee to fill' : 'Items — code, price and discount' }));
      var tb = el('div', { class: 'md-lines', id: 'md-lines' });
      ctx.lines.forEach(function (l, i) {
        var netEl = el('span', { class: 'md-net', text: net(l) == null ? '—' : money(net(l)) });
        function f(key, ph, attrs) {
          var x = el('input', Object.assign({ placeholder: ph, value: l[key] == null ? '' : String(l[key]), 'data-line': String(i), 'data-k': key, autocomplete: 'off' }, attrs || {}));
          x.addEventListener('input', function () { l[key] = x.value; netEl.textContent = net(l) == null ? '—' : money(net(l)); if (ctx.onTotal) ctx.onTotal(); });
          return x;
        }
        var code = f('itemCode', 'Item code'); var prod = f('productName', 'Product / description');
        var sg = el('div', { class: 'md-sugg', hidden: true }), t;
        code.addEventListener('input', function () {
          clearTimeout(t); var q = code.value.trim();
          if (q.length < 2) { sg.hidden = true; return; }
          t = setTimeout(function () {
            api('GET', '/products/search?limit=8&q=' + encodeURIComponent(q)).then(function (j) {
              var list = j.data.results || []; clear(sg); sg.hidden = !list.length;
              list.forEach(function (p) {
                sg.appendChild(el('button', { type: 'button', onmousedown: function (e) {
                  e.preventDefault(); l.itemCode = p.itemCode; l.productName = p.specification || p.productName || '';
                  if ((l.price === '' || l.price == null) && p.price) l.price = p.price;
                  draw();
                } }, [el('b', { text: p.itemCode }), ' ', el('small', { text: [p.specification || p.productName, p.brand].filter(Boolean).join(' · ') })]));
              });
            }).catch(function () {});
          }, 220);
        });
        code.addEventListener('blur', function () { setTimeout(function () { sg.hidden = true; }, 150); });
        tb.appendChild(el('div', { class: 'md-line', 'data-row': String(i) }, [
          el('div', { class: 'md-l1' }, [el('span', { class: 'md-ln', text: String(i + 1) }), el('div', { class: 'md-qs', style: 'flex:0 0 38%' }, [code, sg]), prod,
            el('button', { type: 'button', class: 'md-btn sm red', title: 'Remove item', text: '✕', onclick: function () { ctx.lines.splice(i, 1); if (!ctx.lines.length) ctx.lines.push(blank()); draw(); if (ctx.onTotal) ctx.onTotal(); } })]),
          ctx.getPrice ? el('div', { class: 'md-l2', style: 'grid-template-columns:1fr' }, [el('label', {}, ['Supplier (optional)', f('supplier', 'Supplier / vendor to ask')])]) : null,
          el('div', { class: 'md-l2' }, [
            el('label', {}, ['Qty', f('quantity', 'Qty', { type: 'number', min: '0', step: 'any', inputmode: 'decimal' })]),
            el('label', {}, ['Price ₹', f('price', '0.00', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal' })]),
            el('label', {}, ['Disc %', f('discount', '0', { type: 'number', min: '0', max: '100', step: '0.01', inputmode: 'decimal' })]),
            el('label', {}, ['Net', netEl])
          ])
        ]));
      });
      wrap.appendChild(tb);
      wrap.appendChild(el('button', { type: 'button', class: 'md-btn sm', id: 'md-add-line', text: '+ Add item', onclick: function () { ctx.lines.push(blank()); draw(); var r = wrap.querySelectorAll('[data-k=itemCode]'); r[r.length - 1].focus(); } }));
    }
    ctx.redraw = draw;
    draw();
    return wrap;
  }

  function renderForm() {
    clear(formBox);
    var t = state.compose;
    if (!state.toSel) state.toSel = {};
    if (!state.rptSel) state.rptSel = {};
    if (!state.pendFiles) state.pendFiles = [];
    if (state.toPick) { state.toSel = {}; state.toSel[state.toPick] = true; state.toPick = null; }
    formBox.appendChild(el('h2', { text: state.canGroups ? 'Send to staff' : 'Send to CEO / admin' }));
    formBox.appendChild(el('div', { class: 'md-types' }, Object.keys(TYPES).map(function (k) {
      return el('button', { type: 'button', class: 'md-type' + (k === t ? ' on' : ''), style: '--c:' + TYPES[k].c, 'data-type': k, onclick: function () { state.compose = k; renderForm(); } },
        [el('span', { class: 'i', text: TYPES[k].icon }), TYPES[k].label]);
    })));
    var prio = el('select', { id: 'md-prio' }, ['NORMAL', 'HIGH', 'URGENT'].map(function (p) { return el('option', { value: p, text: PRIO[p][0] }); }));
    var g = el('div', { class: 'md-grid' }, [recipientPicker(), field('Priority', prio)]);
    var inp = {};
    var ctx = { customerName: '', customerId: null, lines: null };
    function add(key, label, attrs, wide) {
      attrs = attrs || {}; attrs.id = 'md-' + key;
      inp[key] = attrs.tag === 'textarea' ? el('textarea', attrs) : el('input', attrs);
      g.appendChild(field(label, inp[key], wide));
      return inp[key];
    }
    var qid = null;
    function copyQuote(q) {
      api('GET', '/md-desk/quotations/' + encodeURIComponent(q.id)).then(function (j) {
        ctx.lines = j.data.items.map(function (x) { return { itemCode: x.itemCode || '', productName: x.productName || '', quantity: x.quantity || '', price: x.price || '', discount: x.discount || '' }; });
        if (!ctx.lines.length) ctx.lines = null;
        qid = q.id;
        if (inp.quotationNo) inp.quotationNo.value = q.quotationNumber || '';
        if (inp.amount) inp.amount.value = q.totalAmount != null ? Number(q.totalAmount).toFixed(2) : '';
        if (!ctx.customerName && q.customerName) { ctx.customerName = q.customerName; var ci = document.getElementById('md-customerName'); if (ci) ci.value = q.customerName; }
        ctx.redraw(); toast('Copied ' + j.data.items.length + ' item(s) from ' + q.quotationNumber);
      }).catch(function (e) { toast(e.message, 'err'); });
    }
    if (t === 'MESSAGE') {
      add('title', 'Subject (optional)', { placeholder: 'e.g. Sakthi Auto payment follow-up' }, true);
      add('details', 'Message', { tag: 'textarea', placeholder: 'Write your message…', rows: 4 }, true);
    } else if (t === 'TASK') {
      add('title', 'Task', { placeholder: 'e.g. Collect C-form from Sakthi Auto' }, true);
      add('dueDate', 'Due date', { type: 'date', min: today() });
      add('details', 'Details', { tag: 'textarea', placeholder: 'What exactly needs to be done', rows: 3 }, true);
    } else if (t === 'PRICE') {
      // Get price: a task to get the price from the supplier
      ctx.getPrice = true;
      add('title', 'Task (optional)', { placeholder: 'e.g. Get price from Sandvik for these inserts' }, true);
      var cp = customerPicker(ctx, copyQuote); cp.querySelector('label').textContent = 'For customer (optional)';
      g.appendChild(cp);
      g.appendChild(linesEditor(ctx));
      add('dueDate', 'Need the price by', { type: 'date', min: today() });
      add('details', 'Notes', { tag: 'textarea', placeholder: 'Quantity, delivery, target price, conditions…', rows: 2 }, true);
    } else {
      g.appendChild(customerPicker(ctx, copyQuote));
      var pick = el('input', { id: 'md-qpick', placeholder: 'Or search any quotation no. / customer…', autocomplete: 'off' });
      var sugg = el('div', { class: 'md-sugg', hidden: true });
      var qs = el('div', { class: 'md-qs' }, [pick, sugg]);
      g.appendChild(field('Pick from Quotations (optional)', qs, true));
      add('quotationNo', 'Quotation no. (optional)', { placeholder: 'blank = a CEO-yymm-nnnn number is given' });
      add('amount', 'Quotation value (₹)', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: 'blank = total of the items' });
      g.appendChild(linesEditor(ctx));
      add('details', 'Notes', { tag: 'textarea', placeholder: 'Delivery, terms, follow-up…', rows: 2 }, true);
      var tmr;
      pick.addEventListener('input', function () {
        clearTimeout(tmr);
        tmr = setTimeout(function () {
          api('GET', '/md-desk/quotations?q=' + encodeURIComponent(pick.value.trim())).then(function (j) {
            var list = j.data.quotations || [];
            clear(sugg); sugg.hidden = !list.length;
            list.forEach(function (q) {
              sugg.appendChild(el('button', { type: 'button', onclick: function () { pick.value = q.quotationNumber; sugg.hidden = true; copyQuote(q); } },
                [el('b', { text: q.quotationNumber + ' ' }), (q.customerName || '') + ' ', el('small', { text: money(q.totalAmount) + ' · ' + dmy(q.date) + (q.byName ? ' · ' + q.byName : '') })]));
            });
          }).catch(function () {});
        }, 250);
      });
      pick.addEventListener('focus', function () { pick.dispatchEvent(new Event('input')); });
      document.addEventListener('click', function (e) { if (!qs.contains(e.target)) sugg.hidden = true; });
    }
    g.appendChild(reportToPicker());
    g.appendChild(attachPicker());
    formBox.appendChild(g);
    var send = el('button', { class: 'md-btn pri', type: 'button', id: 'md-send', text: 'Send ' + TYPES[t].label.toLowerCase() });
    send.onclick = function () {
      var picked = Object.keys(state.toSel);
      if (!picked.length) { toast('Pick who to send it to.', 'err'); return; }
      var grp = picked.filter(function (k) { return k.charAt(0) === '_'; })[0];
      var body = { type: t, toIds: grp ? [] : picked, toGroup: grp === '__EVERYONE' ? 'EVERYONE' : 'ADMINS', priority: prio.value, reportTo: Object.keys(state.rptSel) };
      Object.keys(inp).forEach(function (k) { body[k] = inp[k].value.trim(); });
      if (t === 'PRICE' || t === 'QUOTATION') {
        body.customerName = ctx.customerName || ''; body.customerId = ctx.customerId || '';
        body.items = (ctx.lines || []).filter(function (l) { return String(l.itemCode).trim() || String(l.productName).trim() || String(l.price == null ? '' : l.price).trim(); });
        if (qid) body.quotationId = qid;
      }
      send.disabled = true;
      api('POST', '/md-desk', body).then(function (j) {
        var files = state.pendFiles.slice(), id = j.data.item.id, msg = j.message || 'Sent', bad = 0;
        return files.reduce(function (p, f) { return p.then(function () { return upload('/md-desk/' + encodeURIComponent(id) + '/files', f).catch(function (e) { bad++; toast(f.name + ': ' + e.message, 'err'); }); }); }, Promise.resolve()).then(function () {
          if (!bad) toast(msg + (files.length ? ' · ' + files.length + ' file' + (files.length > 1 ? 's' : '') + ' attached' : ''));
          state.compose = t; state.toSel = {}; state.rptSel = {}; state.pendFiles = []; renderForm();
          state.tab = 'sent'; state.status = ''; load();
        });
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
      if (q && [i.deskNo, i.title, i.details, i.customerName, i.itemCode, i.productName, i.quotationNo, i.fromName, i.toName, (i.items || []).map(function (l) { return [l.itemCode, l.productName, l.supplier].join(' '); }).join(' ')].join(' ').toLowerCase().indexOf(q) === -1) return false;
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
    if (i.type === 'PRICE') {
      var ls = i.items || [], got = ls.filter(function (l) { return l.price != null; }).length;
      return [i.customerName, ls.length > 1 ? ls.length + ' items' : (i.itemCode || i.productName), ls.length ? (got === ls.length ? '✓ all priced' : got + ' of ' + ls.length + ' priced') : (i.price != null ? money(i.price) : 'price pending')].filter(Boolean).join(' · ');
    }
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
        i.dueDate ? el('span', { class: 'md-badge', style: '--c:' + (i.overdue ? '#dc2626' : '#475569'), text: (i.overdue ? 'Overdue · ' : 'Due ') + dmy(i.dueDate) }) : null,
        i.reportToMe && !i.assignedToMe && i.toId !== state.me ? el('span', { class: 'md-badge', style: '--c:#7c3aed', text: '📋 Reported to you' }) : null,
        +i.replyCount || +i.fileCount ? el('span', { text: (+i.replyCount ? '💬 ' + i.replyCount : '') + (+i.fileCount ? '  📎 ' + i.fileCount : '') }) : null
      ]);
      listBox.appendChild(el('button', { type: 'button', class: 'md-item' + (i.unread ? ' unread' : '') + (i.status === 'DONE' ? ' done' : ''), style: '--c:' + T.c, 'data-item': i.id, onclick: function () { open(i.id); } }, [
        el('span', { class: 'i', text: T.icon }),
        el('div', {}, [
          el('b', { text: i.title }),
          el('div', { class: 's', text: (i.deskNo ? i.deskNo + ' · ' : '') + T.label + ' · ' + (i.mine ? 'to ' + toLabel(i) : 'from ' + (i.fromName || '—') + (i.toId ? '' : ' · to ' + toLabel(i))) }),
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
            el('span', { class: 'md-badge', style: '--c:' + P[1], text: P[0] + ' priority' }),
            i.deskNo ? el('button', { type: 'button', class: 'md-badge', 'data-desk-no': i.deskNo, style: '--c:#0f766e;border:0;cursor:pointer', title: 'Copy — type this number on the Quotations page to load the customer and items',
              text: '# ' + i.deskNo + ' ⧉', onclick: function () { try { navigator.clipboard.writeText(i.deskNo); toast('Copied ' + i.deskNo + ' — paste it on the Quotations page'); } catch (e) { prompt('Copy this number:', i.deskNo); } } }) : null
          ])
        ]),
        el('button', { class: 'md-btn sm', type: 'button', text: '✕', 'aria-label': 'Close', onclick: close })
      ]));
      var facts = [];
      if (i.type === 'TASK' || (i.type === 'PRICE' && i.dueDate)) facts.push([i.type === 'PRICE' ? 'Need price by' : 'Due date', i.dueDate ? dmy(i.dueDate) + (i.overdue ? ' (overdue)' : '') : '—']);
      if (i.type === 'PRICE') facts.push(['Customer', i.customerName || '—'], ['Items', String((i.items || []).length || 1)], ['Priced', (i.items || []).filter(function (l) { return l.price != null; }).length + ' of ' + ((i.items || []).length || 1)]);
      if (i.type === 'QUOTATION') facts.push(['CEO Desk no.', i.deskNo || '—'], ['Quotation no.', i.quotationNo || '—'], ['Customer', i.customerName], ['Value', i.amount != null ? money(i.amount) : '—']);
      function ppl(lbl, list, c) {
        return el('div', { style: 'font-size:.8rem;margin-top:.3rem' }, [el('b', { text: lbl + ' ' }), el('span', { class: 'md-ppl', style: 'display:inline-flex' }, list.map(function (u) { return el('span', { class: 'md-chip', style: 'padding-right:.6rem;' + (c || ''), text: u.name }); }))]);
      }
      if (i.assignees && i.assignees.length) dlg.appendChild(ppl('Assigned to (shared task):', i.assignees));
      if (i.reportTo && i.reportTo.length) dlg.appendChild(ppl('📋 Report to:', i.reportTo, 'background:#ede9fe;color:#5b21b6'));
      if (facts.length) dlg.appendChild(el('div', { class: 'md-facts' }, facts.map(function (f) { return el('div', {}, [el('span', { text: f[0] }), f[1] || '—']); })));
      var canWork = state.role === 'SUPER_ADMIN' || state.role === 'ADMIN' || i.fromId === state.me || i.toId === state.me || (i.assignees || []).some(function (u) { return u.id === state.me; });
      if (i.items && i.items.length) {
        var gp = i.type === 'PRICE', itemsBox = el('div', { style: 'overflow-x:auto' });
        var drawItems = function () {
          clear(itemsBox).appendChild(el('table', { class: 'md-qtable', id: 'md-items' }, [
            el('thead', {}, [el('tr', {}, ['#', 'Item code', 'Product', gp ? 'Supplier' : null, 'Qty', 'Price', 'Disc %', 'Net', gp ? 'Lead time' : null].filter(function (h) { return h !== null; }).map(function (h) { return el('th', { class: /Qty|Price|Disc|Net/.test(h) ? 'md-n' : '', text: h }); }))]),
            el('tbody', {}, i.items.map(function (l, k) {
              return el('tr', {}, [el('td', { text: String(k + 1) }), el('td', {}, [el('b', { text: l.itemCode || '—' })]), el('td', { text: l.productName || '' }),
                gp ? el('td', { text: l.supplier || '—' }) : null,
                el('td', { class: 'md-n', text: l.quantity != null ? String(l.quantity) : '—' }), el('td', { class: 'md-n', text: l.price != null ? money(l.price) : (gp ? '⏳ pending' : '—') }),
                el('td', { class: 'md-n', text: l.discount != null ? Number(l.discount) + ' %' : '—' }), el('td', { class: 'md-n' }, [el('b', { text: money(l.net) })]),
                gp ? el('td', { text: l.leadTime || '—' }) : null]);
            }))
          ]));
          if (gp && canWork) itemsBox.appendChild(el('div', { class: 'md-acts', style: 'justify-content:flex-start' }, [el('button', { type: 'button', class: 'md-btn grn sm', id: 'md-fill-prices', text: '💰 Enter supplier prices', onclick: editPrices })]));
          if (i.type === 'QUOTATION' && canWork) itemsBox.appendChild(el('div', { class: 'md-acts', style: 'justify-content:flex-start' }, [
            el('button', { type: 'button', class: 'md-btn sm', id: 'md-edit-items', text: '✎ Edit items', onclick: editQuoteItems }),
            i.deskNo ? el('span', { class: 'md-sub', text: 'On the Quotations page type ' + i.deskNo + ' in "Price request / approval no." to load these items.' }) : null]));
        };
        /* Quotation: change code, product, qty, price, discount; add / remove lines */
        var editQuoteItems = function () {
          var rows = i.items.map(function (l) { return Object.assign({}, l); });
          function draw2() {
            clear(itemsBox);
            function inp(r, k, attrs) { var x = el('input', Object.assign({ value: r[k] == null ? '' : String(r[k]), 'data-qe': k }, attrs || {})); x.oninput = function () { r[k] = x.value; }; return x; }
            itemsBox.appendChild(el('table', { class: 'md-gp', id: 'md-qe' }, [
              el('thead', {}, [el('tr', {}, ['Item code', 'Product', 'Qty', 'Price ₹', 'Disc %', ''].map(function (h) { return el('th', { text: h }); }))]),
              el('tbody', {}, rows.map(function (r, k) {
                return el('tr', {}, [el('td', { style: 'width:130px' }, [inp(r, 'itemCode')]), el('td', {}, [inp(r, 'productName')]),
                  el('td', { style: 'width:70px' }, [inp(r, 'quantity', { type: 'number', min: '0', step: 'any' })]), el('td', { style: 'width:100px' }, [inp(r, 'price', { type: 'number', min: '0', step: '0.01' })]),
                  el('td', { style: 'width:70px' }, [inp(r, 'discount', { type: 'number', min: '0', max: '100', step: '0.01' })]),
                  el('td', {}, [el('button', { type: 'button', class: 'md-btn sm red', text: '✕', onclick: function () { rows.splice(k, 1); draw2(); } })])]);
              }))
            ]));
            var save = el('button', { type: 'button', class: 'md-btn pri sm', id: 'md-qe-save', text: 'Save items' });
            save.onclick = function () {
              save.disabled = true;
              api('PATCH', '/md-desk/' + encodeURIComponent(i.id) + '/items', { items: rows }).then(function (k) { toast('Items saved'); draw(k); }).catch(function (e) { toast(e.message, 'err'); save.disabled = false; });
            };
            itemsBox.appendChild(el('div', { class: 'md-acts', style: 'justify-content:flex-start' }, [
              el('button', { type: 'button', class: 'md-btn sm', text: '+ Add line', onclick: function () { rows.push({ itemCode: '', productName: '', quantity: '', price: '', discount: '' }); draw2(); } }),
              save, el('button', { type: 'button', class: 'md-btn sm', text: 'Cancel', onclick: drawItems })]));
          }
          draw2();
        };
        /* Get price: the assignee types the supplier, price, discount and lead time per line */
        var editPrices = function () {
          var rows = i.items.map(function (l) { return Object.assign({}, l); });
          function inp(r, k, attrs) { var x = el('input', Object.assign({ value: r[k] == null ? '' : String(r[k]), 'data-gp': k }, attrs || {})); x.oninput = function () { r[k] = x.value; }; return x; }
          clear(itemsBox).appendChild(el('table', { class: 'md-gp', id: 'md-gp' }, [
            el('thead', {}, [el('tr', {}, ['Item', 'Supplier', 'Price ₹', 'Disc %', 'Lead time'].map(function (h) { return el('th', { text: h }); }))]),
            el('tbody', {}, rows.map(function (r) {
              return el('tr', {}, [el('td', {}, [el('b', { text: r.itemCode || '' }), el('div', { class: 'md-sub', text: (r.productName || '') + (r.quantity != null ? ' · qty ' + r.quantity : '') })]),
                el('td', {}, [inp(r, 'supplier', { placeholder: 'Supplier' })]), el('td', { style: 'width:100px' }, [inp(r, 'price', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' })]),
                el('td', { style: 'width:80px' }, [inp(r, 'discount', { type: 'number', min: '0', max: '100', step: '0.01', placeholder: '0' })]), el('td', { style: 'width:110px' }, [inp(r, 'leadTime', { placeholder: 'e.g. 2 weeks' })])]);
            }))
          ]));
          var save = el('button', { type: 'button', class: 'md-btn pri sm', id: 'md-gp-save', text: 'Save prices' });
          save.onclick = function () {
            save.disabled = true;
            api('PATCH', '/md-desk/' + encodeURIComponent(i.id) + '/items', { items: rows }).then(function (k) { toast('Prices saved — the sender has been told'); draw(k); }).catch(function (e) { toast(e.message, 'err'); save.disabled = false; });
          };
          itemsBox.appendChild(el('div', { class: 'md-acts', style: 'justify-content:flex-start' }, [save, el('button', { type: 'button', class: 'md-btn sm', text: 'Cancel', onclick: drawItems })]));
        };
        drawItems();
        dlg.appendChild(itemsBox);
      }
      if (i.details) dlg.appendChild(el('div', { class: 'md-body', text: i.details }));
      // attachments: image thumbnails (👁 view, download), PDF viewer, Excel / Word download
      var files = j.data.files || [];
      var fbox = el('div', { class: 'md-files', id: 'md-files-box' });
      files.forEach(function (f) {
        var icon = f.kind === 'PDF' ? '📕' : f.kind === 'EXCEL' ? '📗' : f.kind === 'IMAGE' ? '🖼' : '📄';
        var thumb = el('button', { type: 'button', class: 'md-thumb', 'data-file': f.id, title: 'View ' + f.fileName }, [el('span', { text: icon }), el('span', { class: 'eye', text: '👁' })]);
        if (f.kind === 'IMAGE') blobOf(fileUrl(i.id, f)).then(function (b) { var u = URL.createObjectURL(b); thumb.replaceChild(el('img', { src: u, alt: f.fileName }), thumb.firstChild); f._url = u; }).catch(function () {});
        function view() {
          if (f.kind === 'PDF' && window.PdfView) return PdfView.show(fileUrl(i.id, f), { title: f.fileName, fileName: f.fileName });
          if (f.kind !== 'IMAGE') return download();
          var shown = function (u) {
            var lb = el('div', { class: 'md-lb', id: 'md-lightbox' }, [el('div', { class: 'bar' }, [el('b', { text: f.fileName }),
              el('button', { type: 'button', class: 'md-btn sm', text: '⬇ Download', onclick: download }),
              el('button', { type: 'button', class: 'md-btn sm', text: '✕ Close', onclick: function () { lb.remove(); } })]),
              el('div', { class: 'pic' }, [el('img', { src: u, alt: f.fileName })])]);
            lb.addEventListener('click', function (e) { if (e.target === lb || e.target.className === 'pic') lb.remove(); });
            document.body.appendChild(lb);
          };
          if (f._url) shown(f._url); else blobOf(fileUrl(i.id, f)).then(function (b) { f._url = URL.createObjectURL(b); shown(f._url); }).catch(function (e) { toast(e.message, 'err'); });
        }
        function download() { blobOf(fileUrl(i.id, f, true)).then(function (b) { saveBlob(b, f.fileName); }).catch(function (e) { toast(e.message, 'err'); }); }
        thumb.onclick = view;
        var canDel = f.uploadedById === state.me || i.fromId === state.me || state.role === 'SUPER_ADMIN';
        fbox.appendChild(el('div', { class: 'md-file' }, [thumb, el('div', { class: 'nm', title: f.fileName, text: f.fileName }),
          el('div', { class: 'md-sub', style: 'padding:0 .4rem', text: (f.uploadedByName || '') + ' · ' + Math.max(1, Math.round(f.size / 1024)) + ' KB' }),
          el('div', { class: 'ac' }, [el('button', { type: 'button', class: 'md-btn sm', title: 'View', text: '👁', 'data-view': f.id, onclick: view }),
            el('button', { type: 'button', class: 'md-btn sm', title: 'Download', text: '⬇', 'data-dl': f.id, onclick: download }),
            canDel ? el('button', { type: 'button', class: 'md-btn sm red', title: 'Remove', text: '✕', onclick: function () {
              if (!confirm('Remove ' + f.fileName + '?')) return;
              api('DELETE', '/md-desk/' + encodeURIComponent(i.id) + '/files/' + encodeURIComponent(f.id)).then(function () { return api('GET', '/md-desk/' + encodeURIComponent(i.id)); }).then(draw).catch(function (e) { toast(e.message, 'err'); });
            } }) : null])]));
      });
      var addF = el('input', { type: 'file', id: 'md-dlg-file', multiple: true, accept: 'image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx', style: 'display:none' });
      addF.onchange = function () {
        var fl = Array.prototype.slice.call(addF.files);
        fl.reduce(function (p, f) { return p.then(function () { return upload('/md-desk/' + encodeURIComponent(i.id) + '/files', f); }); }, Promise.resolve())
          .then(function () { toast(fl.length + ' file' + (fl.length > 1 ? 's' : '') + ' attached'); return api('GET', '/md-desk/' + encodeURIComponent(i.id)); }).then(draw).catch(function (e) { toast(e.message, 'err'); });
      };
      dlg.appendChild(el('div', { style: 'display:flex;align-items:center;gap:.5rem;margin-top:.6rem' }, [
        el('span', { style: 'font-size:.75rem;font-weight:700;color:#64748b;text-transform:uppercase', text: 'Attachments' + (files.length ? ' (' + files.length + ')' : '') }),
        el('button', { type: 'button', class: 'md-btn sm', id: 'md-attach', text: '📎 Add screenshot / PDF / Excel', onclick: function () { addF.click(); } }), addF]));
      if (files.length) dlg.appendChild(fbox);
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
      if (state.role === 'SUPER_ADMIN') {   // only the Super Admin deletes CEO Desk items
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
    root.appendChild(el('div', { class: 'md-head' }, [el('h1', { text: 'CEO Desk' }),
      el('p', { text: 'Direct line from the CEO — messages, important tasks, get-price tasks (get the price from the supplier) and quotations, to one or many people as one shared task, with screenshots / PDF / Excel attached. Replies come back here.' })]));
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
    var deskView = el('div', { class: 'md-cols' }, [formBox, right]);
    var quoteView = el('div', { id: 'md-quotes', style: 'display:none' });
    // Desk (messages, tasks…) | Quotations (follow-up status, price negotiation)
    var views = el('div', { class: 'md-tabs', style: 'margin-bottom:1rem' }, [['desk', '📨 Desk'], ['quotes', '📄 Quotations']].map(function (v) {
      return el('button', { type: 'button', class: 'md-tab' + (v[0] === 'desk' ? ' on' : ''), 'data-view': v[0], text: v[1], onclick: function () { showView(v[0]); } });
    }));
    function showView(v) {
      Array.prototype.forEach.call(views.children, function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
      deskView.style.display = v === 'desk' ? '' : 'none'; quoteView.style.display = v === 'quotes' ? '' : 'none';
      if (v === 'quotes') quotesView(quoteView);
      try { history.replaceState(null, '', v === 'quotes' ? '#quotes' : location.pathname); } catch (e) {}
    }
    root.appendChild(views); root.appendChild(deskView); root.appendChild(quoteView);
    content.appendChild(root);
    if (location.hash === '#quotes') setTimeout(function () { showView('quotes'); }, 0);
    var origRender = renderList;
    renderList = function () { stSel.value = state.status; origRender(); };
    api('GET', '/md-desk/recipients').then(function (j) { state.users = j.data.users || []; state.allUsers = j.data.allUsers || state.users; state.canGroups = !!j.data.canSendToGroups; renderForm(); }).catch(function () { renderForm(); });
    load().then(function () { var h = location.hash.slice(1); if (h && h !== 'quotes') open(decodeURIComponent(h)); });
    timer = setInterval(function () { if (document.visibilityState === 'visible' && !document.querySelector('.md-modal')) load(); }, 30000);
  }

  // ── Quotations: every quotation with its follow-up status, engineer / admin wise ──
  var qf = { user: '', status: '', company: '', q: '', by: 'list' };
  function quotesView(host) {
    var QN = window.QuoteNotes;
    clear(host);
    if (!QN) { host.appendChild(el('div', { class: 'md-empty', text: 'Could not load the quotation notes module.' })); return; }
    var tiles = el('div', { class: 'md-qtiles', id: 'md-qtiles' });
    var who = el('select', { id: 'md-q-user' }, [el('option', { value: '', text: 'Everyone (engineers & admins)' })]);
    var co = el('select', { id: 'md-q-co' }, [['', 'TMS & APJ'], ['TMS', 'TMS'], ['APJ', 'APJ']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var q = el('input', { type: 'search', placeholder: 'Search quotation no., customer…', id: 'md-q-search', value: qf.q });
    var by = el('select', { id: 'md-q-by' }, [['list', 'List'], ['person', 'Person-wise summary']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    who.value = qf.user; co.value = qf.company; by.value = qf.by;
    var box = el('div', { id: 'md-q-list' });
    host.appendChild(el('div', { class: 'md-card' }, [tiles, el('div', { class: 'md-bar' }, [who, co, by, q]), box]));
    var t;
    who.onchange = function () { qf.user = who.value; load(); };
    co.onchange = function () { qf.company = co.value; load(); };
    by.onchange = function () { qf.by = by.value; load(); };
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { qf.q = q.value.trim(); load(); }, 250); };
    function load() {
      clear(box).appendChild(el('div', { class: 'md-empty', text: 'Loading…' }));
      var qs = '?status=' + (qf.by === 'person' ? '' : qf.status) + (qf.user ? '&user=' + encodeURIComponent(qf.user) : '') + (qf.company ? '&company=' + qf.company : '') + (qf.q ? '&q=' + encodeURIComponent(qf.q) : '');
      QN.api('GET', '/quote-follow' + qs).then(function (j) {
        var d = j.data;
        if (who.options.length <= 1) d.people.forEach(function (p) { who.appendChild(el('option', { value: p.id, text: p.name + (p.role === 'SUPER_ADMIN' || p.role === 'ADMIN' ? ' (admin)' : '') })); });
        who.value = qf.user; who.style.display = d.seesAll ? '' : 'none';
        clear(tiles);
        var total = Object.keys(d.counts).reduce(function (a, k) { return a + d.counts[k].n; }, 0);
        [['', 'All', '#1e3a8a', total]].concat(Object.keys(QN.STATUS).map(function (k) { return [k, QN.STATUS[k][0], QN.STATUS[k][1], d.counts[k] ? d.counts[k].n : 0, d.counts[k] ? d.counts[k].value : 0]; })).forEach(function (x) {
          tiles.appendChild(el('button', { type: 'button', class: 'md-qtile' + (qf.status === x[0] ? ' on' : ''), style: '--c:' + x[2], 'data-qtile': x[0] || 'ALL', onclick: function () { qf.status = x[0]; if (qf.by === 'person') { qf.by = 'list'; by.value = 'list'; } load(); } },
            [el('b', { text: String(x[3]) }), el('span', { text: x[1] }), x[4] ? el('small', { text: '₹' + Math.round(x[4]).toLocaleString('en-IN') }) : null]));
        });
        clear(box);
        if (!d.items.length) { box.appendChild(el('div', { class: 'md-empty', text: 'No quotations here.' })); return; }
        if (qf.by === 'person') return person(d);
        var tb = el('tbody', {}, d.items.map(function (x) {
          var sel = el('select', { class: 'md-q-sel', 'data-qsel': x.id, title: 'Change status' }, Object.keys(QN.STATUS).map(function (k) { return el('option', { value: k, text: QN.STATUS[k][0] }); }));
          sel.value = x.followStatus;
          sel.onchange = function () {
            var note = '';
            if (sel.value === 'OTHER') { note = prompt('Type the status:', x.followStatus === 'OTHER' ? x.followNote || '' : '') || ''; if (!note.trim()) { sel.value = x.followStatus; return; } }
            QN.api('PATCH', '/quote-follow/' + encodeURIComponent(x.id) + '/status', { status: sel.value, note: note.trim() }).then(function (r) { toast(r.message); load(); }).catch(function (e) { toast(e.message, 'err'); sel.value = x.followStatus; });
          };
          var ln = x.lastNote;
          return el('tr', { 'data-quote': x.id }, [
            el('td', {}, [el('b', { text: x.quotationNumber || '—' }), el('div', { class: 'md-sub', text: x.company + ' · ' + dmy(x.quotationDate) })]),
            el('td', { text: x.customer || '—' }),
            el('td', {}, [x.user.name || '—', x.user.role === 'SUPER_ADMIN' || x.user.role === 'ADMIN' ? el('span', { class: 'md-badge', style: '--c:#7c3aed;margin-left:.3rem', text: 'admin' }) : null]),
            el('td', { class: 'md-n', text: money(x.totalAmount) }),
            el('td', {}, [QN.badge(x.followStatus, x.followNote), el('div', { style: 'margin-top:.25rem' }, [sel])]),
            el('td', { class: 'md-sub', style: 'max-width:280px' }, ln ? [ln.newPrice != null ? el('b', { style: 'color:#0f172a', text: (ln.itemCode ? ln.itemCode + ' ' : '') + (ln.oldPrice != null ? money(ln.oldPrice) + ' → ' : '') + money(ln.newPrice) + ' ' }) : null, (ln.text || '').slice(0, 90), el('div', { text: (ln.user || '') + ' · ' + when(ln.createdAt) })] : ['—']),
            el('td', {}, [el('button', { class: 'md-btn sm', type: 'button', 'data-qnotes': x.id, text: '💬 Notes' + (x.noteCount ? ' (' + x.noteCount + ')' : ''), onclick: function () { QN.open(x.id, { onChange: load }); } })])
          ]);
        }));
        box.appendChild(el('div', { style: 'overflow-x:auto' }, [el('table', { class: 'md-qtable', id: 'md-q-table' }, [el('thead', {}, [el('tr', {}, ['Quotation', 'Customer', 'Engineer / admin', 'Value', 'Status', 'Latest note / price', ''].map(function (h, i) { return el('th', { class: i === 3 ? 'md-n' : '', text: h }); }))]), tb])]));
      }).catch(function (e) { clear(box).appendChild(el('div', { class: 'md-empty', text: e.message })); });
    }
    function person(d) {
      var by = {};
      d.items.forEach(function (x) { var k = x.user.id; by[k] = by[k] || { name: x.user.name, role: x.user.role, n: 0, value: 0, st: {} }; by[k].n++; by[k].value += x.totalAmount; by[k].st[x.followStatus] = (by[k].st[x.followStatus] || 0) + 1; });
      var keys = Object.keys(QN.STATUS);
      var tb = el('tbody', {}, Object.keys(by).sort(function (a, b) { return by[b].n - by[a].n; }).map(function (k) {
        var p = by[k];
        return el('tr', {}, [el('td', {}, [el('b', { text: p.name || '—' }), p.role === 'SUPER_ADMIN' || p.role === 'ADMIN' ? el('span', { class: 'md-badge', style: '--c:#7c3aed;margin-left:.3rem', text: 'admin' }) : null]),
          el('td', { class: 'md-n', text: String(p.n) }), el('td', { class: 'md-n', text: money(p.value) })]
          .concat(keys.map(function (s) { return el('td', { class: 'md-n' }, [p.st[s] ? el('button', { type: 'button', class: 'md-btn sm', text: String(p.st[s]), onclick: function () { qf.user = k; qf.status = s; qf.by = 'list'; quotesView(host); } }) : el('span', { class: 'md-sub', text: '—' })]); })));
      }));
      box.appendChild(el('div', { style: 'overflow-x:auto' }, [el('table', { class: 'md-qtable', id: 'md-q-person' }, [el('thead', {}, [el('tr', {}, ['Engineer / admin', 'Quotations', 'Value'].concat(keys.map(function (s) { return QN.STATUS[s][0]; })).map(function (h, i) { return el('th', { class: i ? 'md-n' : '', text: h }); }))]), tb])]));
    }
    load();
  }

  window.MdDeskPage = { mountPage: mountPage };
})();
