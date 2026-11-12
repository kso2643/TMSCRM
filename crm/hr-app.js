/* ══════════════════════════════════════════════════════════════════════
   HR — employee directory + personnel profile, for the compiled build.

   Every field here was already accepted by PUT /api/users/:id and already
   returned by GET /api/users/:id — there just wasn't a page for it. This
   is a pure frontend addition; no backend change.

   Gated the same as the Users page: SUPER_ADMIN / ADMIN (matches
   require_admin() in the API — the actual enforced boundary on every
   endpoint this page calls). Role and account-status (active/locked)
   stay on the Users page; this page owns the personnel/HR fields only.

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.apjtech.in';
  var ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN']; // matches require_admin()

  var EMPLOYMENT_TYPES = [
    ['FULL_TIME', 'Full-time'], ['PART_TIME', 'Part-time'],
    ['CONTRACT', 'Contract'], ['INTERN', 'Intern']
  ];

  // [key, label, type, listOptions?]. type: text | textarea | date | select | employmentType
  var SECTIONS = [
    { title: 'Employment', fields: [
      ['employeeCode', 'Employee code', 'text'],
      ['designation', 'Designation', 'text'],
      ['department', 'Department', 'text'],
      ['employmentType', 'Employment type', 'employmentType'],
      ['dateOfJoining', 'Date of joining', 'date'],
      ['dateOfLeaving', 'Date of leaving', 'date'],
      ['phone', 'Phone', 'text']
    ]},
    { title: 'Personal', fields: [
      ['dateOfBirth', 'Date of birth', 'date'],
      ['gender', 'Gender', 'text', ['Male', 'Female', 'Other']],
      ['maritalStatus', 'Marital status', 'text', ['Single', 'Married', 'Other']],
      ['bloodGroup', 'Blood group', 'text', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']],
      ['fatherName', "Father's name", 'text'],
      ['fatherPhone', "Father's contact number", 'text'],
      ['spousePhone', "Spouse's contact number", 'text'],
      ['personalEmail', 'Personal email', 'text']
    ]},
    { title: 'Emergency contact', fields: [
      ['emergencyContactName', 'Contact name', 'text'],
      ['emergencyContactPhone', 'Contact phone', 'text']
    ]},
    { title: 'Current address', fields: [
      ['currentAddress', 'Address', 'textarea']
    ]},
    { title: 'Permanent address', fields: [
      ['permanentAddress', 'Address line', 'text'],
      ['permanentCity', 'City', 'text'],
      ['permanentDistrict', 'District', 'text'],
      ['permanentState', 'State', 'text'],
      ['permanentPincode', 'Pincode', 'text']
    ]}
    // Present address is handled separately below (same-as-permanent toggle).
  ];
  var PRESENT_FIELDS = [
    ['presentAddress', 'Address line', 'text'],
    ['presentCity', 'City', 'text'],
    ['presentDistrict', 'District', 'text'],
    ['presentState', 'State', 'text'],
    ['presentPincode', 'Pincode', 'text']
  ];
  var BANK_SECTION = { title: 'Bank & statutory', sensitive: true, fields: [
    ['bankName', 'Bank name', 'text'],
    ['bankAccountName', 'Account holder name', 'text'],
    ['bankAccountNumber', 'Account number', 'text', null, true],
    ['bankIFSC', 'IFSC', 'text'],
    ['bankBranchName', 'Branch', 'text'],
    ['upiId', 'UPI ID', 'text'],
    ['panNumber', 'PAN', 'text', null, true],
    ['aadharNumber', 'Aadhar', 'text', null, true],
    ['uanNumber', 'UAN', 'text'],
    ['pfNumber', 'PF number', 'text'],
    ['esiNumber', 'ESI number', 'text']
  ]};

  // ── helpers ─────────────────────────────────────────────────────────
  function token() { try { return localStorage.getItem('crm_token'); } catch (e) { return null; } }

  function api(method, path, body) {
    return fetch(API + '/api' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token() || '') },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
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
    var dt = new Date(s);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // yyyy-mm-dd for a <input type=date>, from whatever the API sent back.
  function toDateInput(d) {
    if (!d) return '';
    var s = /[Zz]|[+-]\d\d:?\d\d$/.test(d) ? d : String(d).replace(' ', 'T');
    var dt = new Date(s);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
  }

  function mask(v) {
    v = String(v || '');
    if (v.length <= 4) return '••••';
    return '••••' + v.slice(-4);
  }

  var INPUT = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
              'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary';
  var selectCls = INPUT;

  // ── directory page ──────────────────────────────────────────────────
  function mount(root) {
    var all = [];
    var q = '', dept = '', etype = '', activeOnly = '';
    var drawerEl = null;

    var stats = el('div', { class: 'grid grid-cols-2 lg:grid-cols-4 gap-3' });
    var filters = el('div', { class: 'flex flex-wrap gap-2' });
    var body = el('div', { class: 'card p-10 text-center text-muted', text: 'Loading…' });

    root.appendChild(el('div', { class: 'space-y-5' }, [
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        el('h1', { class: 'page-title', text: 'HR' }),
        el('div', { class: 'flex gap-2 flex-wrap' }, [
          el('button', { class: 'btn-primary', type: 'button', 'data-new-emp': '1', text: '+ New employee', onclick: function () { openNewEmployee(); } }),
          el('a', {
            class: 'btn-secondary', href: '/admin/users/',
            text: 'Manage accounts →'
          })
        ])
      ]),
      stats, filters, body
    ]));

    var docMissing = {}, docTotal = 7;
    function loadDocs() {
      return api('GET', '/hr/missing-docs').then(function (r) { docMissing = (r.data && r.data.have) || {}; docTotal = (r.data && r.data.total) || 7; renderTable(); }).catch(function () {});
    }
    function load() {
      loadDocs();
      api('GET', '/users?limit=500').then(function (res) {
        all = (res.data && res.data.items) || [];
        renderStats();
        renderFilters();
        renderTable();
      }).catch(function (e) {
        body.innerHTML = '';
        body.appendChild(el('div', { class: 'card p-10 text-center text-muted', text: e.message }));
      });
    }

    function renderStats() {
      stats.innerHTML = '';
      var active = all.filter(function (u) { return u.isActive; }).length;
      var depts = {};
      all.forEach(function (u) { if (u.department) depts[u.department] = 1; });
      var fullTime = all.filter(function (u) { return u.employmentType === 'FULL_TIME'; }).length;
      [
        ['Total employees', String(all.length)],
        ['Active', String(active)],
        ['Departments', String(Object.keys(depts).length)],
        ['Full-time', String(fullTime)]
      ].forEach(function (s) {
        stats.appendChild(el('div', { class: 'card p-4' }, [
          el('p', { class: 'text-xs text-muted', text: s[0] }),
          el('p', { class: 'mt-1 text-xl font-bold text-slate-900 dark:text-slate-100', text: s[1] })
        ]));
      });
    }

    function renderFilters() {
      filters.innerHTML = '';
      var search = el('input', {
        class: INPUT, placeholder: 'Search name, email, employee code…',
        style: 'max-width:260px', value: q
      });
      search.addEventListener('input', function () { q = search.value.toLowerCase(); renderTable(); });

      var depts = Array.from(new Set(all.map(function (u) { return u.department; }).filter(Boolean))).sort();
      var dSel = el('select', { class: selectCls }, [el('option', { value: '', text: 'All departments' })]
        .concat(depts.map(function (d) { return el('option', { value: d, text: d }); })));
      dSel.value = dept;
      dSel.addEventListener('change', function () { dept = dSel.value; renderTable(); });

      var eSel = el('select', { class: selectCls }, [el('option', { value: '', text: 'All employment types' })]
        .concat(EMPLOYMENT_TYPES.map(function (t) { return el('option', { value: t[0], text: t[1] }); })));
      eSel.value = etype;
      eSel.addEventListener('change', function () { etype = eSel.value; renderTable(); });

      var aSel = el('select', { class: selectCls }, [
        el('option', { value: '', text: 'All statuses' }),
        el('option', { value: 'active', text: 'Active only' }),
        el('option', { value: 'inactive', text: 'Inactive only' })
      ]);
      aSel.value = activeOnly;
      aSel.addEventListener('change', function () { activeOnly = aSel.value; renderTable(); });

      filters.appendChild(search);
      filters.appendChild(dSel);
      filters.appendChild(eSel);
      filters.appendChild(aSel);
    }

    function filtered() {
      return all.filter(function (u) {
        if (dept && u.department !== dept) return false;
        if (etype && u.employmentType !== etype) return false;
        if (activeOnly === 'active' && !u.isActive) return false;
        if (activeOnly === 'inactive' && u.isActive) return false;
        if (q) {
          var hay = [u.name, u.email, u.employeeCode, u.department].join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
    }

    function renderTable() {
      var rows = filtered();
      var heads = ['Employee', 'Code', 'Department', 'Designation', 'Type', 'Joined', 'Documents', 'Status'];
      var tbody = el('tbody');
      if (!rows.length) {
        tbody.appendChild(el('tr', {}, [el('td', {
          colspan: String(heads.length), class: 'px-4 py-10 text-center text-muted',
          text: all.length ? 'No employees match these filters.' : 'No employees found.'
        })]));
      } else {
        rows.forEach(function (u) {
          var etLabel = (EMPLOYMENT_TYPES.filter(function (t) { return t[0] === u.employmentType; })[0] || [])[1] || '—';
          var tr = el('tr', { class: 'table-row cursor-pointer' }, [
            el('td', { class: 'px-4 py-3 font-medium whitespace-nowrap' }, [
              el('span', { text: u.name || '—' }),
              el('span', { class: 'block text-xs text-muted font-normal', text: u.email || '' })
            ]),
            el('td', { class: 'px-4 py-3 text-muted', text: u.employeeCode || '—' }),
            el('td', { class: 'px-4 py-3', text: u.department || '—' }),
            el('td', { class: 'px-4 py-3', text: u.designation || '—' }),
            el('td', { class: 'px-4 py-3', text: etLabel }),
            el('td', { class: 'px-4 py-3', text: u.dateOfJoining ? fmtDate(u.dateOfJoining) : '—' }),
            (function () {
              var miss = docMissing[u.id] != null ? docMissing[u.id] : docTotal;
              return el('td', { class: 'px-4 py-3 whitespace-nowrap', 'data-docs': u.id }, [
                el('span', { class: 'badge whitespace-nowrap ' + (miss ? 'badge-yellow' : 'badge-green'), text: miss ? '⚠ ' + miss + ' missing' : '✓ ' + docTotal + '/' + docTotal })
              ]);
            })(),
            el('td', { class: 'px-4 py-3' }, [
              el('span', { class: 'badge ' + (u.isActive ? 'badge-green' : 'badge-gray'), text: u.isActive ? 'Active' : 'Inactive' })
            ])
          ]);
          tr.addEventListener('click', function () { openDrawer(u.id); });
          tbody.appendChild(tr);
        });
      }
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'card overflow-hidden' }, [
        el('div', { class: 'px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between' }, [
          el('span', { class: 'text-sm font-semibold text-slate-900 dark:text-slate-100', text: 'Employees' }),
          el('span', { class: 'text-xs text-muted', text: rows.length + ' of ' + all.length })
        ]),
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

    // ── profile drawer ───────────────────────────────────────────────
    function openDrawer(userId) {
      closeDrawer();
      var overlay = el('div', { class: 'fixed inset-0 z-50 bg-black/50', onclick: closeDrawer });
      var panel = el('div', {
        class: 'fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-white dark:bg-slate-900 shadow-xl ' +
               'overflow-y-auto border-l border-slate-200 dark:border-slate-700'
      });
      panel.addEventListener('click', function (e) { e.stopPropagation(); });
      drawerEl = el('div', {}, [overlay, panel]);
      document.body.appendChild(drawerEl);

      panel.appendChild(el('div', { class: 'p-6 text-center text-muted', text: 'Loading…' }));

      api('GET', '/users/' + userId).then(function (res) {
        var user = res.data && res.data.user;
        if (!user) throw new Error('Not found');
        renderDrawer(panel, user);
      }).catch(function (e) {
        panel.innerHTML = '';
        panel.appendChild(el('div', { class: 'p-6 text-center text-muted', text: e.message }));
      });
    }

    function closeDrawer() {
      if (drawerEl && drawerEl.parentNode) drawerEl.parentNode.removeChild(drawerEl);
      drawerEl = null;
    }

    function renderDrawer(panel, user) {
      var editing = false;
      var revealed = false;
      var values = {};       // working copy while editing
      var presentSame = !!user.presentAddressSameAsPermanent;

      function resetValues() {
        values = {};
        SECTIONS.concat([BANK_SECTION]).forEach(function (sec) {
          sec.fields.forEach(function (f) { values[f[0]] = user[f[0]]; });
        });
        PRESENT_FIELDS.forEach(function (f) { values[f[0]] = user[f[0]]; });
        presentSame = !!user.presentAddressSameAsPermanent;
      }
      resetValues();

      function fieldValue(type, key, options) {
        var v = values[key];
        if (!editing) {
          var display = v || '—';
          if (type === 'date') display = v ? fmtDate(v) : '—';
          if (type === 'employmentType') {
            display = (EMPLOYMENT_TYPES.filter(function (t) { return t[0] === v; })[0] || [])[1] || '—';
          }
          return el('p', { class: 'text-sm text-slate-900 dark:text-slate-100 mt-0.5', text: display });
        }
        if (type === 'employmentType') {
          var sel = el('select', { class: selectCls },
            EMPLOYMENT_TYPES.map(function (t) { return el('option', { value: t[0], text: t[1] }); }));
          sel.value = v || 'FULL_TIME';
          sel.addEventListener('change', function () { values[key] = sel.value; });
          return sel;
        }
        if (type === 'date') {
          var di = el('input', { type: 'date', class: INPUT, value: toDateInput(v) });
          di.addEventListener('input', function () { values[key] = di.value; });
          return di;
        }
        if (type === 'textarea') {
          var ta = el('textarea', { class: INPUT, rows: '2' });
          ta.value = v || '';
          ta.addEventListener('input', function () { values[key] = ta.value; });
          return ta;
        }
        var listId = options ? 'dl-' + key : null;
        var ti = el('input', { class: INPUT, value: v || '', list: listId || null });
        ti.addEventListener('input', function () { values[key] = ti.value; });
        if (options) {
          var dl = el('datalist', { id: listId }, options.map(function (o) { return el('option', { value: o }); }));
          return el('div', {}, [ti, dl]);
        }
        return ti;
      }

      function fieldRow(f) {
        var key = f[0], label = f[1], type = f[2], options = f[3], sensitive = f[4];
        var wrap = el('div', {});
        wrap.appendChild(el('span', { class: 'text-xs text-muted', text: label }));
        if (sensitive && !editing) {
          var v = values[key];
          var text = v ? (revealed ? v : mask(v)) : '—';
          wrap.appendChild(el('p', { class: 'text-sm text-slate-900 dark:text-slate-100 mt-0.5 font-mono', text: text }));
        } else {
          wrap.appendChild(fieldValue(type, key, options));
        }
        return wrap;
      }

      function section(sec) {
        var grid = el('div', { class: 'grid grid-cols-2 gap-x-3 gap-y-3 mt-3' });
        sec.fields.forEach(function (f) {
          var full = f[2] === 'textarea';
          var cell = fieldRow(f);
          if (full) cell.className = 'col-span-2';
          grid.appendChild(cell);
        });
        var header = el('div', { class: 'flex items-center justify-between' }, [
          el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-400', text: sec.title }),
          sec.sensitive ? el('button', {
            class: 'text-xs text-primary dark:text-primary-300 font-medium',
            text: revealed ? 'Hide' : 'Show',
            onclick: function () { revealed = !revealed; rerender(); }
          }) : null
        ]);
        return el('div', { class: 'py-4 border-b border-slate-100 dark:border-slate-800' }, [header, grid]);
      }

      function presentAddressSection() {
        var checkbox = el('input', { type: 'checkbox' });
        checkbox.checked = presentSame;
        checkbox.disabled = !editing;
        checkbox.addEventListener('change', function () { presentSame = checkbox.checked; rerender(); });

        var kids = [
          el('div', { class: 'flex items-center justify-between' }, [
            el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-400', text: 'Present address' }),
            el('label', { class: 'flex items-center gap-1.5 text-xs text-muted' }, [checkbox, ' Same as permanent'])
          ])
        ];
        if (!presentSame) {
          var grid = el('div', { class: 'grid grid-cols-2 gap-x-3 gap-y-3 mt-3' });
          PRESENT_FIELDS.forEach(function (f) { grid.appendChild(fieldRow(f)); });
          kids.push(grid);
        }
        return el('div', { class: 'py-4 border-b border-slate-100 dark:border-slate-800' }, kids);
      }

      function save() {
        var body = {};
        SECTIONS.concat([BANK_SECTION]).forEach(function (sec) {
          sec.fields.forEach(function (f) { body[f[0]] = values[f[0]] || ''; });
        });
        body.presentAddressSameAsPermanent = presentSame;
        if (!presentSame) {
          PRESENT_FIELDS.forEach(function (f) { body[f[0]] = values[f[0]] || ''; });
        } else {
          PRESENT_FIELDS.forEach(function (f) { body[f[0]] = ''; });
        }
        var saveBtn = panel.querySelector('[data-save]');
        if (saveBtn) saveBtn.disabled = true;
        api('PUT', '/users/' + user.id, body).then(function (res) {
          user = res.data.user;
          editing = false;
          resetValues();
          var idx = all.findIndex(function (u) { return u.id === user.id; });
          if (idx !== -1) all[idx] = Object.assign({}, all[idx], user);
          renderTable();
          rerender();
        }).catch(function (e) {
          if (saveBtn) saveBtn.disabled = false;
          var err = panel.querySelector('[data-err]');
          if (err) { err.textContent = e.message; err.classList.remove('hidden'); }
        });
      }

      function rerender() {
        panel.innerHTML = '';
        panel.appendChild(el('div', { class: 'p-5' }, [
          el('div', { class: 'flex items-start justify-between mb-1' }, [
            el('div', {}, [
              el('h2', { class: 'section-title mb-0', text: user.name }),
              el('p', { class: 'text-xs text-muted mt-0.5', text: user.email })
            ]),
            el('button', { class: 'p-1 rounded text-slate-400 hover:text-slate-600', text: '✕', onclick: closeDrawer })
          ]),
          el('div', { class: 'flex items-center gap-2 mb-2' }, [
            el('span', { class: 'badge badge-gray', text: (ROLE_LABELS()[user.role] || user.role) }),
            el('span', { class: 'badge ' + (user.isActive ? 'badge-green' : 'badge-gray'), text: user.isActive ? 'Active' : 'Inactive' })
          ]),
          el('p', { class: 'text-[11px] text-slate-400 mb-3', text: 'Role and account status are managed from Users.' })
        ].concat(SECTIONS.map(section)).concat([
          presentAddressSection(),
          section(BANK_SECTION),
          docsSection(user.id),
          el('p', { 'data-err': '1', class: 'text-xs text-red-600 dark:text-red-400 hidden mt-2' }),
          el('div', { class: 'flex gap-2 justify-end mt-5 pb-2' },
            editing ? [
              el('button', {
                class: 'btn-secondary', text: 'Cancel',
                onclick: function () { editing = false; resetValues(); rerender(); }
              }),
              el('button', { class: 'btn-primary', 'data-save': '1', text: 'Save', onclick: save })
            ] : [
              el('button', { class: 'btn-primary', text: 'Edit profile', onclick: function () { editing = true; rerender(); } })
            ]
          )
        ])));
      }

      rerender();
    }

    // ── documents (v11.52): the 7 KYC / education documents, kept private on the server ──
    function apiForm(path, fd) {
      return fetch(API + '/api' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') }, body: fd })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error((j && j.message) || 'Request failed'); e.data = j; throw e; } return j; }); });
    }
    function openDoc(id) {
      var w = window.open('', '_blank');
      fetch(API + '/api/hr/docs/' + id, { headers: { Authorization: 'Bearer ' + (token() || '') } })
        .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || 'Not found'); }); return r.blob(); })
        .then(function (b) { var u = URL.createObjectURL(b); if (w) w.location = u; else location.href = u; })
        .catch(function (e) { if (w) w.close(); alert(e.message); });
    }
    function docsSection(userId) {
      var box = el('div', { class: 'mt-5', 'data-doc-section': '1' }, [
        el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-muted mb-2', text: 'Documents' }),
        el('p', { class: 'text-xs text-muted', text: 'Loading…' })
      ]);
      function draw(list) {
        box.innerHTML = '';
        var missing = list.filter(function (d) { return !d.id; }).length;
        box.appendChild(el('div', { class: 'flex items-center justify-between mb-2' }, [
          el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-muted', text: 'Documents' }),
          el('span', { class: 'badge ' + (missing ? 'badge-yellow' : 'badge-green'), text: missing ? missing + ' missing' : 'All ' + list.length + ' on file' })
        ]));
        list.forEach(function (d) {
          var inp = el('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'hidden', 'data-doc-file': d.type });
          inp.addEventListener('change', function () {
            if (!inp.files[0]) return;
            var fd = new FormData(); fd.append('documentType', d.type); fd.append('file', inp.files[0]);
            apiForm('/hr/employees/' + userId + '/docs', fd).then(function (r) { draw(r.data.documents); loadDocs(); }).catch(function (e) { alert(e.message); });
          });
          box.appendChild(el('div', { class: 'flex items-center gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800 text-sm', 'data-doc-row': d.type }, [
            el('span', { class: d.id ? 'text-green-600' : 'text-amber-500', text: d.id ? '✓' : '⚠' }),
            el('span', { class: 'flex-1', text: d.label }),
            d.id ? el('button', { type: 'button', class: 'text-xs text-blue-600 hover:underline', text: 'View', onclick: function () { openDoc(d.id); } }) : el('span', { class: 'text-xs text-amber-600', text: 'Missing' }),
            el('button', { type: 'button', class: 'text-xs btn-secondary btn-sm', text: d.id ? 'Replace' : 'Upload', onclick: function () { inp.click(); } }),
            inp
          ]));
        });
      }
      api('GET', '/hr/employees/' + userId + '/docs').then(function (r) { draw(r.data.documents); }).catch(function (e) { box.lastChild.textContent = e.message; });
      return box;
    }

    // ── "+ New employee": auto code, all details, login + password, mandatory documents ──
    var NEW_DOCS = [['AADHAAR', 'Aadhaar card'], ['PAN', 'PAN card'], ['BANK_PASSBOOK', 'Bank passbook (front page)'], ['PHOTO', 'Passport size photo'],
      ['SSLC', '10th mark sheet'], ['HSC', '12th mark sheet'], ['DEGREE', 'Degree certificate']];
    // [name, label, required, type/options]
    var NEW_GROUPS = [
      { title: 'Login & job', fields: [
        ['name', 'Full name', 1], ['email', 'E-mail (login)', 1, 'email'], ['phone', 'Mobile number', 1, 'tel'],
        ['role', 'Role', 1, [['SALES', 'Sales'], ['SALES_ENGINEER', 'Sales Engineer'], ['MANAGER', 'Manager'], ['ACCOUNTS', 'Accounts'], ['ADMIN', 'Administrator']]],
        ['designation', 'Designation', 1], ['department', 'Department', 1],
        ['employmentType', 'Employment type', 0, EMPLOYMENT_TYPES], ['dateOfJoining', 'Date of joining', 1, 'date'],
        ['password', 'Password (leave blank to auto-create)', 0, 'text']
      ]},
      { title: 'Personal', fields: [
        ['dateOfBirth', 'Date of birth', 1, 'date'], ['gender', 'Gender', 1, [['Male', 'Male'], ['Female', 'Female'], ['Other', 'Other']]],
        ['bloodGroup', 'Blood group', 0, [['A+', 'A+'], ['A-', 'A-'], ['B+', 'B+'], ['B-', 'B-'], ['AB+', 'AB+'], ['AB-', 'AB-'], ['O+', 'O+'], ['O-', 'O-']]],
        ['maritalStatus', 'Marital status', 0, [['Single', 'Single'], ['Married', 'Married'], ['Other', 'Other']]],
        ['fatherName', "Father's name", 1], ['fatherPhone', "Father's contact number", 0, 'tel'], ['spousePhone', "Spouse's contact number", 0, 'tel'],
        ['personalEmail', 'Personal e-mail', 0, 'email']
      ]},
      { title: 'Permanent address', fields: [
        ['permanentAddress', 'Address line', 1], ['permanentCity', 'City', 1], ['permanentDistrict', 'District', 0],
        ['permanentState', 'State', 1], ['permanentPincode', 'Pincode', 1]
      ]},
      { title: 'Emergency contact', fields: [['emergencyContactName', 'Name', 1], ['emergencyContactPhone', 'Phone', 1, 'tel']] },
      { title: 'ID & bank', fields: [
        ['aadharNumber', 'Aadhaar number (12 digits)', 1], ['panNumber', 'PAN (ABCDE1234F)', 1],
        ['bankName', 'Bank name', 1], ['bankAccountName', 'Account holder name', 0], ['bankAccountNumber', 'Account number', 1],
        ['bankIFSC', 'IFSC', 1], ['bankBranchName', 'Branch', 0], ['upiId', 'UPI ID', 0],
        ['uanNumber', 'UAN', 0], ['pfNumber', 'PF number', 0], ['esiNumber', 'ESI number', 0]
      ]}
    ];
    function openNewEmployee() {
      closeDrawer();
      var overlay = el('div', { class: 'fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-3 sm:p-6', onclick: function (e) { if (e.target === overlay) closeDrawer(); } });
      var form = el('form', { class: 'card w-full max-w-4xl p-5 my-4', 'data-new-emp-form': '1', novalidate: 'novalidate' });
      overlay.appendChild(form);
      drawerEl = overlay;
      document.body.appendChild(overlay);
      var prefixSel = el('select', { class: 'input', name: 'prefix', style: 'max-width:6rem' }, [el('option', { value: 'TMS', text: 'TMS' }), el('option', { value: 'APJ', text: 'APJ' })]);
      var codeIn = el('input', { class: 'input font-mono font-semibold', name: 'employeeCode', 'data-emp-code': '1', placeholder: 'TMS-001', style: 'max-width:9rem' });
      function fetchCode() { api('GET', '/hr/next-code?prefix=' + prefixSel.value).then(function (r) { codeIn.value = r.data.code; }).catch(function () {}); }
      prefixSel.addEventListener('change', fetchCode);
      fetchCode();
      var err = el('div', { class: 'hidden rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 mt-3', 'data-new-err': '1' });
      form.appendChild(el('div', { class: 'flex items-start justify-between gap-3 mb-3' }, [
        el('div', {}, [
          el('h2', { class: 'section-title mb-0', text: 'New employee' }),
          el('p', { class: 'text-xs text-muted mt-0.5', text: 'Fields marked * and all 7 documents are required. The login is created when you save.' })
        ]),
        el('button', { type: 'button', class: 'p-1 rounded text-slate-400 hover:text-slate-600', text: '✕', onclick: closeDrawer })
      ]));
      form.appendChild(el('div', { class: 'flex items-end gap-2 flex-wrap rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 mb-2' }, [
        el('label', { class: 'block' }, [el('span', { class: 'label', text: 'Company' }), prefixSel]),
        el('label', { class: 'block' }, [el('span', { class: 'label', text: 'Employee code / user ID' }), codeIn]),
        el('p', { class: 'text-xs text-muted pb-2', text: 'Auto-numbered. The employee signs in with this ID or the e-mail.' })
      ]));
      NEW_GROUPS.forEach(function (g) {
        var grid = el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3' });
        g.fields.forEach(function (f) {
          var input;
          if (Array.isArray(f[3])) input = el('select', { class: 'input', name: f[0] }, [el('option', { value: '', text: '— Select —' })].concat(f[3].map(function (o) { return el('option', { value: o[0], text: o[1] }); })));
          else input = el('input', { class: 'input', name: f[0], type: f[3] || 'text', autocomplete: f[0] === 'password' ? 'new-password' : 'off' });
          if (f[0] === 'role') input.value = 'SALES';
          if (f[0] === 'employmentType') input.value = 'FULL_TIME';
          if (f[2]) input.setAttribute('data-req', f[1]);
          input.addEventListener('input', function () { input.style.borderColor = ''; });
          input.addEventListener('change', function () { input.style.borderColor = ''; });
          grid.appendChild(el('label', { class: 'block' }, [el('span', { class: 'label', text: f[1] + (f[2] ? ' *' : '') }), input]));
        });
        form.appendChild(el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-muted mt-4 mb-2', text: g.title }));
        form.appendChild(grid);
      });
      var docGrid = el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-3' });
      NEW_DOCS.forEach(function (d) {
        var inp = el('input', { type: 'file', name: 'doc_' + d[0], accept: '.pdf,.jpg,.jpeg,.png', class: 'block w-full text-sm', 'data-req': d[1] + ' (file)' });
        inp.addEventListener('change', function () { inp.style.borderColor = ''; });
        docGrid.appendChild(el('label', { class: 'block rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-2.5' }, [el('span', { class: 'label', text: d[1] + ' *' }), inp]));
      });
      form.appendChild(el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-muted mt-5 mb-1', text: 'Documents (PDF / JPG / PNG, up to 8 MB each)' }));
      form.appendChild(docGrid);
      form.appendChild(err);
      var saveBtn = el('button', { type: 'submit', class: 'btn-primary', 'data-new-save': '1', text: 'Create employee & login' });
      form.appendChild(el('div', { class: 'flex gap-2 justify-end mt-5' }, [el('button', { type: 'button', class: 'btn-secondary', text: 'Cancel', onclick: closeDrawer }), saveBtn]));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var miss = [];
        form.querySelectorAll('[data-req]').forEach(function (i) {
          var empty = i.type === 'file' ? !(i.files && i.files.length) : !String(i.value || '').trim();
          i.style.borderColor = empty ? '#dc2626' : '';
          if (empty) miss.push(i.getAttribute('data-req'));
        });
        if (miss.length) { err.textContent = 'Please fill / attach: ' + miss.join(', '); err.classList.remove('hidden'); err.scrollIntoView({ block: 'center' }); return; }
        err.classList.add('hidden');
        saveBtn.disabled = true; saveBtn.textContent = 'Creating…';
        var fd = new FormData(form);
        fd.set('presentAddressSameAsPermanent', '1');
        apiForm('/hr/employees', fd).then(function (r) {
          showCredentials(form, r.data);
          load();
        }).catch(function (ex) {
          saveBtn.disabled = false; saveBtn.textContent = 'Create employee & login';
          err.textContent = ex.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'center' });
        });
      });
    }
    function showCredentials(form, d) {
      var L = d.login || {};
      var text = 'Employee ID: ' + L.userId + '\nE-mail: ' + L.email + '\nPassword: ' + L.password + '\nSign in at: ' + location.origin + '/login/';
      form.innerHTML = '';
      form.appendChild(el('div', { class: 'text-center py-4', 'data-new-done': '1' }, [
        el('div', { class: 'text-4xl mb-2', text: '✅' }),
        el('h2', { class: 'section-title', text: (d.user && d.user.name) + ' added' }),
        el('p', { class: 'text-sm text-muted mb-4', text: 'Login created and all 7 documents saved. Give these details to the employee — the password is shown only now.' }),
        el('div', { class: 'inline-block text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-5 py-4 font-mono text-sm space-y-1' }, [
          el('div', {}, ['Employee ID: ', el('b', { 'data-cred-id': '1', text: L.userId })]),
          el('div', {}, ['E-mail:      ', el('b', { text: L.email })]),
          el('div', {}, ['Password:    ', el('b', { 'data-cred-pass': '1', text: L.password })])
        ]),
        el('div', { class: 'flex gap-2 justify-center mt-5' }, [
          el('button', { type: 'button', class: 'btn-secondary', text: 'Copy', onclick: function (e) { try { navigator.clipboard.writeText(text); e.target.textContent = 'Copied ✓'; } catch (x) {} } }),
          el('button', { type: 'button', class: 'btn-primary', text: 'Done', onclick: closeDrawer })
        ])
      ]));
    }

    function ROLE_LABELS() {
      return { SUPER_ADMIN: 'Super Admin', ADMIN: 'Administrator', MANAGER: 'Manager', SALES_ENGINEER: 'Sales Engineer', SALES: 'Sales' };
    }

    load();
  }

  window.HR = { mount: mount, isAdmin: function () {
    try {
      var u = JSON.parse(localStorage.getItem('crm_user') || 'null');
      return !!u && ADMIN_ROLES.indexOf(u.role) !== -1;
    } catch (e) { return false; }
  } };
})();
