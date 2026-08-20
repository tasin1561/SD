'use client';

import { useState, type ReactElement } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * The number the agent is about to dial.
 *
 * Set apart from the rest of the card because it is not a detail of the
 * order — it is the thing the screen exists to hand over. An agent
 * reading it off a line of small grey text, into a headset, mid-sentence,
 * is where a transposed digit becomes a call to a stranger.
 *
 * `tel:` makes it dialable where a softphone is installed; copy covers
 * everywhere else, which today is everywhere (click-to-call is Phase 2).
 * Digits are tabular so a mis-keyed number does not also mis-align, and
 * `select-all` means a drag selects the whole number rather than half.
 */
export function PhoneToCall({
  phone,
  altPhone = null,
}: {
  readonly phone: string;
  readonly altPhone?: string | null;
}): ReactElement {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard is permission-gated and can simply refuse. The number
      // is on screen and selectable either way, so a failure needs no
      // alarm — silently not confirming is the honest outcome.
    }
  }

  function Row({ value, label }: { value: string; label?: string }): ReactElement {
    return (
      <div className="flex items-center gap-2">
        <a
          href={`tel:${value}`}
          className="text-text-bright font-mono text-lg font-semibold tabular-nums tracking-wide select-all hover:underline"
        >
          {value}
        </a>
        {label !== undefined && <span className="text-text-faint text-xs">{label}</span>}
        <button
          type="button"
          onClick={() => void copy(value)}
          className="text-text-muted hover:text-text-bright inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-xs"
          aria-label={`Copy ${label ?? 'phone number'} ${value}`}
        >
          {copied === value ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Copied
            </>
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="border-accent/40 bg-accent/5 rounded-[6px] border px-3 py-2">
      <div className="text-text-faint mb-0.5 text-[11px] tracking-wide uppercase">Call</div>
      <Row value={phone} />
      {altPhone !== null && altPhone !== '' && <Row value={altPhone} label="alt" />}
    </div>
  );
}
