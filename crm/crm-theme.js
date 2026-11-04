/* ══════════════════════════════════════════════════════════════════════
   crm-theme.js — the CRM's look, editable (v11.46).

   Admin → Notifications & branding → 🎨 Theme. The Super Admin / Admin set the
   company theme; anyone can pick their own (or follow the company's):
     colour preset or own colours, sidebar (light / brand colour / dark),
     page background, font, text size, corner style, light / dark default.

   Loaded on every page (crm-global.js). The finished CSS is kept on the device
   (localStorage "crm_theme_css") and put on the page by a one-line boot script
   at the top of every page, so the colours are there before the page draws.
   window.CRMTheme = { PRESETS, FONTS, effective(), preview(t), apply(t), refresh() }
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.CRMTheme) return;
  var API = 'https://api.apjtech.in';
  var PRESETS = {
    navy:     { label: 'Navy (default)', primary: '#1e3a5f', accent: '#f59e0b' },
    royal:    { label: 'Royal blue',     primary: '#1d4ed8', accent: '#f59e0b' },
    teal:     { label: 'Teal',           primary: '#0f766e', accent: '#f97316' },
    emerald:  { label: 'Emerald',        primary: '#047857', accent: '#eab308' },
    purple:   { label: 'Purple',         primary: '#6d28d9', accent: '#ec4899' },
    maroon:   { label: 'Maroon',         primary: '#9f1239', accent: '#f59e0b' },
    orange:   { label: 'Sunset orange',  primary: '#c2410c', accent: '#0ea5e9' },
    graphite: { label: 'Graphite',       primary: '#334155', accent: '#22c55e' },
    apj:      { label: 'APJ (teal & navy)', primary: '#0a2540', accent: '#00c9a7' },
    tms:      { label: 'TMS blue',       primary: '#1a4fa0', accent: '#f59e0b' }
  };
  var FONTS = ['Inter', 'Poppins', 'Roboto', 'Nunito', 'Open Sans', 'Lato', 'Montserrat'];

  function hexRgb(h) { h = String(h || '').replace('#', ''); if (h.length !== 6) return null; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgbHex(r) { return '#' + r.map(function (x) { x = Math.max(0, Math.min(255, Math.round(x))); return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function mix(h, w, t) { var a = hexRgb(h), b = hexRgb(w); return a && b ? rgbHex(a.map(function (x, i) { return x + (b[i] - x) * t; })) : h; }
  function token() { try { return localStorage.getItem('crm_token') || ''; } catch (e) { return ''; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var company = {}, mine = {};
  try { company = JSON.parse(read('crm_theme_company') || '{}') || {}; mine = JSON.parse(read('crm_theme_mine') || '{}') || {}; } catch (e) {}
  function effective() { return Object.keys(mine || {}).length ? mine : (company || {}); }

  function css(t) {
    t = t || {};
    var pre = PRESETS[t.preset] || PRESETS.navy;
    var P = t.primary || pre.primary, A = t.accent || pre.accent;
    var isDefault = P === PRESETS.navy.primary && !t.sidebar && !t.background && !t.font && !t.size && !t.radius && (!t.accent || t.accent === PRESETS.navy.accent);
    if (isDefault) return '';
    var Pd = mix(P, '#000000', 0.22), Pl = mix(P, '#ffffff', 0.9), Pm = mix(P, '#ffffff', 0.78), Pt = mix(P, '#ffffff', 0.55);
    var out = [':root{--crm-p:' + P + ';--crm-pd:' + Pd + ';--crm-pl:' + Pl + ';--crm-a:' + A + ';--blue:' + P + ';--blue-dark:' + Pd + ';--blue-light:' + Pl + ';--primary:' + P + ';--navy:' + P + '}'];
    var BTN = '.btn-primary,.md-btn.pri,.pr-btn.pri,.sr-btn.pri,.ep-btn.pri,.ch-btn,.vu-save,.lh-btn-pri,#drawer-save,.as-btn-pri';
    out.push(BTN + '{background-color:' + P + '!important;border-color:' + P + '!important;color:#fff!important}');
    out.push(BTN.split(',').map(function (s) { return s + ':hover'; }).join(',') + '{background-color:' + Pd + '!important}');
    out.push('.bg-primary-50,.sidebar-link-active{background-color:' + Pl + '!important}.bg-primary-100{background-color:' + Pm + '!important}');
    out.push('.text-primary-700,.text-primary-600,.sidebar-link-active,.hover\\:text-primary-600:hover{color:' + P + '!important}.text-primary-300,.text-primary-200{color:' + Pt + '!important}');
    out.push('.border-primary-200{border-color:' + Pm + '!important}.ring-primary-500,.focus\\:ring-primary-500:focus{--tw-ring-color:' + P + '!important}');
    out.push('.ch-m.mine{background:' + P + '!important;border-color:' + P + '!important}');
    out.push('.md-tab.on,.ep-tab.on,.pr-tab.on,.tab-btn.is-active,.sr-tab.on{color:' + P + '!important;border-bottom-color:' + P + '!important}');
    out.push('.pr-chip.on,.cu-chip.on,.md-btn.sm.pri,.joint-btn.on,.vu-yn button.on{background:' + P + '!important;border-color:' + P + '!important;color:#fff!important}');
    out.push('.fu-chip.on,.vu-chip.on{background:' + Pl + '!important;border-color:' + P + '!important;color:' + Pd + '!important}');
    out.push('.input:focus,input:focus,select:focus,textarea:focus{border-color:' + P + '}');
    out.push('.badge-blue{background:' + Pl + '!important;color:' + Pd + '!important}');
    out.push('.crm-accent,.badge-accent{background:' + A + '!important;color:#fff!important}');
    // sidebar
    if (t.sidebar === 'brand' || t.sidebar === 'dark') {
      var S = t.sidebar === 'brand' ? P : '#0f172a', Sb = t.sidebar === 'brand' ? Pd : '#1e293b';
      out.push('aside{background:' + S + '!important;border-color:' + Sb + '!important}');
      out.push('aside .sidebar-link,aside .sidebar-section,aside p,aside span,aside a,aside button,aside svg{color:rgba(255,255,255,.86)!important}');
      out.push('aside .sidebar-section{color:rgba(255,255,255,.55)!important}');
      out.push('aside .sidebar-link:hover{background:rgba(255,255,255,.1)!important}aside .sidebar-link-active,aside a[aria-current]{background:rgba(255,255,255,.18)!important;color:#fff!important}');
      out.push('aside [class*="border-"]{border-color:rgba(255,255,255,.14)!important}aside .bg-white,aside [class*="bg-slate-"]{background:transparent!important}');
    }
    // page background
    if (t.background === 'white') out.push('body,.bg-slate-50{background-color:#ffffff!important}');
    if (t.background === 'tint') out.push('body,.bg-slate-50{background-color:' + mix(P, '#ffffff', 0.95) + '!important}');
    out.push('.dark body,.dark .bg-slate-50{background-color:#0f172a!important}');
    // font + size
    if (t.font && t.font !== 'Inter') out.push('html,body,button,input,select,textarea{font-family:"' + t.font + '",ui-sans-serif,system-ui,sans-serif!important}');
    if (t.size && t.size !== 16) out.push('html{font-size:' + t.size + 'px!important}');
    // corners
    if (t.radius === 'sharp' || t.radius === 'round') {
      var r = t.radius === 'sharp' ? ['3px', '4px'] : ['12px', '18px'];
      out.push('.btn-primary,.btn-secondary,.btn-danger,.input,.select,.badge,.rounded-lg,.rounded-md,.md-btn,.pr-btn,.sr-btn,.ep-btn,.ch-btn{border-radius:' + r[0] + '!important}');
      out.push('.card,.rounded-xl,.rounded-2xl,.md-card,.pr-card,.sr-card,.ep-card,.ep-tile,.ep-eng,.ch-card,.meeting-card,#cu-card,#vu-card{border-radius:' + r[1] + '!important}');
    }
    return out.join('\n');
  }

  function fontLink(t) {
    var f = t && t.font;
    var old = document.getElementById('crm-theme-font');
    if (!f || f === 'Inter') { if (old) old.remove(); return; }
    var href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f) + ':wght@400;500;600;700&display=swap';
    if (old && old.getAttribute('href') === href) return;
    if (!old) { old = document.createElement('link'); old.id = 'crm-theme-font'; old.rel = 'stylesheet'; document.head.appendChild(old); }
    old.href = href;
  }
  function put(text, t) {
    var st = document.getElementById('crm-theme-css');
    if (!st) { st = document.createElement('style'); st.id = 'crm-theme-css'; (document.head || document.documentElement).appendChild(st); }
    if (st.textContent !== text) st.textContent = text;
    if (document.head && st !== document.head.lastElementChild) document.head.appendChild(st);   // after the page's own styles
    fontLink(t);
  }
  function apply(t) {
    t = t || effective();
    var text = css(t);
    put(text, t);
    store('crm_theme_css', text || null);
    store('crm_theme_font', t.font && t.font !== 'Inter' ? t.font : null);
    // company default light / dark (only for people who never chose with the moon button)
    if (t.mode && read('crm_theme') == null) document.documentElement.classList.toggle('dark', t.mode === 'dark');
  }
  function preview(t) { put(css(t), t); }

  function refresh() {
    var tk = token();
    var url = tk ? '/api/app-settings' : '/api/app-settings/public';
    return fetch(API + url, { headers: tk ? { Authorization: 'Bearer ' + tk } : {} }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.data) return;
      company = j.data.theme || {};
      if (tk) mine = j.data.myTheme || {};
      store('crm_theme_company', JSON.stringify(company));
      store('crm_theme_mine', JSON.stringify(mine));
      apply();
    }).catch(function () {});
  }

  window.CRMTheme = {
    PRESETS: PRESETS, FONTS: FONTS, css: css, effective: effective, preview: preview, apply: apply, refresh: refresh,
    company: function () { return company; }, mine: function () { return mine; },
    setCompany: function (t) { company = t || {}; store('crm_theme_company', JSON.stringify(company)); apply(); },
    setMine: function (t) { mine = t || {}; store('crm_theme_mine', JSON.stringify(mine)); apply(); }
  };
  apply();
  refresh();
})();
