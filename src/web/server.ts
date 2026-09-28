/**
 * The web server: three pages and a small JSON API.
 *
 *   bun run web            → http://localhost:5199
 *
 *   /            the machine: set a key, type, transmit, break, decrypt
 *   /research    the research paper, with its live figures
 *   /jev         the Jev performance paper
 *
 * The machine opens with a TypeSafe key, verified once and held per session
 * (./session.ts); the browser only ever sees Jev's answers. A break streams as
 * server-sent events (./break-stream.ts, protocol in ./events.ts). Reports are
 * read from reports/ on each request, so rerunning an analysis updates the pages.
 */
import index from '../../web/pages/index.html';
import jevPage from '../../web/pages/jev.html';
import research from '../../web/pages/research.html';
import { historicalCases } from '../backtest/cases.js';
import { type EnigmaKey, encrypt, type KeyPress } from '../enigma/machine.js';
import { CRIBS } from '../jev/cribs.js';
import { type OperatorStyle, toOperatorText } from '../lang/normalize.js';
import { breakStream } from './break-stream.js';
import type { BreakRequest } from './events.js';
import { latestBacktests, reportRoute } from './reports.js';
import { lock, sessionOf, statusOf, unlock } from './session.js';

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** The historical Enigma I intercepts, offered on the page as ready-made messages. */
function presets() {
  return historicalCases()
    .filter(c => c.machine === 'I')
    .map(c => ({
      id: c.id,
      title: c.title,
      date: c.date,
      service: c.service,
      ciphertext: c.ciphertext,
      notes: c.notes ?? null,
      key: c.key,
      plaintext: c.plaintext,
      // Known plaintext, clearly labelled: most historical openers are not on the generic crib list.
      hint: c.plaintext.slice(0, 14),
    }));
}

function encryptRoute(body: { key: EnigmaKey; text: string; style?: OperatorStyle }) {
  const operatorText = toOperatorText(body.text, body.style ?? { wordSeparator: '', chToQ: true });
  if (operatorText.length < 1) throw new Error('Write at least one letter.');
  const trace: KeyPress[] = [];
  const ciphertext = encrypt(body.key, operatorText, trace);
  return { operatorText, ciphertext, trace };
}

export function startServer(port = Number(process.env.PORT ?? 5199)) {
  return Bun.serve({
    port,
    idleTimeout: 255,
    development: process.env.NODE_ENV !== 'production',
    routes: {
      '/': index,
      '/research': research,
      '/jev': jevPage,
      '/api/status': req => json(statusOf(req)),
      '/api/unlock': { POST: req => unlock(req) },
      '/api/lock': { POST: req => lock(req) },
      '/api/presets': () => json({ presets: presets(), cribs: CRIBS }),
      '/api/report': () => json(latestBacktests()),
      '/api/jev-analysis': reportRoute('jev-analysis.json', 'bun run src/analysis/jev-eval.ts'),
      '/api/bombe-stops': reportRoute('bombe-stops.json', 'bun run src/analysis/bombe-stops.ts'),
      '/api/judge-comparison': reportRoute('judge-comparison.json', '.venv/bin/python analysis/judges.py'),
      '/api/encrypt': {
        POST: async req => {
          try {
            return json(encryptRoute(await req.json()));
          } catch (err) {
            return json({ error: String(err instanceof Error ? err.message : err) }, 400);
          }
        },
      },
      '/api/break': {
        POST: async req => {
          const s = sessionOf(req);
          if (!s) return json({ error: 'locked' }, 401);
          return breakStream((await req.json()) as BreakRequest, s.client, s.model);
        },
      },
    },
  });
}

if (import.meta.main) {
  const server = startServer();
  console.log(`enigma-jev on ${server.url} · the machine asks for a TypeSafe key`);
}
