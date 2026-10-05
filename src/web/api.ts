import type { AnalyticsReport } from '../core/analytics.js';
import type {
  Channel,
  ChannelStats,
  ProviderId,
  QueueItem,
  Relationship,
  RelationshipSuggestion,
  ScheduleChange,
  Story,
} from '../core/types.js';

export interface Overview {
  providers: Array<{ id: ProviderId; mode: 'live' | 'mock'; error?: string }>;
  channels: Channel[];
  items: QueueItem[];
  stories: Story[];
  suggestions: RelationshipSuggestion[];
}

export type Analytics = AnalyticsReport & { channels: Channel[]; stats: ChannelStats[] };

export interface RescheduleResult {
  changes: ScheduleChange[];
  skipped: Array<{ itemId: string; reason: string }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  overview: () => request<Overview>('/overview'),

  schedule: (itemId: string, scheduledAt: string | null, cascade: boolean) =>
    request<RescheduleResult>(`/items/${encodeURIComponent(itemId)}/schedule`, {
      method: 'PUT',
      body: JSON.stringify({ scheduledAt, cascade }),
    }),

  link: (itemIds: string[], reason?: string) =>
    request<Relationship>('/relationships', {
      method: 'POST',
      body: JSON.stringify({ itemIds, reason }),
    }),

  unlink: (relationshipId: string) =>
    request<void>(`/relationships/${encodeURIComponent(relationshipId)}`, { method: 'DELETE' }),

  setFollowers: (channelId: string, followers: number | null) =>
    request<void>(`/channels/${encodeURIComponent(channelId)}/followers`, {
      method: 'PUT',
      body: JSON.stringify({ followers }),
    }),

  analytics: (range: { from?: string; refresh?: boolean }) => {
    const query = new URLSearchParams();
    if (range.from) query.set('from', range.from);
    if (range.refresh) query.set('refresh', '1');
    const qs = query.toString();
    return request<Analytics>(`/analytics${qs ? `?${qs}` : ''}`);
  },
};
