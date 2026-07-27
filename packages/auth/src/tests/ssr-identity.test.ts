import { describe, expect, it, vi } from 'vitest';
import { resolveStaffSsrIdentity, resolveSellerSsrIdentity } from '../server/identity';

function jsonResponse(status: number, body: unknown = null): Response {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveStaffSsrIdentity', () => {
  it('forwards the __Host- cookie to /auth/staff/me — does NOT call /refresh', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      // The single sanctioned API call: GET /auth/staff/me on the
      // direct API origin (NOT through the proxy — SSR goes
      // server-to-server). The Cookie header MUST carry the exact
      // value under the right name.
      expect(u).toBe('https://api.skydrop.online/auth/staff/me');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBe('__Host-staffRefresh=secret-cookie-value');
      // Critical: the SSR path never hits /refresh.
      return jsonResponse(200, {
        id: 'sx',
        email: 'a@b',
        emailDisplay: 'a@b',
        role: 'SUPER_ADMIN',
        emailVerifiedAt: null,
        lastLoginAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    const result = await resolveStaffSsrIdentity({
      apiOrigin: 'https://api.skydrop.online',
      identityKind: 'staff',
      cookieValue: 'secret-cookie-value',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.state).toBe('authenticated');
    if (result.state === 'authenticated') {
      expect(result.identity.email).toBe('a@b');
      expect(result.identity.role).toBe('SUPER_ADMIN');
    }
    // Hard assertion: ONE call total — no refresh, no retry.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('empty cookie value → not-authenticated immediately (no network call)', async () => {
    const fetchImpl = vi.fn();
    const result = await resolveStaffSsrIdentity({
      apiOrigin: 'https://api.skydrop.online',
      identityKind: 'staff',
      cookieValue: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe('not-authenticated');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401 → not-authenticated (caller redirects to /login)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { code: 'UNAUTHORIZED' }));
    const result = await resolveStaffSsrIdentity({
      apiOrigin: 'https://api.skydrop.online',
      identityKind: 'staff',
      cookieValue: 'dead-cookie',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe('not-authenticated');
  });

  it('5xx → throws (caller shows generic service-unavailable, NOT logged-out)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503));
    await expect(
      resolveStaffSsrIdentity({
        apiOrigin: 'https://api.skydrop.online',
        identityKind: 'staff',
        cookieValue: 'fine-cookie',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/SSR \/me failed/);
  });
});

describe('resolveSellerSsrIdentity', () => {
  it('uses the seller cookie name + seller /me path', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.skydrop.online/auth/seller/me');
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      expect(headers.get('cookie')).toBe('__Host-sellerRefresh=s-cookie');
      return jsonResponse(200, {
        id: 'sx',
        email: 'a@b',
        emailDisplay: 'a@b',
        companyName: 'Acme',
        contactPersonName: 'A',
        phone: '+880',
        whatsapp: null,
        status: 'APPROVED',
        approvedAt: null,
        displayCurrency: 'INR',
        displayLanguage: 'en',
        countryCode: 'BD',
        emailVerifiedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });
    const result = await resolveSellerSsrIdentity({
      apiOrigin: 'https://api.skydrop.online',
      identityKind: 'seller',
      cookieValue: 's-cookie',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe('authenticated');
    if (result.state === 'authenticated') {
      expect(result.identity.companyName).toBe('Acme');
      expect(result.identity.status).toBe('APPROVED');
    }
  });

  it('403 (e.g., SUSPENDED seller) → forbidden with code', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, { code: 'ACCOUNT_NOT_ACTIVE' }));
    const result = await resolveSellerSsrIdentity({
      apiOrigin: 'https://api.skydrop.online',
      identityKind: 'seller',
      cookieValue: 's-cookie',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe('forbidden');
    if (result.state === 'forbidden') expect(result.code).toBe('ACCOUNT_NOT_ACTIVE');
  });
});
