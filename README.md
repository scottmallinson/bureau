# Bureau

A desk for publishing across Ghost and Buffer. Bureau shows every queued item
on one calendar, works out which items belong together (a Ghost article and
the LinkedIn, Bluesky and Mastodon posts that share it), and reports how they
performed, overall, by platform and by post. An MCP server lets an AI
assistant analyse the same numbers.

![The schedule: a week calendar with Ghost and Buffer items, and the unscheduled tray](docs/images/schedule.png)

## What it does

- **Schedule.** A week calendar of every scheduled item across Ghost and every
  Buffer channel. Drag an item to another hour or day to move it, drag an
  unscheduled draft onto the calendar to give it a time, or drop an item on the
  _Unscheduled_ tray to take its time away. Every change can be undone from the
  notification that confirms it.
- **Manual entry.** Click any item for a details panel with a date-time field,
  quick nudges (-1h, +1h, +1 day, +1 week) and _Remove time_. The _Queue_ view
  lists every unpublished item with its own time field, for bulk edits by
  keyboard.
- **Relationships.** Bureau links a social post to a Ghost article when it
  shares the article's URL or slug, which works even before the article is
  published. Posts sharing the same outside link are grouped too. Posts with no
  link that repeat an article's title are offered as suggestions to confirm or
  dismiss. In the _Stories_ view you can drag an unlinked item onto a story, or
  tick several items to link them.
- **Timing checks.** A social post scheduled before its article goes live, or
  for an article with no time yet, is flagged on the calendar and in the story.
- **Moving a story together.** With _Move related items too_ on, moving an
  article moves its scheduled social posts by the same amount.
- **Analytics.** Totals (views, followers, engagements, engagement rate, email
  opens, sign-ups), a per-platform breakdown, per-channel follower counts,
  cross-platform story totals and a sortable per-post table with every metric.
- **AI analysis.** A read-only MCP server exposes the analytics, the schedule
  and the relationships to any MCP client.
- **Web or desktop.** Host it (on Vercel, say) or install it on macOS or
  Windows, where it keeps itself up to date.

Editing an item's content is deliberately out of scope: Bureau only adds,
changes or removes publishing times.

## Quick start

Needs Node 22.9 or newer.

```sh
npm install
npm run dev        # API on :8787, UI on http://localhost:5173
```

With no credentials Bureau runs on demo data for both integrations (the badges
in the top right say `demo`). The demo is seeded relative to the day you first
run it and stored in `data/`; delete `data/mock-*.json` to reseed.

For a production build:

```sh
npm run build
npm start          # UI and API on http://localhost:8787
```

## Connecting Ghost and Buffer

Open **Settings** in Bureau and enter each service's details; _Test connection_
checks them before you save. Each integration is independent: connect one and
the other stays on demo data. Keys are kept with Bureau's other state (in
`data/settings.json`, in Redis, or in the desktop app's data folder, where
they are encrypted with the system keychain) and are never sent back to the
browser once saved.

Environment variables do the same job and take precedence: an integration set
in the environment shows as such in Settings and cannot be changed there,
which suits a deployment you want pinned. To use them, copy `.env.example` to
`.env`.

| Variable                                         | What it is                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GHOST_ADMIN_API_URL`                            | Your site's URL                                                                                       |
| `GHOST_ADMIN_API_KEY`                            | Admin API key from a custom integration (Ghost Admin, Settings, Integrations), in `id:secret` form    |
| `BUFFER_API_KEY`                                 | From [publish.buffer.com/settings/api](https://publish.buffer.com/settings/api)                       |
| `BUFFER_ORGANIZATION_ID`                         | The Buffer organisation to read                                                                       |
| `BUREAU_MOCK`                                    | `1` forces demo data for both                                                                         |
| `PORT`, `BUREAU_DATA_DIR`, `BUREAU_HISTORY_DAYS` | Server port (8787), where Bureau keeps its state (`data/`), how far back to load published items (90) |

How each service maps onto Bureau:

- **Ghost.** Scheduling sets a post's `status` to `scheduled` with a future
  `published_at`; removing a time sets it back to `draft`. Bureau never sends a
  `newsletter`, so scheduling a draft from Bureau publishes it to the web only;
  posts scheduled in Ghost Admin with a newsletter keep it when their time
  moves. Followers are the site's member count. Email opens, clicks, sign-ups
  and paid conversions come from the Admin API. Page views come from Ghost 6's
  stats endpoint, which is not part of the documented Admin API: if your site
  does not answer it, Ghost views are simply left out.
- **Buffer.** Uses Buffer's GraphQL API. Moving a time is `editPost` with a
  custom `dueAt`; removing a time moves the post to drafts. Metrics come from
  each post's `metrics`. Buffer's API reports no follower counts, so enter them
  on the _Analytics_ page; Bureau records when you did.

## Signing in

Bureau can move your scheduled posts, so anywhere but your own machine it asks
you to sign in with Google, GitHub, Microsoft or LinkedIn, using
[Better Auth](https://www.better-auth.com). Only the verified email addresses
you list get in; anyone else who signs in with one of those providers is
turned away.

| Variable                                         | What it is                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `BUREAU_ALLOWED_EMAILS`                          | Comma-separated addresses allowed in. The provider must report the address as verified                |
| `BETTER_AUTH_SECRET`                             | At least 32 random characters that encrypt session cookies: `openssl rand -base64 32`                 |
| `BETTER_AUTH_URL`                                | Where Bureau is served, e.g. `https://bureau.example.com` (`http://localhost:5173` for `npm run dev`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`       | From a Google Cloud OAuth client (web application)                                                    |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`       | From a GitHub OAuth app                                                                               |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | From a Microsoft Entra app registration; `MICROSOFT_TENANT_ID` narrows it to one tenant (`common`)    |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`   | From a LinkedIn app with _Sign In with LinkedIn using OpenID Connect_                                 |
| `BUREAU_SESSION_DAYS`                            | How long a sign-in lasts (7)                                                                          |

Configure any of the providers; each one you set gets a button on the sign-in
page. Register `<BETTER_AUTH_URL>/api/auth/callback/<provider>` as the
redirect URL with each, where `<provider>` is `google`, `github`,
`microsoft` or `linkedin`.

Bureau has no database, so sessions are stateless: they live in encrypted
cookies, which works on serverless hosts too. Every API route except
`/api/health`, `/api/session` and Better Auth's own `/api/auth/*` needs one.
Changing `BETTER_AUTH_SECRET` signs out every browser.

With no provider configured, the server listens on `127.0.0.1` only and
refuses to start if `HOST` points anywhere else. A provider without an
allowlist or a strong secret stops it from starting. The MCP server needs no
sign-in: it talks over stdio to a client on the same machine. See
[ADR 0003](docs/adr/0003-single-owner-sign-in.md) for the reasoning.

## Deploying to Vercel

Bureau deploys to [Vercel](https://vercel.com) as it is: `vercel.json` builds
the UI as static files and serves the API from one Vercel Function
(`api/index.js`, which wraps the compiled Hono app).

1. Import the repository as a new Vercel project. Leave the framework preset
   alone: `vercel.json` sets the build command and output directory.
2. Add a Redis database: _Storage_ (or the Marketplace) > _Upstash_ >
   _Upstash for Redis_, connected to the project. A function has no writable
   disk, so Bureau keeps its links, follower counts and snapshots there
   instead of in `data/`. The free plan is plenty.
3. Set the [sign-in](#signing-in) variables, with `BETTER_AUTH_URL` set to the
   deployment's URL (e.g. `https://bureau.vercel.app`), and register
   `<BETTER_AUTH_URL>/api/auth/callback/<provider>` with each provider.
4. Add the Ghost and Buffer variables from
   [Connecting Ghost and Buffer](#connecting-ghost-and-buffer), or leave them
   out to try it on demo data, then deploy.

`vercel.json` skips downloading Electron during the install: the desktop app's
build tools are development dependencies the web deployment never runs.

A deployment is public, so until sign-in and a database are configured the API
answers every request with 503 and the function logs say what is missing.

| Variable                               | What it is                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Set by the Upstash integration. Bureau also reads `UPSTASH_REDIS_REST_URL/TOKEN` |
| `BUREAU_REDIS_PREFIX`                  | Put before every key (`bureau:`), so previews or two sites can share a database  |

The same variables work anywhere: set them in `.env` and the local server and
the MCP server use the Redis database instead of `data/`, which lets an
assistant analyse the deployed Bureau's numbers from your machine. See
[ADR 0004](docs/adr/0004-vercel-and-redis-storage.md) for the reasoning.

## Desktop app

Bureau also runs as a desktop app for macOS 12 or later and Windows 10 or
later, built with [Electron](https://www.electronjs.org). The app runs the same
server inside itself on a private loopback port and shows the UI in its own
window, so it needs no sign-in, no `.env` and no terminal: connect Ghost and
Buffer in Settings. Its data lives in the app's data folder
(`~/Library/Application Support/Bureau` on macOS, `%APPDATA%\Bureau` on
Windows).

```sh
npm run desktop       # build and open the app from source
npm run dist:desktop  # build an installer for this platform into release/
```

### Updates

The installed app checks
[GitHub Releases](https://github.com/scottmallinson/bureau/releases) when it
starts and every six hours, using
[electron-updater](https://www.electron.build/auto-update). A newer version
downloads in the background and installs when Bureau quits; _Settings >
Updates_ shows its progress and can restart into it straight away or check
again.

Releases are automatic. Every merge to `main` that carries a releasable
[Conventional Commit](https://www.conventionalcommits.org/) cuts a version
through `.github/workflows/desktop.yml`:

1. [semantic-release](https://semantic-release.gitbook.io) picks the next
   version from the commits since the last tag (`fix` and `perf` bump the
   patch, `feat` the minor, a breaking change the major), tags it and opens a
   draft release with the notes. `chore`, `docs`, `ci` and the like release
   nothing.
2. The macOS (universal) and Windows installers are built at that version and
   uploaded, with the update metadata, into the draft.
3. Once both are in, the draft is published, and installed apps update from
   that moment. If either build fails, the release stays a draft and nothing
   updates.

The version lives in the tags, so `version` in `package.json` is not bumped.
Pull requests build both installers without publishing, so a build that
would break a release fails on the pull request first.

### Signing

macOS installs updates only into a signed app, so updates on macOS need an
Apple Developer ID certificate and notarisation. Add these repository secrets
and the workflow uses them:

| Secret                                                     | What it is                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`              | The _Developer ID Application_ certificate as base64 `.p12`, and its password            |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | For notarisation                                                                         |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`      | Optional. Unsigned Windows builds install and update, but SmartScreen warns on first run |

Without the macOS secrets the build is unsigned: it opens after a right-click
and _Open_, and has to be updated by downloading the new version by hand.

The app is pinned to Electron 43, the last version that supports macOS 12.
See [ADR 0005](docs/adr/0005-desktop-app.md).

## AI analysis over MCP

`npm run mcp` (after `npm run build`) starts the MCP server on stdio, against
the same configuration and storage (`data/` or Redis) as the web app. For Claude Desktop or
Claude Code, add:

```json
{
  "mcpServers": {
    "bureau": {
      "command": "npm",
      "args": ["--prefix", "/path/to/bureau", "--silent", "run", "mcp"]
    }
  }
}
```

| Tool                     | Returns                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `get_analytics_summary`  | Overall totals and a one-line-per-platform summary, for a date range |
| `get_platform_breakdown` | Per-platform totals with each channel's followers and their source   |
| `list_post_metrics`      | Published items with metrics, filtered by platform and sorted        |
| `get_post_analytics`     | One item, every item related to it, and the story's combined totals  |
| `list_stories`           | Cross-platform stories ranked by views                               |
| `get_schedule`           | Upcoming and unscheduled items with timing warnings and suggestions  |
| `get_metrics_history`    | Follower, view and engagement snapshots over time                    |

There is also a `performance_review` prompt that walks an assistant through a
review of the last N days. All tools are read-only.

## How it fits together

```
src/core/     Domain types, relationship detection, analytics (shared by everything)
src/server/   Bureau service, Ghost/Buffer providers, mock providers, JSON API (Hono)
api/          Vercel Function entry point over the compiled server
src/mcp/      MCP server over the same Bureau service
src/web/      React UI (Vite, dnd-kit)
src/desktop/  Electron app: runs the server in-process, window, updates
test/         Vitest suites for core, providers, service, API and MCP
docs/adr/     Architecture decisions (see 0002 for the stack)
```

The JSON API, for reference:

| Method   | Path                                  | Body                                                         |
| -------- | ------------------------------------- | ------------------------------------------------------------ |
| `GET`    | `/api/session`                        | Whether sign-in is needed, providers, the user               |
| `*`      | `/api/auth/*`                         | Better Auth: sign-in, OAuth callbacks, sign-out              |
| `GET`    | `/api/overview`                       | Channels, items, stories, suggestions                        |
| `PUT`    | `/api/items/:id/schedule`             | `{ "scheduledAt": iso \| null, "cascade": bool }`            |
| `POST`   | `/api/relationships`                  | `{ "itemIds": [...] }`                                       |
| `DELETE` | `/api/relationships/:id`              | Removes a manual link or rejects a detected one              |
| `PUT`    | `/api/channels/:id/followers`         | `{ "followers": number \| null }`                            |
| `GET`    | `/api/analytics`                      | `?from=&to=&refresh=1`                                       |
| `GET`    | `/api/analytics/history`              | Snapshots                                                    |
| `GET`    | `/api/changes`                        | Recent schedule changes                                      |
| `GET`    | `/api/settings/integrations`          | Where Ghost and Buffer are configured; no keys               |
| `PUT`    | `/api/settings/integrations/:id`      | Connect `ghost` or `buffer`; a blank key keeps the saved one |
| `DELETE` | `/api/settings/integrations/:id`      | Disconnect, back to demo data                                |
| `POST`   | `/api/settings/integrations/:id/test` | Check details without saving                                 |

## Everyday commands

```sh
npm run dev           # API and UI with reload
npm test              # unit and integration tests
npm run typecheck     # server, tests and UI
npm run build         # UI to dist/web, server to dist/
npm run desktop       # desktop app from source
npm run format        # Prettier
npm run lint:commits  # commitlint since origin/main
```

## Licence

[MIT](LICENCE.md)
