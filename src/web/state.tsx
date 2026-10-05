import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { QueueItem, Story } from '../core/types.js';
import { api, type Overview } from './api.js';
import { formatDateTime } from './format.js';

export interface Toast {
  id: number;
  tone: 'info' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

interface BureauContext {
  overview: Overview | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => Promise<void>;
  itemsById: Map<string, QueueItem>;
  storyOf: Map<string, Story>;
  /** Move related items with the one being rescheduled. */
  cascade: boolean;
  setCascade: (value: boolean) => void;
  schedule: (item: QueueItem, at: string | null) => Promise<boolean>;
  link: (itemIds: string[]) => Promise<void>;
  unlink: (relationshipId: string, message?: string) => Promise<void>;
  toasts: Toast[];
  notify: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

const Context = createContext<BureauContext | null>(null);

let nextToast = 1;

function readCascade(): boolean {
  try {
    return localStorage.getItem('bureau.cascade') !== 'false';
  } catch {
    return true;
  }
}

export function BureauProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<Overview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [cascade, setCascadeState] = useState(readCascade);

  const setCascade = useCallback((value: boolean) => {
    setCascadeState(value);
    try {
      localStorage.setItem('bureau.cascade', String(value));
    } catch {
      // Preference only; nothing to do without storage.
    }
  }, []);

  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  );

  const notify = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextToast++;
      setToasts((all) => [...all.slice(-3), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.action ? 8000 : 5000);
    },
    [dismiss],
  );

  const reload = useCallback(async () => {
    try {
      setOverview(await api.overview());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const itemsById = useMemo(
    () => new Map((overview?.items ?? []).map((i) => [i.id, i])),
    [overview],
  );
  const storyOf = useMemo(() => {
    const map = new Map<string, Story>();
    for (const story of overview?.stories ?? []) for (const id of story.itemIds) map.set(id, story);
    return map;
  }, [overview]);

  const schedule = useCallback(
    async (item: QueueItem, at: string | null): Promise<boolean> => {
      const previous = item.scheduledAt ?? null;
      if (previous === at) return true;
      try {
        const result = await api.schedule(item.id, at, cascade);
        await reload();
        const moved = result.changes.length - 1;
        const what = at ? `Moved to ${formatDateTime(at)}` : 'Publishing time removed';
        const extra = moved > 0 ? `, with ${moved} related item${moved === 1 ? '' : 's'}` : '';
        const skipped = result.skipped.length
          ? ` (${result.skipped.length} related item${result.skipped.length === 1 ? '' : 's'} left in place)`
          : '';
        notify({
          tone: 'info',
          message: `${item.title}: ${what}${extra}${skipped}`,
          action: {
            label: 'Undo',
            run: () => {
              void (async () => {
                try {
                  // Put back every item that moved, the dragged one last.
                  for (const change of [...result.changes].reverse()) {
                    await api.schedule(change.itemId, change.from ?? null, false);
                  }
                  await reload();
                  notify({ tone: 'info', message: 'Change undone' });
                } catch (e) {
                  notify({ tone: 'error', message: `Could not undo: ${(e as Error).message}` });
                }
              })();
            },
          },
        });
        return true;
      } catch (e) {
        notify({ tone: 'error', message: (e as Error).message });
        return false;
      }
    },
    [cascade, notify, reload],
  );

  const link = useCallback(
    async (itemIds: string[]) => {
      try {
        await api.link(itemIds);
        await reload();
        notify({ tone: 'info', message: `Linked ${itemIds.length} items` });
      } catch (e) {
        notify({ tone: 'error', message: (e as Error).message });
      }
    },
    [notify, reload],
  );

  const unlink = useCallback(
    async (relationshipId: string, message = 'Link removed') => {
      try {
        await api.unlink(relationshipId);
        await reload();
        notify({ tone: 'info', message });
      } catch (e) {
        notify({ tone: 'error', message: (e as Error).message });
      }
    },
    [notify, reload],
  );

  const value: BureauContext = {
    overview,
    loading,
    error,
    reload,
    itemsById,
    storyOf,
    cascade,
    setCascade,
    schedule,
    link,
    unlink,
    toasts,
    notify,
    dismiss,
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBureau(): BureauContext {
  const context = useContext(Context);
  if (!context) throw new Error('useBureau outside BureauProvider');
  return context;
}
