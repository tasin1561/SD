import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Manual courier placement — the fallback when Delhivery refuses.
 *
 * Both endpoints shipped in M9 and nothing ever called them, so the
 * MANUAL_PLACEMENT_ADMIN role owned two actions it could not reach and
 * an order routed here simply stopped.
 *
 * The check that carries the most weight is the REQUEST SHAPE. The API
 * runs `forbidNonWhitelisted`, so one field name that the DTO does not
 * declare turns every call into a 400 — and the client contract had
 * exactly that: `trackingUrl` where the server wants `serviceType`. It
 * went unnoticed for months precisely because no screen exercised it.
 * A hook existing is not evidence its endpoint accepts what it sends.
 */

const PANEL = join(__dirname, '../app/(authed)/orders/_components/manual-placement-panel.tsx');
const SECTION = join(__dirname, '../app/(authed)/orders/_components/order-shipments-section.tsx');
const DETAIL = join(__dirname, '../app/(authed)/orders/_components/order-detail.tsx');
const HOOKS = join(__dirname, '../lib/api-hooks.ts');
const CONTRACT = join(
  __dirname,
  '../../../../packages/api-client/src/endpoints/admin-warehouse.ts',
);
const SERVER_DTO = join(
  __dirname,
  '../../../api/src/modules/courier-manual-placement/dto/manual-placement.dto.ts',
);

const read = (p: string): string => readFileSync(p, 'utf8');

describe('what the client sends is what the server accepts', () => {
  it('the request type names exactly the DTO fields', () => {
    // forbidNonWhitelisted means an extra field is a 400, and a missing
    // optional is a feature nobody can reach. Compare both directions.
    const dto = read(SERVER_DTO);
    const placeDto = dto.slice(
      dto.indexOf('class PlaceManualAwbDto'),
      dto.indexOf('class CancelUnfulfillableDto'),
    );
    const serverFields = Array.from(
      placeDto.matchAll(/^\s{2}([a-zA-Z]+)[?!]:/gm),
      (m) => m[1],
    ).sort();

    const contract = read(CONTRACT);
    const iface = contract.slice(
      contract.indexOf('interface PlaceManualAwbRequest'),
      contract.indexOf('interface PlaceManualAwbResult'),
    );
    const clientFields = Array.from(
      iface.matchAll(/readonly ([a-zA-Z]+)\??:/g),
      (m) => m[1],
    ).sort();

    expect(serverFields.length).toBeGreaterThan(0);
    expect(clientFields).toEqual(serverFields);
  });

  it('trackingUrl is gone — the DTO never accepted it', () => {
    const iface = read(CONTRACT);
    const block = iface.slice(
      iface.indexOf('interface PlaceManualAwbRequest'),
      iface.indexOf('interface PlaceManualAwbResult'),
    );
    expect(block).not.toMatch(/readonly trackingUrl/);
  });

  it('the panel sends only fields the DTO declares', () => {
    const src = read(PANEL);
    const call = src.slice(src.indexOf('place.mutateAsync({'), src.indexOf('setPlacing(false)'));
    expect(call).toContain('awbNumber');
    expect(call).toContain('courierName');
    expect(call).toContain('serviceType');
    expect(call).not.toContain('trackingUrl');
  });
});

describe('the panel is reachable, and only when it applies', () => {
  it('is mounted on the shipments section', () => {
    expect(read(SECTION)).toContain('<ManualPlacementPanel');
  });

  it('renders only for an order in PENDING_MANUAL_PLACEMENT', () => {
    // Rendering it always would offer "dispatch" on a parcel a courier
    // already has.
    expect(read(SECTION)).toContain("orderStatus === 'PENDING_MANUAL_PLACEMENT'");
  });

  it('the order status is passed down rather than re-fetched', () => {
    // Two reads of the same status can disagree for a moment right
    // after a dispatch, which is exactly when this panel is on screen.
    expect(read(DETAIL)).toContain('orderStatus={detail.data.status}');
  });

  it('will not offer to place an AWB on a shipment that has one', () => {
    expect(read(SECTION)).toContain('hasAwb={s.awbNumber !== null}');
    expect(read(PANEL)).toContain('disabled={hasAwb}');
  });
});

describe('both actions move money-adjacent state, so the cache must follow', () => {
  const src = read(HOOKS);

  it('placing an AWB invalidates orders AND inventory', () => {
    // It dispatches the order and takes stock off hand. A page still
    // showing PENDING_MANUAL_PLACEMENT reads as a failed action and
    // invites a second attempt.
    const hook = src.slice(src.indexOf('export function usePlaceManualAwb('));
    expect(hook.slice(0, 1200)).toContain("['admin-orders']");
    expect(hook.slice(0, 1200)).toContain("['admin-inventory']");
  });

  it('cancelling invalidates them too — it releases the reservation', () => {
    const hook = src.slice(src.indexOf('export function useCancelManualPlacement('));
    expect(hook.slice(0, 1200)).toContain("['admin-orders']");
    expect(hook.slice(0, 1200)).toContain("['admin-inventory']");
  });
});

describe('the destructive path is guarded like one', () => {
  const src = read(PANEL);

  it('cancelling asks for a reason at the server’s own floor', () => {
    // The DTO is @MinLength(10). Mirrored so the operator is told before
    // submitting; the server still decides.
    expect(src).toContain('reason.trim().length < 10');
  });

  it('uses the critical tone rather than looking like a save', () => {
    expect(src).toMatch(/tone="critical"/);
  });

  it('surfaces the server verdict verbatim (FE-2)', () => {
    // MANUAL_PLACEMENT_NOT_ALLOCATED tells the operator to re-pick —
    // guessing at that message here would lose the instruction.
    expect(src).toContain('serverVerdict(err)');
  });
});
