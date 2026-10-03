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

  // Lucide icons (same set, same picks as the compiled React sidebar), as
  // [tag, attributes] nodes, inlined so pages built from this shell have no
  // external icon dependency.
  var ICONS = {
    "Activity": [["path",{"d":"M22 12h-4l-3 9L9 3l-3 9H2"}]],
    "BarChart3": [["path",{"d":"M3 3v18h18"}],["path",{"d":"M18 17V9"}],["path",{"d":"M13 17V5"}],["path",{"d":"M8 17v-3"}]],
    "Bell": [["path",{"d":"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"}],["path",{"d":"M10.3 21a1.94 1.94 0 0 0 3.4 0"}]],
    "Boxes": [["path",{"d":"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"}],["path",{"d":"m7 16.5-4.74-2.85"}],["path",{"d":"m7 16.5 5-3"}],["path",{"d":"M7 16.5v5.17"}],["path",{"d":"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"}],["path",{"d":"m17 16.5-5-3"}],["path",{"d":"m17 16.5 4.74-2.85"}],["path",{"d":"M17 16.5v5.17"}],["path",{"d":"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"}],["path",{"d":"M12 8 7.26 5.15"}],["path",{"d":"m12 8 4.74-2.85"}],["path",{"d":"M12 13.5V8"}]],
    "Building2": [["path",{"d":"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"}],["path",{"d":"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"}],["path",{"d":"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"}],["path",{"d":"M10 6h4"}],["path",{"d":"M10 10h4"}],["path",{"d":"M10 14h4"}],["path",{"d":"M10 18h4"}]],
    "CalendarCheck": [["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2","ry":"2"}],["line",{"x1":"16","x2":"16","y1":"2","y2":"6"}],["line",{"x1":"8","x2":"8","y1":"2","y2":"6"}],["line",{"x1":"3","x2":"21","y1":"10","y2":"10"}],["path",{"d":"m9 16 2 2 4-4"}]],
    "CalendarOff": [["path",{"d":"M4.18 4.18A2 2 0 0 0 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 1.82-1.18"}],["path",{"d":"M21 15.5V6a2 2 0 0 0-2-2H9.5"}],["path",{"d":"M16 2v4"}],["path",{"d":"M3 10h7"}],["path",{"d":"M21 10h-5.5"}],["line",{"x1":"2","x2":"22","y1":"2","y2":"22"}]],
    "ChevronRight": [["path",{"d":"m9 18 6-6-6-6"}]],
    "ClipboardList": [["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"M12 11h4"}],["path",{"d":"M12 16h4"}],["path",{"d":"M8 11h.01"}],["path",{"d":"M8 16h.01"}]],
    "Clock": [["circle",{"cx":"12","cy":"12","r":"10"}],["polyline",{"points":"12 6 12 12 16 14"}]],
    "Contact": [["path",{"d":"M17 18a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["circle",{"cx":"12","cy":"10","r":"2"}],["line",{"x1":"8","x2":"8","y1":"2","y2":"4"}],["line",{"x1":"16","x2":"16","y1":"2","y2":"4"}]],
    "FileText": [["path",{"d":"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}],["polyline",{"points":"14 2 14 8 20 8"}],["line",{"x1":"16","x2":"8","y1":"13","y2":"13"}],["line",{"x1":"16","x2":"8","y1":"17","y2":"17"}],["line",{"x1":"10","x2":"8","y1":"9","y2":"9"}]],
    "FlaskConical": [["path",{"d":"M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"}],["path",{"d":"M8.5 2h7"}],["path",{"d":"M7 16h10"}]],
    "Fuel": [["line",{"x1":"3","x2":"15","y1":"22","y2":"22"}],["line",{"x1":"4","x2":"14","y1":"9","y2":"9"}],["path",{"d":"M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"}],["path",{"d":"M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"}]],
    "Handshake": [["path",{"d":"m11 17 2 2a1 1 0 1 0 3-3"}],["path",{"d":"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"}],["path",{"d":"m21 3 1 11h-2"}],["path",{"d":"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"}],["path",{"d":"M3 4h8"}]],
    "LayoutDashboard": [["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],
    "ListChecks": [["path",{"d":"m3 17 2 2 4-4"}],["path",{"d":"m3 7 2 2 4-4"}],["path",{"d":"M13 6h8"}],["path",{"d":"M13 12h8"}],["path",{"d":"M13 18h8"}]],
    "LogOut": [["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}],["polyline",{"points":"16 17 21 12 16 7"}],["line",{"x1":"21","x2":"9","y1":"12","y2":"12"}]],
    "MapPin": [["path",{"d":"M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"}],["circle",{"cx":"12","cy":"10","r":"3"}]],
    "Menu": [["line",{"x1":"4","x2":"20","y1":"12","y2":"12"}],["line",{"x1":"4","x2":"20","y1":"6","y2":"6"}],["line",{"x1":"4","x2":"20","y1":"18","y2":"18"}]],
    "Package": [["path",{"d":"m7.5 4.27 9 5.15"}],["path",{"d":"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"}],["path",{"d":"m3.3 7 8.7 5 8.7-5"}],["path",{"d":"M12 22V12"}]],
    "Radio": [["path",{"d":"M4.9 19.1C1 15.2 1 8.8 4.9 4.9"}],["path",{"d":"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"}],["circle",{"cx":"12","cy":"12","r":"2"}],["path",{"d":"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"}],["path",{"d":"M19.1 4.9C23 8.8 23 15.1 19.1 19"}]],
    "ShieldCheck": [["path",{"d":"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"}],["path",{"d":"m9 12 2 2 4-4"}]],
    "Tags": [["path",{"d":"M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5Z"}],["path",{"d":"M6 9.01V9"}],["path",{"d":"m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"}]],
    "TrendingUp": [["polyline",{"points":"22 7 13.5 15.5 8.5 10.5 2 17"}],["polyline",{"points":"16 7 22 7 22 13"}]],
    "Users": [["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["path",{"d":"M16 3.13a4 4 0 0 1 0 7.75"}]],
    "Wallet": [["path",{"d":"M21 12V7H5a2 2 0 0 1 0-4h14v4"}],["path",{"d":"M3 5v14a2 2 0 0 0 2 2h16v-5"}],["path",{"d":"M18 12a2 2 0 0 0 0 4h4v-4Z"}]],
    "Route": [["circle",{"cx":"6","cy":"19","r":"3"}],["path",{"d":"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"}],["circle",{"cx":"18","cy":"5","r":"3"}]],
    "Coffee": [["path",{"d":"M17 8h1a4 4 0 1 1 0 8h-1"}],["path",{"d":"M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"}],["line",{"x1":"6","x2":"6","y1":"2","y2":"4"}],["line",{"x1":"10","x2":"10","y1":"2","y2":"4"}],["line",{"x1":"14","x2":"14","y1":"2","y2":"4"}]],
    "Database": [["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],
    "Download": [["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{"points":"7 10 12 15 17 10"}],["line",{"x1":"12","x2":"12","y1":"15","y2":"3"}]],
    "Upload": [["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{"points":"17 8 12 3 7 8"}],["line",{"x1":"12","x2":"12","y1":"3","y2":"15"}]]
  };
  // Sidebar label -> icon. Keep in sync with the React layout chunk.
  var ICON_FOR = {"Dashboard": "LayoutDashboard","Customers": "Building2","Customer map": "MapPin","Meetings & follow-ups": "Handshake","Products": "Package","Quotations": "FileText","Orders": "ClipboardList","Trials": "FlaskConical","Stock": "Boxes","Analytics": "TrendingUp","Attendance": "Clock","Fuel expense": "Fuel","Appointments": "CalendarCheck","Tasks": "ListChecks","Leave": "CalendarOff","Live tracking": "Radio","Categories": "Tags","Users": "Users","HR": "Contact","Payroll": "Wallet","Approvals": "ShieldCheck","Reports": "BarChart3","Activity logs": "Activity","Location history": "Route"};

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
    { label: 'Trials',                href: '/trials/',         icon: 'flask',     section: 'Sales' },
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
    { label: 'Location history', href: '/admin/location-history/', icon: 'nav', roles: ['SUPER_ADMIN','ADMIN','MANAGER'] },
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
    (ICONS[name] || ICONS.LayoutDashboard).forEach(function (node) {
      var c = document.createElementNS(ns, node[0]);
      Object.keys(node[1]).forEach(function (k) { c.setAttribute(k, node[1][k]); });
      svg.appendChild(c);
    });
    return svg;
  }

  function navLink(item, activeHref) {
    return e('a', {
      href: item.href,
      class: 'sidebar-link' + (item.href === activeHref ? ' sidebar-link-active' : '')
    }, [icon(ICON_FOR[item.label] || item.icon), e('span', { class: 'flex-1', text: item.label })]);
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
    }, [icon('LogOut'), ' Sign out']);

    return e('aside', {
      id: 'app-shell-aside',
      class: 'fixed inset-y-0 left-0 z-40 flex flex-col bg-white dark:bg-slate-900 border-r ' +
             'border-slate-200 dark:border-slate-700 transition-transform duration-300 w-64 ' +
             '-translate-x-full md:translate-x-0'
    }, [
      e('div', { class: 'flex items-center justify-between px-4 h-16 border-b border-slate-200 dark:border-slate-700 shrink-0' }, [
        e('div', { class: 'flex items-center gap-2.5' }, [
          e('div', { class: 'w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0' },
            [icon('Users', 'w-4 h-4 text-white')]),
          e('div', {}, [
            e('p', { class: 'text-sm font-bold text-slate-900 dark:text-white leading-none', text: 'Industrial CRM' }),
            e('p', { class: 'text-[10px] text-slate-400 mt-0.5', text: ROLE_LABELS[role] || role })
          ])
        ]),
        e('button', { class: 'md:hidden p-1 rounded text-slate-400 hover:text-slate-600', text: '✕', onclick: onClose })
      ]),
      e('div', { class: 'px-2 pt-3' }, [
        e('a', { href: '/alerts/', class: 'sidebar-link relative' + (activeHref === '/alerts/' ? ' sidebar-link-active' : '') }, [icon('Bell'), e('span', { class: 'flex-1', text: 'Alerts & reminders' })])
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
        [icon('Menu', 'w-5 h-5')]),
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

  /**
   * For pages that keep their own layout (Meetings, Quotations, Payroll…):
   * a floating "Menu" button that slides out the same CRM sidebar, so every
   * menu option is reachable from every page. Rendered in a Shadow DOM with
   * the CRM stylesheet, so the page's CSS and the sidebar's can't affect
   * each other. Called by crm-global.js on pages that have no sidebar.
   */
  function drawer() {
    if (document.getElementById('crm-nav-drawer')) return;
    var user = null, hasToken = false;
    try { user = JSON.parse(localStorage.getItem('crm_user') || 'null'); hasToken = !!localStorage.getItem('crm_token'); } catch (x) {}
    if (!hasToken) return;
    var role = (user && user.role) || 'SALES';

    // Highlight the menu item whose link is the longest prefix of this page.
    var path = location.pathname.replace(/index\.html$/, '');
    if (path.slice(-1) !== '/') path += '/';
    var active = '';
    NAV.concat(ADMIN_NAV).forEach(function (i) { if (path.indexOf(i.href) === 0 && i.href.length > active.length) active = i.href; });

    var host = e('div', { id: 'crm-nav-drawer' });
    var shadow = host.attachShadow({ mode: 'open' });
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/_next/static/css/808bab28f4c17593.css';
    var st = document.createElement('style');
    st.textContent =
      ':host{all:initial}' +
      '.crm-fab{position:fixed;left:16px;bottom:16px;z-index:2147482000;display:flex;align-items:center;gap:8px;padding:10px 16px;' +
      'border-radius:9999px;border:0;background:#1e3a5f;color:#fff;font:600 13px/1 Inter,system-ui,-apple-system,Segoe UI,sans-serif;' +
      'box-shadow:0 8px 24px rgba(15,23,42,.28);cursor:pointer}.crm-fab:hover{background:#274b78}' +
      '.crm-wrap{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}' +
      '.crm-back{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:2147482001}' +
      '#app-shell-aside{z-index:2147482002!important;box-shadow:0 10px 40px rgba(15,23,42,.3)}';
    var dark = false;
    try { dark = localStorage.getItem('crm_theme') === 'dark'; } catch (x) {}
    var wrap = e('div', { class: 'crm-wrap' + (dark ? ' dark' : '') });
    var back = e('div', { class: 'crm-back', hidden: 'hidden' });
    var aside = buildSidebar(role, user, active, function () { toggle(false); });
    aside.classList.remove('md:translate-x-0'); // always a drawer here, even on desktop
    var closeBtn = aside.querySelector('button.md\\:hidden');
    if (closeBtn) closeBtn.classList.remove('md:hidden'); // keep the ✕ visible on desktop too
    var docked = false;
    function toggle(open) {
      if (docked) open = true; // the docked desktop sidebar can't be closed
      aside.classList.toggle('translate-x-0', open);
      aside.classList.toggle('-translate-x-full', !open);
      if (open) back.removeAttribute('hidden'); else back.setAttribute('hidden', 'hidden');
      if (docked) back.setAttribute('hidden', 'hidden');
      fab.style.display = open || docked ? 'none' : 'flex';
    }
    // Desktop: dock the sidebar on the left and push the page over, exactly
    // like every other CRM page. Phones / small tablets: Menu button + drawer.
    var mq = window.matchMedia ? window.matchMedia('(min-width: 1024px)') : { matches: false };
    function applyDock() {
      docked = !!mq.matches;
      document.documentElement.style.paddingLeft = docked ? '256px' : '';
      document.documentElement.classList.toggle('crm-docked', docked);
      if (closeBtn) closeBtn.style.display = docked ? 'none' : '';
      aside.style.boxShadow = docked ? 'none' : '';
      toggle(docked);
    }
    var fab = e('button', { class: 'crm-fab', type: 'button', 'aria-label': 'Open CRM menu', onclick: function () { toggle(true); } },
      [icon('Menu', ''), 'Menu']);
    fab.firstChild.setAttribute('width', '16'); fab.firstChild.setAttribute('height', '16');
    back.addEventListener('click', function () { toggle(false); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') toggle(false); });
    wrap.appendChild(back); wrap.appendChild(aside); wrap.appendChild(fab);
    applyDock();
    if (mq.addEventListener) mq.addEventListener('change', applyDock); else if (mq.addListener) mq.addListener(applyDock);
    shadow.appendChild(css); shadow.appendChild(st); shadow.appendChild(wrap);
    document.body.appendChild(host);
  }

  window.AppShell = { mount: mount, drawer: drawer, el: e, icon: icon, ADMIN_ROLES: ADMIN_ROLES };
})();
