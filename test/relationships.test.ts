import { describe, expect, it } from 'vitest';
import {
  buildStories,
  detectLinks,
  extractUrls,
  normaliseUrl,
  suggestLinks,
} from '../src/core/relationships.js';
import { item } from './helpers.js';

describe('normaliseUrl', () => {
  it('ignores www, trailing slashes, case and tracking parameters', () => {
    expect(
      normaliseUrl('https://WWW.Example.com/post/?utm_source=linkedin&utm_medium=social'),
    ).toBe('example.com/post');
    expect(normaliseUrl('http://example.com/post')).toBe('example.com/post');
  });

  it('keeps meaningful query parameters', () => {
    expect(normaliseUrl('https://example.com/search?q=ghost&utm_campaign=x')).toBe(
      'example.com/search?q=ghost',
    );
  });

  it('rejects things that are not web URLs', () => {
    expect(normaliseUrl('mailto:me@example.com')).toBeUndefined();
    expect(normaliseUrl('not a url')).toBeUndefined();
  });
});

describe('extractUrls', () => {
  it('trims sentence punctuation from the end of a link', () => {
    expect(extractUrls('Read it: https://example.com/post/. Then tell me.')).toEqual([
      'https://example.com/post/',
    ]);
  });
});

describe('detectLinks', () => {
  const article = item({
    id: 'ghost:1',
    title: 'Silent failures',
    slug: 'silent-failures',
    status: 'scheduled',
    // A scheduled post only has its preview URL until it publishes.
    url: 'https://example.com/p/0000-uuid/',
  });

  it('links a social post to a scheduled article by slug', () => {
    const social = item({
      id: 'buffer:1',
      links: ['https://www.example.com/silent-failures/?utm_source=x'],
    });
    const links = detectLinks([article, social]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ itemIds: ['ghost:1', 'buffer:1'], source: 'auto' });
  });

  it('does not match the same slug on another site', () => {
    const social = item({ id: 'buffer:1', links: ['https://elsewhere.com/silent-failures/'] });
    expect(detectLinks([article, social])).toEqual([]);
  });

  it('groups social posts that share the same outside link', () => {
    const a = item({
      id: 'buffer:1',
      links: ['https://talks.example.org/observability?utm_source=li'],
    });
    const b = item({ id: 'buffer:2', links: ['https://talks.example.org/observability'] });
    expect(detectLinks([a, b])).toMatchObject([{ itemIds: ['buffer:1', 'buffer:2'] }]);
  });
});

describe('suggestLinks', () => {
  const article = item({
    id: 'ghost:1',
    title: 'Notes on rate limits',
    scheduledAt: '2026-03-10T08:00:00Z',
  });

  it('suggests an unlinked post that repeats the title close in time', () => {
    const social = item({
      id: 'buffer:9',
      title: 'Rate limits are a design decision',
      excerpt: 'Rate limits are a design decision, not an afterthought.',
      scheduledAt: '2026-03-10T14:00:00Z',
    });
    const suggestions = suggestLinks([article, social], () => false, new Set());
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.itemIds).toEqual(['ghost:1', 'buffer:9']);
  });

  it('skips pairs already related, dismissed, or far apart in time', () => {
    const social = item({
      id: 'buffer:9',
      excerpt: 'Notes on rate limits',
      scheduledAt: '2026-03-10T14:00:00Z',
    });
    expect(suggestLinks([article, social], () => true, new Set())).toEqual([]);
    expect(suggestLinks([article, social], () => false, new Set(['buffer:9|ghost:1']))).toEqual([]);
    const late = { ...social, scheduledAt: '2026-04-10T14:00:00Z' };
    expect(suggestLinks([article, late], () => false, new Set())).toEqual([]);
  });
});

describe('buildStories', () => {
  it('anchors a story on the Ghost post and merges overlapping links', () => {
    const article = item({ id: 'ghost:1', scheduledAt: '2026-03-03T09:00:00Z' });
    const li = item({ id: 'buffer:1', scheduledAt: '2026-03-03T11:00:00Z' });
    const bs = item({ id: 'buffer:2', scheduledAt: '2026-03-03T12:00:00Z' });
    const stories = buildStories(
      [li, bs, article],
      [
        { id: 'a', itemIds: ['ghost:1', 'buffer:1'], source: 'auto', reason: '' },
        { id: 'b', itemIds: ['buffer:1', 'buffer:2'], source: 'manual', reason: '' },
      ],
    );
    expect(stories).toHaveLength(1);
    expect(stories[0]!.anchorId).toBe('ghost:1');
    expect(stories[0]!.itemIds).toEqual(['ghost:1', 'buffer:1', 'buffer:2']);
    expect(stories[0]!.warnings).toEqual([]);
  });

  it('warns when a social post goes out before its article', () => {
    const article = item({ id: 'ghost:1', title: 'Post', scheduledAt: '2026-03-03T09:00:00Z' });
    const early = item({ id: 'buffer:1', scheduledAt: '2026-03-03T08:00:00Z' });
    const [story] = buildStories(
      [article, early],
      [{ id: 'a', itemIds: ['ghost:1', 'buffer:1'], source: 'auto', reason: '' }],
    );
    expect(story!.warnings).toMatchObject([{ itemId: 'buffer:1', kind: 'before-anchor' }]);
  });

  it('warns when the article has no time but its social posts do', () => {
    const draft = item({ id: 'ghost:1', status: 'draft' });
    const social = item({ id: 'buffer:1', scheduledAt: '2026-03-03T08:00:00Z' });
    const [story] = buildStories(
      [draft, social],
      [{ id: 'a', itemIds: ['ghost:1', 'buffer:1'], source: 'auto', reason: '' }],
    );
    expect(story!.warnings).toMatchObject([{ kind: 'anchor-unscheduled' }]);
  });
});
