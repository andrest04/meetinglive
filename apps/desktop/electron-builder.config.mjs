// electron-builder configuration.
//
// Two variants of the same app:
//   release (default)  hardened fuses; this is what ships.
//   e2e                identical, except the Node inspector CLI fuse stays on, because
//                      Playwright's _electron.launch drives the app through it
//                      (docs/port/research/quality-packaging.md). It must never ship.
// Select with VOZELLA_PACKAGE_VARIANT=e2e.
const variant = process.env.VOZELLA_PACKAGE_VARIANT === 'e2e' ? 'e2e' : 'release';

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'app.vozella.desktop',
  productName: 'Vozella',
  executableName: 'Vozella',
  copyright: 'Vozella',
  directories: { output: variant === 'e2e' ? 'release-e2e' : 'release' },
  // The bundles in out/ contain everything except koffi, which electron-builder adds
  // from `dependencies`. Sources, tests and tooling stay out of the archive.
  files: ['out/**/*', 'package.json'],
  asar: true,
  // A native library cannot be loaded from inside an archive.
  asarUnpack: ['out/native/**/*.node', '**/node_modules/koffi/**/*.node'],
  npmRebuild: false,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // Unsigned for now. Code signing is configured when a certificate exists.
    signAndEditExecutable: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    artifactName: `Vozella-Setup-\${version}${variant === 'e2e' ? '-e2e' : ''}.\${ext}`,
  },
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: variant === 'e2e',
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    // The renderer is served from the vozella:// scheme, not file://.
    grantFileProtocolExtraPrivileges: false,
  },
};
