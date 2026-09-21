import type { TourVignetteContent } from './tour-types';

/**
 * Tour vignette 4 · Returns (magenta).
 *
 * Words are the seller app's own: the three courier statuses a returning
 * parcel passes through ("RTO initiated", "RTO in transit", and the
 * warehouse's own "Received at our warehouse"), the three disposition
 * choices the inspector is given on the RTO screen — "Put back in stock",
 * "Keep aside (damaged)" and "Write off (not sellable)" — the ticket
 * number format `TK-YYYY-NNNNNN`, and "Damage settlement" as the wallet
 * ledger reads it. The inspection is BY QUANTITY, which is why the second
 * beat's two units of one line end up in two different trays.
 *
 * Nothing here is a business figure, so nothing here is a `dummy()`. The
 * sample waybill, the ticket number and the one settlement amount live in
 * the mock beside it, inside the frame's `aria-hidden` box, and are
 * plainly illustrative — one line of one return, never a rate, an average
 * or a volume.
 */
export const tourReturns: TourVignetteContent = {
  id: 'returns',
  hue: 'magenta',
  tab: 'Returns',
  title: 'Returns, handled unit by unit',
  promise:
    'A refused parcel is tracked all the way back to our Indian warehouse, every unit in it is judged on its own, and whatever we owe you is opened as a ticket and paid into your wallet.',
  checklist: [
    {
      id: 'back',
      text: 'Every return is tracked back to our Indian warehouse',
      beat: 'back',
    },
    {
      id: 'inspect',
      text: 'Inspected unit by unit — two of the same item can go different ways: restock, keep aside damaged, or write off',
      beat: 'inspect',
    },
    {
      id: 'ticket',
      text: 'A scrap or damage ticket opens by itself with the details, and the refund is settled onto it',
      beat: 'ticket',
    },
  ],
  beats: [
    {
      id: 'back',
      ms: 2200,
      caption:
        'The parcel is tracked the whole way back: RTO initiated, RTO in transit, received at our warehouse.',
    },
    {
      id: 'inspect',
      ms: 2100,
      caption:
        'Two of the same product, judged one at a time — one goes back on the shelf, one is kept aside.',
    },
    {
      id: 'ticket',
      ms: 1900,
      caption:
        'A ticket opens with the detail already filled in, and the settlement lands in your wallet.',
    },
  ],
};
