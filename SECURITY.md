# Security

## Scope and design

The web server is built to run **on your own machine** for one person, or for a small trusted group. It is not hardened for exposure to the public internet.

How the TypeSafe key is handled:

- **CLI and backtests.** The key is read from `TYPESAFE_API_KEY`, `./.env` or `~/.enigma-jev/.env`. `.env` files are ignored by git, and only `.env.example` is tracked.
- **Web page.** The key is sent once, to your own server's `POST /api/unlock`. The server verifies it with one Jev call and holds it in memory against a random `HttpOnly; SameSite=Strict` session cookie.
  - The key is never returned to the page, written to disk or logged.
  - Unlock attempts are rate-limited.
  - Idle sessions expire after 12 hours, and a restart forgets every session.
- **Remember on this device.** This opt-in stores the key in the browser's local storage, so leave it off on shared computers.
- **Audit log.** `~/.enigma-jev/jev-calls.jsonl` records requests and answers, never the key.

If you run the server on a network:

- put it behind HTTPS, because the key crosses the wire once at unlock;
- restrict who can reach it, because anyone who unlocks a session spends *your* TypeSafe credit through `/api/break`.

## Reporting a vulnerability

Please do **not** open a public issue. Use the repository's **private vulnerability reporting** instead: *Security → Report a vulnerability* on GitHub. Include steps to reproduce. You can expect a reply within a week.

If you find a key committed anywhere in the history, report it the same way, and revoke it with TypeSafe straight away.
