import type { UpdateState } from '../core/updates.js';

/**
 * The bridge the desktop app's preload script exposes (src/desktop/preload.cts).
 * Absent in a browser, which is how the UI knows to hide desktop-only settings.
 */
export interface DesktopBridge {
  platform: string;
  updates: {
    state(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    install(): Promise<void>;
    onChange(listener: (state: UpdateState) => void): () => void;
  };
}

export const desktop: DesktopBridge | undefined = (
  window as unknown as { bureauDesktop?: DesktopBridge }
).bureauDesktop;
