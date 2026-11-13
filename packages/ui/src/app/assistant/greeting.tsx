'use client';

import { CheckCircle2, ChevronRight, ListChecks } from 'lucide-react';
import type { MouseEvent, ReactElement } from 'react';
import type { Translate } from '../i18n';
import type { UiMessageKey } from '../i18n/ui-messages';
import type { AssistantConsole } from './quick-actions';

/**
 * "What needs my attention?" — the card above the input of an EMPTY chat.
 *
 * It is plain data, never a model call: every figure comes from an endpoint
 * the console's own screens already read, through the same bearer-token
 * transport, so the server stays the authority on who may see what. The
 * status endpoint hands over only which of the card's permissions the caller
 * holds, so a request nobody may make is not sent (a viewer without
 * `wallet.view` never asks for the balance, and sees no balance line).
 */
export type GreetingLineKey = Extract<UiMessageKey, `ui.assistant.greet.line.${string}`>;

export interface GreetingLine {
  readonly key: GreetingLineKey;
  readonly count: number;
  readonly href: string;
}

interface Source {
  readonly key: GreetingLineKey;
  /** The permission the endpoint behind it needs; null = open to everyone signed in. */
  readonly permission: string | null;
  readonly path: string;
  readonly count: (data: unknown) => number;
  readonly href: string;
}

export interface GreetingTransport {
  request<T>(path: string): Promise<T>;
}

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const arrayLength = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** One status's count out of `GET /api/seller/orders/summary`. */
const fromSummary =
  (status: string) =>
  (v: unknown): number => {
    const rows = obj(v)['byStatus'];
    if (!Array.isArray(rows)) return 0;
    const row = rows.map(obj).find((r) => r['status'] === status);
    return row === undefined ? 0 : num(row['count']);
  };

/** Wallet lines say only that a balance is below zero; the figure itself stays on the wallet page. */
const negativeBalances = (v: unknown): number => {
  const rows = obj(v)['balances'];
  if (!Array.isArray(rows)) return 0;
  return rows.map(obj).filter((r) => r['isConverted'] !== true && Number(r['balance']) < 0).length;
};

/** `GET /api/store/orders?status=…&pageSize=1` → its `total`. */
const total = (v: unknown): number => num(obj(v)['total']);

const STORE_SOURCES: readonly Source[] = [
  {
    key: 'ui.assistant.greet.line.awaiting',
    permission: 'orders.view',
    path: '/api/store/orders?status=AWAITING_SELLER_DECISION&page=1&pageSize=1',
    count: total,
    href: '/orders?status=AWAITING_SELLER_DECISION',
  },
  {
    key: 'ui.assistant.greet.line.failed',
    permission: 'orders.view',
    path: '/api/store/orders?status=DELIVERY_FAILED&page=1&pageSize=1',
    count: total,
    href: '/orders?status=DELIVERY_FAILED',
  },
];

const SOURCES: Record<AssistantConsole, readonly Source[]> = {
  seller: [
    {
      key: 'ui.assistant.greet.line.awaiting',
      permission: 'orders.view',
      path: '/api/seller/orders/summary',
      count: fromSummary('AWAITING_SELLER_DECISION'),
      href: '/needs-attention',
    },
    {
      key: 'ui.assistant.greet.line.stuck',
      permission: 'orders.view',
      path: '/api/seller/nsa',
      count: arrayLength,
      href: '/needs-attention',
    },
    {
      key: 'ui.assistant.greet.line.failed',
      permission: 'orders.view',
      path: '/api/seller/orders/summary',
      count: fromSummary('DELIVERY_FAILED'),
      href: '/orders?status=DELIVERY_FAILED',
    },
    {
      key: 'ui.assistant.greet.line.balance',
      permission: 'wallet.view',
      path: '/api/seller/wallet',
      count: negativeBalances,
      href: '/wallet',
    },
  ],
  reseller: STORE_SOURCES,
  associate: STORE_SOURCES,
  admin: [
    {
      key: 'ui.assistant.greet.line.calls',
      permission: 'callcenter.queue.view',
      path: '/api/admin/call-queue/stats',
      count: (v) => num(obj(v)['openTotal']),
      href: '/call-center',
    },
    {
      key: 'ui.assistant.greet.line.manual',
      permission: 'courier.manual_placement',
      path: '/api/admin/courier/manual-placement/queue',
      count: arrayLength,
      href: '/manual-placement',
    },
  ],
};

export type GreetingResult =
  | { readonly state: 'lines'; readonly lines: readonly GreetingLine[] }
  | { readonly state: 'unavailable' };

/**
 * Ask each permitted endpoint once (two lines sharing a path share one
 * request). A line whose request fails is left out; if EVERY request fails
 * the card is not shown at all rather than claiming "all clear".
 */
export async function loadGreeting(
  console_: AssistantConsole,
  permissions: readonly string[],
  transport: GreetingTransport,
): Promise<GreetingResult> {
  const sources = SOURCES[console_].filter(
    (s) => s.permission === null || permissions.includes(s.permission),
  );
  if (sources.length === 0) return { state: 'unavailable' };
  const answers = new Map<string, Promise<unknown>>();
  const ask = (path: string): Promise<unknown> => {
    let p = answers.get(path);
    if (p === undefined) {
      p = transport.request<unknown>(path);
      answers.set(path, p);
    }
    return p;
  };
  const settled = await Promise.all(
    sources.map(async (s): Promise<GreetingLine | 'failed'> => {
      try {
        return { key: s.key, count: s.count(await ask(s.path)), href: s.href };
      } catch {
        return 'failed';
      }
    }),
  );
  const ok = settled.filter((r): r is GreetingLine => r !== 'failed');
  if (ok.length === 0) return { state: 'unavailable' };
  return { state: 'lines', lines: ok.filter((l) => l.count > 0) };
}

/** The sentence the "Explain these" button sends, in the person's own language. */
export function explainQuestion(
  t: Translate<UiMessageKey>,
  lines: readonly GreetingLine[],
): string {
  const summary = lines.map((l) => lineText(t, l)).join('; ');
  return t('ui.assistant.greet.explainQuestion', { summary });
}

export function lineText(t: Translate<UiMessageKey>, l: GreetingLine): string {
  return t(l.key, { n: String(l.count) });
}

export function GreetingCard({
  lines,
  t,
  onOpen,
  onExplain,
  disabled,
}: {
  readonly lines: readonly GreetingLine[];
  readonly t: Translate<UiMessageKey>;
  /** Click on a line's link; the widget navigates in-app and closes a phone's sheet. */
  readonly onOpen: (href: string) => (e: MouseEvent<HTMLAnchorElement>) => void;
  readonly onExplain: () => void;
  readonly disabled?: boolean;
}): ReactElement {
  const clear = lines.length === 0;
  return (
    <section
      className="sk-ai-greet"
      data-clear={clear ? '1' : undefined}
      aria-label={t('ui.assistant.greet.title')}
    >
      <h3 className="sk-ai-greet__title">
        <span className="sk-ai-greet__badge" aria-hidden="true">
          {clear ? <CheckCircle2 size={16} /> : <ListChecks size={16} />}
        </span>
        {t('ui.assistant.greet.title')}
      </h3>
      {clear ? (
        <p className="sk-ai-greet__clear">{t('ui.assistant.greet.clear')}</p>
      ) : (
        <>
          <ul className="sk-ai-greet__list">
            {lines.map((l) => (
              <li key={l.key}>
                <a className="sk-ai-greet__row" href={l.href} onClick={onOpen(l.href)}>
                  <span className="sk-ai-greet__count" aria-hidden="true">
                    {l.key === 'ui.assistant.greet.line.balance' ? '!' : l.count}
                  </span>
                  <span className="sk-ai-greet__text">{lineText(t, l)}</span>
                  <ChevronRight size={16} aria-hidden="true" className="sk-ai-greet__go" />
                </a>
              </li>
            ))}
          </ul>
          <button type="button" className="sk-ai-cta" disabled={disabled} onClick={onExplain}>
            {t('ui.assistant.greet.explain')}
          </button>
        </>
      )}
    </section>
  );
}
