/**
 * Shared helpers for /payroll/* pages: session/auth (reuses the main CRM's
 * localStorage session, same as the original /payroll/index.html), the API
 * fetch wrapper, formatting, and the cross-page nav bar.
 *
 * Usage in a page:
 *   <script src="../payroll-common.js"></script>
 *   <script>
 *     PayrollCommon.boot(function (user) {
 *       PayrollCommon.renderNav('advances');
 *       // ...page init...
 *     });
 *   </script>
 */
window.PayrollCommon = (function () {
  "use strict";

  // If this section is ever moved to a different address than the rest of
  // the CRM, this is the one line that needs to stay correct (matches the
  // original /payroll/index.html).
  const API_BASE = "https://api.apjtech.in/api";

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const money = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  let token = null;
  let user = null;

  function doLogout() {
    localStorage.removeItem("crm_token");
    localStorage.removeItem("crm_user");
    window.location.href = "/login";
  }

  async function api(path, { method = "GET", body = null, isPublic = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (!isPublic) {
      if (!token) throw new Error("Not signed in.");
      headers["Authorization"] = "Bearer " + token;
    }
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json;
    try {
      json = await res.json();
    } catch (e) {
      json = { success: false, message: "Unexpected response from server." };
    }
    if (res.status === 401 && !isPublic) doLogout();
    if (!json.success) throw new Error(json.message || "Something went wrong.");
    return json.data;
  }

  // File downloads need the auth header, so they go through fetch + blob
  // rather than a plain <a href> link (mirrors the original page's .xlsx
  // export handling).
  /* A download must really be the file: Excel / zip start with "PK", PDF with "%PDF".
     If something was printed in front of it, cut it off; if the server sent an
     error page instead, show that message rather than saving a broken file. */
  function checkFile(b, name) {
    var sig = /\.(xlsx|zip)$/i.test(name || '') ? [80, 75, 3, 4] : /\.pdf$/i.test(name || '') ? [37, 80, 68, 70] : null;
    if (!sig || !b || !b.arrayBuffer) return Promise.resolve(b);
    return b.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), lim = Math.min(u.length - 4, 1 << 20);
      for (var i = 0; i <= lim; i++) {
        if (u[i] === sig[0] && u[i + 1] === sig[1] && u[i + 2] === sig[2] && u[i + 3] === sig[3]) return i === 0 ? b : new Blob([u.subarray(i)], { type: b.type });
      }
      var t = new TextDecoder().decode(u.subarray(0, 4000)), m = '';
      try { m = JSON.parse(t).message || ''; } catch (e) { m = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
      throw new Error('The server sent an error instead of the file' + (m ? ': ' + m : '.'));
    });
  }
  function downloadFile(path, filename) {
    fetch(API_BASE + path, { headers: { Authorization: "Bearer " + token } })
      .then((r) => {
        if (!r.ok) throw new Error("Download failed.");
        return r.blob().then((b) => checkFile(b, filename));
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((e) => toast(e && e.message ? e.message : "Download failed.", true));
  }

  function toast(msg, isError) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.style.display = "block";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.style.display = "none";
    }, 3500);
  }

  // Checks the shared CRM session + ADMIN/SUPER_ADMIN gate, same rule as
  // the original /payroll/index.html. Calls onReady(user) once past the
  // gate; the caller's markup must include #login-screen, #app,
  // #gate-title, #gate-message, #gate-link, #user-name, #user-avatar,
  // #logout-btn (same IDs as the original page).
  function boot(onReady) {
    const t = localStorage.getItem("crm_token");
    const userRaw = localStorage.getItem("crm_user");
    if (!t || !userRaw) {
      window.location.href = "/login";
      return;
    }
    let u;
    try {
      u = JSON.parse(userRaw);
    } catch (e) {
      window.location.href = "/login";
      return;
    }
    if (!["ADMIN", "SUPER_ADMIN"].includes(u.role)) {
      document.getElementById("gate-title").textContent = "Admins only";
      document.getElementById("gate-message").textContent = "Your account (" + u.role + ") doesn't have access to Payroll.";
      document.getElementById("gate-link").style.display = "inline-flex";
      return;
    }
    token = t;
    user = u;
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.getElementById("user-name").textContent = u.name;
    document.getElementById("user-avatar").textContent = (u.name || "?").trim().charAt(0).toUpperCase();
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", doLogout);
    onReady(u);
  }

  const NAV_ITEMS = [
    { href: "/payroll/", label: "Payroll Records", key: "records" },
    { href: "/payroll/dashboard/", label: "Dashboard", key: "dashboard" },
    { href: "/payroll/advances/", label: "Advances", key: "advances" },
    { href: "/payroll/advance-recovery/", label: "Recovery", key: "recovery" },
    { href: "/payroll/ledger/", label: "Ledger", key: "ledger" },
  ];

  function renderNav(activeKey) {
    const el = document.getElementById("payroll-nav");
    if (!el) return;
    el.innerHTML = NAV_ITEMS.map(
      (i) => `<a href="${i.href}"${i.key === activeKey ? ' class="active"' : ""}>${i.label}</a>`
    ).join("");
  }

  // Populates a <select> with active employees for pickers (Advances form,
  // Ledger lookup). Returns the loaded list.
  async function loadEmployeeOptions(selectEl, placeholder) {
    try {
      const data = await api("/users?limit=200&isActive=true");
      const employees = data.items || [];
      selectEl.innerHTML =
        `<option value="">${placeholder || "Select employee…"}</option>` +
        employees
          .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.employeeCode ? " · " + escapeHtml(e.employeeCode) : ""}</option>`)
          .join("");
      return employees;
    } catch (err) {
      toast(err.message, true);
      return [];
    }
  }

  return {
    API_BASE,
    MONTHS,
    money,
    escapeHtml,
    api,
    downloadFile,
    toast,
    boot,
    logout: doLogout,
    renderNav,
    loadEmployeeOptions,
    getUser: () => user,
  };
})();
