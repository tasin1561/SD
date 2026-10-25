import { ActorType } from '@skydrop/db';
import { AddressCheckService } from '../../src/modules/address-check/services/address-check.service';
import { SOLUSTATION_ERROR_NAME } from '../../src/modules/address-check/types/solustation.types';
import type { SolustationHttpService } from '../../src/modules/address-check/services/solustation-http.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const ACTOR = {
  actorType: ActorType.SELLER,
  actorId: 'user-1',
  sellerId: 'seller-1',
} as const;

const INPUT = {
  referenceId: 'draft-01a11111-2222-3333-4444-555566667777',
  address: 'Vill Kankandighi, PO Kankandighi, PS Mathurapur',
  pincode: '743383',
  paymentType: 'cod' as const,
};

/** Their real answer, trimmed to what these tests read. */
function judgement(over: Record<string, unknown> = {}) {
  return {
    status: 'valid',
    recommended_action: 'approve',
    validity_score: 73,
    rto_risk: null,
    rto_risk_status: 'model_not_ready',
    post_office_confidence: 'high',
    completed_address: 'Vill Kankandighi, South 24 Parganas, West Bengal 743383',
    issues: [{ code: 'house_number_missing', message: 'No house or flat number' }],
    suggestions: [],
    extracted: { post_office: 'Kankandighi' },
    field_source: { post_office: 'customer', district: 'pincode' },
    validation_id: 'val_1',
    ...over,
  };
}

function solustationError(retryable: boolean, extra: Record<string, unknown> = {}): Error {
  const e = new Error('Solustation POST /v1/validate timed out after 3000ms');
  e.name = SOLUSTATION_ERROR_NAME;
  Object.assign(e, { classification: 'TIMEOUT', retryable, ...extra });
  return e;
}

function makeService(
  opts: { existing?: { validationId: string | null; createdByActorId: string } | null } = {},
) {
  const findUnique = jest.fn(async () =>
    opts.existing === undefined
      ? null
      : opts.existing === null
        ? null
        : { id: 'ac-1', ...opts.existing },
  );
  /** Typed args so `mock.calls[0][0].create` is readable — a bare
   *  `jest.fn(async () => …)` makes the call tuple `never`. */
  type UpsertArgs = {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  const upsert = jest.fn(async (_args: UpsertArgs) => ({}));
  const prisma = {
    client: { addressCheck: { findUnique, upsert } },
  } as unknown as PrismaService;

  const validate = jest.fn(async () => judgement());
  const correction = jest.fn(async () =>
    judgement({ validity_score: 100, validation_id: 'val_2' }),
  );
  const pincode = jest.fn(async () => ({ pincode: '743383', valid: true }));
  const http = { validate, correction, pincode } as unknown as SolustationHttpService;

  return {
    svc: new AddressCheckService(prisma, http),
    validate,
    correction,
    pincode,
    upsert,
  };
}

describe('AddressCheckService — validate once, then correct', () => {
  it('a first check goes to /v1/validate', async () => {
    const { svc, validate, correction } = makeService();
    const view = await svc.check(ACTOR, INPUT);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(correction).not.toHaveBeenCalled();
    expect(view.rechecked).toBe(false);
  });

  it('a later check on the same draft goes to /v1/corrections', async () => {
    // Re-validating a reference returns their STORED answer, so the
    // operator would be shown the verdict on text they had already
    // changed. It looks exactly like the edit did nothing.
    const { svc, validate, correction } = makeService({
      existing: { validationId: 'val_1', createdByActorId: ACTOR.actorId },
    });
    const view = await svc.check(ACTOR, INPUT);
    expect(correction).toHaveBeenCalledWith(
      expect.objectContaining({ validationId: 'val_1', source: 'operator_fixed' }),
    );
    expect(validate).not.toHaveBeenCalled();
    expect(view.rechecked).toBe(true);
  });

  it('the FIRST validation id is never overwritten by a correction', async () => {
    const { svc, upsert } = makeService({
      existing: { validationId: 'val_1', createdByActorId: ACTOR.actorId },
    });
    await svc.check(ACTOR, INPUT);
    // Every later correction carries the first id; replacing it would
    // orphan the chain and send the next edit back to /v1/validate.
    expect(upsert.mock.calls[0]?.[0].update).not.toHaveProperty('validationId');
  });

  it("another actor's reference starts a fresh check, it does not resume theirs", async () => {
    // A reference id is not a secret. Resuming somebody else's draft
    // would let one console read another's judgement by guessing.
    const { svc, validate, correction } = makeService({
      existing: { validationId: 'val_1', createdByActorId: 'somebody-else' },
    });
    await svc.check(ACTOR, INPUT);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(correction).not.toHaveBeenCalled();
  });
});

describe('AddressCheckService — a failed check is caution, never approval', () => {
  it('a timeout answers confirm_with_customer', async () => {
    // Owner, 2026-10-26. We could not check this address, so the
    // honest instruction to an operator is to ring the customer.
    const { svc } = makeService();
    const http = (svc as unknown as { http: { validate: jest.Mock } }).http;
    http.validate.mockRejectedValue(solustationError(true));

    const view = await svc.check(ACTOR, INPUT);
    expect(view.action).toBe('confirm_with_customer');
    expect(view.available).toBe(false);
    expect(view.status).toBe('unavailable');
    expect(view.score).toBeNull();
  });

  it('stores `unavailable` and schedules a retry for a retryable failure', async () => {
    const { svc, upsert } = makeService();
    (svc as unknown as { http: { validate: jest.Mock } }).http.validate.mockRejectedValue(
      solustationError(true, { requestId: 'req_X' }),
    );
    await svc.check(ACTOR, INPUT);
    const create = upsert.mock.calls[0]?.[0].create ?? {};
    expect(create['status']).toBe('unavailable');
    expect(create['lastRequestId']).toBe('req_X');
    expect(create['nextRetryAt']).toBeInstanceOf(Date);
  });

  it('does NOT schedule a retry for a failure that cannot change', async () => {
    // A 422 is our own request being wrong and a 401 is the key —
    // retrying either asks the same question forever.
    const { svc, upsert } = makeService();
    (svc as unknown as { http: { validate: jest.Mock } }).http.validate.mockRejectedValue(
      solustationError(false, { classification: 'BAD_REQUEST' }),
    );
    await svc.check(ACTOR, INPUT);
    expect((upsert.mock.calls[0]?.[0].create ?? {})['nextRetryAt']).toBeNull();
  });

  it('an unrecognised recommended_action is caution, not a green badge', async () => {
    const { svc } = makeService();
    (svc as unknown as { http: { validate: jest.Mock } }).http.validate.mockResolvedValue(
      judgement({ recommended_action: 'something_new' }),
    );
    expect((await svc.check(ACTOR, INPUT)).action).toBe('confirm_with_customer');
  });

  it('a failure to RECORD the check still answers the operator', async () => {
    // The check is advice; recording the advice failing is not more
    // important than the order in front of somebody.
    const { svc, upsert } = makeService();
    upsert.mockRejectedValue(new Error('database is down'));
    const view = await svc.check(ACTOR, INPUT);
    expect(view.available).toBe(true);
    expect(view.action).toBe('approve');
  });

  it('a pincode lookup that fails costs the autofill and nothing else', async () => {
    const { svc, pincode } = makeService();
    pincode.mockRejectedValue(new Error('nope'));
    expect(await svc.pincode('743383')).toBeNull();
  });
});

describe('AddressCheckService — the RTO figure is never invented', () => {
  it('stays null while their model is not ready', async () => {
    // Today it is always model_not_ready. A number here would be acted
    // on, which is worse than showing nothing.
    const { svc } = makeService();
    const view = await svc.check(ACTOR, INPUT);
    expect(view.rtoRisk).toBeNull();
    expect(view.rtoRiskStatus).toBe('model_not_ready');
  });

  it('is read ONLY when they say it is shown', async () => {
    const { svc } = makeService();
    (svc as unknown as { http: { validate: jest.Mock } }).http.validate.mockResolvedValue(
      judgement({ rto_risk: 0.42, rto_risk_status: 'shown' }),
    );
    expect((await svc.check(ACTOR, INPUT)).rtoRisk).toBe(0.42);
  });

  it('ignores a figure sent without `shown`', async () => {
    const { svc } = makeService();
    (svc as unknown as { http: { validate: jest.Mock } }).http.validate.mockResolvedValue(
      judgement({ rto_risk: 0.42, rto_risk_status: 'model_not_ready' }),
    );
    expect((await svc.check(ACTOR, INPUT)).rtoRisk).toBeNull();
  });
});
