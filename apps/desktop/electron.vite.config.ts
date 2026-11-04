import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { buildCsp } from './src/main/security/csp';

/** Puts the Content-Security-Policy in the page itself, strict in builds, looser in dev. */
function cspPlugin(): Plugin {
  return {
    name: 'vozella-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const policy = buildCsp({ dev: ctx.server !== undefined });
        return html.replace(
          '<!--vozella-csp-->',
          `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

// Everything that is not a runtime-only native module is bundled, so the packaged app
// needs no node_modules tree (pnpm links make that fragile). koffi is the exception:
// it loads its own .node binary, so it stays external and ships as a dependency.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: { include: ['koffi'] },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'workers/audio': resolve(__dirname, 'src/workers/audio/index.ts'),
          'workers/asr': resolve(__dirname, 'src/workers/asr/index.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // The sandboxed preload can only require electron, so bundle everything else.
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss(), cspPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          'meeting-prompt': resolve(__dirname, 'src/renderer/meeting-prompt.html'),
          pill: resolve(__dirname, 'src/renderer/pill.html'),
        },
      },
    },
  },
});
