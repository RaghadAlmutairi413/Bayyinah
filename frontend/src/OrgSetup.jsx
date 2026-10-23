import { useState } from 'react';
import { responseData, saveLogin } from './api.js';

export default function OrgSetup() {
  const [form, setForm] = useState({
    organization_name: '',
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm_password: '',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirm_password) {
      setError('The passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/accounts/setup/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_name: form.organization_name,
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          password: form.password,
        }),
      });
      const login = await responseData(response);
      saveLogin(login);
      window.location.assign('/dashboard/hr');
    } catch (requestError) {
      setError(requestError.message || 'Organization setup failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page setup-page">
      <a className="brand auth-brand" href="/" aria-label="Bayyinah home"><img className="brand-logo" src="/bayyinah-logo.png" alt="" /><span>Bayyinah <span className="brand-arabic">بينة</span></span></a>
      <section className="auth-card setup-card">
        <span className="auth-kicker">YOUR WORKSPACE STARTS HERE</span>
        <h1>Set up your organization.</h1>
        <p className="auth-description">
          Create your organization and HR administrator account. You’ll be able to
          add departments and invite your team next.
        </p>
        {error && <p className="notice error" role="alert">{error}</p>}
        <form onSubmit={submit}>
          <label htmlFor="organization-name">Organization name</label>
          <input id="organization-name" type="text" maxLength="255" autoComplete="organization" value={form.organization_name} onChange={(event) => update('organization_name', event.target.value)} required />
          <div className="form-two-columns">
            <div>
              <label htmlFor="admin-first-name">First name</label>
              <input id="admin-first-name" type="text" maxLength="255" autoComplete="given-name" value={form.first_name} onChange={(event) => update('first_name', event.target.value)} required />
            </div>
            <div>
              <label htmlFor="admin-last-name">Last name</label>
              <input id="admin-last-name" type="text" maxLength="255" autoComplete="family-name" value={form.last_name} onChange={(event) => update('last_name', event.target.value)} required />
            </div>
          </div>
          <label htmlFor="admin-email">Work email</label>
          <input id="admin-email" type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} required />
          <div className="form-two-columns">
            <div>
              <label htmlFor="setup-password">Create password</label>
              <input id="setup-password" type="password" autoComplete="new-password" minLength="8" value={form.password} onChange={(event) => update('password', event.target.value)} required />
            </div>
            <div>
              <label htmlFor="confirm-password">Confirm password</label>
              <input id="confirm-password" type="password" autoComplete="new-password" value={form.confirm_password} onChange={(event) => update('confirm_password', event.target.value)} required />
            </div>
            <p className="auth-description">Use at least 8 characters, including one uppercase letter and one number. Avoid common passwords.</p>
          </div>
          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating workspace…' : 'Create organization'}
          </button>
        </form>
        <p className="auth-switch">Already have an account? <a href="/login">Log in</a></p>
      </section>
      <p className="auth-footnote">Your information is handled by your organization’s workspace.</p>
    </main>
  );
}
