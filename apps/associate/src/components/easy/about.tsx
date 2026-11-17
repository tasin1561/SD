'use client';

import type { ReactElement, ReactNode } from 'react';
import { useT } from '@/i18n/client';
import { InfoButton } from './info-button';
import './easy.css';

/**
 * "About this page" — the sentence that used to sit under a page title,
 * now one press away. The page opens on the work; the explanation is
 * still there for whoever wants it.
 */
export function AboutThis({
  text,
  kind = 'page',
}: {
  readonly text: string;
  /** What the sentence is about: the page (default), the list above it, or the card it sits in. */
  readonly kind?: 'page' | 'list' | 'this';
}): ReactElement {
  const t = useT();
  const label = t(
    kind === 'list'
      ? 'easy.aboutThisList'
      : kind === 'this'
        ? 'easy.aboutThis'
        : 'easy.aboutThisPage',
  );
  return (
    <span className="ez-about">
      <InfoButton title={label} text={text} />
      <span
        className="ez-about__label"
        aria-hidden
        onClick={(e) => {
          const button = e.currentTarget.parentElement?.querySelector('button');
          button?.click();
        }}
      >
        {label}
      </span>
    </span>
  );
}

/** A label with its explanation behind an "i" beside it. */
export function InfoLabel({
  label,
  info,
}: {
  readonly label: ReactNode;
  readonly info: string;
}): ReactElement {
  return (
    <span className="ez-titled">
      <span>{label}</span>
      <InfoButton title={typeof label === 'string' ? label : info.slice(0, 40)} text={info} />
    </span>
  );
}

/**
 * The line under a headline number, behind an "i" in the card's corner.
 * The number is what is read at a glance; what it counts is one press away.
 */
export function HintInfo({ text }: { readonly text: string }): ReactElement {
  const t = useT();
  return <InfoButton className="ez-hint" title={t('easy.aboutThis')} text={text} />;
}

/**
 * A section's title and note, with an explanatory note moved behind an "i"
 * beside the title. A short note with a number in it is a fact ("4 tickets")
 * and stays where it is; a sentence is an explanation and waits to be asked for.
 */
export function foldNote(
  title: ReactNode,
  note: ReactNode,
): { readonly title: ReactNode; readonly note: ReactNode } {
  if (typeof note !== 'string' || note === '') return { title, note };
  // A count ("4 tickets") is a fact and stays; a sentence is an explanation.
  if (/\d/.test(note) && note.length <= 40) return { title, note };
  return { title: <InfoLabel label={title} info={note} />, note: undefined };
}
