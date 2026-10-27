import { toCatalogs } from './define';
import { account } from './messages/account';
import { auth } from './messages/auth';
import { common } from './messages/common';
import { notifications } from './messages/notifications';
import { orderImport } from './messages/orderImport';
import { csvColumns } from './messages/csvColumns';
import { orderNew } from './messages/orderNew';
import { orders } from './messages/orders';
import { shell } from './messages/shell';
import { tickets } from './messages/tickets';

/**
 * Every namespace, in one place. A namespace is a file of `[en, bn]` pairs;
 * the unit spec asserts no key is defined twice (a spread would silently let
 * the later file win) and that every `{placeholder}` appears in both languages.
 */
export const NAMESPACES = [
  common,
  auth,
  shell,
  notifications,
  account,
  tickets,
  orders,
  orderImport,
  csvColumns,
  orderNew,
] as const;

const ALL = {
  ...common,
  ...auth,
  ...shell,
  ...notifications,
  ...account,
  ...tickets,
  ...orders,
  ...orderImport,
  ...csvColumns,
  ...orderNew,
};

export type MessageKey = keyof typeof ALL;

/** `{ en, bn }`, each a flat key → string map. English is the fallback for Bangla. */
export const CATALOGS = toCatalogs<MessageKey>(ALL);
