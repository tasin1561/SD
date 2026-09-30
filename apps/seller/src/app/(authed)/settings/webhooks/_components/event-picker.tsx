'use client';

import { type ReactElement } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useWebhookEvents } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import './event-picker.css';

/** What a new endpoint starts subscribed to. */
export const DEFAULT_EVENTS: readonly string[] = [
  'order.confirmed',
  'shipment.dispatched',
  'shipment.delivered',
];

/**
 * Pick events from the list the API sends; never type one.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────
 * This was a comma-separated text box over a `string[]` column with no
 * vocabulary check anywhere on the seller path. `shipment.delivery` —
 * close, and wrong — saved cleanly, rendered as configured, and matched
 * nothing we ever send. An endpoint subscribed to nothing looks exactly
 * like one whose events have not happened yet, so the failure is
 * permanent and invisible.
 *
 * ── AND WHY A CHIP RATHER THAN A REFUSAL ─────────────────────────────
 * Validating on write was the obvious fix and was rejected: a row
 * already holding an unrecognised value would then fail its NEXT save,
 * including one that does not touch the events — somebody renaming an
 * endpoint blocked by a typo from months ago. That is punishing a
 * seller for our omission.
 *
 * So an unrecognised stored value is KEPT, shown as a warning chip that
 * says what is wrong in the seller's words, and removable in one click.
 * It is carried through a save untouched, so nobody's save breaks; and
 * because there is no text box left, no NEW one can be made.
 *
 * The list comes from `GET /seller/webhook-endpoints/events`, which
 * serves the same `WEBHOOK_EVENT_CATALOGUE` the store's screen reads —
 * imported there, never restated, because two lists is how the two
 * screens come to offer different things while both look right.
 */
export function EventPicker({
  value,
  onChange,
}: {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}): ReactElement {
  const events = useWebhookEvents();

  if (events.isPending) return <SkeletonRows label="Loading the events" rows={3} cols={2} />;
  if (events.isError) {
    return <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />;
  }

  const offered = events.data;
  const known = new Set(offered.map((e) => e.code));
  const chosen = new Set(value);
  // Held but not offered. Only a row written before the picker existed
  // can have one; the form cannot produce another.
  const unknown = value.filter((c) => !known.has(c));

  /** Keep the API's order for the known ones, then whatever is left. */
  function commit(next: Set<string>): void {
    onChange([
      ...offered.map((e) => e.code).filter((c) => next.has(c)),
      ...[...next].filter((c) => !known.has(c)),
    ]);
  }

  return (
    <fieldset className="whk-events">
      <legend>Events</legend>

      {unknown.length > 0 && (
        <div className="whk-events__warn" role="status">
          <CircleAlert size={15} aria-hidden />
          <div>
            <p>
              {unknown.length === 1
                ? 'This event is not one we send'
                : 'These events are not ones we send'}
              . Nothing has ever been delivered for {unknown.length === 1 ? 'it' : 'them'} — most
              likely a typo from when this was typed by hand. Remove{' '}
              {unknown.length === 1 ? 'it' : 'them'} and tick what you meant below.
            </p>
            <ul className="whk-events__chips">
              {unknown.map((code) => (
                <li key={code}>
                  <span className="sk-ident">{code}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${code}`}
                    onClick={() => {
                      const next = new Set(chosen);
                      next.delete(code);
                      commit(next);
                    }}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="whk-events__grid">
        {offered.map((e) => (
          <Checkbox
            key={e.code}
            checked={chosen.has(e.code)}
            label={<span className="sk-ident">{e.code}</span>}
            description={e.description}
            onChange={(ev) => {
              const next = new Set(chosen);
              if (ev.target.checked) next.add(e.code);
              else next.delete(e.code);
              commit(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
