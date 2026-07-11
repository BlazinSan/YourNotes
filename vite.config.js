import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: './', // Critical for Electron: use relative paths for built assets
  plugins: [{
    name: 'omit-unused-legacy-haven-assets',
    closeBundle() {
      // The polished scenes are now procedural and never import the old 81 MB
      // HDR/GLTF library. Keep those source assets available for future work,
      // but do not ship dead bytes in every APK and desktop installer.
      rmSync(resolve(process.cwd(), 'dist', 'haven3d'), { recursive: true, force: true });
    },
  }],
});
