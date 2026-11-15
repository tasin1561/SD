'use client';

import type { ReactElement } from 'react';
import './courier-whatsapp.css';

export interface CourierWhatsappMessageItem {
  readonly text: string;
  /** The time exactly as the courier's window showed it. */
  readonly sentLabel: string;
}

/** A run of 7-15 digits (spaces, dashes, a leading +): a phone number. */
const PHONE = /(\+?\d[\d\s-]{5,15}\d)/g;

/**
 * A message's text with every phone number a `tel:` link — the delivery
 * executive's number is the thing a reader acts on.
 */
export function linkPhones(
  text: string,
): Array<string | { readonly tel: string; readonly shown: string }> {
  const out: Array<string | { readonly tel: string; readonly shown: string }> = [];
  let last = 0;
  for (const m of text.matchAll(PHONE)) {
    const shown = m[0];
    const digits = shown.replace(/[^\d+]/g, '');
    const count = digits.replace(/\D/g, '').length;
    if (count < 7 || count > 15) continue;
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push({ tel: digits, shown });
    last = at + shown.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * "WhatsApp messages from the courier": chat bubbles with their times.
 * Presentational only — each console fetches through its own proxy and
 * passes the words. Renders nothing for an empty list (hidden when there
 * are no messages).
 */
export function CourierWhatsappMessages({
  messages,
  note,
  footer,
  onRefresh,
  refreshLabel,
  refreshing = false,
}: {
  readonly messages: readonly CourierWhatsappMessageItem[];
  /** One line under the list, e.g. "Last checked …". */
  readonly footer?: string | null;
  readonly note?: string | null;
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshLabel?: string | undefined;
  readonly refreshing?: boolean;
}): ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <div className="sk-cwa">
      {note !== undefined && note !== null && <p className="sk-cwa__foot">{note}</p>}
      <ol className="sk-cwa__list">
        {messages.map((m, i) => (
          <li key={`${m.sentLabel}-${i}`} className="sk-cwa__row">
            <div className="sk-cwa__bubble">
              {linkPhones(m.text).map((p, j) =>
                typeof p === 'string' ? (
                  <span key={j}>{p}</span>
                ) : (
                  <a key={j} href={`tel:${p.tel}`}>
                    {p.shown}
                  </a>
                ),
              )}
              <span className="sk-cwa__time">{m.sentLabel}</span>
            </div>
          </li>
        ))}
      </ol>
      {((footer !== undefined && footer !== null) || onRefresh !== undefined) && (
        <div className="sk-cwa__foot">
          {footer !== undefined && footer !== null && <span>{footer}</span>}
          {onRefresh !== undefined && (
            <button
              type="button"
              className="sk-cwa__refresh"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshLabel ?? 'Refresh'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
