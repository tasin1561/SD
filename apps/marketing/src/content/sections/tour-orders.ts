import type { TourVignetteContent } from './tour-types';

/**
 * Tour vignette 3 · Orders (saffron).
 *
 * Words are the seller app's own: "Consignment monitor" and "Awaiting the
 * call" from the orders index, "What we discussed with your customer" from
 * the delivery-trouble panel, "Customer register" and its Orders /
 * Delivered / RTO / Refused / Risk columns from the customers index, and
 * the eight milestone labels straight off `OrderJourneyService` — which is
 * also where each rung's owner (Skydrop or Courier) comes from.
 *
 * Nothing here is a business figure, so nothing here is a `dummy()`. The
 * sample names, the masked phone and the per-customer counts live in the
 * mock beside it, inside the frame's `aria-hidden` box, and are plainly
 * illustrative — a single customer's row, never a rate or a volume.
 */
export const tourOrders: TourVignetteContent = {
  id: 'orders',
  hue: 'saffron',
  tab: 'Orders',
  title: 'Every order, confirmed before it ships',
  promise:
    'Orders reach us however you send them, we phone your customer before anything leaves the shelf, and the parcel is tracked from our scan to their door.',
  checklist: [
    {
      id: 'intake',
      text: 'Orders in one at a time, by bulk CSV, or from your own system (API key + webhooks)',
      beat: 'intake',
    },
    {
      id: 'journey',
      text: 'A full lifecycle timeline — picked, packed, handed over the same day, tracked to the door — with edit and cancel while you can',
      beat: 'journey',
    },
    {
      id: 'calls',
      text: 'Our call centre confirms every COD order by phone — you see each attempt and its outcome',
      beat: 'calls',
    },
    {
      id: 'register',
      text: "Every customer's order history and reputation in one place",
      beat: 'register',
    },
  ],
  beats: [
    {
      id: 'intake',
      ms: 2000,
      caption: 'Orders arrive from your form, a CSV, or your own system — all into one queue.',
    },
    {
      id: 'journey',
      ms: 2200,
      caption: 'Every step is stamped and owned: ours to the courier’s van, theirs to the door.',
    },
    {
      id: 'calls',
      ms: 1900,
      caption: 'We phone your customer before anything is picked, and write down what they said.',
    },
    {
      id: 'register',
      ms: 1900,
      caption: 'Everyone you have shipped to, and how those orders ended.',
    },
  ],
};
