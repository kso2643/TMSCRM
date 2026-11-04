/* ══════════════════════════════════════════════════════════════════════
   Engineer notes (v11.46) — learn, take a daily quiz, read the news and prices.
   Tabs:
     📚 Learn            the 10 topics (engineer-notes-content.js) with pictures, "Mark as read"
     🎯 Today & quiz     pick today's topics ("I read from topic X to Y") → auto-generated MCQ quiz,
                         score saved, history and streak
     📰 News & prices    carbide / raw material prices (history) and technical news, updated after midnight
     👥 Team             (Super Admin / Admin / Manager) who is learning and their quiz scores
   API: /api/learn/*
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  var E = window.ENotes || { topics: [], generated: function () { return []; } };
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  function api(method, path, body) {
    var o = { method: method, headers: { Authorization: 'Bearer ' + (token() || '') } };
    if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(API + '/api' + path, o).then(function (r) {
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
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v; else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function toast(m, bad) { var t = el('div', { class: 'en-toast' + (bad ? ' bad' : ''), text: m }); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
  function dmy(s) { var d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function when(s) { var d = new Date(String(s || '').replace(' ', 'T')); if (isNaN(d)) return ''; var h = (Date.now() - d) / 36e5; return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min ago' : h < 24 ? Math.round(h) + ' h ago' : dmy(s); }
  function topic(id) { return E.topics.filter(function (t) { return t.id === id; })[0]; }
  var admin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(me().role) !== -1;

  function css() {
    if (document.getElementById('en-css')) return;
    var st = document.createElement('style'); st.id = 'en-css';
    st.textContent = [
      '.en-wrap{max-width:1250px;margin:0 auto;padding-bottom:3rem}',
      '.en-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:.8rem}.en-head h1{font-size:1.5rem;font-weight:700;margin:0}.en-head p{color:#64748b;font-size:.9rem;margin:.2rem 0 0}',
      '.en-streak{display:flex;gap:.5rem;flex-wrap:wrap}.en-pill{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;border-radius:999px;padding:.35rem .8rem;font-weight:700;font-size:.85rem}.en-pill.b{background:#eff6ff;color:#1e40af;border-color:#bfdbfe}',
      '.dark .en-pill{background:#422006;color:#fed7aa;border-color:#7c2d12}.dark .en-pill.b{background:#1e3a8a55;color:#bfdbfe;border-color:#1e3a8a}',
      '.en-tabs{display:flex;gap:.2rem;border-bottom:1px solid #e2e8f0;margin-bottom:1rem;overflow-x:auto}.dark .en-tabs{border-color:#334155}',
      '.en-tab{padding:.6rem 1rem;border:0;background:none;font-weight:600;color:#64748b;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;font-size:.92rem}.en-tab.on{color:var(--crm-p,#1e3a5f);border-bottom-color:var(--crm-p,#1e3a5f)}.dark .en-tab.on{color:#93c5fd;border-bottom-color:#93c5fd}',
      '.en-learn{display:grid;grid-template-columns:280px 1fr;gap:1rem}@media(max-width:860px){.en-learn{grid-template-columns:1fr}}',
      '.en-list{display:flex;flex-direction:column;gap:.35rem}@media(max-width:860px){.en-list{flex-direction:row;overflow-x:auto;padding-bottom:.3rem}.en-li{min-width:220px}}',
      '.en-li{display:flex;gap:.6rem;align-items:center;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:.8rem;padding:.6rem .7rem;cursor:pointer;color:inherit}.dark .en-li{background:#1e293b;border-color:#334155}',
      '.en-li.on{border-color:var(--crm-p,#1e3a5f);box-shadow:0 0 0 2px color-mix(in srgb,var(--crm-p,#1e3a5f) 20%,transparent)}',
      '.en-li .i{width:34px;height:34px;border-radius:.6rem;background:#eff6ff;display:flex;align-items:center;justify-content:center;font-size:1.05rem;flex:none}.dark .en-li .i{background:#0f172a}',
      '.en-li b{display:block;font-size:.86rem;line-height:1.25}.en-li small{color:#64748b;font-size:.72rem}.en-li .ok{margin-left:auto;color:#16a34a;font-weight:800}',
      '.en-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1.1rem 1.2rem;margin-bottom:1rem}.dark .en-card{background:#1e293b;border-color:#334155}',
      '.en-doc h2{font-size:1.3rem;margin:.1rem 0 .2rem}.en-doc .sub{color:#64748b;margin:0 0 .9rem;font-size:.9rem}.en-doc h3{font-size:1.02rem;margin:1.3rem 0 .5rem;color:var(--crm-p,#1e3a5f)}.dark .en-doc h3{color:#93c5fd}',
      '.en-doc p,.en-doc li{line-height:1.6;font-size:.93rem}.en-doc ol,.en-doc ul{padding-left:1.2rem}',
      '.en-fig{margin:.8rem 0 1rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:.8rem;padding:.6rem}.dark .en-fig{background:#0f172a;border-color:#334155}',
      '.en-fig svg{width:100%;height:auto;display:block;max-height:340px}.dark .en-fig svg text{fill:#e2e8f0}.en-fig figcaption{font-size:.8rem;color:#64748b;margin-top:.4rem;line-height:1.45}',
      '.en-tw{overflow-x:auto;margin:.5rem 0 1rem}.en-t{width:100%;border-collapse:collapse;font-size:.85rem}.en-t th{background:#f1f5f9;text-align:left;padding:.5rem .6rem;font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;color:#475569}',
      '.en-t td{padding:.5rem .6rem;border-bottom:1px solid #f1f5f9;vertical-align:top}.dark .en-t th{background:#0f172a;color:#94a3b8}.dark .en-t td{border-color:#334155}',
      '.en-box{border-radius:.7rem;padding:.7rem .9rem;margin:.8rem 0;font-size:.88rem;line-height:1.55}.en-tip{background:#ecfdf5;border:1px solid #a7f3d0}.en-note{background:#eff6ff;border:1px solid #bfdbfe}.en-warn{background:#fffbeb;border:1px solid #fde68a}',
      '.dark .en-tip{background:#052e16;border-color:#14532d}.dark .en-note{background:#172554;border-color:#1e3a8a}.dark .en-warn{background:#422006;border-color:#713f12}',
      '.en-acts{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem;padding-top:.8rem;border-top:1px solid #e2e8f0}.dark .en-acts{border-color:#334155}',
      '.en-btn{border:1px solid #cbd5e1;background:#fff;border-radius:.6rem;padding:.55rem .9rem;font-weight:600;font-size:.86rem;cursor:pointer;color:inherit}.dark .en-btn{background:#0f172a;border-color:#334155}',
      '.en-btn.pri{background:var(--crm-p,#1e3a5f);border-color:var(--crm-p,#1e3a5f);color:#fff}.en-btn.ok{background:#16a34a;border-color:#16a34a;color:#fff}.en-btn:disabled{opacity:.5}',
      '.en-calc{border:1px dashed #94a3b8;border-radius:.8rem;padding:.8rem;margin:.6rem 0;display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end}',
      '.en-calc label{display:flex;flex-direction:column;font-size:.75rem;font-weight:600;color:#64748b;gap:.2rem}.en-calc input,.en-calc select{border:1px solid #cbd5e1;border-radius:.5rem;padding:.4rem .5rem;width:7.5rem;font-size:.88rem;background:#fff;color:inherit}',
      '.dark .en-calc input,.dark .en-calc select{background:#0f172a;border-color:#334155}.en-calc .r{font-weight:700;font-size:.95rem;color:var(--crm-p,#1e3a5f);padding:.4rem 0}.en-calc b.t{width:100%;font-size:.85rem}',
      '.en-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.5rem;margin:.6rem 0}',
      '.en-pick label{display:flex;gap:.5rem;align-items:center;border:1px solid #e2e8f0;border-radius:.7rem;padding:.55rem .7rem;cursor:pointer;font-size:.86rem}.en-pick label.on{border-color:var(--crm-p,#1e3a5f);background:color-mix(in srgb,var(--crm-p,#1e3a5f) 8%,#fff)}',
      '.dark .en-pick label{border-color:#334155}.dark .en-pick label.on{background:#1e3a8a44}',
      '.en-q{border:1px solid #e2e8f0;border-radius:.8rem;padding:.8rem .9rem;margin-bottom:.7rem}.dark .en-q{border-color:#334155}.en-q b{display:block;margin-bottom:.5rem;font-size:.93rem}',
      '.en-q label{display:flex;gap:.5rem;align-items:flex-start;padding:.4rem .5rem;border-radius:.5rem;cursor:pointer;font-size:.9rem}.en-q label:hover{background:#f8fafc}.dark .en-q label:hover{background:#0f172a}',
      '.en-q label.right{background:#dcfce7}.en-q label.wrong{background:#fee2e2}.dark .en-q label.right{background:#14532d}.dark .en-q label.wrong{background:#7f1d1d}',
      '.en-q .ex{font-size:.82rem;color:#475569;margin-top:.35rem}.dark .en-q .ex{color:#cbd5e1}.en-q .tg{font-size:.7rem;color:#64748b;float:right}',
      '.en-score{text-align:center;padding:1rem}.en-score .big{font-size:2.6rem;font-weight:800;color:var(--crm-p,#1e3a5f)}',
      '.en-prices td.r,.en-prices th.r{text-align:right}.en-up{color:#16a34a}.en-down{color:#dc2626}',
      '.en-news a{display:block;padding:.6rem 0;border-bottom:1px solid #f1f5f9;color:inherit;text-decoration:none}.dark .en-news a{border-color:#334155}.en-news a:hover b{text-decoration:underline}',
      '.en-news b{display:block;font-size:.9rem;line-height:1.4}.en-news small{color:#64748b;font-size:.75rem}',
      '.en-grid2{display:grid;grid-template-columns:1.2fr 1fr;gap:1rem}@media(max-width:900px){.en-grid2{grid-template-columns:1fr}}',
      '.en-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:.6rem 1rem;border-radius:.6rem;font-size:.88rem;z-index:9999}.en-toast.bad{background:#b91c1c}',
      '.en-in{border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .55rem;font-size:.88rem;background:#fff;color:inherit}.dark .en-in{background:#0f172a;border-color:#334155}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var S = { tab: 'learn', topic: 'tools', mine: { read: {}, quizzes: [], plan: [], streak: 0 } }, body, headPills;
  function loadMine() { return api('GET', '/learn/me').then(function (j) { S.mine = j.data; S.mine.read = S.mine.read || {}; drawPills(); }).catch(function () {}); }
  function drawPills() {
    if (!headPills) return;
    clear(headPills);
    var readN = Object.keys(S.mine.read || {}).length, last = (S.mine.quizzes || [])[0];
    headPills.appendChild(el('span', { class: 'en-pill', id: 'en-streak', text: '🔥 ' + (S.mine.streak || 0) + ' day streak' }));
    headPills.appendChild(el('span', { class: 'en-pill b', text: '📚 ' + readN + ' / ' + E.topics.length + ' topics read' }));
    if (last) headPills.appendChild(el('span', { class: 'en-pill b', text: '🎯 Last quiz ' + last.correct + '/' + last.total }));
  }

  // ── 📚 Learn ──
  function learnView() {
    clear(body);
    var wrap = el('div', { class: 'en-learn' }), list = el('div', { class: 'en-list', id: 'en-topics' }), doc = el('div', { class: 'en-card en-doc', id: 'en-doc' });
    E.topics.forEach(function (t) {
      var r = S.mine.read[t.id];
      list.appendChild(el('button', { type: 'button', class: 'en-li' + (S.topic === t.id ? ' on' : ''), 'data-topic': t.id, onclick: function () { S.topic = t.id; learnView(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
        [el('span', { class: 'i', text: t.icon }), el('span', {}, [el('b', { text: t.n + '. ' + t.title }), el('small', { text: r ? 'Read ' + dmy(r.lastDay) : t.qs.length + ' quiz questions' })]), r ? el('span', { class: 'ok', text: '✓' }) : null]));
    });
    var t = topic(S.topic) || E.topics[0];
    doc.appendChild(el('h2', { text: t.icon + ' ' + t.n + '. ' + t.title }));
    doc.appendChild(el('p', { class: 'sub', text: t.sub }));
    doc.appendChild(el('div', { html: t.body }));
    doc.querySelectorAll('.en-calc').forEach(calc);
    var i = E.topics.indexOf(t);
    doc.appendChild(el('div', { class: 'en-acts' }, [
      el('button', { type: 'button', class: 'en-btn ok', id: 'en-mark-read', text: S.mine.read[t.id] && S.mine.read[t.id].lastDay === S.mine.today ? '✓ Read today' : '✓ Mark as read', onclick: function () {
        api('POST', '/learn/read', { topicId: t.id }).then(function (j) { S.mine.read[t.id] = { lastDay: S.mine.today, times: 1 }; S.mine.streak = j.data.streak; toast('Marked as read — well done!'); drawPills(); learnView(); }).catch(function (e) { toast(e.message, true); });
      } }),
      el('button', { type: 'button', class: 'en-btn pri', id: 'en-quiz-this', text: '🎯 Quiz on this topic', onclick: function () { S.tab = 'quiz'; S.quizTopics = [t.id]; render(); startQuiz([t.id], 8); } }),
      i > 0 ? el('button', { type: 'button', class: 'en-btn', text: '‹ ' + E.topics[i - 1].title, onclick: function () { S.topic = E.topics[i - 1].id; learnView(); window.scrollTo({ top: 0 }); } }) : null,
      i < E.topics.length - 1 ? el('button', { type: 'button', class: 'en-btn', text: E.topics[i + 1].title + ' ›', onclick: function () { S.topic = E.topics[i + 1].id; learnView(); window.scrollTo({ top: 0 }); } }) : null]));
    wrap.appendChild(list); wrap.appendChild(doc); body.appendChild(wrap);
  }
  // calculators inside the conversions topic
  function calc(box) {
    var k = box.getAttribute('data-calc');
    function inp(id, ph, v) { return el('input', { type: 'number', step: 'any', 'data-c': id, placeholder: ph, value: v }); }
    function f(lbl, x) { return el('label', {}, [lbl, x]); }
    var out = el('span', { class: 'r' });
    function g(id) { var x = box.querySelector('[data-c="' + id + '"]'); return x ? parseFloat(x.value) : NaN; }
    var fmt = function (v, d) { return isFinite(v) ? Number(v.toFixed(d)).toLocaleString('en-IN') : '—'; };
    var run;
    if (k === 'rpm') {
      box.appendChild(el('b', { class: 't', text: 'rpm ↔ cutting speed' }));
      [f('Diameter D (mm)', inp('d', 'Ø mm', 50)), f('Vc (m/min)', inp('vc', 'm/min', 200))].forEach(function (x) { box.appendChild(x); });
      run = function () { out.textContent = 'n = ' + fmt(g('vc') * 1000 / (Math.PI * g('d')), 0) + ' rpm'; };
    } else if (k === 'vf') {
      box.appendChild(el('b', { class: 't', text: 'Milling table feed' }));
      [f('fz (mm/tooth)', inp('fz', '0.1', 0.1)), f('Teeth z', inp('z', '4', 4)), f('rpm n', inp('n', 'rpm', 2000))].forEach(function (x) { box.appendChild(x); });
      run = function () { out.textContent = 'vf = ' + fmt(g('fz') * g('z') * g('n'), 0) + ' mm/min'; };
    } else if (k === 'mrr') {
      box.appendChild(el('b', { class: 't', text: 'Turning: metal removal and power' }));
      [f('Vc (m/min)', inp('vc', '200', 200)), f('ap (mm)', inp('ap', '2', 2)), f('f (mm/rev)', inp('f', '0.3', 0.3)), f('kc (N/mm²)', inp('kc', '1800', 1800))].forEach(function (x) { box.appendChild(x); });
      run = function () { var q = g('vc') * g('ap') * g('f'); out.textContent = 'Q = ' + fmt(q, 1) + ' cm³/min · Pc ≈ ' + fmt(q * g('kc') / 60000, 1) + ' kW'; };
    } else {
      box.appendChild(el('b', { class: 't', text: 'Unit converter' }));
      var sel = el('select', { 'data-c': 'u' }, [['in-mm', 'inch → mm'], ['mm-in', 'mm → inch'], ['sfm-m', 'SFM → m/min'], ['m-sfm', 'm/min → SFM'], ['ipr-mmr', 'inch/rev → mm/rev'], ['hrc-hb', 'HRC → HB (approx.)']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
      [f('Convert', sel), f('Value', inp('v', 'value', 1))].forEach(function (x) { box.appendChild(x); });
      run = function () {
        var v = g('v'), u = sel.value, hb = { 20: 226, 25: 253, 30: 286, 35: 327, 40: 371, 45: 421, 50: 481 };
        var r = u === 'in-mm' ? fmt(v * 25.4, 3) + ' mm' : u === 'mm-in' ? fmt(v / 25.4, 4) + ' inch' : u === 'sfm-m' ? fmt(v * 0.3048, 1) + ' m/min' : u === 'm-sfm' ? fmt(v * 3.2808, 0) + ' SFM' : u === 'ipr-mmr' ? fmt(v * 25.4, 3) + ' mm/rev' : null;
        if (u === 'hrc-hb') { var ks = Object.keys(hb).map(Number), lo = ks.filter(function (x) { return x <= v; }).pop(), hi = ks.filter(function (x) { return x >= v; })[0]; r = lo == null || hi == null ? 'use 20–50 HRC' : '≈ ' + fmt(lo === hi ? hb[lo] : hb[lo] + (hb[hi] - hb[lo]) * (v - lo) / (hi - lo), 0) + ' HB'; }
        out.textContent = '= ' + r;
      };
      sel.onchange = run;
    }
    box.appendChild(out);
    box.addEventListener('input', run);
    run();
  }

  // ── 🎯 Today & quiz ──
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function makeQuiz(ids, n) {
    var pool = [];
    ids.forEach(function (id) { var t = topic(id); if (t) t.qs.forEach(function (q) { pool.push(Object.assign({ topic: id }, q)); }); });
    pool = shuffle(pool);
    var wantGen = ids.some(function (id) { var t = topic(id); return t && (t.gen || id === 'existing'); });
    var nGen = wantGen ? Math.max(2, Math.round(n * 0.3)) : 0;
    var qs = pool.slice(0, Math.max(0, n - nGen)).concat(E.generated(Math.min(nGen, n)).map(function (q) { return Object.assign({ topic: 'conversions' }, q); }));
    if (qs.length < n) qs = qs.concat(E.generated(n - qs.length).map(function (q) { return Object.assign({ topic: 'conversions' }, q); }));
    return shuffle(qs).slice(0, n).map(function (q) {   // shuffle the options, keep the right one
      var order = shuffle(q.o.map(function (_, i) { return i; }));
      return { q: q.q, o: order.map(function (i) { return q.o[i]; }), a: order.indexOf(q.a), e: q.e, topic: q.topic, gen: !!q.gen };
    });
  }
  var quizBox;
  function quizView() {
    clear(body);
    var plan = (S.mine.plan && S.mine.plan.length ? S.mine.plan : (S.quizTopics || [])).slice();
    var sel = {}; plan.forEach(function (id) { sel[id] = true; });
    var card = el('div', { class: 'en-card', id: 'en-today' });
    card.appendChild(el('h3', { style: 'margin:0 0 .3rem;font-size:1.05rem', text: '📅 Today’s learning — ' + dmy(new Date().toISOString()) }));
    card.appendChild(el('p', { style: 'margin:0;color:#64748b;font-size:.88rem', text: 'Pick the topics you read today (tick them, or choose “from topic … to …”). The quiz asks questions only from those topics, plus a few fresh calculation questions.' }));
    var from = el('select', { class: 'en-in', id: 'en-from' }, E.topics.map(function (t) { return el('option', { value: String(t.n), text: t.n + '. ' + t.title }); }));
    var to = el('select', { class: 'en-in', id: 'en-to' }, E.topics.map(function (t) { return el('option', { value: String(t.n), text: t.n + '. ' + t.title }); }));
    to.value = String(Math.min(3, E.topics.length));
    var pick = el('div', { class: 'en-pick', id: 'en-pick' });
    function drawPick() {
      clear(pick);
      E.topics.forEach(function (t) {
        var cb = el('input', { type: 'checkbox', value: t.id, checked: sel[t.id] ? true : null });
        cb.onchange = function () { if (cb.checked) sel[t.id] = true; else delete sel[t.id]; drawPick(); };
        pick.appendChild(el('label', { class: sel[t.id] ? 'on' : '', 'data-pick': t.id }, [cb, t.icon + ' ' + t.n + '. ' + t.title, S.mine.read[t.id] ? el('span', { style: 'margin-left:auto;color:#16a34a;font-weight:700', text: '✓' }) : null]));
      });
    }
    drawPick();
    card.appendChild(el('div', { style: 'display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.7rem' }, ['I read from', from, 'to', to,
      el('button', { type: 'button', class: 'en-btn', id: 'en-range', text: 'Select', onclick: function () { var a = +from.value, b = +to.value; if (a > b) { var x = a; a = b; b = x; } sel = {}; E.topics.forEach(function (t) { if (t.n >= a && t.n <= b) sel[t.id] = true; }); drawPick(); } })]));
    card.appendChild(pick);
    var count = el('select', { class: 'en-in', id: 'en-count' }, [5, 10, 15, 20].map(function (n) { return el('option', { value: String(n), text: n + ' questions' }); }));
    count.value = '10';
    card.appendChild(el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center' }, [
      el('button', { type: 'button', class: 'en-btn', id: 'en-save-plan', text: '💾 Save as today’s plan', onclick: function () {
        api('POST', '/learn/plan', { topics: Object.keys(sel) }).then(function (j) { S.mine.plan = j.data.plan; toast(j.message); }).catch(function (e) { toast(e.message, true); });
      } }), count,
      el('button', { type: 'button', class: 'en-btn pri', id: 'en-start', text: '🎯 Start quiz', onclick: function () {
        var ids = Object.keys(sel); if (!ids.length) { toast('Tick at least one topic.', true); return; }
        startQuiz(ids, +count.value);
      } })]));
    body.appendChild(card);
    quizBox = el('div', { id: 'en-quiz' });
    body.appendChild(quizBox);
    var hist = el('div', { class: 'en-card', id: 'en-history' }, [el('h3', { style: 'margin:0 0 .5rem;font-size:1rem', text: '📈 My quiz history' })]);
    var qz = S.mine.quizzes || [];
    if (!qz.length) hist.appendChild(el('p', { style: 'color:#64748b;font-size:.88rem', text: 'No quizzes yet — take your first one above.' }));
    else hist.appendChild(el('div', { class: 'en-tw' }, [el('table', { class: 'en-t' }, [el('thead', {}, [el('tr', {}, ['When', 'Topics', 'Score'].map(function (h) { return el('th', { text: h }); }))]),
      el('tbody', {}, qz.map(function (x) { var pc = Math.round(x.correct / x.total * 100); return el('tr', {}, [el('td', { text: when(x.at) }), el('td', { text: x.topics.map(function (id) { var t = topic(id); return t ? t.n + '. ' + t.title : id; }).join(', ') }),
        el('td', {}, [el('b', { style: 'color:' + (pc >= 80 ? '#16a34a' : pc >= 50 ? '#ca8a04' : '#dc2626'), text: x.correct + ' / ' + x.total + ' (' + pc + '%)' })])]); }))])]));
    body.appendChild(hist);
  }
  function startQuiz(ids, n) {
    if (!quizBox) return;
    var qs = makeQuiz(ids, n), picked = {};
    clear(quizBox);
    var card = el('div', { class: 'en-card', id: 'en-quiz-card' }, [el('h3', { style: 'margin:0 0 .6rem;font-size:1.05rem', text: '🎯 Quiz — ' + qs.length + ' questions on ' + ids.map(function (id) { var t = topic(id); return t ? t.title : id; }).join(', ') })]);
    qs.forEach(function (q, i) {
      var d = el('div', { class: 'en-q', 'data-q': String(i) }, [el('span', { class: 'tg', text: q.gen ? '🧮 calculated' : (topic(q.topic) || {}).title || '' }), el('b', { text: (i + 1) + '. ' + q.q })]);
      q.o.forEach(function (o, k) {
        var r = el('input', { type: 'radio', name: 'q' + i, value: String(k) });
        r.onchange = function () { picked[i] = k; };
        d.appendChild(el('label', {}, [r, o]));
      });
      card.appendChild(d);
    });
    var submit = el('button', { type: 'button', class: 'en-btn pri', id: 'en-submit', text: 'Submit answers', onclick: function () {
      var miss = qs.filter(function (_, i) { return picked[i] == null; }).length;
      if (miss && !confirm(miss + ' question' + (miss > 1 ? 's are' : ' is') + ' not answered. Submit anyway?')) return;
      var right = 0, answers = [];
      qs.forEach(function (q, i) {
        var d = card.querySelector('[data-q="' + i + '"]'), labels = d.querySelectorAll('label');
        d.querySelectorAll('input').forEach(function (x) { x.disabled = true; });
        labels[q.a].classList.add('right');
        if (picked[i] === q.a) right++; else if (picked[i] != null) labels[picked[i]].classList.add('wrong');
        d.appendChild(el('div', { class: 'ex', text: (picked[i] === q.a ? '✅ ' : '❌ ') + q.e }));
        answers.push({ q: q.q.slice(0, 160), ok: picked[i] === q.a });
      });
      submit.remove();
      var pc = Math.round(right / qs.length * 100);
      card.insertBefore(el('div', { class: 'en-score', id: 'en-score' }, [el('div', { class: 'big', text: right + ' / ' + qs.length }),
        el('div', { text: pc >= 80 ? '🏆 Excellent!' : pc >= 50 ? '👍 Good — read the explanations below.' : '📖 Read the topic again and retry.' })]), card.children[1]);
      api('POST', '/learn/quiz', { topics: ids, total: qs.length, correct: right, answers: answers }).then(function (j) { S.mine.streak = j.data.streak; loadMine(); toast(j.message); }).catch(function (e) { toast(e.message, true); });
      card.appendChild(el('div', { class: 'en-acts' }, [el('button', { type: 'button', class: 'en-btn pri', text: '🔁 New quiz on the same topics', onclick: function () { startQuiz(ids, n); } })]));
      card.scrollIntoView({ behavior: 'smooth' });
    } });
    card.appendChild(submit);
    quizBox.appendChild(card);
    setTimeout(function () { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }

  // ── 📰 News & prices ──
  function spark(h) {
    if (!h || h.length < 2) return '';
    var v = h.map(function (x) { return x.price; }), mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), w = 90, ht = 24;
    return '<svg width="' + w + '" height="' + ht + '" viewBox="0 0 ' + w + ' ' + ht + '"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="' +
      v.map(function (p, i) { return (i * w / (v.length - 1)).toFixed(1) + ',' + (mx === mn ? ht / 2 : ht - 2 - (p - mn) / (mx - mn) * (ht - 4)).toFixed(1); }).join(' ') + '"/></svg>';
  }
  function newsView() {
    clear(body);
    var grid = el('div', { class: 'en-grid2' }), pc = el('div', { class: 'en-card en-prices', id: 'en-prices' }, [el('p', { text: 'Loading…' })]), nc = el('div', { class: 'en-card en-news', id: 'en-news' });
    grid.appendChild(pc); grid.appendChild(nc); body.appendChild(grid);
    var adminBox = el('div', { id: 'en-market-admin' }); body.appendChild(adminBox);
    function draw(d) {
      clear(pc);
      pc.appendChild(el('h3', { style: 'margin:0 0 .2rem;font-size:1.05rem', text: '💹 Carbide & raw material prices' }));
      pc.appendChild(el('p', { style: 'margin:0 0 .6rem;color:#64748b;font-size:.8rem', text: 'Each price shows its date. Updated after midnight' + (d.lastRefresh ? ' — last update ' + when(d.lastRefresh) : '') + '.' }));
      pc.appendChild(el('div', { class: 'en-tw' }, [el('table', { class: 'en-t' }, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Item' }), el('th', { class: 'r', text: 'Price' }), el('th', { class: 'r', text: 'Change' }), el('th', { text: '30 days' }), el('th', { text: 'Date' })])]),
        el('tbody', {}, d.items.map(function (it) {
          var L = it.latest, P = it.previous, ch = L && P ? (L.price - P.price) / P.price * 100 : null;
          return el('tr', { 'data-price': it.key }, [el('td', {}, [el('b', { text: it.label }), el('div', { style: 'font-size:.72rem;color:#64748b', text: it.unit + (it.auto ? ' · automatic' : '') })]),
            el('td', { class: 'r', text: L ? Number(L.price).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—' }),
            el('td', { class: 'r ' + (ch > 0 ? 'en-up' : ch < 0 ? 'en-down' : ''), text: ch == null ? '' : (ch > 0 ? '▲ ' : ch < 0 ? '▼ ' : '') + Math.abs(ch).toFixed(1) + '%' }),
            el('td', { html: spark(it.history), style: 'color:var(--crm-p,#1e3a5f)' }), el('td', { style: 'font-size:.78rem;color:#64748b;white-space:nowrap', text: L ? dmy(L.date) : 'not entered' })]);
        }))])]));
      clear(nc);
      nc.appendChild(el('h3', { style: 'margin:0 0 .4rem;font-size:1.05rem', text: '📰 Technical news' }));
      if (!d.news.length) nc.appendChild(el('p', { style: 'color:#64748b;font-size:.88rem', text: 'No news yet — it is fetched every night after 12:00.' }));
      d.news.forEach(function (n) { nc.appendChild(el('a', { href: n.link, target: '_blank', rel: 'noopener', 'data-news': '1' }, [el('b', { text: n.title }), el('small', { text: (n.source || '') + ' · ' + when(n.publishedAt) + (n.topic ? ' · ' + n.topic : '') })])); });
      clear(adminBox);
      if (d.canEdit) adminBox.appendChild(priceForm(d));
    }
    function load() { return api('GET', '/learn/market').then(function (j) { draw(j.data); return j.data; }).catch(function (e) { clear(pc).appendChild(el('p', { text: e.message })); }); }
    load().then(function () {   // first visit after midnight: fetch today's news + rate in the background
      api('POST', '/learn/refresh-due').then(function (j) { if (j.data.refreshed) load(); }).catch(function () {});
    });
    function priceForm(d) {
      var card = el('div', { class: 'en-card', id: 'en-price-form' }, [el('h3', { style: 'margin:0 0 .3rem;font-size:1rem', text: '✎ Enter today’s prices (Admin)' }),
        el('p', { style: 'margin:0 0 .6rem;color:#64748b;font-size:.82rem', text: 'Carbide, tungsten and metal prices have no free public feed — type them in from your supplier or market report. The dollar rate is fetched automatically.' })]);
      var date = el('input', { type: 'date', class: 'en-in', id: 'en-price-date', value: new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10) });
      var grid = el('div', { class: 'en-pick' });
      d.items.forEach(function (it) { grid.appendChild(el('label', {}, [el('span', { style: 'flex:1', text: it.label + ' (' + it.unit + ')' }), el('input', { type: 'number', step: 'any', class: 'en-in', style: 'width:7rem', 'data-item': it.key, placeholder: it.latest ? String(it.latest.price) : '' })])); });
      card.appendChild(el('div', { style: 'display:flex;gap:.5rem;align-items:center;margin-bottom:.4rem' }, ['Price date', date]));
      card.appendChild(grid);
      card.appendChild(el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' }, [
        el('button', { type: 'button', class: 'en-btn pri', id: 'en-save-prices', text: 'Save prices', onclick: function () {
          var prices = Array.prototype.map.call(grid.querySelectorAll('[data-item]'), function (x) { return { item: x.getAttribute('data-item'), price: x.value, date: date.value }; }).filter(function (p) { return p.price !== ''; });
          api('PUT', '/learn/prices', { prices: prices }).then(function (j) { toast(j.message); load(); }).catch(function (e) { toast(e.message, true); });
        } }),
        el('button', { type: 'button', class: 'en-btn', id: 'en-refresh-now', text: '⟳ Fetch news now', onclick: function () { api('GET', '/learn/cron').then(function (j) { toast('Fetched ' + j.data.added + ' new articles' + (j.data.failed.length ? ' (could not reach: ' + j.data.failed.join(', ') + ')' : '')); load(); }).catch(function (e) { toast(e.message, true); }); } }),
        el('button', { type: 'button', class: 'en-btn', id: 'en-cron', text: '⏰ Midnight update link', onclick: function () { api('GET', '/learn/cron-key').then(function (j) { prompt('Add this address as a daily cron job at 00:00 in your hosting panel (e.g. wget -q -O - "…"):', API + '/api/learn/cron?key=' + j.data.key); }).catch(function (e) { toast(e.message, true); }); } })]));
      // news sources
      var fs = el('textarea', { class: 'en-in', id: 'en-feeds', style: 'width:100%;min-height:70px;margin-top:.8rem;font-family:monospace;font-size:.78rem', placeholder: 'topic | https://… RSS address (one per line). Leave empty for the built-in Google News searches.' });
      fs.value = Object.keys(d.feeds || {}).map(function (k) { return k + ' | ' + d.feeds[k]; }).join('\n');
      card.appendChild(el('p', { style: 'margin:.9rem 0 0;font-weight:700;font-size:.85rem', text: 'News sources (RSS)' }));
      card.appendChild(fs);
      card.appendChild(el('button', { type: 'button', class: 'en-btn', id: 'en-save-feeds', style: 'margin-top:.4rem', text: 'Save news sources', onclick: function () {
        var feeds = fs.value.split('\n').map(function (l) { var p = l.split('|'); return { topic: (p[0] || '').trim(), url: (p.slice(1).join('|') || '').trim() }; }).filter(function (f) { return f.topic && f.url; });
        api('PUT', '/learn/feeds', { feeds: feeds }).then(function (j) { toast(j.message); }).catch(function (e) { toast(e.message, true); });
      } }));
      return card;
    }
  }

  // ── 👥 Team ──
  function teamView() {
    clear(body);
    var card = el('div', { class: 'en-card', id: 'en-team' }, [el('p', { text: 'Loading…' })]);
    body.appendChild(card);
    api('GET', '/learn/team').then(function (j) {
      clear(card);
      card.appendChild(el('h3', { style: 'margin:0 0 .5rem;font-size:1.05rem', text: '👥 Team learning — last 30 days' }));
      card.appendChild(el('div', { class: 'en-tw' }, [el('table', { class: 'en-t' }, [el('thead', {}, [el('tr', {}, ['Engineer', 'Topics read', 'Quizzes (30 days)', 'Average score', 'Streak', 'Last quiz'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, j.data.team.map(function (r) {
          return el('tr', { 'data-team': r.user.id }, [el('td', {}, [el('b', { text: r.user.name }), el('div', { style: 'font-size:.72rem;color:#64748b', text: String(r.user.role || '').replace(/_/g, ' ').toLowerCase() })]),
            el('td', { text: r.topicsRead + ' / ' + E.topics.length }), el('td', { text: String(r.quizzes30) }),
            el('td', {}, [r.avg30 == null ? '—' : el('b', { style: 'color:' + (r.avg30 >= 80 ? '#16a34a' : r.avg30 >= 50 ? '#ca8a04' : '#dc2626'), text: r.avg30 + '%' })]),
            el('td', { text: r.streak ? '🔥 ' + r.streak : '—' }), el('td', { text: r.lastQuiz ? when(r.lastQuiz) : 'never' })]);
        }))])]));
    }).catch(function (e) { clear(card).appendChild(el('p', { text: e.message })); });
  }

  function render() {
    document.querySelectorAll('.en-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-en-tab') === S.tab); });
    try { history.replaceState(null, '', '#' + S.tab + (S.tab === 'learn' ? '-' + S.topic : '')); } catch (e) {}
    if (S.tab === 'learn') learnView(); else if (S.tab === 'quiz') quizView(); else if (S.tab === 'news') newsView(); else teamView();
  }
  function mountPage(content) {
    css();
    var h = location.hash.slice(1);
    if (/^learn-/.test(h) && topic(h.slice(6))) { S.tab = 'learn'; S.topic = h.slice(6); } else if (['quiz', 'news', 'team'].indexOf(h) !== -1) S.tab = h;
    var wrap = el('div', { class: 'en-wrap' });
    headPills = el('div', { class: 'en-streak' });
    wrap.appendChild(el('div', { class: 'en-head' }, [el('div', {}, [el('h1', { text: '📘 Engineer notes' }),
      el('p', { text: 'Cutting tools step by step with pictures — read a little every day, take the quiz, and keep up with the news and carbide prices.' })]), headPills]));
    var tabs = [['learn', '📚 Learn'], ['quiz', '🎯 Today & quiz'], ['news', '📰 News & prices']];
    if (admin) tabs.push(['team', '👥 Team']);
    wrap.appendChild(el('div', { class: 'en-tabs' }, tabs.map(function (t) { return el('button', { type: 'button', class: 'en-tab', 'data-en-tab': t[0], text: t[1], onclick: function () { S.tab = t[0]; render(); } }); })));
    body = el('div', { id: 'en-body' });
    wrap.appendChild(body);
    content.appendChild(wrap);
    drawPills();
    loadMine().then(render);
    render();
  }
  window.EngineerNotesPage = { mountPage: mountPage };
})();
