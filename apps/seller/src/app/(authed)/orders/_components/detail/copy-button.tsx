'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useT } from '@/i18n/client';

/**
 * Copy a value to the clipboard. The icon morphs to a check (transform and
 * opacity only, instant under reduced motion), the word "Copied" shows for two
 * seconds beside it, and a polite live region announces it — a visual morph
 * alone says nothing to a screen reader. The accessible name stays stable.
 */
export function CopyButton({
  value,
  label,
  showLabel = false,
  className,
}: {
  readonly value: string;
  /** Accessible name; defaults to "Copy number". */
  readonly label?: string | undefined;
  /** Print the word beside the icon (used where there is room: the tracking link). */
  readonly showLabel?: boolean;
  readonly className?: string | undefined;
}): ReactElement {
  const t = useT();
  const name = label ?? t('orderPage.copyNumber');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard blocked (permissions, insecure origin): fall back to the
      // old selection route rather than claiming a copy that did not happen.
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) return;
      } catch {
        return;
      }
    }
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <button
        type="button"
        className={className === undefined ? 'cod-copy' : `cod-copy ${className}`}
        data-copied={copied ? '1' : undefined}
        data-labelled={showLabel || copied ? '1' : undefined}
        aria-label={name}
        title={name}
        onClick={() => {
          void copy();
        }}
      >
        <span className="cod-copy__icons" aria-hidden>
          <Copy size={16} className="cod-copy__a" />
          <Check size={16} className="cod-copy__b" />
        </span>
        {showLabel || copied ? (
          <span className="cod-copy__text" aria-hidden>
            {copied ? t('orderPage.copied') : name}
          </span>
        ) : null}
      </button>
      <span className="cod-sr" role="status" aria-live="polite">
        {copied ? t('orderPage.copied') : ''}
      </span>
    </>
  );
}
