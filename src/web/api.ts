/**
 * The JSON API, shared by the local server (./server.ts) and the Vercel
 * Function (api/index.ts). `routes` plugs straight into Bun.serve; `handleApi`
 * dispatches one request by path, for hosts that hand over every /api call.
 */
import { historicalCases } from '../backtest/cases.js';
import { type EnigmaKey, encrypt, type KeyPress } from '../enigma/machine.js';
import { CRIBS } from '../jev/cribs.js';
import { type OperatorStyle, toOperatorText } from '../lang/normalize.js';
import { breakStream } from './break-stream.js';
import type { BreakRequest } from './events.js';
import { latestBacktests, reportRoute } from './reports.js';
import { lock, sessionOf, statusOf, unlock } from './session.js';

type Handler = (req: Request) => Response | Promise<Response>;
type Route = Handler | { GET?: Handler; POST?: Handler };

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

export const routes = {
  '/api/status': async req => json(await statusOf(req)),
  '/api/unlock': { POST: req => unlock(req) },
  '/api/lock': { POST: req => lock(req) },
  '/api/presets': () => json({ presets: presets(), cribs: CRIBS }),
  '/api/report': () => json(latestBacktests()),
  '/api/jev-analysis': reportRoute('jev-analysis.json', 'bun run analyze:jev'),
  '/api/bombe-stops': reportRoute('bombe-stops.json', 'bun run analyze:stops'),
  '/api/judge-comparison': reportRoute('judge-comparison.json', 'bun run analyze:judges'),
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
      const s = await sessionOf(req);
      if (!s) return json({ error: 'locked' }, 401);
      return breakStream((await req.json()) as BreakRequest, s.client, s.model);
    },
  },
} satisfies Record<string, Route>;

/**
 * One API request, dispatched by path. A host that rewrites every /api/* call to one function
 * can pass the original path as `?route=` (see vercel.json); otherwise the URL's own path is used.
 */
export async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rewritten = url.searchParams.get('route');
  const path = rewritten ? `/api/${rewritten.replace(/^\/+/, '')}` : url.pathname.replace(/\/+$/, '');
  const route: Route | undefined = (routes as Record<string, Route>)[path];
  if (!route) return json({ error: `no route ${path}` }, 404);
  const handler = typeof route === 'function' ? route : route[req.method as 'GET' | 'POST'];
  if (!handler) return json({ error: `${req.method} not allowed on ${path}` }, 405);
  return handler(req);
}
