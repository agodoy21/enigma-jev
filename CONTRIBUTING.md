# Contributing

Thank you for helping. The most useful contributions are:

- **Historical intercepts** with a published key and decryption. See [data/README.md](data/README.md#adding-a-historical-message).
- **Corrections** to the papers' history or statistics, with a source.
- **Faster or better searches**, such as a quicker Bombe or a better climb, measured on the backtest.
- **Bug reports** with a message and key that reproduce them.

## Setup

You need [Bun](https://bun.sh) 1.3 or later. Python 3.12 is needed only for `analysis/`.

```bash
bun install
```

```bash
bun run check
```

`bun run check` runs the type check, Biome (format and lint) and the tests. It must pass before a pull request, and CI runs the same checks. `bun run format` fixes formatting and import order.

A TypeSafe key is **not** needed for the tests. They stub the Jev API, and the break tests run with Jev off. You need a key only to use the machine page, run `cli break` with Jev, or rerun the backtests.

## Ground rules

- **Numbers come from reports.** Every figure in the papers is read from `reports/*.json`. If a change moves a published number, rerun the analysis that writes it (see the table in the README) and say so in the pull request.
- **The machine is sacred.** A change to `src/enigma/` must keep every historical message decrypting exactly (`bun test`).
- **The synthetic set stays held out.** Never add `data/synthetic/` text to `data/corpus/`; `test/data.test.ts` enforces this.
- **Match the surrounding code.** TypeScript is strict. Biome's formatting is canonical: single quotes, 120 columns. Comments explain *why*, as the existing ones do.
- **One concern per pull request**, with a short description of what changed and how you checked it.

## Commit messages

Use a short imperative subject (`Rank Bombe stops by suffix sum over rings`), and a body when the reason isn't obvious.

## Layout

The README has the [project layout](README.md#project-layout), and [docs/architecture.md](docs/architecture.md) explains how the pieces fit together.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
