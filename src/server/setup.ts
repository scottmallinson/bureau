import { Bureau } from './bureau.js';
import type { Config } from './config.js';
import { BufferProvider } from './providers/buffer.js';
import { GhostProvider } from './providers/ghost.js';
import { MockBufferProvider, MockGhostProvider } from './providers/mock.js';
import type { Provider } from './providers/types.js';
import { redisStorage } from './redis-store.js';
import { fileStorage, type Storage } from './store.js';

export function createStorage(store: Config['store']): Storage {
  return store.kind === 'redis' ? redisStorage(store) : fileStorage(store.dataDir);
}

/** Live providers where credentials exist, mock ones everywhere else. */
export function createBureau(config: Config): Bureau {
  const storage = createStorage(config.store);
  const providers: Provider[] = [
    config.ghost ? new GhostProvider(config.ghost) : new MockGhostProvider(storage),
    config.buffer ? new BufferProvider(config.buffer) : new MockBufferProvider(storage),
  ];
  return new Bureau(providers, storage, { historyDays: config.historyDays });
}
