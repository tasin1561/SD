import { DelhiveryLabelService } from '../../src/modules/courier-delhivery/services/delhivery-label.service';
import { DelhiveryServiceabilityService } from '../../src/modules/courier-delhivery/services/delhivery-serviceability.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';

function makeHttp(opts: { stubMode?: boolean } = {}) {
  const isStubMode = jest.fn(async () => opts.stubMode ?? true);
  const authHeaders = jest.fn(async () => ({ Authorization: 'Token x' }));
  const request = jest.fn(async () => {
    throw new Error('real-mode ... TODO(delhivery-api)');
  });
  return { isStubMode, authHeaders, request };
}

describe('DelhiveryLabelService.fetchLabel', () => {
  it('stub mode: returns deterministic PDF bytes keyed on the AWB', async () => {
    const http = makeHttp({ stubMode: true });
    const svc = new DelhiveryLabelService(http as unknown as DelhiveryHttpService);
    const a = await svc.fetchLabel('DLVSTUB1');
    const b = await svc.fetchLabel('DLVSTUB1');
    expect(a.mimeType).toBe('application/pdf');
    expect(a.bytes.toString('utf8')).toContain('%PDF-1.4');
    expect(a.bytes.toString('utf8')).toContain('DLVSTUB1');
    expect(a.bytes.equals(b.bytes)).toBe(true); // deterministic
    expect(http.request).not.toHaveBeenCalled();
  });

  it('distinct AWBs → distinct label bytes', async () => {
    const http = makeHttp({ stubMode: true });
    const svc = new DelhiveryLabelService(http as unknown as DelhiveryHttpService);
    const a = await svc.fetchLabel('DLVSTUB1');
    const b = await svc.fetchLabel('DLVSTUB2');
    expect(a.bytes.equals(b.bytes)).toBe(false);
  });

  it('real mode: routes through authHeaders + request (TODO(delhivery-api) throw)', async () => {
    const http = makeHttp({ stubMode: false });
    const svc = new DelhiveryLabelService(http as unknown as DelhiveryHttpService);
    await expect(svc.fetchLabel('AWB1')).rejects.toThrow(/TODO\(delhivery-api\)/);
    expect(http.authHeaders).toHaveBeenCalled();
  });
});

describe('DelhiveryServiceabilityService.checkServiceability', () => {
  it('stub mode: serviceable for a normal pincode, fromLiveApi false', async () => {
    const http = makeHttp({ stubMode: true });
    const svc = new DelhiveryServiceabilityService(
      http as unknown as DelhiveryHttpService,
    );
    expect(await svc.checkServiceability('560001')).toEqual({
      serviceable: true,
      fromLiveApi: false,
    });
  });

  it('stub mode: 000000 → not serviceable (consistent with the AWB stub)', async () => {
    const http = makeHttp({ stubMode: true });
    const svc = new DelhiveryServiceabilityService(
      http as unknown as DelhiveryHttpService,
    );
    expect(await svc.checkServiceability('000000')).toEqual({
      serviceable: false,
      fromLiveApi: false,
    });
  });

  it('real mode: routes through request (TODO(delhivery-api) throw)', async () => {
    const http = makeHttp({ stubMode: false });
    const svc = new DelhiveryServiceabilityService(
      http as unknown as DelhiveryHttpService,
    );
    await expect(svc.checkServiceability('560001')).rejects.toThrow(
      /TODO\(delhivery-api\)/,
    );
  });
});
