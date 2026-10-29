/* ══════════════════════════════════════════════════════════════════════
   CRM name and logo set by the Super Admin / Admin (Admin → Notifications & branding).

   Loaded by crm-global.js on every page, the login page included. Wherever the
   built-in "Industrial CRM" name is shown (sidebar, login, page titles) it is
   replaced by the saved name, and the small square icon next to it by the logo.
   The settings are kept on this device so the page does not flash the old name,
   and refreshed from GET /api/app-settings/public on each page load.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__crmBrand) return;
  window.__crmBrand = true;
  var API = 'https://api.apjtech.in';
  var KEY = 'crm_brand';
  var DEFAULT = 'Industrial CRM';
  var brand = null;
  try { brand = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}

  function logoUrl(b) { return b && b.logo ? (/^https?:/.test(b.logo) ? b.logo : API + b.logo) : null; }

  function apply() {
    var b = brand || {};
    var name = b.name || DEFAULT, logo = logoUrl(b);
    if (document.title.indexOf(DEFAULT) !== -1 && name !== DEFAULT) document.title = document.title.split(DEFAULT).join(name);
    if (!document.body) return;
    // Every element showing the name (marked once, so a later change of name still finds it)
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.nodeValue && n.nodeValue.trim() === DEFAULT ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; }
    });
    var hits = [], n;
    while ((n = walker.nextNode())) hits.push(n.parentElement);
    hits.forEach(function (el) { if (el && !el.closest('[data-brand-skip]')) el.setAttribute('data-brand-name', '1'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-brand-name]'), function (el) {
      if (el.textContent !== name) el.textContent = name;
      var box = iconBox(el);
      if (!box) return;
      if (logo) {
        var img = box.querySelector('img[data-brand-logo]');
        if (!img || img.getAttribute('src') !== logo) {
          if (!box.hasAttribute('data-brand-orig')) box.setAttribute('data-brand-orig', box.className);
          box.innerHTML = '';
          img = document.createElement('img');
          img.setAttribute('data-brand-logo', '1'); img.alt = name; img.src = logo;
          img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:inherit';
          box.appendChild(img);
          box.style.background = 'transparent';
        }
      } else if (box.querySelector('img[data-brand-logo]')) {
        location.reload();   // logo removed: the page draws its own icon again
      }
    });
    if (logo) {
      var fav = document.querySelector('link[rel="icon"][data-brand]');
      if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; fav.setAttribute('data-brand', '1'); document.head.appendChild(fav); }
      if (fav.getAttribute('href') !== logo) fav.href = logo;
    }
  }
  // The square icon drawn just before the name (sidebar / login header).
  function iconBox(el) {
    var cands = [el.previousElementSibling, el.parentElement && el.parentElement.previousElementSibling];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c && /rounded/.test(c.className || '') && (c.querySelector('svg, img[data-brand-logo]'))) return c;
    }
    return null;
  }

  var pending = null;
  function later() { if (pending) return; pending = setTimeout(function () { pending = null; apply(); }, 120); }
  function boot() {
    apply();
    new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
    fetch(API + '/api/app-settings/public').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.data || !j.data.branding) return;
      var b = j.data.branding;
      var changed = JSON.stringify(b) !== JSON.stringify(brand);
      brand = b;
      try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) {}
      if (changed) apply();
    }).catch(function () {});
  }
  window.CRMBrand = { get: function () { return brand || {}; }, set: function (b) { brand = b; try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) {} apply(); }, apply: apply, DEFAULT: DEFAULT };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
