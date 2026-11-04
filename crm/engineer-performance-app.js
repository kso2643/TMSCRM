/* ══════════════════════════════════════════════════════════════════════
   Engineer performance — Super Admin / Admin / Manager.
   1. Day summary (phone-friendly): every engineer's day — the plan
      (appointments, follow-ups due) against what was done: punch in / out,
      hours, km travelled, stops, visits (joint or alone) and where, orders
      and value, quotations — with team totals on top.
   2. Performance report: an engineer over any dates — where he went, how
      far he travelled and how long he worked, visits and joint visits,
      follow-ups, orders and value, quotations, day by day; or the whole
      team side by side. Download as Excel or PDF.
   Data: GET /api/engineer-report/day and /api/engineer-report/performance.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function api(path) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
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
  function money(v) { return !v ? '₹0' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  function iso(d) { var x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }
  function tm(s) { if (!s) return '—'; var d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? s : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function hm(h) { h = +h || 0; var H = Math.floor(h), M = Math.round((h - H) * 60); return H + 'h ' + (M < 10 ? '0' : '') + M + 'm'; }
  function human(v) { return String(v || '').replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }); }

  function css() {
    if (document.getElementById('ep-css')) return;
    var st = document.createElement('style'); st.id = 'ep-css';
    st.textContent = [
      '.ep-wrap{max-width:1250px;margin:0 auto;padding:0 0 3rem}',
      '.ep-head h1{font-size:1.5rem;font-weight:700;margin:0}.ep-head p{color:#64748b;font-size:.9rem;margin:.25rem 0 1rem}',
      '.ep-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;margin-bottom:1rem}.dark .ep-tabs{border-color:#334155}',
      '.ep-tab{padding:.6rem 1rem;border:0;background:none;font-weight:600;color:#64748b;border-bottom:2px solid transparent;cursor:pointer;font-size:.92rem}',
      '.ep-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .ep-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.ep-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .ep-card{background:#1e293b;border-color:#334155}',
      '.ep-bar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end}',
      '.ep-bar label{display:flex;flex-direction:column;gap:.2rem;font-size:.75rem;font-weight:600;color:#64748b}',
      '.ep-bar input,.ep-bar select{border:1px solid #cbd5e1;border-radius:.55rem;padding:.5rem .6rem;font-size:.88rem;background:#fff;color:inherit;min-width:9rem}.dark .ep-bar input,.dark .ep-bar select{background:#0f172a;border-color:#334155}',
      '.ep-btn{border:1px solid #cbd5e1;background:#fff;border-radius:.55rem;padding:.5rem .8rem;font-weight:600;font-size:.85rem;cursor:pointer;color:inherit;white-space:nowrap}.dark .ep-btn{background:#0f172a;border-color:#334155}',
      '.ep-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}',
      '.ep-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.6rem;margin-bottom:1rem}',
      '.ep-tile{background:#fff;border:1px solid #e2e8f0;border-radius:.8rem;padding:.7rem .8rem}.dark .ep-tile{background:#1e293b;border-color:#334155}',
      '.ep-tile .k{font-size:.72rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.03em}.ep-tile .v{font-size:1.25rem;font-weight:700;margin-top:.15rem}.ep-tile .s{font-size:.75rem;color:#64748b}',
      '.ep-eng{border:1px solid #e2e8f0;border-radius:.9rem;background:#fff;margin-bottom:.7rem;overflow:hidden}.dark .ep-eng{background:#1e293b;border-color:#334155}',
      '.ep-eng>summary{list-style:none;cursor:pointer;padding:.8rem 1rem;display:flex;gap:.7rem;align-items:center;flex-wrap:wrap}.ep-eng>summary::-webkit-details-marker{display:none}',
      '.ep-av{width:38px;height:38px;border-radius:50%;background:#e0e7ff;color:#3730a3;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}',
      '.ep-nm{flex:1;min-width:150px}.ep-nm b{display:block}.ep-nm small{color:#64748b}',
      '.ep-pills{display:flex;gap:.35rem;flex-wrap:wrap}',
      '.ep-pill{font-size:.75rem;font-weight:600;border-radius:999px;padding:.2rem .55rem;background:#f1f5f9;color:#334155;white-space:nowrap}.dark .ep-pill{background:#0f172a;color:#cbd5e1}',
      '.ep-pill.g{background:#dcfce7;color:#166534}.ep-pill.r{background:#fee2e2;color:#991b1b}.ep-pill.b{background:#dbeafe;color:#1e40af}.ep-pill.p{background:#ede9fe;color:#5b21b6}',
      '.ep-body{padding:0 1rem 1rem;display:grid;grid-template-columns:1fr 1fr;gap:1rem}@media(max-width:760px){.ep-body{grid-template-columns:1fr}}',
      '.ep-sec h4{margin:.4rem 0 .4rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b}',
      '.ep-li[hidden]{display:none}.ep-li{display:flex;gap:.5rem;padding:.45rem 0;border-top:1px solid #f1f5f9;font-size:.85rem}.dark .ep-li{border-color:#334155}',
      '.ep-li .t{color:#64748b;min-width:4.2rem;font-size:.78rem}.ep-li .x{flex:1;min-width:0}.ep-li .x small{display:block;color:#64748b;line-height:1.35}',
      '.ep-empty{color:#64748b;font-size:.85rem;padding:.4rem 0}',
      '.ep-tbl{width:100%;border-collapse:collapse;font-size:.84rem}.ep-tbl th{text-align:left;font-size:.72rem;text-transform:uppercase;color:#64748b;padding:.5rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.ep-tbl td{padding:.5rem;border-bottom:1px solid #f1f5f9;vertical-align:top}.dark .ep-tbl th,.dark .ep-tbl td{border-color:#334155}',
      '.ep-tbl td.r,.ep-tbl th.r{text-align:right}.ep-tbl tr.click{cursor:pointer}.ep-tbl tr.click:hover td{background:#f8fafc}.dark .ep-tbl tr.click:hover td{background:#0f172a}',
      '.ep-scroll{overflow-x:auto}',
      '.ep-day{font-weight:700;font-size:.85rem;margin:.9rem 0 .2rem;color:#1e3a8a}.dark .ep-day{color:#93c5fd}',
      '@media(max-width:640px){.ep-tile .v{font-size:1.05rem}.ep-bar label{flex:1 1 45%}.ep-bar input,.ep-bar select{min-width:0;width:100%}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var S = { tab: 'day', date: iso(new Date()), from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: iso(new Date()), user: '' };
  var body, engines = [];
  function tile(k, v, s) { return el('div', { class: 'ep-tile' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', text: String(v) }), s ? el('div', { class: 's', text: s }) : null]); }
  function pill(t, c) { return el('span', { class: 'ep-pill' + (c ? ' ' + c : ''), text: t }); }

  // ── 1. Day summary ──
  function dayView() {
    clear(body);
    var d = el('input', { type: 'date', id: 'ep-date', value: S.date });
    d.onchange = function () { S.date = d.value; dayView(); };
    function shift(n) { var x = new Date(S.date + 'T00:00:00'); x.setDate(x.getDate() + n); S.date = iso(x); dayView(); }
    body.appendChild(el('div', { class: 'ep-card' }, [el('div', { class: 'ep-bar' }, [el('label', {}, ['Day', d]),
      el('button', { class: 'ep-btn', type: 'button', text: '‹ Previous', onclick: function () { shift(-1); } }),
      el('button', { class: 'ep-btn', type: 'button', text: 'Next ›', onclick: function () { shift(1); } }),
      el('button', { class: 'ep-btn', type: 'button', text: 'Today', onclick: function () { S.date = iso(new Date()); dayView(); } })])]));
    var tiles = el('div', { class: 'ep-tiles', id: 'ep-day-tiles' }), list = el('div', { id: 'ep-day-list' }, [el('div', { class: 'ep-empty', text: 'Loading…' })]);
    body.appendChild(tiles); body.appendChild(list);
    api('/engineer-report/day?date=' + S.date).then(function (j) {
      var t = j.data.totals;
      [tile('Present', t.present + ' / ' + t.engineers, 'engineers'), tile('Planned', t.planned, 'appointments + follow-ups'), tile('Visits', t.visits, t.jointVisits + ' joint'),
       tile('Travelled', t.km + ' km', hm(t.hours) + ' on duty'), tile('Orders', t.orders, money(t.orderValue)), tile('Quotations', t.quotations, money(t.quoteValue)), tile('Price requests', t.priceRequests)]
        .forEach(function (x) { tiles.appendChild(x); });
      clear(list);
      if (!j.data.team.length) list.appendChild(el('div', { class: 'ep-card ep-empty', text: 'No engineers.' }));
      j.data.team.forEach(function (e) { list.appendChild(engCard(e)); });
    }).catch(function (e) { clear(list).appendChild(el('div', { class: 'ep-card ep-empty', text: e.message })); });
  }
  function engCard(e) {
    var s = e.summary, planN = e.plan.appointments.length + e.plan.followUps.length;
    var card = el('details', { class: 'ep-eng', 'data-eng': e.user.id });
    card.appendChild(el('summary', {}, [
      el('span', { class: 'ep-av', text: (e.user.name || '?').charAt(0).toUpperCase() }),
      el('span', { class: 'ep-nm' }, [el('b', { text: e.user.name }), el('small', { text: e.checkIn ? 'In ' + tm(e.checkIn) + (e.checkOut ? ' · Out ' + tm(e.checkOut) : ' · still working') + (e.late ? ' · ' + e.late + ' min late' : '') : 'Not punched in' })]),
      el('span', { class: 'ep-pills' }, [
        e.checkIn ? pill(hm(s.hours)) : pill('Absent', 'r'),
        pill('🚗 ' + s.km + ' km', 'b'),
        pill('📋 ' + planN + ' planned'),
        pill('🤝 ' + s.visits + ' visits' + (s.jointVisits + s.jointAsColleague ? ' · ' + (s.jointVisits + s.jointAsColleague) + ' joint' : ''), s.visits ? 'g' : ''),
        s.orders ? pill('📦 ' + s.orders + ' · ' + money(s.orderValue), 'p') : null,
        s.quotations ? pill('📄 ' + s.quotations + ' · ' + money(s.quoteValue)) : null])]));
    var plan = el('div', { class: 'ep-sec' }, [el('h4', { text: 'Plan for the day' })]);
    if (!planN) plan.appendChild(el('div', { class: 'ep-empty', text: 'Nothing planned.' }));
    e.plan.appointments.forEach(function (a) {
      plan.appendChild(el('div', { class: 'ep-li' }, [el('span', { class: 't', text: a.appointmentTime || '—' }), el('span', { class: 'x' }, ['📅 ' + (a.companyName || a.title || 'Appointment'),
        el('small', { text: (a.title || '') + (a.visitStatus ? ' · ' + human(a.visitStatus) : a.status ? ' · ' + human(a.status) : '') })])]));
    });
    e.plan.followUps.forEach(function (f) {
      plan.appendChild(el('div', { class: 'ep-li' }, [el('span', { class: 't', text: f.time || tm(f.at) }), el('span', { class: 'x' }, [(f.done ? '✅ ' : '⏳ ') + 'Follow-up: ' + (f.customer || ''),
        el('small', { text: f.done ? 'Done — visited / called' : 'Not done yet' })])]));
    });
    var done = el('div', { class: 'ep-sec' }, [el('h4', { text: 'Done — where he went' })]);
    if (!e.visits.length) done.appendChild(el('div', { class: 'ep-empty', text: 'No visits logged.' }));
    e.visits.forEach(function (v) {
      done.appendChild(el('div', { class: 'ep-li', 'data-visit': v.id }, [el('span', { class: 't', text: tm(v.at) }), el('span', { class: 'x' }, [
        (v.type === 'CALL' ? '📞 ' : '🤝 ') + v.customer + (v.verified ? ' 📍' : ''),
        el('small', { text: human(v.type) + ' · ' + human(v.status) + (v.minutes ? ' · ' + v.minutes + ' min' : '') + (v.joint ? ' · 👥 with ' + (v.with.join(', ') || 'others') : '') }),
        v.summary ? el('small', { text: v.summary }) : null])]));
    });
    var ords = e.orders || [];
    ords.forEach(function (o, i) {
      if (i === 5) {
        var more = el('button', { type: 'button', class: 'ep-btn', style: 'margin:.3rem 0', text: '+ ' + (ords.length - 5) + ' more orders', onclick: function () { done.querySelectorAll('.ep-more-o').forEach(function (x) { x.hidden = false; }); more.remove(); } });
        done.appendChild(more);
      }
      done.appendChild(el('div', { class: 'ep-li' + (i >= 5 ? ' ep-more-o' : ''), hidden: i >= 5 ? true : null }, [el('span', { class: 't', text: '' }), el('span', { class: 'x' }, ['📦 Order ' + (o.orderNo || '') + ' · ' + (o.customer || ''), el('small', { text: (o.value ? money(o.value) : 'value not entered') + (o.firm ? ' · ' + o.firm : '') })])]));
    });
    if (e.stops && e.stops.length) done.appendChild(el('div', { class: 'ep-li' }, [el('span', { class: 't', text: '' }), el('span', { class: 'x' }, ['📍 ' + e.stops.length + ' stop' + (e.stops.length === 1 ? '' : 's') + ' of 20+ min',
      el('small', {}, [e.stops.map(function (x) { return tm(x.from) + '–' + tm(x.to) + ' (' + x.minutes + ' min)'; }).join(' · '), ' ', el('a', { href: '/admin/location-history/?userId=' + encodeURIComponent(e.user.id) + '&date=' + S.date, text: 'Map →' })])])]));
    card.appendChild(el('div', { class: 'ep-body' }, [plan, done]));
    return card;
  }

  // ── 2. Performance report ──
  function download(fmt) {
    var q = '/engineer-report/performance?from=' + S.from + '&to=' + S.to + (S.user ? '&userId=' + encodeURIComponent(S.user) : '') + '&format=' + fmt;
    fetch(API + '/api' + q, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) throw new Error('Could not download (' + r.status + ')');
      var name = ((r.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)/) || [])[1] || 'engineer-performance.' + (fmt === 'pdf' ? 'pdf' : 'xlsx');
      return r.blob().then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); });
    }).catch(function (e) { alert(e.message); });
  }
  function perfView() {
    clear(body);
    var preset = el('select', { id: 'ep-preset' }, [['month', 'This month'], ['last', 'Last month'], ['week', 'Last 7 days'], ['custom', 'Custom dates']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var f = el('input', { type: 'date', id: 'ep-from', value: S.from }), t = el('input', { type: 'date', id: 'ep-to', value: S.to });
    var who = el('select', { id: 'ep-user' }, [el('option', { value: '', text: 'All engineers (team)' })].concat(engines.map(function (u) { return el('option', { value: u.id, text: u.name }); })));
    who.value = S.user;
    preset.value = 'custom';
    preset.onchange = function () {
      var n = new Date(), a, b = iso(n);
      if (preset.value === 'month') a = iso(new Date(n.getFullYear(), n.getMonth(), 1));
      else if (preset.value === 'last') { a = iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)); b = iso(new Date(n.getFullYear(), n.getMonth(), 0)); }
      else if (preset.value === 'week') a = iso(new Date(n.getTime() - 6 * 864e5));
      if (a) { S.from = f.value = a; S.to = t.value = b; load(); }
    };
    f.onchange = t.onchange = function () { if (f.value && t.value) { S.from = f.value; S.to = t.value; preset.value = 'custom'; load(); } };
    who.onchange = function () { S.user = who.value; load(); };
    body.appendChild(el('div', { class: 'ep-card' }, [el('div', { class: 'ep-bar' }, [el('label', {}, ['Period', preset]), el('label', {}, ['From', f]), el('label', {}, ['To', t]), el('label', {}, ['Engineer', who]),
      el('button', { class: 'ep-btn', type: 'button', id: 'ep-xlsx', text: '⬇ Excel', onclick: function () { download('excel'); } }),
      el('button', { class: 'ep-btn', type: 'button', id: 'ep-pdf', text: '⬇ PDF', onclick: function () { download('pdf'); } })])]));
    var out = el('div', { id: 'ep-perf' }, [el('div', { class: 'ep-empty', text: 'Loading…' })]);
    body.appendChild(out);
    function load() {
      clear(out).appendChild(el('div', { class: 'ep-empty', text: 'Loading…' }));
      api('/engineer-report/performance?from=' + S.from + '&to=' + S.to + (S.user ? '&userId=' + encodeURIComponent(S.user) : '')).then(function (j) {
        clear(out);
        if (S.user) detail(out, j.data); else team(out, j.data.team, function (id) { S.user = id; who.value = id; load(); });
      }).catch(function (e) { clear(out).appendChild(el('div', { class: 'ep-card ep-empty', text: e.message })); });
    }
    load();
  }
  function team(out, list, open) {
    var tb = el('tbody');
    list.forEach(function (x) {
      var s = x.summary;
      tb.appendChild(el('tr', { class: 'click', 'data-team-user': x.user.id, onclick: function () { open(x.user.id); } }, [
        el('td', {}, [el('b', { text: x.user.name }), el('div', { style: 'font-size:.75rem;color:#64748b', text: human(x.user.role) })]),
        el('td', { class: 'r', text: String(s.daysPresent) }), el('td', { class: 'r', text: hm(s.hours) }), el('td', { class: 'r', text: s.km + ' km' }),
        el('td', { class: 'r', text: String(s.visits) }), el('td', { class: 'r', text: String(s.jointVisits + s.jointAsColleague) }), el('td', { class: 'r', text: String(s.customersVisited) }),
        el('td', { class: 'r', text: s.followUpsDone + ' / ' + s.followUpsDue + (s.followUpsOverdue ? ' (' + s.followUpsOverdue + ' overdue)' : '') }),
        el('td', { class: 'r', text: String(s.orders) }), el('td', { class: 'r', text: money(s.orderValue) }), el('td', { class: 'r', text: s.quotations + ' · ' + money(s.quoteValue) })]));
    });
    out.appendChild(el('div', { class: 'ep-card' }, [el('p', { style: 'margin:0 0 .5rem;font-size:.85rem;color:#64748b', text: 'Click an engineer for the detailed report.' }),
      el('div', { class: 'ep-scroll' }, [el('table', { class: 'ep-tbl', id: 'ep-team' }, [el('thead', {}, [el('tr', {}, ['Engineer', 'Days', 'Hours', 'Travelled', 'Visits', 'Joint', 'Customers', 'Follow-ups done', 'Orders', 'Order value', 'Quotations'].map(function (h, i) { return el('th', { class: i ? 'r' : null, text: h }); }))]), tb])])]));
  }
  function detail(out, d) {
    var s = d.summary;
    out.appendChild(el('div', { class: 'ep-card', style: 'padding:.8rem 1rem' }, [el('b', { style: 'font-size:1.1rem', text: d.user.name }), ' ', el('span', { style: 'color:#64748b;font-size:.85rem', text: human(d.user.role) + ' · ' + dmy(d.from) + ' – ' + dmy(d.to) })]));
    var tiles = el('div', { class: 'ep-tiles', id: 'ep-sum' });
    [tile('Days worked', s.daysPresent, hm(s.hours) + ' on duty'), tile('Travelled', s.km + ' km', (s.odometerKm ? s.odometerKm + ' km odometer · ' : '') + s.kmPerDay + ' km/day'),
     tile('Stops (20+ min)', s.stops, Math.round(s.stopMinutes / 60 * 10) / 10 + ' h stopped'), tile('Visits', s.visits, (s.daysPresent ? s.visitsPerDay + '/day · ' : '') + s.customersVisited + ' customers'),
     tile('Joint visits', s.jointVisits + s.jointAsColleague, s.jointVisits + ' led · ' + s.jointAsColleague + ' as colleague'),
     tile('Follow-ups', s.followUpsDone + ' / ' + s.followUpsDue, s.followUpsOverdue ? s.followUpsOverdue + ' overdue now' : 'none overdue'),
     tile('Orders', s.orders, money(s.orderValue) + (s.visits && s.conversion <= 100 ? ' · ' + s.conversion + '% of visits' : '')), tile('Invoiced', money(s.invoiceValue), s.invoices + ' invoices'),
     tile('Quotations', s.quotations, money(s.quoteValue)), tile('Price requests', s.priceRequests, s.trials + ' trials')].forEach(function (x) { tiles.appendChild(x); });
    out.appendChild(tiles);
    // where he went — visits by day
    var w = el('div', { class: 'ep-card', id: 'ep-visits' }, [el('h3', { style: 'margin:0 0 .3rem;font-size:1rem', text: '📍 Where he went (' + d.visits.length + ' visits)' })]);
    if (!d.visits.length) w.appendChild(el('div', { class: 'ep-empty', text: 'No visits in this period.' }));
    var last = '';
    d.visits.forEach(function (v) {
      var day = String(v.at).slice(0, 10);
      if (day !== last) { last = day; w.appendChild(el('div', { class: 'ep-day', text: dmy(day) })); }
      w.appendChild(el('div', { class: 'ep-li' }, [el('span', { class: 't', text: tm(v.at) }), el('span', { class: 'x' }, [
        (v.type === 'CALL' ? '📞 ' : '🤝 ') + v.customer + (v.location ? ' — ' + v.location : '') + (v.verified ? ' 📍' : ''),
        el('small', { text: human(v.type) + ' · ' + human(v.status) + (v.minutes ? ' · ' + v.minutes + ' min there' : '') + (v.joint ? ' · 👥 ' + (v.loggedBy ? 'joined ' + v.loggedBy : 'with ' + (v.with.join(', ') || 'others')) : '') }),
        v.summary ? el('small', { text: v.summary }) : null])]));
    });
    out.appendChild(w);
    // day by day
    var tb = el('tbody');
    d.days.forEach(function (x) {
      tb.appendChild(el('tr', {}, [el('td', { text: dmy(x.date) }), el('td', { text: x.checkIn ? tm(x.checkIn) + ' – ' + (x.checkOut ? tm(x.checkOut) : '…') : '—' }), el('td', { class: 'r', text: x.hours ? hm(x.hours) : '' }),
        el('td', { class: 'r' }, [x.km ? el('a', { href: '/admin/location-history/?userId=' + encodeURIComponent(d.user.id) + '&date=' + x.date, text: x.km + ' km' }) : '']),
        el('td', { class: 'r', text: x.odometerKm != null ? x.odometerKm + ' km' : '' }), el('td', { class: 'r', text: x.stops || '' }), el('td', { class: 'r', text: x.visits || '' }),
        el('td', { text: x.customers.join(', ') }), el('td', { class: 'r', text: x.orders ? x.orders + ' · ' + money(x.orderValue) : '' }), el('td', { class: 'r', text: x.quotations ? x.quotations + ' · ' + money(x.quoteValue) : '' })]));
    });
    out.appendChild(el('div', { class: 'ep-card' }, [el('h3', { style: 'margin:0 0 .5rem;font-size:1rem', text: '📅 Day by day' }), el('div', { class: 'ep-scroll' }, [el('table', { class: 'ep-tbl', id: 'ep-days' }, [
      el('thead', {}, [el('tr', {}, ['Day', 'Punch in – out', 'Hours', 'GPS km', 'Odometer', 'Stops', 'Visits', 'Customers', 'Orders', 'Quotations'].map(function (h, i) { return el('th', { class: [2, 3, 4, 5, 6, 8, 9].indexOf(i) !== -1 ? 'r' : null, text: h }); }))]), tb])])]));
    // orders + quotations + top customers
    function list(title, rows, fn) { var c = el('div', { class: 'ep-card' }, [el('h3', { style: 'margin:0 0 .3rem;font-size:1rem', text: title })]); if (!rows.length) c.appendChild(el('div', { class: 'ep-empty', text: 'None.' })); rows.forEach(function (r) { c.appendChild(fn(r)); }); return c; }
    var grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem' });
    grid.appendChild(list('📦 Orders (' + d.orders.length + ') · ' + money(s.orderValue), d.orders, function (o) {
      return el('div', { class: 'ep-li' }, [el('span', { class: 't', text: dmy(o.date) }), el('span', { class: 'x' }, [(o.orderNo || '') + ' · ' + (o.customer || ''), el('small', { text: (o.value ? money(o.value) : 'value not entered') + ' · ' + (o.type === 'PO' ? 'PO' : 'Verbal') + (o.firm ? ' · ' + o.firm : '') + ' · ' + human(o.delivery) })])]);
    }));
    grid.appendChild(list('📄 Quotations (' + d.quotations.length + ') · ' + money(s.quoteValue), d.quotations, function (q) {
      return el('div', { class: 'ep-li' }, [el('span', { class: 't', text: dmy(q.date) }), el('span', { class: 'x' }, [q.number + ' · ' + (q.customer || ''), el('small', { text: money(q.value) + ' · ' + human(q.status) })])]);
    }));
    grid.appendChild(list('🏢 Most visited customers', d.topCustomers, function (c) {
      return el('div', { class: 'ep-li' }, [el('span', { class: 'x', text: c.customer }), el('b', { text: c.visits + '×' })]);
    }));
    out.appendChild(grid);
  }

  function render() {
    body.parentNode.querySelectorAll('.ep-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ep-tab') === S.tab); });
    try { history.replaceState(null, '', '#' + S.tab); } catch (e) {}
    if (S.tab === 'day') dayView(); else perfView();
  }
  function mountPage(content) {
    css();
    if (/^#perf/.test(location.hash)) S.tab = 'perf';
    var m = location.search.match(/[?&]userId=([^&]+)/); if (m) { S.user = decodeURIComponent(m[1]); S.tab = 'perf'; }
    var wrap = el('div', { class: 'ep-wrap' });
    wrap.appendChild(el('div', { class: 'ep-head' }, [el('h1', { text: 'Engineer performance' }),
      el('p', { text: 'Each engineer’s day — plan against what was done — and the performance report: where he went, how far he travelled, visits, orders and value.' })]));
    wrap.appendChild(el('div', { class: 'ep-tabs' }, [['day', '📋 Day summary'], ['perf', '📈 Performance report']].map(function (t) {
      return el('button', { type: 'button', class: 'ep-tab', 'data-ep-tab': t[0], text: t[1], onclick: function () { S.tab = t[0]; render(); } });
    })));
    body = el('div', { id: 'ep-body' });
    wrap.appendChild(body);
    content.appendChild(wrap);
    api('/engineer-report/performance?from=' + S.from + '&to=' + S.to).then(function (j) { engines = j.data.team.map(function (x) { return x.user; }); if (S.tab === 'perf') render(); }).catch(function () {});
    render();
  }
  window.EngineerPerformancePage = { mountPage: mountPage };
})();
