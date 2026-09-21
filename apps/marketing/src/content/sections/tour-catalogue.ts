import type { TourVignetteContent } from './tour-types';

/**
 * Tour vignette 2 — Catalogue & inventory (violet).
 *
 * The words are the seller app's own: `/products` is the catalogue,
 * `/inventory` the stock register, and the upload states are the four it
 * actually badges (queued → uploading → registering → done). Sellers never
 * see bins or batches, so the MOCK shows the per-SKU register they really
 * get; the checklist keeps the 3A wording ("warehouses, bins and batches")
 * because that is what the platform tracks underneath.
 *
 * Nothing here is a business figure — no rate, no price, no volume — so
 * nothing needs `dummy()`. The sample SKUs and quantities are mock
 * furniture and live in the component beside the markup that draws them.
 */
export const tourCatalogue: TourVignetteContent = {
  id: 'catalogue',
  hue: 'violet',
  tab: 'Stock on the shelf',
  title: "Know exactly what's on the shelf",
  promise:
    'Every product, variant and picture in one catalogue, and a stock register that says what is on hand, what is spoken for and what is still in the air.',
  checklist: [
    {
      id: 'products',
      text: 'Products, variants and pictures (drag and drop) — by hand or by CSV',
      beat: 'card',
    },
    {
      id: 'live-stock',
      text: 'Live stock across warehouses, bins and batches — on hand, reserved, available, in transit — with low-stock alerts',
      beat: 'register',
    },
    {
      id: 'strict',
      text: 'STRICT mode when you want it: per-unit serials scanned at pick and pack, with a discrepancy report',
      beat: 'strict',
    },
  ],
  beats: [
    {
      id: 'card',
      ms: 2000,
      caption:
        'Add a product, drop its pictures in and fan out the variants — or upload the whole catalogue as a CSV.',
    },
    {
      id: 'register',
      ms: 2000,
      caption:
        'The stock register is live: on hand, reserved, available, and what is still in transit and not sellable yet.',
    },
    {
      id: 'strict',
      ms: 2200,
      caption:
        'Turn STRICT mode on and every unit carries its own serial, scanned at pick and again at pack.',
    },
  ],
};
