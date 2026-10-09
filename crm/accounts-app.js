/* ══════════════════════════════════════════════════════════════════════
   Accounts — for the accounts team (role ACCOUNTS), Admins and the MD.

   Overview        this month, receivables (with ageing), payables, Tally
                   pending, customers with the most outstanding, bills due
   Invoices        sales invoices (taxable + GST = total, due date) with
                   paid / balance / overdue from the receipts against them
   Receipts        money received (against an invoice, or on account)
   Vendor bills    purchase bills, and Vendor payments against them
   Tally works     everything not yet entered in Tally → mark posted with
                   the Tally voucher no.; Excel list to enter from
   Vouchers        other Tally vouchers (journal, contra, credit note…)
   Staff claims    fuel / travel claims per employee for the month
   Every entry can carry the bill / invoice copy (PDF or photo).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  function api(method, path, body) {
    var opt = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body instanceof FormData) opt.body = body;
    else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(API + '/api' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed (' + r.status + ')');
        return j;
      });
    });
  }
  function checkFile(b, name) {
    var sig = /\.(xlsx|zip)$/i.test(name || '') ? [80, 75, 3, 4] : /\.pdf$/i.test(name || '') ? [37, 80, 68, 70] : null;
    if (!sig || !b || !b.arrayBuffer) return Promise.resolve(b);
    return b.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), lim = Math.min(u.length - 4, 1 << 20);
      for (var i = 0; i <= lim; i++) if (u[i] === sig[0] && u[i + 1] === sig[1] && u[i + 2] === sig[2] && u[i + 3] === sig[3]) return i === 0 ? b : new Blob([u.subarray(i)], { type: b.type });
      var t = new TextDecoder().decode(u.subarray(0, 4000)), m = '';
      try { m = JSON.parse(t).message || ''; } catch (e) { m = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
      throw new Error('The server sent an error instead of the file' + (m ? ': ' + m : '.'));
    });
  }
  function download(path, open) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Download failed'); });
      var cd = r.headers.get('Content-Disposition') || '', m = /filename="?([^";]+)"?/.exec(cd), name = m ? m[1] : 'download';
      return r.blob().then(function (b) { return checkFile(b, name); }).then(function (b) {
        var u = URL.createObjectURL(b);
        if (open) { window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); return; }
        var a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      });
    }).catch(function (e) { toast(e.message, 'err'); });
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
  function money(v) { return v == null || v === '' ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function short(v) {
    v = Number(v) || 0; var a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L';
    return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function today() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function toast(msg, kind) {
    document.querySelectorAll('.ac-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'ac-toast' + (kind === 'err' ? ' err' : ''), text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }

  var KIND = {
    INVOICE: { label: 'Invoice', plural: 'Invoices', party: 'Customer', no: 'Invoice no.', ptype: 'customer', hash: 'invoices' },
    RECEIPT: { label: 'Receipt', plural: 'Receipts', party: 'Customer', no: 'Receipt no.', ptype: 'customer', hash: 'receipts', link: 'INVOICE' },
    BILL:    { label: 'Vendor bill', plural: 'Vendor bills', party: 'Vendor', no: 'Bill no.', ptype: 'vendor', hash: 'bills' },
    PAYMENT: { label: 'Vendor payment', plural: 'Vendor payments', party: 'Vendor', no: 'Payment / cheque no.', ptype: 'vendor', hash: 'payments', link: 'BILL' },
    VOUCHER: { label: 'Voucher', plural: 'Vouchers', party: 'Ledger / party', no: 'Voucher no.', ptype: '', hash: 'vouchers' }
  };
  var PAY = { PAID: ['Paid', '#16a34a'], PARTIAL: ['Part paid', '#d97706'], UNPAID: ['Unpaid', '#2563eb'], OVERDUE: ['Overdue', '#dc2626'] };
  var MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER'];
  var VTYPES = ['Journal', 'Contra', 'Credit Note', 'Debit Note', 'Expense', 'Salary', 'Other'];
  var TABS = [['', 'Overview'], ['invoices', 'Invoices'], ['receipts', 'Receipts'], ['bills', 'Vendor bills'], ['payments', 'Vendor payments'], ['tally', 'Tally works'], ['vouchers', 'Vouchers'], ['claims', 'Staff claims']];

  function injectCss() {
    if (document.getElementById('ac-css')) return;
    var st = document.createElement('style'); st.id = 'ac-css';
    st.textContent = [
      '.ac-wrap{max-width:1350px;margin:0 auto}',
      '.ac-head h1{font-size:1.35rem;font-weight:700;margin:0}.ac-head p{margin:.15rem 0 .8rem;color:#64748b;font-size:.85rem}',
      '.ac-tabs{display:flex;gap:.2rem;border-bottom:1px solid #e2e8f0;margin-bottom:1rem;overflow-x:auto}.dark .ac-tabs{border-color:#334155}',
      '.ac-tab{padding:.55rem .9rem;font-size:.88rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.ac-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .ac-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.ac-tab .n{display:inline-block;min-width:1.2rem;padding:0 .35rem;margin-left:.3rem;border-radius:999px;background:#d97706;color:#fff;font-size:.7rem;line-height:1.2rem;text-align:center}',
      '.ac-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .ac-card{background:#1e293b;border-color:#334155}',
      '.ac-card h2{font-size:1rem;font-weight:700;margin:0 0 .7rem;display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap}',
      '.ac-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.75rem;margin-bottom:1rem}',
      '.ac-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:.85rem 1rem;cursor:pointer;text-align:left;color:inherit}.dark .ac-kpi{background:#1e293b;border-color:#334155}',
      '.ac-kpi:hover{border-color:#94a3b8}.ac-kpi span{display:block;font-size:.74rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.03em}',
      '.ac-kpi b{display:block;font-size:1.45rem;margin:.2rem 0 .1rem;font-variant-numeric:tabular-nums}.ac-kpi small{font-size:.78rem;color:#64748b}.ac-kpi small.bad{color:#dc2626;font-weight:600}',
      '.ac-2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}@media (max-width:900px){.ac-2{grid-template-columns:1fr}}',
      '.ac-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.7rem}',
      '.ac-bar input,.ac-bar select{border:1px solid #cbd5e1;border-radius:.5rem;padding:.42rem .6rem;font-size:.85rem;background:#fff;color:inherit}.ac-bar input[type=search]{min-width:200px;flex:1}',
      '.dark .ac-bar input,.dark .ac-bar select{background:#0f172a;border-color:#334155}.ac-bar .sp{flex:1}',
      '.ac-btn{display:inline-flex;align-items:center;gap:.35rem;border-radius:.55rem;padding:.45rem .85rem;font-size:.84rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.ac-btn:hover{background:#f1f5f9}.ac-btn:disabled{opacity:.55;cursor:default}.ac-btn.sm{padding:.22rem .55rem;font-size:.76rem}',
      '.ac-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.ac-btn.pri:hover{background:#1e40af}.ac-btn.grn{background:#0f766e;border-color:#0f766e;color:#fff}',
      '.ac-btn.red{color:#b91c1c;border-color:#fecaca}.dark .ac-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .ac-btn.pri{background:#2563eb}.dark .ac-btn.grn{background:#0d9488}',
      '.ac-tw{overflow-x:auto}.ac-table{width:100%;border-collapse:collapse;font-size:.83rem}',
      '.ac-table th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.45rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.ac-table td{padding:.45rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.dark .ac-table th,.dark .ac-table td{border-color:#334155}',
      '.ac-table td.d{white-space:nowrap}.ac-table .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.ac-table .sub{color:#64748b;font-size:.74rem}.ac-table tfoot td{font-weight:700;border-top:2px solid #e2e8f0}',
      '.ac-table input{border:1px solid #cbd5e1;border-radius:.4rem;padding:.25rem .4rem;font-size:.8rem;width:110px;background:#fff;color:inherit}.dark .ac-table input{background:#0f172a;border-color:#334155}',
      '.ac-acts{display:flex;gap:.3rem;flex-wrap:wrap;justify-content:flex-end}',
      '.ac-badge{display:inline-block;padding:.08rem .5rem;border-radius:999px;font-size:.72rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);white-space:nowrap}',
      'button.ac-badge{border:0;cursor:pointer}',
      '.ac-empty{padding:1.5rem;text-align:center;color:#64748b;font-size:.88rem}',
      '.ac-age{display:grid;grid-template-columns:repeat(5,1fr);gap:.4rem}.ac-age div{border-radius:.6rem;padding:.55rem;background:#f8fafc;font-size:.78rem}.dark .ac-age div{background:#0f172a}',
      '.ac-age b{display:block;font-size:.98rem;margin-top:.15rem;font-variant-numeric:tabular-nums}',
      '.ac-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483400;display:flex;align-items:flex-start;justify-content:center;padding:4vh 1rem;overflow:auto}',
      '.ac-dlg{background:#fff;border-radius:1rem;max-width:760px;width:100%;padding:1.15rem;box-shadow:0 20px 50px rgba(0,0,0,.3)}.dark .ac-dlg{background:#1e293b}',
      '.ac-dlg h3{margin:0 0 .8rem;font-size:1.1rem}.ac-dacts{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.9rem}',
      '.ac-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.6rem}.ac-f.w{grid-column:1/-1}',
      '.ac-f label{display:block;font-size:.73rem;font-weight:600;color:#475569;margin-bottom:.2rem}.dark .ac-f label{color:#94a3b8}',
      '.ac-f input,.ac-f select,.ac-f textarea{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.86rem;background:#fff;color:inherit;font-family:inherit}',
      '.dark .ac-f input,.dark .ac-f select,.dark .ac-f textarea{background:#0f172a;border-color:#334155}.ac-f textarea{min-height:56px}',
      '.ac-total{display:flex;gap:1.2rem;flex-wrap:wrap;justify-content:flex-end;margin-top:.7rem;padding:.6rem .8rem;border-radius:.6rem;background:#f8fafc;font-size:.88rem}.dark .ac-total{background:#0f172a}',
      '.ac-total b{font-variant-numeric:tabular-nums}',
      '.ac-qs{position:relative}.ac-sugg{position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #cbd5e1;border-radius:.5rem;box-shadow:0 10px 28px rgba(0,0,0,.18);max-height:240px;overflow:auto}',
      '.ac-sugg button{display:block;width:100%;text-align:left;border:0;background:none;padding:.42rem .6rem;cursor:pointer;font-size:.82rem;color:#0f172a}.ac-sugg button:hover{background:#eff6ff}.ac-sugg small{color:#64748b}',
      '.dark .ac-sugg{background:#1e293b;border-color:#334155}.dark .ac-sugg button{color:#e2e8f0}',
      '.ac-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s;max-width:90vw}',
      '.ac-toast.in{opacity:1;transform:translate(-50%,0)}.ac-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var root, tabsBox, body, tallyPending = 0;
  var isAdmin = ['SUPER_ADMIN', 'ADMIN'].indexOf(me().role) !== -1;

  function route() {
    var h = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (!TABS.some(function (t) { return t[0] === h; })) h = '';
    clear(tabsBox);
    TABS.forEach(function (t) {
      tabsBox.appendChild(el('button', { class: 'ac-tab' + (t[0] === h ? ' on' : ''), type: 'button', 'data-tab': t[0] || 'overview', onclick: function () { location.hash = '#/' + t[0]; } },
        [t[1], t[0] === 'tally' && tallyPending ? el('span', { class: 'n', text: String(tallyPending) }) : null]));
    });
    clear(body);
    if (h === '') overview();
    else if (h === 'tally') tally();
    else if (h === 'claims') claims();
    else entries(Object.keys(KIND).filter(function (k) { return KIND[k].hash === h; })[0]);
  }

  // ── overview ────────────────────────────────────────────────────────
  function overview() {
    body.appendChild(el('div', { class: 'ac-empty', text: 'Loading…' }));
    api('GET', '/accounts/summary').then(function (j) {
      var d = j.data; tallyPending = d.tallyPendingTotal; clear(body);
      var t = tabsBox.querySelector('[data-tab=tally]'); if (t && tallyPending && !t.querySelector('.n')) t.appendChild(el('span', { class: 'n', text: String(tallyPending) }));
      function kpi(label, val, sub, bad, hash) {
        return el('button', { type: 'button', class: 'ac-kpi', onclick: function () { if (hash != null) location.hash = '#/' + hash; } },
          [el('span', { text: label }), el('b', { text: short(val) }), sub ? el('small', { class: bad ? 'bad' : '', text: sub }) : null]);
      }
      body.appendChild(el('div', { class: 'ac-kpis', id: 'ac-kpis' }, [
        kpi('Invoiced this month', d.month.invoiced, 'Received ' + short(d.month.received), false, 'invoices'),
        kpi('To receive', d.receivable, d.overdueCount ? short(d.overdue) + ' overdue · ' + d.overdueCount + ' invoice' + (d.overdueCount === 1 ? '' : 's') : 'Nothing overdue', d.overdueCount > 0, 'invoices'),
        kpi('To pay vendors', d.payable, d.payableOverdue ? short(d.payableOverdue) + ' overdue' : (d.payableDue7 ? short(d.payableDue7) + ' due in 7 days' : 'Nothing due this week'), d.payableOverdue > 0, 'bills'),
        el('button', { type: 'button', class: 'ac-kpi', onclick: function () { location.hash = '#/tally'; } }, [el('span', { text: 'Tally pending' }), el('b', { text: String(d.tallyPendingTotal) }),
          el('small', { class: d.tallyPendingTotal ? 'bad' : '', text: d.tallyPendingTotal ? Object.keys(d.tallyPending).map(function (k) { var n = d.tallyPending[k]; return n + ' ' + (n === 1 ? KIND[k].label : KIND[k].plural).toLowerCase(); }).join(' · ') : 'All entered in Tally' })])
      ]));
      var ages = [['notDue', 'Not yet due'], ['d30', '1–30 days'], ['d60', '31–60 days'], ['d90', '61–90 days'], ['d90plus', '90+ days']];
      var ageCard = el('div', { class: 'ac-card' }, [el('h2', { text: 'Receivables by days overdue' }),
        el('div', { class: 'ac-age' }, ages.map(function (a, i) { return el('div', { style: i >= 3 && d.aging[a[0]] > 0 ? 'color:#b91c1c' : '' }, [a[1], el('b', { text: short(d.aging[a[0]]) })]); })),
        d.onAccount ? el('div', { class: 'ac-table sub', style: 'margin-top:.6rem;font-size:.78rem;color:#64748b', text: 'Plus ' + money(d.onAccount) + ' received on account (not linked to an invoice).' }) : null]);
      var trend = el('table', { class: 'ac-table' }, [el('thead', {}, [el('tr', {}, ['Month', 'Invoiced', 'Received', 'Vendor bills', 'Paid'].map(function (h, i) { return el('th', { class: i ? 'n' : '', text: h }); }))]),
        el('tbody', {}, d.trend.slice().reverse().map(function (m) { return el('tr', {}, [el('td', { text: m.month }), el('td', { class: 'n', text: money(m.invoiced) }), el('td', { class: 'n', text: money(m.received) }), el('td', { class: 'n', text: money(m.billed) }), el('td', { class: 'n', text: money(m.paid) })]); }))]);
      body.appendChild(el('div', { class: 'ac-2' }, [ageCard, el('div', { class: 'ac-card' }, [el('h2', { text: 'Last 6 months' }), el('div', { class: 'ac-tw' }, [trend])])]));
      var cust = d.customers.length ? el('table', { class: 'ac-table' }, [el('thead', {}, [el('tr', {}, ['Customer', 'Invoices', 'Outstanding', 'Overdue', 'Oldest due'].map(function (h, i) { return el('th', { class: i && i < 4 ? 'n' : '', text: h }); }))]),
        el('tbody', {}, d.customers.map(function (c) { return el('tr', {}, [el('td', { text: c.party }), el('td', { class: 'n', text: String(c.invoices) }), el('td', { class: 'n', text: money(c.balance) }),
          el('td', { class: 'n', style: c.overdue ? 'color:#dc2626;font-weight:600' : '', text: c.overdue ? money(c.overdue) : '—' }), el('td', { text: dmy(c.oldestDue) || '—' })]); }))]) : el('div', { class: 'ac-empty', text: 'No customer dues.' });
      var bills = d.upcomingBills.length ? el('table', { class: 'ac-table' }, [el('thead', {}, [el('tr', {}, ['Vendor', 'Bill', 'Due', 'Balance'].map(function (h, i) { return el('th', { class: i === 3 ? 'n' : '', text: h }); }))]),
        el('tbody', {}, d.upcomingBills.map(function (b) { return el('tr', {}, [el('td', { text: b.partyName }), el('td', { text: b.docNo }), el('td', {}, [b.dueDate ? dmy(b.dueDate) : '—', ' ', b.payStatus === 'OVERDUE' ? el('span', { class: 'ac-badge', style: '--c:#dc2626', text: 'Overdue' }) : null]), el('td', { class: 'n', text: money(b.balance) })]); }))]) : el('div', { class: 'ac-empty', text: 'No vendor bills to pay.' });
      body.appendChild(el('div', { class: 'ac-2' }, [
        el('div', { class: 'ac-card' }, [el('h2', {}, ['Customers with the most outstanding', el('button', { class: 'ac-btn sm', type: 'button', text: '⤓ Outstanding (Excel)', onclick: function () { download('/accounts/export?kind=OUTSTANDING'); } })]), el('div', { class: 'ac-tw' }, [cust])]),
        el('div', { class: 'ac-card' }, [el('h2', { text: 'Vendor bills to pay' }), el('div', { class: 'ac-tw' }, [bills])])
      ]));
    }).catch(function (e) { clear(body).appendChild(el('div', { class: 'ac-empty', text: e.message })); });
  }

  // ── entries list (invoices, receipts, bills, payments, vouchers) ────
  var filt = {};
  function entries(kind) {
    var K = KIND[kind]; filt[kind] = filt[kind] || { q: '', from: '', to: '', pay: '' };
    var f = filt[kind];
    var q = el('input', { type: 'search', placeholder: 'Search number, party, reference…', value: f.q, id: 'ac-q' });
    var from = el('input', { type: 'date', value: f.from, title: 'From date' }), to = el('input', { type: 'date', value: f.to, title: 'To date' });
    var bar = el('div', { class: 'ac-bar' }, [q, from, to]);
    var pay = null;
    if (kind === 'INVOICE' || kind === 'BILL') {
      pay = el('select', { id: 'ac-pay' }, [['', 'All'], ['DUE', kind === 'INVOICE' ? 'To receive' : 'To pay'], ['OVERDUE', 'Overdue'], ['PAID', 'Paid']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
      pay.value = f.pay; bar.appendChild(pay);
    }
    bar.appendChild(el('span', { class: 'sp' }));
    bar.appendChild(el('button', { class: 'ac-btn', type: 'button', text: '⤓ Excel', onclick: function () { download('/accounts/export?kind=' + kind + qs()); } }));
    bar.appendChild(el('button', { class: 'ac-btn pri', type: 'button', id: 'ac-new', text: '+ New ' + K.label.toLowerCase(), onclick: function () { editor(kind, null, reload); } }));
    var list = el('div', {});
    body.appendChild(el('div', { class: 'ac-card' }, [bar, list]));
    function qs() { return (f.q ? '&q=' + encodeURIComponent(f.q) : '') + (f.from ? '&from=' + f.from : '') + (f.to ? '&to=' + f.to : '') + (f.pay ? '&pay=' + f.pay : ''); }
    var t;
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { f.q = q.value.trim(); reload(); }, 250); };
    from.onchange = function () { f.from = from.value; reload(); };
    to.onchange = function () { f.to = to.value; reload(); };
    if (pay) pay.onchange = function () { f.pay = pay.value; reload(); };
    function reload() {
      clear(list).appendChild(el('div', { class: 'ac-empty', text: 'Loading…' }));
      api('GET', '/accounts/entries?kind=' + kind + qs()).then(function (j) { draw(j.data.entries || []); })
        .catch(function (e) { clear(list).appendChild(el('div', { class: 'ac-empty', text: e.message })); });
    }
    function draw(rows) {
      clear(list);
      if (!rows.length) { list.appendChild(el('div', { class: 'ac-empty', text: 'No ' + K.plural.toLowerCase() + ' yet. Use “+ New ' + K.label.toLowerCase() + '”.' })); return; }
      var big = kind === 'INVOICE' || kind === 'BILL';
      var heads = big ? [K.no, 'Date', K.party, 'Taxable', 'GST', 'Total', 'Balance', 'Due', 'Status', 'Tally', '']
        : kind === 'VOUCHER' ? ['Date', 'Type', K.no, K.party, 'Amount', 'Narration', 'Tally', '']
        : ['Date', K.no, K.party, 'Against', 'Amount', 'Mode / ref', 'Tally', ''];
      var numCols = big ? [3, 4, 5, 6] : kind === 'VOUCHER' ? [4] : [4];
      var tb = el('tbody'), tot = { taxable: 0, gst: 0, amount: 0, balance: 0 };
      rows.forEach(function (r) {
        tot.taxable += r.taxable || 0; tot.gst += r.gstAmount || 0; tot.amount += r.amount || 0; tot.balance += r.balance || 0;
        var acts = el('div', { class: 'ac-acts' });
        if (big && r.balance > 0) acts.appendChild(el('button', { class: 'ac-btn sm grn', type: 'button', 'data-pay': r.id, text: kind === 'INVOICE' ? '+ Receipt' : '+ Payment', onclick: function () { editor(kind === 'INVOICE' ? 'RECEIPT' : 'PAYMENT', { linkId: r.id, partyName: r.partyName, partyId: r.partyId, amount: r.balance }, reload); } }));
        acts.appendChild(fileBtn(r, reload));
        acts.appendChild(el('button', { class: 'ac-btn sm', type: 'button', text: 'Edit', onclick: function () { editor(kind, r, reload); } }));
        acts.appendChild(el('button', { class: 'ac-btn sm red', type: 'button', text: '✕', title: 'Delete', onclick: function () { del(r, reload); } }));
        var tallyCell = el('td', {}, [tallyBadge(r, reload)]);
        var cells;
        if (big) {
          var P = PAY[r.payStatus] || PAY.UNPAID;
          cells = [el('td', {}, [el('b', { text: r.docNo }), r.company !== 'TMS' && kind === 'INVOICE' ? el('div', { class: 'sub', text: r.company }) : null, r.orderRef || r.poRef ? el('div', { class: 'sub', text: [r.orderRef, r.poRef].filter(Boolean).join(' · ') }) : null]),
            el('td', { class: 'd', text: dmy(r.docDate) }), el('td', {}, [r.partyName, r.partyGstin ? el('div', { class: 'sub', text: r.partyGstin }) : null]),
            el('td', { class: 'n', text: money(r.taxable) }), el('td', { class: 'n', text: money(r.gstAmount) }), el('td', { class: 'n', text: money(r.amount) }),
            el('td', { class: 'n', style: r.balance > 0 ? 'font-weight:600' : 'color:#64748b', text: money(r.balance) }),
            el('td', { class: 'd', text: r.dueDate ? dmy(r.dueDate) : '—' }),
            el('td', {}, [el('span', { class: 'ac-badge', style: '--c:' + P[1], text: P[0] + (r.daysOverdue ? ' · ' + r.daysOverdue + 'd' : '') })]), tallyCell, el('td', {}, [acts])];
        } else if (kind === 'VOUCHER') {
          cells = [el('td', { text: dmy(r.docDate) }), el('td', { text: r.voucherType }), el('td', { text: r.docNo || '—' }), el('td', { text: r.partyName || '—' }), el('td', { class: 'n', text: money(r.amount) }),
            el('td', { class: 'sub', text: r.notes || '' }), tallyCell, el('td', {}, [acts])];
        } else {
          cells = [el('td', { text: dmy(r.docDate) }), el('td', { text: r.docNo || '—' }), el('td', { text: r.partyName }), el('td', {}, [r.linkNo ? el('b', { text: r.linkNo }) : el('span', { class: 'sub', text: 'On account' })]),
            el('td', { class: 'n', text: money(r.amount) }), el('td', {}, [r.mode, r.reference ? el('div', { class: 'sub', text: r.reference }) : null]), tallyCell, el('td', {}, [acts])];
        }
        tb.appendChild(el('tr', { 'data-row': r.id }, cells));
      });
      var foot = big ? el('tfoot', {}, [el('tr', {}, [el('td', { text: rows.length + ' ' + (rows.length === 1 ? K.label : K.plural).toLowerCase() }), el('td'), el('td'), el('td', { class: 'n', text: money(tot.taxable) }), el('td', { class: 'n', text: money(tot.gst) }),
          el('td', { class: 'n', text: money(tot.amount) }), el('td', { class: 'n', text: money(tot.balance) }), el('td'), el('td'), el('td'), el('td')])])
        : el('tfoot', {}, [el('tr', {}, heads.map(function (h, i) { return el('td', { class: i === 4 ? 'n' : '', text: i === 0 ? rows.length + (rows.length === 1 ? ' entry' : ' entries') : i === 4 ? money(tot.amount) : '' }); }))]);
      list.appendChild(el('div', { class: 'ac-tw' }, [el('table', { class: 'ac-table', id: 'ac-table' }, [el('thead', {}, [el('tr', {}, heads.map(function (h, i) { return el('th', { class: numCols.indexOf(i) !== -1 ? 'n' : '', text: h }); }))]), tb, foot])]));
    }
    reload();
  }

  function tallyBadge(r, after) {
    if (r.tallyStatus === 'POSTED') {
      return el('button', { type: 'button', class: 'ac-badge', style: '--c:#16a34a', title: 'Posted' + (r.tallyPostedByName ? ' by ' + r.tallyPostedByName : '') + ' — click to move back to pending',
        text: '✓ Tally' + (r.tallyVoucherNo ? ' ' + r.tallyVoucherNo : ''), onclick: function () {
          if (!confirm('Move this back to “not yet in Tally”?')) return;
          api('PATCH', '/accounts/entries/' + encodeURIComponent(r.id) + '/tally', { status: 'PENDING' }).then(function (j) { toast(j.message); after(); }).catch(function (e) { toast(e.message, 'err'); });
        } });
    }
    return el('button', { type: 'button', class: 'ac-badge', style: '--c:#d97706', title: 'Not yet entered in Tally — click when done', text: 'Tally pending', onclick: function () {
      var no = prompt('Entered in Tally? Tally voucher no. (optional):', '');
      if (no === null) return;
      api('PATCH', '/accounts/entries/' + encodeURIComponent(r.id) + '/tally', { status: 'POSTED', voucherNo: no }).then(function (j) { toast(j.message); after(); }).catch(function (e) { toast(e.message, 'err'); });
    } });
  }

  function fileBtn(r, after) {
    var inp = el('input', { type: 'file', accept: '.pdf,image/*,.xlsx,.xls', style: 'display:none' });
    inp.onchange = function () {
      if (!inp.files[0]) return;
      var fd = new FormData(); fd.append('file', inp.files[0]);
      api('POST', '/accounts/entries/' + encodeURIComponent(r.id) + '/file', fd).then(function (j) { toast(j.message); after(); }).catch(function (e) { toast(e.message, 'err'); });
    };
    var wrap = el('span', { style: 'display:inline-flex;gap:.3rem' }, [inp]);
    if (r.hasFile) wrap.appendChild(el('button', { class: 'ac-btn sm', type: 'button', title: r.fileName || 'Open copy', text: '📎 View', onclick: function () { download('/accounts/entries/' + encodeURIComponent(r.id) + '/file?inline=1', true); } }));
    wrap.appendChild(el('button', { class: 'ac-btn sm', type: 'button', title: r.hasFile ? 'Replace the attached copy' : 'Attach the bill / invoice copy (PDF or photo)', text: r.hasFile ? '↻' : '📎 Attach', onclick: function () { inp.click(); } }));
    return wrap;
  }

  function del(r, after) {
    if (!confirm('Delete ' + (KIND[r.kind].label.toLowerCase()) + (r.docNo ? ' ' + r.docNo : '') + ' (' + money(r.amount) + ')?')) return;
    api('DELETE', '/accounts/entries/' + encodeURIComponent(r.id)).then(function () { toast('Deleted'); after(); }).catch(function (e) { toast(e.message, 'err'); });
  }

  // ── editor ──────────────────────────────────────────────────────────
  function suggest(input, load, pick) {
    var box = el('div', { class: 'ac-sugg', hidden: true }), wrap = el('div', { class: 'ac-qs' }), t;
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input); wrap.appendChild(box);
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        load(input.value.trim()).then(function (items) {
          clear(box); box.hidden = !items.length;
          items.forEach(function (it) { box.appendChild(el('button', { type: 'button', onclick: function () { pick(it.v); box.hidden = true; } }, [el('b', { text: it.t + ' ' }), el('small', { text: it.s || '' })])); });
        }).catch(function () {});
      }, 220);
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) box.hidden = true; });
  }

  function editor(kind, row, after) {
    var K = KIND[kind], edit = row && row.id, r = row || {};
    var dlg = el('div', { class: 'ac-dlg', id: 'ac-dlg' }), modal = el('div', { class: 'ac-modal' }, [dlg]);
    function close() { modal.remove(); }
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    dlg.appendChild(el('h3', { text: (edit ? 'Edit ' : 'New ') + K.label.toLowerCase() + (edit && r.docNo ? ' ' + r.docNo : '') }));
    var g = el('div', { class: 'ac-grid' }), F = {};
    function fld(key, label, input, wide) { F[key] = input; input.id = 'ac-f-' + key; g.appendChild(el('div', { class: 'ac-f' + (wide ? ' w' : '') }, [el('label', { text: label }), input])); return input; }
    function inp(attrs) { return el('input', attrs || {}); }
    function sel(opts, v) { var s = el('select', {}, opts.map(function (o) { return el('option', { value: o[0], text: o[1] }); })); if (v != null) s.value = v; return s; }
    var big = kind === 'INVOICE' || kind === 'BILL';
    if (kind === 'INVOICE') fld('company', 'Company', sel([['TMS', 'TMS'], ['APJ', 'APJ']], r.company || 'TMS'));
    if (big) fld('docNo', K.no + ' *', inp({ value: r.docNo || '', placeholder: kind === 'INVOICE' ? 'e.g. TMS/2026-27/0154' : 'Bill no. on the vendor’s bill' }));
    fld('docDate', 'Date *', inp({ type: 'date', value: (r.docDate || today()).slice(0, 10) }));
    if (big) fld('dueDate', 'Due date', inp({ type: 'date', value: r.dueDate ? r.dueDate.slice(0, 10) : (edit ? '' : addDays(today(), 30)) }));
    if (kind === 'VOUCHER') fld('voucherType', 'Voucher type *', sel(VTYPES.map(function (v) { return [v, v]; }), r.voucherType || 'Journal'));
    if (!big) fld('docNo', K.no, inp({ value: r.docNo || '' }));
    var linkSel = null;
    if (K.link) {
      linkSel = sel([['', 'On account (not against a ' + (K.link === 'INVOICE' ? 'invoice' : 'bill') + ')']], '');
      fld('linkId', 'Against ' + (K.link === 'INVOICE' ? 'invoice' : 'vendor bill'), linkSel, true);
      api('GET', '/accounts/entries?kind=' + K.link).then(function (j) {
        (j.data.entries || []).filter(function (e) { return e.balance > 0 || e.id === r.linkId; }).forEach(function (e) {
          linkSel.appendChild(el('option', { value: e.id, text: e.docNo + ' · ' + e.partyName + ' · balance ' + money(e.balance) + (e.payStatus === 'OVERDUE' ? ' (overdue)' : '') }));
          linkSel.lastChild._e = e;
        });
        linkSel.value = r.linkId || '';
      });
      linkSel.onchange = function () {
        var o = linkSel.options[linkSel.selectedIndex], e = o && o._e;
        if (e) { F.partyName.value = e.partyName; F.partyName._id = e.partyId; if (!F.amount.value || !edit) F.amount.value = e.balance.toFixed(2); }
      };
    }
    var party = fld('partyName', K.party + (kind === 'VOUCHER' ? '' : ' *'), inp({ value: r.partyName || '', placeholder: kind === 'VOUCHER' ? 'e.g. Bank charges, Rent, Salary' : 'Start typing…' }), !big);
    party._id = r.partyId || null;
    if (big) fld('partyGstin', 'GSTIN', inp({ value: r.partyGstin || '', placeholder: '33ABCDE1234F1Z5', maxlength: 15, style: 'text-transform:uppercase' }));
    if (kind === 'INVOICE') {
      var ord = fld('orderRef', 'Order no.', inp({ value: r.orderRef || '', placeholder: 'Search an order…' }));
      ord._id = r.orderId || null;
      fld('poRef', 'Customer PO no.', inp({ value: r.poRef || '' }));
    }
    if (kind === 'BILL') fld('poRef', 'Our PO no.', inp({ value: r.poRef || '' }));
    if (big) {
      fld('taxable', 'Taxable value (₹) *', inp({ type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: r.taxable != null ? r.taxable : '' }));
      fld('gstPercent', 'GST %', sel([['0', '0 %'], ['5', '5 %'], ['12', '12 %'], ['18', '18 %'], ['28', '28 %']], r.gstPercent != null ? String(Number(r.gstPercent)) : '18'));
    } else {
      fld('amount', 'Amount (₹) *', inp({ type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: r.amount != null ? r.amount : '' }));
    }
    if (kind === 'RECEIPT' || kind === 'PAYMENT') {
      fld('mode', kind === 'RECEIPT' ? 'Received by *' : 'Paid by *', sel(MODES.map(function (m) { return [m, m === 'CHEQUE' ? 'Cheque' : m === 'CASH' ? 'Cash' : m === 'CARD' ? 'Card' : m === 'OTHER' ? 'Other' : m]; }), r.mode || 'NEFT'));
      fld('reference', 'UTR / cheque no.', inp({ value: r.reference || '' }));
    } else if (kind === 'VOUCHER') fld('reference', 'Reference', inp({ value: r.reference || '' }));
    fld('notes', kind === 'VOUCHER' ? 'Narration' : 'Notes', el('textarea', { rows: 2 }, [r.notes || '']), true);
    dlg.appendChild(g);
    var totals = null;
    if (big) {
      totals = el('div', { class: 'ac-total', id: 'ac-totals' });
      dlg.appendChild(totals);
      var upd = function () {
        var tx = parseFloat(F.taxable.value) || 0, gp = parseFloat(F.gstPercent.value) || 0, gst = Math.round(tx * gp) / 100;
        clear(totals).appendChild(el('span', {}, ['Taxable ', el('b', { text: money(tx) })]));
        totals.appendChild(el('span', {}, ['GST ', el('b', { text: money(gst) })]));
        totals.appendChild(el('span', {}, ['Total ', el('b', { text: money(tx + gst) })]));
      };
      F.taxable.addEventListener('input', upd); F.gstPercent.addEventListener('change', upd); upd();
    }
    if (K.ptype) {
      suggest(party, function (q) {
        return api('GET', '/accounts/parties?type=' + K.ptype + '&q=' + encodeURIComponent(q)).then(function (j) { return (j.data.parties || []).map(function (p) { return { t: p.name, s: [p.gstin, p.sub].filter(Boolean).join(' · '), v: p }; }); });
      }, function (p) { party.value = p.name; party._id = p.id; if (F.partyGstin && p.gstin && !F.partyGstin.value) F.partyGstin.value = p.gstin; });
    }
    if (kind === 'INVOICE') {
      suggest(F.orderRef, function (q) {
        return api('GET', '/accounts/orders?q=' + encodeURIComponent(q)).then(function (j) { return (j.data.orders || []).map(function (o) { return { t: o.orderNumber, s: (o.companyName || '') + ' · ' + dmy(o.orderDate) + (o.invoiceNo ? ' · invoiced ' + o.invoiceNo : ''), v: o }; }); });
      }, function (o) { F.orderRef.value = o.orderNumber; F.orderRef._id = o.id; if (!party.value) { party.value = o.companyName || ''; party._id = o.customerId; } });
    }
    var save = el('button', { class: 'ac-btn pri', type: 'button', id: 'ac-save', text: edit ? 'Save' : 'Save ' + K.label.toLowerCase() });
    save.onclick = function () {
      var b = { kind: kind, partyId: party._id || '' };
      Object.keys(F).forEach(function (k) { b[k] = F[k].value; });
      if (F.orderRef) b.orderId = F.orderRef._id || '';
      save.disabled = true;
      (edit ? api('PUT', '/accounts/entries/' + encodeURIComponent(r.id), b) : api('POST', '/accounts/entries', b)).then(function (j) {
        toast(j.message || 'Saved'); close(); after();
      }).catch(function (e) { toast(e.message, 'err'); save.disabled = false; });
    };
    dlg.appendChild(el('div', { class: 'ac-dacts' }, [el('button', { class: 'ac-btn', type: 'button', text: 'Cancel', onclick: close }), save]));
    document.body.appendChild(modal);
    (F.docNo && !F.docNo.value ? F.docNo : party).focus();
  }

  // ── Tally works ─────────────────────────────────────────────────────
  var tallyFilt = 'PENDING';
  function tally() {
    var st = el('select', { id: 'ac-tally-st' }, [['PENDING', 'Not yet in Tally'], ['POSTED', 'Entered in Tally'], ['ALL', 'All']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    st.value = tallyFilt;
    var list = el('div', {});
    var postSel = el('button', { class: 'ac-btn grn', type: 'button', id: 'ac-post-sel', text: '✓ Mark selected as entered', disabled: true });
    var bar = el('div', { class: 'ac-bar' }, [st, el('span', { class: 'sp' }), postSel,
      el('button', { class: 'ac-btn', type: 'button', text: '⤓ Excel to enter in Tally', onclick: function () { download('/accounts/export?kind=TALLY&tally=' + tallyFilt); } })]);
    body.appendChild(el('div', { class: 'ac-card' }, [
      el('h2', { text: 'Tally works' }),
      el('p', { style: 'margin:-.3rem 0 .8rem;font-size:.82rem;color:#64748b', text: 'Every invoice, receipt, vendor bill, payment and voucher shows here until it is entered in Tally. Type the Tally voucher no. and press “Entered”, or tick several and mark them together.' }),
      bar, list]));
    st.onchange = function () { tallyFilt = st.value; reload(); };
    var chosen = {};
    function reload() {
      chosen = {}; postSel.disabled = true;
      clear(list).appendChild(el('div', { class: 'ac-empty', text: 'Loading…' }));
      api('GET', '/accounts/tally?status=' + tallyFilt).then(function (j) {
        var rows = j.data.entries || [];
        tallyPending = Object.keys(j.data.pendingByKind || {}).reduce(function (a, k) { return a + j.data.pendingByKind[k]; }, 0);
        var t = tabsBox.querySelector('[data-tab=tally] .n'); if (t) t.textContent = String(tallyPending); if (t && !tallyPending) t.remove();
        clear(list);
        if (!rows.length) { list.appendChild(el('div', { class: 'ac-empty', text: tallyFilt === 'PENDING' ? '✓ Everything is entered in Tally.' : 'Nothing here.' })); return; }
        var tb = el('tbody'), total = 0;
        rows.forEach(function (r) {
          total += r.amount || 0;
          var cb = el('input', { type: 'checkbox', 'aria-label': 'Select', style: 'width:auto' });
          cb.onchange = function () { if (cb.checked) chosen[r.id] = vno; else delete chosen[r.id]; postSel.disabled = !Object.keys(chosen).length; };
          var vno = el('input', { placeholder: 'Tally voucher no.', value: r.tallyVoucherNo || '' });
          var act = r.tallyStatus === 'POSTED'
            ? el('span', { class: 'ac-badge', style: '--c:#16a34a', text: '✓ Entered' + (r.tallyPostedByName ? ' · ' + r.tallyPostedByName : '') })
            : el('button', { class: 'ac-btn sm grn', type: 'button', 'data-post': r.id, text: 'Entered', onclick: function () {
              api('PATCH', '/accounts/entries/' + encodeURIComponent(r.id) + '/tally', { status: 'POSTED', voucherNo: vno.value }).then(function (j) { toast(j.message); reload(); }).catch(function (e) { toast(e.message, 'err'); });
            } });
          tb.appendChild(el('tr', { 'data-row': r.id }, [
            el('td', {}, [r.tallyStatus === 'PENDING' ? cb : null]),
            el('td', { text: dmy(r.docDate) }),
            el('td', {}, [el('b', { text: r.tallyType }), r.tallyType !== KIND[r.kind].label ? el('div', { class: 'sub', text: KIND[r.kind].label }) : null]),
            el('td', { text: r.docNo || '—' }),
            el('td', {}, [r.partyName || '—', r.linkNo ? el('div', { class: 'sub', text: 'against ' + r.linkNo }) : null]),
            el('td', { class: 'n', text: money(r.taxable) }), el('td', { class: 'n', text: money(r.gstAmount) }), el('td', { class: 'n', text: money(r.amount) }),
            el('td', {}, [r.tallyStatus === 'PENDING' ? vno : el('span', { text: r.tallyVoucherNo || '—' })]),
            el('td', {}, [act])
          ]));
        });
        list.appendChild(el('div', { class: 'ac-tw' }, [el('table', { class: 'ac-table', id: 'ac-tally' }, [
          el('thead', {}, [el('tr', {}, ['', 'Date', 'Tally voucher', 'Number', 'Party / ledger', 'Taxable', 'GST', 'Amount', 'Tally voucher no.', ''].map(function (h, i) { return el('th', { class: i >= 5 && i <= 7 ? 'n' : '', text: h }); }))]),
          tb, el('tfoot', {}, [el('tr', {}, [el('td'), el('td', { text: rows.length + ' entries' }), el('td'), el('td'), el('td'), el('td'), el('td'), el('td', { class: 'n', text: money(total) }), el('td'), el('td')])])])]));
      }).catch(function (e) { clear(list).appendChild(el('div', { class: 'ac-empty', text: e.message })); });
    }
    postSel.onclick = function () {
      var ids = Object.keys(chosen); if (!ids.length) return;
      postSel.disabled = true;
      Promise.all(ids.map(function (id) { return api('PATCH', '/accounts/entries/' + encodeURIComponent(id) + '/tally', { status: 'POSTED', voucherNo: chosen[id].value }); }))
        .then(function () { toast(ids.length + ' marked as entered in Tally'); reload(); }).catch(function (e) { toast(e.message, 'err'); reload(); });
    };
    reload();
  }

  // ── staff claims (fuel expense) ─────────────────────────────────────
  var claimMonth = null;
  function claims() {
    var d = new Date(), sel = el('select', { id: 'ac-claim-month' });
    for (var k = 0; k < 12; k++) {
      var x = new Date(d.getFullYear(), d.getMonth() - k, 1);
      sel.appendChild(el('option', { value: (x.getMonth() + 1) + '-' + x.getFullYear(), text: x.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }));
    }
    if (claimMonth) sel.value = claimMonth;
    var list = el('div', {});
    body.appendChild(el('div', { class: 'ac-card' }, [el('h2', { text: 'Staff claims — fuel & travel' }),
      el('p', { style: 'margin:-.3rem 0 .8rem;font-size:.82rem;color:#64748b', text: 'Totals from each employee’s daily fuel log (odometer readings at punch in / punch out). Details are on the Fuel expense page.' }),
      el('div', { class: 'ac-bar' }, [sel, el('span', { class: 'sp' }), el('a', { class: 'ac-btn', href: '/fuel-expense/', text: 'Open Fuel expense →' })]), list]));
    function reload() {
      claimMonth = sel.value; var p = sel.value.split('-');
      clear(list).appendChild(el('div', { class: 'ac-empty', text: 'Loading…' }));
      api('GET', '/accounts/claims?month=' + p[0] + '&year=' + p[1]).then(function (j) {
        var rows = j.data.claims || []; clear(list);
        if (!rows.length) { list.appendChild(el('div', { class: 'ac-empty', text: 'No fuel claims this month.' })); return; }
        var t = { km: 0, fuel: 0, misc: 0, total: 0 };
        var tb = el('tbody', {}, rows.map(function (r) {
          t.km += r.km; t.fuel += r.fuel; t.misc += r.misc; t.total += r.total;
          return el('tr', {}, [el('td', {}, [el('b', { text: r.name }), el('div', { class: 'sub', text: r.department || '' })]), el('td', { class: 'n', text: String(r.days) }),
            el('td', { class: 'n', text: r.km.toLocaleString('en-IN') + ' km' }), el('td', { class: 'n', text: money(r.fuel) }), el('td', { class: 'n', text: money(r.misc) }), el('td', { class: 'n', style: 'font-weight:700', text: money(r.total) }),
            el('td', {}, [r.openDays ? el('span', { class: 'ac-badge', style: '--c:#d97706', text: r.openDays + ' day' + (r.openDays === 1 ? '' : 's') + ' not closed' }) : el('span', { class: 'ac-badge', style: '--c:#16a34a', text: 'Complete' })])]);
        }));
        list.appendChild(el('div', { class: 'ac-tw' }, [el('table', { class: 'ac-table' }, [
          el('thead', {}, [el('tr', {}, ['Employee', 'Days', 'Official km', 'Fuel', 'Misc.', 'Total claim', ''].map(function (h, i) { return el('th', { class: i && i < 6 ? 'n' : '', text: h }); }))]), tb,
          el('tfoot', {}, [el('tr', {}, [el('td', { text: rows.length + ' employees' }), el('td'), el('td', { class: 'n', text: t.km.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km' }), el('td', { class: 'n', text: money(t.fuel) }), el('td', { class: 'n', text: money(t.misc) }), el('td', { class: 'n', text: money(t.total) }), el('td')])])])]));
      }).catch(function (e) { clear(list).appendChild(el('div', { class: 'ac-empty', text: e.message })); });
    }
    sel.onchange = reload;
    reload();
  }

  function mountPage(content) {
    injectCss();
    if (['SUPER_ADMIN', 'ADMIN', 'ACCOUNTS'].indexOf(me().role) === -1) {
      content.appendChild(el('div', { class: 'ac-card', style: 'max-width:600px;margin:2rem auto' }, [el('div', { class: 'ac-empty', text: 'Accounts is for the accounts team, Admins and the Super Admin.' })]));
      return;
    }
    root = el('div', { class: 'ac-wrap' });
    root.appendChild(el('div', { class: 'ac-head' }, [el('h1', { text: 'Accounts' }),
      el('p', { text: 'Invoiced bills, receipts, vendor bills and payments, Tally entry tracking, outstanding and staff claims.' })]));
    tabsBox = el('div', { class: 'ac-tabs' });
    body = el('div', {});
    root.appendChild(tabsBox); root.appendChild(body);
    content.appendChild(root);
    window.addEventListener('hashchange', route);
    route();
    if (location.hash.replace(/^#\/?/, '') !== '') api('GET', '/accounts/summary').then(function (j) { tallyPending = j.data.tallyPendingTotal; var t = tabsBox.querySelector('[data-tab=tally]'); if (t && tallyPending && !t.querySelector('.n')) t.appendChild(el('span', { class: 'n', text: String(tallyPending) })); }).catch(function () {});
  }

  window.AccountsPage = { mountPage: mountPage, isAdmin: isAdmin };
})();
