import { build, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Portable source documents, served in development and emitted unchanged for deployment.
const documents: Record<string, string> = {
  'architecture.html': fileURLToPath(new URL('./docs/architecture-overview.html', import.meta.url)),
  'oracle-server.html': fileURLToPath(new URL('./docs/oracle-server.html', import.meta.url)),
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'anotar-public-diagram-viewer',
      apply: 'build',
      async closeBundle() {
        // A separate build prevents the public entry from sharing editor/React chunks.
        await build({
          configFile: false,
          publicDir: false,
          build: {
            outDir: 'dist/share-viewer',
            emptyOutDir: true,
            rollupOptions: {
              input: fileURLToPath(new URL('./src/diagrams/public.ts', import.meta.url)),
              output: {
                format: 'es',
                entryFileNames: 'entry.js',
                chunkFileNames: '[name]-[hash].js',
                assetFileNames: '[name]-[hash][extname]',
              },
            },
          },
        });
        await build({
          configFile: false,
          publicDir: false,
          build: {
            outDir: 'dist',
            emptyOutDir: false,
            lib: {
              entry: fileURLToPath(new URL('./src/code/public.ts', import.meta.url)),
              formats: ['iife'],
              name: 'AnotarCodeCopy',
              fileName: () => 'share-code.js',
            },
          },
        });
      },
    },
    {
      name: 'anotar-architecture-document',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const file = documents[request.url?.split('?')[0].slice(1) ?? ''];
          if (!file) return next();
          if (request.method !== 'GET' && request.method !== 'HEAD') return next();
          const document = readFileSync(file);
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.setHeader('Content-Length', document.byteLength);
          response.end(request.method === 'HEAD' ? undefined : document);
        });
      },
      generateBundle() {
        for (const [fileName, file] of Object.entries(documents)) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
        }
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.DEV_PORT || 5173),
    // Keep the browser's Host/Origin pair intact for the private request guard.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.DEV_API_PORT || 8787}`,
        changeOrigin: false,
      },
      // Wiki data: the API serves MEMORY_DATA_FILE like production (server/memoryData.mjs).
      '/memory': {
        target: `http://127.0.0.1:${process.env.DEV_API_PORT || 8787}`,
        changeOrigin: false,
      },
    },
  },
});
