/* ══════════════════════════════════════════════════════════════════════
   Chat — admin ↔ users.

   Manager / Admin / Super Admin: pick any user in the "Send to" dropdown and
   write; each user's conversation is listed on the left with unread counts.
   Everyone else: sees messages from the admin team and replies to them.
   New messages arrive every few seconds; an alert pops up on other pages.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function api(method, path, body) {
    return fetch(API + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + (token() || ''), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed'); return j; }); });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function time(s) {
    var d = new Date(String(s || '').replace(' ', 'T')); if (isNaN(d)) return '';
    var today = new Date(); var same = d.toDateString() === today.toDateString();
    return same ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function roleLabel(r) { return String(r || '').replace('_', ' ').toLowerCase(); }

  function css() {
    if (document.getElementById('ch-css')) return;
    var st = document.createElement('style'); st.id = 'ch-css';
    st.textContent = [
      '.ch-wrap{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:300px 1fr;gap:1rem;height:calc(100vh - 140px);min-height:480px}',
      '@media(max-width:820px){.ch-wrap{grid-template-columns:1fr;height:auto}.ch-wrap.open .ch-list{display:none}.ch-wrap:not(.open) .ch-main{display:none}}',
      '.ch-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;display:flex;flex-direction:column;overflow:hidden}.dark .ch-card{background:#1e293b;border-color:#334155}',
      '.ch-head{padding:.8rem 1rem;border-bottom:1px solid #e2e8f0;font-weight:700;display:flex;align-items:center;gap:.5rem}.dark .ch-head{border-color:#334155}',
      '.ch-new{padding:.7rem;border-bottom:1px solid #e2e8f0;display:flex;gap:.4rem}.dark .ch-new{border-color:#334155}',
      '.ch-new select,.ch-in{flex:1;border:1px solid #cbd5e1;border-radius:.55rem;padding:.5rem .6rem;font-size:.86rem;background:#fff;color:inherit}.dark .ch-new select,.dark .ch-in{background:#0f172a;border-color:#334155}',
      '.ch-users{overflow:auto;flex:1}',
      '.ch-u{display:flex;gap:.6rem;align-items:center;width:100%;text-align:left;border:0;background:none;padding:.65rem .9rem;border-bottom:1px solid #f1f5f9;cursor:pointer;color:inherit}.dark .ch-u{border-color:#0f172a}',
      '.ch-u:hover{background:#f8fafc}.ch-u.on{background:#eff6ff}.dark .ch-u:hover,.dark .ch-u.on{background:#0f172a}',
      '.ch-av{width:34px;height:34px;border-radius:50%;background:#e0e7ff;color:#3730a3;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0}',
      '.ch-u .t{flex:1;min-width:0}.ch-u b{display:block;font-size:.88rem}.ch-u small{display:block;color:#64748b;font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ch-badge{background:#dc2626;color:#fff;border-radius:999px;font-size:.7rem;font-weight:700;padding:0 .45rem;min-width:1.2rem;text-align:center}',
      '.ch-msgs{flex:1;overflow:auto;padding:1rem;display:flex;flex-direction:column;gap:.45rem;background:#f8fafc}.dark .ch-msgs{background:#0f172a}',
      '.ch-m{max-width:72%;padding:.5rem .75rem;border-radius:.8rem;font-size:.88rem;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;background:#fff;border:1px solid #e2e8f0;align-self:flex-start}',
      '.dark .ch-m{background:#1e293b;border-color:#334155}',
      '.ch-m.mine{align-self:flex-end;background:#1e3a8a;color:#fff;border-color:#1e3a8a}',
      '.ch-m small{display:block;font-size:.68rem;opacity:.7;margin-top:.2rem}',
      '.ch-send{display:flex;gap:.5rem;padding:.7rem;border-top:1px solid #e2e8f0}.dark .ch-send{border-color:#334155}',
      '.ch-send textarea{flex:1;resize:none;height:44px;border:1px solid #cbd5e1;border-radius:.6rem;padding:.55rem .7rem;font:inherit;font-size:.88rem;background:#fff;color:inherit}.dark .ch-send textarea{background:#0f172a;border-color:#334155}',
      '.ch-btn{border:0;border-radius:.6rem;background:#1e3a8a;color:#fff;font-weight:600;padding:0 1rem;cursor:pointer}.ch-btn:disabled{opacity:.5}',
      '.ch-icon{border:1px solid #cbd5e1;background:#fff;border-radius:.6rem;min-width:44px;padding:0 .55rem;font-size:1.05rem;cursor:pointer;color:inherit;white-space:nowrap}.dark .ch-icon{background:#0f172a;border-color:#334155}',
      '.ch-icon.rec{background:#dc2626;border-color:#dc2626;color:#fff;font-size:.82rem;font-weight:700;animation:chpulse 1.2s infinite}@keyframes chpulse{50%{opacity:.75}}',
      '.ch-att{display:flex;flex-direction:column;gap:.35rem;margin-bottom:.25rem}',
      '.ch-img{max-width:260px;max-height:260px;border-radius:.55rem;cursor:zoom-in;display:block;background:#e2e8f0;min-height:60px;min-width:80px;object-fit:cover}',
      '.ch-audio{width:260px;max-width:100%;height:40px}.ch-video{max-width:300px;max-height:240px;border-radius:.55rem;background:#000}',
      '.ch-file{display:flex;align-items:center;gap:.45rem;border:1px solid rgba(148,163,184,.5);background:rgba(255,255,255,.12);border-radius:.55rem;padding:.4rem .55rem;color:inherit;cursor:pointer;text-align:left;max-width:280px;font:inherit}',
      '.ch-m:not(.mine) .ch-file{background:#f8fafc}.dark .ch-m:not(.mine) .ch-file{background:#0f172a}',
      '.ch-fi{font-size:1.1rem}.ch-fn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem;font-weight:600}.ch-fs{font-size:.72rem;opacity:.75;white-space:nowrap}',
      '.ch-msgs.drop{outline:3px dashed #3b82f6;outline-offset:-8px}',
      '.ch-up{opacity:.7;font-style:italic}',
      '@media(max-width:820px){.ch-img{max-width:200px}.ch-icon{min-width:40px}}',
      '.ch-empty{margin:auto;color:#64748b;text-align:center;padding:2rem;font-size:.9rem}',
      '.ch-back{display:none;border:0;background:none;font-size:1.1rem;cursor:pointer;color:inherit}@media(max-width:820px){.ch-back{display:inline}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var ROOT, users = [], canStart = false, active = null, lastAt = null, pollT = null, wrap, listBox, main;

  function renderList() {
    clear(listBox);
    users.forEach(function (u) {
      listBox.appendChild(el('button', { class: 'ch-u' + (active && active.id === u.id ? ' on' : ''), 'data-user': u.id, onclick: function () { openThread(u); } }, [
        el('span', { class: 'ch-av', text: (u.name || '?').charAt(0).toUpperCase() }),
        el('span', { class: 't' }, [el('b', { text: u.name }), el('small', { text: u.last ? (u.last.mine ? 'You: ' : '') + String(u.last.body).replace(/📷?\s*https?:\/\/\S+\/api\/pasted-images\/\S+/g, '📷 Photo') : roleLabel(u.role) + (u.department ? ' · ' + u.department : '') })]),
        u.unread ? el('span', { class: 'ch-badge', text: String(u.unread) }) : null
      ]));
    });
    if (!users.length) listBox.appendChild(el('div', { class: 'ch-empty', text: canStart ? 'No users.' : 'No messages yet. The admin team will write to you here.' }));
  }

  var lastUnread = null;
  function ding() { var A = window.CRMAlerts; if (A && A.chime) A.chime(A.typeSound ? A.typeSound('CHAT_MESSAGE') : undefined); }
  function loadUsers() {
    return api('GET', '/chat/users').then(function (j) {
      users = j.data.users || []; canStart = j.data.canStart; renderList();
      // a new unread message in another conversation → sound
      var unread = j.data.unread || 0;
      if (lastUnread !== null && unread > lastUnread) ding();
      lastUnread = unread;
    });
  }

  // ── attachments (v11.45): any file; photos, audio and video play right in the chat ──
  function fmtSize(b) { b = +b || 0; return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  var blobCache = {};
  function fileBlob(id) {
    if (!blobCache[id]) blobCache[id] = fetch(API + '/api/chat/file/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + (token() || '') } })
      .then(function (r) { if (!r.ok) throw new Error('Could not load the file (' + r.status + ')'); return r.blob(); })
      .then(function (b) { return URL.createObjectURL(b); });
    return blobCache[id];
  }
  function saveFile(m) {
    fileBlob(m.id).then(function (u) { var a = document.createElement('a'); a.href = u; a.download = m.fileName || 'file'; document.body.appendChild(a); a.click(); a.remove(); })
      .catch(function (e) { alert(e.message); });
  }
  function attachment(m) {
    var k = m.fileKind || 'FILE', box = el('div', { class: 'ch-att ch-att-' + k.toLowerCase(), 'data-att': m.id });
    if (k === 'IMAGE') {
      var img = el('img', { alt: m.fileName || 'Photo', class: 'ch-img' });
      img.onclick = function () { fileBlob(m.id).then(function (u) { window.open(u, '_blank'); }); };
      fileBlob(m.id).then(function (u) { img.src = u; }).catch(function () { img.alt = '⚠ ' + (m.fileName || 'photo'); });
      box.appendChild(img);
    } else if (k === 'AUDIO' || k === 'VIDEO') {
      var media = el(k === 'AUDIO' ? 'audio' : 'video', { controls: 'controls', preload: 'metadata', class: k === 'AUDIO' ? 'ch-audio' : 'ch-video' });
      fileBlob(m.id).then(function (u) { media.src = u; }).catch(function () {});
      box.appendChild(media);
    }
    box.appendChild(el('button', { type: 'button', class: 'ch-file', title: 'Download ' + (m.fileName || ''), onclick: function () { saveFile(m); } },
      [el('span', { class: 'ch-fi', text: k === 'AUDIO' ? '🎤' : k === 'VIDEO' ? '🎬' : k === 'IMAGE' ? '📷' : '📎' }),
       el('span', { class: 'ch-fn', text: m.fileName || 'file' }), el('span', { class: 'ch-fs', text: fmtSize(m.fileSize) + ' ⬇' })]));
    return box;
  }
  function bubble(m) {
    return el('div', { class: 'ch-m' + (m.mine ? ' mine' : '') + (m.fileKind ? ' has-file' : ''), 'data-msg': m.id }, [
      m.fileKind ? attachment(m) : null, m.body || null,
      el('small', { text: time(m.createdAt) + (m.mine && m.readAt ? ' · seen' : '') })]);
  }
  function sendFiles(u, files, caption, msgs, done) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.resolve();
    return list.reduce(function (p, f, i) {
      return p.then(function () {
        if (f.size > 25 * 1024 * 1024) { alert(f.name + ' is larger than 25 MB.'); return; }
        var fd = new FormData(); fd.append('toId', u.id); fd.append('file', f, f.name); if (i === 0 && caption) fd.append('body', caption);
        var tmp = el('div', { class: 'ch-m mine ch-up' }, ['⏫ Sending ' + f.name + '…']); msgs.appendChild(tmp); msgs.scrollTop = msgs.scrollHeight;
        return fetch(API + '/api/chat/send-file', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') }, body: fd })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) throw new Error(j.message || 'Could not send ' + f.name); return j; }); })
          .then(function (j) { tmp.remove(); var e = msgs.querySelector('.ch-empty'); if (e) e.remove(); msgs.appendChild(bubble(j.data.message)); msgs.scrollTop = msgs.scrollHeight; lastAt = j.data.message.createdAt; })
          .catch(function (e) { tmp.textContent = '⚠ ' + e.message; });
      });
    }, Promise.resolve()).then(function () { loadUsers(); if (done) done(); });
  }
  // 🎤 voice note: tap to record, tap ■ to send (or ✕ to cancel)
  function recorder(u, msgs, bar) {
    var btn = el('button', { type: 'button', class: 'ch-icon', id: 'ch-rec', title: 'Record a voice note', 'aria-label': 'Record a voice note', text: '🎤' });
    var st = null;
    function reset() { if (st && st.t) clearInterval(st.t); st = null; btn.textContent = '🎤'; btn.classList.remove('rec'); var c = bar.querySelector('.ch-rec-x'); if (c) c.remove(); }
    btn.onclick = function () {
      if (st) { st.keep = true; st.rec.stop(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) { alert('This browser cannot record audio. Attach an audio file with 📎 instead.'); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0] || '';
        var rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks = [], t0 = Date.now();
        st = { rec: rec, keep: false };
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          stream.getTracks().forEach(function (x) { x.stop(); });
          var keep = st && st.keep; reset();
          if (!keep || !chunks.length) return;
          var mt = (chunks[0].type || type || 'audio/webm').split(';')[0], ext = /mp4/.test(mt) ? 'm4a' : /ogg/.test(mt) ? 'ogg' : 'weba';
          var d = new Date(), name = 'voice-note-' + d.toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.' + ext;
          sendFiles(u, [new File(chunks, name, { type: mt })], '', msgs);
        };
        rec.start(250);
        btn.classList.add('rec');
        st.t = setInterval(function () { var s2 = Math.round((Date.now() - t0) / 1000); btn.textContent = '■ ' + Math.floor(s2 / 60) + ':' + ('0' + s2 % 60).slice(-2); }, 500);
        btn.textContent = '■ 0:00';
        bar.insertBefore(el('button', { type: 'button', class: 'ch-icon ch-rec-x', title: 'Cancel recording', text: '✕', onclick: function () { if (st) { st.keep = false; st.rec.stop(); } } }), btn);
      }).catch(function () { alert('Allow the microphone to record a voice note.'); });
    };
    return btn;
  }

  function openThread(u) {
    active = u; lastAt = null; wrap.classList.add('open');
    try { history.replaceState(null, '', '#' + u.id); } catch (e) {}
    clear(main);
    var msgs = el('div', { class: 'ch-msgs', id: 'ch-msgs' }, [el('div', { class: 'ch-empty', text: 'Loading…' })]);
    var ta = el('textarea', { id: 'ch-text', placeholder: 'Write a message to ' + u.name + '… (Enter to send, Shift+Enter for a new line)' });
    var btn = el('button', { class: 'ch-btn', id: 'ch-send', text: 'Send' });
    function send() {
      var body = ta.value.trim(); if (!body) return;
      btn.disabled = true;
      api('POST', '/chat/send', { toId: u.id, body: body }).then(function (j) {
        ta.value = ''; var e = msgs.querySelector('.ch-empty'); if (e) e.remove();
        msgs.appendChild(bubble(j.data.message)); msgs.scrollTop = msgs.scrollHeight;
        lastAt = j.data.message.createdAt; loadUsers();
      }).catch(function (e) { alert(e.message); }).then(function () { btn.disabled = false; ta.focus(); });
    }
    btn.onclick = send;
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    main.appendChild(el('div', { class: 'ch-head' }, [el('button', { class: 'ch-back', text: '←', 'aria-label': 'Back', onclick: function () { wrap.classList.remove('open'); } }),
      el('span', { class: 'ch-av', text: (u.name || '?').charAt(0).toUpperCase() }), el('span', {}, [u.name, el('div', { style: 'font-weight:400;font-size:.75rem;color:#64748b', text: roleLabel(u.role) })])]));
    main.appendChild(msgs);
    var fileIn = el('input', { type: 'file', multiple: 'multiple', id: 'ch-file-in', style: 'display:none' });
    var bar = el('div', { class: 'ch-send' });
    fileIn.onchange = function () { var cap = ta.value.trim(); sendFiles(u, fileIn.files, cap, msgs, function () { if (cap) ta.value = ''; }); fileIn.value = ''; };
    var attachBtn = el('button', { type: 'button', class: 'ch-icon', id: 'ch-attach', title: 'Attach files — photo, audio, video, PDF, Excel, anything', 'aria-label': 'Attach files', text: '📎', onclick: function () { fileIn.click(); } });
    [attachBtn, recorder(u, msgs, bar), ta, btn, fileIn].forEach(function (x) { bar.appendChild(x); });
    main.appendChild(bar);
    // drop files on the conversation to send them
    msgs.addEventListener('dragover', function (e) { e.preventDefault(); msgs.classList.add('drop'); });
    msgs.addEventListener('dragleave', function () { msgs.classList.remove('drop'); });
    msgs.addEventListener('drop', function (e) { e.preventDefault(); msgs.classList.remove('drop'); if (e.dataTransfer && e.dataTransfer.files.length) sendFiles(u, e.dataTransfer.files, '', msgs); });
    api('GET', '/chat/thread/' + encodeURIComponent(u.id)).then(function (j) {
      clear(msgs);
      var list = j.data.messages || [];
      if (!list.length) msgs.appendChild(el('div', { class: 'ch-empty', text: 'No messages yet — say hello.' }));
      list.forEach(function (m) { msgs.appendChild(bubble(m)); });
      lastAt = list.length ? list[list.length - 1].createdAt : j.data.now;
      msgs.scrollTop = msgs.scrollHeight;
      u.unread = 0; renderList();
    }).catch(function (e) { clear(msgs).appendChild(el('div', { class: 'ch-empty', text: e.message })); });
    setTimeout(function () { ta.focus(); }, 50);
    renderList();
  }

  function poll() {
    if (document.visibilityState !== 'visible') return;
    if (active && lastAt) {
      api('GET', '/chat/thread/' + encodeURIComponent(active.id) + '?after=' + encodeURIComponent(lastAt)).then(function (j) {
        var msgs = document.getElementById('ch-msgs'); if (!msgs) return;
        var incoming = false;
        (j.data.messages || []).forEach(function (m) {
          if (msgs.querySelector('[data-msg="' + m.id + '"]')) return;
          if (!m.mine) incoming = true;
          var e = msgs.querySelector('.ch-empty'); if (e) e.remove();
          msgs.appendChild(bubble(m)); lastAt = m.createdAt; msgs.scrollTop = msgs.scrollHeight;
        });
        if (incoming) ding();
      }).catch(function () {});
    }
    loadUsers().catch(function () {});
  }

  function mountPage(content) {
    css(); ROOT = content;
    listBox = el('div', { class: 'ch-users', id: 'ch-users' });
    main = el('div', { class: 'ch-card ch-main', id: 'ch-main' }, [el('div', { class: 'ch-empty', text: 'Choose a conversation.' })]);
    var picker = el('div', { class: 'ch-new', id: 'ch-new' });
    var side = el('div', { class: 'ch-card ch-list' }, [el('div', { class: 'ch-head', text: 'Chat' }), picker, listBox]);
    wrap = el('div', { class: 'ch-wrap' }, [side, main]);
    ROOT.appendChild(wrap);
    loadUsers().then(function () {
      if (canStart) {
        var sel = el('select', { id: 'ch-to', 'aria-label': 'Send to' }, [el('option', { value: '', text: 'Send to… (choose a user)' })].concat(users.map(function (u) {
          return el('option', { value: u.id, text: u.name + ' — ' + roleLabel(u.role) }); })));
        sel.onchange = function () { var u = users.filter(function (x) { return x.id === sel.value; })[0]; if (u) openThread(u); sel.value = ''; };
        picker.appendChild(sel);
      } else picker.remove();
      var want = location.hash.replace('#', '');
      var u = users.filter(function (x) { return x.id === want; })[0] || (!canStart && users.length === 1 ? users[0] : null);
      if (u) openThread(u);
    }).catch(function (e) { clear(listBox).appendChild(el('div', { class: 'ch-empty', text: e.message })); });
    pollT = setInterval(poll, 5000);
  }
  window.ChatPage = { mountPage: mountPage };
})();
