// Hardens the packaged Electron app (runs after packaging, before the installer is made):
// no "run as Node", no NODE_OPTIONS / --inspect, cookies encrypted, app code only from its archive.
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function (context) {
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
