/**
 * Bureau's domain model.
 *
 * Everything the UI, the HTTP API and the MCP server exchange is one of these
 * shapes. Providers (Ghost, Buffer) translate their own payloads into them, so
 * nothing above the provider layer knows which service an item came from beyond
 * the `provider` and `platform` fields.
 */

/** The service Bureau talks to. One provider can publish to many platforms. */
export type ProviderId = 'ghost' | 'buffer';

/** Where an item actually appears to readers. */
export type Platform =
  | 'ghost'
  | 'linkedin'
  | 'twitter'
  | 'mastodon'
  | 'bluesky'
  | 'threads'
  | 'facebook'
  | 'instagram'
  | 'other';

export type ItemStatus = 'draft' | 'scheduled' | 'published' | 'failed';

export interface Channel {
  /** Globally unique: `<provider>:<external id>`. */
  id: string;
  provider: ProviderId;
  platform: Platform;
  name: string;
  /** A link to the channel's public profile or site, when known. */
  url?: string;
}

export interface QueueItem {
  /** Globally unique: `<provider>:<external id>`. */
  id: string;
  provider: ProviderId;
  platform: Platform;
  channelId: string;
  title: string;
  /** A short plain-text preview of the body. */
  excerpt: string;
  status: ItemStatus;
  /** ISO timestamp the item is (or was) due to publish. Absent when unscheduled. */
  scheduledAt?: string;
  /** ISO timestamp the item actually went out. */
  publishedAt?: string;
  /** The item's own public URL once published (or its preview URL). */
  url?: string;
  /**
   * Links the item points at: a social post's shared article, for instance.
   * Relationship detection reads these.
   */
  links: string[];
  /** For Ghost posts: the slug the post will publish at. */
  slug?: string;
  /** Whether Bureau may change this item's publishing time. */
  reschedulable: boolean;
}

/**
 * Metrics normalised across platforms. Every field is optional because no
 * platform reports all of them; an absent field means "not reported", which is
 * different from zero and is kept distinct all the way to the UI.
 */
export interface NormalisedMetrics {
  /** Page views on Ghost; views or impressions on social platforms. */
  views?: number;
  impressions?: number;
  reach?: number;
  reactions?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  saves?: number;
  /** Followers gained from this item. */
  follows?: number;
  emailRecipients?: number;
  emailOpens?: number;
  /** Free member sign-ups attributed to the post (Ghost). */
  signups?: number;
  /** Paid conversions attributed to the post (Ghost). */
  conversions?: number;
}

export type MetricKey = keyof NormalisedMetrics;

export interface ItemMetrics {
  itemId: string;
  metrics: NormalisedMetrics;
  /** When the source last refreshed these numbers. */
  updatedAt?: string;
}

export interface ChannelStats {
  channelId: string;
  /** Followers, subscribers or members, depending on the platform. */
  followers?: number;
  /** Where the follower count came from. */
  followersSource?: 'api' | 'manual';
  updatedAt?: string;
}

/** A link between two or more items on different channels about the same thing. */
export interface Relationship {
  id: string;
  itemIds: string[];
  /** `auto` links were detected; `manual` ones a person made or confirmed. */
  source: 'auto' | 'manual';
  reason: string;
}

/** A possible link Bureau is not sure enough about to apply on its own. */
export interface RelationshipSuggestion {
  id: string;
  itemIds: [string, string];
  reason: string;
  score: number;
}

/** A connected set of related items, usually one article and its social posts. */
export interface Story {
  id: string;
  /** The item the others point at (the Ghost post when there is one). */
  anchorId: string;
  itemIds: string[];
  relationships: Relationship[];
  warnings: StoryWarning[];
}

export interface StoryWarning {
  itemId: string;
  kind: 'before-anchor' | 'anchor-unscheduled';
  message: string;
}

export interface ScheduleChange {
  itemId: string;
  from?: string;
  to?: string;
}

export interface AnalyticsTotals {
  posts: number;
  views: number;
  engagements: number;
  /** Engagements per view, 0..1. Absent when there are no views. */
  engagementRate?: number;
  clicks: number;
  followers: number;
  followsGained: number;
  emailOpens: number;
  signups: number;
}

export interface PlatformAnalytics extends AnalyticsTotals {
  platform: Platform;
  channels: number;
  topItemId?: string;
}

export interface PostAnalytics {
  item: QueueItem;
  metrics: NormalisedMetrics;
  engagements: number;
  engagementRate?: number;
  storyId?: string;
  updatedAt?: string;
}

export interface StoryAnalytics {
  storyId: string;
  anchorId: string;
  title: string;
  items: number;
  platforms: Platform[];
  totals: AnalyticsTotals;
}

export interface AnalyticsSummary {
  range: { from?: string; to?: string };
  totals: AnalyticsTotals;
  generatedAt: string;
}

export interface Snapshot {
  takenAt: string;
  channels: ChannelStats[];
  items: ItemMetrics[];
}
