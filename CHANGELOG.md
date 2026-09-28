# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- Vercel deployment: static pages built by `bun run build`, and one Bun function for the API (`api/index.ts`, `vercel.json`).
- The worker pool runs steps in process when worker threads are unavailable.

### Changed

- Sessions are sealed into an encrypted HttpOnly cookie (AES-256-GCM under `SESSION_SECRET`) instead of server memory, so they work across function instances.
- The API routes are shared between the local server and the function (`src/web/api.ts`), and data paths resolve from the project root (`src/paths.ts`).

## [1.0.0] - 2026-09-28

The first public release.

### Added

- **The Enigma machine.** Enigma I, M3 and M4 with every historical rotor and reflector, rings, plugboard and double stepping. It is checked against the textbook vector and every historical message.
- **The Bombe and the searches.**
  - A Turing–Welchman Bombe with Welchman's diagonal board, turnover-aware menus and ring-independent stop ranking.
  - A plugboard hill-climb with ring refinement.
  - A ciphertext-only scan and climb.
- **Jev.** Crib ranking and plaintext judging through TypeSafe's System One API, with a two-condition decision rule and a full audit log.
- **The backtest.** Five tiers (`verify`, `key`, `crib`, `bombe`, `climb`) on 10 historical messages and 16 synthetic ones.
- **The machine page.** A CSS 3D Enigma I behind a key gate, and a six-step flow from setting the key to breaking the message, with Bletchley's break streamed live.
- **The research page.** History, method and evaluation, with five live figures, including a running Bombe with its test register.
- **The Jev performance page.** Discrimination, calibration, decisions, reliability, cost, and a comparison with n-gram judges, logistic regression and XGBoost.
- **Checks against published work.** The Bombe stop counts and Zygalski female probabilities are validated against Weinbaum (2025).
- **Reproduction and CI.** `bun run reproduce` rebuilds every offline result. CI covers type checks, lint, tests and the Python comparison.
