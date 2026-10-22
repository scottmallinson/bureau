# 0005. Desktop app with Electron, updates from GitHub Releases, integrations in Settings

- Status: Proposed
- Date: 2026-10-15

## Context

The owner wants Bureau as an installable app for Windows and macOS 12 or
later, next to the hosted web app, that can update itself to the latest
version from inside the app. Every integration (Ghost, Buffer) has to be
configurable through the UI: until now they were set only by environment
variables, which a desktop user has no natural place to put.

Bureau's server is a Node process (Hono over `@hono/node-server`) with the
React UI served from the same origin. Its state is a handful of JSON
documents behind the `Storage` interface.

## Decision

We will wrap Bureau in **Electron**. The main process starts the existing
server in-process on `127.0.0.1` with a random port, serves the built UI from
it and opens a window on that address. The server code is unchanged apart
from being callable as `serveBureau()`, which the Node entry point now uses
too. The window is sandboxed with context isolation; a small preload bridge
exposes only the update controls. Requests whose `Host` is not the loopback
address are refused, so a web page cannot reach the app through DNS
rebinding.

We will pin Electron to **43.x**, the last line that runs on macOS 12:
Electron 44 requires macOS 13.

We will update through **electron-updater** with **GitHub Releases** as the
feed. Each merge to `main` with a releasable Conventional Commit runs
`.github/workflows/desktop.yml`: semantic-release tags the next version and
opens a draft release, electron-builder builds a universal macOS app (dmg,
plus the zip updates install from) and a Windows NSIS installer at that
version and attaches them, with the `latest*.yml` metadata, to the draft, and
the draft is published once both builds succeed. The version comes from the
tags, not `package.json`, so nobody has to bump it by hand (a hand-pushed tag
that did not match `package.json` was what broke the first automated
release). Publishing releases it to installed apps, which check at launch and every six hours, download in the
background and install on quit or on request from Settings.

We will make integrations configurable at run time through an
`Integrations` service and a **Settings** page, on the web and the desktop
alike. Saved settings are a `settings` document in the existing storage. The
environment keeps precedence, so deployments configured by variables stay as
they are. Keys are write-only through the API. The desktop app encrypts them
with Electron's `safeStorage` (Keychain on macOS, DPAPI on Windows) before
they are stored; the server stores them in its own storage as it does the rest
of its state. Bureau reads providers through a source that changes when
settings do, so a save takes effect without a restart.

We considered **Tauri**. It produces much smaller apps and uses the system
web view, which supports older macOS without pinning, but Bureau's server
would have to ship as a separate Node binary run as a sidecar, with a Rust
toolchain in the build. Electron runs the server as it is.

## Consequences

- One codebase serves the web app, the desktop app and the MCP server; the
  desktop app needs no sign-in, `.env` or terminal.
- Installers are large (an Electron app is around 100 MB unpacked).
- Electron 43 stops receiving security fixes when Electron 46 ships. Keeping
  macOS 12 after that means shipping an unpatched Chromium; dropping it is a
  version bump to the current Electron.
- macOS only installs updates into a signed, notarised app, so updates on
  macOS need an Apple Developer ID and the signing secrets in the release
  workflow. Windows updates work unsigned, with a SmartScreen warning on
  first install.
- Ghost and Buffer can now be connected from the hosted app too; their keys
  then live in the deployment's Redis database rather than in Vercel's
  environment.
