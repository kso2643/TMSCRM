/* ══════════════════════════════════════════════════════════════════════
   Orders — verbal commitments and purchase orders, with delivery
   tracking, for the compiled build.

   Every authenticated user sees the full list (same visibility model as
   Meetings/Appointments). Creating one self-assigns the engineer unless
   you're admin-tier and pick someone else. Editing/deleting needs to be
   the creator or admin-tier — matches OrderController.php exactly.

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var ORDER_TYPES = [['VERBAL', 'Verbal'], ['PO', 'Purchase order']];
  var DELIVERY_STATUSES = [['PENDING', 'Pending'], ['DELIVERED', 'Delivered'], ['NOT_DELIVERED', 'Not delivered']];
  var STATUS_BADGE = { PENDING: 'badge-yellow', DELIVERED: 'badge-green', NOT_DELIVERED: 'badge-red' };
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
    var all = [];
    var from = '', to = '', engineerId = '', deliveryStatus = '', orderType = '', procurementStatus = '';
    var engineers = [];

    var stats = el('div', { class: 'grid grid-cols-2 lg:grid-cols-4 gap-3' });
    var filters = el('div', { class: 'flex flex-wrap gap-2' });
    var body = el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' });

    root.appendChild(el('div', { class: 'space-y-5' }, [
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('h1', { class: 'page-title', text: 'Orders' }),
        el('button', { class: 'btn-primary', text: '+ New order', onclick: function () { openOrderDialog(null, load); } })
      ]),
      stats, filters, body
    ]));

    function query() {
      var q = [];
      if (from) q.push('from=' + from);
      if (to) q.push('to=' + to);
      if (engineerId) q.push('engineerId=' + engineerId);
      if (deliveryStatus) q.push('deliveryStatus=' + deliveryStatus);
      if (orderType) q.push('orderType=' + orderType);
      if (procurementStatus) q.push('procurementStatus=' + procurementStatus);
      q.push('limit=100');
      return q.join('&');
    }

    function load() {
      body.innerHTML = ''; body.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' }));
      api('GET', '/orders?' + query()).then(function (res) {
        all = (res.data && res.data.items) || [];
        renderStats();
        renderTable();
      }).catch(function (e) {
        body.innerHTML = '';
        body.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: e.message }));
      });
    }

    function renderStats() {
      stats.innerHTML = '';
      var pending = all.filter(function (o) { return o.deliveryStatus === 'PENDING'; }).length;
      var delivered = all.filter(function (o) { return o.deliveryStatus === 'DELIVERED'; }).length;
      var notDelivered = all.filter(function (o) { return o.deliveryStatus === 'NOT_DELIVERED'; }).length;
      [['Total orders', String(all.length)], ['Pending', String(pending)],
       ['Delivered', String(delivered)], ['Not delivered', String(notDelivered)]
      ].forEach(function (s) {
        stats.appendChild(el('div', { class: 'card p-4' }, [
          el('p', { class: 'text-xs text-muted', text: s[0] }),
          el('p', { class: 'mt-1 text-xl font-bold text-slate-900 dark:text-slate-100', text: s[1] })
        ]));
      });
    }

    function renderFilters() {
      filters.innerHTML = '';
      var fromI = el('input', { type: 'date', class: INPUT, style: 'max-width:160px' });
      fromI.value = from;
      fromI.addEventListener('change', function () { from = fromI.value; load(); });
      var toI = el('input', { type: 'date', class: INPUT, style: 'max-width:160px' });
      toI.value = to;
      toI.addEventListener('change', function () { to = toI.value; load(); });

      var eSel = el('select', { class: selectCls }, [el('option', { value: '', text: 'All engineers' })]
        .concat(engineers.map(function (e2) { return el('option', { value: e2.id, text: e2.name }); })));
      eSel.value = engineerId;
      eSel.addEventListener('change', function () { engineerId = eSel.value; load(); });

      var dSel = el('select', { class: selectCls }, [el('option', { value: '', text: 'All delivery statuses' })]
        .concat(DELIVERY_STATUSES.map(function (s) { return el('option', { value: s[0], text: s[1] }); })));
      dSel.value = deliveryStatus;
      dSel.addEventListener('change', function () { deliveryStatus = dSel.value; load(); });

      var pSel = el('select', { class: selectCls }, [el('option', { value: '', text: 'All procurement statuses' })]
        .concat(PROCUREMENT_STATUSES.map(function (s) { return el('option', { value: s[0], text: s[1] }); })));
      pSel.value = procurementStatus;
      pSel.addEventListener('change', function () { procurementStatus = pSel.value; load(); });

      var tSel = el('select', { class: selectCls }, [el('option', { value: '', text: 'All types' })]
        .concat(ORDER_TYPES.map(function (t) { return el('option', { value: t[0], text: t[1] }); })));
      tSel.value = orderType;
      tSel.addEventListener('change', function () { orderType = tSel.value; load(); });

      [el('span', { class: 'text-xs text-muted self-center', text: 'From' }), fromI,
       el('span', { class: 'text-xs text-muted self-center', text: 'to' }), toI,
       eSel, dSel, pSel, tSel].forEach(function (n) { filters.appendChild(n); });
    }

    function renderTable() {
      var heads = ['Customer', 'Type', 'Products', 'Engineer', 'Order date', 'Procurement', 'Delivery'];
      var tbody = el('tbody');
      if (!all.length) {
        tbody.appendChild(el('tr', {}, [el('td', {
          colspan: String(heads.length), class: 'px-4 py-10 text-center text-muted', text: 'No orders found.'
        })]));
      } else {
        all.forEach(function (o) {
          var procCell = el('td', { class: 'px-4 py-3 whitespace-nowrap' }, [
            el('span', { class: 'badge ' + PROCUREMENT_BADGE[o.procurementStatus], text: labelOf(PROCUREMENT_STATUSES, o.procurementStatus) }),
            o.expectedDeliveryDate ? el('span', { class: 'block text-xs text-muted mt-0.5', text: 'Arriving ' + fmtDate(o.expectedDeliveryDate) }) : null
          ]);
          var tr = el('tr', { class: 'table-row cursor-pointer' }, [
            el('td', { class: 'px-4 py-3 font-medium whitespace-nowrap', text: (o.customer && o.customer.companyName) || '—' }),
            el('td', { class: 'px-4 py-3' }, [el('span', { class: 'badge ' + TYPE_BADGE[o.orderType], text: labelOf(ORDER_TYPES, o.orderType) })]),
            el('td', { class: 'px-4 py-3 max-w-[220px] truncate text-muted', text: o.productSummary || '—', title: o.productSummary || '' }),
            el('td', { class: 'px-4 py-3', text: (o.engineer && o.engineer.name) || '—' }),
            el('td', { class: 'px-4 py-3 whitespace-nowrap', text: fmtDate(o.orderDate) }),
            procCell,
            el('td', { class: 'px-4 py-3' }, [el('span', { class: 'badge ' + STATUS_BADGE[o.deliveryStatus], text: labelOf(DELIVERY_STATUSES, o.deliveryStatus) })])
          ]);
          tr.addEventListener('click', function () { openOrderDialog(o.id, load); });
          tbody.appendChild(tr);
        });
      }
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'card overflow-hidden' }, [
        el('div', { class: 'overflow-x-auto' }, [
          el('table', { class: 'w-full text-sm' }, [
            el('thead', { class: 'bg-slate-50 dark:bg-slate-800/50' }, [
              el('tr', {}, heads.map(function (h) { return el('th', { class: 'table-head text-left px-4 py-3 whitespace-nowrap', text: h }); }))
            ]),
            tbody
          ])
        ])
      ]));
    }

    api('GET', '/orders/engineers').then(function (res) {
      engineers = (res.data && res.data.engineers) || [];
      renderFilters();
    }).catch(function () {});

    renderFilters();
    load();
  }

  // ── create / detail-edit dialog ─────────────────────────────────────
  // orderId === null -> create mode. Otherwise loads and shows/edits it.
  function openOrderDialog(orderId, onChange) {
    var overlay = el('div', { class: 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4' });
    var card = el('div', {
      class: 'card w-full sm:max-w-lg p-5 rounded-b-none sm:rounded-xl max-h-[92vh] overflow-y-auto',
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
          el('span', { class: 'badge ' + STATUS_BADGE[o.deliveryStatus], text: labelOf(DELIVERY_STATUSES, o.deliveryStatus) })
        ]));

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

        var itemsTbl = el('table', { class: 'w-full text-sm' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { class: 'table-head text-left px-2 py-1.5', text: 'Product' }),
            el('th', { class: 'table-head text-right px-2 py-1.5', text: 'Qty' })
          ])]),
          el('tbody', {}, (o.items || []).map(function (i) {
            return el('tr', { class: 'border-t border-slate-100 dark:border-slate-800' }, [
              el('td', { class: 'px-2 py-1.5', text: i.productName + (i.itemCode ? ' (' + i.itemCode + ')' : '') }),
              el('td', { class: 'px-2 py-1.5 text-right', text: i.quantity + (i.unit ? ' ' + i.unit : '') })
            ]);
          }))
        ]);
        wrap.appendChild(el('div', { class: 'rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden' }, [itemsTbl]));

        if (o.notes) wrap.appendChild(el('p', { class: 'text-sm text-muted', text: o.notes }));

        if (o.deliveryStatus === 'NOT_DELIVERED' && o.notDeliveredReason) {
          wrap.appendChild(el('div', {
            class: 'text-sm px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
          }, ['Not delivered: ' + o.notDeliveredReason]));
        }
        if (o.deliveryStatus === 'DELIVERED' && o.deliveredDate) {
          wrap.appendChild(el('p', { class: 'text-xs text-muted', text: 'Delivered ' + fmtDate(o.deliveredDate) }));
        }

        // Delivery action buttons — anyone who can edit this order.
        if (canEdit) {
          var actions = el('div', { class: 'flex gap-2 flex-wrap' });
          if (o.deliveryStatus !== 'DELIVERED') {
            actions.appendChild(el('button', {
              class: 'btn-secondary', text: 'Mark delivered',
              onclick: function () { setDelivery(o.id, 'DELIVERED'); }
            }));
          }
          if (o.deliveryStatus !== 'NOT_DELIVERED') {
            actions.appendChild(el('button', {
              class: 'btn-secondary', text: 'Mark not delivered',
              onclick: function () { promptNotDelivered(o.id); }
            }));
          }
          if (o.deliveryStatus !== 'PENDING') {
            actions.appendChild(el('button', {
              class: 'btn-secondary', text: 'Reset to pending',
              onclick: function () { setDelivery(o.id, 'PENDING'); }
            }));
          }
          wrap.appendChild(actions);
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

      function promptNotDelivered(id) {
        var reasonBox = el('div', { class: 'space-y-2 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20' });
        var ta = el('textarea', { class: INPUT, rows: '2', placeholder: 'Why wasn\u2019t it delivered?' });
        reasonBox.appendChild(el('span', { class: 'text-xs text-amber-800 dark:text-amber-200', text: 'Reason required' }));
        reasonBox.appendChild(ta);
        reasonBox.appendChild(el('div', { class: 'flex gap-2 justify-end' }, [
          el('button', { class: 'btn-secondary', text: 'Cancel', onclick: render }),
          el('button', {
            class: 'btn-primary', text: 'Confirm',
            onclick: function () {
              if (!ta.value.trim()) return;
              setDelivery(id, 'NOT_DELIVERED', ta.value.trim());
            }
          })
        ]));
        card.querySelector('.space-y-4').appendChild(reasonBox);
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
