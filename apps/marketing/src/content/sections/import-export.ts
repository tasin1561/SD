/**
 * SECTION — Import & export. Copy only.
 *
 * Two panels, one per direction: goods coming INTO Bangladesh from India,
 * and goods going the other way. Everything either panel says is a fact
 * about the product, read off `platform` in `site.ts`:
 *
 *   · pickup      → `platform.howItWorksParcel` step `pickup`
 *                   ("A courier collects from your door in Bangladesh or India")
 *   · paperwork   → step `border` ("We handle the paperwork")
 *   · customs     → step `border` ("crosses as part of a declared consignment",
 *                   runs: "Left → landed, both stamped")
 *   · last mile   → step `lastmile` + `platform.services` to-india / to-bangladesh
 *   · COD         → `platform.claims` SELLER — Orders
 *                   ("Our call centre confirms every COD order by phone")
 *
 * ── What is deliberately NOT here ────────────────────────────────────
 * No transit time, no rate, no duty figure, no volume, no licence — every
 * one of those is a BUSINESS fact the owner has not supplied, and the
 * honest version of this section is the one that leaves them out rather
 * than the one that invents them. So this file imports no `dummy()`: it
 * contains no figure to wrap. If a transit time or a duty line is ever
 * added here, it is a `dummy()` from `@/content/dummy` on the day it
 * lands, not a number typed into the copy.
 *
 * In particular: "customs" says how the parcel crosses and what you are
 * shown, never that it clears in N days or that duty is covered. "We
 * handle the paperwork" is the product's own sentence and is as far as
 * this section goes.
 *
 * ── Why the last-mile lines differ ───────────────────────────────────
 * Delhivery and Shiprocket are INDIAN networks (`business.partners`, and
 * the FAQ names them for exactly this). So the export panel names them
 * and the import panel does not: naming an Indian courier for a
 * Bangladeshi doorstep would be the one false sentence on the page.
 */

/** The four things we handle, in the order a parcel meets them. */
export type ImportExportStep = 'pickup' | 'paperwork' | 'customs' | 'lastmile';

export interface ImportExportRow {
  /** Which icon the section draws in the chip — mapped in `import-export.tsx`. */
  step: ImportExportStep;
  title: string;
  line: string;
}

export interface ImportExportPanel {
  /** Also picks the panel's own directional icon in `import-export.tsx`. */
  id: 'import' | 'export';
  /** Drives `data-hue`; the panel colours entirely from `--h-*`. */
  hue: 'teal' | 'violet';
  /**
   * `SweepLink` exports four tones — blue / green / saffron / ink — and
   * neither teal nor violet is among them, so each panel takes its
   * nearest neighbour: the green sweep already runs green → teal, and the
   * blue one is the closest cool to violet. If the primitive ever grows
   * the two hues, these are the only two values to change.
   */
  tone: 'green' | 'blue';
  eyebrow: string;
  title: string;
  /** One line: who this direction is for. */
  who: string;
  rowsHeading: string;
  rows: ImportExportRow[];
  cta: { label: string; href: string };
}

export interface ImportExportContent {
  eyebrow: string;
  title: string;
  sub: string;
  panels: [ImportExportPanel, ImportExportPanel];
}

export const importExport: ImportExportContent = {
  eyebrow: 'Import & export',
  title: 'Goods move both ways',
  sub: 'Bringing something in from India, or sending it the other way. The same booking, the same declaration, and a person on both sides of the border to ring if it slips.',
  panels: [
    {
      id: 'import',
      hue: 'teal',
      tone: 'green',
      eyebrow: 'Importing from India',
      title: 'Bringing goods in from India',
      who: 'For Bangladeshi businesses and individuals receiving goods from an Indian supplier or seller.',
      rowsHeading: 'What we handle',
      rows: [
        {
          step: 'pickup',
          title: 'Pickup in India',
          line: "A courier collects from the sender's door. The scan at pickup is where tracking starts.",
        },
        {
          step: 'paperwork',
          title: 'The declaration',
          line: 'The consignment paperwork is ours to file, not yours.',
        },
        {
          step: 'customs',
          title: 'Across the border',
          line: 'It crosses as part of a declared consignment. You see when it left and when it landed.',
        },
        {
          step: 'lastmile',
          title: 'Delivery in Bangladesh',
          line: 'Run to the address and signed for, with every scan on the tracking page.',
        },
      ],
      cta: { label: 'Request an invite', href: '/request-invite?dir=IN_TO_BD' },
    },
    {
      id: 'export',
      hue: 'violet',
      tone: 'blue',
      eyebrow: 'Exporting to India',
      title: 'Sending goods to India',
      who: 'For Bangladeshi sellers and shippers sending to Indian customers, cash on delivery included.',
      rowsHeading: 'What we handle',
      rows: [
        {
          step: 'pickup',
          title: 'Pickup in Bangladesh',
          line: 'A courier collects from your door. Label it or let us; the first scan starts the timeline.',
        },
        {
          step: 'paperwork',
          title: 'The declaration',
          line: 'Ours to file on the way out, exactly as it is on the way in.',
        },
        {
          step: 'customs',
          title: 'Across the border',
          line: 'It crosses as part of a declared consignment, left and landed both stamped.',
        },
        {
          step: 'lastmile',
          title: 'Last mile in India',
          line: 'Handed to the Delhivery and Shiprocket networks, and every COD order is confirmed by phone before it ships.',
        },
      ],
      cta: { label: 'Request an invite', href: '/request-invite?dir=BD_TO_IN' },
    },
  ],
};
