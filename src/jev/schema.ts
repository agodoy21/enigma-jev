/**
 * The TypeSafe / Jev wire format, and nothing else.
 *
 * Request: `{ state, model, questions: { <id>: Question } }`
 * Response: `{ model, answers: { <id>: Answer }, usage }`
 *
 * Answers are validated here with zod so nothing downstream handles raw JSON.
 */
import { z } from 'zod';

export type NoulQuestion = { readonly type: 'noul'; readonly instructions: string };
export type ChoiceQuestion = {
  readonly type: 'choice';
  readonly instructions: string;
  /** option key → description. Keys are returned verbatim in `choice`. */
  readonly criteria: Readonly<Record<string, string>>;
};
export type ScoreQuestion = {
  readonly type: 'score';
  readonly instructions: string;
  /** Ordered level descriptions; the level number is the index. `score` is the probability-weighted position. */
  readonly criteria: readonly string[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type QuestionSet = Readonly<Record<string, Question>>;

const NoulAnswer = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
});

const ChoiceAnswer = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number().finite().min(0).max(1)).optional(),
});

const ScoreAnswer = z.object({
  type: z.literal('score'),
  score: z.number().finite(),
  legend: z.record(z.string(), z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number().finite().min(0).max(1)).optional(),
});

export const AnswerSchema = z.discriminatedUnion('type', [NoulAnswer, ChoiceAnswer, ScoreAnswer]);

export const RawAnswersSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), AnswerSchema),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type Answer = z.infer<typeof AnswerSchema>;
export type RawAnswers = z.infer<typeof RawAnswersSchema>;

/** Probability tolerance accommodates decimal serialization, never renormalizes. */
export const PROBABILITY_TOLERANCE = 1e-5;
export function validateDistribution(
  probabilities: Record<string, number> | undefined,
  keys: string[],
): asserts probabilities is Record<string, number> {
  if (
    !probabilities ||
    Object.keys(probabilities).sort().join('\0') !== [...keys].sort().join('\0') ||
    Object.values(probabilities).some(p => !Number.isFinite(p) || p < 0 || p > 1) ||
    Math.abs(Object.values(probabilities).reduce((n, p) => n + p, 0) - 1) > PROBABILITY_TOLERANCE
  )
    throw new Error('Invalid or incomplete probability distribution');
}

/**
 * Jev's observed wire responses round probabilities and Score independently to
 * two decimals. The resulting mean can differ by more than half a score tick.
 * Bound that difference using normalized distributions inside each rounding
 * interval; do not change the response or relax its coverage/sum/range checks.
 * Higher-precision probabilities retain their tighter serialization bounds.
 */
function scoreRoundingBounds(probabilities: number[]): [number, number] {
  const halfStep = (p: number) => {
    for (let digits = 2; digits <= 12; digits++) {
      const scale = 10 ** digits;
      if (Math.abs(p * scale - Math.round(p * scale)) < 1e-7) return 0.5 / scale;
    }
    return 1e-12;
  };
  const lower = probabilities.map(p => Math.max(0, p - halfStep(p)));
  const upper = probabilities.map(p => Math.min(1, p + halfStep(p)));
  const extreme = (descending: boolean) => {
    let remaining = Math.max(0, 1 - lower.reduce((sum, p) => sum + p, 0));
    let mean = lower.reduce((sum, p, i) => sum + p * i, 0);
    for (let step = 0; step < lower.length; step++) {
      const i = descending ? lower.length - 1 - step : step;
      const added = Math.min(remaining, upper[i] - lower[i]);
      mean += i * added;
      remaining -= added;
    }
    return mean;
  };
  return [extreme(false) - 0.005, extreme(true) + 0.005];
}

export function validateResponse(raw: unknown, questions: QuestionSet, expectedModel?: string): RawAnswers {
  const response = RawAnswersSchema.parse(raw);
  if (!response.model || (expectedModel && response.model !== expectedModel))
    throw new Error('Missing or unexpected model revision');
  if (!response.usage || response.usage.input_tokens === undefined || response.usage.output_tokens === undefined)
    throw new Error('Missing model usage');
  if (Object.keys(response.answers).sort().join('\0') !== Object.keys(questions).sort().join('\0'))
    throw new Error('Question coverage mismatch');
  for (const [id, q] of Object.entries(questions)) {
    const a = response.answers[id];
    if (a.type !== q.type) throw new Error(`Answer type mismatch: ${id}`);
    if (q.type === 'choice' && a.type === 'choice') {
      validateDistribution(a.probabilities, Object.keys(q.criteria));
      if (
        a.confidence === undefined ||
        !(a.choice in q.criteria) ||
        a.probabilities[a.choice] + PROBABILITY_TOLERANCE < Math.max(...Object.values(a.probabilities))
      )
        throw new Error(`Invalid choice: ${id}`);
    }
    if (q.type === 'score' && a.type === 'score') {
      const keys = q.criteria.map((_, i) => String(i));
      validateDistribution(a.probabilities, keys);
      if (a.confidence === undefined) throw new Error(`Missing score confidence: ${id}`);
      if (
        !a.legend ||
        Object.keys(a.legend).length !== keys.length ||
        keys.some(k => a.legend![k] !== q.criteria[Number(k)])
      )
        throw new Error(`Invalid score legend: ${id}`);
      const expected = keys.reduce((n, k) => n + Number(k) * a.probabilities![k], 0);
      const [minimum, maximum] = scoreRoundingBounds(keys.map(k => a.probabilities![k]));
      if (a.score < 0 || a.score > keys.length - 1 || a.score < minimum - 1e-9 || a.score > maximum + 1e-9)
        throw new Error(`Invalid score: ${id}; returned=${a.score}, distributionMean=${expected.toFixed(6)}`);
    }
  }
  return response;
}
