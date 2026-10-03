/* ══════════════════════════════════════════════════════════════════════
   Trials — tool trial requests, from existing situation to cost savings.

     1. Raise a trial request: the engineer fills the "Existing situation
        data analysis" sheet (required to raise the request).
     2. Approval: a Super Admin / Admin approves with recommendations —
        category Cutter / Insert / Key / Drill / Tap, a spec, and for an
        Insert also the grade — or rejects with a reason. A rejected
        request can be corrected and resubmitted.
     3. After the trial: the engineer fills the "Trial comparison / cost
        savings report" sheet; submitting it completes the trial.

   Both sheets are the customer-facing HTML tool (/trial-sheet/index.html),
   embedded in an iframe with ?embed=eda|cmp. It talks to this page over
   postMessage (see the bridge at the end of trial-sheet/index.html); this page
   saves the sheets' JSON through /api/trials (TrialController.php).

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  // A folder with index.html, like every other standalone page (/orders/, /tasks/).
  var SHEET_URL = '/trial-sheet/';
  var CATEGORIES = [['CUTTER', 'Cutter'], ['INSERT', 'Insert'], ['KEY', 'Key'], ['DRILL', 'Drill'], ['TAP', 'Tap']];
  var STATUS = {
    PENDING_APPROVAL: { label: 'Waiting for approval', badge: 'badge-yellow' },
    APPROVED:         { label: 'Approved — trial in progress', badge: 'badge-blue' },
    REJECTED:         { label: 'Rejected', badge: 'badge-red' },
    COMPLETED:        { label: 'Completed', badge: 'badge-green' }
  };

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function currentUser() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch (e) { return null; } }
  function role() { var u = currentUser(); return (u && u.role) || ''; }
  function isAdminTier() { return ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(role()) !== -1; }
  /** Approves / rejects — matches require_admin() in TrialController. */
  function canManage() { return ['SUPER_ADMIN', 'ADMIN'].indexOf(role()) !== -1; }
  function isMine(t) { var u = currentUser(); return !!(u && t.requestedBy && t.requestedBy.id === u.id); }
  function canEdit(t) { return canManage() || isMine(t); }

  function api(method, path, body) {
    var opts = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + '/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { try { localStorage.removeItem('crm_token'); } catch (x) {} location.href = '/login/'; }
        if (!r.ok) throw new Error(((j && j.message) || 'Request failed') + (j && j.error ? ' — ' + j.error : ''));
        return j;
      });
    });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function fmtDate(d) {
    if (!d) return '—';
    var dt = new Date(String(d).replace(' ', 'T'));
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function money(v) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
    return '₹' + Math.round(Number(v)).toLocaleString('en-IN');
  }
  function labelOf(pairs, v) { var m = pairs.filter(function (p) { return p[0] === v; })[0]; return m ? m[1] : v; }
  function recText(r) {
    return labelOf(CATEGORIES, r.category) + ': ' + r.spec + (r.grade ? ' · grade ' + r.grade : '') + (r.quantity ? ' × ' + r.quantity : '');
  }

  var INPUT = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
              'px-3 py-2 text-sm text-slate-900 dark:text-slate-100';

  function injectCss() {
    if (document.getElementById('trials-extra-css')) return;
    var st = document.createElement('style');
    st.id = 'trials-extra-css';
    st.textContent = [
      '.trl-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}',
      '@media(min-width:768px){.trl-tiles{grid-template-columns:repeat(5,minmax(0,1fr))}}',
      '.trl-tile{text-align:left;cursor:pointer;border:1px solid #e2e8f0;background:#fff;border-radius:.75rem;padding:.75rem 1rem}',
      '.dark .trl-tile{background:#0f172a;border-color:#334155}',
      '.trl-tile-on{border-color:#1e3a5f;box-shadow:0 0 0 1px #1e3a5f}',
      '.dark .trl-tile-on{border-color:#60a5fa;box-shadow:0 0 0 1px #60a5fa}',
      '.trl-n{font-size:1.5rem;font-weight:700;line-height:1.2;color:#0f172a}.dark .trl-n{color:#f1f5f9}',
      '.trl-help{font-size:.8rem;color:#64748b}',
      '.trl-row{cursor:pointer}.trl-row:hover td{background:#f8fafc}.dark .trl-row:hover td{background:rgba(30,41,59,.5)}',
      '.trl-nowrap{white-space:nowrap}',
      '.trl-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem}',
      '.trl-step{border:1px solid #e2e8f0;border-radius:.75rem;padding:.6rem .8rem;background:#fff;cursor:pointer;text-align:left}',
      '.dark .trl-step{background:#0f172a;border-color:#334155}',
      '.trl-step-on{border-color:#1e3a5f;box-shadow:0 0 0 1px #1e3a5f}.dark .trl-step-on{border-color:#60a5fa;box-shadow:0 0 0 1px #60a5fa}',
      '.trl-step-locked{opacity:.55;cursor:not-allowed}',
      '.trl-step-num{display:inline-flex;width:1.5rem;height:1.5rem;border-radius:9999px;align-items:center;justify-content:center;',
      '  font-size:.75rem;font-weight:700;background:#e2e8f0;color:#475569;margin-right:.4rem}',
      '.trl-done .trl-step-num{background:#22c55e;color:#fff}.trl-now .trl-step-num{background:#f59e0b;color:#fff}',
      '.trl-bad .trl-step-num{background:#ef4444;color:#fff}',
      '.trl-step-title{font-size:.85rem;font-weight:600;color:#0f172a}.dark .trl-step-title{color:#f1f5f9}',
      '.trl-step-sub{display:block;font-size:.72rem;color:#64748b;margin-top:.15rem}',
      '.trl-frame{width:100%;height:calc(100vh - 210px);min-height:560px;border:1px solid #e2e8f0;border-radius:.75rem;background:#fff}',
      '.dark .trl-frame{border-color:#334155}',
      '.trl-bar{position:sticky;bottom:0;z-index:5;display:flex;gap:.5rem;justify-content:flex-end;align-items:center;flex-wrap:wrap;',
      '  padding:.75rem;margin-top:.75rem;border:1px solid #e2e8f0;border-radius:.75rem;background:rgba(255,255,255,.96)}',
      '.dark .trl-bar{background:rgba(15,23,42,.96);border-color:#334155}',
      '.trl-banner{border-radius:.5rem;padding:.65rem .8rem;font-size:.875rem}',
      '.trl-info{background:#eff6ff;color:#1e40af}.trl-warn{background:#fffbeb;color:#92400e}',
      '.trl-ok{background:#f0fdf4;color:#166534}.trl-err{background:#fef2f2;color:#991b1b}',
      '.dark .trl-info{background:rgba(30,64,175,.2);color:#bfdbfe}.dark .trl-warn{background:rgba(146,64,14,.2);color:#fde68a}',
      '.dark .trl-ok{background:rgba(22,101,52,.25);color:#bbf7d0}.dark .trl-err{background:rgba(153,27,27,.25);color:#fecaca}',
      '.trl-rec{display:grid;gap:.5rem;grid-template-columns:1fr;align-items:end;padding:.75rem;border:1px solid #e2e8f0;border-radius:.6rem}',
      '.dark .trl-rec{border-color:#334155}',
      '@media(min-width:900px){.trl-rec{grid-template-columns:150px 2fr 1fr 90px 2fr auto}}',
      '.trl-lab{display:block;font-size:.72rem;font-weight:500;color:#64748b;margin-bottom:.25rem}',
      '.trl-req{color:#dc2626}',
      '.trl-x{border:0;background:none;color:#94a3b8;font-size:1rem;cursor:pointer;padding:.4rem}.trl-x:hover{color:#dc2626}',
      '.trl-link{font-size:.8rem;font-weight:500;color:#1e3a5f;background:none;border:0;padding:0;cursor:pointer}',
      '.dark .trl-link{color:#93c5fd}',
      '.trl-disabled{opacity:.5;cursor:not-allowed}',
      '.trl-cat{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.03em;padding:.1rem .45rem;border-radius:.3rem;background:#e0e7ff;color:#1e3a5f;margin-right:.35rem}',
      '.trl-grid2{display:grid;gap:.75rem;grid-template-columns:1fr}',
      '@media(min-width:768px){.trl-grid2{grid-template-columns:1fr 1fr}}',
      '.mt-5{margin-top:1.25rem}.mr-auto{margin-right:auto}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── embedded sheet (iframe + postMessage bridge) ─────────────────────
  var frames = [];
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.source !== 'tms-trial-sheet') return;
    frames.forEach(function (f) { if (f.iframe.contentWindow === e.source) f.onMessage(e.data); });
  });

  /** An embedded sheet of `kind` ('eda' | 'cmp'). load(opts) once; get() resolves {report, summary}. */
  function Sheet(kind) {
    var self = this, readyResolve, pending = {}, seq = 0;
    this.kind = kind;
    this.changed = false;
    this.ready = new Promise(function (res) { readyResolve = res; });
    this.iframe = el('iframe', { class: 'trl-frame', src: SHEET_URL + '?embed=' + kind, title: kind === 'eda' ? 'Existing situation data analysis' : 'Cost savings report' });
    // If the sheet file is missing on the server the frame shows the host's
    // 404 page and never says "ready" — replace that with a clear message.
    var isReady = false;
    this.ready.then(function () { isReady = true; });
    this.node = el('div', {}, [this.iframe]);
    this.iframe.addEventListener('load', function () {
      setTimeout(function () {
        if (isReady) return;
        var doc = null;
        try { doc = self.iframe.contentDocument; } catch (e) {}
        if (doc && doc.getElementById('view-editor')) return; // still starting up
        self.node.innerHTML = '';
        self.node.appendChild(el('div', { class: 'trl-banner trl-err' }, [
          el('p', { class: 'font-semibold', text: 'The trial form could not be loaded.' }),
          el('p', { text: 'The file ' + location.origin + SHEET_URL + ' was not found on the server. Upload the folder crm/trial-sheet/ (it contains index.html) from the latest zip, then reload this page with Ctrl+Shift+R.' })
        ]));
      }, 2500);
    });
    this.onMessage = function (d) {
      if (d.type === 'ready') readyResolve();
      else if (d.type === 'change') self.changed = true;
      else if (d.type === 'data' && pending[d.requestId]) { pending[d.requestId](d); delete pending[d.requestId]; }
    };
    this.send = function (msg) {
      msg.target = 'tms-trial-sheet';
      return self.ready.then(function () { self.iframe.contentWindow.postMessage(msg, location.origin); });
    };
    this.load = function (opts) { self.changed = false; return self.send({ type: 'load', report: opts.report || null, prefill: opts.prefill || null, readOnly: !!opts.readOnly }); };
    this.patch = function (fields) { self.changed = true; return self.send({ type: 'patch', fields: fields }); };
    this.get = function () {
      var id = ++seq;
      return new Promise(function (res, rej) {
        pending[id] = res;
        self.send({ type: 'get', requestId: id });
        setTimeout(function () { if (pending[id]) { delete pending[id]; rej(new Error('The sheet did not respond — please try again.')); } }, 8000);
      });
    };
    this.destroy = function () { frames = frames.filter(function (f) { return f !== self; }); };
    frames.push(this);
  }

  // ── page / router ────────────────────────────────────────────────────
  var root, current = null; // current = { sheet, leave() } for unsaved-change checks

  function mount(r) {
    injectCss();
    root = r;
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', function (e) {
      if (current && current.sheet && current.sheet.changed) { e.preventDefault(); e.returnValue = ''; }
    });
    // A trial alert arrived (crm-global.js): refresh the list — never an open form.
    window.addEventListener('crm-alert', function (e) {
      var ev = (e.detail && e.detail.events) || [];
      if (!ev.some(function (x) { return /^TRIAL_/.test(x.type); })) return;
      if (location.hash.replace(/^#\/?/, '') === '') route();
    });
    route();
  }
  function go(hash) { location.hash = hash; }
  /** Navigates to hash, re-rendering even when it is already the current one. */
  function show(hash) { if (location.hash.replace(/^#/, '') === hash) route(); else go(hash); }
  function route() {
    if (current && current.sheet) current.sheet.destroy();
    current = null;
    root.innerHTML = '';
    var h = location.hash.replace(/^#\/?/, '');
    if (h === 'new') newTrialView();
    else if (h.indexOf('t/') === 0) detailView(decodeURIComponent(h.slice(2).split('/')[0]), h.split('/')[2] || null);
    else listView();
  }
  /** Asks before leaving a sheet with unsaved edits. */
  function confirmLeave() {
    return !(current && current.sheet && current.sheet.changed) || confirm('You have unsaved changes in the sheet. Leave without saving?');
  }
  function backLink(text) {
    return el('button', { class: 'trl-link', text: '← ' + (text || 'All trials'), onclick: function () { if (confirmLeave()) { if (current && current.sheet) current.sheet.changed = false; go(''); } } });
  }
  function errorCard(msg, retry) {
    return el('div', { class: 'card p-10 text-center text-muted' }, [
      el('p', { class: 'font-medium text-red-600', text: 'Something went wrong' }),
      el('p', { class: 'text-sm mt-1', text: msg }),
      retry ? el('button', { class: 'btn-secondary btn-sm mt-4', text: 'Try again', onclick: retry }) : null
    ]);
  }

  // ── list ─────────────────────────────────────────────────────────────
  var listState = { status: isAdminTier() ? 'PENDING_APPROVAL' : 'ALL', search: '' };

  function listView() {
    var body = el('div', {}, [el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' })]);
    var tiles = el('div', { class: 'trl-tiles' });
    var search = el('input', { class: INPUT, type: 'search', placeholder: 'Search trial no., customer or component…', style: 'max-width:340px' });
    search.value = listState.search;
    var t;
    search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { listState.search = search.value.trim(); load(); }, 300); });

    root.appendChild(el('div', { class: 'space-y-4' }, [
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('h1', { class: 'page-title', text: 'Trials' }),
        el('button', { class: 'btn-primary', text: '+ New trial request', onclick: function () { go('/new'); } })
      ]),
      el('p', { class: 'trl-help', text: '1 · Raise a request with the existing situation data  →  2 · Admin approves with the recommended tool (cutter, insert, key, drill or tap)  →  3 · After the trial, fill the cost savings report to complete it.' }),
      tiles, search, body
    ]));

    function load() {
      var q = '/trials?status=' + listState.status + (listState.search ? '&search=' + encodeURIComponent(listState.search) : '');
      api('GET', q).then(function (r) { render(r.data.trials || [], r.data.counts || {}); })
        .catch(function (e) { body.innerHTML = ''; body.appendChild(errorCard(e.message, load)); });
    }

    function render(trials, counts) {
      tiles.innerHTML = '';
      var total = Object.keys(counts).reduce(function (a, k) { return a + (counts[k] || 0); }, 0);
      [['PENDING_APPROVAL', canManage() ? 'Waiting for your approval' : 'Waiting for approval'], ['APPROVED', 'Trial in progress'],
       ['COMPLETED', 'Completed'], ['REJECTED', 'Rejected'], ['ALL', 'All trials']].forEach(function (x) {
        tiles.appendChild(el('button', { class: 'trl-tile' + (listState.status === x[0] ? ' trl-tile-on' : ''), onclick: function () { listState.status = x[0]; load(); } }, [
          el('p', { class: 'text-xs text-muted', text: x[1] }),
          el('p', { class: 'trl-n', text: String(x[0] === 'ALL' ? total : (counts[x[0]] || 0)) })
        ]));
      });

      body.innerHTML = '';
      if (!trials.length) {
        body.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: listState.status === 'ALL' && !listState.search
          ? 'No trials yet — use “+ New trial request” to raise one.' : 'No trials in this view.' }));
        return;
      }
      var heads = ['Trial no.', 'Customer', 'Component', 'Requested by', 'Status', 'Recommendation', 'Saving / year', 'Raised'];
      var tbody = el('tbody');
      trials.forEach(function (x) {
        var recs = x.recommendations || [];
        var tr = el('tr', { class: 'table-row trl-row', tabindex: '0' }, [
          el('td', { class: 'px-3 py-3 font-medium trl-nowrap', text: x.trialNo }),
          el('td', { class: 'px-3 py-3', text: (x.customer && x.customer.name) || '—' }),
          el('td', { class: 'px-3 py-3', text: x.component || '—' }),
          el('td', { class: 'px-3 py-3 trl-nowrap', text: (x.requestedBy && x.requestedBy.name) || '—' }),
          el('td', { class: 'px-3 py-3' }, [el('span', { class: 'badge ' + STATUS[x.status].badge, text: STATUS[x.status].label })]),
          el('td', { class: 'px-3 py-3 text-sm', text: recs.length ? recText(recs[0]) + (recs.length > 1 ? '  +' + (recs.length - 1) + ' more' : '') : '—' }),
          el('td', { class: 'px-3 py-3 trl-nowrap font-medium', text: x.savingsPerYear !== null ? money(x.savingsPerYear) + (x.savingsPct !== null ? ' (' + Math.round(x.savingsPct) + '%)' : '') : '—' }),
          el('td', { class: 'px-3 py-3 trl-nowrap text-muted', text: fmtDate(x.createdAt) })
        ]);
        function open() { go('/t/' + encodeURIComponent(x.id)); }
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
        tbody.appendChild(tr);
      });
      body.appendChild(el('div', { class: 'card overflow-hidden' }, [el('div', { class: 'overflow-x-auto' }, [
        el('table', { class: 'w-full text-sm' }, [
          el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, heads.map(function (h) { return el('th', { class: 'table-head text-left px-3 py-3 trl-nowrap', text: h }); }))]),
          tbody
        ])
      ])]));
    }

    load();
  }

  // ── new trial request ────────────────────────────────────────────────
  function newTrialView() {
    var sheet = new Sheet('eda');
    current = { sheet: sheet };
    var cust = { id: '', name: '' };
    var err = el('div');
    var saving = false;
    var custBox = el('div');
    var submitBtn = el('button', { class: 'btn-primary', text: 'Submit trial request', onclick: submit });

    root.appendChild(el('div', { class: 'space-y-4' }, [
      backLink(),
      el('div', {}, [
        el('h1', { class: 'page-title', text: 'New trial request' }),
        el('p', { class: 'trl-help mt-1', text: 'Step 1 of 3 — fill in the customer’s existing situation below. Customer name and component name are required. The request then goes to an admin for approval.' })
      ]),
      el('div', { class: 'card p-4' }, [
        el('span', { class: 'trl-lab', text: 'Link to a CRM customer (optional — fills the customer name in the sheet)' }),
        custBox
      ]),
      sheet.node,
      err,
      el('div', { class: 'trl-bar' }, [
        el('span', { class: 'trl-help mr-auto', text: 'Use the Edit / Sheet tabs inside the form to preview. PDF and Excel downloads work as usual.' }),
        el('button', { class: 'btn-secondary', text: 'Cancel', onclick: function () { if (confirmLeave()) { sheet.changed = false; go(''); } } }),
        submitBtn
      ])
    ]));

    function renderCust() {
      custBox.innerHTML = '';
      custBox.appendChild(customerPicker(cust, function () {
        renderCust();
        if (cust.name) sheet.patch({ customer: cust.name });
      }));
    }
    renderCust();

    var u = currentUser();
    sheet.load({ prefill: { engineer: (u && u.name) || '', reportNo: 'New trial request' } });

    function showErr(msg) { err.innerHTML = ''; if (msg) err.appendChild(el('div', { class: 'trl-banner trl-err', text: msg })); }

    function submit() {
      if (saving) return;
      showErr('');
      sheet.get().then(function (d) {
        var R = d.report;
        if (!R || !String(R.customer || '').trim()) throw new Error('Enter the customer name in the sheet (Enquiry & customer).');
        if (!String(R.component || '').trim()) throw new Error('Enter the component name in the sheet (Component & machine).');
        saving = true; submitBtn.classList.add('trl-disabled'); submitBtn.textContent = 'Submitting…';
        return api('POST', '/trials', { customerId: cust.id || '', existingData: R });
      }).then(function (res) {
        if (!res) return;
        sheet.changed = false;
        flashMsg = 'Trial ' + res.data.trial.trialNo + ' raised — it is now waiting for admin approval.';
        go('/t/' + encodeURIComponent(res.data.trial.id) + '/existing');
      }).catch(function (e) {
        saving = false; submitBtn.classList.remove('trl-disabled'); submitBtn.textContent = 'Submit trial request';
        showErr(e.message);
      });
    }
  }

  // ── trial detail ─────────────────────────────────────────────────────
  var flashMsg = '';

  function detailView(id, wantTab) {
    var holder = el('div', {}, [el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' })]);
    root.appendChild(holder);
    api('GET', '/trials/' + encodeURIComponent(id)).then(function (r) { render(r.data.trial); })
      .catch(function (e) { holder.innerHTML = ''; holder.appendChild(backLink()); holder.appendChild(errorCard(e.message, function () { route(); })); });

    function render(t) {
      holder.innerHTML = '';
      var tab = wantTab || (t.status === 'PENDING_APPROVAL' && canManage() ? 'approval'
        : t.status === 'PENDING_APPROVAL' || t.status === 'REJECTED' ? 'existing'
        : t.status === 'APPROVED' ? 'savings' : 'savings');
      var savingsOpen = t.status === 'APPROVED' || t.status === 'COMPLETED';
      if (tab === 'savings' && !savingsOpen) tab = 'existing';

      holder.appendChild(el('div', { class: 'space-y-4' }, [
        backLink(),
        el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' }, [
          el('div', {}, [
            el('h1', { class: 'page-title', text: t.trialNo + ' · ' + ((t.customer && t.customer.name) || 'Customer') }),
            el('p', { class: 'text-sm text-muted mt-1', text: [(t.component || ''), 'Requested by ' + ((t.requestedBy && t.requestedBy.name) || '—'), fmtDate(t.createdAt)].filter(Boolean).join(' · ') })
          ]),
          el('span', { class: 'badge ' + STATUS[t.status].badge, text: STATUS[t.status].label })
        ]),
        flashMsg ? el('div', { class: 'trl-banner trl-ok', text: flashMsg }) : null,
        steps(t, tab, savingsOpen),
        tabBody(t, tab)
      ]));
      flashMsg = '';
    }

    function steps(t, tab, savingsOpen) {
      var s1 = t.status === 'REJECTED' ? 'trl-bad' : 'trl-done';
      var s2 = t.status === 'PENDING_APPROVAL' ? 'trl-now' : t.status === 'REJECTED' ? 'trl-bad' : 'trl-done';
      var s3 = t.status === 'COMPLETED' ? 'trl-done' : t.status === 'APPROVED' ? 'trl-now' : '';
      function step(key, n, title, sub, cls, locked) {
        return el('button', {
          class: 'trl-step ' + cls + (tab === key ? ' trl-step-on' : '') + (locked ? ' trl-step-locked' : ''),
          title: locked ? 'Opens once the trial is approved' : '',
          onclick: function () { if (!locked && tab !== key && confirmLeave()) { if (current && current.sheet) current.sheet.changed = false; go('/t/' + encodeURIComponent(t.id) + '/' + key); } }
        }, [el('span', { class: 'trl-step-num', text: cls === 'trl-done' ? '✓' : String(n) }), el('span', { class: 'trl-step-title', text: title }), el('span', { class: 'trl-step-sub', text: sub })]);
      }
      return el('div', { class: 'trl-steps' }, [
        step('existing', 1, 'Existing data analysis', t.status === 'REJECTED' ? 'Correct and resubmit' : 'Submitted ' + fmtDate(t.createdAt), s1, false),
        step('approval', 2, 'Approval & recommendation',
          t.status === 'PENDING_APPROVAL' ? (canManage() ? 'Your decision needed' : 'Waiting for admin')
            : t.status === 'REJECTED' ? 'Rejected ' + fmtDate(t.decidedAt) : 'Approved ' + fmtDate(t.decidedAt), s2, false),
        step('savings', 3, 'Cost savings report',
          t.status === 'COMPLETED' ? 'Completed ' + fmtDate(t.completedAt) : savingsOpen ? (t.hasSavings ? 'Draft saved' : 'Fill after the trial') : 'Locked until approved', s3, !savingsOpen)
      ]);
    }

    function tabBody(t, tab) {
      if (tab === 'approval') return approvalTab(t);
      if (tab === 'savings') return savingsTab(t);
      return existingTab(t);
    }

    // Step 1 — existing data sheet
    function existingTab(t) {
      var editable = canEdit(t) && (canManage() || t.status === 'PENDING_APPROVAL' || t.status === 'REJECTED');
      var sheet = new Sheet('eda');
      current = { sheet: sheet };
      var msg = el('div');
      var btn = el('button', { class: 'btn-primary', text: t.status === 'REJECTED' ? 'Save & resubmit for approval' : 'Save changes', onclick: save });
      sheet.load({ report: t.existingData, readOnly: !editable });
      var wrap = el('div', { class: 'space-y-3' }, [
        t.status === 'REJECTED' ? el('div', { class: 'trl-banner trl-err' }, [
          el('p', { class: 'font-semibold', text: 'Rejected by ' + ((t.decidedBy && t.decidedBy.name) || 'admin') + ' — ' + (t.approvalNote || '') }),
          isMine(t) ? el('p', { text: 'Correct the existing data below and press “Save & resubmit for approval”.' }) : null
        ]) : null,
        !editable ? el('p', { class: 'trl-help', text: t.status === 'PENDING_APPROVAL' || t.status === 'REJECTED' ? 'View only.' : 'The existing data is locked after approval (view only). Use the Sheet tab inside to see the print layout and download the PDF.' }) : null,
        sheet.node, msg,
        editable ? el('div', { class: 'trl-bar' }, [btn]) : null
      ]);
      function save() {
        msg.innerHTML = '';
        sheet.get().then(function (d) {
          return api('PUT', '/trials/' + encodeURIComponent(t.id) + '/existing', { existingData: d.report });
        }).then(function (res) {
          sheet.changed = false;
          flashMsg = res.message;
          route();
        }).catch(function (e) { msg.appendChild(el('div', { class: 'trl-banner trl-err', text: e.message })); });
      }
      return wrap;
    }

    // Step 2 — approval & recommendation
    function approvalTab(t) {
      var wrap = el('div', { class: 'space-y-4' });
      var recs = t.recommendations || [];

      if (t.status === 'PENDING_APPROVAL' && !canManage()) {
        wrap.appendChild(el('div', { class: 'trl-banner trl-warn', text: '⏳ Waiting for an admin to approve this trial and give the recommendation.' }));
        return wrap;
      }
      if (t.status === 'REJECTED') {
        wrap.appendChild(el('div', { class: 'trl-banner trl-err' }, [
          el('p', { class: 'font-semibold', text: '✕ Rejected by ' + ((t.decidedBy && t.decidedBy.name) || '—') + ' · ' + fmtDate(t.decidedAt) }),
          el('p', { text: 'Reason: ' + (t.approvalNote || '—') })
        ]));
        return wrap;
      }
      if (t.status === 'PENDING_APPROVAL' || (t.status === 'APPROVED' && canManage() && editingRecs)) {
        wrap.appendChild(recommendationEditor(t));
        return wrap;
      }

      // Approved / completed — show the recommendation
      wrap.appendChild(el('div', { class: 'trl-banner trl-ok' }, [
        el('p', { class: 'font-semibold', text: '✓ Approved by ' + ((t.decidedBy && t.decidedBy.name) || '—') + ' · ' + fmtDate(t.decidedAt) }),
        t.approvalNote ? el('p', { text: 'Note: ' + t.approvalNote }) : null
      ]));
      var card = el('div', { class: 'card overflow-hidden' }, [
        el('div', { class: 'px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between' }, [
          el('span', { class: 'text-sm font-semibold', text: 'Recommended for the trial' }),
          canManage() && t.status === 'APPROVED' ? el('button', { class: 'trl-link', text: 'Edit recommendation', onclick: function () { editingRecs = true; route(); } }) : null
        ])
      ]);
      var tbl = el('table', { class: 'w-full text-sm' }, [
        el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [el('tr', {}, ['Category', 'Spec', 'Grade', 'Qty', 'Notes'].map(function (h) { return el('th', { class: 'table-head text-left px-3 py-2', text: h }); }))]),
        el('tbody', {}, recs.map(function (r) {
          return el('tr', { class: 'table-row' }, [
            el('td', { class: 'px-3 py-2' }, [el('span', { class: 'trl-cat', text: labelOf(CATEGORIES, r.category).toUpperCase() })]),
            el('td', { class: 'px-3 py-2 font-medium', text: r.spec }),
            el('td', { class: 'px-3 py-2', text: r.grade || '—' }),
            el('td', { class: 'px-3 py-2', text: r.quantity !== null && r.quantity !== undefined ? String(r.quantity) : '—' }),
            el('td', { class: 'px-3 py-2 text-muted', text: r.notes || '—' })
          ]);
        }))
      ]);
      card.appendChild(el('div', { class: 'overflow-x-auto' }, [tbl]));
      wrap.appendChild(card);
      if (t.status === 'APPROVED') {
        wrap.appendChild(el('div', { class: 'flex justify-end' }, [el('button', {
          class: 'btn-primary', text: 'Go to step 3 — cost savings report →',
          onclick: function () { go('/t/' + encodeURIComponent(t.id) + '/savings'); }
        })]));
      }
      return wrap;
    }

    // Step 3 — savings report sheet
    function savingsTab(t) {
      var sheet = new Sheet('cmp');
      current = { sheet: sheet };
      var editable = canEdit(t);
      var msg = el('div');
      var busy = false;
      if (t.savingsData) {
        sheet.load({ report: t.savingsData, readOnly: !editable });
      } else {
        sheet.load({ prefill: savingsPrefill(t), readOnly: !editable });
      }
      var recs = t.recommendations || [];
      var head = el('div', { class: 'space-y-2' }, [
        t.status === 'COMPLETED'
          ? el('div', { class: 'trl-banner trl-ok', text: '✓ Trial completed ' + fmtDate(t.completedAt) +
              (t.savingsPerYear !== null ? ' — best: ' + (t.bestTool || '—') + ', saving ' + money(t.savingsPerYear) + ' / year' + (t.savingsPct !== null ? ' (' + Math.round(t.savingsPct) + '%)' : '') : '') })
          : el('div', { class: 'trl-banner trl-info', text: t.savingsData
              ? 'Draft saved. When the trial is finished, press “Submit report & complete trial”.'
              : 'Fill in the trial results. The first tool column is the existing tool (baseline); the recommended tools are already added as the next columns.' }),
        recs.length ? el('p', { class: 'trl-help', text: 'Recommended: ' + recs.map(recText).join('  ·  ') }) : null
      ]);
      var saveBtn = el('button', { class: 'btn-secondary', text: t.status === 'COMPLETED' ? 'Save changes' : 'Save draft', onclick: function () { save(false); } });
      var doneBtn = t.status === 'COMPLETED' ? null : el('button', { class: 'btn-primary', text: '✓ Submit report & complete trial', onclick: function () {
        if (confirm('Submit the savings report and mark this trial as completed?')) save(true);
      } });

      function save(complete) {
        if (busy) return;
        busy = true; msg.innerHTML = '';
        sheet.get().then(function (d) {
          return api('PUT', '/trials/' + encodeURIComponent(t.id) + '/savings', { savingsData: d.report, summary: d.summary || null, complete: complete });
        }).then(function (res) {
          busy = false; sheet.changed = false;
          flashMsg = res.message;
          route();
        }).catch(function (e) { busy = false; msg.appendChild(el('div', { class: 'trl-banner trl-err', text: e.message })); });
      }

      return el('div', { class: 'space-y-3' }, [head, sheet.node, msg,
        editable ? el('div', { class: 'trl-bar' }, [saveBtn, doneBtn]) : el('p', { class: 'trl-help', text: 'View only.' })]);
    }
  }
  var editingRecs = false;
  window.addEventListener('hashchange', function () { editingRecs = false; });

  /** Pre-fills the savings report from the existing data and the recommendation. */
  function savingsPrefill(t) {
    var E = t.existingData || {};
    var ex = (E.tools && E.tools[0]) || {};
    var tools = [{ label: 'Existing' + (ex.exSpec ? ' — ' + ex.exSpec : ''), insertGrade: ex.comp || '' }];
    (t.recommendations || []).forEach(function (r) {
      if (tools.length >= 4) return;
      tools.push({ label: labelOf(CATEGORIES, r.category) + ' — ' + r.spec, insertGrade: r.grade || '' });
    });
    if (tools.length < 2) tools.push({ label: 'Recommended' });
    return {
      reportNo: t.trialNo + '-SR',
      customer: E.customer || (t.customer && t.customer.name) || '',
      engineer: E.engineer || (t.requestedBy && t.requestedBy.name) || '',
      workpiece: E.component || t.component || '',
      matGrade: E.matGrade || '',
      production: E.production || '',
      machineType: [E.machineMake, E.machineModel].filter(Boolean).join(' ') || '',
      tools: tools
    };
  }

  /** Recommendation lines + approve / reject (Super Admin, Admin). */
  function recommendationEditor(t) {
    var lines = (t.recommendations && t.recommendations.length ? t.recommendations : [{ category: '', spec: '', grade: '', quantity: '', notes: '' }])
      .map(function (r) { return { category: r.category || '', spec: r.spec || '', grade: r.grade || '', quantity: r.quantity !== null && r.quantity !== undefined ? String(r.quantity) : '', notes: r.notes || '' }; });
    var note = t.status === 'APPROVED' ? (t.approvalNote || '') : '';
    var err = '', busy = false;
    var box = el('div', { class: 'card p-4 space-y-3' });

    function render() {
      box.innerHTML = '';
      box.appendChild(el('div', {}, [
        el('p', { class: 'text-base font-semibold', text: t.status === 'APPROVED' ? 'Edit recommendation' : 'Approve this trial — recommend the tool' }),
        el('p', { class: 'trl-help', text: 'Check the existing data in step 1, then add what to trial. For an Insert, the spec and grade are both required.' })
      ]));
      lines.forEach(function (ln, i) { box.appendChild(lineRow(ln, i)); });
      box.appendChild(el('button', { class: 'trl-link', text: '+ Add another recommendation', onclick: function () { lines.push({ category: '', spec: '', grade: '', quantity: '', notes: '' }); render(); } }));

      var ta = el('textarea', { class: INPUT, rows: '2', placeholder: 'Note to the engineer (required if you reject)' });
      ta.value = note; ta.addEventListener('input', function () { note = ta.value; });
      box.appendChild(el('div', {}, [el('span', { class: 'trl-lab', text: 'Note' }), ta]));
      if (err) box.appendChild(el('div', { class: 'trl-banner trl-err', text: err }));
      box.appendChild(el('div', { class: 'flex gap-2 justify-end flex-wrap' }, [
        t.status === 'APPROVED'
          ? el('button', { class: 'btn-secondary', text: 'Cancel', onclick: function () { editingRecs = false; route(); } })
          : el('button', { class: 'btn-secondary', text: '✕ Reject', onclick: reject }),
        el('button', { class: 'btn-primary' + (busy ? ' trl-disabled' : ''), text: t.status === 'APPROVED' ? 'Save recommendation' : '✓ Approve with recommendation', onclick: approve })
      ]));
    }

    function lineRow(ln, i) {
      var isInsert = ln.category === 'INSERT';
      var cat = el('select', { class: INPUT, 'aria-label': 'Category ' + (i + 1) }, [el('option', { value: '', text: 'Choose…' })]
        .concat(CATEGORIES.map(function (c) { return el('option', { value: c[0], text: c[1] }); })));
      cat.value = ln.category;
      cat.addEventListener('change', function () { ln.category = cat.value; if (cat.value !== 'INSERT') ln.grade = ''; render(); });
      var spec = el('input', { class: INPUT, placeholder: isInsert ? 'e.g. CNMG 120408-PM' : ln.category ? 'Size / type / part no.' : 'Choose a category first', 'aria-label': 'Spec ' + (i + 1) });
      spec.value = ln.spec; spec.addEventListener('input', function () { ln.spec = spec.value; });
      var grade = el('input', { class: INPUT, placeholder: 'e.g. IC8250', 'aria-label': 'Grade ' + (i + 1) });
      grade.value = ln.grade; grade.addEventListener('input', function () { ln.grade = grade.value; });
      var qty = el('input', { class: INPUT, type: 'number', min: '0', step: 'any', placeholder: 'Qty', 'aria-label': 'Quantity ' + (i + 1) });
      qty.value = ln.quantity; qty.addEventListener('input', function () { ln.quantity = qty.value; });
      var nt = el('input', { class: INPUT, placeholder: 'Optional', 'aria-label': 'Notes ' + (i + 1) });
      nt.value = ln.notes; nt.addEventListener('input', function () { ln.notes = nt.value; });

      function f(label, control, req) {
        return el('div', {}, [el('span', { class: 'trl-lab' }, [label, req ? el('span', { class: 'trl-req', text: ' *' }) : null]), control]);
      }
      return el('div', { class: 'trl-rec' }, [
        f('Category', cat, true),
        f(isInsert ? 'Insert spec' : 'Spec / description', spec, true),
        isInsert ? f('Grade', grade, true) : el('div', { class: 'trl-help', text: ln.category ? 'Grade only needed for inserts' : '' }),
        f('Qty', qty, false),
        f('Notes', nt, false),
        lines.length > 1 ? el('button', { class: 'trl-x', 'aria-label': 'Remove recommendation ' + (i + 1), text: '✕', onclick: function () { lines.splice(i, 1); render(); } }) : el('span')
      ]);
    }

    function validate() {
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i], n = lines.length > 1 ? ' (line ' + (i + 1) + ')' : '';
        if (!l.category) return 'Choose a category' + n + '.';
        if (!l.spec.trim()) return (l.category === 'INSERT' ? 'Enter the insert spec' : 'Enter the spec') + n + '.';
        if (l.category === 'INSERT' && !l.grade.trim()) return 'Enter the insert grade' + n + '.';
      }
      return '';
    }
    function approve() {
      if (busy) return;
      err = validate();
      if (err) return render();
      busy = true; render();
      api('PATCH', '/trials/' + encodeURIComponent(t.id) + '/approve', { recommendations: lines, note: note }).then(function (res) {
        editingRecs = false;
        flashMsg = t.status === 'APPROVED' ? 'Recommendation updated.' : 'Trial approved — ' + ((t.requestedBy && t.requestedBy.name) || 'the engineer') + ' can now run the trial and fill the savings report.';
        show('/t/' + encodeURIComponent(t.id) + '/approval');
      }).catch(function (e) { busy = false; err = e.message; render(); });
    }
    function reject() {
      if (busy) return;
      if (!note.trim()) { err = 'Write the reason in the note to reject the trial.'; return render(); }
      if (!confirm('Reject this trial request?')) return;
      busy = true; render();
      api('PATCH', '/trials/' + encodeURIComponent(t.id) + '/reject', { note: note }).then(function () {
        flashMsg = 'Trial rejected — the engineer can see your reason, correct the data and resubmit.';
        show('/t/' + encodeURIComponent(t.id) + '/approval');
      }).catch(function (e) { busy = false; err = e.message; render(); });
    }

    render();
    return box;
  }

  /** Search-as-you-type CRM customer picker writing into c.id / c.name. */
  function customerPicker(c, onPick) {
    if (c.id) {
      return el('div', { class: 'flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50', style: 'max-width:420px' }, [
        el('span', { class: 'truncate', text: c.name }),
        el('button', { class: 'trl-link', text: 'Change', onclick: function () { c.id = ''; c.name = ''; onPick(); } })
      ]);
    }
    var input = el('input', { class: INPUT, placeholder: 'Search company…', style: 'max-width:420px' });
    var list = el('div', { class: 'mt-1 space-y-1', style: 'max-width:420px' });
    var t;
    input.addEventListener('input', function () {
      clearTimeout(t);
      var q = input.value.trim();
      if (!q) { list.innerHTML = ''; return; }
      t = setTimeout(function () {
        api('GET', '/customers?search=' + encodeURIComponent(q) + '&limit=6').then(function (res) {
          list.innerHTML = '';
          ((res.data && res.data.items) || []).forEach(function (x) {
            list.appendChild(el('button', {
              class: 'block w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-slate-50',
              text: x.companyName + (x.contactPerson ? ' — ' + x.contactPerson : ''),
              onclick: function () { c.id = x.id; c.name = x.companyName; onPick(); }
            }));
          });
        }).catch(function () {});
      }, 300);
    });
    return el('div', {}, [input, list]);
  }

  window.Trials = { mountPage: mount };
})();
