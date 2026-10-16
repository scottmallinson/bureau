# AGENTS.md

Guidance for AI coding agents (and a useful summary for humans). Tool-specific
files such as `CLAUDE.md` point here so there is a single source of truth.

## Project overview

Bureau is a web app for managing publishing schedules across Ghost and Buffer:
a drag-and-drop calendar, relationships between items on different platforms,
analytics, and a read-only MCP server for AI analysis, on the web or as a
desktop app. TypeScript on Node 22.9+, React + Vite for the UI, Hono for the
API, Electron for the desktop app. See `README.md` and
`docs/adr/0002-stack-and-architecture.md`.

- Domain logic lives in `src/core/` and is shared by the API, the UI and the
  MCP server; keep it free of Node and browser APIs.
- Services are reached only through the `Provider` interface in
  `src/server/providers/types.ts`. Bureau changes publishing times and nothing
  else: do not add content editing without an ADR.
- Ghost and Buffer are configured in Settings (`src/server/integrations.ts`)
  or by environment variables, which win. The desktop app (`src/desktop/`)
  runs the same server in-process; keep Electron on 43.x while macOS 12 is
  supported (ADR 0005).
- Without credentials the app runs on mock providers
  (`src/server/providers/mock*.ts`) that replay real API payload shapes; keep
  them in step with the live clients.

## Commands

<!-- Keep these accurate; agents rely on them to verify their work. -->

| Task             | Command                |
| ---------------- | ---------------------- |
| Install          | `npm install`          |
| Run (API + UI)   | `npm run dev`          |
| Test             | `npm test`             |
| Typecheck        | `npm run typecheck`    |
| Build            | `npm run build`        |
| MCP server       | `npm run mcp`          |
| Desktop app      | `npm run desktop`      |
| Format           | `npm run format`       |
| Check formatting | `npm run format:check` |
| Lint commits     | `npm run lint:commits` |

## Conventions

- Commits and PR titles follow Conventional Commits (see `CONTRIBUTING.md`).
- Follow `.editorconfig`; run `npm run format` before committing.
- Match the style of surrounding code; don't reformat unrelated files.
- Keep changes small and focused; one logical change per PR.
- Add or update tests and docs with every behavioural change.
- Record significant design decisions in `docs/adr/`.

## Boundaries

- Never commit secrets, credentials, or `.env` files.
- Commits are authored by the human user; never add `Co-Authored-By`,
  `Generated with`, or other AI attribution to commits, PR bodies or comments
  (enforced in `.claude/settings.json`).
- Never bypass hooks (`--no-verify`) or disable checks to get green.
- Never force-push to `main` or rewrite shared history.
- Ask before: adding dependencies, changing CI or release config, deleting
  files you didn't create, or making breaking changes.

## Definition of done

1. Checks above pass locally.
2. Tests and docs updated.
3. PR description explains the _why_, links the issue, and notes risks.
