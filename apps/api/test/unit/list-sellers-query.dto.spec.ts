import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SellerStatus } from '@skydrop/db';
import { ListSellersQueryDto } from '../../src/modules/admin-seller/dto/list-sellers.dto';

/**
 * `?status=APPROVED` must work, not only `?status=A&status=B`.
 *
 * ── THE BUG ──────────────────────────────────────────────────────────
 * The DTO declared `@IsArray()` and nothing else. Express hands over an
 * ARRAY only when a key repeats — a single `?status=PENDING` arrives as
 * a plain string — so every status filter on the sellers page answered
 * "400: status must be an array". The only option that worked was the
 * one that sends no filter at all, which is why it survived: "All
 * statuses" looked fine and every other choice was broken.
 *
 * A filter needing two values to work is a trap, so the single value is
 * normalised in the DTO rather than left for each caller to remember.
 *
 * ── WHY A DTO TEST ───────────────────────────────────────────────────
 * This is exactly a validation-pipe question, and `plainToInstance` +
 * `validate` is the same pair the pipe runs. An e2e would prove it too
 * and would take four hundred times as long to tell us.
 */

async function check(query: Record<string, unknown>) {
  const dto = plainToInstance(ListSellersQueryDto, query, {
    enableImplicitConversion: false,
  });
  return { dto, errors: await validate(dto, { whitelist: true }) };
}

describe('ListSellersQueryDto — status filter', () => {
  it('accepts ONE status, as a browser sends it', async () => {
    const { dto, errors } = await check({ status: 'APPROVED' });
    expect(errors).toEqual([]);
    expect(dto.status).toEqual([SellerStatus.APPROVED]);
  });

  it('still accepts a repeated key', async () => {
    const { dto, errors } = await check({ status: ['APPROVED', 'SUSPENDED'] });
    expect(errors).toEqual([]);
    expect(dto.status).toEqual([SellerStatus.APPROVED, SellerStatus.SUSPENDED]);
  });

  it('accepts no status at all — the unfiltered list', async () => {
    const { dto, errors } = await check({});
    expect(errors).toEqual([]);
    expect(dto.status).toBeUndefined();
  });

  it('still rejects a value that is not a SellerStatus', async () => {
    // Normalising the shape must not soften the enum check: `?status=x`
    // has to stay a 400 rather than quietly filtering on nothing.
    const { errors } = await check({ status: 'NOT_A_STATUS' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a bad value even when a good one is alongside it', async () => {
    const { errors } = await check({ status: ['APPROVED', 'NOT_A_STATUS'] });
    expect(errors.length).toBeGreaterThan(0);
  });
});
