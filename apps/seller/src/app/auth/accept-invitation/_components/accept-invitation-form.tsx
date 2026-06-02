'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';

/**
 * Seller invitation acceptance form. Mirrors LoginForm's pattern
 * (one-shot ApiClient instantiated locally because the auth-provider
 * mounts only under (authed)), but posts to /seller/auth/register/invite
 * instead of /login. On 201 the API sets __Host-sellerRefresh via
 * Set-Cookie (passed through the Next.js proxy); we hard-nav to
 * /dashboard so the (authed) layout SSR resolves identity cleanly.
 *
 * FE-2: any server rejection surfaces the [CODE] message verbatim.
 */
interface FormState {
  readonly companyName: string;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly whatsapp: string;
  readonly password: string;
}

const INITIAL: FormState = {
  companyName: '',
  contactPersonName: '',
  phone: '',
  whatsapp: '',
  password: '',
};

export function AcceptInvitationForm({
  token,
}: {
  readonly token: string;
}): ReactElement {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const body = {
      token,
      companyName: form.companyName.trim(),
      contactPersonName: form.contactPersonName.trim(),
      phone: form.phone.trim(),
      ...(form.whatsapp.trim() ? { whatsapp: form.whatsapp.trim() } : {}),
      password: form.password,
    };

    try {
      const store = new AccessTokenStore();
      const client = new ApiClient({
        identityKind: 'seller',
        tokenStore: store,
      });
      await client.request('/api/auth/seller/register/invite', {
        method: 'POST',
        body,
      });
      // Hard nav — SSR re-runs (authed) layout, hydrates identity
      // via cookie→/me, mounts AuthProvider.
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
        setError('Registration failed.');
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
        <label htmlFor="company" className={labelClass}>
          Company name
        </label>
        <input
          id="company"
          type="text"
          required
          minLength={2}
          maxLength={120}
          placeholder="Acme Trading Co."
          value={form.companyName}
          onChange={(e) => set('companyName', e.target.value)}
          disabled={submitting}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="contact" className={labelClass}>
          Contact person
        </label>
        <input
          id="contact"
          type="text"
          required
          minLength={2}
          maxLength={120}
          placeholder="Your full name"
          value={form.contactPersonName}
          onChange={(e) => set('contactPersonName', e.target.value)}
          disabled={submitting}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="phone" className={labelClass}>
          Phone (E.164)
        </label>
        <input
          id="phone"
          type="tel"
          required
          placeholder="+8801712345678"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          disabled={submitting}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="whatsapp" className={labelClass}>
          WhatsApp <span className="text-text-faint">(optional)</span>
        </label>
        <input
          id="whatsapp"
          type="tel"
          placeholder="+8801712345678"
          value={form.whatsapp}
          onChange={(e) => set('whatsapp', e.target.value)}
          disabled={submitting}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          Password{' '}
          <span className="text-text-faint">(min 10 characters)</span>
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={256}
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
          disabled={submitting}
          className={fieldClass}
        />
      </div>
      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[5px]">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full mt-2 px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
