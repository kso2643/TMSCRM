/*
 * APJ CRM for Windows — a secure window onto https://crm.apjtech.in.
 *
 * Security:
 *  - the page has no access to Node / the computer (contextIsolation, sandbox, no nodeIntegration)
 *  - only crm.apjtech.in / api.apjtech.in open inside the app, over HTTPS; other links open
 *    in the normal browser; certificate errors are never ignored
 *  - camera / microphone / location / notifications are only given to the CRM's own pages
 *  - login is kept in an encrypted, app-only profile; "Sign out & clear data" wipes it
 *  - one window, no developer tools, no remote-module, hardened Electron fuses
 */
const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const path = require('path');

const APP_URL = 'https://crm.apjtech.in';
const ALLOWED = new Set(['crm.apjtech.in', 'api.apjtech.in']);
const PARTITION = 'persist:apjcrm';

function allowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ALLOWED.has(u.hostname); } catch (e) { return false; }
}
function external(url) {
  try { const u = new URL(url); if (['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol)) shell.openExternal(url); } catch (e) {}
}

app.enableSandbox();
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const secureWeb = {
  partition: PARTITION,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  devTools: !app.isPackaged,
  plugins: true,          // built-in PDF viewer
  spellcheck: true,
};

function harden(contents) {
  contents.on('will-navigate', (e, url) => { if (!allowed(url) && !url.startsWith('file:')) { e.preventDefault(); external(url); } });
  contents.on('will-redirect', (e, url) => { if (!allowed(url)) { e.preventDefault(); external(url); } });
  contents.setWindowOpenHandler(({ url }) => {
    if (allowed(url) || url.startsWith('blob:') || url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: secureWeb } };
    }
    external(url);
    return { action: 'deny' };
  });
  contents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) contents.loadFile(path.join(__dirname, 'offline.html'));
  });
}

function nav() { return win ? (win.webContents.navigationHistory || win.webContents) : null; }

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'APJ CRM', backgroundColor: '#ffffff', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: secureWeb,
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  harden(win.webContents);
  win.loadURL(APP_URL + '/dashboard/');
}

app.on('web-contents-created', (e, contents) => {
  contents.on('will-attach-webview', ev => ev.preventDefault());
  harden(contents);
});

app.on('certificate-error', (event, webContents, url, error, cert, callback) => { callback(false); });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(ses.getUserAgent().replace(/Electron\/\S+\s?/, '') + ' APJCRM-Windows/' + app.getVersion());
  const okPerms = new Set(['geolocation', 'media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(okPerms.has(permission) && allowed(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, permission, origin) => okPerms.has(permission) && allowed(origin));
  // downloads: always ask where to save
  ses.on('will-download', (event, item) => {
    item.setSaveDialogOptions({ title: 'Save file', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'APJ CRM', submenu: [
      { label: 'Dashboard', click: () => win && win.loadURL(APP_URL + '/dashboard/') },
      { role: 'reload' }, { role: 'forceReload' },
      { type: 'separator' },
      { label: 'Sign out && clear data on this computer', click: async () => {
        const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Clear and sign out', 'Cancel'], defaultId: 1, cancelId: 1,
          message: 'Remove the login and all saved CRM data from this computer?' });
        if (r.response !== 0) return;
        await ses.clearStorageData(); await ses.clearCache();
        win.loadURL(APP_URL + '/login/');
      } },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Go', submenu: [
      { label: 'Back', accelerator: 'Alt+Left', click: () => { const h = nav(); if (h && h.canGoBack()) h.goBack(); } },
      { label: 'Forward', accelerator: 'Alt+Right', click: () => { const h = nav(); if (h && h.canGoForward()) h.goForward(); } },
    ] },
  ]));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
