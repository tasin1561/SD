'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Chip, LiveDot } from './chrome';
import { useAsyncState } from '@/components/micro/use-async-state';
import { VanSubmitButton } from '@/components/micro/van-drive-off';
import { ChoiceCards } from '@/components/micro/choice-cards';
import { PhoneField } from '@/components/micro/phone-field';
import { SuccessCard } from '@/components/micro/success-card';
import { SelectField, TextArea, TextField } from '@/components/micro/text-field';
import { Plane } from 'lucide-react';
import { useState as useReactState } from 'react';
import type { Direction } from '@/components/islands/direction';

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

/** Sent even when blank, so the server answers with the length rule the
 *  field actually broke rather than a type error about a missing key. */
const REQUIRED = new Set(['fullName', 'companyName', 'email', 'phone']);

const VOLUMES = ['Under 100', '100–500', '500–2,000', '2,000+', 'Not sure yet'] as const;

/**
 * Which way they want parcels to travel.
 *
 * We run Bangladesh → India today, so the other two are demand we cannot
 * serve. They are offered anyway: a lead asking for the reverse corridor
 * is the clearest signal we could get about what to build next, and a
 * form that only offers the direction we already run can never tell us
 * one exists.
 *
 * Phrased from the seller's side — "my customers are in …" — because
 * that is how someone thinks about their own business. "BD_TO_IN" is our
 * word for it, not theirs.
 */
const DIRECTIONS = [
  { value: 'BD_TO_IN', label: 'Bangladesh → India' },
  { value: 'IN_TO_BD', label: 'India → Bangladesh' },
  { value: 'BOTH', label: 'Both directions' },
] as const;

/**
 * Two faces of one form. `page` is /request-invite as it always was.
 * `embedded` is the hero's "Book a shipment" tab: the five fields that
 * qualify a lead, no heading (the hero has one), the direction prefilled
 * from the hero's own toggle. Same endpoint, same field names, same
 * honeypot, same literal "Request received" — the contract the e2e spec
 * and the API both read.
 *
 * The submit is the [Van drive-off]: `useAsyncState` fires the request at
 * t=0 and lets the van leave only once the server has said yes, never
 * before (an honest busy state — the contract lives in the hook, not
 * here). An error returns the button to idle so the same values can be
 * sent again.
 */
export function InviteForm({
  variant = 'page',
  direction,
  quote,
}: {
  variant?: 'page' | 'embedded';
  direction?: Direction;
  /** A quote line from the hero's estimator, carried into the lead as its message. */
  quote?: string | undefined;
} = {}): ReactElement {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dir, setDir] = useReactState<'BD_TO_IN' | 'IN_TO_BD' | 'BOTH'>(
    direction === 'in' ? 'IN_TO_BD' : 'BD_TO_IN',
  );
  const embedded = variant === 'embedded';
  const state = useAsyncState<void>({
    minBusyMs: 900,
    settleMs: 1800,
    onSettled: (r) => {
      if (r.ok) setSent(true);
    },
  });

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    // Read from the form itself, never from a second list of field names.
    //
    // A hand-kept list WAS this code, and it was a bug: the shipping
    // direction and the second phone number were added to the markup and
    // never to the list, so the browser dropped both on every submission.
    // The person filling the form saw their answers accepted; the lead
    // arrived with an empty route. Nothing failed — which is what made it
    // survive. A field can only reach the server now by existing in the
    // DOM, which is the same condition under which someone can fill it.
    const payload: Record<string, string> = {};
    for (const key of new Set(form.keys())) {
      const value = String(form.get(key) ?? '').trim();
      // An unanswered optional is OMITTED, not sent blank: the server
      // reads shippingDirection as an enum, which accepts absent and
      // rejects ''. Required fields are sent either way, so an empty one
      // is answered by the rule it actually broke.
      if (value !== '' || REQUIRED.has(key)) payload[key] = value;
    }

    await state.run(async () => {
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        const msg =
          'Could not reach us just now. Please try again, or write to hello@skydrop.online.';
        setError(msg);
        throw new Error(msg);
      }
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const detail =
          body !== null && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message)
            : `Request failed (${res.status})`;
        // Verbatim. "email must be an email" is the useful part, and
        // paraphrasing it into "something went wrong" helps nobody.
        setError(detail);
        throw new Error(detail);
      }
    });
  }

  if (sent && embedded) {
    return (
      <SuccessCard
        title="Request received"
        body="Someone will read this properly and get back to you within one working day."
      />
    );
  }

  if (sent) {
    return (
      <div className="overflow-hidden rounded-lg border border-line bg-surface-2 shadow-[var(--shadow-2)]">
        <div className="panel-head flex items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
          <span className="flex items-center gap-2 text-[12px] font-semibold text-fg-muted">
            <LiveDot />
            <span className="text-fg-strong">Invite request</span>
          </span>
          <Chip tone="good">received</Chip>
        </div>
        <div className="p-7 text-center sm:p-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-green-line bg-green-tint">
            <Check size={22} className="text-green" aria-hidden="true" />
          </div>
          <h2
            className="mt-5 text-fg-strong"
            style={{ fontSize: 'clamp(1.4rem, 2.6vw, 1.9rem)', letterSpacing: '-0.025em' }}
          >
            Request received
          </h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-relaxed text-fg-body">
            Someone will read this properly and get back to you within one working day. If it is
            urgent, write to{' '}
            <a href="mailto:hello@skydrop.online" className="text-sky hover:underline">
              hello@skydrop.online
            </a>
            .
          </p>
          {/* Was a dim mono line reading "back to the flight plan" — which
              names a SECTION of the home page, not the home page, and was
              styled so quietly it read as a caption rather than the only
              way onward from a page with nothing else on it. */}
          <Link
            href="/"
            className="mt-7 inline-flex items-center gap-2 rounded-sm border border-line-strong px-5 py-3 text-[14px] font-medium text-fg-strong transition-colors hover:bg-surface-3"
          >
            Back to the main site
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  const honeypot = (
    <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
      <label htmlFor="website">Website</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
    </div>
  );
  const errorNote =
    error !== null ? (
      <p
        role="alert"
        className="mt-4 rounded-sm border border-red-line bg-red-tint px-4 py-3 text-[13px] text-red"
      >
        {error}
      </p>
    ) : null;

  if (embedded) {
    return (
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="invite-embedded relative"
        noValidate
        data-variant="embedded"
      >
        {/* Direction as u10 cards — no select. The hero's own direction
            seeds it; the value travels as the shippingDirection field. */}
        <ChoiceCards<'BD_TO_IN' | 'IN_TO_BD' | 'BOTH'>
          name="shippingDirection"
          label="Where do you want to deliver parcels?"
          value={dir}
          onChange={setDir}
          columns={3}
          options={[
            {
              value: 'BD_TO_IN',
              title: 'Bangladesh → India',
              icon: <Plane size={14} />,
              hue: 'saffron',
            },
            {
              value: 'IN_TO_BD',
              title: 'India → Bangladesh',
              icon: <Plane size={14} style={{ transform: 'scaleX(-1)' }} />,
              hue: 'green',
            },
            { value: 'BOTH', title: 'Both directions', hue: 'blue' },
          ]}
        />
        <div className="invite-embedded__grid">
          <TextField
            id="companyName"
            name="companyName"
            label="Business name (or your own name) *"
            required
            maxLength={160}
            autoComplete="organization"
          />
          <TextField
            id="fullName"
            name="fullName"
            label="Your name *"
            required
            maxLength={120}
            autoComplete="name"
          />
          <PhoneField
            id="phone"
            name="phone"
            required
            defaultCountry={dir === 'IN_TO_BD' ? 'IN' : 'BD'}
          />
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email *"
            required
            maxLength={200}
            autoComplete="email"
          />
        </div>
        {quote ? <input type="hidden" name="message" value={quote} /> : null}
        {honeypot}
        {errorNote}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <VanSubmitButton
            phase={state.phase}
            label="Request an invite"
            successLabel="Request received"
            errorLabel="Not sent — check the message above"
          />
          <span className="text-[12px] leading-snug text-fg-muted">
            {quote ? 'Your quote travels with the request. ' : ''}We reply within one working day.
          </span>
        </div>
      </form>
    );
  }

  return (
    <>
      {/* The sign-in consoles open with the wordmark and the live-status
          dot, because those pages have no nav to introduce the product.
          This one does — it sits 65px above, saying the same two things
          — so repeating them here read as a mistake once the surplus
          padding above was removed. What the nav does NOT say is the
          terms of entry, and that is the line worth keeping. */}
      <div className="boot-rise mb-5 flex justify-center">
        <Chip tone="accent">
          <LiveDot tone="sky" />
          invite-only beta · bd &rarr; in
        </Chip>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="boot-rise boot-rise-2 overflow-hidden rounded-lg border border-line bg-surface-2 shadow-[var(--shadow-hud)]"
        noValidate
      >
        <div className="panel-head flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
          <span className="text-[12px] font-semibold text-fg-strong">Invite request</span>
          <span className="text-[12px] text-fg-faint">4 required · 5 optional</span>
        </div>

        <div className="p-5 sm:p-8">
          <h1
            className="text-fg-strong"
            style={{ fontSize: 'clamp(1.6rem, 3.4vw, 2.2rem)', letterSpacing: '-0.03em' }}
          >
            Tell us about your store
          </h1>
          <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-fg-body">
            Skydrop is invite-only while we scale the warehouse. Four fields is all we need to start
            — the rest helps us come to the call prepared.
          </p>

          {/* First, because it frames everything after it — and because
              a lead in the wrong direction is worth knowing about before
              reading their volume. */}
          <div className="mt-7 grid gap-4">
            <SelectField
              id="shippingDirection"
              name="shippingDirection"
              label="Where do you want to deliver parcels?"
              icon={<Plane size={15} />}
              helper="We run Bangladesh → India today. Tell us either way — the other direction is what we are deciding whether to build next."
              defaultValue=""
            >
              <option value="">Select…</option>
              {DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <TextField
              id="fullName"
              name="fullName"
              label="Your name *"
              required
              maxLength={120}
              autoComplete="name"
            />
            <TextField
              id="companyName"
              name="companyName"
              label="Business name (or your own name) *"
              required
              maxLength={160}
              autoComplete="organization"
            />
            <TextField
              id="email"
              name="email"
              type="email"
              label="Email *"
              required
              maxLength={200}
              autoComplete="email"
            />
            <TextField
              id="phone"
              name="phone"
              label="Phone or WhatsApp *"
              required
              maxLength={32}
              autoComplete="tel"
              inputMode="tel"
              helper="However you write it is fine."
            />
            <TextField
              id="altPhone"
              name="altPhone"
              label="Second number"
              maxLength={32}
              autoComplete="tel"
              inputMode="tel"
              helper="If you have one in the other country — whichever reaches you."
            />
            <TextField
              id="productTypes"
              name="productTypes"
              label="What do you sell?"
              maxLength={300}
            />
            <SelectField
              id="monthlyOrders"
              name="monthlyOrders"
              label="Orders a month"
              defaultValue=""
            >
              <option value="">Select…</option>
              {VOLUMES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="mt-5">
            <TextArea
              id="message"
              name="message"
              label="Anything else"
              maxLength={2000}
              counter
              rows={4}
              helper="Where you ship from, what you have tried before, what worries you about India."
            />
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
              className="mt-6 rounded-sm border border-red-line bg-red-tint px-4 py-3 text-[13px] text-red"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-7">
            <VanSubmitButton
              phase={state.phase}
              label="Request an invite"
              successLabel="Request received"
              errorLabel="Not sent — check the message above"
            />
          </div>

          <p className="mt-5 max-w-[52ch] text-[12px] leading-relaxed text-fg-muted">
            We use this only to get in touch about Skydrop. No newsletter, and we do not pass it on.
          </p>
        </div>
      </form>
    </>
  );
}
