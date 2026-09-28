# The web server and its API

```bash
bun run web
```

This serves <http://localhost:5199>; set `PORT` to change the port. `src/web/server.ts` defines every route.

## Pages

| Route | Page |
|---|---|
| `/` | The machine: unlock, set a key, type, transmit, break, decrypt |
| `/research` | Research and history paper |
| `/jev` | Jev performance paper |

## The key gate

The machine page opens locked. When a key is entered, the page sends it once to `POST /api/unlock`. The server verifies it with one small Jev question, then holds it in memory against a random session token (`src/web/session.ts`). The token is set as an `HttpOnly; SameSite=Strict` cookie named `ej_session`.

- The key is never sent back to the page, never written to disk and never logged. The verification call skips the audit log.
- Unlock attempts are limited to 8 a minute per server.
- Sessions expire after 12 idle hours, and a server restart forgets all of them.
- *Remember on this device* is an opt-in. It keeps the key in the browser's local storage so the page can unlock again on the next visit. Leave it off on shared machines.
- **Lock** calls `POST /api/lock`, which drops the session.

The CLI and the backtests read the key from the environment instead (see [jev.md](jev.md)).

## JSON routes

| Route | Method | Returns |
|---|---|---|
| `/api/status` | GET | `{unlocked, jev, model, hint}`. `hint` holds the key's last four characters. |
| `/api/unlock` | POST `{key}` | `{ok, model, hint, latencyMs, german}` and the session cookie. Or `{ok:false, reason}` with status 400, 401, 402, 429 or 502. |
| `/api/lock` | POST | `{ok:true}` and a cleared cookie |
| `/api/presets` | GET | The historical Enigma I intercepts offered as ready-made messages, and the crib list |
| `/api/encrypt` | POST `{key, text, style?}` | `{operatorText, ciphertext, trace}` |
| `/api/report` | GET | The backtest runs the papers cite: `{main, holdout}` |
| `/api/jev-analysis` | GET | `reports/jev-analysis.json` |
| `/api/bombe-stops` | GET | `reports/bombe-stops.json` |
| `/api/judge-comparison` | GET | `reports/judge-comparison.json` |
| `/api/break` | POST `BreakRequest` | A `text/event-stream` of `BreakEvent`s. Returns 401 without a session. |

The report routes read from disk on each request, so the papers show a new result as soon as an analysis is rerun. A missing report returns 404, with the command that writes it.

## The break stream

`POST /api/break` takes a `BreakRequest`. The protocol is typed in `src/web/events.ts` and shared by the server, its workers and the page.

```ts
interface BreakRequest {
  ciphertext: string;
  service?: 'Heer' | 'Luftwaffe' | 'Kriegsmarine';
  date?: string;          // YYYY or YYYY-MM-DD: decides the wheel orders and reflectors
  crib?: string;          // TEXT or TEXT@position, tried first
  useJev?: boolean;       // default true when unlocked
  maxCribs?: number;
  language?: 'de' | 'en' | 'es';
}
```

The response is one `data: {json}` line per event, in this order:

| Event | When | Payload |
|---|---|---|
| `intercept` | first | the cleaned ciphertext, its length, whether Jev is on, the model, the language |
| `drag` | after crib dragging | every listed crib: whether it fits, the positions that clash, its loop count |
| `jev-cribs` | after crib ranking | the order, the probabilities, P(none), the source (`jev` or `static`) |
| `bombe-start` / `bombe-progress` / `bombe-done` | once per Bombe run | the menu, wheel orders, workers; then progress and stop counts; then the run's verdict |
| `climb-start` / `climb-progress` / `climb-done` | only if no crib broke it | as above, for the ciphertext-only search |
| `replay` | after the search | the winning plugboard climb, frame by frame |
| `candidates` | after the replay | the candidates Jev read |
| `jev-judge` | if Jev judged | the `Verdict`, and whether it is only advisory (non-German text) |
| `note` | any time | an explanation shown in the panel (for example "No crib can prove anything here") |
| `jev-error` | any time | a failed Jev call. The run falls back to statistics. |
| `result` | last | the chosen index, a verdict sentence, the candidate, the number of Jev calls |
| `error` | on failure | a message |

CPU work runs on a worker pool (`src/web/pool.ts`: one worker per core, minus one, and at most eight). Each Bombe or climb run is split into slices of wheel orders across the workers, and progress is throttled to about eight updates a second.

## Rules on the live page

The page never claims a break it cannot back up:

- **Short messages.** Any message can be transmitted. Under about 25 letters, the page says a break cannot be proven, because Enigma's unicity distance is about 22 letters.
- **Letters beyond the crib.** A verdict needs at least 12 letters beyond the assumed crib (`MIN_FREE`), and cribs that would leave fewer are skipped.
- **German breaks need two judges.** Jev must accept, and the German letter statistics must reach `GERMAN_FLOOR` (0.42).
- **English and Spanish.** Messages in these languages are scored with their own letter statistics (`data/corpus-en`, `data/corpus-es`), and those statistics decide. Jev's reading is shown as advice only. The German crib list is skipped for them, so give your first words as the crib.
- **False breaks.** A key that is accepted but whose plaintext does not match what was sent is labelled a false break.
