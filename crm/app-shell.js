/* ══════════════════════════════════════════════════════════════════════
   Shared page shell for standalone pages (/fuel-expense/, /hr/, and any
   future one built the same way).

   Renders the same sidebar + topbar the React app renders, from a single
   nav definition, so every standalone page's nav stays in sync instead of
   drifting across copy-pasted inline scripts. Redirects to /login/ if
   there's no token.

   Usage, at the end of a page's <body>:
     <script src="/app-shell.js"></script>
     <script src="/hr-app.js"></script>
     <script>
       AppShell.mount({ activeHref: '/hr/', title: 'HR' }, function (content) {
         HR.mount(content);
       });
     </script>

   NOTE: part of the hand-patched build. `npm run build` from source will
   not regenerate this file — see DEPLOY-README.md.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ROLE_LABELS = {
    SUPER_ADMIN: 'Super Admin', ADMIN: 'Administrator', MANAGER: 'Manager',
    SALES_ENGINEER: 'Sales Engineer', SALES: 'Sales'
  };
  // Matches require_admin() in the API (ROLE_LEVELS >= ADMIN) — the actual
  // enforced boundary for every admin-only endpoint these pages call, so
  // nav items never appear for a role that would get a 403 behind them.
  var ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

  // 24x24 stroke icon paths (lucide-compatible), inlined so pages built
  // from this shell have no external icon dependency.
  var I = {
    dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
    users:     'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    map:       'M9 20l-6-3V4l6 3m0 13l6-3m-6 3V7m6 10l6 3V7l-6-3m0 13V4',
    calendar:  'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    package:   'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
    file:      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
    layers:    'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    chart:     'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
    clock:     'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    fuel:      'M3 22h12V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2zM3 10h12M15 9h2a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2M18 5l3 3',
    idcard:    'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM7 15c0-1.66 1.79-3 4-3M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM15 8h4M15 12h4',
    appts:     'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h2M8 17h2M14 14h2M14 17h2',
    clipboard: 'M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M9 12l2 2 4-4',
    bell:      'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
    logout:    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    menu:      'M3 12h18M3 6h18M3 18h18',
    nav:       'M3 11l19-9-9 19-2-8-8-2z',
    tag:       'M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42zM7 7h.01',
    check:     'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    activity:  'M22 12h-4l-3 9L9 3l-3 9H2',
    timer:     'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'
  };

  // Same list the React layout renders, plus the standalone pages. Roles
  // on the Admin-section items mirror what the API actually enforces —
  // see the comment on ADMIN_ROLES above.
  var NAV = [
    { label: 'Dashboard',             href: '/dashboard/',      icon: 'dashboard', section: null },
    { label: 'Customers',             href: '/customers/',      icon: 'users',     section: 'CRM' },
    { label: 'Customer map',          href: '/customers/map/',  icon: 'map',       section: 'CRM' },
    { label: 'Meetings & follow-ups', href: '/meetings/',       icon: 'calendar',  section: 'CRM' },
    { label: 'Products',              href: '/products/',       icon: 'package',   section: 'Sales' },
    { label: 'Quotations',            href: '/quotations/',     icon: 'file',      section: 'Sales' },
    { label: 'Orders',                href: '/orders/',         icon: 'clipboard', section: 'Sales' },
    { label: 'Stock',                 href: '/stock/',          icon: 'layers',    section: 'Sales' },
    { label: 'Analytics',             href: '/analytics/',      icon: 'chart',     section: 'Reports' },
    { label: 'Attendance',            href: '/attendance/',     icon: 'clock',     section: 'Operations' },
    { label: 'Fuel expense',          href: '/fuel-expense/',   icon: 'fuel',      section: 'Operations' },
    { label: 'Appointments',          href: '/appointments/',   icon: 'appts',     section: 'Operations' },
    { label: 'Tasks',                 href: '/tasks/',          icon: 'timer',     section: 'Operations' },
    { label: 'Leave',                 href: '/leaves/',         icon: 'calendar',  section: 'Operations' }
  ];
  var ADMIN_NAV = [
    { label: 'Live tracking', href: '/admin/live-tracking/', icon: 'nav',      roles: ['SUPER_ADMIN','ADMIN','MANAGER'] },
    { label: 'Categories',    href: '/admin/categories/',    icon: 'tag',      roles: ADMIN_ROLES },
    { label: 'Users',         href: '/admin/users/',         icon: 'users',    roles: ADMIN_ROLES },
    { label: 'HR',            href: '/hr/',                  icon: 'idcard',   roles: ADMIN_ROLES },
    { label: 'Payroll',       href: '/payroll/',              icon: 'file',    roles: ADMIN_ROLES },
    { label: 'Approvals',     href: '/admin/approvals/',     icon: 'check',    roles: ['SUPER_ADMIN','ADMIN','MANAGER'] },
    { label: 'Reports',       href: '/admin/reports/',       icon: 'chart',    roles: ['SUPER_ADMIN','ADMIN','MANAGER'] },
    { label: 'Activity logs', href: '/admin/activity/',      icon: 'activity', roles: ['SUPER_ADMIN','ADMIN','MANAGER'] }
  ];

  function e(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
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

  function icon(name, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', cls || 'w-4 h-4 shrink-0');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', I[name] || I.dashboard);
    svg.appendChild(p);
    return svg;
  }

  function navLink(item, activeHref) {
    return e('a', {
      href: item.href,
      class: 'sidebar-link' + (item.href === activeHref ? ' sidebar-link-active' : '')
    }, [icon(item.icon), e('span', { class: 'flex-1', text: item.label })]);
  }

  function buildSidebar(role, user, activeHref, onClose) {
    var sections = ['', 'CRM', 'Sales', 'Reports', 'Operations'];
    var nav = e('nav', { class: 'flex-1 overflow-y-auto py-2 px-2 space-y-0.5' });

    sections.forEach(function (sec) {
      var items = NAV.filter(function (i) { return sec === '' ? i.section === null : i.section === sec; });
      if (!items.length) return;
      var group = e('div', {}, sec ? [e('p', { class: 'sidebar-section', text: sec })] : []);
      items.forEach(function (i) { group.appendChild(navLink(i, activeHref)); });
      nav.appendChild(group);
    });

    var adminItems = ADMIN_NAV.filter(function (i) { return i.roles.indexOf(role) !== -1; });
    if (adminItems.length) {
      var ag = e('div', {}, [e('p', { class: 'sidebar-section', text: 'Admin' })]);
      adminItems.forEach(function (i) { ag.appendChild(navLink(i, activeHref)); });
      nav.appendChild(ag);
    }

    var signOut = e('button', {
      class: 'sidebar-link w-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600',
      onclick: function () {
        try { localStorage.removeItem('crm_token'); localStorage.removeItem('crm_user'); } catch (x) {}
        location.href = '/login/';
      }
    }, [icon('logout'), ' Sign out']);

    return e('aside', {
      id: 'app-shell-aside',
      class: 'fixed inset-y-0 left-0 z-40 flex flex-col bg-white dark:bg-slate-900 border-r ' +
             'border-slate-200 dark:border-slate-700 transition-transform duration-300 w-64 ' +
             '-translate-x-full md:translate-x-0'
    }, [
      e('div', { class: 'flex items-center justify-between px-4 h-16 border-b border-slate-200 dark:border-slate-700 shrink-0' }, [
        e('div', { class: 'flex items-center gap-2.5' }, [
          e('div', { class: 'w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0' },
            [icon('users', 'w-4 h-4 text-white')]),
          e('div', {}, [
            e('p', { class: 'text-sm font-bold text-slate-900 dark:text-white leading-none', text: 'Industrial CRM' }),
            e('p', { class: 'text-[10px] text-slate-400 mt-0.5', text: ROLE_LABELS[role] || role })
          ])
        ]),
        e('button', { class: 'md:hidden p-1 rounded text-slate-400 hover:text-slate-600', text: '✕', onclick: onClose })
      ]),
      e('div', { class: 'px-2 pt-3' }, [
        e('a', { href: '/alerts/', class: 'sidebar-link relative' }, [icon('bell'), e('span', { class: 'flex-1', text: 'Alerts & reminders' })])
      ]),
      nav,
      e('div', { class: 'p-3 border-t border-slate-200 dark:border-slate-700 shrink-0' }, [
        e('div', { class: 'flex items-center gap-2.5 px-2 py-1.5 mb-1' }, [
          e('div', { class: 'w-8 h-8 bg-primary-100 dark:bg-primary-900 rounded-full flex items-center justify-center shrink-0' }, [
            e('span', { class: 'text-xs font-bold text-primary dark:text-primary-300',
                        text: ((user && user.name) || '?').charAt(0).toUpperCase() })
          ]),
          e('div', { class: 'min-w-0 flex-1' }, [
            e('p', { class: 'text-sm font-medium text-slate-900 dark:text-slate-100 truncate', text: (user && user.name) || '' }),
            e('p', { class: 'text-xs text-slate-400 truncate', text: ROLE_LABELS[role] || role })
          ])
        ]),
        signOut
      ])
    ]);
  }

  function buildTopbar(title, onMenu) {
    var isDark = document.documentElement.classList.contains('dark');
    var themeBtn = e('button', {
      class: 'p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors',
      text: isDark ? '☀' : '☾',
      onclick: function () {
        isDark = !isDark;
        document.documentElement.classList.toggle('dark', isDark);
        try { localStorage.setItem('crm_theme', isDark ? 'dark' : 'light'); } catch (x) {}
        themeBtn.textContent = isDark ? '☀' : '☾';
      }
    });
    return e('header', {
      class: 'h-16 fixed top-0 right-0 left-0 md:left-64 z-20 flex items-center gap-3 px-4 ' +
             'bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700'
    }, [
      e('button', { class: 'md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800', onclick: onMenu },
        [icon('menu', 'w-5 h-5')]),
      e('h1', { class: 'text-base font-semibold text-slate-900 dark:text-slate-100 truncate hidden sm:block', text: title }),
      e('div', { class: 'flex-1' }),
      themeBtn
    ]);
  }

  /**
   * Mounts the shell into #app-shell-root (created if absent) and calls
   * onReady(contentEl) once, handing back the element the page should
   * render its content into. Redirects to /login/ if there's no token.
   */
  function mount(opts, onReady) {
    var user = null;
    try { user = JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch (e) {}
    var hasToken = false;
    try { hasToken = !!localStorage.getItem('crm_token'); } catch (e) {}
    if (!hasToken) { location.replace('/login/'); return; }

    try {
      if (localStorage.getItem('crm_theme') === 'dark') document.documentElement.classList.add('dark');
    } catch (ex) {}

    var role = (user && user.role) || 'SALES';
    var root = document.getElementById('app-shell-root');
    if (!root) { root = e('div', { id: 'app-shell-root' }); document.body.appendChild(root); }
    root.innerHTML = '';
    root.className = 'min-h-screen bg-slate-50 dark:bg-slate-900';

    var backdrop = e('div', {
      class: 'fixed inset-0 z-30 bg-black/50 md:hidden hidden',
      onclick: function () { toggle(false); }
    });
    function toggle(open) {
      var aside = document.getElementById('app-shell-aside');
      aside.classList.toggle('translate-x-0', open);
      aside.classList.toggle('-translate-x-full', !open);
      backdrop.classList.toggle('hidden', !open);
    }

    var content = e('div', { class: 'p-4 md:p-6 max-w-screen-2xl mx-auto' });
    root.appendChild(backdrop);
    root.appendChild(buildSidebar(role, user, opts.activeHref, function () { toggle(false); }));
    root.appendChild(e('div', { class: 'md:pl-64 flex flex-col min-h-screen' }, [
      buildTopbar(opts.title || '', function () { toggle(true); }),
      e('main', { class: 'flex-1 pt-16' }, [content])
    ]));

    onReady(content, { role: role, user: user });
  }

  window.AppShell = { mount: mount, el: e, icon: icon, ADMIN_ROLES: ADMIN_ROLES };
})();
