import type { ItemStatus, Platform } from '../../core/types.js';
import { PLATFORMS } from '../../core/platforms.js';
import { useBureau } from '../state.js';

/** Ghost carries the articles; every other platform carries posts about them. */
export function isArticle(platform: Platform): boolean {
  return platform === 'ghost';
}

export function PlatformDot({ platform }: { platform: Platform }) {
  return (
    <span
      className={isArticle(platform) ? 'dot article' : 'dot'}
      style={{ background: `var(--series-${PLATFORMS[platform].slot})` }}
      aria-hidden
    />
  );
}

/** The Bureau mark: two offset bars crossed by the shared time axis. */
export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={(size * 22) / 30}
      height={size}
      viewBox="0 0 22 30"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <rect
        x="1.1"
        y="4.1"
        width="19.8"
        height="21.8"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <rect x="10.25" y="0" width="1.5" height="30" rx="0.75" fill="currentColor" opacity="0.5" />
      <rect x="4.4" y="8.8" width="7.4" height="3" rx="1.5" fill="currentColor" />
      <rect x="10.2" y="18.2" width="7.4" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span className="platform">
      <PlatformDot platform={platform} />
      {PLATFORMS[platform].label}
    </span>
  );
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  draft: 'Unscheduled',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
};

export function StatusPill({ status }: { status: ItemStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Toasts() {
  const { toasts, dismiss } = useBureau();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="link-button"
              onClick={() => {
                toast.action!.run();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="icon-button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Icon({ name }: { name: 'link' | 'warn' | 'lock' | 'external' | 'grip' }) {
  const paths: Record<typeof name, string> = {
    link: 'M6.5 9.5l3-3M7 4.5l1.2-1.2a2.5 2.5 0 013.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 01-3.5-3.5L5.5 8',
    warn: 'M8 2.5l6 10.5H2L8 2.5zM8 6.5v3M8 11.2v.3',
    lock: 'M4.5 7.5h7v5.5h-7zM6 7.5V5.5a2 2 0 014 0v2',
    external: 'M9.5 3h3.5v3.5M13 3L7.5 8.5M11 9.5V13H3V5h3.5',
    grip: 'M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01',
  };
  return (
    <svg className={`icon icon-${name}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth={name === 'grip' ? 2.4 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
