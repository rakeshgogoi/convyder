import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Stages a clean copy of backend/ (source only — no .venv, which is
// machine-specific and built by the first-run setup flow, see
// setup-process.ts) so packagerConfig.extraResource can bundle it into
// the app's Resources without pulling in a stale/huge venv.
const BACKEND_STAGING_DIR = path.join(__dirname, '.backend-staging', 'backend');

function stageBackendSource(): void {
  const backendSrc = path.join(__dirname, '../backend');
  fs.rmSync(BACKEND_STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(BACKEND_STAGING_DIR, { recursive: true });
  fs.cpSync(backendSrc, BACKEND_STAGING_DIR, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(backendSrc, src);
      if (rel.startsWith('.venv')) return false;
      if (rel.split(path.sep).includes('__pycache__')) return false;
      if (rel.endsWith('.pyc')) return false;
      return true;
    },
  });
}

// `@electron/osx-sign` (invoked via packagerConfig.osxSign) has its own
// automatic entitlements management for nested frameworks that overrides
// whatever custom entitlements file is passed — in practice this left
// "Electron Framework" signed with a *different* effective identity/
// entitlements set than the main executable, which macOS's Library
// Validation then rejects ("different Team IDs") as a hard crash, not
// just a permission-denied. Simplest reliable fix: skip osxSign
// entirely and deep re-sign everything ourselves in one pass here, so
// every binary in the bundle gets the exact same ad-hoc identity and
// entitlements.
function signApp(appPath: string): void {
  execFileSync('codesign', [
    '--deep',
    '--force',
    '--sign', '-',
    '--options', 'runtime',
    '--entitlements', path.join(__dirname, 'entitlements.plist'),
    appPath,
  ]);
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.codingryder.convyder',
    icon: path.join(__dirname, 'assets', 'icon'), // resolves to icon.icns on macOS
    extraResource: [BACKEND_STAGING_DIR],
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Convyder captures meeting audio and your microphone to translate speech in real time.',
    },
  },
  rebuildConfig: {},
  hooks: {
    prePackage: async () => {
      stageBackendSource();
    },
    postPackage: async (_forgeConfig, options) => {
      if (options.platform !== 'darwin') return;
      for (const outputPath of options.outputPaths) {
        const appName = fs.readdirSync(outputPath).find((f) => f.endsWith('.app'));
        if (appName) signApp(path.join(outputPath, appName));
      }
    },
  },
  makers: [
    new MakerSquirrel({
      setupIcon: path.join(__dirname, 'assets', 'icon.ico'),
    }),
    // Squirrel needs Mono+Wine to build from a non-Windows host, so it's
    // only viable running natively on Windows. A zip fallback needs
    // neither — same portable-folder shape as the darwin zip, useful for
    // a quick "does it run at all" check without the installer machinery.
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
