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
  packErrorCopy,
} from '@/app/(authed)/warehouse/pack/_components/pack-error-copy';
import { PACK_STEP_TRIPLES } from '@/app/(authed)/warehouse/pack/_components/pack-step-strip';
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

function refusalOn(code: string, message: string, details?: Record<string, string>): ScanRoute {
  return {
    match: /\/boxes\/pb-1\/scan$/,
    method: 'POST',
    reply: {
      status: 409,
      body: { code, message, ...(details === undefined ? {} : { details }) },
    } satisfies Reply,
  };
}

const OPENS: ScanRoute = {
  match: /\/boxes\/open$/,
  method: 'POST',
  reply: { status: 201, body: OPEN_BOX },
};

function scanOk(variantId: string, expiresAt = '2026-11-10T06:00:00.000Z'): Reply {
  return {
    status: 201,
    body: {
      packBoxId: 'pb-1',
      variantId,
      skuCode: 'SKU-A',
      stockUnitId: null,
      // The LIVE deadline: the server pushed it forward by this scan.
      expiresAt,
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

    const cancel = screen.getByRole('button', { name: 'Cancel this box' });
    const noLabels = screen.getByRole('button', { name: 'These products have no labels to scan' });
    expect(cancel).toBeInTheDocument();
    expect(noLabels).toBeInTheDocument();
    // ONE row, not stacked (2026-11-10, owner). Stacked, the second read
    // as an afterthought bolted under the first.
    const row = cancel.closest('.wh-row--pair');
    expect(row).not.toBeNull();
    expect(noLabels.closest('.wh-row--pair')).toBe(row);
    // The destructive one stays visually distinct.
    expect(cancel.className).not.toBe(noLabels.className);
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

  it('every placeholder sits inside an OPTIONAL segment, so a missing value costs a clause and never shows “{awb}”', () => {
    for (const [code, copy] of Object.entries(PACK_ERROR_COPY)) {
      const lines = {
        en: copy.en,
        bn: copy.bn,
        hi: copy.hi,
        'why.en': copy.why?.en ?? '',
        'why.bn': copy.why?.bn ?? '',
        'why.hi': copy.why?.hi ?? '',
        'fix.en': copy.fix?.en ?? '',
        'fix.bn': copy.fix?.bn ?? '',
        'fix.hi': copy.fix?.hi ?? '',
      };
      for (const [lang, line] of Object.entries(lines)) {
        // Strip the segments, then there must be no placeholder left.
        const outside = line.replace(/\[\[[^\]]*\]\]/g, '');
        expect(outside, `${code} ${lang} has a placeholder outside [[ ]]`).not.toMatch(/\{\w+\}/);
        // And with no values at all, the sentence is still a sentence.
        const bare = packErrorCopy(code);
        expect(bare.en).not.toContain('[[');
        expect(bare.bn).not.toMatch(/\{\w+\}/);
        expect(bare.hi).not.toMatch(/\{\w+\}/);
      }
    }
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
      // The scenario and the fix are held to the same standard: a code
      // that has one must have it in all three, with no script bleed.
      for (const extra of [copy.why, copy.fix]) {
        if (extra === undefined) continue;
        expect(extra.en.trim(), `${code} extra en`).not.toBe('');
        expect(extra.bn.trim(), `${code} extra bn`).not.toBe('');
        expect(extra.hi.trim(), `${code} extra hi`).not.toBe('');
        expect(/[०-९০-৯]/.test(`${extra.en}${extra.bn}${extra.hi}`), code).toBe(false);
        expect(/[ঀ-৿]/.test(extra.hi), `${code} extra hi has Bengali`).toBe(false);
        expect(/[ऀ-ॣ०-ॿ]/.test(extra.bn), `${code} extra bn has Devanagari`).toBe(false);
      }
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
      // Resolved with NO values — the server sent none here — which is
      // exactly what the dialog renders.
      const copy = packErrorCopy(code);
      expect(dialog).toHaveTextContent(copy.bn);
      expect(dialog).toHaveTextContent(copy.hi);
      // A sentence that lost a clause must not have lost its syntax —
      // the WHAT, the WHY and the FIX alike.
      expect(dialog.textContent ?? '').not.toContain('[[');
      expect(dialog.textContent ?? '').not.toMatch(/\{\w+\}/);
      if (copy.why !== undefined) {
        expect(dialog).toHaveTextContent(copy.why.bn);
        expect(dialog).toHaveTextContent(copy.why.hi);
      }
      if (copy.fix !== undefined) {
        expect(dialog).toHaveTextContent(copy.fix.bn);
        expect(dialog).toHaveTextContent(copy.fix.hi);
      }
    },
  );
});

/**
 * The refusals that NAME the mistake (2026-11-10, owner). The server used
 * to collapse these into PACK_CODE_UNKNOWN — "this barcode is not known" —
 * for a label that is perfectly well known, just not this box's.
 */
describe('pack bench — a refusal that carries a value', () => {
  async function refuse(
    code: string,
    message: string,
    details: Record<string, string>,
  ): Promise<HTMLElement> {
    const user = userEvent.setup();
    renderBench([OPENS, refusalOn(code, message, details)]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');
    await user.type(scanField(), '38061110627394{Enter}');
    return screen.findByRole('dialog', { name: 'That scan was refused' });
  }

  it('the wrong parcel’s label names the AWB to scan, in ALL THREE languages', async () => {
    const dialog = await refuse(
      'PACK_WRONG_PARCEL_LABEL',
      "38061110627394 is a different parcel's label. This box is parcel 38061110627395.",
      { awb: '38061110627395', otherAwb: '38061110627394' },
    );

    const lines = [...dialog.querySelectorAll('.wh-oops .wh-tri__line')];
    expect(lines).toHaveLength(3);
    // The AWB is in the English, the Bangla AND the Hindi — a packer who
    // reads only one of them still learns which parcel to scan.
    for (const line of lines) expect(line.textContent).toContain('38061110627395');
    expect(dialog.querySelector('[lang="bn"]')?.textContent).toContain('38061110627395');
    expect(dialog.querySelector('[lang="hi"]')?.textContent).toContain('38061110627395');
    // FE-2 survives it.
    expect(dialog).toHaveTextContent('[PACK_WRONG_PARCEL_LABEL] 38061110627394 is a different');
  });

  it('another client’s goods name the CODE in all three, and never the client', async () => {
    const dialog = await refuse(
      'PACK_PRODUCT_OTHER_CLIENT',
      "BAR-OTHER is another client's stock, not this parcel's.",
      { item: 'BAR-OTHER' },
    );

    // The code the packer scanned is in all three; it is already in their
    // hand, so it leaks nothing — and the fix tells them where it goes.
    for (const line of [...dialog.querySelectorAll('.wh-fix .wh-tri__line')]) {
      expect(line.textContent).toContain('BAR-OTHER');
    }
    expect(dialog).toHaveTextContent("[PACK_PRODUCT_OTHER_CLIENT] BAR-OTHER is another client's");
  });

  it('a held box tells them WHO, WHEN, WHY and THE FIX — in all three languages', async () => {
    const dialog = await refuse(
      'PACK_BOX_HELD_BY_OTHER',
      'Rahim Ali has parcel 38061110627395 open. Ask them to close or cancel that box.',
      { awb: '38061110627395', who: 'Rahim Ali', when: '11:05' },
    );

    // WHO and WHEN, as language-free facts.
    const facts = dialog.querySelector('.wh-facts');
    expect(facts?.textContent).toContain('Rahim Ali');
    expect(facts?.textContent).toContain('11:05');
    // WHY — the scenario, three languages.
    expect(dialog.querySelectorAll('.wh-oops__why .wh-tri__line')).toHaveLength(3);
    // THE FIX — three languages, each naming the colleague AND the time,
    // so two people can settle it without a supervisor.
    const fix = [...dialog.querySelectorAll('.wh-fix .wh-tri__line')];
    expect(fix).toHaveLength(3);
    for (const line of fix) {
      expect(line.textContent).toContain('Rahim Ali');
      expect(line.textContent).toContain('11:05');
    }
    // FE-2, still verbatim and still below all of it.
    expect(dialog).toHaveTextContent('[PACK_BOX_HELD_BY_OTHER] Rahim Ali has parcel');
  });

  it('no WHO and no WHEN: no fact row, no empty line, and the fix still reads', async () => {
    const dialog = await refuse('PACK_BOX_HELD_BY_OTHER', 'Another packer has it open.', {});

    expect(dialog.querySelector('.wh-facts')).toBeNull();
    const fix = [...dialog.querySelectorAll('.wh-fix .wh-tri__line')];
    expect(fix).toHaveLength(3);
    for (const line of fix) {
      const text = line.textContent ?? '';
      expect(text).not.toMatch(/[{}]|\[\[/);
      expect(text.toLowerCase()).not.toContain('undefined');
      expect(text.trim().length).toBeGreaterThan(10);
    }
  });

  it('a code with NO details still reads as three sentences, with no stray braces', async () => {
    const dialog = await refuse('PACK_WRONG_PARCEL_LABEL', 'A different parcel’s label.', {});

    const lines = [...dialog.querySelectorAll('.wh-tri__line')];
    for (const line of lines) {
      expect(line.textContent ?? '').not.toMatch(/[{}]|\[\[/);
    }
    expect(dialog.querySelectorAll('.wh-oops .wh-tri__line')).toHaveLength(3);
  });

  it('every new code is written in all three languages', () => {
    for (const code of [
      'PACK_WRONG_PARCEL_LABEL',
      'PACK_PRODUCT_OTHER_CLIENT',
      'PACK_OWN_LABEL_NOT_A_PRODUCT',
      'PACK_UNIT_NOT_PICKED',
    ]) {
      const copy = PACK_ERROR_COPY[code];
      expect(copy, code).toBeDefined();
      expect(copy?.en.trim()).not.toBe('');
      expect(copy?.bn.trim()).not.toBe('');
      expect(copy?.hi.trim()).not.toBe('');
    }
  });
});

/**
 * The step strip is the thing that TEACHES the job and it is always on
 * screen, so it is the worst place to be monolingual (2026-11-10, owner).
 */
/**
 * Ten minutes of IDLE, not ten minutes of work (owner, 2026-11-10). The
 * bench therefore has to draw the LIVE deadline — the one the last scan
 * moved — or a packer watches a clock that is quietly no longer true.
 */
describe('pack bench — the idle deadline', () => {
  it('shows the deadline from the open box, then the one the scan moved', async () => {
    const user = userEvent.setup();
    renderBench([
      OPENS,
      {
        match: /\/boxes\/pb-1\/scan$/,
        method: 'POST',
        // 06:00Z is 11:30 IST, a deliberately DIFFERENT clock time from
        // the open box's 10:00Z / 15:30 IST, so the assertion below
        // cannot pass on the value the open call returned.
        reply: () => scanOk('v-1', '2026-11-10T06:00:00.000Z'),
      },
    ]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');

    // OPEN_BOX.expiresAt is 2026-11-10T10:00:00Z → 15:30 in Asia/Kolkata.
    const line = () => document.querySelector('.wh-scan__deadline')?.textContent ?? '';
    expect(line()).toContain('15:30');

    await user.type(scanField(), 'SKU-A{Enter}');
    // …and after the scan, the value the SERVER just sent: 11:30.
    await waitFor(() => expect(line()).toContain('11:30'));
    expect(line()).not.toContain('15:30');
  });

  it('tells the packer who came back from lunch that nothing was lost', async () => {
    const user = userEvent.setup();
    renderBench([
      OPENS,
      refusalOn(
        'PACK_BOX_EXPIRED',
        'This box was left open too long, so parcel AWB100 went back to the queue.',
        { awb: 'AWB100' },
      ),
    ]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');
    await user.type(scanField(), 'SKU-A{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'That scan was refused' });
    const what = [...dialog.querySelectorAll('.wh-oops .wh-tri__line')];
    expect(what).toHaveLength(3);
    // Plain words, in all three, and never a bare "not found".
    for (const line of what) expect((line.textContent ?? '').length).toBeGreaterThan(20);
    expect(dialog.querySelector('[lang="bn"]')?.textContent).toContain('কিউতে');
    // The fix names the label to scan again, in all three.
    const fix = [...dialog.querySelectorAll('.wh-fix .wh-tri__line')];
    expect(fix).toHaveLength(3);
    for (const line of fix) expect(line.textContent).toContain('AWB100');
    expect(dialog).toHaveTextContent('[PACK_BOX_EXPIRED] This box was left open too long');
  });

  it('…or that somebody else finished it, with WHO and WHEN', async () => {
    const user = userEvent.setup();
    renderBench([
      OPENS,
      refusalOn(
        'PACK_PARCEL_PACKED_BY_OTHER',
        'While this box stood open, parcel AWB100 was packed by Rahim Ali at 10:42.',
        { awb: 'AWB100', who: 'Rahim Ali', when: '10:42' },
      ),
    ]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await screen.findByText('Aviator Sunglass');
    await user.type(scanField(), 'SKU-A{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'That scan was refused' });
    expect(dialog.querySelector('.wh-facts')?.textContent).toContain('Rahim Ali');
    expect(dialog.querySelector('.wh-facts')?.textContent).toContain('10:42');
    for (const line of [...dialog.querySelectorAll('.wh-fix .wh-tri__line')]) {
      expect(line.textContent).toContain('Rahim Ali');
      expect(line.textContent).toContain('10:42');
    }
  });
});

/**
 * PACK-4 follow-up (2026-11-10): a parcel another bench is holding is
 * EXPLAINED rather than silently gone from the queue. "Rahim has it until
 * 11:05" is the answer a packer would otherwise walk over and ask for.
 */
describe('pack bench — what another bench is holding', () => {
  const HELD = {
    shipmentId: 'sh-9',
    shipmentNumber: 'SH-000009',
    awbNumber: '38061110627999',
    orderNumber: 'SD-2026-26-000009',
    hold: 'BOX' as const,
    heldByStaffId: '0193c0de-0000-7000-8000-000000000001',
    heldByName: 'Rahim Ali',
    heldUntilIso: '2026-11-10T05:35:00.000Z',
  };

  function queue(inProgress: unknown[]): ScanRoute {
    return {
      match: /\/api\/warehouse\/packs\/queue/,
      method: 'GET',
      reply: { status: 200, body: { waiting: [], inProgress } },
    };
  }

  it('names the colleague and the clock time, never a uuid', async () => {
    renderBench([queue([HELD])]);
    const section = await waitFor(() => {
      const el = document.querySelector('.wh-inprog');
      if (el === null) throw new Error('the in-progress list is not on screen');
      return el;
    });

    expect(section.textContent).toContain('Rahim Ali');
    // 05:35Z is 11:05 in Asia/Kolkata — a clock time, not a countdown.
    expect(section.textContent).toContain('11:05');
    expect(section.textContent).toContain('38061110627999');
    expect(section.textContent).not.toContain(HELD.heldByStaffId);
  });

  it('a hold with no nameable holder says “another bench”, never a blank', async () => {
    renderBench([queue([{ ...HELD, heldByName: null, hold: 'CLAIM' }])]);
    const section = await waitFor(() => {
      const el = document.querySelector('.wh-inprog');
      if (el === null) throw new Error('the in-progress list is not on screen');
      return el;
    });

    expect(section.textContent).toContain('another bench');
    expect(section.textContent?.toLowerCase()).not.toContain('undefined');
    expect(section.textContent?.toLowerCase()).not.toContain('null');
  });

  it('is absent when no other bench is holding anything', async () => {
    renderBench([queue([])]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    expect(document.querySelector('.wh-inprog')).toBeNull();
  });
});

describe('pack bench — the step strip speaks all three languages', () => {
  it('shows English, Bangla and Hindi under every step', async () => {
    renderBench([]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));

    const steps = [...document.querySelectorAll('.wh-step')];
    expect(steps).toHaveLength(3);
    steps.forEach((step, i) => {
      const triple = PACK_STEP_TRIPLES[i];
      expect(triple).toBeDefined();
      expect(step.querySelector('[lang="en"]')?.textContent).toBe(triple?.en);
      expect(step.querySelector('[lang="bn"]')?.textContent).toBe(triple?.bn);
      expect(step.querySelector('[lang="hi"]')?.textContent).toBe(triple?.hi);
    });
  });

  it('keeps the numeral, and reads ONE translated sentence to a screen reader', async () => {
    renderBench([]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));

    // The number is still there, and still its own signal.
    expect(document.querySelector('.wh-step__num')?.textContent).toBe('1');
    // The three visible lines are hidden from assistive tech; the one
    // translated sentence is what it reads.
    const first = document.querySelectorAll('.wh-step')[0];
    expect(first?.querySelector('.wh-step__tri')?.getAttribute('aria-hidden')).toBe('true');
    expect(first?.querySelector('.wh-sr')?.textContent).toBe('Scan the box label');
  });

  it('writes the three steps with Western numerals and no script bleed', () => {
    for (const triple of PACK_STEP_TRIPLES) {
      expect(/[०-९০-৯]/.test(`${triple.en}${triple.bn}${triple.hi}`)).toBe(false);
      expect(/[ঀ-৿]/.test(triple.hi)).toBe(false);
      expect(/[ऀ-ॣ०-ॿ]/.test(triple.bn)).toBe(false);
      // Short on purpose: three stacked lines × three steps must fit a
      // 360px phone. Three words per language at most.
      for (const line of [triple.en, triple.bn, triple.hi]) {
        expect(line.trim().split(/\s+/).length, line).toBeLessThanOrEqual(5);
      }
    }
  });
});
