import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The Rust app serves the built frontend from `static/` via its own axum server
// (which also hosts /api and /ws). So we build into `static/` with fixed asset
// names and WITHOUT emptying the dir, to preserve config.json, icons/, sw.js,
// manifest.json and the icon PNGs that live there and are served at runtime.
export default defineConfig({
  root: 'ui',
  plugins: [vue()],
  // Those runtime files (manifest.json, /icons, sw.js, ...) are served by axum,
  // not managed by Vite — disable public-dir handling so Vite leaves the
  // absolute `/...` references in index.html untouched.
  publicDir: false,
  build: {
    outDir: '../static',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/app.[ext]',
      },
    },
  },
  // `npm run dev` gives a hot-reloading UI in the browser. It proxies the API
  // and WebSocket to the running Rust app (`cargo run`) on :3161 so fetches and
  // the /ws socket stay same-origin. The desktop window itself still loads the
  // built assets from :3161 (run `npm run build` after UI changes for that).
  server: {
    port: 3162,
    proxy: {
      '/api': 'http://localhost:3161',
      '/icons': 'http://localhost:3161',
      '/ws': { target: 'http://localhost:3161', ws: true },
    },
  },
})
