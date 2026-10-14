# 0004. Deploy to Vercel with Redis storage

- Status: Proposed
- Date: 2026-10-14

## Context

The owner wants to host Bureau on Vercel. [ADR 0003](0003-single-owner-sign-in.md)
made sign-in work on serverless hosts, but two things were still missing:

- An entry point. The server is a long-running Node process that calls
  `serve()`; Vercel runs request handlers as functions and serves static files
  itself.
- Somewhere to write. Bureau keeps its manual links, dismissed suggestions,
  follower counts, analytics snapshots and the demo data as JSON files in
  `data/`. A function's file system is read-only apart from `/tmp`, which is
  neither shared between instances nor kept between invocations.

The state is a handful of small JSON documents that are always read and
written whole. The file store already reads from disk on every call and takes
a lock around each read-modify-write, because the web and MCP servers are
separate processes over the same files.

## Decision

We will serve the API from one Vercel Function, `api/index.js`, that wraps the
compiled Hono app, with `vercel.json` building the UI as static files and
rewriting `/api/*` to the function and everything else to `index.html`. The
function refuses to serve (503, with the reason in the logs) until sign-in and
a database are configured, as the Node server refuses to listen beyond
loopback without a login.

We will keep state behind a small `Store` interface with two implementations:

- `JsonStore`, the existing file store, stays the default and is what
  development uses.
- `RedisStore` keeps each document as one JSON string in Redis, through
  Upstash's REST API. It is chosen whenever `KV_REST_API_URL` and
  `KV_REST_API_TOKEN` (or Upstash's own `UPSTASH_REDIS_REST_*` names) are set,
  which is what Vercel's Upstash integration does. Each update takes a lock key
  with `SET NX PX`, so concurrent functions cannot lose each other's writes, and
  the lease expires on its own if a function dies holding it. On Vercel with no
  database, configuration fails rather than falling back to a disk that cannot
  be written.

The client is a few lines of `fetch` rather than `@upstash/redis`, so the
change adds no dependency.

We considered Postgres (Neon through the Marketplace). It would mean a schema,
a driver dependency and interactive transactions over WebSockets to store a few
JSON documents that Redis holds as plain keys. Vercel Blob has no conditional
writes to build a lock from, and Edge Config is meant for rarely changing
configuration, not frequent writes.

## Consequences

- Bureau deploys to Vercel with one integration and the sign-in variables, and
  still runs locally with no services at all.
- Pointing a local server or the MCP server at the same Redis database works
  out of the box, so an assistant can analyse the deployed Bureau's data.
- Every store operation is now a network round trip on Vercel. The documents
  are small and the service already caches provider data, so this is not
  noticeable, but the demo providers take the lock on every read to persist
  their seed.
- Moving data between `data/` and Redis is manual: the keys are the file names
  without `.json`, under `BUREAU_REDIS_PREFIX`.
