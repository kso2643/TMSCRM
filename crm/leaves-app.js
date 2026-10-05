/* ══════════════════════════════════════════════════════════════════════
   Leave — apply for leave or hourly permission, see your requests,
   and (Manager / Admin / Super Admin) approve or reject everyone's.

   Types: Casual leave, Sick leave, Personal leave, Half day and
   Permission (hourly) — permission takes a time from / to on one day and
   the hours are worked out for you (at most 8 hours).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  var TYPES = [
    { value: 'CASUAL', label: 'Casual leave' }, { value: 'SICK', label: 'Sick leave' },
    { value: 'PERSONAL', label: 'Personal leave' }, { value: 'HALF_DAY', label: 'Half day' },
    { value: 'PERMISSION', label: 'Permission (hourly)' }
  ];
  var LABEL = {}; TYPES.forEach(function (t) { LABEL[t.value] = t.label; });
  var STATUS = { PENDING: ['Pending', '#d97706'], APPROVED: ['Approved', '#16a34a'], REJECTED: ['Rejected', '#dc2626'] };

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  var isAdminTier = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(me().role) !== -1;
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
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function today() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function hrs(h) { h = Number(h) || 0; var m = Math.round(h * 60); return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : ''); }
  function minutes(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function toast(msg, kind) {
    document.querySelectorAll('.lv-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'lv-toast ' + (kind || 'ok'), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.classList.remove('in'); }, 3400);
    setTimeout(function () { t.remove(); }, 3800);
  }
  function badge(s) { var x = STATUS[s] || [s, '#64748b']; return el('span', { class: 'lv-badge', style: '--c:' + x[1], text: x[0] }); }
  function typeChip(t) { return el('span', { class: 'lv-type t-' + String(t).toLowerCase(), text: LABEL[t] || t }); }

  function injectCss() {
    if (document.getElementById('lv-css')) return;
    var st = document.createElement('style');
    st.id = 'lv-css';
    st.textContent = [
      '.lv-wrap{max-width:1200px;margin:0 auto}',
      '.lv-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem;margin-bottom:1rem}',
      '.lv-head h1{font-size:1.35rem;font-weight:700;margin:0}.lv-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.lv-btn{display:inline-flex;align-items:center;gap:.4rem;border-radius:.55rem;padding:.5rem .9rem;font-size:.85rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.lv-btn:hover{background:#f1f5f9}.lv-btn:disabled{opacity:.55;cursor:default}',
      '.lv-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.lv-btn.pri:hover{background:#1e40af}',
      '.lv-btn.grn{background:#0f766e;border-color:#0f766e;color:#fff}.lv-btn.grn:hover{background:#115e59}',
      '.lv-btn.red{color:#b91c1c;border-color:#fecaca}.lv-btn.red:hover{background:#fef2f2}.lv-btn.sm{padding:.3rem .6rem;font-size:.78rem}',
      '.dark .lv-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .lv-btn.pri{background:#2563eb;border-color:#2563eb}.dark .lv-btn.grn{background:#0d9488;border-color:#0d9488}',
      '.lv-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin-bottom:1rem}',
      '.lv-stat{background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;padding:.75rem .9rem}.dark .lv-stat{background:#1e293b;border-color:#334155}',
      '.lv-stat b{display:block;font-size:1.25rem}.lv-stat span{font-size:.75rem;color:#64748b}',
      '.lv-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .lv-card{background:#1e293b;border-color:#334155}',
      '.lv-card h2{font-size:1rem;font-weight:700;margin:0 0 .75rem}',
      '.lv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.75rem;align-items:start}',
      '.lv-f label{display:block;font-size:.75rem;font-weight:600;color:#475569;margin-bottom:.25rem}.dark .lv-f label{color:#94a3b8}',
      '.lv-f label i{color:#dc2626;font-style:normal}',
      '.lv-f input,.lv-f select,.lv-f textarea{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.88rem;background:#fff;color:inherit}',
      '.dark .lv-f input,.dark .lv-f select,.dark .lv-f textarea{background:#0f172a;border-color:#334155}',
      '.lv-f.wide{grid-column:1/-1}.lv-f textarea{min-height:64px;resize:vertical}',
      '.lv-hours{display:inline-block;margin-top:.25rem;font-size:.8rem;font-weight:600;color:#0f766e}.lv-hours.bad{color:#b91c1c}',
      '.lv-actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.75rem}',
      '.lv-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;margin-bottom:.75rem;overflow-x:auto}.dark .lv-tabs{border-color:#334155}',
      '.lv-tab{padding:.55rem 1rem;font-size:.88rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.lv-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .lv-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.lv-tab .n{display:inline-block;margin-left:.35rem;background:#fef3c7;color:#92400e;border-radius:999px;padding:0 .45rem;font-size:.72rem}',
      '.lv-filters{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.75rem}.lv-filters select{border:1px solid #cbd5e1;border-radius:.5rem;padding:.35rem .5rem;font-size:.82rem;background:#fff;color:inherit}',
      '.dark .lv-filters select{background:#0f172a;border-color:#334155}',
      '.lv-table{width:100%;border-collapse:collapse;font-size:.85rem}.lv-tw{overflow-x:auto}',
      '.lv-table th{text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.5rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.lv-table td{padding:.6rem .5rem;border-bottom:1px solid #f1f5f9;vertical-align:top}.dark .lv-table th,.dark .lv-table td{border-color:#334155}',
      '.lv-table .sub{color:#64748b;font-size:.76rem}.lv-table .acts{display:flex;gap:.35rem;flex-wrap:wrap}',
      '.lv-badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.74rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent)}',
      '.lv-type{display:inline-block;padding:.1rem .5rem;border-radius:.4rem;font-size:.74rem;font-weight:600;background:#eef2ff;color:#3730a3}',
      '.lv-type.t-permission{background:#ecfeff;color:#0e7490}.lv-type.t-personal{background:#fdf4ff;color:#a21caf}.lv-type.t-sick{background:#fef2f2;color:#b91c1c}.lv-type.t-half_day{background:#fffbeb;color:#b45309}',
      '.lv-empty{padding:2rem;text-align:center;color:#64748b;font-size:.9rem}',
      '.lv-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;box-shadow:0 10px 25px rgba(0,0,0,.2);transition:opacity .25s,transform .25s;max-width:calc(100vw - 32px)}',
      '.lv-toast.in{opacity:1;transform:translate(-50%,0)}.lv-toast.err{background:#b91c1c}',
      '@media (max-width:640px){.lv-table thead{display:none}.lv-table tr{display:block;border-bottom:1px solid #e2e8f0;padding:.5rem 0}.lv-table td{display:block;border:none;padding:.2rem 0}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var state = { tab: 'mine', status: '', type: '', items: [], summary: null };
  var ROOT;

  function field(label, input, req, extra) {
    return el('div', { class: 'lv-f' + (extra || '') }, [el('label', {}, [label, req ? el('i', { text: ' *' }) : null]), input]);
  }

  function form() {
    var type = el('select', { id: 'lv-type' }, TYPES.map(function (t) { return el('option', { value: t.value, text: t.label }); }));
    var from = el('input', { type: 'date', id: 'lv-from', value: today() });
    var to = el('input', { type: 'date', id: 'lv-to', value: today() });
    var ft = el('input', { type: 'time', id: 'lv-ftime', value: '10:00' });
    var tt = el('input', { type: 'time', id: 'lv-ttime', value: '12:00' });
    var reason = el('textarea', { id: 'lv-reason', placeholder: 'Why do you need this leave / permission?' });
    var hoursOut = el('span', { class: 'lv-hours', id: 'lv-hours' });
    var toF = field('To date', to, true), ftF = field('Time from', ft, true), ttF = field('Time to', tt, true, '');
    ttF.appendChild(hoursOut);
    var fromLbl;
    var fromF = field('From date', from, true); fromLbl = fromF.querySelector('label');

    function sync() {
      var t = type.value, perm = t === 'PERMISSION', one = perm || t === 'HALF_DAY';
      toF.style.display = one ? 'none' : '';
      ftF.style.display = ttF.style.display = perm ? '' : 'none';
      fromLbl.firstChild.textContent = one ? 'Date' : 'From date';
      if (to.value < from.value) to.value = from.value;
      to.min = from.value;
      if (perm) {
        var a = minutes(ft.value), b = minutes(tt.value), d = a == null || b == null ? null : b - a;
        hoursOut.className = 'lv-hours' + (d == null || d <= 0 || d > 480 ? ' bad' : '');
        hoursOut.textContent = d == null ? '' : d <= 0 ? '"To" must be after "from"' : d > 480 ? hrs(d / 60) + ' — at most 8 hours' : 'Hours: ' + hrs(d / 60);
      }
    }
    [type, from, to, ft, tt].forEach(function (x) { x.addEventListener('input', sync); x.addEventListener('change', sync); });

    var submit = el('button', { class: 'lv-btn pri', id: 'lv-submit', text: 'Submit request', onclick: function () {
      var t = type.value, body = { leaveType: t, fromDate: from.value, toDate: (t === 'PERMISSION' || t === 'HALF_DAY') ? from.value : to.value, reason: reason.value.trim() };
      if (!body.fromDate) return toast('Choose the date.', 'err');
      if (t === 'PERMISSION') {
        var d = minutes(tt.value) - minutes(ft.value);
        if (!(d > 0)) return toast('The "to" time must be after the "from" time.', 'err');
        if (d > 480) return toast('Permission can be at most 8 hours — apply for leave instead.', 'err');
        body.fromTime = ft.value; body.toTime = tt.value;
      }
      if (!body.reason) { reason.focus(); return toast('Please give a reason.', 'err'); }
      submit.disabled = true;
      api('POST', '/leaves', body).then(function (j) {
        toast(j.message || 'Request submitted');
        reason.value = '';
        state.tab = 'mine'; load();
      }).catch(function (e) { toast(e.message, 'err'); }).then(function () { submit.disabled = false; });
    } });
    var card = el('div', { class: 'lv-card' }, [
      el('h2', { text: 'Apply for leave or permission' }),
      el('div', { class: 'lv-grid' }, [field('Type', type, true), fromF, toF, ftF, ttF, field('Reason', reason, true, ' wide')]),
      el('div', { class: 'lv-actions' }, [submit])
    ]);
    sync();
    return card;
  }

  function stats() {
    var s = state.summary || { year: {}, permissionHoursThisMonth: 0, pending: 0 }, y = s.year || {};
    function d(k) { return (y[k] && y[k].days) || 0; }
    return el('div', { class: 'lv-stats', id: 'lv-stats' }, [
      el('div', { class: 'lv-stat' }, [el('b', { text: String(d('CASUAL')) }), el('span', { text: 'Casual days this year' })]),
      el('div', { class: 'lv-stat' }, [el('b', { text: String(d('SICK')) }), el('span', { text: 'Sick days this year' })]),
      el('div', { class: 'lv-stat' }, [el('b', { text: String(d('PERSONAL')) }), el('span', { text: 'Personal days this year' })]),
      el('div', { class: 'lv-stat' }, [el('b', { text: String(d('HALF_DAY') ? d('HALF_DAY') * 2 : 0) }), el('span', { text: 'Half days this year' })]),
      el('div', { class: 'lv-stat' }, [el('b', { text: hrs(s.permissionHoursThisMonth) }), el('span', { text: 'Permission hours this month' })]),
      el('div', { class: 'lv-stat' }, [el('b', { text: String(s.pending || 0) }), el('span', { text: isAdminTier ? 'Pending to decide (all)' : 'Your pending requests' })])
    ]);
  }

  function whenCell(r) {
    var same = String(r.toDate || '').slice(0, 10) === String(r.fromDate).slice(0, 10);
    var main = dmy(r.fromDate) + (same ? '' : ' – ' + dmy(r.toDate));
    var sub = r.leaveType === 'PERMISSION' ? (r.fromTime + ' – ' + r.toTime + ' · ' + hrs(r.hours)) : r.leaveType === 'HALF_DAY' ? 'Half day' : (r.totalDays + ' day' + (r.totalDays == 1 ? '' : 's'));
    return el('td', {}, [el('div', { text: main }), el('div', { class: 'sub', text: sub })]);
  }

  function decide(r, status, btn) {
    var note = '';
    if (status === 'REJECTED') { note = prompt('Reason for rejecting this request:'); if (note == null) return; note = note.trim(); if (!note) return toast('Please give a reason for rejecting.', 'err'); }
    btn.disabled = true;
    api('PATCH', '/leaves/' + r.id + '/approve', { status: status, adminNote: note || undefined }).then(function (j) { toast(j.message || 'Done'); load(); })
      .catch(function (e) { toast(e.message, 'err'); btn.disabled = false; });
  }

  function table() {
    var showWho = state.tab === 'all';
    if (!state.items.length) return el('div', { class: 'lv-empty', text: 'No requests yet.' });
    var head = el('tr', {}, [showWho ? el('th', { text: 'Employee' }) : null, el('th', { text: 'Type' }), el('th', { text: 'When' }),
      el('th', { text: 'Reason' }), el('th', { text: 'Status' }), el('th', { text: '' })]);
    var rows = state.items.map(function (r) {
      var acts = el('div', { class: 'acts' });
      var mine = r.userId === me().id;
      if (r.status === 'PENDING' && isAdminTier && state.tab === 'all') {
        var ok = el('button', { class: 'lv-btn sm grn', 'data-approve': r.id, text: 'Approve' }); ok.onclick = function () { decide(r, 'APPROVED', ok); };
        var no = el('button', { class: 'lv-btn sm red', 'data-reject': r.id, text: 'Reject' }); no.onclick = function () { decide(r, 'REJECTED', no); };
        acts.appendChild(ok); acts.appendChild(no);
      }
      if (r.status === 'PENDING' && mine) {
        var wd = el('button', { class: 'lv-btn sm', 'data-withdraw': r.id, text: 'Withdraw' });
        wd.onclick = function () {
          if (!confirm('Withdraw this request?')) return;
          wd.disabled = true;
          api('DELETE', '/leaves/' + r.id).then(function () { toast('Request withdrawn'); load(); }).catch(function (e) { toast(e.message, 'err'); wd.disabled = false; });
        };
        acts.appendChild(wd);
      }
      var statusTd = el('td', {}, [badge(r.status),
        r.approvedBy ? el('div', { class: 'sub', text: 'by ' + r.approvedBy.name }) : null,
        r.adminNote ? el('div', { class: 'sub', text: r.adminNote }) : null]);
      return el('tr', { 'data-id': r.id }, [
        showWho ? el('td', {}, [el('div', { text: (r.user && r.user.name) || '—' }), r.user && r.user.department ? el('div', { class: 'sub', text: r.user.department }) : null]) : null,
        el('td', {}, [typeChip(r.leaveType)]), whenCell(r), el('td', { text: r.reason || '' }), statusTd, el('td', {}, [acts])
      ]);
    });
    return el('div', { class: 'lv-tw' }, [el('table', { class: 'lv-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)])]);
  }

  function listCard() {
    var tabs = el('div', { class: 'lv-tabs' });
    [['mine', 'My requests'], isAdminTier ? ['all', 'All requests'] : null].forEach(function (t) {
      if (!t) return;
      var b = el('button', { class: 'lv-tab' + (state.tab === t[0] ? ' on' : ''), 'data-tab': t[0] }, [t[1],
        t[0] === 'all' && state.summary && state.summary.pending ? el('span', { class: 'n', text: String(state.summary.pending) }) : null]);
      b.onclick = function () { state.tab = t[0]; load(); };
      tabs.appendChild(b);
    });
    var st = el('select', { id: 'lv-fstatus' }, [['', 'All statuses'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    st.value = state.status; st.onchange = function () { state.status = st.value; load(); };
    var ty = el('select', { id: 'lv-ftype' }, [el('option', { value: '', text: 'All types' })].concat(TYPES.map(function (t) { return el('option', { value: t.value, text: t.label }); })));
    ty.value = state.type; ty.onchange = function () { state.type = ty.value; load(); };
    return el('div', { class: 'lv-card' }, [tabs, el('div', { class: 'lv-filters' }, [st, ty]), el('div', { id: 'lv-list' }, [table()])]);
  }

  function render() {
    var exp = isAdminTier ? el('button', { class: 'lv-btn', text: '⬇ Export Excel', onclick: function () {
      download('/leaves/export?format=xlsx', 'leaves-' + today() + '.xlsx').catch(function (e) { toast(e.message, 'err'); });
    } }) : null;
    clear(ROOT).appendChild(el('div', { class: 'lv-wrap' }, [
      el('div', { class: 'lv-head' }, [el('div', {}, [el('h1', { text: 'Leave & permission' }),
        el('p', { text: 'Apply for casual, sick, personal or half-day leave, or an hourly permission.' })]), exp]),
      stats(), form(), listCard()
    ]));
  }

  function load() {
    var q = '?limit=100' + (state.tab === 'mine' ? '&mine=1' : '') + (state.status ? '&status=' + state.status : '') + (state.type ? '&type=' + state.type : '');
    return Promise.all([api('GET', '/leaves' + q), api('GET', '/leaves/summary').catch(function () { return { data: null }; })]).then(function (res) {
      var d = res[0].data; state.items = Array.isArray(d) ? d : (d && (d.items || d.leaves || d.data)) || [];
      state.summary = res[1].data;
      var keep = document.getElementById('lv-reason'), draft = keep ? keep.value : '';
      var keepType = document.getElementById('lv-type'), tv = keepType ? keepType.value : null;
      render();
      if (draft) document.getElementById('lv-reason').value = draft;
      if (tv) { var t = document.getElementById('lv-type'); t.value = tv; t.dispatchEvent(new Event('change')); }
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function mountPage(content) {
    injectCss();
    ROOT = content;
    if (isAdminTier && /all/.test(location.hash)) state.tab = 'all';
    render();
    load();
  }
  window.LeavesPage = { mountPage: mountPage };
})();
