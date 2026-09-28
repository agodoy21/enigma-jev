"""
Classical plaintext statistics, trained on the project's German corpus.

These are the codebreaker's judges: a Kneser-Ney character model, quadgram
fitness, letter frequencies and dictionary coverage. `features` turns one
candidate decryption into the twelve numbers the trained judges learn from.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np

A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

FEATURES = [
    'kn5',
    'quadgram',
    'trigram_germanness',
    'ioc',
    'chi2',
    'entropy',
    'vowels',
    'common8',
    'unseen_trigrams',
    'dict_coverage',
    'dict_run',
    'x_rate',
]


class KneserNey:
    """Interpolated Kneser-Ney character n-gram model (absolute discount 0.75; Kneser and Ney 1995)."""

    def __init__(self, text: str, order: int = 5, d: float = 0.75):
        self.n, self.d = order, d
        self.counts = [Counter() for _ in range(order + 1)]  # counts[k][gram of length k]
        self.ctx = [Counter() for _ in range(order + 1)]  # count of each context, highest order
        self.types_after = [Counter() for _ in range(order + 1)]  # N1+(h •)
        self.cont = [Counter() for _ in range(order + 1)]  # N1+(• w), continuation counts for lower orders
        self.cont_ctx = [Counter() for _ in range(order + 1)]  # N1+(• h •)
        self.cont_types_after = [Counter() for _ in range(order + 1)]
        grams = [Counter() for _ in range(order + 1)]
        for k in range(1, order + 1):
            for i in range(len(text) - k + 1):
                grams[k][text[i : i + k]] += 1
        for k in range(1, order + 1):
            for g, c in grams[k].items():
                self.counts[k][g] = c
                self.ctx[k][g[:-1]] += c
                self.types_after[k][g[:-1]] += 1
                if k >= 2:
                    self.cont[k - 1][g[1:]] += 1
        for k in range(1, order):
            for g, c in self.cont[k].items():
                self.cont_ctx[k][g[:-1]] += c
                self.cont_types_after[k][g[:-1]] += 1
        self.unigram_total = sum(self.cont[1].values())

    def prob(self, h: str, w: str, k: int | None = None) -> float:
        k = self.n if k is None else k
        h = h[-(k - 1) :] if k > 1 else ''
        if k == 1:
            return (self.cont[1][w] + 1) / (self.unigram_total + 26)  # continuation unigram, add-one
        top = k == self.n
        c = self.counts[k][h + w] if top else self.cont[k][h + w]
        z = self.ctx[k][h] if top else self.cont_ctx[k][h]
        t = self.types_after[k][h] if top else self.cont_types_after[k][h]
        lower = self.prob(h, w, k - 1)
        if z == 0:
            return lower
        return max(c - self.d, 0) / z + self.d * t / z * lower

    def mean_logprob(self, s: str) -> float:
        if len(s) < 2:
            return math.log(1 / 26)
        total = sum(math.log(self.prob(s[max(0, i - self.n + 1) : i], s[i])) for i in range(1, len(s)))
        return total / (len(s) - 1)


@dataclass
class TextModels:
    """Everything the features need, built once from the training text."""

    letters: int
    kn5: KneserNey
    quad: Counter
    quad_total: int
    quad_floor: float
    trigrams: set[str]
    unigram: np.ndarray
    vocabulary: set[str]
    longest_word: int

    @classmethod
    def build(cls, training: str, corpus_dir: Path) -> TextModels:
        quad = Counter(training[i : i + 4] for i in range(len(training) - 3))
        total = sum(quad.values())
        uni = Counter(training)
        vocab = load_vocabulary(corpus_dir)
        return cls(
            letters=len(training),
            kn5=KneserNey(training, 5),
            quad=quad,
            quad_total=total,
            quad_floor=math.log10(0.01 / total),
            trigrams={training[i : i + 3] for i in range(len(training) - 2)},
            unigram=np.array([uni[ch] for ch in A], dtype=float) / len(training),
            vocabulary=vocab,
            longest_word=max(map(len, vocab)),
        )

    def quadgram_fitness(self, s: str) -> float:
        """Mean log10 quadgram probability, the usual hill-climbing score (Lasry 2018)."""
        grams = (s[i : i + 4] for i in range(len(s) - 3))
        score = sum(math.log10(self.quad[g] / self.quad_total) if self.quad[g] else self.quad_floor for g in grams)
        return score / max(1, len(s) - 3)

    def coverage(self, s: str) -> tuple[float, int]:
        """Share of letters inside greedy longest dictionary matches, and the longest covered run."""
        covered = [False] * len(s)
        i = 0
        while i < len(s):
            hit = next(
                (n for n in range(min(self.longest_word, len(s) - i), 3, -1) if s[i : i + n] in self.vocabulary), 0
            )
            for j in range(i, i + hit):
                covered[j] = True
            i += hit or 1
        run = best = 0
        for c in covered:
            run = run + 1 if c else 0
            best = max(best, run)
        return sum(covered) / max(1, len(s)), best


def load_vocabulary(corpus_dir: Path) -> set[str]:
    """German words of four letters or more, spelled as an operator would key them (Q for CH as well)."""
    vocab: set[str] = set()
    for f in sorted(corpus_dir.glob('*.txt')):
        for line in f.read_text().splitlines():
            if line.strip().startswith('#'):
                continue
            s = line.upper().replace('Ä', 'AE').replace('Ö', 'OE').replace('Ü', 'UE').replace('ß', 'SS')
            s = ''.join(ch for ch in unicodedata.normalize('NFD', s) if not unicodedata.combining(ch))
            for w in re.findall(r'[A-Z]+', s):
                if len(w) >= 4:
                    vocab.add(w)
                    if 'CH' in w:
                        vocab.add(w.replace('CH', 'Q'))
    return vocab


def features(s: str, germanness: float, m: TextModels) -> list[float]:
    """The twelve features of one candidate's free text (the letters outside its crib), in FEATURES order."""
    n = max(1, len(s))
    counts = np.array([s.count(ch) for ch in A], dtype=float)
    freq = counts / n
    ioc = float((counts * (counts - 1)).sum() / max(1, n * (n - 1)) * 26)
    chi2 = float(((counts - n * m.unigram) ** 2 / (n * m.unigram + 1e-9)).sum() / n)
    entropy = float(-(freq[freq > 0] * np.log2(freq[freq > 0])).sum())
    unseen = sum(s[i : i + 3] not in m.trigrams for i in range(len(s) - 2)) / max(1, len(s) - 2)
    cov, run = m.coverage(s)
    return [
        m.kn5.mean_logprob(s),
        m.quadgram_fitness(s),
        germanness,
        ioc,
        chi2,
        entropy,
        sum(s.count(v) for v in 'AEIOU') / n,
        sum(s.count(v) for v in 'ENISRATD') / n,
        unseen,
        cov,
        run / n,
        s.count('X') / n,
    ]
