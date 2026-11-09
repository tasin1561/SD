import { AddressCheckService } from '../../src/modules/address-check/services/address-check.service';
import { SOLUSTATION_ERROR_NAME } from '../../src/modules/address-check/types/solustation.types';
import type { SolustationHttpService } from '../../src/modules/address-check/services/solustation-http.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/*
  Re-checking an order's address after an OPERATOR EDITED IT.

  Two rules carry the feature, and both are invisible when broken:

    * an edit goes to /v1/corrections, because a repeat /v1/validate on
      the same reference returns their STORED answer — the screen would
      show the verdict on the words the customer has just corrected and
      look exactly like a successful re-check;

    * the verdict is REPLACED on the one row the order already has. A
      second row cannot exist (`address_checks.order_id` is unique), and
      a stale score left beside a new address reads as "we checked this".

  And the whole thing must be unable to cost the operator their edit,
  which is the last block below.
*/

const ORDER_ID = '01a30000-0000-7000-8000-000000000001';

function judgement(over: Record<string, unknown> = {}) {
  return {
    status: 'valid',
    recommended_action: 'approve',
    validity_score: 91,
    rto_risk: null,
    rto_risk_status: 'model_not_ready',
    post_office_confidence: 'high',
    completed_address: 'Flat 4B, Kankandighi, South 24 Parganas, West Bengal 743383',
    issues: [],
    suggestions: [],
    extracted: {},
    field_source: {},
    validation_id: 'val_correction',
    ...over,
  };
}

/**
 * `SERVER` is transient, so it costs the one 2-second inline retry the
 * brief asks for; `AUTH` is not, which is the fast path for the cases
 * that are about the ROW rather than the retry.
 */
function solustationError(classification: 'SERVER' | 'AUTH'): Error {
  const e = new Error(`Solustation POST /v1/corrections failed (${classification})`);
  e.name = SOLUSTATION_ERROR_NAME;
  Object.assign(e, {
    classification,
    retryable: classification === 'SERVER',
    requestId: 'req_9',
  });
  return e;
}

interface RowOpts {
  readonly id?: string;
  readonly referenceId?: string;
  readonly validationId?: string | null;
}

function makeService(
  opts: {
    row?: RowOpts | null;
    order?: Record<string, unknown> | null;
    live?: boolean;
    fail?: Error;
  } = {},
) {
  const order =
    opts.order === null
      ? null
      : {
          id: ORDER_ID,
          sellerId: 'seller-1',
          storeId: null,
          recipientCountryCode: 'IN',
          recipientAddressLine1: 'Flat 4B, Kankandighi',
          recipientAddressLine2: 'PO Kankandighi',
          recipientLandmark: 'Beside the school',
          recipientPostalCode: '743383',
          // A Decimal in production; only `isZero()` is read.
          codAmountInr: { isZero: () => false },
          ...(opts.order ?? {}),
        };

  const findFirst = jest.fn(async () => order);
  const findUnique = jest.fn(async () =>
    opts.row === undefined || opts.row === null
      ? null
      : {
          id: opts.row.id ?? 'ac-1',
          referenceId: opts.row.referenceId ?? 'draft-01a11111-2222-3333-4444-555566667777',
          validationId: opts.row.validationId === undefined ? 'val_first' : opts.row.validationId,
        },
  );
  type WriteArgs = { where?: Record<string, unknown>; data: Record<string, unknown> };
  const update = jest.fn(async (_args: WriteArgs) => ({}));
  const create = jest.fn(async (_args: WriteArgs) => ({}));
  const upsert = jest.fn(async (_args: unknown) => ({}));
  const prisma = {
    client: {
      order: { findFirst },
      addressCheck: { findUnique, update, create, upsert },
    },
  } as unknown as PrismaService;

  /** Typed args so `mock.calls[0][0]` is readable — a bare
   *  `jest.fn(async () => …)` makes the call tuple `never`. */
  type Sent = Record<string, unknown>;
  const validate = jest.fn(async (_input: Sent) => judgement({ validation_id: 'val_fresh' }));
  const correction = jest.fn(async (_input: Sent) => {
    if (opts.fail !== undefined) throw opts.fail;
    return judgement();
  });
  const isLive = jest.fn(async () => opts.live ?? true);
  const http = { validate, correction, isLive } as unknown as SolustationHttpService;

  return {
    svc: new AddressCheckService(prisma, http),
    validate,
    correction,
    isLive,
    update,
    create,
    upsert,
    findUnique,
  };
}

describe('AddressCheckService.recheckOrder — an edited address', () => {
  it('goes to /v1/corrections with the FIRST check’s validation id, never back to /v1/validate', async () => {
    const { svc, correction, validate } = makeService({ row: { validationId: 'val_first' } });
    const view = await svc.recheckOrder(ORDER_ID);

    expect(validate).not.toHaveBeenCalled();
    expect(correction).toHaveBeenCalledTimes(1);
    expect(correction.mock.calls[0]?.[0]).toMatchObject({
      validationId: 'val_first',
      source: 'operator_fixed',
      address: 'Flat 4B, Kankandighi, PO Kankandighi',
      pincode: '743383',
      landmark: 'Beside the school',
    });
    expect(view?.rechecked).toBe(true);
    expect(view?.score).toBe(91);
  });

  it('never sends the recipient’s name, phone or email', async () => {
    const { svc, correction } = makeService({ row: {} });
    await svc.recheckOrder(ORDER_ID);
    const sent = Object.keys(correction.mock.calls[0]?.[0] ?? {});
    expect(sent.sort()).toEqual(['address', 'landmark', 'pincode', 'source', 'validationId']);
  });

  it('REPLACES the verdict on the row the order already has — one row, by its own id', async () => {
    const { svc, update, create, upsert } = makeService({
      row: { id: 'ac-7', validationId: 'val_first' },
    });
    await svc.recheckOrder(ORDER_ID);

    // A second row is what an upsert keyed on the order id would have
    // made for every order whose check came from the v2 page.
    expect(create).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: 'ac-7' });
    expect(args?.data).toMatchObject({
      status: 'valid',
      action: 'approve',
      score: 91,
      poConfidence: 'high',
      nextRetryAt: null,
      lastError: null,
    });
    expect(args?.data['checkedAt']).toBeInstanceOf(Date);
    expect(args?.data['result']).toMatchObject({ validity_score: 91 });
    // The first check's id is what every later correction carries.
    expect(args?.data).not.toHaveProperty('validationId');
  });

  it('fills the validation id only when the row had none', async () => {
    const { svc, validate, correction, update } = makeService({ row: { validationId: null } });
    await svc.recheckOrder(ORDER_ID);
    // No validation id means the first check never landed, so there is
    // no stored answer to be handed back.
    expect(correction).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]?.data).toMatchObject({ validationId: 'val_fresh' });
  });

  it('creates the one row when the order has no check at all', async () => {
    const { svc, create, update } = makeService({ row: null });
    await svc.recheckOrder(ORDER_ID);
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]?.data).toMatchObject({
      referenceId: ORDER_ID,
      orderId: ORDER_ID,
      sellerId: 'seller-1',
      createdByActorType: 'SYSTEM',
      createdByActorId: null,
      status: 'valid',
    });
  });
});

describe('AddressCheckService.recheckOrder — it cannot cost the operator their edit', () => {
  it('does not throw when Solustation is unreachable, and says the check is unavailable', async () => {
    const { svc } = makeService({ row: {}, fail: solustationError('AUTH') });
    const view = await svc.recheckOrder(ORDER_ID);
    expect(view).not.toBeNull();
    expect(view?.available).toBe(false);
    expect(view?.status).toBe('unavailable');
    // A failed check is caution, never approval.
    expect(view?.action).toBe('confirm_with_customer');
    expect(view?.score).toBeNull();
  });

  it('clears the old verdict and stores the EDITED address for the retry sweep', async () => {
    const { svc, update } = makeService({ row: { id: 'ac-7' }, fail: solustationError('SERVER') });
    await svc.recheckOrder(ORDER_ID);

    const args = update.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: 'ac-7' });
    expect(args?.data).toMatchObject({
      status: 'unavailable',
      // A score about the address before the edit must not keep
      // standing next to the address after it.
      action: null,
      score: null,
      poConfidence: null,
      lastRequestId: 'req_9',
      attempts: { increment: 1 },
    });
    expect(args?.data['result']).toEqual({
      _asked: {
        referenceId: 'draft-01a11111-2222-3333-4444-555566667777',
        address: 'Flat 4B, Kankandighi, PO Kankandighi',
        pincode: '743383',
        landmark: 'Beside the school',
        paymentType: 'cod',
      },
    });
    // On the worklist, so the verdict catches up with the edit later.
    expect(args?.data['nextRetryAt']).toBeInstanceOf(Date);
  });

  it('leaves nothing on the worklist for a failure that cannot change', async () => {
    const { svc, update } = makeService({ row: {}, fail: solustationError('AUTH') });
    await svc.recheckOrder(ORDER_ID);
    expect(update.mock.calls[0]?.[0]?.data).toMatchObject({ nextRetryAt: null });
  });

  it('survives the row write itself failing', async () => {
    const { svc, update } = makeService({ row: {} });
    update.mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(svc.recheckOrder(ORDER_ID)).resolves.toMatchObject({ available: true });
  });
});

describe('AddressCheckService.recheckOrder — when there is nothing to ask', () => {
  it('asks nothing in stub mode, and overwrites nothing', async () => {
    const { svc, correction, validate, update, create } = makeService({ row: {}, live: false });
    const view = await svc.recheckOrder(ORDER_ID);
    expect(correction).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(view?.available).toBe(false);
  });

  it('returns null for an order that is not an India one', async () => {
    const { svc, correction, isLive } = makeService({
      row: {},
      order: { recipientCountryCode: 'BD' },
    });
    expect(await svc.recheckOrder(ORDER_ID)).toBeNull();
    expect(correction).not.toHaveBeenCalled();
    expect(isLive).not.toHaveBeenCalled();
  });

  it('returns null for an order that does not exist', async () => {
    const { svc, findUnique } = makeService({ order: null });
    expect(await svc.recheckOrder(ORDER_ID)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns null rather than spending a call on an address too short to check', async () => {
    const { svc, correction } = makeService({
      row: {},
      order: { recipientAddressLine1: 'A', recipientAddressLine2: null },
    });
    expect(await svc.recheckOrder(ORDER_ID)).toBeNull();
    expect(correction).not.toHaveBeenCalled();
  });

  it('reads the payment type from the order rather than assuming COD', async () => {
    // Only /v1/validate carries a payment type, so the first-check path
    // is where it is visible at all.
    const { svc, validate } = makeService({
      row: { validationId: null },
      order: { codAmountInr: { isZero: () => true } },
    });
    await svc.recheckOrder(ORDER_ID);
    expect(validate.mock.calls[0]?.[0]).toMatchObject({ paymentType: 'prepaid' });
  });
});
