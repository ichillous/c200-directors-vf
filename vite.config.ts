import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the same build works on GitHub Pages (a sub-path) and at a domain root.
// The Android app bundles its own files, so it skips the service worker.
const native = process.env.NATIVE === '1';
// The commit goes into the log file header so a report can be matched to its build.
const commit = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'dev';

export default defineConfig({
  base: './',
  define: { __COMMIT__: JSON.stringify(commit) },
  // Keep function names in the Android build so crash stacks in the logs stay readable.
  esbuild: native ? { minifyIdentifiers: false } : undefined,
  plugins: [
    react(),
    !native && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'C200 Viewfinder',
        short_name: 'C200 VF',
        description: "Director's viewfinder for the Canon C200 and Sigma 18-35mm f/1.8 Art.",
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#121315',
        theme_color: '#121315',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
