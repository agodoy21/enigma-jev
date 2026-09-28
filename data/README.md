# Data

| Path | What it is | Origin |
|---|---|---|
| `historical/messages.json` | 10 real Enigma messages with published keys | the public sources listed in each entry |
| `synthetic/plaintexts.txt` | 16 German military messages, one per paragraph, each prefixed with its service | written for this project |
| `corpus/` | German training text for the language model: general prose and military report style | written for this project |
| `corpus-en/`, `corpus-es/` | English and Spanish text for scoring live messages in those languages | written for this project |

The synthetic plaintexts are **held out** of the language model: nothing in `synthetic/` appears in `corpus/`. Keep it that way. `test/data.test.ts` fails if any 30-letter stretch of a synthetic message appears in the corpus.

## Historical messages

The historical messages have these properties:

- every entry decrypts exactly with its published key on this machine, which `test/data.test.ts` checks;
- nine of them are scored in the backtest;
- `heer-1941-07-07-nr113` is kept, but excluded from scoring (see its `caveats`).

| id | Machine | Date | Main source |
|---|---|---|---|
| `heer-1930-manual` | Enigma I | 1930 | 1930 instruction manual test message (cryptocellar) |
| `barbarossa-1941-part1`, `-part2` | Enigma I | 1941-07-07 | Operation Barbarossa, SS-Totenkopf (Franklin Heath wiki) |
| `heer-1941-07-07-nr113` | Enigma I | 1941-07-07 | Heeresgruppe Nord short message (cryptocellar, *Breaking German Army Ciphers*) |
| `scharnhorst-1943` | M3 | 1943-12-26 | Scharnhorst's last message (cryptocellar, bytereef) |
| `m4-project-1-looks-u264` | M4 | 1942-11-25 | M4 Message Breaking Project, first break (bytereef) |
| `m4-project-2-schroeder-u623` | M4 | 1942-11-21 | M4 Project, second break (bytereef) |
| `m4-project-3-rasch-u106` | M4 | 1942-11-19 | M4 Project, third message (Enigma-Hörenberg) |
| `u534-doenitz-p1030681` | M4 | 1945-05-01 | Dönitz succession message recovered from U-534 (Crypto Museum) |
| `dewiki-example-aachen` | Enigma I | – | German Wikipedia's worked example, kept as a control |

Each entry records:

| Field | Meaning |
|---|---|
| `id`, `title`, `date`, `machine` | identification |
| `sources` | every page the message, key and decryption were checked against |
| `reflector`, `rotors`, `rings`, `ringsFormat`, `plugboard` | the daily key, with a note on how the source wrote the rings |
| `grundstellung`, `indicator`, `messageKey` | the indicator procedure and the recovered message key |
| `ciphertext`, `plaintext`, `translation` | the message in five-letter groups (four for naval), its decryption and an English translation |
| `excluded` | the groups left out of the ciphertext (headers, Kenngruppen, indicators) and why |
| `caveats` | anything uncertain: garbles, unpublished plaintext, procedure notes |

The messages themselves are historical records. The transcriptions, keys and decryptions are the work of the sources credited in each entry, and they are reproduced here for research with attribution. If you reuse them, cite those sources.

## Adding a historical message

Good additions are messages with a **published key and a published decryption** from a source you can link. Open an issue with the *Historical message* template first if you are unsure.

1. Add an entry to `historical/messages.json` with every field above. Put the ciphertext exactly as transmitted, without headers, and record what you removed under `excluded`.
2. Check that it decrypts with the machine:

   ```bash
   bun run cli decrypt "<ciphertext>" --rotors .. --reflector .. --rings .. --start <messageKey> --plugs ".."
   ```

3. Run `bun test`. `test/data.test.ts` decrypts every entry, and a mismatch fails the run.
4. Say in `caveats` whether the plaintext is published or your own decryption. Unverified plaintexts are excluded from scoring (see `EXCLUDED` in `src/backtest/cases.ts`).

A new message changes the backtest. Rerun it (`bun run reproduce --backtests`, which needs a key) before quoting new numbers.
