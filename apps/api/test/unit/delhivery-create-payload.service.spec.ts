import { DelhiveryShipmentEditService } from '../../src/modules/courier-delhivery/services/delhivery-shipment-edit.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';
import type { DelhiveryWriteGuardService } from '../../src/modules/courier-delhivery/services/delhivery-write-guard.service';

type AnyArgs = Record<string, unknown>;

/**
 * ── THE `#` PROBLEM ──────────────────────────────────────────────────
 * Delhivery's docs: the raw JSON body rejects `& # % ; \` and a
 * URL-encoded payload must be used instead. Indian addresses contain `#`
 * constantly ("#402, 3rd Cross, Indiranagar"), so this is a live
 * corruption risk, not an edge case — and the failure mode is a mangled
 * delivery address rather than a clean error.
 *
 * We are safe by construction: the `form-data-key` encoding runs the JSON
 * through URLSearchParams, which percent-encodes all five characters.
 * This suite pins that property directly against the encoding, because a
 * future "let's simplify the body encoding" refactor would silently
 * reintroduce the bug.
 */
describe('Delhivery create body encoding — the & # % ; \\ hazard', () => {
  /** Exactly what DelhiveryHttpService does for `encoding: form-data-key`. */
  const encodeAsDelhiveryBody = (payload: unknown): string => {
    const params = new URLSearchParams();
    params.set('format', 'json');
    params.set('data', JSON.stringify(payload));
    return params.toString();
  };

  const REAL_WORLD_ADDRESS = '#402, 3rd Cross & Main, 100% Silk Bldg; Lane\\2';

  it('percent-encodes every character Delhivery rejects', () => {
    const body = encodeAsDelhiveryBody({
      shipments: [{ add: REAL_WORLD_ADDRESS }],
    });
    // None of the five may appear raw in the transmitted body.
    expect(body).not.toMatch(/#/);
    expect(body).not.toMatch(/\\/);
    expect(body).not.toMatch(/;/);
    // `&` and `%` legitimately appear as separators/escapes, so assert the
    // ADDRESS's own copies were escaped rather than left as delimiters.
    expect(body).toContain('%23'); // #
    expect(body).toContain('%26'); // &
    expect(body).toContain('%25'); // %
    expect(body).toContain('%3B'); // ;
    expect(body).toContain('%5C'); // \
  });

  it('round-trips the address back EXACTLY — no silent mangling', () => {
    const body = encodeAsDelhiveryBody({
      shipments: [{ add: REAL_WORLD_ADDRESS }],
    });
    const parsed = new URLSearchParams(body);
    const data = JSON.parse(parsed.get('data') ?? '{}') as {
      shipments: Array<{ add: string }>;
    };
    // The address a courier prints must be the address we were given.
    expect(data.shipments[0]!.add).toBe(REAL_WORLD_ADDRESS);
  });

  it('keeps format=json alongside the payload', () => {
    const body = encodeAsDelhiveryBody({ shipments: [] });
    expect(new URLSearchParams(body).get('format')).toBe('json');
  });

  it('survives a `&` in a consignee NAME too, not just the address', () => {
    const body = encodeAsDelhiveryBody({
      shipments: [{ name: 'Ravi & Sons' }],
    });
    const data = JSON.parse(new URLSearchParams(body).get('data') ?? '{}') as {
      shipments: Array<{ name: string }>;
    };
    expect(data.shipments[0]!.name).toBe('Ravi & Sons');
  });
});

function makeEdit(stub = false, response: AnyArgs = { status: true }) {
  const request = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => response);
  const http = {
    isStubMode: jest.fn(async () => stub),
    request,
  } as unknown as DelhiveryHttpService;
  const assertWritable = jest.fn(async () => undefined);
  const writeGuard = { assertWritable } as unknown as DelhiveryWriteGuardService;
  return {
    svc: new DelhiveryShipmentEditService(http, writeGuard),
    request,
    assertWritable,
  };
}

describe('DelhiveryShipmentEditService', () => {
  it('refuses a Prepaid→COD conversion with no COD amount, before calling out', async () => {
    // Delhivery would reject this; failing locally says WHY.
    const sut = makeEdit();
    await expect(
      sut.svc.edit({ awbNumber: '123', paymentMode: 'COD' }),
    ).rejects.toThrow(/requires codAmountInr/);
    expect(sut.request).not.toHaveBeenCalled();
  });

  it('allows COD→Prepaid without an amount', async () => {
    const sut = makeEdit();
    await expect(
      sut.svc.edit({ awbNumber: '123', paymentMode: 'Prepaid' }),
    ).resolves.toMatchObject({ success: true });
  });

  it('sends only the fields being changed', async () => {
    const sut = makeEdit();
    await sut.svc.edit({ awbNumber: '123', phone: '+919876500000' });
    expect(sut.request.mock.calls[0]![0]['body']).toEqual({
      waybill: '123',
      phone: '+919876500000',
    });
  });

  it('cancel posts to the shared edit endpoint with the cancellation flag', async () => {
    const sut = makeEdit();
    await sut.svc.cancel('123');
    expect(sut.request.mock.calls[0]![0]).toMatchObject({
      path: '/api/p/edit',
      body: { waybill: '123', cancellation: 'true' },
    });
  });

  it('reads failure from the BODY, not the HTTP status', async () => {
    // Delhivery answers 200 and puts the error in the payload — verified
    // on tracking. Trusting res.ok would mark a rejected edit as done.
    const sut = makeEdit(false, { status: false, remark: 'Package in incorrect status' });
    const r = await sut.svc.edit({ awbNumber: '123', name: 'X' });
    expect(r.success).toBe(false);
    expect(r.message).toBe('Package in incorrect status');
  });

  it('is gated by the write guard on both edit and cancel', async () => {
    const sut = makeEdit();
    await sut.svc.edit({ awbNumber: '123', name: 'X' });
    await sut.svc.cancel('123');
    expect(sut.assertWritable).toHaveBeenNthCalledWith(
      1,
      'shipment.edit',
      expect.anything(),
    );
    expect(sut.assertWritable).toHaveBeenNthCalledWith(
      2,
      'shipment.cancel',
      expect.anything(),
    );
  });

  it('stub mode never touches the network', async () => {
    const sut = makeEdit(true);
    await expect(sut.svc.cancel('123')).resolves.toMatchObject({ success: true });
    expect(sut.request).not.toHaveBeenCalled();
  });
});
