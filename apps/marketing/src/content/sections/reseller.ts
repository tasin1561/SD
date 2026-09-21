import type { ResellerSectionContent } from './reseller-types';

/**
 * SECTION 14 — Reseller stores. Every label here is the app's own: the
 * page subtitle from apps/seller `/reseller-stores`, the fee labels and
 * credit timings from `FEE_FIELDS` / `CREDIT_TRIGGERS`, the seven
 * capabilities and both questions from the action-policy screen, and the
 * table columns from apps/reseller `/catalogue`.
 *
 * NO FIGURE LIVES HERE, and none of them is a `dummy()` either. Every
 * percentage, price and count in the demo is illustrative furniture
 * declared in the island beside the markup it draws — the same rule the
 * tour vignettes follow. A share, a transfer price and a retail band are
 * a bargain struck between one seller and one store; Skydrop neither sets
 * them nor has a real value the owner could supply. The one number that
 * WOULD be Skydrop's own — the Instant Pay rate — is absent here exactly
 * as it is in the money vignette: the row names the fee and stops.
 */
export const reseller: ResellerSectionContent = {
  title: 'Reseller stores',
  promise: 'Other businesses that sell your stock under their own name, with their own login.',
  sellerHue: 'blue',
  storeHue: 'violet',

  // The seven, in the order the seller's own screen lists them. `claims`
  // is the 3A task each one answers; two are shown because the app has
  // them, and 3A does not claim either.
  capabilities: [
    { task: 'Call the customer again', claims: 'recall' },
    { task: 'Change the order', claims: 'change an order' },
    { task: 'Call the order off', claims: 'cancel' },
    { task: 'Answer “keep trying?”', claims: null },
    { task: 'Raise it with Skydrop', claims: 'chase us' },
    { task: 'Try delivering again', claims: null },
    { task: 'Send the parcel back', claims: 'send back' },
  ],

  policyQuestions: {
    can: 'Can the Reseller store do this?',
    how: 'How?',
    direct: 'Directly',
    approval: 'Needs my approval',
  },

  storeColumns: ['Product', 'You pay', 'Sell between', 'Suggested', 'Available'],
  hiddenColumns: ['Your cost', 'Real stock'],

  creditTriggers: [
    'When the courier pays us (+ days)',
    'Days after delivery',
    'Instant, at delivery (Instant Pay fee applies)',
    'Days after confirmation',
  ],

  fees: [
    'Delivery fee',
    'Return fee',
    'Customer return fee',
    'COD fee',
    'COD tax',
    'Instant Pay fee',
  ],

  cards: [
    {
      id: 'terms',
      title: 'Terms you set',
      line: 'Per fee, the share the store pays — “Delivery fee — store pays (%)” — and when each of you is credited.',
    },
    {
      id: 'sees',
      title: 'What the store sees',
      line: 'A “Hidden share (%)” of your stock, or “Units set aside” for them. Never your cost, your real stock or your other stores.',
    },
    {
      id: 'does',
      title: 'What the store may do',
      line: 'Two questions per task: can the store do this, and does it need your approval first?',
    },
    {
      id: 'disputes',
      title: 'Disputes',
      line: 'A disagreement is settled between your two wallets — never from ours.',
    },
    {
      id: 'brand',
      title: 'The customer sees the store',
      line: 'The tracking page, the courier label and the emails carry the store’s name and logo — never yours.',
    },
    {
      id: 'orders',
      title: 'How it orders',
      line: 'By portal, CSV or API key; paid on delivery, or prepaid from its own wallet.',
    },
    {
      id: 'wallet',
      title: 'Its own books',
      line: 'Its own login, team and permissions; its own wallet, P&L and expense book.',
    },
    {
      id: 'guard',
      title: 'Guardrails',
      line: 'Auto-pause a store at a return rate you set; fraud signals are surfaced to us.',
    },
  ],

  note: 'Figures in the demo are illustrative.',

  // `step` is the short line in the list beside the mock; `caption` is the
  // sentence the frame reads aloud. Saying the same words twice would make
  // the list decoration rather than the accessible half of the picture.
  beats: [
    {
      id: 'terms',
      ms: 2200,
      step: 'Versioned terms the store accepts: each fee split by the share you set, and when each of you is credited',
      caption:
        'You publish the terms: each Skydrop fee split by the share you set, and when each side is credited.',
    },
    {
      id: 'catalogue',
      ms: 2000,
      step: 'Which products, at what transfer price, and how much stock it is shown — set aside, less a hidden share',
      caption:
        'You choose what the store is shown — units set aside for them, less a hidden share. It sees the visible figure only.',
    },
    {
      id: 'policy',
      ms: 2200,
      step: 'Two questions per task, for all seven — and whether it happens directly or waits for your approval',
      caption:
        'Per task you answer two questions: can the store do this, and may it act directly or does it need your approval?',
    },
    {
      id: 'store',
      ms: 2000,
      step: 'Its own login and portal — its price and visible stock, never your cost, real stock or other stores',
      caption:
        'The store signs in to its own portal: what it pays you, what it may sell for, and how many it can sell.',
    },
    {
      id: 'dispute',
      ms: 2000,
      step: 'A dispute settles between your two wallets',
      caption: 'If you disagree, the money moves between your two wallets — never from ours.',
    },
  ],
};
