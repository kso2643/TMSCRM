/* hard-nav.js — loaded first (before the React scripts) on the compiled React pages.

   The compiled React app moves between pages without reloading: after login it goes to
   /dashboard that way, and menu links between React pages too. It then shows its original
   built-in version of the page, without the newer screens and scripts added to each page
   since — "the old UI until I refresh". This turns every React page change into a normal
   page load:
     - the router's page fetch (index.txt, header RSC: 1) for another page → location.assign
     - its prefetches of other pages are refused (else it would switch from its cache)
     - last resort: if the address still changes to another page without a load, reload.
*/
(function hardNavigations() {
    if (!window.fetch || window.__crmHardNav) return;
    window.__crmHardNav = true;
    var origFetch = window.fetch;
    function hdr(h, k) {
      if (!h) return null;
      if (typeof h.get === 'function') return h.get(k);
      if (Array.isArray(h)) { for (var i = 0; i < h.length; i++) if (String(h[i][0]).toLowerCase() === k) return h[i][1]; return null; }
      for (var n in h) if (n.toLowerCase() === k) return h[n];
      return null;
    }
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        var h = (init && init.headers) || (input && typeof input === 'object' && input.headers);
        if (hdr(h, 'rsc') === '1' && hdr(h, 'next-router-prefetch')) {
          // Prefetches would let the router switch pages from its cache (no request to catch),
          // so they are refused; the real navigation then comes through here and loads the page.
          var pu = new URL(url, location.href);
          var pp = pu.pathname.replace(/index\.txt$/, '').replace(/\.txt$/, '/');
          if (pu.origin === location.origin && pp.replace(/\/?$/, '/') !== location.pathname.replace(/\/?$/, '/'))
            return Promise.resolve(new Response('', { status: 204 }));
        }
        if (hdr(h, 'rsc') === '1' && !hdr(h, 'next-router-prefetch')) {
          var u = new URL(url, location.href);
          if (u.origin === location.origin) {
            var path = u.pathname.replace(/index\.txt$/, '').replace(/\.txt$/, '/');
            if (!/\/$/.test(path)) path += '/';
            var here = location.pathname.replace(/\/?$/, '/');
            if (path !== here) {
              u.searchParams.delete('_rsc');
              var qs = u.searchParams.toString();
              location.assign(path + (qs ? '?' + qs : '') + (u.hash || ''));
              return new Promise(function () {});   // the page is being replaced
            }
          }
        }
      } catch (e) { /* fall through to the normal fetch */ }
      return origFetch.apply(this, arguments);
    };
  
  // last resort: the router changed the address to another page without asking the server
  try {
    var push = history.pushState;
    history.pushState = function (st, t, url) {
      var r = push.apply(this, arguments);
      try {
        if (url != null) {
          var u = new URL(String(url), location.href);
          if (u.origin === location.origin && u.pathname.replace(/\/?$/, '/') !== (window.__crmLoadedPath || '')) location.reload();
        }
      } catch (e) {}
      return r;
    };
    window.__crmLoadedPath = location.pathname.replace(/\/?$/, '/');
  } catch (e) {}
})();
