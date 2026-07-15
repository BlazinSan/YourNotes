import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: './', // Critical for Electron: use relative paths for built assets
  plugins: [{
    name: 'omit-unused-haven-assets',
    closeBundle() {
      // The legacy library is never used by either edition.
      rmSync(resolve(process.cwd(), 'dist', 'haven3d'), { recursive: true, force: true });

      // `public` is copied wholesale by Vite. Keep the heavyweight authored
      // GLBs out of the normal 2.5D desktop build, while retaining them for the
      // Haven desktop and Android builds selected by VITE_HAVEN_EDITION.
      if (process.env.VITE_HAVEN_EDITION !== 'heavy') {
        rmSync(resolve(process.cwd(), 'dist', 'haven-assets'), { recursive: true, force: true });
      }
    },
  }],
});
