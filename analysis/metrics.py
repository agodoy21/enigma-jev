"""
Scoring judges: proper scoring rules for the probabilities, and call-level
accept/reject decisions with cluster-bootstrap intervals over judge calls.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Sequence

import numpy as np


def auc(p: np.ndarray, t: np.ndarray) -> float:
    """Mann-Whitney AUC, ties counted half."""
    pos, neg = p[t == 1], p[t == 0]
    if not len(pos) or not len(neg):
        return float('nan')
    wins = (pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()
    return float(wins / (len(pos) * len(neg)))


def brier(p: np.ndarray, t: np.ndarray) -> float:
    return float(np.mean((p - t) ** 2))


def logloss(p: np.ndarray, t: np.ndarray) -> float:
    q = np.clip(p, 1e-3, 1 - 1e-3)
    return float(-np.mean(t * np.log(q) + (1 - t) * np.log(1 - q)))


def ece(p: np.ndarray, t: np.ndarray, bins: int = 10) -> float:
    """Expected calibration error over equal-width bins."""
    b = np.minimum((p * bins).astype(int), bins - 1)
    return float(sum(abs(t[b == k].mean() - p[b == k].mean()) * (b == k).mean() for k in range(bins) if (b == k).any()))


class Calls:
    """The judge calls behind the candidates: decisions per call, and a bootstrap that resamples calls."""

    def __init__(self, rows: list[dict], calls: list[dict], y: np.ndarray, jev_accept: float):
        self.rows, self.calls, self.y, self.jev_accept = rows, calls, y, jev_accept
        self.ids = [c['call'] for c in calls]
        self.by_id = {c['call']: c for c in calls}
        self.rows_of: dict[str, list[int]] = defaultdict(list)
        for i, r in enumerate(rows):
            self.rows_of[r['call']].append(i)

    def _tally(self, ids: Sequence[str] | None, accept: Callable[[str, list[int]], int | None]) -> dict:
        m = {'acceptCorrect': 0, 'acceptWrong': 0, 'rejectMissed': 0, 'rejectRight': 0}
        for cid in ids or self.ids:
            idx = self.rows_of[cid]
            k = accept(cid, idx)
            if k is not None:
                m['acceptCorrect' if self.y[k] else 'acceptWrong'] += 1
            else:
                m['rejectMissed' if any(self.y[i] for i in idx) else 'rejectRight'] += 1
        n = sum(m.values())
        return {**m, 'n': n, 'accuracy': (m['acceptCorrect'] + m['rejectRight']) / n}

    def decide(self, p: np.ndarray, ids: Sequence[str] | None = None) -> dict:
        """Per call: accept the highest-probability candidate if it reaches 0.5, else accept none."""

        def accept(_: str, idx: list[int]) -> int | None:
            k = max(idx, key=lambda i: p[i])
            return k if p[k] >= 0.5 else None

        return self._tally(ids, accept)

    def jev_rule(self, ids: Sequence[str] | None = None) -> dict:
        """Jev's own decision rule: its pick, with P(pick) and P(correct) both at least the acceptance bar."""

        def accept(cid: str, idx: list[int]) -> int | None:
            c = self.by_id[cid]
            k = next((i for i in idx if self.rows[i]['label'] == c['pick']), None)
            ok = k is not None and c['pickP'] >= self.jev_accept and self.rows[k]['jev'] >= self.jev_accept
            return k if ok else None

        return self._tally(ids, accept)

    def boot(self, stat: Callable[[np.ndarray, list[str]], float], reps: int = 2000, seed: int = 7) -> list[float]:
        """Cluster bootstrap over calls: the 95% interval of stat(row indices, call ids)."""
        r = np.random.default_rng(seed)
        vals = []
        for _ in range(reps):
            ids = [self.ids[k] for k in r.integers(0, len(self.ids), len(self.ids))]
            v = stat(np.array([i for cid in ids for i in self.rows_of[cid]]), ids)
            if np.isfinite(v):
                vals.append(v)
        return [float(np.quantile(vals, 0.025)), float(np.quantile(vals, 0.975))]
