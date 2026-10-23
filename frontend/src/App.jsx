import { useState } from 'react';

function errorMessage(data) {
  if (!data || typeof data !== 'object') {
    return 'We could not set your password. Please try again.';
  }
  if (typeof data.detail === 'string') {
    return data.detail;
  }

  const messages = Object.values(data)
    .flat(Infinity)
    .filter((message) => typeof message === 'string');

  return messages.join(' ') || 'We could not set your password. Please try again.';
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid') || '';
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  async function submitPassword(event) {
    event.preventDefault();
    setMessage('');

    if (!uid || !token) {
      setIsError(true);
      setMessage('This invitation link is incomplete. Ask HR to send a new invite.');
      return;
    }

    if (password !== confirmation) {
      setIsError(true);
      setMessage('The passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/accounts/set-password/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, token, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(errorMessage(data));
      }

      setComplete(true);
    } catch (error) {
      setIsError(true);
      setMessage(error.message || 'Unable to reach Bayyinah. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <a className="brand auth-brand" href="/" aria-label="Bayyinah home">
        <img className="brand-logo" src="/bayyinah-logo.png" alt="" />
        <span>Bayyinah <span className="brand-arabic">بينة</span></span>
      </a>
      <section className="auth-card password-card" aria-labelledby="page-title">
        <span className="auth-kicker">ACCOUNT SETUP</span>
        {complete ? (
          <>
            <h1 id="page-title">You’re all set</h1>
            <p className="auth-description">
              Your password has been saved. You can now sign in to your Bayyinah account.
            </p>
            <a className="button button-primary auth-submit password-login-link" href="/login">Go to log in</a>
          </>
        ) : (
          <>
            <h1 id="page-title">Set your password</h1>
            <p className="auth-description">
              Choose a password to finish setting up your account.
            </p>
            {!token && (
              <p className="notice error" role="alert">
                This invitation link is incomplete. Ask HR to send a new invite.
              </p>
            )}
            {message && (
              <p className={`notice ${isError ? 'error' : ''}`} role="alert">
                {message}
              </p>
            )}
            <form onSubmit={submitPassword}>
              <label htmlFor="password">New password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength="8"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <p className="auth-description">Use at least 8 characters, including one uppercase letter and one number. Avoid common passwords.</p>
              <label htmlFor="confirmation">Confirm password</label>
              <input
                id="confirmation"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
              <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting || !uid || !token}>
                {isSubmitting ? 'Saving password…' : 'Set password'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
