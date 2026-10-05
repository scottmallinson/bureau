import { platformFromBufferService } from '../../core/platforms.js';
import { extractUrls } from '../../core/relationships.js';
import type {
  Channel,
  ChannelStats,
  ItemMetrics,
  ItemStatus,
  NormalisedMetrics,
  QueueItem,
} from '../../core/types.js';
import type { BufferConfig } from '../config.js';
import { externalId, firstLine, preview, ProviderError, type Provider } from './types.js';

/** The subset of Buffer's GraphQL `Post` Bureau reads. */
export interface BufferPost {
  id: string;
  channelId: string;
  channelService: string;
  status: 'draft' | 'needs_approval' | 'scheduled' | 'sending' | 'sent' | 'error';
  text: string;
  dueAt?: string | null;
  sentAt?: string | null;
  externalLink?: string | null;
  allowedActions: string[];
  metadata?: { linkAttachment?: { url?: string | null } | null } | null;
  metrics?: Array<{ type: string; value: number }> | null;
  metricsUpdatedAt?: string | null;
}

export interface BufferChannel {
  id: string;
  name: string;
  displayName?: string | null;
  service: string;
  externalLink?: string | null;
  isDisconnected?: boolean;
}

const POST_FIELDS = `
  id channelId channelService status text dueAt sentAt externalLink allowedActions
  metadata {
    ... on LinkedInPostMetadata { linkAttachment { url } }
    ... on FacebookPostMetadata { linkAttachment { url } }
    ... on ThreadsPostMetadata { linkAttachment { url } }
    ... on BlueskyPostMetadata { linkAttachment { url } }
    ... on SubstackPostMetadata { linkAttachment { url } }
  }
`;

type Fetch = typeof fetch;

/**
 * Buffer GraphQL API client (https://api.buffer.com).
 *
 * Rescheduling is `editPost` with a `dueAt` and `customScheduled` mode;
 * clearing a time moves the post back to drafts with `saveToDraft`, which is
 * the API's equivalent of the "remove scheduled time" action in Buffer's UI.
 *
 * Buffer's API does not report follower counts, so Buffer channels get theirs
 * from values entered by hand in Bureau.
 */
export class BufferProvider implements Provider {
  readonly id = 'buffer' as const;
  readonly mode = 'live' as const;

  constructor(
    private readonly config: BufferConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(this.config.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new ProviderError(
        'buffer',
        `API request failed: ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) {
      throw new ProviderError('buffer', body.errors.map((e) => e.message).join('; '));
    }
    if (!body.data) throw new ProviderError('buffer', 'empty response');
    return body.data;
  }

  async listChannels(): Promise<Channel[]> {
    const data = await this.graphql<{ channels: BufferChannel[] }>(
      `query Channels($input: ChannelsInput!) {
        channels(input: $input) { id name displayName service externalLink isDisconnected }
      }`,
      { input: { organizationId: this.config.organizationId } },
    );
    return data.channels.map(toChannel);
  }

  async listItems(since: Date): Promise<QueueItem[]> {
    const pending = await this.posts(
      { status: ['draft', 'needs_approval', 'scheduled', 'error'] },
      false,
    );
    const sent = await this.posts(
      { status: ['sent'], dueAt: { start: since.toISOString() } },
      false,
    );
    return [...pending, ...sent].map(toItem);
  }

  private async posts(
    filter: Record<string, unknown>,
    withMetrics: boolean,
  ): Promise<BufferPost[]> {
    const fields = withMetrics
      ? `${POST_FIELDS} metrics { type value } metricsUpdatedAt`
      : POST_FIELDS;
    const query = `query Posts($input: PostsInput!, $first: Int, $after: String) {
      posts(input: $input, first: $first, after: $after) {
        edges { node { ${fields} } }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    const posts: BufferPost[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const data: {
        posts: {
          edges: Array<{ node: BufferPost }> | null;
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        };
      } = await this.graphql(query, {
        input: {
          organizationId: this.config.organizationId,
          filter,
          sort: [{ field: 'dueAt', direction: 'asc' }],
        },
        first: 100,
        after,
      });
      posts.push(...(data.posts.edges ?? []).map((edge) => edge.node));
      if (!data.posts.pageInfo.hasNextPage || !data.posts.pageInfo.endCursor) break;
      after = data.posts.pageInfo.endCursor;
    }
    return posts;
  }

  async setSchedule(itemId: string, at: string | null): Promise<QueueItem> {
    const id = externalId('buffer', itemId);
    const input =
      at === null ? { id, saveToDraft: true } : { id, dueAt: at, mode: 'customScheduled' };
    const data = await this.graphql<{
      editPost: { post?: BufferPost; message?: string };
    }>(
      `mutation Reschedule($input: EditPostInput!) {
        editPost(input: $input) {
          ... on PostActionSuccess { post { ${POST_FIELDS} } }
          ... on MutationError { message }
        }
      }`,
      { input },
    );
    if (!data.editPost.post) {
      throw new ProviderError('buffer', data.editPost.message ?? 'editPost failed', 422);
    }
    return toItem(data.editPost.post);
  }

  async fetchMetrics(items: QueueItem[]): Promise<ItemMetrics[]> {
    const sent = items.filter((item) => item.provider === 'buffer' && item.status === 'published');
    if (sent.length === 0) return [];
    const earliest = sent
      .map((item) => item.publishedAt ?? item.scheduledAt)
      .filter((s): s is string => Boolean(s))
      .sort()[0];
    const wanted = new Set(sent.map((item) => externalId('buffer', item.id)));
    const filter: Record<string, unknown> = { status: ['sent'] };
    if (earliest) filter.dueAt = { start: earliest };
    const posts = await this.posts(filter, true);
    return posts
      .filter((post) => wanted.has(post.id))
      .map((post) => {
        const entry: ItemMetrics = {
          itemId: `buffer:${post.id}`,
          metrics: bufferMetrics(post.metrics ?? []),
        };
        if (post.metricsUpdatedAt) entry.updatedAt = post.metricsUpdatedAt;
        return entry;
      });
  }

  async fetchChannelStats(): Promise<ChannelStats[]> {
    return [];
  }
}

export function toChannel(channel: BufferChannel): Channel {
  const result: Channel = {
    id: `buffer:${channel.id}`,
    provider: 'buffer',
    platform: platformFromBufferService(channel.service),
    name: channel.displayName || channel.name,
  };
  if (channel.externalLink) result.url = channel.externalLink;
  return result;
}

function toStatus(status: BufferPost['status']): ItemStatus {
  switch (status) {
    case 'sent':
    case 'sending':
      return 'published';
    case 'scheduled':
      return 'scheduled';
    case 'error':
      return 'failed';
    default:
      return 'draft';
  }
}

export function toItem(post: BufferPost): QueueItem {
  const status = toStatus(post.status);
  const links = new Set(extractUrls(post.text));
  const attachment = post.metadata?.linkAttachment?.url;
  if (attachment) links.add(attachment);

  const item: QueueItem = {
    id: `buffer:${post.id}`,
    provider: 'buffer',
    platform: platformFromBufferService(post.channelService),
    channelId: `buffer:${post.channelId}`,
    title: firstLine(post.text) || '(no text)',
    excerpt: preview(post.text),
    status,
    links: [...links],
    reschedulable:
      (status === 'scheduled' || status === 'draft' || status === 'failed') &&
      (post.allowedActions.length === 0 || post.allowedActions.includes('updatePostSchedule')),
  };
  if (post.dueAt && status !== 'draft') item.scheduledAt = post.dueAt;
  if (status === 'published') item.publishedAt = post.sentAt ?? post.dueAt ?? undefined;
  if (item.publishedAt === undefined) delete item.publishedAt;
  if (post.externalLink) item.url = post.externalLink;
  return item;
}

const METRIC_MAP: Record<string, keyof NormalisedMetrics> = {
  views: 'views',
  impressions: 'impressions',
  reach: 'reach',
  reactions: 'reactions',
  comments: 'comments',
  shares: 'shares',
  reposts: 'shares',
  quotes: 'shares',
  clicks: 'clicks',
  saves: 'saves',
  follows: 'follows',
};

export function bufferMetrics(metrics: Array<{ type: string; value: number }>): NormalisedMetrics {
  const result: NormalisedMetrics = {};
  for (const { type, value } of metrics) {
    const key = METRIC_MAP[type];
    if (!key) continue;
    result[key] = (result[key] ?? 0) + value;
  }
  // Some networks report likes and no normalised reactions; never both, or
  // the same taps would be counted twice.
  const likes = metrics.find((m) => m.type === 'likes');
  if (result.reactions === undefined && likes) result.reactions = likes.value;
  return result;
}
