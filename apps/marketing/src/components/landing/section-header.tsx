import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';

/**
 * Instrument section chrome — mono index + display heading.
 */
export function SectionHeader({
  index,
  code,
  title,
  sub,
  align = 'left',
}: {
  index: string;
  code: string;
  title: string;
  sub?: string;
  align?: 'left' | 'center';
}): ReactElement {
  return (
    <Reveal className={align === 'center' ? 'text-center' : ''}>
      <div
        className={`telemetry text-fg-muted flex items-center gap-3 ${
          align === 'center' ? 'justify-center' : ''
        }`}
      >
        <span className="text-sky">SEC {index}</span>
        <span aria-hidden className="inline-block h-px w-8 bg-line-strong" />
        <span>{code}</span>
      </div>
      <h2
        className="mt-4 font-display font-semibold text-fg-strong"
        style={{
          fontSize: 'clamp(1.9rem, 3.6vw, 2.9rem)',
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </h2>
      {sub ? (
        <p
          className={`mt-4 text-fg-body text-base sm:text-lg max-w-[52ch] ${
            align === 'center' ? 'mx-auto' : ''
          }`}
        >
          {sub}
        </p>
      ) : null}
    </Reveal>
  );
}
