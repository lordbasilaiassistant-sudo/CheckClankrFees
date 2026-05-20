import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
