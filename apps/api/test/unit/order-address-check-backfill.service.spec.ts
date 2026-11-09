import { ActorType, Prisma } from '@skydrop/db';
import { OrderAddressCheckBackfillService } from '../../src/modules/address-check/services/order-address-check-backfill.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SolustationHttpService } from '../../src/modules/address-check/services/solustation-http.service';
import {
  SOLUSTATION_ERROR_NAME,
  type SolustationError,
} from '../../src/modules/address-check/types/solustation.types';

/*
  ── WHAT THIS SUITE IS GUARDING ───────────────────────────────────────
  There are five ways an order gets created in this repo, and until this
  service existed only ONE of them produced an address check: the v2
  order page, which mints a draft while the operator types. Orders from
  the seller API, a member store, either CSV import, or the staged-row
  queue were silently unchecked — and in shadow mode an unchecked order
  looks exactly like an address nobody had concerns about.

  The fix keys off DATA ("an India order with no check") rather than the
  code path, so the tests do the same: none of them names a creation
  path, because the point is that the service does not have to.
*/

/**
 * Narrows away the `undefined` that `noUncheckedIndexedAccess` adds to
 * an indexed read, without a non-null assertion (banned repo-wide, and
 * `--max-warnings 0` enforces it). A missing call is a real test
 * failure, so throwing is the honest response.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/** Only the shapes these tests read back — not the Prisma arg types. */
interface FindManyArgs {
  where: {
    deletedAt: null;
    recipientCountryCode: string;
    createdAt: { gte: Date };
    addressCheck: null;
  };
  orderBy: Record<string, string>;
  take: number;
}
interface UpsertArgs {
  where: { referenceId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}
interface ValidateArgs {
  referenceId: string;
  address: string;
  pincode: string;
  landmark?: string;
  paymentType: string;
}

const JUDGEMENT = {
  validation_id: 'val_01J',
  recommended_action: 'approve',
  validity_score: 75,
  status: 'valid',
  post_office_confidence: 'high',
};

function order(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    sellerId: 'seller-1',
    storeId: null,
    recipientAddressLine1: 'H.No 12, near Hanuman Mandir',
    recipientAddressLine2: 'Vill Raydighi',
    recipientLandmark: 'Hanuman Mandir',
    recipientPostalCode: '743383',
    codAmountInr: new Prisma.Decimal('1499.00'),
    ...over,
  };
}

function makeService(
  opts: {
    orders?: unknown[];
    live?: boolean;
    validate?: jest.Mock;
    validateBatch?: jest.Mock;
    batchJob?: jest.Mock;
    batchResults?: jest.Mock;
  } = {},
) {
  /*
    Args are TYPED on every mock that gets read back. A bare
    `jest.fn(async () => …)` infers a zero-length call tuple, so
    `mock.calls[0][0]` does not typecheck — the trap the sibling specs
    in this module already carry a note about.
  */
  const findMany = jest.fn(async (_args: FindManyArgs) => opts.orders ?? []);
  const upsert = jest.fn(async (_args: UpsertArgs) => ({}));
  const findFirst = jest.fn(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    sellerId: 'seller-1',
    storeId: null,
  }));
  const prisma = {
    client: {
      order: { findMany, findFirst },
      addressCheck: { upsert },
    },
  } as unknown as PrismaService;

  const validate = opts.validate ?? jest.fn(async (_input: ValidateArgs) => JUDGEMENT);
  const validateBatch =
    opts.validateBatch ?? jest.fn(async (_items: readonly ValidateArgs[]) => ({ job_id: 'job_1' }));
  const http = {
    isLive: jest.fn(async () => opts.live ?? true),
    validate,
    validateBatch,
    batchJob: opts.batchJob ?? jest.fn(async () => ({ job_id: 'job_1', status: 'done' })),
    batchResults: opts.batchResults ?? jest.fn(async () => ({ job_id: 'job_1', status: 'done' })),
  } as unknown as SolustationHttpService;

  return {
    svc: new OrderAddressCheckBackfillService(prisma, http),
    validate,
    validateBatch,
    upsert,
    findMany,
  };
}

describe('OrderAddressCheckBackfillService', () => {
  describe('which orders it picks up', () => {
    it('asks only for India orders that have no check, recently placed', async () => {
      const { svc, findMany } = makeService({ orders: [order()] });
      await svc.sweep();

      const where = must(findMany.mock.calls[0], 'a findMany call')[0].where;
      // `addressCheck: null` is the whole gate — a draft the v2 page
      // already claimed IS a row, so a covered order is skipped without
      // this service knowing the v2 page exists.
      expect(where).toMatchObject({
        deletedAt: null,
        recipientCountryCode: 'IN',
        addressCheck: null,
      });
      expect(where.createdAt.gte).toBeInstanceOf(Date);
    });

    it('drains oldest first, so nothing waits behind a newer order for ever', async () => {
      const { svc, findMany } = makeService({ orders: [order()] });
      await svc.sweep();
      expect(findMany.mock.calls[0]?.[0]?.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('does nothing at all in stub mode', async () => {
      const { svc, validate, findMany } = makeService({ live: false, orders: [order()] });
      const r = await svc.sweep();
      expect(r).toMatchObject({ found: 0, checked: 0 });
      expect(findMany).not.toHaveBeenCalled();
      expect(validate).not.toHaveBeenCalled();
    });
  });

  describe('the request it builds', () => {
    it('uses the ORDER ID as reference_id, so a re-check is free', async () => {
      const o = order();
      const { svc, validate } = makeService({ orders: [o] });
      await svc.sweep();
      expect(validate).toHaveBeenCalledWith(expect.objectContaining({ referenceId: o.id }));
    });

    it('joins the two address lines and carries the landmark', async () => {
      const { svc, validate } = makeService({ orders: [order()] });
      await svc.sweep();
      expect(validate).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'H.No 12, near Hanuman Mandir, Vill Raydighi',
          pincode: '743383',
          landmark: 'Hanuman Mandir',
        }),
      );
    });

    it('omits the landmark rather than sending an empty one', async () => {
      const { svc, validate } = makeService({ orders: [order({ recipientLandmark: '  ' })] });
      await svc.sweep();
      expect(validate.mock.calls[0]?.[0]).not.toHaveProperty('landmark');
    });

    it('survives a null second address line', async () => {
      const { svc, validate } = makeService({ orders: [order({ recipientAddressLine2: null })] });
      await svc.sweep();
      expect(validate).toHaveBeenCalledWith(
        expect.objectContaining({ address: 'H.No 12, near Hanuman Mandir' }),
      );
    });

    /*
      ── THE PRIVACY ASSERTION ───────────────────────────────────────────
      The order row this service reads also holds the recipient's name,
      phone, alternate phone and email. Solustation refuses an unknown
      field with 422, so a leak would announce itself — but "it would be
      caught" is not the same as "it cannot happen", and this is the
      test that says it cannot.
    */
    it('sends ONLY the five permitted fields — never a name or a phone', async () => {
      const { svc, validate } = makeService({
        orders: [
          order({
            recipientName: 'Asha Devi',
            recipientPhoneE164: '+919876543210',
            recipientEmail: 'asha@example.test',
          }),
        ],
      });
      await svc.sweep();
      const sent = validate.mock.calls[0]?.[0] ?? {};
      expect(Object.keys(sent).sort()).toEqual(
        ['address', 'landmark', 'paymentType', 'pincode', 'referenceId'].sort(),
      );
      const asJson = JSON.stringify(sent);
      expect(asJson).not.toContain('Asha');
      expect(asJson).not.toContain('98765');
      expect(asJson).not.toContain('example.test');
    });

    it('reads payment_type from the order rather than assuming', async () => {
      const cod = makeService({ orders: [order()] });
      await cod.svc.sweep();
      expect(cod.validate).toHaveBeenCalledWith(expect.objectContaining({ paymentType: 'cod' }));

      const prepaid = makeService({ orders: [order({ codAmountInr: new Prisma.Decimal('0') })] });
      await prepaid.svc.sweep();
      expect(prepaid.validate).toHaveBeenCalledWith(
        expect.objectContaining({ paymentType: 'prepaid' }),
      );
    });
  });

  describe('one at a time, or a batch', () => {
    it('checks a handful individually', async () => {
      const orders = Array.from({ length: 3 }, (_, i) =>
        order({ id: `0000000${i}-1111-1111-1111-111111111111` }),
      );
      const { svc, validate, validateBatch } = makeService({ orders });
      const r = await svc.sweep();

      expect(validate).toHaveBeenCalledTimes(3);
      expect(validateBatch).not.toHaveBeenCalled();
      expect(r).toMatchObject({ found: 3, checked: 3, batched: 0, batchJobId: null });
    });

    it('opens a batch job for a backlog, and reports its id to be collected', async () => {
      // A CSV import of hundreds is the case this exists for: hundreds
      // of single round trips would hold a worker open for minutes.
      const orders = Array.from({ length: 40 }, (_, i) =>
        order({ id: `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111` }),
      );
      const { svc, validate, validateBatch } = makeService({ orders });
      const r = await svc.sweep();

      expect(validateBatch).toHaveBeenCalledTimes(1);
      expect(validate).not.toHaveBeenCalled();
      expect(validateBatch.mock.calls[0]?.[0]).toHaveLength(40);
      expect(r).toMatchObject({ found: 40, batched: 40, batchJobId: 'job_1' });
    });

    it('every batch item carries its own order id as the reference', async () => {
      const orders = Array.from({ length: 12 }, (_, i) =>
        order({ id: `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111` }),
      );
      const { svc, validateBatch } = makeService({ orders });
      await svc.sweep();
      const items = validateBatch.mock.calls[0]?.[0] ?? [];
      expect(items.map((i: { referenceId: string }) => i.referenceId)).toEqual(
        orders.map((o) => o.id),
      );
    });
  });

  describe('collecting a batch', () => {
    it('reports not-done while the job is still running', async () => {
      const { svc } = makeService({
        batchJob: jest.fn(async () => ({ job_id: 'job_1', status: 'running' })),
      });
      await expect(svc.collectBatch('job_1')).resolves.toEqual({ done: false, stored: 0 });
    });

    it('stores each result against the order its reference_id names', async () => {
      const id = '11111111-1111-1111-1111-111111111111';
      const { svc, upsert } = makeService({
        batchJob: jest.fn(async () => ({
          job_id: 'job_1',
          status: 'done',
          pages: 1,
          results: [{ reference_id: id, ...JUDGEMENT }],
        })),
      });
      const r = await svc.collectBatch('job_1');
      expect(r).toEqual({ done: true, stored: 1 });
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { referenceId: id } }));
    });

    it('treats a failed job as done and leaves the orders unchecked for the next sweep', async () => {
      const { svc, upsert } = makeService({
        batchJob: jest.fn(async () => ({ job_id: 'job_1', status: 'failed' })),
      });
      await expect(svc.collectBatch('job_1')).resolves.toEqual({ done: true, stored: 0 });
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe('what it writes', () => {
    it('stores the verdict and the whole response', async () => {
      const { svc, upsert } = makeService({ orders: [order()] });
      await svc.sweep();
      const call = must(upsert.mock.calls[0], 'an upsert call')[0];
      expect(call.create).toMatchObject({
        status: 'valid',
        action: 'approve',
        score: 75,
        validationId: 'val_01J',
        poConfidence: 'high',
      });
      // SYSTEM with no actor id: nobody was at a screen, and a sentinel
      // uuid would match nobody while looking like somebody.
      // `ActorType.SYSTEM` — the client-side enum name; it `@map`s to
      // `system` in the column, which is not what the service passes.
      expect(call.create).toMatchObject({
        createdByActorType: ActorType.SYSTEM,
        createdByActorId: null,
      });
      // Attached to the order straight away — there is no draft to claim.
      expect(call.create.orderId).toBe(order().id);
    });

    /*
      The brief's hard rule: a check that could not be made is treated
      as `confirm_with_customer`, NEVER as approval. It is guaranteed
      structurally — there is no path here that writes an approving
      action on a failure — and asserted from both ends below.
    */
    it('writes `unavailable` with no action when the call fails', async () => {
      const err = Object.assign(new Error('boom'), {
        name: SOLUSTATION_ERROR_NAME,
        classification: 'SERVER',
        retryable: true,
        requestId: 'req_01M',
      }) as SolustationError;
      const { svc, upsert } = makeService({
        orders: [order()],
        validate: jest.fn(async () => {
          throw err;
        }),
      });
      const r = await svc.sweep();

      expect(r).toMatchObject({ found: 1, checked: 0, failed: 1 });
      const written = must(upsert.mock.calls[0], 'an upsert call')[0].create;
      expect(written.status).toBe('unavailable');
      expect(written.action).toBeNull();
      expect(written.action).not.toBe('approve');
      // Their id for the call, kept so the failure can be asked about
      // in their logs by name.
      expect(written.lastRequestId).toBe('req_01M');
      // Retryable, so the 60-second backstop sweep will come back.
      expect(written.nextRetryAt).toBeInstanceOf(Date);
    });

    it('does not schedule a retry for a failure that cannot improve', async () => {
      const err = Object.assign(new Error('bad body'), {
        name: SOLUSTATION_ERROR_NAME,
        classification: 'BAD_REQUEST',
        retryable: false,
      }) as SolustationError;
      const { svc, upsert } = makeService({
        orders: [order()],
        validate: jest.fn(async () => {
          throw err;
        }),
      });
      await svc.sweep();
      expect(upsert.mock.calls[0]?.[0]?.create?.nextRetryAt).toBeNull();
    });

    it('one failing order does not strand the rest of the tick', async () => {
      const orders = [
        order({ id: '00000001-1111-1111-1111-111111111111' }),
        order({ id: '00000002-1111-1111-1111-111111111111' }),
        order({ id: '00000003-1111-1111-1111-111111111111' }),
      ];
      let n = 0;
      const { svc } = makeService({
        orders,
        validate: jest.fn(async () => {
          n += 1;
          if (n === 2) throw Object.assign(new Error('boom'), { name: SOLUSTATION_ERROR_NAME });
          return JUDGEMENT;
        }),
      });
      const r = await svc.sweep();
      expect(r).toMatchObject({ found: 3, checked: 2, failed: 1 });
    });
  });
});
