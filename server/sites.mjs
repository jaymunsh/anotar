import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostingStore } from './hosting/store.mjs';
import { serveHostedSite } from './hosting/http.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const store = createHostingStore(resolve(process.env.HOSTED_SITES_DIR || root + 'hosted-sites'));
const host = process.env.SITES_HOST || '127.0.0.1',
  port = Number(process.env.SITES_PORT || 8792);
const server = createServer((request, response) => void serveHostedSite(request, response, store));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(port, host, () => console.log(`정적 사이트: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
