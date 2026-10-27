import { toCatalogs } from './define';
import { account } from './messages/account';
import { addressCorrection } from './messages/addressCorrection';
import { associates } from './messages/associates';
import { auth } from './messages/auth';
import { callReviews } from './messages/callReviews';
import { catalogue } from './messages/catalogue';
import { common } from './messages/common';
import { consignee } from './messages/consignee';
import { customers } from './messages/customers';
import { dashboard } from './messages/dashboard';
import { expenses } from './messages/expenses';
import { integrations } from './messages/integrations';
import { notifications } from './messages/notifications';
import { orderActions } from './messages/orderActions';
import { orderDetail } from './messages/orderDetail';
import { orderImport } from './messages/orderImport';
import { orderMoney } from './messages/orderMoney';
import { orderNew } from './messages/orderNew';
import { orders } from './messages/orders';
import { reports } from './messages/reports';
import { settings } from './messages/settings';
import { shell } from './messages/shell';
import { team } from './messages/team';
import { terms } from './messages/terms';
import { tickets } from './messages/tickets';
import { wallet } from './messages/wallet';

/**
 * Every namespace, in one place. A namespace is a file of `[en, bn]` pairs;
 * the unit spec asserts no key is defined twice (a spread would silently let
 * the later file win) and that every `{placeholder}` appears in both languages.
 */
export const NAMESPACES = [
  account,
  addressCorrection,
  associates,
  auth,
  callReviews,
  catalogue,
  common,
  consignee,
  customers,
  dashboard,
  expenses,
  integrations,
  notifications,
  orderActions,
  orderDetail,
  orderImport,
  orderMoney,
  orderNew,
  orders,
  reports,
  settings,
  shell,
  team,
  terms,
  tickets,
  wallet,
] as const;

const ALL = {
  ...account,
  ...addressCorrection,
  ...associates,
  ...auth,
  ...callReviews,
  ...catalogue,
  ...common,
  ...consignee,
  ...customers,
  ...dashboard,
  ...expenses,
  ...integrations,
  ...notifications,
  ...orderActions,
  ...orderDetail,
  ...orderImport,
  ...orderMoney,
  ...orderNew,
  ...orders,
  ...reports,
  ...settings,
  ...shell,
  ...team,
  ...terms,
  ...tickets,
  ...wallet,
};

export type MessageKey = keyof typeof ALL;

/** `{ en, bn }`, each a flat key → string map. English is the fallback for Bangla. */
export const CATALOGS = toCatalogs<MessageKey>(ALL);
