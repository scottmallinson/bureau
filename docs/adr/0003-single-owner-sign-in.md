# 0003. Single-owner sign-in

- Status: Proposed
- Date: 2026-10-12

## Context

Bureau can move scheduled posts on the owner's Ghost site and Buffer
channels. Until now it had no login and protected itself by listening on
loopback only, which rules out hosting it on the open web (on Vercel, for
example). Bureau has exactly one user, and hosted platforms may run it as
several short-lived instances with no shared memory or disk.

## Decision

We will protect the JSON API with a single owner password, set in
`BUREAU_PASSWORD`, and stateless sessions:

- `POST /api/login` checks the password in constant time and sets an
  HttpOnly, SameSite=Strict cookie holding an HS256 JWT signed with
  `BUREAU_SESSION_SECRET` (Secure everywhere except plain HTTP on loopback).
- Every `/api` route except `health`, `session`, `login` and `logout` needs
  that cookie. The UI and its assets stay public: they contain no data, and
  show a sign-in form until `/api/session` reports a session.
- Unsafe requests that a browser marks as cross-site (`Sec-Fetch-Site`) are
  refused, on top of SameSite.
- After ten failed sign-ins in fifteen minutes, sign-in stops answering until
  the window passes. The count is global, not per client, because client
  addresses can be spoofed when Bureau is not behind a trusted proxy.
- Without a password, Bureau still runs open, but the Node server refuses to
  listen on anything but loopback. A weak password or short secret stops it
  from starting.

The MCP server is unchanged. It speaks stdio to a client on the same machine
and is never reachable over the network.

## Consequences

- One environment variable pair makes Bureau safe to expose; no user store,
  database or third-party identity provider is needed.
- Sessions cannot be revoked one at a time. Rotating `BUREAU_SESSION_SECRET`
  signs out every browser.
- On serverless hosts each instance keeps its own failure count, so the
  sign-in limit is per instance. A long random password is the real defence.
- Anyone who can try passwords can also trip the limit and lock the owner out
  for fifteen minutes. That is the accepted price of not trusting client
  addresses.
- More users, or sign-in through an identity provider, would mean replacing
  `src/server/auth.ts` and recording that in a new ADR.
