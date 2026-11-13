/* ══════════════════════════════════════════════════════════════════════
   quote-mail.js — e-mail a quotation (v11.52). Loaded on /quotations/ only.

   ✉ E-mail on every saved quotation (TMS and APJ):
     • the mail is pre-written in the company's wording (Quotation, or Quotation
       confirmation) — To / CC / subject / text can all be changed
     • the quotation PDF is attached; tick catalogues to attach as well
     • it goes to a Manager / Admin / Super Admin for approval first. They check it
       (and can still correct it), then "Approve & send" e-mails it — or send it back
       with a note.
   Approvers see "✉ N mails to approve" at the top of the page (#mail-approvals).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__quoteMail || !/^\/quotations\/?/.test(location.pathname)) return;
  window.__quoteMail = true;
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token') || ''; } catch (e) { return ''; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  var APPROVER = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(me().role) !== -1;
  function api(method, path, body) {
    var h = { Authorization: 'Bearer ' + token() };
    if (body) h['Content-Type'] = 'application/json';
    return fetch(API + '/api' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) { var e = new Error((j && j.message) || 'Request failed (' + r.status + ')'); e.data = j; throw e; } return j; });
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function toast(msg, bad) {
    var t = document.getElementById('qm-toast') || document.body.appendChild(el('div', { id: 'qm-toast' }));
    t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.opacity = '1';
    clearTimeout(t._t); t._t = setTimeout(function () { t.style.opacity = '0'; }, 4500);
  }
  function dt(s) { if (!s) return ''; var d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  var ST = { PENDING: ['Waiting for approval', '#b45309', '#fef3c7'], REJECTED: ['Sent back', '#b91c1c', '#fee2e2'], APPROVED: ['Approved — open in mail app', '#1d4ed8', '#dbeafe'], SENT: ['E-mailed', '#047857', '#d1fae5'], FAILED: ['Not sent — error', '#b91c1c', '#fee2e2'] };
  function badge(s) { var x = ST[s] || [s, '#475569', '#e2e8f0']; return el('span', { class: 'qm-badge', 'data-qm-status': s, style: 'color:' + x[1] + ';background:' + x[2], text: x[0] }); }

  (function css() {
    var st = document.createElement('style');
    st.textContent = [
      '#qm-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f766e;color:#fff;padding:10px 18px;border-radius:10px;font:600 14px system-ui;z-index:2147483600;opacity:0;transition:opacity .3s;max-width:90vw}',
      '#qm-toast.bad{background:#b91c1c}',
      '.qm-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:20px 10px}',
      '.qm-dlg{background:#fff;color:#0f172a;border-radius:14px;width:100%;max-width:820px;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.3);font:14px system-ui,sans-serif}',
      '.dark .qm-dlg{background:#0f172a;color:#e2e8f0}',
      '.qm-dlg h3{margin:0 0 4px;font-size:18px}.qm-dlg .sub{color:#64748b;font-size:12.5px;margin-bottom:12px}',
      '.qm-row{display:grid;grid-template-columns:70px 1fr;gap:8px;align-items:center;margin:6px 0}.qm-row label{font-weight:600;color:#475569;font-size:13px}',
      '.qm-dlg input[type=text],.qm-dlg input[type=email],.qm-dlg textarea,.qm-dlg input[type=search]{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font:14px system-ui;background:transparent;color:inherit}',
      '.qm-dlg textarea{min-height:300px;line-height:1.45;resize:vertical;font-family:system-ui,sans-serif}',
      '.qm-kinds{display:flex;gap:6px;margin-bottom:8px}.qm-kinds button{border:1px solid #cbd5e1;background:transparent;border-radius:999px;padding:5px 12px;font:600 13px system-ui;cursor:pointer;color:inherit}',
      '.qm-kinds button.on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}',
      '.qm-att{border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin-top:10px}.qm-att h4{margin:0 0 6px;font-size:13px}',
      '.qm-cats{max-height:170px;overflow:auto;margin-top:6px}.qm-cats label{display:flex;gap:8px;align-items:center;padding:3px 2px;font-size:13px;cursor:pointer}.qm-cats small{color:#64748b;margin-left:auto}',
      '.qm-btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}',
      '.qm-btn{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;padding:8px 14px;font:600 13.5px system-ui;cursor:pointer}',
      '.qm-btn.pri{background:#1e3a5f;border-color:#1e3a5f;color:#fff}.qm-btn.ok{background:#047857;border-color:#047857;color:#fff}.qm-btn.no{color:#b91c1c;border-color:#fca5a5}',
      '.qm-btn:disabled{opacity:.55;cursor:wait}',
      '.qm-badge{display:inline-block;border-radius:999px;padding:1px 8px;font:600 11.5px system-ui;margin-left:6px;vertical-align:middle}',
      '.qm-note{background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 10px;font-size:13px;margin:8px 0}',
      '.qm-hist{margin-top:12px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:12.5px;color:#475569}.qm-hist div{padding:2px 0}',
      '#mail-approvals{margin:10px auto 0;max-width:1200px;padding:0 12px}',
      '#mail-approvals .qm-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:10px 14px;font:600 14px system-ui;color:#9a3412;cursor:pointer}',
      '#mail-approvals .qm-list{background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-top:6px;overflow:hidden}',
      '#mail-approvals .qm-item{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-top:1px solid #f1f5f9;font:13.5px system-ui;color:#0f172a}',
      '#mail-approvals .qm-item:first-child{border-top:0}#mail-approvals .qm-item .grow{flex:1;min-width:220px}#mail-approvals .qm-item small{color:#64748b;display:block}'
    ].join('\n');
    document.head.appendChild(st);
  })();

  // ── the mail dialog: new mail for a quotation, or review / correct an existing one ──
  function openMail(opt) {
    // opt: { quotationId } for a new mail, or { mail } to review / edit one
    var modal = el('div', { class: 'qm-modal' }), dlg = el('div', { class: 'qm-dlg', id: 'qm-dlg' });
    modal.appendChild(dlg);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    dlg.appendChild(el('div', { text: 'Loading…' }));
    var M = opt.mail || null, kind = M ? M.kind : 'QUOTATION', qid = M ? M.quotationId : opt.quotationId;
    var state = { cats: [], selected: {}, canApprove: APPROVER, info: null, driver: '' };
    if (M) (M.catalogueIds || []).forEach(function (id) { state.selected[id] = 1; });
    function load(k) {
      return api('GET', '/quote-mail/draft?quotationId=' + encodeURIComponent(qid) + '&kind=' + k).then(function (j) {
        state.cats = j.data.catalogues || []; state.canApprove = j.data.canApprove; state.info = j.data.quotation; state.driver = j.data.driver;
        return j.data.draft;
      });
    }
    var F = {};
    function draw(d) {
      dlg.innerHTML = '';
      if (M && (M.status === 'APPROVED' || M.status === 'SENT')) { sendPanel(dlg, M, function () { modal.remove(); refresh(); }); return; }
      var Q = state.info || {};
      dlg.appendChild(el('h3', { text: '✉ E-mail ' + (Q.quotationNumber || M && M.quotationNumber || '') }));
      dlg.appendChild(el('div', { class: 'sub', text: (Q.customer || (M && M.customer) || '') + ' · ' + (Q.company || (M && M.company) || '') + (M ? ' · by ' + (M.requestedBy || '') : '') }));
      if (M && M.status === 'REJECTED' && M.reviewNote) dlg.appendChild(el('div', { class: 'qm-note', 'data-qm-reject-note': '1', text: '✖ Sent back by ' + (M.reviewedBy || 'the approver') + ': ' + M.reviewNote + ' — correct it and send again.' }));
      if (M && M.status === 'FAILED' && M.sendError) dlg.appendChild(el('div', { class: 'qm-note', style: 'background:#fee2e2;color:#991b1b', text: '⚠ Could not be sent: ' + M.sendError }));
      if (!M) {
        var kinds = el('div', { class: 'qm-kinds' });
        [['QUOTATION', 'Quotation mail'], ['CONFIRMATION', 'Quotation confirmation']].forEach(function (x) {
          kinds.appendChild(el('button', { type: 'button', class: x[0] === kind ? 'on' : '', 'data-qm-kind': x[0], text: x[1], onclick: function () {
            if (x[0] === kind) return;
            kind = x[0]; load(kind).then(draw).catch(function (e) { toast(e.message, true); });
          } }));
        });
        dlg.appendChild(kinds);
      } else dlg.appendChild(el('div', { class: 'sub', style: 'margin-top:-6px', text: M.kindLabel }));
      function row(label, input) { dlg.appendChild(el('div', { class: 'qm-row' }, [el('label', { text: label }), input])); return input; }
      F.to = row('To', el('input', { type: 'text', id: 'qm-to', value: d.to || '', placeholder: 'customer@company.com (several: separate with commas)' }));
      F.cc = row('CC', el('input', { type: 'text', id: 'qm-cc', value: d.cc || '', placeholder: 'optional' }));
      F.subject = row('Subject', el('input', { type: 'text', id: 'qm-subject', value: d.subject || '' }));
      F.body = el('textarea', { id: 'qm-body' }); F.body.value = d.body || '';
      dlg.appendChild(F.body);
      // attachments
      var att = el('div', { class: 'qm-att' });
      F.pdf = el('input', { type: 'checkbox', id: 'qm-pdf' }); F.pdf.checked = d.attachPdf !== false;
      att.appendChild(el('h4', { text: '📎 Attachments' }));
      att.appendChild(el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:13px' }, [F.pdf, 'Quotation PDF (' + ((Q.quotationNumber || (M && M.quotationNumber) || '').replace(/\//g, '-')) + '.pdf)']));
      var srch = el('input', { type: 'search', placeholder: 'Find a catalogue (brand / title)…', style: 'margin-top:8px' });
      var box = el('div', { class: 'qm-cats', id: 'qm-cats' });
      function cats() {
        box.innerHTML = '';
        var q = srch.value.toLowerCase(), shown = 0;
        state.cats.forEach(function (c) {
          var hay = ((c.brand || '') + ' ' + (c.title || '') + ' ' + (c.docType || '')).toLowerCase();
          if (q && hay.indexOf(q) === -1 && !state.selected[c.id]) return;
          if (++shown > 200) return;
          var cb = el('input', { type: 'checkbox', 'data-qm-cat': c.id }); cb.checked = !!state.selected[c.id];
          cb.onchange = function () { if (cb.checked) state.selected[c.id] = 1; else delete state.selected[c.id]; };
          box.appendChild(el('label', {}, [cb, (c.isLink ? '🔗 ' : '📘 ') + (c.brand ? c.brand + ' — ' : '') + c.title, el('small', { text: c.isLink ? 'link in the mail' : kb(c.size || 0) })]));
        });
        if (!state.cats.length) box.appendChild(el('div', { style: 'color:#64748b;font-size:12.5px', text: 'No catalogues uploaded yet (Catalogues & documents page).' }));
      }
      srch.oninput = cats; cats();
      att.appendChild(el('div', { style: 'font-size:12.5px;color:#64748b;margin-top:6px', text: 'Catalogues (optional):' }));
      att.appendChild(srch); att.appendChild(box);
      dlg.appendChild(att);
      dlg.appendChild(el('div', { class: 'sub', style: 'margin:10px 0 0', text: state.canApprove
        ? 'You can approve: then it opens in Gmail / Outlook with everything filled in — you press Send there.'
        : 'It goes to a Manager / Admin / Super Admin for approval. Once approved you get an alert, open it here and it opens in Gmail / Outlook to send.' }));
      var btns = el('div', { class: 'qm-btns' });
      btns.appendChild(el('button', { type: 'button', class: 'qm-btn', text: 'Cancel', onclick: function () { modal.remove(); } }));
      if (state.canApprove && !M) btns.appendChild(el('button', { type: 'button', class: 'qm-btn', 'data-qm-save-tpl': '1', title: 'Use this subject and text as the standard wording for every ' + (Q.company || '') + ' ' + (kind === 'QUOTATION' ? 'quotation' : 'confirmation') + ' mail', text: '☆ Save as standard wording', onclick: saveTpl }));
      if (M && state.canApprove && M.status !== 'SENT') {
        btns.appendChild(el('button', { type: 'button', class: 'qm-btn no', 'data-qm-reject': '1', text: '✖ Send back…', onclick: reject }));
        btns.appendChild(el('button', { type: 'button', class: 'qm-btn ok', 'data-qm-approve': '1', text: '✔ Approve', onclick: function (e) { submit(e.target, 'approve'); } }));
      } else if (M) {
        btns.appendChild(el('button', { type: 'button', class: 'qm-btn pri', 'data-qm-resubmit': '1', text: 'Save & send for approval again', onclick: function (e) { submit(e.target, 'update'); } }));
      } else {
        btns.appendChild(el('button', { type: 'button', class: 'qm-btn pri', 'data-qm-request': '1', text: 'Send for approval', onclick: function (e) { submit(e.target, 'request'); } }));
        if (state.canApprove) btns.appendChild(el('button', { type: 'button', class: 'qm-btn ok', 'data-qm-sendnow': '1', text: '✔ Approve & open mail app', onclick: function (e) { submit(e.target, 'sendNow'); } }));
      }
      dlg.appendChild(btns);
      var hist = el('div', { class: 'qm-hist' });
      dlg.appendChild(hist);
      api('GET', '/quote-mail?quotationId=' + encodeURIComponent(qid)).then(function (j) {
        var rows = (j.data.mails || []).filter(function (m) { return !M || m.id !== M.id; });
        if (!rows.length) return;
        hist.appendChild(el('b', { text: 'Earlier mails for this quotation' }));
        rows.forEach(function (m) { hist.appendChild(el('div', {}, [m.kindLabel + ' → ' + m.toEmails + ' · ' + dt(m.sentAt || m.createdAt), badge(m.status)])); });
      }).catch(function () {});
    }
    function payload() {
      return { quotationId: qid, kind: kind, to: F.to.value, cc: F.cc.value, subject: F.subject.value, body: F.body.value, attachPdf: F.pdf.checked, catalogueIds: Object.keys(state.selected) };
    }
    function submit(btn, how) {
      var p = payload();
      if (!p.to.trim()) { toast('Enter the customer’s e-mail address (To).', true); F.to.focus(); return; }
      btn.disabled = true; var old = btn.textContent; btn.textContent = how === 'request' || how === 'update' ? 'Sending…' : 'Approving…';
      var call = how === 'approve' ? api('POST', '/quote-mail/' + M.id + '/approve', p)
        : how === 'update' ? api('PUT', '/quote-mail/' + M.id, p)
        : api('POST', '/quote-mail', Object.assign(p, { sendNow: how === 'sendNow' }));
      call.then(function (j) {
        toast(j.message || 'Done');
        var mm = j.data && j.data.mail;
        // my own mail approved now → straight to the mail app
        if (mm && mm.status === 'APPROVED' && (how === 'sendNow' || mm.requestedById === me().id)) { M = mm; draw(); refresh(); return; }
        modal.remove();
        refresh();
      }).catch(function (e) { btn.disabled = false; btn.textContent = old; toast(e.message, true); if (e.data && e.data.errors && e.data.errors.mail) refresh(); });
    }
    function reject() {
      var note = prompt('What should be corrected? (sent to ' + (M.requestedBy || 'the person') + ')');
      if (note == null) return;
      if (!note.trim()) { toast('Write what should be corrected.', true); return; }
      api('POST', '/quote-mail/' + M.id + '/reject', { note: note }).then(function (j) { modal.remove(); toast(j.message); refresh(); }).catch(function (e) { toast(e.message, true); });
    }
    function saveTpl() {
      var co = (state.info && state.info.company) || 'TMS';
      if (!confirm('Use this subject and text as the standard ' + co + ' ' + (kind === 'QUOTATION' ? 'quotation' : 'confirmation') + ' mail?\n\nTip: the customer name / number etc. in it will be the same for every mail — better to use the placeholders like {attn}, {quotationNo}, {total}.')) return;
      api('PUT', '/quote-mail/templates', { company: co, kind: kind, subject: F.subject.value, body: F.body.value }).then(function (j) { toast(j.message); }).catch(function (e) { toast(e.message, true); });
    }
    if (M) load(M.kind).then(function () { draw({ to: M.toEmails, cc: M.ccEmails || '', subject: M.subject, body: M.body, attachPdf: M.attachPdf }); }).catch(function (e) { toast(e.message, true); modal.remove(); });
    else load(kind).then(draw).catch(function (e) { toast(e.message, true); modal.remove(); });
  }

  // ── approved mail → Gmail / Outlook with everything filled in; the person presses Send there ──
  function isPhoneApp() { return !!(window.CRMNative && typeof window.CRMNative.composeMail === 'function'); }
  function downloadFile(M, n, name) {
    return fetch(API + '/api/quote-mail/' + M.id + '/file/' + n, { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { if (!r.ok) throw new Error('Could not get ' + name); return r.blob(); })
      .then(function (b) { var u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 30000); });
  }
  function sendPanel(dlg, M, done) {
    dlg.innerHTML = '';
    dlg.appendChild(el('h3', { text: '✉ ' + M.kindLabel + ' — ' + M.quotationNumber }));
    dlg.appendChild(el('div', { class: 'sub', text: (M.customer || '') + ' · approved by ' + (M.reviewedBy || '—') + (M.status === 'SENT' ? ' · e-mailed ' + dt(M.sentAt) : '') }));
    var info = el('div', { class: 'qm-att', id: 'qm-send-panel' }, [el('div', { text: 'Loading…' })]);
    dlg.appendChild(info);
    var btns = el('div', { class: 'qm-btns' });
    dlg.appendChild(btns);
    api('GET', '/quote-mail/' + M.id + '/compose').then(function (j) {
      var c = j.data.compose; info.innerHTML = '';
      function line(l, v) { info.appendChild(el('div', { class: 'qm-row' }, [el('label', { text: l }), el('div', { text: v || '—' })])); }
      line('To', c.to.join(', ')); line('CC', c.cc.join(', ')); line('Subject', c.subject);
      info.appendChild(el('pre', { id: 'qm-final-body', style: 'white-space:pre-wrap;font:13.5px system-ui;background:rgba(148,163,184,.1);border-radius:8px;padding:10px;margin:8px 0;max-height:260px;overflow:auto', text: c.body }));
      info.appendChild(el('div', { style: 'font-size:13px' }, ['📎 ', c.files.length ? c.files.map(function (f) { return f.name; }).join(', ') : 'No attachments']));
      var phone = isPhoneApp();
      info.appendChild(el('p', { class: 'sub', style: 'margin:8px 0 0', text: phone
        ? 'Opens Gmail / Outlook (choose one) with To, CC, subject, text and the attachments filled in — check it and press Send there.'
        : 'Opens the mail with To, CC, subject and text filled in. A link cannot carry files, so the attachments are downloaded — drag them into the mail, then press Send.' }));
      function opened() {
        var mark = btns.querySelector('[data-qm-mark-sent]');
        if (mark) { mark.classList.add('ok'); mark.style.outline = '3px solid #86efac'; }
      }
      function enc(x) { return encodeURIComponent(x); }
      var to = c.to.join(','), cc = c.cc.join(',');
      btns.appendChild(el('button', { type: 'button', class: 'qm-btn', text: 'Close', onclick: done }));
      if (phone) {
        btns.appendChild(el('button', { type: 'button', class: 'qm-btn pri', 'data-qm-open-app': '1', text: '✉ Open in mail app (Gmail / Outlook)', onclick: function (e) {
          var b = e.target; b.disabled = true; b.textContent = 'Opening…';
          api('GET', '/quote-mail/' + M.id + '/compose?files=1').then(function (k) {
            window.CRMNative.composeMail(JSON.stringify(k.data.compose));
            b.disabled = false; b.textContent = '✉ Open in mail app again'; opened();
          }).catch(function (x) { b.disabled = false; b.textContent = '✉ Open in mail app (Gmail / Outlook)'; toast(x.message, true); });
        } }));
      } else {
        var dl = function () { c.files.reduce(function (p, f, n) { return p.then(function () { return downloadFile(M, n, f.name); }); }, Promise.resolve()).catch(function (x) { toast(x.message, true); }); };
        var go = function (url) { return function () { window.open(url, '_blank'); dl(); opened(); }; };
        btns.appendChild(el('button', { type: 'button', class: 'qm-btn pri', 'data-qm-gmail': '1', text: 'Open in Gmail',
          onclick: go('https://mail.google.com/mail/?view=cm&fs=1&to=' + enc(to) + (cc ? '&cc=' + enc(cc) : '') + '&su=' + enc(c.subject) + '&body=' + enc(c.body)) }));
        // Outlook: the installed app takes mailto links; the two web Outlooks need different addresses
        // (outlook.office.com only works for work / Microsoft 365 accounts — personal accounts got "HTTP ERROR 500").
        var q = 'to=' + enc(to) + (cc ? '&cc=' + enc(cc) : '') + '&subject=' + enc(c.subject) + '&body=' + enc(c.body);
        btns.appendChild(el('a', { class: 'qm-btn pri', 'data-qm-mailto': '1', style: 'text-decoration:none', text: 'Outlook / mail app on this computer',
          title: 'Opens the Outlook app (or the mail program set on this computer) with everything filled in',
          href: 'mailto:' + c.to.map(enc).join(',') + '?' + (cc ? 'cc=' + enc(cc) + '&' : '') + 'subject=' + enc(c.subject) + '&body=' + enc(c.body),
          onclick: function () { dl(); opened(); } }));
        btns.appendChild(el('button', { type: 'button', class: 'qm-btn', 'data-qm-outlook-live': '1', text: 'Outlook.com (web)', title: 'Personal Outlook / Hotmail account in the browser',
          onclick: go('https://outlook.live.com/mail/0/deeplink/compose?' + q) }));
        btns.appendChild(el('button', { type: 'button', class: 'qm-btn', 'data-qm-outlook': '1', text: 'Microsoft 365 Outlook (web)', title: 'Company (work) Outlook account in the browser',
          onclick: go('https://outlook.office.com/mail/0/deeplink/compose?' + q) }));
        if (c.files.length) btns.appendChild(el('button', { type: 'button', class: 'qm-btn', 'data-qm-download': '1', text: '⤓ Attachments only', onclick: dl }));
      }
      if (M.status !== 'SENT') btns.appendChild(el('button', { type: 'button', class: 'qm-btn', 'data-qm-mark-sent': '1', text: '✓ I\'ve sent it', onclick: function (e) {
        e.target.disabled = true;
        api('POST', '/quote-mail/' + M.id + '/sent').then(function (k) { toast(k.message); done(); }).catch(function (x) { e.target.disabled = false; toast(x.message, true); });
      } }));
    }).catch(function (e) { info.innerHTML = ''; info.appendChild(el('div', { text: e.message })); btns.appendChild(el('button', { type: 'button', class: 'qm-btn', text: 'Close', onclick: done })); });
  }
  window.openQuoteMail = openMail;

  // ── buttons on the saved quotation cards + last mail status ──
  var lastByQ = {};
  function decorate() {
    Array.prototype.forEach.call(document.querySelectorAll('#completed-list button[onclick*="_editQuotation("]'), function (b) {
      var m = /_editQuotation\('([^']+)'\)/.exec(b.getAttribute('onclick') || ''); if (!m) return;
      var id = m[1], wrap = b.parentElement;
      if (!wrap) return;
      var btn = wrap.querySelector('[data-qm-mail]');
      if (!btn) {
        btn = el('button', { type: 'button', class: b.className.replace(/btn-primary/, '').trim() || 'btn', 'data-qm-mail': id, title: 'E-mail this quotation to the customer (after approval)', text: '✉ E-mail',
          style: 'background:#0f766e;color:#fff;border-color:#0f766e', onclick: function () { openMail({ quotationId: id }); } });
        wrap.appendChild(btn);
      }
      var last = lastByQ[id], cur = wrap.querySelector('[data-qm-status]');
      if (last && (!cur || cur.getAttribute('data-qm-status') !== last.status)) { if (cur) cur.remove(); var bd = badge(last.status); bd.title = last.kindLabel + ' → ' + last.toEmails + ' — click to open'; bd.style.cursor = 'pointer'; bd.addEventListener('click', function (lm) { return function (e) { e.stopPropagation(); openMail({ mail: lm }); }; }(last)); wrap.appendChild(bd); }
    });
  }
  // approvals bar (approvers) / my sent-back mails (everyone)
  var bar = null;
  function refresh() {
    api('GET', '/quote-mail').then(function (j) {
      var mails = j.data.mails || [];
      lastByQ = {};
      mails.forEach(function (m) { if (!lastByQ[m.quotationId]) lastByQ[m.quotationId] = m; });
      decorate();
      var mine = function (m) { return m.requestedById === me().id; };
      var todo = mails.filter(function (m) { return (APPROVER && m.status === 'PENDING') || (m.status === 'APPROVED' && (mine(m) || APPROVER)) || (mine(m) && m.status === 'REJECTED'); });
      drawBar(todo);
    }).catch(function () {});
  }
  function drawBar(todo) {
    if (!bar) {
      bar = el('div', { id: 'mail-approvals' });
      var anchor = document.getElementById('company-switcher');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
      else { var mn = document.querySelector('main') || document.body; mn.insertBefore(bar, mn.firstChild); }
    }
    bar.innerHTML = '';
    if (!todo.length) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    var open = bar._open !== false; // shown unless folded away (short list, each item needs action)
    var list = el('div', { class: 'qm-list', style: open ? '' : 'display:none' });
    bar.appendChild(el('div', { class: 'qm-bar', 'data-qm-bar': '1', onclick: function () { bar._open = list.style.display === 'none'; list.style.display = bar._open ? '' : 'none'; } }, [
      (function () {
        var p = todo.filter(function (m) { return m.status === 'PENDING'; }).length, a = todo.filter(function (m) { return m.status === 'APPROVED'; }).length, r = todo.length - p - a;
        return '✉ ' + [p ? p + ' quotation mail' + (p > 1 ? 's' : '') + ' waiting for your approval' : '', a ? a + ' approved — open in Gmail / Outlook to send' : '', r ? r + ' sent back — correct and send again' : ''].filter(Boolean).join(' · ');
      })(),
      el('span', { style: 'margin-left:auto;font-weight:500', text: open ? 'Hide ▴' : 'Show ▾' })
    ]));
    todo.forEach(function (m) {
      list.appendChild(el('div', { class: 'qm-item', 'data-qm-item': m.id }, [
        el('div', { class: 'grow' }, [el('b', { text: m.quotationNumber + ' — ' + (m.customer || '') }), el('small', { text: m.kindLabel + ' → ' + m.toEmails + ' · by ' + (m.requestedBy || '') + ' · ' + dt(m.createdAt) }),
          m.status === 'REJECTED' && m.reviewNote ? el('small', { style: 'color:#b91c1c', text: '✖ ' + m.reviewNote }) : null]),
        badge(m.status),
        el('button', { type: 'button', class: 'qm-btn pri', 'data-qm-review': m.id, text: m.status === 'APPROVED' ? '✉ Open in mail app' : m.status === 'PENDING' ? 'Review' : 'Correct', onclick: function () { openMail({ mail: m }); } })
      ]));
    });
    bar.appendChild(list);
  }
  new MutationObserver(function () { clearTimeout(decorate._t); decorate._t = setTimeout(decorate, 120); }).observe(document.documentElement, { childList: true, subtree: true });
  function start() { refresh(); setInterval(refresh, 120000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
