/* quote-firm.js — Quotations page: "Our company — TMS / APJ" must be chosen for every quotation.
 *
 * The page holds two quotation apps (TMS and APJ) and used to open whichever was used last, so a
 * quotation could be saved under the wrong company without anyone noticing. This adds a clear
 * TMS / APJ chooser above the form and, until a company has been chosen on this visit (or an
 * existing quotation is opened), Save asks "Which company is this quotation for?" first.
 */
(function () {
  'use strict';
  var picked = '';   // company confirmed on this visit

  function current() { try { return localStorage.getItem('activeCompany') === 'TMS' ? 'TMS' : 'APJ'; } catch (e) { return 'APJ'; } }
  function mark(f) { picked = f; draw(); }

  function css() {
    if (document.getElementById('qf-css')) return;
    var st = document.createElement('style'); st.id = 'qf-css';
    st.textContent = [
      '#qf-bar{max-width:1200px;margin:12px auto 0;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:12px;font:600 14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#0f172a;box-shadow:0 1px 2px rgba(15,23,42,.06)}',
      '#qf-bar.need{border-color:#f59e0b;background:#fffbeb}',
      '#qf-bar .qf-l{margin-right:4px}#qf-bar .qf-l i{color:#dc2626;font-style:normal}',
      '.qf-btn{border:1.5px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:9px;padding:7px 16px;font:700 14px/1 inherit;cursor:pointer;min-width:72px}',
      '.qf-btn:hover{border-color:#64748b}',
      '.qf-btn.on[data-qf=TMS],.qf-btn.on[data-qf-pick=TMS]{background:#2563eb;border-color:#2563eb;color:#fff}',
      '.qf-btn.on[data-qf=APJ],.qf-btn.on[data-qf-pick=APJ]{background:#0f766e;border-color:#0f766e;color:#fff}',
      '#qf-bar .qf-s{font-weight:500;font-size:13px;color:#64748b}#qf-bar.need .qf-s{color:#92400e}',
      'body.theme-apj #qf-bar{background:#0f1e36;border-color:#1e3a5f;color:#e2e8f0}body.theme-apj #qf-bar.need{background:#3b2a07;border-color:#b45309}',
      'body.theme-apj .qf-btn{background:#0a1628;color:#e2e8f0;border-color:#334155}body.theme-apj #qf-bar .qf-s{color:#94a3b8}body.theme-apj #qf-bar.need .qf-s{color:#fcd34d}',
      '#qf-modal{position:fixed;inset:0;z-index:1000001;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px}',
      '#qf-modal .qf-card{background:#fff;color:#0f172a;border-radius:14px;padding:22px;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.3);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}',
      '#qf-modal h3{margin:0 0 6px;font-size:18px}#qf-modal p{margin:0 0 16px;color:#475569;font-size:14px}',
      '#qf-modal .qf-row{display:flex;gap:10px}#qf-modal .qf-row .qf-btn{flex:1;padding:14px;font-size:16px}',
      '#qf-modal .qf-x{margin-top:12px;background:none;border:0;color:#64748b;cursor:pointer;font-size:13px}',
      '@media (max-width:560px){#qf-bar{margin:8px 8px 0}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var bar;
  function draw() {
    if (!bar) return;
    var cur = current();
    bar.className = picked ? '' : 'need';
    bar.querySelectorAll('[data-qf]').forEach(function (b) { b.classList.toggle('on', !!picked && b.getAttribute('data-qf') === picked); b.setAttribute('aria-checked', picked === b.getAttribute('data-qf') ? 'true' : 'false'); });
    bar.querySelector('.qf-s').textContent = picked
      ? '✓ This quotation is for ' + (picked === 'TMS' ? 'TMS — Tulips Machining Solutions' : 'APJ — APJ Technologies')
      : '⚠ Choose TMS or APJ before saving (the ' + cur + ' form is open now)';
  }

  function choose(f) {
    if (f !== current() && typeof window.switchCompanyFromBar === 'function') window.__qfSwitch(f);
    mark(f);
  }

  function ask(appCompany, proceed) {
    var old = document.getElementById('qf-modal'); if (old) old.remove();
    var m = document.createElement('div'); m.id = 'qf-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="qf-card"><h3>Which company is this quotation for?</h3>' +
      '<p>Choose our company before saving. The quotation number, letterhead and signatory follow this choice.</p>' +
      '<div class="qf-row"><button type="button" class="qf-btn" data-qf-pick="TMS">TMS</button><button type="button" class="qf-btn" data-qf-pick="APJ">APJ</button></div>' +
      '<button type="button" class="qf-x">Cancel</button></div>';
    document.body.appendChild(m);
    function close() { m.remove(); }
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    m.querySelector('.qf-x').onclick = close;
    m.querySelectorAll('[data-qf-pick]').forEach(function (b) {
      b.onclick = function () {
        var f = b.getAttribute('data-qf-pick');
        close();
        if (f === appCompany) { mark(f); proceed(); return; }
        choose(f);   // moves the typed quotation over to the other company's form
        alert('Moved to the ' + f + ' quotation form. Check the details and press Save again.');
      };
    });
    m.querySelector('[data-qf-pick="' + appCompany + '"]').focus();
  }

  function wrapSave(name, company) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__qf) return;
    var w = function () {
      var self = this, args = arguments;
      if (picked === company) return orig.apply(self, args);
      ask(company, function () { orig.apply(self, args); });
    };
    w.__qf = true;
    window[name] = w;
  }
  function wrapPick(name, companyOf) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__qf) return;
    var w = function () { var r = orig.apply(this, arguments); var f = companyOf(arguments); if (f) mark(f); return r; };
    w.__qf = true;
    window[name] = w;
  }

  function init() {
    var sw = document.getElementById('company-switcher');
    if (!sw || document.getElementById('qf-bar')) return;
    css();
    bar = document.createElement('div'); bar.id = 'qf-bar'; bar.setAttribute('role', 'radiogroup'); bar.setAttribute('aria-label', 'Our company');
    bar.innerHTML = '<span class="qf-l">Our company — TMS or APJ <i>*</i></span>' +
      '<button type="button" class="qf-btn" data-qf="TMS">TMS</button><button type="button" class="qf-btn" data-qf="APJ">APJ</button>' +
      '<span class="qf-s"></span>';
    sw.parentNode.insertBefore(bar, sw.nextSibling);
    bar.querySelectorAll('[data-qf]').forEach(function (b) { b.onclick = function () { choose(b.getAttribute('data-qf')); }; });

    // the dark bar's buttons count as a choice too
    var origSwitch = window.switchCompanyFromBar;
    window.__qfSwitch = function (f) { return origSwitch.call(window, f); };
    if (typeof origSwitch === 'function') window.switchCompanyFromBar = function (f) { var r = origSwitch.apply(this, arguments); mark(f); return r; };
    // opening a saved quotation / loading a price request / converting: the company is known
    wrapPick('tms_editQuotation', function () { return 'TMS'; });
    wrapPick('apj_editQuotation', function () { return 'APJ'; });
    wrapPick('convertQuotation', function (a) { return a[1]; });
    wrapPick('prLoadIntoQuotation', function (a) { return a[0]; });
    wrapSave('tms_saveQuotation', 'TMS');
    wrapSave('apj_saveQuotation', 'APJ');
    draw();
  }

  window.QuoteFirm = { picked: function () { return picked; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
