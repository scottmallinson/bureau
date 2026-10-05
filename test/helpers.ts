import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { QueueItem } from '../src/core/types.js';
import { Bureau } from '../src/server/bureau.js';
import { MockBufferProvider, MockGhostProvider } from '../src/server/providers/mock.js';

/** A Monday morning, so the demo week has scheduled items ahead of it. */
export const NOW = new Date('2026-03-02T07:00:00.000Z');

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bureau-test-'));
  dirs.push(dir);
  return dir;
}

export async function demoBureau(): Promise<Bureau> {
  const dir = await tempDir();
  const now = () => NOW;
  return new Bureau([new MockGhostProvider(dir, now), new MockBufferProvider(dir, now)], dir, {
    now,
    historyDays: 365,
  });
}

export function item(overrides: Partial<QueueItem> & Pick<QueueItem, 'id'>): QueueItem {
  const provider = overrides.id.startsWith('ghost:') ? 'ghost' : 'buffer';
  return {
    provider,
    platform: provider === 'ghost' ? 'ghost' : 'linkedin',
    channelId: provider === 'ghost' ? 'ghost:site' : 'buffer:li',
    title: 'Untitled',
    excerpt: '',
    status: 'scheduled',
    links: [],
    reschedulable: true,
    ...overrides,
  };
}

/** A fetch stub that records requests and answers from a handler. */
export function fakeFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; init: RequestInit; body?: unknown }> = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });
    const result = handler(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}
