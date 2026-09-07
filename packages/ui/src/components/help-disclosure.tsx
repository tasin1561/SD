'use client';

import { clsx } from 'clsx';
import { Info } from 'lucide-react';
import { useId, useState, type ReactElement, type ReactNode } from 'react';

/**
 * Guidance, folded away behind an (i) until somebody wants it.
 *
 * ── WHY A HOOK AND NOT A COMPONENT ───────────────────────────────────
 * The button and the prose belong in two different places: the button
 * next to the LABEL, where a person looks when they are unsure what a
 * field wants, and the prose BELOW the control, where it has always
 * been and where it does not squeeze the label. One component cannot
 * render into two slots, so this hands back both halves and lets each
 * primitive put them where they go. The state, the ids, the aria and
 * the animation live here once rather than in four copies.
 *
 * ── WHY INLINE, NOT A POPOVER ────────────────────────────────────────
 * A floating panel needs positioning, collision handling, a portal and
 * a different shape again on a phone, and every one of those is a way
 * for the help to land off-screen. Expanding in place has none of that:
 * it is the same behaviour at 360px and at 1440px, it cannot be
 * clipped by a card's overflow, and "click again to hide" is literally
 * what it does. The cost is that the page below moves, which is honest
 * — the text really is there now.
 *
 * ── THE ANIMATION ────────────────────────────────────────────────────
 * `grid-template-rows: 0fr → 1fr` is what makes this smooth without
 * measuring anything. Animating `height` to `auto` does not work, and
 * animating to a measured pixel height breaks the moment the text
 * rewraps at a different width — which on a phone is every time. The
 * global `prefers-reduced-motion` rule in tokens.css already collapses
 * the transition to an instant show for anybody who asked for that.
 *
 * ── WHAT MUST NEVER GO IN HERE ───────────────────────────────────────
 * An ERROR, and a WARNING. Both are things the reader has not asked for
 * and needs anyway; putting either behind a click means it is read
 * after the mistake rather than before it. `FormField` keeps `error` on
 * its own always-visible path, and a hint that is really a warning
 * should be passed as `notice` instead of `hint`.
 */
export interface HelpDisclosure {
  /** The (i). Goes beside the label or title. Null when there is no help. */
  readonly trigger: ReactElement | null;
  /** The prose, collapsed. Goes where the prose used to be. */
  readonly panel: ReactElement | null;
  readonly open: boolean;
}

/**
 * A readable name for a title that may be markup.
 *
 * Only a plain string can be trusted here: a title built from elements
 * could be an icon, a badge and three spans, and flattening that yields
 * something like "Recipient KYC REQUIRED" read out as the name of a
 * button. The fallback says what the control does without pretending to
 * know what it is about.
 */
export function helpSubject(node: ReactNode, fallback = 'this'): string {
  return typeof node === 'string' && node.trim() !== '' ? node.trim() : fallback;
}

export function useHelpDisclosure(
  /** What the help is ABOUT — "Full name", "Payment & physical". Read
   *  out as "Show help for Full name", so a screen-reader user hears
   *  which of forty (i)s on a page they have landed on. */
  subject: string,
  help: ReactNode,
  opts: { readonly size?: 'xs' | 'sm' } = {},
): HelpDisclosure {
  const [open, setOpen] = useState(false);
  const id = useId();

  // `null`/`false`/`''` all mean "there is no help here", and every one
  // of them reaches this from a conditional at a call site. Rendering an
  // (i) that opens onto nothing is worse than rendering no (i).
  if (help === null || help === undefined || help === false || help === '') {
    return { trigger: null, panel: null, open: false };
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-controls={id}
      aria-label={open ? `Hide help for ${subject}` : `Show help for ${subject}`}
      title={open ? 'Hide help' : 'Show help'}
      className={clsx(
        // `skydrop-hit` gives it a 44px touch target on a coarse pointer
        // without a 44px BOX — the label row would be three times its
        // height if the button really were that size.
        'skydrop-hit inline-flex shrink-0 items-center justify-center rounded-full align-middle transition-colors',
        'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
        open ? 'text-accent' : 'text-text-faint hover:text-text-muted',
        opts.size === 'sm' ? 'h-5 w-5' : 'h-4 w-4',
      )}
    >
      <Info size={opts.size === 'sm' ? 14 : 12} aria-hidden />
    </button>
  );

  const panel = (
    <div
      id={id}
      className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
    >
      {/* The overflow clip is what the 0fr row collapses AGAINST; without
          it the text simply overhangs its own zero-height row. */}
      <div className="overflow-hidden">{help}</div>
    </div>
  );

  return { trigger, panel, open };
}
