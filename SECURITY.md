# Security

## Scope and design

The web server is built to run **on your own machine**, or as a small deployment (for example on Vercel) for yourself or a trusted group. It is not hardened as a public service.

How the TypeSafe key is handled:

- **CLI and backtests.** The key is read from `TYPESAFE_API_KEY`, `./.env` or `~/.enigma-jev/.env`. `.env` files are ignored by git, and only `.env.example` is tracked.
- **Web page.** The key is sent once, to the server's `POST /api/unlock`. The server verifies it with one Jev call, then seals it into a `HttpOnly; SameSite=Strict` cookie. The cookie is also `Secure` over HTTPS, and it is encrypted with AES-256-GCM under `SESSION_SECRET`.
  - The page's scripts cannot read the cookie, and it cannot be opened without the secret.
  - The key is never written to disk or logged.
  - Unlock attempts are rate-limited per server instance.
  - Sessions expire 12 hours after unlocking. **Lock** clears the cookie from the browser. The server keeps no session list, so a copied cookie stays valid until it expires. To end every session at once, rotate `SESSION_SECRET`.
- **`SESSION_SECRET`.** A deployment must set it and keep it secret. Locally, a random one is drawn when the server starts, so a restart ends every session.
- **Remember on this device.** This opt-in stores the key in the browser's local storage, so leave it off on shared computers.
- **Audit log.** `~/.enigma-jev/jev-calls.jsonl` records requests and answers, never the key.

If you run the server on a network:

- put it behind HTTPS, because the key crosses the wire once at unlock;
- restrict who can reach it, because anyone who unlocks a session spends *your* TypeSafe credit through `/api/break`.

## Reporting a vulnerability

Please do **not** open a public issue. Use the repository's **private vulnerability reporting** instead: *Security → Report a vulnerability* on GitHub. Include steps to reproduce. You can expect a reply within a week.

If you find a key committed anywhere in the history, report it the same way, and revoke it with TypeSafe straight away.
