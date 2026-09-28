import { describe, expect, test } from 'bun:test';
import type { Verdict } from '../src/jev/judge.js';
import {
  checkGerman,
  decideByStats,
  freeLetters,
  GERMAN_FLOOR,
  MIN_FREE,
  outcome,
  parseCrib,
  planCribs,
  STRICT,
} from '../src/pipeline/rules.js';
import { KNOWN_CRIB } from '../src/pipeline/tiers.js';
import type { CandidateView } from '../src/web/events.js';

const key = { reflector: 'B', rotors: ['I', 'II', 'III'], rings: [0, 0, 0], positions: [0, 0, 0], plugboard: '' };
const cand = (germanness: number, via = 'climb'): CandidateView => ({ key, plaintext: 'X', via, score: 0, germanness });
const verdict = (accepted: number): Verdict => ({
  pick: accepted,
  accepted,
  pickProbability: 0.9,
  noneProbability: 0.05,
  readable: [0.9, 0.1, 0.1],
  latencyMs: 180,
});

describe('evidence rules for a live break', () => {
  test('a Bombe candidate is judged only on the letters outside its crib', () => {
    expect(freeLetters({ via: 'bombe WETTERVORHERSA@0' }, 40)).toBe(26);
    expect(freeLetters({ via: 'climb' }, 40)).toBe(40);
  });

  test('German: too little text beyond the crib is not evidence', () => {
    const c = [cand(0.9, 'bombe WETTERVORHERSA@0')];
    const j = checkGerman({ accepted: 0, verdict: verdict(0) }, c, 14 + MIN_FREE - 1);
    expect(j.accepted).toBe(-1);
    expect(j.thin).toBe(true);
  });

  test('German: Jev and the letter statistics must agree', () => {
    const j = checkGerman({ accepted: 0, verdict: verdict(0) }, [cand(GERMAN_FLOOR - 0.05)], 80);
    expect(j.accepted).toBe(-1);
    expect(j.disagree).toBeCloseTo(GERMAN_FLOOR - 0.05);
    const ok = checkGerman({ accepted: 0, verdict: verdict(0) }, [cand(0.8)], 80);
    expect(ok).toMatchObject({ accepted: 0, decidedBy: 'jev' });
  });

  test('other languages: statistics decide and Jev only advises', () => {
    const cs = [cand(STRICT - 0.1), cand(STRICT + 0.1)];
    expect(decideByStats(cs, 80, verdict(0))).toMatchObject({ accepted: 1, decidedBy: 'stats' });
    expect(decideByStats([cand(STRICT - 0.1)], 80, null).accepted).toBe(-1);
  });

  test('the sender’s crib runs first; cribs are cut and filtered by the evidence floor', () => {
    const user = parseCrib('wetter vorhersage@3', s => s.toUpperCase().replace(/[^A-Z]/g, ''));
    expect(user).toEqual({ text: 'WETTERVORHERSAGE', at: 3, source: 'your crib' });
    const ranked = { order: [{ text: 'KEINEBESONDERENEREIGNISSE' }, { text: 'ANX' }], source: 'jev' as const };
    const plan = planCribs(user, ranked, 'de', 60);
    expect(plan.map(c => c.source)).toEqual(['your crib', "Jev's #1", "Jev's #2"]);
    expect(plan.every(c => c.text.length <= KNOWN_CRIB)).toBe(true);
    expect(planCribs(null, ranked, 'en', 60)).toEqual([]);
    expect(planCribs(user, ranked, 'de', KNOWN_CRIB + MIN_FREE - 1).map(c => c.text)).toEqual(['ANX']);
    expect(parseCrib('  ', s => s)).toBeNull();
  });

  test('outcome lines', () => {
    expect(outcome(1, 'de', true, 80)).toBe('Jev accepts candidate B');
    expect(outcome(0, 'es', false, 80)).toContain('Spanish letter statistics');
    expect(outcome(-1, 'de', true, 10)).toContain('Too short to prove');
    expect(outcome(-1, 'de', false, 80)).toBe('n-gram verdict: nothing reads as German');
  });
});
