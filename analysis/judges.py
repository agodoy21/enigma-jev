"""
Jev against the standard ways of deciding whether a trial decryption is plaintext.

    .venv/bin/python analysis/judges.py        -> reports/judge-comparison.json

Input is reports/judge-dataset.json, written by `bun run src/analysis/jev-eval.ts`:
the 478 candidate decryptions Jev judged in the main and holdout backtests, each
labelled correct when it matches at least 90% of the published plaintext.

The judges, from the codebreaker's toolbox to a trained classifier:

    index of coincidence     Friedman 1922; the first stage of Gillogly 1995
    trigram German-ness      this project's interpolated trigram model
    quadgram fitness         the usual hill-climbing score (Lasry 2018)
    Kneser-Ney 5-gram        the strongest classical character model (Kneser and Ney 1995)
    logistic regression      on twelve text features (textstats.py)
    XGBoost                  gradient-boosted trees on the same features (Chen and Guestrin 2016)
    Jev                      zero-shot, raw and recalibrated

Every score becomes a probability through training on labels, except raw Jev.
Evaluation is leave-one-text-out: all runs of a plaintext (a synthetic text
recurs in main and holdout under new keys) are held out together, so no trained
judge ever sees the text it is scored on. Features use only the letters outside
the assumed crib, as the n-gram judge does.
"""

from __future__ import annotations

import json
import math
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import sklearn
import xgboost
from metrics import Calls, auc, brier, ece, logloss
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from textstats import FEATURES, TextModels, features
from xgboost import XGBClassifier

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT / 'reports' / 'judge-dataset.json'
OUT = ROOT / 'reports' / 'judge-comparison.json'


def free_text(r: dict) -> str:
    """The candidate's letters outside the assumed crib (the crib is German by construction)."""
    t, s, n = r['plaintext'], r['cribStart'], r['cribLen']
    return t[:s] + t[s + n :]


def platt(train_x: np.ndarray, train_y: np.ndarray, test_x: np.ndarray) -> np.ndarray:
    """One-feature logistic calibration (Platt 1999)."""
    m = LogisticRegression(C=1e4, max_iter=1000).fit(train_x.reshape(-1, 1), train_y)
    return m.predict_proba(test_x.reshape(-1, 1))[:, 1]


def make_lr() -> LogisticRegression:
    return LogisticRegression(C=1.0, max_iter=5000)


def make_xgb() -> XGBClassifier:
    return XGBClassifier(
        n_estimators=300,
        max_depth=3,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        min_child_weight=1,
        reg_lambda=1.0,
        eval_metric='logloss',
        random_state=1941,
        n_jobs=4,
    )


def fit_predict(model: str, X: np.ndarray, y: np.ndarray, train: np.ndarray, test: np.ndarray) -> np.ndarray:
    """Train logistic regression (on standardised features) or XGBoost on `train`, predict `test`."""
    if len(set(y[train])) < 2:
        return np.full(len(test), y[train].mean())
    if model == 'lr':
        sc = StandardScaler().fit(X[train])
        return make_lr().fit(sc.transform(X[train]), y[train]).predict_proba(sc.transform(X[test]))[:, 1]
    return make_xgb().fit(X[train], y[train]).predict_proba(X[test])[:, 1]


def main() -> None:
    data = json.loads(DATASET.read_text())
    rows, calls = data['rows'], data['calls']
    y = np.array([r['y'] for r in rows])
    texts = sorted({r['text'] for r in rows})
    groups = np.array([texts.index(r['text']) for r in rows])
    kind = np.array([r['kind'] for r in rows])
    jev_raw = np.array([r['jev'] for r in rows])
    book = Calls(rows, calls, y, data['jevAccept'])

    # Features from the project's own German corpus, the same text the trigram judge learned from.
    models = TextModels.build(''.join(data['lmTraining']), ROOT / 'data' / 'corpus')
    t0 = time.perf_counter()
    X = np.array([features(free_text(r), r['germanness'], models) for r in rows])
    feature_ms = (time.perf_counter() - t0) / len(rows) * 1000
    col = {f: X[:, i] for i, f in enumerate(FEATURES)}

    # ── every judge, leave-one-text-out
    one_feature = {
        'Index of coincidence': 'ioc',
        'Trigram German-ness': 'trigram_germanness',
        'Quadgram fitness': 'quadgram',
        'Kneser-Ney 5-gram': 'kn5',
    }
    preds = {
        name: np.zeros(len(rows)) for name in [*one_feature, 'Logistic regression', 'XGBoost', 'Jev, recalibrated']
    }
    for g in range(len(texts)):
        test, train = np.where(groups == g)[0], np.where(groups != g)[0]
        for name, f in one_feature.items():
            preds[name][test] = platt(col[f][train], y[train], col[f][test])
        preds['Logistic regression'][test] = fit_predict('lr', X, y, train, test)
        preds['XGBoost'][test] = fit_predict('xgb', X, y, train, test)
        preds['Jev, recalibrated'][test] = platt(jev_raw[train], y[train], jev_raw[test])
    preds = {'Jev, zero-shot': jev_raw, **preds}

    judges = []
    for name, p in preds.items():
        judges.append(
            {
                'name': name,
                'trained': name != 'Jev, zero-shot',
                'auc': auc(p, y),
                'aucCI': book.boot(lambda i, _, p=p: auc(p[i], y[i])),
                'brier': brier(p, y),
                'brierCI': book.boot(lambda i, _, p=p: brier(p[i], y[i])),
                'logLoss': logloss(p, y),
                'ece': ece(p, y),
                'decisions': book.decide(p),
                'decisionCI': book.boot(lambda _, ids, p=p: book.decide(p, ids)['accuracy']),
            }
        )
    jev_decision = {**book.jev_rule(), 'ci': book.boot(lambda _, ids: book.jev_rule(ids)['accuracy'])}

    def paired(a: str, b: str, metric) -> dict:
        """metric(a) − metric(b), with a paired cluster bootstrap."""
        pa, pb = preds[a], preds[b]
        ci = book.boot(lambda i, _: metric(pa[i], y[i]) - metric(pb[i], y[i]))
        return {'a': a, 'b': b, 'diff': metric(pa, y) - metric(pb, y), 'ci': ci}

    contrasts = {
        'brier_xgb_minus_jevcal': paired('XGBoost', 'Jev, recalibrated', brier),
        'brier_xgb_minus_jevraw': paired('XGBoost', 'Jev, zero-shot', brier),
        'auc_jevraw_minus_xgb': paired('Jev, zero-shot', 'XGBoost', auc),
        'brier_kn5_minus_jevcal': paired('Kneser-Ney 5-gram', 'Jev, recalibrated', brier),
    }

    # ── how many labelled texts does a classifier need?
    curve = []
    for k in (1, 2, 3, 4, 6, 8, 12, 16, 20, 24):
        stats: dict[str, list[float]] = defaultdict(list)
        for rep in range(40):
            chosen = np.random.default_rng(1000 * k + rep).choice(len(texts), size=k, replace=False)
            train, test = np.where(np.isin(groups, chosen))[0], np.where(~np.isin(groups, chosen))[0]
            if len(set(y[train])) < 2 or len(set(y[test])) < 2:
                continue
            for name, p in [
                ('XGBoost', fit_predict('xgb', X, y, train, test)),
                ('Logistic regression', fit_predict('lr', X, y, train, test)),
                ('Kneser-Ney 5-gram', platt(col['kn5'][train], y[train], col['kn5'][test])),
                ('Jev, recalibrated', platt(jev_raw[train], y[train], jev_raw[test])),
                ('Jev, zero-shot', jev_raw[test]),
            ]:
                stats[f'{name}|auc'].append(auc(p, y[test]))
                stats[f'{name}|brier'].append(brier(p, y[test]))
            stats['labels'].append(len(train))
        row = {
            'texts': k,
            'reps': len(stats['labels']),
            'labelledCandidates': float(np.mean(stats['labels'])) if stats['labels'] else None,
        }
        row |= {key: {'mean': float(np.mean(v)), 'sd': float(np.std(v))} for key, v in stats.items() if key != 'labels'}
        curve.append(row)

    # ── distribution shift: learn on synthetic traffic, judge the real intercepts
    tr, te = np.where(kind == 'synthetic')[0], np.where(kind == 'historical')[0]
    shift_preds = {
        'Jev, zero-shot': jev_raw[te],
        'Jev, recalibrated on synthetic': platt(jev_raw[tr], y[tr], jev_raw[te]),
        'XGBoost on synthetic': fit_predict('xgb', X, y, tr, te),
        'Logistic regression on synthetic': fit_predict('lr', X, y, tr, te),
        'Kneser-Ney 5-gram on synthetic': platt(col['kn5'][tr], y[tr], col['kn5'][te]),
        'Trigram German-ness on synthetic': platt(col['trigram_germanness'][tr], y[tr], col['trigram_germanness'][te]),
    }
    hist_calls = [c for c in book.ids if rows[book.rows_of[c][0]]['kind'] == 'historical']
    shift = []
    for name, p in shift_preds.items():
        full = np.zeros(len(rows))
        full[te] = p
        shift.append(
            {
                'name': name,
                'auc': auc(p, y[te]),
                'brier': brier(p, y[te]),
                'logLoss': logloss(p, y[te]),
                'decisions': book.decide(full, hist_calls),
            }
        )
    shift_meta = {
        'trainRows': int(len(tr)),
        'testRows': int(len(te)),
        'testPositives': int(y[te].sum()),
        'testCalls': len(hist_calls),
        'jevRule': book.jev_rule(hist_calls),
    }

    # ── what XGBoost learned, and what it costs
    full_xgb = make_xgb().fit(X, y)
    gain = full_xgb.get_booster().get_score(importance_type='gain')
    importance = sorted(
        ({'feature': FEATURES[int(k[1:])], 'gain': float(v)} for k, v in gain.items()), key=lambda d: -d['gain']
    )
    t0 = time.perf_counter()
    for _ in range(20):
        full_xgb.predict_proba(X)
    predict_us = (time.perf_counter() - t0) / (20 * len(rows)) * 1e6

    # Where the best trained judge and Jev disagree at the 0.5 line.
    px = preds['XGBoost']
    disagree = [
        {
            'text': rows[i]['text'],
            'acc': rows[i]['acc'],
            'y': int(y[i]),
            'jev': float(jev_raw[i]),
            'xgb': float(px[i]),
            'sample': free_text(rows[i])[:60],
        }
        for i in range(len(rows))
        if (jev_raw[i] >= 0.5) != (px[i] >= 0.5)
    ]

    out = {
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'data': {
            'candidates': len(rows),
            'positives': int(y.sum()),
            'calls': len(calls),
            'texts': len(texts),
            'historicalRows': int((kind == 'historical').sum()),
            'lmTrainingLetters': models.letters,
            'vocabulary': len(models.vocabulary),
        },
        'protocol': 'leave-one-text-out cross-validation; 95% intervals from a cluster bootstrap over judge calls '
        '(2,000 resamples)',
        'features': FEATURES,
        'judges': judges,
        'jevDecisionRule': jev_decision,
        'contrasts': contrasts,
        'learningCurve': curve,
        'shift': shift,
        'shiftMeta': shift_meta,
        'xgboost': {
            'params': make_xgb().get_params() | {'missing': None},
            'importance': importance,
            'predictMicroseconds': predict_us,
            'featureMilliseconds': feature_ms,
        },
        'disagreements': disagree,
        'versions': {'xgboost': xgboost.__version__, 'sklearn': sklearn.__version__, 'numpy': np.__version__},
    }
    finite = lambda o: None if isinstance(o, float) and not math.isfinite(o) else str(o)  # noqa: E731
    OUT.write_text(json.dumps(out, indent=1, default=finite))

    print(f'{len(rows)} candidates, {int(y.sum())} correct, {len(calls)} calls, {len(texts)} texts')
    for j in judges:
        d = j['decisions']
        print(
            f'{j["name"]:<24} AUC {j["auc"]:.4f}  Brier {j["brier"]:.4f}  ECE {j["ece"]:.3f}  '
            f'decisions {d["accuracy"]:.3f} ({d["acceptWrong"]} wrong, {d["rejectMissed"]} missed)'
        )
    print(f'Jev decision rule: {jev_decision["accuracy"]:.3f}')
    for s in shift:
        d = s['decisions']
        print(f'  shift  {s["name"]:<34} decisions {d["accuracy"]:.3f} ({d["rejectMissed"]} missed)')
    print(f'wrote {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
