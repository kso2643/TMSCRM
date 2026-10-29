/* ══════════════════════════════════════════════════════════════════════
   Customers page → "Engineer-wise total" card (admin / manager only).

   For each engineer: customers they added (all time / this month), customers
   visited and meetings in the month, quotations and orders in the month with
   their value. Backed by GET /api/customers/by-engineer.

   The customers page is React-rendered and minified, so this attaches at the
   DOM level: it waits for the page title, inserts the card under the header
   row, and re-inserts it if React re-renders the page.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  var MARK = 'data-cust-summary';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var now = new Date();
  var st = { m: now.getMonth() + 1, y: now.getFullYear(), data: null };

  function user() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch (e) { return null; } }
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function isAdminTier() { var u = user(); return !!u && ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(u.role) !== -1; }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function money(v) { return v ? '₹' + Math.round(v).toLocaleString('en-IN') : '—'; }
  function num(v) { return v ? String(Math.round(v * 10) / 10) : '—'; }

  function card() {
    var box = el('div', { class: 'card overflow-hidden mb-4', id: 'cust-sum' });
    box.setAttribute(MARK, '1');
    draw(box);
    load(box);
    return box;
  }
  function load(box) {
    st.data = null; draw(box);
    fetch(API + '/api/customers/by-engineer?month=' + st.m + '&year=' + st.y, { headers: { Authorization: 'Bearer ' + (token() || '') } })
      .then(function (r) { return r.json(); })
      .then(function (j) { st.data = j && j.success !== false ? j.data : { error: (j && j.message) || 'Could not load' }; draw(box); })
      .catch(function (e) { st.data = { error: e.message }; draw(box); });
  }
  function draw(box) {
    box.innerHTML = '';
    function shift(d) { st.m += d; if (st.m < 1) { st.m = 12; st.y--; } if (st.m > 12) { st.m = 1; st.y++; } load(box); }
    box.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2' }, [
      el('span', { class: 'text-sm font-semibold text-slate-900 dark:text-slate-100', text: '👥 Engineer-wise total — ' + MONTHS[st.m - 1] + ' ' + st.y }),
      el('span', { class: 'flex items-center gap-1' }, [
        el('button', { class: 'btn-secondary btn-sm', type: 'button', 'aria-label': 'Previous month', text: '‹', onclick: function () { shift(-1); } }),
        el('button', { class: 'btn-secondary btn-sm', type: 'button', 'aria-label': 'Next month', text: '›', onclick: function () { shift(1); } })
      ])
    ]));
    var d = st.data;
    if (!d) { box.appendChild(el('p', { class: 'px-5 py-3 text-sm text-muted', text: 'Loading…' })); return; }
    if (d.error) { box.appendChild(el('p', { class: 'px-5 py-3 text-sm text-muted', text: d.error })); return; }
    if (!d.engineers.length) { box.appendChild(el('p', { class: 'px-5 py-3 text-sm text-muted', text: 'Nothing yet.' })); return; }
    var cols = [['Engineer', null], ['Customers', 'customers'], ['New this month', 'newCustomers'], ['Visited', 'visitedCustomers'], ['Meetings', 'meetings'],
                ['Quotations', 'quotations'], ['Quote value', 'quotationValue'], ['Orders', 'orders'], ['Order value', 'orderValue']];
    function cell(k, x, bold) {
      var v = /Value$/.test(k) ? money(x[k]) : num(x[k]);
      return el('td', { class: 'px-4 py-2 text-right whitespace-nowrap' + (bold ? ' font-bold' : '') + (k === 'customers' ? ' font-semibold' : ''), text: v });
    }
    var rows = d.engineers.map(function (x) {
      return el('tr', { class: 'table-row', 'data-cust-eng': x.id }, [el('td', { class: 'px-4 py-2 font-medium whitespace-nowrap', text: x.name })]
        .concat(cols.slice(1).map(function (c) { return cell(c[1], x); })));
    });
    rows.push(el('tr', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('td', { class: 'px-4 py-2 font-bold', text: 'All engineers' })]
      .concat(cols.slice(1).map(function (c) { return cell(c[1], d.totals, true); }))));
    box.appendChild(el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-sm', id: 'cust-sum-table' }, [
      el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, cols.map(function (c, i) { return el('th', { class: 'table-head px-4 py-2 whitespace-nowrap ' + (i ? 'text-right' : 'text-left'), text: c[0] }); }))]),
      el('tbody', {}, rows)])]));
    box.appendChild(el('p', { class: 'px-5 py-2 text-xs text-muted', text: 'Customers = added by the engineer (all time). Visited / meetings / quotations / orders are for the month shown.' }));
  }

  function tryMount() {
    if (!/^\/customers\/?$/.test(location.pathname) || !isAdminTier()) return;
    if (document.querySelector('[' + MARK + ']')) return;
    var t = Array.prototype.find.call(document.querySelectorAll('main .page-title, main h1'), function (h) { return /^\s*Customers\s*$/.test(h.textContent || ''); });
    if (!t) return;
    // The header row holds the title and the "Add customer" button side by side — go under all of it.
    var row = t.closest('div') || t;
    while (row.parentElement && row.parentElement.tagName !== 'MAIN') {
      var cs = getComputedStyle(row.parentElement);
      if (cs.display.indexOf('flex') === -1 || cs.flexDirection.indexOf('row') !== 0) break;
      row = row.parentElement;
    }
    var holder = row.parentNode;
    if (!holder) return;
    holder.insertBefore(card(), row.nextSibling);
  }
  function boot() {
    tryMount();
    var pending = null;
    new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; tryMount(); }, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
