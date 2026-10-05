import {
  DndContext,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import type { QueueItem, Story } from '../../core/types.js';
import { Icon, PlatformBadge, PlatformDot, StatusPill } from '../components/common.js';
import { ItemPanel } from '../components/ItemPanel.js';
import { formatDateTime } from '../format.js';
import { useBureau } from '../state.js';

/** Drop where the pointer is; fall back to overlap for keyboard dragging. */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/**
 * Relationships between items across platforms. Links are detected from URLs
 * and offered from wording; people confirm suggestions, drag loose items onto
 * a story, or tick several items to link them into a new one.
 */
export function StoriesView() {
  const { overview, itemsById, storyOf, link, unlink } = useBureau();
  const [selected, setSelected] = useState<string>();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string>();
  const [query, setQuery] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const loose = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (overview?.items ?? [])
      .filter((item) => !storyOf.has(item.id))
      .filter((item) => !q || `${item.title} ${item.excerpt}`.toLowerCase().includes(q));
  }, [overview, storyOf, query]);

  if (!overview) return null;
  const selectedItem = selected ? itemsById.get(selected) : undefined;
  const draggingItem = dragging ? itemsById.get(dragging) : undefined;

  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  };

  return (
    <div className={`stories ${selectedItem ? 'with-panel' : ''}`}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={(e) => setDragging(String(e.active.id))}
        onDragCancel={() => setDragging(undefined)}
        onDragEnd={(e) => {
          setDragging(undefined);
          const target = e.over?.id ? String(e.over.id) : undefined;
          const story = overview.stories.find((s) => s.id === target);
          if (story) void link([story.anchorId, String(e.active.id)]);
        }}
      >
        <div className="stories-body">
          <div className="stories-main">
            {overview.suggestions.length > 0 && (
              <section className="card">
                <h2>Possible links</h2>
                <p className="muted small">
                  These share wording and timing but no link. Confirm the ones that belong together.
                </p>
                <ul className="suggestions">
                  {overview.suggestions.map((s) => {
                    const [a, b] = s.itemIds.map((id) => itemsById.get(id)!) as [
                      QueueItem,
                      QueueItem,
                    ];
                    return (
                      <li key={s.id}>
                        <div className="pair">
                          <ItemLine item={a} onSelect={setSelected} />
                          <ItemLine item={b} onSelect={setSelected} />
                          <p className="muted small">{s.reason}</p>
                        </div>
                        <div className="row">
                          <button className="primary" onClick={() => void link(s.itemIds)}>
                            Link
                          </button>
                          <button onClick={() => void unlink(s.id, 'Suggestion dismissed')}>
                            Dismiss
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <h2 className="section-title">Stories</h2>
            {overview.stories.length === 0 && <p className="muted">No related items yet.</p>}
            {overview.stories.map((story) => (
              <StoryCard
                key={story.id}
                story={story}
                accepting={Boolean(draggingItem)}
                onSelect={setSelected}
                onUnlink={(id, title) => void unlink(id, `Unlinked ${title}`)}
              />
            ))}
          </div>

          <aside className="loose">
            <h2>Not linked</h2>
            <p className="muted small">
              Drag an item onto a story to link it, or tick two or more to start a new story.
            </p>
            <input
              type="search"
              placeholder="Filter items"
              aria-label="Filter unlinked items"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="row">
              <button
                className="primary"
                disabled={ticked.size < 2}
                onClick={() => {
                  void link([...ticked]);
                  setTicked(new Set());
                }}
              >
                Link {ticked.size > 1 ? ticked.size : ''} selected
              </button>
              {ticked.size > 0 && <button onClick={() => setTicked(new Set())}>Clear</button>}
            </div>
            <ul className="loose-list">
              {loose.map((item) => (
                <LooseItem
                  key={item.id}
                  item={item}
                  ticked={ticked.has(item.id)}
                  onTick={() => toggle(item.id)}
                  onSelect={setSelected}
                />
              ))}
            </ul>
          </aside>
        </div>
        <DragOverlay dropAnimation={null}>
          {draggingItem && (
            <div className="drag-card">
              <PlatformDot platform={draggingItem.platform} /> {draggingItem.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {selectedItem && (
        <ItemPanel
          item={selectedItem}
          onClose={() => setSelected(undefined)}
          onSelect={setSelected}
        />
      )}
    </div>
  );
}

function ItemLine({ item, onSelect }: { item: QueueItem; onSelect: (id: string) => void }) {
  const time = item.publishedAt ?? item.scheduledAt;
  return (
    <button className="item-line" onClick={() => onSelect(item.id)}>
      <PlatformBadge platform={item.platform} />
      <span className="item-line-title">{item.title}</span>
      <span className="muted small">{time ? formatDateTime(time) : 'no time'}</span>
    </button>
  );
}

function StoryCard({
  story,
  accepting,
  onSelect,
  onUnlink,
}: {
  story: Story;
  accepting: boolean;
  onSelect: (id: string) => void;
  onUnlink: (relationshipId: string, title: string) => void;
}) {
  const { itemsById } = useBureau();
  const { setNodeRef, isOver } = useDroppable({ id: story.id });
  const anchor = itemsById.get(story.anchorId)!;
  const members = story.itemIds.slice(1).map((id) => itemsById.get(id)!);

  const relationFor = (id: string) =>
    story.relationships.find((r) => r.itemIds.includes(id) && r.itemIds.includes(story.anchorId)) ??
    story.relationships.find((r) => r.itemIds.includes(id));

  return (
    <section
      ref={setNodeRef}
      className={`card story ${isOver ? 'over' : ''} ${accepting ? 'accepting' : ''}`}
    >
      <header className="story-head">
        <button className="link-button story-title" onClick={() => onSelect(anchor.id)}>
          {anchor.title}
        </button>
        <div className="row">
          <PlatformBadge platform={anchor.platform} />
          <StatusPill status={anchor.status} />
          <span className="muted small">
            {(anchor.publishedAt ?? anchor.scheduledAt)
              ? formatDateTime((anchor.publishedAt ?? anchor.scheduledAt)!)
              : 'no time yet'}
          </span>
        </div>
      </header>
      <ol className="story-members">
        {members.map((item) => {
          const rel = relationFor(item.id);
          const warning = story.warnings.find((w) => w.itemId === item.id);
          const time = item.publishedAt ?? item.scheduledAt;
          return (
            <li key={item.id} className={warning ? 'warned' : ''}>
              <button className="member" onClick={() => onSelect(item.id)}>
                <PlatformBadge platform={item.platform} />
                <span className="member-title">{item.title}</span>
                <span className="muted small">{time ? formatDateTime(time) : 'no time'}</span>
                <StatusPill status={item.status} />
              </button>
              {warning && (
                <p className="warning small">
                  <Icon name="warn" /> {warning.message}
                </p>
              )}
              {rel && (
                <p className="muted small rel">
                  <span className={`source source-${rel.source}`}>
                    {rel.source === 'auto' ? 'Detected' : 'Manual'}
                  </span>{' '}
                  {rel.reason}{' '}
                  <button
                    className="link-button small"
                    onClick={() => onUnlink(rel.id, item.title)}
                  >
                    Unlink
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function LooseItem({
  item,
  ticked,
  onTick,
  onSelect,
}: {
  item: QueueItem;
  ticked: boolean;
  onTick: () => void;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  const time = item.publishedAt ?? item.scheduledAt;
  return (
    <li ref={setNodeRef} className={`loose-item ${isDragging ? 'dragging' : ''}`}>
      <input
        type="checkbox"
        checked={ticked}
        onChange={onTick}
        aria-label={`Select ${item.title}`}
      />
      <span
        className="grip"
        {...listeners}
        {...attributes}
        aria-label={`Drag ${item.title} onto a story`}
      >
        <Icon name="grip" />
      </span>
      <button className="loose-body" onClick={() => onSelect(item.id)}>
        <span className="loose-title">
          <PlatformDot platform={item.platform} />
          <span className="ellipsis">{item.title}</span>
        </span>
        <span className="muted small">{time ? formatDateTime(time) : 'no time'}</span>
      </button>
    </li>
  );
}
