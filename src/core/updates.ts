/** What the desktop app tells its window about updates; shared by the app and the UI. */
export type UpdateState =
  | { status: 'idle'; version: string }
  /** Run from source rather than installed, where there is nothing to update. */
  | { status: 'unsupported'; version: string; reason: string }
  | { status: 'checking'; version: string }
  | { status: 'current'; version: string; checkedAt: string }
  | { status: 'downloading'; version: string; next: string; percent: number }
  /** Downloaded: installs on quit, or now on request. */
  | { status: 'ready'; version: string; next: string }
  | { status: 'error'; version: string; message: string };
