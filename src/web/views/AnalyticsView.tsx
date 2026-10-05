import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { viewsOf } from '../../core/analytics.js';
import { PLATFORMS } from '../../core/platforms.js';
import type { MetricKey, Platform, PlatformAnalytics, PostAnalytics } from '../../core/types.js';
import { api, type Analytics } from '../api.js';
import { PlatformBadge, PlatformDot } from '../components/common.js';
import { formatCount, formatDateTime, formatRate, formatWhole } from '../format.js';
import { useBureau } from '../state.js';

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All', days: 0 },
];

const METRIC_LABELS: Record<MetricKey, string> = {
  views: 'Views',
  impressions: 'Impressions',
  reach: 'Reach',
  reactions: 'Reactions',
  comments: 'Comments',
  shares: 'Shares',
  clicks: 'Clicks',
  saves: 'Saves',
  follows: 'Follows',
  emailRecipients: 'Email recipients',
  emailOpens: 'Email opens',
  signups: 'Sign-ups',
  conversions: 'Paid conversions',
};

type SortKey = 'views' | 'engagements' | 'rate' | 'clicks' | 'published';

export function AnalyticsView() {
  const { notify } = useBureau();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
        setData(await api.analytics({ ...(from ? { from } : {}), refresh }));
      } catch (e) {
        notify({ tone: 'error', message: (e as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [days, notify],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!data)
    return <p className="muted pad">{loading ? 'Loading analytics…' : 'No analytics yet.'}</p>;
  const t = data.summary.totals;

  return (
    <div className="analytics">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Date range">
          {RANGES.map((range) => (
            <button
              key={range.label}
              aria-pressed={days === range.days}
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </button>
          ))}
        </div>
        <button onClick={() => void load(true)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh metrics'}
        </button>
        <span className="muted small">
          Followers are current; everything else counts items published in the range.
        </span>
      </div>

      <section className="tiles" aria-label="Summary">
        <Tile
          label="Views"
          value={formatCount(t.views)}
          hint="Page views on Ghost, views or impressions on social"
        />
        <Tile
          label="Followers"
          value={formatCount(t.followers)}
          hint={`+${formatWhole(t.followsGained)} from posts in range`}
        />
        <Tile
          label="Engagements"
          value={formatCount(t.engagements)}
          hint="Reactions, comments, shares, saves and clicks"
        />
        <Tile
          label="Engagement rate"
          value={formatRate(t.engagementRate)}
          hint="Engagements per view"
        />
        <Tile label="Published" value={formatWhole(t.posts)} hint="Items published in range" />
        <Tile
          label="Email opens"
          value={formatCount(t.emailOpens)}
          hint={`${formatWhole(t.signups)} sign-ups`}
        />
      </section>

      <section className="card">
        <h2>By platform</h2>
        <PlatformBars platforms={data.platforms} />
        <PlatformTable platforms={data.platforms} />
      </section>

      <section className="card">
        <h2>Channels</h2>
        <ChannelTable data={data} onChange={() => void load()} />
      </section>

      {data.stories.length > 0 && (
        <section className="card">
          <h2>Stories across platforms</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Story</th>
                <th scope="col">Platforms</th>
                <th scope="col" className="num">
                  Views
                </th>
                <th scope="col" className="num">
                  Engagements
                </th>
                <th scope="col" className="num">
                  Rate
                </th>
                <th scope="col" className="num">
                  Clicks
                </th>
              </tr>
            </thead>
            <tbody>
              {data.stories.map((story) => (
                <tr key={story.storyId}>
                  <td>{story.title}</td>
                  <td>
                    <span className="dots">
                      {story.platforms.map((p) => (
                        <span key={p} title={PLATFORMS[p].label}>
                          <PlatformDot platform={p} />
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="num">{formatWhole(story.totals.views)}</td>
                  <td className="num">{formatWhole(story.totals.engagements)}</td>
                  <td className="num">{formatRate(story.totals.engagementRate)}</td>
                  <td className="num">{formatWhole(story.totals.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>By post</h2>
        <PostTable posts={data.posts} />
      </section>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-hint">{hint}</div>
    </div>
  );
}

/** One series (views), one hue; platform identity sits in the row label. */
function PlatformBars({ platforms }: { platforms: PlatformAnalytics[] }) {
  const [hover, setHover] = useState<Platform>();
  const max = Math.max(1, ...platforms.map((p) => p.views));
  return (
    <div className="bars" role="img" aria-label="Views by platform">
      {platforms.map((p) => (
        <div
          key={p.platform}
          className={`bar-row ${hover === p.platform ? 'hover' : ''}`}
          onMouseEnter={() => setHover(p.platform)}
          onMouseLeave={() => setHover(undefined)}
        >
          <span className="bar-label">
            <PlatformDot platform={p.platform} /> {PLATFORMS[p.platform].label}
          </span>
          <span className="bar-track">
            <span className="bar" style={{ width: `${(p.views / max) * 100}%` }} />
            {hover === p.platform && (
              <span className="tooltip">
                <strong>{PLATFORMS[p.platform].label}</strong>
                <span>{formatWhole(p.views)} views</span>
                <span>{formatWhole(p.engagements)} engagements</span>
                <span>{p.posts} posts</span>
              </span>
            )}
          </span>
          <span className="bar-value">{formatCount(p.views)}</span>
        </div>
      ))}
    </div>
  );
}

function PlatformTable({ platforms }: { platforms: PlatformAnalytics[] }) {
  const { itemsById } = useBureau();
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Platform</th>
          <th scope="col" className="num">
            Followers
          </th>
          <th scope="col" className="num">
            Posts
          </th>
          <th scope="col" className="num">
            Views
          </th>
          <th scope="col" className="num">
            Engagements
          </th>
          <th scope="col" className="num">
            Rate
          </th>
          <th scope="col" className="num">
            Clicks
          </th>
          <th scope="col">Top post</th>
        </tr>
      </thead>
      <tbody>
        {platforms.map((p) => (
          <tr key={p.platform}>
            <td>
              <PlatformBadge platform={p.platform} />
            </td>
            <td className="num">{formatWhole(p.followers)}</td>
            <td className="num">{p.posts}</td>
            <td className="num">{formatWhole(p.views)}</td>
            <td className="num">{formatWhole(p.engagements)}</td>
            <td className="num">{formatRate(p.engagementRate)}</td>
            <td className="num">{formatWhole(p.clicks)}</td>
            <td className="small">{p.topItemId ? itemsById.get(p.topItemId)?.title : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChannelTable({ data, onChange }: { data: Analytics; onChange: () => void }) {
  const stats = new Map(data.stats.map((s) => [s.channelId, s]));
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Channel</th>
          <th scope="col">Platform</th>
          <th scope="col">Followers</th>
          <th scope="col">Source</th>
        </tr>
      </thead>
      <tbody>
        {data.channels.map((channel) => {
          const stat = stats.get(channel.id);
          return (
            <tr key={channel.id}>
              <td>{channel.name}</td>
              <td>
                <PlatformBadge platform={channel.platform} />
              </td>
              <td>
                <FollowersField
                  channelId={channel.id}
                  name={channel.name}
                  value={stat?.followers}
                  onSaved={onChange}
                />
              </td>
              <td className="small muted">
                {stat?.followersSource === 'api'
                  ? 'From the API'
                  : stat?.followersSource === 'manual'
                    ? `Entered by hand${stat.updatedAt ? `, ${formatDateTime(stat.updatedAt)}` : ''}`
                    : 'Not reported, enter it by hand'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FollowersField({
  channelId,
  name,
  value,
  onSaved,
}: {
  channelId: string;
  name: string;
  value: number | undefined;
  onSaved: () => void;
}) {
  const { notify } = useBureau();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const dirty = text !== (value === undefined ? '' : String(value));

  return (
    <form
      className="inline-time"
      onSubmit={(event) => {
        event.preventDefault();
        const next = text.trim() === '' ? null : Number(text);
        void api
          .setFollowers(channelId, next)
          .then(() => {
            notify({ tone: 'info', message: `Followers for ${name} saved` });
            onSaved();
          })
          .catch((e: Error) => notify({ tone: 'error', message: e.message }));
      }}
    >
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        className="num-input"
        aria-label={`Followers for ${name}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {dirty && (
        <button type="submit" className="primary small">
          Save
        </button>
      )}
    </form>
  );
}

function PostTable({ posts }: { posts: PostAnalytics[] }) {
  const { itemsById } = useBureau();
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('views');
  const [open, setOpen] = useState<string>();

  const platforms = useMemo(() => [...new Set(posts.map((p) => p.item.platform))], [posts]);
  const rows = useMemo(() => {
    const value = (p: PostAnalytics): number => {
      switch (sort) {
        case 'engagements':
          return p.engagements;
        case 'rate':
          return p.engagementRate ?? -1;
        case 'clicks':
          return p.metrics.clicks ?? 0;
        case 'published':
          return Date.parse(p.item.publishedAt ?? '0');
        default:
          return viewsOf(p.metrics);
      }
    };
    return posts
      .filter((p) => platform === 'all' || p.item.platform === platform)
      .sort((a, b) => value(b) - value(a));
  }, [posts, platform, sort]);

  const header = (key: SortKey, label: string) => (
    <th scope="col" className="num" aria-sort={sort === key ? 'descending' : 'none'}>
      <button className="sort" onClick={() => setSort(key)}>
        {label}
        {sort === key ? ' ↓' : ''}
      </button>
    </th>
  );

  return (
    <>
      <div className="row">
        <label className="small" htmlFor="post-platform">
          Platform
        </label>
        <select
          id="post-platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform | 'all')}
        >
          <option value="all">All platforms</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {PLATFORMS[p].label}
            </option>
          ))}
        </select>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Post</th>
            <th scope="col" aria-sort={sort === 'published' ? 'descending' : 'none'}>
              <button className="sort" onClick={() => setSort('published')}>
                Published{sort === 'published' ? ' ↓' : ''}
              </button>
            </th>
            {header('views', 'Views')}
            {header('engagements', 'Engagements')}
            {header('rate', 'Rate')}
            {header('clicks', 'Clicks')}
          </tr>
        </thead>
        <tbody>
          {rows.map((post) => {
            const expanded = open === post.item.id;
            const story = post.storyId;
            return (
              <Fragment key={post.item.id}>
                <tr className={expanded ? 'expanded' : ''}>
                  <td>
                    <button
                      className="link-button row-title"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? undefined : post.item.id)}
                    >
                      <PlatformDot platform={post.item.platform} /> {post.item.title}
                    </button>
                  </td>
                  <td className="small">
                    {post.item.publishedAt ? formatDateTime(post.item.publishedAt) : '–'}
                  </td>
                  <td className="num">{formatWhole(viewsOf(post.metrics))}</td>
                  <td className="num">{formatWhole(post.engagements)}</td>
                  <td className="num">{formatRate(post.engagementRate)}</td>
                  <td className="num">
                    {post.metrics.clicks === undefined ? '–' : formatWhole(post.metrics.clicks)}
                  </td>
                </tr>
                {expanded && (
                  <tr className="detail">
                    <td colSpan={6}>
                      <dl className="metrics">
                        {(Object.keys(METRIC_LABELS) as MetricKey[])
                          .filter((key) => post.metrics[key] !== undefined)
                          .map((key) => (
                            <div key={key}>
                              <dt>{METRIC_LABELS[key]}</dt>
                              <dd>{formatWhole(post.metrics[key]!)}</dd>
                            </div>
                          ))}
                      </dl>
                      {story && (
                        <p className="small muted">
                          Part of a story with{' '}
                          {posts
                            .filter((p) => p.storyId === story && p.item.id !== post.item.id)
                            .map(
                              (p) =>
                                `${PLATFORMS[p.item.platform].label} (${formatWhole(viewsOf(p.metrics))} views)`,
                            )
                            .join(', ') || 'unpublished items'}
                          .
                        </p>
                      )}
                      {post.item.url && (
                        <a
                          className="out small"
                          href={post.item.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open{' '}
                          {itemsById.get(post.item.id)?.platform === 'ghost' ? 'article' : 'post'}
                        </a>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
