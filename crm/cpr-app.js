/* ══════════════════════════════════════════════════════════════════════
   CPR — customer opportunity register, Saturday weekly review, reports.

   The "Master CPR" Excel as forms:
     Register        every opportunity (same columns as the sheet), add / edit
     Saturday review one card per opportunity: this week's remark, status,
                     Red/Yellow/Green, expected sale, order value, time line
     Reports         weekly and monthly Excel downloads (Master CPR layout with
                     "Remarks as on" columns), import of an existing CPR sheet

   Data: /api/cpr/* (api/controllers/CprController.php). Sales engineers see
   their own opportunities; Manager / Admin / Super Admin see everyone's.

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var META = null;
  var ROOT = null;

  /* ── helpers ─────────────────────────────────────────────────────── */
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  function api(method, path, body) {
    return fetch(API + '/api' + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + (token() || ''), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { location.href = '/login/'; }
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed (' + r.status + ')');
        return j;
      });
    });
  }
  /* A download must really be the file: Excel / zip start with "PK", PDF with "%PDF".
     If something was printed in front of it, cut it off; if the server sent an
     error page instead, show that message rather than saving a broken file. */
  function checkFile(b, name) {
    var sig = /\.(xlsx|zip)$/i.test(name || '') ? [80, 75, 3, 4] : /\.pdf$/i.test(name || '') ? [37, 80, 68, 70] : null;
    if (!sig || !b || !b.arrayBuffer) return Promise.resolve(b);
    return b.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), lim = Math.min(u.length - 4, 1 << 20);
      for (var i = 0; i <= lim; i++) {
        if (u[i] === sig[0] && u[i + 1] === sig[1] && u[i + 2] === sig[2] && u[i + 3] === sig[3]) return i === 0 ? b : new Blob([u.subarray(i)], { type: b.type });
      }
      var t = new TextDecoder().decode(u.subarray(0, 4000)), m = '';
      try { m = JSON.parse(t).message || ''; } catch (e) { m = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
      throw new Error('The server sent an error instead of the file' + (m ? ': ' + m : '.'));
    });
  }
  function download(path, fallbackName) {
    return fetch(API + '/api' + path, { headers: { Authorization: 'Bearer ' + (token() || '') } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error((j && j.message) || 'Download failed'); });
      var m = /filename="?([^";]+)"?/.exec(r.headers.get('Content-Disposition') || '');
      var name = m ? m[1] : fallbackName;
      return r.blob().then(function (b) { return checkFile(b, name); }).then(function (b) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        return name;
      });
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function lakh(v) { return v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function dmy(s) {
    if (!s) return '';
    var d = new Date(String(s).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function saturdayOf(s) {
    var d = new Date((s || ymd(new Date())) + 'T00:00:00');
    d.setDate(d.getDate() + (6 - d.getDay()));
    return ymd(d);
  }
  function toast(msg, kind) {
    var t = el('div', { class: 'cp-toast ' + (kind || 'ok'), role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 3200);
    setTimeout(function () { t.remove(); }, 3700);
  }
  function canSeeAll() { return META && META.canSeeAll; }
  var STATUS_COLOR = {
    'Trial underway': '#2563eb', 'Trial planned': '#7c3aed', 'Order awaited': '#d97706',
    'Order received': '#16a34a', 'Trial failed': '#dc2626', 'Parked': '#64748b'
  };
  var RAG_COLOR = { Red: '#dc2626', Yellow: '#f59e0b', Green: '#16a34a' };
  function statusBadge(s) {
    return el('span', { class: 'cp-badge', style: '--c:' + (STATUS_COLOR[s] || '#64748b'), text: s || '—' });
  }
  /** Status dropdown takes the colour of the chosen status (and changes with it). */
  function paintStatus(sel) {
    function apply() {
      var c = STATUS_COLOR[sel.value];
      sel.classList.toggle('cp-st', !!c);
      sel.setAttribute('data-status', sel.value || '');
      if (c) sel.style.setProperty('--sc', c); else sel.style.removeProperty('--sc');
    }
    sel.addEventListener('change', apply);
    apply();
    return sel;
  }
  function ragDot(r) { return r ? el('span', { class: 'cp-rag', title: r, style: 'background:' + RAG_COLOR[r] }) : el('span', { class: 'cp-rag none', title: 'No colour set' }); }

  /* ── styles ──────────────────────────────────────────────────────── */
  function injectCss() {
    if (document.getElementById('cpr-css')) return;
    var st = document.createElement('style');
    st.id = 'cpr-css';
    st.textContent = [
      '.cp-wrap{max-width:1400px;margin:0 auto}',
      '.cp-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem;margin-bottom:1rem}',
      '.cp-head h1{font-size:1.35rem;font-weight:700;margin:0}',
      '.cp-head p{margin:.15rem 0 0;color:#64748b;font-size:.85rem}',
      '.cp-actions{display:flex;flex-wrap:wrap;gap:.5rem}',
      '.cp-btn{display:inline-flex;align-items:center;gap:.4rem;border-radius:.55rem;padding:.5rem .9rem;font-size:.85rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}',
      '.cp-btn:hover{background:#f1f5f9}.cp-btn:disabled{opacity:.55;cursor:default}',
      '.cp-btn.pri{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.cp-btn.pri:hover{background:#1e40af}',
      '.cp-btn.grn{background:#0f766e;border-color:#0f766e;color:#fff}.cp-btn.grn:hover{background:#115e59}',
      '.cp-btn.red{color:#b91c1c;border-color:#fecaca}.cp-btn.red:hover{background:#fef2f2}',
      '.cp-btn.sm{padding:.3rem .6rem;font-size:.78rem}',
      '.dark .cp-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .cp-btn:hover{background:#273449}',
      '.dark .cp-btn.pri{background:#2563eb;border-color:#2563eb}.dark .cp-btn.grn{background:#0d9488;border-color:#0d9488}',
      '.cp-tabs{display:flex;gap:.25rem;border-bottom:1px solid #e2e8f0;margin-bottom:1rem;overflow-x:auto}',
      '.dark .cp-tabs{border-color:#334155}',
      '.cp-tab{padding:.6rem 1rem;font-size:.88rem;font-weight:600;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.cp-tab.on{color:#1e3a8a;border-bottom-color:#1e3a8a}.dark .cp-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.cp-card{background:#fff;border:1px solid #e2e8f0;border-radius:.8rem;padding:1rem}',
      '.dark .cp-card{background:#0f172a;border-color:#1e293b}',
      '.cp-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;margin-bottom:.9rem}',
      '@media(min-width:900px){.cp-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}}',
      '.cp-kpi{padding:.75rem .9rem}.cp-kpi b{display:block;font-size:1.25rem}.cp-kpi span{font-size:.75rem;color:#64748b}',
      '.cp-chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.8rem}',
      '.cp-chip{border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:.25rem .7rem;font-size:.78rem;cursor:pointer;display:inline-flex;gap:.35rem;align-items:center}',
      '.cp-chip i{width:.55rem;height:.55rem;border-radius:50%;background:var(--c)}',
      '.cp-chip.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 10%,#fff);font-weight:600}',
      '.dark .cp-chip{background:#0f172a;border-color:#334155}.dark .cp-chip.on{background:color-mix(in srgb,var(--c) 20%,#0f172a)}',
      '.cp-filters{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.8rem}',
      'select.cp-in.cp-st{--sc:#64748b;color:var(--sc);font-weight:700;border:2px solid var(--sc);background:color-mix(in srgb,var(--sc) 12%,#fff)}',
      '.dark select.cp-in.cp-st{background:color-mix(in srgb,var(--sc) 22%,#0f172a)}',
      'select.cp-in.cp-st option{color:#0f172a;background:#fff;font-weight:500}',
      '.cp-in{border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.85rem;background:#fff;color:#0f172a;min-width:0}',
      '.dark .cp-in{background:#1e293b;border-color:#334155;color:#e2e8f0}',
      '.cp-filters .cp-in.grow{flex:1 1 220px}',
      '.cp-table{width:100%;border-collapse:collapse;font-size:.83rem}',
      '.cp-table th{text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;color:#64748b;padding:.55rem .6rem;border-bottom:1px solid #e2e8f0;white-space:nowrap;background:#f8fafc;position:sticky;top:0}',
      '.dark .cp-table th{background:#111827;border-color:#1e293b}',
      '.cp-table td{padding:.55rem .6rem;border-bottom:1px solid #f1f5f9;vertical-align:top}',
      '.dark .cp-table td{border-color:#1e293b}',
      '.cp-table tr.row{cursor:pointer}.cp-table tr.row:hover td{background:#f8fafc}.dark .cp-table tr.row:hover td{background:#111827}',
      '.cp-table .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.cp-sub{color:#64748b;font-size:.76rem}',
      '.cp-clip{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.cp-badge{display:inline-block;border-radius:999px;padding:.12rem .55rem;font-size:.72rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,#fff);white-space:nowrap}',
      '.dark .cp-badge{background:color-mix(in srgb,var(--c) 22%,#0f172a)}',
      '.cp-rag{display:inline-block;width:.7rem;height:.7rem;border-radius:50%;vertical-align:middle}',
      '.cp-rag.none{border:1.5px dashed #94a3b8}',
      '.cp-scroll{overflow-x:auto;border:1px solid #e2e8f0;border-radius:.8rem;background:#fff}',
      '.dark .cp-scroll{border-color:#1e293b;background:#0f172a}',
      '.cp-empty{padding:2.5rem 1rem;text-align:center;color:#64748b}',
      '.cp-pager{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-top:.7rem;font-size:.82rem;color:#64748b}',
      /* drawer */
      '.cp-back{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;justify-content:flex-end}',
      '.cp-drawer{width:min(720px,100vw);height:100%;background:#fff;display:flex;flex-direction:column;box-shadow:-10px 0 30px rgba(0,0,0,.15)}',
      '.dark .cp-drawer{background:#0f172a;color:#e2e8f0}',
      '.cp-dh{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;padding:1rem 1.2rem;border-bottom:1px solid #e2e8f0}',
      '.dark .cp-dh{border-color:#1e293b}',
      '.cp-dh h2{margin:0;font-size:1.05rem}.cp-dh p{margin:.15rem 0 0;font-size:.8rem;color:#64748b}',
      '.cp-x{background:none;border:none;font-size:1.4rem;line-height:1;color:#64748b;cursor:pointer}',
      '.cp-db{flex:1;overflow-y:auto;padding:1rem 1.2rem}',
      '.cp-df{display:flex;gap:.5rem;justify-content:flex-end;padding:.8rem 1.2rem;border-top:1px solid #e2e8f0}',
      '.dark .cp-df{border-color:#1e293b}',
      '.cp-sec{margin:0 0 1.1rem}.cp-sec h3{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:#0f766e;margin:0 0 .55rem;display:flex;gap:.4rem;align-items:center}',
      '.cp-sec h3 small{font-weight:500;text-transform:none;letter-spacing:0;color:#94a3b8}',
      '.cp-grid{display:grid;grid-template-columns:1fr;gap:.6rem .8rem}',
      '@media(min-width:620px){.cp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-grid .full{grid-column:1/-1}}',
      '.cp-f label{display:block;font-size:.74rem;font-weight:600;color:#475569;margin-bottom:.25rem}',
      '.dark .cp-f label{color:#94a3b8}',
      '.cp-f label .req{color:#dc2626}',
      '.cp-f .cp-in{width:100%}.cp-f textarea.cp-in{min-height:64px;resize:vertical}',
      '.cp-f .hint{font-size:.7rem;color:#94a3b8;margin-top:.15rem}',
      '.cp-seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:.5rem;overflow:hidden}',
      '.dark .cp-seg{border-color:#334155}',
      '.cp-seg button{border:none;background:#fff;padding:.42rem .8rem;font-size:.82rem;cursor:pointer;color:#334155}',
      '.dark .cp-seg button{background:#1e293b;color:#cbd5e1}',
      '.cp-seg button+button{border-left:1px solid #cbd5e1}.dark .cp-seg button+button{border-color:#334155}',
      '.cp-seg button.on{background:#1e3a8a;color:#fff;font-weight:600}',
      '.cp-seg.rag button.on[data-v=Red]{background:#dc2626}.cp-seg.rag button.on[data-v=Yellow]{background:#f59e0b;color:#111}.cp-seg.rag button.on[data-v=Green]{background:#16a34a}',
      '.cp-err{background:#fef2f2;color:#b91c1c;border-radius:.5rem;padding:.55rem .75rem;font-size:.82rem;margin:0 1.2rem .6rem}',
      '.cp-hist{border-left:2px solid #e2e8f0;padding-left:.8rem;margin-left:.3rem}',
      '.cp-hist .h{margin-bottom:.7rem;font-size:.82rem}.cp-hist .h b{font-size:.78rem}',
      /* review */
      '.cp-rbar{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-bottom:.8rem}',
      '.cp-prog{flex:1 1 220px;display:flex;align-items:center;gap:.6rem;font-size:.8rem;color:#64748b}',
      '.cp-prog .bar{flex:1;height:.45rem;background:#e2e8f0;border-radius:999px;overflow:hidden}',
      '.cp-prog .bar i{display:block;height:100%;background:#0f766e;border-radius:999px;transition:width .3s}',
      '.cp-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:.6rem;padding:.55rem .8rem;font-size:.82rem;margin-bottom:.8rem}',
      '.dark .cp-warn{background:#422006;border-color:#713f12;color:#fde68a}',
      '.cp-segt{font-size:.8rem;font-weight:700;color:#475569;margin:1rem 0 .5rem;display:flex;gap:.5rem;align-items:center}',
      '.cp-rc{border:1px solid #e2e8f0;border-radius:.8rem;background:#fff;padding:.85rem;margin-bottom:.6rem;border-left:4px solid var(--c,#cbd5e1)}',
      '.dark .cp-rc{background:#0f172a;border-color:#1e293b;border-left-color:var(--c,#334155)}',
      '.cp-rc.dirty{box-shadow:0 0 0 2px #93c5fd}',
      '.cp-rc .top{display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap}',
      '.cp-rc .ttl{font-weight:600;font-size:.9rem}',
      '.cp-rc .done{font-size:.72rem;color:#0f766e;font-weight:700}',
      '.cp-rc .last{background:#f8fafc;border-radius:.5rem;padding:.45rem .6rem;font-size:.78rem;color:#475569;margin:.55rem 0}',
      '.dark .cp-rc .last{background:#111827;color:#94a3b8}',
      '.cp-rgrid{display:grid;grid-template-columns:1fr;gap:.5rem .7rem;margin-top:.5rem}',
      '@media(min-width:760px){.cp-rgrid{grid-template-columns:1.2fr auto .7fr .7fr .8fr}}',
      '.cp-rc textarea{width:100%;min-height:52px;margin-top:.5rem}',
      '.cp-save{position:sticky;bottom:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;background:#0f172a;color:#fff;border-radius:.8rem;padding:.7rem .9rem;margin-top:.8rem;box-shadow:0 -6px 20px rgba(0,0,0,.12)}',
      '.cp-save span{font-size:.85rem}',
      /* reports */
      '.cp-rgrid2{display:grid;grid-template-columns:1fr;gap:.9rem}',
      '@media(min-width:900px){.cp-rgrid2{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.cp-rep h3{margin:0 0 .25rem;font-size:1rem}.cp-rep p{margin:0 0 .8rem;font-size:.82rem;color:#64748b}',
      '.cp-rep .row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end}',
      '.cp-rep .row .cp-f{flex:1 1 160px}',
      '.cp-dates{display:flex;flex-direction:column;gap:.35rem}',
      '.cp-dates .d{display:flex;justify-content:space-between;align-items:center;gap:.5rem;font-size:.84rem;padding:.4rem 0;border-bottom:1px solid #f1f5f9}',
      '.dark .cp-dates .d{border-color:#1e293b}',
      '.cp-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;box-shadow:0 10px 25px rgba(0,0,0,.2);transition:opacity .4s;max-width:calc(100vw - 32px)}',
      '.cp-toast.err{background:#b91c1c}.cp-toast.out{opacity:0}',
      '.cp-mob{display:none}',
      '@media(max-width:760px){.cp-desk{display:none}.cp-mob{display:block}}',
      '.cp-mcard{border:1px solid #e2e8f0;border-radius:.8rem;background:#fff;padding:.75rem;margin-bottom:.55rem;cursor:pointer}',
      '.dark .cp-mcard{background:#0f172a;border-color:#1e293b}',
      '.cp-mcard .t{display:flex;justify-content:space-between;gap:.5rem}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ── page ────────────────────────────────────────────────────────── */
  var state = {
    tab: 'register',
    reg: { page: 1, search: '', status: '', rag: '', cpr: '', productGroup: '', seId: '', sort: 'potential' },
    rev: { date: null, seId: '', show: 'open', search: '', items: [], dirty: {}, limit: 60 }
  };

  function mountPage(content) {
    injectCss();
    ROOT = el('div', { class: 'cp-wrap' });
    content.appendChild(ROOT);
    var h = (location.hash || '').replace('#', '');
    if (['register', 'review', 'reports'].indexOf(h) !== -1) state.tab = h;
    ROOT.appendChild(el('div', { class: 'cp-empty', text: 'Loading CPR…' }));
    api('GET', '/cpr/meta').then(function (r) {
      META = r.data;
      state.rev.date = META.thisSaturday;
      render();
    }).catch(function (e) {
      clear(ROOT).appendChild(el('div', { class: 'cp-empty', text: 'Could not load CPR: ' + e.message }));
    });
    window.addEventListener('beforeunload', function (e) {
      if (Object.keys(state.rev.dirty).length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function render() {
    clear(ROOT);
    var u = me();
    ROOT.appendChild(el('div', { class: 'cp-head' }, [
      el('div', {}, [
        el('h1', { text: 'CPR · Customer opportunity register' }),
        el('p', { text: canSeeAll() ? 'All sales engineers · weekly review every Saturday' : 'Your opportunities · weekly review every Saturday' })
      ]),
      el('div', { class: 'cp-actions' }, [
        el('button', { class: 'cp-btn pri', type: 'button', id: 'cp-add', onclick: function () { openForm(null); } }, [el('span', { text: '＋' }), 'Add opportunity'])
      ])
    ]));
    var tabs = el('div', { class: 'cp-tabs', role: 'tablist' });
    [['register', 'Register'], ['review', 'Saturday review'], ['reports', 'Weekly & monthly reports']].forEach(function (t) {
      tabs.appendChild(el('button', {
        class: 'cp-tab' + (state.tab === t[0] ? ' on' : ''), role: 'tab', 'data-tab': t[0], type: 'button',
        onclick: function () {
          if (state.tab === 'review' && t[0] !== 'review' && Object.keys(state.rev.dirty).length &&
              !confirm('You have unsaved review changes. Leave without saving?')) return;
          if (t[0] !== 'review') state.rev.dirty = {};
          state.tab = t[0]; history.replaceState(null, '', '#' + t[0]); render();
        }
      }, [t[1]]));
    });
    ROOT.appendChild(tabs);
    var body = el('div', { id: 'cp-body' });
    ROOT.appendChild(body);
    if (state.tab === 'register') renderRegister(body);
    else if (state.tab === 'review') renderReview(body);
    else renderReports(body);
    void u;
  }

  function seSelect(value, onchange, allLabel) {
    var s = el('select', { class: 'cp-in', 'aria-label': 'Sales engineer', onchange: function () { onchange(s.value); } }, [el('option', { value: '', text: allLabel || 'All engineers' })]);
    (META.users || []).forEach(function (u) { s.appendChild(el('option', { value: u.id, text: u.name })); });
    s.value = value || '';
    return s;
  }
  function listSelect(list, value, label, onchange) {
    var s = el('select', { class: 'cp-in', 'aria-label': label, onchange: function () { onchange(s.value); } }, [el('option', { value: '', text: label })]);
    list.forEach(function (v) { s.appendChild(el('option', { value: v, text: v })); });
    s.value = value || '';
    return s;
  }

  /* ── Register ────────────────────────────────────────────────────── */
  function renderRegister(body) {
    var f = state.reg;
    var kpis = el('div', { class: 'cp-kpis' });
    var chips = el('div', { class: 'cp-chips' });
    var filters = el('div', { class: 'cp-filters' });
    var search = el('input', { class: 'cp-in grow', type: 'search', placeholder: 'Search customer, opportunity, EDP, component, competitor…', value: f.search });
    var t;
    search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { f.search = search.value.trim(); f.page = 1; load(); }, 300); });
    filters.appendChild(search);
    if (canSeeAll()) filters.appendChild(seSelect(f.seId, function (v) { f.seId = v; f.page = 1; load(); }));
    filters.appendChild(listSelect(META.statuses, f.status, 'All statuses', function (v) { f.status = v; f.page = 1; load(); }));
    filters.appendChild(listSelect(META.cpr, f.cpr, 'C / P / R', function (v) { f.cpr = v; f.page = 1; load(); }));
    filters.appendChild(listSelect(META.productGroups, f.productGroup, 'All product groups', function (v) { f.productGroup = v; f.page = 1; load(); }));
    var sort = el('select', { class: 'cp-in', 'aria-label': 'Sort', onchange: function () { f.sort = sort.value; load(); } }, [
      el('option', { value: 'potential', text: 'Sort: potential' }), el('option', { value: 'recent', text: 'Sort: recently updated' }),
      el('option', { value: 'customer', text: 'Sort: customer' }), el('option', { value: 'slno', text: 'Sort: Sl. No.' })
    ]);
    sort.value = f.sort;
    filters.appendChild(sort);
    var list = el('div', { id: 'cp-list' });
    body.appendChild(kpis); body.appendChild(chips); body.appendChild(filters); body.appendChild(list);

    function load() {
      var q = ['page=' + f.page, 'limit=50', 'sort=' + f.sort];
      ['search', 'status', 'rag', 'cpr', 'productGroup', 'seId'].forEach(function (k) { if (f[k]) q.push(k + '=' + encodeURIComponent(f[k])); });
      list.style.opacity = '.55';
      api('GET', '/cpr?' + q.join('&')).then(function (r) {
        list.style.opacity = '';
        var d = r.data;
        clear(kpis);
        var open = 0;
        Object.keys(d.byStatus).forEach(function (s) { if (s !== 'Order received' && s !== 'Parked') open += d.byStatus[s]; });
        [[d.total, 'Opportunities' + (f.search || f.status || f.rag || f.cpr || f.productGroup ? ' (filtered)' : '')], [open, 'Open in register (not ordered / parked)'],
         [lakh(d.totals.annualPotential), 'Annual potential (Rs L)'], [lakh(d.totals.expectedSale), 'Expected sale (Rs L)'], [lakh(d.totals.orderValue), 'Order value till date (Rs L)']
        ].forEach(function (k) { kpis.appendChild(el('div', { class: 'cp-card cp-kpi' }, [el('b', { text: String(k[0]) }), el('span', { text: k[1] })])); });
        clear(chips);
        META.statuses.forEach(function (s) {
          chips.appendChild(el('button', {
            class: 'cp-chip' + (f.status === s ? ' on' : ''), type: 'button', style: '--c:' + STATUS_COLOR[s],
            onclick: function () { f.status = f.status === s ? '' : s; f.page = 1; renderBody(); }
          }, [el('i'), s + ' ', el('b', { text: String(d.byStatus[s] || 0) })]));
        });
        drawList(d);
      }).catch(function (e) { list.style.opacity = ''; clear(list).appendChild(el('div', { class: 'cp-empty', text: e.message })); });
    }
    function drawList(d) {
      clear(list);
      if (!d.items.length) {
        list.appendChild(el('div', { class: 'cp-card cp-empty' }, [
          el('p', { text: d.total === 0 && !f.search && !f.status ? 'No opportunities yet.' : 'Nothing matches these filters.' }),
          d.total === 0 && !f.search && !f.status ? el('p', { class: 'cp-sub', text: 'Add one with “Add opportunity”' + (canSeeAll() ? ', or import your CPR Excel from the “Weekly & monthly reports” tab.' : '.') }) : null
        ]));
        return;
      }
      var tbl = el('table', { class: 'cp-table' });
      tbl.appendChild(el('thead', {}, [el('tr', {}, ['Sl.', 'Customer / region', 'Opportunity', 'Product group', 'C/P/R', 'Potential (L)', 'Expected (L)', 'Order (L)', 'Status', 'Latest remark'].map(function (h, i) {
        return el('th', { class: i >= 5 && i <= 7 ? 'num' : null, text: h });
      }))]));
      var tb = el('tbody');
      d.items.forEach(function (o) {
        tb.appendChild(el('tr', { class: 'row', 'data-id': o.id, onclick: function () { openForm(o.id); } }, [
          el('td', { class: 'cp-sub', text: String(o.slNo) }),
          el('td', {}, [el('div', { style: 'font-weight:600', text: o.customerName }), el('div', { class: 'cp-sub', text: [o.region, canSeeAll() ? o.seName : null].filter(Boolean).join(' · ') })]),
          el('td', {}, [el('div', { class: 'cp-clip', text: o.opportunity || o.component || '—' }), el('div', { class: 'cp-sub', text: [o.edp, o.component].filter(Boolean).join(' · ') })]),
          el('td', {}, [o.productGroup || '—', o.focusGroup || o.focusBrand ? el('div', { class: 'cp-sub', text: [o.focusBrand, o.focusGroup].filter(Boolean).join(' · ') }) : null]),
          el('td', { text: o.cpr || '—' }),
          el('td', { class: 'num', text: lakh(o.annualPotential) }),
          el('td', { class: 'num', text: lakh(o.expectedSale) }),
          el('td', { class: 'num', text: lakh(o.orderValue) }),
          el('td', { style: 'white-space:nowrap' }, [statusBadge(o.status)]),
          el('td', { style: 'max-width:280px' }, [o.latestRemark ? el('div', { class: 'cp-clip', text: o.latestRemark }) : el('span', { class: 'cp-sub', text: '—' }),
            o.lastReviewDate ? el('div', { class: 'cp-sub', text: dmy(o.lastReviewDate) }) : null])
        ]));
      });
      tbl.appendChild(tb);
      list.appendChild(el('div', { class: 'cp-scroll cp-desk' }, [tbl]));
      var mob = el('div', { class: 'cp-mob' });
      d.items.forEach(function (o) {
        mob.appendChild(el('div', { class: 'cp-mcard', onclick: function () { openForm(o.id); } }, [
          el('div', { class: 't' }, [el('b', { text: o.customerName }), el('span', {}, [statusBadge(o.status)])]),
          el('div', { class: 'cp-sub cp-clip', text: (o.opportunity || '') + (o.edp ? ' · ' + o.edp : '') }),
          el('div', { class: 'cp-sub', text: 'Potential ' + lakh(o.annualPotential) + ' L · Expected ' + lakh(o.expectedSale) + ' L' + (o.productGroup ? ' · ' + o.productGroup : '') })
        ]));
      });
      list.appendChild(mob);
      list.appendChild(el('div', { class: 'cp-pager' }, [
        el('span', { text: 'Showing ' + ((d.page - 1) * d.limit + 1) + '–' + Math.min(d.total, d.page * d.limit) + ' of ' + d.total }),
        el('span', { class: 'cp-actions' }, [
          el('button', { class: 'cp-btn sm', type: 'button', disabled: d.page <= 1, onclick: function () { f.page--; load(); } }, ['← Prev']),
          el('button', { class: 'cp-btn sm', type: 'button', disabled: d.page >= d.totalPages, onclick: function () { f.page++; load(); } }, ['Next →'])
        ])
      ]));
    }
    function renderBody() { clear(body); renderRegister(body); }
    state.reloadRegister = load;
    load();
  }

  /* ── Opportunity form (drawer) ───────────────────────────────────── */
  function openForm(id) {
    var back = el('div', { class: 'cp-back' });
    var dr = el('div', { class: 'cp-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': id ? 'Edit opportunity' : 'Add opportunity' });
    back.appendChild(dr);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    function close() {
      document.removeEventListener('keydown', esc);
      if (back.classList.contains('crm-leaving')) return;
      var instant = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      back.classList.add('crm-leaving'); // slide out (see /motion.css), then remove
      setTimeout(function () { back.remove(); }, instant ? 0 : 180);
    }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    dr.appendChild(el('div', { class: 'cp-empty', text: 'Loading…' }));
    var p = id ? api('GET', '/cpr/' + id) : Promise.resolve({ data: { opportunity: null, reviews: [] } });
    p.then(function (r) { build(r.data.opportunity, r.data.reviews || []); })
      .catch(function (e) { clear(dr).appendChild(el('div', { class: 'cp-empty', text: e.message })); });

    function build(o, reviews) {
      o = o || {};
      clear(dr);
      var v = {};
      var fields = {};
      function inp(key, label, opts) {
        opts = opts || {};
        var c;
        if (opts.type === 'textarea') c = el('textarea', { class: 'cp-in', id: 'cp-f-' + key, placeholder: opts.ph || '' });
        else if (opts.list) {
          // no duplicates (case-insensitive), keep the first spelling
          var seen = {}, list = opts.list.filter(function (x) { var k = String(x).trim().toLowerCase(); if (!k || seen[k]) return false; seen[k] = 1; return true; });
          c = el('select', { class: 'cp-in', id: 'cp-f-' + key }, [el('option', { value: '', text: '— Select —' })]);
          list.forEach(function (x) { if (!(opts.other && /^others?$/i.test(x))) c.appendChild(el('option', { value: x, text: x })); });
          if (o[key] && !seen[String(o[key]).trim().toLowerCase()]) c.appendChild(el('option', { value: o[key], text: o[key] + (opts.other ? '' : ' (from sheet)') }));
          if (opts.other) {
            // "Other" → type the value; the typed text is what gets saved
            c.appendChild(el('option', { value: '__other', text: 'Other — type it…' }));
            var sel = c, txt = el('input', { class: 'cp-in', id: 'cp-f-' + key + '-other', placeholder: 'Type the ' + label.toLowerCase(), style: 'display:none;margin-top:.35rem' });
            sel.addEventListener('change', function () { txt.style.display = sel.value === '__other' ? '' : 'none'; if (sel.value === '__other') txt.focus(); });
            var box = el('div', {}, [sel, txt]);
            var val0 = o[key] == null ? (opts.def != null ? opts.def : null) : o[key];
            if (val0 != null) sel.value = val0;
            fields[key] = { get value() { return sel.value === '__other' ? txt.value : sel.value; } };
            return el('div', { class: 'cp-f' + (opts.full ? ' full' : '') }, [el('label', { for: 'cp-f-' + key }, [label]), box, opts.hint ? el('div', { class: 'hint', text: opts.hint }) : null]);
          }
        } else c = el('input', { class: 'cp-in', id: 'cp-f-' + key, type: opts.type || 'text', placeholder: opts.ph || '', step: opts.type === 'number' ? 'any' : null, min: opts.type === 'number' ? '0' : null, inputmode: opts.type === 'number' ? 'decimal' : null });
        var val = o[key];
        if (val == null && opts.def != null) val = opts.def;
        if (val != null) c.value = opts.type === 'date' ? String(val).slice(0, 10) : val;
        fields[key] = c;
        return el('div', { class: 'cp-f' + (opts.full ? ' full' : '') }, [
          el('label', { for: 'cp-f-' + key }, [label, opts.req ? el('span', { class: 'req', text: ' *' }) : null]),
          c, opts.hint ? el('div', { class: 'hint', text: opts.hint }) : null
        ]);
      }
      function seg(key, label, list, cls) {
        var wrap = el('div', { class: 'cp-seg' + (cls ? ' ' + cls : ''), role: 'radiogroup', 'aria-label': label });
        v[key] = o[key] || '';
        list.forEach(function (x) {
          var b = el('button', { type: 'button', 'data-v': x, class: v[key] === x ? 'on' : '', role: 'radio', 'aria-checked': v[key] === x ? 'true' : 'false', text: x,
            onclick: function () {
              v[key] = v[key] === x ? '' : x;
              Array.prototype.forEach.call(wrap.children, function (c) { var on = c.getAttribute('data-v') === v[key]; c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); });
            } });
          wrap.appendChild(b);
        });
        return el('div', { class: 'cp-f' }, [el('label', { text: label }), wrap]);
      }
      // Customer: type to search CRM customers (or keep the name as written).
      var custWrap = el('div', { class: 'cp-f full' });
      var custIn = el('input', { class: 'cp-in', id: 'cp-f-customerName', placeholder: 'Type company name…', autocomplete: 'off', list: 'cp-cust-dl', value: o.customerName || '' });
      var dl = el('datalist', { id: 'cp-cust-dl' });
      var custMap = {};
      v.customerId = o.customerId || '';
      var ct;
      custIn.addEventListener('input', function () {
        v.customerId = custMap[custIn.value] || '';
        clearTimeout(ct);
        var q = custIn.value.trim();
        if (q.length < 2) return;
        ct = setTimeout(function () {
          api('GET', '/customers?limit=12&search=' + encodeURIComponent(q)).then(function (r) {
            clear(dl);
            ((r.data && r.data.items) || []).forEach(function (c) { custMap[c.companyName] = c.id; dl.appendChild(el('option', { value: c.companyName })); });
            v.customerId = custMap[custIn.value] || v.customerId;
          }).catch(function () {});
        }, 250);
      });
      custWrap.appendChild(el('label', { for: 'cp-f-customerName' }, ['Customer', el('span', { class: 'req', text: ' *' })]));
      custWrap.appendChild(custIn); custWrap.appendChild(dl);
      custWrap.appendChild(el('div', { class: 'hint', text: 'Pick a CRM customer from the list, or type the name as in your sheet.' }));
      fields.customerName = custIn;

      var seField = null;
      if (canSeeAll()) {
        seField = el('select', { class: 'cp-in', id: 'cp-f-seId' }, [el('option', { value: '', text: o.seName && !o.seId ? o.seName + ' (from sheet)' : '— Me —' })]);
        (META.users || []).forEach(function (u) { seField.appendChild(el('option', { value: u.id, text: u.name })); });
        seField.value = o.seId || '';
      }

      var err = el('div');
      var title = id ? (o.customerName || 'Opportunity') : 'Add opportunity';
      dr.appendChild(el('div', { class: 'cp-dh' }, [
        el('div', {}, [el('h2', { text: title }), el('p', { text: id ? ('Sl. No. ' + o.slNo + (o.seName ? ' · SE ' + o.seName : '') + (o.lastReviewDate ? ' · last review ' + dmy(o.lastReviewDate) : '')) : 'Same columns as the Master CPR sheet' })]),
        el('button', { class: 'cp-x', type: 'button', 'aria-label': 'Close', onclick: close, text: '×' })
      ]));
      var b = el('div', { class: 'cp-db' });
      b.appendChild(el('div', { class: 'cp-sec' }, [el('h3', { text: 'Customer & sales engineer' }), el('div', { class: 'cp-grid' }, [
        custWrap,
        inp('region', 'Region & City', { ph: 'e.g. South-Chennai' }),
        seField ? el('div', { class: 'cp-f' }, [el('label', { for: 'cp-f-seId', text: 'SE (sales engineer)' }), seField]) : el('div', { class: 'cp-f' }, [el('label', { text: 'SE (sales engineer)' }), el('div', { class: 'cp-in', style: 'background:transparent', text: o.seName || me().name || 'Me' })]),
        seg('channel', 'Channel or Direct', META.channels),
        inp('distributor', 'Distributor', { ph: 'e.g. MTS' })
      ])]));
      b.appendChild(el('div', { class: 'cp-sec' }, [el('h3', { text: 'Application' }), el('div', { class: 'cp-grid' }, [
        inp('materialGroup', 'Material group', { list: META.materials }),
        inp('materialSubGroup', 'Material sub-group', { ph: 'e.g. C45, SS304, FCD700' }),
        inp('component', 'Component', { ph: 'e.g. Brake housing' }),
        inp('capturedDate', 'Opportunity captured / mapped date', { type: 'date', def: id ? null : ymd(new Date()) })
      ])]));
      b.appendChild(el('div', { class: 'cp-sec' }, [el('h3', { text: 'Opportunity' }), el('div', { class: 'cp-grid' }, [
        inp('opportunity', 'Opportunity', { type: 'textarea', full: true, ph: 'Tool / product, e.g. TNMA160408-D2-YC0014' }),
        inp('edp', 'EDP', { ph: 'Item / EDP number' }),
        inp('competition', 'Competition', { ph: 'e.g. Mitsubishi, Guhring' }),
        inp('productGroup', 'Product group', { list: META.productGroups }),
        inp('focusBrand', 'Focus brand', { list: META.focusBrands || [], other: true }),
        inp('focusGroup', 'Focus product', { list: META.focusGroups, other: true }),
        seg('cpr', 'C / P / R', META.cpr),
        inp('objective', 'Objective', { type: 'textarea', full: true, ph: 'What needs to happen, e.g. consistency trial planned' })
      ])]));
      b.appendChild(el('div', { class: 'cp-sec' }, [el('h3', {}, ['Value & plan ', el('small', { text: 'amounts in Rs lakhs' })]), el('div', { class: 'cp-grid' }, [
        inp('annualPotential', 'Annual potential of the opportunity (L)', { type: 'number', ph: '0.00' }),
        inp('expectedSale', 'Expected annual sale (L)', { type: 'number', ph: '0.00' }),
        inp('orderValue', 'Order value received till date (L)', { type: 'number', ph: '0.00', hint: 'If order received — total value this financial year' }),
        inp('timeline', 'Time line', { type: 'date' }),
        inp('personResponsible', 'Person responsible', { ph: 'Defaults to the SE' })
      ])]));
      b.appendChild(el('div', { class: 'cp-sec' }, [el('h3', { text: 'Status' }), el('div', { class: 'cp-grid' }, [
        inp('status', 'Status of the opportunity', { list: META.statuses, def: 'Trial planned' })
      ])]));
      if (fields.status && fields.status.tagName === 'SELECT') paintStatus(fields.status);
      if (id) {
        var hist = el('div', { class: 'cp-hist' });
        if (!reviews.length) hist.appendChild(el('div', { class: 'cp-sub', text: 'No review remarks yet — add them in the Saturday review tab.' }));
        reviews.forEach(function (rv) {
          hist.appendChild(el('div', { class: 'h' }, [
            el('b', { text: 'Remarks as on ' + dmy(rv.reviewDate) }), ' ',
            rv.status && rv.prevStatus && rv.status !== rv.prevStatus ? el('span', { class: 'cp-sub', text: rv.prevStatus + ' → ' + rv.status }) : null,
            el('div', { text: rv.remark || '(status / values updated)' }),
            rv.reviewedByName ? el('div', { class: 'cp-sub', text: 'by ' + rv.reviewedByName }) : null
          ]));
        });
        b.appendChild(el('div', { class: 'cp-sec' }, [el('h3', { text: 'Review history' }), hist]));
      }
      dr.appendChild(b);
      dr.appendChild(err);
      var saveBtn = el('button', { class: 'cp-btn pri', type: 'button', id: 'cp-save-opp', text: id ? 'Save changes' : 'Add opportunity' });
      dr.appendChild(el('div', { class: 'cp-df' }, [
        id ? el('button', { class: 'cp-btn red', type: 'button', style: 'margin-right:auto', text: 'Remove', onclick: function () {
          if (!confirm('Remove this opportunity from the register?')) return;
          api('DELETE', '/cpr/' + id).then(function () { close(); toast('Opportunity removed'); if (state.reloadRegister) state.reloadRegister(); })
            .catch(function (e) { err.className = 'cp-err'; err.textContent = e.message; });
        } }) : null,
        el('button', { class: 'cp-btn', type: 'button', text: 'Cancel', onclick: close }),
        saveBtn
      ]));
      saveBtn.addEventListener('click', function () {
        var body = {};
        Object.keys(fields).forEach(function (k) { body[k] = fields[k].value.trim(); });
        ['channel', 'cpr', 'rag'].forEach(function (k) { body[k] = v[k] || ''; });
        body.customerId = custMap[body.customerName] || (body.customerName === (o.customerName || '') ? (o.customerId || '') : '') || v.customerId || '';
        if (seField) { body.seId = seField.value; if (!seField.value && o.seName && !o.seId) delete body.seId; }
        if (!body.customerName) { err.className = 'cp-err'; err.textContent = 'Customer is required.'; custIn.focus(); return; }
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        // Link the CRM customer even if the name was typed faster than the suggestions arrived.
        var link = body.customerId ? Promise.resolve() : api('GET', '/customers?limit=10&search=' + encodeURIComponent(body.customerName)).then(function (r) {
          var hit = ((r.data && r.data.items) || []).filter(function (c) { return String(c.companyName).trim().toLowerCase() === body.customerName.toLowerCase(); });
          if (hit.length === 1) body.customerId = hit[0].id;
        }).catch(function () {});
        link.then(function () { return id ? api('PUT', '/cpr/' + id, body) : api('POST', '/cpr', body); }).then(function () {
          close();
          toast(id ? 'Opportunity updated' : 'Opportunity added');
          if (state.tab === 'register' && state.reloadRegister) state.reloadRegister();
          else if (state.tab === 'review') loadReview();
        }).catch(function (e) {
          err.className = 'cp-err'; err.textContent = e.message;
          saveBtn.disabled = false; saveBtn.textContent = id ? 'Save changes' : 'Add opportunity';
        });
      });
      setTimeout(function () { (id ? fields.status : custIn).focus(); }, 30);
    }
  }

  /* ── Saturday review ─────────────────────────────────────────────── */
  var revBody = null;
  function renderReview(body) {
    revBody = body;
    var r = state.rev;
    var bar = el('div', { class: 'cp-rbar' });
    var date = el('input', { class: 'cp-in', type: 'date', id: 'cp-rev-date', value: r.date, 'aria-label': 'Review date' });
    date.addEventListener('change', function () {
      if (Object.keys(r.dirty).length && !confirm('You have unsaved changes for ' + dmy(r.date) + '. Switch date and discard them?')) { date.value = r.date; return; }
      r.date = date.value || META.thisSaturday; r.dirty = {}; loadReview();
    });
    bar.appendChild(el('label', { class: 'cp-sub', for: 'cp-rev-date', text: 'Review date' }));
    bar.appendChild(date);
    bar.appendChild(el('button', { class: 'cp-btn sm', type: 'button', text: 'This Saturday', onclick: function () { if (date.value !== META.thisSaturday) { date.value = META.thisSaturday; date.dispatchEvent(new Event('change')); } } }));
    if (canSeeAll()) bar.appendChild(seSelect(r.seId, function (v) { r.seId = v; loadReview(); }));
    var show = el('select', { class: 'cp-in', 'aria-label': 'Show', onchange: function () { r.show = show.value; r.limit = 60; drawReview(); } }, [
      el('option', { value: 'open', text: 'Open opportunities' }), el('option', { value: 'pending', text: 'Not yet reviewed' }),
      el('option', { value: 'reviewed', text: 'Reviewed this date' }), el('option', { value: 'all', text: 'All (incl. ordered / parked)' })
    ]);
    show.value = r.show;
    bar.appendChild(show);
    var s = el('input', { class: 'cp-in', type: 'search', placeholder: 'Search…', value: r.search, style: 'flex:1 1 160px' });
    var t; s.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { r.search = s.value.trim().toLowerCase(); r.limit = 60; drawReview(); }, 250); });
    bar.appendChild(s);
    body.appendChild(bar);
    body.appendChild(el('div', { id: 'cp-rev-info' }));
    body.appendChild(el('div', { id: 'cp-rev-list' }));
    body.appendChild(el('div', { id: 'cp-rev-save' }));
    loadReview();
  }

  function loadReview() {
    var r = state.rev;
    var list = document.getElementById('cp-rev-list');
    if (!list) return;
    clear(list).appendChild(el('div', { class: 'cp-empty', text: 'Loading review sheet…' }));
    api('GET', '/cpr/review?date=' + r.date + (r.seId ? '&seId=' + r.seId : '')).then(function (res) {
      r.items = res.data.items; r.isSaturday = res.data.isSaturday; r.dirty = {};
      drawReview();
    }).catch(function (e) { clear(list).appendChild(el('div', { class: 'cp-empty', text: e.message })); });
  }

  function visibleReviewItems() {
    var r = state.rev;
    return r.items.filter(function (o) {
      if (r.show === 'open' && (o.status === 'Order received' || o.status === 'Parked') && !o.review && !r.dirty[o.id]) return false;
      if (r.show === 'pending' && o.review) return false;
      if (r.show === 'reviewed' && !o.review) return false;
      if (r.search) {
        var hay = [o.customerName, o.opportunity, o.edp, o.component, o.region, o.seName, o.productGroup].join(' ').toLowerCase();
        if (hay.indexOf(r.search) === -1) return false;
      }
      return true;
    });
  }

  function drawReview() {
    var r = state.rev;
    var info = document.getElementById('cp-rev-info'), list = document.getElementById('cp-rev-list');
    if (!info || !list) return;
    clear(info); clear(list);
    var reviewed = r.items.filter(function (o) { return o.review; }).length;
    var open = r.items.filter(function (o) { return o.status !== 'Order received' && o.status !== 'Parked'; });
    var openReviewed = open.filter(function (o) { return o.review; }).length;
    if (!r.isSaturday) info.appendChild(el('div', { class: 'cp-warn', text: dmy(r.date) + ' is not a Saturday. Reviews are usually entered for the Saturday meeting — use “This Saturday” unless you are correcting another date.' }));
    info.appendChild(el('div', { class: 'cp-rbar' }, [
      el('div', { class: 'cp-prog' }, [
        el('span', { text: 'Saturday review ' + dmy(r.date) + ' · ' + openReviewed + ' of ' + open.length + ' open reviewed' + (reviewed > openReviewed ? ' (+' + (reviewed - openReviewed) + ' others)' : '') }),
        el('span', { class: 'bar' }, [el('i', { style: 'width:' + (open.length ? Math.round(openReviewed * 100 / open.length) : 0) + '%' })])
      ])
    ]));
    var items = visibleReviewItems();
    if (!items.length) {
      list.appendChild(el('div', { class: 'cp-card cp-empty', text: r.items.length ? 'Nothing to show for this filter.' : 'No opportunities in your register yet. Add them in the Register tab.' }));
      drawSaveBar();
      return;
    }
    var lastSe = null;
    items.slice(0, r.limit).forEach(function (o) {
      if (canSeeAll() && o.seName !== lastSe) {
        lastSe = o.seName;
        var n = items.filter(function (x) { return x.seName === o.seName; }).length;
        list.appendChild(el('div', { class: 'cp-segt' }, ['👤 ' + (o.seName || 'No SE'), el('span', { class: 'cp-sub', text: n + ' opportunit' + (n === 1 ? 'y' : 'ies') })]));
      }
      list.appendChild(reviewCard(o));
    });
    if (items.length > r.limit) {
      list.appendChild(el('div', { style: 'text-align:center;margin:.6rem 0' }, [el('button', { class: 'cp-btn', type: 'button', text: 'Show more (' + (items.length - r.limit) + ' more)', onclick: function () { r.limit += 60; drawReview(); } })]));
    }
    drawSaveBar();
  }

  function reviewCard(o) {
    var r = state.rev;
    var cur = r.dirty[o.id] || {};
    var base = o.review || {};
    var val = function (k, fallback) { return cur[k] !== undefined ? cur[k] : (base[k] !== undefined && base[k] !== null ? base[k] : fallback); };
    var card = el('div', { class: 'cp-rc' + (r.dirty[o.id] ? ' dirty' : ''), 'data-id': o.id, style: '--c:' + (STATUS_COLOR[val('status', o.status)] || '#cbd5e1') });
    function mark(k, v) {
      var d = r.dirty[o.id] || (r.dirty[o.id] = {});
      d[k] = v;
      card.classList.add('dirty');
      if (k === 'status') card.style.setProperty('--c', STATUS_COLOR[v] || '#cbd5e1');
      drawSaveBar();
    }
    card.appendChild(el('div', { class: 'top' }, [
      el('div', {}, [
        el('div', { class: 'ttl', text: o.customerName }),
        el('div', { class: 'cp-sub', text: [o.opportunity || o.component, o.edp, o.productGroup, o.cpr ? 'C/P/R ' + o.cpr : null].filter(Boolean).join(' · ') }),
        el('div', { class: 'cp-sub', text: (o.annualPotential != null ? 'Potential ' + lakh(o.annualPotential) + ' L' : 'Potential not set') + (o.competition ? ' · vs ' + o.competition : '') + (o.objective ? ' · ' + o.objective : '') })
      ]),
      el('div', { style: 'text-align:right' }, [
        o.review ? el('div', { class: 'done', text: '✓ Reviewed ' + dmy(r.date) }) : null,
        el('button', { class: 'cp-btn sm', type: 'button', text: 'Details', onclick: function () { openForm(o.id); } })
      ])
    ]));
    var lr = o.lastReview;
    card.appendChild(el('div', { class: 'last' }, lr
      ? [el('b', { text: 'Last review ' + dmy(lr.reviewDate) + ': ' }), lr.remark || '(status / values updated)', lr.status ? el('span', { class: 'cp-sub', text: ' · ' + lr.status }) : null]
      : [o.latestRemark && !(o.review && o.review.remark === o.latestRemark) ? el('span', {}, [el('b', { text: 'Latest remark: ' }), o.latestRemark]) : el('span', { class: 'cp-sub', text: 'No earlier review remark.' })]));
    var st = el('select', { class: 'cp-in', 'aria-label': 'Status' });
    META.statuses.forEach(function (s) { st.appendChild(el('option', { value: s, text: s })); });
    if (META.statuses.indexOf(o.status) === -1) st.appendChild(el('option', { value: o.status, text: o.status }));
    st.value = val('status', o.status);
    st.addEventListener('change', function () { mark('status', st.value); });
    paintStatus(st);
    var rag = el('div', { class: 'cp-seg rag', role: 'radiogroup', 'aria-label': 'Red / Yellow / Green' });
    var rv = val('rag', o.rag) || '';
    META.rag.forEach(function (x) {
      rag.appendChild(el('button', { type: 'button', 'data-v': x, class: rv === x ? 'on' : '', role: 'radio', 'aria-checked': rv === x ? 'true' : 'false', title: x, text: x.charAt(0),
        onclick: function () {
          rv = rv === x ? '' : x;
          Array.prototype.forEach.call(rag.children, function (c) { var on = c.getAttribute('data-v') === rv; c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); });
          mark('rag', rv);
        } }));
    });
    function num(k, label, fb) {
      var i = el('input', { class: 'cp-in', type: 'number', step: 'any', min: '0', inputmode: 'decimal', placeholder: label, 'aria-label': label, title: label });
      var x = val(k, fb); if (x != null && x !== '') i.value = x;
      i.addEventListener('input', function () { mark(k, i.value); });
      return el('div', { class: 'cp-f' }, [el('label', { text: label }), i]);
    }
    var tl = el('input', { class: 'cp-in', type: 'date', 'aria-label': 'Time line' });
    var tv = val('timeline', o.timeline); if (tv) tl.value = String(tv).slice(0, 10);
    tl.addEventListener('change', function () { mark('timeline', tl.value); });
    card.appendChild(el('div', { class: 'cp-rgrid' }, [
      el('div', { class: 'cp-f' }, [el('label', { text: 'Status' }), st]),
      num('expectedSale', 'Expected (L)', o.expectedSale),
      num('orderValue', 'Order value (L)', o.orderValue),
      el('div', { class: 'cp-f' }, [el('label', { text: 'Time line' }), tl])
    ]));
    var ta = el('textarea', { class: 'cp-in', placeholder: 'Remarks as on ' + dmy(r.date) + ' — what happened this week, next step…', 'aria-label': 'Remark' });
    ta.value = val('remark', '') || '';
    ta.addEventListener('input', function () { mark('remark', ta.value); });
    card.appendChild(ta);
    return card;
  }

  function drawSaveBar() {
    var host = document.getElementById('cp-rev-save');
    if (!host) return;
    clear(host);
    var n = Object.keys(state.rev.dirty).length;
    if (!n) return;
    var btn = el('button', { class: 'cp-btn grn', type: 'button', id: 'cp-rev-savebtn', text: 'Save review for ' + dmy(state.rev.date) });
    host.appendChild(el('div', { class: 'cp-save' }, [
      el('span', { text: n + ' opportunit' + (n === 1 ? 'y' : 'ies') + ' changed — not saved yet' }),
      el('span', { class: 'cp-actions' }, [
        el('button', { class: 'cp-btn sm', type: 'button', text: 'Discard', onclick: function () { if (confirm('Discard your unsaved changes?')) { state.rev.dirty = {}; drawReview(); } } }),
        btn
      ])
    ]));
    btn.addEventListener('click', function () {
      var entries = Object.keys(state.rev.dirty).map(function (id) {
        var d = state.rev.dirty[id]; var e = { opportunityId: id };
        Object.keys(d).forEach(function (k) { e[k] = d[k]; });
        return e;
      });
      btn.disabled = true; btn.textContent = 'Saving…';
      api('POST', '/cpr/review', { date: state.rev.date, entries: entries }).then(function (res) {
        state.rev.dirty = {};
        toast(res.message + (res.data.errors && res.data.errors.length ? ' · ' + res.data.errors.length + ' skipped' : ''), res.data.errors && res.data.errors.length ? 'err' : 'ok');
        loadReview();
      }).catch(function (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Save review for ' + dmy(state.rev.date); });
    });
  }

  /* ── Reports ─────────────────────────────────────────────────────── */
  function renderReports(body) {
    var grid = el('div', { class: 'cp-rgrid2' });
    body.appendChild(grid);
    // Weekly
    var wDate = el('input', { class: 'cp-in', type: 'date', id: 'cp-wk-date', value: META.thisSaturday });
    var wLbl = el('div', { class: 'hint' });
    function wl() { wLbl.textContent = 'Week ending Saturday ' + dmy(saturdayOf(wDate.value)) + ' (Sunday–Saturday)'; }
    wDate.addEventListener('change', wl); wl();
    var wSe = canSeeAll() ? seSelect('', function () {}) : null;
    var wBtn = el('button', { class: 'cp-btn pri', type: 'button', id: 'cp-dl-week', text: '⤓ Download weekly report' });
    wBtn.addEventListener('click', function () {
      wBtn.disabled = true;
      download('/cpr/report?period=week&date=' + saturdayOf(wDate.value) + (wSe && wSe.value ? '&seId=' + wSe.value : ''), 'CPR-weekly-' + saturdayOf(wDate.value) + '.xlsx')
        .then(function (n) { toast('Downloaded ' + n); }).catch(function (e) { toast(e.message, 'err'); }).then(function () { wBtn.disabled = false; });
    });
    grid.appendChild(el('div', { class: 'cp-card cp-rep' }, [
      el('h3', { text: '📅 Weekly report' }),
      el('p', { text: 'For the Saturday review: the full register in the Master CPR layout with this week’s and the previous review’s remarks, plus a summary by status, engineer and product group, this week’s review entries and new opportunities.' }),
      el('div', { class: 'row' }, [
        el('div', { class: 'cp-f' }, [el('label', { for: 'cp-wk-date', text: 'Any day in the week' }), wDate, wLbl]),
        wSe ? el('div', { class: 'cp-f' }, [el('label', { text: 'Sales engineer' }), wSe]) : null,
        wBtn
      ])
    ]));
    // Monthly
    var now = new Date();
    var mIn = el('input', { class: 'cp-in', type: 'month', id: 'cp-mo', value: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') });
    var mSe = canSeeAll() ? seSelect('', function () {}) : null;
    var mBtn = el('button', { class: 'cp-btn pri', type: 'button', id: 'cp-dl-month', text: '⤓ Download monthly report' });
    mBtn.addEventListener('click', function () {
      if (!mIn.value) { toast('Pick a month', 'err'); return; }
      mBtn.disabled = true;
      download('/cpr/report?period=month&date=' + mIn.value + '-01' + (mSe && mSe.value ? '&seId=' + mSe.value : ''), 'CPR-monthly-' + mIn.value + '.xlsx')
        .then(function (n) { toast('Downloaded ' + n); }).catch(function (e) { toast(e.message, 'err'); }).then(function () { mBtn.disabled = false; });
    });
    grid.appendChild(el('div', { class: 'cp-card cp-rep' }, [
      el('h3', { text: '🗓 Monthly report' }),
      el('p', { text: 'The register with a “Remarks as on” column for every Saturday review in the month, the month’s summary, every review entry with status changes, and opportunities captured in the month.' }),
      el('div', { class: 'row' }, [
        el('div', { class: 'cp-f' }, [el('label', { for: 'cp-mo', text: 'Month' }), mIn]),
        mSe ? el('div', { class: 'cp-f' }, [el('label', { text: 'Sales engineer' }), mSe]) : null,
        mBtn
      ])
    ]));
    // Review history
    var hist = el('div', { class: 'cp-dates' }, [el('div', { class: 'cp-sub', text: 'Loading…' })]);
    grid.appendChild(el('div', { class: 'cp-card cp-rep' }, [el('h3', { text: '🕘 Review meetings held' }), el('p', { text: 'Dates with review remarks. Download that week’s report directly.' }), hist]));
    api('GET', '/cpr/review-dates').then(function (r) {
      clear(hist);
      if (!r.data.dates.length) { hist.appendChild(el('div', { class: 'cp-sub', text: 'No reviews yet.' })); return; }
      r.data.dates.slice(0, 15).forEach(function (d) {
        hist.appendChild(el('div', { class: 'd' }, [
          el('span', {}, [el('b', { text: dmy(d.date) }), el('span', { class: 'cp-sub', text: ' · ' + d.entries + ' remark' + (d.entries == 1 ? '' : 's') })]),
          el('button', { class: 'cp-btn sm', type: 'button', text: '⤓ Weekly', onclick: function () {
            download('/cpr/report?period=week&date=' + d.date, 'CPR-weekly-' + saturdayOf(d.date) + '.xlsx').then(function (n) { toast('Downloaded ' + n); }).catch(function (e) { toast(e.message, 'err'); });
          } })
        ]));
      });
    }).catch(function (e) { clear(hist).appendChild(el('div', { class: 'cp-sub', text: e.message })); });
    // Import (manager+)
    if (canSeeAll()) {
      var file = el('input', { type: 'file', id: 'cp-import-file', accept: '.xlsx', style: 'display:none' });
      var res = el('div', { class: 'cp-sub', style: 'margin-top:.6rem' });
      var iBtn = el('button', { class: 'cp-btn grn', type: 'button', id: 'cp-import-btn', text: '⤒ Import CPR Excel', onclick: function () { file.click(); } });
      file.addEventListener('change', function () {
        var f = file.files[0]; if (!f) return;
        if (!confirm('Import “' + f.name + '”? Rows are added to the register; rows imported before from the same sheet are updated, not duplicated.')) { file.value = ''; return; }
        var fd = new FormData(); fd.append('file', f);
        iBtn.disabled = true; iBtn.textContent = 'Importing…'; res.textContent = '';
        fetch(API + '/api/cpr/import', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') }, body: fd })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.success === false) throw new Error(j.message || 'Import failed'); return j; }); })
          .then(function (j) {
            res.textContent = '✓ ' + j.message + (j.data.remarkDates && j.data.remarkDates.length ? ' (remarks dated ' + j.data.remarkDates.map(dmy).join(', ') + ')' : '');
            toast(j.message);
          })
          .catch(function (e) { res.textContent = '✗ ' + e.message; toast(e.message, 'err'); })
          .then(function () { iBtn.disabled = false; iBtn.textContent = '⤒ Import CPR Excel'; file.value = ''; });
      });
      grid.appendChild(el('div', { class: 'cp-card cp-rep' }, [
        el('h3', { text: '📥 Import your CPR Excel' }),
        el('p', { text: 'Upload the Master CPR sheet (.xlsx). Columns are matched by their headings; “Remarks as on dd.mm.yyyy” columns become dated review remarks. Engineers and customers are linked by name.' }),
        el('div', { class: 'row' }, [iBtn, file, el('button', { class: 'cp-btn', type: 'button', text: '⤓ Blank template', onclick: function () {
          download('/cpr/template', 'CPR-template.xlsx').catch(function (e) { toast(e.message, 'err'); });
        } })]),
        res
      ]));
    }
  }

  window.CprPage = { mountPage: mountPage };
})();
