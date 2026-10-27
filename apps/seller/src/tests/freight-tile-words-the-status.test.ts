import { readFileSync } from 'node:fs';
import { CATALOGS } from '@/i18n/catalog';
import { readEnglish } from './english-source';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InboundFreightStatus } from '@skydrop/db';
import { statusLabel } from '@skydrop/ui/status';

/**
 * The consignment page's freight tile says the status in WORDS.
 *
 * Its hint was `` `One bill · ${charge.status.toLowerCase()}` ``, which
 * reads perfectly for three of the five values and is wrong for the two
 * a bill has to actually reach:
 *
 *   · `PARTIALLY_SETTLED` printed as **partially_settled** — an
 *     underscore straight out of the database, on a seller's own screen,
 *     beside four other statuses that all go through `statusLabel`.
 *   · `VOIDED` printed as **voided**, where `statusLabel` — and every
 *     sentence on the page beside it — says **Withdrawn**. A caption
 *     disagreeing with its own badge reads as two different things
 *     having happened.
 *
 * It survived because a bill has to REACH one of those two for the tile
 * to show them, and until the freight tutorial was filmed (2026-09-30)
 * no bill on any box ever had. The api-client's
 * `ConsignmentView.freightCharges[].status` was typed `string` rather
 * than the enum, so nothing could tell the tile it was wording an enum
 * by hand.
 *
 * Pinned by reading the source, on the same reasoning as
 * `holds-name-the-order.test.ts`: the defect is a formatting choice, and
 * a render test asserting "some status is shown" passes either way.
 * Comments are stripped first — this file's docblock and the
 * component's both quote the old expression.
 */
const DETAIL = join(
  __dirname,
  '..',
  'app',
  '(authed)',
  'inbound',
  '[id]',
  '_components',
  'consignment-detail.tsx',
);

function withoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the consignment page’s inbound-freight tile', () => {
  const src = withoutComments(readEnglish(DETAIL, 'utf8'));

  it('words the bill’s status through statusLabel', () => {
    // The sentence is in the catalogue; the status word fed into it is the
    // part this pins, and it must come from statusLabel.
    expect(CATALOGS.en['inboundDetail.oneBill']).toBe('One bill · {pending}');
    const raw = readFileSync(DETAIL, 'utf8');
    expect(raw).toMatch(/t\(\s*'inboundDetail\.oneBill',\s*\{\s*pending:\s*statusLabel\(/);
  });

  it('never lower-cases a status enum into a sentence', () => {
    expect(src).not.toMatch(/status\.toLowerCase\(\)/);
  });
});

describe('statusLabel over every freight status', () => {
  it('leaves no underscore and no bare enum on screen', () => {
    for (const status of Object.values(InboundFreightStatus)) {
      const label = statusLabel(status);
      expect(label).not.toContain('_');
      expect(label).not.toBe(String(status));
    }
  });

  it('says Withdrawn for VOIDED, which is what the rest of the page says', () => {
    expect(statusLabel(InboundFreightStatus.VOIDED)).toBe('Withdrawn');
    expect(statusLabel(InboundFreightStatus.PARTIALLY_SETTLED)).toBe('Partially Settled');
  });
});
