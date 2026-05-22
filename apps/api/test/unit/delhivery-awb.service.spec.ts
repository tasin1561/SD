import { DelhiveryAwbService } from '../../src/modules/courier-delhivery/services/delhivery-awb.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';
import type { DelhiveryAwbRequest } from '../../src/modules/courier-delhivery/types/delhivery.types';

function awbReq(over: Partial<DelhiveryAwbRequest> = {}): DelhiveryAwbRequest {
  return {
    shipmentNumber: 'SH-2026-05-000042',
    recipientName: 'Asha Verma',
    recipientPhoneE164: '+919876543210',
    addressLine1: '12 MG Road',
    addressLine2: null,
    city: 'Bengaluru',
    stateProvince: 'Karnataka',
    postalCode: '560001',
    countryCode: 'IN',
    totalWeightGrams: 500,
    declaredValueInr: '999.00',
    codAmountInr: '999.00',
    itemDescription: 'Widget x2',
    ...over,
  };
}

function makeService(opts: { stubMode?: boolean } = {}) {
  const isStubMode = jest.fn(async () => opts.stubMode ?? true);
  const authHeaders = jest.fn(async () => ({ Authorization: 'Token x' }));
  const request = jest.fn(async () => {
    throw new Error(
      'DelhiveryHttpService.request: real-mode ... TODO(delhivery-api)',
    );
  });
  const http = { isStubMode, authHeaders, request };
  const svc = new DelhiveryAwbService(
    http as unknown as DelhiveryHttpService,
  );
  return { svc, isStubMode, authHeaders, request };
}

describe('DelhiveryAwbService.generateAwb — stub mode', () => {
  it('returns a deterministic success for a serviceable pincode', async () => {
    const { svc } = makeService({ stubMode: true });
    const r = await svc.generateAwb(awbReq({ shipmentNumber: 'SH-2026-05-000042' }));
    expect(r).toEqual({
      ok: true,
      awbNumber: 'DLVSTUB202605000042',
      courierShipmentId: 'DLVSHP202605000042',
      labelUrl: null,
    });
  });

  it('is deterministic — same shipmentNumber → same awbNumber', async () => {
    const { svc } = makeService({ stubMode: true });
    const a = await svc.generateAwb(awbReq());
    const b = await svc.generateAwb(awbReq());
    expect(a).toEqual(b);
  });

  it('pincode 000000 → non-serviceable failure (ok:false, serviceable:false)', async () => {
    const { svc } = makeService({ stubMode: true });
    const r = await svc.generateAwb(awbReq({ postalCode: '000000' }));
    expect(r).toEqual({
      ok: false,
      serviceable: false,
      errorCode: 'STUB_NON_SERVICEABLE',
      errorMessage: expect.any(String),
    });
  });

  it('pincode 999999 → transient courier failure (ok:false, serviceable:true)', async () => {
    const { svc } = makeService({ stubMode: true });
    const r = await svc.generateAwb(awbReq({ postalCode: '999999' }));
    expect(r).toMatchObject({
      ok: false,
      serviceable: true,
      errorCode: 'STUB_COURIER_FAILURE',
    });
  });

  it('does not call authHeaders or request in stub mode', async () => {
    const { svc, authHeaders, request } = makeService({ stubMode: true });
    await svc.generateAwb(awbReq());
    expect(authHeaders).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('DelhiveryAwbService.generateAwb — real mode', () => {
  it('routes through authHeaders + request (which throws — TODO(delhivery-api))', async () => {
    const { svc, authHeaders, request } = makeService({ stubMode: false });
    await expect(svc.generateAwb(awbReq())).rejects.toThrow(
      /TODO\(delhivery-api\)/,
    );
    expect(authHeaders).toHaveBeenCalled();
    expect(request).toHaveBeenCalled();
  });
});
