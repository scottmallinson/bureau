import { resolve } from 'node:path';
import { PROVIDERS, type AuthConfig, type ProviderName } from './auth.js';

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
  /** Interface to listen on. Loopback by default, so no login is needed. */
  host: string;
  /** Absent means no login; the server then refuses to listen beyond loopback. */
  auth?: AuthConfig;
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

  const auth = loadAuth(env);
  if (auth) config.auth = auth;

  return config;
}

const MIN_SECRET = 32;

const PROVIDER_ENV: Record<ProviderName, string> = {
  google: 'GOOGLE',
  github: 'GITHUB',
  microsoft: 'MICROSOFT',
  linkedin: 'LINKEDIN',
};

/**
 * Sign-in is on when any provider has a client ID and secret. A half-made
 * setup stops the server rather than quietly leaving it open.
 */
function loadAuth(env: NodeJS.ProcessEnv): AuthConfig | undefined {
  const providers: AuthConfig['providers'] = {};
  for (const name of PROVIDERS) {
    const prefix = PROVIDER_ENV[name];
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (Boolean(clientId) !== Boolean(clientSecret)) {
      throw new Error(`Set both ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET, or neither`);
    }
    if (clientId && clientSecret) {
      providers[name] = { clientId, clientSecret };
      if (name === 'microsoft' && env.MICROSOFT_TENANT_ID) {
        providers[name].tenantId = env.MICROSOFT_TENANT_ID;
      }
    }
  }

  const allowedEmails = (env.BUREAU_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const secret = env.BETTER_AUTH_SECRET ?? '';

  if (Object.keys(providers).length === 0) {
    if (allowedEmails.length) {
      throw new Error('BUREAU_ALLOWED_EMAILS is set but no sign-in provider is configured');
    }
    return undefined;
  }
  if (!allowedEmails.length) {
    throw new Error('Set BUREAU_ALLOWED_EMAILS to the addresses allowed to sign in');
  }
  if (secret.length < MIN_SECRET) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET} characters (try: openssl rand -base64 32)`,
    );
  }
  const sessionDays = Number(env.BUREAU_SESSION_DAYS ?? 7);
  if (!Number.isFinite(sessionDays) || sessionDays <= 0) {
    throw new Error('BUREAU_SESSION_DAYS must be a positive number');
  }

  const auth: AuthConfig = { secret, allowedEmails, providers, sessionDays };
  if (env.BETTER_AUTH_URL) auth.baseURL = env.BETTER_AUTH_URL.replace(/\/+$/, '');
  return auth;
}

/** True when only this machine can reach the server. */
export function isLoopback(host: string): boolean {
  return ['127.0.0.1', '::1', 'localhost'].includes(host);
}
