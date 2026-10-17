/* ══════════════════════════════════════════════════════════════════════
   Internal meeting reports + MOM (minutes of meeting).

   Internal meetings — date, topic, who attended, what was discussed and the
   next actions (owner + due date). Owners tick their actions off; "My open
   actions" lists what is still pending for you.

   MOM — customer meeting minutes on the TMS or APJ letterhead, downloaded as
   a PDF: customer, date / time / venue, attendees on both sides, discussion
   points, action points and the next meeting. Admins can change the
   letterhead (name, address, phone, e-mail, GST) for both companies.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || '{}') || {}; } catch (e) { return {}; } }
  function isAdmin() { return ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(me().role) >= 0; }
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
  function download(path, name) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Download failed'); });
      return r.blob();
    }).then(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
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
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? (s || '') : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function today() { var x = new Date(); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }
  function toast(msg, kind) {
    document.querySelectorAll('.imx-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'imx-toast' + (kind === 'err' ? ' err' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }
  var people = null;
  function loadPeople() {
    if (people) return Promise.resolve(people);
    return api('GET', '/internal-meetings/people').then(function (j) { people = j.data.people || []; return people; });
  }

  function css() {
    if (document.getElementById('imx-css')) return;
    var st = document.createElement('style'); st.id = 'imx-css';
    st.textContent = [
      '.imx-wrap{max-width:1200px;margin:0 auto}',
      '.imx-head{display:flex;flex-wrap:wrap;gap:.7rem;align-items:flex-end;justify-content:space-between;margin-bottom:1rem}.imx-head h1{font-size:1.35rem;font-weight:700;margin:0}.imx-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.imx-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:.8rem}.dark .imx-card{background:#1e293b;border-color:#334155}',
      '.imx-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.9rem}',
      '.imx-in{border:1px solid #cbd5e1;border-radius:.5rem;padding:.42rem .6rem;font-size:.86rem;background:#fff;color:inherit;font-family:inherit;min-width:0;width:100%;box-sizing:border-box}',
      '.dark .imx-in{background:#0f172a;border-color:#334155}textarea.imx-in{resize:vertical;min-height:2.6rem}',
      '.imx-btn{display:inline-flex;align-items:center;gap:.3rem;border-radius:.55rem;padding:.45rem .9rem;font-size:.84rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.imx-btn.sm{padding:.22rem .55rem;font-size:.76rem}.imx-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.imx-btn.red{color:#b91c1c;border-color:#fecaca}.imx-btn.on{background:#1e3a8a;color:#fff;border-color:#1e3a8a}',
      '.dark .imx-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .imx-btn.pri,.dark .imx-btn.on{background:#2563eb;border-color:#2563eb;color:#fff}',
      '.imx-top{display:flex;flex-wrap:wrap;gap:.4rem .8rem;align-items:baseline;justify-content:space-between}',
      '.imx-top h3{margin:0;font-size:1rem;font-weight:700}.imx-sub{font-size:.76rem;color:#64748b}',
      '.imx-chips{display:flex;flex-wrap:wrap;gap:.3rem;margin:.45rem 0}.imx-chip{font-size:.72rem;padding:.08rem .5rem;border-radius:999px;background:#eff6ff;color:#1e40af}.dark .imx-chip{background:#1e3a8a;color:#dbeafe}',
      '.imx-h{font-size:.7rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin:.6rem 0 .25rem}',
      '.imx-points{margin:0;padding-left:1.4rem;list-style:decimal;font-size:.86rem;line-height:1.5}.imx-points li{white-space:pre-wrap}',
      '.imx-acts{width:100%;border-collapse:collapse;font-size:.84rem}.imx-acts td{padding:.35rem .4rem;border-top:1px solid #f1f5f9;vertical-align:top}.dark .imx-acts td{border-color:#334155}',
      '.imx-acts tr.done td.t{text-decoration:line-through;color:#94a3b8}.imx-late{color:#b91c1c;font-weight:600}',
      '.imx-badge{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.72rem;font-weight:700;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}',
      '.imx-empty{padding:2rem;text-align:center;color:#64748b}',
      '.imx-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:4vh 1rem;overflow:auto}',
      '.imx-dlg{background:#fff;border-radius:1rem;max-width:860px;width:100%;padding:1.2rem;box-sizing:border-box}.dark .imx-dlg{background:#1e293b}.imx-dlg h2{margin:0 0 .8rem;font-size:1.1rem}',
      '.imx-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.55rem}.imx-f{display:flex;flex-direction:column;gap:.2rem;min-width:0}.imx-f.w2{grid-column:span 2}.imx-f.w{grid-column:1/-1}',
      '.imx-f label,.imx-lab{font-size:.73rem;font-weight:600;color:#475569}.dark .imx-f label,.dark .imx-lab{color:#cbd5e1}',
      '@media(max-width:700px){.imx-grid{grid-template-columns:1fr 1fr}.imx-f.w2{grid-column:1/-1}}',
      '.imx-rows{display:flex;flex-direction:column;gap:.4rem}.imx-row{display:grid;gap:.4rem;align-items:start}',
      '.imx-row .x{border:none;background:none;color:#b91c1c;font-size:1rem;cursor:pointer;padding:.35rem}',
      '.imx-sec{border-top:1px solid #e2e8f0;margin-top:.9rem;padding-top:.7rem}.dark .imx-sec{border-color:#334155}',
      '.imx-sec-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem}.imx-sec-h b{font-size:.86rem}',
      '.imx-people{display:flex;flex-wrap:wrap;gap:.3rem .8rem;max-height:9rem;overflow:auto;border:1px solid #e2e8f0;border-radius:.5rem;padding:.5rem}.dark .imx-people{border-color:#334155}',
      '.imx-people label{display:flex;gap:.3rem;align-items:center;font-size:.82rem;font-weight:500;color:inherit}',
      '.imx-err{color:#b91c1c;font-size:.82rem;min-height:1rem;margin-top:.5rem}.imx-foot{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.6rem;flex-wrap:wrap}',
      '.imx-table{width:100%;border-collapse:collapse;font-size:.85rem}.imx-table th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.5rem;border-bottom:1px solid #e2e8f0;background:#f8fafc;white-space:nowrap}',
      '.dark .imx-table th{background:#0f172a;border-color:#334155}.imx-table td{padding:.5rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.dark .imx-table td{border-color:#334155}',
      '.imx-seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:.55rem;overflow:hidden}.imx-seg button{border:none;background:#fff;padding:.42rem 1rem;font-weight:700;cursor:pointer;font-size:.85rem;color:#334155}.imx-seg button.on{background:#1e3a8a;color:#fff}',
      '.dark .imx-seg{border-color:#334155}.dark .imx-seg button{background:#0f172a;color:#cbd5e1}.dark .imx-seg button.on{background:#2563eb;color:#fff}',
      '.imx-lh{display:flex;gap:.8rem;align-items:center;border:1px dashed #cbd5e1;border-radius:.6rem;padding:.55rem .7rem;margin-top:.5rem;font-size:.78rem;color:#475569}.imx-lh img{height:34px}.imx-lh b{display:block;color:#1e3a8a;font-size:.86rem}',
      '.dark .imx-lh{border-color:#334155;color:#cbd5e1}.dark .imx-lh b{color:#93c5fd}',
      '.imx-sugg{position:relative}.imx-sugg ul{position:absolute;z-index:5;left:0;right:0;top:100%;margin:.15rem 0 0;padding:.25rem;list-style:none;background:#fff;border:1px solid #cbd5e1;border-radius:.5rem;box-shadow:0 10px 24px rgba(15,23,42,.12);max-height:14rem;overflow:auto}',
      '.dark .imx-sugg ul{background:#0f172a;border-color:#334155}.imx-sugg li{padding:.35rem .5rem;border-radius:.35rem;cursor:pointer;font-size:.84rem}.imx-sugg li:hover{background:#eff6ff}.dark .imx-sugg li:hover{background:#1e293b}',
      '.imx-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s}',
      '.imx-toast.in{opacity:1;transform:translate(-50%,0)}.imx-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function modal(title, build) {
    var ov = el('div', { class: 'imx-modal' });
    var dlg = el('div', { class: 'imx-dlg', role: 'dialog', 'aria-modal': 'true' }, [el('h2', { text: title })]);
    ov.appendChild(dlg);
    function close() { ov.remove(); }
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    build(dlg, close);
    document.body.appendChild(ov);
    return close;
  }
  function field(label, input, cls) { return el('div', { class: 'imx-f' + (cls ? ' ' + cls : '') }, [el('label', { text: label }), input]); }
  function input(attrs) { return el('input', Object.assign({ class: 'imx-in' }, attrs || {})); }
  function area(attrs) { return el('textarea', Object.assign({ class: 'imx-in', rows: '2' }, attrs || {})); }

  /** A growable list of rows: make(values) → { node, get() }. */
  function rowList(container, make, initial, minRows) {
    var rows = [];
    function add(v) {
      var r = make(v || {}, function () { if (rows.length > (minRows || 0)) { r.node.remove(); rows.splice(rows.indexOf(r), 1); } });
      rows.push(r); container.appendChild(r.node); return r;
    }
    (initial && initial.length ? initial : Array(minRows || 1).fill(null)).forEach(function (v) { add(v); });
    return { add: add, values: function () { return rows.map(function (r) { return r.get(); }); } };
  }

  /* ══════════════════════════ internal meetings ══════════════════════════ */
  function mountInternal(root) {
    css();
    var st = { search: '', from: '', to: '', mine: false, list: [] };
    var listEl = el('div');
    var mineBtn = el('button', { class: 'imx-btn', id: 'im-mine', text: 'My open actions', onclick: function () { st.mine = !st.mine; mineBtn.classList.toggle('on', st.mine); load(); } });
    var search = input({ type: 'search', placeholder: 'Search topic, points, actions, IM no…', style: 'flex:1 1 240px;width:auto' });
    var tmr; search.addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(function () { st.search = search.value.trim(); load(); }, 300); });
    var from = input({ type: 'date', style: 'width:auto', 'aria-label': 'From' }), to = input({ type: 'date', style: 'width:auto', 'aria-label': 'To' });
    from.addEventListener('change', function () { st.from = from.value; load(); }); to.addEventListener('change', function () { st.to = to.value; load(); });
    root.appendChild(el('div', { class: 'imx-wrap' }, [
      el('div', { class: 'imx-head' }, [
        el('div', {}, [el('h1', { text: 'Internal meetings' }), el('p', { text: 'Team meeting reports: date, what was discussed and the next actions with owners and due dates.' })]),
        el('button', { class: 'imx-btn pri', id: 'im-new', text: '+ New meeting report', onclick: function () { openEditor(null); } })
      ]),
      el('div', { class: 'imx-bar' }, [search, from, el('span', { class: 'imx-sub', text: 'to' }), to, mineBtn]),
      listEl
    ]));

    function load() {
      var q = [];
      if (st.search) q.push('search=' + encodeURIComponent(st.search));
      if (st.from) q.push('from=' + st.from);
      if (st.to) q.push('to=' + st.to);
      if (st.mine) q.push('mine=1');
      api('GET', '/internal-meetings' + (q.length ? '?' + q.join('&') : '')).then(function (j) {
        st.list = j.data.meetings || [];
        mineBtn.textContent = 'My open actions' + (j.data.myOpenActions ? ' (' + j.data.myOpenActions + ')' : '');
        render();
      }).catch(function (e) { clear(listEl).appendChild(el('div', { class: 'imx-card imx-empty', text: e.message })); });
    }
    function canEdit(m) { return m.createdBy.id === me().id || isAdmin(); }
    function render() {
      clear(listEl);
      if (!st.list.length) { listEl.appendChild(el('div', { class: 'imx-card imx-empty', text: st.mine ? 'No open actions for you.' : 'No meeting reports yet — add the first one.' })); return; }
      var t = today();
      st.list.forEach(function (m) {
        var acts = el('table', { class: 'imx-acts' }, [el('tbody', {}, m.actions.map(function (a, i) {
          var mineAct = a.ownerId === me().id, can = mineAct || canEdit(m);
          var cb = el('input', { type: 'checkbox', 'data-act': m.id + ':' + i, 'aria-label': 'Done: ' + a.text });
          cb.checked = a.done; cb.disabled = !can;
          cb.addEventListener('change', function () {
            api('PATCH', '/internal-meetings/' + m.id + '/actions/' + i, { done: cb.checked }).then(function (j) { toast(j.message); load(); })
              .catch(function (e) { cb.checked = !cb.checked; toast(e.message, 'err'); });
          });
          var late = !a.done && a.dueDate && a.dueDate < t;
          return el('tr', { class: a.done ? 'done' : '' }, [
            el('td', { style: 'width:1.6rem' }, [cb]),
            el('td', { class: 't', text: a.text }),
            el('td', { style: 'white-space:nowrap' }, [el('span', { class: 'imx-sub', text: '👤 ' }), (a.ownerName || a.ownerText || '—') + (mineAct ? ' (you)' : '')]),
            el('td', { style: 'white-space:nowrap', class: late ? 'imx-late' : 'imx-sub', text: a.dueDate ? (late ? 'Overdue · ' : 'Due ') + dmy(a.dueDate) : '' }),
            el('td', { class: 'imx-sub', style: 'white-space:nowrap', text: a.done && a.doneAt ? '✓ ' + dmy(a.doneAt) : '' })
          ]);
        }))]);
        listEl.appendChild(el('div', { class: 'imx-card', 'data-meeting': m.id }, [
          el('div', { class: 'imx-top' }, [
            el('div', {}, [el('h3', { text: m.title }), el('div', { class: 'imx-sub', text: dmy(m.meetingDate) + (m.meetingTime ? ' · ' + m.meetingTime : '') + ' · ' + m.meetingNo + ' · by ' + m.createdBy.name })]),
            el('div', { style: 'display:flex;gap:.35rem;align-items:center' }, [
              m.actions.length ? el('span', { class: 'imx-badge', style: '--c:' + (m.openActions ? '#d97706' : '#16a34a'), text: m.openActions ? m.openActions + ' open action' + (m.openActions > 1 ? 's' : '') : 'All actions done' }) : null,
              canEdit(m) ? el('button', { class: 'imx-btn sm', 'data-edit': m.id, text: '✎ Edit', onclick: function () { openEditor(m); } }) : null,
              canEdit(m) ? el('button', { class: 'imx-btn sm red', text: 'Delete', onclick: function () {
                if (!confirm('Delete meeting report ' + m.meetingNo + '?')) return;
                api('DELETE', '/internal-meetings/' + m.id).then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
              } }) : null
            ])
          ]),
          m.attendees.length || m.otherAttendees ? el('div', { class: 'imx-chips' }, m.attendees.map(function (a) { return el('span', { class: 'imx-chip', text: a.name }); })
            .concat(m.otherAttendees ? [el('span', { class: 'imx-chip', style: 'background:#f1f5f9;color:#475569', text: m.otherAttendees })] : [])) : null,
          el('div', { class: 'imx-h', text: 'What we discussed' }),
          el('ol', { class: 'imx-points' }, m.points.map(function (p) { return el('li', { text: p }); })),
          m.actions.length ? el('div', { class: 'imx-h', text: 'Next actions' }) : null,
          m.actions.length ? acts : null,
          m.notes ? el('div', { class: 'imx-sub', style: 'margin-top:.5rem;white-space:pre-wrap', text: '📝 ' + m.notes }) : null
        ]));
      });
    }

    function openEditor(m) {
      loadPeople().then(function (ppl) {
        modal(m ? 'Edit meeting report · ' + m.meetingNo : 'New internal meeting report', function (dlg, close) {
          var date = input({ type: 'date', id: 'im-date', value: m ? m.meetingDate : today() });
          var time = input({ type: 'time', id: 'im-time', value: m ? (m.meetingTime || '') : '' });
          var title = input({ id: 'im-title', placeholder: 'e.g. Weekly sales review', value: m ? m.title : '' });
          var chosen = {}; (m ? m.attendees : []).forEach(function (a) { chosen[a.id] = 1; });
          var pbox = el('div', { class: 'imx-people', id: 'im-people' }, ppl.map(function (p) {
            var c = el('input', { type: 'checkbox', 'data-person': p.id }); c.checked = !!chosen[p.id];
            c.addEventListener('change', function () { if (c.checked) chosen[p.id] = 1; else delete chosen[p.id]; });
            return el('label', {}, [c, p.name]);
          }));
          var others = input({ id: 'im-others', placeholder: 'Others (not in the CRM), e.g. auditor', value: m ? (m.otherAttendees || '') : '' });
          var pointsBox = el('div', { class: 'imx-rows', id: 'im-points' });
          var points = rowList(pointsBox, function (v, remove) {
            var t = area({ 'data-point': '', placeholder: 'What was discussed / decided', value: typeof v === 'string' ? v : '' });
            return { node: el('div', { class: 'imx-row', style: 'grid-template-columns:1fr auto' }, [t, el('button', { class: 'x', type: 'button', title: 'Remove', text: '✕', onclick: remove })]), get: function () { return t.value.trim(); } };
          }, m ? m.points : null, 1);
          var actBox = el('div', { class: 'imx-rows', id: 'im-actions' });
          var actions = rowList(actBox, function (v, remove) {
            var t = input({ 'data-action-text': '', placeholder: 'Next action', value: v.text || '' });
            var o = el('select', { class: 'imx-in', 'data-action-owner': '' }, [el('option', { value: '', text: 'Owner…' })].concat(ppl.map(function (p) { return el('option', { value: p.id, text: p.name }); })));
            o.value = v.ownerId || '';
            var d = input({ type: 'date', 'data-action-due': '', value: v.dueDate || '' });
            return { node: el('div', { class: 'imx-row', style: 'grid-template-columns:minmax(0,3fr) minmax(0,1.4fr) minmax(0,1.1fr) auto' }, [t, o, d, el('button', { class: 'x', type: 'button', title: 'Remove', text: '✕', onclick: remove })]),
              get: function () { return { text: t.value.trim(), ownerId: o.value || null, dueDate: d.value || null, done: !!v.done }; } };
          }, m ? m.actions : null, 1);
          var notes = area({ id: 'im-notes', placeholder: 'Anything else (optional)', value: m ? (m.notes || '') : '' });
          var err = el('div', { class: 'imx-err' });
          var save = el('button', { class: 'imx-btn pri', id: 'im-save', text: m ? 'Save changes' : 'Save report' });
          save.addEventListener('click', function () {
            err.textContent = ''; save.disabled = true;
            var body = { meetingDate: date.value, meetingTime: time.value, title: title.value.trim(), attendeeIds: Object.keys(chosen), otherAttendees: others.value.trim(),
              points: points.values().filter(Boolean), actions: actions.values().filter(function (a) { return a.text; }), notes: notes.value.trim() };
            (m ? api('PUT', '/internal-meetings/' + m.id, body) : api('POST', '/internal-meetings', body)).then(function (j) { toast(j.message); close(); load(); })
              .catch(function (e) { err.textContent = e.message; save.disabled = false; });
          });
          dlg.appendChild(el('div', { class: 'imx-grid' }, [field('Meeting date *', date), field('Time', time), field('Topic *', title, 'w2')]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [el('div', { class: 'imx-sec-h' }, [el('b', { text: 'Attended' })]), pbox, el('div', { style: 'margin-top:.4rem' }, [others])]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [el('div', { class: 'imx-sec-h' }, [el('b', { text: 'What we discussed *' }), el('button', { class: 'imx-btn sm', type: 'button', id: 'im-add-point', text: '+ Add point', onclick: function () { points.add(''); } })]), pointsBox]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [el('div', { class: 'imx-sec-h' }, [el('b', { text: 'Next actions' }), el('button', { class: 'imx-btn sm', type: 'button', id: 'im-add-action', text: '+ Add action', onclick: function () { actions.add({}); } })]), actBox]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [field('Notes', notes, 'w')]));
          dlg.appendChild(err);
          dlg.appendChild(el('div', { class: 'imx-foot' }, [el('button', { class: 'imx-btn', type: 'button', text: 'Cancel', onclick: close }), save]));
          setTimeout(function () { title.focus(); }, 30);
        });
      }).catch(function (e) { toast(e.message, 'err'); });
    }
    load();
  }

  /* ══════════════════════════ MOM ══════════════════════════ */
  function mountMom(root) {
    css();
    var st = { search: '', company: '', list: [], profiles: null };
    var listEl = el('div', { class: 'imx-card', style: 'padding:0;overflow:auto' });
    var search = input({ type: 'search', placeholder: 'Search MOM no, customer, subject…', style: 'flex:1 1 240px;width:auto' });
    var tmr; search.addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(function () { st.search = search.value.trim(); load(); }, 300); });
    var coSel = el('select', { class: 'imx-in', style: 'width:auto' }, [el('option', { value: '', text: 'TMS + APJ' }), el('option', { value: 'TMS', text: 'TMS' }), el('option', { value: 'APJ', text: 'APJ' })]);
    coSel.addEventListener('change', function () { st.company = coSel.value; load(); });
    root.appendChild(el('div', { class: 'imx-wrap' }, [
      el('div', { class: 'imx-head' }, [
        el('div', {}, [el('h1', { text: 'MOM — minutes of meeting' }), el('p', { text: 'Customer meeting minutes on the TMS or APJ letterhead — save, then download the PDF.' })]),
        el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' }, [
          isAdmin() ? el('button', { class: 'imx-btn', id: 'mom-letterheads', text: '✎ Letterheads (address)', onclick: editLetterheads }) : null,
          el('button', { class: 'imx-btn pri', id: 'mom-new', text: '+ New MOM', onclick: function () { openEditor(null); } })
        ])
      ]),
      el('div', { class: 'imx-bar' }, [search, coSel]),
      listEl
    ]));

    function loadProfiles(force) {
      if (st.profiles && !force) return Promise.resolve(st.profiles);
      return api('GET', '/company-profiles').then(function (j) { st.profiles = j.data.profiles; return st.profiles; });
    }
    function load() {
      var q = [];
      if (st.search) q.push('search=' + encodeURIComponent(st.search));
      if (st.company) q.push('company=' + st.company);
      api('GET', '/mom' + (q.length ? '?' + q.join('&') : '')).then(function (j) { st.list = j.data.moms || []; render(); })
        .catch(function (e) { clear(listEl).appendChild(el('div', { class: 'imx-empty', text: e.message })); });
    }
    function fileName(m) { return (m.momNo + '-' + m.customerName).replace(/[^A-Za-z0-9]+/g, '-') + '.pdf'; }
    function viewPdf(m) {
      if (window.PdfView) PdfView.show(API + '/api/mom/' + m.id + '/pdf?inline=1', { title: m.momNo, fileName: fileName(m) });
      else download('/mom/' + m.id + '/pdf', fileName(m)).catch(function (e) { toast(e.message, 'err'); });
    }
    function render() {
      clear(listEl);
      if (!st.list.length) { listEl.appendChild(el('div', { class: 'imx-empty', text: 'No MOM yet — create the first one.' })); return; }
      listEl.appendChild(el('table', { class: 'imx-table' }, [
        el('thead', {}, [el('tr', {}, ['MOM no.', 'Date', 'Customer', 'Subject', 'Points', 'By', ''].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, st.list.map(function (m) {
          return el('tr', { 'data-mom': m.id }, [
            el('td', { style: 'white-space:nowrap' }, [el('span', { class: 'imx-badge', style: '--c:' + (m.company === 'APJ' ? '#0f766e' : '#1e40af'), text: m.company }), ' ', el('b', { text: m.momNo })]),
            el('td', { style: 'white-space:nowrap', text: dmy(m.meetingDate) }),
            el('td', { text: m.customerName }),
            el('td', { text: m.subject || '—' }),
            el('td', { class: 'imx-sub', text: m.points.length + ' points · ' + m.actions.length + ' actions' }),
            el('td', { class: 'imx-sub', text: m.createdBy.name }),
            el('td', { style: 'white-space:nowrap;text-align:right' }, [
              el('button', { class: 'imx-btn sm', 'data-pdf': m.id, text: '📄 PDF', onclick: function () { viewPdf(m); } }), ' ',
              el('button', { class: 'imx-btn sm', 'data-dl': m.id, title: 'Download PDF', text: '⬇', onclick: function () { download('/mom/' + m.id + '/pdf', fileName(m)).catch(function (e) { toast(e.message, 'err'); }); } }), ' ',
              el('button', { class: 'imx-btn sm', 'data-edit': m.id, text: '✎ Edit', onclick: function () { openEditor(m); } }), ' ',
              el('button', { class: 'imx-btn sm red', text: 'Delete', onclick: function () {
                if (!confirm('Delete ' + m.momNo + '?')) return;
                api('DELETE', '/mom/' + m.id).then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, 'err'); });
              } })
            ])
          ]);
        }))
      ]));
    }

    function letterhead(p, code) {
      var lines = String(p.address || '').split('\n').map(function (l) { return l.trim().replace(/,$/, ''); }).filter(Boolean).join(', ');
      return el('div', { class: 'imx-lh', 'data-letterhead': code }, [
        el('img', { src: '/brand/' + (code === 'APJ' ? 'apj' : 'tms') + '-logo.png', alt: code }),
        el('div', {}, [el('b', { text: p.name }), el('span', { text: lines }), el('div', { class: 'imx-sub', text: [p.phone, p.email, p.gstin ? 'GST ' + p.gstin : ''].filter(Boolean).join(' · ') })])
      ]);
    }

    function editLetterheads() {
      loadProfiles(true).then(function (pr) {
        modal('Letterheads — company name and address', function (dlg, close) {
          ['TMS', 'APJ'].forEach(function (code) {
            var p = pr[code];
            var f = { name: input({ value: p.name || '', 'data-lh-name': code }), address: area({ value: p.address || '', rows: '3', 'data-lh-address': code }),
              phone: input({ value: p.phone || '', 'data-lh-phone': code }), email: input({ value: p.email || '', 'data-lh-email': code }), gstin: input({ value: p.gstin || '', 'data-lh-gstin': code }) };
            var err = el('div', { class: 'imx-err' });
            var save = el('button', { class: 'imx-btn pri sm', 'data-lh-save': code, text: 'Save ' + code + ' letterhead' });
            save.addEventListener('click', function () {
              err.textContent = ''; save.disabled = true;
              api('PUT', '/company-profiles/' + code, { name: f.name.value.trim(), address: f.address.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), gstin: f.gstin.value.trim() })
                .then(function (j) { toast(j.message); st.profiles = null; save.disabled = false; })
                .catch(function (e) { err.textContent = e.message; save.disabled = false; });
            });
            dlg.appendChild(el('div', { class: 'imx-sec' }, [
              el('div', { class: 'imx-sec-h' }, [el('b', { text: code }), save]),
              el('div', { class: 'imx-grid' }, [field('Company name', f.name, 'w'), field('Address (one line per row)', f.address, 'w'), field('Phone', f.phone, 'w2'), field('E-mail', f.email), field('GST no.', f.gstin)]),
              err
            ]));
          });
          dlg.appendChild(el('p', { class: 'imx-sub', text: 'Used on every MOM and purchase order PDF of that company.' }));
          dlg.appendChild(el('div', { class: 'imx-foot' }, [el('button', { class: 'imx-btn', text: 'Close', onclick: close })]));
        });
      }).catch(function (e) { toast(e.message, 'err'); });
    }

    function openEditor(m) {
      Promise.all([loadProfiles(), loadPeople()]).then(function (res) {
        var pr = res[0], ppl = res[1];
        modal(m ? 'Edit ' + m.momNo : 'New MOM', function (dlg, close) {
          var co = m ? m.company : 'TMS';
          var lhBox = el('div');
          var seg = el('div', { class: 'imx-seg', role: 'group', 'aria-label': 'Company' });
          ['TMS', 'APJ'].forEach(function (c) {
            seg.appendChild(el('button', { type: 'button', 'data-co': c, class: c === co ? 'on' : '', text: c, onclick: function () {
              co = c; seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-co') === c); });
              clear(lhBox).appendChild(letterhead(pr[c], c));
            } }));
          });
          lhBox.appendChild(letterhead(pr[co], co));
          var custId = m ? m.customerId : null;
          var cust = input({ id: 'mom-customer', placeholder: 'Type to search customers…', autocomplete: 'off', value: m ? m.customerName : '' });
          var addr = area({ id: 'mom-address', placeholder: 'Customer address (optional)', value: m ? (m.customerAddress || '') : '' });
          var sugg = el('ul', { style: 'display:none' });
          var ct;
          cust.addEventListener('input', function () {
            custId = null; clearTimeout(ct);
            var q = cust.value.trim();
            if (q.length < 2) { sugg.style.display = 'none'; return; }
            ct = setTimeout(function () {
              api('GET', '/customers?limit=8&search=' + encodeURIComponent(q)).then(function (j) {
                var items = (j.data && j.data.items) || [];
                clear(sugg); sugg.style.display = items.length ? '' : 'none';
                items.forEach(function (c) {
                  sugg.appendChild(el('li', { text: c.companyName + (c.city ? ' · ' + c.city : ''), onmousedown: function (e) {
                    e.preventDefault(); custId = c.id; cust.value = c.companyName;
                    if (!addr.value.trim()) addr.value = [c.address, [c.city, c.state].filter(Boolean).join(', '), c.pincode].filter(Boolean).join('\n');
                    sugg.style.display = 'none';
                  } }));
                });
              }).catch(function () { sugg.style.display = 'none'; });
            }, 250);
          });
          cust.addEventListener('blur', function () { setTimeout(function () { sugg.style.display = 'none'; }, 150); });
          var date = input({ type: 'date', id: 'mom-date', value: m ? m.meetingDate : today() });
          var time = input({ id: 'mom-time', placeholder: 'e.g. 11:00 am – 12:30 pm', value: m ? (m.meetingTime || '') : '' });
          var venue = input({ id: 'mom-venue', placeholder: 'e.g. Customer plant, Hosur', value: m ? (m.venue || '') : '' });
          var subject = input({ id: 'mom-subject', placeholder: 'e.g. Trial review of milling inserts', value: m ? (m.subject || '') : '' });
          var dl = el('datalist', { id: 'mom-people' }, ppl.map(function (p) { return el('option', { value: p.name }); }));
          function personRows(box, init, prefix, ours) {
            return rowList(box, function (v, remove) {
              var n = input({ placeholder: 'Name', value: v.name || '', list: ours ? 'mom-people' : null, 'data-person-name': prefix });
              var d = input({ placeholder: 'Designation', value: v.designation || '', 'data-person-desig': prefix });
              return { node: el('div', { class: 'imx-row', style: 'grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto' }, [n, d, el('button', { class: 'x', type: 'button', text: '✕', title: 'Remove', onclick: remove })]),
                get: function () { return { name: n.value.trim(), designation: d.value.trim() }; } };
            }, init, 1);
          }
          var clientBox = el('div', { class: 'imx-rows', id: 'mom-client' }), ourBox = el('div', { class: 'imx-rows', id: 'mom-ours' });
          var me0 = me();
          var client = personRows(clientBox, m ? m.clientAttendees : null, 'client', false);
          var ours = personRows(ourBox, m ? m.ourAttendees : [{ name: me0.name || '', designation: '' }], 'ours', true);
          var pointsBox = el('div', { class: 'imx-rows', id: 'mom-points' });
          var points = rowList(pointsBox, function (v, remove) {
            var t = input({ placeholder: 'Topic', value: v.topic || '', 'data-point-topic': '' });
            var d = area({ placeholder: 'Discussion / decision', value: v.discussion || '', 'data-point-disc': '' });
            return { node: el('div', { class: 'imx-row', style: 'grid-template-columns:minmax(0,1fr) minmax(0,2.2fr) auto' }, [t, d, el('button', { class: 'x', type: 'button', text: '✕', title: 'Remove', onclick: remove })]),
              get: function () { return { topic: t.value.trim(), discussion: d.value.trim() }; } };
          }, m ? m.points : null, 1);
          var actBox = el('div', { class: 'imx-rows', id: 'mom-actions' });
          var actions = rowList(actBox, function (v, remove) {
            var a = input({ placeholder: 'Action', value: v.action || '', 'data-mom-action': '' });
            var r = input({ placeholder: 'Responsibility', value: v.responsibility || '', list: 'mom-people', 'data-mom-resp': '' });
            var d = input({ type: 'date', value: /^\d{4}-\d{2}-\d{2}$/.test(v.target || '') ? v.target : '', 'data-mom-target': '' });
            return { node: el('div', { class: 'imx-row', style: 'grid-template-columns:minmax(0,2.4fr) minmax(0,1.2fr) minmax(0,1fr) auto' }, [a, r, d, el('button', { class: 'x', type: 'button', text: '✕', title: 'Remove', onclick: remove })]),
              get: function () { return { action: a.value.trim(), responsibility: r.value.trim(), target: d.value }; } };
          }, m ? m.actions : null, 1);
          var next = input({ type: 'date', id: 'mom-next', value: m ? (m.nextMeetingDate || '') : '' });
          var remarks = area({ id: 'mom-remarks', placeholder: 'Remarks (optional)', value: m ? (m.remarks || '') : '' });
          var err = el('div', { class: 'imx-err' });
          function body() {
            return { company: co, customerId: custId, customerName: cust.value.trim(), customerAddress: addr.value.trim(), meetingDate: date.value, meetingTime: time.value.trim(),
              venue: venue.value.trim(), subject: subject.value.trim(), clientAttendees: client.values().filter(function (p) { return p.name; }),
              ourAttendees: ours.values().filter(function (p) { return p.name; }), points: points.values().filter(function (p) { return p.topic || p.discussion; }),
              actions: actions.values().filter(function (a) { return a.action; }), nextMeetingDate: next.value, remarks: remarks.value.trim() };
          }
          function submit(thenPdf) {
            err.textContent = ''; saveBtn.disabled = pdfBtn.disabled = true;
            (m ? api('PUT', '/mom/' + m.id, body()) : api('POST', '/mom', body())).then(function (j) {
              toast(j.message); close(); load();
              if (thenPdf) viewPdf(j.data.mom);
            }).catch(function (e) { err.textContent = e.message; saveBtn.disabled = pdfBtn.disabled = false; });
          }
          var saveBtn = el('button', { class: 'imx-btn', id: 'mom-save', text: 'Save', onclick: function () { submit(false); } });
          var pdfBtn = el('button', { class: 'imx-btn pri', id: 'mom-save-pdf', text: 'Save & open PDF', onclick: function () { submit(true); } });
          dlg.appendChild(dl);
          dlg.appendChild(el('div', {}, [el('span', { class: 'imx-lab', text: 'Letterhead  ' }), seg, lhBox]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [el('div', { class: 'imx-grid' }, [
            field('Customer *', el('div', { class: 'imx-sugg' }, [cust, sugg]), 'w2'), field('Meeting date *', date), field('Time', time),
            field('Customer address', addr, 'w2'), field('Venue', venue, 'w2'), field('Subject', subject, 'w')
          ])]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [el('div', { class: 'imx-grid' }, [
            el('div', { class: 'imx-f w2' }, [el('div', { class: 'imx-sec-h' }, [el('b', { text: 'Customer attendees' }), el('button', { class: 'imx-btn sm', type: 'button', text: '+ Add', onclick: function () { client.add({}); } })]), clientBox]),
            el('div', { class: 'imx-f w2' }, [el('div', { class: 'imx-sec-h' }, [el('b', { text: 'Our attendees' }), el('button', { class: 'imx-btn sm', type: 'button', text: '+ Add', onclick: function () { ours.add({}); } })]), ourBox])
          ])]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [el('div', { class: 'imx-sec-h' }, [el('b', { text: 'Points discussed *' }), el('button', { class: 'imx-btn sm', type: 'button', id: 'mom-add-point', text: '+ Add point', onclick: function () { points.add({}); } })]), pointsBox]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [el('div', { class: 'imx-sec-h' }, [el('b', { text: 'Action points' }), el('button', { class: 'imx-btn sm', type: 'button', id: 'mom-add-action', text: '+ Add action', onclick: function () { actions.add({}); } })]), actBox]));
          dlg.appendChild(el('div', { class: 'imx-sec' }, [el('div', { class: 'imx-grid' }, [field('Next meeting', next), field('Remarks', remarks, 'w2')])]));
          dlg.appendChild(err);
          dlg.appendChild(el('div', { class: 'imx-foot' }, [el('button', { class: 'imx-btn', type: 'button', text: 'Cancel', onclick: close }), saveBtn, pdfBtn]));
        });
      }).catch(function (e) { toast(e.message, 'err'); });
    }
    load();
  }

  window.InternalMeetingsPage = { mountPage: mountInternal };
  window.MomPage = { mountPage: mountMom };
})();
