import { describe, expect, it } from 'vitest';
import { buildAnalytics, engagementsOf, viewsOf } from '../src/core/analytics.js';
import type { Channel } from '../src/core/types.js';
import { item } from './helpers.js';

const channels: Channel[] = [
  { id: 'ghost:site', provider: 'ghost', platform: 'ghost', name: 'Blog' },
  { id: 'buffer:li', provider: 'buffer', platform: 'linkedin', name: 'LinkedIn' },
  { id: 'buffer:bs', provider: 'buffer', platform: 'bluesky', name: 'Bluesky' },
];

const article = item({
  id: 'ghost:1',
  title: 'Article',
  status: 'published',
  publishedAt: '2026-02-20T08:00:00Z',
});
const share = item({ id: 'buffer:1', status: 'published', publishedAt: '2026-02-20T10:00:00Z' });
const old = item({
  id: 'buffer:2',
  channelId: 'buffer:bs',
  platform: 'bluesky',
  status: 'published',
  publishedAt: '2026-01-01T10:00:00Z',
});
const queued = item({ id: 'buffer:3', scheduledAt: '2026-03-05T10:00:00Z' });

const input = {
  items: [article, share, old, queued],
  channels,
  metrics: [
    { itemId: 'ghost:1', metrics: { views: 1000, clicks: 40, emailOpens: 600, signups: 3 } },
    {
      itemId: 'buffer:1',
      metrics: { impressions: 4000, reactions: 80, comments: 10, shares: 10, follows: 5 },
    },
    { itemId: 'buffer:2', metrics: { views: 500, reactions: 5 } },
  ],
  stats: [
    { channelId: 'ghost:site', followers: 1200 },
    { channelId: 'buffer:li', followers: 3000 },
  ],
  stories: [
    {
      id: 'story:ghost:1',
      anchorId: 'ghost:1',
      itemIds: ['ghost:1', 'buffer:1'],
      relationships: [],
      warnings: [],
    },
  ],
};

describe('metric helpers', () => {
  it('prefers views, falls back to impressions', () => {
    expect(viewsOf({ views: 10, impressions: 99 })).toBe(10);
    expect(viewsOf({ impressions: 99 })).toBe(99);
    expect(viewsOf({})).toBe(0);
  });

  it('counts interactions but not passive metrics as engagements', () => {
    expect(
      engagementsOf({
        reactions: 1,
        comments: 2,
        shares: 3,
        saves: 4,
        clicks: 5,
        views: 100,
        follows: 9,
      }),
    ).toBe(15);
  });
});

describe('buildAnalytics', () => {
  it('summarises published items only, with followers across every channel', () => {
    const { summary } = buildAnalytics(input);
    expect(summary.totals).toMatchObject({
      posts: 3,
      views: 5500,
      engagements: 145,
      followers: 4200,
      followsGained: 5,
      emailOpens: 600,
      signups: 3,
    });
    expect(summary.totals.engagementRate).toBeCloseTo(145 / 5500, 4);
  });

  it('filters by publish date but keeps followers current', () => {
    const { summary } = buildAnalytics({ ...input, from: '2026-02-01T00:00:00Z' });
    expect(summary.totals.posts).toBe(2);
    expect(summary.totals.views).toBe(5000);
    expect(summary.totals.followers).toBe(4200);
  });

  it('breaks totals down by platform, including channels with no posts', () => {
    const { platforms } = buildAnalytics({ ...input, from: '2026-02-01T00:00:00Z' });
    const byPlatform = Object.fromEntries(platforms.map((p) => [p.platform, p]));
    expect(byPlatform.linkedin).toMatchObject({
      posts: 1,
      views: 4000,
      followers: 3000,
      topItemId: 'buffer:1',
    });
    expect(byPlatform.ghost).toMatchObject({ posts: 1, views: 1000, engagements: 40 });
    expect(byPlatform.bluesky).toMatchObject({ posts: 0, views: 0, channels: 1 });
    expect(byPlatform.bluesky!.engagementRate).toBeUndefined();
  });

  it('totals stories across platforms and tags posts with their story', () => {
    const { stories, posts } = buildAnalytics(input);
    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({ title: 'Article', platforms: ['linkedin', 'ghost'] });
    expect(stories[0]!.totals.views).toBe(5000);
    expect(posts.find((p) => p.item.id === 'buffer:1')!.storyId).toBe('story:ghost:1');
    expect(posts.map((p) => p.item.id)).toEqual(['buffer:1', 'ghost:1', 'buffer:2']);
  });
});
