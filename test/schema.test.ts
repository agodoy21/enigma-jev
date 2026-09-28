import { describe, expect, test } from 'bun:test';
import { type QuestionSet, validateDistribution, validateResponse } from '../src/jev/schema.js';

const Q: QuestionSet = {
  p: { type: 'noul', instructions: 'P?' },
  c: { type: 'choice', instructions: 'Which?', criteria: { a: 'first', b: 'second' } },
  s: { type: 'score', instructions: 'How much?', criteria: ['low', 'mid', 'high'] },
};
const good = () => ({
  model: 'jev-1.13.0',
  usage: { input_tokens: 10, output_tokens: 5 },
  answers: {
    p: { type: 'noul', noul: 0.7 },
    c: { type: 'choice', choice: 'a', confidence: 0.6, probabilities: { a: 0.6, b: 0.4 } },
    s: {
      type: 'score',
      score: 1.2,
      confidence: 0.5,
      probabilities: { '0': 0.1, '1': 0.6, '2': 0.3 },
      legend: { '0': 'low', '1': 'mid', '2': 'high' },
    },
  },
});

describe('Jev response validation', () => {
  test('a well-formed response passes', () => {
    expect(validateResponse(good(), Q, 'jev-1.13.0').answers.p).toEqual({ type: 'noul', noul: 0.7 });
  });

  test.each([
    [
      'another model revision',
      (r: ReturnType<typeof good>) => {
        r.model = 'jev-9';
      },
    ],
    ['missing usage', (r: ReturnType<typeof good>) => void Reflect.deleteProperty(r, 'usage')],
    ['a missing answer', (r: ReturnType<typeof good>) => void Reflect.deleteProperty(r.answers, 's')],
    [
      'a probability out of range',
      (r: ReturnType<typeof good>) => {
        r.answers.p.noul = 1.4;
      },
    ],
    [
      'a distribution that does not sum to one',
      (r: ReturnType<typeof good>) => {
        r.answers.c.probabilities.b = 0.5;
      },
    ],
    [
      'a choice that is not the argmax',
      (r: ReturnType<typeof good>) => {
        r.answers.c.choice = 'b';
      },
    ],
    [
      'a score outside its distribution',
      (r: ReturnType<typeof good>) => {
        r.answers.s.score = 1.9;
      },
    ],
    [
      'a wrong score legend',
      (r: ReturnType<typeof good>) => {
        r.answers.s.legend['2'] = 'max';
      },
    ],
  ])('rejects %s', (_, spoil) => {
    const r = good();
    spoil(r);
    expect(() => validateResponse(r, Q, 'jev-1.13.0')).toThrow();
  });

  test('distributions must cover exactly the listed options', () => {
    expect(() => validateDistribution({ a: 0.5, b: 0.5 }, ['a', 'b'])).not.toThrow();
    expect(() => validateDistribution({ a: 1 }, ['a', 'b'])).toThrow();
    expect(() => validateDistribution(undefined, ['a'])).toThrow();
  });
});
