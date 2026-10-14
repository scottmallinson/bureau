import { useState } from 'react';
import type { ProviderName } from '../api.js';
import { authClient } from '../auth.js';
import { Icon } from './common.js';

const LABELS: Record<ProviderName, string> = {
  google: 'Google',
  github: 'GitHub',
  microsoft: 'Microsoft',
  linkedin: 'LinkedIn',
};

const ERRORS: Record<string, string> = {
  not_allowed: 'That account is not allowed to use Bureau.',
};

/** Better Auth sends a failed sign-in back here with `?error=`. */
function errorFromUrl(): string | undefined {
  const code = new URLSearchParams(window.location.search).get('error');
  if (!code) return undefined;
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  return ERRORS[code] ?? `Sign-in failed (${code.replace(/_/g, ' ')}).`;
}

export function SignIn({ providers }: { providers: ProviderName[] }) {
  const [busy, setBusy] = useState<ProviderName>();
  const [error, setError] = useState(errorFromUrl);

  async function signIn(provider: ProviderName) {
    setBusy(provider);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: window.location.pathname + window.location.hash,
    });
    // On success the browser is already leaving for the provider.
    if (error) {
      setError(error.message ?? 'Sign-in failed.');
      setBusy(undefined);
    }
  }

  return (
    <div className="sign-in">
      <div className="sign-in-card">
        <div className="brand">
          <span className="logo" aria-hidden />
          Bureau
        </div>
        {error && (
          <p className="error-text" role="alert">
            <Icon name="warn" /> {error}
          </p>
        )}
        {providers.map((provider) => (
          <button
            key={provider}
            type="button"
            disabled={busy !== undefined}
            onClick={() => void signIn(provider)}
          >
            Continue with {LABELS[provider]}
          </button>
        ))}
      </div>
    </div>
  );
}
