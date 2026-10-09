/* ══════════════════════════════════════════════════════════════════════
   Leave — apply for leave or hourly permission, see your requests,
   and (Manager / Admin / Super Admin) approve or reject everyone's.

   Types: Casual leave, Sick leave, Personal leave, Half day and
   Permission (hourly) — permission takes a time from / to on one day and
   the hours are worked out for you (at most 8 hours).

   Admin: "Count as…" turns a permission that ran over (or any request) into
   a half day, a full day or a leave of n days, paid or loss of pay — it then
   counts in the payroll working days and shows on the payslip. "Mark leave"
   records leave for an employee directly. The Calendar tab shows everyone's
   leave by day.
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
  var isAdmin = ['SUPER_ADMIN', 'ADMIN'].indexOf(me().role) !== -1; // convert / mark leave (require_admin in the API)
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
      '.lv-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:6vh 1rem;overflow:auto}',
      '.lv-dlg{background:#fff;border-radius:1rem;max-width:620px;width:100%;padding:1.1rem;box-shadow:0 20px 50px rgba(0,0,0,.3)}.dark .lv-dlg{background:#1e293b}.lv-dlg h2{font-size:1.05rem;font-weight:700;margin:0 0 .8rem}',
      '.lv-dlg .lv-f{margin-bottom:.6rem}',
      '.lv-seg{display:flex;gap:.35rem;flex-wrap:wrap}.lv-seg button{flex:1;min-width:110px;padding:.55rem .6rem;border:1px solid #cbd5e1;border-radius:.55rem;background:#fff;font-weight:600;font-size:.85rem;cursor:pointer;color:inherit}',
      '.lv-seg button.on{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.dark .lv-seg button{background:#0f172a;border-color:#334155}.dark .lv-seg button.on{background:#2563eb}',
      '.lv-cal-head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.6rem}.lv-cal-head b{min-width:9rem;text-align:center}',
      '.lv-cal-leg{display:flex;gap:.7rem;flex-wrap:wrap;margin-left:auto;font-size:.74rem;color:#64748b}.lv-cal-leg i{display:inline-block;width:.7rem;height:.7rem;border-radius:.2rem;margin-right:.25rem;vertical-align:-1px}',
      '.lv-cal{display:grid;grid-template-columns:repeat(7,minmax(110px,1fr));gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:.7rem;overflow:hidden;min-width:780px}.dark .lv-cal{background:#334155;border-color:#334155}',
      '.lv-cal-wd{background:#f8fafc;padding:.4rem;text-align:center;font-size:.7rem;font-weight:700;text-transform:uppercase;color:#64748b}.dark .lv-cal-wd{background:#0f172a}',
      '.lv-cal-c{background:#fff;min-height:96px;padding:.3rem .35rem;display:flex;flex-direction:column;gap:2px}.dark .lv-cal-c{background:#020617}',
      '.lv-cal-c.out{background:#f8fafc}.dark .lv-cal-c.out{background:#0b1222}.lv-cal-c.sun{background:#fafafa}.lv-cal-c.today{box-shadow:inset 0 0 0 2px #1e3a8a}',
      '.lv-cal-n{display:flex;justify-content:space-between;font-size:.76rem;font-weight:700;color:#334155}.dark .lv-cal-n{color:#cbd5e1}.lv-cal-n em{font-style:normal;font-size:.64rem;background:#eef2ff;color:#3730a3;border-radius:999px;padding:0 .35rem}',
      '.lv-cal-ev{font-size:.68rem;line-height:1.3;padding:.1rem .3rem;border-radius:.3rem;border-left:3px solid var(--c);background:color-mix(in srgb,var(--c) 12%,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#0f172a}',
      '.dark .lv-cal-ev{background:color-mix(in srgb,var(--c) 25%,#020617);color:#f1f5f9}.lv-cal-ev.pend{background:#fff;border:1px dashed var(--c);border-left-width:3px}.lv-cal-ev.lop{box-shadow:inset -3px 0 0 #dc2626}',
      '.lv-cal-more{font-size:.64rem;color:#64748b;padding-left:.3rem}',
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
    var conv = r.originalType && r.originalType !== r.leaveType
      ? el('div', { class: 'sub', style: 'color:#b45309', text: 'Was ' + (LABEL[r.originalType] || r.originalType).toLowerCase() + (r.originalType === 'PERMISSION' && r.fromTime ? ' ' + r.fromTime + '–' + r.toTime : '') + (r.convertNote ? ' — ' + r.convertNote : '') }) : null;
    return el('td', {}, [el('div', { text: main }), el('div', { class: 'sub', text: sub }), r.isLop ? el('span', { class: 'lv-badge', style: '--c:#dc2626', text: 'Loss of pay' }) : null, conv]);
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
      if (isAdmin && state.tab === 'all' && r.status !== 'REJECTED') {
        acts.appendChild(el('button', { class: 'lv-btn sm', 'data-convert': r.id, text: r.leaveType === 'PERMISSION' ? 'Count as…' : 'Change…', title: 'Count this as a half day, full day or leave (paid or loss of pay)', onclick: function () { countAs(r); } }));
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

  // ── admin: count a permission as half day / full day / leave, or mark leave directly ──
  function modal(title, bodyKids, onOk, okText) {
    var err = el('div', { class: 'lv-hours bad', style: 'display:none' });
    var ok = el('button', { class: 'lv-btn pri', id: 'lv-dlg-ok', text: okText || 'Save' });
    var dlg = el('div', { class: 'lv-dlg', id: 'lv-dlg' }, [el('h2', { text: title })].concat(bodyKids).concat([err,
      el('div', { class: 'lv-actions' }, [el('button', { class: 'lv-btn', text: 'Cancel', onclick: function () { m.remove(); } }), ok])]));
    var m = el('div', { class: 'lv-modal' }, [dlg]);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    ok.onclick = function () {
      ok.disabled = true; err.style.display = 'none';
      onOk().then(function (j) { m.remove(); toast(j.message || 'Saved'); load(); })
        .catch(function (e) { ok.disabled = false; err.textContent = e.message; err.style.display = ''; });
    };
    document.body.appendChild(m);
    return m;
  }
  function kindPicker(def) {
    var st = { to: def || 'HALF_DAY' };
    var days = el('input', { type: 'number', min: '1', max: '60', value: '2', id: 'lv-c-days', style: 'width:5rem' });
    var seg = el('div', { class: 'lv-seg' });
    [['HALF_DAY', '½ Half day'], ['FULL_DAY', '1 Full day'], ['LEAVE', 'Leave (days)']].forEach(function (o) {
      seg.appendChild(el('button', { type: 'button', 'data-kind': o[0], class: st.to === o[0] ? 'on' : '', text: o[1], onclick: function () {
        st.to = o[0]; Array.prototype.forEach.call(seg.children, function (b) { b.classList.toggle('on', b.getAttribute('data-kind') === st.to); });
        daysF.style.display = st.to === 'LEAVE' ? '' : 'none';
      } }));
    });
    var daysF = field('Number of days', days); daysF.style.display = st.to === 'LEAVE' ? '' : 'none';
    var lt = el('select', { id: 'lv-c-type' }, [['CASUAL', 'Casual leave'], ['SICK', 'Sick leave'], ['PERSONAL', 'Personal leave']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var lop = el('input', { type: 'checkbox', id: 'lv-c-lop', style: 'width:auto' });
    var note = el('input', { id: 'lv-c-note', placeholder: 'e.g. went 10–12 but came back at 4 PM' });
    return {
      nodes: [field('Count as', seg, true), el('div', { class: 'lv-grid' }, [daysF, field('Leave type (for full day / leave)', lt),
        el('div', { class: 'lv-f' }, [el('label', { style: 'display:flex;gap:.4rem;align-items:center;margin-top:1.4rem;cursor:pointer' }, [lop, 'Loss of pay (LOP) — deduct from salary'])]),
        field('Note', note)])],
      value: function () { return { to: st.to, days: days.value, leaveType: lt.value, lop: lop.checked, note: note.value.trim() }; }
    };
  }
  function countAs(r) {
    var k = kindPicker(r.leaveType === 'HALF_DAY' ? 'HALF_DAY' : r.leaveType === 'PERMISSION' ? 'HALF_DAY' : 'FULL_DAY');
    var who = (r.user && r.user.name) || '';
    modal('Count ' + who + '’s ' + (LABEL[r.leaveType] || 'request').toLowerCase() + ' on ' + dmy(r.fromDate) + ' as…',
      [r.leaveType === 'PERMISSION' ? el('p', { class: 'sub', style: 'margin:-.4rem 0 .6rem;color:#64748b;font-size:.82rem', text: 'Permission ' + r.fromTime + '–' + r.toTime + ' (' + hrs(r.hours) + '). If they took more time, count it as a half day, a full day or leave — it is then counted in the working days and shown on the payslip.' }) : null].concat(k.nodes),
      function () { return api('PATCH', '/leaves/' + r.id + '/convert', k.value()); }, 'Save');
  }
  var users = null;
  function markLeave() {
    var who = el('select', { id: 'lv-m-user' }, [el('option', { value: '', text: 'Loading…' })]);
    var from = el('input', { type: 'date', id: 'lv-m-date', value: today() });
    var reason = el('input', { id: 'lv-m-reason', placeholder: 'e.g. Absent without informing' });
    var k = kindPicker('FULL_DAY');
    (users ? Promise.resolve(users) : api('GET', '/md-desk/recipients').then(function (j) { return (users = j.data.users || []); })).then(function (list) {
      clear(who).appendChild(el('option', { value: '', text: 'Choose employee…' }));
      list.forEach(function (u) { who.appendChild(el('option', { value: u.id, text: u.name + (u.department ? ' · ' + u.department : '') })); });
    }).catch(function () {});
    modal('Mark leave for an employee', [el('div', { class: 'lv-grid' }, [field('Employee', who, true), field('Date (from)', from, true)])].concat(k.nodes).concat([field('Reason', reason)]),
      function () { var v = k.value(); v.userId = who.value; v.fromDate = from.value; v.reason = reason.value.trim() || v.note; return api('POST', '/leaves/assign', v); }, 'Mark leave');
  }

  // ── calendar ─────────────────────────────────────────────────────────
  var cal = { y: new Date().getFullYear(), m: new Date().getMonth() + 1, leaves: [] };
  var KIND_C = { HALF_DAY: '#d97706', FULL_DAY: '#2563eb', LEAVE: '#7c3aed', PERMISSION: '#0e7490' };
  function calendarCard() {
    var box = el('div', { id: 'lv-cal' }, [el('div', { class: 'lv-empty', text: 'Loading…' })]);
    function draw() {
      var first = new Date(cal.y, cal.m - 1, 1), n = new Date(cal.y, cal.m, 0).getDate(), lead = first.getDay();
      var byDay = {};
      cal.leaves.forEach(function (r) {
        var a = String(r.fromDate).slice(0, 10), b = String(r.toDate || r.fromDate).slice(0, 10);
        for (var d = 1; d <= n; d++) {
          var ds = cal.y + '-' + String(cal.m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          if (ds >= a && ds <= b) (byDay[ds] = byDay[ds] || []).push(r);
        }
      });
      var grid = el('div', { class: 'lv-cal' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (w) { return el('div', { class: 'lv-cal-wd', text: w }); }));
      for (var i = 0; i < lead; i++) grid.appendChild(el('div', { class: 'lv-cal-c out' }));
      var td = today();
      for (var d = 1; d <= n; d++) {
        var ds = cal.y + '-' + String(cal.m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var list = byDay[ds] || [], sun = new Date(cal.y, cal.m - 1, d).getDay() === 0;
        var c = el('div', { class: 'lv-cal-c' + (sun ? ' sun' : '') + (ds === td ? ' today' : ''), 'data-date': ds }, [el('div', { class: 'lv-cal-n' }, [String(d), list.length ? el('em', { text: String(list.length) }) : null])]);
        list.slice(0, 4).forEach(function (r) {
          var k = r.dayKind || 'FULL_DAY';
          c.appendChild(el('div', { class: 'lv-cal-ev' + (r.status === 'PENDING' ? ' pend' : '') + (r.isLop ? ' lop' : ''), style: '--c:' + (KIND_C[k] || '#2563eb'),
            title: ((r.user && r.user.name) || '') + ' · ' + (LABEL[r.leaveType] || r.leaveType) + (k === 'PERMISSION' ? ' ' + r.fromTime + '–' + r.toTime : '') + (r.isLop ? ' · loss of pay' : '') + (r.status === 'PENDING' ? ' · pending' : '') + (r.reason ? '\n' + r.reason : '') },
            [el('b', { text: isAdminTier ? ((r.user && r.user.name) || '').split(' ')[0] : (LABEL[r.leaveType] || '') }), ' ' + (k === 'HALF_DAY' ? '½' : k === 'PERMISSION' ? hrs(r.hours) : (isAdminTier ? (k === 'LEAVE' ? 'leave' : 'day') : ''))]));
        });
        if (list.length > 4) c.appendChild(el('div', { class: 'lv-cal-more', text: '+' + (list.length - 4) + ' more' }));
        grid.appendChild(c);
      }
      var title = new Date(cal.y, cal.m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      clear(box).appendChild(el('div', { class: 'lv-cal-head' }, [
        el('button', { class: 'lv-btn sm', text: '‹', 'aria-label': 'Previous month', onclick: function () { cal.m--; if (cal.m < 1) { cal.m = 12; cal.y--; } loadCal(); } }),
        el('b', { text: title }),
        el('button', { class: 'lv-btn sm', text: '›', 'aria-label': 'Next month', onclick: function () { cal.m++; if (cal.m > 12) { cal.m = 1; cal.y++; } loadCal(); } }),
        el('span', { class: 'lv-cal-leg' }, [['HALF_DAY', 'Half day'], ['FULL_DAY', 'Full day'], ['LEAVE', 'Leave (days)'], ['PERMISSION', 'Permission']].map(function (o) { return el('span', {}, [el('i', { style: 'background:' + KIND_C[o[0]] }), o[1]]); })
          .concat([el('span', {}, [el('i', { style: 'background:#fff;border:1.5px dashed #94a3b8' }), 'Pending']), el('span', {}, [el('i', { style: 'background:#dc2626' }), 'Loss of pay'])]))
      ]));
      box.appendChild(el('div', { class: 'lv-tw' }, [grid]));
    }
    function loadCal() {
      api('GET', '/leaves/calendar?month=' + cal.m + '&year=' + cal.y).then(function (j) { cal.leaves = j.data.leaves || []; draw(); })
        .catch(function (e) { clear(box).appendChild(el('div', { class: 'lv-empty', text: e.message })); });
    }
    loadCal();
    return box;
  }

  function listCard() {
    var tabs = el('div', { class: 'lv-tabs' });
    [['mine', 'My requests'], isAdminTier ? ['all', 'All requests'] : null, ['calendar', 'Calendar']].forEach(function (t) {
      if (!t) return;
      var b = el('button', { class: 'lv-tab' + (state.tab === t[0] ? ' on' : ''), 'data-tab': t[0] }, [t[1],
        t[0] === 'all' && state.summary && state.summary.pending ? el('span', { class: 'n', text: String(state.summary.pending) }) : null]);
      b.onclick = function () { state.tab = t[0]; if (t[0] === 'calendar') render(); else load(); };
      tabs.appendChild(b);
    });
    var st = el('select', { id: 'lv-fstatus' }, [['', 'All statuses'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    st.value = state.status; st.onchange = function () { state.status = st.value; load(); };
    var ty = el('select', { id: 'lv-ftype' }, [el('option', { value: '', text: 'All types' })].concat(TYPES.map(function (t) { return el('option', { value: t.value, text: t.label }); })));
    ty.value = state.type; ty.onchange = function () { state.type = ty.value; load(); };
    if (state.tab === 'calendar') return el('div', { class: 'lv-card' }, [tabs, calendarCard()]);
    var mark = isAdmin && state.tab === 'all' ? el('button', { class: 'lv-btn sm pri', id: 'lv-mark', style: 'margin-left:auto', text: '+ Mark leave for employee', onclick: markLeave }) : null;
    return el('div', { class: 'lv-card' }, [tabs, el('div', { class: 'lv-filters' }, [st, ty, mark]), el('div', { id: 'lv-list' }, [table()])]);
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
