import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { viewsOf } from '../core/analytics.js';
import { platformLabel } from '../core/platforms.js';
import type { Platform, PostAnalytics } from '../core/types.js';
import type { Bureau } from '../server/bureau.js';

/**
 * Bureau's MCP server: read-only tools that let an AI assistant analyse
 * publishing performance with the same numbers the dashboard shows.
 *
 * Tools return compact JSON rather than prose so the model does the analysis;
 * every tool is read-only, so connecting an assistant cannot move anything in
 * the schedule.
 */

const PLATFORMS = [
  'ghost',
  'linkedin',
  'twitter',
  'mastodon',
  'bluesky',
  'threads',
  'facebook',
  'instagram',
  'other',
] as const;

const range = {
  from: z.string().optional().describe('Only items published at or after this ISO date-time'),
  to: z.string().optional().describe('Only items published at or before this ISO date-time'),
};

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function rangeOf(args: { from?: string | undefined; to?: string | undefined }) {
  const options: { from?: string; to?: string } = {};
  if (args.from) options.from = args.from;
  if (args.to) options.to = args.to;
  return options;
}

function postRow(post: PostAnalytics) {
  return {
    id: post.item.id,
    title: post.item.title,
    platform: post.item.platform,
    publishedAt: post.item.publishedAt,
    url: post.item.url,
    views: viewsOf(post.metrics),
    engagements: post.engagements,
    engagementRate: post.engagementRate,
    metrics: post.metrics,
    storyId: post.storyId,
  };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export function createMcpServer(bureau: Bureau): McpServer {
  const server = new McpServer({ name: 'bureau', version: '0.1.0' });

  server.registerTool(
    'get_analytics_summary',
    {
      title: 'Analytics summary',
      description:
        'Overall totals across every platform: posts published, views, engagements, engagement rate, clicks, followers, follows gained, email opens and sign-ups. Views are page views on Ghost and views or impressions on social platforms.',
      inputSchema: range,
      annotations: READ_ONLY,
    },
    async (args) => {
      const report = await bureau.analytics(rangeOf(args));
      return json({
        ...report.summary,
        platforms: report.platforms.map((p) => ({
          platform: p.platform,
          label: platformLabel(p.platform),
          posts: p.posts,
          views: p.views,
          engagements: p.engagements,
          engagementRate: p.engagementRate,
          followers: p.followers,
        })),
      });
    },
  );

  server.registerTool(
    'get_platform_breakdown',
    {
      title: 'Per-platform analytics',
      description:
        'Totals for each platform and each channel on it, including follower counts and where they came from (the service API, or entered by hand).',
      inputSchema: range,
      annotations: READ_ONLY,
    },
    async (args) => {
      const report = await bureau.analytics(rangeOf(args));
      const stats = new Map(report.stats.map((s) => [s.channelId, s]));
      return json(
        report.platforms.map((platform) => ({
          ...platform,
          label: platformLabel(platform.platform),
          channelDetail: report.channels
            .filter((c) => c.platform === platform.platform)
            .map((c) => ({
              id: c.id,
              name: c.name,
              followers: stats.get(c.id)?.followers,
              followersSource: stats.get(c.id)?.followersSource,
            })),
        })),
      );
    },
  );

  server.registerTool(
    'list_post_metrics',
    {
      title: 'Per-post metrics',
      description:
        'Published items with their metrics, sorted and filtered. Use to find best and worst performers or compare posts on one platform.',
      inputSchema: {
        ...range,
        platform: z.enum(PLATFORMS).optional().describe('Limit to one platform'),
        sort_by: z
          .enum(['views', 'engagements', 'engagement_rate', 'clicks', 'published_at'])
          .default('views'),
        limit: z.number().int().min(1).max(200).default(25),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const report = await bureau.analytics(rangeOf(args));
      let posts = report.posts;
      if (args.platform) posts = posts.filter((p) => p.item.platform === args.platform);
      const key = (p: PostAnalytics): number => {
        switch (args.sort_by) {
          case 'engagements':
            return p.engagements;
          case 'engagement_rate':
            return p.engagementRate ?? -1;
          case 'clicks':
            return p.metrics.clicks ?? 0;
          case 'published_at':
            return Date.parse(p.item.publishedAt ?? '0');
          default:
            return viewsOf(p.metrics);
        }
      };
      posts = [...posts].sort((a, b) => key(b) - key(a)).slice(0, args.limit);
      return json({ count: posts.length, posts: posts.map(postRow) });
    },
  );

  server.registerTool(
    'get_post_analytics',
    {
      title: 'One post, with its related items',
      description:
        'Metrics for one item and every item related to it across platforms (for example a Ghost article and the LinkedIn and Bluesky posts that shared it), with the story total.',
      inputSchema: { item_id: z.string().describe('An item id such as ghost:abc or buffer:123') },
      annotations: READ_ONLY,
    },
    async ({ item_id }) => {
      const report = await bureau.analytics();
      const post = report.posts.find((p) => p.item.id === item_id);
      const overview = await bureau.overview();
      const item = overview.items.find((i) => i.id === item_id);
      if (!item) return { ...json({ error: `Unknown item ${item_id}` }), isError: true };
      const story = overview.stories.find((s) => s.itemIds.includes(item_id));
      const related = (story?.itemIds ?? [])
        .filter((id) => id !== item_id)
        .map((id) => {
          const rp = report.posts.find((p) => p.item.id === id);
          const ri = overview.items.find((i) => i.id === id)!;
          return rp
            ? postRow(rp)
            : {
                id,
                title: ri.title,
                platform: ri.platform,
                status: ri.status,
                scheduledAt: ri.scheduledAt,
              };
        });
      return json({
        item: post
          ? postRow(post)
          : { id: item.id, title: item.title, status: item.status, scheduledAt: item.scheduledAt },
        related,
        story: story ? report.stories.find((s) => s.storyId === story.id) : undefined,
        warnings: story?.warnings ?? [],
      });
    },
  );

  server.registerTool(
    'list_stories',
    {
      title: 'Cross-platform stories',
      description:
        'Groups of related items (an article and its social posts) with combined totals, sorted by views. Use to see which pieces travelled furthest across platforms.',
      inputSchema: { ...range, limit: z.number().int().min(1).max(100).default(20) },
      annotations: READ_ONLY,
    },
    async (args) => {
      const report = await bureau.analytics(rangeOf(args));
      return json(report.stories.slice(0, args.limit));
    },
  );

  server.registerTool(
    'get_schedule',
    {
      title: 'Publishing schedule',
      description:
        'Scheduled and unscheduled items with their publishing times, related items and any ordering warnings (such as a social post queued before its article).',
      inputSchema: {
        ...range,
        platform: z.enum(PLATFORMS).optional(),
        include_drafts: z.boolean().default(true),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const overview = await bureau.overview();
      const storyOf = new Map<string, string>();
      for (const story of overview.stories)
        for (const id of story.itemIds) storyOf.set(id, story.id);
      const warnings = overview.stories.flatMap((s) => s.warnings);
      const items = overview.items.filter((item) => {
        if (item.status === 'published') return false;
        if (!args.include_drafts && !item.scheduledAt) return false;
        if (args.platform && item.platform !== (args.platform as Platform)) return false;
        if (item.scheduledAt && args.from && item.scheduledAt < args.from) return false;
        if (item.scheduledAt && args.to && item.scheduledAt > args.to) return false;
        return true;
      });
      return json({
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          platform: item.platform,
          status: item.status,
          scheduledAt: item.scheduledAt ?? null,
          storyId: storyOf.get(item.id),
          warnings: warnings.filter((w) => w.itemId === item.id).map((w) => w.message),
        })),
        suggestions: overview.suggestions,
      });
    },
  );

  server.registerTool(
    'get_metrics_history',
    {
      title: 'Metrics history',
      description:
        'Snapshots of follower counts per channel and total views and engagements over time, oldest first. Bureau records one whenever analytics are refreshed, at most hourly.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => json(await bureau.history()),
  );

  server.registerPrompt(
    'performance_review',
    {
      title: 'Publishing performance review',
      description: 'Review how recent publishing performed across platforms and what to change.',
      argsSchema: {
        days: z.string().optional().describe('How many days back to review (default 30)'),
      },
    },
    ({ days }) => {
      const span = Number(days) > 0 ? Number(days) : 30;
      const from = new Date(Date.now() - span * 86_400_000).toISOString();
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Review my publishing performance since ${from} using the Bureau tools.`,
                'Start with get_analytics_summary and get_platform_breakdown, then list_stories and list_post_metrics.',
                'Tell me which platforms and stories performed best and worst, whether timing or channel mix explains it,',
                'and check get_schedule for upcoming items that look mistimed. Quote the numbers you rely on.',
              ].join(' '),
            },
          },
        ],
      };
    },
  );

  return server;
}
