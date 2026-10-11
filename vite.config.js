import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'web',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined)
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // the sandbox proxies previews from *.e2b.app and *.arena.ai hosts; vite
    // otherwise answers 403 "Blocked request. This host is not allowed."
    allowedHosts: ['.e2b.app', '.arena.ai', '.localhost']
  }
});
