import { describe, expect, it } from 'vitest';
import { bufferMetrics, BufferProvider } from '../src/server/providers/buffer.js';
import { GhostProvider } from '../src/server/providers/ghost.js';
import { fetchMastodonFollowers, mastodonProfile } from '../src/server/providers/mastodon.js';
import { fakeFetch } from './helpers.js';

const ghostConfig = {
  url: 'https://example.com',
  adminApiKey: 'abc123:00112233445566778899aabbccddeeff',
};
const bufferConfig = { apiUrl: 'https://api.buffer.test', apiKey: 'key', organizationId: 'org1' };

describe('GhostProvider', () => {
  it('maps drafts, scheduled and published posts to queue items', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      const filter = new URL(url).searchParams.get('filter') ?? '';
      if (filter.startsWith('status:[draft')) {
        return {
          posts: [
            {
              id: 'd1',
              title: 'Draft',
              slug: 'draft',
              status: 'draft',
              updated_at: 'x',
              published_at: null,
            },
            {
              id: 's1',
              title: 'Soon',
              slug: 'soon',
              status: 'scheduled',
              url: 'https://example.com/p/uuid/',
              updated_at: 'x',
              published_at: '2026-03-03T09:00:00.000Z',
            },
          ],
          meta: { pagination: { pages: 1 } },
        };
      }
      return {
        posts: [
          {
            id: 'p1',
            title: 'Live',
            slug: 'live',
            status: 'published',
            url: 'https://example.com/live/',
            updated_at: 'x',
            published_at: '2026-02-01T09:00:00.000Z',
          },
        ],
        meta: { pagination: { pages: 1 } },
      };
    });
    const provider = new GhostProvider(ghostConfig, fetch);
    const items = await provider.listItems(new Date('2026-01-01'));

    expect(items.map((i) => [i.id, i.status, i.scheduledAt ?? null, i.reschedulable])).toEqual([
      ['ghost:d1', 'draft', null, true],
      ['ghost:s1', 'scheduled', '2026-03-03T09:00:00.000Z', true],
      ['ghost:p1', 'published', '2026-02-01T09:00:00.000Z', false],
    ]);
    expect(calls[0]!.url).toContain('/ghost/api/admin/posts/');
    expect(String((calls[0]!.init.headers as Record<string, string>).Authorization)).toMatch(
      /^Ghost .+\..+\..+$/,
    );
  });

  it('reschedules by echoing updated_at, and unschedules back to draft', async () => {
    const { fetch, calls } = fakeFetch((url, init) => {
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { posts: Array<Record<string, unknown>> };
        return {
          posts: [{ id: 's1', title: 'Soon', slug: 'soon', updated_at: 'y', ...body.posts[0] }],
        };
      }
      return { posts: [{ id: 's1', status: 'scheduled', updated_at: '2026-02-01T00:00:00.000Z' }] };
    });
    const provider = new GhostProvider(ghostConfig, fetch);

    const moved = await provider.setSchedule('ghost:s1', '2026-03-04T09:00:00.000Z');
    expect(calls[1]!.body).toEqual({
      posts: [
        {
          status: 'scheduled',
          published_at: '2026-03-04T09:00:00.000Z',
          updated_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    expect(moved.scheduledAt).toBe('2026-03-04T09:00:00.000Z');

    const cleared = await provider.setSchedule('ghost:s1', null);
    expect(calls[3]!.body).toEqual({
      posts: [{ status: 'draft', updated_at: '2026-02-01T00:00:00.000Z' }],
    });
    expect(cleared.status).toBe('draft');
  });

  it('refuses to reschedule a published post', async () => {
    const { fetch } = fakeFetch(() => ({
      posts: [{ id: 'p1', status: 'published', updated_at: 'x' }],
    }));
    await expect(
      new GhostProvider(ghostConfig, fetch).setSchedule('ghost:p1', null),
    ).rejects.toThrow(/cannot be rescheduled/);
  });

  it('reports members as followers', async () => {
    const { fetch } = fakeFetch(() => ({ members: [], meta: { pagination: { total: 1234 } } }));
    const stats = await new GhostProvider(ghostConfig, fetch).fetchChannelStats();
    expect(stats).toMatchObject([
      { channelId: 'ghost:site', followers: 1234, followersSource: 'api' },
    ]);
  });

  it('rejects a malformed admin key early', () => {
    expect(() => new GhostProvider({ url: 'https://example.com', adminApiKey: 'nope' })).toThrow(
      /id>:<secret/,
    );
  });
});

describe('BufferProvider', () => {
  const node = {
    id: 'b1',
    channelId: 'c1',
    channelService: 'linkedin',
    status: 'scheduled',
    text: 'New post\nhttps://example.com/live/',
    dueAt: '2026-03-03T11:00:00.000Z',
    allowedActions: ['updatePostSchedule'],
    metadata: { linkAttachment: { url: 'https://example.com/live/?utm_source=li' } },
  };

  it('maps channels and posts, collecting links from text and attachments', async () => {
    const { fetch, calls } = fakeFetch((_, init) => {
      const { query } = JSON.parse(String(init.body)) as { query: string };
      if (query.includes('channels(')) {
        return {
          data: { channels: [{ id: 'c1', name: 'me', displayName: 'Me', service: 'linkedin' }] },
        };
      }
      return { data: { posts: { edges: [{ node }], pageInfo: { hasNextPage: false } } } };
    });
    const provider = new BufferProvider(bufferConfig, fetch);

    expect(await provider.listChannels()).toEqual([
      { id: 'buffer:c1', provider: 'buffer', platform: 'linkedin', name: 'Me' },
    ]);
    const [item] = await provider.listItems(new Date('2026-01-01'));
    expect(item).toMatchObject({
      id: 'buffer:b1',
      channelId: 'buffer:c1',
      platform: 'linkedin',
      title: 'New post',
      status: 'scheduled',
      scheduledAt: '2026-03-03T11:00:00.000Z',
      reschedulable: true,
    });
    expect(item!.links).toEqual([
      'https://example.com/live/',
      'https://example.com/live/?utm_source=li',
    ]);
    expect(calls[1]!.body).toMatchObject({ variables: { input: { organizationId: 'org1' } } });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer key');
  });

  it('reschedules with a custom time and unschedules to drafts', async () => {
    const { fetch, calls } = fakeFetch(() => ({ data: { editPost: { post: node } } }));
    const provider = new BufferProvider(bufferConfig, fetch);
    await provider.setSchedule('buffer:b1', '2026-03-05T10:00:00.000Z');
    await provider.setSchedule('buffer:b1', null);
    expect(calls.map((c) => (c.body as { variables: unknown }).variables)).toEqual([
      { input: { id: 'b1', dueAt: '2026-03-05T10:00:00.000Z', mode: 'customScheduled' } },
      { input: { id: 'b1', saveToDraft: true } },
    ]);
  });

  it('surfaces mutation errors from the payload union', async () => {
    const { fetch } = fakeFetch(() => ({ data: { editPost: { message: 'Post already sent' } } }));
    await expect(
      new BufferProvider(bufferConfig, fetch).setSchedule('buffer:b1', null),
    ).rejects.toThrow(/Post already sent/);
  });

  it('surfaces GraphQL errors', async () => {
    const { fetch } = fakeFetch(() => ({ errors: [{ message: 'Unauthorized' }] }));
    await expect(new BufferProvider(bufferConfig, fetch).listChannels()).rejects.toThrow(
      /Unauthorized/,
    );
  });
});

describe('bufferMetrics', () => {
  it('normalises metric types and never double-counts likes', () => {
    expect(
      bufferMetrics([
        { type: 'impressions', value: 100 },
        { type: 'reactions', value: 7 },
        { type: 'likes', value: 7 },
        { type: 'reposts', value: 2 },
        { type: 'quotes', value: 1 },
        { type: 'engagementRate', value: 0.5 },
      ]),
    ).toEqual({ impressions: 100, reactions: 7, shares: 3 });
    expect(bufferMetrics([{ type: 'likes', value: 4 }])).toEqual({ reactions: 4 });
  });
});

describe('Mastodon follower counts', () => {
  it('reads the account from the instance named in the profile link', () => {
    expect(mastodonProfile('https://mastodon.test/@scott')).toEqual({
      origin: 'https://mastodon.test',
      acct: 'scott',
    });
    expect(mastodonProfile('https://mastodon.test/@scott@other.example/')).toEqual({
      origin: 'https://mastodon.test',
      acct: 'scott@other.example',
    });
    expect(mastodonProfile('https://www.linkedin.com/in/scott')).toBeUndefined();
    expect(mastodonProfile('http://mastodon.test/@scott')).toBeUndefined();
    expect(mastodonProfile('not a link')).toBeUndefined();
  });

  it('reads followers for Mastodon channels only, leaving out any that fail', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.endsWith('acct=gone')) throw new Error('ECONNREFUSED');
      return { id: '1', username: 'scott', followers_count: 381 };
    });
    const provider = new BufferProvider(bufferConfig, fetch);
    const stats = await provider.fetchChannelStats([
      {
        id: 'buffer:ma',
        provider: 'buffer',
        platform: 'mastodon',
        name: 'Scott',
        url: 'https://mastodon.test/@scott',
      },
      {
        id: 'buffer:li',
        provider: 'buffer',
        platform: 'linkedin',
        name: 'Scott',
        url: 'https://www.linkedin.com/in/scott',
      },
      {
        id: 'buffer:gone',
        provider: 'buffer',
        platform: 'mastodon',
        name: 'Gone',
        url: 'https://mastodon.test/@gone',
      },
    ]);

    expect(stats).toEqual([{ channelId: 'buffer:ma', followers: 381, followersSource: 'api' }]);
    expect(calls.map((call) => call.url)).toEqual([
      'https://mastodon.test/api/v1/accounts/lookup?acct=scott',
      'https://mastodon.test/api/v1/accounts/lookup?acct=gone',
    ]);
  });

  it('leaves out an instance that answers without a count', async () => {
    const { fetch } = fakeFetch(() => new Response('{"error":"Not found"}', { status: 404 }));
    const stats = await fetchMastodonFollowers(
      {
        id: 'buffer:ma',
        provider: 'buffer',
        platform: 'mastodon',
        name: 'Scott',
        url: 'https://mastodon.test/@scott',
      },
      fetch,
    );
    expect(stats).toBeUndefined();
  });
});
