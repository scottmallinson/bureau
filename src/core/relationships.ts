import type {
  QueueItem,
  Relationship,
  RelationshipSuggestion,
  Story,
  StoryWarning,
} from './types.js';

/**
 * Relationship detection.
 *
 * The strong signal is a link: a LinkedIn post that shares
 * `https://example.com/my-post/` belongs to the Ghost post with slug `my-post`.
 * Matching on the slug, not only on the post's current URL, matters because a
 * draft or scheduled Ghost post only has a `/p/<uuid>/` preview URL until it
 * publishes, while the social post queued to announce it already carries the
 * final address.
 *
 * The weak signal is wording. A social post with no link that repeats most of
 * an article's title, close to it in time, is offered as a suggestion for a
 * person to confirm, never applied on its own.
 */

const TRACKING_PARAMS = /^(utm_|ref$|ref_src$|fbclid$|gclid$|mc_)/;

export function normaliseUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return `${host}${path}${query}`;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

export function extractUrls(text: string): string[] {
  return [...(text.match(URL_PATTERN) ?? [])].map((url) => url.replace(/[.,;:!?]+$/, ''));
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Everything that identifies a Ghost post by address. */
function ghostKeys(item: QueueItem): string[] {
  const keys = new Set<string>();
  const own = item.url ? normaliseUrl(item.url) : undefined;
  if (own) keys.add(own);
  if (item.slug && own) {
    const host = own.split('/')[0];
    keys.add(`${host}/${item.slug}`);
  }
  return [...keys];
}

/** Links detected from URLs. Pairs only; stories are assembled later. */
export function detectLinks(items: QueueItem[]): Relationship[] {
  const byKey = new Map<string, QueueItem>();
  for (const item of items) {
    if (item.provider !== 'ghost') continue;
    for (const key of ghostKeys(item)) byKey.set(key, item);
  }

  const relationships: Relationship[] = [];
  const seen = new Set<string>();
  const sharedLinks = new Map<string, QueueItem[]>();

  for (const item of items) {
    if (item.provider === 'ghost') continue;
    for (const link of item.links) {
      const key = normaliseUrl(link);
      if (!key) continue;
      const target = byKey.get(key);
      if (target) {
        const id = `auto:${pairKey(target.id, item.id)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        relationships.push({
          id,
          itemIds: [target.id, item.id],
          source: 'auto',
          reason: `Shares ${target.slug ? `/${target.slug}/` : 'the post URL'}`,
        });
      } else {
        const group = sharedLinks.get(key) ?? [];
        if (!group.includes(item)) group.push(item);
        sharedLinks.set(key, group);
      }
    }
  }

  // Social posts that share the same outside link (no Ghost post behind it)
  // are still one story told on several channels.
  for (const [key, group] of sharedLinks) {
    for (let i = 1; i < group.length; i++) {
      const a = group[0]!;
      const b = group[i]!;
      const id = `auto:${pairKey(a.id, b.id)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      relationships.push({
        id,
        itemIds: [a.id, b.id],
        source: 'auto',
        reason: `Both share ${key}`,
      });
    }
  }

  return relationships;
}

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'been',
  'before',
  'being',
  'from',
  'have',
  'here',
  'into',
  'just',
  'more',
  'most',
  'only',
  'other',
  'over',
  'same',
  'some',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'your',
]);

export function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(URL_PATTERN, ' ')
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
  );
}

export function itemTime(item: QueueItem): number | undefined {
  const stamp = item.publishedAt ?? item.scheduledAt;
  return stamp ? Date.parse(stamp) : undefined;
}

const SUGGESTION_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
const SUGGESTION_THRESHOLD = 0.6;

/**
 * Ghost post + social post pairs whose wording overlaps. `related` holds pair
 * keys already linked (directly or through a story) and `dismissed` the ones a
 * person rejected; neither is suggested again.
 */
export function suggestLinks(
  items: QueueItem[],
  isRelated: (a: string, b: string) => boolean,
  dismissed: Set<string>,
): RelationshipSuggestion[] {
  const ghosts = items.filter((item) => item.provider === 'ghost');
  const socials = items.filter((item) => item.provider !== 'ghost');
  const suggestions: RelationshipSuggestion[] = [];

  for (const ghost of ghosts) {
    const titleWords = significantWords(ghost.title);
    if (titleWords.size < 2) continue;
    const ghostTime = itemTime(ghost);

    for (const social of socials) {
      const key = pairKey(ghost.id, social.id);
      if (dismissed.has(key) || isRelated(ghost.id, social.id)) continue;

      const socialTime = itemTime(social);
      if (ghostTime !== undefined && socialTime !== undefined) {
        if (Math.abs(ghostTime - socialTime) > SUGGESTION_WINDOW_MS) continue;
      }

      const words = significantWords(`${social.title} ${social.excerpt}`);
      let shared = 0;
      for (const word of titleWords) if (words.has(word)) shared++;
      const score = shared / titleWords.size;
      if (score < SUGGESTION_THRESHOLD) continue;

      suggestions.push({
        id: `suggest:${key}`,
        itemIds: [ghost.id, social.id],
        reason: `Repeats ${shared} of ${titleWords.size} words from "${ghost.title}"`,
        score: Math.round(score * 100) / 100,
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score);
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

/** Groups related items into stories and flags ordering problems in each. */
export function buildStories(items: QueueItem[], relationships: Relationship[]): Story[] {
  const known = new Map(items.map((item) => [item.id, item]));
  const uf = new UnionFind();
  for (const rel of relationships) {
    const ids = rel.itemIds.filter((id) => known.has(id));
    for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!);
  }

  const groups = new Map<string, Set<string>>();
  for (const rel of relationships) {
    for (const id of rel.itemIds) {
      if (!known.has(id)) continue;
      const root = uf.find(id);
      const group = groups.get(root) ?? new Set<string>();
      group.add(id);
      groups.set(root, group);
    }
  }

  const stories: Story[] = [];
  for (const ids of groups.values()) {
    if (ids.size < 2) continue;
    const members = [...ids].map((id) => known.get(id)!);
    members.sort((a, b) => (itemTime(a) ?? Infinity) - (itemTime(b) ?? Infinity));
    const anchor = members.find((item) => item.provider === 'ghost') ?? members[0]!;
    const rels = relationships.filter((rel) => rel.itemIds.some((id) => ids.has(id)));
    stories.push({
      id: `story:${anchor.id}`,
      anchorId: anchor.id,
      itemIds: [anchor.id, ...members.filter((m) => m !== anchor).map((m) => m.id)],
      relationships: rels,
      warnings: storyWarnings(anchor, members),
    });
  }

  return stories.sort(
    (a, b) => (itemTime(known.get(b.anchorId)!) ?? 0) - (itemTime(known.get(a.anchorId)!) ?? 0),
  );
}

function storyWarnings(anchor: QueueItem, members: QueueItem[]): StoryWarning[] {
  if (anchor.provider !== 'ghost') return [];
  const warnings: StoryWarning[] = [];
  const anchorTime = itemTime(anchor);

  for (const item of members) {
    if (item === anchor || item.status !== 'scheduled') continue;
    const time = itemTime(item);
    if (anchorTime === undefined) {
      warnings.push({
        itemId: item.id,
        kind: 'anchor-unscheduled',
        message: `Scheduled, but "${anchor.title}" has no publishing time yet`,
      });
    } else if (time !== undefined && time < anchorTime) {
      warnings.push({
        itemId: item.id,
        kind: 'before-anchor',
        message: `Goes out before "${anchor.title}" is published`,
      });
    }
  }

  return warnings;
}
