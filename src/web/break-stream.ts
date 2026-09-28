/**
 * One break, streamed to the page as server-sent events (./events.ts):
 *
 *   1. crib dragging     every listed crib against the start of the intercept
 *   2. crib ranking      Jev orders the survivors (or the list order, without Jev)
 *   3. Bombe runs        the sender's crib first, then the ranked list; every crib
 *                        once without and once with a middle-rotor step inside it
 *   4. ciphertext-only   scan and hill-climb, if no crib broke it
 *   5. replay            the winning plugboard climb, frame by frame
 *
 * The search stops at the first run whose best candidate passes the rules in
 * src/pipeline/rules.ts. CPU work runs on a worker pool (./pool.ts).
 */
import { menuLoops } from '../break/bombe.js';
import type { Candidate } from '../break/engine.js';
import { clean } from '../enigma/machine.js';
import type { JevClient } from '../jev/client.js';
import { CRIBS, rankCribs } from '../jev/cribs.js';
import { judge, type Verdict } from '../jev/judge.js';
import type { Lang } from '../lang/ngrams.js';
import {
  checkGerman,
  decideByStats,
  type Judged,
  MIN_FREE,
  outcome,
  type PlannedCrib,
  parseCrib,
  planCribs,
  STRICT,
} from '../pipeline/rules.js';
import { ordersFor } from '../pipeline/tiers.js';
import type { BreakEvent, BreakRequest, CandidateView, RunVerdict, Turnovers } from './events.js';
import { mergeCandidates, WorkerPool } from './pool.js';

type Payload<T extends BreakEvent['type']> = Omit<Extract<BreakEvent, { type: T }>, 'type'>;

export function breakStream(body: BreakRequest, jev: JevClient | null, model: string | null): Response {
  let pool: WorkerPool | null = null;
  const stream = new ReadableStream({
    async start(controller: ReadableStreamDefaultController<string>) {
      const send = <T extends BreakEvent['type']>(type: T, data: Payload<T>) => {
        try {
          controller.enqueue(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        } catch {
          /* the page went away */
        }
      };
      try {
        pool = new WorkerPool();
        await run(body, jev, model, pool, send);
      } catch (err) {
        send('error', { message: String(err instanceof Error ? err.message : err) });
      } finally {
        pool?.terminate();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      pool?.terminate();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

async function run(
  body: BreakRequest,
  jev: JevClient | null,
  model: string | null,
  pool: WorkerPool,
  send: <T extends BreakEvent['type']>(type: T, data: Payload<T>) => void,
): Promise<void> {
  const lang: Lang = body.language === 'en' || body.language === 'es' ? body.language : 'de';
  const ct = clean(body.ciphertext);
  const useJev = body.useJev !== false && !!jev;
  if (ct.length < 6) throw new Error('The intercept needs at least 6 letters: there is nothing to search below that.');
  send('intercept', { ciphertext: ct, letters: ct.length, jev: useJev, model: useJev ? model : null, lang });

  // 1. Crib dragging: an Enigma never enciphers a letter to itself.
  const service = body.service;
  const listed = CRIBS.filter(c => !service || c.services.includes(service));
  send('drag', {
    cribs: listed.map(c => {
      const clashes = [...c.text].flatMap((ch, j) => (ct[j] === ch ? [j] : []));
      return {
        text: c.text,
        meaning: c.meaning,
        fits: clashes.length === 0 && c.text.length <= ct.length,
        clashes,
        loops: clashes.length ? null : menuLoops(ct, c.text, 0),
      };
    }),
  });

  // 2. Jev ranks the cribs that survive.
  const ctx = { service, date: body.date, machine: 'I' as const };
  let ranking = await rankCribs(ct, ctx, null);
  if (useJev) {
    try {
      ranking = await rankCribs(ct, ctx, jev);
    } catch (err) {
      send('jev-error', { stage: 'cribs', message: String(err).slice(0, 200) });
    }
  }
  send('jev-cribs', {
    source: ranking.source,
    order: ranking.order.map(c => c.text),
    probabilities: ranking.probabilities,
    none: ranking.none,
    latencyMs: ranking.latencyMs ?? null,
  });

  // The judge: Jev's decision rule plus the page's evidence rules.
  const judgeOnce = async (cands: CandidateView[]): Promise<Judged> => {
    if (useJev && jev) {
      try {
        const v = await judge(jev, ct, cands as unknown as Candidate[], { language: lang });
        return { accepted: v.accepted, verdict: v };
      } catch (err) {
        send('jev-error', { stage: 'judge', message: String(err).slice(0, 200) });
      }
    }
    return { accepted: cands[0].germanness >= STRICT ? 0 : -1, verdict: null };
  };
  const read = async (cands: CandidateView[]): Promise<Judged> => {
    if (!cands.length) return { accepted: -1, verdict: null };
    if (lang !== 'de') return decideByStats(cands, ct.length, useJev ? (await judgeOnce(cands)).verdict : null);
    return checkGerman(await judgeOnce(cands), cands, ct.length);
  };
  const verdictOf = (cands: CandidateView[], judged: Judged, ms: number): RunVerdict => ({
    ms,
    best: cands[Math.max(0, judged.accepted)] ?? null,
    accepted: judged.accepted >= 0,
    jev: judged.verdict,
    thin: judged.thin ?? false,
    disagree: judged.disagree ?? null,
    decidedBy: judged.decidedBy,
    fit: cands[Math.max(0, judged.accepted)]?.germanness ?? null,
  });

  // 3. The Bombe, crib by crib, until one run is accepted.
  const user = parseCrib(body.crib, clean);
  const plan = planCribs(user, ranking, lang, ct.length, body.maxCribs);
  if (!plan.length && lang !== 'de' && ct.length >= MIN_FREE + 6)
    send('note', {
      title: 'The crib list is German',
      body: `This intercept is marked ${lang === 'en' ? 'English' : 'Spanish'}, and Bletchley's cribs are German phrases. Give the Bombe a crib (the message's first words) for a real chance; the ciphertext-only search runs meanwhile.`,
    });
  else if (!plan.length)
    send('note', {
      title: 'No crib can prove anything here',
      body: `With ${ct.length} letters, every crib would leave fewer than ${MIN_FREE} letters to judge the result by. Skipping the Bombe; the ciphertext-only search still runs, and any "German" it finds is suspect.`,
    });

  const orders = ordersFor('I', body.date).length;
  const seen: CandidateView[] = [];
  let win: (Judged & { cands: CandidateView[] }) | null = null;

  const tryCrib = async (c: PlannedCrib, turnovers: Turnovers) => {
    send('bombe-start', {
      crib: c.text,
      at: c.at,
      source: c.source,
      turnovers,
      loops: menuLoops(ct, c.text, c.at),
      menu: Array.from(c.text, (p, j) => [p, ct[c.at + j], j] as [string, string, number]),
      orders,
      workers: pool.size,
    });
    const t = performance.now();
    const r = await pool.spread(
      orders,
      slice => ({
        op: 'bombe',
        ciphertext: ct,
        machine: 'I',
        date: body.date,
        crib: c.text,
        at: c.at,
        turnovers,
        slice,
        lang,
      }),
      p => send('bombe-progress', p),
    );
    seen.push(...r.candidates);
    const judged = await read(r.candidates);
    send('bombe-done', {
      crib: c.text,
      turnovers,
      stops: r.stops,
      ...verdictOf(r.candidates, judged, Math.round(performance.now() - t)),
    });
    if (judged.accepted >= 0) win = { cands: r.candidates, ...judged };
  };

  const own = user && plan[0]?.source === 'your crib';
  if (own) {
    await tryCrib(plan[0], 'none');
    if (!win) await tryCrib(plan[0], 'all');
  }
  const rest = plan.slice(own ? 1 : 0);
  for (const c of rest) if (!win) await tryCrib(c, 'none');
  // Still nothing: the middle rotor may have stepped inside the crib (likelier the longer the crib).
  for (const c of rest) if (!win) await tryCrib(c, 'all');

  // 4. Ciphertext only, the last resort.
  if (!win) {
    send('climb-start', { orders, workers: pool.size });
    const t = performance.now();
    const r = await pool.spread(
      orders,
      slice => ({ op: 'climb', ciphertext: ct, machine: 'I', date: body.date, slice, lang }),
      p => send('climb-progress', p),
    );
    seen.push(...r.candidates);
    const judged = await read(r.candidates);
    send('climb-done', verdictOf(r.candidates, judged, Math.round(performance.now() - t)));
    if (judged.accepted >= 0) win = { cands: r.candidates, ...judged };
  }

  // 5. Replay the winner's plugboard climb, then show the candidates Jev read.
  const final = win as (Judged & { cands: CandidateView[] }) | null;
  const cands = final ? final.cands : mergeCandidates(seen);
  const lead = final ? cands[final.accepted] : cands[0];
  if (lead) {
    const replay = await pool.call<{
      type: 'result';
      locked: string;
      frames: { plugboard: string; plaintext: string }[];
    }>({
      op: 'replay',
      ciphertext: ct,
      candidate: lead,
      lang,
    });
    send('replay', { locked: replay.locked, frames: replay.frames });
  }
  send('candidates', { candidates: cands });
  let verdict: Verdict | null = final?.verdict ?? null;
  if (!final && useJev && cands.length) verdict = (await read(cands)).verdict;
  if (verdict) send('jev-judge', { ...verdict, advisory: lang !== 'de' });
  const chosen = final ? final.accepted : -1;
  send('result', {
    chosen,
    verdict: outcome(chosen, lang, useJev, ct.length),
    candidate: chosen >= 0 ? cands[chosen] : (cands[0] ?? null),
    jevCalls: jev?.calls ?? 0,
  });
}
