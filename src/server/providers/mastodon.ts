import type { Channel, ChannelStats } from '../../core/types.js';

type Fetch = typeof fetch;

/**
 * Mastodon follower counts. Buffer does not report them, but every Mastodon
 * instance publishes an account's `followers_count` without a token, so Bureau
 * reads it from the profile link Buffer gives for the channel.
 */

export interface MastodonProfile {
  /** The instance, e.g. `https://mastodon.social`. */
  origin: string;
  /** The account as the instance writes it: `name`, or `name@other.host` for a remote account. */
  acct: string;
}

/** Reads `https://host/@name` (or `https://host/@name@other.host`) into an instance and account. */
export function mastodonProfile(link: string): MastodonProfile | undefined {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  const match = /^\/@([^/]+)\/?$/.exec(url.pathname);
  if (!match) return undefined;
  return { origin: url.origin, acct: match[1]! };
}

/**
 * The follower count for one Mastodon channel, or `undefined` when its link is
 * not a profile on an instance or the instance does not answer with a count.
 */
export async function fetchMastodonFollowers(
  channel: Channel,
  fetchImpl: Fetch = fetch,
): Promise<ChannelStats | undefined> {
  const profile = channel.url ? mastodonProfile(channel.url) : undefined;
  if (!profile) return undefined;

  const query = new URLSearchParams({ acct: profile.acct });
  const response = await fetchImpl(`${profile.origin}/api/v1/accounts/lookup?${query}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return undefined;

  const account = (await response.json()) as { followers_count?: unknown };
  if (typeof account.followers_count !== 'number') return undefined;
  return {
    channelId: channel.id,
    followers: account.followers_count,
    followersSource: 'api',
  };
}
