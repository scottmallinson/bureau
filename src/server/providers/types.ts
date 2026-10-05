import type {
  Channel,
  ChannelStats,
  ItemMetrics,
  ProviderId,
  QueueItem,
} from '../../core/types.js';

/**
 * What Bureau needs from a publishing service. Deliberately narrow: Bureau
 * reads queues and analytics and changes publishing times. Editing content is
 * out of scope, so there is no method for it.
 */
export interface Provider {
  readonly id: ProviderId;
  readonly mode: 'live' | 'mock';

  listChannels(): Promise<Channel[]>;

  /** Unpublished items, plus items published since `since`. */
  listItems(since: Date): Promise<QueueItem[]>;

  /**
   * Sets, moves or clears an item's publishing time. `null` takes the item out
   * of the schedule (back to draft) without deleting it.
   */
  setSchedule(itemId: string, at: string | null): Promise<QueueItem>;

  fetchMetrics(items: QueueItem[]): Promise<ItemMetrics[]>;

  /** Follower counts the service can report. Missing channels are left out. */
  fetchChannelStats(channels: Channel[]): Promise<ChannelStats[]>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
    readonly status = 502,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
  }
}

/** `ghost:abc` → `abc`. Throws on an id from another provider. */
export function externalId(provider: ProviderId, itemId: string): string {
  const prefix = `${provider}:`;
  if (!itemId.startsWith(prefix)) {
    throw new ProviderError(provider, `${itemId} is not a ${provider} item`, 400);
  }
  return itemId.slice(prefix.length);
}

export function firstLine(text: string, max = 80): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  const clean = line.replace(/https?:\/\/\S+/g, '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function preview(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
