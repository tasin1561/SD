import {
  describeEgress,
  egressCountryMatches,
  probeEgress,
  type FetchLike,
} from '../../src/common/net/egress-probe';

const answering = (status: number, body: unknown): FetchLike =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as FetchLike;

describe('probeEgress', () => {
  it('reads the address and where it is', async () => {
    const r = await probeEgress('http://127.0.0.1:8001/v1/publicip/ip', {
      fetchImpl: answering(200, {
        public_ip: '187.13.247.153',
        country: 'India',
        city: 'Mumbai',
      }),
    });
    expect(r).toEqual({
      kind: 'UP',
      reading: { publicIp: '187.13.247.153', country: 'India', city: 'Mumbai' },
    });
  });

  it('an EMPTY public_ip is the VPN saying it is carrying nothing — a NO, not an answer', async () => {
    const r = await probeEgress('http://x', { fetchImpl: answering(200, { public_ip: '' }) });
    expect(r.kind).toBe('DOWN');
  });

  it('a non-2xx is DOWN', async () => {
    const r = await probeEgress('http://x', { fetchImpl: answering(503, {}) });
    expect(r).toEqual({ kind: 'DOWN', reason: 'the egress check answered 503' });
  });

  it('NEVER throws — a probe that cannot be reached has the same answer as one that says no', async () => {
    const boom: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const r = await probeEgress('http://x', { fetchImpl: boom });
    expect(r.kind).toBe('DOWN');
    expect(r.kind === 'DOWN' && r.reason).toContain('ECONNREFUSED');
  });

  it('a body that is not an object is DOWN rather than a crash', async () => {
    const r = await probeEgress('http://x', { fetchImpl: answering(200, 'hello') });
    expect(r.kind).toBe('DOWN');
  });
});

describe('egressCountryMatches', () => {
  const reading = { publicIp: '1.2.3.4', country: 'India', city: 'Mumbai' };

  it('matches ignoring case and space', () => {
    expect(egressCountryMatches(reading, '  india ')).toBe(true);
  });

  it('refuses another country', () => {
    expect(egressCountryMatches(reading, 'United States')).toBe(false);
  });

  it('an EMPTY expectation accepts anywhere — an unset setting is not a match-nothing', () => {
    expect(egressCountryMatches(reading, '')).toBe(true);
    expect(egressCountryMatches({ ...reading, country: null }, '')).toBe(true);
  });

  it('a reading with no country cannot satisfy a stated one', () => {
    expect(egressCountryMatches({ ...reading, country: null }, 'India')).toBe(false);
  });
});

describe('describeEgress', () => {
  it('says the address and the place', () => {
    expect(describeEgress({ publicIp: '1.2.3.4', country: 'India', city: 'Mumbai' })).toBe(
      '1.2.3.4 (Mumbai, India)',
    );
  });

  it('falls back to the address alone', () => {
    expect(describeEgress({ publicIp: '1.2.3.4', country: null, city: null })).toBe('1.2.3.4');
  });
});
