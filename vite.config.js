import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path: GitHub Pages serves project sites at /<repo-name>/, not /.
// VITE_BASE is set by the Pages workflow to '/CheckClankrFees/'. For local
// `npm run dev` and any other host (Cloudflare Pages, Netlify, your own
// nginx at the root), we default to '/' so nothing breaks.
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5173, host: true },
  // sourcemap is false in production so prod bundles don't ship original
  // source (reduces RE surface; smaller upload). Dev mode (`vite dev`)
  // still gets full sourcemaps automatically from Vite.
  build: { target: 'es2022', sourcemap: false },
  define: {
    // wagmi expects globalThis.process.env to exist in some code paths
    'process.env': {},
  },
});
