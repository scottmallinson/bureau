import type { Channel, ChannelStats, ItemMetrics, QueueItem } from '../../core/types.js';
import { JsonStore } from '../store.js';
import { bufferMetrics, toChannel, toItem as bufferItem } from './buffer.js';
import { ghostMetrics, toItem as ghostItem } from './ghost.js';
import {
  DEMO_SITE,
  seedBuffer,
  seedGhost,
  type MockBufferState,
  type MockGhostState,
} from './mock-data.js';
import { externalId, ProviderError, type Provider } from './types.js';

/**
 * Stand-ins for Ghost and Buffer when no credentials are configured.
 *
 * State lives in the data directory rather than memory so a reschedule made
 * in the web UI is what the MCP server (a separate process) sees too. Delete
 * `mock-ghost.json` / `mock-buffer.json` to reseed relative to today.
 */
export class MockGhostProvider implements Provider {
  readonly id = 'ghost' as const;
  readonly mode = 'mock' as const;
  private readonly store: JsonStore<MockGhostState>;

  constructor(dataDir: string, now: () => Date = () => new Date()) {
    this.store = JsonStore.in(dataDir, 'mock-ghost.json', () => seedGhost(now()));
  }

  private async state(): Promise<MockGhostState> {
    // Persist the seed on first read so its times stay put across restarts.
    return this.store.update((state) => state);
  }

  async listChannels(): Promise<Channel[]> {
    const state = await this.state();
    return [
      {
        id: 'ghost:site',
        provider: 'ghost',
        platform: 'ghost',
        name: state.siteTitle,
        url: DEMO_SITE,
      },
    ];
  }

  async listItems(since: Date): Promise<QueueItem[]> {
    const state = await this.state();
    return state.posts
      .filter(
        (post) =>
          post.status !== 'published' || Date.parse(post.published_at ?? '') > since.getTime(),
      )
      .map((post) => ghostItem(post));
  }

  async setSchedule(itemId: string, at: string | null): Promise<QueueItem> {
    const id = externalId('ghost', itemId);
    return this.store.update((state) => {
      const post = state.posts.find((p) => p.id === id);
      if (!post) throw new ProviderError('ghost', `post ${id} not found`, 404);
      if (post.status === 'published' || post.status === 'sent') {
        throw new ProviderError('ghost', 'published posts cannot be rescheduled', 409);
      }
      if (at === null) {
        post.status = 'draft';
        post.published_at = null;
      } else {
        post.status = 'scheduled';
        post.published_at = at;
      }
      post.updated_at = new Date().toISOString();
      return ghostItem(post);
    });
  }

  async fetchMetrics(items: QueueItem[]): Promise<ItemMetrics[]> {
    const state = await this.state();
    const wanted = new Set(items.map((item) => item.id));
    return state.posts
      .filter((post) => post.status === 'published' && wanted.has(`ghost:${post.id}`))
      .map((post) => {
        const metrics = ghostMetrics(post);
        const views = state.views[post.id];
        if (views !== undefined) metrics.views = views;
        return { itemId: `ghost:${post.id}`, metrics, updatedAt: state.seededAt };
      });
  }

  async fetchChannelStats(): Promise<ChannelStats[]> {
    const state = await this.state();
    return [
      {
        channelId: 'ghost:site',
        followers: state.members,
        followersSource: 'api',
        updatedAt: state.seededAt,
      },
    ];
  }
}

export class MockBufferProvider implements Provider {
  readonly id = 'buffer' as const;
  readonly mode = 'mock' as const;
  private readonly store: JsonStore<MockBufferState>;

  constructor(dataDir: string, now: () => Date = () => new Date()) {
    this.store = JsonStore.in(dataDir, 'mock-buffer.json', () => seedBuffer(now()));
  }

  private async state(): Promise<MockBufferState> {
    return this.store.update((state) => state);
  }

  async listChannels(): Promise<Channel[]> {
    return (await this.state()).channels.map(toChannel);
  }

  async listItems(since: Date): Promise<QueueItem[]> {
    const state = await this.state();
    return state.posts
      .filter((post) => post.status !== 'sent' || Date.parse(post.dueAt ?? '') > since.getTime())
      .map(bufferItem);
  }

  async setSchedule(itemId: string, at: string | null): Promise<QueueItem> {
    const id = externalId('buffer', itemId);
    return this.store.update((state) => {
      const post = state.posts.find((p) => p.id === id);
      if (!post) throw new ProviderError('buffer', `post ${id} not found`, 404);
      if (!post.allowedActions.includes('updatePostSchedule')) {
        throw new ProviderError('buffer', 'this post can no longer be rescheduled', 409);
      }
      if (at === null) {
        post.status = 'draft';
        post.dueAt = null;
      } else {
        post.status = 'scheduled';
        post.dueAt = at;
      }
      return bufferItem(post);
    });
  }

  async fetchMetrics(items: QueueItem[]): Promise<ItemMetrics[]> {
    const state = await this.state();
    const wanted = new Set(items.map((item) => item.id));
    return state.posts
      .filter((post) => post.status === 'sent' && wanted.has(`buffer:${post.id}`))
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
    // Live Buffer reports no followers, so the mock does not either. Its demo
    // counts are offered to Bureau as hand-entered values instead.
    return [];
  }

  async demoFollowers(): Promise<Record<string, number>> {
    const state = await this.state();
    return Object.fromEntries(
      Object.entries(state.followers).map(([id, n]) => [`buffer:${id}`, n]),
    );
  }
}
