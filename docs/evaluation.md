# Evaluation

This page covers how every number in the two papers is produced. [The README](../README.md#reproduce-the-papers) maps each result to its command. This page covers what those commands measure.

**Without a key**, you can reproduce:

- the tests;
- the Bombe validation (§4);
- the judge comparison (§3), from the committed `reports/judge-dataset.json`;
- every search tier with `--no-jev`.

**With a key:**

- the backtests' Jev verdicts and the reliability experiments call TypeSafe's paid API, so rerunning them costs credit;
- the Jev analysis (§2) needs the audit log those runs write.

The committed reports are the ones the papers cite.

## 1. The backtest

```bash
bun run backtest [historical|synthetic|all] [--tiers verify,key,crib,bombe,climb] [--only id,..] [--seed N] [--no-jev]
```

### Data

- **Historical:** the 10 messages in `data/historical/messages.json`. All 10 decrypt exactly on this machine. Nine are scored:
  - `heer-1941-07-07-nr113` is left out, because its plaintext is unverified and its 26 letters are below any attack's reach;
  - `dewiki-example-aachen` is a textbook example, kept as a control.
- **Synthetic:** the 16 German plaintexts in `data/synthetic/plaintexts.txt`, written for this project and held out of the language model. Each is enciphered under a random key drawn from `--seed`:
  - Enigma I for the Heer and Luftwaffe;
  - M3 with rotors I–VIII for the Kriegsmarine;
  - 10 plugs for most messages, and 6 for every fourth.

The papers use two runs:

| Run | Command | Cases |
|---|---|---|
| Main | `backtest all --seed 1941` | 9 historical and 16 synthetic |
| Holdout | `backtest synthetic --seed 2024` | the 16 synthetic plaintexts under fresh keys |

### Tiers

The tiers run from most known to least known:

| Tier | Given | Searched |
|---|---|---|
| `verify` | the full key | nothing: the machine must reproduce the published plaintext |
| `key` | the daily key (wheel order, rings, plugs) | the message key (start positions) |
| `crib` | the message's true first 14 letters | everything else. This measures the Bombe on real traffic, separately from crib choice. |
| `bombe` | the machine and service | everything; the cribs come from the fixed list in Jev's order, top 3 |
| `climb` | the machine | everything, from ciphertext only (not attempted for M4) |

For M4, both Bombe tiers are given the wheel order and the greek wheel; its offset is still searched. A full four-rotor search is 2 greek wheels × 2 reflectors × 336 orders, which is out of reach for one machine.

### Scoring

| Measure | Definition |
|---|---|
| **Broken** | the tier's best candidate matches at least 90% of the published plaintext |
| **Jev verdict right** | Jev accepts a broken candidate, or says "none" when no candidate shown is broken |
| **n-gram verdict right** | the same rule, for a baseline that accepts the top candidate when its German-ness is at least 0.4 |
| **Brier** | the squared error of Jev's per-candidate P(correct) |
| **Crib rank** | the position of the true opening crib in Jev's order and in the static list order |

Reports are written to `reports/backtest-<time>.{md,json}`. `GET /api/report` serves the newest main and holdout runs to the pages.

## 2. The Jev analysis (`src/analysis/jev-eval.ts`)

This step makes no Jev calls. It reads the audit log (`~/.enigma-jev/jev-calls.jsonl`) and splits it by timestamp into three windows:

- **pilot:** calls before the main run (a prompt ablation, Jev §4.4);
- **main:** calls during the main run;
- **holdout:** calls during the holdout run.

Each judge call is matched to its case, and every candidate it showed is labelled correct when it matches at least 90% of the known plaintext. The result is 478 candidates from 160 calls on 41 messages, of which 76 are correct.

Jev is scored on four things:

| Aspect | Measures |
|---|---|
| Discrimination | AUC (Mann–Whitney, ties counted half) |
| Probability quality | Brier score, log loss, Murphy decomposition |
| Calibration | reliability diagram, ECE over ten equal-width bins |
| Decisions | the per-call accept or reject decision, under three rules: Jev's two-condition rule, Jev's top choice, and an n-gram bar |

The baselines are:

- a trigram judge, calibrated leave-one-message-out;
- a fixed German-ness bar;
- accepting the search's top candidate.

Every interval is a 95% cluster bootstrap over judge calls, with 2,000 resamples. Resampling calls rather than candidates keeps together the candidates that one call saw.

`src/analysis/jev-experiments.ts` makes about 58 fresh Jev calls:

- **test–retest:** the same state asked twice;
- **position:** the candidates shown in reverse order;
- **crib retest:** the crib ranking asked twice.

## 3. Jev against the standard judges (`analysis/judges.py`)

This comparison uses the same 478 candidates (`reports/judge-dataset.json`).

**The judges:**

- index of coincidence;
- trigram German-ness;
- quadgram fitness;
- an interpolated Kneser–Ney character 5-gram model;
- logistic regression and XGBoost on twelve text features;
- Jev, raw and with Platt (one-feature logistic) recalibration.

**The features:** Kneser–Ney log probability, quadgram fitness, trigram German-ness, IoC, χ² against German unigrams, entropy, vowel share, share of the eight commonest letters, unseen trigrams, dictionary coverage, longest dictionary run, and X rate. They are all computed on the letters outside the assumed crib (`analysis/textstats.py`).

The n-gram models are trained on the same German text as the project's own language model, in its four operator conventions. Every score except raw Jev becomes a probability by Platt scaling fitted on the training fold. Scoring and decisions are in `analysis/metrics.py`.

**The protocol:**

1. **Leave one text out.** Every run of a plaintext is held out together. A synthetic text recurs in main and holdout under new keys. So no trained judge sees the text it is scored on.
2. **Learning curve.** Trained judges are fitted on 1, 2, 3, 4, 6 … 24 randomly chosen texts, 40 draws each. This shows how much labelled traffic they need to catch up with zero-shot Jev.
3. **Distribution shift.** The judges are trained on synthetic traffic only and tested on the historical intercepts. This is the realistic case: in 1940 no one had labelled wartime traffic to train on.

The output is `reports/judge-comparison.json`. The library versions are recorded in the file, and CI reruns the script on Linux (`analysis/check_reproduced.py`). Every count must match exactly, and every score within floating-point noise, except XGBoost's scores. Those differ between arm64 and x86-64 builds (AUC 0.993 on macOS arm64, 0.988 on Linux x86-64), so they are reported but not enforced. XGBoost's decisions are identical on both.

## 4. The Bombe against Weinbaum (`src/analysis/bombe-stops.ts`)

This check uses the test register in `src/break/register.ts`.

- **Stop counts.** The register counts stops for random one-loop menus (lengths 2–7) and pairs of disjoint loops. The counts are compared with Weinbaum (2025, ch. 4) and with Turing's estimate of 26^(4−c) for c closures. Even-length single loops stop at every position, by parity. The diagonal board lowers the two-loop counts.
- **Zygalski females.** The share of settings that can produce a female, measured over all 60 wheel orders, is compared with Weinbaum's model.
- **D-Day crib.** `WETTERVORHERSAGEBISKAYA` is dragged along its ciphertext, and only one alignment survives.

The output is `reports/bombe-stops.json`, shown as Table B1 on the research page.

## Threats to validity

Both papers include a threats-to-validity section. In brief:

- The evaluation is small: 9 scored historical intercepts.
- The synthetic plaintexts and the corpus were written for this project.
- The crib list was fixed before any backtest ran, but by the same author.
- Jev is a hosted model, so results are pinned to `jev-1.13.0` and every raw call is kept.
