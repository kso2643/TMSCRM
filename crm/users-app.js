/* ══════════════════════════════════════════════════════════════════════
   Users (Admin / Super Admin): add a user, edit (name, email, role, phone,
   department, designation, employee code), reset password, lock / unlock,
   deactivate / reactivate and delete.

   Delete removes the account for good. Someone who already has quotations,
   meetings, attendance… is "removed" instead: they can no longer log in and
   are hidden from the list, while those records keep their name ("Removed"
   filter shows them, and Reactivate brings them back).
   Only the Super Admin can change or remove a Super Admin.
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
  function when(s) {
    if (!s) return 'Never';
    var d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function toast(msg, kind) {
    document.querySelectorAll('.us-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'us-toast' + (kind === 'err' ? ' err' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, kind === 'err' ? 6000 : 5000);
  }
  var ROLES = { SUPER_ADMIN: ['Super Admin (CEO)', '#7c3aed'], ADMIN: ['Admin', '#2563eb'], MANAGER: ['Manager', '#0891b2'], ACCOUNTS: ['Accounts', '#b45309'], SALES_ENGINEER: ['Sales engineer', '#0f766e'], SALES: ['Sales', '#16a34a'] };

  function css() {
    if (document.getElementById('us-css')) return;
    var st = document.createElement('style'); st.id = 'us-css';
    st.textContent = [
      '.us-wrap{max-width:1300px;margin:0 auto}',
      '.us-head{display:flex;flex-wrap:wrap;gap:.7rem;align-items:flex-end;justify-content:space-between;margin-bottom:1rem}.us-head h1{font-size:1.35rem;font-weight:700;margin:0}.us-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.us-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem}.dark .us-card{background:#1e293b;border-color:#334155}',
      '.us-bar{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.8rem}.us-bar input,.us-bar select{border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.86rem;background:#fff;color:inherit}.us-bar input{flex:1;min-width:200px}',
      '.dark .us-bar input,.dark .us-bar select{background:#0f172a;border-color:#334155}',
      '.us-btn{display:inline-flex;align-items:center;gap:.3rem;border-radius:.55rem;padding:.5rem .95rem;font-size:.85rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.us-btn:hover{background:#f1f5f9}.us-btn.sm{padding:.25rem .55rem;font-size:.76rem}.us-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.us-btn.red{color:#b91c1c;border-color:#fecaca}.us-btn.grn{color:#0f766e;border-color:#99f6e4}',
      '.us-btn:disabled{opacity:.5;cursor:default}.dark .us-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .us-btn.pri{background:#2563eb}',
      '.us-t{width:100%;border-collapse:collapse;font-size:.85rem}.us-t th{text-align:left;font-size:.7rem;text-transform:uppercase;color:#64748b;padding:.5rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.us-t td{padding:.55rem .5rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.dark .us-t th,.dark .us-t td{border-color:#334155}.us-t tr.off td{opacity:.6}',
      '.us-av{width:2.1rem;height:2.1rem;border-radius:999px;background:#dbeafe;color:#1e3a8a;display:inline-flex;align-items:center;justify-content:center;font-weight:700;margin-right:.55rem;flex:none}',
      '.us-nm{display:flex;align-items:center}.us-nm b{display:block}.us-nm small{color:#64748b}',
      '.us-badge{display:inline-block;padding:.08rem .5rem;border-radius:999px;font-size:.72rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);white-space:nowrap}',
      '.us-acts{display:flex;flex-wrap:wrap;gap:.3rem;justify-content:flex-end}',
      '.us-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:6vh 1rem;overflow:auto}',
      '.us-dlg{background:#fff;border-radius:1rem;max-width:620px;width:100%;padding:1.2rem;box-shadow:0 20px 50px rgba(0,0,0,.3)}.dark .us-dlg{background:#1e293b}.us-dlg h3{margin:0 0 .8rem;font-size:1.1rem}',
      '.us-g{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.us-g .w{grid-column:1/-1}@media (max-width:560px){.us-g{grid-template-columns:1fr}}',
      '.us-g label{display:block;font-size:.73rem;font-weight:600;color:#475569;margin-bottom:.2rem}.us-g input,.us-g select{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.88rem;background:#fff;color:inherit}',
      '.dark .us-g input,.dark .us-g select{background:#0f172a;border-color:#334155}.us-err{color:#b91c1c;font-size:.82rem;min-height:1.1rem;margin-top:.5rem}',
      '.us-foot{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.9rem}',
      '.us-empty{padding:2rem 1rem;text-align:center;color:#64748b}',
      '.us-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s;max-width:90vw}',
      '.us-toast.in{opacity:1;transform:translate(-50%,0)}.us-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var F = { q: '', role: '', status: 'active' };
  var body, me0 = me(), isSuper = me0.role === 'SUPER_ADMIN';

  function load() {
    clear(body).appendChild(el('div', { class: 'us-empty', text: 'Loading…' }));
    var qs = '?limit=500' + (F.q ? '&search=' + encodeURIComponent(F.q) : '') + (F.role ? '&role=' + F.role : '') +
      (F.status === 'active' ? '&isActive=true' : F.status === 'inactive' ? '&isActive=false' : F.status === 'removed' ? '&removed=1' : '');
    api('GET', '/users' + qs).then(function (j) { draw(j.data.items || []); }).catch(function (e) { clear(body).appendChild(el('div', { class: 'us-empty', text: e.message })); });
  }
  function canTouch(u) { return isSuper || u.role !== 'SUPER_ADMIN'; }
  function draw(users) {
    clear(body);
    if (!users.length) { body.appendChild(el('div', { class: 'us-empty', text: F.status === 'removed' ? 'No removed users.' : 'No users match.' })); return; }
    var tb = el('tbody', {}, users.map(function (u) {
      var R = ROLES[u.role] || [u.role, '#64748b'], self = u.id === me0.id, ok = canTouch(u);
      var st = F.status === 'removed' ? ['Removed', '#64748b'] : !u.isActive ? ['Deactivated', '#64748b'] : u.isLocked ? ['Locked', '#dc2626'] : ['Active', '#16a34a'];
      var acts = el('div', { class: 'us-acts' });
      function b(txt, cls, fn, title) { acts.appendChild(el('button', { type: 'button', class: 'us-btn sm ' + (cls || ''), 'data-act': txt.toLowerCase().replace(/[^a-z]+/g, '-'), title: title || null, text: txt, onclick: fn })); }
      if (ok) {
        if (F.status !== 'removed') {
          b('Edit', '', function () { form(u); });
          b('Reset password', '', function () { resetPw(u); });
          if (isSuper && u.role !== 'SUPER_ADMIN') b('Page access', '', function () { pageAccess(u); }, 'Which pages this user can see, edit or delete on');
          if (!self && u.isActive) b(u.isLocked ? 'Unlock' : 'Lock', '', function () { act('PATCH', '/users/' + u.id + '/toggle-lock'); });
          if (!self) b(u.isActive ? 'Deactivate' : 'Reactivate', u.isActive ? '' : 'grn', function () {
            if (u.isActive) { if (confirm('Deactivate ' + u.name + '? They will not be able to log in until reactivated.')) act('DELETE', '/users/' + u.id); }
            else act('PATCH', '/users/' + u.id + '/reactivate');
          });
          if (!self) b('Delete', 'red', function () { del(u); });
        } else b('Restore', 'grn', function () { act('PATCH', '/users/' + u.id + '/reactivate'); });
      } else acts.appendChild(el('span', { style: 'font-size:.75rem;color:#64748b', text: 'Super Admin only' }));
      return el('tr', { 'data-user': u.id, class: u.isActive ? '' : 'off' }, [
        el('td', {}, [el('div', { class: 'us-nm' }, [el('span', { class: 'us-av', text: (u.name || '?').trim().charAt(0).toUpperCase() }), el('div', {}, [el('b', { text: u.name + (self ? ' (you)' : '') }), el('small', { text: u.email })])])]),
        el('td', {}, [el('span', { class: 'us-badge', style: '--c:' + R[1], text: R[0] })]),
        el('td', { text: [u.department, u.designation].filter(Boolean).join(' · ') || '—' }),
        el('td', { text: u.phone || '—' }),
        el('td', {}, [el('span', { class: 'us-badge', style: '--c:' + st[1], text: st[0] })]),
        el('td', { style: 'white-space:nowrap;font-size:.8rem;color:#64748b', text: when(u.lastLoginAt) }),
        el('td', {}, [acts])
      ]);
    }));
    body.appendChild(el('div', { style: 'overflow-x:auto' }, [el('table', { class: 'us-t', id: 'us-table' }, [
      el('thead', {}, [el('tr', {}, ['Name', 'Role', 'Department', 'Phone', 'Status', 'Last login', ''].map(function (h) { return el('th', { text: h }); }))]), tb])]));
    body.appendChild(el('div', { style: 'font-size:.78rem;color:#64748b;margin-top:.6rem', text: users.length + ' user' + (users.length === 1 ? '' : 's') }));
  }
  function act(m, path) { api(m, path).then(function (j) { toast(j.message || 'Done'); load(); }).catch(function (e) { toast(e.message, 'err'); }); }
  function del(u) {
    if (!confirm('Delete ' + u.name + ' (' + u.email + ') permanently?\n\nIf they already have quotations, meetings, attendance or other records, the account is removed instead: it can no longer log in and is hidden here, but those records keep their name.')) return;
    api('DELETE', '/users/' + u.id + '?permanent=1').then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
  }
  function modal(title) {
    document.querySelectorAll('.us-modal').forEach(function (m) { m.remove(); });
    var dlg = el('div', { class: 'us-dlg', role: 'dialog', 'aria-label': title }, [el('h3', { text: title })]);
    var m = el('div', { class: 'us-modal' }, [dlg]);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return { dlg: dlg, close: function () { m.remove(); } };
  }
  /* Super Admin: per page — full access / edit (no delete) / view only / hidden */
  function pageAccess(u) {
    var M = modal('Page access · ' + u.name);
    M.dlg.style.maxWidth = '720px';
    M.dlg.appendChild(el('div', { class: 'us-empty', text: 'Loading…' }));
    api('GET', '/page-access/users/' + u.id).then(function (j) {
      var d = j.data, access = {}, sels = {};
      Object.keys(d.access || {}).forEach(function (k) { access[k] = d.access[k]; });
      M.dlg.removeChild(M.dlg.lastChild);
      M.dlg.appendChild(el('p', { style: 'margin:0 0 .6rem;font-size:.82rem;color:#64748b', text: 'Full access = view, add, edit and delete. Edit = no delete. View only = read only. Hidden = removed from the menu. The server enforces it too.' }));
      var quick = el('div', { style: 'display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.6rem' }, [el('span', { style: 'font-size:.78rem;color:#64748b;align-self:center', text: 'Set all to:' })]
        .concat(Object.keys(d.levels).map(function (lv) { return el('button', { type: 'button', class: 'us-btn sm', 'data-pa-all': lv, text: d.levels[lv], onclick: function () { Object.keys(sels).forEach(function (k) { sels[k].value = lv; }); } }); })));
      M.dlg.appendChild(quick);
      var COL = { full: '#16a34a', edit: '#2563eb', view: '#d97706', hidden: '#64748b' };
      var tb = el('tbody', {}, d.pages.map(function (pg) {
        var sel = el('select', { 'data-pa': pg.key, style: 'border:1px solid #cbd5e1;border-radius:.4rem;padding:.25rem .4rem;font-size:.82rem;background:transparent;color:inherit' },
          Object.keys(d.levels).map(function (lv) { return el('option', { value: lv, text: d.levels[lv] }); }));
        sel.value = access[pg.key] || 'full';
        function tint() { sel.style.borderColor = COL[sel.value]; sel.style.color = sel.value === 'full' ? '' : COL[sel.value]; }
        sel.addEventListener('change', tint); tint();
        sels[pg.key] = sel;
        return el('tr', {}, [el('td', { style: 'padding:.3rem .4rem;font-size:.85rem' }, [el('b', { text: pg.label }), el('small', { style: 'color:#64748b;margin-left:.4rem', text: pg.paths.join(', ') })]), el('td', { style: 'padding:.3rem .4rem;text-align:right' }, [sel])]);
      }));
      M.dlg.appendChild(el('div', { style: 'max-height:55vh;overflow:auto;border:1px solid #e2e8f0;border-radius:.6rem' }, [el('table', { style: 'width:100%;border-collapse:collapse', id: 'us-pa-table' }, [tb])]));
      var err = el('div', { class: 'us-err' });
      M.dlg.appendChild(err);
      M.dlg.appendChild(el('div', { class: 'us-foot' }, [el('button', { type: 'button', class: 'us-btn', text: 'Cancel', onclick: M.close }),
        el('button', { type: 'button', class: 'us-btn pri', id: 'us-pa-save', text: 'Save', onclick: function () {
          var out = {}; Object.keys(sels).forEach(function (k) { if (sels[k].value !== 'full') out[k] = sels[k].value; });
          api('PUT', '/page-access/users/' + u.id, { access: out }).then(function (r) { toast(r.message); M.close(); }).catch(function (e) { err.textContent = e.message; });
        } })]));
    }).catch(function (e) { M.dlg.lastChild.textContent = e.message; });
  }
  function resetPw(u) {
    var M = modal('Reset password · ' + u.name);
    var pw = el('input', { type: 'text', id: 'us-newpw', placeholder: 'At least 6 characters', autocomplete: 'new-password' });
    var err = el('div', { class: 'us-err' });
    M.dlg.appendChild(el('div', { class: 'us-g' }, [el('div', { class: 'w' }, [el('label', { text: 'New password' }), pw])]));
    M.dlg.appendChild(err);
    M.dlg.appendChild(el('div', { class: 'us-foot' }, [el('button', { type: 'button', class: 'us-btn', text: 'Cancel', onclick: M.close }),
      el('button', { type: 'button', class: 'us-btn pri', id: 'us-pw-save', text: 'Set password', onclick: function () {
        api('PATCH', '/users/' + u.id + '/reset-password', { newPassword: pw.value }).then(function (j) { toast(j.message); M.close(); }).catch(function (e) { err.textContent = e.message; });
      } })]));
    pw.focus();
  }
  function form(u) {
    var isNew = !u; u = u || { role: 'SALES_ENGINEER' };
    var M = modal(isNew ? 'Add user' : 'Edit user · ' + u.name);
    var f = {};
    function inp(k, label, attrs, wide) { f[k] = el('input', Object.assign({ id: 'us-f-' + k, value: u[k] || '' }, attrs || {})); return el('div', { class: wide ? 'w' : '' }, [el('label', { text: label }), f[k]]); }
    var role = el('select', { id: 'us-f-role' }, Object.keys(ROLES).filter(function (r) { return isSuper || r !== 'SUPER_ADMIN'; }).map(function (r) { return el('option', { value: r, text: ROLES[r][0] }); }));
    role.value = u.role; f.role = role;
    if (u.id === me0.id) role.disabled = true;
    var g = el('div', { class: 'us-g' }, [
      inp('name', 'Full name *', { placeholder: 'e.g. Raj Kumar' }), inp('email', 'Email (login) *', { type: 'email', placeholder: 'name@company.com' }),
      isNew ? inp('password', 'Password *', { type: 'text', placeholder: 'At least 6 characters', autocomplete: 'new-password' }) : null,
      el('div', {}, [el('label', { text: 'Role *' }), role]),
      inp('phone', 'Phone', { inputmode: 'tel' }), inp('department', 'Department', { placeholder: 'e.g. Sales' }),
      inp('designation', 'Designation', { placeholder: 'e.g. Sales Engineer' }), inp('employeeCode', 'Employee code', { placeholder: 'e.g. TMS-012' })
    ]);
    var err = el('div', { class: 'us-err', id: 'us-err' });
    M.dlg.appendChild(g); M.dlg.appendChild(err);
    var save = el('button', { type: 'button', class: 'us-btn pri', id: 'us-save', text: isNew ? 'Create user' : 'Save changes' });
    save.onclick = function () {
      var b = {};
      Object.keys(f).forEach(function (k) { if (!(k === 'role' && f.role.disabled)) b[k] = f[k].value.trim(); });
      if (!b.name) { err.textContent = 'Enter the name.'; return; }
      if (!b.email) { err.textContent = 'Enter the email.'; return; }
      if (isNew && (b.password || '').length < 6) { err.textContent = 'The password needs at least 6 characters.'; return; }
      save.disabled = true; err.textContent = '';
      (isNew ? api('POST', '/users', b) : api('PUT', '/users/' + u.id, b)).then(function (j) {
        toast(j.message || 'Saved'); M.close();
        if (!isNew && u.id === me0.id && j.data && j.data.user) { try { var cur = me(); cur.name = j.data.user.name; cur.email = j.data.user.email; localStorage.setItem('crm_user', JSON.stringify(cur)); } catch (e) {} }
        load();
      }).catch(function (e) { err.textContent = e.message; save.disabled = false; });
    };
    M.dlg.appendChild(el('div', { class: 'us-foot' }, [el('button', { type: 'button', class: 'us-btn', text: 'Cancel', onclick: M.close }), save]));
    f.name.focus();
  }

  function mountPage(content) {
    css();
    var role = me0.role;
    if (['SUPER_ADMIN', 'ADMIN'].indexOf(role) === -1) { content.appendChild(el('div', { class: 'us-empty', text: 'Only Admins can manage users.' })); return; }
    var wrap = el('div', { class: 'us-wrap' });
    wrap.appendChild(el('div', { class: 'us-head' }, [el('div', {}, [el('h1', { text: 'Users' }), el('p', { text: 'Add people, change their name, email or role, reset passwords, and deactivate or delete accounts.' })]),
      el('button', { type: 'button', class: 'us-btn pri', id: 'us-add', text: '+ Add user', onclick: function () { form(null); } })]));
    var q = el('input', { type: 'search', id: 'us-search', placeholder: 'Search name, email or department…' });
    var rs = el('select', { id: 'us-role' }, [el('option', { value: '', text: 'All roles' })].concat(Object.keys(ROLES).map(function (r) { return el('option', { value: r, text: ROLES[r][0] }); })));
    var ss = el('select', { id: 'us-status' }, [['active', 'Active'], ['inactive', 'Deactivated'], ['all', 'Active + deactivated'], ['removed', 'Removed']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var t; q.oninput = function () { clearTimeout(t); t = setTimeout(function () { F.q = q.value.trim(); load(); }, 250); };
    rs.onchange = function () { F.role = rs.value; load(); };
    ss.onchange = function () { F.status = ss.value; load(); };
    body = el('div', { id: 'us-body' });
    wrap.appendChild(el('div', { class: 'us-card' }, [el('div', { class: 'us-bar' }, [q, rs, ss]), body]));
    content.appendChild(wrap);
    load();
  }
  window.UsersPage = { mountPage: mountPage };
})();
