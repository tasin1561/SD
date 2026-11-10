/**
 * The pack bench, made usable by a packer who may read no English
 * (2026-11-10, owner) — `(authed)/warehouse/pack/_components/*`.
 *
 * These are the four things the redesign claims, each of which would fail
 * silently if somebody "tidied" it later:
 *
 *   1. the step strip highlights the step the bench is actually on;
 *   2. a refusal shows the friendly sentence in ALL THREE languages at
 *      once, not in the picked locale;
 *   3. an UNKNOWN code still produces a usable dialog (generic triple plus
 *      the raw server message) rather than a blank one;
 *   4. FE-2 survives all of it: the server's `[CODE] message` is in the
 *      DOM, verbatim, for every refusal.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackStation } from '@/app/(authed)/warehouse/pack/_components/pack-station';
import {
  PACK_ERROR_COPY,
  FALLBACK,
} from '@/app/(authed)/warehouse/pack/_components/pack-error-copy';
import { makeStaff, renderWithProviders } from './helpers';
import { scanFetch, type Reply, type ScanRoute } from './scan-fetch';

const OPEN_BOX = {
  packBoxId: 'pb-1',
  shipmentId: 'sh-1',
  orderId: 'ord-1',
  awbNumber: 'AWB100',
  expiresAt: '2026-11-10T10:00:00.000Z',
  expected: [
    {
      variantId: 'v-1',
      skuCode: 'SKU-A',
      productName: 'Aviator Sunglass',
      quantity: 1,
      imageUrl: 'https://cdn.example.com/aviator.jpg',
    },
    {
      variantId: 'v-2',
      skuCode: 'SKU-B',
      productName: 'Leather Case',
      quantity: 1,
      imageUrl: null,
    },
  ],
  alreadyOpen: false,
};

const BACKGROUND: ScanRoute[] = [
  { match: /\/api\/admin\/courier\/scan-block$/, method: 'GET', reply: { status: 200 } },
  {
    match: /\/api\/warehouse\/packs\/queue/,
    method: 'GET',
    reply: { status: 200, body: { waiting: [] } },
  },
];

function renderBench(routes: ScanRoute[]): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<PackStation />, {
    identity: makeStaff(undefined, ['warehouse.pack', 'warehouse.pick.supervise']),
    fetchImpl: scanFetch([...routes, ...BACKGROUND]),
  });
}

function scanField(): HTMLInputElement {
  const el = document.getElementById('pack-scan');
  if (!(el instanceof HTMLInputElement)) throw new Error('#pack-scan is not on screen');
  return el;
}

/** The 1-based index of the step the strip says you are on. */
function currentStep(): number {
  const steps = [...document.querySelectorAll('.wh-step')];
  expect(steps).toHaveLength(3);
  return steps.findIndex((li) => li.getAttribute('data-state') === 'now') + 1;
}

function doneSteps(): number {
  return document.querySelectorAll('.wh-step[data-state="done"]').length;
}

function refusalOn(code: string, message: string): ScanRoute {
  return {
    match: /\/boxes\/pb-1\/scan$/,
    method: 'POST',
    reply: { status: 409, body: { code, message } } satisfies Reply,
  };
}

const OPENS: ScanRoute = {
  match: /\/boxes\/open$/,
  method: 'POST',
  reply: { status: 201, body: OPEN_BOX },
};

function scanOk(variantId: string): Reply {
  return {
    status: 201,
    body: {
      packBoxId: 'pb-1',
      variantId,
      skuCode: 'SKU-A',
      stockUnitId: null,
      scannedCount: 1,
      expectedCount: 2,
      complete: false,
    },
  };
}

describe('pack bench — the step strip', () => {
  it('starts on step 1 with nothing done', async () => {
    renderBench([]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    expect(currentStep()).toBe(1);
    expect(doneSteps()).toBe(0);
  });

  it('moves to step 2 once a box is open and products are outstanding', async () => {
    const user = userEvent.setup();
    renderBench([OPENS]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');
    expect(currentStep()).toBe(2);
    expect(doneSteps()).toBe(1);
  });

  it('moves to step 3 — scan the label again — once every product is in', async () => {
    const user = userEvent.setup();
    renderBench([
      OPENS,
      { match: /\/boxes\/pb-1\/scan$/, method: 'POST', reply: () => scanOk('v-1') },
    ]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');
    await user.type(scanField(), 'SKU-A{Enter}');
    await screen.findByText('1 / 1');
    await user.type(scanField(), 'SKU-B{Enter}');
    await waitFor(() => expect(currentStep()).toBe(3));
    expect(doneSteps()).toBe(2);
  });
});

describe('pack bench — the product lines', () => {
  it('shows the snapshotted picture, and a placeholder (never a broken frame) when there is none', async () => {
    const user = userEvent.setup();
    renderBench([OPENS]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');

    const images = [...document.querySelectorAll('img.wh-line__thumb')];
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute('src')).toBe('https://cdn.example.com/aviator.jpg');
    // The imageless line gets a neutral tile, not an <img> with no src.
    expect(document.querySelectorAll('.wh-line__thumb--none')).toHaveLength(1);
  });
});

describe('pack bench — the two actions that must look like buttons', () => {
  it('offers "Cancel this box" and the no-labels escape hatch as real buttons', async () => {
    const user = userEvent.setup();
    renderBench([OPENS]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');

    expect(screen.getByRole('button', { name: 'Cancel this box' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'These products have no labels to scan' }),
    ).toBeInTheDocument();
  });

  it('keeps the camera button in the scan card, beside the field it belongs to', async () => {
    renderBench([]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    const camera = document.querySelector('.wh-scan__camera');
    // It may be absent in a jsdom with no mediaDevices — but the slot that
    // holds it must be inside the scan card, never at the foot of the page.
    expect(camera).not.toBeNull();
    expect(camera?.closest('.wh-scan')).not.toBeNull();
  });
});

describe('pack bench — the three-language refusal dialog', () => {
  it('shows English, Bangla and Hindi at once for a known code, plus the verbatim verdict (FE-2)', async () => {
    const user = userEvent.setup();
    renderBench([OPENS, refusalOn('PACK_CODE_UNKNOWN', 'Nothing matches dfc')]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');
    await user.type(scanField(), 'dfc{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'That scan was refused' });
    const known = PACK_ERROR_COPY['PACK_CODE_UNKNOWN'];
    expect(known).toBeDefined();
    // All three AT ONCE — this is the deliberate exception to the locale
    // picker. If somebody "fixes" it to one language, this fails.
    expect(dialog).toHaveTextContent(known?.en ?? '');
    expect(dialog).toHaveTextContent(known?.bn ?? '');
    expect(dialog).toHaveTextContent(known?.hi ?? '');
    // FE-2 — the server's own words, verbatim, still present.
    expect(dialog).toHaveTextContent('[PACK_CODE_UNKNOWN] Nothing matches dfc');
    // And the dismiss control is still one stable accessible name.
    expect(screen.getByRole('button', { name: 'I have fixed it' })).toBeInTheDocument();
  });

  it('an UNKNOWN code is not a blank dialog: the generic triple plus the raw server message', async () => {
    const user = userEvent.setup();
    renderBench([OPENS, refusalOn('SOMETHING_WE_NEVER_HEARD_OF', 'The widget frobnicated.')]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');
    await user.type(scanField(), 'zzz{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'That scan was refused' });
    expect(dialog).toHaveTextContent(FALLBACK.en);
    expect(dialog).toHaveTextContent(FALLBACK.bn);
    expect(dialog).toHaveTextContent(FALLBACK.hi);
    expect(dialog).toHaveTextContent('[SOMETHING_WE_NEVER_HEARD_OF] The widget frobnicated.');
  });

  it('every code the pack bench can produce has all three languages written', () => {
    for (const [code, copy] of Object.entries(PACK_ERROR_COPY)) {
      expect(copy.en.trim(), `${code} en`).not.toBe('');
      expect(copy.bn.trim(), `${code} bn`).not.toBe('');
      expect(copy.hi.trim(), `${code} hi`).not.toBe('');
      // Same rules the message catalogue's spec enforces: Western numerals,
      // and the two Indic scripts never bleed into each other.
      expect(/[०-९০-৯]/.test(`${copy.en}${copy.bn}${copy.hi}`), code).toBe(false);
      expect(/[ঀ-৿]/.test(copy.hi), `${code} hi has Bengali`).toBe(false);
      expect(/[ऀ-ॣ०-ॿ]/.test(copy.bn), `${code} bn has Devanagari`).toBe(false);
    }
  });

  // Walk every code: whatever the server says, its words reach the screen.
  it.each(Object.keys(PACK_ERROR_COPY))(
    'renders the server verdict verbatim for %s (FE-2)',
    async (code) => {
      const user = userEvent.setup();
      renderBench([OPENS, refusalOn(code, `Refused because of ${code}.`)]);
      await waitFor(() => expect(document.activeElement).toBe(scanField()));
      await user.type(scanField(), 'AWB100{Enter}');
      await screen.findByText('Aviator Sunglass');
      await user.type(scanField(), 'xyz{Enter}');

      const dialog = await screen.findByRole('dialog', { name: 'That scan was refused' });
      expect(dialog).toHaveTextContent(`[${code}] Refused because of ${code}.`);
      const copy = PACK_ERROR_COPY[code];
      expect(dialog).toHaveTextContent(copy?.bn ?? '');
      expect(dialog).toHaveTextContent(copy?.hi ?? '');
    },
  );
});
