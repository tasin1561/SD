import { DEFAULT_LOCALE, makeTranslator, type Locale } from '../app/i18n';
import { UI_MESSAGES } from '../app/i18n/ui-messages';
import {
  AlertTriangle,
  Bell,
  ClipboardCheck,
  FileSignature,
  MessagesSquare,
  Package,
  PackageCheck,
  RotateCcw,
  Truck,
  Wallet,
  Warehouse,
} from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * How a notification LOOKS, and how old it reads.
 *
 * Shared because two surfaces show the same rows — the bell panel and
 * the full inbox — and a group that is a red triangle in one and a blue
 * lorry in the other teaches the reader that the icon means nothing.
 * The bell had these inline first; the page is the second consumer, and
 * a second consumer is what turns a local helper into a shared one
 * rather than a copy that slowly disagrees.
 */
export interface NotificationKindStyle {
  readonly Icon: ComponentType<{ size?: number }>;
  /** A `--status-<tone>-bg/fg` pair from tokens.css. Never a hex (FE-6). */
  readonly tone: string;
}

/**
 * Keyed on the topic catalogue's own group names (NOTIF-17). An unknown
 * group falls back to the bell: a new group added server-side must
 * render as SOMETHING, and rendering as nothing would hide the
 * notification entirely.
 */
const GROUP_STYLE: Record<string, NotificationKindStyle> = {
  Couriers: { Icon: Truck, tone: 'in-transit' },
  Shipments: { Icon: PackageCheck, tone: 'in-transit' },
  Orders: { Icon: Package, tone: 'confirmed' },
  Returns: { Icon: RotateCcw, tone: 'rto' },
  Money: { Icon: Wallet, tone: 'delivered' },
  Warehouse: { Icon: Warehouse, tone: 'pending' },
  System: { Icon: AlertTriangle, tone: 'failed' },
  // Shared with the seller and staff catalogues, which both have a
  // Tickets group; the other three are the reseller store's (2026-09-19).
  Tickets: { Icon: MessagesSquare, tone: 'rto' },
  'Your requests': { Icon: ClipboardCheck, tone: 'pending' },
  'Your orders': { Icon: Package, tone: 'confirmed' },
  Terms: { Icon: FileSignature, tone: 'draft' },
};

const FALLBACK: NotificationKindStyle = { Icon: Bell, tone: 'draft' };

export function notificationKindStyle(group: string | null): NotificationKindStyle {
  return (group !== null ? GROUP_STYLE[group] : undefined) ?? FALLBACK;
}

/**
 * How long ago, in the words a person would use.
 *
 * Minutes and hours while it is still today, "Yesterday" while that is
 * the clearest thing to say, then a date. An absolute timestamp on a
 * row that arrived twelve minutes ago makes the reader do the
 * subtraction; a relative one on something from August makes them do
 * worse.
 */
export function agoLabel(iso: string, now: number, locale: Locale = DEFAULT_LOCALE): string {
  const t = makeTranslator(UI_MESSAGES[locale], UI_MESSAGES.en);
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const mins = Math.floor((now - ts) / 60_000);
  if (mins < 1) return t('ui.ago.now');
  if (mins < 60) return t('ui.ago.minutes', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('ui.ago.hours', { n: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t('ui.ago.yesterday');
  // Latin digits in Bangla too (`-u-nu-latn`): numerals stay 0-9 everywhere.
  return new Date(ts).toLocaleDateString(locale === 'bn' ? 'bn-BD-u-nu-latn' : undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * `shipment.delivery_failed.seller` → `Delivery failed`, as a last
 * resort for a topic the catalogue does not name.
 *
 * The trailing segment is dropped when it is an AUDIENCE or a CHANNEL
 * rather than the subject: a topic key is the template code without its
 * `.email` suffix (NOTIF-14), and a row whose stored code kept one was
 * rendering a chip that said "EMAIL" — the channel it arrived on, which
 * the reader can see, in the place reserved for what it is about.
 */
const NOT_THE_SUBJECT = new Set(['seller', 'staff', 'email', 'inapp', 'in_app', 'sms']);

export function humaniseTopic(topic: string): string {
  const parts = topic.split('.').filter((p) => !NOT_THE_SUBJECT.has(p));
  const word = parts[parts.length - 1] ?? topic;
  const spaced = word.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
