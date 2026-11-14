'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { Check, Copy } from 'lucide-react';
import { clsx } from 'clsx';
import { useUiT } from '../i18n-client';
import './awb-copy.css';

/**
 * An AWB in the identifier font with a small copy button beside it.
 *
 * Usage: `<AwbCopy awb={order.shipment?.awbNumber ?? null} />`
 * Accepts one AWB, a list (a split order — each shown once) or null
 * (renders nothing; pass `dashWhenEmpty` for a muted dash in a table cell).
 *
 * The button stops the click here, so it never opens a row link around it.
 * Copied state shows the word "Copied" for 2s in an aria-live region.
 */
export function AwbCopy({
  awb,
  dashWhenEmpty = false,
  className,
  kind = 'awb',
  size = 'sm',
}: {
  readonly awb: string | readonly string[] | null | undefined;
  readonly dashWhenEmpty?: boolean;
  readonly className?: string;
  /** `order` copies an order number instead (label differs). */
  readonly kind?: 'awb' | 'order';
  /** `inherit` takes the surrounding type size (a page title). */
  readonly size?: 'sm' | 'inherit';
}): ReactElement | null {
  const list = Array.from(
    new Set(
      (Array.isArray(awb) ? awb : [awb])
        .map((a) => (typeof a === 'string' ? a.trim() : ''))
        .filter((a) => a !== ''),
    ),
  );
  if (list.length === 0) {
    return dashWhenEmpty ? (
      <span className="sk-awb-empty" aria-hidden="true">
        —
      </span>
    ) : null;
  }
  return (
    <span className={clsx('sk-awb-list', size === 'inherit' && 'sk-awb-list--inherit', className)}>
      {list.map((a) => (
        <AwbCopyOne key={a} awb={a} kind={kind} />
      ))}
    </span>
  );
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function AwbCopyOne({
  awb,
  kind,
}: {
  readonly awb: string;
  readonly kind: 'awb' | 'order';
}): ReactElement {
  const t = useUiT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(e: MouseEvent<HTMLButtonElement>): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (!(await writeClipboard(awb))) return;
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <span className="sk-awb">
      <span className="sk-ident sk-awb__value">{awb}</span>
      <button
        type="button"
        className="sk-awb__btn"
        data-copied={copied ? '1' : undefined}
        aria-label={
          kind === 'order' ? t('ui.order.copy', { value: awb }) : t('ui.awb.copy', { awb })
        }
        onClick={copy}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        <span className="sk-awb__done" aria-live="polite">
          {copied ? t('ui.awb.copied') : ''}
        </span>
      </button>
    </span>
  );
}

/**
 * A detail page's title: "AWB 38061110634966" with its copy button, one per
 * parcel; before any AWB exists, a muted "AWB ___________________" and no
 * button. Put it inside the page's title slot so the h1 stays the h1.
 */
export function AwbTitle({
  awbs,
}: {
  readonly awbs: readonly (string | null | undefined)[];
}): ReactElement {
  const t = useUiT();
  const has = awbs.some((a) => typeof a === 'string' && a.trim() !== '');
  if (!has) {
    return (
      <span className="sk-awb-title sk-awb-title--empty">
        AWB <span aria-hidden="true">___________________</span>
        <span className="sk-awb-sr">{t('ui.awb.none')}</span>
      </span>
    );
  }
  return (
    <span className="sk-awb-title">
      AWB{' '}
      <AwbCopy awb={[...awbs].filter((a): a is string => typeof a === 'string')} size="inherit" />
    </span>
  );
}
