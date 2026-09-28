#!/usr/bin/env bun
/**
 * enigma-jev: break Enigma messages with a Bombe, a hill-climber and Jev.
 *
 *   enigma-jev break <ciphertext> [--machine I|M3|M4] [--service Heer|Luftwaffe|Kriegsmarine] [--date YYYY-MM-DD]
 *                    [--crib TEXT[@pos]]... [--mode auto|bombe|climb|key] [--rotors ..] [--reflector ..] [--rings ..] [--plugs ".."] [--no-jev]
 *   enigma-jev backtest [historical|synthetic|all] [--tiers verify,key,crib,bombe,climb] [--only id,..] [--limit N] [--no-jev] [--concurrency N]
 *   enigma-jev encrypt|decrypt --rotors II,IV,V --reflector B --rings 02,21,12 --start BLA --plugs "AV BS .." <text>
 *   enigma-jev doctor [--ping]
 */
import { join } from 'node:path';
import { EXCLUDED, historicalCases, syntheticCases } from './backtest/cases.js';
import { caseLine, summaryText, writeReport } from './backtest/report.js';
import { runBacktest, summarize } from './backtest/run.js';
import { bombe, cribFits } from './break/bombe.js';
import type { Candidate } from './break/engine.js';
import { clean, describeKey, type EnigmaKey, encrypt, groups, parseSetting } from './enigma/machine.js';
import { DEFAULT_JEV_MODEL, JEV_LOG, jevFromEnv, loadJevKey } from './jev/client.js';
import { rankCribs, type Service } from './jev/cribs.js';
import { distinct, judge } from './jev/judge.js';
import { german } from './lang/ngrams.js';
import {
  ACCEPT,
  freeGermanness,
  knownOrder,
  type Machine,
  ordersFor,
  runBombe,
  runClimb,
  runKey,
  type TierName,
} from './pipeline/tiers.js';

type Flags = Record<string, string[]>;
function parse(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [],
    flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const [k, inline] = a.slice(2).split('=');
    const v = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
    flags[k] ??= [];
    flags[k].push(v);
  }
  return { pos, flags };
}
const one = (f: Flags, k: string) => f[k]?.at(-1);
const list = (s?: string) => (s ? s.split(/[,\s]+/).filter(Boolean) : undefined);

function keyFromFlags(f: Flags, needStart = true): EnigmaKey | null {
  const rotors = list(one(f, 'rotors')),
    rings = one(f, 'rings'),
    start = one(f, 'start');
  if (!rotors || !rings || (needStart && !start)) return null;
  return {
    reflector: one(f, 'reflector') ?? (rotors.length === 4 ? 'B-thin' : 'B'),
    rotors,
    rings: parseSetting(rings),
    positions: start ? parseSetting(start) : rotors.map(() => 0),
    plugboard: one(f, 'plugs') ?? '',
  };
}

function show(c: Candidate): string {
  return `  ${describeKey(c.key)}\n  via ${c.via} · German-ness ${freeGermanness(c).toFixed(2)}\n  ${groups(c.plaintext)}`;
}

async function cmdBreak(pos: string[], f: Flags): Promise<number> {
  const ct = clean(pos.join(' '));
  if (ct.length < 20) {
    console.error('Give a ciphertext of at least 20 letters.');
    return 2;
  }
  const machine = (one(f, 'machine') ?? 'I') as Machine,
    service = one(f, 'service') as Service | undefined,
    date = one(f, 'date');
  const mode = one(f, 'mode') ?? 'auto';
  const jev = f['no-jev'] ? null : jevFromEnv();
  const lm = german();
  const found: Candidate[] = [];
  const log = (s: string) => console.log(s);
  log(
    `${ct.length} letters · ${machine}${service ? ` · ${service}` : ''}${date ? ` · ${date}` : ''} · Jev ${jev ? 'on' : 'off'}`,
  );

  const daily = keyFromFlags(f, false);
  if (mode === 'key' || (mode === 'auto' && daily && f.plugs)) {
    if (!daily) {
      console.error('--mode key needs --rotors, --rings and --plugs (the daily key).');
      return 2;
    }
    log('Daily key known: scanning message keys…');
    found.push(...runKey(ct, daily).candidates);
  }
  const accepted = () => found.length > 0 && freeGermanness(found.sort((a, b) => b.score - a.score)[0]) >= ACCEPT;
  const m4Order =
    machine === 'M4' && one(f, 'rotors')
      ? knownOrder({
          reflector: one(f, 'reflector') ?? 'B-thin',
          rotors: list(one(f, 'rotors'))!,
          rings: [0, 0, 0, 0],
          positions: [0, 0, 0, 0],
          plugboard: '',
        })
      : undefined;
  if (machine === 'M4' && !m4Order && (mode === 'auto' || mode === 'bombe'))
    log(
      'Note: no --rotors for an M4, so the Bombe searches 2 greek wheels × 2 reflectors × 336 orders; expect a long run.',
    );

  if (!accepted() && (mode === 'auto' || mode === 'bombe')) {
    const userCribs = (f.crib ?? []).map(s => {
      const [text, at] = s.split('@');
      return { text: clean(text), at: at === undefined ? 0 : Number(at) };
    });
    for (const c of userCribs) {
      if (!cribFits(ct, c.text, c.at)) {
        log(`Crib ${c.text}@${c.at} clashes with the ciphertext (a letter would encipher to itself); skipped.`);
        continue;
      }
      log(`Bombe: your crib ${c.text}@${c.at}…`);
      const r = bombe(ct, c.text, c.at, { orders: m4Order ? [m4Order] : ordersFor(machine, date) }, lm, {
        turnovers: 'none',
      });
      found.push(...r.candidates.slice(0, 3));
      if (!accepted())
        found.push(
          ...bombe(ct, c.text, c.at, { orders: m4Order ? [m4Order] : ordersFor(machine, date) }, lm, {
            turnovers: 'all',
          }).candidates.slice(0, 3),
        );
      if (accepted()) break;
    }
    if (!accepted()) {
      const ranking = await rankCribs(ct, { service, date, machine }, jev).catch(() =>
        rankCribs(ct, { service, date, machine }, null),
      );
      log(
        `Cribs that fit the start (${ranking.source} order): ${ranking.order
          .slice(0, 6)
          .map(
            c =>
              `${c.text}${ranking.probabilities[c.text] !== undefined ? ` ${ranking.probabilities[c.text].toFixed(2)}` : ''}`,
          )
          .join(', ')}${ranking.order.length > 6 ? ', …' : ''}`,
      );
      const r = runBombe(ct, {
        machine,
        date,
        cribs: ranking.order.map(c => c.text),
        maxCribs: Number(one(f, 'max-cribs') ?? 3),
        m4Order,
      });
      log(`Bombe tried ${r.cribsTried?.join(', ') || 'nothing'} in ${(r.ms / 1000).toFixed(1)}s`);
      found.push(...r.candidates);
    }
  }
  if (!accepted() && (mode === 'auto' || mode === 'climb') && machine !== 'M4') {
    log('Ciphertext-only scan and hill-climb…');
    const r = runClimb(ct, machine, date);
    log(`Climb examined ${r.examined} settings in ${(r.ms / 1000).toFixed(1)}s`);
    found.push(...r.candidates);
  }
  found.sort((a, b) => b.score - a.score);
  const shown = distinct(found, 3);
  if (!shown.length) {
    log('No candidates.');
    return 1;
  }
  let chosen = 0,
    verdict = '';
  if (jev) {
    try {
      const v = await judge(jev, ct, shown);
      chosen = v.accepted;
      verdict =
        v.accepted >= 0
          ? `Jev accepts candidate ${'ABCD'[v.accepted]} (p=${v.pickProbability.toFixed(2)}, P(correct) ${v.readable[v.accepted].toFixed(2)})`
          : v.pick >= 0
            ? `Jev leans to ${'ABCD'[v.pick]} but below the bar (p=${v.pickProbability.toFixed(2)}, P(correct) ${v.readable[v.pick].toFixed(2)}): not broken`
            : `Jev: none of these is a correct decryption (p=${v.noneProbability.toFixed(2)})`;
    } catch (err) {
      verdict = `Jev unavailable: ${String(err).slice(0, 120)}`;
    }
  } else
    verdict =
      freeGermanness(shown[0]) >= ACCEPT
        ? 'n-gram verdict: accepted'
        : 'n-gram verdict: not German enough; probably not broken';
  for (const [k, c] of shown.entries()) log(`\n${'ABCD'[k]}${k === chosen ? ' ◀' : ''}\n${show(c)}`);
  log(`\n${verdict}`);
  if (one(f, 'json')) console.log(JSON.stringify({ candidates: shown, chosen, verdict }, null, 2));
  return chosen >= 0 && (jev || freeGermanness(shown[0]) >= ACCEPT) ? 0 : 1;
}

async function cmdBacktest(pos: string[], f: Flags): Promise<number> {
  const set = pos[0] ?? 'all';
  const tiers = (list(one(f, 'tiers')) ?? ['verify', 'key', 'crib', 'bombe', 'climb']) as TierName[];
  const jev = f['no-jev'] ? null : jevFromEnv();
  let cases = [
    ...(set !== 'synthetic' ? historicalCases() : []),
    ...(set !== 'historical' ? syntheticCases(Number(one(f, 'seed') ?? 1941)) : []),
  ];
  const only = list(one(f, 'only'));
  if (only) cases = cases.filter(c => only.some(o => c.id.includes(o)));
  if (one(f, 'limit')) cases = cases.slice(0, Number(one(f, 'limit')));
  console.log(
    `Backtest: ${cases.length} cases · tiers ${tiers.join(', ')} · Jev ${jev ? `on (${process.env.JEV_MODEL || DEFAULT_JEV_MODEL})` : 'off'}`,
  );
  for (const [id, why] of Object.entries(EXCLUDED)) if (set !== 'synthetic') console.log(`  excluded ${id}: ${why}`);
  const t0 = performance.now();
  const rows = await runBacktest(cases, {
    tiers,
    jev,
    concurrency: one(f, 'concurrency') ? Number(one(f, 'concurrency')) : undefined,
    maxCribs: Number(one(f, 'max-cribs') ?? 3),
    onRow: r => console.log(caseLine(r)),
  });
  const order = new Map(cases.map((c, i) => [c.id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const summaries: Record<string, ReturnType<typeof summarize>> = {};
  for (const kind of ['historical', 'synthetic'] as const) {
    const sub = rows.filter(r => r.kind === kind);
    if (sub.length) {
      summaries[kind] = summarize(sub);
      console.log(summaryText(summaries[kind], `${kind} (${sub.length})`));
    }
  }
  const meta = {
    cases: cases.length,
    tiers,
    jev: jev ? process.env.JEV_MODEL || DEFAULT_JEV_MODEL : null,
    jevCalls: jev?.calls ?? 0,
    jevTokens: jev ? { input: jev.inputTokens, output: jev.outputTokens } : null,
    seconds: Math.round((performance.now() - t0) / 1000),
    seed: Number(one(f, 'seed') ?? 1941),
    excluded: EXCLUDED,
  };
  const files = writeReport(join(import.meta.dir, '..', 'reports'), rows, summaries, meta);
  console.log(
    `\n${meta.seconds}s · Jev calls ${meta.jevCalls}${jev ? ` (${jev.inputTokens} in / ${jev.outputTokens} out tokens)` : ''}\nReport: ${files.md}\nData:   ${files.json}`,
  );
  return 0;
}

function cmdCipher(pos: string[], f: Flags): number {
  const key = keyFromFlags(f);
  if (!key) {
    console.error('Need --rotors, --rings and --start (and optionally --reflector, --plugs).');
    return 2;
  }
  console.log(groups(encrypt(key, pos.join(' '))));
  return 0;
}

async function cmdDoctor(f: Flags): Promise<number> {
  const key = loadJevKey();
  console.log(
    `TypeSafe key   ${key ? 'found' : 'missing: set TYPESAFE_API_KEY in the environment, ./.env or ~/.enigma-jev/.env'}`,
  );
  console.log(`Jev model      ${process.env.JEV_MODEL || DEFAULT_JEV_MODEL}`);
  console.log(`Jev call log   ${JEV_LOG}`);
  const lm = german();
  console.log(
    `German model   ${lm.trainingLetters} training letters · mean log-prob German ${lm.germanMean.toFixed(2)} vs random ${lm.randomMean.toFixed(2)}`,
  );
  if (f.ping && key) {
    const jev = jevFromEnv()!;
    const r = await jev.evaluate('Ping from enigma-jev doctor. The sky is blue.', {
      q: { type: 'noul', instructions: 'Probability that the state says the sky is blue.' },
    });
    console.log(
      `Jev ping       ${Math.round(r.latencyMs)}ms · model ${r.answers.model} · answer ${JSON.stringify(r.answers.answers.q)}`,
    );
  }
  return key ? 0 : 1;
}

const HELP = `enigma-jev · Enigma I, M3 and M4 breaking with a Bombe, a hill-climber and Jev

  break <ciphertext>        break a message (auto: daily key → Bombe with Jev-ranked cribs → ciphertext-only climb; Jev judges)
      --machine I|M3|M4  --service Heer|Luftwaffe|Kriegsmarine  --date 1941-07-07
      --crib TEXT[@pos]   your own crib, tried first      --mode auto|bombe|climb|key
      --rotors II,IV,V --reflector B --rings 02,21,12 --plugs "AV BS .."   known parts of the key
      --no-jev            n-gram verdict only
  backtest [historical|synthetic|all]
      --tiers verify,key,crib,bombe,climb  --only id,..  --limit N  --no-jev  --concurrency N  --seed N  --max-cribs N
  encrypt|decrypt <text> --rotors II,IV,V --reflector B --rings 02,21,12 --start BLA --plugs "AV BS .."
  doctor [--ping]`;

const { pos, flags } = parse(process.argv.slice(2));
const cmd = pos.shift();
async function main(): Promise<number> {
  switch (cmd) {
    case 'break':
      return cmdBreak(pos, flags);
    case 'backtest':
      return cmdBacktest(pos, flags);
    case 'encrypt':
    case 'decrypt':
      return cmdCipher(pos, flags);
    case 'doctor':
      return cmdDoctor(flags);
    default:
      console.log(HELP);
      return cmd && cmd !== 'help' ? 2 : 0;
  }
}
process.exit(await main());
