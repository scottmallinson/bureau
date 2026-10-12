# 0003. Single-owner sign-in through OAuth providers

- Status: Proposed
- Date: 2026-10-12

## Context

Bureau can move scheduled posts on the owner's Ghost site and Buffer
channels. Until now it had no login and protected itself by listening on
loopback only, which rules out hosting it on the open web (on Vercel, for
example). Bureau has exactly one user and no database, and hosted platforms
may run it as several short-lived instances with no shared memory or disk.

A first draft rolled its own password sign-in. We would rather not maintain
session and credential code ourselves, and the owner already has accounts with
Google, GitHub, Microsoft and LinkedIn.

## Decision

We will authenticate through those providers with
[Better Auth](https://www.better-auth.com), mounted on the Hono API at
`/api/auth/*`, and run it stateless:

- With no database configured, Better Auth keeps the session in an encrypted
  cookie (JWE) that it refreshes as it goes, and keeps OAuth state in a
  cookie too. `BETTER_AUTH_SECRET` encrypts them.
- Any provider will authenticate anyone, so `BUREAU_ALLOWED_EMAILS` is what
  makes Bureau single-owner. Better Auth's `validateUserInfo` hook admits a
  sign-in only when the provider reports the address as verified and it is on
  the list.
- Every other `/api` route except `health` and `session` needs a session.
  Unsafe requests that a browser marks as cross-site (`Sec-Fetch-Site`) are
  refused, on top of Better Auth's own origin checks and SameSite cookies.
- Each provider is switched on by its client ID and secret. Without any,
  Bureau still runs open, but the Node server refuses to listen on anything
  but loopback. A provider without an allowlist or a strong secret stops it
  from starting.

The MCP server is unchanged. It speaks stdio to a client on the same machine
and is never reachable over the network.

We chose Better Auth over Auth.js, which now receives maintenance updates
only and whose maintainers point new projects at Better Auth, and over a hosted
service such as Clerk, which would make every sign-in depend on a third-party
account.

## Consequences

- No credential or session code of our own, and no user store or database.
- Better Auth is a new dependency, and the providers' OAuth apps have to be
  registered with `<BETTER_AUTH_URL>/api/auth/callback/<provider>`.
- Sessions cannot be revoked one at a time. Rotating `BETTER_AUTH_SECRET`
  signs out every browser.
- A provider that does not report an address as verified cannot be used to
  sign in. Microsoft personal accounts may fall into this; use a tenant or
  another provider.
- More users, or roles, would mean adding a database to Better Auth and
  recording that in a new ADR.
