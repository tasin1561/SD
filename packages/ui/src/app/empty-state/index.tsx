'use client';

import { clsx } from 'clsx';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useRef, type ReactElement, type ReactNode } from 'react';
import { Button } from '../button';
import { useLoopVisible } from '../motion/use-loop-visible';
import './empty-state.css';

/**
 * EmptyState (u27). A friendly illustration that bobs gently (paused
 * off-screen and on a hidden tab), a title, one helpful sentence and ONE
 * action.
 *
 *   tone="neutral"   a parcel under a sweeping magnifier — "nothing here
 *                    yet", an invitation to the next step, never a sad face
 *   tone="positive"  a parcel with a check and sparkles — good news
 *                    ("Nothing needs you"): celebrate, don't apologise
 *
 * Legacy-compatible props (`title`, `description`, `action`, `icon`,
 * `bare`). `icon` replaces the illustration when a page wants its own
 * glyph. `bare` drops the card for use inside a bordered table.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  tone = 'neutral',
  bare = false,
  className,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: 'neutral' | 'positive';
  readonly bare?: boolean;
  readonly className?: string | undefined;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const play = useLoopVisible(ref);
  return (
    <div
      ref={ref}
      className={clsx('sk-empty', className)}
      data-tone={tone}
      data-bare={bare ? '1' : undefined}
      data-play={play ? '1' : '0'}
    >
      {icon !== undefined ? (
        <span className="sk-empty__icon" aria-hidden>
          {icon}
        </span>
      ) : (
        <span className="sk-empty__art" aria-hidden>
          {tone === 'positive' ? <PositiveArt /> : <NeutralArt />}
        </span>
      )}
      <div className="sk-empty__title">{title}</div>
      {description !== undefined && <div className="sk-empty__body">{description}</div>}
      {action !== undefined && <div className="sk-empty__action">{action}</div>}
    </div>
  );
}

function NeutralArt(): ReactElement {
  return (
    <>
      <svg className="sk-empty__svg" viewBox="0 0 120 84">
        <ellipse cx="60" cy="78" rx="30" ry="3.5" fill="var(--line)" />
        <path d="M34 36l26-12 26 12v26L60 74 34 62z" fill="var(--saffron-tint)" />
        <path
          d="M34 36l26 12 26-12M60 48v26M34 36v26l26 12 26-12V36"
          fill="none"
          stroke="var(--saffron-text)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M47 30l26 12v10l-4-2v-7L43 31z" fill="var(--saffron-fill)" />
        <circle className="sk-empty__spark" cx="24" cy="24" r="2" fill="var(--blue-text)" />
        <circle
          className="sk-empty__spark sk-empty__spark--2"
          cx="102"
          cy="64"
          r="1.6"
          fill="var(--blue-text)"
        />
      </svg>
      <svg className="sk-empty__svg sk-empty__lens" viewBox="0 0 120 84">
        <circle
          cx="80"
          cy="28"
          r="13"
          fill="var(--blue-tint)"
          stroke="var(--blue-text)"
          strokeWidth="3"
        />
        <path d="M90 38l10 10" stroke="var(--blue-text)" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </>
  );
}

function PositiveArt(): ReactElement {
  return (
    <svg className="sk-empty__svg" viewBox="0 0 120 84">
      <ellipse cx="60" cy="78" rx="30" ry="3.5" fill="var(--line)" />
      <path d="M34 36l26-12 26 12v26L60 74 34 62z" fill="var(--green-tint)" />
      <path
        d="M34 36l26 12 26-12M60 48v26M34 36v26l26 12 26-12V36"
        fill="none"
        stroke="var(--green-text)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="84" cy="26" r="13" fill="var(--green-fill)" />
      <path
        className="sk-empty__tick"
        d="M78 26.5l4.2 4.2 8-8.4"
        fill="none"
        stroke="var(--green-on-fill)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="sk-empty__spark"
        d="M26 20l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z"
        fill="var(--saffron-fill)"
      />
      <circle
        className="sk-empty__spark sk-empty__spark--2"
        cx="104"
        cy="58"
        r="2"
        fill="var(--blue-text)"
      />
      <circle
        className="sk-empty__spark sk-empty__spark--3"
        cx="18"
        cy="54"
        r="1.6"
        fill="var(--green-text)"
      />
    </svg>
  );
}

/**
 * ErrorState — a failed fetch with a way out. The message is shown
 * VERBATIM (FE-2: a server's `[CODE] message` is never paraphrased), and
 * `retry`, where given, is a real Retry button.
 */
export function ErrorState({
  message,
  title = 'Something went wrong',
  retry,
  className,
}: {
  readonly message: string;
  readonly title?: ReactNode;
  readonly retry?: (() => void) | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <div role="alert" className={clsx('sk-error', className)}>
      <span className="sk-error__icon" aria-hidden>
        <AlertTriangle size={18} />
      </span>
      <div className="sk-error__text">
        <div className="sk-error__title">{title}</div>
        <div className="sk-error__message">{message}</div>
      </div>
      {retry !== undefined && (
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCw size={14} />}
          onClick={retry}
          className="sk-error__retry"
        >
          Retry
        </Button>
      )}
    </div>
  );
}
