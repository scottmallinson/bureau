import { resolve } from 'node:path';

export interface GhostConfig {
  /** The site's URL, e.g. https://example.com. */
  url: string;
  /** Admin API key from a custom integration: `<id>:<secret>`. */
  adminApiKey: string;
}

export interface BufferConfig {
  apiUrl: string;
  apiKey: string;
  organizationId: string;
}

export interface Config {
  port: number;
  /** Interface to listen on. Loopback by default: the API has no login. */
  host: string;
  dataDir: string;
  /** Absent means the Ghost provider runs against mock data. */
  ghost?: GhostConfig;
  /** Absent means the Buffer provider runs against mock data. */
  buffer?: BufferConfig;
  /** How far back to load published items, in days. */
  historyDays: number;
}

/**
 * Reads configuration from the environment.
 *
 * Each integration is independent: set Ghost's two variables and leave
 * Buffer's empty, and Bureau talks to your real Ghost site next to a mocked
 * Buffer. `BUREAU_MOCK=1` forces both to mock data regardless.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const forceMock = env.BUREAU_MOCK === '1' || env.BUREAU_MOCK === 'true';

  const config: Config = {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    dataDir: resolve(env.BUREAU_DATA_DIR ?? 'data'),
    historyDays: Number(env.BUREAU_HISTORY_DAYS ?? 90),
  };

  if (!forceMock && env.GHOST_ADMIN_API_URL && env.GHOST_ADMIN_API_KEY) {
    config.ghost = {
      url: env.GHOST_ADMIN_API_URL.replace(/\/+$/, ''),
      adminApiKey: env.GHOST_ADMIN_API_KEY,
    };
  }

  if (!forceMock && env.BUFFER_API_KEY && env.BUFFER_ORGANIZATION_ID) {
    config.buffer = {
      apiUrl: env.BUFFER_API_URL ?? 'https://api.buffer.com',
      apiKey: env.BUFFER_API_KEY,
      organizationId: env.BUFFER_ORGANIZATION_ID,
    };
  }

  return config;
}
