/**
 * FE-2 boundary — promoting a courier message into a live pattern.
 *
 * This is the one new admin write surface with a real temptation to
 * pre-empt the server. The form knows the candidate's body, so it could
 * "helpfully" test the regex client-side and refuse before asking — and
 * the moment it does, the server's PATTERN_DOES_NOT_MATCH becomes
 * unreachable and the enforcement has quietly moved into the browser.
 * That is exactly the FE-2 erosion mode, so it is pinned here.
 *
 * The other half pinned: a pattern's promotion changes how every future
 * courier message is labelled, and the label is what a seller is shown.
 * So the test also asserts the request body carries what the reviewer
 * typed, unedited.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourierTemplatesIndex } from '@/app/(authed)/courier-escalation/templates/_components/templates-index';
import { buildFetchMock, renderWithProviders, makeStaff } from './helpers';
import type { StaffRole } from '@skydrop/db';

const CANDIDATE = {
  id: 'cand-1',
  body: 'Your shipment 1234567890 has been rescheduled for delivery within 24-48 hours.',
  seenCount: 12,
  status: 'PENDING',
  suggestedRegex: null,
  suggestedState: null,
  firstSeenAt: '2026-08-01T10:00:00.000Z',
  lastSeenAt: '2026-08-05T10:00:00.000Z',
};

const WRITER = makeStaff('SUPER_ADMIN' as StaffRole, ['courier.ops.view', 'courier.ops.write']);

function routes(promoteResponse: { status: number; body?: unknown }) {
  return [
    {
      match: /\/api\/admin\/courier-escalation\/template-candidates$/,
      responses: [{ status: 200, body: [CANDIDATE] }],
    },
    {
      match: /\/api\/admin\/courier-escalation\/templates$/,
      responses: [{ status: 200, body: [] }],
    },
    {
      match: /\/template-candidates\/cand-1\/promote$/,
      responses: [promoteResponse],
    },
  ];
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, pattern: string) {
  await user.click(await screen.findByRole('button', { name: /write a pattern/i }));
  await user.type(screen.getByLabelText(/^Code/i), 'NDR_ACK_24_48');
  await user.type(screen.getByLabelText(/^Means/i), 'ACKNOWLEDGED');
  await user.type(screen.getByLabelText(/^Pattern/i), pattern);
  await user.click(screen.getByRole('button', { name: /make it live/i }));
}

describe('FE-2 boundary — courier pattern promotion', () => {
  it('a pattern that does not match: the SERVER refuses and the verdict renders VERBATIM (no client-side pre-emption)', async () => {
    const user = userEvent.setup();
    const rejection = {
      code: 'PATTERN_DOES_NOT_MATCH',
      message:
        'That pattern does not match the message it was written for. Test it against the body shown before promoting.',
    };
    const fetchImpl = buildFetchMock(routes({ status: 400, body: rejection }));

    renderWithProviders(<CourierTemplatesIndex />, { fetchImpl, identity: WRITER });

    // A pattern the reviewer believes in and which does NOT match the body
    // shown above the form.
    await fillAndSubmit(user, 'out for delivery today');

    // The request WAS made — the UI did not decide for the server. That is
    // the property: it can see the body, and it still asks.
    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => /\/promote$/.test(String(c[0])))).toBe(true);
    });

    const verdict = await screen.findByText(/PATTERN_DOES_NOT_MATCH/);
    expect(verdict.textContent).toContain('[PATTERN_DOES_NOT_MATCH]');
    expect(verdict.textContent).toContain('Test it against the body shown');
  });

  it('sends what the reviewer typed, unedited', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock(
      routes({
        status: 200,
        body: {
          id: 'tpl-1',
          code: 'NDR_ACK_24_48',
          pattern: 'rescheduled for delivery',
          state: 'ACKNOWLEDGED',
          action: null,
          priority: 50,
          isActive: true,
        },
      }),
    );

    renderWithProviders(<CourierTemplatesIndex />, { fetchImpl, identity: WRITER });
    await fillAndSubmit(user, 'rescheduled for delivery within 24-48');

    const call = await waitFor(() => {
      const found = fetchImpl.mock.calls.find((c) => /\/promote$/.test(String(c[0])));
      expect(found).toBeDefined();
      return found;
    });
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    // Verbatim: no normalising, no escaping, no lower-casing. A regex the
    // UI "tidied" is a different regex.
    expect(body['pattern']).toBe('rescheduled for delivery within 24-48');
    expect(body['code']).toBe('NDR_ACK_24_48');
    expect(body['state']).toBe('ACKNOWLEDGED');
  });

  it('cosmetic RBAC: a viewer sees the candidate and gets no promote control', async () => {
    const fetchImpl = buildFetchMock(routes({ status: 200 }));

    renderWithProviders(<CourierTemplatesIndex />, {
      fetchImpl,
      identity: makeStaff('CALL_AGENT' as StaffRole, ['courier.ops.view']),
    });

    // The body is still READABLE — hiding the corpus from someone allowed
    // to look at it would make the queue useless as a record.
    expect(await screen.findByText(/has been rescheduled for delivery/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write a pattern/i })).not.toBeInTheDocument();
  });
});
