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
  type DragEndEvent,
} from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { PLATFORMS } from '../../core/platforms.js';
import type { Platform, QueueItem } from '../../core/types.js';
import { Icon, isArticle, PlatformBadge, PlatformDot, StatusPill } from '../components/common.js';
import { CellMenu } from '../components/CellMenu.js';
import { ItemPanel } from '../components/ItemPanel.js';
import {
  addDays,
  dayKey,
  formatDate,
  formatDateTime,
  formatDay,
  formatTime,
  fromLocalInput,
  parseDayKey,
  sameDay,
  startOfWeek,
  toLocalInput,
} from '../format.js';
import { useBureau } from '../state.js';

/** Drop where the pointer is; fall back to overlap for keyboard dragging. */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const UNSCHEDULED = 'unscheduled';

function when(item: QueueItem): string | undefined {
  return item.publishedAt ?? item.scheduledAt;
}

export function ScheduleView() {
  const { overview, itemsById, storyOf, schedule, cascade, setCascade } = useBureau();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [mode, setMode] = useState<'week' | 'list'>('week');
  const [hidden, setHidden] = useState<Set<Platform>>(new Set());
  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [dragging, setDragging] = useState<string>();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const items = useMemo(
    () => (overview?.items ?? []).filter((item) => !hidden.has(item.platform)),
    [overview, hidden],
  );
  const platforms = useMemo(
    () => [...new Set((overview?.channels ?? []).map((c) => c.platform))],
    [overview],
  );

  const focus = hovered ?? selected;
  const highlighted = useMemo(
    () => new Set(focus ? (storyOf.get(focus)?.itemIds ?? [focus]) : []),
    [focus, storyOf],
  );
  const warned = useMemo(
    () => new Set((overview?.stories ?? []).flatMap((s) => s.warnings.map((w) => w.itemId))),
    [overview],
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const unscheduled = items.filter((item) => !when(item) && item.status !== 'published');

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(undefined);
    const item = itemsById.get(String(event.active.id));
    const target = event.over?.id ? String(event.over.id) : undefined;
    if (!item || !target) return;

    if (target === UNSCHEDULED) {
      if (item.scheduledAt) void schedule(item, null);
      return;
    }
    const [, key, hour] = target.split(':') as [string, string, string];
    const at = parseDayKey(key);
    // Keep the item's minutes so dragging between hours is a clean move;
    // minute precision lives in the details panel.
    const minutes = item.scheduledAt ? new Date(item.scheduledAt).getMinutes() : 0;
    at.setHours(Number(hour), minutes, 0, 0);
    void schedule(item, at.toISOString());
  };

  const selectedItem = selected ? itemsById.get(selected) : undefined;
  const draggingItem = dragging ? itemsById.get(dragging) : undefined;

  return (
    <div className={`schedule ${selectedItem ? 'with-panel' : ''}`}>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="View">
          <button aria-pressed={mode === 'week'} onClick={() => setMode('week')}>
            Calendar
          </button>
          <button aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
            Queue
          </button>
        </div>
        {mode === 'week' && (
          <div className="week-nav">
            <button aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              ‹
            </button>
            <button onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</button>
            <button aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
              ›
            </button>
            <span className="week-label">
              {formatDate(weekStart)} – {formatDate(addDays(weekStart, 6))}
            </span>
          </div>
        )}
        <div className="filters" role="group" aria-label="Platforms">
          {platforms.map((platform) => (
            <button
              key={platform}
              className="chip-toggle"
              aria-pressed={!hidden.has(platform)}
              onClick={() => {
                const next = new Set(hidden);
                if (next.has(platform)) next.delete(platform);
                else next.add(platform);
                setHidden(next);
              }}
            >
              <PlatformDot platform={platform} /> {PLATFORMS[platform].label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
          Move related items too
        </label>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={(event) => setDragging(String(event.active.id))}
        onDragCancel={() => setDragging(undefined)}
        onDragEnd={onDragEnd}
      >
        <div className="schedule-body">
          {mode === 'week' ? (
            <WeekGrid
              days={days}
              items={items}
              highlighted={highlighted}
              warned={warned}
              storyOf={(id) => storyOf.has(id)}
              onSelect={setSelected}
              onHover={setHovered}
            />
          ) : (
            <QueueList items={items} warned={warned} onSelect={setSelected} />
          )}

          <Tray
            items={unscheduled}
            highlighted={highlighted}
            warned={warned}
            storyOf={(id) => storyOf.has(id)}
            onSelect={setSelected}
            onHover={setHovered}
            active={Boolean(draggingItem?.scheduledAt)}
          />
        </div>

        <DragOverlay dropAnimation={null} className="drag-overlay">
          {draggingItem && (
            <ChipBody
              item={draggingItem}
              linked={storyOf.has(draggingItem.id)}
              warned={warned.has(draggingItem.id)}
            />
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

interface ChipListProps {
  highlighted: Set<string>;
  warned: Set<string>;
  storyOf: (id: string) => boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | undefined) => void;
}

function WeekGrid({ days, items, ...chip }: ChipListProps & { days: Date[]; items: QueueItem[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = new Date();

  useEffect(() => {
    // Open on the working day rather than midnight.
    const row = scroller.current?.querySelector<HTMLElement>('[data-hour="7"]');
    if (scroller.current && row) {
      const head = scroller.current.querySelector<HTMLElement>('.day-head')?.offsetHeight ?? 0;
      scroller.current.scrollTop = row.offsetTop - head;
    }
  }, []);

  const byCell = useMemo(() => {
    const map = new Map<string, QueueItem[]>();
    for (const item of items) {
      const stamp = when(item);
      if (!stamp) continue;
      const d = new Date(stamp);
      const key = `${dayKey(d)}:${d.getHours()}`;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => when(a)!.localeCompare(when(b)!));
    return map;
  }, [items]);

  return (
    <div className="week" ref={scroller}>
      <div className="week-grid" role="grid" aria-label="Week schedule">
        <div className="corner" />
        {days.map((day) => {
          const count = HOURS.reduce(
            (n, h) => n + (byCell.get(`${dayKey(day)}:${h}`)?.length ?? 0),
            0,
          );
          return (
            <div
              key={dayKey(day)}
              className={`day-head ${sameDay(day, now) ? 'today' : ''}`}
              role="columnheader"
            >
              {formatDay(day)}
              {count > 0 && <span className="count">{count}</span>}
            </div>
          );
        })}
        {HOURS.map((hour) => (
          <HourRow key={hour} hour={hour} days={days} byCell={byCell} now={now} {...chip} />
        ))}
      </div>
    </div>
  );
}

function HourRow({
  hour,
  days,
  byCell,
  now,
  ...chip
}: ChipListProps & { hour: number; days: Date[]; byCell: Map<string, QueueItem[]>; now: Date }) {
  return (
    <>
      <div className="hour-label" data-hour={hour}>
        {String(hour).padStart(2, '0')}:00
      </div>
      {days.map((day) => {
        const start = new Date(day);
        start.setHours(hour, 0, 0, 0);
        const end = new Date(day);
        end.setHours(hour + 1, 0, 0, 0);
        return (
          <Cell
            key={dayKey(day)}
            id={`slot:${dayKey(day)}:${hour}`}
            start={start}
            past={end.getTime() <= now.getTime()}
            items={byCell.get(`${dayKey(day)}:${hour}`) ?? []}
            {...chip}
          />
        );
      })}
    </>
  );
}

function Cell({
  id,
  start,
  past,
  items,
  ...chip
}: ChipListProps & { id: string; start: Date; past: boolean; items: QueueItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: past });
  const cell = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      cell.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  // A click on the cell's own empty space opens the new-post menu. Clicks on
  // a chip select that item instead, so they are left alone.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!cell.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div
      ref={attach}
      className={`cell ${past ? 'past' : ''} ${isOver ? 'over' : ''}`}
      role="gridcell"
      onClick={(event) => {
        if (!past && event.target === event.currentTarget) setMenuOpen((open) => !open);
      }}
    >
      {items.map((item) => (
        <Chip key={item.id} item={item} {...chip} />
      ))}
      {menuOpen && <CellMenu at={start} />}
    </div>
  );
}

function Chip({
  item,
  highlighted,
  warned,
  storyOf,
  onSelect,
  onHover,
}: ChipListProps & { item: QueueItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    disabled: !item.reschedulable,
  });
  const time = when(item);
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={[
        'chip',
        `chip-${item.status}`,
        isArticle(item.platform) ? 'chip-article' : 'chip-post',
        highlighted.has(item.id) ? 'highlight' : '',
        isDragging ? 'dragging' : '',
        item.reschedulable ? 'movable' : '',
      ].join(' ')}
      style={
        {
          '--chip-ink': `var(--series-${PLATFORMS[item.platform].slot})`,
          '--chip-soft': `var(--series-${PLATFORMS[item.platform].slot}-soft)`,
        } as CSSProperties
      }
      onClick={() => onSelect(item.id)}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(undefined)}
      onFocus={() => onHover(item.id)}
      onBlur={() => onHover(undefined)}
      title={`${PLATFORMS[item.platform].label}: ${item.title}${time ? ` (${formatDateTime(time)})` : ''}`}
      aria-roledescription={item.reschedulable ? 'draggable item' : undefined}
    >
      <ChipBody item={item} linked={storyOf(item.id)} warned={warned.has(item.id)} />
    </button>
  );
}

function ChipBody({ item, linked, warned }: { item: QueueItem; linked: boolean; warned: boolean }) {
  const time = when(item);
  return (
    <span className="chip-body">
      <span className="chip-meta">
        <PlatformDot platform={item.platform} />
        <span className="chip-time">
          {time ? formatTime(time) : PLATFORMS[item.platform].label}
        </span>
        {warned && <Icon name="warn" />}
        {linked && <Icon name="link" />}
        {item.status === 'published' && <Icon name="lock" />}
      </span>
      <span className="chip-title">{item.title}</span>
    </span>
  );
}

function Tray({ items, active, ...chip }: ChipListProps & { items: QueueItem[]; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULED });
  return (
    <section
      ref={setNodeRef}
      className={`tray ${isOver ? 'over' : ''} ${active ? 'accepting' : ''}`}
      aria-label="Unscheduled items"
    >
      <h2>Unscheduled</h2>
      <p className="muted small">Drag onto the calendar to schedule. Drop here to remove a time.</p>
      {items.length === 0 && <p className="muted small">Nothing waiting.</p>}
      <div className="tray-items">
        {items.map((item) => (
          <Chip key={item.id} item={item} {...chip} />
        ))}
      </div>
    </section>
  );
}

/** The manual view: every unpublished item with a time field of its own. */
function QueueList({
  items,
  warned,
  onSelect,
}: {
  items: QueueItem[];
  warned: Set<string>;
  onSelect: (id: string) => void;
}) {
  const { overview, storyOf, itemsById } = useBureau();
  const channels = new Map((overview?.channels ?? []).map((c) => [c.id, c]));
  const queue = items
    .filter((item) => item.status !== 'published')
    .sort((a, b) => (a.scheduledAt ?? '9').localeCompare(b.scheduledAt ?? '9'));

  return (
    <div className="queue">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Channel</th>
            <th scope="col">Status</th>
            <th scope="col">Publishing time</th>
            <th scope="col">Story</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((item) => {
            const story = storyOf.get(item.id);
            const anchor = story ? itemsById.get(story.anchorId) : undefined;
            return (
              <tr key={item.id}>
                <td>
                  <button className="link-button row-title" onClick={() => onSelect(item.id)}>
                    {warned.has(item.id) && <Icon name="warn" />} {item.title}
                  </button>
                </td>
                <td>
                  <PlatformBadge platform={item.platform} />
                  <div className="muted small">{channels.get(item.channelId)?.name}</div>
                </td>
                <td>
                  <StatusPill status={item.status} />
                </td>
                <td>
                  <TimeField item={item} />
                </td>
                <td className="small">
                  {anchor && anchor.id !== item.id ? (
                    <button className="link-button" onClick={() => onSelect(anchor.id)}>
                      <Icon name="link" /> {anchor.title}
                    </button>
                  ) : story ? (
                    <span className="muted">
                      <Icon name="link" /> {story.itemIds.length - 1} related
                    </span>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TimeField({ item }: { item: QueueItem }) {
  const { schedule } = useBureau();
  const [value, setValue] = useState(toLocalInput(item.scheduledAt));
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(toLocalInput(item.scheduledAt)), [item.scheduledAt]);

  if (!item.reschedulable) return <span className="muted small">Locked</span>;
  const parsed = fromLocalInput(value);
  const dirty =
    (parsed ?? null) !== (item.scheduledAt ? new Date(item.scheduledAt).toISOString() : null);

  const save = async (at: string | null) => {
    setBusy(true);
    const ok = await schedule(item, at);
    if (!ok) setValue(toLocalInput(item.scheduledAt));
    setBusy(false);
  };

  return (
    <form
      className="inline-time"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty) void save(parsed ?? null);
      }}
    >
      <input
        type="datetime-local"
        aria-label={`Publishing time for ${item.title}`}
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
      />
      {dirty && (
        <button type="submit" className="primary small" disabled={busy}>
          {parsed ? 'Save' : 'Clear'}
        </button>
      )}
      {!dirty && item.scheduledAt && (
        <button
          type="button"
          className="link-button small"
          disabled={busy}
          onClick={() => void save(null)}
        >
          Remove
        </button>
      )}
    </form>
  );
}
