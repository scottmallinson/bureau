import { useEffect, useState } from 'react';
import { Icon, Toasts } from './components/common.js';
import { BureauProvider, useBureau } from './state.js';
import { AnalyticsView } from './views/AnalyticsView.js';
import { ScheduleView } from './views/ScheduleView.js';
import { StoriesView } from './views/StoriesView.js';

const TABS = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'stories', label: 'Stories' },
  { id: 'analytics', label: 'Analytics' },
] as const;

type Tab = (typeof TABS)[number]['id'];

function tabFromHash(): Tab {
  const hash = window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === hash) ? (hash as Tab) : 'schedule';
}

function Shell() {
  const { overview, loading, error, reload } = useBureau();
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const warnings = overview?.stories.reduce((n, s) => n + s.warnings.length, 0) ?? 0;
  const suggestions = overview?.suggestions.length ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          Bureau
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? 'page' : undefined}>
              {t.label}
              {t.id === 'schedule' && warnings > 0 && (
                <span
                  className="badge warn"
                  title={`${warnings} timing warning${warnings === 1 ? '' : 's'}`}
                >
                  {warnings}
                </span>
              )}
              {t.id === 'stories' && suggestions > 0 && (
                <span
                  className="badge"
                  title={`${suggestions} possible link${suggestions === 1 ? '' : 's'}`}
                >
                  {suggestions}
                </span>
              )}
            </a>
          ))}
        </nav>
        <div className="sources">
          {overview?.providers.map((p) => (
            <span
              key={p.id}
              className={`source-badge ${p.error ? 'error' : p.mode}`}
              title={
                p.error ??
                (p.mode === 'mock' ? 'No credentials configured: showing demo data' : 'Connected')
              }
            >
              {p.error && <Icon name="warn" />}
              {p.id === 'ghost' ? 'Ghost' : 'Buffer'}
              {p.mode === 'mock' ? ' · demo' : ''}
            </span>
          ))}
          <button
            className="icon-button"
            onClick={() => void reload()}
            aria-label="Reload"
            title="Reload"
          >
            ↻
          </button>
        </div>
      </header>

      <main>
        {error && (
          <p className="banner error">
            <Icon name="warn" /> {error}
          </p>
        )}
        {overview?.providers
          .filter((p) => p.error)
          .map((p) => (
            <p key={p.id} className="banner error">
              <Icon name="warn" /> {p.id === 'ghost' ? 'Ghost' : 'Buffer'} could not be reached:{' '}
              {p.error}
            </p>
          ))}
        {loading && !overview ? (
          <p className="muted pad">Loading…</p>
        ) : tab === 'schedule' ? (
          <ScheduleView />
        ) : tab === 'stories' ? (
          <StoriesView />
        ) : (
          <AnalyticsView />
        )}
      </main>
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <BureauProvider>
      <Shell />
    </BureauProvider>
  );
}
