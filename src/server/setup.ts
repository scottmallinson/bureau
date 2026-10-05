import { Bureau } from './bureau.js';
import type { Config } from './config.js';
import { BufferProvider } from './providers/buffer.js';
import { GhostProvider } from './providers/ghost.js';
import { MockBufferProvider, MockGhostProvider } from './providers/mock.js';
import type { Provider } from './providers/types.js';

/** Live providers where credentials exist, mock ones everywhere else. */
export function createBureau(config: Config): Bureau {
  const providers: Provider[] = [
    config.ghost ? new GhostProvider(config.ghost) : new MockGhostProvider(config.dataDir),
    config.buffer ? new BufferProvider(config.buffer) : new MockBufferProvider(config.dataDir),
  ];
  return new Bureau(providers, config.dataDir, { historyDays: config.historyDays });
}
