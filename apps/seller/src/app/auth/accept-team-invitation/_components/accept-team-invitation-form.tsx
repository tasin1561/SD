'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';

/**
 * Team-invitation acceptance form. Posts to
 * /auth/seller/accept-team-invitation. On 200 the API sets the
 * __Host-sellerRefresh cookie via Set-Cookie passed through the
 * Next.js proxy; we then hard-nav to /dashboard.
 *
 * FE-2: server rejection surfaces [CODE] message verbatim.
 */
interface FormState {
  readonly fullName: string;
  readonly password: string;
  readonly confirmPassword: string;
}

const INITIAL: FormState = {
  fullName: '',
  password: '',
  confirmPassword: '',
};

export function AcceptTeamInvitationForm({ token }: { readonly token: string }): ReactElement {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (form.password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);

    const body = {
      token,
      fullName: form.fullName.trim(),
      password: form.password,
    };

    try {
      const store = new AccessTokenStore();
      const client = new ApiClient({
        identityKind: 'seller',
        tokenStore: store,
      });
      await client.request('/api/auth/seller/accept-team-invitation', {
        method: 'POST',
        body,
      });
      window.location.assign('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        const b = err.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : err.message;
        setError(code ? `[${code}] ${msg}` : msg);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Accept failed.');
      }
      setSubmitting(false);
    }
  }

  const fieldClass =
    'w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors disabled:opacity-50';
  const labelClass = 'block text-text-muted text-xs mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="full-name" className={labelClass}>
          Full name
        </label>
        <input
          id="full-name"
          type="text"
          required
          minLength={1}
          maxLength={120}
          placeholder="Your full name"
          value={form.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          disabled={submitting}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          Password <span className="text-text-faint">(min 12 characters)</span>
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            disabled={submitting}
            className={`${fieldClass} pr-9`}
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            tabIndex={-1}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-body transition-colors p-1 rounded-[3px]"
          >
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      <div>
        <label htmlFor="confirm-password" className={labelClass}>
          Confirm password
        </label>
        <div className="relative">
          <input
            id="confirm-password"
            type={showConfirmPw ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
            value={form.confirmPassword}
            onChange={(e) => set('confirmPassword', e.target.value)}
            disabled={submitting}
            className={`${fieldClass} pr-9`}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPw((s) => !s)}
            tabIndex={-1}
            aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-body transition-colors p-1 rounded-[3px]"
          >
            {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[5px]">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full mt-2 px-3 py-1.5 rounded-[5px] bg-accent-fill text-accent-fg text-sm font-medium hover:bg-accent-fill-hover disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Joining…' : 'Accept invitation'}
      </button>
    </form>
  );
}
