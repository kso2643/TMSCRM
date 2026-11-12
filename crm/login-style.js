/* login-style.js — a more attractive sign-in page (v11.46). Loaded on /login/ only.
 * Left: a gradient panel in the theme colour with a cutting-tool illustration and what the CRM does.
 * Right: the sign-in form in a card with a greeting. The sample "Demo credentials" box is hidden.
 * Colours follow the theme (crm-theme.js → --crm-p / --crm-a), the name and logo follow branding.
 */
(function () {
  'use strict';
  if (!/^\/login\/?$/.test(location.pathname) || window.__loginStyle) return;
  window.__loginStyle = true;

  var css = [
    ':root{--lg-p:var(--crm-p,#1e3a5f);--lg-a:var(--crm-a,#f59e0b)}',
    '.lg-root{background:radial-gradient(1200px 600px at 100% 0%,rgba(59,130,246,.08),transparent 60%),#f6f8fb!important}',
    '.dark .lg-root{background:#0b1220!important}',
    '.lg-left{position:relative;overflow:hidden;background:linear-gradient(150deg,var(--lg-p) 0%,color-mix(in srgb,var(--lg-p) 70%,#000) 100%)!important;color:#fff}',
    '.lg-left>*:not(.lg-art):not(.lg-hero):not(.lg-logo):not(.lg-foot){display:none!important}',
    '.lg-left .lg-logo{position:relative;z-index:2}',
    '.lg-left .lg-art{position:absolute!important;top:0;left:0;width:100%!important;height:100%!important;max-width:none!important;z-index:0;pointer-events:none}',
    '.lg-hero{position:relative;z-index:2;margin-top:auto;margin-bottom:auto;padding:8px 0}',
    '.lg-hero h2{font-size:1.85rem;line-height:1.15;font-weight:800;margin:0 0 .8rem;letter-spacing:-.02em}',
    '.lg-hero h2 span{color:var(--lg-a)}',
    '.lg-hero p{color:rgba(255,255,255,.78);font-size:.9rem;line-height:1.55;margin:0 0 1.2rem;max-width:30rem}',
    '.lg-feat{display:grid;grid-template-columns:1fr;gap:.5rem;max-width:30rem}',
    '.lg-feat div{display:flex;gap:.6rem;align-items:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:.5rem .75rem;backdrop-filter:blur(4px)}',
    '.lg-feat b{display:block;font-size:.86rem}.lg-feat small{color:rgba(255,255,255,.7);font-size:.74rem;line-height:1.35}',
    '.lg-feat i{font-style:normal;font-size:1.15rem;line-height:1}',
    '.lg-foot{position:relative;z-index:2;font-size:.75rem;color:rgba(255,255,255,.55)}',
    '.lg-card{background:#fff;border:1px solid #e6ebf2;border-radius:22px;box-shadow:0 24px 60px -20px rgba(15,23,42,.25),0 2px 6px rgba(15,23,42,.05);padding:2.2rem 2rem!important;max-width:26rem!important}',
    '.dark .lg-card{background:#111a2c;border-color:#1f2b40}',
    '.lg-card .btn-primary{height:46px;font-size:.95rem;border-radius:12px!important;box-shadow:0 8px 20px -8px var(--lg-p)}',
    '.lg-card .input{height:46px;border-radius:12px!important}',
    '.lg-hello{display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;font-weight:600;color:var(--lg-p);background:color-mix(in srgb,var(--lg-p) 10%,#fff);border-radius:999px;padding:.25rem .7rem;margin-bottom:.8rem}',
    '.dark .lg-hello{background:rgba(255,255,255,.08);color:#cbd5e1}',
    '.lg-secure{margin-top:1.2rem;text-align:center;font-size:.75rem;color:#94a3b8}',
    '.lg-demo{display:none!important}',
    '@media(max-width:767px){.lg-left{padding:22px!important;min-height:auto!important}.lg-hero{margin:14px 0 0}.lg-hero h2{font-size:1.45rem}.lg-hero p,.lg-feat,.lg-foot{display:none}.lg-card{margin-top:-28px;position:relative;z-index:3}}'
  ].join('\n');

  var ART = '<svg class="lg-art" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<defs><pattern id="lgg" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="1"/></pattern>' +
    '<radialGradient id="lgr" cx="85%" cy="12%" r="60%"><stop offset="0" stop-color="rgba(255,255,255,.18)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient></defs>' +
    '<rect width="600" height="900" fill="url(#lgg)"/><rect width="600" height="900" fill="url(#lgr)"/>' +
    // a turning insert (80° rhombic, CNMG-like) with its hole
    '<g transform="translate(470 170) rotate(15)" opacity=".22" fill="none" stroke="#fff" stroke-width="3"><path d="M0 -70 L40 0 L0 70 L-40 0 Z"/><circle r="14"/><path d="M0 -52 L28 0 L0 52 L-28 0 Z" stroke-width="1.5"/></g>' +
    // an end mill (side view with flutes)
    '<g transform="translate(90 690) rotate(-28)" opacity=".2" fill="none" stroke="#fff" stroke-width="3"><rect x="-22" y="-150" width="44" height="120" rx="4"/><path d="M-22 -30 L-22 120 L22 120 L22 -30"/>' +
    '<path d="M-22 -10 Q0 10 22 -18 M-22 30 Q0 50 22 22 M-22 70 Q0 90 22 62 M-22 108 Q0 125 22 100"/></g>' +
    // a gear
    '<g transform="translate(520 760)" opacity=".14" fill="none" stroke="#fff" stroke-width="3"><circle r="46"/><circle r="16"/>' +
    [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) { return '<rect x="-7" y="-62" width="14" height="18" rx="2" transform="rotate(' + a + ')"/>'; }).join('') + '</g>' +
    '<circle cx="80" cy="120" r="140" fill="var(--lg-a)" opacity=".10"/></svg>';

  function greet() { var h = new Date().getHours(); return h < 12 ? '☀ Good morning' : h < 17 ? '🌤 Good afternoon' : '🌙 Good evening'; }
  function brandName() { try { return (JSON.parse(localStorage.getItem('crm_brand') || 'null') || {}).name || 'Industrial CRM'; } catch (e) { return 'Industrial CRM'; } }

  function build() {
    var form = document.querySelector('form');
    if (!form) return false;
    var root = form.closest('.min-h-screen');
    if (!root || root.classList.contains('lg-root')) return !!root;
    var left = root.firstElementChild, right = form.closest('.max-w-sm') || form.parentElement;
    if (!left || left.contains(form)) return false;
    var st = document.createElement('style'); st.id = 'lg-css'; st.textContent = css; document.head.appendChild(st);
    root.classList.add('lg-root'); left.classList.add('lg-left'); right.classList.add('lg-card');
    if (left.firstElementChild) left.firstElementChild.classList.add('lg-logo');   // the logo + name row
    left.insertAdjacentHTML('afterbegin', ART);
    var hero = document.createElement('div'); hero.className = 'lg-hero';
    hero.innerHTML = '<h2>Cutting-tool sales &amp; service,<br><span>all in one place.</span></h2>' +
      '<p>Customers, visits and follow-ups, price requests, quotations and orders, field tracking and attendance — for the whole team, on the web and the phone app.</p>' +
      '<div class="lg-feat">' +
      '<div><i>🤝</i><span><b>Visits &amp; follow-ups</b><small>Plan, check in, log and never miss one</small></span></div>' +
      '<div><i>💰</i><span><b>Prices &amp; quotations</b><small>Supplier prices, approvals, TMS / APJ</small></span></div>' +
      '<div><i>📦</i><span><b>Orders &amp; delivery</b><small>From PO to invoice, item by item</small></span></div>' +
      '<div><i>📍</i><span><b>Field team</b><small>Attendance, km travelled, day plans</small></span></div></div>';
    left.appendChild(hero);
    var foot = document.createElement('div'); foot.className = 'lg-foot'; foot.textContent = '© ' + new Date().getFullYear() + ' ' + brandName();
    left.appendChild(foot);
    var hello = document.createElement('div'); hello.className = 'lg-hello'; hello.textContent = greet();
    right.insertBefore(hello, right.firstChild);
    var sec = document.createElement('p'); sec.className = 'lg-secure'; sec.textContent = '🔒 Secure sign-in · your session stays on this device';
    right.appendChild(sec);
    return true;
  }
  function hideDemo() {
    Array.prototype.forEach.call(document.querySelectorAll('div,p'), function (d) {
      if (!d.classList.contains('lg-demo') && /^Demo credentials/.test((d.textContent || '').trim()) && d.children.length <= 6) {
        var box = d.closest('[class*="border"]') || d; box.classList.add('lg-demo');
      }
    });
  }
  // v11.52: sign in with the e-mail OR the employee ID (TMS-024)
  function idField() {
    var i = document.querySelector('form input[type="email"]') || document.querySelector('form input[autocomplete="username"]');
    if (!i) return;
    if (i.form) i.form.noValidate = true; // the browser's own e-mail check would block "TMS-024"
    if (i.type !== 'text') i.type = 'text';
    if (i.placeholder !== 'you@company.com or TMS-024') { i.placeholder = 'you@company.com or TMS-024'; i.setAttribute('autocapitalize', 'off'); i.setAttribute('autocomplete', 'username'); }
    var wrap = i.closest('div') && i.closest('div').parentNode;
    var lab = wrap && wrap.querySelector('label');
    if (lab && lab.textContent === 'Email address') lab.textContent = 'Email or employee ID';
  }
  function tick() { idField(); if (build()) hideDemo(); }
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick); else tick();
})();
