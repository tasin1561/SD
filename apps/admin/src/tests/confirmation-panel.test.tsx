/**
 * Phone-confirmation panel on a client's page.
 *
 * Admin and the client write ONE override row (last writer wins), so the
 * panel has to say who wrote it and when, or one silently undoes the
 * other. The 1-168 bound is shown as help text before submit but ENFORCED
 * by the server (FE-2), whose `[CODE] message` is shown verbatim.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmationCallsPanel } from '@/app/(authed)/sellers/_components/seller-confirmation-panel';
import type { ResolvedSetting } from '@/app/(authed)/sellers/_components/seller-settings-hooks';
import { buildFetchMock, renderWithProviders } from './helpers';

const REQ = 'ops.call_confirmation_required';
const TTL = 'ops.call_auto_confirm_ttl_hours';

function defaults(): ResolvedSetting[] {
  return [
    { key: REQ, valueType: 'BOOLEAN', value: true, source: 'SYSTEM_DEFAULT', systemDefault: true },
    { key: TTL, valueType: 'INT', value: 24, source: 'SYSTEM_DEFAULT', systemDefault: 24 },
  ];
}
function overridden(by: Partial<ResolvedSetting>): ResolvedSetting[] {
  return [
    {
      key: REQ,
      valueType: 'BOOLEAN',
      value: false,
      source: 'SELLER_OVERRIDE',
      systemDefault: true,
      updatedAt: '2026-11-03T08:30:00.000Z',
      ...by,
    },
    {
      key: TTL,
      valueType: 'INT',
      value: 48,
      source: 'SELLER_OVERRIDE',
      systemDefault: 24,
      updatedAt: '2026-11-03T08:30:00.000Z',
      ...by,
    },
  ];
}

describe('ConfirmationCallsPanel', () => {
  it('disables the TTL field while calls are on, and states the bound before submit', () => {
    renderWithProviders(<ConfirmationCallsPanel sellerId="s1" settings={defaults()} />);
    expect(screen.getByLabelText(/auto-confirm after/i)).toBeDisabled();
    expect(screen.getByText(/from 1 to 168/i)).toBeInTheDocument();
  });

  it('enables the TTL field once calls are switched off', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConfirmationCallsPanel sellerId="s1" settings={defaults()} />);
    await user.click(screen.getByRole('switch'));
    expect(screen.getByLabelText(/auto-confirm after/i)).toBeEnabled();
    expect(screen.getByText(/carries the return cost/i)).toBeInTheDocument();
  });

  it('renders the platform default with no author', () => {
    renderWithProviders(<ConfirmationCallsPanel sellerId="s1" settings={defaults()} />);
    expect(screen.getAllByText(/platform default/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Nobody has changed this/i)).toBeInTheDocument();
  });

  it('attributes an override to staff, with the time', () => {
    renderWithProviders(
      <ConfirmationCallsPanel sellerId="s1" settings={overridden({ setByStaffId: 'st-1' })} />,
    );
    expect(screen.getByText(/Last set by Skydrop staff on/i)).toBeInTheDocument();
    expect(screen.getByText(/Set for this client/i)).toBeInTheDocument();
    expect(screen.queryByText(/replaces their choice/i)).toBeNull();
  });

  it('reads a null staff id as the client, and an absent one as not recorded', () => {
    const { unmount } = renderWithProviders(
      <ConfirmationCallsPanel sellerId="s1" settings={overridden({ setByStaffId: null })} />,
    );
    expect(screen.getByText(/Last set by the client on/i)).toBeInTheDocument();
    unmount();
    renderWithProviders(<ConfirmationCallsPanel sellerId="s1" settings={overridden({})} />);
    expect(screen.getByText(/who set it was not recorded/i)).toBeInTheDocument();
  });

  it('attributes an override to the client and warns that saving replaces it', () => {
    renderWithProviders(
      <ConfirmationCallsPanel sellerId="s1" settings={overridden({ setBySellerId: 'sel-1' })} />,
    );
    expect(screen.getByText(/Last set by the client on/i)).toBeInTheDocument();
    expect(screen.getByText(/Saving replaces their choice/i)).toBeInTheDocument();
  });

  it('saves the switch then the TTL through the per-client override endpoint', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /settings\/ops\.call_confirmation_required/,
        responses: [{ status: 200, body: {} }],
      },
      {
        match: /settings\/ops\.call_auto_confirm_ttl_hours/,
        responses: [{ status: 200, body: {} }],
      },
    ]);
    renderWithProviders(<ConfirmationCallsPanel sellerId="s1" settings={defaults()} />, {
      fetchImpl,
    });
    await user.click(screen.getByRole('switch'));
    const field = screen.getByLabelText(/auto-confirm after/i);
    await user.clear(field);
    await user.type(field, '36');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies[0]).toMatchObject({ valueType: 'BOOLEAN', value: false });
    expect(bodies[1]).toMatchObject({ valueType: 'INT', value: 36 });
  });

  it('shows the server refusal verbatim', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /settings\//,
        responses: [
          { status: 400, body: { code: 'SETTING_OUT_OF_RANGE', message: 'ttl must be 1 to 168' } },
        ],
      },
    ]);
    renderWithProviders(<ConfirmationCallsPanel sellerId="s1" settings={defaults()} />, {
      fetchImpl,
    });
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(
      await screen.findByText(/\[SETTING_OUT_OF_RANGE\] ttl must be 1 to 168/),
    ).toBeInTheDocument();
  });
});
