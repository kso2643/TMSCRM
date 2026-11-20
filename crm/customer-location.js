/* ══════════════════════════════════════════════════════════════════════
   customer-location.js — map in the customer Add / Edit form (v11.57). Customers page.

   The form had "Use my current location", GPS latitude / longitude and a Google
   Maps link, but no map — and they drifted apart:
     • the Maps link kept the OLD place after "Use my current location" (it was only
       filled when empty), so the map still showed the old spot;
     • typing new numbers or pasting a Maps link changed only that one box.
   Now a map with a draggable pin sits under those boxes and keeps all three in step:
     GPS button / typed numbers → pin moves + link rewritten
     drag the pin or tap the map → numbers + link updated
     paste a Google Maps link with a place (…@11.01,76.95… / ?q=11.01,76.95) → numbers + pin
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__custLoc || !/^\/customers\/?$/.test(location.pathname)) return;
  window.__custLoc = true;
  var LCSS = '/vendor/leaflet/leaflet.css', LJS = '/vendor/leaflet/leaflet.js';
  var ready = null;
  function leaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (ready) return ready;
    ready = new Promise(function (res, rej) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LCSS; document.head.appendChild(l);
      var s = document.createElement('script'); s.src = LJS; s.onload = function () { res(window.L); }; s.onerror = function () { ready = null; rej(new Error('map')); };
      document.head.appendChild(s);
    });
    return ready;
  }
  // set a React-controlled input's value so React sees it (its onChange runs)
  function setVal(inp, v) {
    var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(inp, v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function num(v) { var n = parseFloat(String(v || '').trim()); return isFinite(n) ? n : null; }
  function okLL(a, b) { return a != null && b != null && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0); }
  function link(a, b) { return 'https://www.google.com/maps?q=' + a.toFixed(6) + ',' + b.toFixed(6); }
  function fromLink(u) {
    u = String(u || '');
    var m = u.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || u.match(/[?&](?:q|ll|query|center|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i) || u.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  }
  function find(form) {
    var lat = form.querySelector('input[placeholder="e.g. 18.5204"]'), lng = form.querySelector('input[placeholder="e.g. 73.8567"]');
    var ml = form.querySelector('input[type="url"][placeholder^="https://maps.google"]');
    return lat && lng ? { lat: lat, lng: lng, link: ml } : null;
  }
  function attach(f) {
    if (f.lat.__clMap) return;
    f.lat.__clMap = true;
    var host = f.lat.closest('.grid') || f.lat.parentNode.parentNode;
    var box = document.createElement('div');
    box.className = 'sm:col-span-2';
    box.id = 'cl-map-box';
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">' +
      '<span class="label" style="margin:0">Customer location on the map</span>' +
      '<span id="cl-map-hint" style="font-size:12px;color:#64748b">Drag the pin or tap the map to correct it</span></div>' +
      '<div id="cl-map" style="height:260px;border-radius:10px;border:1px solid #cbd5e1;overflow:hidden;background:#e2e8f0"></div>';
    // after the GPS longitude box's row
    var after = f.lng.closest('div');
    if (after && after.parentNode === host) host.insertBefore(box, after.nextSibling); else host.appendChild(box);
    var hint = box.querySelector('#cl-map-hint');
    leaflet().then(function (L) {
      var el = box.querySelector('#cl-map');
      var a = num(f.lat.value), b = num(f.lng.value), has = okLL(a, b);
      var map = L.map(el, { zoomControl: true, attributionControl: false }).setView(has ? [a, b] : [11.0168, 76.9558], has ? 16 : 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      var pin = L.marker(has ? [a, b] : [11.0168, 76.9558], { draggable: true, opacity: has ? 1 : 0.35 }).addTo(map);
      el.__map = map; el.__pin = pin;
      var last = has ? a.toFixed(6) + ',' + b.toFixed(6) : '';
      function put(lat, lng, from) {          // pin / tap → boxes
        setVal(f.lat, lat.toFixed(6)); setVal(f.lng, lng.toFixed(6));
        if (f.link) setVal(f.link, link(lat, lng));
        last = lat.toFixed(6) + ',' + lng.toFixed(6);
        pin.setOpacity(1);
        hint.textContent = (from === 'drag' ? 'Pin moved' : 'Pin set') + ' — ' + last + '. Save to keep it.';
        hint.style.color = '#047857';
      }
      pin.on('dragend', function () { var p = pin.getLatLng(); put(p.lat, p.lng, 'drag'); });
      map.on('click', function (e) { pin.setLatLng(e.latlng); put(e.latlng.lat, e.latlng.lng, 'tap'); });
      function sync() {                        // boxes (GPS button / typing) → pin + link
        if (!document.body.contains(f.lat)) return stop();
        var x = num(f.lat.value), y = num(f.lng.value);
        if (!okLL(x, y)) return;
        var key = x.toFixed(6) + ',' + y.toFixed(6);
        if (key === last) return;
        last = key;
        pin.setLatLng([x, y]); pin.setOpacity(1);
        map.setView([x, y], Math.max(map.getZoom(), 16));
        if (f.link) { var cur = fromLink(f.link.value); if (!cur || cur[0].toFixed(5) !== x.toFixed(5) || cur[1].toFixed(5) !== y.toFixed(5)) setVal(f.link, link(x, y)); }
        hint.textContent = 'Pin at ' + key + ' — the Google Maps link follows it.';
        hint.style.color = '#64748b';
      }
      var timer = setInterval(sync, 400);   // the GPS button sets the numbers without an input event
      function stop() { clearInterval(timer); try { map.remove(); } catch (e) {} }
      if (f.link) f.link.addEventListener('change', function () {   // pasted Google Maps link → numbers + pin
        var p = fromLink(f.link.value);
        if (p && okLL(p[0], p[1])) { setVal(f.lat, p[0].toFixed(6)); setVal(f.lng, p[1].toFixed(6)); sync(); hint.textContent = 'Location taken from the Google Maps link.'; }
      });
      setTimeout(function () { map.invalidateSize(); }, 250);
    }).catch(function () { hint.textContent = 'Map could not load — the numbers and link still work.'; });
  }
  new MutationObserver(function () {
    clearTimeout(attach._t);
    attach._t = setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('input[placeholder="e.g. 18.5204"]'), function (inp) {
        var form = inp.closest('form') || inp.closest('[role="dialog"]') || inp.closest('.grid').parentNode;
        var f = form && find(form);
        if (f) attach(f);
      });
    }, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
