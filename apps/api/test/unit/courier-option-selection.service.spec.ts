import {
  CourierOptionSelectionService,
  type CourierOption,
} from '../../src/modules/courier-shared/services/courier-option-selection.service';

const svc = new CourierOptionSelectionService();

const opt = (
  id: number,
  name: string,
  rateInr: number,
  estimatedDays: number | null,
): CourierOption => ({
  courierCompanyId: id,
  courierName: name,
  rateInr,
  estimatedDays,
  etd: null,
});

/**
 * CUR-17 — the policy → carrier table.
 *
 * Pure by design, so every rule here is checked against a list of rates
 * rather than against a courier. The cases that matter are the ones
 * where two plausible readings disagree.
 */
describe('CourierOptionSelectionService', () => {
  const three = [opt(1, 'Slow & Cheap', 40, 6), opt(2, 'Middle', 60, 3), opt(3, 'Express', 90, 1)];

  it('CHEAPEST takes the lowest rate', () => {
    const r = svc.select(three, 'CHEAPEST', 5);
    expect(r).toMatchObject({ kind: 'CHOSEN' });
    expect(r.kind === 'CHOSEN' && r.option.courierCompanyId).toBe(1);
  });

  it('FASTEST takes the earliest estimate', () => {
    const r = svc.select(three, 'FASTEST', 5);
    expect(r.kind === 'CHOSEN' && r.option.courierCompanyId).toBe(3);
  });

  it('SHIPROCKET_DEFAULT sends no id at all', () => {
    // Not "pick the first one" — the whole point of the default is that
    // their ranking decides, and naming a carrier would override it.
    expect(svc.select(three, 'SHIPROCKET_DEFAULT', 5)).toMatchObject({ kind: 'DEFER_TO_CARRIER' });
  });

  it('MANUAL stops and asks', () => {
    expect(svc.select(three, 'MANUAL', 5)).toMatchObject({ kind: 'ASK_A_HUMAN' });
  });

  it('MANUAL does NOT stop when there is only one option', () => {
    // A decision screen with one button on it holds a parcel, its
    // stock and its customer for no gain. Measured, not hypothetical:
    // our own pickup pin returns exactly one carrier for some lanes.
    const r = svc.select([opt(1, 'Only', 40, 3)], 'MANUAL', 5);
    expect(r).toMatchObject({ kind: 'CHOSEN' });
  });

  it('an EMPTY list is not a question for a human', () => {
    // Nothing to choose between. Let the booking proceed and fail with
    // the carrier's own reason, which is the one an operator can act on.
    expect(svc.select([], 'MANUAL', 5)).toMatchObject({ kind: 'DEFER_TO_CARRIER' });
  });

  describe('CHEAPEST_WITHIN_DAYS', () => {
    it('takes the cheapest that actually arrives in time', () => {
      const r = svc.select(three, 'CHEAPEST_WITHIN_DAYS', 4);
      // Not the ₹40 one — it takes six days.
      expect(r.kind === 'CHOSEN' && r.option.courierCompanyId).toBe(2);
    });

    it('falls back to the FASTEST when nothing qualifies, not the cheapest', () => {
      // The policy is a deadline with a price preference inside it.
      // Missing the deadline to save money inverts what was asked for.
      const r = svc.select(three, 'CHEAPEST_WITHIN_DAYS', 1);
      expect(r.kind === 'CHOSEN' && r.option.courierCompanyId).toBe(3);
    });

    it('excludes options with NO estimate rather than assuming they qualify', () => {
      // "We do not know when it arrives" is not evidence that it
      // arrives in time — and it would win on price every time.
      const withUnknown = [opt(9, 'Unknown ETA', 10, null), opt(2, 'Middle', 60, 3)];
      const r = svc.select(withUnknown, 'CHEAPEST_WITHIN_DAYS', 5);
      expect(r.kind === 'CHOSEN' && r.option.courierCompanyId).toBe(2);
    });
  });

  it('an unknown estimate never wins FASTEST', () => {
    // Sorting a null as 0 would make the carrier that told us least
    // look like the quickest.
    const r = svc.select([opt(9, 'Unknown ETA', 10, null), opt(2, 'Middle', 60, 3)], 'FASTEST', 5);
    expect(r.kind === 'CHOSEN' && r.option.courierCompanyId).toBe(2);
  });

  it('CHEAPEST breaks a price tie on speed', () => {
    const tie = [opt(1, 'A', 50, 6), opt(2, 'B', 50, 2)];
    const r = svc.select(tie, 'CHEAPEST', 5);
    expect(r.kind === 'CHOSEN' && r.option.courierCompanyId).toBe(2);
  });

  it('never mutates the caller’s list', () => {
    // It sorts, and sorting in place would reorder the very array the
    // caller is about to persist as "what was on the table".
    const original = [...three];
    svc.select(three, 'CHEAPEST', 5);
    expect(three).toEqual(original);
  });
});
