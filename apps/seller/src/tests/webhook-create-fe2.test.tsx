/**
 * FE-2 boundary — seller write. Pins the server-verdict-verbatim
 * discipline for a seller-side write action (mirrors apps/admin's
 * god-mode-fe2.test.tsx).
 *
 * The webhook create flow was chosen as the pattern-setter because:
 *   - It's a plain modal-driven POST with a small DTO surface →
 *     simple to drive in vitest.
 *   - The server's response distinguishes failure (rejection with
 *     `{code, message}`) from success (returns the row with the
 *     plaintext secretKey — one-shot reveal). Both paths are
 *     observable here.
 *   - FE-2 says the UI shows the server's `[code] message` VERBATIM
 *     and never pre-empts with a client-side mirror of the policy.
 *     If a future refactor moves URL/event validation client-side,
 *     this test fails — exactly the regression we want to catch.
 *
 * Discipline is structurally enforced everywhere already (every
 * mutation hook routes through ApiError → fmtError → setError) but
 * one explicit pinning test per app keeps the contract visible.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebhookFormModal } from '@/app/(authed)/settings/webhooks/_components/webhook-form-modal';
import { buildFetchMock, renderWithProviders } from './helpers';

describe('FE-2 boundary — seller webhook create', () => {
  it('server-rejection VERBATIM: the server returns [HTTPS_REQUIRED] → UI displays the verdict EXACTLY (no client-side pre-emption)', async () => {
    const user = userEvent.setup();

    const serverRejection = {
      code: 'HTTPS_REQUIRED',
      message: 'url must use https',
    };
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/seller\/webhook-endpoints$/,
        responses: [{ status: 400, body: serverRejection }],
      },
    ]);

    renderWithProviders(
      <WebhookFormModal
        mode="create"
        onClose={() => undefined}
        onSuccess={() => undefined}
      />,
      { fetchImpl },
    );

    // The URL field's HTML-level `type="url"` would normally enforce
    // a basic protocol shape, but the server's bug here is "we said
    // the validation rule MOVED to https-only and you haven't
    // redeployed the client" — FE-2's whole point. The form submits
    // an http URL (the client wouldn't have flagged it pre-protocol
    // bump); the server rejects.
    const urlInput = screen.getByPlaceholderText(
      'https://example.com/skydrop/webhooks',
    );
    await user.clear(urlInput);
    // browsers accept http://, but the server now demands https.
    await user.type(urlInput, 'http://example.com/skydrop');

    // Submit.
    const submit = screen.getByRole('button', { name: /Create endpoint/i });
    await user.click(submit);

    // The server's [code] + message render verbatim — NOT a generic
    // "failed", NOT a client-side rephrase.
    const verdict = await screen.findByText(/HTTPS_REQUIRED/);
    expect(verdict.textContent).toContain('[HTTPS_REQUIRED]');
    expect(verdict.textContent).toContain(serverRejection.message);

    // The submit button is re-enabled so the operator can correct
    // + retry; we don't trap them in a busy state on failure.
    await waitFor(() => {
      expect(submit).not.toBeDisabled();
    });
  });

  it('happy path: server returns 201 with the full WebhookEndpointWithSecret → onSuccess called verbatim', async () => {
    const user = userEvent.setup();

    const serverResult = {
      id: 'wh-1',
      url: 'https://example.com/skydrop',
      name: 'Acme CRM',
      description: null,
      subscribedEvents: ['order.confirmed', 'shipment.dispatched'],
      isActive: true,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailureCount: 0,
      autoDisabledAt: null,
      autoDisabledReason: null,
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
      secretKey: 'a'.repeat(64),
    };
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/seller\/webhook-endpoints$/,
        responses: [{ status: 201, body: serverResult }],
      },
    ]);

    let captured: unknown = null;
    renderWithProviders(
      <WebhookFormModal
        mode="create"
        onClose={() => undefined}
        onSuccess={(r) => {
          captured = r;
        }}
      />,
      { fetchImpl },
    );

    // The form is pre-populated with sensible defaults (https://
    // placeholder + canonical event codes), so submitting as-is
    // works for the happy-path drive.
    const urlInput = screen.getByPlaceholderText(
      'https://example.com/skydrop/webhooks',
    );
    await user.clear(urlInput);
    await user.type(urlInput, 'https://example.com/skydrop');

    await user.click(screen.getByRole('button', { name: /Create endpoint/i }));

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });

    // FE-2 corollary: the UI receives the server's response object
    // verbatim — INCL. the plaintext secretKey for the one-shot
    // reveal card. We don't transform or strip fields client-side.
    expect(captured).toEqual(serverResult);
  });
});
