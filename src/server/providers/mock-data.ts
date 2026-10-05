import type { BufferChannel, BufferPost } from './buffer.js';
import type { GhostPost } from './ghost.js';

/**
 * Demo data for running Bureau without credentials.
 *
 * It is shaped exactly like the real APIs' payloads (Ghost Admin posts,
 * Buffer GraphQL posts), so the mock providers run the same mapping code as
 * the live ones. Times are relative to the day the data is seeded, so the
 * calendar always opens on something to look at, and the set deliberately
 * includes the cases Bureau exists to catch: a social post queued before its
 * article, one queued for an article with no time yet, and an unlinked post
 * that only wording ties to an article.
 */

export const DEMO_SITE = 'https://notes.example.com';

export interface MockGhostState {
  seededAt: string;
  siteTitle: string;
  members: number;
  posts: GhostPost[];
  views: Record<string, number>;
}

export interface MockBufferState {
  seededAt: string;
  channels: BufferChannel[];
  posts: BufferPost[];
  /** Demo follower counts. The live Buffer API reports none. */
  followers: Record<string, number>;
}

/** Small deterministic PRNG so the demo looks the same on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startOfDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface DemoArticle {
  key: string;
  title: string;
  slug: string;
  excerpt: string;
  status: GhostPost['status'];
  /** Days from today and hour (UTC). Absent for drafts. */
  at?: [number, number];
}

const ARTICLES: DemoArticle[] = [
  {
    key: 'a1',
    title: 'Silent failures and how to hear them',
    slug: 'silent-failures',
    excerpt: 'The bugs that cost the most are the ones that never raise an error.',
    status: 'published',
    at: [-26, 8],
  },
  {
    key: 'a2',
    title: 'A queue is a promise',
    slug: 'a-queue-is-a-promise',
    excerpt: 'Everything you put in a queue is a promise to someone downstream.',
    status: 'published',
    at: [-19, 8],
  },
  {
    key: 'a3',
    title: 'Designing for the second reader',
    slug: 'second-reader',
    excerpt: 'Code is read by the person who wrote it, and then by everyone else.',
    status: 'published',
    at: [-12, 9],
  },
  {
    key: 'a4',
    title: 'What the changelog knows',
    slug: 'what-the-changelog-knows',
    excerpt: 'A changelog is a history of decisions, if you let it be one.',
    status: 'published',
    at: [-6, 8],
  },
  {
    key: 'a5',
    title: 'Small tools, long lives',
    slug: 'small-tools-long-lives',
    excerpt: 'The tools that last are the ones small enough to understand.',
    status: 'published',
    at: [-2, 8],
  },
  {
    key: 'a6',
    title: 'Shipping on a Friday, deliberately',
    slug: 'shipping-on-a-friday',
    excerpt: 'The rule against Friday deploys is a symptom, not a policy.',
    status: 'scheduled',
    at: [1, 9],
  },
  {
    key: 'a7',
    title: 'The cost of a dashboard nobody reads',
    slug: 'unread-dashboards',
    excerpt: 'Every dashboard has a maintenance cost and, usually, no reader.',
    status: 'scheduled',
    at: [4, 8],
  },
  {
    key: 'a8',
    title: 'Notes on rate limits',
    slug: 'notes-on-rate-limits',
    excerpt: 'Rate limits protect a service and tax its callers. Both matter.',
    status: 'scheduled',
    at: [9, 8],
  },
  {
    key: 'a9',
    title: 'Feature flags as a conversation',
    slug: 'feature-flags-as-a-conversation',
    excerpt: 'A flag is a question the code asks the people who run it.',
    status: 'draft',
  },
  {
    key: 'a10',
    title: 'Every cache is a lie',
    slug: 'every-cache-is-a-lie',
    excerpt: 'A cache tells you what was true, and lets you assume it still is.',
    status: 'draft',
  },
];

const CHANNELS: BufferChannel[] = [
  {
    id: '64a000000000000000000001',
    name: 'fieldnotes',
    displayName: 'Field Notes',
    service: 'linkedin',
    externalLink: 'https://www.linkedin.com/company/example',
  },
  {
    id: '64a000000000000000000002',
    name: 'notes.example.com',
    displayName: '@notes.example.com',
    service: 'bluesky',
    externalLink: 'https://bsky.app/profile/notes.example.com',
  },
  {
    id: '64a000000000000000000003',
    name: 'notes',
    displayName: '@notes@example.social',
    service: 'mastodon',
    externalLink: 'https://example.social/@notes',
  },
  {
    id: '64a000000000000000000004',
    name: 'fieldnotes',
    displayName: 'fieldnotes',
    service: 'threads',
    externalLink: 'https://www.threads.net/@fieldnotes',
  },
];

const [LINKEDIN, BLUESKY, MASTODON, THREADS] = CHANNELS.map((c) => c.id) as [
  string,
  string,
  string,
  string,
];

interface DemoSocial {
  channel: string;
  text: string;
  /** Days from today and hour (UTC); absent for unscheduled drafts. */
  at?: [number, number];
  status: BufferPost['status'];
  attach?: string;
}

function articleUrl(slug: string): string {
  return `${DEMO_SITE}/${slug}/`;
}

function socialsFor(article: DemoArticle): DemoSocial[] {
  const url = articleUrl(article.slug);
  const at = article.at;
  const status: BufferPost['status'] = article.status === 'published' ? 'sent' : 'scheduled';
  if (!at) return [];
  const [day, hour] = at;

  if (article.key === 'a6') {
    return [
      {
        channel: LINKEDIN,
        text: `${article.title}.\n\n${article.excerpt}`,
        at: [day, hour + 2],
        status,
        attach: url,
      },
      // Queued an hour before the article goes live: the link would 404.
      { channel: BLUESKY, text: `New post: ${article.title} ${url}`, at: [day, hour - 1], status },
      { channel: MASTODON, text: `${article.excerpt}\n\n${url}`, at: [day, hour + 4], status },
    ];
  }
  if (article.key === 'a8') {
    // Only LinkedIn links the article; Threads paraphrases it with no link.
    return [
      {
        channel: LINKEDIN,
        text: `${article.title}. ${article.excerpt}`,
        at: [day, hour + 3],
        status,
        attach: url,
      },
    ];
  }

  const posts: DemoSocial[] = [
    {
      channel: LINKEDIN,
      text: `${article.title}.\n\n${article.excerpt}`,
      at: [day, hour + 2],
      status,
      attach: `${url}?utm_source=linkedin`,
    },
    { channel: BLUESKY, text: `${article.excerpt} ${url}`, at: [day, hour + 3], status },
  ];
  if (article.key !== 'a7') {
    posts.push({
      channel: MASTODON,
      text: `New on the blog: ${article.title}\n${url}`,
      at: [day + 1, 10],
      status,
    });
  }
  return posts;
}

const STANDALONE: DemoSocial[] = [
  {
    channel: THREADS,
    text: 'Rate limits are a design decision, not an afterthought. A few notes on what they protect and what they cost the people calling you.',
    at: [9, 14],
    status: 'scheduled',
  },
  {
    channel: LINKEDIN,
    text: 'Writing up the feature flags piece this week. If flags have ever caused you an incident, I would like to hear how. https://notes.example.com/feature-flags-as-a-conversation/',
    at: [6, 12],
    status: 'scheduled',
  },
  {
    channel: LINKEDIN,
    text: 'The best talk I saw this year, on observability as a habit rather than a product. https://www.example.org/talks/observability?utm_source=linkedin',
    at: [-9, 13],
    status: 'sent',
  },
  {
    channel: BLUESKY,
    text: 'Observability as a habit, not a product. Worth forty minutes. https://example.org/talks/observability',
    at: [-9, 15],
    status: 'sent',
  },
  {
    channel: MASTODON,
    text: 'Reading list for the week: three essays on maintenance.',
    at: [2, 17],
    status: 'scheduled',
  },
  {
    channel: BLUESKY,
    text: 'An idea for later: a short thread on why caches drift from the truth.',
    status: 'draft',
  },
  {
    channel: THREADS,
    text: 'Half-formed thought about changelogs as memory.',
    status: 'draft',
  },
];

export function seedGhost(now = new Date()): MockGhostState {
  const base = startOfDay(now);
  const random = mulberry32(7);
  const posts: GhostPost[] = [];
  const views: Record<string, number> = {};

  ARTICLES.forEach((article, index) => {
    const id = `66f0000000000000000000${String(index + 1).padStart(2, '0')}`;
    const published = article.at
      ? new Date(base + article.at[0] * DAY + article.at[1] * HOUR)
      : null;
    const post: GhostPost = {
      id,
      uuid: `00000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}`,
      title: article.title,
      slug: article.slug,
      url:
        article.status === 'published'
          ? articleUrl(article.slug)
          : `${DEMO_SITE}/p/00000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}/`,
      status: article.status,
      published_at: published ? published.toISOString() : null,
      updated_at: new Date(base - 30 * DAY).toISOString(),
      custom_excerpt: article.excerpt,
    };
    if (article.status === 'published' && published) {
      const age = (base - published.getTime()) / DAY;
      const recipients = 1180 + Math.round(random() * 40);
      post.email = {
        email_count: recipients,
        opened_count: Math.round(recipients * (0.48 + random() * 0.14)),
      };
      post.count = {
        clicks: Math.round(30 + random() * 110),
        signups: Math.round(random() * 9),
        paid_conversions: Math.round(random() * 2),
      };
      views[id] = Math.round((600 + random() * 1800) * Math.min(1, 0.35 + age / 20));
    }
    posts.push(post);
  });

  return { seededAt: now.toISOString(), siteTitle: 'Field Notes', members: 1243, posts, views };
}

export function seedBuffer(now = new Date()): MockBufferState {
  const base = startOfDay(now);
  const random = mulberry32(11);
  const socials = [...ARTICLES.flatMap(socialsFor), ...STANDALONE];
  const posts: BufferPost[] = socials.map((social, index) => {
    const channel = CHANNELS.find((c) => c.id === social.channel)!;
    const due = social.at
      ? new Date(base + social.at[0] * DAY + social.at[1] * HOUR).toISOString()
      : null;
    const post: BufferPost = {
      id: `65b0000000000000000000${String(index + 1).padStart(2, '0')}`,
      channelId: channel.id,
      channelService: channel.service,
      status: social.status,
      text: social.text,
      dueAt: due,
      sentAt: social.status === 'sent' ? due : null,
      allowedActions: social.status === 'sent' ? ['viewPost'] : ['updatePostSchedule', 'viewPost'],
      metadata: social.attach ? { linkAttachment: { url: social.attach } } : null,
    };
    if (social.status === 'sent') {
      post.externalLink = `${channel.externalLink}/post/${post.id.slice(-6)}`;
      post.metrics = socialMetrics(channel.service, random);
      post.metricsUpdatedAt = new Date(base).toISOString();
    }
    return post;
  });

  return {
    seededAt: now.toISOString(),
    channels: CHANNELS,
    posts,
    followers: {
      [LINKEDIN]: 3480,
      [BLUESKY]: 1912,
      [MASTODON]: 846,
      [THREADS]: 402,
    },
  };
}

function socialMetrics(
  service: string,
  random: () => number,
): Array<{ type: string; value: number }> {
  const scale = service === 'linkedin' ? 4200 : service === 'bluesky' ? 1600 : 700;
  const impressions = Math.round(scale * (0.4 + random()));
  const reactions = Math.round(impressions * (0.015 + random() * 0.03));
  const metrics = [
    { type: 'impressions', value: impressions },
    { type: 'reactions', value: reactions },
    { type: 'comments', value: Math.round(reactions * (0.05 + random() * 0.2)) },
    { type: 'reposts', value: Math.round(reactions * (0.05 + random() * 0.25)) },
    { type: 'clicks', value: Math.round(impressions * (0.004 + random() * 0.012)) },
    { type: 'follows', value: Math.round(random() * 14) },
  ];
  if (service === 'linkedin') metrics.push({ type: 'reach', value: Math.round(impressions * 0.7) });
  return metrics;
}
