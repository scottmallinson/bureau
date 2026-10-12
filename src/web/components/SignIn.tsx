import { useState, type FormEvent } from 'react';
import { api } from '../api.js';
import { Icon } from './common.js';

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.login(password);
      setError(undefined);
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="sign-in">
      <form onSubmit={(e) => void submit(e)}>
        <div className="brand">
          <span className="logo" aria-hidden />
          Bureau
        </div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="error-text" role="alert">
            <Icon name="warn" /> {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy || !password}>
          Sign in
        </button>
      </form>
    </div>
  );
}
