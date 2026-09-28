# How Jev is used

Jev is a hosted model served by TypeSafe's System One API (`https://api.typesafe.ai/v1/systemone`). You send it a *state*, a piece of text, and a set of typed questions. It answers every question in the requested type:

| Type | Answer |
|---|---|
| `noul` | a probability in [0, 1] |
| `choice` | a distribution over named options, plus the argmax |
| `score` | a number on a stated scale |

It never returns free text, so **it cannot write out a decryption**. The cryptanalysis runs locally, and Jev makes only the two calls a Hut 6 analyst made.

## 1. Which crib opens this message? (`src/jev/cribs.ts`)

- **When:** once per message, after crib dragging.
- **State:** the ciphertext; the service and date if known; the cribs that fit the opening; and the ones crib dragging ruled out, as context.
- **Question:** `choice` over the fitting cribs, plus `none`.
- **Use:** the Bombe tries the cribs in Jev's order. Without Jev it uses the list order, which runs from general to specific and was fixed before any backtest ran.
- **Finding:** Jev's order is no better than the fixed list (mean rank 6.5 in both), and its P(none) does not tell present cribs from absent ones (AUC 0.50). The Jev paper's §4.5 discusses why.

## 2. Is this German, and which one? (`src/jev/judge.ts`)

- **When:** after each search that produces candidates.
- **State:** the ciphertext and up to four distinct candidate decryptions, as text only. The search's n-gram scores are withheld, so Jev's judgement is independent of the search. When a Bombe candidate carries its crib verbatim, the state says which letters were assumed and asks Jev to judge the rest.
- **Questions:**
  - `pick`: `choice` over the candidates plus `none`;
  - `readable_A` … `readable_D`: a `noul` P(correct) for each candidate.
- **Decision rule:** accept the pick only when P(pick) ≥ 0.5 **and** P(correct) for that pick ≥ 0.5 (`JEV_ACCEPT`). The argmax alone is not a verdict: over garbage the distribution is flat, and the top option can still be wrong. With the rule, 159 of 160 calls are decided correctly; with the argmax alone, 141 of 160.

## Keys and configuration

| Setting | Where it is read from |
|---|---|
| API key (CLI and backtests) | `TYPESAFE_API_KEY`, then `./.env`, then `~/.enigma-jev/.env` |
| API key (web page) | entered on the page; see [web.md](web.md#the-key-gate) |
| Model | `JEV_MODEL`; the default `jev-1.13.0` is the model behind every published number |
| App directory | `ENIGMA_JEV_HOME`, default `~/.enigma-jev` |

```bash
bun run cli doctor
```

This checks the key, the model and the language model. Add `--ping` to make one Jev call.

## The audit log

Every request and answer is appended to `~/.enigma-jev/jev-calls.jsonl`, along with the latency and token counts. The key is never written. The Jev paper is rebuilt entirely from this file:

```bash
bun run analyze:jev
```

`src/analysis/jev-eval.ts` matches each logged call to its backtest case and labels every candidate against the known plaintext. It then writes `reports/jev-analysis.json`, and `reports/judge-dataset.json` for the Python comparison.

The log is personal to whoever ran the backtests. The committed reports are its derived, anonymised output: the log path is written with `~`, and no key or account detail appears.

## Cost

Each question costs one API call.

| Call | Median latency | Tokens in | Tokens out |
|---|---|---|---|
| Judge | 183 ms | ~1,050 | ~100 |
| Crib ranking | 201 ms | ~910 | ~100 |

The main backtest made 121 Jev calls and the holdout run 80.
