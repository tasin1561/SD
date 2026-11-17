'use client';

import type { ReactElement } from 'react';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/catalog';

/** The counting words that sit beside a number, and where each is translated. */
const UNIT_KEYS = {
  ticket: 'easy.unitTicket',
  tickets: 'easy.unitTickets',
  bill: 'easy.unitBill',
  bills: 'easy.unitBills',
  store: 'easy.unitStore',
  stores: 'easy.unitStores',
  active: 'easy.unitActive',
  person: 'easy.unitPerson',
  people: 'easy.unitPeople',
  request: 'easy.unitRequest',
  requests: 'easy.unitRequests',
  ask: 'easy.unitAsk',
  asks: 'easy.unitAsks',
  change: 'easy.unitChange',
  changes: 'easy.unitChanges',
  order: 'easy.unitOrder',
  orders: 'easy.unitOrders',
  unit: 'easy.unitUnit',
  units: 'easy.unitUnits',
  product: 'easy.unitProduct',
  products: 'easy.unitProducts',
  invite: 'easy.unitInvite',
  invites: 'easy.unitInvites',
  role: 'easy.unitRole',
  roles: 'easy.unitRoles',
  row: 'easy.unitRow',
  rows: 'easy.unitRows',
  categories: 'easy.unitCategories',
  parcels: 'easy.unitParcels',
  member: 'easy.unitMember',
  members: 'easy.unitMembers',
  matching: 'easy.unitMatching',
  shown: 'easy.unitShown',
} as const satisfies Record<string, MessageKey>;

type Word = keyof typeof UNIT_KEYS;

function isWord(w: string): w is Word {
  return Object.prototype.hasOwnProperty.call(UNIT_KEYS, w);
}

/**
 * A counting word in the reader's language. A word this table does not
 * know is shown as it was given, so nothing ever goes blank.
 */
export function unitWord(t: (key: MessageKey) => string, word: string): string {
  return isWord(word) ? t(UNIT_KEYS[word]) : word;
}

/** The same, as an element: for a `unit` slot beside a headline number. */
export function Unit({ w }: { readonly w: string | undefined }): ReactElement | null {
  const t = useT();
  if (w === undefined) return null;
  return <>{unitWord(t, w)}</>;
}
