/* ══════════════════════════════════════════════════════════════════════
   PdfView — shows a PDF inside the page (no new tab, so pop-up blockers and
   missing browser PDF plug-ins / phones don't matter). The file is fetched
   with the login token, drawn page by page with PDF.js (/vendor/pdfjs), and
   has Download and Open-in-new-tab buttons. A server error is shown as text.

     PdfView.show(url, { title, fileName })
     PdfView.fetchBlob(url) → Promise<Blob>   (with the login token)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.PdfView) return;
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var libP = null;
  function lib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = '/vendor/pdfjs/pdf.min.js';
      s.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; } catch (e) {} res(window.pdfjsLib); };
      s.onerror = function () { libP = null; rej(new Error('Could not load the PDF viewer')); };
      document.head.appendChild(s);
    });
    return libP;
  }
  function fetchBlob(url) {
    return fetch(url, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || ('Could not open the file (' + r.status + ')')); });
      return r.blob();
    });
  }
  function css() {
    if (document.getElementById('pv-css')) return;
    var st = el('style', { id: 'pv-css' });
    st.textContent = '.pv-back{position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:2147483500;display:flex;flex-direction:column}' +
      '.pv-bar{display:flex;gap:.5rem;align-items:center;padding:.6rem .9rem;background:#0f172a;color:#fff;font:600 14px/1.3 Inter,system-ui,sans-serif}' +
      '.pv-bar b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.pv-bar button,.pv-bar a{border:1px solid #475569;background:#1e293b;color:#fff;border-radius:.45rem;padding:.35rem .7rem;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;text-decoration:none}' +
      '.pv-pages{flex:1;overflow:auto;padding:1rem;display:flex;flex-direction:column;align-items:center;gap:.8rem}' +
      '.pv-pages canvas{max-width:100%;height:auto;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.35)}' +
      '.pv-msg{color:#fff;font:14px Inter,system-ui,sans-serif;margin-top:2rem;text-align:center}';
    document.head.appendChild(st);
  }
  function show(url, o) {
    o = o || {}; css();
    document.querySelectorAll('.pv-back').forEach(function (m) { m.remove(); });
    var pages = el('div', { class: 'pv-pages', id: 'pv-pages' }, [el('div', { class: 'pv-msg', text: 'Loading…' })]);
    var dl = el('button', { type: 'button', text: '⬇ Download', disabled: true });
    var tab = el('a', { href: '#', target: '_blank', rel: 'noopener', text: '↗ New tab', style: 'display:none' });
    var back = el('div', { class: 'pv-back', role: 'dialog', 'aria-label': o.title || 'PDF' }, [
      el('div', { class: 'pv-bar' }, [el('b', { text: o.title || o.fileName || 'PDF' }), tab, dl, el('button', { type: 'button', text: '✕ Close', onclick: close })]), pages]);
    var objUrl = null;
    function close() { back.remove(); document.removeEventListener('keydown', esc); if (objUrl) setTimeout(function () { URL.revokeObjectURL(objUrl); }, 1000); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    function msg(t) { pages.innerHTML = ''; pages.appendChild(el('div', { class: 'pv-msg', text: t })); }
    fetchBlob(url).then(function (b) {
      objUrl = URL.createObjectURL(b.type === 'application/pdf' ? b : new Blob([b], { type: 'application/pdf' }));
      dl.disabled = false; dl.onclick = function () { var a = el('a', { href: objUrl, download: o.fileName || 'document.pdf' }); document.body.appendChild(a); a.click(); a.remove(); };
      tab.href = objUrl; tab.style.display = '';
      return b.arrayBuffer().then(function (buf) {
        var head = new Uint8Array(buf.slice(0, 1024)), txt = '';
        for (var i = 0; i < head.length; i++) txt += String.fromCharCode(head[i]);
        if (txt.indexOf('%PDF') === -1) throw new Error('This file is not a readable PDF — use Download to open it.');
        return lib().then(function (pdfjs) { return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise; });
      });
    }).then(function (doc) {
      pages.innerHTML = '';
      var width = Math.min(pages.clientWidth - 32, 1100);
      var n = 0;
      (function next() {
        if (++n > doc.numPages || !back.isConnected) return;
        doc.getPage(n).then(function (pg) {
          var v1 = pg.getViewport({ scale: 1 }), scale = width / v1.width, dpr = window.devicePixelRatio || 1;
          var vp = pg.getViewport({ scale: scale * dpr });
          var c = el('canvas', { 'data-page': String(n) }); c.width = vp.width; c.height = vp.height; c.style.width = (vp.width / dpr) + 'px';
          pages.appendChild(c);
          return pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        }).then(next).catch(next);
      })();
    }).catch(function (e) { msg(e.message || 'Could not open the PDF.'); });
  }
  window.PdfView = { show: show, fetchBlob: fetchBlob };
})();
