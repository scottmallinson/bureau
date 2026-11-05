import { Bureau } from './bureau.js';
import type { Config } from './config.js';
import { Integrations, type SecretBox } from './integrations.js';
import { redisStorage } from './redis-store.js';
import { fileStorage, type Storage } from './store.js';

export function createStorage(store: Config['store']): Storage {
  return store.kind === 'redis' ? redisStorage(store) : fileStorage(store.dataDir);
}

export interface Services {
  bureau: Bureau;
  integrations: Integrations;
}

/**
 * Bureau over live providers where credentials exist, from the environment or
 * from Settings, and mock ones everywhere else.
 */
export function createServices(
  config: Config,
  options: { secrets?: SecretBox; fetch?: typeof fetch } = {},
): Services {
  const storage = createStorage(config.store);
  const integrations = new Integrations(config, storage, options);
  const bureau = new Bureau(integrations.providers, storage, { historyDays: config.historyDays });
  return { bureau, integrations };
}

export function createBureau(config: Config): Bureau {
  return createServices(config).bureau;
}
