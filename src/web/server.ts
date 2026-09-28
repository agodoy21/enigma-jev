/**
 * The web server: three pages and a small JSON API.
 *
 *   bun run web            → http://localhost:5199
 *
 *   /            the machine: set a key, type, transmit, break, decrypt
 *   /research    the research paper, with its live figures
 *   /jev         the Jev performance paper
 *
 * The API lives in ./api.ts, shared with the Vercel Function (api/index.ts).
 * The machine opens with a TypeSafe key, verified once and sealed into an
 * HttpOnly session cookie (./session.ts). A break streams as server-sent events
 * (./break-stream.ts, protocol in ./events.ts). Reports are read from reports/
 * on each request, so rerunning an analysis updates the pages.
 */
import index from '../../web/pages/index.html';
import jevPage from '../../web/pages/jev.html';
import research from '../../web/pages/research.html';
import { routes } from './api.js';

export function startServer(port = Number(process.env.PORT ?? 5199)) {
  return Bun.serve({
    port,
    idleTimeout: 255,
    development: process.env.NODE_ENV !== 'production',
    routes: {
      '/': index,
      '/research': research,
      '/jev': jevPage,
      ...routes,
    },
  });
}

if (import.meta.main) {
  const server = startServer();
  console.log(`enigma-jev on ${server.url} · the machine asks for a TypeSafe key`);
}
