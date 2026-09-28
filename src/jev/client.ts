/**
 * Jev over TypeSafe's System One endpoint: one JSON request per question set,
 * answers validated with zod, retries with backoff on 429 and 5xx.
 *
 * Jev answers typed questions about a text state: `noul` (a probability),
 * `choice` (a distribution over named options) and `score` (a position on an
 * ordered scale). It never returns prose, so it cannot write out a decryption.
 * This app uses it for the judgments a Bletchley analyst made: which crib is
 * likely, and whether a trial decryption is really German.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type QuestionSet, type RawAnswers, validateResponse } from './schema.js';

export const DEFAULT_JEV_MODEL = 'jev-1.13.0';
export const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai/v1/systemone';
export const APP_DIR = process.env.ENIGMA_JEV_HOME ?? join(homedir(), '.enigma-jev');
export const JEV_LOG = join(APP_DIR, 'jev-calls.jsonl');

export class JevApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`TypeSafe API ${status}: ${detail.slice(0, 200)}`);
    this.name = 'JevApiError';
  }
}

export interface JevResponse {
  readonly answers: RawAnswers;
  readonly latencyMs: number;
  readonly attempts: number;
}

export interface JevModel {
  evaluate(state: string, questions: QuestionSet): Promise<JevResponse>;
}

export interface JevClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Append each request and response (never the key) to this JSONL file. */
  logPath?: string | null;
}

async function boundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0,
    text = '';
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      bytes += r.value.byteLength;
      if (bytes > 256000) {
        await reader.cancel();
        throw new Error('Model response exceeds 256 kB');
      }
      text += decoder.decode(r.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export class JevClient implements JevModel {
  private readonly model: string;
  private readonly transport: typeof fetch;
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;

  constructor(private readonly opts: JevClientOptions) {
    if (!opts.apiKey) throw new Error('JevClient requires an API key');
    this.model = opts.model ?? DEFAULT_JEV_MODEL;
    this.transport = opts.fetchImpl ?? globalThis.fetch;
  }

  async evaluate(state: string, questions: QuestionSet): Promise<JevResponse> {
    const requestId = randomUUID(),
      started = performance.now();
    const body = JSON.stringify({ state, model: this.model, questions });
    const limit = this.opts.timeoutMs ?? 20000,
      retries = this.opts.maxRetries ?? 4;
    this.log({ kind: 'request', requestId, at: new Date().toISOString(), model: this.model, state, questions });
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limit);
      let delay = 0,
        status = 0;
      try {
        const response = await this.transport(this.opts.baseUrl ?? DEFAULT_JEV_BASE_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        const text = await boundedBody(response);
        status = response.status;
        if (status === 429 || status === 529 || status >= 500) {
          const after = Number(response.headers.get('retry-after'));
          delay = Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(500 * 2 ** attempt, 8000);
        } else {
          if (!response.ok) throw new JevApiError(status, text);
          // jev-latest and jev-preview float; any other model name must come back as asked.
          const expected = ['jev-latest', 'jev-preview'].includes(this.model) ? undefined : this.model;
          const answers = validateResponse(JSON.parse(text), questions, expected);
          this.calls++;
          this.inputTokens += answers.usage?.input_tokens ?? 0;
          this.outputTokens += answers.usage?.output_tokens ?? 0;
          const result = { answers, latencyMs: performance.now() - started, attempts: attempt + 1 };
          this.log({
            kind: 'response',
            requestId,
            at: new Date().toISOString(),
            latencyMs: Math.round(result.latencyMs),
            answers,
          });
          return result;
        }
      } catch (err) {
        if (err instanceof JevApiError || attempt >= retries) {
          this.log({ kind: 'error', requestId, at: new Date().toISOString(), message: String(err).slice(0, 500) });
          throw err;
        }
        delay = Math.min(500 * 2 ** attempt, 8000);
      } finally {
        clearTimeout(timer);
      }
      if (attempt >= retries) throw new JevApiError(status, `retries exhausted after ${attempt + 1} attempts`);
      await (this.opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms))))(delay);
    }
  }

  private log(entry: unknown): void {
    const path = this.opts.logPath === undefined ? JEV_LOG : this.opts.logPath;
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(entry) + '\n');
    } catch {
      /* The audit log never changes an answer. */
    }
  }
}

/**
 * The TypeSafe key: the environment first, then ./.env, then this app's home
 * (~/.enigma-jev/.env). The command line and the backtests use it; the web page
 * asks for a key instead (src/web/session.ts).
 */
export function loadJevKey(): string | null {
  const files = [resolve(process.cwd(), '.env'), join(APP_DIR, '.env')];
  for (const name of ['TYPESAFE_API_KEY', 'JEV_MODEL']) {
    if (process.env[name]) continue;
    for (const f of files) {
      if (!existsSync(f)) continue;
      const line = readFileSync(f, 'utf8')
        .split('\n')
        .find(l => l.trim().startsWith(`${name}=`));
      const value = line
        ?.split('=')
        .slice(1)
        .join('=')
        .trim()
        .replace(/^["']|["']$/g, '');
      if (value) {
        process.env[name] = value;
        break;
      }
    }
  }
  const key = process.env.TYPESAFE_API_KEY?.trim();
  return key && !key.startsWith('your-') ? key : null;
}

export function jevFromEnv(): JevClient | null {
  const key = loadJevKey();
  return key ? new JevClient({ apiKey: key, model: process.env.JEV_MODEL || undefined }) : null;
}
