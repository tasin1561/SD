import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Asking us to act OPENS A TICKET, so the ticket list has to be re-read.
 *
 * `POST /seller/orders/:id/delivery-actions` does two things: it records
 * the request, and it raises a ticket for it — a seller issue for a
 * recall, a courier escalation for a re-attempt. The mutation invalidated
 * the ACTIONS list alone, so the "Issues raised on this order" panel a
 * few centimetres below the reply went on saying "Nothing raised yet"
 * about the ticket that had just been created, on the same page, until
 * somebody reloaded. Seen while filming D2.
 *
 * Pinned by reading the source rather than by rendering: the failure is
 * an ABSENT invalidation, and a component test that did not assert on
 * this exact key would pass just as loudly with it missing again.
 *
 * COMMENTS ARE STRIPPED FIRST. Prose about a rule reads exactly like the
 * rule to a regex, and this file's own docblock names both keys.
 */
const HOOKS = join(__dirname, '..', 'lib', 'ops-hooks.ts');

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('requesting a delivery action re-reads what it created', () => {
  const src = withoutComments(readFileSync(HOOKS, 'utf8'));
  const start = src.indexOf('export function useRequestDeliveryAction');
  const body = src.slice(start, src.indexOf('\nexport ', start + 1));

  it('found the hook', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('delivery-actions');
  });

  it('invalidates the delivery actions AND the tickets', () => {
    expect(body).toContain("'seller-delivery-actions'");
    expect(body).toContain("'seller-tickets'");
  });
});
