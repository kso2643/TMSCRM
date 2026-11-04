/* customer-updates.js — on a customer's page (/customers/detail/?id=…, compiled React page):
 *
 *  1. "Log meeting" opens the full Log meeting form on the Meetings & follow-ups page with this
 *     customer already chosen (summary, requirements, photos / voice notes, next follow-up and
 *     "Follow-up by" engineers) instead of the small built-in pop-up; after saving it comes back here.
 *  2. A "Latest updates" card above the meeting history: everything that happened with this customer,
 *     newest first — meetings, follow-ups, quotations, price requests, orders, invoices, trials,
 *     appointments, CEO Desk — from GET /api/customers/:id/updates.
 */
(function () {
  'use strict';
  if (window.__custUpdates) return;
  window.__custUpdates = true;
  var API = 'https://api.apjtech.in';

  function onPage() { return /^\/customers\/detail\/?$/.test(location.pathname); }
  function custId() { try { return new URLSearchParams(location.search).get('id') || ''; } catch (e) { return ''; } }
  function token() { try { return localStorage.getItem('crm_token') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(s) {
    var d = new Date(String(s || '').replace(' ', 'T'));
    if (isNaN(d)) return '';
    var days = Math.floor((Date.now() - d.getTime()) / 864e5);
    var date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days > 1 && days < 7 ? days + ' days ago' : date;
  }

  // ── 1. "Log meeting" → the full form on the Meetings page ──
  document.addEventListener('click', function (e) {
    if (!onPage()) return;
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b || b.closest('#cu-card')) return;
    var t = (b.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/^(\+\s*)?Log meeting$/i.test(t)) return;
    var id = custId();
    if (!id) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    location.assign('/meetings/?new=1&back=customer&customerId=' + encodeURIComponent(id));
  }, true);

  // ── 2. Latest updates card ──
  function css() {
    if (document.getElementById('cu-css')) return;
    var st = document.createElement('style'); st.id = 'cu-css';
    st.textContent = [
      '#cu-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin:0 0 18px;box-shadow:0 1px 2px rgba(15,23,42,.05)}',
      '#cu-card .cu-h{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
      '#cu-card .cu-h h3{margin:0;font-size:1.05rem;font-weight:700;color:#0f172a}',
      '#cu-card .cu-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '#cu-card .cu-chip{font-size:.72rem;font-weight:600;border-radius:999px;padding:3px 9px;background:#f1f5f9;color:#475569;border:0;cursor:pointer}',
      '#cu-card .cu-chip.on{background:#1e3a8a;color:#fff}',
      '#cu-card .cu-next{display:flex;align-items:center;gap:8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:9px;padding:8px 12px;font-size:.85rem;margin-bottom:10px}',
      '#cu-card .cu-next a{margin-left:auto;color:#b45309;font-weight:600;text-decoration:none}',
      '#cu-card .cu-list{display:flex;flex-direction:column}',
      '#cu-card .cu-row{display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:start;padding:9px 4px;border-top:1px solid #f1f5f9;text-decoration:none;color:inherit;border-radius:8px}',
      '#cu-card .cu-row:first-child{border-top:0}',
      '#cu-card .cu-row:hover{background:#f8fafc}',
      '#cu-card .cu-i{width:30px;height:30px;border-radius:8px;background:#eff6ff;display:flex;align-items:center;justify-content:center;font-size:15px}',
      '#cu-card .cu-t{font-weight:600;font-size:.88rem;color:#0f172a}',
      '#cu-card .cu-s{font-size:.82rem;color:#475569;margin-top:1px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '#cu-card .cu-w{font-size:.75rem;color:#64748b;white-space:nowrap;text-align:right}',
      '#cu-card .cu-more{margin-top:8px;background:none;border:0;color:#1d4ed8;font-weight:600;cursor:pointer;font-size:.84rem;padding:4px 0}',
      '#cu-card .cu-empty{font-size:.85rem;color:#64748b;padding:6px 0}',
      '.dark #cu-card{background:#1e293b;border-color:#334155}.dark #cu-card .cu-h h3,.dark #cu-card .cu-t{color:#e2e8f0}',
      '.dark #cu-card .cu-s{color:#cbd5e1}.dark #cu-card .cu-row{border-color:#334155}.dark #cu-card .cu-row:hover{background:#0f172a}',
      '.dark #cu-card .cu-i{background:#0f172a}.dark #cu-card .cu-chip{background:#0f172a;color:#cbd5e1}.dark #cu-card .cu-next{background:#422006;border-color:#854d0e;color:#fde68a}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var LABEL = { MEETING: 'Meetings', QUOTATION: 'Quotations', PRICE_REQUEST: 'Price requests', ORDER: 'Orders', INVOICE: 'Invoices', TRIAL: 'Trials', APPOINTMENT: 'Appointments', CEO_DESK: 'CEO Desk' };
  var data = null, loadingFor = '', filter = '', showAll = false;

  function anchor() {
    // the "Meeting history (12)" heading row on the React page
    var hs = document.querySelectorAll('h1,h2,h3,h4');
    for (var i = 0; i < hs.length; i++) {
      if (/^Meeting history/i.test((hs[i].textContent || '').trim())) {
        var row = hs[i].parentElement;
        return row && row.querySelector('button') ? row : hs[i];
      }
    }
    return null;
  }

  function render() {
    var card = document.getElementById('cu-card');
    if (!card) return;
    if (!data) { card.innerHTML = '<div class="cu-h"><h3>🕘 Latest updates</h3></div><div class="cu-empty">Loading…</div>'; return; }
    var list = data.updates.filter(function (u) { return !filter || u.type === filter; });
    var shown = showAll ? list : list.slice(0, 8);
    var chips = '<button type="button" class="cu-chip' + (filter ? '' : ' on') + '" data-cu-f="">All ' + data.updates.length + '</button>' +
      Object.keys(LABEL).filter(function (k) { return data.counts[k]; }).map(function (k) {
        return '<button type="button" class="cu-chip' + (filter === k ? ' on' : '') + '" data-cu-f="' + k + '">' + LABEL[k] + ' ' + data.counts[k] + '</button>';
      }).join('');
    var nf = data.nextFollowUp;
    var next = nf ? '<div class="cu-next" data-cu-next>📅 <span><b>Next follow-up:</b> ' + esc(new Date(String(nf.at).replace(' ', 'T')).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })) +
      (nf.time ? ' · ' + esc(nf.time) : '') + (nf.by ? ' · ' + esc(nf.by) : '') + '</span><a href="/meetings/#m-' + encodeURIComponent(nf.meetingId) + '">Open →</a></div>' : '';
    card.innerHTML = '<div class="cu-h"><h3>🕘 Latest updates</h3><div class="cu-chips">' + chips + '</div></div>' + next +
      (shown.length ? '<div class="cu-list">' + shown.map(function (u) {
        return '<a class="cu-row" data-cu-type="' + u.type + '" href="' + esc(u.link || '#') + '"><span class="cu-i">' + esc(u.icon) + '</span>' +
          '<span><div class="cu-t">' + esc(u.title) + '</div><div class="cu-s">' + esc(u.sub) + '</div></span>' +
          '<span class="cu-w">' + esc(when(u.at)) + (u.by ? '<br>' + esc(u.by) : '') + '</span></a>';
      }).join('') + '</div>' : '<div class="cu-empty">Nothing recorded for this customer yet.</div>') +
      (list.length > 8 ? '<button type="button" class="cu-more" data-cu-more>' + (showAll ? 'Show less' : 'Show all ' + list.length + ' updates') + '</button>' : '');
  }

  function load(id) {
    if (loadingFor === id) return;
    loadingFor = id; data = null; render();
    fetch(API + '/api/customers/' + encodeURIComponent(id) + '/updates', { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (loadingFor !== id) return; data = j && j.data ? j.data : { updates: [], counts: {}, nextFollowUp: null }; render(); })
      .catch(function () { data = { updates: [], counts: {}, nextFollowUp: null }; render(); });
  }

  function ensure() {
    if (!onPage()) return;
    var id = custId(), a = anchor();
    if (!id || !a) return;
    var card = document.getElementById('cu-card');
    if (!card || card.nextElementSibling !== a) {
      if (card) card.remove();
      css();
      card = document.createElement('section'); card.id = 'cu-card'; card.setAttribute('aria-label', 'Latest updates');
      card.addEventListener('click', function (e) {
        var f = e.target.closest('[data-cu-f]');
        if (f) { filter = f.getAttribute('data-cu-f'); showAll = false; render(); return; }
        if (e.target.closest('[data-cu-more]')) { showAll = !showAll; render(); }
      });
      a.parentNode.insertBefore(card, a);
      render();
    }
    if (loadingFor !== id) load(id);
  }

  var mo = new MutationObserver(function () { ensure(); });
  function start() { ensure(); mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
