import { describe, expect, it } from 'vitest';
import { demoBureau, NOW } from './helpers.js';

const DAY = 86_400_000;

describe('Bureau with demo data', () => {
  it('loads both providers and finds the planted relationships', async () => {
    const bureau = await demoBureau();
    const overview = await bureau.overview();

    expect(overview.providers).toEqual([
      { id: 'ghost', mode: 'mock' },
      { id: 'buffer', mode: 'mock' },
    ]);
    const kinds = overview.stories.flatMap((s) => s.warnings.map((w) => w.kind)).sort();
    expect(kinds).toEqual(['anchor-unscheduled', 'before-anchor']);
    expect(overview.suggestions).toHaveLength(1);
    expect(overview.suggestions[0]!.reason).toMatch(/rate limits/);
  });

  it('moves a story together when cascading, and logs every change', async () => {
    const bureau = await demoBureau();
    const { items, stories } = await bureau.overview();
    const article = items.find((i) => i.title === 'Shipping on a Friday, deliberately')!;
    const story = stories.find((s) => s.anchorId === article.id)!;
    const before = new Map(items.map((i) => [i.id, i.scheduledAt]));

    const target = new Date(Date.parse(article.scheduledAt!) + DAY).toISOString();
    const result = await bureau.reschedule(article.id, target, { cascade: true });

    expect(result.changes).toHaveLength(story.itemIds.length);
    const after = await bureau.overview();
    for (const id of story.itemIds) {
      const moved = after.items.find((i) => i.id === id)!;
      expect(Date.parse(moved.scheduledAt!) - Date.parse(before.get(id)!)).toBe(DAY);
    }
    expect(await bureau.recentChanges()).toHaveLength(story.itemIds.length);
  });

  it('moves only the one item without cascade', async () => {
    const bureau = await demoBureau();
    const { items } = await bureau.overview();
    const article = items.find((i) => i.title === 'Shipping on a Friday, deliberately')!;
    const result = await bureau.reschedule(
      article.id,
      new Date(NOW.getTime() + 3 * DAY).toISOString(),
    );
    expect(result.changes).toHaveLength(1);
  });

  it('adds and removes publishing times', async () => {
    const bureau = await demoBureau();
    const { items } = await bureau.overview();
    const draft = items.find((i) => i.title === 'Every cache is a lie')!;
    expect(draft.scheduledAt).toBeUndefined();

    const at = new Date(NOW.getTime() + 2 * DAY).toISOString();
    await bureau.reschedule(draft.id, at);
    expect((await bureau.item(draft.id)).scheduledAt).toBe(at);

    await bureau.reschedule(draft.id, null);
    const cleared = await bureau.item(draft.id);
    expect(cleared.scheduledAt).toBeUndefined();
    expect(cleared.status).toBe('draft');
  });

  it('refuses past times, bad dates and published items', async () => {
    const bureau = await demoBureau();
    const { items } = await bureau.overview();
    const scheduled = items.find((i) => i.status === 'scheduled')!;
    const published = items.find((i) => i.status === 'published')!;

    await expect(
      bureau.reschedule(scheduled.id, new Date(NOW.getTime() - DAY).toISOString()),
    ).rejects.toThrow(/future/);
    await expect(bureau.reschedule(scheduled.id, 'tomorrow-ish')).rejects.toThrow(/Not a date/);
    await expect(bureau.reschedule(published.id, null)).rejects.toThrow(
      /can no longer be rescheduled/,
    );
  });

  it('keeps a rejected detected link rejected, and lets people link by hand', async () => {
    const bureau = await demoBureau();
    const { stories, suggestions } = await bureau.overview();
    const story = stories.find((s) => s.relationships.length > 1)!;
    const rel = story.relationships[0]!;

    await bureau.unlink(rel.id);
    let overview = await bureau.overview();
    expect(overview.stories.flatMap((s) => s.relationships).some((r) => r.id === rel.id)).toBe(
      false,
    );

    const manual = await bureau.link(rel.itemIds);
    overview = await bureau.overview();
    expect(overview.stories.flatMap((s) => s.relationships).map((r) => r.id)).toContain(manual.id);
    expect(overview.stories.flatMap((s) => s.relationships).map((r) => r.id)).toContain(rel.id);

    await bureau.link(suggestions[0]!.itemIds);
    overview = await bureau.overview();
    expect(overview.suggestions).toEqual([]);

    await bureau.unlink(manual.id);
    await expect(bureau.unlink(manual.id)).rejects.toThrow(/Unknown relationship/);
  });

  it('reports analytics with hand-entered followers winning over the API', async () => {
    const bureau = await demoBureau();
    const report = await bureau.analytics();
    expect(report.summary.totals.posts).toBeGreaterThan(0);
    // Demo Buffer followers arrive as hand-entered values; Ghost members from the API.
    expect(report.stats.find((s) => s.channelId === 'ghost:site')).toMatchObject({
      followersSource: 'api',
    });
    expect(report.stats.filter((s) => s.followersSource === 'manual')).toHaveLength(4);

    await bureau.setFollowers('ghost:site', 2000);
    const updated = await bureau.analytics();
    expect(updated.stats.find((s) => s.channelId === 'ghost:site')).toMatchObject({
      followers: 2000,
      followersSource: 'manual',
    });
    await expect(bureau.setFollowers('ghost:site', -1)).rejects.toThrow(/whole number/);
  });

  it('records snapshots for history', async () => {
    const bureau = await demoBureau();
    await bureau.analytics();
    await bureau.analytics({ refresh: true });
    const history = await bureau.history();
    expect(history).toHaveLength(2);
    expect(history[0]!.views).toBeGreaterThan(0);
    expect(Object.keys(history[0]!.followers)).toContain('ghost:site');
  });
});
