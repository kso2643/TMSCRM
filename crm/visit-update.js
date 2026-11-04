/* visit-update.js — on the visit / check-in page (/meetings/checkin/?meetingId=…, compiled React page).
 *
 * After punching in and starting the visit, the engineer records the visit update here:
 *   - Joint visit? No — alone / Yes — joint visit, with the colleagues who came (ticked) and anyone
 *     else (e.g. a supplier's rep), and
 *   - what happened (summary).
 * Saved on the meeting (PUT /api/meetings/:id { jointVisit, jointWith, jointOthers, summary }) — it
 * then shows on the meeting card, the customer's latest updates and the engineer performance report.
 */
(function () {
  'use strict';
  if (window.__visitUpdate) return;
  window.__visitUpdate = true;
  var API = 'https://api.apjtech.in';
  function onPage() { return /^\/meetings\/checkin\/?$/.test(location.pathname); }
  function mid() { try { return new URLSearchParams(location.search).get('meetingId') || ''; } catch (e) { return ''; } }
  function token() { try { return localStorage.getItem('crm_token') || ''; } catch (e) { return ''; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(method, path, body) {
    return fetch(API + '/api' + path, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) throw new Error(j.message || 'Request failed (' + r.status + ')'); return j; }); });
  }

  function css() {
    if (document.getElementById('vu-css')) return;
    var st = document.createElement('style'); st.id = 'vu-css';
    st.textContent = [
      '#vu-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-top:16px;box-shadow:0 1px 2px rgba(15,23,42,.05)}',
      '#vu-card h3{margin:0 0 10px;font-size:1rem;font-weight:700;color:#0f172a}',
      '#vu-card .vu-l{display:block;font-size:.75rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.03em;margin:10px 0 5px}',
      '#vu-card .vu-yn{display:flex;gap:6px}',
      '#vu-card .vu-yn button{flex:1;border:1px solid #cbd5e1;background:#fff;border-radius:9px;padding:10px;font-weight:600;font-size:.88rem;color:#0f172a;cursor:pointer}',
      '#vu-card .vu-yn button.on{background:#1e3a8a;border-color:#1e3a8a;color:#fff}',
      '#vu-card .vu-ppl{display:flex;flex-wrap:wrap;gap:6px}',
      '#vu-card .vu-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid #cbd5e1;border-radius:999px;padding:6px 11px;font-size:.82rem;font-weight:600;cursor:pointer;background:#fff;color:#0f172a}',
      '#vu-card .vu-chip.on{background:#eff6ff;border-color:#1d4ed8;color:#1e3a8a}',
      '#vu-card input[type=text],#vu-card textarea{width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:9px 11px;font:inherit;font-size:.9rem;background:#fff;color:#0f172a;box-sizing:border-box}',
      '#vu-card textarea{min-height:80px;resize:vertical}',
      '#vu-card .vu-save{margin-top:12px;width:100%;border:0;border-radius:10px;background:#1e3a8a;color:#fff;font-weight:700;padding:12px;font-size:.95rem;cursor:pointer}',
      '#vu-card .vu-save:disabled{opacity:.6}',
      '#vu-card .vu-msg{margin-top:8px;font-size:.85rem}',
      '.dark #vu-card{background:#1e293b;border-color:#334155}.dark #vu-card h3{color:#e2e8f0}',
      '.dark #vu-card .vu-yn button,.dark #vu-card .vu-chip,.dark #vu-card input[type=text],.dark #vu-card textarea{background:#0f172a;border-color:#334155;color:#e2e8f0}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var people = null, meeting = null, built = false;
  function loadPeople() {
    if (people) return Promise.resolve(people);
    return api('GET', '/users?limit=200').then(function (j) { return (j.data && j.data.items) || []; })
      .catch(function () { return api('GET', '/md-desk/recipients').then(function (j) { return (j.data && (j.data.allUsers || j.data.users)) || []; }); })
      .then(function (l) { var my = me().id; people = l.filter(function (u) { return u.id !== my && u.isActive !== false && u.isActive !== 0; }); return people; })
      .catch(function () { people = []; return people; });
  }

  function build(host) {
    built = true; css();
    var card = document.createElement('section'); card.id = 'vu-card'; card.setAttribute('aria-label', 'Visit update');
    card.innerHTML = '<h3>📝 Visit update</h3><div class="vu-msg">Loading…</div>';
    host.appendChild(card);
    Promise.all([api('GET', '/meetings/' + encodeURIComponent(mid())), loadPeople()]).then(function (r) {
      meeting = r[0].data.meeting || r[0].data;
      var on = !!meeting.jointVisit, sel = {};
      (meeting.jointWith || []).forEach(function (u) { sel[u.id] = true; });
      card.innerHTML = '<h3>📝 Visit update</h3>' +
        '<span class="vu-l">Joint visit?</span><div class="vu-yn"><button type="button" data-vu-joint="0" class="' + (on ? '' : 'on') + '">No — alone</button><button type="button" data-vu-joint="1" class="' + (on ? 'on' : '') + '">Yes — joint visit</button></div>' +
        '<div id="vu-joint"' + (on ? '' : ' hidden') + '><span class="vu-l">Went with</span><div class="vu-ppl">' + people.map(function (u) {
          return '<label class="vu-chip' + (sel[u.id] ? ' on' : '') + '"><input type="checkbox" value="' + esc(u.id) + '"' + (sel[u.id] ? ' checked' : '') + ' style="margin:0">' + esc(u.name) + '</label>';
        }).join('') + '</div><span class="vu-l">Others (optional)</span><input type="text" id="vu-others" placeholder="e.g. Sandvik rep Mr. Kumar" value="' + esc(meeting.jointOthers || '') + '"></div>' +
        '<span class="vu-l">What happened</span><textarea id="vu-summary" placeholder="Discussion, requirements, next step…">' + esc(meeting.summary || '') + '</textarea>' +
        '<button type="button" class="vu-save" id="vu-save">Save visit update</button><div class="vu-msg" id="vu-msg"></div>';
      card.querySelectorAll('[data-vu-joint]').forEach(function (b) {
        b.onclick = function () { card.querySelectorAll('[data-vu-joint]').forEach(function (x) { x.classList.toggle('on', x === b); }); card.querySelector('#vu-joint').hidden = b.getAttribute('data-vu-joint') !== '1'; };
      });
      card.querySelector('.vu-ppl').addEventListener('change', function (e) { if (e.target.type === 'checkbox') e.target.parentNode.classList.toggle('on', e.target.checked); });
      card.querySelector('#vu-save').onclick = function () {
        var joint = !!card.querySelector('[data-vu-joint="1"].on');
        var withIds = Array.prototype.map.call(card.querySelectorAll('.vu-ppl input:checked'), function (i) { return i.value; });
        var others = card.querySelector('#vu-others').value.trim(), msg = card.querySelector('#vu-msg'), btn = this;
        if (joint && !withIds.length && !others) { msg.style.color = '#b91c1c'; msg.textContent = 'Tick who went with you, or type the others.'; return; }
        var body = { jointVisit: joint, jointWith: joint ? withIds : [], jointOthers: joint ? others : '' };
        var sum = card.querySelector('#vu-summary').value.trim();
        if (sum) body.summary = sum;
        btn.disabled = true; btn.textContent = 'Saving…';
        api('PUT', '/meetings/' + encodeURIComponent(mid()), body).then(function () {
          msg.style.color = '#15803d'; msg.textContent = '✓ Saved' + (joint ? ' — joint visit with ' + (withIds.length + (others ? 1 : 0)) + ' ' + ((withIds.length + (others ? 1 : 0)) === 1 ? 'person' : 'people') : ' — visited alone') + '.';
        }).catch(function (e) { msg.style.color = '#b91c1c'; msg.textContent = e.message; })
          .then(function () { btn.disabled = false; btn.textContent = 'Save visit update'; });
      };
    }).catch(function (e) { card.innerHTML = '<h3>📝 Visit update</h3><div class="vu-msg" style="color:#b91c1c">' + esc(e.message) + '</div>'; });
  }

  function ensure() {
    if (!onPage() || !mid()) return;
    if (document.getElementById('vu-card')) return;
    var h1 = Array.prototype.filter.call(document.querySelectorAll('h1'), function (h) { return /Customer Check-in/i.test(h.textContent || ''); })[0];
    if (!h1) return;
    var host = h1, step = document.querySelector('h2');
    while (host.parentElement && !(step && host.contains(step))) host = host.parentElement;   // the page column holding the cards
    if (host === document.body) return;
    if (built && document.getElementById('vu-card')) return;
    build(host);
  }
  var mo = new MutationObserver(function () { if (!document.getElementById('vu-card')) { built = false; ensure(); } });
  function start() { ensure(); mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
