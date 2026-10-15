import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { Bureau } from '../src/server/bureau.js';
import { loadConfig } from '../src/server/config.js';
import { Integrations, type SecretBox } from '../src/server/integrations.js';
import { fileStorage } from '../src/server/store.js';
import { fakeFetch, NOW, tempDir } from './helpers.js';

const GHOST_KEY = 'abc123:00112233445566778899aabbccddeeff';

/** A Ghost Admin API with one scheduled post, answering only the right key. */
function ghostApi() {
  return fakeFetch((url, init) => {
    const auth = new Headers(init.headers).get('Authorization') ?? '';
    if (!auth.startsWith('Ghost ')) return new Response('{}', { status: 401 });
    if (url.includes('/site/')) return { site: { title: 'Real site' } };
    const filter = new URL(url).searchParams.get('filter') ?? '';
    const posts = filter.startsWith('status:[draft')
      ? [
          {
            id: 's1',
            title: 'Soon',
            slug: 'soon',
            status: 'scheduled',
            updated_at: 'x',
            published_at: '2026-03-03T09:00:00.000Z',
          },
        ]
      : [];
    return { posts, meta: { pagination: { pages: 1 } } };
  });
}

/** Reversible, and visibly not plain text, like the desktop app's keychain box. */
const box: SecretBox = {
  seal: (plain) => `sealed:${Buffer.from(plain).toString('base64')}`,
  open: (sealed) => {
    if (!sealed.startsWith('sealed:')) throw new Error('not sealed here');
    return Buffer.from(sealed.slice(7), 'base64').toString();
  },
};

async function setup(env: NodeJS.ProcessEnv = {}, options: { secrets?: SecretBox } = {}) {
  const dataDir = await tempDir();
  const config = loadConfig({ ...env, BUREAU_DATA_DIR: dataDir });
  const storage = fileStorage(dataDir);
  const api = ghostApi();
  const integrations = new Integrations(config, storage, { ...options, fetch: api.fetch });
  const bureau = new Bureau(integrations.providers, storage, { now: () => NOW });
  const app = createApp(bureau, null, integrations);
  return { dataDir, integrations, bureau, app, api };
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('Integrations', () => {
  it('starts on demo data with nothing configured', async () => {
    const { integrations, bureau } = await setup();
    expect(await integrations.status()).toEqual({
      forcedDemo: false,
      ghost: { source: 'demo', keySet: false },
      buffer: { source: 'demo', keySet: false },
    });
    const overview = await bureau.overview();
    expect(overview.providers.map((p) => p.mode)).toEqual(['mock', 'mock']);
  });

  it('switches Bureau to the live provider once saved, and back when cleared', async () => {
    const { integrations, bureau } = await setup();
    expect((await bureau.overview()).items.some((i) => i.id === 'ghost:s1')).toBe(false);

    await integrations.save({ id: 'ghost', url: 'https://example.com/', adminApiKey: GHOST_KEY });
    const live = await bureau.overview();
    expect(live.providers[0]).toEqual({ id: 'ghost', mode: 'live' });
    expect(live.items.filter((i) => i.provider === 'ghost').map((i) => i.id)).toEqual(['ghost:s1']);

    expect(await integrations.clear('ghost')).toMatchObject({ ghost: { source: 'demo' } });
    expect((await bureau.overview()).providers[0]).toEqual({ id: 'ghost', mode: 'mock' });
  });

  it('returns the same providers until something changes', async () => {
    const { integrations } = await setup();
    const first = await integrations.providers();
    expect(await integrations.providers()).toBe(first);
    await integrations.save({ id: 'buffer', apiKey: 'key', organizationId: 'org' });
    expect(await integrations.providers()).not.toBe(first);
  });

  it('keeps the saved key when the form leaves it blank', async () => {
    const { integrations, dataDir } = await setup();
    await integrations.save({ id: 'ghost', url: 'https://example.com', adminApiKey: GHOST_KEY });
    await integrations.save({ id: 'ghost', url: 'https://new.example.com', adminApiKey: '' });
    const saved = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'));
    expect(saved.ghost).toEqual({ url: 'https://new.example.com', adminApiKey: GHOST_KEY });
  });

  it('validates what it saves', async () => {
    const { integrations } = await setup();
    await expect(
      integrations.save({ id: 'ghost', url: 'example.com', adminApiKey: GHOST_KEY }),
    ).rejects.toThrow(/full URL/);
    await expect(
      integrations.save({ id: 'ghost', url: 'https://example.com', adminApiKey: 'nocolon' }),
    ).rejects.toThrow(/<id>:<secret>/);
    await expect(integrations.save({ id: 'buffer', apiKey: 'key' })).rejects.toThrow(
      /organisation/,
    );
  });

  it('lets the environment win, and refuses to overwrite it', async () => {
    const { integrations } = await setup({
      GHOST_ADMIN_API_URL: 'https://env.example.com',
      GHOST_ADMIN_API_KEY: GHOST_KEY,
    });
    expect((await integrations.status()).ghost).toEqual({
      source: 'environment',
      url: 'https://env.example.com',
      keySet: true,
    });
    await expect(
      integrations.save({ id: 'ghost', url: 'https://example.com', adminApiKey: GHOST_KEY }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps everything on demo data under BUREAU_MOCK', async () => {
    const { integrations, bureau } = await setup({ BUREAU_MOCK: '1' });
    await integrations.save({ id: 'ghost', url: 'https://example.com', adminApiKey: GHOST_KEY });
    expect(await integrations.status()).toMatchObject({
      forcedDemo: true,
      ghost: { source: 'demo' },
    });
    expect((await bureau.overview()).providers[0]!.mode).toBe('mock');
  });

  it('seals keys at rest when given a secret box', async () => {
    const { integrations, dataDir } = await setup({}, { secrets: box });
    await integrations.save({ id: 'buffer', apiKey: 'buffer-key', organizationId: 'org' });
    const raw = await readFile(join(dataDir, 'settings.json'), 'utf8');
    expect(raw).not.toContain('buffer-key');
    expect((await integrations.status()).buffer).toMatchObject({
      source: 'settings',
      keySet: true,
    });
  });

  it('falls back to demo data when a saved key cannot be decrypted', async () => {
    const plain = await setup();
    await plain.integrations.save({
      id: 'ghost',
      url: 'https://example.com',
      adminApiKey: GHOST_KEY,
    });
    const storage = fileStorage(plain.dataDir);
    const config = loadConfig({ BUREAU_DATA_DIR: plain.dataDir });
    const integrations = new Integrations(config, storage, { secrets: box });

    expect((await integrations.status()).ghost).toMatchObject({
      source: 'demo',
      keySet: false,
      error: expect.stringMatching(/Enter it again/),
    });
    expect((await integrations.providers())[0]!.mode).toBe('mock');
  });

  it('tests a connection without saving it', async () => {
    const { integrations } = await setup();
    expect(
      await integrations.test({ id: 'ghost', url: 'https://example.com', adminApiKey: GHOST_KEY }),
    ).toEqual({ channels: 1, items: 1 });
    expect((await integrations.status()).ghost.source).toBe('demo');
  });
});

describe('Settings API', () => {
  it('saves, reports without the key, tests and clears', async () => {
    const { app } = await setup();

    const saved = await app.request(
      '/api/settings/integrations/ghost',
      json('PUT', { url: 'https://example.com', adminApiKey: GHOST_KEY }),
    );
    expect(saved.status).toBe(200);

    const status = await app.request('/api/settings/integrations');
    const text = await status.text();
    expect(text).not.toContain(GHOST_KEY.split(':')[1]);
    expect(JSON.parse(text)).toMatchObject({
      ghost: { source: 'settings', url: 'https://example.com', keySet: true },
    });

    const tested = await app.request(
      '/api/settings/integrations/ghost/test',
      json('POST', { url: 'https://example.com' }),
    );
    expect(await tested.json()).toEqual({ channels: 1, items: 1 });

    const cleared = await app.request('/api/settings/integrations/ghost', { method: 'DELETE' });
    expect(await cleared.json()).toMatchObject({ ghost: { source: 'demo' } });
  });

  it('rejects unknown integrations and bad input', async () => {
    const { app } = await setup();
    const unknown = await app.request('/api/settings/integrations/mastodon', json('PUT', {}));
    expect(unknown.status).toBe(404);
    const bad = await app.request(
      '/api/settings/integrations/buffer',
      json('PUT', { apiKey: 'key' }),
    );
    expect(bad.status).toBe(400);
  });

  it('is not served without integrations', async () => {
    const { bureau } = await setup();
    const res = await createApp(bureau, null).request('/api/settings/integrations');
    expect(res.status).toBe(404);
  });
});

describe('Testing a connection', () => {
  it('says which service failed and why', async () => {
    const { integrations } = await setup();
    await expect(
      integrations.test({ id: 'buffer', apiKey: 'key', organizationId: 'org' }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/^Could not connect to Buffer: /),
    });
  });
});
