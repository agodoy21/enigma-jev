"""
Did a rerun of judges.py reproduce the committed report?

    python analysis/check_reproduced.py BEFORE.json reports/judge-comparison.json

Counts (decisions, sizes) must match exactly. Probabilities and scores may differ
by floating-point noise between platforms (BLAS and XGBoost builds differ between
macOS and Linux): within 1e-4 absolute or 1e-3 relative. Timings are ignored.
Prints every difference, then exits 1 if any is beyond tolerance.
"""

from __future__ import annotations

import json
import math
import sys

IGNORED = {'generatedAt', 'predictMicroseconds', 'featureMilliseconds'}


def diffs(a: object, b: object, path: str = '') -> list[tuple[str, object, object, bool]]:
    """(path, before, after, within tolerance) for every leaf that differs."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k in IGNORED:
                continue
            out += diffs(a.get(k), b.get(k), f'{path}.{k}')
        return out
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [d for i, (x, y) in enumerate(zip(a, b, strict=True)) for d in diffs(x, y, f'{path}[{i}]')]
    if isinstance(a, float) and isinstance(b, float | int) and not isinstance(b, bool):
        if a == b or (math.isnan(a) and math.isnan(b)):
            return []
        return [(path, a, b, math.isclose(a, b, rel_tol=1e-3, abs_tol=1e-4))]
    return [] if a == b else [(path, a, b, False)]


def main() -> None:
    before, after = (json.load(open(p)) for p in sys.argv[1:3])
    found = diffs(before, after)
    for path, a, b, ok in found:
        print(f'{"noise" if ok else "CHANGED"}  {path}: {a} -> {b}')
    bad = [d for d in found if not d[3]]
    print(f'{len(found)} differences, {len(bad)} beyond tolerance')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
