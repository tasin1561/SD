import {
  OrderAttentionService,
  staleFeeFxRateKey,
} from '../../src/modules/order-attention/services/order-attention.service';

/**
 * A FIXED exchange rate is a pricing policy, not a defect.
 *
 * `checkStaleFeeFxRate` used to compare the rate's age against a
 * hard-coded 7 days, which assumed somebody refreshes it weekly. Skydrop
 * holds a rate deliberately until the market moves materially, so that
 * alarm was permanent by construction — it had raised 820 times and
 * would have raised hourly for ever, which is the exact failure the
 * method's own severity note warns about ("how an alert gets ignored").
 *
 * `ops.fee_fx_rate_review_days` makes the policy expressible, and 0
 * means never ask. These pin BOTH directions, because the easy mistake
 * in either refactor is to delete the check instead of configuring it.
 */
describe('checkStaleFeeFxRate — fixed-rate policy', () => {
  const makeService = (reviewDays: number | null) => {
    const resolveByKey = jest.fn().mockResolvedValue(1);
    const raise = jest.fn().mockResolvedValue({ isNew: true });
    const findUnique = jest
      .fn()
      .mockResolvedValue(reviewDays === null ? null : { valueInt: reviewDays });
    const findMany = jest.fn().mockResolvedValue([{ key: 'k', valueString: 'BDT' }]);
    // A rate set long ago — stale under any positive threshold.
    const findFirst = jest.fn().mockResolvedValue({ updatedAt: new Date('2026-08-24T00:00:00Z') });

    const svc = Object.assign(
      Object.create(OrderAttentionService.prototype) as OrderAttentionService,
      {
        prisma: { client: { systemSetting: { findUnique, findMany }, fxRate: { findFirst } } },
        issues: { resolveByKey, raise },
      },
    );
    return { svc, resolveByKey, raise };
  };

  const NOW = new Date('2026-10-24T00:00:00Z');
  const run = (svc: OrderAttentionService): Promise<number> =>
    (svc as unknown as { checkStaleFeeFxRate(now: Date): Promise<number> }).checkStaleFeeFxRate(
      NOW,
    );

  it('raises nothing when the review window is 0 — the rate is fixed on purpose', async () => {
    const { svc, resolveByKey, raise } = makeService(0);

    const raised = await run(svc);

    expect(raised).toBe(0);
    expect(raise).not.toHaveBeenCalled();
    // And it CLOSES any issue a previous policy left open, rather than
    // leaving a card nobody can clear.
    expect(resolveByKey).toHaveBeenCalledWith(
      staleFeeFxRateKey(),
      expect.stringContaining('policy'),
    );
  });

  it('defaults to 0 when nobody has set the key, so a fresh database is quiet too', async () => {
    const { svc, raise } = makeService(null);

    expect(await run(svc)).toBe(0);
    expect(raise).not.toHaveBeenCalled();
  });

  it('still raises when an operator DOES ask to be reminded', async () => {
    // The check is configured, not deleted: set a window and the alarm
    // comes back exactly as before.
    const { svc, raise } = makeService(7);

    const raised = await run(svc);

    expect(raised).toBe(1);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0]?.[0]).toMatchObject({
      dedupeKey: staleFeeFxRateKey(),
      metadata: expect.objectContaining({ staleAfterDays: 7 }),
    });
  });
});
