import type { UiMessageKey } from '../i18n/ui-messages';

export type AssistantConsole = 'admin' | 'seller' | 'reseller' | 'associate';

/** Where each console's API serves the assistant (the audience is decided server-side). */
export const ASSISTANT_API_BASE: Record<AssistantConsole, string> = {
  admin: '/api/admin/assistant',
  seller: '/api/seller/assistant',
  reseller: '/api/store/assistant',
  associate: '/api/store/assistant',
};

/**
 * Where an order number or waybill goes IN THIS CONSOLE. Every console has
 * an orders list that searches both, and none has a route keyed by order
 * number, so the search page is the only honest target.
 */
export function orderSearchHref(_console: AssistantConsole, value: string): string {
  return `/orders?search=${encodeURIComponent(value)}`;
}

export type QuickActionKey = Extract<UiMessageKey, `ui.assistant.qa.${string}`>;

const has = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * Suggestions for an empty chat: the page you are on first, then what the
 * console is generally for. At most four. Pure, so a test can pin it.
 */
export function quickActionsFor(
  console_: AssistantConsole,
  pathname: string | null,
  hasLastError = false,
): QuickActionKey[] {
  const path = pathname ?? '/';
  const out: QuickActionKey[] = [];
  const add = (...k: QuickActionKey[]): void => {
    for (const key of k) if (!out.includes(key)) out.push(key);
  };
  const onOrderPage =
    /^\/orders\/[^/]+$/.test(path) && !/^\/orders\/(new|new-v2|import|pending)$/.test(path);

  if (console_ === 'admin') {
    if (onOrderPage) add('ui.assistant.qa.stuck', 'ui.assistant.qa.whereOrder');
    if (
      ['/warehouse', '/manual-placement', '/courier-decisions', '/delivery-actions'].some((p) =>
        has(path, p),
      )
    ) {
      add('ui.assistant.qa.errorMeaning');
    }
    if (
      [
        '/treasury',
        '/seller-wallets',
        '/reseller-store-wallets',
        '/remittances',
        '/settlements',
        '/wallet-transfers',
        '/withdrawals',
      ].some((p) => has(path, p))
    ) {
      add('ui.assistant.qa.balance');
    }
    if (has(path, '/call-center')) add('ui.assistant.qa.callQueue');
    add('ui.assistant.qa.today', 'ui.assistant.qa.findParcel', 'ui.assistant.qa.manualPlace');
  } else if (console_ === 'seller') {
    if (onOrderPage) add('ui.assistant.qa.stuck', 'ui.assistant.qa.whereOrder');
    if (has(path, '/wallet')) add('ui.assistant.qa.balance', 'ui.assistant.qa.codPaid');
    if (has(path, '/orders')) add('ui.assistant.qa.needsAction');
    if (has(path, '/inventory') || has(path, '/products')) add('ui.assistant.qa.lowStock');
    if (has(path, '/needs-attention')) add('ui.assistant.qa.needsAction', 'ui.assistant.qa.whyRto');
    add('ui.assistant.qa.balance', 'ui.assistant.qa.createOrder', 'ui.assistant.qa.needsAction');
  } else if (console_ === 'reseller') {
    if (onOrderPage) add('ui.assistant.qa.stuck', 'ui.assistant.qa.whereOrder');
    if (has(path, '/wallet')) add('ui.assistant.qa.balance');
    if (has(path, '/orders')) add('ui.assistant.qa.needsAction');
    add('ui.assistant.qa.balance', 'ui.assistant.qa.createOrder', 'ui.assistant.qa.findParcel');
  } else {
    if (onOrderPage) add('ui.assistant.qa.stuck', 'ui.assistant.qa.whereOrder');
    if (has(path, '/orders')) add('ui.assistant.qa.needsAction');
    add(
      'ui.assistant.qa.placeForCustomer',
      'ui.assistant.qa.findParcel',
      'ui.assistant.qa.whereOrder',
    );
  }
  // Only offered when there is a recent error to explain, and then first.
  if (hasLastError) out.unshift('ui.assistant.qa.lastError');
  return out.slice(0, 4);
}
