import { randomUUID } from 'node:crypto';
import type { Storage, Store } from './store.js';

const LOCK_LEASE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;

// Deletes the lock only if it is still ours, so a write that outlived its
// lease cannot release the next writer's lock.
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

export interface RedisConfig {
  /** The database's REST URL, e.g. https://example.upstash.io. */
  url: string;
  token: string;
  /** Put before every key, so deployments can share one database. */
  prefix: string;
}

/**
 * Just enough of Upstash's REST API to keep Bureau's documents: one HTTPS
 * request per command, which suits serverless functions that cannot hold a
 * connection open between requests.
 */
export class RedisClient {
  constructor(
    private readonly config: Pick<RedisConfig, 'url' | 'token'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async command<R>(args: Array<string | number>): Promise<R> {
    const res = await this.fetchImpl(this.config.url.replace(/\/+$/, ''), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: R; error?: string };
    if (!res.ok || body.error !== undefined) {
      throw new Error(`Redis ${String(args[0])} failed: ${body.error ?? `HTTP ${res.status}`}`);
    }
    return body.result as R;
  }
}

/**
 * A document kept as one JSON string in Redis, for hosts with no writable
 * disk such as Vercel. Same contract as `JsonStore`: reads always go to the
 * database, and every read-modify-write happens under a lock, here a key set
 * with NX that expires on its own if a function dies holding it.
 */
export class RedisStore<T> implements Store<T> {
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: RedisClient,
    private readonly key: string,
    private readonly initial: () => T,
  ) {}

  async read(): Promise<T> {
    const raw = await this.client.command<string | null>(['GET', this.key]);
    return raw === null ? this.initial() : (JSON.parse(raw) as T);
  }

  async update<R>(mutate: (state: T) => R | Promise<R>): Promise<R> {
    let result!: R;

    const next = this.writing.then(async () => {
      const token = await this.lock();
      try {
        const state = await this.read();
        result = await mutate(state);
        await this.client.command(['SET', this.key, JSON.stringify(state)]);
      } finally {
        await this.client.command(['EVAL', RELEASE, 1, this.lockKey, token]);
      }
    });

    this.writing = next.catch(() => undefined);
    await next;
    return result;
  }

  private get lockKey(): string {
    return `${this.key}:lock`;
  }

  private async lock(): Promise<string> {
    const token = randomUUID();
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    for (;;) {
      const set = await this.client.command<string | null>([
        'SET',
        this.lockKey,
        token,
        'NX',
        'PX',
        LOCK_LEASE_MS,
      ]);
      if (set === 'OK') return token;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for the Redis lock ${this.lockKey}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

/** Each document under `<prefix><name>` in one Redis database. */
export function redisStorage(config: RedisConfig, fetchImpl?: typeof fetch): Storage {
  const client = new RedisClient(config, fetchImpl);
  return (name, initial) => new RedisStore(client, `${config.prefix}${name}`, initial);
}
