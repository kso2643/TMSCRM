/* ══════════════════════════════════════════════════════════════════════
   Product suggestions for the quotation forms (TMS and APJ).

   Type in a row's "Product Code" or "Specification" box (e.g. SNMX, snmx1206,
   YG602) → a list of matching products from the Products page shows code,
   specification, grade, brand, price and stock. Picking one fills the code,
   specification and price of that row.

   Prices that come from the product list or from an approved price request are
   locked (read-only) for engineers; Manager / Admin / Super Admin can unlock
   them with the 🔒 button.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var API = 'https://api.apjtech.in';
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function me() { try { return JSON.parse(localStorage.getItem('crm_user') || 'null') || {}; } catch (e) { return {}; } }
  var canUnlock = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(me().role) !== -1;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(v) { return (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('en-IN'); }

  var css = document.createElement('style');
  css.textContent = [
    '.ps-box{position:absolute;z-index:2147483000;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 14px 34px rgba(15,23,42,.18);max-height:340px;overflow:auto;min-width:420px;font:13px/1.35 Inter,system-ui,sans-serif;color:#0f172a}',
    '.ps-it{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 11px;cursor:pointer;border-bottom:1px solid #f1f5f9}',
    '.ps-it:hover,.ps-it.on{background:#eff6ff}.ps-it b{font-weight:700}.ps-it .ps-s{color:#475569;font-size:12px;margin-top:2px}',
    '.ps-tag{display:inline-block;padding:0 6px;border-radius:5px;font-size:11px;font-weight:600;margin-left:6px;background:#eef2ff;color:#3730a3}',
    '.ps-tag.g{background:#ecfeff;color:#0e7490}.ps-tag.st{background:#f0fdf4;color:#166534}.ps-tag.st0{background:#fef2f2;color:#991b1b}',
    '.ps-empty{padding:10px 12px;color:#64748b}.ps-v{color:#7c2d12;font-size:11.5px}',
    'input.ps-locked{background:#f1f5f9!important;color:#334155!important;cursor:not-allowed}',
    '.ps-lock{position:absolute;right:2px;top:50%;transform:translateY(-50%);border:0;background:none;cursor:pointer;font-size:12px;padding:2px}',
    '.ps-wrap{position:relative;display:contents}'
  ].join('\n');
  document.head.appendChild(css);

  // Locked prices per quotation row: key "tms:12" / "apj:3" → price
  var locked = window.__qLockedPrices = window.__qLockedPrices || {};

  /** Row info from an input's oninput="tms_upd(12,'productCode',this.value)". */
  function rowInfo(input) {
    var m = /(tms|apj)_upd\((\d+)\s*,\s*'(\w+)'/.exec(input.getAttribute('oninput') || '');
    return m ? { app: m[1], id: +m[2], field: m[3], fn: window[m[1] + '_upd'] } : null;
  }
  function rowInputs(row) {
    var out = {};
    row.querySelectorAll('input').forEach(function (i) { var r = rowInfo(i); if (r) out[r.field] = i; });
    return out;
  }

  // ── suggestion box ───────────────────────────────────────────────────
  var box = null, active = null, results = [], sel = -1, timer = null, seq = 0;
  function closeBox() { if (box) box.remove(); box = null; active = null; results = []; sel = -1; }
  function place() {
    if (!box || !active) return;
    var r = active.getBoundingClientRect();
    box.style.left = (window.scrollX + r.left) + 'px';
    box.style.top = (window.scrollY + r.bottom + 4) + 'px';
    box.style.width = Math.max(420, r.width * 2) + 'px';
  }
  function show(input, list) {
    if (!box) { box = document.createElement('div'); box.className = 'ps-box'; box.setAttribute('role', 'listbox'); document.body.appendChild(box); }
    active = input; results = list; sel = -1;
    box.innerHTML = list.length ? list.map(function (p, i) {
      var st = p.stock;
      return '<button type="button" class="ps-it" data-i="' + i + '"><div><b>' + esc(p.itemCode) + '</b>' +
        (p.brand ? '<span class="ps-tag">' + esc(p.brand) + '</span>' : '') +
        (p.grade ? '<span class="ps-tag g">' + esc(p.grade) + '</span>' : '') +
        (st ? '<span class="ps-tag ' + (st.total > 0 ? 'st' : 'st0') + '">Stock ' + num(st.total) + (st.hand ? ' · hand ' + num(st.hand) : '') + '</span>' : '') +
        (p.standardPrice ? '<span style="float:right;font-weight:700">₹' + num(p.standardPrice) + '</span>' : '') + '</div>' +
        '<div class="ps-s">' + esc([p.specification, p.productName !== p.specification ? p.productName : '', p.productType].filter(Boolean).join(' · ')) + '</div>' +
        (p.vendors && p.vendors.length ? '<div class="ps-s ps-v">Vendors: ' + p.vendors.map(function (v) {
          return esc(v.vendor) + (v.netPrice != null ? ' ₹' + num(v.netPrice) : '') + (v.stock != null ? ' (stock ' + num(v.stock) + ')' : '');
        }).join(' · ') + '</div>' : '') + '</button>';
    }).join('') : '<div class="ps-empty">No product matches — keep typing to enter it by hand.</div>';
    place();
  }
  function search(input) {
    var q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { closeBox(); return; }
    timer = setTimeout(function () {
      var my = ++seq;
      fetch(API + '/api/products/search?limit=15&q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + (token() || '') } })
        .then(function (r) { return r.json(); }).then(function (j) {
          if (my !== seq || document.activeElement !== input) return;
          show(input, (j.data && j.data.results) || []);
        }).catch(function () {});
    }, 220);
  }
  function choose(i) {
    var p = results[i], input = active;
    if (!p || !input) return;
    var row = input.closest('.item-row'), ins = rowInputs(row), info = rowInfo(input);
    closeBox();
    var spec = [p.specification || p.productName, p.grade ? 'Grade ' + p.grade : '', p.brand].filter(Boolean).join(' — ');
    function set(field, val) {
      if (!ins[field]) return;
      ins[field].value = val;
      info.fn(info.id, field, String(val));
    }
    set('productCode', p.itemCode);
    set('spec', spec);
    if (p.standardPrice > 0) {
      set('unitPrice', p.standardPrice);
      locked[info.app + ':' + info.id] = p.standardPrice;
    }
    applyLocks();
    if (ins.moq) ins.moq.focus();
  }

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.closest('.item-row')) return;
    var info = rowInfo(t);
    if (!info || (info.field !== 'productCode' && info.field !== 'spec')) return;
    search(t);
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!box || e.target !== active) return;
    var items = box.querySelectorAll('.ps-it');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach(function (x, k) { x.classList.toggle('on', k === sel); });
      if (items[sel]) items[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') closeBox();
  }, true);
  document.addEventListener('mousedown', function (e) {
    if (!box) return;
    var b = e.target.closest && e.target.closest('.ps-it');
    if (b && box.contains(b)) { e.preventDefault(); choose(+b.getAttribute('data-i')); return; }
    if (!box.contains(e.target) && e.target !== active) closeBox();
  }, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);

  // ── price locks ──────────────────────────────────────────────────────
  function applyLocks() {
    document.querySelectorAll('.item-row').forEach(function (row) {
      var ins = rowInputs(row), pi = ins.unitPrice;
      if (!pi) return;
      var info = rowInfo(pi), key = info.app + ':' + info.id;
      var isLocked = Object.prototype.hasOwnProperty.call(locked, key);
      pi.readOnly = isLocked;
      pi.classList.toggle('ps-locked', isLocked);
      pi.title = isLocked ? 'Price from the product list / approved price request — fixed' + (canUnlock ? ' (🔒 to unlock)' : '') : '';
      var btn = pi.nextElementSibling && pi.nextElementSibling.classList.contains('ps-lock') ? pi.nextElementSibling : null;
      if (isLocked && canUnlock && !btn) {
        // the price cell is a grid item: wrap so the lock button sits inside it
        var wrap = document.createElement('span'); wrap.style.cssText = 'position:relative;display:block';
        pi.parentNode.insertBefore(wrap, pi); wrap.appendChild(pi);
        btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ps-lock'; btn.textContent = '🔒'; btn.title = 'Unlock price';
        btn.addEventListener('click', function () { delete locked[key]; applyLocks(); pi.focus(); });
        wrap.appendChild(btn);
      } else if (!isLocked && btn) btn.remove();
    });
  }
  // Rows are re-rendered by the quotation app: re-apply locks each time.
  var mo = new MutationObserver(function () { applyLocks(); });
  function watch() { document.querySelectorAll('[id$="items-container"], #items-container').forEach(function (c) { mo.observe(c, { childList: true }); }); applyLocks(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  setInterval(watch, 3000); // forms can be created later (company switch)

  // Approved price-request prices are fixed too.
  window.productSuggestLock = function (app, id, price) { locked[app + ':' + id] = price; applyLocks(); };
  window.productSuggestUnlockAll = function (app) { Object.keys(locked).forEach(function (k) { if (!app || k.indexOf(app + ':') === 0) delete locked[k]; }); applyLocks(); };
})();
