import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// One portable source document is served in development and emitted unchanged for deployment.
const architectureFile = fileURLToPath(new URL('./docs/architecture-overview.html', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'anotar-architecture-document',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/architecture.html') return next();
          if (request.method !== 'GET' && request.method !== 'HEAD') return next();
          const document = readFileSync(architectureFile);
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.setHeader('Content-Length', document.byteLength);
          response.end(request.method === 'HEAD' ? undefined : document);
        });
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'architecture.html', source: readFileSync(architectureFile) });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.DEV_PORT || 5173),
    // Keep the browser's Host/Origin pair intact for the private request guard.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.DEV_API_PORT || 8787}`, changeOrigin: false } },
  },
});
