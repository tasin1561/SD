'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useT } from '@/i18n/client';

/**
 * Copy a value to the clipboard. The icon morphs to a check (transform /
 * opacity only, instant under reduced motion) and "Copied" is announced
 * through a polite live region — the visual morph alone says nothing to a
 * screen reader. The accessible name stays "Copy: <value>" throughout.
 */
export function CopyButton({
  value,
  className,
}: {
  readonly value: string;
  readonly className?: string;
}): ReactElement {
  const t = useT();
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
      // Clipboard blocked (permissions, insecure origin): fall back to
      // the old selection route rather than claiming a copy that did not
      // happen.
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
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <button
        type="button"
        className={className === undefined ? 'od-copy' : `od-copy ${className}`}
        data-copied={copied ? '1' : undefined}
        aria-label={`${t('common.copy')}: ${value}`}
        title={t('common.copy')}
        onClick={() => {
          void copy();
        }}
      >
        <Copy size={14} aria-hidden className="od-copy__a" />
        <Check size={14} aria-hidden className="od-copy__b" />
      </button>
      <span className="od-sr" role="status" aria-live="polite">
        {copied ? t('common.copied') : ''}
      </span>
    </>
  );
}
