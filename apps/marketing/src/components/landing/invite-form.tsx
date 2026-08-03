'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';

/**
 * Asking to be let in.
 *
 * This replaces a `mailto:` link. That link asked the browser to hand
 * off to a mail client: a chooser dialog on desktop, and on a phone with
 * no mail account set up, nothing at all. Every person who did not
 * complete that handoff vanished, and we never knew one had tried.
 *
 * ── What the form asks for, and what it does not ─────────────────────
 * Four required fields, and they are the four an operator needs to make
 * the call: who, which company, where to write, where to ring. Product
 * type, volume and a free-text note are optional because they are
 * conversation-starters, not qualifiers — a form that demands a monthly
 * order estimate before it will take a name loses the person who has not
 * worked it out yet, and that person is a perfectly good lead.
 *
 * Phone is not format-validated. Losing a real prospect to a regex over
 * a leading zero costs far more than an operator retyping a number.
 *
 * ── Errors ───────────────────────────────────────────────────────────
 * The server's verdict is shown as-is, and the typed values are kept.
 * A form that clears itself on failure is a form people do not fill in
 * twice.
 */

/** Same-origin. Caddy forwards this one path to the API, so the static
 *  site never makes a cross-origin request — which its own CSP
 *  (`connect-src 'self'`) would block anyway. */
const ENDPOINT = '/api/public/invite-leads';

const VOLUMES = ['Under 100', '100–500', '500–2,000', '2,000+', 'Not sure yet'] as const;

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly children: ReactElement;
  readonly hint?: string;
}

function Field({ id, label, required, children, hint }: FieldProps): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="telemetry text-fg-muted">
        {label}
        {required ? <span className="text-sky"> *</span> : null}
      </label>
      {children}
      {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
    </div>
  );
}

const inputClass =
  'w-full h-12 px-4 rounded-xl bg-surface border border-line text-fg-strong ' +
  'placeholder:text-fg-muted text-sm focus:outline-none focus:border-sky transition-colors';

export function InviteForm(): ReactElement {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(
      [
        'fullName',
        'companyName',
        'email',
        'phone',
        'productTypes',
        'monthlyOrders',
        'message',
        'website',
      ].map((k) => [k, String(form.get(k) ?? '').trim()]),
    );

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const detail =
          body !== null && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message)
            : `Request failed (${res.status})`;
        // Verbatim. "email must be an email" is the useful part, and
        // paraphrasing it into "something went wrong" helps nobody.
        setError(detail);
        return;
      }
      setSent(true);
    } catch {
      setError('Could not reach us just now. Please try again, or write to hello@skydrop.online.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="panel ticks p-8 sm:p-10 text-center">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: 'var(--glow)' }}
        >
          <Check size={22} className="text-sky" />
        </div>
        <h2
          className="mt-5 font-display font-semibold text-fg-strong"
          style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2rem)', letterSpacing: '-0.02em' }}
        >
          Request received
        </h2>
        <p className="mt-4 text-fg-body mx-auto max-w-[46ch]">
          Someone will read this properly and get back to you within one working day. If it is
          urgent, write to{' '}
          <a href="mailto:hello@skydrop.online" className="text-sky hover:underline">
            hello@skydrop.online
          </a>
          .
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 font-mono text-sm text-fg-muted hover:text-fg-strong transition-colors"
        >
          Back to the flight plan
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="panel ticks p-6 sm:p-9" noValidate>
      <div className="telemetry text-fg-muted">invite request</div>
      <h1
        className="mt-3 font-display font-semibold text-fg-strong"
        style={{ fontSize: 'clamp(1.8rem, 3.4vw, 2.6rem)', letterSpacing: '-0.025em' }}
      >
        Tell us about your store
      </h1>
      <p className="mt-4 text-fg-body max-w-[52ch]">
        Skydrop is invite-only while we scale the warehouse. Four fields is all we need to start —
        the rest helps us come to the call prepared.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Field id="fullName" label="Your name" required>
          <input
            id="fullName"
            name="fullName"
            required
            maxLength={120}
            autoComplete="name"
            className={inputClass}
            placeholder="Rahim Uddin"
          />
        </Field>
        <Field id="companyName" label="Company" required>
          <input
            id="companyName"
            name="companyName"
            required
            maxLength={160}
            autoComplete="organization"
            className={inputClass}
            placeholder="Dhaka Threads"
          />
        </Field>
        <Field id="email" label="Email" required>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            className={inputClass}
            placeholder="you@yourstore.com"
          />
        </Field>
        <Field id="phone" label="Phone or WhatsApp" required hint="However you write it is fine.">
          <input
            id="phone"
            name="phone"
            required
            maxLength={32}
            autoComplete="tel"
            inputMode="tel"
            className={inputClass}
            placeholder="+880 1712 345678"
          />
        </Field>
        <Field id="productTypes" label="What do you sell?">
          <input
            id="productTypes"
            name="productTypes"
            maxLength={300}
            className={inputClass}
            placeholder="Womenswear — kurtis, sarees"
          />
        </Field>
        <Field id="monthlyOrders" label="Orders a month">
          <select id="monthlyOrders" name="monthlyOrders" className={inputClass} defaultValue="">
            <option value="">Select…</option>
            {VOLUMES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5">
        <Field id="message" label="Anything else">
          <textarea
            id="message"
            name="message"
            maxLength={2000}
            rows={4}
            className={inputClass.replace('h-12', 'min-h-[7rem] py-3')}
            placeholder="Where you ship from, what you have tried before, what worries you about India."
          />
        </Field>
      </div>

      {/* Hidden from people, irresistible to scripts. Off-screen rather
          than display:none, because some bots skip what is not rendered. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error !== null ? (
        <p
          role="alert"
          className="mt-6 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--red, #EF4444)', color: 'var(--red, #EF4444)' }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-sky px-6 py-4 text-sm font-medium text-accent-fg transition-colors hover:bg-sky-deep disabled:opacity-60"
        style={{ boxShadow: '0 0 42px var(--glow)' }}
      >
        {busy ? 'Sending…' : 'Request an invite'}
        {busy ? null : (
          <ArrowUpRight
            size={16}
            className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        )}
      </button>

      <p className="mt-5 text-xs text-fg-muted max-w-[52ch]">
        We use this only to get in touch about Skydrop. No newsletter, and we do not pass it on.
      </p>
    </form>
  );
}
