import type { ReactElement } from 'react';

/**
 * Flat-face isometric props for the service scenes, drawn from tokens:
 * `currentColor` is the scene's hue; faces are the hue at three alphas
 * so both themes are free. One symbol per service, ~1 KB each.
 */
export function SceneArt({ kind }: { kind: string }): ReactElement {
  return (
    <svg viewBox="0 0 320 240" className="svc__art" role="img" aria-label={ART_LABEL[kind] ?? ''}>
      <defs>
        <linearGradient id={`svc-g-${kind}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {/* ground plate */}
      <path d="M160 200 L40 140 L160 80 L280 140 Z" fill="currentColor" opacity="0.12" />
      <path
        d="M160 200 L40 140 L160 80 L280 140 Z"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
      />
      {kind === 'to-india' || kind === 'to-bangladesh' ? (
        <Plane flip={kind === 'to-bangladesh'} />
      ) : null}
      {kind === 'import' ? <Warehouse /> : null}
      {kind === 'sell' ? <Shop /> : null}
    </svg>
  );
}

const ART_LABEL: Record<string, string> = {
  'to-india': 'A cargo plane flying from Bangladesh to India',
  'to-bangladesh': 'A cargo plane flying from India to Bangladesh',
  import: 'A warehouse with stacked cartons',
  sell: 'A storefront with a delivery van outside',
};

function Plane({ flip }: { flip: boolean }): ReactElement {
  return (
    <g transform={flip ? 'translate(320 0) scale(-1 1)' : undefined}>
      <path
        d="M60 150 C 110 60, 210 60, 260 120"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="6 8"
        opacity="0.6"
      />
      <g transform="translate(150 78) rotate(-12)">
        <path d="M-40 6 L30 0 L44 6 L30 12 Z" fill="currentColor" />
        <path d="M-6 6 L-26 -22 L-14 -22 L10 4 Z" fill="currentColor" opacity="0.75" />
        <path d="M-6 6 L-26 34 L-14 34 L10 8 Z" fill="currentColor" opacity="0.5" />
        <path d="M-40 6 L-52 -6 L-46 -6 L-32 4 Z" fill="currentColor" opacity="0.75" />
      </g>
      <g transform="translate(232 128)">
        <rect x="-16" y="-14" width="32" height="28" rx="4" fill="currentColor" opacity="0.9" />
        <path d="M-16 -2 H16 M0 -14 V14" stroke="var(--page)" strokeWidth="2" opacity="0.7" />
        <path d="M-22 -34 Q0 -58 22 -34 Z" fill="currentColor" opacity="0.55" />
        <path
          d="M-22 -34 L-10 -14 M22 -34 L10 -14"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.6"
        />
      </g>
      <circle cx="60" cy="150" r="6" fill="currentColor" />
      <circle cx="60" cy="150" r="12" fill="none" stroke="currentColor" opacity="0.4" />
    </g>
  );
}

function Warehouse(): ReactElement {
  return (
    <g>
      <path
        d="M100 150 L100 100 L160 70 L220 100 L220 150 L160 180 Z"
        fill="currentColor"
        opacity="0.28"
      />
      <path d="M100 100 L160 130 L220 100" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M160 130 V180" stroke="currentColor" strokeWidth="2" />
      <path d="M100 100 L160 70 L220 100" fill="currentColor" opacity="0.7" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${124 + i * 20} ${148 + i * 8})`}>
          <path d="M0 0 L12 -6 L24 0 L12 6 Z" fill="currentColor" opacity="0.95" />
          <path d="M0 0 L12 6 L12 18 L0 12 Z" fill="currentColor" opacity="0.7" />
          <path d="M24 0 L12 6 L12 18 L24 12 Z" fill="currentColor" opacity="0.5" />
        </g>
      ))}
    </g>
  );
}

function Shop(): ReactElement {
  return (
    <g>
      <path
        d="M96 156 L96 112 L156 82 L216 112 L216 156 L156 186 Z"
        fill="currentColor"
        opacity="0.28"
      />
      <path d="M96 112 L156 142 L216 112" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M156 142 V186" stroke="currentColor" strokeWidth="2" />
      <path
        d="M86 108 L156 72 L226 108 L216 118 L156 88 L96 118 Z"
        fill="currentColor"
        opacity="0.85"
      />
      <rect
        x="124"
        y="140"
        width="18"
        height="30"
        rx="2"
        fill="currentColor"
        opacity="0.9"
        transform="skewY(26)"
      />
      <g transform="translate(232 166)">
        <path
          d="M-22 -10 L-22 4 L18 4 L18 -6 L4 -6 L-2 -14 L-22 -14 Z"
          fill="currentColor"
          opacity="0.9"
        />
        <circle cx="-12" cy="6" r="5" fill="currentColor" />
        <circle cx="10" cy="6" r="5" fill="currentColor" />
      </g>
    </g>
  );
}
