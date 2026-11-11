# 0006. Open Dispatch from the schedule with a dispatch link

- Status: Proposed
- Date: 2026-11-11

## Context

Bureau decides when a post goes out, and Dispatch (a sibling desktop app)
writes posts and publishes them through Buffer. When someone sees a free slot
on the schedule, they want to start a post for that slot without retyping the
time.

Bureau runs in a browser and in its desktop app. A browser cannot tell whether
a custom-scheme link has a handler: the page gets no answer when the app is
missing, and a click on a link to an app that is not installed usually does
nothing visible. The desktop window also refuses to navigate away from Bureau's
own origin, so it cannot hand a link to another app by itself.

## Decision

We will give Dispatch a custom URL scheme, `dispatch://compose?at=<ISO 8601>`,
which opens its composer with the publish time filled in.

- Clicking an empty calendar cell opens a small menu for that hour. Its action
  is a `dispatch://` link. Past cells have no menu, as Buffer would refuse them.
- The menu always says where to get Dispatch when nothing opens. We do not try
  to detect whether Dispatch is installed, because a browser cannot do that
  reliably.
- In the desktop app the link is opened through the main process, which
  accepts only compose links (`isDispatchComposeLink` in `src/core/dispatch.ts`).
- Dispatch keeps the time until its composer takes it, so a link that arrives
  while the app is still starting is not lost.

## Consequences

- Bureau gains no dependency and no network call; the link is built in the
  browser from the cell's time.
- Bureau has no way to know whether Dispatch received the time. The menu's hint
  covers the case where nothing opens.
- Dispatch must register the scheme in its installers and take a single running
  instance, so that links from the browser reach the app that is already open.
- The cell menu is reached by mouse. Keyboard users cannot open it yet.
