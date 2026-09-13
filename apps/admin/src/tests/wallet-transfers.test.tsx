/**
 * Staff wallet transfers — the form that moves money between a seller's
 * wallet and our bank.
 *
 * Pins three things: the request names exactly what the server's DTO
 * declares (forbidNonWhitelisted turns one wrong name into a 400 on every
 * call); the preview's plain sentence is what the operator confirms; and a
 * server refusal is shown VERBATIM (FE-2), with a retry carrying the SAME
 * idempotency key (IDEM-1).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletTransfersIndex } from '@/app/(authed)/wallet-transfers/_components/wallet-transfers-index';
import { buildFetchMock, renderWithProviders } from './helpers';

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

describe('wallet transfer — client body matches the server DTO', () => {
  it('sends exactly the DTO fields', () => {
    const dto = R('../../../api/src/modules/admin-wallet-transfer/dto/wallet-transfer.dto.ts');
    const block = dto.slice(dto.indexOf('class WalletTransferDto'));
    const server = Array.from(
      block.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)[?!]:/gm),
      (m) => m[1] as string,
    ).sort();
    const hooks = R('../lib/wallet-transfer-hooks.ts');
    const from = hooks.indexOf('export interface WalletTransferBody');
    const iface = hooks.slice(from, hooks.indexOf('}', from));
    const client = Array.from(
      iface.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm),
      (m) => m[1] as string,
    ).sort();
    expect(server).toEqual([
      'amountInr',
      'bankAccountId',
      'direction',
      'idempotencyKey',
      'internalNote',
      'reason',
      'sellerId',
    ]);
    expect(client).toEqual(server);
  });

  it('the page is gated on the permission every one of its calls needs', () => {
    expect(R('../lib/page-access.ts')).toContain("['/wallet-transfers', 'money.wallet.transfer']");
  });
});

const CONTEXT = {
  seller: { id: 's-1', companyName: 'Menev Store', status: 'APPROVED' },
  walletInr: '111.40',
  heldInr: '111.40',
  accounts: [{ accountId: 'acct-1', label: 'HDFC', capitalInr: '50000.00', sellerInr: '111.40' }],
};
const PREVIEW = {
  sellerId: 's-1',
  companyName: 'Menev Store',
  direction: 'DEBIT',
  amountInr: '500.00',
  walletBeforeInr: '111.40',
  walletAfterInr: '-388.60',
  heldBeforeInr: '111.40',
  heldAfterInr: '0.00',
  cashMovedInr: '111.40',
  withoutCashInr: '388.60',
  accounts: [],
  sentence:
    "₹111.40 of Menev Store's money at HDFC becomes Skydrop's; their wallet goes from ₹111.40 to −₹388.60 — they will owe us ₹388.60.",
};

function requestBody(call: unknown[]): Record<string, unknown> {
  const init = call[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
}

describe('wallet transfer — preview, confirm, verdict', () => {
  it('shows the plain sentence, and a refusal verbatim — a retry reuses the same key', async () => {
    const user = userEvent.setup();
    const verdict = {
      code: 'WALLET_TRANSFER_CAPITAL_SHORT',
      message: 'Our own money in that account is ₹0.00.',
    };
    const fetchImpl = buildFetchMock([
      {
        match: /\/wallet-transfers\/sellers\/s-1\/context/,
        responses: [{ status: 200, body: CONTEXT }],
      },
      { match: /\/wallet-transfers\?sellerId=/, responses: [{ status: 200, body: { items: [] } }] },
      { match: /\/wallet-transfers\/preview$/, responses: [{ status: 200, body: PREVIEW }] },
      {
        match: /\/wallet-transfers$/,
        responses: [
          { status: 409, body: verdict },
          { status: 409, body: verdict },
        ],
      },
    ]);
    renderWithProviders(<WalletTransfersIndex initialSellerId="s-1" />, { fetchImpl });

    await screen.findByText('Menev Store');
    // By role: the (i) help button beside a hinted field is named after it too.
    await user.type(screen.getByRole('textbox', { name: /^Amount/ }), '500');
    await user.type(
      screen.getByRole('textbox', { name: /^Reason/ }),
      'Carton lost by the seller’s own forwarder before it reached us',
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByTestId('wallet-transfer-sentence')).toHaveTextContent(
      'they will owe us ₹388.60',
    );

    await user.click(screen.getByRole('button', { name: 'Post transfer' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, post it' }));
    expect(await screen.findByText(`[${verdict.code}] ${verdict.message}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, post it' }));
    await waitFor(() => {
      const posts = fetchImpl.mock.calls.filter((c) => /\/wallet-transfers$/.test(String(c[0])));
      expect(posts).toHaveLength(2);
    });
    const posts = fetchImpl.mock.calls.filter((c) => /\/wallet-transfers$/.test(String(c[0])));
    const [first, second] = posts.map(requestBody);
    expect(first).toMatchObject({ sellerId: 's-1', direction: 'DEBIT', amountInr: '500' });
    expect(typeof first?.['idempotencyKey']).toBe('string');
    expect(second?.['idempotencyKey']).toBe(first?.['idempotencyKey']);

    // The preview carried no key: it writes nothing.
    const previewCall = fetchImpl.mock.calls.find((c) => /\/preview$/.test(String(c[0])));
    expect(previewCall).toBeDefined();
    expect(requestBody(previewCall ?? [])).not.toHaveProperty('idempotencyKey');
  });
});
