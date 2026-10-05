# 0002. Stack and architecture for Bureau

- Status: Proposed
- Date: 2026-10-05

## Context

Bureau is a GUI for managing publishing schedules across Ghost and Buffer:
drag-and-drop rescheduling, relationships between items on different
platforms, analytics, and AI analysis of those analytics. The repository
started as a language-agnostic template with no application code.

Two constraints shaped the design. First, three surfaces (the web UI, its HTTP
API and an MCP server) must report identical numbers. Second, the app has to be
usable and testable without live Ghost or Buffer credentials.

## Decision

We will build Bureau in TypeScript on Node 22+, as one package:

- **`src/core/`**: framework-free domain logic (types, relationship detection,
  analytics aggregation) shared by every surface.
- **`src/server/`**: a `Bureau` service over a narrow `Provider` interface
  (list channels and items, set or clear a publishing time, fetch metrics and
  follower counts), exposed as a JSON API with [Hono](https://hono.dev). Bureau's
  own state (manual links, dismissed links, hand-entered follower counts,
  snapshots) is a JSON file with atomic, lock-guarded writes, borrowed from
  fediverse-desk.
- **`src/mcp/`**: a stdio MCP server built with the official SDK, calling the
  same `Bureau` service. Its tools are read-only.
- **`src/web/`**: a React single-page app built with Vite, using
  [dnd-kit](https://dndkit.com) for accessible drag and drop.
- **Mock providers** that replay realistic Ghost and Buffer payloads through
  the same mapping code as the live clients, used whenever credentials are
  absent.

## Consequences

- One service means the dashboard and an AI assistant never disagree about a
  number.
- Editing content is impossible by construction: the provider interface has no
  method for it.
- A JSON file store is right for one person's data and wrong for a team; moving
  to SQLite later means replacing `JsonStore` only.
- Ghost post views use an undocumented Ghost 6 stats endpoint and degrade to no
  views if it is missing. Buffer reports no follower counts, so those are
  entered by hand.
- React, Vite, Hono, dnd-kit, the MCP SDK and zod are new dependencies.
