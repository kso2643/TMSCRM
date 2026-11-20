/* ══════════════════════════════════════════════════════════════════════
   image-view.js — one photo viewer for the whole CRM (v11.57).

   CRMImageView.show({ src | blob, name })
     • opens the photo full screen (pinch / scroll to zoom, ⟲ to rotate) — it is NOT downloaded
     • ⬇ Download  saves it (phone app: Downloads folder)
     • ↗ Share     → 💬 Send in Chat (pick a person) · 🗂 Send to CEO Desk (with a note)
                    · 📱 Other apps (WhatsApp, Gmail… — phone share sheet)
   crm-global.js loads this on every page and routes "open this photo" there.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.CRMImageView) return;
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token') || ''; } catch (e) { return ''; } }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function api(method, path, body) {
    var h = { Authorization: 'Bearer ' + token() };
    if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch(API + '/api' + path, { method: method, headers: h, body: body }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) throw new Error(j.message || 'Request failed (' + r.status + ')'); return j; });
    });
  }
  var css = false;
  function addCss() {
    if (css) return; css = true;
    var st = document.createElement('style');
    st.textContent = [
      '.iv{position:fixed;inset:0;background:rgba(2,6,23,.92);z-index:2147483550;display:flex;flex-direction:column;font:14px system-ui,sans-serif;color:#fff}',
      '.iv-bar{display:flex;gap:6px;align-items:center;padding:8px 10px;flex-wrap:wrap}.iv-bar b{flex:1 1 140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.iv-btn{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;border-radius:9px;padding:7px 12px;font:600 13px system-ui;cursor:pointer;white-space:nowrap}',
      '.iv-btn:hover{background:rgba(255,255,255,.2)}.iv-btn.pri{background:#2563eb;border-color:#2563eb}',
      '.iv-pic{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;touch-action:pinch-zoom pan-x pan-y}',
      '.iv-pic img{max-width:100%;max-height:100%;transition:transform .15s;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.6)}',
      '.iv-menu{position:absolute;right:10px;top:52px;background:#fff;color:#0f172a;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.4);padding:6px;min-width:220px;z-index:2}',
      '.iv-menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:10px 12px;border-radius:8px;font:600 14px system-ui;color:#0f172a;cursor:pointer}.iv-menu button:hover{background:#f1f5f9}',
      '.iv-dlg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;color:#0f172a;border-radius:14px;padding:16px;width:min(420px,92vw);max-height:80vh;overflow:auto;z-index:3;box-shadow:0 20px 50px rgba(0,0,0,.5)}',
      '.iv-dlg h4{margin:0 0 8px;font-size:16px}.iv-dlg input,.iv-dlg textarea,.iv-dlg select{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font:14px system-ui;margin:4px 0 8px}',
      '.iv-dlg input[type=checkbox],.iv-dlg input[type=radio]{width:auto;margin:0;flex:0 0 auto}',
      '.iv-ppl{max-height:240px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px}.iv-ppl label{display:flex;gap:8px;align-items:center;padding:7px 9px;cursor:pointer;border-bottom:1px solid #f1f5f9}',
      '.iv-ppl small{color:#64748b;margin-left:auto}.iv-row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}',
      '.iv-dlg .b{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 14px;font:600 13.5px system-ui;cursor:pointer}.iv-dlg .b.pri{background:#1e3a5f;color:#fff;border-color:#1e3a5f}',
      '.iv-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f766e;color:#fff;padding:10px 18px;border-radius:10px;font:600 14px system-ui;z-index:2147483600}.iv-toast.bad{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function toast(m, bad) { var t = el('div', { class: 'iv-toast' + (bad ? ' bad' : ''), text: m }); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
  function extOf(type) { return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[type] || 'jpg'; }
  function phoneApp() { return !!window.CRMNative; }

  function show(o) {
    addCss();
    var name = o.name || 'photo';
    var getBlob = function () {
      if (o.blob) return Promise.resolve(o.blob);
      return fetch(o.src, /^https?:/.test(o.src) && o.src.indexOf(API) === 0 ? { headers: { Authorization: 'Bearer ' + token() } } : undefined)
        .then(function (r) { if (!r.ok) throw new Error('Could not load the photo'); return r.blob(); }).then(function (b) { o.blob = b; return b; });
    };
    var src = o.src || (o.blob ? URL.createObjectURL(o.blob) : '');
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + extOf((o.blob && o.blob.type) || '');
    var img = el('img', { src: src, alt: name, id: 'iv-img' });
    var zoom = 1, rot = 0;
    function apply() { img.style.transform = 'scale(' + zoom + ') rotate(' + rot + 'deg)'; }
    var pic = el('div', { class: 'iv-pic', onclick: function (e) { if (e.target === pic) close(); } }, [img]);
    pic.addEventListener('wheel', function (e) { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoom = Math.min(5, Math.max(.3, zoom * (e.deltaY < 0 ? 1.15 : .87))); apply(); }, { passive: false });
    var menu = null;
    var box = el('div', { class: 'iv', id: 'crm-image-view', role: 'dialog', 'aria-label': name }, [
      el('div', { class: 'iv-bar' }, [
        el('b', { text: name }),
        el('button', { class: 'iv-btn', type: 'button', title: 'Zoom out', text: '−', onclick: function () { zoom = Math.max(.3, zoom / 1.25); apply(); } }),
        el('button', { class: 'iv-btn', type: 'button', title: 'Zoom in', text: '+', onclick: function () { zoom = Math.min(5, zoom * 1.25); apply(); } }),
        el('button', { class: 'iv-btn', type: 'button', title: 'Rotate', text: '⟲', onclick: function () { rot = (rot + 90) % 360; apply(); } }),
        el('button', { class: 'iv-btn', type: 'button', 'data-iv-download': '1', text: '⬇ Download', onclick: download }),
        el('button', { class: 'iv-btn pri', type: 'button', 'data-iv-share': '1', text: '↗ Share', onclick: function (e) { e.stopPropagation(); toggleMenu(); } }),
        el('button', { class: 'iv-btn', type: 'button', 'data-iv-close': '1', text: '✕', title: 'Close', onclick: close })
      ]), pic]);
    function close() { box.remove(); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', key);
    document.body.appendChild(box);
    function download() {
      getBlob().then(function (b) {
        if (window.CRMSaveFile) return window.CRMSaveFile(b, name);   // phone app: Downloads folder
        var u = URL.createObjectURL(b), a = el('a', { href: u, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 20000);
      }).catch(function (e) { toast(e.message, true); });
    }
    function toggleMenu() {
      if (menu) { menu.remove(); menu = null; return; }
      menu = el('div', { class: 'iv-menu', id: 'iv-share-menu' }, [
        el('button', { type: 'button', 'data-iv-chat': '1', text: '💬 Send in Chat…', onclick: function () { menu.remove(); menu = null; toChat(); } }),
        el('button', { type: 'button', 'data-iv-md': '1', text: '🗂 Send to CEO Desk…', onclick: function () { menu.remove(); menu = null; toDesk(); } }),
        el('button', { type: 'button', 'data-iv-apps': '1', text: '📱 Other apps (WhatsApp, Gmail…)', onclick: function () { menu.remove(); menu = null; toApps(); } })
      ]);
      box.appendChild(menu);
    }
    function file() { return getBlob().then(function (b) { return new File([b], name, { type: b.type || 'image/jpeg' }); }); }
    function dialog(title, kids, okText, ok) {
      var d = el('div', { class: 'iv-dlg', id: 'iv-dlg' }, [el('h4', { text: title })].concat(kids));
      var btn = el('button', { class: 'b pri', type: 'button', 'data-iv-ok': '1', text: okText });
      btn.onclick = function () { btn.disabled = true; var t = btn.textContent; btn.textContent = 'Sending…'; ok().then(function (m) { d.remove(); toast(m); }).catch(function (e) { btn.disabled = false; btn.textContent = t; toast(e.message, true); }); };
      d.appendChild(el('div', { class: 'iv-row' }, [el('button', { class: 'b', type: 'button', text: 'Cancel', onclick: function () { d.remove(); } }), btn]));
      box.appendChild(d);
      return d;
    }
    function people(list, multi) {
      var q = el('input', { type: 'search', placeholder: 'Find a person…' });
      var wrap = el('div', { class: 'iv-ppl' });
      function draw() {
        wrap.innerHTML = '';
        list.filter(function (u) { return !q.value || (u.name + ' ' + (u.role || '')).toLowerCase().indexOf(q.value.toLowerCase()) !== -1; }).forEach(function (u) {
          wrap.appendChild(el('label', {}, [el('input', { type: multi ? 'checkbox' : 'radio', name: 'iv-p', value: u.id, 'data-iv-person': u.name }), u.name, el('small', { text: String(u.role || '').replace(/_/g, ' ').toLowerCase() })]));
        });
      }
      q.oninput = draw; draw();
      return { el: [q, wrap], picked: function () { return Array.prototype.map.call(wrap.querySelectorAll('input:checked'), function (i) { return i.value; }); } };
    }
    function toChat() {
      api('GET', '/chat/users').then(function (j) {
        var me = (function () { try { return JSON.parse(localStorage.getItem('crm_user') || '{}').id; } catch (e) { return ''; } })();
        var list = (j.data.users || j.data.contacts || j.data || []).filter(function (u) { return u && u.id && u.id !== me && u.canMessage !== false; });
        var p = people(list, false), cap = el('input', { type: 'text', placeholder: 'Message with the photo (optional)', id: 'iv-caption' });
        dialog('💬 Send the photo in Chat', p.el.concat([cap]), 'Send', function () {
          var to = p.picked()[0];
          if (!to) return Promise.reject(new Error('Pick a person'));
          return file().then(function (f) {
            var fd = new FormData(); fd.append('toId', to); fd.append('file', f); if (cap.value.trim()) fd.append('caption', cap.value.trim());
            return api('POST', '/chat/send-file', fd).then(function () { return cap.value.trim() ? api('POST', '/chat/send', { toId: to, body: cap.value.trim() }).catch(function () {}) : null; });
          }).then(function () { return 'Sent in Chat'; });
        });
      }).catch(function (e) { toast(e.message, true); });
    }
    function toDesk() {
      api('GET', '/md-desk/recipients').then(function (j) {
        var p = people(j.data.users || [], true);
        var t = el('input', { type: 'text', placeholder: 'Subject', id: 'iv-md-title', value: 'Photo: ' + name.replace(/\.[a-z0-9]+$/i, '') });
        var m = el('textarea', { rows: 3, placeholder: 'Message (optional)', id: 'iv-md-msg' });
        dialog('🗂 Send the photo to the CEO Desk', [el('div', { style: 'font-size:12.5px;color:#64748b', text: 'To:' })].concat(p.el, [t, m]), 'Send', function () {
          var to = p.picked();
          if (!to.length) return Promise.reject(new Error('Pick who to send it to'));
          return api('POST', '/md-desk', { type: 'MESSAGE', toIds: to, title: t.value.trim() || 'Photo', details: m.value.trim() }).then(function (r) {
            var id = (r.data.item || r.data.items && r.data.items[0] || r.data).id || (r.data.ids && r.data.ids[0]);
            var ids = r.data.ids || (r.data.items ? r.data.items.map(function (x) { return x.id; }) : [id]);
            return file().then(function (f) {
              return ids.reduce(function (pr, x) { return pr.then(function () { var fd = new FormData(); fd.append('file', f); return api('POST', '/md-desk/' + encodeURIComponent(x) + '/files', fd); }); }, Promise.resolve());
            });
          }).then(function () { return 'Sent to the CEO Desk'; });
        });
      }).catch(function (e) { toast(e.message, true); });
    }
    function toApps() {
      file().then(function (f) {
        if (window.CRMNative && typeof window.CRMNative.shareFile === 'function') {
          var fr = new FileReader();
          fr.onload = function () { window.CRMNative.shareFile(String(fr.result), name, f.type || 'image/jpeg', ''); };
          fr.readAsDataURL(f); return;
        }
        if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: name }).catch(function () {});
        toast(phoneApp() ? 'Update the phone app to share to other apps — the photo is downloaded instead.' : 'This browser cannot share files — the photo is downloaded; attach it in WhatsApp / mail.');
        download();
      }).catch(function (e) { toast(e.message, true); });
    }
    return box;
  }
  window.CRMImageView = { show: show };
})();
