import type {
  Channel,
  ChannelStats,
  ItemMetrics,
  ItemStatus,
  NormalisedMetrics,
  QueueItem,
} from '../../core/types.js';
import type { GhostConfig } from '../config.js';
import { createAdminToken } from './ghost-token.js';
import { externalId, preview, ProviderError, type Provider } from './types.js';

/** The subset of a Ghost Admin API post Bureau reads. */
export interface GhostPost {
  id: string;
  uuid?: string;
  title: string;
  slug: string;
  url?: string;
  status: 'draft' | 'scheduled' | 'published' | 'sent';
  published_at?: string | null;
  updated_at: string;
  custom_excerpt?: string | null;
  excerpt?: string | null;
  email?: { email_count?: number; opened_count?: number } | null;
  count?: { clicks?: number; signups?: number; paid_conversions?: number };
}

const CHANNEL_ID = 'ghost:site';

type Fetch = typeof fetch;

/**
 * Ghost Admin API client.
 *
 * Scheduling in Ghost is the post's own `status` + `published_at`: a future
 * time with status `scheduled` queues it, status `draft` unqueues it. Edits
 * must echo the post's `updated_at` (Ghost's collision check), so every change
 * reads the post first.
 *
 * Bureau never sends a `newsletter` parameter. Scheduling a draft from here
 * publishes it to the web only; posts already scheduled with a newsletter in
 * Ghost Admin keep their email settings when their time moves.
 */
export class GhostProvider implements Provider {
  readonly id = 'ghost' as const;
  readonly mode = 'live' as const;
  private readonly keyId: string;
  private readonly secret: string;
  private siteTitle: string | undefined;

  constructor(
    private readonly config: GhostConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    const [keyId, secret] = config.adminApiKey.split(':');
    if (!keyId || !secret) {
      throw new Error('GHOST_ADMIN_API_KEY must look like <id>:<secret>');
    }
    this.keyId = keyId;
    this.secret = secret;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.config.url}/ghost/api/admin/${path}`;
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Ghost ${createAdminToken(this.keyId, this.secret)}`,
        'Accept-Version': 'v6.0',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const detail = /"message":"([^"]+)"/.exec(body)?.[1] ?? response.statusText;
      throw new ProviderError('ghost', `${init.method ?? 'GET'} ${path} failed: ${detail}`);
    }
    return (await response.json()) as T;
  }

  async listChannels(): Promise<Channel[]> {
    if (!this.siteTitle) {
      try {
        const { site } = await this.request<{ site: { title: string } }>('site/');
        this.siteTitle = site.title;
      } catch {
        this.siteTitle = new URL(this.config.url).hostname;
      }
    }
    return [
      {
        id: CHANNEL_ID,
        provider: 'ghost',
        platform: 'ghost',
        name: this.siteTitle,
        url: this.config.url,
      },
    ];
  }

  async listItems(since: Date): Promise<QueueItem[]> {
    const fields = 'id,uuid,title,slug,url,status,published_at,updated_at,custom_excerpt';
    const pending = await this.browse(`status:[draft,scheduled]`, fields);
    const published = await this.browse(
      `status:published+published_at:>'${since.toISOString()}'`,
      fields,
    );
    return [...pending, ...published].map((post) => toItem(post));
  }

  private async browse(filter: string, fields: string, include?: string): Promise<GhostPost[]> {
    const posts: GhostPost[] = [];
    for (let page = 1; page <= 20; page++) {
      const query = new URLSearchParams({ filter, fields, limit: '100', page: String(page) });
      if (include) query.set('include', include);
      const result = await this.request<{
        posts: GhostPost[];
        meta?: { pagination?: { pages?: number } };
      }>(`posts/?${query.toString()}`);
      posts.push(...result.posts);
      if (page >= (result.meta?.pagination?.pages ?? 1)) break;
    }
    return posts;
  }

  async setSchedule(itemId: string, at: string | null): Promise<QueueItem> {
    const id = externalId('ghost', itemId);
    const { posts } = await this.request<{ posts: GhostPost[] }>(
      `posts/${id}/?fields=id,status,updated_at`,
    );
    const current = posts[0];
    if (!current) throw new ProviderError('ghost', `post ${id} not found`, 404);
    if (current.status === 'published' || current.status === 'sent') {
      throw new ProviderError('ghost', 'published posts cannot be rescheduled', 409);
    }

    const change =
      at === null
        ? { status: 'draft', updated_at: current.updated_at }
        : { status: 'scheduled', published_at: at, updated_at: current.updated_at };

    const result = await this.request<{ posts: GhostPost[] }>(`posts/${id}/`, {
      method: 'PUT',
      body: JSON.stringify({ posts: [change] }),
    });
    return toItem(result.posts[0]!);
  }

  async fetchMetrics(items: QueueItem[]): Promise<ItemMetrics[]> {
    const published = items.filter(
      (item) => item.provider === 'ghost' && item.status === 'published',
    );
    if (published.length === 0) return [];

    const ids = published.map((item) => externalId('ghost', item.id));
    const metrics = new Map<string, NormalisedMetrics>();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const posts = await this.browse(
        `id:[${chunk.join(',')}]`,
        'id,title,slug,status,updated_at',
        'email,count.clicks,count.signups,count.paid_conversions',
      );
      for (const post of posts) metrics.set(post.id, ghostMetrics(post));
    }

    // Page views come from Ghost 6's web analytics. The endpoint is not part of
    // the documented Admin API, so treat it as optional: no views is better
    // than no analytics.
    const views = await this.fetchViews(published).catch(() => new Map<string, number>());
    for (const [postId, count] of views) {
      const entry = metrics.get(postId) ?? {};
      entry.views = count;
      metrics.set(postId, entry);
    }

    const now = new Date().toISOString();
    return [...metrics].map(([postId, values]) => ({
      itemId: `ghost:${postId}`,
      metrics: values,
      updatedAt: now,
    }));
  }

  private async fetchViews(items: QueueItem[]): Promise<Map<string, number>> {
    const earliest = items
      .map((item) => item.publishedAt)
      .filter((stamp): stamp is string => Boolean(stamp))
      .sort()[0];
    const query = new URLSearchParams({
      date_from: (earliest ?? new Date().toISOString()).slice(0, 10),
      date_to: new Date().toISOString().slice(0, 10),
      limit: '100',
    });
    const result = await this.request<{
      stats?: Array<{ post_id?: string; views?: number }>;
    }>(`stats/top-posts-views/?${query.toString()}`);
    const views = new Map<string, number>();
    for (const row of result.stats ?? []) {
      if (row.post_id && typeof row.views === 'number') views.set(row.post_id, row.views);
    }
    return views;
  }

  async fetchChannelStats(): Promise<ChannelStats[]> {
    const result = await this.request<{ meta?: { pagination?: { total?: number } } }>(
      'members/?limit=1&fields=id',
    );
    const total = result.meta?.pagination?.total;
    if (typeof total !== 'number') return [];
    return [
      {
        channelId: CHANNEL_ID,
        followers: total,
        followersSource: 'api',
        updatedAt: new Date().toISOString(),
      },
    ];
  }
}

function toStatus(status: GhostPost['status']): ItemStatus {
  if (status === 'published' || status === 'sent') return 'published';
  return status;
}

export function toItem(post: GhostPost): QueueItem {
  const status = toStatus(post.status);
  const item: QueueItem = {
    id: `ghost:${post.id}`,
    provider: 'ghost',
    platform: 'ghost',
    channelId: CHANNEL_ID,
    title: post.title || '(untitled)',
    excerpt: preview(post.custom_excerpt ?? post.excerpt ?? ''),
    status,
    links: [],
    slug: post.slug,
    reschedulable: status === 'draft' || status === 'scheduled',
  };
  if (post.url) item.url = post.url;
  if (status === 'scheduled' && post.published_at) item.scheduledAt = post.published_at;
  if (status === 'published' && post.published_at) {
    item.publishedAt = post.published_at;
    item.scheduledAt = post.published_at;
  }
  return item;
}

export function ghostMetrics(post: GhostPost): NormalisedMetrics {
  const metrics: NormalisedMetrics = {};
  if (post.email?.email_count !== undefined) metrics.emailRecipients = post.email.email_count;
  if (post.email?.opened_count !== undefined) metrics.emailOpens = post.email.opened_count;
  if (post.count?.clicks !== undefined) metrics.clicks = post.count.clicks;
  if (post.count?.signups !== undefined) metrics.signups = post.count.signups;
  if (post.count?.paid_conversions !== undefined) metrics.conversions = post.count.paid_conversions;
  return metrics;
}
