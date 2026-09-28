# analysis/: Jev against the standard judges

This is the one Python part of the project. It compares Jev with the classical and trained ways of deciding whether a trial decryption is plaintext. The results are in §4.8 of the Jev paper (`/jev`).

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r analysis/requirements.txt
```

```bash
bun run analyze:jev
```

```bash
bun run analyze:judges
```

`bun run analyze:jev` writes `reports/judge-dataset.json` from the Jev audit log. `bun run analyze:judges` then writes `reports/judge-comparison.json`.

| File | Contents |
|---|---|
| `judges.py` | The experiment: leave-one-text-out cross-validation, the learning curve, the synthetic→historical shift test, and the report. |
| `textstats.py` | The classical statistics: an interpolated Kneser–Ney character model, quadgram fitness, dictionary coverage, and `features`, the twelve numbers the trained judges learn from. |
| `metrics.py` | AUC, Brier, log loss, ECE, call-level decisions and the cluster bootstrap over judge calls. |
| `requirements.txt` | Exact pins (numpy, scikit-learn, xgboost). The versions are also written into the report. |
| `requirements-dev.txt`, `ruff.toml` | The formatter and linter. |

The input `reports/judge-dataset.json` is committed, so the comparison can be rerun without the audit log or a key. The run is deterministic, because every seed is fixed. CI reruns it and fails if any number in the report moves beyond its sixth decimal place, which allows for floating-point differences between platforms.

For the protocol and what each judge is, see [docs/evaluation.md](../docs/evaluation.md#3-jev-against-the-standard-judges-analysisjudgespy).

## Lint

```bash
.venv/bin/pip install -r analysis/requirements-dev.txt
```

```bash
.venv/bin/ruff format --config analysis/ruff.toml analysis
```

```bash
.venv/bin/ruff check --config analysis/ruff.toml analysis
```
