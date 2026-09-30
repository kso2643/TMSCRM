/* ══════════════════════════════════════════════════════════════════════
   Orders — verbal commitments and purchase orders, with delivery
   tracking, for the compiled build.

   Every authenticated user sees the full list (same visibility model as
   Meetings/Appointments). Creating one self-assigns the engineer unless
   you're admin-tier and pick someone else. Editing/deleting needs to be
   the creator or admin-tier — matches OrderController.php exactly.

   List page: price/proforma and delivery are inline dropdowns; clicking a
   row (or the sales engineer's name) expands it to show the materials on
   the order, where the supplied ones are ticked off. All ticked = order
   complete; some = partially complete; none = not delivered — anything
   short of complete needs a reason (enforced by PATCH /orders/:id/supply).

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var ORDER_TYPES = [['VERBAL', 'Verbal'], ['PO', 'Purchase order']];
  var DELIVERY_STATUSES = [['PENDING', 'Pending'], ['DELIVERED', 'Delivered'],
                           ['PARTIALLY_DELIVERED', 'Partially delivered'], ['NOT_DELIVERED', 'Not delivered']];
  var STATUS_BADGE = { PENDING: 'badge-yellow', DELIVERED: 'badge-green', PARTIALLY_DELIVERED: 'badge-amber', NOT_DELIVERED: 'badge-red' };
  var PROFORMA_STATUSES = [['NOT_CONFIRMED', 'Not confirmed'], ['CONFIRMED', 'Confirmed']];
  var PROFORMA_BADGE = { NOT_CONFIRMED: 'badge-gray', CONFIRMED: 'badge-green' };
  var TYPE_BADGE = { VERBAL: 'badge-gray', PO: 'badge-blue' };
  var PROCUREMENT_STATUSES = [['NOT_ORDERED', 'Not ordered'], ['ORDERED', 'Ordered']];
  var PROCUREMENT_BADGE = { NOT_ORDERED: 'badge-gray', ORDERED: 'badge-blue' };

  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }
  function currentUser() {
    try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch (e) { return null; }
  }
  function isAdmin() {
    var u = currentUser();
    return !!u && ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].indexOf(u.role) !== -1; // matches is_admin_tier()
  }
  /** Mirrors OrderController::canEdit() — admin-tier, or the engineer the order belongs to. */
  function canEditOrder(o) {
    var u = currentUser();
    return isAdmin() || !!(o && o.engineer && u && o.engineer.id === u.id);
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // A few styles the compiled Tailwind CSS doesn't include (it only has the
  // classes the original React build used), scoped under an ox- prefix.
  function injectCss() {
    if (document.getElementById('orders-extra-css')) return;
    var st = document.createElement('style');
    st.id = 'orders-extra-css';
    st.textContent = [
      '.ox-nowrap{white-space:nowrap}',
      '.ox-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;align-items:end}',
      '@media(min-width:768px){.ox-filters{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '@media(min-width:1280px){.ox-filters{grid-template-columns:repeat(8,minmax(0,1fr))}}',
      '.ox-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}',
      '@media(min-width:768px){.ox-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '@media(min-width:1280px){.ox-stats{grid-template-columns:repeat(6,minmax(0,1fr))}}',
      '.ox-sel{width:auto;min-width:8.5rem;padding:.3rem 1.6rem .3rem .5rem;font-size:.78rem;font-weight:500;border-radius:.5rem;',
      '  border:1px solid #e2e8f0;background-color:#fff;color:#0f172a;cursor:pointer}',
      '.ox-sel:focus{outline:none;box-shadow:0 0 0 1px #1e3a5f}',
      '.dark .ox-sel{background-color:#0f172a;border-color:#334155;color:#f1f5f9}',
      '.ox-good{border-color:#86efac;background-color:#f0fdf4;color:#166534}',
      '.ox-warn{border-color:#fcd34d;background-color:#fffbeb;color:#92400e}',
      '.ox-bad{border-color:#fca5a5;background-color:#fef2f2;color:#991b1b}',
      '.ox-idle{border-color:#e2e8f0;background-color:#f8fafc;color:#475569}',
      '.dark .ox-good{background-color:rgba(22,101,52,.25);border-color:#166534;color:#bbf7d0}',
      '.dark .ox-warn{background-color:rgba(146,64,14,.25);border-color:#92400e;color:#fde68a}',
      '.dark .ox-bad{background-color:rgba(153,27,27,.25);border-color:#991b1b;color:#fecaca}',
      '.dark .ox-idle{background-color:#1e293b;border-color:#334155;color:#cbd5e1}',
      '.ox-caret{display:inline-block;width:1rem;transition:transform .15s;color:#94a3b8}',
      '.ox-open .ox-caret{transform:rotate(90deg)}',
      '.ox-open>td{background:#f8fafc}.dark .ox-open>td{background:rgba(30,41,59,.5)}',
      '.ox-expand>td{background:#f8fafc;border-bottom:1px solid #e2e8f0}',
      '.dark .ox-expand>td{background:rgba(30,41,59,.5);border-color:#334155}',
      '.ox-eng{color:#1e3a5f;font-weight:500;text-decoration:underline dotted;text-underline-offset:3px}',
      '.dark .ox-eng{color:#93c5fd}',
      '.ox-check{width:1.05rem;height:1.05rem;accent-color:#1e3a5f;cursor:pointer;flex-shrink:0}',
      '.ox-check:disabled{cursor:default}',
      '.ox-item{display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;border-top:1px solid #f1f5f9}',
      '.dark .ox-item{border-color:#1e293b}',
      '.ox-item:first-child{border-top:0}',
      '.ox-item-on{background:rgba(34,197,94,.08)}',
      '.ox-overdue{color:#dc2626;font-weight:600}',
      '.ox-dialog{max-width:40rem}',
      '.ox-expand-grid{display:grid;gap:1rem}',
      '@media(min-width:1024px){.ox-expand-grid{grid-template-columns:3fr 2fr}}',
      '.ox-muted-link{font-size:.75rem;font-weight:500;color:#1e3a5f;cursor:pointer;background:none;border:0;padding:0}',
      '.dark .ox-muted-link{color:#93c5fd}',
      '.ox-btn-disabled{opacity:.5;cursor:not-allowed}',
      '.ox-pl{padding-left:1rem}',
      '.ox-expand-inner{position:sticky;left:1rem;text-align:left}',
      // Tailwind utilities this file already used that the compiled CSS lacks:
      '.mr-auto{margin-right:auto}.mt-5{margin-top:1.25rem}',
      '.hover\\:text-red-500:hover{color:#ef4444}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /** Tone class for an inline status dropdown, so it reads like a badge at a glance. */
  function deliveryTone(s) { return { DELIVERED: 'ox-good', PARTIALLY_DELIVERED: 'ox-warn', NOT_DELIVERED: 'ox-bad' }[s] || 'ox-idle'; }
  function proformaTone(s) { return s === 'CONFIRMED' ? 'ox-good' : 'ox-idle'; }

  /** Re-derives the list-only summary fields from a full order returned by a PATCH/GET. */
  function toListRow(o) {
    var items = o.items || [];
    o.productSummary = items.map(function (i) { return i.productName; }).join(', ');
    o.itemCount = items.length;
    o.suppliedCount = items.filter(function (i) { return i.supplied; }).length;
    return o;
  }

  function api(method, path, body) {
    var opts = {
      method: method,
      headers: { Authorization: 'Bearer ' + (token() || '') }
    };
    if (body instanceof FormData) {
      opts.body = body; // browser sets the multipart Content-Type + boundary itself
    } else if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + '/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.message) || 'Request failed');
        return j;
      });
    });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function fmtDate(d) {
    if (!d) return '—';
    var s = /[Zz]|[+-]\d\d:?\d\d$/.test(d) ? d : String(d).replace(' ', 'T');
    var dt = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function labelOf(pairs, v) { var m = pairs.filter(function (p) { return p[0] === v; })[0]; return m ? m[1] : v; }

  var INPUT = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
              'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 ' +
              'focus:outline-none focus:ring-1 focus:ring-primary';
  var selectCls = INPUT;

  // ── list page ────────────────────────────────────────────────────────
  function mount(root) {
    injectCss();
    var all = [];
    var from = '', to = '', engineerId = '', deliveryStatus = '', orderType = '', procurementStatus = '', proformaStatus = '';
    var engineers = [];
    var expanded = {};    // orderId -> true while its row is open
    var presets = {};     // orderId -> delivery status picked from the dropdown that needs the materials panel
    var fullOrders = {};  // orderId -> full order (with items), fetched on expand
    var flash = '';

    var stats = el('div', { class: 'ox-stats' });
    var filters = el('div', { class: 'ox-filters' });
    var flashBox = el('div');
    // Plain wrapper — loading/error/table each render their own card inside it.
    var body = el('div', {}, [el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' })]);

    root.appendChild(el('div', { class: 'space-y-5' }, [
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('h1', { class: 'page-title', text: 'Orders' }),
        el('button', { class: 'btn-primary', text: '+ New order', onclick: function () { openOrderDialog(null, load); } })
      ]),
      stats, filters, flashBox, body
    ]));

    function showFlash(msg) {
      flash = msg || '';
      flashBox.innerHTML = '';
      if (flash) {
        flashBox.appendChild(el('div', {
          class: 'text-sm px-3 py-2 rounded-lg bg-red-50 text-red-600 flex items-center justify-between gap-3'
        }, [el('span', { text: flash }), el('button', { class: 'ox-muted-link', text: 'Dismiss', onclick: function () { showFlash(''); } })]));
      }
    }

    function query() {
      var q = [];
      if (from) q.push('from=' + from);
      if (to) q.push('to=' + to);
      if (engineerId) q.push('engineerId=' + encodeURIComponent(engineerId));
      if (deliveryStatus) q.push('deliveryStatus=' + deliveryStatus);
      if (orderType) q.push('orderType=' + orderType);
      if (procurementStatus) q.push('procurementStatus=' + procurementStatus);
      if (proformaStatus) q.push('proformaStatus=' + proformaStatus);
      q.push('limit=100');
      return q.join('&');
    }

    function load() {
      body.innerHTML = ''; body.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' }));
      api('GET', '/orders?' + query()).then(function (res) {
        all = (res.data && res.data.items) || [];
        fullOrders = {};
        renderStats();
        renderTable();
      }).catch(function (e) {
        body.innerHTML = '';
        body.appendChild(el('div', { class: 'card p-10 text-center text-muted' }, [
          el('p', { class: 'font-medium text-red-600', text: 'Could not load orders' }),
          el('p', { class: 'text-sm mt-1', text: e.message }),
          el('button', { class: 'btn-secondary btn-sm mt-4', text: 'Try again', onclick: load })
        ]));
      });
    }

    /** Swaps an updated order into the list and redraws. */
    function applyUpdate(order) {
      toListRow(order);
      fullOrders[order.id] = order;
      all = all.map(function (o) { return o.id === order.id ? order : o; });
      renderStats();
      renderTable();
    }

    function patchOrder(id, path, payload) {
      showFlash('');
      return api('PATCH', '/orders/' + id + '/' + path, payload).then(function (res) {
        applyUpdate(res.data.order);
        return res.data.order;
      }).catch(function (e) { showFlash(e.message); renderTable(); throw e; });
    }

    function renderStats() {
      stats.innerHTML = '';
      function count(fn) { return String(all.filter(fn).length); }
      [['Total orders', String(all.length)],
       ['Pending', count(function (o) { return o.deliveryStatus === 'PENDING'; })],
       ['Partially complete', count(function (o) { return o.deliveryStatus === 'PARTIALLY_DELIVERED'; })],
       ['Delivered', count(function (o) { return o.deliveryStatus === 'DELIVERED'; })],
       ['Not delivered', count(function (o) { return o.deliveryStatus === 'NOT_DELIVERED'; })],
       ['Proforma confirmed', count(function (o) { return o.proformaStatus === 'CONFIRMED'; })]
      ].forEach(function (s) {
        stats.appendChild(el('div', { class: 'card p-4' }, [
          el('p', { class: 'text-xs text-muted', text: s[0] }),
          el('p', { class: 'mt-1 text-xl font-bold text-slate-900 dark:text-slate-100', text: s[1] })
        ]));
      });
    }

    function renderFilters() {
      filters.innerHTML = '';
      function labelled(label, control) {
        return el('label', { class: 'block' }, [el('span', { class: 'text-xs text-muted', text: label }), el('div', { class: 'mt-1' }, [control])]);
      }
      function sel(first, pairs, value, onPick) {
        var s2 = el('select', { class: selectCls }, [el('option', { value: '', text: first })]
          .concat(pairs.map(function (p) { return el('option', { value: p[0], text: p[1] }); })));
        s2.value = value;
        s2.addEventListener('change', function () { onPick(s2.value); load(); });
        return s2;
      }
      var fromI = el('input', { type: 'date', class: INPUT });
      fromI.value = from;
      fromI.addEventListener('change', function () { from = fromI.value; load(); });
      var toI = el('input', { type: 'date', class: INPUT });
      toI.value = to;
      toI.addEventListener('change', function () { to = toI.value; load(); });

      [labelled('From', fromI), labelled('To', toI),
       labelled('Sales engineer', sel('All engineers', engineers.map(function (e2) { return [e2.id, e2.name]; }), engineerId, function (v) { engineerId = v; })),
       labelled('Delivery', sel('All delivery statuses', DELIVERY_STATUSES, deliveryStatus, function (v) { deliveryStatus = v; })),
       labelled('Price / proforma', sel('All', PROFORMA_STATUSES, proformaStatus, function (v) { proformaStatus = v; })),
       labelled('Procurement', sel('All procurement statuses', PROCUREMENT_STATUSES, procurementStatus, function (v) { procurementStatus = v; })),
       labelled('Type', sel('All types', ORDER_TYPES, orderType, function (v) { orderType = v; })),
       el('div', { class: 'flex items-end' }, [el('button', {
         class: 'btn-secondary w-full', text: 'Clear filters',
         onclick: function () { from = to = engineerId = deliveryStatus = orderType = procurementStatus = proformaStatus = ''; renderFilters(); load(); }
       })])
      ].forEach(function (n) { filters.appendChild(n); });
    }

    function stop(e) { e.stopPropagation(); }

    function proformaCell(o) {
      if (!canEditOrder(o)) {
        return el('span', { class: 'badge ' + PROFORMA_BADGE[o.proformaStatus], text: labelOf(PROFORMA_STATUSES, o.proformaStatus) });
      }
      var s2 = el('select', { class: 'ox-sel ' + proformaTone(o.proformaStatus), 'aria-label': 'Price / proforma confirmed', onclick: stop },
        PROFORMA_STATUSES.map(function (p) { return el('option', { value: p[0], text: p[1] }); }));
      s2.value = o.proformaStatus || 'NOT_CONFIRMED';
      s2.addEventListener('change', function () { patchOrder(o.id, 'proforma', { proformaStatus: s2.value }).catch(function () {}); });
      return s2;
    }

    function deliveryCell(o) {
      if (!canEditOrder(o)) {
        return el('span', { class: 'badge ' + STATUS_BADGE[o.deliveryStatus], text: labelOf(DELIVERY_STATUSES, o.deliveryStatus) });
      }
      var s2 = el('select', { class: 'ox-sel ' + deliveryTone(o.deliveryStatus), 'aria-label': 'Delivery status', onclick: stop },
        DELIVERY_STATUSES.map(function (p) { return el('option', { value: p[0], text: p[1] }); }));
      s2.value = o.deliveryStatus;
      s2.addEventListener('change', function () {
        var v = s2.value;
        if (v === 'DELIVERED' || v === 'PENDING') {
          patchOrder(o.id, 'delivery', { deliveryStatus: v }).catch(function () {});
        } else {
          // Partial / not delivered need the materials + a reason — open the row for that.
          presets[o.id] = v;
          expanded[o.id] = true;
          renderTable();
        }
      });
      return s2;
    }

    function etaCell(o) {
      var overdue = o.expectedDeliveryDate && o.deliveryStatus !== 'DELIVERED' && String(o.expectedDeliveryDate).slice(0, 10) < todayIso();
      if (isAdmin()) {
        var d = el('input', { type: 'date', class: 'ox-sel ' + (overdue ? 'ox-bad' : 'ox-idle'), 'aria-label': 'Expected date', onclick: stop,
                              title: overdue ? 'Overdue' : '' });
        d.value = o.expectedDeliveryDate ? String(o.expectedDeliveryDate).slice(0, 10) : '';
        d.addEventListener('change', function () { patchOrder(o.id, 'eta', { expectedDeliveryDate: d.value || null }).catch(function () {}); });
        return d;
      }
      if (!o.expectedDeliveryDate) return el('span', { class: 'text-muted', text: '—' });
      return el('span', { class: overdue ? 'ox-overdue' : '', text: fmtDate(o.expectedDeliveryDate) + (overdue ? ' · overdue' : '') });
    }

    function renderTable() {
      var heads = ['', 'Customer', 'Sales engineer', 'Type', 'Order date', 'Expected date', 'Price / proforma', 'Procurement', 'Delivery', 'Materials'];
      var tbody = el('tbody');
      if (!all.length) {
        tbody.appendChild(el('tr', {}, [el('td', {
          colspan: String(heads.length), class: 'px-4 py-10 text-center text-muted', text: 'No orders found.'
        })]));
      } else {
        all.forEach(function (o) {
          var open = !!expanded[o.id];
          var procCell = el('td', { class: 'px-3 py-3 ox-nowrap' }, [
            el('span', { class: 'badge ' + PROCUREMENT_BADGE[o.procurementStatus], text: labelOf(PROCUREMENT_STATUSES, o.procurementStatus) })
          ]);
          var supplied = o.itemCount ? (o.suppliedCount || 0) + ' / ' + o.itemCount + ' supplied' : '—';
          var tr = el('tr', { class: 'table-row cursor-pointer' + (open ? ' ox-open' : ''), 'aria-expanded': open ? 'true' : 'false' }, [
            el('td', { class: 'ox-pl py-3' }, [el('span', { class: 'ox-caret', text: '▸' })]),
            el('td', { class: 'px-3 py-3 font-medium ox-nowrap', text: (o.customer && o.customer.companyName) || '—' }),
            el('td', { class: 'px-3 py-3 ox-nowrap' }, [el('span', { class: 'ox-eng', title: 'Show materials', text: (o.engineer && o.engineer.name) || '—' })]),
            el('td', { class: 'px-3 py-3' }, [el('span', { class: 'badge ' + TYPE_BADGE[o.orderType], text: labelOf(ORDER_TYPES, o.orderType) })]),
            el('td', { class: 'px-3 py-3 ox-nowrap', text: fmtDate(o.orderDate) }),
            el('td', { class: 'px-3 py-3 ox-nowrap' }, [etaCell(o)]),
            el('td', { class: 'px-3 py-3' }, [proformaCell(o)]),
            procCell,
            el('td', { class: 'px-3 py-3' }, [deliveryCell(o)]),
            el('td', { class: 'px-3 py-3 ox-nowrap text-muted', title: o.productSummary || '', text: supplied })
          ]);
          tr.addEventListener('click', function () {
            expanded[o.id] = !expanded[o.id];
            if (!expanded[o.id]) delete presets[o.id];
            renderTable();
          });
          tbody.appendChild(tr);
          if (open) tbody.appendChild(expandedRow(o, heads.length));
        });
      }
      var scroller = el('div', { class: 'overflow-x-auto' }, [
        el('table', { class: 'w-full text-sm' }, [
          el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [
            el('tr', {}, heads.map(function (h) { return el('th', { class: 'table-head text-left px-3 py-3 ox-nowrap', text: h }); }))
          ]),
          tbody
        ])
      ]);
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'card overflow-hidden' }, [scroller]));
      fitExpanded(scroller);
    }

    // The table can be wider than the screen (it scrolls sideways); keep an
    // expanded row's panel pinned to the visible width so nothing in it is
    // cut off or needs scrolling to reach.
    function fitExpanded(scroller) {
      var w = scroller.clientWidth;
      var panels = scroller.querySelectorAll('.ox-expand-inner');
      for (var i = 0; i < panels.length; i++) panels[i].style.width = Math.max(260, w - 32) + 'px';
    }
    window.addEventListener('resize', function () {
      var sc = body.querySelector('.overflow-x-auto');
      if (sc) fitExpanded(sc);
    });

    function expandedRow(o, span) {
      var inner = el('div', { class: 'ox-expand-inner' });
      var cell = el('td', { colspan: String(span), class: 'py-4' }, [inner]);
      var tr = el('tr', { class: 'ox-expand' }, [cell]);
      function fill(order) {
        inner.innerHTML = '';
        inner.appendChild(orderDetailPanel(order, {
          preset: presets[order.id],
          onSaved: function (updated) { delete presets[order.id]; applyUpdate(updated); },
          onCancelPreset: function () { delete presets[order.id]; renderTable(); },
          onOpen: function () { openOrderDialog(order.id, load); }
        }));
      }
      if (fullOrders[o.id]) {
        fill(fullOrders[o.id]);
      } else {
        inner.appendChild(el('p', { class: 'text-sm text-muted', text: 'Loading materials…' }));
        api('GET', '/orders/' + o.id).then(function (res) {
          fullOrders[o.id] = res.data.order;
          fill(res.data.order);
        }).catch(function (e) {
          inner.innerHTML = '';
          inner.appendChild(el('p', { class: 'text-sm text-red-600', text: e.message }));
        });
      }
      return tr;
    }

    api('GET', '/orders/engineers').then(function (res) {
      engineers = (res.data && res.data.engineers) || [];
      renderFilters();
    }).catch(function () {});

    renderFilters();
    load();
  }

  /** The expanded-row content: materials checklist on the left, order facts on the right. */
  function orderDetailPanel(o, opts) {
    var facts = el('div', { class: 'space-y-3 text-sm' });
    facts.appendChild(el('div', {}, [
      el('span', { class: 'text-xs text-muted block', text: 'Order placed by' }),
      el('span', { class: 'font-medium', text: ((o.engineer && o.engineer.name) || '—') + ' · ' + fmtDate(o.orderDate) })
    ]));
    if (o.customer && (o.customer.contactPerson || o.customer.contactNumber)) {
      facts.appendChild(el('div', {}, [
        el('span', { class: 'text-xs text-muted block', text: 'Customer contact' }),
        el('span', { text: [o.customer.contactPerson, o.customer.contactNumber].filter(Boolean).join(' · ') })
      ]));
    }
    if (o.orderType === 'PO' && o.poDocument) {
      facts.appendChild(el('a', {
        href: API + o.poDocument.url, target: '_blank', rel: 'noopener', class: 'text-primary font-medium block'
      }, ['📄 ' + o.poDocument.originalName]));
    } else if (o.orderType === 'VERBAL' && o.verbalDetails) {
      facts.appendChild(el('div', {}, [
        el('span', { class: 'text-xs text-muted block', text: 'Verbally agreed' }),
        el('span', { class: 'whitespace-pre-wrap', text: o.verbalDetails })
      ]));
    }
    if (o.notes) facts.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted block', text: 'Notes' }), el('span', { class: 'whitespace-pre-wrap', text: o.notes })]));
    if (o.deliveredDate && o.deliveryStatus !== 'PENDING') {
      facts.appendChild(el('p', { class: 'text-xs text-muted', text: 'Last supplied ' + fmtDate(o.deliveredDate) }));
    }
    facts.appendChild(el('button', { class: 'btn-secondary btn-sm', text: 'Open full order', onclick: opts.onOpen }));

    return el('div', { class: 'ox-expand-grid' }, [
      supplyPanel(o, { preset: opts.preset, onSaved: opts.onSaved, onCancelPreset: opts.onCancelPreset }),
      facts
    ]);
  }

  /**
   * Materials checklist. Tick what was supplied, then one button saves it:
   * all ticked = complete, some = partially complete, none = not delivered.
   * Anything short of complete requires a reason. Read-only for people who
   * can't edit the order.
   */
  function supplyPanel(o, opts) {
    opts = opts || {};
    var editable = canEditOrder(o);
    var items = o.items || [];
    var picked = {};
    items.forEach(function (i) {
      picked[i.id] = opts.preset === 'NOT_DELIVERED' ? false : !!i.supplied;
    });
    var reason = o.deliveryStatus === 'PARTIALLY_DELIVERED' || o.deliveryStatus === 'NOT_DELIVERED' ? (o.notDeliveredReason || '') : '';
    var err = '';
    var saving = false;
    var wrap = el('div', { class: 'space-y-3' });

    function nPicked() { return items.filter(function (i) { return picked[i.id]; }).length; }

    function render() {
      wrap.innerHTML = '';
      var n = nPicked(), total = items.length;
      wrap.appendChild(el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('div', {}, [
          el('span', { class: 'text-sm font-semibold text-slate-900 dark:text-slate-100', text: 'Materials supplied' }),
          el('span', { class: 'text-xs text-muted ml-2', text: n + ' of ' + total + ' selected' })
        ]),
        editable && total ? el('div', { class: 'flex gap-3' }, [
          el('button', { class: 'ox-muted-link', text: 'Select all', onclick: function (e) { e.stopPropagation(); items.forEach(function (i) { picked[i.id] = true; }); render(); } }),
          el('button', { class: 'ox-muted-link', text: 'Clear', onclick: function (e) { e.stopPropagation(); items.forEach(function (i) { picked[i.id] = false; }); render(); } })
        ]) : null
      ]));

      if (opts.preset) {
        wrap.appendChild(el('div', { class: 'text-xs px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800' }, [
          opts.preset === 'NOT_DELIVERED'
            ? 'Marking as not delivered — give the reason below and save.'
            : 'Tick the materials that were supplied, give the reason for the rest, and save.'
        ]));
      }

      var list = el('div', { class: 'rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900' });
      if (!total) list.appendChild(el('p', { class: 'px-3 py-2 text-sm text-muted', text: 'No products on this order.' }));
      items.forEach(function (i) {
        var cb = el('input', { type: 'checkbox', class: 'ox-check', 'aria-label': 'Supplied: ' + i.productName });
        cb.checked = !!picked[i.id];
        cb.disabled = !editable;
        cb.addEventListener('change', function () { picked[i.id] = cb.checked; render(); });
        var row = el('label', { class: 'ox-item' + (picked[i.id] ? ' ox-item-on' : '') + (editable ? ' cursor-pointer' : '') }, [
          cb,
          el('span', { class: 'flex-1 min-w-0' }, [
            el('span', { class: 'block text-sm text-slate-900 dark:text-slate-100', text: i.productName + (i.itemCode ? ' (' + i.itemCode + ')' : '') }),
            i.supplied && i.suppliedAt ? el('span', { class: 'block text-xs text-muted', text: 'Supplied ' + fmtDate(i.suppliedAt) }) : null
          ]),
          el('span', { class: 'text-sm text-muted ox-nowrap', text: i.quantity + (i.unit ? ' ' + i.unit : '') })
        ]);
        row.addEventListener('click', function (e) { e.stopPropagation(); });
        list.appendChild(row);
      });
      wrap.appendChild(list);

      if (!editable) {
        if (reason) wrap.appendChild(el('p', { class: 'text-sm text-amber-800', text: 'Reason: ' + reason }));
        return;
      }

      var complete = total > 0 && n === total;
      if (!complete && total) {
        var ta = el('textarea', { class: INPUT, rows: '2', placeholder: n ? 'Why is the order only partially complete?' : 'Why wasn’t it delivered?' });
        ta.value = reason;
        ta.addEventListener('input', function () { reason = ta.value; });
        ta.addEventListener('click', function (e) { e.stopPropagation(); });
        wrap.appendChild(el('div', {}, [
          el('span', { class: 'text-xs font-medium text-amber-800', text: n ? 'Reason for partial completion (required)' : 'Reason for non-delivery (required)' }),
          el('div', { class: 'mt-1' }, [ta])
        ]));
      }
      if (err) wrap.appendChild(el('p', { class: 'text-xs text-red-600', text: err }));

      var label = complete ? '✓ Mark order complete' : (n ? 'Save as partially complete' : 'Mark not delivered');
      var btns = el('div', { class: 'flex gap-2 justify-end flex-wrap' });
      if (opts.preset && opts.onCancelPreset) {
        btns.appendChild(el('button', { class: 'btn-secondary btn-sm', text: 'Cancel', onclick: function (e) { e.stopPropagation(); opts.onCancelPreset(); } }));
      }
      if (total) {
        btns.appendChild(el('button', {
          class: 'btn-primary btn-sm' + (saving ? ' ox-btn-disabled' : ''), text: saving ? 'Saving…' : label,
          onclick: function (e) { e.stopPropagation(); save(); }
        }));
      }
      wrap.appendChild(btns);
    }

    function save() {
      if (saving) return;
      err = '';
      var ids = items.filter(function (i) { return picked[i.id]; }).map(function (i) { return i.id; });
      if (ids.length < items.length && !reason.trim()) {
        err = ids.length ? 'Please give a reason why the order is only partially complete.' : 'Please give a reason for the non-delivery.';
        return render();
      }
      saving = true; render();
      api('PATCH', '/orders/' + o.id + '/supply', { suppliedItemIds: ids, reason: reason.trim() }).then(function (res) {
        saving = false;
        if (opts.onSaved) opts.onSaved(res.data.order);
      }).catch(function (e2) { saving = false; err = e2.message; render(); });
    }

    render();
    return wrap;
  }

  // ── create / detail-edit dialog ─────────────────────────────────────
  // orderId === null -> create mode. Otherwise loads and shows/edits it.
  function openOrderDialog(orderId, onChange) {
    injectCss();
    var overlay = el('div', { class: 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4' });
    var card = el('div', {
      class: 'card w-full ox-dialog p-5 rounded-b-none sm:rounded-xl max-h-[92vh] overflow-y-auto',
      role: 'dialog', 'aria-modal': 'true'
    });
    overlay.appendChild(card);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    card.appendChild(el('div', { class: 'p-6 text-center text-muted', text: 'Loading…' }));
    document.body.appendChild(overlay);

    if (orderId) {
      api('GET', '/orders/' + orderId).then(function (res) {
        buildForm(res.data.order, false);
      }).catch(function (e) {
        card.innerHTML = '';
        card.appendChild(el('div', { class: 'p-2 text-center text-muted', text: e.message }));
      });
    } else {
      buildForm(null, true);
    }

    function buildForm(order, editing) {
      var isCreate = !order;
      var canEdit = isCreate || isAdmin() || (order.engineer && currentUser() && order.engineer.id === currentUser().id);
      editing = editing && canEdit;

      var state = {
        customerId: order ? order.customer.id : '', customerLabel: order ? order.customer.companyName : '',
        orderType: order ? order.orderType : 'VERBAL',
        verbalDetails: order ? order.verbalDetails || '' : '',
        orderDate: order ? order.orderDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
        notes: order ? order.notes || '' : '',
        engineerId: order ? order.engineer.id : (currentUser() && currentUser().id),
        items: order && order.items ? order.items.map(function (i) {
          return { productId: i.productId, itemCode: i.itemCode, productName: i.productName, unit: i.unit, quantity: i.quantity };
        }) : [],
        file: null
      };
      var errMsg = '';
      var dialogEngineers = null;

      function render() {
        card.innerHTML = '';
        card.appendChild(header());
        var body2 = el('div', { class: 'space-y-4' });

        if (!isCreate && !editing) {
          body2.appendChild(readOnlyView(order));
        } else {
          body2.appendChild(editableForm());
        }
        if (errMsg) body2.appendChild(el('p', { class: 'text-xs text-red-600 dark:text-red-400', text: errMsg }));
        card.appendChild(body2);
        card.appendChild(footer());
      }

      function header() {
        var title = isCreate ? 'New order' : (order.customer.companyName || 'Order');
        return el('div', { class: 'flex items-start justify-between mb-4' }, [
          el('div', {}, [
            el('h2', { class: 'section-title mb-0', text: title }),
            !isCreate ? el('p', { class: 'text-xs text-muted mt-0.5', text: fmtDate(order.orderDate) + ' · ' + (order.engineer.name || '') }) : null
          ]),
          el('button', { class: 'p-1 rounded text-slate-400 hover:text-slate-600', 'aria-label': 'Close', text: '✕', onclick: close })
        ]);
      }

      function readOnlyView(o) {
        var wrap = el('div', { class: 'space-y-4' });
        wrap.appendChild(el('div', { class: 'flex items-center gap-2 flex-wrap' }, [
          el('span', { class: 'badge ' + TYPE_BADGE[o.orderType], text: labelOf(ORDER_TYPES, o.orderType) }),
          el('span', { class: 'badge ' + PROCUREMENT_BADGE[o.procurementStatus], text: labelOf(PROCUREMENT_STATUSES, o.procurementStatus) }),
          el('span', { class: 'badge ' + STATUS_BADGE[o.deliveryStatus], text: labelOf(DELIVERY_STATUSES, o.deliveryStatus) }),
          el('span', { class: 'badge ' + PROFORMA_BADGE[o.proformaStatus], text: 'Proforma: ' + labelOf(PROFORMA_STATUSES, o.proformaStatus) })
        ]));

        // Price / proforma confirmed? — anyone who can edit the order.
        if (canEdit) {
          wrap.appendChild(el('div', { class: 'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700' }, [
            el('span', { class: 'text-xs text-muted', text: 'Price / proforma confirmed?' }),
            el('div', { class: 'flex gap-2' }, PROFORMA_STATUSES.map(function (s) {
              return el('button', {
                class: (o.proformaStatus === s[0] ? 'btn-primary' : 'btn-secondary') + ' btn-sm', text: s[1],
                onclick: function () { patch(o.id, 'proforma', { proformaStatus: s[0] }); }
              });
            }))
          ]));
        }

        // Procurement (has the company ordered this from its own supplier?)
        // and expected arrival — everyone sees both, so engineers can tell
        // the customer; only admin-tier gets the controls to set them.
        if (isAdmin()) {
          var procRow = el('div', { class: 'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700' }, [
            el('span', { class: 'text-xs text-muted', text: 'Ordered from our supplier?' }),
            el('div', { class: 'flex gap-2' }, PROCUREMENT_STATUSES.map(function (s) {
              return el('button', {
                class: o.procurementStatus === s[0] ? 'btn-primary' : 'btn-secondary', text: s[1],
                onclick: function () { setProcurement(o.id, s[0]); }
              });
            }))
          ]);
          wrap.appendChild(procRow);
        }

        var etaText = o.expectedDeliveryDate ? fmtDate(o.expectedDeliveryDate) : (o.procurementStatus === 'ORDERED' ? 'Not set yet' : '—');
        var etaRow = el('div', { class: 'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700' }, [
          el('div', {}, [
            el('span', { class: 'text-xs text-muted block', text: 'Expected arrival' }),
            el('span', { class: 'text-sm font-medium text-slate-900 dark:text-slate-100', text: etaText })
          ])
        ]);
        if (isAdmin()) {
          var etaInput = el('input', { type: 'date', class: INPUT, style: 'max-width:150px', 'aria-label': 'Expected arrival date' });
          etaInput.value = o.expectedDeliveryDate ? String(o.expectedDeliveryDate).slice(0, 10) : '';
          etaRow.appendChild(el('div', { class: 'flex items-center gap-2' }, [
            etaInput,
            el('button', { class: 'btn-secondary', text: 'Set', onclick: function () { setEta(o.id, etaInput.value || null); } })
          ]));
        }
        wrap.appendChild(etaRow);

        if (o.orderType === 'PO' && o.poDocument) {
          wrap.appendChild(el('a', {
            href: API + o.poDocument.url, target: '_blank', rel: 'noopener',
            class: 'flex items-center gap-2 text-sm text-primary dark:text-primary-300 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700'
          }, ['📄 ' + o.poDocument.originalName]));
        } else if (o.orderType === 'VERBAL') {
          wrap.appendChild(el('div', { class: 'text-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50' }, [o.verbalDetails || '—']));
        }

        if (o.notes) wrap.appendChild(el('p', { class: 'text-sm text-muted whitespace-pre-wrap', text: o.notes }));

        // Materials checklist — tick what was supplied; complete / partial / not delivered
        // is derived from the ticks, with a required reason for anything short of complete.
        wrap.appendChild(supplyPanel(o, {
          onSaved: function (updated) { order = updated; errMsg = ''; render(); if (onChange) onChange(); }
        }));

        if (o.deliveredDate && (o.deliveryStatus === 'DELIVERED' || o.deliveryStatus === 'PARTIALLY_DELIVERED')) {
          wrap.appendChild(el('p', { class: 'text-xs text-muted', text: 'Last supplied ' + fmtDate(o.deliveredDate) }));
        }
        if (canEdit && o.deliveryStatus !== 'PENDING') {
          wrap.appendChild(el('div', { class: 'flex justify-end' }, [el('button', {
            class: 'btn-ghost btn-sm', text: 'Reset to pending',
            onclick: function () { setDelivery(o.id, 'PENDING'); }
          })]));
        }
        return wrap;
      }

      function setDelivery(id, status, reason) {
        var payload = { deliveryStatus: status };
        if (reason) payload.notDeliveredReason = reason;
        api('PATCH', '/orders/' + id + '/delivery', payload).then(function (res) {
          order = res.data.order;
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function setEta(id, date) {
        api('PATCH', '/orders/' + id + '/eta', { expectedDeliveryDate: date }).then(function (res) {
          order = res.data.order;
          errMsg = '';
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function setProcurement(id, status) {
        api('PATCH', '/orders/' + id + '/procurement', { procurementStatus: status }).then(function (res) {
          order = res.data.order;
          errMsg = '';
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function patch(id, path, payload) {
        api('PATCH', '/orders/' + id + '/' + path, payload).then(function (res) {
          order = res.data.order;
          errMsg = '';
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      // ── editable form (create, or edit-mode on an existing order) ────
      var custResults = [];
      function editableForm() {
        var wrap = el('div', { class: 'space-y-4' });

        // Customer picker
        if (state.customerId) {
          wrap.appendChild(el('div', { class: 'flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50' }, [
            el('span', { text: state.customerLabel }),
            el('button', { class: 'text-primary dark:text-primary-300 text-xs font-medium', text: 'Change', onclick: function () { state.customerId = ''; render(); } })
          ]));
        } else {
          var custInput = el('input', { class: INPUT, placeholder: 'Search by company or contact name…' });
          var custList = el('div', { class: 'mt-1 space-y-1' });
          var t;
          custInput.addEventListener('input', function () {
            clearTimeout(t);
            var q = custInput.value.trim();
            if (!q) { custList.innerHTML = ''; return; }
            t = setTimeout(function () {
              api('GET', '/customers?search=' + encodeURIComponent(q) + '&limit=8').then(function (res) {
                custResults = (res.data && res.data.items) || [];
                custList.innerHTML = '';
                custResults.forEach(function (c) {
                  custList.appendChild(el('button', {
                    class: 'block w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800',
                    text: c.companyName + (c.contactPerson ? ' — ' + c.contactPerson : ''),
                    onclick: function () { state.customerId = c.id; state.customerLabel = c.companyName; render(); }
                  }));
                });
              }).catch(function () {});
            }, 300);
          });
          wrap.appendChild(el('div', {}, [
            el('span', { class: 'text-xs text-muted', text: 'Customer' }),
            el('div', { class: 'mt-1' }, [custInput, custList])
          ]));
        }

        // Order type
        var typeRow = el('div', { class: 'flex gap-2' });
        ORDER_TYPES.forEach(function (t) {
          typeRow.appendChild(el('button', {
            class: (state.orderType === t[0] ? 'btn-primary' : 'btn-secondary'), text: t[1],
            onclick: function () { state.orderType = t[0]; render(); }
          }));
        });
        wrap.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Type' }), el('div', { class: 'mt-1' }, [typeRow])]));

        if (state.orderType === 'PO') {
          var fileLabel = state.file ? state.file.name : (order && order.poDocument ? order.poDocument.originalName + ' (current)' : 'No file chosen');
          var fileInput = el('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'hidden' });
          fileInput.addEventListener('change', function () { state.file = fileInput.files[0] || null; render(); });
          wrap.appendChild(el('div', {}, [
            el('span', { class: 'text-xs text-muted', text: 'Purchase order document' }),
            el('div', { class: 'mt-1 flex items-center gap-2' }, [
              el('button', { class: 'btn-secondary', text: 'Choose file', onclick: function () { fileInput.click(); } }),
              el('span', { class: 'text-xs text-muted truncate', text: fileLabel }),
              fileInput
            ])
          ]));
        } else {
          var ta2 = el('textarea', { class: INPUT, rows: '2', placeholder: 'What was agreed on the call / in person?' });
          ta2.value = state.verbalDetails;
          ta2.addEventListener('input', function () { state.verbalDetails = ta2.value; });
          wrap.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Verbal details' }), el('div', { class: 'mt-1' }, [ta2])]));
        }

        // Order date + engineer (admin only)
        var row = el('div', { class: 'grid grid-cols-2 gap-3' });
        var dateI = el('input', { type: 'date', class: INPUT });
        dateI.value = state.orderDate;
        dateI.addEventListener('input', function () { state.orderDate = dateI.value; });
        row.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Order date' }), el('div', { class: 'mt-1' }, [dateI])]));
        if (isAdmin()) {
          var engSel = el('select', { class: selectCls });
          function fillEngSel(list) {
            engSel.innerHTML = '';
            list.forEach(function (e2) {
              engSel.appendChild(el('option', { value: e2.id, text: e2.name, selected: e2.id === state.engineerId ? '' : null }));
            });
            engSel.value = state.engineerId;
          }
          if (dialogEngineers) {
            fillEngSel(dialogEngineers);
          } else {
            api('GET', '/orders/engineers').then(function (res) {
              dialogEngineers = (res.data && res.data.engineers) || [];
              fillEngSel(dialogEngineers);
            }).catch(function () {});
          }
          engSel.addEventListener('change', function () { state.engineerId = engSel.value; });
          row.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Engineer' }), el('div', { class: 'mt-1' }, [engSel])]));
        }
        wrap.appendChild(row);

        // Items
        wrap.appendChild(itemsEditor());

        // Notes
        var notesI = el('textarea', { class: INPUT, rows: '2', placeholder: 'Optional' });
        notesI.value = state.notes;
        notesI.addEventListener('input', function () { state.notes = notesI.value; });
        wrap.appendChild(el('div', {}, [el('span', { class: 'text-xs text-muted', text: 'Notes' }), el('div', { class: 'mt-1' }, [notesI])]));

        return wrap;
      }

      function itemsEditor() {
        var wrap = el('div', {});
        wrap.appendChild(el('span', { class: 'text-xs text-muted', text: 'Products' }));
        var list = el('div', { class: 'mt-1 space-y-2' });
        state.items.forEach(function (it, idx) {
          var qty = el('input', { type: 'number', min: '0.01', step: 'any', class: INPUT, style: 'max-width:90px', value: it.quantity });
          qty.addEventListener('input', function () { state.items[idx].quantity = Number(qty.value) || 0; });
          list.appendChild(el('div', { class: 'flex items-center gap-2' }, [
            el('span', { class: 'flex-1 text-sm truncate', text: it.productName + (it.itemCode ? ' (' + it.itemCode + ')' : '') }),
            qty,
            el('button', {
              class: 'p-1 text-slate-400 hover:text-red-500', 'aria-label': 'Remove', text: '✕',
              onclick: function () { state.items.splice(idx, 1); render(); }
            })
          ]));
        });
        wrap.appendChild(list);

        var prodInput = el('input', { class: INPUT, placeholder: 'Search products to add…' });
        var prodResults = el('div', { class: 'mt-1 space-y-1' });
        var t2;
        prodInput.addEventListener('input', function () {
          clearTimeout(t2);
          var q = prodInput.value.trim();
          if (!q) { prodResults.innerHTML = ''; return; }
          t2 = setTimeout(function () {
            api('GET', '/products/search?q=' + encodeURIComponent(q)).then(function (res) {
              var results = (res.data && res.data.results) || [];
              prodResults.innerHTML = '';
              results.forEach(function (p) {
                prodResults.appendChild(el('button', {
                  class: 'block w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800',
                  text: p.productName + ' (' + p.itemCode + ')',
                  onclick: function () {
                    state.items.push({ productId: p.id, itemCode: p.itemCode, productName: p.productName, unit: p.unit, quantity: 1 });
                    prodInput.value = ''; prodResults.innerHTML = '';
                    render();
                  }
                }));
              });
            }).catch(function () {});
          }, 300);
        });
        wrap.appendChild(el('div', { class: 'mt-2' }, [prodInput, prodResults]));
        return wrap;
      }

      function footer() {
        var kids = [];
        if (isCreate) {
          kids.push(el('button', { class: 'btn-secondary', text: 'Cancel', onclick: close }));
          kids.push(el('button', { class: 'btn-primary', text: 'Create order', onclick: submitCreate }));
        } else if (editing) {
          kids.push(el('button', { class: 'btn-secondary', text: 'Cancel', onclick: function () { editing = false; render(); } }));
          kids.push(el('button', { class: 'btn-primary', text: 'Save', onclick: submitEdit }));
        } else {
          if (canEdit) kids.push(el('button', { class: 'text-red-500 text-sm font-medium mr-auto', text: 'Delete', onclick: confirmDelete }));
          if (canEdit) kids.push(el('button', { class: 'btn-secondary', text: 'Edit', onclick: function () { editing = true; render(); } }));
          kids.push(el('button', { class: 'btn-primary', text: 'Close', onclick: close }));
        }
        return el('div', { class: 'flex gap-2 justify-end mt-5' }, kids);
      }

      function confirmDelete() {
        if (!confirm('Delete this order? This cannot be undone.')) return;
        api('DELETE', '/orders/' + order.id).then(function () {
          close();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function submitCreate() {
        errMsg = '';
        if (!state.customerId) { errMsg = 'Please choose a customer.'; return render(); }
        if (!state.items.length) { errMsg = 'Add at least one product.'; return render(); }
        if (state.orderType === 'PO' && !state.file) { errMsg = 'Please attach the purchase order document.'; return render(); }
        if (state.orderType === 'VERBAL' && !state.verbalDetails.trim()) { errMsg = 'Please note what was agreed.'; return render(); }

        var fd = new FormData();
        fd.append('customerId', state.customerId);
        fd.append('orderType', state.orderType);
        fd.append('orderDate', state.orderDate);
        fd.append('notes', state.notes || '');
        fd.append('items', JSON.stringify(state.items.map(function (i) { return { productId: i.productId, quantity: i.quantity }; })));
        if (state.orderType === 'VERBAL') fd.append('verbalDetails', state.verbalDetails);
        if (state.orderType === 'PO' && state.file) fd.append('file', state.file);
        if (isAdmin() && state.engineerId) fd.append('engineerId', state.engineerId);

        api('POST', '/orders', fd).then(function () {
          close();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      function submitEdit() {
        errMsg = '';
        if (!state.items.length) { errMsg = 'Add at least one product.'; return render(); }

        var goingToPO = state.orderType === 'PO' && order.orderType !== 'PO';
        if (goingToPO && !state.file) {
          errMsg = 'Attach a document to switch this order to Purchase order.';
          return render();
        }
        if (state.orderType === 'VERBAL' && !state.verbalDetails.trim()) {
          errMsg = 'Please note what was agreed.'; return render();
        }

        var body2 = {
          customerId: state.customerId,
          orderType: goingToPO ? order.orderType : state.orderType, // don't flip to PO here — the upload call below does that
          orderDate: state.orderDate,
          notes: state.notes,
          items: state.items.map(function (i) { return { productId: i.productId, quantity: i.quantity }; }),
        };
        if (state.orderType === 'VERBAL') body2.verbalDetails = state.verbalDetails;

        api('PUT', '/orders/' + order.id, body2).then(function (res) {
          if (goingToPO && state.file) {
            var fd = new FormData();
            fd.append('file', state.file);
            return api('POST', '/orders/' + order.id + '/document', fd);
          }
          if (state.orderType === 'PO' && state.file) {
            // replacing an existing PO's document
            var fd2 = new FormData();
            fd2.append('file', state.file);
            return api('POST', '/orders/' + order.id + '/document', fd2);
          }
          return res;
        }).then(function (res) {
          order = res.data.order;
          editing = false;
          render();
          if (onChange) onChange();
        }).catch(function (e) { errMsg = e.message; render(); });
      }

      render();
    }
  }

  window.Orders = { mountPage: mount, openOrderDialog: openOrderDialog };
})();
