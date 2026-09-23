'use client';

import { clsx } from 'clsx';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ms, reducedMotion } from '../motion/motion';
import './kpi-card.css';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const EN_IN = new Intl.NumberFormat('en-IN');
function defaultFormat(n: number): string {
  return EN_IN.format(n);
}

/**
 * Odometer — a count-up that runs ONCE, on first mount, and never again
 * (a refetch that changes the number just shows the new number).
 *
 * The real, final text is ALWAYS in the DOM: screen readers and tests
 * read it at every moment. While rolling it is painted transparent and a
 * visual copy — digit strips moved by transform, `aria-hidden` — sits on
 * top; when the roll ends the copy is removed. Reduced motion skips the
 * roll entirely. Tabular figures keep the columns from jittering.
 */
export function Odometer({
  value,
  format = defaultFormat,
  className,
}: {
  readonly value: number;
  readonly format?: ((n: number) => string) | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  const text = format(value);
  const [phase, setPhase] = useState<'idle' | 'roll' | 'armed'>('idle');
  const started = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  useIsoLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    if (reducedMotion()) return;
    setPhase('roll');
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setPhase('armed'));
    });
    const digits = textRef.current.replace(/\D/g, '').length;
    const t = window.setTimeout(() => setPhase('idle'), ms(900 + digits * 60 + 120));
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
    // Mount only: a later value never re-rolls.
  }, []);

  const rolling = phase !== 'idle';
  const chars = Array.from(text);
  let fromRight = chars.filter((c) => /\d/.test(c)).length;
  return (
    <span className={clsx('sk-odo sk-figure', className)} data-rolling={rolling ? '1' : undefined}>
      <span className="sk-odo__value">{text}</span>
      {rolling && (
        <span className="sk-odo__roll" aria-hidden>
          {chars.map((c, i) => {
            if (!/\d/.test(c)) return <span key={i}>{c}</span>;
            fromRight -= 1;
            const style = {
              '--n': phase === 'armed' ? Number(c) : 0,
              '--i': fromRight,
            } as CSSProperties;
            return (
              <span key={i} className="sk-odo__col">
                <span className="sk-odo__strip" style={style}>
                  {'0123456789'.split('').map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </span>
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}

export type KpiTone = 'credit' | 'debit' | 'pending' | 'neutral' | 'info';

export interface KpiTrend {
  readonly direction: 'up' | 'down' | 'flat';
  /** The words: "+12% vs last week". */
  readonly label: string;
  /** Whether this movement is good news; colours the chip. Omit for neutral. */
  readonly good?: boolean | undefined;
}

type KpiFigure =
  | {
      /** A figure the caller already rendered — e.g. their own `<Money>`. */
      readonly figure: ReactNode;
      readonly value?: undefined;
      readonly format?: undefined;
    }
  | {
      /** A plain count; rolled once by the odometer. */
      readonly value: number;
      readonly format?: ((n: number) => string) | undefined;
      readonly figure?: undefined;
    };

export type KpiCardProps = KpiFigure & {
  readonly label: ReactNode;
  /** The word after the figure — "orders", "parcels". */
  readonly unit?: ReactNode;
  /** A second, smaller figure or line under the main one. */
  readonly secondary?: ReactNode;
  readonly trend?: KpiTrend | undefined;
  /** A state chip (e.g. a `StatusChip`) in the corner. */
  readonly chip?: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: KpiTone;
  readonly hint?: ReactNode;
  /** Label/value pairs under a hairline — what the figure is made of. */
  readonly foot?:
    | ReadonlyArray<{ readonly label: ReactNode; readonly value: ReactNode }>
    | undefined;
  readonly className?: string | undefined;
};

/**
 * KpiCard — a headline figure on soft depth with a glow in its tone's
 * hue. The tone is never the only signal: the label says what the figure
 * is, and a trend carries an arrow icon and words.
 */
export function KpiCard(props: KpiCardProps): ReactElement {
  const {
    label,
    unit,
    secondary,
    trend,
    chip,
    icon,
    tone = 'neutral',
    hint,
    foot,
    className,
  } = props;
  const figure =
    props.figure !== undefined ? (
      props.figure
    ) : (
      <Odometer value={props.value ?? 0} format={props.format} />
    );
  const TrendIcon =
    trend === undefined
      ? null
      : trend.direction === 'up'
        ? TrendingUp
        : trend.direction === 'down'
          ? TrendingDown
          : Minus;
  return (
    <div className={clsx('sk-kpi', className)} data-tone={tone}>
      <span className="sk-kpi__glow" aria-hidden />
      <div className="sk-kpi__head">
        <div className="sk-kpi__label">{label}</div>
        {chip !== undefined && <div className="sk-kpi__chip">{chip}</div>}
        {icon !== undefined && (
          <span className="sk-kpi__icon" aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <div className="sk-kpi__figure-row">
        <span className="sk-kpi__figure sk-figure">{figure}</span>
        {unit !== undefined && <span className="sk-kpi__unit">{unit}</span>}
      </div>
      {(secondary !== undefined || trend !== undefined) && (
        <div className="sk-kpi__sub">
          {trend !== undefined && TrendIcon !== null && (
            <span
              className="sk-kpi__trend"
              data-good={trend.good === undefined ? undefined : trend.good ? '1' : '0'}
            >
              <TrendIcon size={13} aria-hidden />
              {trend.label}
            </span>
          )}
          {secondary !== undefined && <span className="sk-kpi__secondary">{secondary}</span>}
        </div>
      )}
      {hint !== undefined && <div className="sk-kpi__hint">{hint}</div>}
      {foot !== undefined && foot.length > 0 && (
        <dl className="sk-kpi__foot">
          {foot.map((row, i) => (
            <div key={i} className="sk-kpi__foot-row">
              <dt>{row.label}</dt>
              <dd className="sk-figure">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
