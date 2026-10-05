import type {
  AnalyticsSummary,
  AnalyticsTotals,
  Channel,
  ChannelStats,
  ItemMetrics,
  NormalisedMetrics,
  Platform,
  PlatformAnalytics,
  PostAnalytics,
  QueueItem,
  Story,
  StoryAnalytics,
} from './types.js';

/**
 * Analytics aggregation. Pure functions over items, metrics and channel stats,
 * so the HTTP API and the MCP server compute identical numbers.
 *
 * "Views" is deliberately one column across platforms: page views for Ghost,
 * views (or impressions where a network reports no views) for social posts. It
 * answers "how many times was this seen", which is the question a summary
 * asks; per-platform detail keeps the raw metrics alongside.
 */

export interface AnalyticsInput {
  items: QueueItem[];
  metrics: ItemMetrics[];
  channels: Channel[];
  stats: ChannelStats[];
  stories?: Story[];
  from?: string;
  to?: string;
}

export interface AnalyticsReport {
  summary: AnalyticsSummary;
  platforms: PlatformAnalytics[];
  posts: PostAnalytics[];
  stories: StoryAnalytics[];
}

export function engagementsOf(metrics: NormalisedMetrics): number {
  return (
    (metrics.reactions ?? 0) +
    (metrics.comments ?? 0) +
    (metrics.shares ?? 0) +
    (metrics.saves ?? 0) +
    (metrics.clicks ?? 0)
  );
}

export function viewsOf(metrics: NormalisedMetrics): number {
  return metrics.views ?? metrics.impressions ?? 0;
}

function rate(engagements: number, views: number): number | undefined {
  return views > 0 ? Math.round((engagements / views) * 10000) / 10000 : undefined;
}

function emptyTotals(): AnalyticsTotals {
  return {
    posts: 0,
    views: 0,
    engagements: 0,
    clicks: 0,
    followers: 0,
    followsGained: 0,
    emailOpens: 0,
    signups: 0,
  };
}

function addPost(totals: AnalyticsTotals, metrics: NormalisedMetrics): void {
  totals.posts += 1;
  totals.views += viewsOf(metrics);
  totals.engagements += engagementsOf(metrics);
  totals.clicks += metrics.clicks ?? 0;
  totals.followsGained += metrics.follows ?? 0;
  totals.emailOpens += metrics.emailOpens ?? 0;
  totals.signups += metrics.signups ?? 0;
}

function finish(totals: AnalyticsTotals): AnalyticsTotals {
  const engagementRate = rate(totals.engagements, totals.views);
  return engagementRate === undefined ? totals : { ...totals, engagementRate };
}

function inRange(item: QueueItem, from?: string, to?: string): boolean {
  if (item.status !== 'published' || !item.publishedAt) return false;
  const at = Date.parse(item.publishedAt);
  if (from && at < Date.parse(from)) return false;
  if (to && at > Date.parse(to)) return false;
  return true;
}

export function buildAnalytics(input: AnalyticsInput): AnalyticsReport {
  const metricsById = new Map(input.metrics.map((m) => [m.itemId, m]));
  const storyOf = new Map<string, Story>();
  for (const story of input.stories ?? []) {
    for (const id of story.itemIds) storyOf.set(id, story);
  }

  const published = input.items.filter((item) => inRange(item, input.from, input.to));

  const posts: PostAnalytics[] = published.map((item) => {
    const entry = metricsById.get(item.id);
    const metrics = entry?.metrics ?? {};
    const engagements = engagementsOf(metrics);
    const post: PostAnalytics = {
      item,
      metrics,
      engagements,
    };
    const engagementRate = rate(engagements, viewsOf(metrics));
    if (engagementRate !== undefined) post.engagementRate = engagementRate;
    const story = storyOf.get(item.id);
    if (story) post.storyId = story.id;
    if (entry?.updatedAt) post.updatedAt = entry.updatedAt;
    return post;
  });
  posts.sort((a, b) => viewsOf(b.metrics) - viewsOf(a.metrics));

  const followersByChannel = new Map(input.stats.map((s) => [s.channelId, s.followers ?? 0]));
  const channelPlatform = new Map(input.channels.map((c) => [c.id, c.platform]));

  const overall = emptyTotals();
  const byPlatform = new Map<Platform, PlatformAnalytics>();
  const platformFor = (platform: Platform): PlatformAnalytics => {
    let entry = byPlatform.get(platform);
    if (!entry) {
      entry = { ...emptyTotals(), platform, channels: 0 };
      byPlatform.set(platform, entry);
    }
    return entry;
  };

  for (const channel of input.channels) {
    const entry = platformFor(channel.platform);
    entry.channels += 1;
    const followers = followersByChannel.get(channel.id) ?? 0;
    entry.followers += followers;
    overall.followers += followers;
  }

  for (const post of posts) {
    addPost(overall, post.metrics);
    const platform = channelPlatform.get(post.item.channelId) ?? post.item.platform;
    const entry = platformFor(platform);
    addPost(entry, post.metrics);
    if (!entry.topItemId) entry.topItemId = post.item.id;
  }

  const stories: StoryAnalytics[] = [];
  for (const story of input.stories ?? []) {
    const members = posts.filter((post) => post.storyId === story.id);
    if (members.length === 0) continue;
    const totals = emptyTotals();
    for (const member of members) addPost(totals, member.metrics);
    const anchor = input.items.find((item) => item.id === story.anchorId);
    stories.push({
      storyId: story.id,
      anchorId: story.anchorId,
      title: anchor?.title ?? story.anchorId,
      items: story.itemIds.length,
      platforms: [...new Set(members.map((m) => m.item.platform))],
      totals: finish(totals),
    });
  }
  stories.sort((a, b) => b.totals.views - a.totals.views);

  const range: AnalyticsSummary['range'] = {};
  if (input.from) range.from = input.from;
  if (input.to) range.to = input.to;

  return {
    summary: { range, totals: finish(overall), generatedAt: new Date().toISOString() },
    platforms: [...byPlatform.values()]
      .map((entry) => finish(entry) as PlatformAnalytics)
      .sort((a, b) => b.views - a.views),
    posts,
    stories,
  };
}
