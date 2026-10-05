import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { demoBureau, NOW } from './helpers.js';

async function app() {
  return createApp(await demoBureau());
}

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('HTTP API', () => {
  it('serves the overview', async () => {
    const res = await (await app()).request('/api/overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; channels: unknown[] };
    expect(body.items.length).toBeGreaterThan(10);
    expect(body.channels).toHaveLength(5);
  });

  it('reschedules, and validates input', async () => {
    const server = await app();
    const overview = (await (await server.request('/api/overview')).json()) as {
      items: Array<{ id: string; status: string }>;
    };
    const scheduled = overview.items.find((i) => i.status === 'scheduled')!;
    const path = `/api/items/${encodeURIComponent(scheduled.id)}/schedule`;
    const at = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();

    const ok = await server.request(path, { method: 'PUT', ...json({ scheduledAt: at }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ changes: [{ itemId: scheduled.id, to: at }] });

    const bad = await server.request(path, { method: 'PUT', ...json({ scheduledAt: 5 }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: expect.stringMatching(/ISO date/) });

    const missing = await server.request('/api/items/ghost%3Anope/schedule', {
      method: 'PUT',
      ...json({ scheduledAt: null }),
    });
    expect(missing.status).toBe(404);
  });

  it('creates and removes manual links', async () => {
    const server = await app();
    const overview = (await (await server.request('/api/overview')).json()) as {
      items: Array<{ id: string }>;
    };
    const ids = overview.items.slice(-2).map((i) => i.id);

    const created = await server.request('/api/relationships', {
      method: 'POST',
      ...json({ itemIds: ids }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const removed = await server.request(`/api/relationships/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
  });

  it('serves analytics for a range', async () => {
    const res = await (
      await app()
    ).request(`/api/analytics?from=${encodeURIComponent('2026-02-20T00:00:00Z')}`);
    const body = (await res.json()) as {
      summary: { range: { from: string } };
      platforms: unknown[];
    };
    expect(body.summary.range.from).toBe('2026-02-20T00:00:00Z');
    expect(body.platforms.length).toBeGreaterThan(1);
  });
});
