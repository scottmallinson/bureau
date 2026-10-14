import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/server/config.js';
import { redisStorage } from '../src/server/redis-store.js';
import { createVercelApp } from '../src/server/vercel.js';

/** An in-memory stand-in for Upstash's REST API: GET, SET (with NX and PX), and the lock release. */
function fakeUpstash(token = 'token') {
  const data = new Map<string, string>();
  const commands: string[] = [];
  const fetch = (async (_url: string | URL | Request, init: RequestInit = {}) => {
    if (new Headers(init.headers).get('Authorization') !== `Bearer ${token}`) {
      return Response.json({ error: 'WRONGPASS' }, { status: 401 });
    }
    const [command, ...args] = JSON.parse(String(init.body)) as string[];
    commands.push(command!);
    const reply = (result: unknown) => Response.json({ result });
    switch (command) {
      case 'GET':
        return reply(data.get(args[0]!) ?? null);
      case 'SET': {
        const [key, value, ...flags] = args;
        if (flags.includes('NX') && data.has(key!)) return reply(null);
        data.set(key!, value!);
        return reply('OK');
      }
      case 'EVAL': {
        const [, , key, expected] = args;
        if (data.get(key!) !== expected) return reply(0);
        data.delete(key!);
        return reply(1);
      }
      default:
        return Response.json({ error: `unknown command ${command}` }, { status: 400 });
    }
  }) as typeof globalThis.fetch;
  return { fetch, data, commands };
}

const config = { url: 'https://db.upstash.io/', token: 'token', prefix: 'bureau:' };

describe('Redis store', () => {
  it('starts from the initial state and keeps updates as JSON under the prefix', async () => {
    const upstash = fakeUpstash();
    const store = redisStorage(config, upstash.fetch)('bureau', () => ({ count: 0 }));

    expect(await store.read()).toEqual({ count: 0 });
    expect(await store.update((s) => ++s.count)).toBe(1);
    expect(await store.read()).toEqual({ count: 1 });
    expect(JSON.parse(upstash.data.get('bureau:bureau')!)).toEqual({ count: 1 });
    expect(upstash.data.has('bureau:bureau:lock')).toBe(false);
  });

  it('serialises concurrent updates, and releases the lock when one throws', async () => {
    const upstash = fakeUpstash();
    const storage = redisStorage(config, upstash.fetch);
    const a = storage('n', () => ({ count: 0 }));
    const b = storage('n', () => ({ count: 0 }));

    await expect(
      a.update(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? a : b).update((s) => {
          s.count += 1;
        }),
      ),
    );
    expect(await a.read()).toEqual({ count: 10 });
    expect(upstash.data.has('bureau:n:lock')).toBe(false);
  });

  it('waits for a lock another process holds', async () => {
    vi.useFakeTimers();
    try {
      const upstash = fakeUpstash();
      upstash.data.set('bureau:n:lock', 'someone-else');
      const store = redisStorage(config, upstash.fetch)('n', () => ({ count: 0 }));

      const pending = store.update((s) => ++s.count);
      await vi.advanceTimersByTimeAsync(200);
      expect(upstash.data.has('bureau:n')).toBe(false);

      upstash.data.delete('bureau:n:lock');
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports what the database said when a command fails', async () => {
    const store = redisStorage({ ...config, token: 'wrong' }, fakeUpstash().fetch)('n', () => 0);
    await expect(store.read()).rejects.toThrow(/GET failed: WRONGPASS/);
  });
});

describe('store configuration', () => {
  it('uses the data directory by default', () => {
    expect(loadConfig({ BUREAU_DATA_DIR: '/srv/bureau' }).store).toEqual({
      kind: 'file',
      dataDir: '/srv/bureau',
    });
  });

  it('uses Redis when Vercel or Upstash connected a database', () => {
    expect(loadConfig({ KV_REST_API_URL: 'https://a', KV_REST_API_TOKEN: 't' }).store).toEqual({
      kind: 'redis',
      url: 'https://a',
      token: 't',
      prefix: 'bureau:',
    });
    expect(
      loadConfig({
        UPSTASH_REDIS_REST_URL: 'https://b',
        UPSTASH_REDIS_REST_TOKEN: 't',
        BUREAU_REDIS_PREFIX: 'preview:',
      }).store,
    ).toMatchObject({ kind: 'redis', url: 'https://b', prefix: 'preview:' });
  });

  it('refuses to run on Vercel without a database', () => {
    expect(() => loadConfig({ VERCEL: '1' })).toThrow(/Redis/);
  });
});

describe('Vercel entry point', () => {
  const auth = {
    GITHUB_CLIENT_ID: 'id',
    GITHUB_CLIENT_SECRET: 'secret',
    BUREAU_ALLOWED_EMAILS: 'owner@example.com',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
  };
  const redis = { VERCEL: '1', KV_REST_API_URL: 'https://db', KV_REST_API_TOKEN: 't' };

  it('refuses to serve without a login or a database, and says why only in the logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const open = await createVercelApp(redis).request('/api/overview');
      expect(open.status).toBe(503);
      expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/no sign-in provider/));

      const noStore = await createVercelApp({ ...auth, VERCEL: '1' }).request('/api/health');
      expect(noStore.status).toBe(503);
      expect(await noStore.json()).not.toHaveProperty('error', expect.stringMatching(/Redis/));
      expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/Redis/));
    } finally {
      log.mockRestore();
    }
  });

  it('serves the API behind sign-in once both are configured', async () => {
    const app = createVercelApp({ ...auth, ...redis });
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/api/overview')).status).toBe(401);
  });
});
