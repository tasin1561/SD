'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import './scene-art.css';

/**
 * The four service scenes, drawn as flat-face isometric pieces in the
 * section's own accent. Every fill is one of the five `--art-*` faces that
 * `[data-hue]` (sections.css) sets — top / mid / side / edge / glow — so a
 * piece is genuinely coloured in BOTH themes rather than a grey wireframe,
 * and switching the hue re-paints it with no code change. The wrapper is
 * what carries `data-hue`, because the switcher's art slot does not.
 *
 * `sell` is drawn MAGENTA (the owner's call) whatever hue the scene content
 * declares; the map below is the one place that decides.
 */
export function SceneArt({ kind }: { kind: string }): ReactElement {
  const raw = useId();
  const uid = `sa${raw.replace(/[^a-zA-Z0-9]/g, '')}${kind.replace(/[^a-z]/g, '')}`;
  // Animations run only while the scene is on screen — the same gate the
  // hero canvas has. Off screen (or before the observer has spoken) every
  // loop is paused; a client without IntersectionObserver plays.
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return;
    }
    const io = new IntersectionObserver((es) => setActive(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const home = kind === 'to-bangladesh';
  return (
    <div
      ref={ref}
      className="svc-art"
      data-hue={HUE[kind] ?? 'saffron'}
      data-active={active ? '' : undefined}
    >
      <div className="svc-art__stage">
        <svg
          viewBox="0 0 480 360"
          className="svc__art"
          role="img"
          aria-label={LABEL[kind] ?? 'Skydrop service illustration'}
        >
          <defs>
            {/* The ground pool. A flat ellipse of `--art-glow` reads as a hard
              puddle; faded to nothing it reads as light. */}
            <radialGradient id={`${uid}g`}>
              <stop offset="0" stopColor="var(--art-glow)" />
              <stop offset="1" stopColor="var(--art-glow)" stopOpacity="0" />
            </radialGradient>
          </defs>
          {kind === 'to-india' ? <Corridor id={uid} /> : null}
          {kind === 'to-bangladesh' ? <Corridor id={uid} home /> : null}
          {kind === 'import' ? <Warehouse id={uid} /> : null}
          {kind === 'sell' ? <Shop id={uid} /> : null}
        </svg>
        {kind === 'to-india' || kind === 'to-bangladesh' ? (
          <>
            <Layer
              cls="fly"
              root={CORRIDOR_ROOT(home)}
              origin={home ? '50.8% 28.6%' : '49.2% 28.6%'}
            >
              <CorridorFly />
            </Layer>
            <Layer cls="drop" root={CORRIDOR_ROOT(home)} origin={home ? '17.1% 21%' : '82.9% 21%'}>
              <CorridorDrop />
            </Layer>
          </>
        ) : null}
        {kind === 'import' ? (
          <>
            <Layer cls="lift" root="translate(0 44)">
              <WarehouseLift />
            </Layer>
            <Layer cls="tag" root="translate(0 44)">
              <WarehouseTag />
            </Layer>
          </>
        ) : null}
        {kind === 'sell' ? (
          <>
            <Layer cls="van" root="translate(0 40)">
              <ShopVan />
            </Layer>
            <Layer cls="still" root="translate(0 40)">
              <ShopCarton />
            </Layer>
            <Layer cls="phone" root="translate(0 40)">
              <ShopPhone />
            </Layer>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The hue each piece is painted in — `sell` is magenta, not the content's violet. */
const HUE: Record<string, string> = {
  'to-india': 'saffron',
  'to-bangladesh': 'green',
  import: 'teal',
  sell: 'magenta',
};

const LABEL: Record<string, string> = {
  'to-india':
    'A cargo plane climbing a corridor from Bangladesh to India, with a parcel coming down under a parachute onto a destination pin',
  'to-bangladesh':
    'A cargo plane flying the corridor back to Bangladesh, with a parcel coming down under a parachute onto a destination pin',
  import:
    'A warehouse with cartons stacked on a pallet, one being lifted in, and a counted-off tally',
  sell: 'A shopfront with an order confirmed on a phone and a parcel leaving in a van at the kerb',
};

const n = (v: number): string => String(Math.round(v * 10) / 10);

/**
 * The three visible faces of a 2:1 dimetric box whose TOP face has its near
 * corner at (x, y): `w` runs up-right, `d` runs up-left, `h` drops straight
 * down. Returned top / right / left so the caller paints light to dark.
 */
function faces(x: number, y: number, w: number, d: number, h: number): [string, string, string] {
  const rx = x + w;
  const ry = y - w / 2;
  const bx = rx - d;
  const by = ry - d / 2;
  const lx = x - d;
  const ly = y - d / 2;
  return [
    `M${n(x)} ${n(y)}L${n(rx)} ${n(ry)}L${n(bx)} ${n(by)}L${n(lx)} ${n(ly)}Z`,
    `M${n(x)} ${n(y)}L${n(rx)} ${n(ry)}L${n(rx)} ${n(ry + h)}L${n(x)} ${n(y + h)}Z`,
    `M${n(x)} ${n(y)}L${n(lx)} ${n(ly)}L${n(lx)} ${n(ly + h)}L${n(x)} ${n(y + h)}Z`,
  ];
}

interface BoxProps {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  /** A carton: cross the top face with packing tape. */
  tape?: boolean;
}

function Box({ x, y, w, d, h, tape }: BoxProps): ReactElement {
  const [top, right, left] = faces(x, y, w, d, h);
  return (
    <g>
      <path d={left} fill="var(--art-side)" />
      <path d={right} fill="var(--art-mid)" />
      <path d={top} fill="var(--art-top)" />
      <path d={top} fill="none" stroke="var(--art-edge)" strokeWidth="1.6" strokeOpacity="0.55" />
      {tape ? (
        <path
          d={`M${n(x + w / 2)} ${n(y - w / 4)}L${n(x + w / 2 - d)} ${n(y - w / 4 - d / 2)}M${n(x - d / 2)} ${n(y - d / 4)}L${n(x + w - d / 2)} ${n(y - d / 4 - w / 2)}`}
          stroke="var(--art-edge)"
          strokeWidth="2"
          strokeOpacity="0.9"
        />
      ) : null}
    </g>
  );
}

function Ground({
  id,
  cx,
  cy,
  rx,
  ry,
}: {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}): ReactElement {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id}g)`} />;
}

/* ── 1 + 2 · the corridor ─────────────────────────────────────────────────
   One composition serves both directions: a plate you leave, a plate you
   arrive at, the corridor arc between them, a plane riding it and a parcel
   coming down under a chute. `home` MIRRORS the whole piece — so the journey
   visibly runs the other way, the plane turns round with it (its CSS travel
   is inside the mirror) and the corridor gradient keeps green at the
   Bangladesh end, which is now the left. */
function Corridor({ id, home }: { id: string; home?: boolean }): ReactElement {
  return (
    <g transform={home ? 'translate(480 -18)scale(-1 1)' : 'translate(0 -18)'}>
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={home ? 'var(--saffron-500)' : 'var(--green-500)'} />
          <stop offset="0.5" stopColor="var(--saffron-400)" />
          <stop offset="1" stopColor={home ? 'var(--green-500)' : 'var(--saffron-500)'} />
        </linearGradient>
      </defs>
      <Ground id={id} cx={240} cy={312} rx={214} ry={54} />

      {/* the plate you leave */}
      <ellipse cx="98" cy="292" rx="56" ry="28" fill="var(--art-side)" />
      <ellipse cx="98" cy="282" rx="56" ry="28" fill="var(--art-mid)" />
      <ellipse
        cx="98"
        cy="282"
        rx="56"
        ry="28"
        fill="none"
        stroke="var(--art-edge)"
        strokeWidth="2"
        strokeOpacity="0.5"
      />

      {/* the plate you arrive at */}
      <ellipse cx="372" cy="280" rx="78" ry="39" fill="var(--art-side)" />
      <ellipse cx="372" cy="268" rx="78" ry="39" fill="var(--art-mid)" />
      <ellipse
        cx="372"
        cy="268"
        rx="78"
        ry="39"
        fill="none"
        stroke="var(--art-edge)"
        strokeWidth="2"
        strokeOpacity="0.5"
      />

      {/* the corridor itself — under the cargo, so it leaves from behind it */}
      <path
        className="art-arc"
        d="M104 256C158 96 320 84 378 212"
        fill="none"
        stroke={`url(#${id}c)`}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="14 10"
      />

      <Box x={92} y={252} w={30} d={26} h={26} tape />
      <Box x={122} y={268} w={22} d={20} h={20} />
      <path d="M372 262L358 240a17 17 0 1 1 28 0Z" fill="var(--art-top)" />
      <circle cx="372" cy="237" r="5.5" fill="var(--art-side)" />

      {/* down under a chute */}
    </g>
  );
}

/* ── 3 · stock in India ───────────────────────────────────────────────────
   An open-front shed with a gable roof and stock already inside, and in the
   foreground a pallet of cartons with one being lifted in — plus the tally
   that says the arrival was counted. */
function Warehouse({ id }: { id: string }): ReactElement {
  return (
    <g transform="translate(0 44)">
      <Ground id={id} cx={240} cy={268} rx={218} ry={56} />

      <path d="M152 200L270 141L176 94L58 153Z" fill="var(--art-side)" />
      <path d="M58 153L176 94L176 24L58 83Z" fill="var(--art-mid)" />
      <path d="M176 94L270 141L270 71L176 24Z" fill="var(--art-side)" />
      <path d="M176 94L176 24" stroke="var(--art-edge)" strokeWidth="2" strokeOpacity="0.45" />
      <Box x={146} y={155} w={26} d={24} h={22} tape />
      <Box x={190} y={145} w={26} d={24} h={22} tape />
      <path d="M58 83L176 24L223 18L105 77Z" fill="var(--art-mid)" />
      <path d="M152 130L270 71L223 18L105 77Z" fill="var(--art-top)" />
      <path
        d="M105 77L223 18"
        stroke="var(--art-edge)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeOpacity="0.8"
      />
      <rect x="149" y="130" width="6" height="70" fill="var(--art-top)" />
      <rect x="267" y="71" width="6" height="70" fill="var(--art-top)" />
      <rect x="55" y="83" width="6" height="70" fill="var(--art-top)" />

      <Box x={304} y={238} w={82} d={70} h={12} />
      <Box x={272} y={184} w={36} d={32} h={32} tape />
      <Box x={304} y={200} w={36} d={32} h={32} tape />
      <Box x={342} y={181} w={36} d={32} h={32} tape />
      <Box x={304} y={168} w={36} d={32} h={32} tape />
      <path
        d="M304 154L304 168"
        stroke="var(--art-mid)"
        strokeWidth="2"
        strokeDasharray="3 4"
        strokeOpacity="0.7"
      />
    </g>
  );
}

/* ── 4 · sell in India ────────────────────────────────────────────────────
   A shopfront under a striped awning, the confirmation call on a phone, and
   the parcel leaving in a van at the kerb. */
function Shop({ id }: { id: string }): ReactElement {
  return (
    <g transform="translate(0 40)">
      <Ground id={id} cx={250} cy={266} rx={222} ry={58} />

      <path d="M176 226L80 178L80 94L176 142Z" fill="var(--art-side)" />
      <path d="M176 226L300 164L300 80L176 142Z" fill="var(--art-mid)" />
      <path d="M176 142L300 80L204 32L80 94Z" fill="var(--art-top)" />
      <path
        d="M176 142L300 80L204 32L80 94Z"
        fill="none"
        stroke="var(--art-edge)"
        strokeWidth="2.5"
        strokeOpacity="0.7"
      />
      <Box x={186} y={65} w={26} d={24} h={22} />

      {/* door, window, sign, awning — all on the two street-facing walls */}
      <path d="M160 158L116 136L116 196L160 218Z" fill="var(--art-mid)" />
      <path
        d="M160 158L116 136L116 196L160 218Z"
        fill="none"
        stroke="var(--art-edge)"
        strokeWidth="2"
        strokeOpacity="0.6"
      />
      <circle cx="124" cy="170" r="3.5" fill="var(--art-edge)" />
      <path d="M192 168L272 128L272 170L192 210Z" fill="var(--art-side)" />
      <path
        d="M192 168L272 128L272 170L192 210Z"
        fill="none"
        stroke="var(--art-edge)"
        strokeWidth="2"
        strokeOpacity="0.7"
      />
      <path d="M200 182L232 166" stroke="var(--art-edge)" strokeWidth="5" strokeOpacity="0.35" />
      <path d="M196 138L256 108L256 120L196 150Z" fill="var(--art-edge)" opacity="0.9" />
      {[0, 1, 2, 3, 4].map((i) => {
        const px = 192 + i * 16;
        const py = 158 - i * 8;
        return (
          <path
            key={i}
            d={`M${n(px)} ${n(py)}L${n(px + 16)} ${n(py - 8)}L${n(px + 38)} ${n(py + 7)}L${n(px + 22)} ${n(py + 15)}Z`}
            fill={i % 2 === 0 ? 'var(--art-top)' : 'var(--art-mid)'}
          />
        );
      })}
      <path d="M214 173L294 133L294 144L214 184Z" fill="var(--art-side)" />

      <Box x={300} y={256} w={120} d={52} h={10} />
    </g>
  );
}

/* ── The animated pieces, each drawn on its OWN overlay <svg> ──────────────
   A `transform` animated on an SVG <g> is laid out by Chrome on the main
   thread every frame (SVG transforms are not composited): ~60 layouts a
   second while the scene was on screen, in every build (PHASE-8-MUST-FIX,
   final pass). An overlay <svg> is an HTML-level box, so the same keyframes
   on it composite. Each layer shares the base's viewBox and its scene's
   root transform, so coordinates are unchanged; the keyframe offsets are
   percentages of the layer box (scene-art.css). */
function Layer({
  cls,
  root,
  origin,
  children,
}: {
  cls: string;
  root: string;
  origin?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <svg
      className={`svc__layer svc__layer--${cls}`}
      viewBox="0 0 480 360"
      aria-hidden="true"
      focusable="false"
      style={origin ? ({ transformOrigin: origin } as CSSProperties) : undefined}
    >
      <g transform={root}>{children}</g>
    </svg>
  );
}

const CORRIDOR_ROOT = (home?: boolean): string =>
  home ? 'translate(480 -18)scale(-1 1)' : 'translate(0 -18)';

function CorridorFly(): ReactElement {
  return (
    <g transform="translate(240 120)">
      <g>
        <path d="M-14 -5L-44 -34L-26 -36L8 -8Z" fill="var(--art-side)" />
        <path d="M-48 -2L-53 -28L-42 -29L-36 -4Z" fill="var(--art-side)" />
        <path d="M-46 3L-58 11L-49 12L-38 5Z" fill="var(--art-side)" />
        <path d="M-54 2L18 11L50 0Z" fill="var(--art-mid)" />
        <path d="M-54 -2L18 -11L50 0L-54 2Z" fill="var(--art-top)" />
        <path d="M-32 -3L2 -7L2 -3L-32 0Z" fill="var(--art-edge)" opacity="0.9" />
        <path
          d="M-10 5L-40 36L-20 38L14 7Z"
          fill="var(--art-mid)"
          stroke="var(--art-edge)"
          strokeWidth="1.5"
          strokeOpacity="0.5"
        />
      </g>
    </g>
  );
}
function CorridorDrop(): ReactElement {
  return (
    <g transform="translate(398 132)">
      <g>
        <path d="M-46 -4C-46 -34 -30 -46 -15 -47L-15 -4Q-31 3 -46 -4Z" fill="var(--art-mid)" />
        <path d="M-15 -47C-5 -48 5 -48 15 -47L15 -4Q0 3 -15 -4Z" fill="var(--art-top)" />
        <path d="M15 -47C30 -46 46 -34 46 -4Q31 3 15 -4Z" fill="var(--art-side)" />
        <path
          d="M-46 -4Q-31 3 -15 -4Q0 3 15 -4Q31 3 46 -4"
          fill="none"
          stroke="var(--art-side)"
          strokeWidth="2.5"
        />
        <path
          d="M-42 -2L-11 24M-13 -3L-6 24M13 -3L6 24M42 -2L11 24"
          stroke="var(--art-mid)"
          strokeWidth="2"
        />
        <Box x={0} y={28} w={24} d={22} h={22} tape />
      </g>
    </g>
  );
}
function WarehouseLift(): ReactElement {
  return (
    <g>
      <Box x={304} y={122} w={36} d={32} h={32} tape />
    </g>
  );
}
function WarehouseTag(): ReactElement {
  return (
    <g>
      <rect x="338" y="38" width="56" height="56" rx="12" fill="var(--art-mid)" />
      <path
        d="M352 56h30M352 70h30M352 84h18"
        stroke="var(--art-edge)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeOpacity="0.8"
      />
      <circle cx="404" cy="90" r="26" fill="var(--art-top)" />
      <circle
        cx="404"
        cy="90"
        r="26"
        fill="none"
        stroke="var(--art-edge)"
        strokeWidth="2.5"
        strokeOpacity="0.7"
      />
      <path
        d="M392 90l8 10 17-20"
        fill="none"
        stroke="var(--art-side)"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}
function ShopVan(): ReactElement {
  return (
    <g>
      <Box x={306} y={195} w={76} d={40} h={46} />
      <Box x={382} y={171} w={32} d={40} h={32} />
      <path d="M388 172L410 161L410 179L388 190Z" fill="var(--art-edge)" opacity="0.85" />
      <ellipse
        cx="332"
        cy="228"
        rx="12"
        ry="8"
        fill="var(--art-side)"
        transform="rotate(-26 332 228)"
      />
      <ellipse
        cx="398"
        cy="196"
        rx="12"
        ry="8"
        fill="var(--art-side)"
        transform="rotate(-26 398 196)"
      />
      <circle cx="332" cy="228" r="3.5" fill="var(--art-edge)" />
      <circle cx="398" cy="196" r="3.5" fill="var(--art-edge)" />
    </g>
  );
}
/** The carton at the kerb: static, drawn ABOVE the van as it was in the base. */
function ShopCarton(): ReactElement {
  return <Box x={302} y={221} w={24} d={22} h={24} tape />;
}
function ShopPhone(): ReactElement {
  return (
    <g transform="translate(348 76) rotate(-10)">
      <g>
        <rect x="-31" y="-54" width="62" height="108" rx="13" fill="var(--art-side)" />
        <rect x="-25" y="-46" width="50" height="86" rx="6" fill="var(--art-mid)" />
        <path
          d="M-13 -5l9 11 19-24"
          fill="none"
          stroke="var(--art-top)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="-9" y="44" width="18" height="4" rx="2" fill="var(--art-edge)" opacity="0.7" />
        <path
          d="M40 -16q10 12 0 24M52 -26q19 22 0 44"
          fill="none"
          stroke="var(--art-top)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeOpacity="0.75"
        />
      </g>
    </g>
  );
}
