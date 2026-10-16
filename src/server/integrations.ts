import type { ProviderId } from '../core/types.js';
import { BureauError } from './bureau.js';
import {
  DEFAULT_BUFFER_API_URL,
  type BufferConfig,
  type Config,
  type GhostConfig,
} from './config.js';
import { BufferProvider } from './providers/buffer.js';
import { GhostProvider } from './providers/ghost.js';
import { MockBufferProvider, MockGhostProvider } from './providers/mock.js';
import type { Provider } from './providers/types.js';
import type { Storage, Store } from './store.js';

/**
 * Encrypts the API keys Bureau saves. The desktop app passes one backed by the
 * operating system's keychain; without one, keys are stored as they are, in
 * the same place as the rest of Bureau's state.
 */
export interface SecretBox {
  seal(plain: string): string;
  open(sealed: string): string;
}

/** What Settings saves: one entry per integration connected in the app. */
export interface IntegrationSettings {
  version: 1;
  ghost?: GhostConfig;
  buffer?: BufferConfig;
}

/** Where an integration's configuration comes from, in order of precedence. */
export type IntegrationSource = 'environment' | 'settings' | 'demo';

/** What the Settings page shows. Never includes a key. */
export interface IntegrationStatus {
  /** `BUREAU_MOCK` is set, so both run on demo data whatever is configured. */
  forcedDemo: boolean;
  ghost: { source: IntegrationSource; url?: string; keySet: boolean; error?: string };
  buffer: {
    source: IntegrationSource;
    organizationId?: string;
    apiUrl?: string;
    keySet: boolean;
    error?: string;
  };
}

/** A change from the Settings form. A blank key keeps the saved one. */
export type IntegrationInput =
  | { id: 'ghost'; url?: unknown; adminApiKey?: unknown }
  | { id: 'buffer'; apiKey?: unknown; organizationId?: unknown; apiUrl?: unknown };

const SETTINGS_TTL_MS = 30_000;

function initialSettings(): IntegrationSettings {
  return { version: 1 };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function httpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BureauError(`${field} must be a full URL, like https://example.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BureauError(`${field} must start with https://`);
  }
  return value.replace(/\/+$/, '');
}

/**
 * The Ghost and Buffer connections, wherever they are configured.
 *
 * The environment wins, so a deployment pinned by its variables stays pinned
 * and Settings shows it as such. An integration the environment leaves out
 * uses what was saved in Settings, and falls back to demo data when nothing
 * was. Saved settings live in the same storage as the rest of Bureau's state
 * (`data/settings.json`, Redis, or the desktop app's data folder), so they
 * survive restarts and every server instance sees them.
 */
export class Integrations {
  private readonly store: Store<IntegrationSettings>;
  private readonly mocks: { ghost: Provider; buffer: Provider };
  private cached: { at: number; json: string; providers: Provider[] } | undefined;

  constructor(
    private readonly config: Config,
    storage: Storage,
    private readonly options: { secrets?: SecretBox; fetch?: typeof fetch } = {},
  ) {
    this.store = storage('settings', initialSettings);
    this.mocks = { ghost: new MockGhostProvider(storage), buffer: new MockBufferProvider(storage) };
  }

  /**
   * The providers to use now. Settings are re-read at most every thirty
   * seconds, so a change saved through another server instance is picked up;
   * the same array comes back until something actually changes.
   */
  readonly providers = async (): Promise<Provider[]> => {
    if (this.cached && Date.now() - this.cached.at < SETTINGS_TTL_MS) {
      return this.cached.providers;
    }
    const settings = await this.settings();
    const json = JSON.stringify(settings);
    if (this.cached?.json === json) {
      this.cached.at = Date.now();
      return this.cached.providers;
    }
    const providers = [this.ghost(settings), this.buffer(settings)];
    this.cached = { at: Date.now(), json, providers };
    return providers;
  };

  async status(): Promise<IntegrationStatus> {
    const { unreadable, ...settings } = await this.settings();
    const error = (id: ProviderId) =>
      unreadable.includes(id)
        ? { error: 'The saved key could not be decrypted on this computer. Enter it again.' }
        : {};
    const source = (id: ProviderId): IntegrationSource => {
      if (this.config.forceMock) return 'demo';
      if (this.config[id]) return 'environment';
      return settings[id] ? 'settings' : 'demo';
    };
    const ghost = this.config.ghost ?? settings.ghost;
    const buffer = this.config.buffer ?? settings.buffer;
    return {
      forcedDemo: this.config.forceMock,
      ghost: {
        source: source('ghost'),
        ...(ghost ? { url: ghost.url } : {}),
        keySet: Boolean(ghost?.adminApiKey),
        ...error('ghost'),
      },
      buffer: {
        source: source('buffer'),
        ...(buffer ? { organizationId: buffer.organizationId, apiUrl: buffer.apiUrl } : {}),
        keySet: Boolean(buffer?.apiKey),
        ...error('buffer'),
      },
    };
  }

  /**
   * Checks a connection without saving it, by reading its channels and queue:
   * the queue needs the key to be right, where Ghost's site details do not.
   */
  async test(input: IntegrationInput): Promise<{ channels: number; items: number }> {
    const provider = this.live(await this.resolve(input));
    try {
      const [channels, items] = await Promise.all([
        provider.listChannels(),
        provider.listItems(new Date()),
      ]);
      return { channels: channels.length, items: items.length };
    } catch (error) {
      const name = input.id === 'ghost' ? 'Ghost' : 'Buffer';
      const reason = (error as Error).message.replace(/^(ghost|buffer): /, '');
      throw new BureauError(`Could not connect to ${name}: ${reason}`, 422);
    }
  }

  async save(input: IntegrationInput): Promise<IntegrationStatus> {
    this.assertEditable(input.id);
    const resolved = await this.resolve(input);
    const secrets = this.options.secrets;
    await this.store.update((settings) => {
      if (resolved.id === 'ghost') {
        const { url, adminApiKey } = resolved.config;
        settings.ghost = { url, adminApiKey: secrets ? secrets.seal(adminApiKey) : adminApiKey };
      } else {
        const { apiKey, ...rest } = resolved.config;
        settings.buffer = { ...rest, apiKey: secrets ? secrets.seal(apiKey) : apiKey };
      }
    });
    this.cached = undefined;
    return this.status();
  }

  /** Forgets a saved connection, which puts that integration back on demo data. */
  async clear(id: ProviderId): Promise<IntegrationStatus> {
    this.assertEditable(id);
    await this.store.update((settings) => {
      delete settings[id];
    });
    this.cached = undefined;
    return this.status();
  }

  private assertEditable(id: ProviderId): void {
    if (this.config[id]) {
      throw new BureauError(
        `${id === 'ghost' ? 'Ghost' : 'Buffer'} is configured by environment variables, which take precedence`,
        409,
      );
    }
  }

  /**
   * Saved settings with their keys decrypted. A key that cannot be decrypted
   * (say the data folder was copied from another computer) leaves its
   * integration out, on demo data, and listed as unreadable for Settings to
   * report, rather than taking the whole app down.
   */
  private async settings(): Promise<IntegrationSettings & { unreadable: ProviderId[] }> {
    const stored = await this.store.read();
    const settings: IntegrationSettings & { unreadable: ProviderId[] } = {
      version: 1,
      unreadable: [],
    };
    const open = (id: ProviderId, value: string): string | undefined => {
      if (!this.options.secrets) return value;
      try {
        return this.options.secrets.open(value);
      } catch {
        settings.unreadable.push(id);
        return undefined;
      }
    };
    if (stored.ghost) {
      const adminApiKey = open('ghost', stored.ghost.adminApiKey);
      if (adminApiKey) settings.ghost = { ...stored.ghost, adminApiKey };
    }
    if (stored.buffer) {
      const apiKey = open('buffer', stored.buffer.apiKey);
      if (apiKey) settings.buffer = { ...stored.buffer, apiKey };
    }
    return settings;
  }

  /** Validates a form, filling a blank key from what is saved. */
  private async resolve(
    input: IntegrationInput,
  ): Promise<{ id: 'ghost'; config: GhostConfig } | { id: 'buffer'; config: BufferConfig }> {
    const saved = await this.settings();
    if (input.id === 'ghost') {
      const url = httpUrl(text(input.url), 'The site URL');
      const adminApiKey = text(input.adminApiKey) || saved.ghost?.adminApiKey || '';
      if (!/^[^:\s]+:[^:\s]+$/.test(adminApiKey)) {
        throw new BureauError('The Admin API key must look like <id>:<secret>');
      }
      return { id: 'ghost', config: { url, adminApiKey } };
    }
    const apiKey = text(input.apiKey) || saved.buffer?.apiKey || '';
    const organizationId = text(input.organizationId);
    const apiUrl = httpUrl(text(input.apiUrl) || DEFAULT_BUFFER_API_URL, 'The API URL');
    if (!apiKey) throw new BureauError('Enter a Buffer API key');
    if (!organizationId) throw new BureauError('Enter the Buffer organisation ID');
    return { id: 'buffer', config: { apiUrl, apiKey, organizationId } };
  }

  private live(
    resolved: { id: 'ghost'; config: GhostConfig } | { id: 'buffer'; config: BufferConfig },
  ): Provider {
    try {
      return resolved.id === 'ghost'
        ? new GhostProvider(resolved.config, this.options.fetch)
        : new BufferProvider(resolved.config, this.options.fetch);
    } catch (error) {
      throw new BureauError((error as Error).message);
    }
  }

  private ghost(settings: IntegrationSettings): Provider {
    if (this.config.forceMock) return this.mocks.ghost;
    const config = this.config.ghost ?? settings.ghost;
    return config ? new GhostProvider(config, this.options.fetch) : this.mocks.ghost;
  }

  private buffer(settings: IntegrationSettings): Provider {
    if (this.config.forceMock) return this.mocks.buffer;
    const config = this.config.buffer ?? settings.buffer;
    return config ? new BufferProvider(config, this.options.fetch) : this.mocks.buffer;
  }
}
