import { clsx } from 'clsx';
import {
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  FilePen,
  PackageCheck,
  PauseCircle,
  Truck,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { StatusKind } from '../../status';
import './status-chip.css';

/**
 * StatusChip — colour + ICON + word, never colour alone.
 *
 * The kind comes from the F2-exhaustive mappers in `@skydrop/ui/status`
 * (`orderStatusKind`, `shipmentStatusKind` …) and so does the word
 * (`statusLabel`, `ticketStatusLabel` …). This component invents
 * neither: it draws what it is handed. `held` and `neutral` are the two
 * display-only kinds the brand adds on top of the eight status kinds.
 *
 * `data-status-kind` is emitted on purpose — tests read it, the same
 * hook the legacy `StatusBadge` carried.
 *
 * `pulse` rings once on mount (a low-stock warning, a fresh arrival);
 * it is an opacity + scale ring, never a loop.
 */
export type StatusChipKind = StatusKind | 'held' | 'neutral';

const ICONS: Record<StatusChipKind, LucideIcon> = {
  draft: FilePen,
  pending: Clock,
  confirmed: CheckCircle2,
  'in-transit': Truck,
  delivered: PackageCheck,
  rto: Undo2,
  failed: XCircle,
  cancelled: Ban,
  held: PauseCircle,
  neutral: Circle,
};

/** Acronyms kept upper case when a label is shown in sentence case. */
const ACRONYMS = new Set([
  'RTO',
  'NDR',
  'AWB',
  'COD',
  'SKU',
  'OTP',
  'API',
  'GST',
  'FX',
  'ETA',
  'ID',
  'BD',
  'INR',
  'BDT',
  'UPI',
  'CSV',
]);

/**
 * The chip shows a status in SENTENCE case. The words are the vocabulary's
 * own (`statusLabel` and friends in `@skydrop/ui/status`, unchanged); only
 * the casing is presentation. The legacy badge hid the Title Case of those
 * labels ("Rto In Transit") behind `text-transform: uppercase`; sentence
 * case needs the acronyms kept, so "RTO in transit". A label that is not a
 * plain string (a node) is left exactly as given.
 */
export function chipWords(label: ReactNode): ReactNode {
  if (typeof label !== 'string') return label;
  return label
    .split(' ')
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper.replace(/[^A-Z]/g, ''))) return upper;
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

export function StatusChip({
  kind,
  label,
  pulse = false,
  size = 'md',
  title,
  className,
}: {
  readonly kind: StatusChipKind;
  /** The word, from `@skydrop/ui/status`. */
  readonly label: string;
  /** Ring once on mount. */
  readonly pulse?: boolean;
  readonly size?: 'sm' | 'md';
  readonly title?: string | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  const Icon = ICONS[kind];
  const style = {
    '--chip-fg': `var(--st-${kind}-fg)`,
    '--chip-bg': `var(--st-${kind}-bg)`,
    '--chip-line': `var(--st-${kind}-line)`,
  } as CSSProperties;
  return (
    <span
      className={clsx('sk-chip', size === 'sm' && 'sk-chip--sm', className)}
      data-status-kind={kind}
      data-pulse={pulse ? '1' : undefined}
      style={style}
      title={title}
    >
      <Icon
        className="sk-chip__icon"
        size={size === 'sm' ? 12 : 14}
        strokeWidth={2.2}
        aria-hidden
      />
      <span className="sk-chip__label">{chipWords(label)}</span>
    </span>
  );
}
