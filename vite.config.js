import { defineConfig } from 'vite';

// The live preview is served through a proxied host, so the dev/preview servers must accept it.
export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 1500, outDir: 'dist', emptyOutDir: true },
});
