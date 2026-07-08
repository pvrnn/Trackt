// Production entry: serves the built client assets and delegates everything
// else to the TanStack Start SSR fetch handler (dist/server/server.js).
// Run `pnpm build` first; then `node server.mjs` (honors PORT/HOST).
import { fileURLToPath } from 'node:url';
import { serve } from 'srvx';
import { serveStatic } from 'srvx/static';
import server from './dist/server/server.js';

const clientDir = fileURLToPath(new URL('./dist/client', import.meta.url));

serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST ?? '0.0.0.0',
  middleware: [serveStatic({ dir: clientDir })],
  fetch: (request) => server.fetch(request),
});
