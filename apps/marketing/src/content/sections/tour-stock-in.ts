import { dummy } from '@/content/dummy';
import type { TourVignetteContent } from './tour-types';

/**
 * 13 · Platform tour — "Get your stock into India". The 3A bullet it
 * proves: stock held in our Indian warehouse, counted on arrival.
 *
 * Every phrase is the seller app's own, not a marketing paraphrase:
 * the two routes and their helper lines are `routeWords()` in
 * `apps/seller/.../inbound/_components/consignment-words.ts`; the three
 * badges are `legWords()` / `statusWords()` from the same file;
 * "Counted differently" is the variance chip on the inbound index;
 * "Counted at our Bangladesh warehouse" is the BD_INTAKE leg heading;
 * and the cancel line is the dialog's own in `consignment-detail.tsx`.
 *
 * The ONE place we speak marketing rather than app is the freight
 * selector — PAY_ADVANCE / PAY_NOW / PAY_LATER are internal names, so
 * the tabs say what they mean and the explainers restate the app's
 * sentence underneath.
 */
export const tourStockIn: TourVignetteContent = {
  id: 'stock-in',
  hue: 'teal',
  tab: 'Stock in',
  title: 'Get your stock into India',
  promise:
    'Send it to our Dhaka warehouse or straight to India — we receive it, count what arrives, and bill the freight the way you agreed.',
  checklist: [
    {
      id: 'route',
      text: 'Straight to India, or two legs via our Dhaka intake — counted there, flown, counted again in India',
      beat: 'route',
    },
    {
      id: 'count',
      text: 'Counted at each leg, a difference recorded either way — a short count opens a ticket naming the leg, a surplus sends a notice, neither blocks your stock',
      beat: 'count',
    },
    {
      id: 'cancel',
      text: 'Cancel before it leaves for India — the goods go back to you, recorded as returned, not written off',
      beat: 'cancel',
    },
    {
      id: 'freight',
      text: 'Freight billed three ways — now, later as units sell, or in advance at the Dhaka count — per seller or per consignment, agreed in taka or rupees and converted when you are charged',
      beat: 'freight',
    },
  ],
  beats: [
    {
      id: 'route',
      ms: 2000,
      caption:
        'You choose the route. Via our Bangladesh warehouse means we move it on to India, and bill the freight.',
    },
    {
      id: 'count',
      ms: 2200,
      caption:
        'Every stop is counted. Three short, two over — recorded, and a ticket opened. Nothing is held up while we look into it.',
    },
    {
      id: 'cancel',
      ms: 1900,
      caption:
        'Change your mind before it leaves for India and the goods go back to you — returned, not written off.',
    },
    {
      id: 'freight',
      ms: 2200,
      caption:
        'Freight is billed the way you agreed: before it flies, on arrival, or per unit as the stock sells.',
    },
  ],
};

/** One way of billing the inbound freight, in the marketing voice. */
export interface StockInFreightMode {
  readonly id: string;
  readonly label: string;
  /** The app's own sentence for what that mode does. */
  readonly explainer: string;
  /** Where the charge lands, 0–1 along the Dhaka → air → India track. */
  readonly at: number;
}

const ON_ARRIVAL: StockInFreightMode = {
  id: 'on-arrival',
  label: 'Pay on arrival',
  explainer: 'Charged in full when the shipment landed.',
  at: 0.833,
};

/**
 * The figures drawn inside the mock. Counts and consignment numbers are
 * illustrative and read as such; the FREIGHT is money, and a freight
 * rate on a marketing page reads as a quote — so it is `dummy()` until
 * the owner supplies a real one.
 */
export const stockInMock = {
  legs: [
    { product: 'Kurti — teal, M', declared: 24, counted: 21 },
    { product: 'Scarf — block print', declared: 60, counted: 62 },
  ],
  ticket: { title: 'Counted differently', leg: 'Counted at our Bangladesh warehouse' },
  cancel: { ref: 'CN-2026-08-000117', units: 40 },
  modes: [
    {
      id: 'before-it-flies',
      label: 'Pay before it flies',
      explainer: 'Agreed before it flew, and charged against the Dhaka count.',
      at: 0.167,
    },
    ON_ARRIVAL,
    {
      id: 'as-it-sells',
      label: 'Pay as it sells',
      explainer: 'Charged per unit as the stock sells.',
      at: 1,
    },
  ],
  chosen: ON_ARRIVAL,
  freight: { bdt: dummy('৳6,200'), inr: dummy('₹5,040') },
} as const;
