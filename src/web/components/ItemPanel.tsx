import { useEffect, useState } from 'react';
import type { QueueItem } from '../../core/types.js';
import { formatDateTime, fromLocalInput, relative, toLocalInput } from '../format.js';
import { useBureau } from '../state.js';
import { Icon, PlatformBadge, PlatformDot, StatusPill } from './common.js';

const HOUR = 3_600_000;

/**
 * The detail drawer: everything about one item, and the manual way to set,
 * change or remove its publishing time. Content itself is read-only here.
 */
export function ItemPanel({
  item,
  onClose,
  onSelect,
}: {
  item: QueueItem;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { overview, storyOf, itemsById, schedule, cascade, setCascade, unlink } = useBureau();
  const [value, setValue] = useState(toLocalInput(item.scheduledAt));
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(toLocalInput(item.scheduledAt)), [item.id, item.scheduledAt]);

  const channel = overview?.channels.find((c) => c.id === item.channelId);
  const story = storyOf.get(item.id);
  const warnings = story?.warnings ?? [];
  const related = (story?.itemIds ?? [])
    .filter((id) => id !== item.id)
    .map((id) => itemsById.get(id)!);

  const run = async (at: string | null) => {
    setBusy(true);
    await schedule(item, at);
    setBusy(false);
  };

  const nudge = (ms: number) => {
    const base = item.scheduledAt ? Date.parse(item.scheduledAt) : Date.now() + HOUR;
    void run(new Date(base + ms).toISOString());
  };

  const parsed = fromLocalInput(value);
  const dirty =
    (parsed ?? null) !== (item.scheduledAt ? new Date(item.scheduledAt).toISOString() : null);

  return (
    <aside className="panel" aria-label="Item details">
      <header className="panel-head">
        <div className="panel-meta">
          <PlatformBadge platform={item.platform} />
          <StatusPill status={item.status} />
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </header>

      <h2 className="panel-title">{item.title}</h2>
      {channel && <p className="muted">{channel.name}</p>}
      {item.excerpt && item.excerpt !== item.title && <p className="excerpt">{item.excerpt}</p>}
      {item.url && (
        <a className="out" href={item.url} target="_blank" rel="noreferrer">
          {item.status === 'published' ? 'View post' : 'Preview'} <Icon name="external" />
        </a>
      )}

      <section className="panel-section">
        <h3>Publishing time</h3>
        {item.publishedAt ? (
          <p>
            Published {formatDateTime(item.publishedAt)}{' '}
            <span className="muted">({relative(item.publishedAt)})</span>
          </p>
        ) : item.reschedulable ? (
          <form
            className="time-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (parsed) void run(parsed);
            }}
          >
            <label className="sr-only" htmlFor="panel-time">
              Publishing time
            </label>
            <input
              id="panel-time"
              type="datetime-local"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
            />
            <div className="row">
              <button type="submit" className="primary" disabled={busy || !parsed || !dirty}>
                {item.scheduledAt ? 'Save time' : 'Schedule'}
              </button>
              {item.scheduledAt && (
                <button type="button" disabled={busy} onClick={() => void run(null)}>
                  Remove time
                </button>
              )}
            </div>
            <div className="row nudges" aria-label="Quick adjustments">
              <button type="button" disabled={busy} onClick={() => nudge(-HOUR)}>
                −1h
              </button>
              <button type="button" disabled={busy} onClick={() => nudge(HOUR)}>
                +1h
              </button>
              <button type="button" disabled={busy} onClick={() => nudge(24 * HOUR)}>
                +1 day
              </button>
              <button type="button" disabled={busy} onClick={() => nudge(7 * 24 * HOUR)}>
                +1 week
              </button>
            </div>
            {item.scheduledAt && (
              <p className="muted small">Goes out {relative(item.scheduledAt)}.</p>
            )}
          </form>
        ) : (
          <p className="muted">
            <Icon name="lock" /> This item can no longer be rescheduled.
          </p>
        )}
      </section>

      {warnings.length > 0 && (
        <section className="panel-section">
          {warnings.map((w) => (
            <p key={w.itemId + w.kind} className="warning">
              <Icon name="warn" /> {itemsById.get(w.itemId)?.title}: {w.message}
            </p>
          ))}
        </section>
      )}

      <section className="panel-section">
        <h3>
          Related items <span className="muted">({related.length})</span>
        </h3>
        {related.length === 0 ? (
          <p className="muted small">Nothing linked yet. Link items from the Stories view.</p>
        ) : (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={cascade}
                onChange={(e) => setCascade(e.target.checked)}
              />
              Move related scheduled items with this one
            </label>
            <ul className="related">
              {related.map((other) => {
                const rel = story!.relationships.find(
                  (r) => r.itemIds.includes(other.id) && r.itemIds.includes(item.id),
                );
                return (
                  <li key={other.id}>
                    <button className="related-item" onClick={() => onSelect(other.id)}>
                      <PlatformDot platform={other.platform} />
                      <span className="related-title">{other.title}</span>
                      <span className="muted small">
                        {other.publishedAt
                          ? `published ${formatDateTime(other.publishedAt)}`
                          : other.scheduledAt
                            ? formatDateTime(other.scheduledAt)
                            : 'no time'}
                      </span>
                    </button>
                    {rel && (
                      <button
                        className="link-button small"
                        title={rel.reason}
                        onClick={() => void unlink(rel.id, `Unlinked ${other.title}`)}
                      >
                        Unlink
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </aside>
  );
}
