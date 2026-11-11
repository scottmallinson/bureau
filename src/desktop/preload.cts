// Runs in the window before the UI, with access to nothing but this bridge.
// The UI checks for `window.bureauDesktop` to show the desktop-only settings.
import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateState } from '../core/updates.js';

// Kept in step with UPDATE_CHANNELS in updates.ts. A sandboxed preload can
// only require 'electron', so it cannot import the constant.
const channels = {
  state: 'bureau:updates:state',
  check: 'bureau:updates:check',
  install: 'bureau:updates:install',
  changed: 'bureau:updates:changed',
  openDispatch: 'bureau:dispatch:open',
  dispatchInstalled: 'bureau:dispatch:installed',
};

contextBridge.exposeInMainWorld('bureauDesktop', {
  platform: process.platform,
  updates: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke(channels.state),
    check: (): Promise<UpdateState> => ipcRenderer.invoke(channels.check),
    install: (): Promise<void> => ipcRenderer.invoke(channels.install),
    onChange: (listener: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: unknown, state: UpdateState) => listener(state);
      ipcRenderer.on(channels.changed, handler);
      return () => ipcRenderer.removeListener(channels.changed, handler);
    },
  },
  openDispatch: (link: string): Promise<void> => ipcRenderer.invoke(channels.openDispatch, link),
  dispatchInstalled: (): Promise<boolean> => ipcRenderer.invoke(channels.dispatchInstalled),
});
