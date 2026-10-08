/* ══════════════════════════════════════════════════════════════════════
   Attendance — punch in with a photo and your location.

   Punch-in times (India time):
     · until 9:30          on time
     · 9:30 – 9:45         grace time (marked late)
     · after 9:45          punch-in is locked. Write the reason and send a
                           request; once a Manager / Admin approves it the
                           Punch in button opens again for that day.
   Manager / Admin / Super Admin see the requests on this page and release
   them. The "All employees" register (attendance-all-app.js) attaches to
   the "Attendance history" card for admins.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  var isAdminTier = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(me().role) !== -1;
  function api(method, path, body) {
    return fetch(API + '/api' + path, {
      method: method, headers: { Authorization: 'Bearer ' + (token() || ''), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) location.href = '/login/';
        if (!r.ok || j.success === false) throw new Error((j && j.message) || 'Request failed (' + r.status + ')');
        return j;
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
      else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function dmy(s) { var d = new Date(String(s || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }); }
  function hm(s) { var m = /(\d{2}):(\d{2})/.exec(String(s || '').slice(11)); if (!m) return '—'; var h = +m[1]; return (h % 12 || 12) + ':' + m[2] + (h < 12 ? ' AM' : ' PM'); }
  function ampm(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return t; var h = +m[1]; return (h % 12 || 12) + ':' + m[2] + (h < 12 ? ' AM' : ' PM'); }
  function hrs(h) { h = Number(h) || 0; var m = Math.round(h * 60); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; }
  function toast(msg, kind) {
    document.querySelectorAll('.at-toast').forEach(function (o) { o.remove(); });
    var t = el('div', { class: 'at-toast ' + (kind || 'ok'), role: 'status', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.remove(); }, 4200);
  }

  function injectCss() {
    if (document.getElementById('at-css')) return;
    var st = document.createElement('style'); st.id = 'at-css';
    st.textContent = [
      '.at-wrap{max-width:1100px;margin:0 auto}',
      '.at-head h1{font-size:1.35rem;font-weight:700;margin:0}.at-head p{margin:.15rem 0 1rem;color:#64748b;font-size:.85rem}',
      '.at-card{background:#fff;border:1px solid #e2e8f0;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.dark .at-card{background:#1e293b;border-color:#334155}',
      '.at-card h2{font-size:1rem;font-weight:700;margin:0 0 .75rem}',
      '.at-punch{display:grid;grid-template-columns:minmax(0,320px) 1fr;gap:1rem;align-items:start}@media (max-width:760px){.at-punch{grid-template-columns:1fr}}',
      '.at-cam{position:relative;background:#0f172a;border-radius:.75rem;overflow:hidden;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:.85rem;text-align:center}',
      '.at-cam video,.at-cam img{width:100%;height:100%;object-fit:cover}.at-cam video{transform:scaleX(-1)}',
      '.at-row{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.6rem}',
      '.at-btn{display:inline-flex;align-items:center;gap:.4rem;border-radius:.55rem;padding:.55rem 1rem;font-size:.88rem;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}',
      '.at-btn:hover{background:#f1f5f9}.at-btn:disabled{opacity:.5;cursor:not-allowed}.at-btn.sm{padding:.3rem .65rem;font-size:.78rem}',
      '.at-btn.pri{background:#0f766e;border-color:#0f766e;color:#fff}.at-btn.pri:hover{background:#115e59}',
      '.at-btn.out{background:#1e3a8a;border-color:#1e3a8a;color:#fff}.at-btn.red{color:#b91c1c;border-color:#fecaca}',
      '.dark .at-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}.dark .at-btn.pri{background:#0d9488}.dark .at-btn.out{background:#2563eb}',
      '.at-clock{font-size:2rem;font-weight:700;letter-spacing:.02em}.at-sub{color:#64748b;font-size:.85rem}',
      '.at-win{display:flex;gap:.35rem;margin:.6rem 0}.at-win span{flex:1;padding:.4rem .5rem;border-radius:.5rem;font-size:.75rem;font-weight:600;background:#f1f5f9;color:#475569;text-align:center}',
      '.at-win span.on{outline:2px solid currentColor}.at-win .w1{background:#dcfce7;color:#166534}.at-win .w2{background:#fef3c7;color:#92400e}.at-win .w3{background:#fee2e2;color:#991b1b}',
      '.at-msg{padding:.6rem .8rem;border-radius:.6rem;font-size:.85rem;margin:.5rem 0}.at-msg.ok{background:#f0fdf4;color:#166534}.at-msg.warn{background:#fffbeb;color:#92400e}.at-msg.bad{background:#fef2f2;color:#991b1b}.at-msg.info{background:#eff6ff;color:#1e40af}',
      '.at-f label{display:block;font-size:.75rem;font-weight:600;color:#475569;margin:.5rem 0 .25rem}',
      '.at-f textarea,.at-f input,.at-f select{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .6rem;font-size:.88rem;background:#fff;color:inherit}.dark .at-f textarea,.dark .at-f input{background:#0f172a;border-color:#334155}',
      '.at-table{width:100%;border-collapse:collapse;font-size:.85rem}.at-tw{overflow-x:auto}',
      '.at-table th{text-align:left;font-size:.72rem;text-transform:uppercase;color:#64748b;padding:.5rem;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
      '.at-table td{padding:.55rem .5rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}.dark .at-table th,.dark .at-table td{border-color:#334155}',
      '.at-badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.74rem;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent)}',
      '.at-thumb{width:38px;height:38px;border-radius:.4rem;object-fit:cover;cursor:pointer;background:#e2e8f0}',
      '.at-empty{padding:1.5rem;text-align:center;color:#64748b;font-size:.9rem}',
      '.at-modal{position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:2147483500;display:flex;align-items:center;justify-content:center;padding:1rem}.at-modal img{max-width:100%;max-height:90vh;border-radius:.6rem}',
      '.at-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);opacity:0;z-index:2147483600;background:#0f766e;color:#fff;padding:.65rem 1rem;border-radius:.6rem;font-size:.85rem;transition:opacity .25s,transform .25s}',
      '.at-toast.in{opacity:1;transform:translate(-50%,0)}.at-toast.err{background:#b91c1c}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── location ─────────────────────────────────────────────────────────
  function getLocation() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'));
      function fail(e) {
        var er = new Error(e && e.code === 1 ? 'Location permission is blocked. Allow this site to use your location and try again.'
          : 'Could not get your location. Turn on GPS and try again.');
        er.geo = { code: e && e.code };
        reject(er);
      }
      navigator.geolocation.getCurrentPosition(function (p) { resolve(p.coords); }, function (e) {
        if (e && e.code === 1) return fail(e);
        navigator.geolocation.getCurrentPosition(function (p) { resolve(p.coords); }, fail, { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 });
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }

  // ── photo: camera preview, or the phone camera via a file input ──────
  function shrink(src) {
    var c = document.createElement('canvas'), w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    var k = Math.min(1, 720 / Math.max(w, h)); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }

  var state = { record: null, win: null, photo: null, stream: null, month: new Date().getMonth() + 1, year: new Date().getFullYear(), busy: false };
  var root, punchBox, reqBox, histBox, adminBox, timer;

  function stopCam() { if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; } }

  function photoPanel() {
    var cam = el('div', { class: 'at-cam', id: 'at-cam' });
    var file = el('input', { type: 'file', accept: 'image/*', capture: 'user', id: 'at-photo-file', style: 'display:none' });
    var shoot = el('button', { class: 'at-btn', type: 'button', id: 'at-snap' });
    function idle() {
      clear(cam);
      if (state.photo) { cam.appendChild(el('img', { src: state.photo, alt: 'Your photo' })); shoot.textContent = '↺ Retake photo'; }
      else { cam.appendChild(el('div', { text: 'Photo needed to punch in' })); shoot.textContent = '📷 Take photo'; }
    }
    function live() {
      clear(cam);
      var v = el('video', { autoplay: true, playsinline: true, muted: true }); v.muted = true;
      v.srcObject = state.stream; cam.appendChild(v); v.play().catch(function () {});
      shoot.textContent = '● Capture';
      shoot.onclick = function () {
        if (!v.videoWidth) return;
        state.photo = shrink(v); stopCam(); idle(); shoot.onclick = start; render();
      };
    }
    function start() {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: false })
          .then(function (s) { state.stream = s; live(); })
          .catch(function () { file.click(); });
      } else file.click();
    }
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      var img = new Image();
      img.onload = function () { state.photo = shrink(img); URL.revokeObjectURL(img.src); file.value = ''; idle(); render(); };
      img.src = URL.createObjectURL(f);
    });
    shoot.onclick = start;
    idle();
    return el('div', {}, [cam, el('div', { class: 'at-row' }, [shoot, file])]);
  }

  function render() {
    var w = state.win || {}, r = state.record;
    clear(punchBox);
    var now = String(w.now || '').slice(0, 5);
    var right = el('div', {});
    right.appendChild(el('div', { class: 'at-sub', text: new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }));
    right.appendChild(el('div', { class: 'at-clock', id: 'at-clock', text: now ? ampm(now) : '' }));
    right.appendChild(el('div', { class: 'at-win' }, [
      el('span', { class: 'w1' + (w.phase === 'ON_TIME' ? ' on' : ''), text: 'On time · till ' + ampm(w.onTimeUntil || '09:30') }),
      el('span', { class: 'w2' + (w.phase === 'GRACE' ? ' on' : ''), text: 'Grace · till ' + ampm(w.graceUntil || '09:45') }),
      el('span', { class: 'w3' + (w.phase === 'LOCKED' ? ' on' : ''), text: 'Locked · needs approval' })
    ]));

    if (r && r.checkIn) {
      right.appendChild(el('div', { class: 'at-msg ok', id: 'at-status' }, [
        'Punched in at ' + hm(r.checkIn) + (r.lateMinutes ? ' (' + r.lateMinutes + ' min late)' : ' — on time') +
        (r.checkOut ? ' · punched out at ' + hm(r.checkOut) + ' · ' + hrs(r.workingHours) : '')
      ]));
      if (!r.checkOut) {
        right.appendChild(el('div', { class: 'at-row' }, [el('button', { class: 'at-btn out', type: 'button', id: 'at-out', onclick: punchOut, text: 'Punch out' })]));
      }
      punchBox.appendChild(el('div', { class: 'at-punch' }, [r.checkInPhoto ? photoThumbBig(r) : el('div', {}), right]));
      renderRequest();
      return;
    }

    var req = w.request, can = !!w.canPunchIn;
    if (w.phase === 'GRACE') right.appendChild(el('div', { class: 'at-msg warn', text: 'Grace time — punch in before ' + ampm(w.graceUntil) + '. It will be marked late.' }));
    if (w.phase === 'LOCKED' && !can) right.appendChild(el('div', { class: 'at-msg bad', id: 'at-locked', text: 'Punch-in closed at ' + ampm(w.graceUntil) + '. Send the reason below — the punch-in opens once an admin approves it.' }));
    if (w.phase === 'LOCKED' && can) right.appendChild(el('div', { class: 'at-msg ok', text: 'Your request was approved' + (req && req.decidedByName ? ' by ' + req.decidedByName : '') + ' — you can punch in now.' }));
    right.appendChild(el('div', { class: 'at-sub', text: (state.photo ? '✓ Photo taken' : '✗ Photo not taken yet') + ' · location is taken when you punch in' }));
    var btn = el('button', { class: 'at-btn pri', type: 'button', id: 'at-in', disabled: !can || !state.photo || state.busy, onclick: punchIn, text: state.busy ? 'Punching in…' : 'Punch in' });
    right.appendChild(el('div', { class: 'at-row' }, [btn]));
    punchBox.appendChild(el('div', { class: 'at-punch' }, [can ? photoPanel() : el('div', { class: 'at-cam', text: '🔒 Punch-in locked' }), right]));
    renderRequest();
  }

  function photoThumbBig(r) {
    var box = el('div', { class: 'at-cam' }, [el('div', { text: 'Loading photo…' })]);
    loadPhoto(r.id).then(function (u) { clear(box).appendChild(el('img', { src: u, alt: 'Punch-in photo' })); }).catch(function () { clear(box).appendChild(el('div', { text: 'Photo not available' })); });
    return box;
  }

  // Late punch-in request (after the grace time)
  function renderRequest() {
    clear(reqBox);
    var w = state.win || {}, req = w.request;
    if (state.record || w.phase !== 'LOCKED') { reqBox.style.display = 'none'; return; }
    reqBox.style.display = '';
    reqBox.appendChild(el('h2', { text: 'Request to punch in late' }));
    if (req && req.status === 'PENDING') {
      reqBox.appendChild(el('div', { class: 'at-msg info', id: 'at-req-status', text: 'Request sent at ' + hm(req.createdAt) + ' — waiting for admin approval. Reason: ' + req.reason }));
      return;
    }
    if (req && req.status === 'APPROVED') { reqBox.appendChild(el('div', { class: 'at-msg ok', id: 'at-req-status', text: 'Approved — punch in above.' })); return; }
    if (req && req.status === 'REJECTED') reqBox.appendChild(el('div', { class: 'at-msg bad', id: 'at-req-status', text: 'Your request was rejected' + (req.adminNote ? ': ' + req.adminNote : '') + '. You can send a new one.' }));
    var ta = el('textarea', { id: 'at-reason', rows: 3, placeholder: 'Why are you late? (e.g. traffic on the highway, customer visit on the way)' });
    var send = el('button', { class: 'at-btn pri', type: 'button', id: 'at-req-send', text: 'Send request' });
    send.onclick = function () {
      if (!ta.value.trim()) { toast('Write the reason first.', 'err'); ta.focus(); return; }
      send.disabled = true;
      api('POST', '/attendance/late-request', { reason: ta.value.trim() }).then(function (j) {
        toast(j.message || 'Request sent'); state.win = j.data.window; render();
      }).catch(function (e) { toast(e.message, 'err'); send.disabled = false; });
    };
    reqBox.appendChild(el('div', { class: 'at-f' }, [el('label', { text: 'Reason' }), ta, el('div', { class: 'at-row' }, [send])]));
  }

  function punchIn() {
    if (!state.photo) { toast('Take a photo first.', 'err'); return; }
    state.busy = true; render();
    getLocation().then(function (c) {
      return api('POST', '/attendance/checkin', { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, photo: state.photo });
    }).then(function (j) {
      toast(j.message || 'Punched in'); state.photo = null;
      try { localStorage.setItem('crm_punched_in', new Date().toDateString()); } catch (e) {}
      meter('open');
      return load();
    }).catch(function (e) { locFail(e, 'in'); })
      .then(function () { state.busy = false; render(); });
  }
  function punchOut() {
    if (!confirm('Punch out now?')) return;
    var b = document.getElementById('at-out'); if (b) { b.disabled = true; b.textContent = 'Punching out…'; }
    getLocation().then(function (c) { return api('POST', '/attendance/checkout', { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy }); })
      .then(function (j) { toast(j.message || 'Punched out'); meter('close'); return load(); })
      .catch(function (e) { locFail(e, 'out'); render(); });
  }
  // Odometer: starting reading after punch in, closing reading after punch out
  // (the Fuel expense page works out the km and the claim from these).
  function meter(mode) {
    if (window.FuelExpense && window.FuelExpense.openMeterDialog) setTimeout(function () { window.FuelExpense.openMeterDialog(mode, function () { loadFuel(); }); }, 350);
  }
  var fuelBox = null;
  function loadFuel() {
    if (!fuelBox) return;
    api('GET', '/fuel-expense/today').then(function (j) {
      var d = j.data || {}, r = d.record;
      clear(fuelBox);
      if (!d.checkedIn) return;
      var km = function (v) { return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }); };
      var line = el('div', { class: 'at-msg info', id: 'at-odo' });
      if (d.needsOpening) {
        line.className = 'at-msg warn';
        line.appendChild(el('span', { text: '🚗 Starting odometer reading not entered. ' }));
        line.appendChild(el('button', { class: 'at-btn sm', type: 'button', id: 'at-odo-open', text: 'Enter starting reading', onclick: function () { meter('open'); } }));
      } else if (d.needsClosing) {
        line.className = 'at-msg warn';
        line.appendChild(el('span', { text: '🚗 Started at ' + km(r.openingMeter) + ' km — enter the closing (finishing) odometer reading. ' }));
        line.appendChild(el('button', { class: 'at-btn sm pri', type: 'button', id: 'at-odo-close', text: 'Enter closing reading', onclick: function () { meter('close'); } }));
      } else if (r && r.status === 'CLOSED') {
        line.className = 'at-msg ok';
        line.textContent = '🚗 Odometer ' + km(r.openingMeter) + ' → ' + km(r.closingMeter) + ' km · official ' + km(r.officialKm) + ' km' +
          (Number(r.totalAmount) ? ' · fuel claim ₹' + Number(r.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '') + ' (in Fuel expense)';
      } else if (r) {
        line.textContent = '🚗 Starting odometer ' + km(r.openingMeter) + ' km — you will enter the closing reading when you punch out.';
      } else return;
      fuelBox.appendChild(line);
    }).catch(function () {});
  }

  // Location problems open the same "Turn on location" help as the rest of the CRM.
  function locFail(e, dir) {
    if (e && e.geo && window.CRMTracking && window.CRMTracking.help) window.CRMTracking.help(dir, e.geo);
    else toast(e.message, 'err');
  }

  var photoCache = {};
  function loadPhoto(id) {
    if (photoCache[id]) return photoCache[id];
    return (photoCache[id] = fetch(API + '/api/attendance/' + encodeURIComponent(id) + '/photo', { headers: { Authorization: 'Bearer ' + (token() || '') } })
      .then(function (r) { if (!r.ok) throw new Error('No photo'); return r.blob(); })
      .then(function (b) { return URL.createObjectURL(b); }));
  }
  function showPhoto(id) {
    loadPhoto(id).then(function (u) {
      var m = el('div', { class: 'at-modal', onclick: function () { m.remove(); } }, [el('img', { src: u, alt: 'Punch-in photo' })]);
      document.body.appendChild(m);
    }).catch(function () { toast('Photo not available', 'err'); });
  }

  // ── my history ───────────────────────────────────────────────────────
  function loadHistory() {
    var body = histBox.querySelector('[data-hist]');
    clear(body).appendChild(el('div', { class: 'at-empty', text: 'Loading…' }));
    api('GET', '/attendance?limit=31&month=' + state.month + '&year=' + state.year).then(function (j) {
      var items = (j.data && j.data.items) || [];
      clear(body);
      if (!items.length) { body.appendChild(el('div', { class: 'at-empty', text: 'No attendance this month.' })); return; }
      var tb = el('tbody');
      items.forEach(function (r) {
        var st = r.status === 'PRESENT' ? '#16a34a' : r.status === 'ABSENT' ? '#dc2626' : '#d97706';
        tb.appendChild(el('tr', {}, [
          el('td', { text: dmy(r.date) }),
          el('td', { text: r.checkInFormatted || hm(r.checkIn) }),
          el('td', { text: r.checkOutFormatted || hm(r.checkOut) || '—' }),
          el('td', { text: r.workingHours ? hrs(r.workingHours) : '—' }),
          el('td', {}, [r.lateMinutes ? el('span', { class: 'at-badge', style: '--c:#d97706', text: r.lateMinutes + ' min late' }) : el('span', { class: 'at-badge', style: '--c:#16a34a', text: 'On time' })]),
          el('td', {}, [el('span', { class: 'at-badge', style: '--c:' + st, text: r.status })]),
          el('td', {}, [r.checkInPhoto ? el('button', { class: 'at-btn sm', type: 'button', onclick: function () { showPhoto(r.id); }, text: 'View' }) : '—'])
        ]));
      });
      body.appendChild(el('div', { class: 'at-tw' }, [el('table', { class: 'at-table' }, [
        el('thead', {}, [el('tr', {}, ['Date', 'Punch in', 'Punch out', 'Hours', 'Time', 'Status', 'Photo'].map(function (h) { return el('th', { text: h }); }))]), tb])]));
    }).catch(function (e) { clear(body).appendChild(el('div', { class: 'at-empty', text: e.message })); });
  }

  // ── admin: late punch-in requests ────────────────────────────────────
  function loadRequests() {
    if (!adminBox) return;
    var body = adminBox.querySelector('[data-reqs]');
    api('GET', '/attendance/late-requests').then(function (j) {
      var list = (j.data && j.data.requests) || [];
      var pend = list.filter(function (x) { return x.status === 'PENDING'; }).length;
      adminBox.querySelector('h2').textContent = 'Late punch-in requests' + (pend ? ' (' + pend + ' waiting)' : '');
      clear(body);
      if (!list.length) { body.appendChild(el('div', { class: 'at-empty', text: 'No requests.' })); return; }
      var tb = el('tbody');
      list.slice(0, 30).forEach(function (q) {
        var c = { PENDING: '#d97706', APPROVED: '#16a34a', REJECTED: '#dc2626' }[q.status] || '#64748b';
        var acts = el('td', {});
        if (q.status === 'PENDING') {
          acts.appendChild(el('div', { class: 'at-row', style: 'margin:0' }, [
            el('button', { class: 'at-btn sm pri', type: 'button', 'data-approve': q.id, text: 'Approve', onclick: function () { decide(q, 'APPROVED'); } }),
            el('button', { class: 'at-btn sm red', type: 'button', 'data-reject': q.id, text: 'Reject', onclick: function () { decide(q, 'REJECTED'); } })
          ]));
        } else acts.textContent = (q.decidedByName ? 'by ' + q.decidedByName : '') + (q.adminNote ? ' — ' + q.adminNote : '');
        tb.appendChild(el('tr', { 'data-req': q.id }, [
          el('td', {}, [el('b', { text: q.userName || '' }), el('div', { class: 'at-sub', text: q.department || '' })]),
          el('td', { text: dmy(q.date) + ' · ' + hm(q.createdAt) }),
          el('td', { text: q.reason }),
          el('td', {}, [el('span', { class: 'at-badge', style: '--c:' + c, text: q.status })]),
          acts
        ]));
      });
      body.appendChild(el('div', { class: 'at-tw' }, [el('table', { class: 'at-table' }, [
        el('thead', {}, [el('tr', {}, ['Employee', 'Sent', 'Reason', 'Status', ''].map(function (h) { return el('th', { text: h }); }))]), tb])]));
    }).catch(function (e) { clear(body).appendChild(el('div', { class: 'at-empty', text: e.message })); });
  }
  function decide(q, status) {
    var note = '';
    if (status === 'REJECTED') { note = prompt('Reason for rejecting ' + (q.userName || '') + '’s request:') || ''; if (!note.trim()) return; }
    api('PATCH', '/attendance/late-requests/' + encodeURIComponent(q.id), { status: status, note: note })
      .then(function (j) { toast(j.message || 'Done'); loadRequests(); })
      .catch(function (e) { toast(e.message, 'err'); });
  }

  function load() {
    return api('GET', '/attendance/today').then(function (j) {
      state.record = j.data.record; state.win = j.data.window;
      if (state.record) { try { localStorage.setItem('crm_punched_in', new Date().toDateString()); } catch (e) {} }
      if (!state.stream) render();
      loadHistory(); loadFuel();
    }).catch(function (e) { clear(punchBox).appendChild(el('div', { class: 'at-msg bad', text: e.message })); });
  }

  function mountPage(content) {
    injectCss();
    root = el('div', { class: 'at-wrap' });
    root.appendChild(el('div', { class: 'at-head' }, [el('h1', { text: 'Attendance' }),
      el('p', { text: 'Punch in with a photo and your location. On time until 9:30 AM, grace until 9:45 AM; after that send a request for approval.' })]));
    var pc = el('div', { class: 'at-card' }, [el('h2', { text: 'Today' })]);
    punchBox = el('div', { id: 'at-punch' }); pc.appendChild(punchBox);
    fuelBox = el('div', { id: 'at-fuel' }); pc.appendChild(fuelBox);
    root.appendChild(pc);
    reqBox = el('div', { class: 'at-card at-f', id: 'at-request', style: 'display:none' });
    root.appendChild(reqBox);
    if (isAdminTier) {
      adminBox = el('div', { class: 'at-card', id: 'at-admin' }, [el('h2', { text: 'Late punch-in requests' }), el('div', { 'data-reqs': '1' })]);
      root.appendChild(adminBox);
    }
    // "card" + span.text-sm.font-semibold "Attendance history": the admin
    // "All employees" register (attendance-all-app.js) attaches here.
    var monthSel = el('select', { id: 'at-month', class: 'at-f', style: 'width:auto;border:1px solid #cbd5e1;border-radius:.5rem;padding:.3rem .5rem;font-size:.82rem' });
    for (var k = 0; k < 6; k++) {
      var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k);
      monthSel.appendChild(el('option', { value: (d.getMonth() + 1) + '-' + d.getFullYear(), text: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }));
    }
    monthSel.onchange = function () { var p = monthSel.value.split('-'); state.month = +p[0]; state.year = +p[1]; loadHistory(); };
    histBox = el('div', { class: 'card at-card', id: 'at-history' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem' }, [
        el('span', { class: 'text-sm font-semibold', text: 'Attendance history' }), monthSel]),
      el('div', { 'data-hist': '1' })
    ]);
    root.appendChild(histBox);
    content.appendChild(root);
    load(); loadRequests();
    timer = setInterval(function () {
      // keep the clock and the window (on time → grace → locked) current
      if (!state.stream && !state.busy && document.visibilityState === 'visible') {
        api('GET', '/attendance/today').then(function (j) {
          var before = JSON.stringify([state.record && state.record.id, state.win && state.win.phase, state.win && state.win.canPunchIn, state.win && state.win.request && state.win.request.status]);
          state.record = j.data.record; state.win = j.data.window;
          var after = JSON.stringify([state.record && state.record.id, state.win.phase, state.win.canPunchIn, state.win.request && state.win.request.status]);
          if (before !== after) render(); else { var c = document.getElementById('at-clock'); if (c) c.textContent = ampm(String(state.win.now).slice(0, 5)); }
        }).catch(function () {});
        loadRequests();
      }
    }, 30000);
    if (window.AttendanceAll) setTimeout(window.AttendanceAll.tryMount, 300);
  }

  window.addEventListener('pagehide', stopCam);
  window.AttendancePage = { mountPage: mountPage };
})();
