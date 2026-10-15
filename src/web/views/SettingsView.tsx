import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { UpdateState } from '../../core/updates.js';
import {
  api,
  type IntegrationForm,
  type IntegrationId,
  type IntegrationSource,
  type IntegrationStatus,
} from '../api.js';
import { Icon } from '../components/common.js';
import { desktop } from '../desktop.js';
import { formatDateTime } from '../format.js';
import { useBureau } from '../state.js';

interface Field {
  name: string;
  label: string;
  hint: ReactNode;
  secret?: boolean;
  placeholder?: string;
  optional?: boolean;
}

const INTEGRATIONS: Record<IntegrationId, { title: string; fields: Field[] }> = {
  ghost: {
    title: 'Ghost',
    fields: [
      {
        name: 'url',
        label: 'Site URL',
        hint: "Your site's address, as readers see it.",
        placeholder: 'https://example.com',
      },
      {
        name: 'adminApiKey',
        label: 'Admin API key',
        hint: (
          <>
            In Ghost Admin, <em>Settings › Integrations › Add custom integration</em>. Copy the
            Admin API key, which looks like <code>id:secret</code>.
          </>
        ),
        secret: true,
      },
    ],
  },
  buffer: {
    title: 'Buffer',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        hint: (
          <>
            Generate one at{' '}
            <a href="https://publish.buffer.com/settings/api" target="_blank" rel="noreferrer">
              publish.buffer.com/settings/api
            </a>
            .
          </>
        ),
        secret: true,
      },
      {
        name: 'organizationId',
        label: 'Organisation ID',
        hint: 'The Buffer organisation whose channels Bureau should show.',
      },
      {
        name: 'apiUrl',
        label: 'API URL',
        hint: 'Leave blank unless Buffer has told you to use another endpoint.',
        placeholder: 'https://api.buffer.com',
        optional: true,
      },
    ],
  },
};

const SOURCE_LABEL: Record<IntegrationSource, string> = {
  environment: 'Set by environment variables',
  settings: 'Connected',
  demo: 'Demo data',
};

function initialForm(id: IntegrationId, status: IntegrationStatus): IntegrationForm {
  if (id === 'ghost') return { url: status.ghost.url ?? '', adminApiKey: '' };
  const apiUrl =
    status.buffer.apiUrl === 'https://api.buffer.com' ? '' : (status.buffer.apiUrl ?? '');
  return { apiKey: '', organizationId: status.buffer.organizationId ?? '', apiUrl };
}

function IntegrationCard({
  id,
  status,
  onChange,
}: {
  id: IntegrationId;
  status: IntegrationStatus;
  onChange: (status: IntegrationStatus) => void;
}) {
  const { notify, reload } = useBureau();
  const { title, fields } = INTEGRATIONS[id];
  const current = status[id];
  const locked = current.source === 'environment';
  const [form, setForm] = useState(() => initialForm(id, status));
  const [busy, setBusy] = useState<'save' | 'test' | 'clear'>();
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; message: string }>();

  const run = async (kind: 'save' | 'test' | 'clear', action: () => Promise<void>) => {
    setBusy(kind);
    setResult(undefined);
    try {
      await action();
    } catch (e) {
      setResult({ tone: 'error', message: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run('save', async () => {
      const next = await api.saveIntegration(id, form);
      onChange(next);
      setForm(initialForm(id, next));
      await reload();
      notify({ tone: 'info', message: `${title} connected` });
    });
  };

  const test = () =>
    run('test', async () => {
      const { channels, items } = await api.testIntegration(id, form);
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      setResult({
        tone: 'ok',
        message: `Connected: ${plural(channels, 'channel')}, ${plural(items, 'unpublished item')}.`,
      });
    });

  const clear = () =>
    run('clear', async () => {
      const next = await api.clearIntegration(id);
      onChange(next);
      setForm(initialForm(id, next));
      await reload();
      notify({ tone: 'info', message: `${title} disconnected: showing demo data` });
    });

  return (
    <section className="card settings-card" aria-labelledby={`settings-${id}`}>
      <div className="settings-head">
        <h2 id={`settings-${id}`}>{title}</h2>
        <span className={`source-badge ${current.source === 'demo' ? 'mock' : 'live'}`}>
          {status.forcedDemo ? 'Demo data (BUREAU_MOCK)' : SOURCE_LABEL[current.source]}
        </span>
      </div>
      {current.error && (
        <p className="error-text" role="alert">
          <Icon name="warn" /> {current.error}
        </p>
      )}
      {locked ? (
        <p className="muted">
          {title} is configured by environment variables, which take precedence over Settings.
          Change them where Bureau is deployed.
        </p>
      ) : (
        <form className="settings-form" onSubmit={save}>
          {fields.map((field) => (
            <label key={field.name} className="field">
              <span className="field-label">
                {field.label}
                {field.optional && <span className="muted"> (optional)</span>}
              </span>
              <input
                type={field.secret ? 'password' : 'text'}
                name={field.name}
                value={form[field.name] ?? ''}
                placeholder={
                  field.secret && current.keySet
                    ? 'Saved. Leave blank to keep it'
                    : (field.placeholder ?? '')
                }
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
              />
              <span className="field-hint small muted">{field.hint}</span>
            </label>
          ))}
          {result && (
            <p className={result.tone === 'ok' ? 'ok-text' : 'error-text'} role="status">
              {result.tone === 'error' && <Icon name="warn" />} {result.message}
            </p>
          )}
          <div className="row settings-actions">
            <button type="submit" className="primary" disabled={busy !== undefined}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" disabled={busy !== undefined} onClick={() => void test()}>
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </button>
            {current.source === 'settings' && (
              <button
                type="button"
                className="link-button"
                disabled={busy !== undefined}
                onClick={() => void clear()}
              >
                Disconnect
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function describeUpdate(state: UpdateState): string {
  switch (state.status) {
    case 'idle':
      return 'Not checked yet.';
    case 'unsupported':
      return state.reason;
    case 'checking':
      return 'Checking for updates…';
    case 'current':
      return `Bureau is up to date. Last checked ${formatDateTime(state.checkedAt)}.`;
    case 'downloading':
      return `Downloading version ${state.next}… ${state.percent}%`;
    case 'ready':
      return `Version ${state.next} is ready. It installs when Bureau restarts.`;
    case 'error':
      return `Could not check for updates: ${state.message}`;
  }
}

function UpdatesCard() {
  const [state, setState] = useState<UpdateState>();

  useEffect(() => {
    if (!desktop) return;
    void desktop.updates.state().then(setState);
    return desktop.updates.onChange(setState);
  }, []);

  if (!desktop || !state) return null;
  const busy = state.status === 'checking' || state.status === 'downloading';

  return (
    <section className="card settings-card" aria-labelledby="settings-updates">
      <div className="settings-head">
        <h2 id="settings-updates">Updates</h2>
        <span className="muted small">Version {state.version}</span>
      </div>
      <p className={state.status === 'error' ? 'error-text' : 'muted'} role="status">
        {describeUpdate(state)}
      </p>
      <div className="row settings-actions">
        {state.status === 'ready' ? (
          <button className="primary" onClick={() => void desktop!.updates.install()}>
            Restart and update
          </button>
        ) : (
          <button
            disabled={busy || state.status === 'unsupported'}
            onClick={() => void desktop!.updates.check().then(setState)}
          >
            Check for updates
          </button>
        )}
      </div>
    </section>
  );
}

export function SettingsView() {
  const [status, setStatus] = useState<IntegrationStatus>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setStatus(await api.integrations());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="settings">
      <p className="muted settings-intro">
        Connect Ghost and Buffer to work on your real schedule. Until one is connected, Bureau shows
        demo data for it. Keys are stored with Bureau's data
        {desktop ? ", encrypted with this computer's keychain" : ''}, and are never shown again once
        saved.
      </p>
      {error && (
        <p className="banner error">
          <Icon name="warn" /> {error}
        </p>
      )}
      {status &&
        (['ghost', 'buffer'] as const).map((id) => (
          <IntegrationCard key={id} id={id} status={status} onChange={setStatus} />
        ))}
      <UpdatesCard />
    </div>
  );
}
