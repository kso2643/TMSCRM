/* ══════════════════════════════════════════════════════════════════════
   Quotation notes & follow-up status — shared by the Quotations page and
   the CEO Desk (Quotations tab).

   QuoteNotes.open(quotationId, { onChange, panel })  — notes log of the
     quotation: comments, price negotiation (customer asks / we offered),
     price changes (old → new, per item), status changes; plus the
     follow-up status (Pending, Price negotiation, Trial, PO received,
     Comparison, Price concern, Closed, Other + text). As a dialog, or as a
     side panel next to the quotation form ({ panel: true }).
   QuoteNotes.badge(status, note) — coloured status chip.

   On the Quotations page it also adds a "💬 Notes" button and the status
   to every saved quotation card, and a "💬 Notes & price" tab at the side
   while a saved quotation is open for editing.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.QuoteNotes) return;
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function api(method, path, body) {
    var opt = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(API + '/api' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
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
  function money(v) { return v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function when(s) {
    var d = new Date(String(s || '').replace(' ', 'T')); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  var STATUS = { PENDING: ['Pending', '#64748b'], PRICE_NEGOTIATION: ['Price negotiation', '#d97706'], TRIAL: ['Trial', '#7c3aed'], PO_RECEIVED: ['PO received', '#16a34a'],
                 COMPARISON: ['Comparison', '#2563eb'], PRICE_CONCERN: ['Price concern', '#dc2626'], CLOSED: ['Closed', '#0f172a'], OTHER: ['Other', '#0e7490'] };
  var KIND = { COMMENT: ['💬', 'Comment', '#475569'], NEGOTIATION: ['🤝', 'Price negotiation', '#d97706'], PRICE_CHANGE: ['₹', 'Price changed', '#16a34a'], STATUS: ['●', 'Status', '#2563eb'] };

  (function css() {
    var s = document.createElement('style');
    s.textContent = [
      '.qn-badge{display:inline-block;padding:.1rem .55rem;border-radius:999px;font:600 11.5px/1.5 Inter,system-ui,sans-serif;color:var(--c);background:color-mix(in srgb,var(--c) 13%,#fff);white-space:nowrap}',
      '.qn-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483300;display:flex;align-items:flex-start;justify-content:center;padding:4vh 1rem;overflow:auto}',
      '.qn-box{background:#fff;color:#0f172a;border-radius:14px;width:100%;max-width:760px;padding:16px;font:14px/1.45 Inter,system-ui,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.3)}',
      '.qn-panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:2147483200;background:#fff;color:#0f172a;box-shadow:-12px 0 40px rgba(15,23,42,.25);overflow:auto;padding:14px;font:14px/1.45 Inter,system-ui,sans-serif}',
      '.qn-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.qn-h h3{margin:0;font-size:17px}.qn-sub{color:#64748b;font-size:12.5px;margin-top:2px}',
      '.qn-x{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:4px 9px;cursor:pointer}',
      '.qn-sec{margin-top:12px;border:1px solid #e2e8f0;border-radius:10px;padding:10px}.qn-sec b.t{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-bottom:6px}',
      '.qn-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.qn-in,.qn-sel{border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px;font:inherit;font-size:13px;background:#fff;color:inherit}',
      '.qn-in.w{flex:1;min-width:150px}.qn-ta{width:100%;min-height:58px;border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px;font:inherit;font-size:13px;margin-top:6px;box-sizing:border-box}',
      '.qn-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:6px 12px;font:600 13px/1.2 inherit;font-family:inherit;cursor:pointer;color:#0f172a}.qn-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}',
      '.qn-kinds{display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap}.qn-kinds button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:5px 9px;font:600 12.5px/1.2 inherit;font-family:inherit;cursor:pointer;color:#334155}',
      '.qn-kinds button.on{background:var(--c);border-color:var(--c);color:#fff}',
      '.qn-log{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto}.qn-panel .qn-log{max-height:none}',
      '.qn-n{border-left:3px solid var(--c);background:#f8fafc;border-radius:6px;padding:7px 9px;font-size:13px}.qn-n .m{color:#64748b;font-size:11.5px}',
      '.qn-n .p{font-weight:700;margin-top:2px}.qn-n .p s{color:#94a3b8;font-weight:500;margin-right:4px}.qn-up{color:#dc2626}.qn-dn{color:#16a34a}',
      '.qn-empty{color:#64748b;font-size:13px;padding:6px 0}.qn-err{color:#b91c1c;font-size:12.5px;margin-top:4px}',
      '.qn-tab{position:fixed;right:0;top:42%;z-index:2147483100;writing-mode:vertical-rl;transform:rotate(180deg);background:#1e3a8a;color:#fff;border:0;border-radius:0 10px 10px 0;padding:14px 8px;font:700 13px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,.3)}',
      '.qn-cardbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}'
    ].join('\n');
    document.head.appendChild(s);
  })();

  function badge(st, note) {
    var x = STATUS[st] || STATUS.PENDING;
    return el('span', { class: 'qn-badge', style: '--c:' + x[1], 'data-qstatus': st || 'PENDING', title: note || '', text: st === 'OTHER' && note ? note : x[0] });
  }

  function open(id, opts) {
    opts = opts || {};
    var panel = !!opts.panel;
    document.querySelectorAll(panel ? '.qn-panel' : '.qn-modal').forEach(function (n) { n.remove(); });
    var box = el('div', { class: panel ? 'qn-panel' : 'qn-box', id: 'qn-box' }, [el('div', { class: 'qn-empty', text: 'Loading…' })]);
    var wrap = panel ? box : el('div', { class: 'qn-modal' }, [box]);
    function close() { wrap.remove(); }
    if (!panel) wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    var kind = 'COMMENT';
    function draw(d) {
      var q = d.quotation;
      clear(box);
      box.appendChild(el('div', { class: 'qn-h' }, [
        el('div', {}, [el('h3', { text: (q.quotationNumber || 'Quotation') + ' · ' + (q.customer || '') }),
          el('div', { class: 'qn-sub', text: q.company + ' · ' + (q.user.name || '—') + ' · ' + money(q.totalAmount) + (q.priceRequestNo ? ' · ' + q.priceRequestNo : '') })]),
        el('button', { class: 'qn-x', type: 'button', text: '✕', 'aria-label': 'Close', onclick: close })
      ]));
      // status
      var sel = el('select', { class: 'qn-sel', id: 'qn-status' }, Object.keys(STATUS).map(function (k) { return el('option', { value: k, text: STATUS[k][0] }); }));
      sel.value = q.followStatus || 'PENDING';
      var other = el('input', { class: 'qn-in w', id: 'qn-other', placeholder: 'Type the status', value: q.followStatus === 'OTHER' ? (q.followNote || '') : '', style: sel.value === 'OTHER' ? '' : 'display:none' });
      sel.onchange = function () { other.style.display = sel.value === 'OTHER' ? '' : 'none'; if (sel.value === 'OTHER') other.focus(); };
      var stErr = el('div', { class: 'qn-err' });
      box.appendChild(el('div', { class: 'qn-sec' }, [el('b', { class: 't', text: 'Follow-up status' }),
        el('div', { class: 'qn-row' }, [badge(q.followStatus, q.followNote), sel, other,
          el('button', { class: 'qn-btn pri', type: 'button', id: 'qn-status-save', text: 'Update', onclick: function () {
            stErr.textContent = '';
            api('PATCH', '/quote-follow/' + encodeURIComponent(id) + '/status', { status: sel.value, note: other.value.trim() })
              .then(function (j) { draw(j.data); if (opts.onChange) opts.onChange(j.data.quotation); }).catch(function (e) { stErr.textContent = e.message; });
          } })]), stErr]));
      // add note
      var item = el('select', { class: 'qn-sel', id: 'qn-item' }, [el('option', { value: '', text: 'Whole quotation' })].concat(d.items.map(function (it, i) {
        return el('option', { value: String(i), text: (it.itemCode || it.productName || 'Item ' + (i + 1)) + ' — ' + money(it.netPrice != null ? it.netPrice : it.unitPrice) });
      })));
      var oldP = el('input', { class: 'qn-in', id: 'qn-old', type: 'number', step: 'any', min: '0', placeholder: 'Old / quoted ₹', style: 'width:120px' });
      var newP = el('input', { class: 'qn-in', id: 'qn-new', type: 'number', step: 'any', min: '0', placeholder: 'New / asked ₹', style: 'width:120px' });
      item.onchange = function () { var it = d.items[+item.value]; oldP.value = item.value !== '' && it ? (it.netPrice != null ? it.netPrice : it.unitPrice) : ''; };
      var priceRow = el('div', { class: 'qn-row', style: 'margin-top:6px' }, [item, oldP, el('span', { text: '→' }), newP]);
      var ta = el('textarea', { class: 'qn-ta', id: 'qn-text', placeholder: 'e.g. Customer asked ₹480 against ₹520 — competitor quoted ₹470; agreed ₹495 for 200 Nos' });
      var kinds = el('div', { class: 'qn-kinds' });
      function drawKinds() {
        clear(kinds);
        ['COMMENT', 'NEGOTIATION', 'PRICE_CHANGE'].forEach(function (k) {
          kinds.appendChild(el('button', { type: 'button', class: kind === k ? 'on' : '', style: '--c:' + KIND[k][2], 'data-kind': k, text: KIND[k][0] + ' ' + KIND[k][1], onclick: function () { kind = k; drawKinds(); priceRow.style.display = k === 'COMMENT' ? 'none' : ''; } }));
        });
      }
      drawKinds(); priceRow.style.display = 'none';
      var err = el('div', { class: 'qn-err' });
      box.appendChild(el('div', { class: 'qn-sec' }, [el('b', { class: 't', text: 'Add a note' }), kinds, priceRow, ta, err,
        el('div', { class: 'qn-row', style: 'justify-content:flex-end;margin-top:6px' }, [el('button', { class: 'qn-btn pri', type: 'button', id: 'qn-add', text: 'Save note', onclick: function () {
          err.textContent = '';
          var it = d.items[+item.value];
          api('POST', '/quote-follow/' + encodeURIComponent(id) + '/notes', { kind: kind, text: ta.value.trim(), itemCode: kind !== 'COMMENT' && it ? (it.itemCode || it.productName) : '',
            oldPrice: kind !== 'COMMENT' ? oldP.value : '', newPrice: kind !== 'COMMENT' ? newP.value : '' })
            .then(function (j) { kind = 'COMMENT'; draw(j.data); if (opts.onChange) opts.onChange(j.data.quotation); }).catch(function (e) { err.textContent = e.message; });
        } })])]));
      // log
      var log = el('div', { class: 'qn-log', id: 'qn-log' });
      if (!d.notes.length) log.appendChild(el('div', { class: 'qn-empty', text: 'No notes yet. Add comments, price negotiation and price changes here.' }));
      d.notes.slice().reverse().forEach(function (n) {
        var K = KIND[n.kind] || KIND.COMMENT, pct = n.oldPrice && n.newPrice != null ? Math.round((n.newPrice - n.oldPrice) / n.oldPrice * 1000) / 10 : null;
        log.appendChild(el('div', { class: 'qn-n', style: '--c:' + (n.kind === 'STATUS' ? (STATUS[n.status] || STATUS.PENDING)[1] : K[2]) }, [
          el('div', { class: 'm', text: K[0] + ' ' + (n.kind === 'STATUS' ? 'Status → ' + (n.status === 'OTHER' ? (n.text || 'Other') : (STATUS[n.status] || ['?'])[0]) : K[1]) + ' · ' + (n.user || '') + ' · ' + when(n.createdAt) }),
          n.newPrice != null ? el('div', { class: 'p' }, [n.itemCode ? n.itemCode + ': ' : '', n.oldPrice != null ? el('s', { text: money(n.oldPrice) }) : null, money(n.newPrice),
            pct != null ? el('span', { class: pct > 0 ? 'qn-up' : 'qn-dn', text: ' (' + (pct > 0 ? '+' : '') + pct + '%)' }) : null]) : null,
          n.text && !(n.kind === 'STATUS' && n.status === 'OTHER') ? el('div', { text: n.text }) : null
        ]));
      });
      box.appendChild(el('div', { class: 'qn-sec' }, [el('b', { class: 't', text: 'History (' + d.notes.length + ')' }), log]));
    }
    api('GET', '/quote-follow/' + encodeURIComponent(id) + '/notes').then(function (j) { draw(j.data); })
      .catch(function (e) { clear(box).appendChild(el('div', { class: 'qn-err', text: e.message })); box.appendChild(el('button', { class: 'qn-x', type: 'button', text: 'Close', onclick: close })); });
    return { close: close };
  }

  // Deleting a quotation is for the Super Admin only (the API refuses others too)
  (function () {
    var u = {}; try { u = JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) {}
    if (u.role === 'SUPER_ADMIN' || !/^\/quotations\/?/.test(location.pathname)) return;
    var st = document.createElement('style');
    st.textContent = 'button[onclick^="tms_deleteQuotation"],button[onclick^="apj_deleteQuotation"]{display:none!important}';
    document.head.appendChild(st);
  })();
  window.QuoteNotes = { open: open, badge: badge, STATUS: STATUS, api: api };

  // ── Quotations page: notes button + status on each saved quotation, side tab while editing ──
  if (!/^\/quotations\/?$/.test(location.pathname)) return;
  var follow = {}, loading = false, lastLoad = 0;
  function loadFollow() {
    if (loading || Date.now() - lastLoad < 4000) return;
    loading = true;
    api('GET', '/quote-follow').then(function (j) { follow = {}; j.data.items.forEach(function (x) { follow[x.id] = x; }); lastLoad = Date.now(); decorate(true); })
      .catch(function () {}).then(function () { loading = false; });
  }
  function decorate(force) {
    document.querySelectorAll('button[onclick*="editQuotation(\'"]').forEach(function (b) {
      var m = /editQuotation\('([^']+)'\)/.exec(b.getAttribute('onclick') || ''); if (!m) return;
      var id = m[1], card = b.closest('.quot-card') || b.parentNode.parentNode;
      var bar = card.querySelector('.qn-cardbar');
      if (bar && !force) return;
      if (!bar) { bar = el('div', { class: 'qn-cardbar' }); (card.querySelector('.quot-info') || card).appendChild(bar); }
      var f = follow[id];
      clear(bar);
      bar.appendChild(badge(f ? f.followStatus : 'PENDING', f && f.followNote));
      if (f && f.lastNote) bar.appendChild(el('span', { style: 'font-size:12px;color:#64748b', text: (f.lastNote.newPrice != null ? (f.lastNote.itemCode ? f.lastNote.itemCode + ' ' : '') + '₹' + f.lastNote.newPrice + ' · ' : '') + (f.lastNote.text || '').slice(0, 60) }));
      bar.appendChild(el('button', { type: 'button', class: 'qn-btn', 'data-qnotes': id, style: 'padding:3px 9px;font-size:12px', text: '💬 Notes' + (f && f.noteCount ? ' (' + f.noteCount + ')' : ''),
        onclick: function () { open(id, { onChange: function () { lastLoad = 0; loadFollow(); } }); } }));
    });
  }
  // Side tab while a saved quotation is open in the form.
  var tab = null;
  function editingId() { try { return typeof editingQuotationId !== 'undefined' && editingQuotationId && /^[a-z0-9]{20,}$/i.test(String(editingQuotationId)) ? String(editingQuotationId) : null; } catch (e) { return null; } }
  function sideTab() {
    var id = editingId();
    if (!id) { if (tab) { tab.remove(); tab = null; } return; }
    if (tab && tab.getAttribute('data-id') === id) return;
    if (tab) tab.remove();
    tab = el('button', { class: 'qn-tab', type: 'button', id: 'qn-tab', 'data-id': id, text: '💬 Notes & price negotiation', onclick: function () { open(id, { panel: true, onChange: function () { lastLoad = 0; loadFollow(); } }); } });
    document.body.appendChild(tab);
  }
  new MutationObserver(function () { decorate(false); if (document.querySelector('button[onclick*="editQuotation(\'"]') && !Object.keys(follow).length) loadFollow(); }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(sideTab, 1000);
  setTimeout(loadFollow, 1500);
})();
