import { buildAnalytics, engagementsOf, viewsOf, type AnalyticsReport } from '../core/analytics.js';
import { buildStories, detectLinks, pairKey, suggestLinks } from '../core/relationships.js';
import type {
  Channel,
  ChannelStats,
  ItemMetrics,
  ProviderId,
  QueueItem,
  Relationship,
  RelationshipSuggestion,
  ScheduleChange,
  Snapshot,
  Story,
} from '../core/types.js';
import { MockBufferProvider } from './providers/mock.js';
import { ProviderError, type Provider } from './providers/types.js';
import { JsonStore } from './store.js';

export interface BureauState {
  version: 1;
  /** Links people made or confirmed. */
  manual: Relationship[];
  /** Pair keys of detected links or suggestions people rejected. */
  dismissed: string[];
  /** Hand-entered follower counts, by channel id. */
  followers: Record<string, { value: number; updatedAt: string }>;
  snapshots: Snapshot[];
  changes: Array<ScheduleChange & { at: string }>;
  demoFollowersSeeded?: boolean;
}

function initialState(): BureauState {
  return { version: 1, manual: [], dismissed: [], followers: {}, snapshots: [], changes: [] };
}

export interface Overview {
  providers: Array<{ id: ProviderId; mode: 'live' | 'mock'; error?: string }>;
  channels: Channel[];
  items: QueueItem[];
  stories: Story[];
  suggestions: RelationshipSuggestion[];
}

export interface RescheduleResult {
  changes: ScheduleChange[];
  skipped: Array<{ itemId: string; reason: string }>;
}

export class BureauError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'BureauError';
  }
}

const ITEMS_TTL_MS = 30_000;
const METRICS_TTL_MS = 5 * 60_000;
const SNAPSHOT_EVERY_MS = 60 * 60_000;
const MAX_SNAPSHOTS = 500;
const MAX_CHANGES = 200;
const MIN_LEAD_MS = 60_000;

/**
 * The application service: one place that combines the providers with
 * Bureau's own state (manual links, follower counts, snapshots). The HTTP API
 * and the MCP server are both thin layers over this.
 */
export class Bureau {
  private readonly store: JsonStore<BureauState>;
  private itemsCache: { at: number; value: Omit<Overview, 'stories' | 'suggestions'> } | undefined;
  private metricsCache: { at: number; metrics: ItemMetrics[]; stats: ChannelStats[] } | undefined;

  constructor(
    private readonly providers: Provider[],
    dataDir: string,
    private readonly options: { historyDays?: number; now?: () => Date } = {},
  ) {
    this.store = JsonStore.in(dataDir, 'bureau.json', initialState);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private provider(id: ProviderId): Provider {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new BureauError(`No ${id} provider configured`, 404);
    return provider;
  }

  invalidate(): void {
    this.itemsCache = undefined;
  }

  private async load(): Promise<Omit<Overview, 'stories' | 'suggestions'>> {
    if (this.itemsCache && Date.now() - this.itemsCache.at < ITEMS_TTL_MS) {
      return this.itemsCache.value;
    }
    const since = new Date(this.now().getTime() - (this.options.historyDays ?? 90) * 86_400_000);
    const results = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          const [channels, items] = await Promise.all([
            provider.listChannels(),
            provider.listItems(since),
          ]);
          return { provider, channels, items };
        } catch (error) {
          return { provider, channels: [], items: [], error: (error as Error).message };
        }
      }),
    );
    const value = {
      providers: results.map(({ provider, error }) => ({
        id: provider.id,
        mode: provider.mode,
        ...(error ? { error } : {}),
      })),
      channels: results.flatMap((r) => r.channels),
      items: results
        .flatMap((r) => r.items)
        .sort((a, b) => (a.scheduledAt ?? '9999').localeCompare(b.scheduledAt ?? '9999')),
    };
    this.itemsCache = { at: Date.now(), value };
    return value;
  }

  private relationshipsFor(items: QueueItem[], state: BureauState): Relationship[] {
    const dismissed = new Set(state.dismissed);
    const auto = detectLinks(items).filter(
      (rel) => !dismissed.has(pairKey(rel.itemIds[0]!, rel.itemIds[1]!)),
    );
    return [...auto, ...state.manual];
  }

  async overview(): Promise<Overview> {
    const [base, state] = await Promise.all([this.load(), this.store.read()]);
    const relationships = this.relationshipsFor(base.items, state);
    const stories = buildStories(base.items, relationships);
    const storyOf = new Map<string, string>();
    for (const story of stories) for (const id of story.itemIds) storyOf.set(id, story.id);
    const suggestions = suggestLinks(
      base.items,
      (a, b) => storyOf.get(a) !== undefined && storyOf.get(a) === storyOf.get(b),
      new Set(state.dismissed),
    );
    return { ...base, stories, suggestions };
  }

  async item(itemId: string): Promise<QueueItem> {
    const { items } = await this.load();
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new BureauError(`Unknown item ${itemId}`, 404);
    return item;
  }

  /**
   * Sets, moves or clears an item's publishing time. With `cascade`, the other
   * scheduled items in the same story move by the same amount, so a LinkedIn
   * post that went out two hours after its article still does.
   */
  async reschedule(
    itemId: string,
    at: string | null,
    options: { cascade?: boolean } = {},
  ): Promise<RescheduleResult> {
    const overview = await this.overview();
    const item = overview.items.find((i) => i.id === itemId);
    if (!item) throw new BureauError(`Unknown item ${itemId}`, 404);
    if (!item.reschedulable)
      throw new BureauError(`${item.title} can no longer be rescheduled`, 409);

    let target: string | null = null;
    if (at !== null) {
      const parsed = Date.parse(at);
      if (Number.isNaN(parsed)) throw new BureauError(`Not a date: ${at}`);
      if (parsed < this.now().getTime() + MIN_LEAD_MS) {
        throw new BureauError('Publishing times must be at least a minute in the future');
      }
      target = new Date(parsed).toISOString();
    }

    const result: RescheduleResult = { changes: [], skipped: [] };
    const apply = async (subject: QueueItem, to: string | null) => {
      const updated = await this.provider(subject.provider).setSchedule(subject.id, to);
      const change: ScheduleChange = { itemId: subject.id };
      if (subject.scheduledAt) change.from = subject.scheduledAt;
      if (updated.scheduledAt) change.to = updated.scheduledAt;
      result.changes.push(change);
    };

    try {
      await apply(item, target);

      if (options.cascade && target !== null && item.scheduledAt) {
        const delta = Date.parse(target) - Date.parse(item.scheduledAt);
        const story = overview.stories.find((s) => s.itemIds.includes(item.id));
        for (const id of story?.itemIds ?? []) {
          if (id === item.id || delta === 0) continue;
          const other = overview.items.find((i) => i.id === id);
          if (!other) continue;
          if (other.status !== 'scheduled' || !other.scheduledAt || !other.reschedulable) {
            result.skipped.push({ itemId: id, reason: 'not scheduled' });
            continue;
          }
          const moved = Date.parse(other.scheduledAt) + delta;
          if (moved < this.now().getTime() + MIN_LEAD_MS) {
            result.skipped.push({ itemId: id, reason: 'would move into the past' });
            continue;
          }
          try {
            await apply(other, new Date(moved).toISOString());
          } catch (error) {
            result.skipped.push({ itemId: id, reason: (error as Error).message });
          }
        }
      }
    } finally {
      this.invalidate();
      if (result.changes.length) {
        const stamp = this.now().toISOString();
        await this.store.update((state) => {
          state.changes.push(...result.changes.map((c) => ({ ...c, at: stamp })));
          state.changes = state.changes.slice(-MAX_CHANGES);
        });
      }
    }

    return result;
  }

  async link(itemIds: string[], reason = 'Linked by hand'): Promise<Relationship> {
    const unique = [...new Set(itemIds)];
    if (unique.length < 2) throw new BureauError('A link needs at least two items');
    const { items } = await this.load();
    for (const id of unique) {
      if (!items.some((i) => i.id === id)) throw new BureauError(`Unknown item ${id}`, 404);
    }
    const relationship: Relationship = {
      id: `manual:${crypto.randomUUID()}`,
      itemIds: unique,
      source: 'manual',
      reason,
    };
    await this.store.update((state) => {
      const pairs = new Set<string>();
      for (const a of unique) for (const b of unique) if (a !== b) pairs.add(pairKey(a, b));
      state.dismissed = state.dismissed.filter((key) => !pairs.has(key));
      state.manual.push(relationship);
    });
    return relationship;
  }

  /** Removes a manual link, or rejects a detected one so it stays gone. */
  async unlink(relationshipId: string): Promise<void> {
    if (relationshipId.startsWith('manual:')) {
      const removed = await this.store.update((state) => {
        const before = state.manual.length;
        state.manual = state.manual.filter((rel) => rel.id !== relationshipId);
        return before !== state.manual.length;
      });
      if (!removed) throw new BureauError(`Unknown relationship ${relationshipId}`, 404);
      return;
    }
    const match = /^(?:auto|suggest):(.+)\|(.+)$/.exec(relationshipId);
    if (!match) throw new BureauError(`Unknown relationship ${relationshipId}`, 404);
    const key = pairKey(match[1]!, match[2]!);
    await this.store.update((state) => {
      if (!state.dismissed.includes(key)) state.dismissed.push(key);
    });
  }

  async setFollowers(channelId: string, value: number | null): Promise<void> {
    const { channels } = await this.load();
    if (!channels.some((c) => c.id === channelId))
      throw new BureauError(`Unknown channel ${channelId}`, 404);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new BureauError('Followers must be a whole number, zero or more');
    }
    await this.store.update((state) => {
      if (value === null) delete state.followers[channelId];
      else state.followers[channelId] = { value, updatedAt: this.now().toISOString() };
    });
    if (this.metricsCache) this.metricsCache.at = 0;
  }

  async channelStats(): Promise<ChannelStats[]> {
    const { stats } = await this.metrics(false);
    return stats;
  }

  private async metrics(
    refresh: boolean,
  ): Promise<{ metrics: ItemMetrics[]; stats: ChannelStats[] }> {
    const { items, channels } = await this.load();
    await this.seedDemoFollowers();
    const state = await this.store.read();

    if (refresh || !this.metricsCache || Date.now() - this.metricsCache.at > METRICS_TTL_MS) {
      const fetched = await Promise.all(
        this.providers.map(async (provider) => {
          const own = channels.filter((c) => c.provider === provider.id);
          const [metrics, stats] = await Promise.all([
            provider.fetchMetrics(items.filter((i) => i.provider === provider.id)).catch(() => []),
            provider.fetchChannelStats(own).catch(() => []),
          ]);
          return { metrics, stats };
        }),
      );
      this.metricsCache = {
        at: Date.now(),
        metrics: fetched.flatMap((f) => f.metrics),
        stats: fetched.flatMap((f) => f.stats),
      };
    }

    // Hand-entered counts win: someone typed them on purpose.
    const apiStats = new Map(this.metricsCache.stats.map((s) => [s.channelId, s]));
    const stats: ChannelStats[] = channels.map((channel) => {
      const manual = state.followers[channel.id];
      if (manual) {
        return {
          channelId: channel.id,
          followers: manual.value,
          followersSource: 'manual',
          updatedAt: manual.updatedAt,
        };
      }
      return apiStats.get(channel.id) ?? { channelId: channel.id };
    });

    const last = state.snapshots.at(-1);
    if (refresh || !last || Date.now() - Date.parse(last.takenAt) > SNAPSHOT_EVERY_MS) {
      const snapshot: Snapshot = {
        takenAt: this.now().toISOString(),
        channels: stats,
        items: this.metricsCache.metrics,
      };
      await this.store.update((s) => {
        s.snapshots.push(snapshot);
        s.snapshots = s.snapshots.slice(-MAX_SNAPSHOTS);
      });
    }

    return { metrics: this.metricsCache.metrics, stats };
  }

  private async seedDemoFollowers(): Promise<void> {
    const mock = this.providers.find(
      (p): p is MockBufferProvider => p instanceof MockBufferProvider,
    );
    if (!mock) return;
    const state = await this.store.read();
    if (state.demoFollowersSeeded) return;
    const demo = await mock.demoFollowers();
    await this.store.update((s) => {
      for (const [channelId, value] of Object.entries(demo)) {
        s.followers[channelId] ??= { value, updatedAt: this.now().toISOString() };
      }
      s.demoFollowersSeeded = true;
    });
  }

  async analytics(
    options: { from?: string; to?: string; refresh?: boolean } = {},
  ): Promise<AnalyticsReport & { channels: Channel[]; stats: ChannelStats[] }> {
    const overview = await this.overview();
    const { metrics, stats } = await this.metrics(options.refresh ?? false);
    const input: Parameters<typeof buildAnalytics>[0] = {
      items: overview.items,
      metrics,
      channels: overview.channels,
      stats,
      stories: overview.stories,
    };
    if (options.from) input.from = options.from;
    if (options.to) input.to = options.to;
    return { ...buildAnalytics(input), channels: overview.channels, stats };
  }

  /** Follower and reach history from stored snapshots, oldest first. */
  async history(): Promise<
    Array<{
      takenAt: string;
      followers: Record<string, number>;
      views: number;
      engagements: number;
    }>
  > {
    const state = await this.store.read();
    return state.snapshots.map((snapshot) => ({
      takenAt: snapshot.takenAt,
      followers: Object.fromEntries(
        snapshot.channels
          .filter((c) => c.followers !== undefined)
          .map((c) => [c.channelId, c.followers!]),
      ),
      views: snapshot.items.reduce((sum, i) => sum + viewsOf(i.metrics), 0),
      engagements: snapshot.items.reduce((sum, i) => sum + engagementsOf(i.metrics), 0),
    }));
  }

  async recentChanges(): Promise<BureauState['changes']> {
    return (await this.store.read()).changes.slice().reverse();
  }
}

export function errorStatus(error: unknown): number {
  if (error instanceof BureauError) return error.status;
  if (error instanceof ProviderError) return error.status;
  return 500;
}
