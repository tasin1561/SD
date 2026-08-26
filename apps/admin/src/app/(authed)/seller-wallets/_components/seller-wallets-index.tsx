'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import {
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Stat,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useSellerWalletOverview } from '@/lib/seller-wallet-hooks';

/**
 * Every seller's wallet in one place.
 *
 * The two directions are kept APART rather than netted. A seller
 * ₹50,000 in credit and another ₹50,000 in debt is not a business with
 * nothing outstanding: one is money we must be able to pay on demand,
 * the other is money we may never see. A single net figure would be
 * true of nobody.
 */
export function SellerWalletsIndex(): ReactElement {
  const overview = useSellerWalletOverview();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Seller wallets"
        subtitle="What we owe sellers, what they owe us, and every ledger behind those two numbers."
      />

      {overview.isLoading ? (
        <LoadingState />
      ) : overview.isError || overview.data === undefined ? (
        <ErrorState
          message={overview.error?.message ?? 'Failed to load.'}
          retry={() => void overview.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="We owe sellers"
              value={<Money amount={overview.data.totals.owedToSellersInr} currency="INR" />}
              hint={`${overview.data.totals.sellersInCredit} in credit — payable on demand`}
              tone="warn"
            />
            <Stat
              label="Sellers owe us"
              value={<Money amount={overview.data.totals.owedBySellersInr} currency="INR" />}
              hint={`${overview.data.totals.sellersInDebt} in debt`}
              tone="bad"
            />
            <Stat
              label="Requested for payout"
              value={<Money amount={overview.data.totals.pendingWithdrawalInr} currency="INR" />}
              hint="Held out of what those sellers can request again"
              tone="neutral"
            />
            <Stat
              label="Top-ups awaiting review"
              value={<Money amount={overview.data.totals.pendingTopupInr} currency="INR" />}
              hint="Claimed, not yet matched to a statement — in no balance"
              tone="neutral"
            />
          </div>

          <Card>
            <CardBody>
              <Table>
                <THead>
                  <Tr>
                    <Th>Seller</Th>
                    <Th align="right">Balance</Th>
                    <Th align="right">Requested out</Th>
                    <Th align="right">Awaiting review</Th>
                    <Th>Last movement</Th>
                  </Tr>
                </THead>
                <TBody>
                  {overview.data.rows.length === 0 ? (
                    <TableEmpty colSpan={5}>
                      No sellers yet. Every approved seller appears here, whether or not money has
                      moved.
                    </TableEmpty>
                  ) : (
                    overview.data.rows.map((r) => (
                      <Tr key={r.sellerId}>
                        <Td>
                          <Link
                            href={`/seller-wallets/${r.sellerId}`}
                            className="text-text-bright hover:underline"
                          >
                            {r.companyName}
                          </Link>
                          <div className="text-text-faint text-xs">{r.email}</div>
                        </Td>
                        <Td align="right">
                          <Money
                            amount={r.balanceInr}
                            currency="INR"
                            direction={Number(r.balanceInr) < 0 ? 'debit' : 'neutral'}
                          />
                        </Td>
                        <Td align="right" className="text-text-muted">
                          {Number(r.pendingWithdrawalInr) > 0 ? (
                            <Money amount={r.pendingWithdrawalInr} currency="INR" />
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </Td>
                        <Td align="right" className="text-text-muted">
                          {Number(r.pendingTopupInr) > 0 ? (
                            <Money amount={r.pendingTopupInr} currency="INR" />
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </Td>
                        <Td className="text-text-faint text-xs">
                          {r.updatedAt === null ? '—' : new Date(r.updatedAt).toLocaleDateString()}
                        </Td>
                      </Tr>
                    ))
                  )}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
