/** The IPC channels between the window and the app. preload.cts repeats them. */
export const UPDATE_CHANNELS = {
  state: 'bureau:updates:state',
  check: 'bureau:updates:check',
  install: 'bureau:updates:install',
  changed: 'bureau:updates:changed',
} as const;
