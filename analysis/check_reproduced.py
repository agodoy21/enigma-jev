"""
Did a rerun of judges.py reproduce the committed report?

    python analysis/check_reproduced.py BEFORE.json reports/judge-comparison.json

Three kinds of difference:

    CHANGED    a count (decisions, sizes) or a non-XGBoost score moved: the run fails
    noise      a score moved within floating-point noise (1e-4 absolute or 1e-3 relative)
    platform   an XGBoost score moved. XGBoost is deterministic on one platform but not
               across them (arm64 and x86-64 builds break near-tied splits differently),
               so its scores are reported, not enforced. Its decision counts still are.

Timings and the platform name are ignored. Prints every difference.
"""

from __future__ import annotations

import json
import math
import sys

IGNORED = {'generatedAt', 'predictMicroseconds', 'featureMilliseconds', 'platform'}


def is_xgb(path: str) -> bool:
    return 'xgb' in path.lower()


def diffs(a: object, b: object, path: str = '') -> list[tuple[str, object, object, str]]:
    """(path, before, after, kind) for every leaf that differs."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in IGNORED:
                out += diffs(a.get(k), b.get(k), f'{path}.{k}')
        return out
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        out = []
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            # Name list entries when they carry a name, so a judge's path says which judge it is.
            label = x['name'] if isinstance(x, dict) and 'name' in x else i
            out += diffs(x, y, f'{path}[{label}]')
        return out
    if a == b or (isinstance(a, float) and isinstance(b, float) and math.isnan(a) and math.isnan(b)):
        return []
    counts = isinstance(a, int) and isinstance(b, int)
    if is_xgb(path) and not counts:
        return [(path, a, b, 'platform')]
    if isinstance(a, float) and isinstance(b, float | int) and not isinstance(b, bool):
        return [(path, a, b, 'noise' if math.isclose(a, b, rel_tol=1e-3, abs_tol=1e-4) else 'CHANGED')]
    return [(path, a, b, 'CHANGED')]


def main() -> None:
    before, after = (json.load(open(p)) for p in sys.argv[1:3])
    found = diffs(before, after)
    for path, a, b, kind in found:
        print(f'{kind:<8}  {path}: {a} -> {b}')
    bad = sum(kind == 'CHANGED' for *_, kind in found)
    print(f'{len(found)} differences, {bad} beyond tolerance')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
